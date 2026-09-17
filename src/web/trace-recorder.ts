/**
 * R8 分析记录器(Trace 埋点 + AnalysisRecord 组装,见 docs/r8-traceability-architecture.md §3.2)
 *
 * 借鉴 Langfuse Trace/Span 层级模型:
 *  - Trace  = 一次完整 AI 分析(RPT-YYYYMMDD-HHmmss)
 *  - Span   = 管线中的每个步骤(upload/analyze/retrieve/advice/ledger)
 *
 * 使用方式(H5 全量采集):
 *   const tracer = new AnalysisTracer({ pool, reporter, reporter_open_id, source: 'h5_upload' })
 *   tracer.startSpan('analyze'); ...; tracer.endSpan('analyze', { cls, ... })
 *   await tracer.flush()   // 写 reports/RPT-*.json + 更新 index.json
 *
 * 群聊场景(后置收集,无耗时/Token)用 recordSpan 直接落数据,见 §4.1 方案 A。
 */

import { writeReport, updateIndex } from './trace-store.js'

// ========== 数据模型(需求 R8 §5.1) ==========

/** 记录来源:h5_upload=拍照汇报页 / group_chat=群聊发图后置收集 / api=外部调用 */
export type RecordSource = 'h5_upload' | 'group_chat' | 'api'

/** Span: 图片上传 */
export interface SpanUpload {
  image_count: number
  /** 图片文件名(H5 提交时采集;群聊场景为空) */
  image_names?: string[]
  /** 服务端收到的图片字节数(客户端已压缩) */
  image_sizes: number[]
  compressed_sizes?: number[]
  duration_ms?: number
  error?: string
}

/** Span: AI 视觉分析 */
export interface SpanAnalyze {
  prompt_length: number
  input_tokens: number
  output_tokens: number
  /** 模型原始输出(截断保留前 500 字) */
  output_raw: string
  cls: string
  symptoms: string[]
  severity: string
  confidence: number
  scene_hint: string
  /** 解剖场景可见器官(仅 scene_hint=dissection) */
  organs?: string[]
  duration_ms?: number
  error?: string
}

/** Span: 知识库检索 */
export interface SpanRetrieve {
  query: string
  channel_a_wiki: number
  channel_b_note: number
  channel_c_pdf: number
  merged_count: number
  excerpts: Array<{ title: string; from?: string; locator?: string; excerpt_preview: string }>
  duration_ms?: number
  error?: string
}

/** Span: 处置建议生成 */
export interface SpanAdvice {
  input_cls: string
  alert_level: string
  knowledge_refs_count: number
  diagnosis_summary: string
  reasoning_preview: string
  duration_ms?: number
  error?: string
}

/** Span: 台账写入 */
export interface SpanLedger {
  target_table: string
  operation: 'create' | 'update'
  record_id?: string
  success?: boolean
  message?: string
  duration_ms?: number
  error?: string
}

/** Span 名 → 数据类型 */
export interface SpanDataMap {
  upload: SpanUpload
  analyze: SpanAnalyze
  retrieve: SpanRetrieve
  advice: SpanAdvice
  ledger: SpanLedger
}

export type SpanName = keyof SpanDataMap

/** 单条分析记录(完整 Trace,存 reports/RPT-*.json) */
export interface AnalysisRecord {
  /** 报告唯一 ID,RPT-YYYYMMDD-HHmmss(同秒冲突时追加 -N) */
  id: string
  /** 池号:池1/池2/池3/池4 */
  pool: string
  /** 上报人飞书姓名 */
  reporter: string
  /** 上报人 open_id */
  reporter_open_id: string
  source: RecordSource
  /** 任务描述(S9 提醒场景) */
  task?: string
  /** 群 ID(关联 S9 提醒卡片) */
  chat_id?: string
  /** 创建时间 ISO 8601 */
  created_at: string
  /** 使用的视觉模型名 */
  model: string
  /** 总耗时(各 Span 之和) */
  total_duration_ms: number
  /** 总 Token 消耗(视觉模型) */
  total_tokens: number
  /** 管线结果:success=完成 / error=中断(仍落盘便于排查) */
  status: 'success' | 'error'
  /** 中断原因(status=error 时) */
  error?: string
  span_upload?: SpanUpload
  span_analyze?: SpanAnalyze
  span_retrieve?: SpanRetrieve
  span_advice?: SpanAdvice
  span_ledger?: SpanLedger
}

/** 索引摘要条目(存 index.json,供列表/趋势页轻量加载) */
export interface RecordSummary {
  id: string
  pool: string
  reporter: string
  source: string
  cls: string
  confidence: number
  symptoms: string[]
  alert_level?: string
  created_at: string
  total_duration_ms: number
  total_tokens: number
}

/** 分析记录索引 */
export interface AnalysisIndex {
  version: 1
  records: RecordSummary[]
}

/** Tracer 构造参数 */
export interface TracerParams {
  pool: string
  reporter: string
  reporter_open_id: string
  source: RecordSource
  task?: string
  chat_id?: string
}

/** 内部 Span 状态(起始时刻 + 耗时 + 数据) */
interface SpanState {
  start: number
  duration_ms?: number
  data: Record<string, unknown>
}

