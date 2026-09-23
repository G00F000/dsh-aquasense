/**
 * 日报文本解析器(纯函数模块)
 *
 * 将工人发送的自由格式日报文本拆分为多条结构化台账记录。
 * 支持的场景:水温(temperature)、喂食(feeding)、用药(medication)。
 *
 * 典型输入:
 *   水温：23℃
 *   喂食：1号池3.2kg   2号池2.6kg， 3号池2.7kg， 4号池1.6kg，
 *   吃食情况: 秒光
 *   拌药情况：.金莲清毒康:280g ...
 *   拌药的第三天
 *
 * 规则(来源于开发规范 memory):
 *  - 池号未指定时默认"全塘"→展开为所有配置池
 *  - 药品标记"暂无"→跳过
 *  - 上报人由台账工具运行时解析 open_id,此处不填充
 *  - 按行块拆分,逐场景提取数值,不做 AI 推断
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { formatPoolIds, getPoolIds } from '../config/aqua-settings.js';
// ─── 池号归一化 ───
/** 将口语池号归一化为配置格式:"1号池"→"池1","一号池"→"池1" */
function normalizePoolRef(raw) {
    const digitMap = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
    // "X号池" / "X号塘" / "池X" / "第X池"
    let m = raw.match(/(\d+|[一二三四五六七八九十]+)\s*(?:号?池|号?塘)/);
    if (m) {
        const num = digitMap[m[1]] ?? m[1];
        return `池${num}`;
    }
    m = raw.match(/池\s*(\d+|[一二三四五六七八九十]+)/);
    if (m) {
        const num = digitMap[m[1]] ?? m[1];
        return `池${num}`;
    }
    m = raw.match(/第\s*(\d+|[一二三四五六七八九十]+)\s*池/);
    if (m) {
        const num = digitMap[m[1]] ?? m[1];
        return `池${num}`;
    }
    return raw.trim();
}
/** 用药/拌药块标题行(不含剂量信息,不应被解析为药品条目) */
const MED_HEADER_RE = /^\s*(?:拌药|用药|药品|药量)(?:情况|记录)?[：:]?\s*$/;
/** 从单行提取药品信息:序号(可选) + 药名 + 分隔符 + 剂量 */
const MED_LINE_RE = /(?:^[一二三四五六七八九十\d]+[.、．)）\]]\s*)(.+)\s*[：:]\s*(.+)/;
/** 无序号的药品行(药名:剂量 格式) */
const MED_LINE_NO_NUM_RE = /^([^\s:：,，。\n\d][^\s:：,，。\n]{0,10})\s*[：:]\s*(.+)/;
/** 跳过暂无/占位符的剂量值 */
const SKIP_DOSE_RE = /^\s*暂?无\s*$|^\s*暂?缺\s*$|^\s*[—–-]\s*$/;
// ─── 块类型识别 ───
function identifyBlockType(block) {
    const head = block.slice(0, 20);
    if (/水温|棚温|温度/.test(head))
        return 'temperature';
    if (/喂食|投喂|吃料|摄食|饲料/.test(head))
        return 'feeding';
    if (/拌药|用药|药品|药量|拌料/.test(head)) {
        // 区分标题行(含冒号/列表)和上下文行(如"拌药的第三天")
        // 上下文行:仅含拌药关键词+非数据内容,不应触发新块
        if (/拌药的第/.test(head))
            return 'unknown';
        return 'medication';
    }
    return 'unknown';
}
// ─── 场景解析器 ───
/** 中文数字→阿拉伯数字(单位数) */
function toDigit(s) {
    const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (s in map)
        return map[s];
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}
/** 中文数字字符串→阿拉伯数字字符串(如"三"→"3","12"→"12") */
function normalizeChineseNum(s) {
    const map = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
    return map[s] ?? s;
}
/**
 * 解析水温块
 * 示例: "水温：23℃" / "水温: 23度" / "棚温：25℃  水温：23℃"
 */
