/**
 * TraceRecordList v2.0 — 配置页面板内「📊 分析记录」(列表态 ⇄ 详情态)
 *
 * 列表态：调用 /aquasense-reports/api/records(JSON index 摘要)；
 * 详情态：调用 /aquasense-reports/api/records/:id(完整 AnalysisRecord)，
 *   展示元信息 + 瀑布图(Trace Timeline) + 5 步骤 Accordion 展开。
 *
 * 原型依据：docs/r8-traceability-requirements.md §4.1 原型 A
 * 样式复用面板 CSS 变量体系，与每日任务提醒表单视觉一致。
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

// ========== 数据模型 ==========

/** 列表接口：index.json 摘要（扁平） */
interface RecordSummary {
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

/** 详情接口：完整 AnalysisRecord（嵌套 span_*） */
interface AnalysisRecord {
  id: string
  pool: string
  reporter: string
  reporter_open_id: string
  source: 'h5_upload' | 'group_chat' | 'api'
  created_at: string
  model: string
  total_duration_ms: number
  total_tokens: number
  status: 'success' | 'error'
  error?: string
  span_upload?: {
    image_count: number
    image_names?: string[]
    image_sizes: number[]
    compressed_sizes?: number[]
    duration_ms?: number
    error?: string
  }
  span_analyze?: {
    prompt_length: number
    input_tokens: number
    output_tokens: number
    output_raw: string
    cls: string
    symptoms: string[]
    severity: string
    confidence: number
    scene_hint: string
    organs?: string[]
    duration_ms?: number
    error?: string
  }
  span_retrieve?: {
    query: string
    channel_a_wiki: number
    channel_b_note: number
    channel_c_pdf: number
    merged_count: number
    excerpts: Array<{ title: string; from?: string; locator?: string; excerpt_preview: string }>
    duration_ms?: number
    error?: string
  }
  span_advice?: {
    input_cls: string
    alert_level: string
    knowledge_refs_count: number
    diagnosis_summary: string
    reasoning_preview: string
    duration_ms?: number
    error?: string
  }
  span_ledger?: {
    target_table: string
    operation: 'create' | 'update'
    record_id?: string
    success?: boolean
    message?: string
    duration_ms?: number
    error?: string
  }
}

/** 列表接口信封 */
interface RecordsPage {
  records: RecordSummary[]
  total: number
  has_more: boolean
}

// ========== 常量 ==========

const PAGE_LIMIT = 20

const POOL_OPTIONS = ['', '池1', '池2', '池3', '池4']
const CLS_OPTIONS: [string, string][] = [
  ['', '全部状态'],
  ['normal', '正常'],
  ['early', '前兆'],
  ['disease', '发病'],
  ['unknown', '未知']
]

const CLS_LABEL: Record<string, string> = { normal: 'normal', early: 'early', disease: 'disease', unknown: 'unknown' }
const CLS_COLOR: Record<string, string> = { normal: '#52c41a', early: '#faad14', disease: '#ff4d4f', unknown: '#9ca3af' }
const SOURCE_LABEL: Record<string, string> = { h5_upload: 'H5上传', group_chat: '群聊发图', api: 'API' }

/** 步骤配置 */
const SPAN_DEFS: Array<{
  key: string
  label: string
  icon: string
  color: string
  field: 'span_upload' | 'span_analyze' | 'span_retrieve' | 'span_advice' | 'span_ledger'
}> = [
  { key: 'upload', label: '图片上传', icon: '📷', color: '#8c8c8c', field: 'span_upload' },
  { key: 'analyze', label: 'AI 视觉分析', icon: '🧠', color: '#1677ff', field: 'span_analyze' },
  { key: 'retrieve', label: '知识库检索', icon: '📚', color: '#fa8c16', field: 'span_retrieve' },
  { key: 'advice', label: '处置建议生成', icon: '💡', color: '#52c41a', field: 'span_advice' },
  { key: 'ledger', label: '台账写入', icon: '📝', color: '#722ed1', field: 'span_ledger' }
]

// ========== 内联样式(面板 token 体系) ==========

const S = {
  /* 筛选条 */
  filterBar: { display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', flexShrink: 0 } satisfies CSSProperties,
  select: { appearance: 'none', padding: '6px 28px 6px 10px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)', fontSize: 13, lineHeight: '20px' } satisfies CSSProperties,
  /* 列表区 */
  list: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '12px 20px 32px' } satisfies CSSProperties,
  empty: { padding: '60px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' } satisfies CSSProperties,
  /* 日期分组标题 */
  groupTitle: { margin: '18px 0 8px', fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)' } satisfies CSSProperties,
  /* 记录行 */
  row: { display: 'block', padding: '12px 14px', color: 'inherit', textDecoration: 'none', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', cursor: 'pointer', background: 'transparent' } satisfies CSSProperties,
  /* 记录行第一行：圆点 + ID + 池号 + 状态 + 置信度 + 症状（同行） */
  line1: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 } satisfies CSSProperties,
  dot: (cls: string): CSSProperties => ({
    flex: 'none', width: 8, height: 8, borderRadius: '50%',
    background: CLS_COLOR[cls] || '#9ca3af'
  }),
  /* 症状（同行，自动截断） */
  symptom: { flex: '1 1 0', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 } satisfies CSSProperties,
  /* 记录行第二行 */
  line2: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' } satisfies CSSProperties,
  /* 趋势链接 */
  trendLink: { display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 20, fontSize: 14, color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', cursor: 'pointer', border: 0, background: 'transparent', padding: 0 } satisfies CSSProperties,
  /* 加载更多 */
  moreBtn: { display: 'block', width: '100%', margin: '16px 0 0', padding: 10, border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer' } satisfies CSSProperties,
  /* 错误 */
  err: { margin: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #ff4d4f', background: 'var(--dsw-alias-bg-layer-3,#fff)', color: '#ff4d4f', fontSize: 13 } satisfies CSSProperties,

  /* ===== 详情态 ===== */
  detailWrap: { flex: 1, overflow: 'auto', padding: '16px 20px 32px' } satisfies CSSProperties,
  detailBack: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer', marginBottom: 12 } satisfies CSSProperties,
  /* 标题行：返回 + ID + 状态 */
  detailTitle: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, marginBottom: 16 } satisfies CSSProperties,
  statusBadge: (cls: string): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 999,
    background: (CLS_COLOR[cls] || '#9ca3af') + '18',
    color: CLS_COLOR[cls] || '#9ca3af', fontSize: 12, fontWeight: 600, flexShrink: 0
  }),
  /* 元信息区 */
  metaGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13, padding: '12px 16px', borderRadius: 8, background: 'var(--dsw-alias-bg-secondary,#f4f5f7)', marginBottom: 20 } satisfies CSSProperties,
  metaLabel: { color: 'var(--dsw-alias-label-secondary,#7b8088)', whiteSpace: 'nowrap' } satisfies CSSProperties,
  metaValue: { color: 'var(--dsw-alias-label-primary,#17191c)' } satisfies CSSProperties,
  /* 瀑布图 */
  waterfallWrap: { marginBottom: 20 } satisfies CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)' } satisfies CSSProperties,
  waterfall: { display: 'flex', flexDirection: 'column', gap: 4 } satisfies CSSProperties,
  wfRow: { display: 'flex', alignItems: 'center', gap: 8 } satisfies CSSProperties,
  wfIcon: { width: 20, textAlign: 'center', fontSize: 14, flexShrink: 0 } satisfies CSSProperties,
  wfLabel: { width: 110, fontSize: 12, color: 'var(--dsw-alias-label-primary,#17191c)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } satisfies CSSProperties,
  wfTrack: { flex: '1 1 auto', height: 18, borderRadius: 4, background: 'var(--dsw-alias-bg-secondary,#f0f1f3)', position: 'relative', overflow: 'hidden' } satisfies CSSProperties,
  wfBar: (color: string, pct: number): CSSProperties => ({
    position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.max(pct, 2)}%`,
    background: color, borderRadius: 4, transition: 'width 0.3s'
  }),
  wfDur: { width: 44, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', textAlign: 'right', flexShrink: 0 } satisfies CSSProperties,
  wfStatus: { width: 20, fontSize: 12, textAlign: 'center', flexShrink: 0 } satisfies CSSProperties,

  /* 步骤 Accordion */
  stepsWrap: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 } satisfies CSSProperties,
  stepItem: { border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, overflow: 'hidden' } satisfies CSSProperties,
  stepHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-3,#fff)', border: 0, width: '100%', textAlign: 'left', fontSize: 13, color: 'var(--dsw-alias-label-primary,#17191c)' } satisfies CSSProperties,
  stepArrow: (open: boolean): CSSProperties => ({
    transition: 'transform 0.2s', fontSize: 10, color: 'var(--dsw-alias-label-secondary,#7b8088)',
    transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0
  }),
  stepHeaderRight: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' } satisfies CSSProperties,
  stepBody: { padding: '10px 14px', borderTop: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', fontSize: 13, background: 'var(--dsw-alias-bg-secondary,#f9fafb)' } satisfies CSSProperties,
  stepField: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 } satisfies CSSProperties,
  stepLabel: { color: 'var(--dsw-alias-label-secondary,#7b8088)', whiteSpace: 'nowrap' } satisfies CSSProperties,
  stepValue: { color: 'var(--dsw-alias-label-primary,#17191c)', wordBreak: 'break-all', whiteSpace: 'pre-wrap' } satisfies CSSProperties,
  /* 知识库命中条目 */
  excerptItem: { padding: '6px 10px', marginBottom: 4, borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e8eaed)' } satisfies CSSProperties,
  excerptTitle: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary,#17191c)', marginBottom: 2 } satisfies CSSProperties,
  excerptMeta: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 2 } satisfies CSSProperties,
  excerptText: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#555)', fontStyle: 'italic' } satisfies CSSProperties,
} as const

// ========== 辅助 ==========

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000)
  if (diff === 0) return `今天 (${d.getMonth() + 1}月${d.getDate()}日)`
  if (diff === 1) return `昨天 (${d.getMonth() + 1}月${d.getDate()}日)`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function timeText(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => (n < 10 ? '0' : '') + n
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function durationText(ms: number): string {
  return ms > 0 ? (ms / 1000).toFixed(1) + 's' : '—'
}

function tokenText(n: number): string {
  return n > 0 ? n.toLocaleString('en-US') : '—'
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => (n < 10 ? '0' : '') + n
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ========== 子组件 ==========

/** 瀑布图：5 个 span 的时间轴可视化 */
function WaterfallChart({ record }: { record: AnalysisRecord }): ReactNode {
  const spans = SPAN_DEFS.map((def) => ({
    ...def,
    data: record[def.field],
    duration: record[def.field]?.duration_ms ?? 0
  }))
  const total = record.total_duration_ms || 1
  const hasAny = spans.some((s) => s.duration > 0)
  if (!hasAny) return null

  return (
    <div style={S.waterfallWrap}>
      <div style={S.sectionTitle}>── 瀑布图（Trace Timeline）──</div>
      <div style={S.waterfall}>
        {spans.map((s) => (
          <div key={s.key} style={S.wfRow}>
            <span style={S.wfIcon}>{s.icon}</span>
            <span style={S.wfLabel}>{s.label}</span>
            <div style={S.wfTrack}>
              <div style={S.wfBar(s.color, (s.duration / total) * 100)} />
            </div>
            <span style={S.wfDur}>{durationText(s.duration)}</span>
            <span style={S.wfStatus}>{s.data?.error ? '❌' : (s.duration > 0 ? '✅' : '—')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 单个步骤 Accordion */
function StepAccordion({
  def,
  record,
  isOpen,
  onToggle
}: {
  def: typeof SPAN_DEFS[number]
  record: AnalysisRecord
  isOpen: boolean
  onToggle: () => void
}): ReactNode {
  const data = record[def.field]
  const dur = data?.duration_ms ?? 0

  return (
    <div style={S.stepItem}>
      <button type="button" style={S.stepHeader} onClick={onToggle}>
        <span style={S.stepArrow(isOpen)}>▶</span>
        <span>{def.icon} {def.label}</span>
        <span style={S.stepHeaderRight}>
          <span>{durationText(dur)}</span>
          <span>{data?.error ? '❌' : (dur > 0 ? '✅' : '—')}</span>
        </span>
      </button>
      {isOpen && data && (
        <div style={S.stepBody}>
          {renderStepContent(def.key, data, record)}
        </div>
      )}
    </div>
  )
}

/** 根据步骤类型渲染不同内容 */
function renderStepContent(key: string, data: Record<string, unknown>, record: AnalysisRecord): ReactNode {
  switch (key) {
    case 'upload': return renderUploadStep(data)
    case 'analyze': return renderAnalyzeStep(data, record)
    case 'retrieve': return renderRetrieveStep(data)
    case 'advice': return renderAdviceStep(data)
    case 'ledger': return renderLedgerStep(data)
    default: return null
  }
}

function renderUploadStep(data: Record<string, unknown>): ReactNode {
  const imageCount = data.image_count as number ?? 0
  const sizes = (data.image_sizes as number[]) ?? []
  const compressed = (data.compressed_sizes as number[]) ?? []
  const names = (data.image_names as string[]) ?? []
  const err = data.error as string | undefined

  return (
    <div style={S.stepField}>
      <span style={S.stepLabel}>输入</span>
      <span style={S.stepValue}>{imageCount} 张图片</span>
      {sizes.map((size, i) => (
        <>
          <span key={`k${i}`} style={S.stepLabel}> </span>
          <span key={`v${i}`} style={S.stepValue}>
            🐟 {names[i] || `image_${String(i + 1).padStart(3, '0')}`}
            {' '}({formatBytes(size)}{compressed[i] ? ` → ${formatBytes(compressed[i])}` : ''})
          </span>
        </>
      ))}
      <span style={S.stepLabel}>输出</span>
      <span style={S.stepValue}>{imageCount} 张图片已压缩并转为 base64</span>
      {err && (
        <>
          <span style={{ ...S.stepLabel, color: '#ff4d4f' }}>错误</span>
          <span style={{ ...S.stepValue, color: '#ff4d4f' }}>{err}</span>
        </>
      )}
    </div>
  )
}

function renderAnalyzeStep(data: Record<string, unknown>, record?: AnalysisRecord): ReactNode {
  const cls = data.cls as string ?? 'unknown'
  const confidence = data.confidence as number ?? 0
  const symptoms = (data.symptoms as string[]) ?? []
  const severity = data.severity as string ?? ''
  const organs = (data.organs as string[]) ?? []
  const promptLen = data.prompt_length as number ?? 0
  const inputTok = data.input_tokens as number ?? 0
  const outputTok = data.output_tokens as number ?? 0
  const raw = data.output_raw as string ?? ''
  const err = data.error as string | undefined

  return (
    <div style={S.stepField}>
      <span style={S.stepLabel}>模型</span>
      <span style={S.stepValue}>{record?.model || '—'} (temperature=0.1)</span>
      <span style={S.stepLabel}>输入</span>
      <span style={S.stepValue}>system prompt ({promptLen} chars) + 图片</span>
      <span style={S.stepLabel}>输出</span>
      <span style={S.stepValue}>
        状态: {CLS_LABEL[cls] || cls}（{cls}）
        {'\n'}置信度: {confidence.toFixed(2)}
        {'\n'}症状: {symptoms.length > 0 ? symptoms.join('、') : '无异常'}
        {severity ? `\n严重度: ${severity}` : ''}
        {organs.length > 0 ? `\n器官: ${organs.join('、')}` : ''}
      </span>
      <span style={S.stepLabel}>Token</span>
      <span style={S.stepValue}>input={tokenText(inputTok)} output={tokenText(outputTok)}</span>
      {raw && (
        <>
          <span style={S.stepLabel}>原始输出</span>
          <span style={S.stepValue}>{raw}</span>
        </>
      )}
      {err && (
        <>
          <span style={{ ...S.stepLabel, color: '#ff4d4f' }}>错误</span>
          <span style={{ ...S.stepValue, color: '#ff4d4f' }}>{err}</span>
        </>
      )}
    </div>
  )
}

function renderRetrieveStep(data: Record<string, unknown>): ReactNode {
  const query = data.query as string ?? ''
  const chA = data.channel_a_wiki as number ?? 0
  const chB = data.channel_b_note as number ?? 0
  const chC = data.channel_c_pdf as number ?? 0
  const merged = data.merged_count as number ?? 0
  const excerpts = (data.excerpts as Array<{ title: string; from?: string; locator?: string; excerpt_preview: string }>) ?? []
  const err = data.error as string | undefined

  return (
    <div style={S.stepField}>
      <span style={S.stepLabel}>查询</span>
      <span style={S.stepValue}>"{query}"</span>
      <span style={S.stepLabel}>通道A (wiki)</span>
      <span style={S.stepValue}>命中 {chA} 条</span>
      <span style={S.stepLabel}>通道B (note)</span>
      <span style={S.stepValue}>命中 {chB} 条</span>
      <span style={S.stepLabel}>通道C (PDF)</span>
      <span style={S.stepValue}>命中 {chC} 条</span>
      <span style={S.stepLabel}>合并去重</span>
      <span style={S.stepValue}>{merged} 条</span>
      {excerpts.length > 0 && (
        <>
          <span style={S.stepLabel}>命中条目</span>
          <span style={S.stepValue}>
            {excerpts.map((ex, i) => (
              <div key={i} style={S.excerptItem}>
                <div style={S.excerptTitle}>📄 《{ex.title}》{ex.from ? `[${fromLabel(ex.from)}]` : ''}</div>
                {ex.locator && <div style={S.excerptMeta}>{ex.locator}</div>}
                <div style={S.excerptText}>「{ex.excerpt_preview}」</div>
              </div>
            ))}
          </span>
        </>
      )}
      {err && (
        <>
          <span style={{ ...S.stepLabel, color: '#ff4d4f' }}>错误</span>
          <span style={{ ...S.stepValue, color: '#ff4d4f' }}>{err}</span>
        </>
      )}
    </div>
  )
}

function renderAdviceStep(data: Record<string, unknown>): ReactNode {
  const alertLevel = data.alert_level as string ?? ''
  const refsCount = data.knowledge_refs_count as number ?? 0
  const diagnosis = data.diagnosis_summary as string ?? ''
  const reasoning = data.reasoning_preview as string ?? ''
  const err = data.error as string | undefined

  return (
    <div style={S.stepField}>
      <span style={S.stepLabel}>预警级别</span>
      <span style={S.stepValue}>{alertLevel || '—'}</span>
      <span style={S.stepLabel}>知识来源</span>
      <span style={S.stepValue}>{refsCount} 条</span>
      <span style={S.stepLabel}>诊断</span>
      <span style={S.stepValue}>{diagnosis || '—'}</span>
      <span style={S.stepLabel}>推理</span>
      <span style={S.stepValue}>{reasoning || '—'}</span>
      {err && (
        <>
          <span style={{ ...S.stepLabel, color: '#ff4d4f' }}>错误</span>
          <span style={{ ...S.stepValue, color: '#ff4d4f' }}>{err}</span>
        </>
      )}
    </div>
  )
}

function renderLedgerStep(data: Record<string, unknown>): ReactNode {
  const table = data.target_table as string ?? ''
  const op = data.operation as string ?? ''
  const recId = data.record_id as string ?? ''
  const success = data.success as boolean | undefined
  const message = data.message as string ?? ''
  const err = data.error as string | undefined

  return (
    <div style={S.stepField}>
      <span style={S.stepLabel}>目标表</span>
      <span style={S.stepValue}>{table || '—'}</span>
      <span style={S.stepLabel}>操作</span>
      <span style={S.stepValue}>{op === 'create' ? '新增' : op === 'update' ? '更新' : op || '—'}</span>
      {recId && (
        <>
          <span style={S.stepLabel}>记录ID</span>
          <span style={S.stepValue}>{recId}</span>
        </>
      )}
      {success !== undefined && (
        <>
          <span style={S.stepLabel}>结果</span>
          <span style={S.stepValue}>{success ? '✅ 成功' : '❌ 失败'}</span>
        </>
      )}
      {message && (
        <>
          <span style={S.stepLabel}>信息</span>
          <span style={S.stepValue}>{message}</span>
        </>
      )}
      {err && (
        <>
          <span style={{ ...S.stepLabel, color: '#ff4d4f' }}>错误</span>
          <span style={{ ...S.stepValue, color: '#ff4d4f' }}>{err}</span>
        </>
      )}
    </div>
  )
}

// ========== 辅助 ==========

/** 知识来源通道名翻译 */
function fromLabel(from: string): string {
  const map: Record<string, string> = { pdf_content: 'PDF', note: '笔记', wiki: 'wiki' }
  return map[from] || from
}

/** 字节格式化 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

// ========== 组件 ==========

interface TraceRecordListProps {
  apiBase?: string
  /** 点击趋势分析时的回调（面板内切换） */
  onOpenTrend?: (pool: string) => void
}

export function TraceRecordList({ apiBase = '/aquasense-reports', onOpenTrend }: TraceRecordListProps): ReactNode {
  // --- 列表状态 ---
  const [records, setRecords] = useState<RecordSummary[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pool, setPool] = useState('')
  const [cls, setCls] = useState('')

  // --- 详情状态 ---
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailRecord, setDetailRecord] = useState<AnalysisRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set())

  // ---------- 列表 ----------

  const fetchPage = useCallback(async (reset: boolean): Promise<void> => {
    if (loading) return
    setLoading(true)
    const off = reset ? 0 : offset
    try {
      let url = `${apiBase}/api/records?limit=${PAGE_LIMIT}&offset=${off}`
      if (pool) url += `&pool=${encodeURIComponent(pool)}`
      if (cls) url += `&cls=${encodeURIComponent(cls)}`
      let resp: Response
      try {
        resp = await fetch(url)
      } catch (netErr) {
        throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})\n请求: ${url}`)
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}\n请求: ${url}`)
      const body = await resp.json()
      if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败\n请求: ${url}`)
      const page: RecordsPage = body.value
      const newRecords = reset ? page.records : [...records, ...page.records]
      setRecords(newRecords)
      setTotal(page.total)
      setHasMore(page.has_more)
      setOffset((reset ? 0 : offset) + page.records.length)
      setError(null)
    } catch (err) {
      setError(`加载失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [loading, offset, pool, cls, records, apiBase])

  const applyFilter = useCallback((newPool: string, newCls: string): void => {
    setPool(newPool)
    setCls(newCls)
    setRecords([])
    setOffset(0)
    setHasMore(false)
    setError(null)
    setDetailId(null)
    setDetailRecord(null)
  }, [])

  useEffect(() => {
    if (records.length === 0 && offset === 0 && !loading) {
      void fetchPage(true)
    }
  }, [pool, cls]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetchPage(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 详情 ----------

  const openDetail = useCallback(async (id: string): Promise<void> => {
    setDetailId(id)
    setDetailRecord(null)
    setDetailLoading(true)
    setDetailError(null)
    setOpenSteps(new Set())
    try {
      const url = `${apiBase}/api/records/${encodeURIComponent(id)}`
      let resp: Response
      try {
        resp = await fetch(url)
      } catch (netErr) {
        throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})\n请求: ${url}`)
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}\n请求: ${url}`)
      const body = await resp.json()
      if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败\n请求: ${url}`)
      setDetailRecord(body.value as AnalysisRecord)
    } catch (err) {
      setDetailError(`加载失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDetailLoading(false)
    }
  }, [apiBase])

  const backToList = useCallback((): void => {
    setDetailId(null)
    setDetailRecord(null)
    setDetailError(null)
  }, [])

  const toggleStep = useCallback((key: string): void => {
    setOpenSteps((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // ---------- 渲染：详情 ----------

  if (detailId) {
    return (
      <div style={S.detailWrap}>
        {detailLoading && <div style={S.empty}>加载中…</div>}
        {detailError && (
          <div style={S.err}>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{detailError}</div>
            <button type="button" style={{ ...S.moreBtn, marginTop: 8, width: 'auto', display: 'inline-block' }} onClick={backToList}>
              返回列表
            </button>
          </div>
        )}
        {detailRecord && (
          <div>
            {/* 标题行：返回 + ID + 池号 + 状态 */}
            <div style={S.detailTitle}>
              <button type="button" style={S.detailBack} onClick={backToList}>← 返回</button>
              <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>
                {detailRecord.id}
              </span>
              <span style={{ fontWeight: 600 }}>{detailRecord.pool}</span>
              <span style={{ fontWeight: 600 }}>巡检分析</span>
              {(() => {
                const cls = detailRecord.span_analyze?.cls ?? 'unknown'
                return (
                  <span style={S.statusBadge(cls)}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: CLS_COLOR[cls] || '#9ca3af' }} />
                    {CLS_LABEL[cls] || cls}
                  </span>
                )
              })()}
            </div>

            {/* 元信息区（原型图：水平布局） */}
            <div style={S.metaGrid}>
              <span style={S.metaLabel}>池号:</span>
              <span style={S.metaValue}>{detailRecord.pool}</span>
              <span style={S.metaLabel}>上报人:</span>
              <span style={S.metaValue}>{detailRecord.reporter || '—'}</span>
              <span style={S.metaLabel}>来源:</span>
              <span style={S.metaValue}>{SOURCE_LABEL[detailRecord.source] || detailRecord.source}</span>
              <span style={S.metaLabel}>时间:</span>
              <span style={S.metaValue}>{formatDateTime(detailRecord.created_at)}</span>
              <span style={S.metaLabel}>总耗时:</span>
              <span style={S.metaValue}>{durationText(detailRecord.total_duration_ms)}</span>
              <span style={S.metaLabel}>模型:</span>
              <span style={S.metaValue}>{detailRecord.model || '—'}</span>
              <span style={S.metaLabel}>Token:</span>
              <span style={S.metaValue}>input={tokenText(detailRecord.span_analyze?.input_tokens ?? 0)} output={tokenText(detailRecord.span_analyze?.output_tokens ?? 0)}</span>
            </div>

            {/* 瀑布图 */}
            <WaterfallChart record={detailRecord} />

            {/* 步骤 Accordion */}
            <div style={S.sectionTitle}>── 步骤详情（Accordion 展开）──</div>
            <div style={S.stepsWrap}>
              {SPAN_DEFS.map((def) => (
                <StepAccordion
                  key={def.key}
                  def={def}
                  record={detailRecord}
                  isOpen={openSteps.has(def.key)}
                  onToggle={() => { toggleStep(def.key) }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---------- 渲染：列表 ----------

  const groups: { title: string; items: RecordSummary[] }[] = []
  let lastKey = ''
  for (const r of records) {
    const key = dayKey(r.created_at)
    if (key !== lastKey) {
      groups.push({ title: dayLabel(r.created_at), items: [] })
      lastKey = key
    }
    groups[groups.length - 1].items.push(r)
  }

  return (
    <>
      {/* 筛选条 */}
      <div style={S.filterBar}>
        <select
          style={S.select}
          value={pool}
          onChange={(e) => { applyFilter(e.target.value, cls) }}
          aria-label="按池号筛选"
        >
          {POOL_OPTIONS.map((p) => <option key={p} value={p}>{p || '全部池号'}</option>)}
        </select>
        <select
          style={S.select}
          value={cls}
          onChange={(e) => { applyFilter(pool, e.target.value) }}
          aria-label="按状态筛选"
        >
          {CLS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', alignSelf: 'center' }}>{total} 条记录</span>
        <button
          type="button"
          style={{ ...S.trendLink, marginTop: 0 }}
          onClick={() => {
            const targetPool = pool || '池1'
            onOpenTrend?.(targetPool)
          }}
        >
          📈 池号趋势分析 →
        </button>
      </div>

      {/* 列表区 */}
      <div style={S.list}>
        {error && (
          <div style={S.err}>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{error}</div>
            <button type="button" style={{ ...S.moreBtn, marginTop: 8, width: 'auto', display: 'inline-block' }} onClick={() => { void fetchPage(true) }}>
              重试
            </button>
          </div>
        )}
        {!error && records.length === 0 && !loading && <div style={S.empty}>暂无分析记录</div>}
        {loading && records.length === 0 && <div style={S.empty}>加载中…</div>}

        {groups.map((g) => (
          <div key={g.title}>
            <div style={S.groupTitle}>{g.title}</div>
            {g.items.map((r) => {
              const clsName = CLS_LABEL[r.cls] || r.cls || '未知'
              const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常'
              return (
                <button
                  key={r.id}
                  type="button"
                  style={S.row}
                  onClick={() => { void openDetail(r.id) }}
                >
                  <div style={S.line1}>
                    <span style={S.dot(r.cls)} />
                    <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>{r.id}</span>
                    <span style={{ fontWeight: 600 }}>{r.pool}</span>
                    <span style={{ fontWeight: 600, color: CLS_COLOR[r.cls] || '#9ca3af' }}>{clsName}</span>
                    <span style={{ color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>{(r.confidence || 0).toFixed(2)}</span>
                    <span style={{ ...S.symptom, color: r.cls === 'disease' ? '#ff4d4f' : 'var(--dsw-alias-label-secondary,#7b8088)' }}>{sym}</span>
                  </div>
                  <div style={S.line2}>
                    <span>{timeText(r.created_at)}</span><span>·</span>
                    <span>{SOURCE_LABEL[r.source || ''] || r.source}</span><span>·</span>
                    <span>{r.alert_level ? 'AI视觉+知识库' : 'AI视觉'}</span><span>·</span>
                    <span>{durationText(r.total_duration_ms)}</span><span>·</span>
                    <span>{tokenText(r.total_tokens)} tokens</span>
                  </div>
                </button>
              )
            })}
          </div>
        ))}

        {/* 加载更多 */}
        {hasMore && !loading && (
          <button type="button" style={S.moreBtn} onClick={() => { void fetchPage(false) }}>
            加载更多
          </button>
        )}
        {loading && records.length > 0 && (
          <div style={{ ...S.empty, padding: '20px 0' }}>加载中…</div>
        )}
      </div>
    </>
  )
}

// ========== 趋势分析组件（面板内嵌，替代 iframe） ==========

interface TrendData {
  pool: string
  days: number
  total: number
  distribution: Record<string, number>
  top_symptoms: Array<{ symptom: string; count: number }>
  recent_records: RecordSummary[]
}

interface TraceTrendViewProps {
  pool: string
  apiBase?: string
  onBack?: () => void
}

export function TraceTrendView({ pool: initPool, apiBase = '/aquasense-reports', onBack }: TraceTrendViewProps): ReactNode {
  const [pool, setPool] = useState(initPool)
  const [pools, setPools] = useState<string[]>([initPool])
  const [data, setData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(7)

  // 加载所有记录以提取可用池号列表
  useEffect(() => {
    fetch(`${apiBase}/api/records`)
      .then((r) => r.ok ? r.json() : null)
      .then((b) => {
        if (!b?.ok) return
        const recs = (b.value as RecordSummary[]) || []
        const poolSet = new Set<string>()
        recs.forEach((r) => poolSet.add(r.pool))
        if (poolSet.size > 0) setPools(Array.from(poolSet).sort())
      })
      .catch(() => {})  // 静默失败
  }, [apiBase])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${apiBase}/api/trend/${encodeURIComponent(pool)}?days=${days}`)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.json()
      })
      .then((body) => {
        if (!body?.ok) throw new Error(body?.error?.message || '请求失败')
        setData(body.value as TrendData)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [pool, days, apiBase])

  if (loading) return <div style={{ padding: 20, color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>加载中…</div>
  if (error) return <div style={{ padding: 20, color: '#ff4d4f' }}>加载失败: {error}</div>
  if (!data) return <div style={{ padding: 20, color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>无数据</div>

  const dist = data.distribution || {}
  const total = data.total || 0
  const distOrder: Array<[string, string, string]> = [
    ['normal', '正常', '#52c41a'],
    ['early', '前兆', '#faad14'],
    ['disease', '发病', '#ff4d4f'],
    ['unknown', '未知', '#9ca3af']
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)' }}>
        <button type="button" style={{ padding: '4px 8px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 13, cursor: 'pointer' }} onClick={onBack}>
          ← 返回列表
        </button>
        {/* 水池下拉框 */}
        <select style={{ padding: '4px 8px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 6, fontSize: 13, fontWeight: 600, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)', cursor: 'pointer' }} value={pool} onChange={(e) => setPool(e.target.value)}>
          {pools.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: 14, fontWeight: 600 }}>趋势分析</span>
        <span style={{ marginLeft: 'auto' }}>
          <select style={{ padding: '4px 8px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 6, fontSize: 12, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>近7天</option>
            <option value={30}>近30天</option>
            <option value={3650}>全部</option>
          </select>
        </span>
      </div>

      <div style={{ padding: '12px 16px 32px' }}>
        {/* 概览 */}
        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 16 }}>
          近 {days} 天共 <b style={{ color: 'var(--dsw-alias-label-primary,#17191c)' }}>{total}</b> 条分析记录
        </div>

        {/* 状态分布 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 8 }}>── 状态分布 ──</div>
          <div style={{ background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, padding: 12 }}>
            {total > 0 ? distOrder.map(([key, label, color]) => {
              const n = dist[key] || 0
              const pct = Math.round(n / total * 100)
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                  <span style={{ width: 48, flexShrink: 0 }}>{label}</span>
                  <div style={{ flex: 1, height: 16, background: 'var(--dsw-alias-bg-secondary,#f0f1f3)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s' }} />
                  </div>
                  <span style={{ width: 96, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }}>{pct}% ({n}次)</span>
                </div>
              )
            }) : <div style={{ color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }}>暂无数据</div>}
          </div>
        </div>

        {/* 症状频次 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 8 }}>── 症状频次 TOP ──</div>
          <div style={{ background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, padding: 12 }}>
            {data.top_symptoms.length > 0 ? (() => {
              const max = data.top_symptoms[0]?.count || 1
              return data.top_symptoms.map((s) => (
                <div key={s.symptom} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                  <span style={{ width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.symptom}</span>
                  <div style={{ flex: 1, height: 14, background: 'var(--dsw-alias-bg-secondary,#f0f1f3)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round(s.count / max * 100)}%`, background: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 44, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }}>{s.count}次</span>
                </div>
              ))
            })() : <div style={{ color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }}>暂无异常症状记录</div>}
          </div>
        </div>

        {/* 最近记录 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 8 }}>── 最近记录 ──</div>
          <div style={{ background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, overflow: 'hidden' }}>
            {data.recent_records.length > 0 ? data.recent_records.map((r) => {
              const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常'
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e8eaed)', fontSize: 13 }}>
                  <span style={{ width: 44, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }}>{timeText(r.created_at)}</span>
                  <span style={{ width: 44, flexShrink: 0, fontWeight: 600, color: CLS_COLOR[r.cls] || '#9ca3af' }}>{CLS_LABEL[r.cls] || r.cls}</span>
                  <span style={{ width: 36, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }}>{(r.confidence || 0).toFixed(2)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>{sym}</span>
                  <span style={{ flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }}>{durationText(r.total_duration_ms)}</span>
                </div>
              )
            }) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>暂无记录</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
