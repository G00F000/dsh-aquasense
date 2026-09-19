/**
 * R8 H5 拍照汇报页服务端(report-handler)单元测试
 *
 * 测试重点:
 *  - parseReportForm:multipart 解析与协议错误(415/413/400)
 *  - validateReportForm:字段/图片校验(池号/上报人/张数/格式/大小)
 *  - runReportPipeline:5 Span 埋点、进度序列、normal 分支、失败终态(仍落盘)
 *  - handleReportHttp / handleReportPage:协议层与 job 轮询
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createReportJob,
  getJob,
  handleReportHttp,
  handleReportPage,
  jobView,
  parseReportForm,
  readReportPage,
  resetReportJobs,
  runReportPipeline,
  startReportJob,
  validateReportForm,
  REPORT_PROGRESS_PATH,
  REPORT_SUBMIT_PATH,
  type ReportFormInput,
  type ReportJobView,
  type ReportPipelineDeps
} from './report-handler.js'
import { AnalysisTracer } from './trace-recorder.js'
import { listReportImages, readReport } from './trace-store.js'
import type { AnalysisResult } from '../tools/analyze-image.js'
import type { AdviceResult, KnowledgeRetrieval } from '../tools/generate-advice.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquasense-report-'))
  process.env.AQUASENSE_CACHE_DIR = tmpDir
  resetReportJobs()
})

afterEach(async () => {
  delete process.env.AQUASENSE_CACHE_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const JPEG_BYTES = 'fake-jpeg-bytes'

/** 构造 multipart 表单(与浏览器提交结构一致) */
function makeForm(fields: Record<string, string>, files: Array<{ name: string; type: string; content: string }>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  for (const file of files) form.append('images', new File([file.content], file.name, { type: file.type }))
  return form
}

/** 单张合法 JPEG 文件 */
const jpegFile = (name = 'a.jpg'): File => new File([JPEG_BYTES], name, { type: 'image/jpeg' })

/** 校验后的表单输入(默认 1 张图) */
function makeInput(overrides: Partial<ReportFormInput> = {}): ReportFormInput {
  const base64 = Buffer.from(JPEG_BYTES).toString('base64')
  return {
    pool: '池1',
    reporter: '张三',
    description: '',
    images: [
      {
        name: 'a.jpg',
        mimeType: 'image/jpeg',
        size: Buffer.byteLength(JPEG_BYTES),
        base64,
        dataUrl: `data:image/jpeg;base64,${base64}`
      }
    ],
    ...overrides
  }
}

const ANALYSIS_EARLY: AnalysisResult = {
  abnormal: true,
  cls: 'early',
  symptoms: ['浮头'],
  severity: 'medium',
  confidence: 0.86,
  scene_hint: 'inspection'
}

const ANALYSIS_NORMAL: AnalysisResult = {
  abnormal: false,
  cls: 'normal',
  symptoms: [],
  severity: 'low',
  confidence: 0.95,
  scene_hint: 'inspection'
}

const ADVICE: AdviceResult = {
  diagnosis_summary: '疑似缺氧前兆',
  immediate_actions: ['立即开启增氧机'],
  follow_up_actions: ['2 小时后复拍确认'],
  medication: '暂不用药',
  alert_level: 'P1',
  knowledge_refs: ['wiki:水质管理'],
  knowledge_excerpt: ['《水质管理》「缺氧时应立即增氧」'],
  reasoning: '浮头症状常见于溶氧不足'
}

const RETRIEVAL: KnowledgeRetrieval = {
  query: '浮头 缺氧',
  knowledge: {
    items: [
      { media_id: 'm1', title: '水质管理', from: 'wiki' },
      { media_id: 'm2', title: '溶氧速测笔记', from: 'note' }
    ],
    total: 2
  },
  excerpts: [{ title: '水质管理', text: '缺氧时应立即增氧', from: 'wiki' }]
}

/** 全套假依赖;tracer 用真实实现以便校验落盘 */
function makeDeps(overrides: Partial<ReportPipelineDeps> = {}): ReportPipelineDeps {
  return {
    callVision: async () => ({
      content: '{"cls":"early"}',
      usage: { prompt_tokens: 1000, completion_tokens: 120, total_tokens: 1120 }
    }),
    parseAnalysis: () => ({ ...ANALYSIS_EARLY, symptoms: [...ANALYSIS_EARLY.symptoms] }),
    buildPrompt: () => 'prompt',
    retrieve: async () => RETRIEVAL,
    advise: async () => ADVICE,
    writeLedger: async () => ({ success: true, message: '已新增巡检记录', record_id: 'rec_1' }),
    pushAlert: vi.fn(),
    createTracer: (params) => new AnalysisTracer(params),
    ...overrides
  }
}

