/**
 * TraceRecordList —— 配置页面板内「📊 分析记录」列表(v1.3,去 iframe 化)
 *
 * 直接调用 /aquasense-reports/api/records JSON 接口,
 * 在面板内容区渲染记录列表;不再依赖 iframe 加载独立 HTML 页面,
 * 从根本上规避跨域/反向代理路径不通等问题。
 *
 * 设计:
 *  - 状态: 'list'(列表) / 'detail'(单条详情)
 *  - 筛选: 池号 / 状态,即时生效;分页用「加载更多」
 *  - 样式复用面板 CSS 变量体系,与 每日任务提醒 表单视觉一致
 *  - API 失败时显示友好提示(非 iframe 崩溃页面)
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

// ========== 数据模型 ==========

/** 单条分析记录(与 trace-store.ts AnalysisRecord 字段对齐) */
interface TraceRecord {
  id: string
  pool: string
  cls: string
  confidence: number
  symptoms: string[]
  source: string
  created_at: string
  total_duration_ms: number
  total_tokens: number
  alert_level: boolean
  /** detail-only: 完整步骤(列表接口不含) */
  steps?: unknown[]
}

/** 列表接口信封 */
interface RecordsPage {
  records: TraceRecord[]
  total: number
  has_more: boolean
}

/** 详情接口信封 = 单条 TraceRecord */

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

const CLS_LABEL: Record<string, string> = { normal: '正常', early: '前兆', disease: '发病', unknown: '未知' }
const SOURCE_LABEL: Record<string, string> = { h5_upload: 'H5上传', group_chat: '群聊发图', api: 'API' }

// ========== 内联样式(与面板 token 一致) ==========

const S = {
  /** 筛选条 */
  filterBar: { display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', flexShrink: 0 } satisfies CSSProperties,
  select: { appearance: 'none', padding: '6px 28px 6px 10px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)', fontSize: 13, lineHeight: '20px' } satisfies CSSProperties,
  /** 列表区(可滚动) */
  list: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '12px 20px 32px' } satisfies CSSProperties,
  /** 空态/加载态 */
  empty: { padding: '60px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' } satisfies CSSProperties,
  /** 日期分组标题 */
  groupTitle: { margin: '18px 0 8px', fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)' } satisfies CSSProperties,
  /** 记录行 */
  row: { display: 'block', padding: '12px 14px', color: 'inherit', textDecoration: 'none', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', cursor: 'pointer', background: 'transparent' } satisfies CSSProperties,
  /** 记录行第一行 */
  line1: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 } satisfies CSSProperties,
  /** 状态圆点 */
  dot: (cls: string): CSSProperties => ({
    flex: 'none', width: 8, height: 8, borderRadius: '50%',
    background: { normal: '#52c41a', early: '#faad14', disease: '#ff4d4f', unknown: '#9ca3af' }[cls] || '#9ca3af'
  }),
  /** 记录行第二行 */
  line2: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' } satisfies CSSProperties,
  chip: { padding: '1px 8px', borderRadius: 999, background: 'var(--dsw-alias-bg-secondary,#eef2f7)', fontSize: 12 } satisfies CSSProperties,
  /** 加载更多按钮 */
  moreBtn: { display: 'block', width: '100%', margin: '16px 0 0', padding: 10, border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer' } satisfies CSSProperties,
  /** 错误提示 */
  err: { margin: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #ff4d4f', background: 'var(--dsw-alias-bg-layer-3,#fff)', color: '#ff4d4f', fontSize: 13 } satisfies CSSProperties,
  /** 详情容器 */
  detailWrap: { padding: '16px 20px 32px' } satisfies CSSProperties,
  detailBack: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer', marginBottom: 12 } satisfies CSSProperties,
  detailGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', fontSize: 14 } satisfies CSSProperties,
  detailLabel: { color: 'var(--dsw-alias-label-secondary,#7b8088)', whiteSpace: 'nowrap' } satisfies CSSProperties,
  detailValue: { color: 'var(--dsw-alias-label-primary,#17191c)', wordBreak: 'break-all' } satisfies CSSProperties,
} as const

// ========== 辅助 ==========

function esc(v: unknown): string {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c] ?? c
  )
}

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

// ========== 组件 ==========

interface TraceRecordListProps {
  /** API 前缀(默认 /aquasense-reports) */
  apiBase?: string
}

