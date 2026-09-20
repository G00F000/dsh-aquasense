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
  /** 群聊 Agent 重试次数汇总(v1.8;>0 时显示 🔁 角标) */
  agent_retries?: number
  /** 重试最多的工具名(角标文案) */
  agent_retry_tool?: string
}

/** Agent 决策链(v1.8,会话事件桥接采集;缺失时前端隐藏区块) */
interface AgentTraceData {
  turn: number
  step: number
  think_ms: number
  calls: Array<{
    tool: 'aquasense_analyze' | 'aquasense_advice' | 'aquasense_ledger'
    call_id: string
    attempt: number
    duration_ms: number
    status: 'ok' | 'error'
    error_code?: string
  }>
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
  /** Agent 决策链(v1.8,仅群聊记录;数据来自会话事件桥接) */
  agent?: AgentTraceData
  /** 工人发送的图片(详情接口附加,已落盘缓存目录) */
  images?: Array<{ index: number; fileName: string; mimeType: string; size: number; url: string }>
}

/** 列表接口信封 */
interface RecordsPage {
  records: RecordSummary[]
  total: number
  has_more: boolean
}

// ========== 常量 ==========

const PAGE_LIMIT = 20

/** 池号兜底枚举(/api/pools 不可用时,与设置页默认一致) */
const FALLBACK_POOLS = ['池1', '池2', '池3', '池4']
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

// ========== 视觉增强样式(.trc-* 类,注入一次) ==========

const TRACE_STYLE_ID = 'aquasense-trace-style'

/**
 * 分析记录页静态样式(类名 trc- 前缀):布局/hover/动画收敛于此;
 * 动态颜色(状态色、瀑布图渐变)由内联样式提供。令牌沿用 DSH
 * --dsw-alias-* 体系并保留亮色 fallback,兼容宿主暗色主题。
 */