/** 构造最小 IncomingMessage mock(含请求体异步迭代) */
function mockRequest(options: { method?: string; url?: string; headers?: Record<string, string>; body?: Buffer } = {}): IncomingMessage {
  const chunks = options.body ? [options.body] : []
  return {
    method: options.method ?? 'POST',
    url: options.url ?? REPORT_SUBMIT_PATH,
    headers: options.headers ?? {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  } as unknown as IncomingMessage
}

/** 响应 mock 的可读字段面 */
interface MockResponseFields {
  status: number
  body: string
  headers: Record<string, string>
  writeHead(status: number, headers?: Record<string, string>): void
  end(body: string): void
}

/** 构造最小 ServerResponse mock */
function mockResponse(): ServerResponse & MockResponseFields {
  const res: MockResponseFields = {
    status: 0,
    body: '',
    headers: {},
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? {}
    },
    end(body) {
      res.body = body
    }
  }
  return res as unknown as ServerResponse & MockResponseFields
}

/** multipart 请求体(经 Request/formData 生成,与浏览器一致) */
async function makeMultipart(
  fields: Record<string, string>,
  files: Array<{ name: string; type: string; content: string }>
): Promise<{ body: Buffer; contentType: string }> {
  const request = new Request('http://dsh.internal/report', { method: 'POST', body: makeForm(fields, files) })
  return {
    body: Buffer.from(await request.arrayBuffer()),
    contentType: request.headers.get('content-type') ?? ''
  }
}

describe('parseReportForm', () => {
  it('非 multipart → 415;空体 → 400;超限 → 413', async () => {
    await expect(
      parseReportForm(mockRequest({ headers: { 'content-type': 'application/json' } }), 1024)
    ).rejects.toMatchObject({ status: 415, code: 'content-type-not-supported' })

    await expect(
      parseReportForm(mockRequest({ headers: { 'content-type': 'multipart/form-data; boundary=x' } }), 1024)
    ).rejects.toMatchObject({ status: 400, code: 'empty-body' })

    await expect(
      parseReportForm(
        mockRequest({ headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.alloc(2048) }),
        1024
      )
    ).rejects.toMatchObject({ status: 413, code: 'payload-too-large' })
  })

  it('multipart 解析失败 → 400 invalid-multipart', async () => {
    await expect(
      parseReportForm(
        mockRequest({ headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.from('garbage') })
      )
    ).rejects.toMatchObject({ status: 400, code: 'invalid-multipart' })
  })
})

