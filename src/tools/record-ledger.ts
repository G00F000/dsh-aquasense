/**
 * 台账写入工具(aquasense_ledger,场景 S1-S8 落表)
 *
 * 将巡检记录写入飞书多维表格(仅追加,满足政府两年台账要求)。
 *  - scene 决定写入哪张表(每张表在 .env 中配置 table id)
 *  - inspection 场景:传 analysis/advice 时自动按巡检表列名组装
 *  - 其他场景:由 Agent 按表格实际列名提供 fields(键为表格列名)
 *  - 池号缺失时不落表,返回追问,由 Agent 向工人补充提问
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { getFeishuToken, getFeishuUserName, uploadImageToFeishu } from '../feishu/token.js'
import { type Scene } from '../router/intent-router.js'

/** 台账场景 = S1-S8 中所有落表场景(排除 S3 知识询问) */
export type LedgerScene = Exclude<Scene, 'knowledge'>

/** 场景 → 表格 id 环境变量(未配置 env 的场景不可写,返回明确错误) */
const SCENE_TABLE_ENV: Record<LedgerScene, string> = {
  inspection: 'FEISHU_BITABLE_TABLE_ID_INSPECTION',
  water_quality: 'FEISHU_BITABLE_TABLE_ID_WATER_QUALITY',
  medication: 'FEISHU_BITABLE_TABLE_ID_MEDICATION',
  feeding: 'FEISHU_BITABLE_TABLE_ID_FEEDING',
  temperature: 'FEISHU_BITABLE_TABLE_ID_TEMPERATURE',
  death: 'FEISHU_BITABLE_TABLE_ID_DEATH',
  dissection: 'FEISHU_BITABLE_TABLE_ID_DISSECTION'
}

/** 各场景表格的常见列名(供 Agent 组装 fields 参考,以实际飞书表格为准) */
const SCENE_COLUMNS: Record<LedgerScene, string[]> = {
  inspection: ['池号', '巡检时间', '巡检人', '鱼群状态', '症状描述', '严重程度', 'AI诊断', '处置建议', '知识来源', '是否预警', '图片'],
  water_quality: ['池号', '检测时间', '检测人', '溶氧(mg/L)', '氨氮(mg/L)', 'pH值', '亚硝酸盐(mg/L)', '二氧化碳(mg/L)', '硝酸盐(mg/L)', '水色描述', 'AI分析', '异常标记', '图片'],
  medication: ['池号', '用药时间', '用药人', '药品名称', '用药剂量', '用药方式', '用药原因', '备注', '图片'],
  feeding: ['池号', '喂食时间', '喂食人', '饲料种类', '投喂量(kg)', '摄食情况', '备注', '图片'],
  temperature: ['池号', '测量时间', '测量人', '水温(℃)', '棚温(℃)', '备注', '图片'],
  death: ['池号', '汇报时间', '汇报人', '死亡数量', '死亡状态', '死鱼外观', 'AI分析', '预警级别', '是否通知负责人', '图片'],
  dissection: ['池号', '汇报时间', '汇报人', '解剖器官', '异常信号', 'AI辅助判断', '备注', '图片']
}

/** 各场景的时间列名(用于查询 30 分钟内已有记录) */
const SCENE_TIME_COLUMN: Record<LedgerScene, string> = {
  inspection: '巡检时间',
  water_quality: '检测时间',
  medication: '用药时间',
  feeding: '喂食时间',
  temperature: '测量时间',
  death: '汇报时间',
  dissection: '汇报时间'
}

/** 编辑窗口:30 分钟(毫秒) */
const EDIT_WINDOW_MS = 30 * 60 * 1000

