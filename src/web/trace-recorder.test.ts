/**
 * R8 分析记录器(trace-recorder)单元测试
 *
 * 测试重点:
 *  - generateReportId:格式/同秒序号/跨秒重置/resetReportIdState
 *  - AnalysisTracer:recordSpan 直接落数据、startSpan/endSpan 计时、
 *    flush 汇总(耗时/Token)并落盘(reports/RPT-*.json + index.json)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { AnalysisTracer, MAX_OUTPUT_RAW, generateReportId, resetReportIdState } from './trace-recorder.js'
import { readIndex, readReport } from './trace-store.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquasense-recorder-'))
  process.env.AQUASENSE_CACHE_DIR = tmpDir
  resetReportIdState()
})

afterEach(async () => {
  delete process.env.AQUASENSE_CACHE_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('generateReportId', () => {
  it('格式为 RPT-YYYYMMDD-HHmmss(本地时间)', () => {
    expect(generateReportId(new Date(2026, 8, 17, 10, 5, 32))).toBe('RPT-20260917-100532')
  })

  it('同秒内多次生成追加 -N 序号防重名', () => {
    const now = new Date(2026, 8, 17, 10, 5, 32)
    expect(generateReportId(now)).toBe('RPT-20260917-100532')
    expect(generateReportId(now)).toBe('RPT-20260917-100532-1')
    expect(generateReportId(now)).toBe('RPT-20260917-100532-2')
  })

  it('跨秒后序号重置', () => {
    const first = new Date(2026, 8, 17, 10, 5, 32)
    const next = new Date(2026, 8, 17, 10, 5, 33)
    expect(generateReportId(first)).toBe('RPT-20260917-100532')
    expect(generateReportId(first)).toBe('RPT-20260917-100532-1')
    expect(generateReportId(next)).toBe('RPT-20260917-100533')
  })

  it('resetReportIdState 清空序号(测试复位用)', () => {
    const now = new Date(2026, 8, 17, 10, 5, 32)
    generateReportId(now)
    generateReportId(now)
    resetReportIdState()
    expect(generateReportId(now)).toBe('RPT-20260917-100532')
  })
})

describe('AnalysisTracer', () => {
  it('recordSpan 直接落数据;flush 汇总耗时/Token 并写盘 + 更新索引', async () => {
    const tracer = new AnalysisTracer({
      pool: '池1',
      reporter: '张三',
      reporter_open_id: 'ou_1',
      source: 'h5_upload',
      task: '投喂并拍照',
      chat_id: 'oc_1'
    })
    tracer.recordSpan('upload', { image_count: 2, image_names: ['a.jpg', 'b.jpg'], image_sizes: [100, 200] }, 80)
    tracer.recordSpan(
      'analyze',
      {
        prompt_length: 42,
        input_tokens: 1000,
        output_tokens: 120,
        output_raw: 'raw output',
        cls: 'early',
        symptoms: ['浮头'],
        severity: 'medium',
        confidence: 0.86,
        scene_hint: 'inspection'
      },
      3200
    )

    const id = await tracer.flush()
    expect(id).toBe(tracer.id)
    expect(id).toMatch(/^RPT-\d{8}-\d{6}$/)

    const record = await readReport(id)
    expect(record).not.toBeNull()
    expect(record!.pool).toBe('池1')
    expect(record!.reporter).toBe('张三')
    expect(record!.source).toBe('h5_upload')
    expect(record!.task).toBe('投喂并拍照')
    expect(record!.chat_id).toBe('oc_1')
    expect(record!.status).toBe('success')
    expect(record!.total_duration_ms).toBe(3280)
    expect(record!.total_tokens).toBe(1120)
    expect(record!.span_upload).toMatchObject({ image_count: 2, duration_ms: 80 })
    expect(record!.span_analyze).toMatchObject({ cls: 'early', input_tokens: 1000, output_tokens: 120 })

    const index = await readIndex()
    expect(index.records).toHaveLength(1)
    expect(index.records[0]).toMatchObject({ id, pool: '池1', cls: 'early', total_tokens: 1120 })
  })

  it('startSpan/endSpan 记录真实耗时;未 startSpan 的 endSpan 被忽略', async () => {
    const tracer = new AnalysisTracer({ pool: '池2', reporter: '李四', reporter_open_id: '', source: 'group_chat' })
    tracer.startSpan('analyze')
    await new Promise((resolve) => setTimeout(resolve, 15))
    tracer.endSpan('analyze', { cls: 'normal', input_tokens: 0, output_tokens: 0 })
    tracer.endSpan('advice', { alert_level: 'P2' }) // 未开始 → 忽略

    await tracer.flush()
    const record = await readReport(tracer.id)
    expect(record!.span_analyze?.duration_ms).toBeGreaterThanOrEqual(10)
    expect(record!.span_advice).toBeUndefined()
  })

  it('setTraceMeta 覆盖状态与错误;recordSpan 缺省耗时不写 duration_ms', async () => {
    const tracer = new AnalysisTracer({ pool: '池3', reporter: '王五', reporter_open_id: '', source: 'h5_upload' })
    tracer.recordSpan('ledger', { target_table: '巡检记录表', operation: 'create', success: false, message: '台账写入失败' })
    tracer.setTraceMeta({ status: 'error', error: '台账写入失败' })
    await tracer.flush()

    const record = await readReport(tracer.id)
    expect(record!.status).toBe('error')
    expect(record!.error).toBe('台账写入失败')
    expect(record!.span_ledger).toMatchObject({ success: false, message: '台账写入失败' })
    expect(record!.span_ledger?.duration_ms).toBeUndefined()
    expect(record!.total_duration_ms).toBe(0)
  })

  it('MAX_OUTPUT_RAW 为模型原文截断长度(500)', () => {
    expect(MAX_OUTPUT_RAW).toBe(500)
  })
})
