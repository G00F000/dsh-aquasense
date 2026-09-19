import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
const POOL_OPTIONS = ['', '池1', '池2', '池3', '池4'];
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
// ========== 内联样式(面板 token 体系) ==========
const S = {
    /* 筛选条 */
    filterBar: { display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', flexShrink: 0 },
    select: { appearance: 'none', padding: '6px 28px 6px 10px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)', fontSize: 13, lineHeight: '20px' },
    /* 列表区 */
    list: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '12px 20px 32px' },
    empty: { padding: '60px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' },
    /* 日期分组标题 */
    groupTitle: { margin: '18px 0 8px', fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)' },
    /* 记录行 */
    row: { display: 'block', padding: '12px 14px', color: 'inherit', textDecoration: 'none', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', cursor: 'pointer', background: 'transparent' },
    /* 记录行第一行：圆点 + ID + 池号 + 状态 + 置信度 + 症状（同行） */
    line1: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 },
    dot: (cls) => ({
        flex: 'none', width: 8, height: 8, borderRadius: '50%',
        background: CLS_COLOR[cls] || '#9ca3af'
    }),
    /* 症状（同行，自动截断） */
    symptom: { flex: '1 1 0', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 },
    /* 记录行第二行 */
    line2: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' },
    /* 趋势链接 */
    trendLink: { display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 20, fontSize: 14, color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', cursor: 'pointer', border: 0, background: 'transparent', padding: 0 },
    /* 加载更多 */
    moreBtn: { display: 'block', width: '100%', margin: '16px 0 0', padding: 10, border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer' },
    /* 错误 */
    err: { margin: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #ff4d4f', background: 'var(--dsw-alias-bg-layer-3,#fff)', color: '#ff4d4f', fontSize: 13 },
    /* ===== 详情态 ===== */
    detailWrap: { padding: '16px 20px 32px' },
    detailBack: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer', marginBottom: 12 },
    /* 标题行：返回 + ID + 状态 */
    detailTitle: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, marginBottom: 16 },
    statusBadge: (cls) => ({
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 999,
        background: (CLS_COLOR[cls] || '#9ca3af') + '18',
        color: CLS_COLOR[cls] || '#9ca3af', fontSize: 12, fontWeight: 600, flexShrink: 0
    }),
    /* 元信息区 */
    metaGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13, padding: '12px 16px', borderRadius: 8, background: 'var(--dsw-alias-bg-secondary,#f4f5f7)', marginBottom: 20 },
    metaLabel: { color: 'var(--dsw-alias-label-secondary,#7b8088)', whiteSpace: 'nowrap' },
    metaValue: { color: 'var(--dsw-alias-label-primary,#17191c)' },
    /* 瀑布图 */
    waterfallWrap: { marginBottom: 20 },
    sectionTitle: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)' },
    waterfall: { display: 'flex', flexDirection: 'column', gap: 4 },
    wfRow: { display: 'flex', alignItems: 'center', gap: 8 },
    wfIcon: { width: 20, textAlign: 'center', fontSize: 14, flexShrink: 0 },
    wfLabel: { width: 110, fontSize: 12, color: 'var(--dsw-alias-label-primary,#17191c)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    wfTrack: { flex: '1 1 auto', height: 18, borderRadius: 4, background: 'var(--dsw-alias-bg-secondary,#f0f1f3)', position: 'relative', overflow: 'hidden' },
    wfBar: (color, pct) => ({
        position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.max(pct, 2)}%`,
        background: color, borderRadius: 4, transition: 'width 0.3s'
    }),
    wfDur: { width: 44, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', textAlign: 'right', flexShrink: 0 },
    wfStatus: { width: 20, fontSize: 12, textAlign: 'center', flexShrink: 0 },
    /* 步骤 Accordion */
    stepsWrap: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 },
    stepItem: { border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, overflow: 'hidden' },
    stepHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-3,#fff)', border: 0, width: '100%', textAlign: 'left', fontSize: 13, color: 'var(--dsw-alias-label-primary,#17191c)' },
    stepArrow: (open) => ({
        transition: 'transform 0.2s', fontSize: 10, color: 'var(--dsw-alias-label-secondary,#7b8088)',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0
    }),
    stepHeaderRight: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' },
    stepBody: { padding: '10px 14px', borderTop: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', fontSize: 13, background: 'var(--dsw-alias-bg-secondary,#f9fafb)' },
    stepField: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 },
    stepLabel: { color: 'var(--dsw-alias-label-secondary,#7b8088)', whiteSpace: 'nowrap' },
    stepValue: { color: 'var(--dsw-alias-label-primary,#17191c)', wordBreak: 'break-all', whiteSpace: 'pre-wrap' },
    /* 知识库命中条目 */
    excerptItem: { padding: '6px 10px', marginBottom: 4, borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e8eaed)' },
    excerptTitle: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary,#17191c)', marginBottom: 2 },
    excerptMeta: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 2 },
    excerptText: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#555)', fontStyle: 'italic' },
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
    return (_jsxs("div", { style: S.waterfallWrap, children: [_jsx("div", { style: S.sectionTitle, children: "\u2500\u2500 \u7011\u5E03\u56FE\uFF08Trace Timeline\uFF09\u2500\u2500" }), _jsx("div", { style: S.waterfall, children: spans.map((s) => (_jsxs("div", { style: S.wfRow, children: [_jsx("span", { style: S.wfIcon, children: s.icon }), _jsx("span", { style: S.wfLabel, children: s.label }), _jsx("div", { style: S.wfTrack, children: _jsx("div", { style: S.wfBar(s.color, (s.duration / total) * 100) }) }), _jsx("span", { style: S.wfDur, children: durationText(s.duration) }), _jsx("span", { style: S.wfStatus, children: s.data?.error ? '❌' : (s.duration > 0 ? '✅' : '—') })] }, s.key))) })] }));
}
/** 单个步骤 Accordion */
function StepAccordion({ def, record, isOpen, onToggle }) {
    const data = record[def.field];
    const dur = data?.duration_ms ?? 0;
    return (_jsxs("div", { style: S.stepItem, children: [_jsxs("button", { type: "button", style: S.stepHeader, onClick: onToggle, children: [_jsx("span", { style: S.stepArrow(isOpen), children: "\u25B6" }), _jsxs("span", { children: [def.icon, " ", def.label] }), _jsxs("span", { style: S.stepHeaderRight, children: [_jsx("span", { children: durationText(dur) }), _jsx("span", { children: data?.error ? '❌' : (dur > 0 ? '✅' : '—') })] })] }), isOpen && data && (_jsx("div", { style: S.stepBody, children: renderStepContent(def.key, data, record) }))] }));
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
    return (_jsxs("div", { style: S.stepField, children: [_jsx("span", { style: S.stepLabel, children: "\u8F93\u5165" }), _jsxs("span", { style: S.stepValue, children: [imageCount, " \u5F20\u56FE\u7247"] }), sizes.map((size, i) => (_jsxs(_Fragment, { children: [_jsx("span", { style: S.stepLabel, children: " " }, `k${i}`), _jsxs("span", { style: S.stepValue, children: ["\uD83D\uDC1F ", names[i] || `image_${String(i + 1).padStart(3, '0')}`, ' ', "(", formatBytes(size), compressed[i] ? ` → ${formatBytes(compressed[i])}` : '', ")"] }, `v${i}`)] }))), _jsx("span", { style: S.stepLabel, children: "\u8F93\u51FA" }), _jsxs("span", { style: S.stepValue, children: [imageCount, " \u5F20\u56FE\u7247\u5DF2\u538B\u7F29\u5E76\u8F6C\u4E3A base64"] }), err && (_jsxs(_Fragment, { children: [_jsx("span", { style: { ...S.stepLabel, color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { style: { ...S.stepValue, color: '#ff4d4f' }, children: err })] }))] }));
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
    return (_jsxs("div", { style: S.stepField, children: [_jsx("span", { style: S.stepLabel, children: "\u6A21\u578B" }), _jsxs("span", { style: S.stepValue, children: [record?.model || '—', " (temperature=0.1)"] }), _jsx("span", { style: S.stepLabel, children: "\u8F93\u5165" }), _jsxs("span", { style: S.stepValue, children: ["system prompt (", promptLen, " chars) + \u56FE\u7247"] }), _jsx("span", { style: S.stepLabel, children: "\u8F93\u51FA" }), _jsxs("span", { style: S.stepValue, children: ["\u72B6\u6001: ", CLS_LABEL[cls] || cls, "\uFF08", cls, "\uFF09", '\n', "\u7F6E\u4FE1\u5EA6: ", confidence.toFixed(2), '\n', "\u75C7\u72B6: ", symptoms.length > 0 ? symptoms.join('、') : '无异常', severity ? `\n严重度: ${severity}` : '', organs.length > 0 ? `\n器官: ${organs.join('、')}` : ''] }), _jsx("span", { style: S.stepLabel, children: "Token" }), _jsxs("span", { style: S.stepValue, children: ["input=", tokenText(inputTok), " output=", tokenText(outputTok)] }), raw && (_jsxs(_Fragment, { children: [_jsx("span", { style: S.stepLabel, children: "\u539F\u59CB\u8F93\u51FA" }), _jsx("span", { style: S.stepValue, children: raw })] })), err && (_jsxs(_Fragment, { children: [_jsx("span", { style: { ...S.stepLabel, color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { style: { ...S.stepValue, color: '#ff4d4f' }, children: err })] }))] }));
}
function renderRetrieveStep(data) {
    const query = data.query ?? '';
    const chA = data.channel_a_wiki ?? 0;
    const chB = data.channel_b_note ?? 0;
    const chC = data.channel_c_pdf ?? 0;
    const merged = data.merged_count ?? 0;
    const excerpts = data.excerpts ?? [];
    const err = data.error;
    return (_jsxs("div", { style: S.stepField, children: [_jsx("span", { style: S.stepLabel, children: "\u67E5\u8BE2" }), _jsxs("span", { style: S.stepValue, children: ["\"", query, "\""] }), _jsx("span", { style: S.stepLabel, children: "\u901A\u9053A (wiki)" }), _jsxs("span", { style: S.stepValue, children: ["\u547D\u4E2D ", chA, " \u6761"] }), _jsx("span", { style: S.stepLabel, children: "\u901A\u9053B (note)" }), _jsxs("span", { style: S.stepValue, children: ["\u547D\u4E2D ", chB, " \u6761"] }), _jsx("span", { style: S.stepLabel, children: "\u901A\u9053C (PDF)" }), _jsxs("span", { style: S.stepValue, children: ["\u547D\u4E2D ", chC, " \u6761"] }), _jsx("span", { style: S.stepLabel, children: "\u5408\u5E76\u53BB\u91CD" }), _jsxs("span", { style: S.stepValue, children: [merged, " \u6761"] }), excerpts.length > 0 && (_jsxs(_Fragment, { children: [_jsx("span", { style: S.stepLabel, children: "\u547D\u4E2D\u6761\u76EE" }), _jsx("span", { style: S.stepValue, children: excerpts.map((ex, i) => (_jsxs("div", { style: S.excerptItem, children: [_jsxs("div", { style: S.excerptTitle, children: ["\uD83D\uDCC4 \u300A", ex.title, "\u300B", ex.from ? `[${fromLabel(ex.from)}]` : ''] }), ex.locator && _jsx("div", { style: S.excerptMeta, children: ex.locator }), _jsxs("div", { style: S.excerptText, children: ["\u300C", ex.excerpt_preview, "\u300D"] })] }, i))) })] })), err && (_jsxs(_Fragment, { children: [_jsx("span", { style: { ...S.stepLabel, color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { style: { ...S.stepValue, color: '#ff4d4f' }, children: err })] }))] }));
}
function renderAdviceStep(data) {
    const alertLevel = data.alert_level ?? '';
    const refsCount = data.knowledge_refs_count ?? 0;
    const diagnosis = data.diagnosis_summary ?? '';
    const reasoning = data.reasoning_preview ?? '';
    const err = data.error;
    return (_jsxs("div", { style: S.stepField, children: [_jsx("span", { style: S.stepLabel, children: "\u9884\u8B66\u7EA7\u522B" }), _jsx("span", { style: S.stepValue, children: alertLevel || '—' }), _jsx("span", { style: S.stepLabel, children: "\u77E5\u8BC6\u6765\u6E90" }), _jsxs("span", { style: S.stepValue, children: [refsCount, " \u6761"] }), _jsx("span", { style: S.stepLabel, children: "\u8BCA\u65AD" }), _jsx("span", { style: S.stepValue, children: diagnosis || '—' }), _jsx("span", { style: S.stepLabel, children: "\u63A8\u7406" }), _jsx("span", { style: S.stepValue, children: reasoning || '—' }), err && (_jsxs(_Fragment, { children: [_jsx("span", { style: { ...S.stepLabel, color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { style: { ...S.stepValue, color: '#ff4d4f' }, children: err })] }))] }));
}
function renderLedgerStep(data) {
    const table = data.target_table ?? '';
    const op = data.operation ?? '';
    const recId = data.record_id ?? '';
    const success = data.success;
    const message = data.message ?? '';
    const err = data.error;
    return (_jsxs("div", { style: S.stepField, children: [_jsx("span", { style: S.stepLabel, children: "\u76EE\u6807\u8868" }), _jsx("span", { style: S.stepValue, children: table || '—' }), _jsx("span", { style: S.stepLabel, children: "\u64CD\u4F5C" }), _jsx("span", { style: S.stepValue, children: op === 'create' ? '新增' : op === 'update' ? '更新' : op || '—' }), recId && (_jsxs(_Fragment, { children: [_jsx("span", { style: S.stepLabel, children: "\u8BB0\u5F55ID" }), _jsx("span", { style: S.stepValue, children: recId })] })), success !== undefined && (_jsxs(_Fragment, { children: [_jsx("span", { style: S.stepLabel, children: "\u7ED3\u679C" }), _jsx("span", { style: S.stepValue, children: success ? '✅ 成功' : '❌ 失败' })] })), message && (_jsxs(_Fragment, { children: [_jsx("span", { style: S.stepLabel, children: "\u4FE1\u606F" }), _jsx("span", { style: S.stepValue, children: message })] })), err && (_jsxs(_Fragment, { children: [_jsx("span", { style: { ...S.stepLabel, color: '#ff4d4f' }, children: "\u9519\u8BEF" }), _jsx("span", { style: { ...S.stepValue, color: '#ff4d4f' }, children: err })] }))] }));
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
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pool, setPool] = useState('');
    const [cls, setCls] = useState('');
    // --- 详情状态 ---
    const [detailId, setDetailId] = useState(null);
    const [detailRecord, setDetailRecord] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState(null);
    const [openSteps, setOpenSteps] = useState(new Set());
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
    // ---------- 详情 ----------
    const openDetail = useCallback(async (id) => {
        setDetailId(id);
        setDetailRecord(null);
        setDetailLoading(true);
        setDetailError(null);
        setOpenSteps(new Set());
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
        return (_jsxs("div", { style: S.detailWrap, children: [detailLoading && _jsx("div", { style: S.empty, children: "\u52A0\u8F7D\u4E2D\u2026" }), detailError && (_jsxs("div", { style: S.err, children: [_jsx("div", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }, children: detailError }), _jsx("button", { type: "button", style: { ...S.moreBtn, marginTop: 8, width: 'auto', display: 'inline-block' }, onClick: backToList, children: "\u8FD4\u56DE\u5217\u8868" })] })), detailRecord && (_jsxs("div", { children: [_jsxs("div", { style: S.detailTitle, children: [_jsx("button", { type: "button", style: S.detailBack, onClick: backToList, children: "\u2190 \u8FD4\u56DE" }), _jsx("span", { style: { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: detailRecord.id }), _jsx("span", { style: { fontWeight: 600 }, children: detailRecord.pool }), _jsx("span", { style: { fontWeight: 600 }, children: "\u5DE1\u68C0\u5206\u6790" }), (() => {
                                    const cls = detailRecord.span_analyze?.cls ?? 'unknown';
                                    return (_jsxs("span", { style: S.statusBadge(cls), children: [_jsx("span", { style: { width: 6, height: 6, borderRadius: '50%', background: CLS_COLOR[cls] || '#9ca3af' } }), CLS_LABEL[cls] || cls] }));
                                })()] }), _jsxs("div", { style: S.metaGrid, children: [_jsx("span", { style: S.metaLabel, children: "\u6C60\u53F7:" }), _jsx("span", { style: S.metaValue, children: detailRecord.pool }), _jsx("span", { style: S.metaLabel, children: "\u4E0A\u62A5\u4EBA:" }), _jsx("span", { style: S.metaValue, children: detailRecord.reporter || '—' }), _jsx("span", { style: S.metaLabel, children: "\u6765\u6E90:" }), _jsx("span", { style: S.metaValue, children: SOURCE_LABEL[detailRecord.source] || detailRecord.source }), _jsx("span", { style: S.metaLabel, children: "\u65F6\u95F4:" }), _jsx("span", { style: S.metaValue, children: formatDateTime(detailRecord.created_at) }), _jsx("span", { style: S.metaLabel, children: "\u603B\u8017\u65F6:" }), _jsx("span", { style: S.metaValue, children: durationText(detailRecord.total_duration_ms) }), _jsx("span", { style: S.metaLabel, children: "\u6A21\u578B:" }), _jsx("span", { style: S.metaValue, children: detailRecord.model || '—' }), _jsx("span", { style: S.metaLabel, children: "Token:" }), _jsxs("span", { style: S.metaValue, children: ["input=", tokenText(detailRecord.span_analyze?.input_tokens ?? 0), " output=", tokenText(detailRecord.span_analyze?.output_tokens ?? 0)] })] }), _jsx(WaterfallChart, { record: detailRecord }), _jsx("div", { style: S.sectionTitle, children: "\u2500\u2500 \u6B65\u9AA4\u8BE6\u60C5\uFF08Accordion \u5C55\u5F00\uFF09\u2500\u2500" }), _jsx("div", { style: S.stepsWrap, children: SPAN_DEFS.map((def) => (_jsx(StepAccordion, { def: def, record: detailRecord, isOpen: openSteps.has(def.key), onToggle: () => { toggleStep(def.key); } }, def.key))) })] }))] }));
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
    return (_jsxs(_Fragment, { children: [_jsxs("div", { style: S.filterBar, children: [_jsx("select", { style: S.select, value: pool, onChange: (e) => { applyFilter(e.target.value, cls); }, "aria-label": "\u6309\u6C60\u53F7\u7B5B\u9009", children: POOL_OPTIONS.map((p) => _jsx("option", { value: p, children: p || '全部池号' }, p)) }), _jsx("select", { style: S.select, value: cls, onChange: (e) => { applyFilter(pool, e.target.value); }, "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009", children: CLS_OPTIONS.map(([v, l]) => _jsx("option", { value: v, children: l }, v)) }), _jsxs("span", { style: { marginLeft: 'auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', alignSelf: 'center' }, children: [total, " \u6761\u8BB0\u5F55"] }), _jsx("button", { type: "button", style: { ...S.trendLink, marginTop: 0 }, onClick: () => {
                            const targetPool = pool || '池1';
                            onOpenTrend?.(targetPool);
                        }, children: "\uD83D\uDCC8 \u6C60\u53F7\u8D8B\u52BF\u5206\u6790 \u2192" })] }), _jsxs("div", { style: S.list, children: [error && (_jsxs("div", { style: S.err, children: [_jsx("div", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }, children: error }), _jsx("button", { type: "button", style: { ...S.moreBtn, marginTop: 8, width: 'auto', display: 'inline-block' }, onClick: () => { void fetchPage(true); }, children: "\u91CD\u8BD5" })] })), !error && records.length === 0 && !loading && _jsx("div", { style: S.empty, children: "\u6682\u65E0\u5206\u6790\u8BB0\u5F55" }), loading && records.length === 0 && _jsx("div", { style: S.empty, children: "\u52A0\u8F7D\u4E2D\u2026" }), groups.map((g) => (_jsxs("div", { children: [_jsx("div", { style: S.groupTitle, children: g.title }), g.items.map((r) => {
                                const clsName = CLS_LABEL[r.cls] || r.cls || '未知';
                                const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常';
                                return (_jsxs("button", { type: "button", style: S.row, onClick: () => { void openDetail(r.id); }, children: [_jsxs("div", { style: S.line1, children: [_jsx("span", { style: S.dot(r.cls) }), _jsx("span", { style: { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: r.id }), _jsx("span", { style: { fontWeight: 600 }, children: r.pool }), _jsx("span", { style: { fontWeight: 600, color: CLS_COLOR[r.cls] || '#9ca3af' }, children: clsName }), _jsx("span", { style: { color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: (r.confidence || 0).toFixed(2) }), _jsx("span", { style: { ...S.symptom, color: r.cls === 'disease' ? '#ff4d4f' : 'var(--dsw-alias-label-secondary,#7b8088)' }, children: sym })] }), _jsxs("div", { style: S.line2, children: [_jsx("span", { children: timeText(r.created_at) }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: SOURCE_LABEL[r.source || ''] || r.source }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: r.alert_level ? 'AI视觉+知识库' : 'AI视觉' }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: durationText(r.total_duration_ms) }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: [tokenText(r.total_tokens), " tokens"] })] })] }, r.id));
                            })] }, g.title))), hasMore && !loading && (_jsx("button", { type: "button", style: S.moreBtn, onClick: () => { void fetchPage(false); }, children: "\u52A0\u8F7D\u66F4\u591A" })), loading && records.length > 0 && (_jsx("div", { style: { ...S.empty, padding: '20px 0' }, children: "\u52A0\u8F7D\u4E2D\u2026" }))] })] }));
}
export function TraceTrendView({ pool, apiBase = '/aquasense-reports', onBack }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [days, setDays] = useState(7);
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
    if (loading)
        return _jsx("div", { style: { padding: 20, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: "\u52A0\u8F7D\u4E2D\u2026" });
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
    return (_jsxs("div", { style: { flex: 1, overflow: 'auto' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)' }, children: [_jsx("button", { type: "button", style: { padding: '4px 8px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 13, cursor: 'pointer' }, onClick: onBack, children: "\u2190 \u8FD4\u56DE\u5217\u8868" }), _jsxs("span", { style: { fontSize: 14, fontWeight: 600 }, children: [pool, " \u8D8B\u52BF\u5206\u6790"] }), _jsx("span", { style: { marginLeft: 'auto' }, children: _jsxs("select", { style: { padding: '4px 8px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 6, fontSize: 12, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)' }, value: days, onChange: (e) => setDays(Number(e.target.value)), children: [_jsx("option", { value: 7, children: "\u8FD17\u5929" }), _jsx("option", { value: 30, children: "\u8FD130\u5929" }), _jsx("option", { value: 3650, children: "\u5168\u90E8" })] }) })] }), _jsxs("div", { style: { padding: '12px 16px 32px' }, children: [_jsxs("div", { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 16 }, children: ["\u8FD1 ", days, " \u5929\u5171 ", _jsx("b", { style: { color: 'var(--dsw-alias-label-primary,#17191c)' }, children: total }), " \u6761\u5206\u6790\u8BB0\u5F55"] }), _jsxs("div", { style: { marginBottom: 20 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 8 }, children: "\u2500\u2500 \u72B6\u6001\u5206\u5E03 \u2500\u2500" }), _jsx("div", { style: { background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, padding: 12 }, children: total > 0 ? distOrder.map(([key, label, color]) => {
                                    const n = dist[key] || 0;
                                    const pct = Math.round(n / total * 100);
                                    return (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }, children: [_jsx("span", { style: { width: 48, flexShrink: 0 }, children: label }), _jsx("div", { style: { flex: 1, height: 16, background: 'var(--dsw-alias-bg-secondary,#f0f1f3)', borderRadius: 4, overflow: 'hidden' }, children: _jsx("div", { style: { height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s' } }) }), _jsxs("span", { style: { width: 96, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }, children: [pct, "% (", n, "\u6B21)"] })] }, key));
                                }) : _jsx("div", { style: { color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }, children: "\u6682\u65E0\u6570\u636E" }) })] }), _jsxs("div", { style: { marginBottom: 20 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 8 }, children: "\u2500\u2500 \u75C7\u72B6\u9891\u6B21 TOP \u2500\u2500" }), _jsx("div", { style: { background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, padding: 12 }, children: data.top_symptoms.length > 0 ? (() => {
                                    const max = data.top_symptoms[0]?.count || 1;
                                    return data.top_symptoms.map((s) => (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }, children: [_jsx("span", { style: { width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: s.symptom }), _jsx("div", { style: { flex: 1, height: 14, background: 'var(--dsw-alias-bg-secondary,#f0f1f3)', borderRadius: 4, overflow: 'hidden' }, children: _jsx("div", { style: { height: '100%', width: `${Math.round(s.count / max * 100)}%`, background: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', borderRadius: 4 } }) }), _jsxs("span", { style: { width: 44, textAlign: 'right', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', flexShrink: 0 }, children: [s.count, "\u6B21"] })] }, s.symptom)));
                                })() : _jsx("div", { style: { color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 13 }, children: "\u6682\u65E0\u5F02\u5E38\u75C7\u72B6\u8BB0\u5F55" }) })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#7b8088)', marginBottom: 8 }, children: "\u2500\u2500 \u6700\u8FD1\u8BB0\u5F55 \u2500\u2500" }), _jsx("div", { style: { background: 'var(--dsw-alias-bg-layer-3,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', borderRadius: 8, overflow: 'hidden' }, children: data.recent_records.length > 0 ? data.recent_records.map((r) => {
                                    const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常';
                                    return (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e8eaed)', fontSize: 13 }, children: [_jsx("span", { style: { width: 44, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }, children: timeText(r.created_at) }), _jsx("span", { style: { width: 44, flexShrink: 0, fontWeight: 600, color: CLS_COLOR[r.cls] || '#9ca3af' }, children: CLS_LABEL[r.cls] || r.cls }), _jsx("span", { style: { width: 36, flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }, children: (r.confidence || 0).toFixed(2) }), _jsx("span", { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: sym }), _jsx("span", { style: { flexShrink: 0, color: 'var(--dsw-alias-label-secondary,#7b8088)', fontSize: 12 }, children: durationText(r.total_duration_ms) })] }, r.id));
                                }) : _jsx("div", { style: { padding: 20, textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: "\u6682\u65E0\u8BB0\u5F55" }) })] })] })] }));
}