/** AI 诊断文本自动落入的列名(按场景) */
const AI_ANALYSIS_COLUMN: Partial<Record<LedgerScene, string>> = {
  water_quality: 'AI分析',
  death: 'AI分析',
  dissection: 'AI辅助判断'
}

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
    reporter: { type: 'string', description: '上报人(工人姓名),优先使用 open_id 自动解析' },
    open_id: { type: 'string', description: '飞书用户 open_id(dsh-lark 消息桥提供,用于自动获取汇报人姓名)' }
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
    const scene = (args.scene || 'inspection') as LedgerScene
    const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN
    const tableId = process.env[SCENE_TABLE_ENV[scene]]

    if (!bitableToken || !tableId) {
      return {
        success: false,
        message: `多维表格未配置:需要 FEISHU_BITABLE_APP_TOKEN 与 ${SCENE_TABLE_ENV[scene]}${scene !== 'inspection' ? '(如未启用该场景表,请改配巡检表)' : ''}`
      }
    }

    // 池号校验:缺失时返回追问(Agent 转述给工人),不落脏数据
    const fields = args.fields as Record<string, unknown> | undefined
    const rawPoolId = fields?.['池号'] ?? args.pool_id
    if (!rawPoolId) {
      return {
        success: false,
        message: '信息不完整,请补充:',
        missing: ['pool_id'],
        questions: ['请问是哪个池子?(池1/池2/池3/池4)']
      }
    }
    const poolId = String(rawPoolId)

    // 自动解析汇报人:open_id → 飞书用户名,reporter 作为显式覆盖
    let reporterName = args.reporter || ''
    if (!reporterName && args.open_id) {
      reporterName = await getFeishuUserName(args.open_id)
    }

    // 非 inspection 场景必须提供 fields:缺失时返回列名提示(Agent 补全后重调)
    if (scene !== 'inspection' && !(fields && Object.keys(fields).length > 0)) {
      return {
        success: false,
        message: `scene=${scene} 需要提供 fields(键为表格实际列名),可选列:${SCENE_COLUMNS[scene].join('、')}`
      }
    }

    const recordFields = await buildFields(scene, args, poolId, reporterName)

    // 查询 30 分钟内同池号已有记录(存在则更新,否则新增)
    const token = await getFeishuToken()
    const timeColumn = SCENE_TIME_COLUMN[scene]
    const recentRecord = await findRecentRecord(token, bitableToken, tableId, poolId, timeColumn)

    try {
      if (recentRecord) {
        // 更新已有记录(合并字段,保留未覆盖的旧值)
        const mergedFields = { ...recentRecord.fields, ...recordFields }
        const response = await fetch(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableToken}/tables/${tableId}/records/${recentRecord.record_id}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: mergedFields })
          }
        )
        const result = (await response.json()) as { code: number; msg?: string; data?: { record?: { record_id?: string } } }
        if (result.code === 0) {
          return { success: true, message: `已更新台账(scene=${scene},record_id=${recentRecord.record_id})`, record_id: recentRecord.record_id }
        }
        return { success: false, message: `更新失败:${result.msg}` }
      }

      // 新增记录
      const response = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableToken}/tables/${tableId}/records`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: recordFields })
        }
      )
      const result = (await response.json()) as { code: number; msg?: string; data?: { record?: { record_id?: string } } }
      if (result.code === 0) {
        const recordId = result.data?.record?.record_id
        return recordId
          ? { success: true, message: `已写入台账(scene=${scene})`, record_id: recordId }
          : { success: true, message: `已写入台账(scene=${scene})` }
      }
      return { success: false, message: `写入失败:${result.msg}(请核对表格列名与字段类型是否一致)` }
    } catch (error) {
      return { success: false, message: `操作异常:${error instanceof Error ? error.message : String(error)}` }
    }
  }
})

interface LedgerArgs {
  pool_id?: string
  reporter?: string
  open_id?: string
  images?: string[]
  fields?: Record<string, unknown>
  analysis?: Record<string, unknown>
  advice?: Record<string, unknown>
}

/**
 * 组装飞书表格字段
 */
/** 各场景「人」字段的列名映射(用于自动填充汇报人) */
const REPORTER_COLUMN: Partial<Record<LedgerScene, string>> = {
  inspection: '巡检人',
  water_quality: '检测人',
  medication: '用药人',
  feeding: '喂食人',
  temperature: '测量人',
  death: '汇报人',
  dissection: '汇报人'
}

/**
 * 批量上传图片 URL 到飞书云文档,返回 Bitable 附件格式数组
 */
async function uploadImages(urls: string[]): Promise<Array<{ file_token: string }>> {
  const results = await Promise.all(urls.map((url) => uploadImageToFeishu(url)))
  return results.filter((r): r is { file_token: string } => r !== null)
}

/** 查询 30 分钟内同池号的最近一条记录(用于判断更新还是新增) */
async function findRecentRecord(
  token: string, appToken: string, tableId: string,
  poolId: string, timeColumn: string
): Promise<{ record_id: string; fields: Record<string, unknown> } | null> {
  try {
    // 构造过滤条件:池号匹配 + 时间列在编辑窗口内
    // 飞书 Bitable 时间字段存储为毫秒时间戳
    const since = Date.now() - EDIT_WINDOW_MS
    const filter = `AND(CurrentValue.[${timeColumn}] >= ${since}, CurrentValue.[池号] = "${poolId}")`
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=1&filter=${encodeURIComponent(filter)}`

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const result = (await resp.json()) as {
      code: number; msg?: string;
      data?: { items?: Array<{ record_id: string; fields: Record<string, unknown> }> }
    }

    if (result.code === 0 && result.data?.items?.length) {
      return result.data.items[0]
    }
    return null
  } catch {
    // 查询失败不阻断,走新增流程
    return null
  }
}