describe('validateReportForm', () => {
  it('合法表单归一化:trim + base64/dataUrl 生成', async () => {
    const input = await validateReportForm(
      makeForm(
        { pool_id: '池1', reporter: ' 张三 ', description: ' 水面有少量浮头 ', task: '投喂并拍照', time: '08:00', chat_id: 'oc_1' },
        [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]
      )
    )
    expect(input.pool).toBe('池1')
    expect(input.reporter).toBe('张三')
    expect(input.description).toBe('水面有少量浮头')
    expect(input.task).toBe('投喂并拍照')
    expect(input.time).toBe('08:00')
    expect(input.chat_id).toBe('oc_1')
    expect(input.images).toHaveLength(1)
    expect(input.images[0].mimeType).toBe('image/jpeg')
    expect(input.images[0].size).toBe(Buffer.byteLength(JPEG_BYTES))
    expect(input.images[0].dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG_BYTES).toString('base64')}`)
  })

  it('池号非法/缺失 → 400 invalid-pool', async () => {
    for (const pool of ['', '池9', 'pool1']) {
      await expect(validateReportForm(makeForm({ pool_id: pool, reporter: '张三' }, [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]))).rejects.toMatchObject(
        { status: 400, code: 'invalid-pool' }
      )
    }
  })

  it('上报人缺失/超长 → 400', async () => {
    await expect(validateReportForm(makeForm({ pool_id: '池1' }, [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]))).rejects.toMatchObject(
      { status: 400, code: 'missing-reporter' }
    )
    await expect(
      validateReportForm(makeForm({ pool_id: '池1', reporter: 'x'.repeat(33) }, [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]))
    ).rejects.toMatchObject({ status: 400, code: 'invalid-reporter' })
  })

  it('描述/任务/时间/群ID 超长 → 400', async () => {
    const base = { pool_id: '池1', reporter: '张三' }
    await expect(
      validateReportForm(makeForm({ ...base, description: 'x'.repeat(501) }, [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]))
    ).rejects.toMatchObject({ code: 'invalid-description' })
    await expect(
      validateReportForm(makeForm({ ...base, task: 'x'.repeat(201) }, [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]))
    ).rejects.toMatchObject({ code: 'invalid-task' })
    await expect(
      validateReportForm(makeForm({ ...base, time: 'x'.repeat(17) }, [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]))
    ).rejects.toMatchObject({ code: 'invalid-time' })
    await expect(
      validateReportForm(makeForm({ ...base, chat_id: 'x'.repeat(129) }, [{ name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }]))
    ).rejects.toMatchObject({ code: 'invalid-chat-id' })
  })

  it('图片缺失/超量/格式不支持 → 400', async () => {
    await expect(validateReportForm(makeForm({ pool_id: '池1', reporter: '张三' }, []))).rejects.toMatchObject({
      status: 400,
      code: 'missing-images'
    })

    const tenFiles = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}.jpg`, type: 'image/jpeg', content: JPEG_BYTES }))
    await expect(validateReportForm(makeForm({ pool_id: '池1', reporter: '张三' }, tenFiles))).rejects.toMatchObject({
      code: 'too-many-images'
    })

    const form = new FormData()
    form.append('pool_id', '池1')
    form.append('reporter', '张三')
    form.append('images', new File([JPEG_BYTES], 'a.gif', { type: 'image/gif' }))
    await expect(validateReportForm(form)).rejects.toMatchObject({ status: 400, code: 'invalid-image-type' })
  })

  it('图片为空/超 10MB → 400', async () => {
    const emptyForm = new FormData()
    emptyForm.append('pool_id', '池1')
    emptyForm.append('reporter', '张三')
    emptyForm.append('images', new File([], 'empty.jpg', { type: 'image/jpeg' }))
    await expect(validateReportForm(emptyForm)).rejects.toMatchObject({ status: 400, code: 'empty-image' })

    const bigForm = new FormData()
    bigForm.append('pool_id', '池1')
    bigForm.append('reporter', '张三')
    bigForm.append('images', new File(['x'.repeat(10 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }))
    await expect(validateReportForm(bigForm)).rejects.toMatchObject({ status: 400, code: 'image-too-large' })
  })
})

