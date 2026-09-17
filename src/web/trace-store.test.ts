/**
 * R8 存储层(trace-store)单元测试
 *
 * 测试重点:
 *  - writeReport/readReport:往返、缺失、损坏、ID 不匹配
 *  - 索引:updateIndex 头插/去重、readIndex 损坏重建、rebuildIndex 跳过坏文件
 *  - 查询:queryIndex 过滤/分页、computeTrend 分布/症状、cleanupOldReports 过期清理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AnalysisRecord } from './trace-recorder.js'
import {
  cleanupOldReports,
  computeTrend,
  indexFile,
  queryIndex,
  readIndex,
  readReport,
  rebuildIndex,
  reportsDir,
  updateIndex,
  writeReport
} from './trace-store.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquasense-store-'))
  process.env.AQUASENSE_CACHE_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.AQUASENSE_CACHE_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** 构造完整记录(analyze Span 按 cls 生成) */
function makeRecord(
  id: string,
  options: { pool?: string; cls?: 'normal' | 'early' | 'disease' | 'unknown'; created_at?: string; symptoms?: string[] } = {}
): AnalysisRecord {
  return {
    id,
    pool: options.pool ?? '池1',
    reporter: '张三',
    reporter_open_id: '',
    source: 'h5_upload',
    created_at: options.created_at ?? '2026-09-17T10:05:32.000Z',
    model: 'deepseek-flash',
    total_duration_ms: 100,
    total_tokens: 50,
    status: 'success',
    span_analyze: {
      prompt_length: 10,
      input_tokens: 30,
      output_tokens: 20,
      output_raw: 'raw',
      cls: options.cls ?? 'early',
      symptoms: options.symptoms ?? ['浮头'],
      severity: 'medium',
      confidence: 0.8,
      scene_hint: 'inspection'
    }
  }
}

/** 记录文件是否存在 */
async function fileExists(name: string): Promise<boolean> {
  try {
    await fs.access(path.join(reportsDir(), name))
    return true
  } catch {
    return false
  }
}

describe('writeReport / readReport', () => {
  it('往返读写(目录自动创建)', async () => {
    await writeReport(makeRecord('RPT-20260917-100532'))
    const record = await readReport('RPT-20260917-100532')
    expect(record).toMatchObject({ id: 'RPT-20260917-100532', pool: '池1', reporter: '张三' })
  })

  it('不存在 / 损坏 JSON / ID 不匹配 → null', async () => {
    expect(await readReport('RPT-20260917-000000')).toBeNull()

    await fs.mkdir(reportsDir(), { recursive: true })
    await fs.writeFile(path.join(reportsDir(), 'RPT-20260917-000001.json'), '{oops', 'utf-8')
    expect(await readReport('RPT-20260917-000001')).toBeNull()

    await fs.writeFile(path.join(reportsDir(), 'RPT-20260917-000002.json'), JSON.stringify({ id: 'RPT-OTHER' }), 'utf-8')
    expect(await readReport('RPT-20260917-000002')).toBeNull()
  })
})

describe('索引(updateIndex / readIndex / rebuildIndex)', () => {
  it('updateIndex 头部插入保持倒序;同 ID 去重后仍回到头部', async () => {
    await updateIndex(makeRecord('RPT-20260917-100000'))
    await updateIndex(makeRecord('RPT-20260917-110000'))
    let index = await readIndex()
    expect(index.records.map((r) => r.id)).toEqual(['RPT-20260917-110000', 'RPT-20260917-100000'])

    await updateIndex(makeRecord('RPT-20260917-100000', { cls: 'disease' }))
    index = await readIndex()
    expect(index.records).toHaveLength(2)
    expect(index.records[0]).toMatchObject({ id: 'RPT-20260917-100000', cls: 'disease' })
  })

  it('readIndex:文件不存在 → 空索引', async () => {
    await expect(readIndex()).resolves.toEqual({ version: 1, records: [] })
  })

  it('readIndex:index.json 损坏 → 从 reports/ 扫描重建(按时间倒序)并回写', async () => {
    await writeReport(makeRecord('RPT-20260916-090000', { created_at: '2026-09-16T09:00:00.000Z' }))
    await writeReport(makeRecord('RPT-20260917-090000', { created_at: '2026-09-17T09:00:00.000Z' }))
    await fs.mkdir(reportsDir(), { recursive: true })
    await fs.writeFile(indexFile(), 'not-json{', 'utf-8')

    const index = await readIndex()
    expect(index.records.map((r) => r.id)).toEqual(['RPT-20260917-090000', 'RPT-20260916-090000'])
    const persisted = JSON.parse(await fs.readFile(indexFile(), 'utf-8'))
    expect(persisted.version).toBe(1)
    expect(persisted.records).toHaveLength(2)
  })

  it('readIndex:index.json 结构非法 → 重建', async () => {
    await writeReport(makeRecord('RPT-20260917-100000'))
    await fs.writeFile(indexFile(), JSON.stringify({ version: 2, records: 'nope' }), 'utf-8')
    const index = await readIndex()
    expect(index.records).toHaveLength(1)
  })

  it('rebuildIndex 跳过损坏记录文件', async () => {
    await writeReport(makeRecord('RPT-20260917-100000'))
    await fs.writeFile(path.join(reportsDir(), 'RPT-20260917-100001.json'), '{broken', 'utf-8')
    const index = await rebuildIndex()
    expect(index.records.map((r) => r.id)).toEqual(['RPT-20260917-100000'])
  })
})