export function TraceRecordList({ apiBase = '/aquasense-reports' }: TraceRecordListProps): ReactNode {
  // --- 列表状态 ---
  const [records, setRecords] = useState<TraceRecord[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pool, setPool] = useState('')
  const [cls, setCls] = useState('')

  // --- 详情状态 ---
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailRecord, setDetailRecord] = useState<TraceRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // ---------- 列表数据加载 ----------

  /** 获取记录列表;错误信息区分网络/HTTP/信封三类 */
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
        // 网络层错误:连接被拒/DNS 失败/CORS 等
        throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})
请求: ${url}`)
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}
请求: ${url}`)
      const body = await resp.json()
      if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败
请求: ${url}`)
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

  /** 筛选变更 → 重置列表 */
  const applyFilter = useCallback((newPool: string, newCls: string): void => {
    setPool(newPool)
    setCls(newCls)
    setRecords([])
    setOffset(0)
    setHasMore(false)
    setError(null)
    setDetailId(null)
    setDetailRecord(null)
    // 下一帧触发加载(useEffect 监听依赖变化)
  }, [])

  /** pool/cls 变化后自动加载重置列表 */
  useEffect(() => {
    // 避免首次重复加载(由下方 initial effect 触发)
    if (records.length === 0 && offset === 0 && !loading) {
      void fetchPage(true)
    }
  }, [pool, cls]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 首次挂载加载 */
  useEffect(() => {
    void fetchPage(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 详情数据 ----------

  /** 获取详情;错误信息区分网络/HTTP/信封三类 */
  const openDetail = useCallback(async (id: string): Promise<void> => {
    setDetailId(id)
    setDetailRecord(null)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const url = `${apiBase}/api/records/${encodeURIComponent(id)}`
      let resp: Response
      try {
        resp = await fetch(url)
      } catch (netErr) {
        throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})
请求: ${url}`)
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}
请求: ${url}`)
      const body = await resp.json()
      if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败
请求: ${url}`)
      setDetailRecord(body.value as TraceRecord)
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

  // ---------- 渲染:详情 ----------

  if (detailId) {
    return (
      <div style={S.detailWrap}>
        <button type="button" style={S.detailBack} onClick={backToList}>← 返回列表</button>
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
            <div style={S.detailGrid}>
              <span style={S.detailLabel}>记录 ID</span><span style={S.detailValue}>{detailRecord.id}</span>
              <span style={S.detailLabel}>池号</span><span style={S.detailValue}>{detailRecord.pool}</span>
              <span style={S.detailLabel}>状态</span><span style={S.detailValue}>{CLS_LABEL[detailRecord.cls] || detailRecord.cls}</span>
              <span style={S.detailLabel}>置信度</span><span style={S.detailValue}>{(detailRecord.confidence || 0).toFixed(2)}</span>
              <span style={S.detailLabel}>症状</span><span style={S.detailValue}>{detailRecord.symptoms?.join('、') || '无异常'}</span>
              <span style={S.detailLabel}>来源</span><span style={S.detailValue}>{SOURCE_LABEL[detailRecord.source || ''] || detailRecord.source}</span>
              <span style={S.detailLabel}>知识库增强</span><span style={S.detailValue}>{detailRecord.alert_level ? '是' : '否'}</span>
              <span style={S.detailLabel}>耗时</span><span style={S.detailValue}>{durationText(detailRecord.total_duration_ms)}</span>
              <span style={S.detailLabel}>Token</span><span style={S.detailValue}>{tokenText(detailRecord.total_tokens)}</span>
              <span style={S.detailLabel}>创建时间</span><span style={S.detailValue}>{new Date(detailRecord.created_at).toLocaleString('zh-CN')}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---------- 渲染:列表 ----------

  // 按日期分组
  const groups: { title: string; items: TraceRecord[] }[] = []
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
                    <span style={{ fontWeight: 600, color: { normal: '#52c41a', early: '#faad14', disease: '#ff4d4f', unknown: '#9ca3af' }[r.cls] || '#9ca3af' }}>{clsName}</span>
                    <span style={{ color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>{(r.confidence || 0).toFixed(2)}</span>
                    <span style={{ flex: '1 1 100%', color: r.cls === 'disease' ? '#ff4d4f' : 'var(--dsw-alias-label-secondary,#7b8088)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sym}</span>
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