const TRACE_CSS = `
/* 筛选条 */
.trc-filterbar{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);flex-shrink:0;background:var(--dsw-alias-bg-base,#fff)}
.trc-select-wrap{position:relative;display:inline-flex;flex:none;min-width:0}
.trc-select{appearance:none;width:100%;padding:7px 30px 7px 12px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#17191c);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease}
.trc-select:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe)}
.trc-select:focus-visible{outline:none;border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 0 0 3px rgba(77,107,254,.16)}
.trc-select-caret{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary,#7b8088);pointer-events:none}
.trc-count{display:inline-flex;align-items:center;margin-left:auto;padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-secondary,#f0f2f5);color:var(--dsw-alias-label-secondary,#7b8088);font-size:12px;white-space:nowrap;flex:none}
.trc-trend-btn{display:inline-flex;align-items:center;gap:5px;flex:none;padding:7px 14px;border:0;border-radius:10px;background:linear-gradient(135deg,#4d6bfe 0%,#7c5cf6 100%);color:#fff;font:inherit;font-size:13px;font-weight:600;line-height:20px;cursor:pointer;box-shadow:0 4px 14px rgba(77,107,254,.3);transition:box-shadow .18s ease,transform .18s ease,filter .18s ease}
.trc-trend-btn:hover{box-shadow:0 6px 20px rgba(77,107,254,.45);transform:translateY(-1px);filter:saturate(1.12)}
.trc-trend-btn:active{transform:translateY(0);box-shadow:0 2px 8px rgba(77,107,254,.3)}
/* 列表区 */
.trc-list{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px 32px}
.trc-group-title{display:flex;align-items:center;gap:8px;margin:20px 2px 10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-group-title::after{content:'';flex:1;height:1px;background:var(--dsw-alias-border-l2,#e8eaed)}
/* 记录卡片 */
.trc-row{display:block;width:100%;box-sizing:border-box;margin-bottom:10px;padding:14px 16px;text-align:left;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.trc-row:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 8px 24px rgba(77,107,254,.14);transform:translateY(-1px)}
.trc-row:active{transform:translateY(0)}
.trc-line1{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}
.trc-line2{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-dot{flex:none;width:9px;height:9px;border-radius:50%;animation:trc-pulse 2.4s ease-in-out infinite}
@keyframes trc-pulse{0%,100%{opacity:1}50%{opacity:.55}}
.trc-idchip{display:inline-flex;align-items:center;padding:2px 10px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f0f2f5);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 9px;border-radius:999px;font-size:11px;font-weight:700;line-height:18px;flex:none}
.trc-badge-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.trc-symptom{flex:1 1 0;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
/* 空态 / 加载态 / 错误 */
.trc-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:64px 0;text-align:center;color:var(--dsw-alias-label-secondary,#7b8088);font-size:13px}
.trc-empty-icon{font-size:44px;line-height:1;animation:trc-float 3s ease-in-out infinite;filter:drop-shadow(0 6px 12px rgba(77,107,254,.2))}
@keyframes trc-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.trc-spin{width:22px;height:22px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,#e2e4e8);border-top-color:var(--dsw-alias-button-primary-fill,#4d6bfe);animation:trc-spin .7s linear infinite}
@keyframes trc-spin{to{transform:rotate(360deg)}}
.trc-err{margin:4px 0 12px;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-state-error-primary,#ff4d4f);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-state-error-primary,#ff4d4f);font-size:13px}
.trc-more-btn{display:block;width:100%;margin:16px 0 0;padding:10px;border:1px solid transparent;border-radius:12px;background:linear-gradient(var(--dsw-alias-bg-layer-3,#fff),var(--dsw-alias-bg-layer-3,#fff)) padding-box,linear-gradient(135deg,#4d6bfe,#7c5cf6) border-box;color:var(--dsw-alias-button-primary-fill,#4d6bfe);font:inherit;font-size:14px;cursor:pointer;transition:box-shadow .16s ease,transform .16s ease}
.trc-more-btn:hover{box-shadow:0 4px 14px rgba(77,107,254,.18);transform:translateY(-1px)}
/* ===== 详情态 ===== */
.trc-detail{flex:1;overflow:auto;padding:16px 20px 36px;animation:trc-fade-up .28s ease}
@keyframes trc-fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.trc-back{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-button-primary-fill,#4d6bfe);font:inherit;font-size:13px;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease}
.trc-back:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 2px 10px rgba(77,107,254,.14)}
.trc-title{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:15px;font-weight:600;margin-bottom:16px}
.trc-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px}
.trc-meta-item{display:flex;align-items:baseline;gap:8px;min-width:0;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);font-size:13px;transition:border-color .16s ease}
.trc-meta-item:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe)}
.trc-meta-label{flex:none;color:var(--dsw-alias-label-secondary,#7b8088);white-space:nowrap}
.trc-meta-value{color:var(--dsw-alias-label-primary,#17191c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trc-section-title{display:flex;align-items:center;gap:8px;margin:22px 0 12px;font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#17191c)}
.trc-section-title::after{content:'';flex:1;height:1px;background:var(--dsw-alias-border-l2,#e8eaed)}
/* 瀑布图 */
.trc-wf{display:flex;flex-direction:column;gap:6px}
.trc-wf-row{display:flex;align-items:center;gap:10px}
.trc-wf-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:9px;font-size:14px}
.trc-wf-label{width:110px;flex:none;font-size:12px;color:var(--dsw-alias-label-primary,#17191c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trc-wf-track{flex:1 1 auto;height:20px;border-radius:999px;background:var(--dsw-alias-bg-secondary,#f0f1f3);position:relative;overflow:hidden}
.trc-wf-bar{position:absolute;top:0;left:0;height:100%;border-radius:999px;transition:width .5s cubic-bezier(.22,.61,.36,1)}
.trc-wf-dur{width:46px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088);text-align:right}
.trc-wf-status{width:20px;flex:none;font-size:12px;text-align:center}
/* 步骤 Accordion */
.trc-steps{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
.trc-step{border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s ease,box-shadow .16s ease}
.trc-step:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 2px 12px rgba(77,107,254,.1)}
.trc-step-head{display:flex;align-items:center;gap:10px;width:100%;padding:11px 14px;border:0;background:transparent;cursor:pointer;font:inherit;font-size:13px;text-align:left;color:var(--dsw-alias-label-primary,#17191c)}
.trc-step-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border-radius:8px;font-size:13px}
.trc-step-arrow{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary,#7b8088);transition:transform .2s ease}
.trc-step-right{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-step-body{padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-secondary,#f9fafb);font-size:13px;animation:trc-fade-up .2s ease}
.trc-step-field{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px}
.trc-step-label{color:var(--dsw-alias-label-secondary,#7b8088);white-space:nowrap}
.trc-step-value{color:var(--dsw-alias-label-primary,#17191c);word-break:break-all;white-space:pre-wrap}
.trc-excerpt{padding:8px 12px;margin-bottom:4px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e8eaed)}
.trc-excerpt-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#17191c);margin-bottom:2px}
.trc-excerpt-meta{font-size:11px;color:var(--dsw-alias-label-secondary,#7b8088);margin-bottom:2px}
.trc-excerpt-text{font-size:12px;color:var(--dsw-alias-label-secondary,#555);font-style:italic}
/* ===== 趋势态 ===== */
.trc-trend-top{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-base,#fff)}
.trc-trend-body{padding:16px 20px 36px;animation:trc-fade-up .28s ease}
.trc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:20px}
.trc-kpi{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.trc-kpi:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 4px 16px rgba(77,107,254,.12);transform:translateY(-1px)}
.trc-kpi-num{font-size:24px;font-weight:700;line-height:1.1}
.trc-kpi-label{font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-card{padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);margin-bottom:20px}
.trc-bar-row{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px}
.trc-bar-track{flex:1;height:16px;border-radius:999px;background:var(--dsw-alias-bg-secondary,#f0f1f3);overflow:hidden}
.trc-bar{height:100%;border-radius:999px;transition:width .5s cubic-bezier(.22,.61,.36,1)}
.trc-back-link{display:inline-flex;align-items:center;gap:4px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-button-primary-fill,#4d6bfe);font:inherit;font-size:13px;cursor:pointer;transition:background .16s ease}
.trc-back-link:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
/* ===== 现场照片(详情页) ===== */
.trc-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.trc-photo{position:relative;aspect-ratio:1/1;padding:0;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-secondary,#f0f1f3);cursor:zoom-in;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.trc-photo:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 4px 14px rgba(77,107,254,.18);transform:translateY(-1px)}
.trc-photo img{display:block;width:100%;height:100%;object-fit:cover}
.trc-photo-idx{position:absolute;left:6px;bottom:6px;padding:1px 7px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:16px}
.trc-lightbox{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.82);animation:trc-fade-up .18s ease;cursor:zoom-out}
.trc-lightbox img{max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.5)}
.trc-lightbox-close{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:16px;cursor:pointer;transition:background .16s ease}
.trc-lightbox-close:hover{background:rgba(255,255,255,.32)}
.trc-lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer;transition:background .16s ease}
.trc-lightbox-nav:hover{background:rgba(255,255,255,.32)}
.trc-lightbox-nav.prev{left:14px}.trc-lightbox-nav.next{right:14px}
`

