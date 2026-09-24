/**
 * R8 H5 拍照汇报页服务端(见 docs/r8-traceability-architecture.md §3.5、S9 §5.3-5.4)
 *
 * 路由(挂在 remind-gateway 的 /aquasense-remind/api 前缀下,由其分流):
 *  - POST /aquasense-remind/api/report/submit   → multipart 表单 → 创建 job 立即返回 { job_id }
 *  - GET  /aquasense-remind/api/report/progress → ?job_id= → job 快照(进度/结果,前端轮询)
 *  - GET  /aquasense-remind/report?task=&time=&chat_id= → H5 页面 HTML(installReportWeb 注册)
 *
 * 管线(5 Span 埋点,进度 20/40/60/80/100):
 *  upload → analyze → retrieve/advice(仅 early/disease)→ ledger → flush
 *  - 进度反馈:轮询而非 SSE(飞书内置浏览器 + 反向代理场景更稳,见架构文档 §3.5)
 *  - trace 埋点失败不影响主流程(§8):记录写入为尽力而为,分析结果照常返回
 *  - 终态(job.status)在 flush 之后才置位,保证前端跳详情页时记录文件已可读
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { HttpError, type ApiEnvelope } from './remind-gateway.js'
import { formatPoolIds, getPoolIds, getValidPoolIds } from '../config/aqua-settings.js'
import { AnalysisTracer, MAX_OUTPUT_RAW, type TracerParams } from './trace-recorder.js'
import { pushAbnormalAlert } from '../scheduler/s9-reminder.js'
import { decideNextSteps } from '../policy/analysis-policy.js'
import {
  buildPrompt,
  callVisionModelWithUsage,
  parseAnalysisResponse,
  type AnalysisResult,
  type ImageDownloadResult,
  type VisionModelResult
} from '../tools/analyze-image.js'
import {
  generateAdviceInternal,
  retrieveKnowledge,
  type AdviceResult,
  type AnalysisInput,
  type KnowledgeRetrieval
} from '../tools/generate-advice.js'
import { recordLedger } from '../tools/record-ledger.js'
import type { SearchResult } from '../ima/ima-api.js'
import { countChannel } from '../ima/ima-api.js'
import { saveReportImages } from './trace-store.js'

// ========== 常量 ==========

/** H5 提交/进度接口路径(remind-gateway 分流用) */
export const REPORT_SUBMIT_PATH = '/aquasense-remind/api/report/submit'
export const REPORT_PROGRESS_PATH = '/aquasense-remind/api/report/progress'

/** H5 页面路由前缀(卡片 B「📷 拍照汇报」按钮 URL) */
export const REPORT_PAGE_PREFIX = '/aquasense-remind/report'

/** 单次最多图片数(与前端校验一致) */
const MAX_IMAGES = 9
/** 单张图片字节上限 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** 请求体上限(9×10MB + multipart 开销) */
const MAX_BODY_BYTES = MAX_IMAGES * MAX_IMAGE_BYTES + 1024 * 1024
/** 允许的图片 MIME(飞书内嵌浏览器相机输出 JPEG;相册可能 PNG/WebP) */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
/** 文字字段长度上限 */
const MAX_DESCRIPTION_LENGTH = 500
const MAX_TASK_LENGTH = 200
const MAX_TIME_LENGTH = 16
const MAX_CHAT_ID_LENGTH = 128
const MAX_REPORTER_LENGTH = 32
/** job 保留时长(前端轮询超时后自然过期) */
const JOB_TTL_MS = 30 * 60 * 1000
/** job 表容量上限(超出时淘汰最早创建的) */
const MAX_JOBS = 100
/** advice span 推理预览截断长度 */
const REASONING_PREVIEW_LENGTH = 200

/** 状态中文名(进度文案) */
const CLS_NAME: Record<string, string> = { normal: '正常', early: '前兆', disease: '发病', unknown: '未知' }

/** 巡检表中文名(详情页展示 target_table) */
const INSPECTION_TABLE_NAME = '巡检记录表'

// ========== 类型 ==========

/** H5 表单解析后的图片(服务端已转 base64) */
export interface ReportImage {
  name: string
  mimeType: string
  /** 服务端收到的字节数(前端已压缩) */
  size: number
  base64: string
  /** data URL(传给 record-ledger 作为「图片」列来源,由其上传飞书) */
  dataUrl: string
}

/** H5 表单校验后的输入 */
export interface ReportFormInput {
  pool: string
  reporter: string
  description: string
  images: ReportImage[]
  task?: string
  time?: string
  chat_id?: string
}

