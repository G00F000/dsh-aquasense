/**
 * R8 存储层(reports/ 目录 + index.json 读写,见 docs/r8-traceability-architecture.md §3.3)
 *
 * 磁盘布局($AQUASENSE_CACHE_DIR/reports/):
 *   index.json                轻量索引(摘要字段,倒序)
 *   RPT-20260917-100532.json  单条完整记录
 *
 * 容错(需求 §9):目录不存在自动创建;index.json 损坏时从 reports/ 扫描重建;
 * 单条记录损坏时读取返回 null(列表跳过,不阻断整体)。
 * 并发:索引更新经进程内串行队列,避免读-改-写竞争丢条目。
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AnalysisIndex, AnalysisRecord, RecordSummary } from './trace-recorder.js'

// ========== 路径(延迟解析 env,便于测试注入 AQUASENSE_CACHE_DIR) ==========

/** 报告目录 */
export function reportsDir(): string {
  return path.join(process.env.AQUASENSE_CACHE_DIR || '/data/aquasense/cache', 'reports')
}

/** 索引文件路径 */
export function indexFile(): string {
  return path.join(reportsDir(), 'index.json')
}

/** 单条记录文件路径(仅接受已校验的 ID,见 trace-gateway 的 REPORT_ID_RE) */
function reportFile(id: string): string {
  return path.join(reportsDir(), `${id}.json`)
}

// ========== 写入 ==========

/** 写入单条完整记录(目录不存在时自动创建) */
export async function writeReport(record: AnalysisRecord): Promise<void> {
  await fs.mkdir(reportsDir(), { recursive: true })
  await fs.writeFile(reportFile(record.id), JSON.stringify(record, null, 2), 'utf-8')
}

// ========== 图片存储(工人发送的原图,详情页展示) ==========

/** 图片元数据(详情接口附加、前端渲染 <img> 用) */
export interface ReportImageMeta {
  /** 图片序号(0 起,与 <img> 接口路径对应) */
  index: number
  fileName: string
  mimeType: string
  size: number
}

/** 单张图片文件路径(index 由调用方保证非负整数) */
function reportImageFile(id: string, index: number, ext: string): string {
  return path.join(reportsDir(), 'images', id, `img-${String(index).padStart(3, '0')}${ext}`)
}

/** MIME → 扩展名(未知类型降级 .jpg,与 feishu/token.ts 一致) */
const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

function extOfImageMime(mimeType: string): string {
  const key = (mimeType || '').split(';')[0].trim().toLowerCase()
  return IMAGE_MIME_EXT[key] || '.jpg'
}

/**
 * 将工人发送的图片(base64 data)按序落盘到 reports/images/<id>/。
 * 写入失败不阻断管线,由调用方捕获后仅告警。
 * @returns 已保存的图片元数据(按 index 升序)
 */
export async function saveReportImages(
  id: string,
  images: Array<{ data: string; mimeType: string }>
): Promise<ReportImageMeta[]> {
  const dir = path.join(reportsDir(), 'images', id)
  await fs.mkdir(dir, { recursive: true })
  const saved: ReportImageMeta[] = []
  for (let i = 0; i < images.length; i++) {
    const mimeType = (images[i].mimeType || 'image/jpeg').split(';')[0].trim().toLowerCase()
    const ext = extOfImageMime(mimeType)
    const buffer = Buffer.from(images[i].data, 'base64')
    const fileName = `img-${String(i).padStart(3, '0')}${ext}`
    await fs.writeFile(path.join(dir, fileName), buffer)
    saved.push({ index: i, fileName, mimeType, size: buffer.byteLength })
  }
  return saved
}