describe('runReportPipeline', () => {
  it('early 全链路:5 Span、进度序列、预警推送、台账写入', async () => {
    const pushAlert = vi.fn()
    const progressAt: Record<string, number> = {}
    const job = createReportJob()
    const deps = makeDeps({
      pushAlert,
      retrieve: async (analysis) => {
        progressAt.retrieve = job.progress
        return RETRIEVAL
      },
      advise: async () => {
        progressAt.advise = job.progress
        return ADVICE
      },
      writeLedger: async () => {
        progressAt.ledger = job.progress
        return { success: true, message: '已更新巡检记录', record_id: 'rec_1' }
      }
    })

    await runReportPipeline(job, makeInput(), 30, deps)

    expect(job.status).toBe('done')
    expect(job.progress).toBe(100)
    expect(job.cls).toBe('early')
    expect(job.confidence).toBe(0.86)
    expect(job.symptoms).toEqual(['浮头'])
    expect(job.record_id).toMatch(/^RPT-/)
    expect(progressAt).toMatchObject({ retrieve: 40, advise: 60, ledger: 80 })

    // 异常预警与群聊主链路一致(early/disease)
    expect(pushAlert).toHaveBeenCalledWith({ pool_id: '池1', cls: 'early', symptoms: ['浮头'], severity: 'medium' })

    // 落盘记录:5 Span + Token 汇总 + 台账结果
    const record = await readReport(job.record_id!)
    expect(record).not.toBeNull()
    expect(record!.source).toBe('h5_upload')
    expect(record!.total_tokens).toBe(1120)
    expect(record!.span_upload).toMatchObject({ image_count: 1, image_names: ['a.jpg'], duration_ms: 30 })
    expect(record!.span_analyze).toMatchObject({ input_tokens: 1000, output_tokens: 120, cls: 'early' })
    expect(record!.span_retrieve).toMatchObject({
      query: '浮头 缺氧',
      channel_a_wiki: 1,
      channel_b_note: 1,
      channel_c_pdf: 0,
      merged_count: 2
    })
    expect(record!.span_advice).toMatchObject({ alert_level: 'P1', knowledge_refs_count: 1 })
    expect(record!.span_ledger).toMatchObject({
      target_table: '巡检记录表',
      operation: 'update',
      record_id: 'rec_1',
      success: true
    })
    expect(record!.status).toBe('success')

    // 工人发送的图片已落盘(详情页展示用)
    const images = await listReportImages(job.record_id!)
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ index: 0, mimeType: 'image/jpeg', size: Buffer.byteLength(JPEG_BYTES) })
  })

  it('normal 分支:跳过 retrieve/advice,不推预警,记录无对应 Span', async () => {
    const pushAlert = vi.fn()
    const retrieve = vi.fn(async () => RETRIEVAL)
    const advise = vi.fn(async () => ADVICE)
    const deps = makeDeps({ parseAnalysis: () => ({ ...ANALYSIS_NORMAL }), pushAlert, retrieve, advise })
    const job = createReportJob()

    await runReportPipeline(job, makeInput(), 20, deps)

    expect(retrieve).not.toHaveBeenCalled()
    expect(advise).not.toHaveBeenCalled()
    expect(pushAlert).not.toHaveBeenCalled()
    expect(job.status).toBe('done')
    expect(job.progress).toBe(100)

    const record = await readReport(job.record_id!)
    expect(record!.span_retrieve).toBeUndefined()
    expect(record!.span_advice).toBeUndefined()
    expect(record!.span_ledger).toMatchObject({ success: true })
  })

  it('台账写入失败 → status=error 且记录仍落盘(可追溯)', async () => {
    const deps = makeDeps({ writeLedger: async () => ({ success: false, message: '缺少池号,无法写入台账' }) })
    const job = createReportJob()

    await runReportPipeline(job, makeInput(), 10, deps)

    expect(job.status).toBe('error')
    expect(job.message).toBe('缺少池号,无法写入台账')

    const record = await readReport(job.record_id!)
    expect(record!.status).toBe('error')
    expect(record!.error).toBe('缺少池号,无法写入台账')
    expect(record!.span_ledger).toMatchObject({ success: false, message: '缺少池号,无法写入台账' })
  })

  it('视觉分析失败 → 中断管线,analyze Span 记录错误,仍落盘', async () => {
    const pushAlert = vi.fn()
    const deps = makeDeps({
      pushAlert,
      callVision: async () => {
        throw new Error('视觉模型超时')
      }
    })
    const job = createReportJob()

    await runReportPipeline(job, makeInput(), 10, deps)

    expect(job.status).toBe('error')
    expect(job.message).toBe('视觉模型超时')
    expect(pushAlert).not.toHaveBeenCalled()

    const record = await readReport(job.record_id!)
    expect(record!.status).toBe('error')
    expect(record!.error).toBe('视觉模型超时')
    expect(record!.span_analyze?.error).toBe('视觉模型超时')
    expect(record!.span_ledger).toBeUndefined()
  })
})

