/**
 * R8 群聊场景 trace 集成(后置收集,见 docs/r8-traceability-architecture.md §4.1 方案 A)
 *
 * 以包装器替换 recordLedger 注册(不修改其实现):台账写入完成后,从
 * args(analysis/advice/open_id)与返回值(record_id/message)组装**简化版**
 * AnalysisRecord(source='group_chat')并落盘。
 *
 * 简化模式说明:群聊场景由 Agent 编排调用,无法分段计时,故只有 ledger
 * 步骤有真实耗时(包装器测量);analyze/advice 数据来自 Agent 透传的参数,
 * 无 Token 数据(记录中为 0)。
 *
 * 安全边界:
 *  - trace 写入为 fire-and-forget,任何失败不影响台账主链路(内部全量捕获);
 *  - 追问类失败(missing 非空)不记录(高频且无分析价值,避免噪声);
 *  - H5 场景调用原始 recordLedger(未包装),由 report-handler 全量埋点,不重复记录。
 */

import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { getFeishuUserName, parseDataUrl } from '../feishu/token.js'
import { AnalysisTracer, type SpanRetrieve } from './trace-recorder.js'
import { saveReportImages } from './trace-store.js'

// ========== 常量 ==========

/** 场景 → 中文表名(详情页展示 target_table) */
const SCENE_TABLE_NAME: Record<string, string> = {
  inspection: '巡检记录表',
  water_quality: '水质检测表',
  medication: '用药记录表',
  feeding: '喂食记录表',
  temperature: '温度记录表',
  death: '死鱼记录表',
  dissection: '解剖记录表'
}

/** 症状/输出原始文本截断长度(简化模式不保留模型原文) */
const REASONING_PREVIEW_LENGTH = 200

// ========== args 解析 ==========

interface LedgerTraceInput {
  scene: string
  pool: string
  reporter: string
  openId: string
  analysis: Record<string, unknown> | null
  advice: Record<string, unknown> | null
  /** 工人发送的图片(data URL 或 http(s) URL,台账 images 参数) */
  images: string[]
}

interface LedgerTraceResult {
  success: boolean
  message: string
  record_id?: string
  missing?: string[]
}

/** 从 args 提取 trace 需要的字段(非对象/无池号时返回 null) */
function pickTraceInput(args: unknown): LedgerTraceInput | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  const fields = a.fields && typeof a.fields === 'object' ? (a.fields as Record<string, unknown>) : undefined
  const pool = String(a.pool_id ?? fields?.['池号'] ?? '').trim()
  if (!pool) return null

  const analysis = a.analysis && typeof a.analysis === 'object' ? (a.analysis as Record<string, unknown>) : null
  const advice = a.advice && typeof a.advice === 'object' ? (a.advice as Record<string, unknown>) : null
  // 无 AI 数据可追溯时不记录(如纯手工台账场景)
  if (!analysis && !advice) return null

  return {
    scene: typeof a.scene === 'string' && a.scene ? a.scene : 'inspection',
    pool,
    reporter: String(a.reporter ?? '').trim(),
    openId: String(a.open_id ?? '').trim(),
    analysis,
    advice,
    images: Array.isArray(a.images) ? (a.images as unknown[]).filter((v): v is string => typeof v === 'string') : []
  }
}

/** 从返回值提取 trace 需要的字段 */
function pickTraceResult(result: unknown): LedgerTraceResult | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (typeof r.success !== 'boolean') return null
  return {
    success: r.success,
    message: typeof r.message === 'string' ? r.message : '',
    record_id: typeof r.record_id === 'string' ? r.record_id : undefined,
    missing: Array.isArray(r.missing) ? (r.missing as string[]) : undefined
  }
}

/** 字符串数组归一化(analysis.symptoms 可能是 string 或 string[]) */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return typeof value === 'string' && value ? [value] : []
}

/** 操作类型判定:recordLedger 以消息文案区分更新/新增 */
function operationOf(message: string): 'create' | 'update' {
  return message.includes('已更新') ? 'update' : 'create'
}

// ========== retrieve span 合成(Agent 转抄可能丢字段,结构化透传优先、字符串反解降级) ==========

/** 从 unknown 读取数字(非 number 返回 undefined,避免缺数据时误报 0 命中) */
function optNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 反解 knowledge_excerpt 字符串(格式《标题》[定位]:「原文」)为结构化摘录;
 * 降级路径拿不到通道归属(from),逐条容错(解析失败跳过)。导出供测试。
 */