/** 注入分析记录页样式(幂等,SSR 安全) */
export function ensureTraceStyle(): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById(TRACE_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = TRACE_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = TRACE_CSS
}

// ========== 内联样式(仅动态颜色;布局/hover/动画由 .trc-* 类提供) ==========

const S = {
  /** 状态圆点:发光 + 呼吸动画(类 .trc-dot) */
  dot: (cls: string): CSSProperties => ({
    background: CLS_COLOR[cls] || '#9ca3af',
    boxShadow: `0 0 8px ${CLS_COLOR[cls] || '#9ca3af'}`
  }),
  /** 状态徽章:半透明底 + 发光(类 .trc-badge 提供 pill 布局) */
  badge: (cls: string): CSSProperties => {
    const color = CLS_COLOR[cls] || '#9ca3af'
    return { background: color + '1a', color, boxShadow: `0 0 10px ${color}40` }
  },
  /** 瀑布图条:渐变 + 发光(类 .trc-wf-bar 提供定位/动画) */
  wfBar: (color: string, pct: number): CSSProperties => ({
    width: `${Math.max(pct, 2)}%`,
    background: `linear-gradient(90deg, ${color}, ${color}b3)`,
    boxShadow: `0 0 10px ${color}66`
  }),
  /** 图标圆底(类 .trc-wf-icon / .trc-step-icon 提供尺寸圆角) */
  iconBg: (color: string): CSSProperties => ({ background: color + '1c' }),
  /** 趋势分布条:渐变 + 发光(类 .trc-bar 提供动画) */
  bar: (color: string, pct: number): CSSProperties => ({
    width: `${pct}%`,
    background: `linear-gradient(90deg, ${color}66, ${color})`,
    boxShadow: `0 0 10px ${color}55`
  }),
  /** 症状 TOP 条:主色渐变 */
  barAccent: (pct: number): CSSProperties => ({
    width: `${pct}%`,
    background: 'linear-gradient(90deg, #4d6bfe, #8b5cf6)',
    boxShadow: '0 0 10px rgba(77,107,254,.4)'
  })
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

/** Agent 决策链工具元信息(v1.8 详情态区块;未知工具降级灰图标) */
const AGENT_TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  aquasense_analyze: { icon: '🧠', label: 'AI 视觉分析', color: '#1677ff' },
  aquasense_advice: { icon: '💡', label: '处置建议生成', color: '#52c41a' },
  aquasense_ledger: { icon: '📝', label: '台账写入', color: '#722ed1' }
}

