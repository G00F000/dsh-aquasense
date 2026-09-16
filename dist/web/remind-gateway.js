/**
 * S9 提醒设置页 Web 面(Host 侧,原型 3)
 *
 *  - settings 配对:注册命名空间 'aquasense-remind'(仅作配对键——设置页插件
 *    tab 扫描到命名空间后才派发浏览器侧同 key 卡片;配置读写仍以
 *    remind/config.json 为唯一事实源,见 s9-reminder 第 7 节)
 *  - HTTP 路由:在宿主 webServer 上注册 /aquasense-remind/api 前缀,供浏览器
 *    卡片 fetch 调用 get/save/test/groups 四个方法
 *
 * 说明:本地 DSH 依赖线为 0.0.1-rc.5,而 dsh-settings 及 client 包为 0.1.5-rc.2,
 * 混装会引发 peer 冲突,故 settings/webServer 均按最小鸭子类型访问,不引入其类型。
 */
import z from '@deepseek-ai/schemastery';
import { getFeishuToken } from '../feishu/token.js';
import { DEFAULT_CRON, getRemindConfig, getRemindStatus, normalizeRemindTask, saveRemindConfig, sendTestReminder } from '../scheduler/s9-reminder.js';
// ========== 常量 ==========
/** 设置页 API 路由前缀(同源 fetch;方法追加在其后,如 /get) */
export const REMIND_API_PREFIX = '/aquasense-remind/api';
/** settings 命名空间(小写连字符;仅作 Host/浏览器卡片配对键) */
export const REMIND_SETTINGS_NAMESPACE = 'aquasense-remind';
/** 设置页允许的最大任务条数 */
const MAX_TASKS = 50;
/** 单条任务内容最大长度(字符) */
const MAX_TASK_LENGTH = 200;
/** 群 chat_id 最大长度(字符) */
const MAX_GROUP_LENGTH = 128;
/** 请求体上限(字节) */
const MAX_BODY_BYTES = 16 * 1024;
/** 群列表分页上限(100 条/页) */
const MAX_GROUP_PAGES = 5;
/** 群列表请求超时 */
const GROUPS_TIMEOUT_MS = 15_000;
/** 校验/协议错误(映射为 HTTP 状态码) */
export class HttpError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
// ========== settings 命名空间(配对键) ==========
/**
 * settings 命名空间 schema:与 RemindConfig 形状对齐(base 取当前生效配置)。
 * 仅用于设置页配对与展示;实际持久化仍走 remind/config.json。
 */
const RemindConfigSchema = z.object({
    enabled: z.boolean().default(false),
    group: z.string().default(''),
    cron: z.string().default(DEFAULT_CRON),
    tasks: z
        .array(z.object({ time: z.string(), task: z.string() }))
        .default([])
});
/**
 * 注册 settings 命名空间。
 * 设置页插件 tab 只有扫描到命名空间才派发本插件卡片(见 ui-settings-plugins
 * 的 settings.plugin.item 合同);重复注册属多 fiber 正常情形,静默跳过。
 */
export function registerRemindSettingsNamespace(ctx) {
    ctx.inject(['settings'], (sctx) => {
        const settings = sctx.settings;
        if (!settings || typeof settings.register !== 'function')
            return;
        try {
            settings.register(REMIND_SETTINGS_NAMESPACE, RemindConfigSchema, { base: getRemindConfig() });
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('already registered'))
                return;
            console.warn('[aquasense-remind] settings 命名空间注册失败(设置页卡片可能不可用):', error);
        }
    });
}
// ========== 请求校验 ==========
/**
 * 校验并归一化「保存配置」请求体(导出供测试)。
 * body 形如 { config: { enabled, group, tasks } };cron 不在设置页暴露。
 */
export function parseRemindConfigInput(body) {
    const raw = body?.config;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new HttpError(400, 'invalid-config', '请求体缺少 config 对象');
    }
    const input = raw;
    if (typeof input.enabled !== 'boolean') {
        throw new HttpError(400, 'invalid-config', 'enabled 必须为布尔值');
    }
    const group = typeof input.group === 'string' ? input.group.trim() : '';
    if (group.length > MAX_GROUP_LENGTH) {
        throw new HttpError(400, 'invalid-config', `group 长度不能超过 ${MAX_GROUP_LENGTH} 字符`);
    }
    if (!Array.isArray(input.tasks)) {
        throw new HttpError(400, 'invalid-config', 'tasks 必须为数组');
    }
    if (input.tasks.length > MAX_TASKS) {
        throw new HttpError(400, 'invalid-config', `任务数量不能超过 ${MAX_TASKS} 条`);
    }
    const tasks = input.tasks.map((item, index) => {
        const task = normalizeRemindTask(item);
        if (!task) {
            throw new HttpError(400, 'invalid-config', `第 ${index + 1} 条任务非法:时间需为 HH:MM、内容不能为空`);
        }
        if (task.task.length > MAX_TASK_LENGTH) {
            throw new HttpError(400, 'invalid-config', `第 ${index + 1} 条任务内容不能超过 ${MAX_TASK_LENGTH} 字`);
        }
        return task;
    });
    return { enabled: input.enabled, group, tasks };
}
// ========== API 分发 ==========
/**
 * 创建设置页 API 分发函数(注入依赖便于测试)。
 * 返回 (method, body) => ApiResult;HTTP 层负责信封序列化。
 */