export function parseExcerpts(list: string[]): Array<{ title: string; locator?: string; excerpt_preview: string }> {
  const out: Array<{ title: string; locator?: string; excerpt_preview: string }> = []
  for (const raw of list) {
    const m = /^《(.+?)》(.*?):「([\s\S]*)」$/.exec(raw.trim())
    if (!m) continue
    const title = m[1].trim()
    const text = m[3].trim()
    if (!title || !text) continue
    const locator = m[2].trim()
    out.push({ title, ...(locator ? { locator } : {}), excerpt_preview: text })
  }
  return out
}

/** 从 Agent 透传的 advice 对象合成 span_retrieve;无任何检索数据时返回 null(不写 span) */
function buildRetrieveSpan(advice: Record<string, unknown>): Partial<SpanRetrieve> | null {
  const query = typeof advice.query === 'string' ? advice.query : ''
  const rawStructured = Array.isArray(advice.retrieve_excerpts) ? advice.retrieve_excerpts : undefined
  const excerpts = rawStructured
    ? (rawStructured as unknown[])
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
        .map((e) => ({
          title: String(e.title ?? ''),
          from: typeof e.from === 'string' && e.from ? e.from : undefined,
          locator: typeof e.locator === 'string' && e.locator ? e.locator : undefined,
          excerpt_preview: String(e.text ?? '')
        }))
        .filter((e) => e.title || e.excerpt_preview)
    : parseExcerpts(toStringArray(advice.knowledge_excerpt))
  if (excerpts.length === 0 && !query) return null
  const span: Partial<SpanRetrieve> = { query, excerpts }
  // 通道计数仅结构化透传时可信(降级反解无通道数据,缺省不写,详情页显示「—」)
  if (rawStructured) {
    span.channel_a_wiki = optNum(advice.channel_a_wiki)
    span.channel_b_note = optNum(advice.channel_b_note)
    span.channel_c_pdf = optNum(advice.channel_c_pdf)
    span.merged_count = optNum(advice.merged_count)
  }
  return span
}

// ========== 图片下载(群聊发图,详情页展示) ==========

/** 下载一张工人发送的图片(data URL 直接解析;http(s) URL 走网络);失败返回 null */
async function downloadChatImage(url: string): Promise<{ data: string; mimeType: string; name: string } | null> {
  try {
    if (url.startsWith('data:')) {
      const parsed = parseDataUrl(url)
      if (!parsed) return null
      return {
        data: parsed.buffer.toString('base64'),
        mimeType: parsed.mimeType,
        name: `image-${Date.now()}${parsed.mimeType === 'image/png' ? '.png' : '.jpg'}`
      }
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) return null
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!resp.ok) return null
    const buffer = Buffer.from(await resp.arrayBuffer())
    const ct = resp.headers.get('content-type') || ''
    let mimeType = 'image/jpeg'
    if (ct.includes('png')) mimeType = 'image/png'
    else if (ct.includes('webp')) mimeType = 'image/webp'
    else if (ct.includes('gif')) mimeType = 'image/gif'
    const name = url.split('/').pop()?.split('?')[0] || `image-${Date.now()}`
    return { data: buffer.toString('base64'), mimeType, name }
  } catch (error) {
    console.warn(`[aquasense-trace] 群聊图片下载失败(跳过): ${url.slice(0, 80)}`, error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 下载并落盘工人发送的图片。
 * 逐张容错:单张失败不阻断其余;整体失败不阻断 trace 主链路。
 * @returns 成功落盘的图片(name + 字节数,供 span_upload 埋点)
 */
async function saveChatImages(recordId: string, urls: string[]): Promise<Array<{ name: string; size: number }>> {
  if (urls.length === 0) return []
  const results = await Promise.allSettled(urls.map((url) => downloadChatImage(url)))
  const images: Array<{ data: string; mimeType: string }> = []
  const names: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      images.push({ data: r.value.data, mimeType: r.value.mimeType })
      names.push(r.value.name)
    }
  }
  if (images.length === 0) return []
  try {
    const saved = await saveReportImages(recordId, images)
    console.log(`[aquasense-trace] 群聊图片已落盘: ${recordId}, ${saved.length} 张`)
    return saved.map((m, i) => ({ name: names[i] ?? m.fileName, size: m.size }))
  } catch (error) {
    console.warn('[aquasense-trace] 群聊图片落盘失败(详情页将无图):', error instanceof Error ? error.message : error)
    return []
  }
}

// ========== 后置收集 ==========

/**
 * 组装并写入一条简化分析记录;全量捕获异常,不向调用方抛出。
 */
