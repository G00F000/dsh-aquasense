/**
 * S9 每日任务提醒(插件内模块,V2)
 *
 * 由插件 apply() 托管生命周期,设计详见 docs/s9-daily-reminder-architecture.md:
 *  - 配置来源: 插件配置文件 > 环境变量(remind/config.json 为配置页持久化产物)
 *  - 到点推送任务提醒卡片;工人按提醒拍照/汇报(落 S1-S8 场景台账),异常自动预警
 *  - 重启恢复当日剩余计划: 已推送不重复、已过时间点不补推、同一时间点仅推送一次
 *  - 仅提醒: 不写任何多维表格、卡片无打卡交互
 *
 * 对外暴露入口:
 *  - setupS9Reminder(ctx)          插件启动/配置变更时调用(enabled=false 时直接跳过)
 *  - pushAbnormalAlert(input)      异常预警(供 analyze 主链路调用)
 *  - getRemindConfig()             读取当前生效配置(配置页 gateway 使用)
 *  - saveRemindConfig(input)       保存配置并重建当日推送计划(配置页「保存配置」)
 *  - sendTestReminder()            立即推送一次总览卡片(配置页「发送测试提醒」)
 *  - getRemindStatus()             当日计划/已推送/下一项(配置页状态展示)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFeishuToken } from '../feishu/token.js';
import { resolveCacheRoot } from '../ima/ima-api.js';
// ========== 常量 ==========
const TICK_MS = 60_000;
const RETRY_DELAY_MS = 30_000;
/** 默认总览推送时刻(config.json 中 cron 字段的默认值) */
export const DEFAULT_CRON = '0 7 * * *';
/** 历史状态文件(plan/sent)保留天数,更早的自动清理(架构文档 §9) */
const KEEP_STATE_DAYS = 7;
/** 任务卡片剩余任务预览条数(原型 2) */
const REMAINING_PREVIEW_COUNT = 3;
// ========== 模块级运行状态 ==========
let tickTimer = null;
let activeConfig = null;
let currentPlan = null;
/** 本进程已触发过的时间点(含推送失败),防同一分钟重复触发 */
let processedKeys = new Set();
/** 已成功推送的时间点(磁盘持久化,防重启重复) */
let sentKeys = new Set();
/** tick 防重入(推送含 30s 重试,可能跨过下一个 tick) */
let ticking = false;
// ========== 日志(格式见架构文档 §10) ==========
function log(...args) {
    console.log('[aquasense-remind]', ...args);
}
function warn(...args) {
    console.warn('[aquasense-remind]', ...args);
}
// ========== 1. 配置解析(文件 > 环境变量,非法值不阻断插件启动) ==========
/** 配置/状态文件目录: $AQUASENSE_CACHE_DIR/remind/ */
function remindDir() {
    const dir = join(resolveCacheRoot(), 'remind');
    mkdirSync(dir, { recursive: true });
    return dir;
}
function loadConfig() {
    const file = readConfigFile();
    const enabled = file?.enabled ?? process.env.S9_REMIND_ENABLED === 'true';
    const group = (file?.group || process.env.S9_REMIND_GROUP || '').trim();
    const cron = (file?.cron || process.env.S9_REMIND_CRON || DEFAULT_CRON).trim();
    // 配置文件优先;文件未提供任务时回退环境变量 JSON
    const rawTasks = file?.tasks !== undefined ? file.tasks : parseEnvTasks(process.env.S9_REMIND_TASKS);
    const { tasks, skipped } = sanitizeTasks(rawTasks);
    if (skipped > 0) {
        warn(`S9_REMIND_TASKS 有 ${skipped} 条非法项已跳过(time 需为 HH:MM、task 需非空)`);
    }
    return { enabled, group, cron, tasks };
}
function readConfigFile() {
    const path = join(remindDir(), 'config.json');
    if (!existsSync(path))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        warn('config.json 解析失败,忽略并回退环境变量');
        return null;
    }
}
function parseEnvTasks(raw) {
    if (!raw?.trim())
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        warn('S9_REMIND_TASKS 不是合法 JSON,已忽略');
        return undefined;
    }
}
/** 单条任务归一化:非法返回 null(配置页校验与配置解析共用同一口径) */
export function normalizeRemindTask(input) {
    const entry = input;
    const time = typeof entry?.time === 'string' ? normalizeTime(entry.time) : '';
    const task = typeof entry?.task === 'string' ? entry.task.trim() : '';
    if (!isValidHHMM(time) || !task)
        return null;
    return { time, task };
}
/** 校验任务列表:非法条目跳过并计数;合法条目按 time 升序 */
function sanitizeTasks(raw) {
    if (!Array.isArray(raw))
        return { tasks: [], skipped: raw === undefined ? 0 : 1 };
    const tasks = [];
    let skipped = 0;
    for (const item of raw) {
        const task = normalizeRemindTask(item);
        if (!task) {
            skipped++;
            continue;
        }
        tasks.push(task);
    }
    return { tasks: tasks.sort((a, b) => a.time.localeCompare(b.time)), skipped };
}
/** 时间归一: "8:30"/"08：30" → "08:30" */
function normalizeTime(raw) {
    const m = raw.trim().match(/^(\d{1,2})[:：](\d{2})$/);
    if (!m)
        return raw.trim();
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59)
        return raw.trim();
    return `${pad(hh)}:${pad(mm)}`;
}
function isValidHHMM(value) {
    const m = value.match(/^(\d{2}):(\d{2})$/);
    if (!m)
        return false;
    return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}