function parseTemperature(block, allPools) {
    const tempMatch = block.match(/水温[：:]\s*(\d+(?:\.\d+)?)\s*[°℃度]/);
    if (!tempMatch)
        return [];
    const temp = Number(tempMatch[1]);
    // 检查是否指定了池号
    const poolMatch = block.match(/(池\d+|[\d一二三四五六七八九十]+号[池塘])/);
    const pools = poolMatch ? [normalizePoolRef(poolMatch[1])] : allPools;
    return pools.map(pool => ({
        scene: 'temperature',
        fields: {
            '池号': pool,
            '水温(℃)': temp,
        }
    }));
}
/**
 * 解析喂食块
 * 示例: "喂食：1号池3.2kg   2号池2.6kg， 3号池2.7kg， 4号池1.6kg，"
 *       "吃食情况: 秒光"
 */
function parseFeeding(block, allPools) {
    // 提取摄食情况(注意:正则备选项按长度降序排列,避免短串优先匹配)
    const appetiteMatch = block.match(/(?:吃食情况|摄食情况|吃食|摄食)[：:]\s*(\S+)/);
    const appetite = appetiteMatch?.[1] ?? '';
    // 提取投喂量: "X号池X.Xkg" / "池X X.Xkg"
    const feedEntries = [];
    const feedRegex = /(?:池?\s*(\d+|[一二三四五六七八九十]+)\s*(?:号池|号塘)|池\s*(\d+|[一二三四五六七八九十]+))\s*(\d+(?:\.\d+)?)\s*(?:kg|KG|Kg)/gi;
    let fm;
    while ((fm = feedRegex.exec(block)) !== null) {
        const poolNum = fm[1] || fm[2];
        const amount = Number(fm[3]);
        if (Number.isFinite(amount)) {
            feedEntries.push({ pool: `池${toDigit(poolNum)}`, amount });
        }
    }
    if (feedEntries.length === 0)
        return [];
    return feedEntries.map(e => ({
        scene: 'feeding',
        fields: {
            '池号': e.pool,
            '投喂量(kg)': e.amount,
            ...(appetite ? { '摄食情况': appetite } : {}),
        }
    }));
}
/**
 * 解析用药/拌药块
 * 示例:
 *   "拌药情况：1.金莲清毒康:280g\n2.肝胆康:240g\n...\n6.硫酸新霉素:暂无"
 *   "拌药的第三天"
 *
 * 规则:
 *  - "暂无" 的药品跳过
 *  - 池号默认全塘(不按池拆分)
 *  - 提取"第N天"类上下文作为备注
 */
function parseMedication(block, _allPools) {
    // 提取上下文备注(如"拌药的第三天" → "拌药第3天")
    const dayMatch = block.match(/(?:的)?第?\s*([一二三四五六七八九十\d]+)\s*天/);
    const dayNote = dayMatch ? `拌药第${normalizeChineseNum(dayMatch[1])}天` : '';
    // 逐行提取药品,跳过标题行
    // 预处理:将标题+药品在同一行的情况拆分(如"拌药情况：.金莲清毒康:280g" → 两行)
    const rawLines = block.split(/\r?\n/);
    const lines = [];
    for (const raw of rawLines) {
        const headerMatch = raw.match(/^\s*(?:拌药|用药|药品|药量)(?:情况|记录)?[：:]\s*(.+)/);
        if (headerMatch) {
            lines.push(headerMatch[1]); // 只保留冒号后的药品部分
        }
        else {
            lines.push(raw);
        }
    }
    const meds = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        // 跳过标题行(如"拌药情况：")
        if (MED_HEADER_RE.test(trimmed))
            continue;
        // 尝试匹配带序号的药品行: "1.金莲清毒康:280g" / ".金莲清毒康:280g"
        let name;
        let dose;
        const m1 = trimmed.match(MED_LINE_RE);
        if (m1) {
            name = m1[1].replace(/^[.、．]+/, '').trim();
            dose = m1[2].trim();
        }
        else {
            // 无序号: "金莲清毒康:280g"
            const m2 = trimmed.match(MED_LINE_NO_NUM_RE);
            if (m2) {
                name = m2[1].replace(/^[.、．]+/, '').trim();
                dose = m2[2].trim();
            }
        }
        if (!name || !dose)
            continue;
        // 跳过"暂无" / "无" / "暂缺"
        if (SKIP_DOSE_RE.test(dose))
            continue;
        meds.push({ name, dose });
    }
    if (meds.length === 0)
        return [];
    return meds.map(med => ({
        scene: 'medication',
        fields: {
            '池号': '全塘',
            '药品名称': med.name,
            '用药剂量': med.dose,
            '用药方式': '拌料',
            ...(dayNote ? { '备注': dayNote } : {}),
        }
    }));
}
// ─── 主解析入口 ───
/**
 * 解析日报文本,输出结构化台账条目。
 *
 * @param text    工人发送的原始日报文本
 * @param pools   当前配置的池号列表(可选,缺省从配置读取)
 * @returns       拆分后的台账条目数组 + 警告信息
 */