// ========== 工具函数 ==========

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 同秒冲突序号(lastBase 记录上一次的秒级前缀) */
let lastBase = ''
let lastSeq = 0

/**
 * 生成报告 ID:RPT-YYYYMMDD-HHmmss;同一秒内多次生成时追加 -N 序号防重名覆盖。
 * 导出供测试。
 */
export function generateReportId(now: Date = new Date()): string {
  const base = `RPT-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  if (base === lastBase) {
    lastSeq += 1
  } else {
    lastBase = base
    lastSeq = 0
  }
  return lastSeq === 0 ? base : `${base}-${lastSeq}`
}

/** 重置 ID 序号(仅供测试) */
export function resetReportIdState(): void {
  lastBase = ''
  lastSeq = 0
}

/** 模型原始输出截断长度(字符) */
export const MAX_OUTPUT_RAW = 500

// ========== Trace 记录器 ==========

/**
 * 单条分析的 Span 数据收集器。
 * 生命周期与一次管线执行一致;flush() 落盘后不再复用。
 */
export class AnalysisTracer {
  private readonly record: AnalysisRecord
  private readonly spans = new Map<SpanName, SpanState>()

  constructor(params: TracerParams) {
    this.record = {
      id: generateReportId(),
      pool: params.pool,
      reporter: params.reporter,
      reporter_open_id: params.reporter_open_id,
      source: params.source,
      task: params.task,
      chat_id: params.chat_id,
      created_at: new Date().toISOString(),
      model: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash',
      total_duration_ms: 0,
      total_tokens: 0,
      status: 'success'
    }
  }

  /** 报告 ID */
  get id(): string {
    return this.record.id
  }

  /** 开始一个 Span(记录起始时刻) */
  startSpan(name: SpanName): void {
    this.spans.set(name, { start: performance.now(), data: {} })
  }

  /** 结束一个 Span(记录耗时并合并数据);未 startSpan 时忽略 */
  endSpan<K extends SpanName>(name: K, data: Partial<SpanDataMap[K]>): void {
    const span = this.spans.get(name)
    if (!span) return
    span.duration_ms = Math.round(performance.now() - span.start)
    span.data = { ...span.data, ...data }
  }

  /**
   * 直接记录一个 Span 的数据(用于群聊后置收集:无实时耗时)。
   * durationMs 缺省时不写 duration_ms,前端展示为「—」。
   */
  recordSpan<K extends SpanName>(name: K, data: Partial<SpanDataMap[K]>, durationMs?: number): void {
    const state: SpanState = { start: performance.now(), data: { ...data } }
    if (durationMs !== undefined) state.duration_ms = durationMs
    this.spans.set(name, state)
  }

  /** 设置 Trace 级别元信息(如 model / status / error) */
  setTraceMeta(meta: Partial<AnalysisRecord>): void {
    Object.assign(this.record, meta)
  }

  /** 汇总各 Span 耗时(缺失视为 0) */
  private sumSpanDurations(): number {
    let total = 0
    for (const span of this.spans.values()) {
      if (span.duration_ms !== undefined) total += span.duration_ms
    }
    return total
  }

  /** 汇总 Token 消耗(从各 Span 数据的 input/output_tokens 提取) */
  private sumTokens(): number {
    let total = 0
    for (const span of this.spans.values()) {
      const input = span.data.input_tokens
      const output = span.data.output_tokens
      if (typeof input === 'number') total += input
      if (typeof output === 'number') total += output
    }
    return total
  }

  /** 取某个 Span 的快照(数据 + duration_ms,数据在对象内部展开,与需求 §5.1 形态一致) */
  private snapshot(name: SpanName): Record<string, unknown> | undefined {
    const span = this.spans.get(name)
    if (!span) return undefined
    const out: Record<string, unknown> = { ...span.data }
    if (span.duration_ms !== undefined) out.duration_ms = span.duration_ms
    return out
  }

  /**
   * 写入磁盘(管线执行完成后调用):汇总 → 写 RPT-*.json → 更新 index.json。
   * @returns 报告 ID
   */
  async flush(): Promise<string> {
    this.record.total_duration_ms = this.sumSpanDurations()
    this.record.total_tokens = this.sumTokens()
    this.record.span_upload = this.snapshot('upload') as unknown as SpanUpload | undefined
    this.record.span_analyze = this.snapshot('analyze') as unknown as SpanAnalyze | undefined
    this.record.span_retrieve = this.snapshot('retrieve') as unknown as SpanRetrieve | undefined
    this.record.span_advice = this.snapshot('advice') as unknown as SpanAdvice | undefined
    this.record.span_ledger = this.snapshot('ledger') as unknown as SpanLedger | undefined

    await writeReport(this.record)
    await updateIndex(this.record)
    console.log(
      `[aquasense-trace] 分析记录已写入: ${this.record.id} (${this.record.pool}, ` +
        `${this.record.span_analyze?.cls ?? 'n/a'}, ${(this.record.total_duration_ms / 1000).toFixed(1)}s)`
    )
    return this.record.id
  }
}