/**
 * 解析 cron 出"每天 HH:MM"时刻(本场景仅使用该语义,见架构文档 §3.2)。
 * 非 5 段、或日/月/周段非 `*`、或分时非固定数字 → null(跳过总览项)。
 */
function parseCronTime(expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5)
        return null;
    const [minPart, hourPart, dom, month, dow] = parts;
    if (dom !== '*' || month !== '*' || dow !== '*')
        return null;
    const minMatch = /^(\d{1,2})$/.exec(minPart);
    const hourMatch = /^(\d{1,2})$/.exec(hourPart);
    if (!minMatch || !hourMatch)
        return null;
    const mm = Number(minMatch[1]);
    const hh = Number(hourMatch[1]);
    if (hh > 23 || mm > 59)
        return null;
    return `${pad(hh)}:${pad(mm)}`;
}
// ========== 2. 推送计划生成与状态文件(架构文档 §3.3 / §9) ==========
function planPath(date) {
    return join(remindDir(), `plan-${date}.json`);
}
function sentPath(date) {
    return join(remindDir(), `sent-${date}.json`);
}
function buildPlanItems(overviewTime, tasks) {
    const items = [];
    if (overviewTime)
        items.push({ time: overviewTime, type: 'overview' });
    for (const t of tasks)
        items.push({ time: t.time, type: 'task', task: t.task });
    return items.sort((a, b) => a.time.localeCompare(b.time));
}
/**
 * 加载或生成当日计划:
 *  - 磁盘已有且与配置一致 → 复用(重启场景,保证当日语义不漂移)
 *  - 不存在或配置已变更 → 重新生成并落盘(配置页保存配置立即重建)
 */