async function buildFields(scene: LedgerScene, args: LedgerArgs, poolId: string, reporterName: string): Promise<Record<string, unknown>> {
  const analysis = args.analysis as { cls?: string; symptoms?: string[]; severity?: string; abnormal?: boolean } | undefined
  const advice = args.advice as { diagnosis_summary?: string; immediate_actions?: string[]; knowledge_refs?: string[]; alert_level?: string } | undefined
  const fields: Record<string, unknown> = {}

  // 显式 fields 优先(其他场景必须由 Agent 提供)
  if (args.fields && Object.keys(args.fields).length > 0) {
    Object.assign(fields, args.fields)
    fields['池号'] = poolId

    // 自动填充「人」字段(未显式提供时)
    const reporterCol = REPORTER_COLUMN[scene]
    if (reporterCol && !(reporterCol in fields) && reporterName) {
      fields[reporterCol] = reporterName
    }

    // 自动填充「图片」字段(未显式提供时)
    if (!('图片' in fields) && args.images?.length) {
      fields['图片'] = await uploadImages(args.images)
    }

    // AI 诊断文本自动落入对应列(未显式提供时)
    const aiColumn = AI_ANALYSIS_COLUMN[scene]
    if (aiColumn && !(aiColumn in fields) && advice?.diagnosis_summary) {
      fields[aiColumn] = advice.diagnosis_summary
    }
    return fields
  }

  // inspection 便捷路径:按分析结果自动组装
  const imageAttachments = args.images?.length ? await uploadImages(args.images) : []
  return {
    '池号': poolId,
    '巡检时间': Date.now(),
    '巡检人': reporterName || '未知',
    '鱼群状态': analysis?.cls || 'normal',
    '症状描述': analysis?.symptoms?.join('、') || '',
    '严重程度': analysis?.severity || 'low',
    'AI诊断': advice?.diagnosis_summary || analysis?.cls || '',
    '处置建议': advice?.immediate_actions?.join('; ') || '',
    '知识来源': advice?.knowledge_refs?.join('; ') || '',
    '是否预警': Boolean(analysis?.abnormal),
    '图片': imageAttachments
  }
}
