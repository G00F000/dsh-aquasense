import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useCallback, useEffect, useState } from 'react';
/** 详情接口信封 = 单条 TraceRecord */
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
const CLS_LABEL = { normal: '正常', early: '前兆', disease: '发病', unknown: '未知' };
const SOURCE_LABEL = { h5_upload: 'H5上传', group_chat: '群聊发图', api: 'API' };
// ========== 内联样式(与面板 token 一致) ==========
const S = {
    /** 筛选条 */
    filterBar: { display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', flexShrink: 0 },
    select: { appearance: 'none', padding: '6px 28px 6px 10px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)', fontSize: 13, lineHeight: '20px' },
    /** 列表区(可滚动) */
    list: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '12px 20px 32px' },
    /** 空态/加载态 */
    empty: { padding: '60px 0', textAlign: 'center', color: 'var(--dsw-alias-label-secondary,#7b8088)' },
    /** 日期分组标题 */
    groupTitle: { margin: '18px 0 8px', fontSize: 13, color: 'var(--dsw-alias-label-secondary,#7b8088)' },
    /** 记录行 */
    row: { display: 'block', padding: '12px 14px', color: 'inherit', textDecoration: 'none', borderBottom: '1px solid var(--dsw-alias-border-l2,#e2e4e8)', cursor: 'pointer', background: 'transparent' },
    /** 记录行第一行 */
    line1: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 },
    /** 状态圆点 */
    dot: (cls) => ({
        flex: 'none', width: 8, height: 8, borderRadius: '50%',
        background: { normal: '#52c41a', early: '#faad14', disease: '#ff4d4f', unknown: '#9ca3af' }[cls] || '#9ca3af'
    }),
    /** 记录行第二行 */
    line2: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' },
    chip: { padding: '1px 8px', borderRadius: 999, background: 'var(--dsw-alias-bg-secondary,#eef2f7)', fontSize: 12 },
    /** 加载更多按钮 */
    moreBtn: { display: 'block', width: '100%', margin: '16px 0 0', padding: 10, border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-3,#fff)', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer' },
    /** 错误提示 */
    err: { margin: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #ff4d4f', background: 'var(--dsw-alias-bg-layer-3,#fff)', color: '#ff4d4f', fontSize: 13 },
    /** 详情容器 */
    detailWrap: { padding: '16px 20px 32px' },
    detailBack: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-button-primary-fill,#4d6bfe)', fontSize: 14, cursor: 'pointer', marginBottom: 12 },
    detailGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', fontSize: 14 },
    detailLabel: { color: 'var(--dsw-alias-label-secondary,#7b8088)', whiteSpace: 'nowrap' },
    detailValue: { color: 'var(--dsw-alias-label-primary,#17191c)', wordBreak: 'break-all' },
};
// ========== 辅助 ==========
function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
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
export function TraceRecordList({ apiBase = '/aquasense-reports' }) {
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
    // ---------- 列表数据加载 ----------
    /** 获取记录列表;错误信息区分网络/HTTP/信封三类 */
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
                // 网络层错误:连接被拒/DNS 失败/CORS 等
                throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})