export function parseDailyReport(text, pools) {
    const allPools = pools ?? getPoolIds();
    const warnings = [];
    const entries = [];
    if (!text.trim()) {
        warnings.push('输入文本为空');
        return { entries, warnings };
    }
    // ── 1. 按行块拆分 ──
    // 识别以场景关键词开头的行,连续行归属同一块;
    // 空行时用向前看(peek)判断下一行是否属于当前块。
    const lines = text.split(/\r?\n/);
    const blocks = [];
    let current = '';
    let pendingBlank = false; // 缓存空行,等下一行决定归属
    /** 将缓存内容(含空行)刷入当前块 */
    const flushBlank = () => {
        if (pendingBlank && current) {
            current += '\n';
            pendingBlank = false;
        }
    };
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) {
            // 空行:延迟处理,看下一行是否为续行
            pendingBlank = true;
            continue;
        }
        const blockType = identifyBlockType(trimmed);
        if (blockType !== 'unknown') {
            // 新场景块:先把旧块入列,然后以当前行起新块
            if (current)
                blocks.push(current);
            // 如果有挂起的空行,在切块前刷入旧块(避免丢失)
            if (pendingBlank && blocks.length > 0) {
                blocks[blocks.length - 1] += '\n';
            }
            pendingBlank = false;
            current = trimmed;
        }
        else if (current) {
            // 当前块的续行:先刷入缓存的空行,再追加内容
            flushBlank();
            current += '\n' + trimmed;
        }
        else {
            // 无主行:看它是否为非场景行(如"拌药的第三天")
            // 空行挂起后遇到非场景行→归入上一个已入列的块
            if (pendingBlank && blocks.length > 0) {
                blocks[blocks.length - 1] += '\n' + trimmed;
            }
            else {
                current = trimmed;
            }
            pendingBlank = false;
        }
    }
    // 尾部处理
    if (pendingBlank && current) {
        current += '\n'; // 空行留在块尾不影响解析
    }
    if (current)
        blocks.push(current);
    // ── 2. 逐块解析 ──
    for (const block of blocks) {
        const type = identifyBlockType(block);
        switch (type) {
            case 'temperature':
                entries.push(...parseTemperature(block, allPools));
                break;
            case 'feeding':
                entries.push(...parseFeeding(block, allPools));
                break;
            case 'medication':
                entries.push(...parseMedication(block, allPools));
                break;
            default:
                warnings.push(`未识别的块: "${block.slice(0, 40)}..."`);
                break;
        }
    }
    return { entries, warnings };
}
// ─── DSH 工具定义 ───
/** 多场景日报文本拆分工具:将自由格式日报文本拆分为多条结构化台账记录 */
export const parseReport = defineTool({
    name: 'aquasense_parse_report',
    description: '将工人发送的多场景日报文本(如水温+喂食+拌药混合)拆分为多条结构化台账记录。拆分后逐条调用 aquasense_ledger 落表。仅 temperature/feeding/medication 三个场景支持拆分。',
    parameters: {
        text: {
            type: 'string',
            description: '工人发送的原始日报文本(自由格式,可能包含多个场景)'
        },
        pools: {
            type: 'array',
            items: { type: 'string' },
            description: `当前配置的池号列表(可选,缺省从 AquaSense 设置读取,如 ${formatPoolIds()})`
        }
    },
    output: {
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                warnings: { type: 'array', items: { type: 'string' }, description: '解析警告' }
            }
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    async execute(args) {
        const text = String(args.text ?? '').trim();
        if (!text) {
            return { entries: [], warnings: ['输入文本为空'] };
        }
        const pools = Array.isArray(args.pools) && args.pools.length > 0
            ? args.pools
            : undefined;
        const result = parseDailyReport(text, pools);
        // JSON 序列化归一化:确保所有字段值为 JSON 兼容类型(数字/字符串/布尔/数组/对象/null)
        return {
            entries: result.entries.map(e => ({
                scene: e.scene,
                fields: JSON.parse(JSON.stringify(e.fields))
            })),
            warnings: result.warnings
        };
    }
});