/** 进度快照(轮询响应) */
export interface ReportJobView {
  status: 'running' | 'done' | 'error'
  /** 0-100 */
  progress: number
  /** 当前步骤文案 */
  step: string
  record_id?: string
  pool: string
  cls?: string
  confidence?: number
  symptoms?: string[]
  message?: string
}

/** 内部 job 记录 */
export interface ReportJob extends ReportJobView {
  id: string
  createdAt: number
}

/** 管线依赖(注入以便独立测试;缺省用真实实现) */
export interface ReportPipelineDeps {
  callVision(images: ImageDownloadResult[], prompt: string): Promise<VisionModelResult>
  parseAnalysis(raw: string): AnalysisResult
  buildPrompt(poolId?: string): string
  retrieve(analysis: AnalysisInput): Promise<KnowledgeRetrieval>
  advise(analysis: AnalysisInput, knowledge: SearchResult | null, excerpts: KnowledgeRetrieval['excerpts']): Promise<AdviceResult>
  writeLedger(args: Record<string, unknown>): Promise<unknown>
  pushAlert(payload: { pool_id: string; cls: 'early' | 'disease'; symptoms: string[]; severity: string }): void
  createTracer(params: TracerParams): AnalysisTracer
}

/** webServer 服务最小鸭子类型(仅用到 register) */
interface WebServerLike {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
  }): () => void
}

/** 携带宿主可选服务的 Context(本地未安装对应类型包,按需访问) */
type ContextWithServices = Context & {
  webServer?: WebServerLike
}

/** 台账工具 exec 参数桩:H5 管线无 Agent 会话上下文,recordLedger 实现不使用 exec */
const LEDGER_STUB_EXEC = {} as unknown as ToolRunContext

// ========== 表单解析 ==========

/** 读取请求体的最大字节数(超限 413) */
export async function parseReportForm(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<FormData> {
  const contentType = String(req.headers['content-type'] ?? '')
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'content-type-not-supported', '请求体需为 multipart/form-data')
  }

  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.length
    if (bytes > maxBytes) {
      throw new HttpError(413, 'payload-too-large', `请求体超过 ${Math.round(maxBytes / 1048576)}MB 上限`)
    }
    chunks.push(buffer)
  }
  if (bytes === 0) {
    throw new HttpError(400, 'empty-body', '请求体为空')
  }

  try {
    // Node 22 全局 Request/FormData(undici)解析 multipart,免手写 boundary 解析器
    const request = new Request('http://dsh.internal/report', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: Buffer.concat(chunks)
    })
    return await request.formData()
  } catch (error) {
    throw new HttpError(400, 'invalid-multipart', `表单解析失败: ${messageOf(error)}`)
  }
}