export function createRemindApi(deps) {
    return async function dispatch(method, body) {
        try {
            switch (method) {
                case 'get':
                    return ok({ config: deps.getConfig(), status: deps.getStatus() });
                case 'save': {
                    const config = deps.saveConfig(parseRemindConfigInput(body));
                    return ok({ config, status: deps.getStatus() });
                }
                case 'test': {
                    if (!deps.getConfig().group) {
                        return fail(400, 'group-missing', '推送目标群未配置,请先选择群并保存');
                    }
                    await deps.sendTest();
                    return ok({ sent: true });
                }
                case 'groups': {
                    try {
                        return ok({ groups: await deps.listGroups() });
                    }
                    catch (error) {
                        // 群列表非关键路径:降级为空列表 + 原因,允许手动填写 chat_id
                        return ok({ groups: [], error: messageOf(error) });
                    }
                }
                default:
                    return fail(404, 'unknown-method', `未知方法: ${method}`);
            }
        }
        catch (error) {
            if (error instanceof HttpError) {
                return fail(error.status, error.code, error.message);
            }
            if (method === 'test') {
                return fail(502, 'push-failed', messageOf(error));
            }
            return fail(500, 'internal', messageOf(error));
        }
    };
}
/** 飞书群列表(机器人已加入的群;分页拉取,失败向上抛,由 API 层降级) */
export async function fetchFeishuGroups() {
    const token = await getFeishuToken();
    const groups = [];
    let pageToken = '';
    for (let page = 0; page < MAX_GROUP_PAGES; page++) {
        const url = new URL('https://open.feishu.cn/open-apis/im/v1/chats');
        url.searchParams.set('page_size', '100');
        if (pageToken)
            url.searchParams.set('page_token', pageToken);
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(GROUPS_TIMEOUT_MS)
        });
        const result = (await response.json());
        if (result.code !== 0) {
            throw new Error(`飞书群列表获取失败: ${result.msg || result.code}`);
        }
        for (const item of result.data?.items ?? []) {
            if (item.chat_id)
                groups.push({ chatId: item.chat_id, name: item.name || item.chat_id });
        }
        if (!result.data?.has_more || !result.data.page_token)
            break;
        pageToken = result.data.page_token;
    }
    return groups;
}
// ========== HTTP 层 ==========
/**
 * 处理一次 HTTP 请求:协议层校验 + 方法分发 + 信封写回。
 * 协议:POST only、同源(Origin 与 Host 一致)、Content-Type application/json。
 */
export async function handleRemindHttp(dispatch, req, res) {
    try {
        if ((req.method ?? '') !== 'POST') {
            writeEnvelope(res, 405, fail(405, 'method-not-allowed', '仅支持 POST').body);
            return;
        }
        const origin = req.headers.origin;
        if (typeof origin === 'string' && origin) {
            let originHost;
            try {
                originHost = new URL(origin).host;
            }
            catch {
                writeEnvelope(res, 400, fail(400, 'invalid-origin', 'Origin 头非法').body);
                return;
            }
            const reqHost = req.headers.host;
            if (typeof reqHost === 'string' && reqHost && originHost !== reqHost) {
                writeEnvelope(res, 403, fail(403, 'origin-not-allowed', '仅允许同源请求').body);
                return;
            }
        }
        const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
        if (!contentType.startsWith('application/json')) {
            writeEnvelope(res, 415, fail(415, 'content-type-not-supported', '请求体需为 application/json').body);
            return;
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
        const method = pathname.startsWith(`${REMIND_API_PREFIX}/`)
            ? pathname.slice(REMIND_API_PREFIX.length + 1)
            : '';
        if (!method || method.includes('/')) {
            writeEnvelope(res, 404, fail(404, 'not-found', `未知路径: ${pathname}`).body);
            return;
        }
        let body;
        try {
            body = await readJsonBody(req);
        }
        catch (error) {
            if (error instanceof HttpError) {
                writeEnvelope(res, error.status, fail(error.status, error.code, error.message).body);
                return;
            }
            throw error;
        }
        const result = await dispatch(method, body);
        writeEnvelope(res, result.status, result.body);
    }
    catch (error) {
        writeEnvelope(res, 500, fail(500, 'internal', messageOf(error)).body);
    }
}
/** 读取并解析 JSON 请求体(超限 413、解析失败 400) */
async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
            throw new HttpError(413, 'payload-too-large', `请求体超过 ${maxBytes} 字节上限`);
        }
        chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text === '')
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        throw new HttpError(400, 'invalid-json', '请求体不是合法 JSON');
    }
}
/** 写回 JSON 信封 */
function writeEnvelope(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
/** 构造成功结果 */
function ok(value) {
    return { status: 200, body: { ok: true, value } };
}
/** 构造失败结果 */
function fail(status, code, message) {
    return { status, body: { ok: false, error: { code, message } } };
}
/** 错误信息提取 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
// ========== 插件接线 ==========
/**
 * 安装设置页 Web 面:settings 配对命名空间 + HTTP API 路由。
 * 由插件 apply() 调用;web 面缺失(无 settings/webServer 服务)时静默跳过,
 * 不影响 S9 定时推送本身。
 */
export function installRemindWeb(ctx) {
    registerRemindSettingsNamespace(ctx);
    const dispatch = createRemindApi({
        getConfig: getRemindConfig,
        getStatus: getRemindStatus,
        saveConfig: saveRemindConfig,
        sendTest: sendTestReminder,
        listGroups: fetchFeishuGroups
    });
    ctx.inject(['webServer'], (sctx) => {
        sctx.effect(() => {
            const webServer = sctx.webServer;
            if (!webServer || typeof webServer.register !== 'function')
                return () => { };
            return webServer.register({
                kind: 'prefix',
                path: REMIND_API_PREFIX,
                handler: (req, res) => handleRemindHttp(dispatch, req, res)
            });
        }, 'aquasense: S9 提醒设置页 API 路由');
    });
}