describe('startReportJob / jobView', () => {
  it('同步返回 job,record_id 在返回时已可读(供前端立即轮询)', async () => {
    const job = startReportJob(makeInput(), 15, makeDeps())

    expect(job.id).toMatch(/^job-/)
    expect(job.record_id).toMatch(/^RPT-/)
    expect(getJob(job.id)).toBe(job)

    // 等待管线终态
    for (let i = 0; i < 200 && job.status === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(job.status).toBe('done')
    expect(jobView(job).record_id).toBe(job.record_id)
  })

  it('jobView 隐藏内部字段(id/createdAt)', () => {
    const job = createReportJob()
    job.record_id = 'RPT-20260917-100532'
    const view: ReportJobView = jobView(job)
    expect(view.status).toBe('running')
    expect(view.progress).toBe(0)
    expect(view.step).toBe('排队中')
    expect(view.record_id).toBe('RPT-20260917-100532')
    expect('id' in view).toBe(false)
    expect('createdAt' in view).toBe(false)
  })
})

describe('handleReportHttp(协议层)', () => {
  it('submit 非 POST → 405;非 multipart → 415', async () => {
    const res405 = mockResponse()
    await handleReportHttp(mockRequest({ method: 'GET' }), res405)
    expect(res405.status).toBe(405)

    const res415 = mockResponse()
    await handleReportHttp(mockRequest({ headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') }), res415)
    expect(res415.status).toBe(415)
  })

  it('progress 非 GET → 405;job 不存在 → 404', async () => {
    const res405 = mockResponse()
    await handleReportHttp(mockRequest({ method: 'POST', url: REPORT_PROGRESS_PATH }), res405)
    expect(res405.status).toBe(405)

    const res404 = mockResponse()
    await handleReportHttp(mockRequest({ method: 'GET', url: `${REPORT_PROGRESS_PATH}?job_id=nope` }), res404)
    expect(res404.status).toBe(404)
    expect(JSON.parse(res404.body)).toMatchObject({ ok: false, error: { code: 'job-not-found' } })
  })

  it('跨域 Origin → 403;非法 Origin → 400;未知路径 → 404', async () => {
    const res403 = mockResponse()
    await handleReportHttp(mockRequest({ headers: { origin: 'https://evil.example', host: 'dsh.internal' } }), res403)
    expect(res403.status).toBe(403)

    const res400 = mockResponse()
    await handleReportHttp(mockRequest({ headers: { origin: 'oops' } }), res400)
    expect(res400.status).toBe(400)

    const res404 = mockResponse()
    await handleReportHttp(mockRequest({ url: '/aquasense-remind/api/report/other' }), res404)
    expect(res404.status).toBe(404)
  })

  it('表单校验失败(池号非法)→ 400 且不创建 job', async () => {
    const { body, contentType } = await makeMultipart({ pool_id: '池9', reporter: '张三' }, [
      { name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }
    ])
    const res = mockResponse()
    await handleReportHttp(mockRequest({ headers: { 'content-type': contentType }, body }), res)
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: { code: 'invalid-pool' } })
  })

  it('submit 合法表单 → 202(job_id/record_id);progress 轮询至 done', async () => {
    const { body, contentType } = await makeMultipart({ pool_id: '池1', reporter: '张三' }, [
      { name: 'a.jpg', type: 'image/jpeg', content: JPEG_BYTES }
    ])

    const res = mockResponse()
    await handleReportHttp(mockRequest({ headers: { 'content-type': contentType }, body }), res, makeDeps())
    expect(res.status).toBe(202)
    const value = JSON.parse(res.body).value as { job_id: string; record_id: string; pool: string }
    expect(value.job_id).toMatch(/^job-/)
    expect(value.record_id).toMatch(/^RPT-/)
    expect(value.pool).toBe('池1')

    let view: ReportJobView | null = null
    for (let i = 0; i < 200; i++) {
      const polled = mockResponse()
      await handleReportHttp(mockRequest({ method: 'GET', url: `${REPORT_PROGRESS_PATH}?job_id=${value.job_id}` }), polled)
      expect(polled.status).toBe(200)
      view = JSON.parse(polled.body).value as ReportJobView
      if (view.status !== 'running') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(view!.status).toBe('done')
    expect(view!.progress).toBe(100)
    expect(view!.cls).toBe('early')
    expect(view!.record_id).toBe(value.record_id)
  })
})

describe('handleReportPage', () => {
  it('非 GET → 405;GET → 200 HTML(no-cache)', async () => {
    const res405 = mockResponse()
    await handleReportPage(mockRequest({ method: 'POST', url: '/aquasense-remind/report' }), res405)
    expect(res405.status).toBe(405)

    const res200 = mockResponse()
    await handleReportPage(mockRequest({ method: 'GET', url: '/aquasense-remind/report' }), res200)
    expect(res200.status).toBe(200)
    expect(res200.headers['content-type']).toContain('text/html')
    expect(res200.headers['cache-control']).toBe('no-cache')
    expect(res200.body).toContain('拍照汇报')
  })

  it('H5 页面资源可读取(构建时拷入 dist/web/)', async () => {
    const html = await readReportPage()
    expect(html).toContain('<!doctype html')
    expect(html).toContain('拍照汇报')
  })
})