function loadOrBuildPlan(date, overviewTime, tasks) {
    const expected = buildPlanItems(overviewTime, tasks);
    if (existsSync(planPath(date))) {
        try {
            const existing = JSON.parse(readFileSync(planPath(date), 'utf8'));
            if (Array.isArray(existing.items) && JSON.stringify(existing.items) === JSON.stringify(expected)) {
                log(`${date} 复用当日计划: ${existing.items.length} 项`);
                return existing;
            }
            log(`${date} 配置已变更,重建当日计划`);
        }
        catch {
            warn(`${date} 计划文件损坏,重建`);
        }
    }
    const plan = { date, items: expected };
    writeFileSync(planPath(date), JSON.stringify(plan, null, 2), 'utf8');
    const overviewCount = expected.filter((i) => i.type === 'overview').length;
    const taskCount = expected.length - overviewCount;
    log(`${date} 计划生成: ${expected.length} 项(总览 ${overviewCount} + 任务 ${taskCount})`);
    return plan;
}
function loadSentKeys(date) {
    if (!existsSync(sentPath(date)))
        return new Set();
    try {
        const parsed = JSON.parse(readFileSync(sentPath(date), 'utf8'));
        return new Set(Array.isArray(parsed.sent) ? parsed.sent : []);
    }
    catch {
        warn(`${date} sent 标记文件损坏,按未推送处理`);
        return new Set();
    }
}
function saveSentKeys(date) {
    writeFileSync(sentPath(date), JSON.stringify({ date, sent: [...sentKeys] }, null, 2), 'utf8');
}
/** 保留最近 KEEP_STATE_DAYS 日状态文件,更早的清理(可重建状态) */
function cleanupOldState(date) {
    const cutoff = new Date(`${date}T00:00:00`);
    cutoff.setDate(cutoff.getDate() - KEEP_STATE_DAYS);
    const cutoffStr = formatDate(cutoff);
    try {
        for (const file of readdirSync(remindDir())) {
            const m = /^(?:plan|sent)-(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
            if (m && m[1] < cutoffStr) {
                unlinkSync(join(remindDir(), file));
            }
        }
    }
    catch {
        // 清理失败不影响调度
    }
}
/** plan/sent 去重键: 同一天内唯一标识一个推送项 */
function keyOf(item) {
    return item.type === 'overview' ? `overview@${item.time}` : `task@${item.time}#${item.task ?? ''}`;
}
function labelOf(item) {
    return item.type === 'overview' ? '晨间总览' : `${item.time} ${(item.task ?? '').slice(0, 20)}`;
}
// ========== 3. 时间工具(本地时区语义) ==========
function pad(n) {
    return String(n).padStart(2, '0');
}
/** 本地日期 YYYY-MM-DD(不用 toISOString: UTC 日期会在早 8 点前错位) */
function today() {
    return formatDate(new Date());
}
function formatDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function currentHHMM() {
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
function formatDateTime(d) {
    return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function weekdayCN(d) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}
// ========== 4. 卡片构建与推送(架构文档 §5;卡片异常降级文本) ==========
/** 多维表格入口(存在 app_token 才显示「查看今日台账」按钮) */
function ledgerUrl() {
    const appToken = process.env.FEISHU_BITABLE_APP_TOKEN?.trim();
    return appToken ? `https://feishu.cn/base/${appToken}` : null;
}
function buildPayload(item, plan) {
    try {
        const card = item.type === 'overview' ? buildOverviewCard(plan) : buildTaskCard(item, plan);
        return { msgType: 'interactive', content: JSON.stringify(card) };
    }
    catch (error) {
        warn('卡片构建失败,降级为文本消息:', error);
        return { msgType: 'text', content: JSON.stringify({ text: buildFallbackText(item, plan) }) };
    }
}
/** 卡片 A: 每日任务总览(原型 1) */
function buildOverviewCard(plan) {
    const date = new Date(`${plan.date}T00:00:00`);
    const tasks = plan.items.filter((i) => i.type === 'task');
    const taskLines = tasks.map((t) => `**${t.time}**　${t.task}`).join('\n');
    const elements = [
        { tag: 'div', text: { tag: 'lark_md', content: `**${plan.date} ${weekdayCN(date)}**　共 ${tasks.length} 项任务` } },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: taskLines || '今日暂无任务' } },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: '💡 完成任务后拍照发到本群,自动记录台账' } }
    ];
    const url = ledgerUrl();
    if (url) {
        elements.push({
            tag: 'action',
            actions: [
                { tag: 'button', text: { tag: 'plain_text', content: '📊 查看今日台账' }, type: 'default', url }
            ]
        });
    }
    return {
        config: { wide_screen_mode: true },
        header: { template: 'blue', title: { tag: 'plain_text', content: '🐟 AquaSense 每日巡检任务' } },
        elements
    };
}
/** 卡片 B: 单条任务提醒(原型 2;巡检类任务附固定检查要点) */
function buildTaskCard(item, plan) {
    const elements = [
        { tag: 'div', text: { tag: 'lark_md', content: `**📋 ${item.task}**` } }
    ];
    // 巡检任务补充观察要点(原型 2 固定文案);其余任务由任务文案自带要点
    if (item.task?.includes('巡检')) {
        elements.push({
            tag: 'div',
            text: { tag: 'lark_md', content: '**检查要点:**\n• 鱼群活动状态(集群/离群/浮头)\n• 水色变化\n• 有无死鱼' }
        });
    }
    elements.push({
        tag: 'action',
        actions: [
            {
                tag: 'button',
                text: { tag: 'plain_text', content: '📷 拍照汇报' },
                type: 'primary',
                value: { action: 'photo_report', time: item.time }
            }
        ]
    });
    const remaining = plan.items
        .filter((i) => i.type === 'task' && i.time > item.time)
        .slice(0, REMAINING_PREVIEW_COUNT)
        .map((i) => `${i.time} ${i.task}`);
    if (remaining.length > 0) {
        elements.push({
            tag: 'note',
            elements: [{ tag: 'plain_text', content: `剩余任务: ${remaining.join(' / ')}` }]
        });
    }
    return {
        config: { wide_screen_mode: true },
        header: { template: 'blue', title: { tag: 'plain_text', content: `⏰ ${item.time} 任务提醒` } },
        elements
    };
}
/** 卡片 C: 异常预警(原型 4) */
function buildAbnormalCard(input) {
    const severityTemplate = input.severity === 'high' || input.severity === 'critical' ? 'red' : 'orange';
    const clsLabel = input.cls === 'early' ? 'early(前兆)' : 'disease(疾病)';
    const poolLabel = input.poolId?.trim() ? `${input.poolId.trim()} ` : '';
    const elements = [
        {
            tag: 'div',
            text: { tag: 'lark_md', content: `**🔴 ${poolLabel}鱼群状态异常**` }
        },
        {
            tag: 'div',
            text: {
                tag: 'lark_md',
                content: [
                    `**状态:** ${clsLabel}`,
                    `**症状:** ${input.symptoms.length > 0 ? input.symptoms.join('、') : '未识别到具体症状'}`,
                    `**严重度:** ${input.severity}`
                ].join('\n')
            }
        }
    ];
    if (input.advice && input.advice.length > 0) {
        const adviceLines = input.advice.map((a, i) => `${i + 1}. ${a}`).join('\n');
        elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**📋 处置建议:**\n${adviceLines}` } });
    }
    if (input.detailUrl) {
        elements.push({
            tag: 'action',
            actions: [
                { tag: 'button', text: { tag: 'plain_text', content: '📊 查看详情' }, type: 'default', url: input.detailUrl }
            ]
        });
    }
    elements.push({
        tag: 'note',
        elements: [{ tag: 'plain_text', content: `时间: ${formatDateTime(new Date())}` }]
    });
    return {
        config: { wide_screen_mode: true },
        header: { template: severityTemplate, title: { tag: 'plain_text', content: '⚠️ 异常预警' } },
        elements
    };
}
/** 卡片构造异常时的文本降级(沿用 V1 文本格式) */
function buildFallbackText(item, plan) {
    if (item.type === 'overview') {
        const lines = [`📅 ${plan.date} 今日任务总览(${plan.items.length} 项)`];
        for (const i of plan.items) {
            lines.push(`${i.time} ${i.task ?? i.type}`);
        }
        return lines.join('\n');
    }
    const lines = [`⏰ ${item.time} 任务提醒`, `📋 ${item.task}`];
    const remaining = plan.items
        .filter((i) => i.type === 'task' && i.time > item.time)
        .slice(0, REMAINING_PREVIEW_COUNT)
        .map((i) => `${i.time} ${i.task}`);
    if (remaining.length > 0)
        lines.push(`💡 今日剩余: ${remaining.join('、')}`);
    lines.push('✅ 完成后拍照发到本群,自动记录台账');
    return lines.join('\n');
}
async function sendToFeishu(message, group) {
    const target = group ?? activeConfig?.group;
    if (!target) {
        throw new Error('S9_REMIND_GROUP 未配置(巡检群 chat_id)');
    }
    const token = await getFeishuToken();
    const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receive_id: target, msg_type: message.msgType, content: message.content }),
        // 超时上限: 网络挂起时避免长时间占用 tick 防重入锁,拖垮后续时间点
        signal: AbortSignal.timeout(15_000)
    });
    const result = (await response.json());
    if (result.code !== 0) {
        throw new Error(`飞书消息推送失败: ${result.msg || result.code}`);
    }
}
/** 推送失败 30s 后重试 1 次;仍失败仅记录,不阻断后续(架构文档 §6) */
async function pushWithRetry(message, label) {
    try {
        await sendToFeishu(message);
        log(`已推送: ${label}`);
        return true;
    }
    catch (error) {
        warn(`推送失败(${label}),30s 后重试:`, error);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        try {
            await sendToFeishu(message);
            log(`重试成功: ${label}`);
            return true;
        }
        catch (retryError) {
            warn(`重试仍失败(${label}):`, retryError);
            return false;
        }
    }
}
// ========== 5. tick 执行器(架构文档 §3.4) ==========
async function tick() {
    if (ticking)
        return;
    ticking = true;
    try {
        // ① 跨天滚动: 生成新一日计划 + 重置标记
        const date = today();
        if (date !== currentPlan?.date) {
            rollNewDay(date);
        }
        if (!currentPlan)
            return;
        // ②③ 匹配当前分钟: 到点且未推送过 → 推送;已过时间点天然不匹配(不补推)
        const current = currentHHMM();
        for (const item of currentPlan.items) {
            if (item.time !== current)
                continue;
            const key = keyOf(item);
            if (sentKeys.has(key) || processedKeys.has(key))
                continue;
            processedKeys.add(key);
            const ok = await pushWithRetry(buildPayload(item, currentPlan), labelOf(item));
            if (ok) {
                sentKeys.add(key);
                saveSentKeys(currentPlan.date);
            }
        }
    }
    catch (error) {
        warn('tick 异常(已跳过本轮):', error);
    }
    finally {
        ticking = false;
    }
}
function rollNewDay(date) {
    if (!activeConfig)
        return;
    log(`跨天滚动: 生成 ${date} 计划`);
    currentPlan = loadOrBuildPlan(date, parseCronTime(activeConfig.cron), activeConfig.tasks);
    sentKeys = loadSentKeys(date);
    processedKeys = new Set(sentKeys);
    cleanupOldState(date);
}
/** 停止当前执行器(重复调用无害,配置变更/插件卸载时使用) */
function stopS9Reminder() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}
// ========== 6. 对外入口 ==========
/**
 * 插件启动/配置变更时调用:
 * 读取配置 → 生成或复用当日计划 → 恢复 sent 标记 → 启动 60s tick。
 * enabled=false 或群未配置时记录日志后跳过,绝不阻断插件启动。
 */
export function setupS9Reminder(ctx) {
    stopS9Reminder();
    // 插件卸载时停止调度(ctx 可选:仅独立调用/测试场景可不传)
    if (ctx) {
        ctx.effect(() => () => stopS9Reminder(), 'aquasense-s9-reminder');
    }
    const config = loadConfig();
    activeConfig = config;
    if (!config.enabled) {
        log('未启用(S9_REMIND_ENABLED=false),跳过');
        return;
    }
    if (!config.group) {
        warn('S9_REMIND_GROUP 未配置(巡检群 chat_id),跳过全部推送');
        return;
    }
    const overviewTime = parseCronTime(config.cron);
    if (!overviewTime) {
        warn(`Cron 表达式非法或非"每天 HH:MM"语义("${config.cron}"),跳过总览推送(单条提醒不受影响)`);
    }
    if (!overviewTime && config.tasks.length === 0) {
        warn('无有效推送项(总览不可解析且任务列表为空),跳过当日调度');
        return;
    }
    const date = today();
    currentPlan = loadOrBuildPlan(date, overviewTime, config.tasks);
    sentKeys = loadSentKeys(date);
    processedKeys = new Set(sentKeys);
    cleanupOldState(date);
    const pushed = currentPlan.items.filter((i) => sentKeys.has(keyOf(i))).length;
    const pending = currentPlan.items.length - pushed;
    log(`配置加载: enabled=true, group=${config.group}, 任务 ${config.tasks.length} 项, 总览时刻 ${overviewTime ?? '未配置'}`);
    log(`${date} 调度启动, 当前 ${currentHHMM()}(已推送 ${pushed}, 待推送 ${pending})`);
    tickTimer = setInterval(() => {
        void tick();
    }, TICK_MS);
}
/**
 * 异常预警卡片(卡片 C): 由主链路在 analyze 检出 early/disease 后调用。
 * 任何失败仅记录日志,绝不向主链路抛出异常。
 */
export async function pushAbnormalAlert(input) {
    try {
        const config = activeConfig ?? loadConfig();
        if (!config.enabled || !config.group)
            return;
        await pushWithRetry({ msgType: 'interactive', content: JSON.stringify(buildAbnormalCard(input)) }, `预警卡片 ${input.poolId ?? '未知池'} ${input.cls}(${input.severity})`);
    }
    catch (error) {
        warn('预警推送异常(不阻断主链路):', error);
    }
}
/** 读取当前生效配置(文件 > 环境变量) */
export function getRemindConfig() {
    return loadConfig();
}
/**
 * 保存配置(配置页「保存配置」):
 * 写入 remind/config.json 后调用 setupS9Reminder() 重建当日推送计划,
 * 使调度立即随新配置运行(需求 R6.5 交互说明「持久化配置并重建当日推送计划」)。
 */
export function saveRemindConfig(input) {
    const current = loadConfig();
    const { tasks, skipped } = sanitizeTasks(input.tasks === undefined ? current.tasks : input.tasks);
    if (skipped > 0) {
        warn(`保存配置: ${skipped} 条非法任务已跳过(time 需为 HH:MM、task 需非空)`);
    }
    const config = {
        enabled: input.enabled ?? current.enabled,
        group: (input.group ?? current.group).trim(),
        cron: current.cron,
        tasks
    };
    writeFileSync(join(remindDir(), 'config.json'), JSON.stringify(config, null, 2), 'utf8');
    log(`配置已保存: enabled=${config.enabled}, group=${config.group || '(未配置)'}, 任务 ${config.tasks.length} 项`);
    // 立即重建当日计划并重启 tick(已推送项由 sent 标记保留,不受影响)
    setupS9Reminder();
    return config;
}
/**
 * 发送测试提醒(配置页「发送测试提醒」):
 * 用已保存配置立即推送一次总览卡片;不落当日计划、不影响 sent 标记。
 * 失败直接抛出(与调度推送不同,不做 30s 重试),由 gateway 转为错误响应。
 */
export async function sendTestReminder() {
    const config = loadConfig();
    if (!config.group) {
        throw new Error('推送目标群未配置,请选择或填写群 chat_id 并保存');
    }
    const plan = {
        date: today(),
        items: buildPlanItems(parseCronTime(config.cron), config.tasks)
    };
    await sendToFeishu({ msgType: 'interactive', content: JSON.stringify(buildOverviewCard(plan)) }, config.group);
    log(`已发送测试提醒 → ${config.group}`);
}
export function getRemindStatus() {
    const date = today();
    if (!currentPlan || currentPlan.date !== date) {
        return { date, planned: 0, sent: 0, nextTime: null, running: tickTimer !== null };
    }
    const sent = currentPlan.items.filter((i) => sentKeys.has(keyOf(i))).length;
    const now = currentHHMM();
    const next = currentPlan.items.find((i) => !sentKeys.has(keyOf(i)) && i.time >= now);
    return {
        date,
        planned: currentPlan.items.length,
        sent,
        nextTime: next?.time ?? null,
        running: tickTimer !== null
    };
}