/** 列出某条记录的已保存图片(不存在/为空返回 []) */
export async function listReportImages(id: string): Promise<ReportImageMeta[]> {
  const dir = path.join(reportsDir(), 'images', id)
  let files: string[] = []
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: ReportImageMeta[] = []
  for (const file of files) {
    const m = /^img-\d{3}\.(jpg|png|webp|gif)$/.exec(file)
    if (!m) continue
    try {
      const stat = await fs.stat(path.join(dir, file))
      out.push({
        index: Number(file.slice(4, 7)),
        fileName: file,
        mimeType: `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}`,
        size: stat.size
      })
    } catch {
      /* 单文件读取失败跳过 */
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

/** 读取某条记录的第 index 张图片(不存在/越界返回 null) */
export async function readReportImage(id: string, index: number): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // 按扩展名依次探测:同一 index 只可能有一个扩展名
  for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
    const file = reportImageFile(id, index, ext)
    try {
      const buffer = await fs.readFile(file)
      const mime = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`
      return { buffer, mimeType: mime }
    } catch {
      /* 尝试下一扩展名 */
    }
  }
  return null
}

/** 删除某条记录的图片目录(随记录清理) */
export async function removeReportImages(id: string): Promise<void> {
  await fs.rm(path.join(reportsDir(), 'images', id), { recursive: true, force: true }).catch(() => {})
}

/** 摘要条目(从完整记录提取;索引与重建共用) */
export function toSummary(record: AnalysisRecord): RecordSummary {
  return {
    id: record.id,
    pool: record.pool,
    reporter: record.reporter,
    source: record.source,
    cls: record.span_analyze?.cls ?? 'unknown',
    confidence: record.span_analyze?.confidence ?? 0,
    symptoms: record.span_analyze?.symptoms ?? [],
    alert_level: record.span_advice?.alert_level,
    created_at: record.created_at,
    total_duration_ms: record.total_duration_ms,
    total_tokens: record.total_tokens
  }
}

/** 索引更新串行队列(防止并发 flush 时读-改-写丢条目) */
let writeChain: Promise<void> = Promise.resolve()

/**
 * 更新索引(在头部插入新记录,保持按时间倒序)。
 * 同 ID 已存在时先移除旧条目再插入(重建/补录场景防重复)。
 */
export function updateIndex(record: AnalysisRecord): Promise<void> {
  const task = writeChain.then(async () => {
    const index = await readIndex()
    index.records = [toSummary(record), ...index.records.filter((r) => r.id !== record.id)]
    await fs.mkdir(reportsDir(), { recursive: true })
    await fs.writeFile(indexFile(), JSON.stringify(index, null, 2), 'utf-8')
    console.log(`[aquasense-trace] 索引已更新: 当前 ${index.records.length} 条记录`)
  })
  // 队列自身永不 reject,避免一次失败阻断后续更新;调用方仍能拿到本次的 reject
  writeChain = task.catch(() => {})
  return task
}

// ========== 读取 ==========

/** 空索引结构 */
function emptyIndex(): AnalysisIndex {
  return { version: 1, records: [] }
}

/** 校验索引结构合法性(仅做必要检查,损坏即重建) */
function isIndexValid(value: unknown): value is AnalysisIndex {
  if (!value || typeof value !== 'object') return false
  const index = value as AnalysisIndex
  return index.version === 1 && Array.isArray(index.records)
}

/**
 * 读取索引;文件不存在时返回空结构,解析失败/结构非法时自动重建(§4.5)。
 */
export async function readIndex(): Promise<AnalysisIndex> {
  let raw: string
  try {
    raw = await fs.readFile(indexFile(), 'utf-8')
  } catch {
    // 不存在(首次运行)或不可读:返回空结构
    return emptyIndex()
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isIndexValid(parsed)) return parsed
    console.warn('[aquasense-trace] index.json 结构非法,正在重建...')
  } catch {
    console.warn('[aquasense-trace] index.json 损坏,正在重建...')
  }
  try {
    return await rebuildIndex()
  } catch (error) {
    // 重建失败(目录不可读等):降级为空索引,不阻断查询
    console.error('[aquasense-trace] 索引重建失败:', error instanceof Error ? error.message : error)
    return emptyIndex()
  }
}

/** 读取单条完整记录;不存在或损坏时返回 null */
export async function readReport(id: string): Promise<AnalysisRecord | null> {
  try {
    const data = await fs.readFile(reportFile(id), 'utf-8')
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || (parsed as AnalysisRecord).id !== id) {
      console.warn(`[aquasense-trace] 记录结构非法,跳过: ${id}`)
      return null
    }
    return parsed as AnalysisRecord
  } catch {
    return null
  }
}

// ========== 重建与清理 ==========

/** 从 reports/ 目录扫描全部记录并重建索引(按 created_at 倒序) */
export async function rebuildIndex(): Promise<AnalysisIndex> {
  let files: string[] = []
  try {
    files = await fs.readdir(reportsDir())
  } catch {
    // 目录不存在:视为空库
    return emptyIndex()
  }

  const targets = files.filter((f) => f.startsWith('RPT-') && f.endsWith('.json'))
  const records: AnalysisRecord[] = []
  for (const file of targets) {
    try {
      const data = await fs.readFile(path.join(reportsDir(), file), 'utf-8')
      records.push(JSON.parse(data) as AnalysisRecord)
    } catch {
      console.warn(`[aquasense-trace] 跳过损坏的记录文件: ${file}`)
    }
  }
  records.sort((a, b) => b.created_at.localeCompare(a.created_at))

  const index: AnalysisIndex = { version: 1, records: records.map(toSummary) }
  await fs.mkdir(reportsDir(), { recursive: true })
  await fs.writeFile(indexFile(), JSON.stringify(index, null, 2), 'utf-8')
  console.log(`[aquasense-trace] 重建完成: ${records.length} 条`)
  return index
}

/**
 * 清理超过保留期的旧记录(默认 90 天)并裁剪索引。
 * @returns 清理条数
 */
export async function cleanupOldReports(daysToKeep = 90): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * 86400000).toISOString()
  const index = await readIndex()
  const toRemove = index.records.filter((r) => r.created_at < cutoff)

  for (const record of toRemove) {
    await fs.unlink(reportFile(record.id)).catch(() => {})
    await removeReportImages(record.id)
  }
  index.records = index.records.filter((r) => r.created_at >= cutoff)
  await fs.writeFile(indexFile(), JSON.stringify(index, null, 2), 'utf-8')
  console.log(`[aquasense-trace] 清理旧记录: ${toRemove.length} 条(daysToKeep=${daysToKeep})`)
  return toRemove.length
}

// ========== 查询(列表 / 趋势) ==========

/** 列表查询参数 */
export interface RecordQuery {
  pool?: string
  cls?: string
  /** 本地日期 YYYY-MM-DD(按记录 ID 的日期段匹配) */
  date?: string
  limit?: number
  offset?: number
}

/** 列表查询结果 */
export interface RecordQueryResult {
  records: RecordSummary[]
  total: number
  has_more: boolean
}

/** 单页最大条数 */
export const MAX_PAGE_SIZE = 200

/**
 * 索引查询:过滤(pool/cls/date) → 分页(limit/offset)。
 * date 按记录 ID 中的本地日期段匹配(RPT-YYYYMMDD-...)。
 */
export async function queryIndex(query: RecordQuery): Promise<RecordQueryResult> {
  const index = await readIndex()
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), MAX_PAGE_SIZE)
  const offset = Math.max(Math.floor(query.offset ?? 0), 0)
  const dateKey = query.date?.replace(/-/g, '') ?? ''

  const filtered = index.records.filter((r) => {
    if (query.pool && r.pool !== query.pool) return false
    if (query.cls && r.cls !== query.cls) return false
    // ID 形如 RPT-20260917-100532,第 4..12 位为本地日期
    if (dateKey && r.id.slice(4, 12) !== dateKey) return false
    return true
  })

  return {
    records: filtered.slice(offset, offset + limit),
    total: filtered.length,
    has_more: offset + limit < filtered.length
  }
}

/** 趋势统计结果(需求 §6.2 趋势查询响应) */
export interface TrendData {
  pool: string
  days: number
  total: number
  distribution: { normal: number; early: number; disease: number; unknown: number }
  top_symptoms: Array<{ symptom: string; count: number }>
  recent_records: RecordSummary[]
}

/**
 * 池号趋势统计:近 N 天的状态分布 + 症状频次 + 最近 10 条摘要。
 */
export async function computeTrend(pool: string, days: number): Promise<TrendData> {
  const index = await readIndex()
  const cutoff = new Date(Date.now() - days * 86400000).toISOString()
  const scoped = index.records.filter((r) => r.pool === pool && r.created_at >= cutoff)

  const distribution = { normal: 0, early: 0, disease: 0, unknown: 0 }
  const symptomCount = new Map<string, number>()
  for (const r of scoped) {
    if (r.cls === 'normal' || r.cls === 'early' || r.cls === 'disease') distribution[r.cls] += 1
    else distribution.unknown += 1
    for (const s of r.symptoms) {
      const key = s.trim()
      if (!key) continue
      symptomCount.set(key, (symptomCount.get(key) ?? 0) + 1)
    }
  }

  const topSymptoms = [...symptomCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symptom, count]) => ({ symptom, count }))

  if (scoped.length > 0) {
    console.log(`[aquasense-trace] 趋势查询: ${pool}, 近${days}天, ${scoped.length} 条记录`)
  }
  return {
    pool,
    days,
    total: scoped.length,
    distribution,
    top_symptoms: topSymptoms,
    recent_records: scoped.slice(0, 10)
  }
}