export async function recordChatTrace(args: unknown, result: unknown, ledgerDurationMs: number): Promise<void> {
  try {
    const input = pickTraceInput(args)
    const output = pickTraceResult(result)
    if (!input || !output) {
      console.warn('[aquasense-trace] 群聊 trace 跳过:缺少必要字段(pool_id/analysis/advice)或返回值无效')
      return
    }
    // 追问类失败(缺池号/缺 open_id 等)不记录:高频且无分析价值
    if (!output.success && output.missing && output.missing.length > 0) {
      console.warn(`[aquasense-trace] 群聊 trace 跳过:追问类失败(missing=${output.missing.join(',')})`)
      return
    }

    // 上报人:优先 open_id 解析(与 recordLedger 同源),失败降级 args.reporter
    let reporter = input.reporter
    if (input.openId) {
      const resolved = await getFeishuUserName(input.openId).catch(() => '')
      if (resolved) reporter = resolved
    }

    const tracer = new AnalysisTracer({
      pool: input.pool,
      reporter,
      reporter_open_id: input.openId,
      source: 'group_chat'
    })

    // upload:下载工人发送的图片并落盘,供详情页展示(失败仅告警)
    const savedImages = await saveChatImages(tracer.id, input.images)
    if (savedImages.length > 0) {
      tracer.recordSpan('upload', {
        image_count: savedImages.length,
        image_names: savedImages.map((img) => img.name),
        image_sizes: savedImages.map((img) => img.size)
      })
    }

    // analyze:数据来自 Agent 透传的分析结果(无耗时/Token)
    const analysis = input.analysis
    if (analysis) {
      tracer.recordSpan('analyze', {
        prompt_length: 0,
        input_tokens: 0,
        output_tokens: 0,
        output_raw: '',
        cls: String(analysis.cls ?? 'unknown'),
        symptoms: toStringArray(analysis.symptoms),
        severity: String(analysis.severity ?? 'low'),
        confidence: typeof analysis.confidence === 'number' ? analysis.confidence : 0,
        scene_hint: String(analysis.scene_hint ?? input.scene)
      })
    }

    // advice:数据来自 Agent 透传的处置建议
    const advice = input.advice
    if (advice) {
      const refs = toStringArray(advice.knowledge_refs)
      const excerpts = toStringArray(advice.knowledge_excerpt)
      tracer.recordSpan('advice', {
        input_cls: String(analysis?.cls ?? input.scene),
        alert_level: String(advice.alert_level ?? 'P2'),
        knowledge_refs_count: refs.length,
        diagnosis_summary: String(advice.diagnosis_summary ?? ''),
        reasoning_preview: String(advice.reasoning ?? '').slice(0, REASONING_PREVIEW_LENGTH),
        ...(excerpts.length > 0 ? { knowledge_excerpt: excerpts } : {})
      })

      // retrieve:结构化透传优先(工具原始产出),降级反解 knowledge_excerpt 字符串;
      // 桥接层会以未失真产出权威覆盖(见 trace-store.patchReportAgent)
      const retrieveSpan = buildRetrieveSpan(advice)
      if (retrieveSpan) tracer.recordSpan('retrieve', retrieveSpan)
    }

    // ledger:真实耗时来自包装器测量
    tracer.recordSpan(
      'ledger',
      {
        target_table: SCENE_TABLE_NAME[input.scene] ?? input.scene,
        operation: operationOf(output.message),
        record_id: output.record_id,
        success: output.success,
        message: output.message
      },
      ledgerDurationMs
    )

    if (!output.success) {
      tracer.setTraceMeta({ status: 'error', error: output.message })
    }

    const id = await tracer.flush()
    console.log(`[aquasense-trace] 群聊 trace: ${id}, 简化模式(无 Token)`)
  } catch (error) {
    // 埋点失败不影响台账主链路
    console.warn('[aquasense-trace] 群聊 trace 写入失败:', error instanceof Error ? error.message : error)
  }
}

// ========== 工具包装 ==========

/**
 * 包装台账工具:透传全部定义,仅在 execute 后追加一次后置收集。
 * trace 写入为 fire-and-forget(不 await),不改变工具返回时机与结果。
 */
export function wrapLedgerWithTrace(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const started = performance.now()
      try {
        const result = await tool.execute(args, exec)
        const durationMs = Math.round(performance.now() - started)
        void recordChatTrace(args, result, durationMs)
        return result
      } catch (error) {
        // 异常路径:仍记录 trace(含 error 信息),不中断上层错误处理
        // 必须传结构化 result 而非 null——pickTraceResult(null) 会返回 null 导致 trace 被跳过
        const durationMs = Math.round(performance.now() - started)
        const errorResult = {
          success: false,
          message: `工具异常:${error instanceof Error ? error.message : String(error)}`
        }
        void recordChatTrace(args, errorResult, durationMs)
        throw error
      }
    }
  }
}
