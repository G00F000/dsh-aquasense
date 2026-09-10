/**
 * 台账写入工具(aquasense_ledger,场景 S1-S8 落表)
 *
 * 将巡检记录写入飞书多维表格(仅追加,满足政府两年台账要求)。
 *  - scene 决定写入哪张表(每张表在 .env 中配置 table id)
 *  - inspection 场景:传 analysis/advice 时自动按巡检表列名组装
 *  - 其他场景:由 Agent 按表格实际列名提供 fields(键为表格列名)
 *  - 池号缺失时不落表,返回追问,由 Agent 向工人补充提问
 *  - 上报人只取当前消息发送者 open_id 解析(禁止凭记忆填写),解析不出时同样追问
 *  - dissection 场景:「解剖器官」写入前归一为下拉框选项(可多选),拒绝选项外自由文本
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { getFeishuToken, getFeishuUserName, uploadImageToFeishu } from '../feishu/token.js';
/** 场景 → 表格 id 环境变量(未配置 env 的场景不可写,返回明确错误) */
const SCENE_TABLE_ENV = {
    inspection: 'FEISHU_BITABLE_TABLE_ID_INSPECTION',
    water_quality: 'FEISHU_BITABLE_TABLE_ID_WATER_QUALITY',
    medication: 'FEISHU_BITABLE_TABLE_ID_MEDICATION',
    feeding: 'FEISHU_BITABLE_TABLE_ID_FEEDING',
    temperature: 'FEISHU_BITABLE_TABLE_ID_TEMPERATURE',
    death: 'FEISHU_BITABLE_TABLE_ID_DEATH',
    dissection: 'FEISHU_BITABLE_TABLE_ID_DISSECTION'
};
/** 各场景表格的常见列名(供 Agent 组装 fields 参考,以实际飞书表格为准) */
const SCENE_COLUMNS = {
    inspection: ['池号', '巡检时间', '巡检人', '鱼群状态', '症状描述', '严重程度', 'AI诊断', '处置建议', '知识来源', '是否预警', '图片'],
    water_quality: ['池号', '检测时间', '检测人', '溶氧(mg/L)', '氨氮(mg/L)', 'pH值', '亚硝酸盐(mg/L)', '二氧化碳(mg/L)', '硝酸盐(mg/L)', '水色描述', 'AI分析', '异常标记', '图片'],
    medication: ['池号', '用药时间', '用药人', '药品名称', '用药剂量', '用药方式', '用药原因', '备注', '图片'],
    feeding: ['池号', '喂食时间', '喂食人', '饲料种类', '投喂量(kg)', '摄食情况', '备注', '图片'],
    temperature: ['池号', '测量时间', '测量人', '水温(℃)', '棚温(℃)', '备注', '图片'],
    death: ['池号', '汇报时间', '汇报人', '死亡数量', '死亡状态', '死鱼外观', 'AI分析', '预警级别', '是否通知负责人', '图片'],
    dissection: ['池号', '汇报时间', '汇报人', '解剖器官', '异常信号', 'AI辅助判断', '备注', '图片']
};
/** 各场景的时间列名(用于查询 30 分钟内已有记录) */
const SCENE_TIME_COLUMN = {
    inspection: '巡检时间',
    water_quality: '检测时间',
    medication: '用药时间',
    feeding: '喂食时间',
    temperature: '测量时间',
    death: '汇报时间',
    dissection: '汇报时间'
};
/** 编辑窗口:30 分钟(毫秒) */
const EDIT_WINDOW_MS = 30 * 60 * 1000;
/** AI 诊断文本自动落入的列名(按场景) */
const AI_ANALYSIS_COLUMN = {
    water_quality: 'AI分析',
    death: 'AI分析',
    dissection: 'AI辅助判断'
};
/** dissection 场景「解剖器官」下拉框选项(多选;须与飞书表格选项一致,写入值只能是其中之一) */
const DISSECTION_ORGAN_OPTIONS = ['体表', '鳃', '肝', '胆囊', '肠', '脾', '鳔', '肾', '腹腔'];
export const recordLedger = defineTool({
    name: 'aquasense_ledger',
    description: '将巡检记录写入飞书多维表格。scene 选择表格,池号必填;缺池号时返回追问。同一池号 30 分钟内重复写入会自动更新已有记录。',
    parameters: {
        scene: {
            type: 'string',
            enum: ['inspection', 'water_quality', 'medication', 'feeding', 'temperature', 'death', 'dissection'],
            description: '场景:inspection 巡检(默认)/ water_quality 水质 / medication 用药 / feeding 喂食 / temperature 温度 / death 死亡 / dissection 解剖'
        },
        pool_id: {
            type: 'string',
            description: '池号(池1/池2/池3/池4),必须与 fields 中的"池号"一致'
        },
        fields: {
            type: 'object',
            additionalProperties: true,
            description: '表格字段,键为表格实际列名。inspection 场景可省略(自动按分析结果组装);其他场景必填'
        },
        images: { type: 'array', items: { type: 'string' }, description: '图片 URL 列表(支持多张,自动上传至飞书云文档写入图片列)' },
        analysis: { type: 'object', additionalProperties: true, description: 'aquasense_analyze 分析结果(inspection 自动组装用)' },
        advice: { type: 'object', additionalProperties: true, description: 'aquasense_advice 处置建议(inspection 自动组装用)' },
        reporter: { type: 'string', description: '上报人姓名(兜底):仅在拿不到消息发送者 open_id 时使用,禁止凭记忆/历史对话填写' },
        open_id: { type: 'string', description: '当前消息发送者的飞书 open_id(dsh-lark 消息上下文提供);上报人以它解析出的姓名为准' }
    },
    output: {
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                record_id: { type: 'string' },
                missing: { type: 'array', items: { type: 'string' } },
                questions: { type: 'array', items: { type: 'string' } }
            }
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    async execute(args) {
        const scene = (args.scene || 'inspection');
        const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN;
        const tableId = process.env[SCENE_TABLE_ENV[scene]];
        if (!bitableToken || !tableId) {
            return {
                success: false,
                message: `多维表格未配置:需要 FEISHU_BITABLE_APP_TOKEN 与 ${SCENE_TABLE_ENV[scene]}${scene !== 'inspection' ? '(如未启用该场景表,请改配巡检表)' : ''}`
            };
        }
        // 池号校验:缺失时返回追问(Agent 转述给工人),不落脏数据
        const fields = args.fields;
        const rawPoolId = fields?.['池号'] ?? args.pool_id;
        if (!rawPoolId) {
            return {
                success: false,
                message: '信息不完整,请补充:',
                missing: ['pool_id'],
                questions: ['请问是哪个池子?(池1/池2/池3/池4)']
            };
        }
        const poolId = String(rawPoolId);
        // 自动解析汇报人:必须以发消息用户的 open_id 为准,防止记忆/猜测中的姓名顶替真实上报人
        // reporter 仅作兜底:拿不到 open_id 或解析失败时才使用
        let reporterName = '';
        if (args.open_id) {
            reporterName = await getFeishuUserName(args.open_id);
        }
        if (!reporterName) {
            reporterName = args.reporter || '';
        }
        // 非 inspection 场景必须提供 fields:缺失时返回列名提示(Agent 补全后重调)
        if (scene !== 'inspection' && !(fields && Object.keys(fields).length > 0)) {
            return {
                success: false,
                message: `scene=${scene} 需要提供 fields(键为表格实际列名),可选列:${SCENE_COLUMNS[scene].join('、')}`
            };
        }
        // dissection 场景:「解剖器官」只允许下拉框选项,归一为多选数组,不写入自由文本
        if (scene === 'dissection' && fields && fields['解剖器官'] !== undefined) {
            const { organs, unknown } = normalizeDissectionOrgans(fields['解剖器官']);
            if (organs.length === 0) {
                return {
                    success: false,
                    message: `「解剖器官」只能从下拉选项中选择(当前值 ${JSON.stringify(fields['解剖器官'])} 无法识别)。合法选项:${DISSECTION_ORGAN_OPTIONS.join('/')}`,
                    missing: ['解剖器官'],
                    questions: [`解剖器官请从以下选项中选(可多选):${DISSECTION_ORGAN_OPTIONS.join('/')}`]
                };
            }
            if (unknown.length > 0) {
                console.warn(`[aquasense] 解剖器官忽略无法识别的内容:${unknown.join('、')}`);
            }
            fields['解剖器官'] = organs;
        }
        // 上报人仍无法确定(fields 也未显式提供人列):返回追问,不写"未知"等脏数据
        const reporterCol = REPORTER_COLUMN[scene];
        const fieldReporter = reporterCol && fields ? fields[reporterCol] : undefined;
        if (!reporterName && !fieldReporter) {
            return {
                success: false,
                message: `无法识别上报人:缺少当前消息发送者的 open_id,且未提供「${reporterCol ?? '上报人'}」。请从消息上下文获取发送者 open_id 后重试,不要凭记忆填写。`,
                missing: ['open_id'],
                questions: ['请问上报人是谁?(将记入台账)']
            };
        }
        const recordFields = await buildFields(scene, args, poolId, reporterName);
        // 查询 30 分钟内同池号已有记录(存在则更新,否则新增)
        const token = await getFeishuToken();
        const timeColumn = SCENE_TIME_COLUMN[scene];
        const recentRecord = await findRecentRecord(token, bitableToken, tableId, poolId, timeColumn);
        try {
            if (recentRecord) {
                // 更新已有记录(合并字段,保留未覆盖的旧值)
                const mergedFields = { ...recentRecord.fields, ...recordFields };
                const response = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableToken}/tables/${tableId}/records/${recentRecord.record_id}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ fields: mergedFields })
                });
                const result = (await response.json());
                if (result.code === 0) {
                    return { success: true, message: `已更新台账(scene=${scene},record_id=${recentRecord.record_id})`, record_id: recentRecord.record_id };
                }
                return { success: false, message: `更新失败:${result.msg}` };
            }
            // 新增记录
            const response = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableToken}/tables/${tableId}/records`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fields: recordFields })
            });
            const result = (await response.json());
            if (result.code === 0) {
                const recordId = result.data?.record?.record_id;
                return recordId
                    ? { success: true, message: `已写入台账(scene=${scene})`, record_id: recordId }
                    : { success: true, message: `已写入台账(scene=${scene})` };
            }
            return { success: false, message: `写入失败:${result.msg}(请核对表格列名与字段类型是否一致)` };
        }
        catch (error) {
            return { success: false, message: `操作异常:${error instanceof Error ? error.message : String(error)}` };
        }
    }
});
/**
 * 组装飞书表格字段
 */
/** 各场景「人」字段的列名映射(用于自动填充汇报人) */
const REPORTER_COLUMN = {
    inspection: '巡检人',
    water_quality: '检测人',
    medication: '用药人',
    feeding: '喂食人',
    temperature: '测量人',
    death: '汇报人',
    dissection: '汇报人'
};
/**
 * 归一化「解剖器官」:输入可含多个器官与常见异写(腮→鳃、单字"胆"→"胆囊"),
 * 只保留下拉框选项内的器官,选项外内容记入 unknown。
 */
function normalizeDissectionOrgans(value) {
    const parts = (Array.isArray(value) ? value : [value])
        .filter((v) => typeof v === 'string')
        .flatMap((v) => v.split(/[、,，/;；\s]+/))
        .map((v) => v.trim())
        .filter(Boolean);
    const organs = [];
    const unknown = [];
    for (const part of parts) {
        // 常见异写归一:"腮"(错别字)→鳃;单独出现的"胆"→"胆囊"
        const text = part.replace(/腮/g, '鳃').replace(/胆(?!囊)/g, '胆囊');
        const hits = DISSECTION_ORGAN_OPTIONS.filter((opt) => text.includes(opt));
        if (hits.length > 0)
            organs.push(...hits);
        else
            unknown.push(part);
    }
    return { organs: [...new Set(organs)], unknown };
}
/**
 * 批量上传图片 URL 到飞书云文档,返回 Bitable 附件格式数组
 */
async function uploadImages(urls) {
    const results = await Promise.all(urls.map((url) => uploadImageToFeishu(url)));
    return results.filter((r) => r !== null);
}
/** 查询 30 分钟内同池号的最近一条记录(用于判断更新还是新增) */
async function findRecentRecord(token, appToken, tableId, poolId, timeColumn) {
    try {
        // 构造过滤条件:池号匹配 + 时间列在编辑窗口内
        // 飞书 Bitable 时间字段存储为毫秒时间戳
        const since = Date.now() - EDIT_WINDOW_MS;
        const filter = `AND(CurrentValue.[${timeColumn}] >= ${since}, CurrentValue.[池号] = "${poolId}")`;
        const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=1&filter=${encodeURIComponent(filter)}`;
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const result = (await resp.json());
        if (result.code === 0 && result.data?.items?.length) {
            return result.data.items[0];
        }
        return null;
    }
    catch {
        // 查询失败不阻断,走新增流程
        return null;
    }
}
async function buildFields(scene, args, poolId, reporterName) {
    const analysis = args.analysis;
    const advice = args.advice;
    const fields = {};
    // 显式 fields 优先(其他场景必须由 Agent 提供)
    if (args.fields && Object.keys(args.fields).length > 0) {
        Object.assign(fields, args.fields);
        fields['池号'] = poolId;
        // 「人」字段以发消息用户为准:open_id 解析成功时覆盖,防止字段里的记忆/猜测姓名顶替真实上报人
        const reporterCol = REPORTER_COLUMN[scene];
        if (reporterCol && reporterName) {
            fields[reporterCol] = reporterName;
        }
        // 自动填充「图片」字段(未显式提供时)
        if (!('图片' in fields) && args.images?.length) {
            fields['图片'] = await uploadImages(args.images);
        }
        // AI 诊断文本自动落入对应列(未显式提供时)
        const aiColumn = AI_ANALYSIS_COLUMN[scene];
        if (aiColumn && !(aiColumn in fields) && advice?.diagnosis_summary) {
            fields[aiColumn] = advice.diagnosis_summary;
        }
        return fields;
    }
    // inspection 便捷路径:按分析结果自动组装
    const imageAttachments = args.images?.length ? await uploadImages(args.images) : [];
    return {
        '池号': poolId,
        '巡检时间': Date.now(),
        '巡检人': reporterName,
        '鱼群状态': analysis?.cls || 'normal',
        '症状描述': analysis?.symptoms?.join('、') || '',
        '严重程度': analysis?.severity || 'low',
        'AI诊断': advice?.diagnosis_summary || analysis?.cls || '',
        '处置建议': advice?.immediate_actions?.join('; ') || '',
        '知识来源': advice?.knowledge_refs?.join('; ') || '',
        '是否预警': Boolean(analysis?.abnormal),
        '图片': imageAttachments
    };
}