/** 表单里的文件对象(Node File 或测试桩) */
interface FileLike {
  name?: string
  type?: string
  size?: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/** 结构判定文件对象(兼容测试桩,不依赖 File 全局) */
function isFileLike(value: unknown): value is FileLike {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
}

/** 取表单文本字段(空串归一为 undefined) */
function textField(form: FormData, name: string): string | undefined {
  const raw = form.get(name)
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 校验并归一化 H5 提交表单(导出供测试)。
 * 校验:池号白名单、上报人必填、图片 1-9 张且格式/大小合法。
 */
export async function validateReportForm(form: FormData): Promise<ReportFormInput> {
  const pool = textField(form, 'pool_id') ?? ''
  // 池号白名单:设置页「AquaSense 设置」配置的枚举,每次提交取最新
  if (!getValidPoolIds().has(pool)) {
    throw new HttpError(400, 'invalid-pool', `池号必须为${formatPoolIds()},收到「${pool || '(空)'}」`)
  }

  const reporter = textField(form, 'reporter') ?? ''
  if (!reporter) {
    throw new HttpError(400, 'missing-reporter', '请填写上报人姓名(将记入台账)')
  }
  if (reporter.length > MAX_REPORTER_LENGTH) {
    throw new HttpError(400, 'invalid-reporter', `上报人姓名不能超过 ${MAX_REPORTER_LENGTH} 字`)
  }

  const description = (textField(form, 'description') ?? '')
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(400, 'invalid-description', `描述不能超过 ${MAX_DESCRIPTION_LENGTH} 字`)
  }

  const task = textField(form, 'task')
  if (task && task.length > MAX_TASK_LENGTH) {
    throw new HttpError(400, 'invalid-task', `任务描述不能超过 ${MAX_TASK_LENGTH} 字`)
  }
  const time = textField(form, 'time')
  if (time && time.length > MAX_TIME_LENGTH) {
    throw new HttpError(400, 'invalid-time', '任务时间格式非法')
  }
  const chatId = textField(form, 'chat_id')
  if (chatId && chatId.length > MAX_CHAT_ID_LENGTH) {
    throw new HttpError(400, 'invalid-chat-id', '群 ID 长度非法')
  }

  const files: FileLike[] = []
  for (const value of form.getAll('images')) {
    if (isFileLike(value)) files.push(value)
  }
  if (files.length === 0) {
    throw new HttpError(400, 'missing-images', '请至少拍摄或选择 1 张照片')
  }
  if (files.length > MAX_IMAGES) {
    throw new HttpError(400, 'too-many-images', `最多上传 ${MAX_IMAGES} 张照片,当前 ${files.length} 张`)
  }

  const images: ReportImage[] = []
  for (const file of files) {
    const index = images.length + 1
    const mimeType = (file.type ?? '').toLowerCase()
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new HttpError(400, 'invalid-image-type', `第 ${index} 张图片格式不支持(${mimeType || '未知'}),仅支持 JPEG/PNG/WebP`)
    }
    const size = typeof file.size === 'number' ? file.size : 0
    if (size <= 0) {
      throw new HttpError(400, 'empty-image', `第 ${index} 张图片内容为空`)
    }
    if (size > MAX_IMAGE_BYTES) {
      throw new HttpError(400, 'image-too-large', `第 ${index} 张图片超过 10MB 上限(${(size / 1048576).toFixed(1)}MB)`)
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength === 0) {
      throw new HttpError(400, 'empty-image', `第 ${index} 张图片内容为空`)
    }
    const base64 = buffer.toString('base64')
    images.push({
      name: file.name || `image_${index}.jpg`,
      mimeType,
      size: buffer.byteLength,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`
    })
  }

  return { pool, reporter, description, images, task, time, chat_id: chatId }
}

// ========== job 表(内存,30 分钟 TTL) ==========

const jobs = new Map<string, ReportJob>()

/** 创建一次 H5 提交任务(导出供测试直接构造) */
export function createReportJob(): ReportJob {
  return {
    id: `job-${randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    status: 'running',
    progress: 0,
    step: '排队中',
    pool: ''
  }
}

/** 清理过期/超量 job */
function cleanupJobs(now = Date.now()): void {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id)
  }
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)
    for (let i = 0; i < sorted.length - MAX_JOBS; i++) jobs.delete(sorted[i].id)
  }
}

/** 读取 job(不存在返回 null) */
export function getJob(id: string): ReportJob | null {
  cleanupJobs()
  return jobs.get(id) ?? null
}

/** 清空 job 表(仅供测试) */
export function resetReportJobs(): void {
  jobs.clear()
}

/** job → 响应视图(隐藏内部字段) */
export function jobView(job: ReportJob): ReportJobView {
  return {
    status: job.status,
    progress: job.progress,
    step: job.step,
    record_id: job.record_id,
    pool: job.pool,
    cls: job.cls,
    confidence: job.confidence,
    symptoms: job.symptoms,
    message: job.message
  }
}

/** 更新进度(仅前进,不回退) */
function setProgress(job: ReportJob, progress: number, step: string): void {
  job.progress = Math.max(job.progress, progress)
  job.step = step
}

// ========== 管线执行 ==========

/** 默认依赖(真实实现) */
function defaultPipelineDeps(): ReportPipelineDeps {
  return {
    callVision: callVisionModelWithUsage,
    parseAnalysis: parseAnalysisResponse,
    buildPrompt,
    retrieve: retrieveKnowledge,
    advise: generateAdviceInternal,
    writeLedger: (args) => recordLedger.execute(args, LEDGER_STUB_EXEC),
    pushAlert: (payload) => {
      void pushAbnormalAlert({
        poolId: payload.pool_id,
        cls: payload.cls,
        symptoms: payload.symptoms,
        severity: payload.severity as 'low' | 'medium' | 'high' | 'critical'
      })
    },
    createTracer: (params) => new AnalysisTracer(params)
  }
}

/** 台账返回值裁剪 */
interface LedgerOutcome {
  success: boolean
  message: string
  record_id?: string
}

function pickLedgerOutcome(result: unknown): LedgerOutcome {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    return {
      success: r.success === true,
      message: typeof r.message === 'string' ? r.message : '',
      record_id: typeof r.record_id === 'string' ? r.record_id : undefined
    }
  }
  return { success: false, message: '台账工具返回结果非法' }
}