/** Agent 决策链区块(v1.8,仅群聊记录;数据来自 DSH 会话事件,agent 缺失时自动隐藏) */
function AgentChain({ agent }: { agent?: AgentTraceData }): ReactNode {
  if (!agent || agent.calls.length === 0) return null
  const total = Math.max(agent.think_ms, ...agent.calls.map((c) => c.duration_ms), 1)
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="trc-section-title">
        Agent 决策链
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>
          （turn {agent.turn} · step {agent.step} · 会话事件自动记录）
        </span>
      </div>
      <div className="trc-wf">
        <div className="trc-wf-row">
          <span className="trc-wf-icon" style={S.iconBg('#8c8c8c')}>🔄</span>
          <span className="trc-wf-label">Agent 思考</span>
          <div className="trc-wf-track">
            <div className="trc-wf-bar" style={S.wfBar('#8c8c8c', (agent.think_ms / total) * 100)} />
          </div>
          <span className="trc-wf-dur">{durationText(agent.think_ms)}</span>
          <span className="trc-wf-status">—</span>
        </div>
        {agent.calls.map((call) => {
          const meta = AGENT_TOOL_META[call.tool] ?? { icon: '🔧', label: call.tool, color: '#9ca3af' }
          return (
            <div key={`${call.call_id}-${call.attempt}`}>
              <div className="trc-wf-row">
                <span className="trc-wf-icon" style={S.iconBg(meta.color)}>{meta.icon}</span>
                <span className="trc-wf-label">{meta.label}</span>
                <div className="trc-wf-track">
                  <div
                    className="trc-wf-bar"
                    style={S.wfBar(call.status === 'error' ? '#ff4d4f' : meta.color, (call.duration_ms / total) * 100)}
                  />
                </div>
                <span className="trc-wf-dur">{durationText(call.duration_ms)}</span>
                <span className="trc-wf-status">{call.status === 'ok' ? '✅' : '❌'}</span>
              </div>
              {call.attempt > 1 && (
                <div style={{ margin: '-2px 0 6px 128px', fontSize: 11, color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>
                  🔁 第 {call.attempt} 次尝试{call.error_code ? `（前次失败: ${call.error_code}）` : ''} · call {call.call_id}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>
        数据来源: DSH 会话事件边界（工具内部 Token/知识库命中明细见下方步骤详情）
      </div>
    </div>
  )
}

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
    <div style={{ marginBottom: 20 }}>
      <div className="trc-section-title">瀑布图 · Trace Timeline</div>
      <div className="trc-wf">
        {spans.map((s) => (
          <div key={s.key} className="trc-wf-row">
            <span className="trc-wf-icon" style={S.iconBg(s.color)}>{s.icon}</span>
            <span className="trc-wf-label">{s.label}</span>
            <div className="trc-wf-track">
              <div className="trc-wf-bar" style={S.wfBar(s.color, (s.duration / total) * 100)} />
            </div>
            <span className="trc-wf-dur">{durationText(s.duration)}</span>
            <span className="trc-wf-status">{s.data?.error ? '❌' : (s.duration > 0 ? '✅' : '—')}</span>
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
    <div className="trc-step">
      <button type="button" className="trc-step-head" onClick={onToggle}>
        <span className="trc-step-icon" style={S.iconBg(def.color)}>{def.icon}</span>
        <span style={{ fontWeight: 600 }}>{def.label}</span>
        <span className="trc-step-right">
          <span>{durationText(dur)}</span>
          <span>{data?.error ? '❌' : (dur > 0 ? '✅' : '—')}</span>
          <span className="trc-step-arrow" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}>▶</span>
        </span>
      </button>
      {isOpen && data && (
        <div className="trc-step-body">
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
    <div className="trc-step-field">
      <span className="trc-step-label">输入</span>
      <span className="trc-step-value">{imageCount} 张图片</span>
      {sizes.map((size, i) => (
        <>
          <span key={`k${i}`} className="trc-step-label"> </span>
          <span key={`v${i}`} className="trc-step-value">
            🐟 {names[i] || `image_${String(i + 1).padStart(3, '0')}`}
            {' '}({formatBytes(size)}{compressed[i] ? ` → ${formatBytes(compressed[i])}` : ''})
          </span>
        </>
      ))}
      <span className="trc-step-label">输出</span>
      <span className="trc-step-value">{imageCount} 张图片已压缩并转为 base64</span>
      {err && (
        <>
          <span className="trc-step-label" style={{ color: '#ff4d4f' }}>错误</span>
          <span className="trc-step-value" style={{ color: '#ff4d4f' }}>{err}</span>
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
    <div className="trc-step-field">
      <span className="trc-step-label">模型</span>
      <span className="trc-step-value">{record?.model || '—'} (temperature=0.1)</span>
      <span className="trc-step-label">输入</span>
      <span className="trc-step-value">system prompt ({promptLen} chars) + 图片</span>
      <span className="trc-step-label">输出</span>
      <span className="trc-step-value">
        状态: {CLS_LABEL[cls] || cls}（{cls}）
        {'\n'}置信度: {confidence.toFixed(2)}
        {'\n'}症状: {symptoms.length > 0 ? symptoms.join('、') : '无异常'}
        {severity ? `\n严重度: ${severity}` : ''}
        {organs.length > 0 ? `\n器官: ${organs.join('、')}` : ''}
      </span>
      <span className="trc-step-label">Token</span>
      <span className="trc-step-value">input={tokenText(inputTok)} output={tokenText(outputTok)}</span>
      {raw && (
        <>
          <span className="trc-step-label">原始输出</span>
          <span className="trc-step-value">{raw}</span>
        </>
      )}
      {err && (
        <>
          <span className="trc-step-label" style={{ color: '#ff4d4f' }}>错误</span>
          <span className="trc-step-value" style={{ color: '#ff4d4f' }}>{err}</span>
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
    <div className="trc-step-field">
      <span className="trc-step-label">查询</span>
      <span className="trc-step-value">"{query}"</span>
      <span className="trc-step-label">通道A (wiki)</span>
      <span className="trc-step-value">命中 {chA} 条</span>
      <span className="trc-step-label">通道B (note)</span>
      <span className="trc-step-value">命中 {chB} 条</span>
      <span className="trc-step-label">通道C (PDF)</span>
      <span className="trc-step-value">命中 {chC} 条</span>
      <span className="trc-step-label">合并去重</span>
      <span className="trc-step-value">{merged} 条</span>
      {excerpts.length > 0 && (
        <>
          <span className="trc-step-label">命中条目</span>
          <span className="trc-step-value">
            {excerpts.map((ex, i) => (
              <div key={i} className="trc-excerpt">
                <div className="trc-excerpt-title">📄 《{ex.title}》{ex.from ? `[${fromLabel(ex.from)}]` : ''}</div>
                {ex.locator && <div className="trc-excerpt-meta">{ex.locator}</div>}
                <div className="trc-excerpt-text">「{ex.excerpt_preview}」</div>
              </div>
            ))}
          </span>
        </>
      )}
      {err && (
        <>
          <span className="trc-step-label" style={{ color: '#ff4d4f' }}>错误</span>
          <span className="trc-step-value" style={{ color: '#ff4d4f' }}>{err}</span>
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
    <div className="trc-step-field">
      <span className="trc-step-label">预警级别</span>
      <span className="trc-step-value">{alertLevel || '—'}</span>
      <span className="trc-step-label">知识来源</span>
      <span className="trc-step-value">{refsCount} 条</span>
      <span className="trc-step-label">诊断</span>
      <span className="trc-step-value">{diagnosis || '—'}</span>
      <span className="trc-step-label">推理</span>
      <span className="trc-step-value">{reasoning || '—'}</span>
      {err && (
        <>
          <span className="trc-step-label" style={{ color: '#ff4d4f' }}>错误</span>
          <span className="trc-step-value" style={{ color: '#ff4d4f' }}>{err}</span>
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
    <div className="trc-step-field">
      <span className="trc-step-label">目标表</span>
      <span className="trc-step-value">{table || '—'}</span>
      <span className="trc-step-label">操作</span>
      <span className="trc-step-value">{op === 'create' ? '新增' : op === 'update' ? '更新' : op || '—'}</span>
      {recId && (
        <>
          <span className="trc-step-label">记录ID</span>
          <span className="trc-step-value">{recId}</span>
        </>
      )}
      {success !== undefined && (
        <>
          <span className="trc-step-label">结果</span>
          <span className="trc-step-value">{success ? '✅ 成功' : '❌ 失败'}</span>
        </>
      )}
      {message && (
        <>
          <span className="trc-step-label">信息</span>
          <span className="trc-step-value">{message}</span>
        </>
      )}
      {err && (
        <>
          <span className="trc-step-label" style={{ color: '#ff4d4f' }}>错误</span>
          <span className="trc-step-value" style={{ color: '#ff4d4f' }}>{err}</span>
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

  useEffect(() => {
    ensureTraceStyle()
  }, [])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pool, setPool] = useState('')
  const [cls, setCls] = useState('')
  /** 池号枚举(设置页「AquaSense 设置」配置;/api/pools 拉取失败时兜底默认 4 池) */
  const [pools, setPools] = useState<string[]>(FALLBACK_POOLS)

  // --- 详情状态 ---
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailRecord, setDetailRecord] = useState<AnalysisRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set())
  /** 灯箱预览的图片序号(null=关闭) */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

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

  // 挂载时拉取池号枚举(失败静默保持默认,筛选器仍可用)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const resp = await fetch(`${apiBase}/api/pools`)
        if (!resp.ok) return
        const body = await resp.json()
        const value = Array.isArray(body?.value?.pools) ? (body.value.pools as unknown[]) : []
        if (!cancelled && value.length > 0) {
          setPools(value.filter((item): item is string => typeof item === 'string'))
        }
      } catch {
        /* 保持默认枚举 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBase])

  // ---------- 详情 ----------

  const openDetail = useCallback(async (id: string): Promise<void> => {
    setDetailId(id)
    setDetailRecord(null)
    setDetailLoading(true)
    setDetailError(null)
    setOpenSteps(new Set())
    setPreviewIndex(null)
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
    setPreviewIndex(null)
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
      <div className="trc-detail">
        {detailLoading && (
          <div className="trc-empty">
            <span className="trc-spin" />
            <span>加载中…</span>
          </div>
        )}
        {detailError && (
          <div className="trc-err">
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{detailError}</div>
            <button type="button" className="trc-more-btn" style={{ marginTop: 8, width: 'auto', display: 'inline-block', padding: '6px 14px', fontSize: 13 }} onClick={backToList}>
              返回列表
            </button>
          </div>
        )}
        {detailRecord && (
          <div>
            {/* 标题行：返回 + ID + 池号 + 状态 */}
            <div className="trc-title">
              <button type="button" className="trc-back" onClick={backToList}>← 返回</button>
              <span className="trc-idchip">{detailRecord.id}</span>
              <span style={{ fontWeight: 600 }}>{detailRecord.pool}</span>
              <span style={{ fontWeight: 600 }}>巡检分析</span>
              {(() => {
                const cls = detailRecord.span_analyze?.cls ?? 'unknown'
                return (
                  <span className="trc-badge" style={S.badge(cls)}>
                    <span className="trc-badge-dot" />
                    {CLS_LABEL[cls] || cls}
                  </span>
                )
              })()}
            </div>

            {/* 元信息区（卡片网格，Token 项横跨整行） */}
            <div className="trc-meta-grid">
              <div className="trc-meta-item">
                <span className="trc-meta-label">池号:</span>
                <span className="trc-meta-value">{detailRecord.pool}</span>
              </div>
              <div className="trc-meta-item">
                <span className="trc-meta-label">上报人:</span>
                <span className="trc-meta-value">{detailRecord.reporter || '—'}</span>
              </div>
              <div className="trc-meta-item">
                <span className="trc-meta-label">来源:</span>
                <span className="trc-meta-value">{SOURCE_LABEL[detailRecord.source] || detailRecord.source}</span>
              </div>
              <div className="trc-meta-item">
                <span className="trc-meta-label">时间:</span>
                <span className="trc-meta-value">{formatDateTime(detailRecord.created_at)}</span>
              </div>
              <div className="trc-meta-item">
                <span className="trc-meta-label">总耗时:</span>
                <span className="trc-meta-value">{durationText(detailRecord.total_duration_ms)}</span>
              </div>
              <div className="trc-meta-item">
                <span className="trc-meta-label">模型:</span>
                <span className="trc-meta-value">{detailRecord.model || '—'}</span>
              </div>
              <div className="trc-meta-item" style={{ gridColumn: '1 / -1' }}>
                <span className="trc-meta-label">Token:</span>
                <span className="trc-meta-value">input={tokenText(detailRecord.span_analyze?.input_tokens ?? 0)} output={tokenText(detailRecord.span_analyze?.output_tokens ?? 0)}</span>
              </div>
              {detailRecord.agent && (
                <div className="trc-meta-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="trc-meta-label">Agent:</span>
                  <span className="trc-meta-value">
                    turn {detailRecord.agent.turn} · step {detailRecord.agent.step} · 工具 {detailRecord.agent.calls.length} 次
                    {(() => {
                      const retries = detailRecord.agent.calls.reduce((n, c) => n + Math.max(0, c.attempt - 1), 0)
                      return retries > 0 ? ` · 重试 ${retries} 次` : ''
                    })()}
                  </span>
                </div>
              )}
            </div>

            {/* Agent 决策链(v1.8,仅群聊记录;agent 缺失时组件自动隐藏) */}
            <AgentChain agent={detailRecord.agent} />

            {/* 现场照片(工人发送的图片,已落盘缓存目录) */}
            {detailRecord.images && detailRecord.images.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div className="trc-section-title">现场照片 · {detailRecord.images.length} 张</div>
                <div className="trc-photos">
                  {detailRecord.images.map((img, i) => (
                    <button
                      key={img.index}
                      type="button"
                      className="trc-photo"
                      onClick={() => { setPreviewIndex(i) }}
                      aria-label={`查看第 ${i + 1} 张现场照片`}
                    >
                      <img src={img.url} alt={`现场照片 ${i + 1}`} loading="lazy" />
                      <span className="trc-photo-idx">{i + 1}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 瀑布图 */}
            <WaterfallChart record={detailRecord} />

            {/* 步骤 Accordion */}
            <div className="trc-section-title">步骤详情</div>
            <div className="trc-steps">
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

        {/* 图片灯箱(点击缩略图打开,左右切换/点击关闭) */}
        {previewIndex !== null && detailRecord?.images && detailRecord.images[previewIndex] && (
          <div
            className="trc-lightbox"
            role="dialog"
            aria-modal="true"
            onClick={() => { setPreviewIndex(null) }}
          >
            <button
              type="button"
              className="trc-lightbox-close"
              onClick={(e) => { e.stopPropagation(); setPreviewIndex(null) }}
              aria-label="关闭预览"
            >
              ✕
            </button>
            {previewIndex > 0 && (
              <button
                type="button"
                className="trc-lightbox-nav prev"
                onClick={(e) => { e.stopPropagation(); setPreviewIndex(previewIndex - 1) }}
                aria-label="上一张"
              >
                ‹
              </button>
            )}
            <img
              src={detailRecord.images[previewIndex].url}
              alt={`现场照片 ${previewIndex + 1}`}
              onClick={(e) => { e.stopPropagation() }}
            />
            {previewIndex < detailRecord.images.length - 1 && (
              <button
                type="button"
                className="trc-lightbox-nav next"
                onClick={(e) => { e.stopPropagation(); setPreviewIndex(previewIndex + 1) }}
                aria-label="下一张"
              >
                ›
              </button>
            )}
            <span style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,.85)', fontSize: 13 }}>
              {previewIndex + 1} / {detailRecord.images.length}
            </span>
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
      <div className="trc-filterbar">
        <span className="trc-select-wrap">
          <select
            className="trc-select"
            value={pool}
            onChange={(e) => { applyFilter(e.target.value, cls) }}
            aria-label="按池号筛选"
          >
            {['', ...pools].map((p) => <option key={p} value={p}>{p || '全部池号'}</option>)}
          </select>
          <span className="trc-select-caret">▾</span>
        </span>
        <span className="trc-select-wrap">
          <select
            className="trc-select"
            value={cls}
            onChange={(e) => { applyFilter(pool, e.target.value) }}
            aria-label="按状态筛选"
          >
            {CLS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="trc-select-caret">▾</span>
        </span>
        <span className="trc-count">{total} 条记录</span>
        <button
          type="button"
          className="trc-trend-btn"
          onClick={() => {
            const targetPool = pool || pools[0] || '池1'
            onOpenTrend?.(targetPool)
          }}
        >
          📈 池号趋势分析 →
        </button>
      </div>

      {/* 列表区 */}
      <div className="trc-list">
        {error && (
          <div className="trc-err">
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{error}</div>
            <button type="button" className="trc-more-btn" style={{ marginTop: 8, width: 'auto', display: 'inline-block', padding: '6px 14px', fontSize: 13 }} onClick={() => { void fetchPage(true) }}>
              重试
            </button>
          </div>
        )}
        {!error && records.length === 0 && !loading && (
          <div className="trc-empty">
            <span className="trc-empty-icon">🐟</span>
            <span>暂无分析记录</span>
          </div>
        )}
        {loading && records.length === 0 && (
          <div className="trc-empty">
            <span className="trc-spin" />
            <span>加载中…</span>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.title}>
            <div className="trc-group-title">{g.title}</div>
            {g.items.map((r) => {
              const clsName = CLS_LABEL[r.cls] || r.cls || '未知'
              const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常'
              return (
                <button
                  key={r.id}
                  type="button"
                  className="trc-row"
                  onClick={() => { void openDetail(r.id) }}
                >
                  <div className="trc-line1">
                    <span className="trc-dot" style={S.dot(r.cls)} />
                    <span className="trc-idchip">{r.id}</span>
                    <span style={{ fontWeight: 600 }}>{r.pool}</span>
                    <span className="trc-badge" style={S.badge(r.cls)}>
                      <span className="trc-badge-dot" />
                      {clsName}
                    </span>
                    <span style={{ color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }}>{(r.confidence || 0).toFixed(2)}</span>
                    <span className="trc-symptom" style={{ color: r.cls === 'disease' ? '#ff4d4f' : 'var(--dsw-alias-label-secondary,#7b8088)' }}>{sym}</span>
                  </div>
                  <div className="trc-line2">
                    <span>{timeText(r.created_at)}</span><span>·</span>
                    <span>{SOURCE_LABEL[r.source || ''] || r.source}</span><span>·</span>
                    {r.agent_retries !== undefined && (
                      <span className="trc-badge" style={{ background: '#4d6bfe1a', color: '#4d6bfe', fontWeight: 600 }}>
                        Agent链路
                      </span>
                    )}
                    <span>{r.alert_level ? 'AI视觉+知识库' : 'AI视觉'}</span><span>·</span>
                    <span>{durationText(r.total_duration_ms)}</span><span>·</span>
                    {r.agent_retries !== undefined && r.agent_retries > 0 && (
                      <span>🔁 {(r.agent_retry_tool || 'tool').replace(/^aquasense_/, '')} ×{r.agent_retries}</span>
                    )}
                    <span>{tokenText(r.total_tokens)} tokens</span>
                  </div>
                </button>
              )
            })}
          </div>
        ))}

        {/* 加载更多 */}
        {hasMore && !loading && (
          <button type="button" className="trc-more-btn" onClick={() => { void fetchPage(false) }}>
            加载更多
          </button>
        )}
        {loading && records.length > 0 && (
          <div className="trc-empty" style={{ padding: '20px 0' }}>
            <span className="trc-spin" />
          </div>
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

  // 加载池号选项:优先设置页「AquaSense 设置」配置(/api/pools),
  // 不可用时回退从历史记录提取;始终保证当前查看池号在选项中
  useEffect(() => {
    const apply = (list: string[]): void => {
      if (list.length === 0) return
      setPools((current) => {
        const next = [...list]
        if (!next.includes(initPool)) next.unshift(initPool)
        return next.length > 0 ? next : current
      })
    }
    fetch(`${apiBase}/api/pools`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b?.ok && Array.isArray(b.value?.pools) && b.value.pools.length > 0) {
          apply(b.value.pools.filter((p: unknown) => typeof p === 'string'))
          return null
        }
        // 回退:历史记录提取池号
        return fetch(`${apiBase}/api/records`)
          .then((r) => (r.ok ? r.json() : null))
          .then((b2) => {
            if (!b2?.ok) return
            const recs = (b2.value as RecordSummary[]) || []
            const poolSet = new Set<string>()
            recs.forEach((r) => poolSet.add(r.pool))
            if (poolSet.size > 0) apply(Array.from(poolSet).sort())
          })
      })
      .catch(() => {}) // 静默失败
  }, [apiBase, initPool])

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

  if (loading) {
    return (
      <div className="trc-empty" style={{ flex: 1 }}>
        <span className="trc-spin" />
        <span>加载中…</span>
      </div>
    )
  }
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
      <div className="trc-trend-top">
        <button type="button" className="trc-back-link" onClick={onBack}>
          ← 返回列表
        </button>
        {/* 水池下拉框 */}
        <span className="trc-select-wrap">
          <select className="trc-select" style={{ fontWeight: 600 }} value={pool} onChange={(e) => setPool(e.target.value)}>
            {pools.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className="trc-select-caret">▾</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>趋势分析</span>
        <span style={{ marginLeft: 'auto' }}>
          <span className="trc-select-wrap">
            <select className="trc-select" style={{ fontSize: 12 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>近7天</option>
              <option value={30}>近30天</option>
              <option value={3650}>全部</option>
            </select>
            <span className="trc-select-caret">▾</span>
          </span>
        </span>
      </div>

      <div className="trc-trend-body">
        {/* KPI 概览卡 */}
        <div className="trc-kpis">
          <div className="trc-kpi">
            <span className="trc-kpi-num" style={{ color: 'var(--dsw-alias-label-primary,#17191c)' }}>{total}</span>
            <span className="trc-kpi-label">近 {days} 天分析记录</span>
          </div>
          {distOrder.slice(0, 3).map(([key, label, color]) => (
            <div key={key} className="trc-kpi">
              <span className="trc-kpi-num" style={{ color }}>{dist[key] || 0}</span>
              <span className="trc-kpi-label">{label}</span>
            </div>
          ))}
        </div>

        {/* 状态分布 */}
        <div className="trc-card">
          <div className="trc-section-title" style={{ margin: '0 0 12px' }}>状态分布</div>
          {total > 0 ? distOrder.map(([key, label, color]) => {
            const n = dist[key] || 0
            const pct = Math.round(n / total * 100)
            return (
              <div key={key} className="trc-bar-row">
                <span style={{ width: 48, flexShrink: 0 }}>{label}</span>
                <div className="trc-bar-track">
                  <div className="trc-bar" style={S.bar(color, pct)} />
                </div>
                <span style={{ width: 96, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }}>{pct}% ({n}次)</span>
              </div>
            )
          }) : <div style={{ color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }}>暂无数据</div>}
        </div>

        {/* 症状频次 */}
        <div className="trc-card">
          <div className="trc-section-title" style={{ margin: '0 0 12px' }}>症状频次 TOP</div>
          {data.top_symptoms.length > 0 ? (() => {
            const max = data.top_symptoms[0]?.count || 1
            return data.top_symptoms.map((s) => (
              <div key={s.symptom} className="trc-bar-row">
                <span style={{ width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.symptom}</span>
                <div className="trc-bar-track" style={{ height: 14 }}>
                  <div className="trc-bar" style={S.barAccent(Math.round(s.count / max * 100))} />
                </div>
                <span style={{ width: 44, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }}>{s.count}次</span>
              </div>
            ))
          })() : <div style={{ color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }}>暂无异常症状记录</div>}
        </div>

        {/* 最近记录 */}
        <div className="trc-card" style={{ marginBottom: 0 }}>
          <div className="trc-section-title" style={{ margin: '0 0 4px' }}>最近记录</div>
          {data.recent_records.length > 0 ? data.recent_records.map((r) => {
            const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常'
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l2,#e8eaed)', fontSize: 13 }}>
                <span style={{ width: 44, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }}>{timeText(r.created_at)}</span>
                <span className="trc-badge" style={S.badge(r.cls)}>{CLS_LABEL[r.cls] || r.cls}</span>
                <span style={{ width: 36, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }}>{(r.confidence || 0).toFixed(2)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>{sym}</span>
                <span style={{ flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }}>{durationText(r.total_duration_ms)}</span>
              </div>
            )
          }) : <div style={{ padding: 20, textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' }}>暂无记录</div>}
        </div>
      </div>
    </div>
  )
}