describe('queryIndex', () => {
  beforeEach(async () => {
    await updateIndex(makeRecord('RPT-20260916-090000', { created_at: '2026-09-16T09:00:00.000Z' }))
    await updateIndex(makeRecord('RPT-20260917-090000', { pool: '池2', cls: 'normal', created_at: '2026-09-17T09:00:00.000Z' }))
    await updateIndex(makeRecord('RPT-20260917-100000', { pool: '池2', cls: 'disease', created_at: '2026-09-17T10:00:00.000Z' }))
  })

  it('无过滤返回全部(倒序)', async () => {
    const result = await queryIndex({})
    expect(result.total).toBe(3)
    expect(result.records.map((r) => r.id)).toEqual(['RPT-20260917-100000', 'RPT-20260917-090000', 'RPT-20260916-090000'])
    expect(result.has_more).toBe(false)
  })

  it('pool / cls / date 过滤', async () => {
    expect((await queryIndex({ pool: '池2' })).total).toBe(2)
    expect((await queryIndex({ cls: 'disease' })).records.map((r) => r.id)).toEqual(['RPT-20260917-100000'])
    expect((await queryIndex({ date: '2026-09-16' })).records.map((r) => r.id)).toEqual(['RPT-20260916-090000'])
  })

  it('分页:limit/offset 与 has_more', async () => {
    const page1 = await queryIndex({ limit: 2 })
    expect(page1.records).toHaveLength(2)
    expect(page1.has_more).toBe(true)

    const page2 = await queryIndex({ limit: 2, offset: 2 })
    expect(page2.records).toHaveLength(1)
    expect(page2.has_more).toBe(false)
  })
})

describe('computeTrend', () => {
  it('仅统计近 N 天:分布/症状频次/最近记录', async () => {
    const fresh = new Date(Date.now() - 86400000).toISOString()
    const stale = new Date(Date.now() - 30 * 86400000).toISOString()
    await updateIndex(makeRecord('RPT-20260916-090000', { cls: 'early', created_at: fresh, symptoms: ['浮头', '游动异常'] }))
    await updateIndex(makeRecord('RPT-20260916-090001', { cls: 'disease', created_at: fresh, symptoms: ['浮头'] }))
    await updateIndex(makeRecord('RPT-20260916-090002', { cls: 'normal', created_at: fresh, symptoms: [] }))
    await updateIndex(makeRecord('RPT-20260816-090003', { cls: 'disease', created_at: stale, symptoms: ['浮头'] }))

    const trend = await computeTrend('池1', 7)
    expect(trend.pool).toBe('池1')
    expect(trend.days).toBe(7)
    expect(trend.total).toBe(3)
    expect(trend.distribution).toEqual({ normal: 1, early: 1, disease: 1, unknown: 0 })
    expect(trend.top_symptoms[0]).toEqual({ symptom: '浮头', count: 2 })
    expect(trend.recent_records).toHaveLength(3)
  })

  it('其他池号记录不计入', async () => {
    await updateIndex(makeRecord('RPT-20260917-090000', { pool: '池2', created_at: new Date().toISOString() }))
    const trend = await computeTrend('池1', 7)
    expect(trend.total).toBe(0)
  })
})

describe('cleanupOldReports', () => {
  it('删除超期记录文件并裁剪索引', async () => {
    const old = new Date(Date.now() - 100 * 86400000).toISOString()
    const fresh = new Date().toISOString()
    await writeReport(makeRecord('RPT-20260601-090000', { created_at: old }))
    await writeReport(makeRecord('RPT-20260917-090000', { created_at: fresh }))
    await updateIndex(makeRecord('RPT-20260601-090000', { created_at: old }))
    await updateIndex(makeRecord('RPT-20260917-090000', { created_at: fresh }))

    const removed = await cleanupOldReports(90)
    expect(removed).toBe(1)
    expect(await fileExists('RPT-20260601-090000.json')).toBe(false)
    expect(await fileExists('RPT-20260917-090000.json')).toBe(true)

    const index = await readIndex()
    expect(index.records.map((r) => r.id)).toEqual(['RPT-20260917-090000'])
  })
})