/**
 * 启动一次 H5 提交处理:创建 job → 异步跑管线 → 立即返回 job。
 * 管线在首次 await 前同步执行到 record_id 生成,故返回时 job.record_id 已可读。
 */
export function startReportJob(
  input: ReportFormInput,
  uploadDurationMs: number,
  deps?: Partial<ReportPipelineDeps>
): ReportJob {
  cleanupJobs()
  const job = createReportJob()
  job.pool = input.pool
  void runReportPipeline(job, input, uploadDurationMs, deps).catch((error) => {
    // runReportPipeline 内部已兜底,此处仅防御极端异常(tracer 构造等)
    job.status = 'error'
    job.message = messageOf(error)
  })
  jobs.set(job.id, job)
  return job
}

/**
 * 执行 H5 分析管线(导出供测试直接 await):
 * upload → analyze → retrieve/advice(仅 early/disease)→ ledger → flush。
 * 终态在 flush 后置位,保证前端跳详情页时记录文件已可读。
 */
export async function runReportPipeline(
  job: ReportJob,
  input: ReportFormInput,
  uploadDurationMs: number,
  depsOverride: Partial<ReportPipelineDeps> = {}
): Promise<void> {
  const deps: ReportPipelineDeps = { ...defaultPipelineDeps(), ...depsOverride }
  const tracer = deps.createTracer({
    pool: input.pool,
    reporter: input.reporter,
    reporter_open_id: '',
    source: 'h5_upload',
    task: input.task,
    chat_id: input.chat_id
  })
  job.record_id = tracer.id
  job.pool = input.pool

  console.log(
    `[aquasense-trace] H5 汇报开始: ${tracer.id} (${input.pool}, ${input.reporter}, ${input.images.length} 张)`,
    input.description ? `描述:${input.description.slice(0, 200)}` : ''
  )

  let finalStatus: 'done' | 'error' = 'done'
  let finalMessage: string | undefined

  try {
    // ── Span 1: upload(表单已在 HTTP 层接收并转 base64,此处仅落数据)
    tracer.recordSpan(
      'upload',
      {
        image_count: input.images.length,
        image_names: input.images.map((img) => img.name),
        image_sizes: input.images.map((img) => img.size)
      },
      uploadDurationMs
    )
    // 图片落盘供分析记录详情页展示;失败不阻断管线(仅告警)
    try {
      await saveReportImages(tracer.id, input.images.map((img) => ({ data: img.base64, mimeType: img.mimeType })))
    } catch (error) {
      console.warn('[aquasense-trace] H5 图片落盘失败(详情页将无图):', messageOf(error))
    }
    setProgress(job, 20, '图片接收完成')

    // ── Span 2: analyze(视觉模型;管线必经步骤)
    const visionImages: ImageDownloadResult[] = input.images.map((img) => ({ data: img.base64, mimeType: img.mimeType }))
    const prompt = deps.buildPrompt(input.pool)
    tracer.startSpan('analyze')
    let analysis: AnalysisResult
    try {
      const { content, usage } = await deps.callVision(visionImages, prompt)
      analysis = deps.parseAnalysis(content)
      analysis.image_count = input.images.length
      analysis.data_completeness = 'complete'
      tracer.endSpan('analyze', {
        prompt_length: prompt.length,
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
        output_raw: content.slice(0, MAX_OUTPUT_RAW),
        cls: analysis.cls,
        symptoms: analysis.symptoms,
        severity: analysis.severity,
        confidence: analysis.confidence,
        scene_hint: analysis.scene_hint,
        organs: analysis.organs,
        data_completeness: analysis.data_completeness,
        expected_image_count: input.images.length
      })
    } catch (error) {
      // 分析失败:记录 span 错误后中断管线(仍 flush,保证失败可追溯)
      tracer.endSpan('analyze', {
        prompt_length: prompt.length,
        input_tokens: 0,
        output_tokens: 0,
        output_raw: '',
        cls: 'unknown',
        symptoms: [],
        severity: 'low',
        confidence: 0,
        scene_hint: 'inspection',
        error: messageOf(error)
      })
      throw error
    }
    job.cls = analysis.cls
    job.confidence = analysis.confidence
    job.symptoms = analysis.symptoms
    setProgress(job, 40, `AI 视觉分析完成(${CLS_NAME[analysis.cls] ?? analysis.cls})`)

    // 异常预警(卡片 C,与群聊主链路一致;失败不阻断)
    const nextSteps = decideNextSteps(analysis)
    if (nextSteps.pushAlert) {
      try {
        deps.pushAlert({
          pool_id: input.pool,
          cls: analysis.cls as 'early' | 'disease',
          symptoms: analysis.symptoms,
          severity: analysis.severity
        })
      } catch (error) {
        console.warn('[aquasense-trace] 异常预警推送失败:', messageOf(error))
      }
    }

    // ── Span 3 + 4: retrieve + advice(仅 early/disease)
    let advice: AdviceResult | null = null
    if (nextSteps.retrieve) {
      tracer.startSpan('retrieve')
      const retrieval = await deps.retrieve(analysis)
      tracer.endSpan('retrieve', {
        query: retrieval.query,
        channel_a_wiki: countChannel(retrieval.knowledge, 'wiki'),
        channel_b_note: countChannel(retrieval.knowledge, 'note'),
        channel_c_pdf: countChannel(retrieval.knowledge, 'pdf_content'),
        merged_count: retrieval.knowledge?.items.length ?? 0,
        excerpts: retrieval.excerpts.map((e) => ({
          title: e.title,
          from: e.from,
          locator: e.locator,
          excerpt_preview: e.text
        }))
      })
      setProgress(job, 60, '知识库检索完成')

      tracer.startSpan('advice')
      advice = await deps.advise(analysis, retrieval.knowledge, retrieval.excerpts)
      tracer.endSpan('advice', {
        input_cls: analysis.cls,
        alert_level: advice.alert_level,
        knowledge_refs_count: advice.knowledge_refs.length,
        diagnosis_summary: advice.diagnosis_summary,
        reasoning_preview: advice.reasoning.slice(0, REASONING_PREVIEW_LENGTH)
      })
      setProgress(job, 80, '处置建议生成完成')
    } else {
      setProgress(job, 80, analysis.cls === 'normal' ? '状态正常,无需知识库检索' : '状态未知,跳过知识库检索')
    }

    // ── Span 5: ledger(图片以 data URL 传入,由 record-ledger 上传飞书)
    tracer.startSpan('ledger')
    const ledgerArgs: Record<string, unknown> = {
      scene: 'inspection',
      pool_id: input.pool,
      images: input.images.map((img) => img.dataUrl),
      analysis,
      reporter: input.reporter,
      open_id: ''
    }
    if (advice) ledgerArgs.advice = advice
    const ledger = pickLedgerOutcome(await deps.writeLedger(ledgerArgs))
    tracer.endSpan('ledger', {
      target_table: INSPECTION_TABLE_NAME,
      operation: ledger.message.includes('已更新') ? 'update' : 'create',
      record_id: ledger.record_id,
      success: ledger.success,
      message: ledger.message
    })
    finalMessage = ledger.message
    if (!ledger.success) {
      finalStatus = 'error'
      tracer.setTraceMeta({ status: 'error', error: ledger.message })
    }
    setProgress(job, 100, ledger.success ? '台账写入完成' : '台账写入失败')
  } catch (error) {
    finalStatus = 'error'
    finalMessage = messageOf(error)
    tracer.setTraceMeta({ status: 'error', error: finalMessage })
    console.error(`[aquasense-trace] H5 汇报管线失败(${job.record_id}):`, finalMessage)
  }

  // 落盘必须在 job 终态前完成:前端看到 done 后跳详情页时 RPT-*.json 需已可读
  try {
    await tracer.flush()
  } catch (error) {
    console.warn(`[aquasense-trace] H5 汇报 trace 写入失败(${job.record_id}):`, messageOf(error))
  }

  job.status = finalStatus
  job.message = finalMessage
  console.log(`[aquasense-trace] H5 汇报 trace: ${job.record_id}, status=${finalStatus}, progress=${job.progress}`)
}

