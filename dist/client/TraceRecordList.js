import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useCallback, useEffect, useState } from 'react';
// ========== 常量 ==========
const PAGE_LIMIT = 20;
/** 池号兜底枚举(/api/pools 不可用时,与设置页默认一致) */
const FALLBACK_POOLS = ['池1', '池2', '池3', '池4'];
const CLS_OPTIONS = [
    ['', '全部状态'],
    ['normal', '正常'],
    ['early', '前兆'],
    ['disease', '发病'],
    ['unknown', '未知']
];
const CLS_LABEL = { normal: 'normal', early: 'early', disease: 'disease', unknown: 'unknown' };
const CLS_COLOR = { normal: '#52c41a', early: '#faad14', disease: '#ff4d4f', unknown: '#9ca3af' };
const SOURCE_LABEL = { h5_upload: 'H5上传', group_chat: '群聊发图', api: 'API' };
/** 步骤配置 */
const SPAN_DEFS = [
    { key: 'upload', label: '图片上传', icon: '📷', color: '#8c8c8c', field: 'span_upload' },
    { key: 'analyze', label: 'AI 视觉分析', icon: '🧠', color: '#1677ff', field: 'span_analyze' },
    { key: 'retrieve', label: '知识库检索', icon: '📚', color: '#fa8c16', field: 'span_retrieve' },
    { key: 'advice', label: '处置建议生成', icon: '💡', color: '#52c41a', field: 'span_advice' },
    { key: 'ledger', label: '台账写入', icon: '📝', color: '#722ed1', field: 'span_ledger' }
];
// ========== 视觉增强样式(.trc-* 类,注入一次) ==========
const TRACE_STYLE_ID = 'aquasense-trace-style';
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
`;
/** 注入分析记录页样式(幂等,SSR 安全) */
export function ensureTraceStyle() {
    if (typeof document === 'undefined')
        return;
    let style = document.getElementById(TRACE_STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = TRACE_STYLE_ID;
        document.head.appendChild(style);
    }
    style.textContent = TRACE_CSS;
}
// ========== 内联样式(仅动态颜色;布局/hover/动画由 .trc-* 类提供) ==========
const S = {
    /** 状态圆点:发光 + 呼吸动画(类 .trc-dot) */
    dot: (cls) => ({
        background: CLS_COLOR[cls] || '#9ca3af',
        boxShadow: `0 0 8px ${CLS_COLOR[cls] || '#9ca3af'}`
    }),
    /** 状态徽章:半透明底 + 发光(类 .trc-badge 提供 pill 布局) */
    badge: (cls) => {
        const color = CLS_COLOR[cls] || '#9ca3af';
        return { background: color + '1a', color, boxShadow: `0 0 10px ${color}40` };
    },
    /** 瀑布图条:渐变 + 发光(类 .trc-wf-bar 提供定位/动画) */
    wfBar: (color, pct) => ({
        width: `${Math.max(pct, 2)}%`,
        background: `linear-gradient(90deg, ${color}, ${color}b3)`,
        boxShadow: `0 0 10px ${color}66`
    }),
    /** 图标圆底(类 .trc-wf-icon / .trc-step-icon 提供尺寸圆角) */
    iconBg: (color) => ({ background: color + '1c' }),
    /** 趋势分布条:渐变 + 发光(类 .trc-bar 提供动画) */
    bar: (color, pct) => ({
        width: `${pct}%`,
        background: `linear-gradient(90deg, ${color}66, ${color})`,
        boxShadow: `0 0 10px ${color}55`
    }),
    /** 症状 TOP 条:主色渐变 */
    barAccent: (pct) => ({
        width: `${pct}%`,
        background: 'linear-gradient(90deg, #4d6bfe, #8b5cf6)',
        boxShadow: '0 0 10px rgba(77,107,254,.4)'
    })
};
// ========== 辅助 ==========
function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function dayLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
    if (diff === 0)
        return `今天 (${d.getMonth() + 1}月${d.getDate()}日)`;
    if (diff === 1)
        return `昨天 (${d.getMonth() + 1}月${d.getDate()}日)`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function timeText(iso) {
    const d = new Date(iso);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function durationText(ms) {
    return ms > 0 ? (ms / 1000).toFixed(1) + 's' : '—';
}
function tokenText(n) {
    return n > 0 ? n.toLocaleString('en-US') : '—';
}
function formatDateTime(iso) {
    const d = new Date(iso);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// ========== 子组件 ==========
/** Agent 决策链工具元信息(v1.8 详情态区块;未知工具降级灰图标) */
const AGENT_TOOL_META = {
    aquasense_analyze: { icon: '🧠', label: 'AI 视觉分析', color: '#1677ff' },
    aquasense_advice: { icon: '💡', label: '处置建议生成', color: '#52c41a' },
    aquasense_ledger: { icon: '📝', label: '台账写入', color: '#722ed1' }
};
/** Agent 决策链区块(v1.8,仅群聊记录;数据来自 DSH 会话事件,agent 缺失时自动隐藏) */
function AgentChain({ agent }) {
    if (!agent || agent.calls.length === 0)
        return null;
    const total = Math.max(agent.think_ms, ...agent.calls.map((c) => c.duration_ms), 1);
    return (_jsxs("div", { style: { marginBottom: 20 }, children: [_jsxs("div", { className: "trc-section-title", children: ["Agent \u51B3\u7B56\u94FE", _jsxs("span", { style: { fontWeight: 400, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: ["\uFF08turn ", agent.turn, " \u00B7 step ", agent.step, " \u00B7 \u4F1A\u8BDD\u4E8B\u4EF6\u81EA\u52A8\u8BB0\u5F55\uFF09"] })] }), _jsxs("div", { className: "trc-wf", children: [_jsxs("div", { className: "trc-wf-row", children: [_jsx("span", { className: "trc-wf-icon", style: S.iconBg('#8c8c8c'), children: "\uD83D\uDD04" }), _jsx("span", { className: "trc-wf-label", children: "Agent \u601D\u8003" }), _jsx("div", { className: "trc-wf-track", children: _jsx("div", { className: "trc-wf-bar", style: S.wfBar('#8c8c8c', (agent.think_ms / total) * 100) }) }), _jsx("span", { className: "trc-wf-dur", children: durationText(agent.think_ms) }), _jsx("span", { className: "trc-wf-status", children: "\u2014" })] }), agent.calls.map((call) => {
                        const toolMeta = AGENT_TOOL_META[call.tool] ?? { icon: '🔧', label: call.tool, color: '#9ca3af' };
                        const summary = formatCallMeta(call);
                        return (_jsxs("div", { children: [_jsxs("div", { className: "trc-wf-row", children: [_jsx("span", { className: "trc-wf-icon", style: S.iconBg(toolMeta.color), children: toolMeta.icon }), _jsxs("span", { className: "trc-wf-label", children: [toolMeta.label, summary && _jsx("span", { style: { marginLeft: 6, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: summary })] }), _jsx("div", { className: "trc-wf-track", children: _jsx("div", { className: "trc-wf-bar", style: S.wfBar(call.status === 'error' ? '#ff4d4f' : toolMeta.color, (call.duration_ms / total) * 100) }) }), _jsx("span", { className: "trc-wf-dur", children: durationText(call.duration_ms) }), _jsx("span", { className: "trc-wf-status", children: call.status === 'ok' ? '✅' : '❌' })] }), call.attempt > 1 && (_jsxs("div", { style: { margin: '-2px 0 6px 128px', fontSize: 11, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: ["\uD83D\uDD01 \u7B2C ", call.attempt, " \u6B21\u5C1D\u8BD5", call.error_code ? `（前次失败: ${call.error_code}）` : '', " \u00B7 call ", call.call_id] }))] }, `${call.call_id}-${call.attempt}`));
                    })] }), _jsx("div", { style: { marginTop: 6, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: "\u6570\u636E\u6765\u6E90: DSH \u4F1A\u8BDD\u4E8B\u4EF6\u8FB9\u754C\uFF08\u5DE5\u5177\u5185\u90E8 Token/\u77E5\u8BC6\u5E93\u547D\u4E2D\u660E\u7EC6\u89C1\u4E0B\u65B9\u6B65\u9AA4\u8BE6\u60C5\uFF09" })] }));
}
/** 格式化单次工具调用的 meta 摘要(显示关键业务字段) */
function formatCallMeta(call) {
    const m = call.meta;
    if (!m)
        return '';
    if (call.tool === 'aquasense_analyze') {
        const cls = m.cls ? String(m.cls) : '';
        const conf = typeof m.confidence === 'number' ? m.confidence.toFixed(2) : '';
        const imgs = typeof m.image_count === 'number' && m.image_count > 0 ? `${m.image_count}张` : '';
        return [cls, conf, imgs].filter(Boolean).join(' · ');
    }
    if (call.tool === 'aquasense_advice') {
        const level = m.alert_level ? String(m.alert_level) : '';
        const refs = typeof m.knowledge_refs_count === 'number' ? `${m.knowledge_refs_count}条知识` : '';
        return [level, refs].filter(Boolean).join(' · ');
    }
    if (call.tool === 'aquasense_ledger') {
        const ok = m.success === true ? '✅' : m.success === false ? '❌' : '';
        const rid = m.record_id ? String(m.record_id).slice(-8) : '';
        return [ok, rid].filter(Boolean).join(' · ');
    }
    return '';
}
/** 瀑布图：5 个 span 的时间轴可视化 */
function WaterfallChart({ record }) {
    const spans = SPAN_DEFS.map((def) => ({
        ...def,
        data: record[def.field],
        duration: record[def.field]?.duration_ms ?? 0
    }));
    const total = record.total_duration_ms || 1;
    const hasAny = spans.some((s) => s.duration > 0);
    if (!hasAny)
        return null;
    return (_jsxs("div", { style: { marginBottom: 20 }, children: [_jsx("div", { className: "trc-section-title", children: "\u7011\u5E03\u56FE \u00B7 Trace Timeline" }), _jsx("div", { className: "trc-wf", children: spans.map((s) => (_jsxs("div", { className: "trc-wf-row", children: [_jsx("span", { className: "trc-wf-icon", style: S.iconBg(s.color), children: s.icon }), _jsx("span", { className: "trc-wf-label", children: s.label }), _jsx("div", { className: "trc-wf-track", children: _jsx("div", { className: "trc-wf-bar", style: S.wfBar(s.color, (s.duration / total) * 100) }) }), _jsx("span", { className: "trc-wf-dur", children: durationText(s.duration) }), _jsx("span", { className: "trc-wf-status", children: s.data?.error ? '❌' : (s.duration > 0 ? '✅' : '—') })] }, s.key))) })] }));
}
/** 单个步骤 Accordion */
function StepAccordion({ def, record, isOpen, onToggle }) {
    const data = record[def.field];
    const dur = data?.duration_ms ?? 0;
    return (_jsxs("div", { className: "trc-step", children: [_jsxs("button", { type: "button", className: "trc-step-head", onClick: onToggle, children: [_jsx("span", { className: "trc-step-icon", style: S.iconBg(def.color), children: def.icon }), _jsx("span", { style: { fontWeight: 600 }, children: def.label }), _jsxs("span", { className: "trc-step-right", children: [_jsx("span", { children: durationText(dur) }), _jsx("span", { children: data?.error ? '❌' : (dur > 0 ? '✅' : '—') }), _jsx("span", { className: "trc-step-arrow", style: { transform: isOpen ? 'rotate(90deg)' : undefined }, children: "\u25B6" })] })] }), isOpen && data && (_jsx("div", { className: "trc-step-body", children: renderStepContent(def.key, data, record) }))] }));
}
/** 根据步骤类型渲染不同内容 */
function renderStepContent(key, data, record) {
    switch (key) {
        case 'upload': return renderUploadStep(data);
        case 'analyze': return renderAnalyzeStep(data, record);
        case 'retrieve': return renderRetrieveStep(data);
        case 'advice': return renderAdviceStep(data);
        case 'ledger': return renderLedgerStep(data);
        default: return null;
    }
}
function renderUploadStep(data) {
    const imageCount = data.image_count ?? 0;
    const sizes = data.image_sizes ?? [];
    const compressed = data.compressed_sizes ?? [];
    const names = data.image_names ?? [];
    const err = data.error;
    return (_jsxs("div", { className: "trc-step-field", children: [_jsx("span", { className: "trc-step-label", children: "\u8F93\u5165" }), _jsxs("span", { className: "trc-step-value", children: [imageCount, " \u5F20\u56FE\u7247"] }), sizes.map((size, i) => (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", children: " " }, `k${i}`), _jsxs("span", { className: "trc-step-value", children: ["\uD83D\uDC1F ", names[i] || `image_${String(i + 1).padStart(3, '0')}`, ' ', "(", formatBytes(size), compressed[i] ? ` → ${formatBytes(compressed[i])}` : '', ")"] }, `v${i}`)] }))), _jsx("span", { className: "trc-step-label", children: "\u8F93\u51FA" }), _jsxs("span", { className: "trc-step-value", children: [imageCount, " \u5F20\u56FE\u7247\u5DF2\u538B\u7F29\u5E76\u8F6C\u4E3A base64"] }), err && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", style: { color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { className: "trc-step-value", style: { color: '#ff4d4f' }, children: err })] }))] }));
}
function renderAnalyzeStep(data, record) {
    const cls = data.cls ?? 'unknown';
    const confidence = data.confidence ?? 0;
    const symptoms = data.symptoms ?? [];
    const severity = data.severity ?? '';
    const organs = data.organs ?? [];
    const promptLen = data.prompt_length ?? 0;
    const inputTok = data.input_tokens ?? 0;
    const outputTok = data.output_tokens ?? 0;
    const raw = data.output_raw ?? '';
    const err = data.error;
    return (_jsxs("div", { className: "trc-step-field", children: [_jsx("span", { className: "trc-step-label", children: "\u6A21\u578B" }), _jsxs("span", { className: "trc-step-value", children: [record?.model || '—', " (temperature=0.1)"] }), _jsx("span", { className: "trc-step-label", children: "\u8F93\u5165" }), _jsxs("span", { className: "trc-step-value", children: ["system prompt (", promptLen, " chars) + \u56FE\u7247"] }), _jsx("span", { className: "trc-step-label", children: "\u8F93\u51FA" }), _jsxs("span", { className: "trc-step-value", children: ["\u72B6\u6001: ", CLS_LABEL[cls] || cls, "\uFF08", cls, "\uFF09", '\n', "\u7F6E\u4FE1\u5EA6: ", confidence.toFixed(2), '\n', "\u75C7\u72B6: ", symptoms.length > 0 ? symptoms.join('、') : '无异常', severity ? `\n严重度: ${severity}` : '', organs.length > 0 ? `\n器官: ${organs.join('、')}` : ''] }), _jsx("span", { className: "trc-step-label", children: "Token" }), _jsxs("span", { className: "trc-step-value", children: ["input=", tokenText(inputTok), " output=", tokenText(outputTok)] }), raw && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", children: "\u539F\u59CB\u8F93\u51FA" }), _jsx("span", { className: "trc-step-value", children: raw })] })), err && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", style: { color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { className: "trc-step-value", style: { color: '#ff4d4f' }, children: err })] }))] }));
}
function renderRetrieveStep(data) {
    const query = data.query ?? '';
    const chA = data.channel_a_wiki ?? 0;
    const chB = data.channel_b_note ?? 0;
    const chC = data.channel_c_pdf ?? 0;
    const merged = data.merged_count ?? 0;
    const excerpts = data.excerpts ?? [];
    const err = data.error;
    return (_jsxs("div", { className: "trc-step-field", children: [_jsx("span", { className: "trc-step-label", children: "\u67E5\u8BE2" }), _jsxs("span", { className: "trc-step-value", children: ["\"", query, "\""] }), _jsx("span", { className: "trc-step-label", children: "\u901A\u9053A (wiki)" }), _jsxs("span", { className: "trc-step-value", children: ["\u547D\u4E2D ", chA, " \u6761"] }), _jsx("span", { className: "trc-step-label", children: "\u901A\u9053B (note)" }), _jsxs("span", { className: "trc-step-value", children: ["\u547D\u4E2D ", chB, " \u6761"] }), _jsx("span", { className: "trc-step-label", children: "\u901A\u9053C (PDF)" }), _jsxs("span", { className: "trc-step-value", children: ["\u547D\u4E2D ", chC, " \u6761"] }), _jsx("span", { className: "trc-step-label", children: "\u5408\u5E76\u53BB\u91CD" }), _jsxs("span", { className: "trc-step-value", children: [merged, " \u6761"] }), excerpts.length > 0 && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", children: "\u547D\u4E2D\u6761\u76EE" }), _jsx("span", { className: "trc-step-value", children: excerpts.map((ex, i) => (_jsxs("div", { className: "trc-excerpt", children: [_jsxs("div", { className: "trc-excerpt-title", children: ["\uD83D\uDCC4 \u300A", ex.title, "\u300B", ex.from ? `[${fromLabel(ex.from)}]` : ''] }), ex.locator && _jsx("div", { className: "trc-excerpt-meta", children: ex.locator }), _jsxs("div", { className: "trc-excerpt-text", children: ["\u300C", ex.excerpt_preview, "\u300D"] })] }, i))) })] })), err && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", style: { color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { className: "trc-step-value", style: { color: '#ff4d4f' }, children: err })] }))] }));
}
function renderAdviceStep(data) {
    const alertLevel = data.alert_level ?? '';
    const refsCount = data.knowledge_refs_count ?? 0;
    const diagnosis = data.diagnosis_summary ?? '';
    const reasoning = data.reasoning_preview ?? '';
    const err = data.error;
    return (_jsxs("div", { className: "trc-step-field", children: [_jsx("span", { className: "trc-step-label", children: "\u9884\u8B66\u7EA7\u522B" }), _jsx("span", { className: "trc-step-value", children: alertLevel || '—' }), _jsx("span", { className: "trc-step-label", children: "\u77E5\u8BC6\u6765\u6E90" }), _jsxs("span", { className: "trc-step-value", children: [refsCount, " \u6761"] }), _jsx("span", { className: "trc-step-label", children: "\u8BCA\u65AD" }), _jsx("span", { className: "trc-step-value", children: diagnosis || '—' }), _jsx("span", { className: "trc-step-label", children: "\u63A8\u7406" }), _jsx("span", { className: "trc-step-value", children: reasoning || '—' }), err && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", style: { color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { className: "trc-step-value", style: { color: '#ff4d4f' }, children: err })] }))] }));
}
function renderLedgerStep(data) {
    const table = data.target_table ?? '';
    const op = data.operation ?? '';
    const recId = data.record_id ?? '';
    const success = data.success;
    const message = data.message ?? '';
    const err = data.error;
    return (_jsxs("div", { className: "trc-step-field", children: [_jsx("span", { className: "trc-step-label", children: "\u76EE\u6807\u8868" }), _jsx("span", { className: "trc-step-value", children: table || '—' }), _jsx("span", { className: "trc-step-label", children: "\u64CD\u4F5C" }), _jsx("span", { className: "trc-step-value", children: op === 'create' ? '新增' : op === 'update' ? '更新' : op || '—' }), recId && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", children: "\u8BB0\u5F55ID" }), _jsx("span", { className: "trc-step-value", children: recId })] })), success !== undefined && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", children: "\u7ED3\u679C" }), _jsx("span", { className: "trc-step-value", children: success ? '✅ 成功' : '❌ 失败' })] })), message && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", children: "\u4FE1\u606F" }), _jsx("span", { className: "trc-step-value", children: message })] })), err && (_jsxs(_Fragment, { children: [_jsx("span", { className: "trc-step-label", style: { color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { className: "trc-step-value", style: { color: '#ff4d4f' }, children: err })] }))] }));
}
// ========== 辅助 ==========
/** 知识来源通道名翻译 */
function fromLabel(from) {
    const map = { pdf_content: 'PDF', note: '笔记', wiki: 'wiki' };
    return map[from] || from;
}
/** 字节格式化 */
function formatBytes(bytes) {
    if (bytes < 1024)
        return bytes + 'B';
    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(0) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
export function TraceRecordList({ apiBase = '/aquasense-reports', onOpenTrend }) {
    // --- 列表状态 ---
    const [records, setRecords] = useState([]);
    useEffect(() => {
        ensureTraceStyle();
    }, []);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pool, setPool] = useState('');
    const [cls, setCls] = useState('');
    /** 池号枚举(设置页「AquaSense 设置」配置;/api/pools 拉取失败时兜底默认 4 池) */
    const [pools, setPools] = useState(FALLBACK_POOLS);
    // --- 详情状态 ---
    const [detailId, setDetailId] = useState(null);
    const [detailRecord, setDetailRecord] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState(null);
    const [openSteps, setOpenSteps] = useState(new Set());
    /** 灯箱预览的图片序号(null=关闭) */
    const [previewIndex, setPreviewIndex] = useState(null);
    // ---------- 列表 ----------
    const fetchPage = useCallback(async (reset) => {
        if (loading)
            return;
        setLoading(true);
        const off = reset ? 0 : offset;
        try {
            let url = `${apiBase}/api/records?limit=${PAGE_LIMIT}&offset=${off}`;
            if (pool)
                url += `&pool=${encodeURIComponent(pool)}`;
            if (cls)
                url += `&cls=${encodeURIComponent(cls)}`;
            let resp;
            try {
                resp = await fetch(url);
            }
            catch (netErr) {
                throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})\n请求: ${url}`);
            }
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status} ${resp.statusText}\n请求: ${url}`);
            const body = await resp.json();
            if (!body?.ok)
                throw new Error(body?.error?.message || `接口返回失败\n请求: ${url}`);
            const page = body.value;
            const newRecords = reset ? page.records : [...records, ...page.records];
            setRecords(newRecords);
            setTotal(page.total);
            setHasMore(page.has_more);
            setOffset((reset ? 0 : offset) + page.records.length);
            setError(null);
        }
        catch (err) {
            setError(`加载失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            setLoading(false);
        }
    }, [loading, offset, pool, cls, records, apiBase]);
    const applyFilter = useCallback((newPool, newCls) => {
        setPool(newPool);
        setCls(newCls);
        setRecords([]);
        setOffset(0);
        setHasMore(false);
        setError(null);
        setDetailId(null);
        setDetailRecord(null);
    }, []);
    useEffect(() => {
        if (records.length === 0 && offset === 0 && !loading) {
            void fetchPage(true);
        }
    }, [pool, cls]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        void fetchPage(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // 挂载时拉取池号枚举(失败静默保持默认,筛选器仍可用)
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const resp = await fetch(`${apiBase}/api/pools`);
                if (!resp.ok)
                    return;
                const body = await resp.json();
                const value = Array.isArray(body?.value?.pools) ? body.value.pools : [];
                if (!cancelled && value.length > 0) {
                    setPools(value.filter((item) => typeof item === 'string'));
                }
            }
            catch {
                /* 保持默认枚举 */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [apiBase]);
    // ---------- 详情 ----------
    const openDetail = useCallback(async (id) => {
        setDetailId(id);
        setDetailRecord(null);
        setDetailLoading(true);
        setDetailError(null);
        setOpenSteps(new Set());
        setPreviewIndex(null);
        try {
            const url = `${apiBase}/api/records/${encodeURIComponent(id)}`;
            let resp;
            try {
                resp = await fetch(url);
            }
            catch (netErr) {
                throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})\n请求: ${url}`);
            }
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status} ${resp.statusText}\n请求: ${url}`);
            const body = await resp.json();
            if (!body?.ok)
                throw new Error(body?.error?.message || `接口返回失败\n请求: ${url}`);
            setDetailRecord(body.value);
        }
        catch (err) {
            setDetailError(`加载失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            setDetailLoading(false);
        }
    }, [apiBase]);
    const backToList = useCallback(() => {
        setDetailId(null);
        setDetailRecord(null);
        setDetailError(null);
        setPreviewIndex(null);
    }, []);
    const toggleStep = useCallback((key) => {
        setOpenSteps((prev) => {
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        });
    }, []);
    // ---------- 渲染：详情 ----------
    if (detailId) {
        return (_jsxs("div", { className: "trc-detail", children: [detailLoading && (_jsxs("div", { className: "trc-empty", children: [_jsx("span", { className: "trc-spin" }), _jsx("span", { children: "\u52A0\u8F7D\u4E2D\u2026" })] })), detailError && (_jsxs("div", { className: "trc-err", children: [_jsx("div", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }, children: detailError }), _jsx("button", { type: "button", className: "trc-more-btn", style: { marginTop: 8, width: 'auto', display: 'inline-block', padding: '6px 14px', fontSize: 13 }, onClick: backToList, children: "\u8FD4\u56DE\u5217\u8868" })] })), detailRecord && (_jsxs("div", { children: [_jsxs("div", { className: "trc-title", children: [_jsx("button", { type: "button", className: "trc-back", onClick: backToList, children: "\u2190 \u8FD4\u56DE" }), _jsx("span", { className: "trc-idchip", children: detailRecord.id }), _jsx("span", { style: { fontWeight: 600 }, children: detailRecord.pool }), _jsx("span", { style: { fontWeight: 600 }, children: "\u5DE1\u68C0\u5206\u6790" }), (() => {
                                    const cls = detailRecord.span_analyze?.cls ?? 'unknown';
                                    return (_jsxs("span", { className: "trc-badge", style: S.badge(cls), children: [_jsx("span", { className: "trc-badge-dot" }), CLS_LABEL[cls] || cls] }));
                                })()] }), _jsxs("div", { className: "trc-meta-grid", children: [_jsxs("div", { className: "trc-meta-item", children: [_jsx("span", { className: "trc-meta-label", children: "\u6C60\u53F7:" }), _jsx("span", { className: "trc-meta-value", children: detailRecord.pool })] }), _jsxs("div", { className: "trc-meta-item", children: [_jsx("span", { className: "trc-meta-label", children: "\u4E0A\u62A5\u4EBA:" }), _jsx("span", { className: "trc-meta-value", children: detailRecord.reporter || '—' })] }), _jsxs("div", { className: "trc-meta-item", children: [_jsx("span", { className: "trc-meta-label", children: "\u6765\u6E90:" }), _jsx("span", { className: "trc-meta-value", children: SOURCE_LABEL[detailRecord.source] || detailRecord.source })] }), _jsxs("div", { className: "trc-meta-item", children: [_jsx("span", { className: "trc-meta-label", children: "\u65F6\u95F4:" }), _jsx("span", { className: "trc-meta-value", children: formatDateTime(detailRecord.created_at) })] }), _jsxs("div", { className: "trc-meta-item", children: [_jsx("span", { className: "trc-meta-label", children: "\u603B\u8017\u65F6:" }), _jsx("span", { className: "trc-meta-value", children: durationText(detailRecord.total_duration_ms) })] }), _jsxs("div", { className: "trc-meta-item", children: [_jsx("span", { className: "trc-meta-label", children: "\u6A21\u578B:" }), _jsx("span", { className: "trc-meta-value", children: detailRecord.model || '—' })] }), _jsxs("div", { className: "trc-meta-item", style: { gridColumn: '1 / -1' }, children: [_jsx("span", { className: "trc-meta-label", children: "Token:" }), _jsxs("span", { className: "trc-meta-value", children: ["input=", tokenText(detailRecord.span_analyze?.input_tokens ?? 0), " output=", tokenText(detailRecord.span_analyze?.output_tokens ?? 0)] })] }), detailRecord.agent && (_jsxs("div", { className: "trc-meta-item", style: { gridColumn: '1 / -1' }, children: [_jsx("span", { className: "trc-meta-label", children: "Agent:" }), _jsxs("span", { className: "trc-meta-value", children: ["turn ", detailRecord.agent.turn, " \u00B7 step ", detailRecord.agent.step, " \u00B7 \u5DE5\u5177 ", detailRecord.agent.calls.length, " \u6B21", (() => {
                                                    const retries = detailRecord.agent.calls.reduce((n, c) => n + Math.max(0, c.attempt - 1), 0);
                                                    return retries > 0 ? ` · 重试 ${retries} 次` : '';
                                                })()] })] }))] }), _jsx(AgentChain, { agent: detailRecord.agent }), detailRecord.images && detailRecord.images.length > 0 && (_jsxs("div", { style: { marginBottom: 20 }, children: [_jsxs("div", { className: "trc-section-title", children: ["\u73B0\u573A\u7167\u7247 \u00B7 ", detailRecord.images.length, " \u5F20"] }), _jsx("div", { className: "trc-photos", children: detailRecord.images.map((img, i) => (_jsxs("button", { type: "button", className: "trc-photo", onClick: () => { setPreviewIndex(i); }, "aria-label": `查看第 ${i + 1} 张现场照片`, children: [_jsx("img", { src: img.url, alt: `现场照片 ${i + 1}`, loading: "lazy" }), _jsx("span", { className: "trc-photo-idx", children: i + 1 })] }, img.index))) })] })), _jsx(WaterfallChart, { record: detailRecord }), _jsx("div", { className: "trc-section-title", children: "\u6B65\u9AA4\u8BE6\u60C5" }), _jsx("div", { className: "trc-steps", children: SPAN_DEFS.map((def) => (_jsx(StepAccordion, { def: def, record: detailRecord, isOpen: openSteps.has(def.key), onToggle: () => { toggleStep(def.key); } }, def.key))) })] })), previewIndex !== null && detailRecord?.images && detailRecord.images[previewIndex] && (_jsxs("div", { className: "trc-lightbox", role: "dialog", "aria-modal": "true", onClick: () => { setPreviewIndex(null); }, children: [_jsx("button", { type: "button", className: "trc-lightbox-close", onClick: (e) => { e.stopPropagation(); setPreviewIndex(null); }, "aria-label": "\u5173\u95ED\u9884\u89C8", children: "\u2715" }), previewIndex > 0 && (_jsx("button", { type: "button", className: "trc-lightbox-nav prev", onClick: (e) => { e.stopPropagation(); setPreviewIndex(previewIndex - 1); }, "aria-label": "\u4E0A\u4E00\u5F20", children: "\u2039" })), _jsx("img", { src: detailRecord.images[previewIndex].url, alt: `现场照片 ${previewIndex + 1}`, onClick: (e) => { e.stopPropagation(); } }), previewIndex < detailRecord.images.length - 1 && (_jsx("button", { type: "button", className: "trc-lightbox-nav next", onClick: (e) => { e.stopPropagation(); setPreviewIndex(previewIndex + 1); }, "aria-label": "\u4E0B\u4E00\u5F20", children: "\u203A" })), _jsxs("span", { style: { position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,.85)', fontSize: 13 }, children: [previewIndex + 1, " / ", detailRecord.images.length] })] }))] }));
    }
    // ---------- 渲染：列表 ----------
    const groups = [];
    let lastKey = '';
    for (const r of records) {
        const key = dayKey(r.created_at);
        if (key !== lastKey) {
            groups.push({ title: dayLabel(r.created_at), items: [] });
            lastKey = key;
        }
        groups[groups.length - 1].items.push(r);
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "trc-filterbar", children: [_jsxs("span", { className: "trc-select-wrap", children: [_jsx("select", { className: "trc-select", value: pool, onChange: (e) => { applyFilter(e.target.value, cls); }, "aria-label": "\u6309\u6C60\u53F7\u7B5B\u9009", children: ['', ...pools].map((p) => _jsx("option", { value: p, children: p || '全部池号' }, p)) }), _jsx("span", { className: "trc-select-caret", children: "\u25BE" })] }), _jsxs("span", { className: "trc-select-wrap", children: [_jsx("select", { className: "trc-select", value: cls, onChange: (e) => { applyFilter(pool, e.target.value); }, "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009", children: CLS_OPTIONS.map(([v, l]) => _jsx("option", { value: v, children: l }, v)) }), _jsx("span", { className: "trc-select-caret", children: "\u25BE" })] }), _jsxs("span", { className: "trc-count", children: [total, " \u6761\u8BB0\u5F55"] }), _jsx("button", { type: "button", className: "trc-trend-btn", onClick: () => {
                            const targetPool = pool || pools[0] || '池1';
                            onOpenTrend?.(targetPool);
                        }, children: "\uD83D\uDCC8 \u6C60\u53F7\u8D8B\u52BF\u5206\u6790 \u2192" })] }), _jsxs("div", { className: "trc-list", children: [error && (_jsxs("div", { className: "trc-err", children: [_jsx("div", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }, children: error }), _jsx("button", { type: "button", className: "trc-more-btn", style: { marginTop: 8, width: 'auto', display: 'inline-block', padding: '6px 14px', fontSize: 13 }, onClick: () => { void fetchPage(true); }, children: "\u91CD\u8BD5" })] })), !error && records.length === 0 && !loading && (_jsxs("div", { className: "trc-empty", children: [_jsx("span", { className: "trc-empty-icon", children: "\uD83D\uDC1F" }), _jsx("span", { children: "\u6682\u65E0\u5206\u6790\u8BB0\u5F55" })] })), loading && records.length === 0 && (_jsxs("div", { className: "trc-empty", children: [_jsx("span", { className: "trc-spin" }), _jsx("span", { children: "\u52A0\u8F7D\u4E2D\u2026" })] })), groups.map((g) => (_jsxs("div", { children: [_jsx("div", { className: "trc-group-title", children: g.title }), g.items.map((r) => {
                                const clsName = CLS_LABEL[r.cls] || r.cls || '未知';
                                const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常';
                                return (_jsxs("button", { type: "button", className: "trc-row", onClick: () => { void openDetail(r.id); }, children: [_jsxs("div", { className: "trc-line1", children: [_jsx("span", { className: "trc-dot", style: S.dot(r.cls) }), _jsx("span", { className: "trc-idchip", children: r.id }), _jsx("span", { style: { fontWeight: 600 }, children: r.pool }), _jsxs("span", { className: "trc-badge", style: S.badge(r.cls), children: [_jsx("span", { className: "trc-badge-dot" }), clsName] }), _jsx("span", { style: { color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }, children: (r.confidence || 0).toFixed(2) }), _jsx("span", { className: "trc-symptom", style: { color: r.cls === 'disease' ? '#ff4d4f' : 'var(--dsw-alias-label-secondary,#7b8088)' }, children: sym })] }), _jsxs("div", { className: "trc-line2", children: [_jsx("span", { children: timeText(r.created_at) }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: SOURCE_LABEL[r.source || ''] || r.source }), _jsx("span", { children: "\u00B7" }), r.agent_retries !== undefined && (_jsx("span", { className: "trc-badge", style: { background: '#4d6bfe1a', color: '#4d6bfe', fontWeight: 600 }, children: "Agent\u94FE\u8DEF" })), _jsx("span", { children: r.alert_level ? 'AI视觉+知识库' : 'AI视觉' }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: durationText(r.total_duration_ms) }), _jsx("span", { children: "\u00B7" }), r.agent_retries !== undefined && r.agent_retries > 0 && (_jsxs("span", { children: ["\uD83D\uDD01 ", (r.agent_retry_tool || 'tool').replace(/^aquasense_/, ''), " \u00D7", r.agent_retries] })), _jsxs("span", { children: [tokenText(r.total_tokens), " tokens"] })] })] }, r.id));
                            })] }, g.title))), hasMore && !loading && (_jsx("button", { type: "button", className: "trc-more-btn", onClick: () => { void fetchPage(false); }, children: "\u52A0\u8F7D\u66F4\u591A" })), loading && records.length > 0 && (_jsx("div", { className: "trc-empty", style: { padding: '20px 0' }, children: _jsx("span", { className: "trc-spin" }) }))] })] }));
}
export function TraceTrendView({ pool: initPool, apiBase = '/aquasense-reports', onBack }) {
    const [pool, setPool] = useState(initPool);
    const [pools, setPools] = useState([initPool]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [days, setDays] = useState(7);
    // 加载池号选项:优先设置页「AquaSense 设置」配置(/api/pools),
    // 不可用时回退从历史记录提取;始终保证当前查看池号在选项中
    useEffect(() => {
        const apply = (list) => {
            if (list.length === 0)
                return;
            setPools((current) => {
                const next = [...list];
                if (!next.includes(initPool))
                    next.unshift(initPool);
                return next.length > 0 ? next : current;
            });
        };
        fetch(`${apiBase}/api/pools`)
            .then((r) => (r.ok ? r.json() : null))
            .then((b) => {
            if (b?.ok && Array.isArray(b.value?.pools) && b.value.pools.length > 0) {
                apply(b.value.pools.filter((p) => typeof p === 'string'));
                return null;
            }
            // 回退:历史记录提取池号
            return fetch(`${apiBase}/api/records`)
                .then((r) => (r.ok ? r.json() : null))
                .then((b2) => {
                if (!b2?.ok)
                    return;
                const recs = b2.value || [];
                const poolSet = new Set();
                recs.forEach((r) => poolSet.add(r.pool));
                if (poolSet.size > 0)
                    apply(Array.from(poolSet).sort());
            });
        })
            .catch(() => { }); // 静默失败
    }, [apiBase, initPool]);
    useEffect(() => {
        setLoading(true);
        setError(null);
        fetch(`${apiBase}/api/trend/${encodeURIComponent(pool)}?days=${days}`)
            .then((resp) => {
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status}`);
            return resp.json();
        })
            .then((body) => {
            if (!body?.ok)
                throw new Error(body?.error?.message || '请求失败');
            setData(body.value);
        })
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setLoading(false));
    }, [pool, days, apiBase]);
    if (loading) {
        return (_jsxs("div", { className: "trc-empty", style: { flex: 1 }, children: [_jsx("span", { className: "trc-spin" }), _jsx("span", { children: "\u52A0\u8F7D\u4E2D\u2026" })] }));
    }
    if (error)
        return _jsxs("div", { style: { padding: 20, color: '#ff4d4f' }, children: ["\u52A0\u8F7D\u5931\u8D25: ", error] });
    if (!data)
        return _jsx("div", { style: { padding: 20, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: "\u65E0\u6570\u636E" });
    const dist = data.distribution || {};
    const total = data.total || 0;
    const distOrder = [
        ['normal', '正常', '#52c41a'],
        ['early', '前兆', '#faad14'],
        ['disease', '发病', '#ff4d4f'],
        ['unknown', '未知', '#9ca3af']
    ];
    return (_jsxs("div", { style: { flex: 1, overflow: 'auto' }, children: [_jsxs("div", { className: "trc-trend-top", children: [_jsx("button", { type: "button", className: "trc-back-link", onClick: onBack, children: "\u2190 \u8FD4\u56DE\u5217\u8868" }), _jsxs("span", { className: "trc-select-wrap", children: [_jsx("select", { className: "trc-select", style: { fontWeight: 600 }, value: pool, onChange: (e) => setPool(e.target.value), children: pools.map((p) => _jsx("option", { value: p, children: p }, p)) }), _jsx("span", { className: "trc-select-caret", children: "\u25BE" })] }), _jsx("span", { style: { fontSize: 14, fontWeight: 600 }, children: "\u8D8B\u52BF\u5206\u6790" }), _jsx("span", { style: { marginLeft: 'auto' }, children: _jsxs("span", { className: "trc-select-wrap", children: [_jsxs("select", { className: "trc-select", style: { fontSize: 12 }, value: days, onChange: (e) => setDays(Number(e.target.value)), children: [_jsx("option", { value: 7, children: "\u8FD17\u5929" }), _jsx("option", { value: 30, children: "\u8FD130\u5929" }), _jsx("option", { value: 3650, children: "\u5168\u90E8" })] }), _jsx("span", { className: "trc-select-caret", children: "\u25BE" })] }) })] }), _jsxs("div", { className: "trc-trend-body", children: [_jsxs("div", { className: "trc-kpis", children: [_jsxs("div", { className: "trc-kpi", children: [_jsx("span", { className: "trc-kpi-num", style: { color: 'var(--dsw-alias-label-primary,#17191c)' }, children: total }), _jsxs("span", { className: "trc-kpi-label", children: ["\u8FD1 ", days, " \u5929\u5206\u6790\u8BB0\u5F55"] })] }), distOrder.slice(0, 3).map(([key, label, color]) => (_jsxs("div", { className: "trc-kpi", children: [_jsx("span", { className: "trc-kpi-num", style: { color }, children: dist[key] || 0 }), _jsx("span", { className: "trc-kpi-label", children: label })] }, key)))] }), _jsxs("div", { className: "trc-card", children: [_jsx("div", { className: "trc-section-title", style: { margin: '0 0 12px' }, children: "\u72B6\u6001\u5206\u5E03" }), total > 0 ? distOrder.map(([key, label, color]) => {
                                const n = dist[key] || 0;
                                const pct = Math.round(n / total * 100);
                                return (_jsxs("div", { className: "trc-bar-row", children: [_jsx("span", { style: { width: 48, flexShrink: 0 }, children: label }), _jsx("div", { className: "trc-bar-track", children: _jsx("div", { className: "trc-bar", style: S.bar(color, pct) }) }), _jsxs("span", { style: { width: 96, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }, children: [pct, "% (", n, "\u6B21)"] })] }, key));
                            }) : _jsx("div", { style: { color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }, children: "\u6682\u65E0\u6570\u636E" })] }), _jsxs("div", { className: "trc-card", children: [_jsx("div", { className: "trc-section-title", style: { margin: '0 0 12px' }, children: "\u75C7\u72B6\u9891\u6B21 TOP" }), data.top_symptoms.length > 0 ? (() => {
                                const max = data.top_symptoms[0]?.count || 1;
                                return data.top_symptoms.map((s) => (_jsxs("div", { className: "trc-bar-row", children: [_jsx("span", { style: { width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: s.symptom }), _jsx("div", { className: "trc-bar-track", style: { height: 14 }, children: _jsx("div", { className: "trc-bar", style: S.barAccent(Math.round(s.count / max * 100)) }) }), _jsxs("span", { style: { width: 44, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }, children: [s.count, "\u6B21"] })] }, s.symptom)));
                            })() : _jsx("div", { style: { color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }, children: "\u6682\u65E0\u5F02\u5E38\u75C7\u72B6\u8BB0\u5F55" })] }), _jsxs("div", { className: "trc-card", style: { marginBottom: 0 }, children: [_jsx("div", { className: "trc-section-title", style: { margin: '0 0 4px' }, children: "\u6700\u8FD1\u8BB0\u5F55" }), data.recent_records.length > 0 ? data.recent_records.map((r) => {
                                const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常';
                                return (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l2,#e8eaed)', fontSize: 13 }, children: [_jsx("span", { style: { width: 44, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }, children: timeText(r.created_at) }), _jsx("span", { className: "trc-badge", style: S.badge(r.cls), children: CLS_LABEL[r.cls] || r.cls }), _jsx("span", { style: { width: 36, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }, children: (r.confidence || 0).toFixed(2) }), _jsx("span", { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: sym }), _jsx("span", { style: { flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }, children: durationText(r.total_duration_ms) })] }, r.id));
                            }) : _jsx("div", { style: { padding: 20, textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: "\u6682\u65E0\u8BB0\u5F55" })] })] })] }));
}