请求: ${url}`);
            }
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status} ${resp.statusText}
请求: ${url}`);
            const body = await resp.json();
            if (!body?.ok)
                throw new Error(body?.error?.message || `接口返回失败
请求: ${url}`);
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
    /** 筛选变更 → 重置列表 */
    const applyFilter = useCallback((newPool, newCls) => {
        setPool(newPool);
        setCls(newCls);
        setRecords([]);
        setOffset(0);
        setHasMore(false);
        setError(null);
        setDetailId(null);
        setDetailRecord(null);
        // 下一帧触发加载(useEffect 监听依赖变化)
    }, []);
    /** pool/cls 变化后自动加载重置列表 */
    useEffect(() => {
        // 避免首次重复加载(由下方 initial effect 触发)
        if (records.length === 0 && offset === 0 && !loading) {
            void fetchPage(true);
        }
    }, [pool, cls]); // eslint-disable-line react-hooks/exhaustive-deps
    /** 首次挂载加载 */
    useEffect(() => {
        void fetchPage(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // ---------- 详情数据 ----------
    /** 获取详情;错误信息区分网络/HTTP/信封三类 */
    const openDetail = useCallback(async (id) => {
        setDetailId(id);
        setDetailRecord(null);
        setDetailLoading(true);
        setDetailError(null);
        try {
            const url = `${apiBase}/api/records/${encodeURIComponent(id)}`;
            let resp;
            try {
                resp = await fetch(url);
            }
            catch (netErr) {
                throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})
请求: ${url}`);
            }
            if (!resp.ok)
                throw new Error(`HTTP ${resp.status} ${resp.statusText}
请求: ${url}`);
            const body = await resp.json();
            if (!body?.ok)
                throw new Error(body?.error?.message || `接口返回失败
请求: ${url}`);
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
    // ---------- 渲染:详情 ----------
    if (detailId) {
        return (_jsxs("div", { style: S.detailWrap, children: [_jsx("button", { type: "button", style: S.detailBack, onClick: backToList, children: "\u2190 \u8FD4\u56DE\u5217\u8868" }), detailLoading && _jsx("div", { style: S.empty, children: "\u52A0\u8F7D\u4E2D\u2026" }), detailError && (_jsxs("div", { style: S.err, children: [_jsx("div", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }, children: detailError }), _jsx("button", { type: "button", style: { ...S.moreBtn, marginTop: 8, width: 'auto', display: 'inline-block' }, onClick: backToList, children: "\u8FD4\u56DE\u5217\u8868" })] })), detailRecord && (_jsx("div", { children: _jsxs("div", { style: S.detailGrid, children: [_jsx("span", { style: S.detailLabel, children: "\u8BB0\u5F55 ID" }), _jsx("span", { style: S.detailValue, children: detailRecord.id }), _jsx("span", { style: S.detailLabel, children: "\u6C60\u53F7" }), _jsx("span", { style: S.detailValue, children: detailRecord.pool }), _jsx("span", { style: S.detailLabel, children: "\u72B6\u6001" }), _jsx("span", { style: S.detailValue, children: CLS_LABEL[detailRecord.cls] || detailRecord.cls }), _jsx("span", { style: S.detailLabel, children: "\u7F6E\u4FE1\u5EA6" }), _jsx("span", { style: S.detailValue, children: (detailRecord.confidence || 0).toFixed(2) }), _jsx("span", { style: S.detailLabel, children: "\u75C7\u72B6" }), _jsx("span", { style: S.detailValue, children: detailRecord.symptoms?.join('、') || '无异常' }), _jsx("span", { style: S.detailLabel, children: "\u6765\u6E90" }), _jsx("span", { style: S.detailValue, children: SOURCE_LABEL[detailRecord.source || ''] || detailRecord.source }), _jsx("span", { style: S.detailLabel, children: "\u77E5\u8BC6\u5E93\u589E\u5F3A" }), _jsx("span", { style: S.detailValue, children: detailRecord.alert_level ? '是' : '否' }), _jsx("span", { style: S.detailLabel, children: "\u8017\u65F6" }), _jsx("span", { style: S.detailValue, children: durationText(detailRecord.total_duration_ms) }), _jsx("span", { style: S.detailLabel, children: "Token" }), _jsx("span", { style: S.detailValue, children: tokenText(detailRecord.total_tokens) }), _jsx("span", { style: S.detailLabel, children: "\u521B\u5EFA\u65F6\u95F4" }), _jsx("span", { style: S.detailValue, children: new Date(detailRecord.created_at).toLocaleString('zh-CN') })] }) }))] }));
    }
    // ---------- 渲染:列表 ----------
    // 按日期分组
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
    return (_jsxs(_Fragment, { children: [_jsxs("div", { style: S.filterBar, children: [_jsx("select", { style: S.select, value: pool, onChange: (e) => { applyFilter(e.target.value, cls); }, "aria-label": "\u6309\u6C60\u53F7\u7B5B\u9009", children: POOL_OPTIONS.map((p) => _jsx("option", { value: p, children: p || '全部池号' }, p)) }), _jsx("select", { style: S.select, value: cls, onChange: (e) => { applyFilter(pool, e.target.value); }, "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009", children: CLS_OPTIONS.map(([v, l]) => _jsx("option", { value: v, children: l }, v)) }), _jsxs("span", { style: { marginLeft: 'auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)', alignSelf: 'center' }, children: [total, " \u6761\u8BB0\u5F55"] })] }), _jsxs("div", { style: S.list, children: [error && (_jsxs("div", { style: S.err, children: [_jsx("div", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }, children: error }), _jsx("button", { type: "button", style: { ...S.moreBtn, marginTop: 8, width: 'auto', display: 'inline-block' }, onClick: () => { void fetchPage(true); }, children: "\u91CD\u8BD5" })] })), !error && records.length === 0 && !loading && _jsx("div", { style: S.empty, children: "\u6682\u65E0\u5206\u6790\u8BB0\u5F55" }), loading && records.length === 0 && _jsx("div", { style: S.empty, children: "\u52A0\u8F7D\u4E2D\u2026" }), groups.map((g) => (_jsxs("div", { children: [_jsx("div", { style: S.groupTitle, children: g.title }), g.items.map((r) => {
                                const clsName = CLS_LABEL[r.cls] || r.cls || '未知';
                                const sym = r.symptoms?.length ? r.symptoms.join('、') : '无异常';
                                return (_jsxs("button", { type: "button", style: S.row, onClick: () => { void openDetail(r.id); }, children: [_jsxs("div", { style: S.line1, children: [_jsx("span", { style: S.dot(r.cls) }), _jsx("span", { style: { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', fontSize: 12, color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: r.id }), _jsx("span", { style: { fontWeight: 600 }, children: r.pool }), _jsx("span", { style: { fontWeight: 600, color: { normal: '#52c41a', early: '#faad14', disease: '#ff4d4f', unknown: '#9ca3af' }[r.cls] || '#9ca3af' }, children: clsName }), _jsx("span", { style: { color: 'var(--dsw-alias-label-secondary,#7b8088)' }, children: (r.confidence || 0).toFixed(2) }), _jsx("span", { style: { flex: '1 1 100%', color: r.cls === 'disease' ? '#ff4d4f' : 'var(--dsw-alias-label-secondary,#7b8088)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: sym })] }), _jsxs("div", { style: S.line2, children: [_jsx("span", { children: timeText(r.created_at) }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: SOURCE_LABEL[r.source || ''] || r.source }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: r.alert_level ? 'AI视觉+知识库' : 'AI视觉' }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: durationText(r.total_duration_ms) }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: [tokenText(r.total_tokens), " tokens"] })] })] }, r.id));
                            })] }, g.title))), hasMore && !loading && (_jsx("button", { type: "button", style: S.moreBtn, onClick: () => { void fetchPage(false); }, children: "\u52A0\u8F7D\u66F4\u591A" })), loading && records.length > 0 && (_jsx("div", { style: { ...S.empty, padding: '20px 0' }, children: "\u52A0\u8F7D\u4E2D\u2026" }))] })] }));
}