// ========== HTTP 层 ==========

/**
 * H5 提交/进度接口请求处理(由 remind-gateway 在 /aquasense-remind/api 前缀下分流)。
 * 提交=POST multipart(立即返回 202 + job_id);进度=GET 轮询。
 */
export async function handleReportHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps?: Partial<ReportPipelineDeps>
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')

    // 同源校验(带 Origin 时要求与 Host 一致;无 Origin 放行,与 remind-gateway 一致)
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin) {
      let originHost: string
      try {
        originHost = new URL(origin).host
      } catch {
        writeEnvelope(res, 400, fail(400, 'invalid-origin', 'Origin 头非法').body)
        return
      }
      const reqHost = req.headers.host
      if (typeof reqHost === 'string' && reqHost && originHost !== reqHost) {
        writeEnvelope(res, 403, fail(403, 'origin-not-allowed', '仅允许同源请求').body)
        return
      }
    }

    if (url.pathname === REPORT_SUBMIT_PATH) {
      if ((req.method ?? '') !== 'POST') {
        writeEnvelope(res, 405, fail(405, 'method-not-allowed', '仅支持 POST').body)
        return
      }
      const startedAt = performance.now()
      const form = await parseReportForm(req)
      const input = await validateReportForm(form)
      const uploadMs = Math.round(performance.now() - startedAt)
      const job = startReportJob(input, uploadMs, deps)
      // 202:job 已受理,由 /progress 轮询结果
      writeEnvelope(res, 202, ok({ job_id: job.id, record_id: job.record_id, pool: job.pool }).body)
      return
    }

    if (url.pathname === REPORT_PROGRESS_PATH) {
      if ((req.method ?? '') !== 'GET') {
        writeEnvelope(res, 405, fail(405, 'method-not-allowed', '仅支持 GET').body)
        return
      }
      const jobId = url.searchParams.get('job_id') ?? ''
      const job = jobId ? getJob(jobId) : null
      if (!job) {
        writeEnvelope(res, 404, fail(404, 'job-not-found', '任务不存在或已过期,请重新提交').body)
        return
      }
      writeEnvelope(res, 200, ok(jobView(job)).body)
      return
    }

    writeEnvelope(res, 404, fail(404, 'not-found', `未知路径: ${url.pathname}`).body)
  } catch (error) {
    if (error instanceof HttpError) {
      writeEnvelope(res, error.status, fail(error.status, error.code, error.message).body)
      return
    }
    writeEnvelope(res, 500, fail(500, 'internal', messageOf(error)).body)
  }
}

/** 默认页面读取器(tsc 产物 dist/web/ 与源码 src/web/ 同构) */
export async function readReportPage(): Promise<string> {
  return readFile(new URL('./report-upload.html', import.meta.url), 'utf-8')
}

/** 处理 H5 页面请求(仅 GET;文件缺失时降级提示) */
export async function handleReportPage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if ((req.method ?? '') !== 'GET') {
      writeEnvelope(res, 405, fail(405, 'method-not-allowed', '仅支持 GET').body)
      return
    }
    let html: string
    try {
      html = await readReportPage()
      // 池号枚举按设置页「AquaSense 设置」配置注入(占位符替换;JSON 即 JS 字面量)
      html = html.replace('__AQUA_POOLS__', JSON.stringify(getPoolIds()))
    } catch (error) {
      console.error('[aquasense-trace] H5 页面读取失败:', messageOf(error))
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><p>页面资源缺失,请重新构建插件(npm run build)。</p>')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // 不缓存:插件升级后页面即时生效(飞书内置浏览器缓存较激进)
      'cache-control': 'no-cache'
    })
    res.end(html)
  } catch (error) {
    writeEnvelope(res, 500, fail(500, 'internal', messageOf(error)).body)
  }
}

/** 写回 JSON 信封 */
function writeEnvelope(res: ServerResponse, status: number, body: ApiEnvelope): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 构造成功结果 */
function ok(value: unknown): { status: number; body: ApiEnvelope } {
  return { status: 200, body: { ok: true, value } }
}

/** 构造失败结果 */
function fail(status: number, code: string, message: string): { status: number; body: ApiEnvelope } {
  return { status, body: { ok: false, error: { code, message } } }
}

/** 错误信息提取 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ========== 插件接线 ==========

/**
 * 安装 R8 H5 拍照汇报页:页面路由。
 * 提交/进度接口由 remind-gateway 的 /aquasense-remind/api 前缀分流到 handleReportHttp;
 * webServer 缺失时静默跳过(与 remind/trace 网关一致)。
 */
export function installReportWeb(ctx: Context): void {
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const webServer = (sctx as ContextWithServices).webServer
      if (!webServer || typeof webServer.register !== 'function') {
        console.warn('[aquasense-trace] webServer 不存在,跳过 H5 汇报页注册')
        return () => {}
      }
      const dispose = webServer.register({
        kind: 'prefix',
        path: REPORT_PAGE_PREFIX,
        handler: handleReportPage
      })
      console.log('[aquasense-trace] R8 H5 拍照汇报页已注册')
      return dispose
    }, 'aquasense: R8 H5 拍照汇报页')
  })
}
