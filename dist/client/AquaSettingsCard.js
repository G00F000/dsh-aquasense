import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AquaSettingsCard —— settings.plugin.item 槽位卡片(设置 → 插件 → 插件配置)
 *
 * 「AquaSense 设置」:配置池号枚举,保存后整个插件系统(台账白名单、
 * H5 拍照汇报校验、分析记录筛选/趋势)统一按该池号生效。
 *
 * 卡片外壳:标题/描述/未保存徽标 + 展开/收起按钮;展开区为池号列表编辑表单。
 * 数据经 /aquasense-settings/api 与 Host 侧读写(见 src/web/aqua-settings-gateway.ts)。
 *
 * UI 对齐 SkillHub(插件广场)设置卡(.sh-cfg 体系):展开区 + 独立收起按钮、
 * 未保存徽标、字段分隔线、底部「放弃修改 / 保存配置」操作区。
 */
import { useCallback, useEffect, useState } from 'react';
/** 池号数量/长度上限(与 Host 侧 aqua-settings.ts 保持一致) */
export const MAX_POOLS = 20;
export const MAX_POOL_LENGTH = 16;
/** 用户映射表单个姓名最大长度 */
export const MAX_USER_NAME_LENGTH = 32;
// ========== 卡片外壳样式(对齐 SkillHub .sh-cfg 体系) ==========
const cardStyle = {
    border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    background: 'var(--dsw-alias-bg-layer-3, #fff)',
    borderRadius: 12,
    boxSizing: 'border-box',
    listStyle: 'none',
    transition: 'border-color .16s, background .16s'
};
/** 展开态卡底色(对齐 .sh-cfg.open) */
const cardOpenStyle = {
    background: 'var(--dsw-alias-bg-layer-2, #fafafa)'
};
const headerStyle = {
    boxSizing: 'border-box',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    display: 'flex'
};
/** 展开区按钮:标题 + 描述 + 未保存徽标(对齐 .sh-cfg-expand) */
const expandStyle = {
    appearance: 'none',
    flex: 1,
    minWidth: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    background: 'transparent',
    border: 0,
    alignItems: 'center',
    gap: 12,
    padding: 0,
    display: 'flex'
};
/** 收起/展开按钮:28×28 独立热区(对齐 .sh-cfg-toggle) */
const toggleStyle = {
    appearance: 'none',
    flex: 'none',
    width: 28,
    height: 28,
    padding: 0,
    border: 0,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center'
};
const headTextStyle = {
    flexDirection: 'column',
    flex: 1,
    gap: 4,
    minWidth: 0,
    display: 'flex'
};
const nameStyle = {
    color: 'var(--dsw-alias-label-primary, inherit)',
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.4
};
const descStyle = {
    color: 'var(--dsw-alias-label-tertiary, #6b7280)',
    fontSize: 13,
    lineHeight: 1.5
};
/** 未保存徽标(对齐 .sh-tag.orange) */
const unsavedStyle = {
    flex: 'none',
    whiteSpace: 'nowrap',
    background: 'var(--dsw-alias-state-warn-tertiary, #fff7ed)',
    color: 'var(--dsw-alias-state-warn-label, #c2410c)',
    borderRadius: 6,
    padding: '2px 6px',
    fontSize: 11,
    lineHeight: '16px'
};
/** 收起箭头:展开态旋转 180°(对齐 .sh-cfg-ch) */
const chevronStyle = (open) => ({
    color: 'var(--dsw-alias-label-tertiary, #6b7280)',
    flex: 'none',
    width: 14,
    height: 14,
    transition: 'transform .16s',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: open ? 'rotate(180deg)' : 'none'
});
/** 卡体(对齐 .sh-cfg-b) */
const bodyStyle = {
    borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    margin: '0 16px',
    padding: '8px 0 12px'
};
/** 收起态仅隐藏卡体(表单保持挂载,展开不重新拉取) */
const HIDDEN_STYLE = {
    display: 'none'
};
const CHEVRON_SVG = (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M6 9l6 6 6-6" }) }));
// ========== 表单样式(对齐 RemindForm) ==========
const formStyle = {
    display: 'flex',
    flexDirection: 'column'
};
const labelStyle = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--dsw-alias-label-primary, inherit)'
};
const inputStyle = {
    width: '100%',
    height: 34,
    padding: '0 12px',
    fontSize: 13,
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-3, #fff))',
    color: 'var(--dsw-alias-label-primary, inherit)',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
};
const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8
};
/** 行内删除按钮(对齐 .sh-cfg-disc 语义,精简为 28×34 图标钮) */
const removeBtnStyle = {
    appearance: 'none',
    flex: 'none',
    width: 34,
    height: 34,
    padding: 0,
    font: 'inherit',
    fontSize: 14,
    cursor: 'pointer',
    borderRadius: 8,
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--dsw-alias-label-tertiary, #6b7280)',
    transition: 'color .16s, border-color .16s'
};
const addBtnStyle = {
    appearance: 'none',
    alignSelf: 'flex-start',
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: 8,
    padding: '5px 14px',
    fontSize: 13,
    lineHeight: '20px',
    background: 'transparent',
    border: '1px solid var(--dsw-alias-border-l2, #d1d5db)',
    color: 'var(--dsw-alias-label-secondary, #4b5563)',
    transition: 'background .16s, opacity .16s'
};
const hintStyle = {
    fontSize: 12,
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    margin: 0,
    lineHeight: 1.5
};
/** 分隔线样式 */
const dividerStyle = {
    borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    margin: '16px 0'
};
/** 用户映射表头样式 */
const userMapHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8
};
/** 用户映射行样式 */
const userMapRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8
};
/** open_id 输入框样式(只读) */
const openIdInputStyle = {
    ...inputStyle,
    width: 200,
    flex: 'none',
    background: 'var(--dsw-alias-bg-layer-2, #f3f4f6)',
    color: 'var(--dsw-alias-label-secondary, #6b7280)'
};
/** 姓名输入框样式 */
const nameInputStyle = {
    ...inputStyle,
    flex: 1
};
/** 加载按钮样式 */
const loadBtnStyle = {
    ...addBtnStyle,
    marginLeft: 'auto'
};
/** 群ID输入框样式 */
const chatIdInputStyle = {
    ...inputStyle,
    width: 280,
    flex: 'none'
};
const errorStyle = {
    ...hintStyle,
    color: 'var(--dsw-alias-state-danger-label, #dc2626)',
    flex: 1
};
const footerStyle = {
    borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    padding: '12px 0 4px',
    display: 'flex'
};
/** 按钮基础(对齐 .sh-cfg-ft button) */
const btnBase = {
    appearance: 'none',
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: 8,
    padding: '5px 14px',
    fontSize: 13,
    lineHeight: '20px',
    transition: 'background .16s, opacity .16s'
};
/** 次级按钮:透明底 + 描边(对齐 .sh-cfg-disc) */
const ghostBtnStyle = {
    ...btnBase,
    background: 'transparent',
    border: '1px solid var(--dsw-alias-border-l2, #d1d5db)',
    color: 'var(--dsw-alias-label-secondary, #4b5563)'
};
/** 主按钮(对齐 .sh-cfg-save) */
const primaryBtnStyle = {
    ...btnBase,
    background: 'var(--dsw-alias-button-primary-fill, #111827)',
    border: '1px solid var(--dsw-alias-button-primary-fill, #111827)',
    color: 'var(--dsw-alias-label-primary-foreground, #fff)'
};
/** 禁用态透明度(对齐 .sh-cfg-ft button:disabled) */
const DISABLED_OPACITY = 0.4;
/** 已保存提示(对齐 .sh-cfg-ok) */
const savedStyle = {
    ...hintStyle,
    color: 'var(--dsw-alias-state-success-label, #16a34a)',
    flex: 1
};
/** 错误信息提取 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 池号配置加载/编辑/保存(与 useRemindConfig 同构) */
export function useAquaSettings(api, t) {
    const [phase, setPhase] = useState('loading');
    const [saved, setSaved] = useState(null);
    const [draft, setDraft] = useState(null);
    const [savedUserMap, setSavedUserMap] = useState(null);
    const [draftUserMap, setDraftUserMap] = useState(null);
    const [applyState, setApplyState] = useState({ kind: 'idle' });
    const [chatMembers, setChatMembers] = useState([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const load = useCallback(async () => {
        setPhase('loading');
        try {
            const result = await api.get();
            const pools = [...result.settings.pools];
            const userMap = { ...result.settings.userMap };
            setSaved(pools);
            setDraft(pools);
            setSavedUserMap(userMap);
            setDraftUserMap(userMap);
            setApplyState({ kind: 'idle' });
            setPhase('ready');
        }
        catch {
            setPhase('unavailable');
        }
    }, [api]);
    useEffect(() => {
        void load();
    }, [load]);
    const dirty = draft !== null && saved !== null && (JSON.stringify(draft) !== JSON.stringify(saved) || JSON.stringify(draftUserMap) !== JSON.stringify(savedUserMap));
    const saving = applyState.kind === 'saving';
    /** 编辑后回到 idle(清除「已保存」提示,由 dirty 徽标接管) */
    const markEdited = () => {
        setApplyState((state) => (state.kind === 'idle' ? state : { kind: 'idle' }));
    };
    const editPool = (index, value) => {
        setDraft((current) => (current ? current.map((item, i) => (i === index ? value : item)) : current));
        markEdited();
    };
    const addPool = () => {
        setDraft((current) => (current && current.length < MAX_POOLS ? [...current, ''] : current));
        markEdited();
    };
    const removePool = (index) => {
        setDraft((current) => (current ? current.filter((_, i) => i !== index) : current));
        markEdited();
    };
    const editUserMap = (openId, name) => {
        setDraftUserMap((current) => {
            const next = { ...(current || {}) };
            if (name.trim()) {
                next[openId] = name.trim();
            }
            else {
                delete next[openId];
            }
            return next;
        });
        markEdited();
    };
    const removeUserMap = (openId) => {
        setDraftUserMap((current) => {
            if (!current)
                return current;
            const next = { ...current };
            delete next[openId];
            return next;
        });
        markEdited();
    };
    const loadChatMembers = useCallback(async (chatId) => {
        if (!chatId.trim())
            return;
        setLoadingMembers(true);
        try {
            const result = await api.listChatMembers(chatId);
            setChatMembers(result.members);
        }
        catch {
            setChatMembers([]);
        }
        finally {
            setLoadingMembers(false);
        }
    }, [api]);
    const save = async () => {
        if (!draft || saving)
            return;
        // 前端预校验(与 Host 侧 sanitizePools 同一口径):trim 后非空、限长
        const trimmed = draft.map((item) => item.trim());
        const invalidIndex = trimmed.findIndex((item) => !item || item.length > MAX_POOL_LENGTH);
        if (invalidIndex !== -1) {
            setApplyState({ kind: 'error', message: t('field.pools.invalid', { index: invalidIndex + 1, len: MAX_POOL_LENGTH }) });
            return;
        }
        if (trimmed.length === 0) {
            setApplyState({ kind: 'error', message: t('field.pools.empty') });
            return;
        }
        setApplyState({ kind: 'saving' });
        try {
            const result = await api.save({ pools: trimmed, userMap: draftUserMap || {} });
            const pools = [...result.settings.pools];
            const userMap = { ...result.settings.userMap };
            setSaved(pools);
            setDraft(pools);
            setSavedUserMap(userMap);
            setDraftUserMap(userMap);
            setApplyState({ kind: 'saved' });
        }
        catch (error) {
            setApplyState({ kind: 'error', message: messageOf(error) });
        }
    };
    const discard = () => {
        setDraft(saved ? [...saved] : null);
        setDraftUserMap(savedUserMap ? { ...savedUserMap } : null);
        setApplyState({ kind: 'idle' });
    };
    return { phase, saved, draft, savedUserMap, draftUserMap, dirty, applyState, chatMembers, loadingMembers, load, editPool, addPool, removePool, editUserMap, removeUserMap, loadChatMembers, save, discard };
}
// ========== 表单组件 ==========
/** 展开区表单:池号列表编辑 + 用户映射配置 + 底部操作区 */
function PoolsForm({ model, t }) {
    const draft = model.draft ?? [];
    const draftUserMap = model.draftUserMap ?? {};
    const busy = model.applyState.kind === 'saving';
    const [chatId, setChatId] = useState('');
    if (model.phase === 'unavailable') {
        return (_jsxs("div", { style: formStyle, children: [_jsx("p", { style: errorStyle, children: t('card.unavailable') }), _jsx("div", { style: footerStyle, children: _jsx("button", { type: "button", style: ghostBtnStyle, onClick: () => void model.load(), children: t('card.retry') }) })] }));
    }
    return (_jsxs("div", { style: formStyle, children: [_jsxs("div", { children: [_jsx("p", { style: labelStyle, children: t('field.pools.label') }), _jsx("p", { style: hintStyle, children: t('field.pools.hint', { max: MAX_POOLS, len: MAX_POOL_LENGTH }) })] }), draft.map((value, index) => (_jsxs("div", { style: { ...rowStyle, marginTop: 8 }, children: [_jsx("input", { style: inputStyle, value: value, maxLength: MAX_POOL_LENGTH, placeholder: t('field.pools.placeholder'), "aria-label": `${t('field.pools.label')} ${index + 1}`, onChange: (e) => model.editPool(index, e.target.value) }), _jsx("button", { type: "button", style: removeBtnStyle, "aria-label": t('field.pools.remove'), title: t('field.pools.remove'), disabled: draft.length <= 1, onClick: () => model.removePool(index), children: "\u2715" })] }, index))), _jsx("div", { style: { marginTop: 8 }, children: _jsxs("button", { type: "button", style: addBtnStyle, disabled: draft.length >= MAX_POOLS, onClick: model.addPool, children: ["\uFF0B ", t('field.pools.add')] }) }), _jsx("div", { style: dividerStyle }), _jsxs("div", { children: [_jsx("p", { style: labelStyle, children: t('field.userMap.label') }), _jsx("p", { style: hintStyle, children: t('field.userMap.hint') })] }), _jsxs("div", { style: { ...userMapHeaderStyle, marginTop: 8 }, children: [_jsx("input", { style: chatIdInputStyle, value: chatId, placeholder: t('field.userMap.chatIdPlaceholder'), onChange: (e) => setChatId(e.target.value) }), _jsx("button", { type: "button", style: loadBtnStyle, disabled: model.loadingMembers || !chatId.trim(), onClick: () => void model.loadChatMembers(chatId), children: model.loadingMembers ? t('field.userMap.loading') : t('field.userMap.loadMembers') })] }), Object.keys(draftUserMap).length > 0 ? (_jsx("div", { style: { marginTop: 12 }, children: Object.entries(draftUserMap).map(([openId, name]) => (_jsxs("div", { style: userMapRowStyle, children: [_jsx("input", { style: openIdInputStyle, value: openId, readOnly: true, "aria-label": "open_id" }), _jsx("input", { style: nameInputStyle, value: name, maxLength: MAX_USER_NAME_LENGTH, placeholder: t('field.userMap.namePlaceholder'), "aria-label": t('field.userMap.nameLabel'), onChange: (e) => model.editUserMap(openId, e.target.value) }), _jsx("button", { type: "button", style: removeBtnStyle, "aria-label": t('field.userMap.remove'), title: t('field.userMap.remove'), onClick: () => model.removeUserMap(openId), children: "\u2715" })] }, openId))) })) : (_jsx("p", { style: { ...hintStyle, marginTop: 8 }, children: t('field.userMap.empty') })), model.chatMembers.length > 0 && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("p", { style: hintStyle, children: t('field.userMap.chatMembersHint', { count: model.chatMembers.length }) }), _jsx("div", { style: { maxHeight: 150, overflowY: 'auto', marginTop: 4 }, children: model.chatMembers
                            .filter((m) => !draftUserMap[m.open_id])
                            .map((member) => (_jsxs("div", { style: { ...userMapRowStyle, marginTop: 4 }, children: [_jsx("input", { style: openIdInputStyle, value: member.open_id, readOnly: true, "aria-label": "open_id" }), _jsx("input", { style: nameInputStyle, value: member.name, readOnly: true, "aria-label": t('field.userMap.nameLabel') }), _jsx("button", { type: "button", style: addBtnStyle, onClick: () => model.editUserMap(member.open_id, member.name), children: "\uFF0B" })] }, member.open_id))) })] })), _jsxs("div", { style: footerStyle, children: [model.applyState.kind === 'error' ? (_jsx("p", { style: errorStyle, role: "status", children: model.applyState.message })) : null, model.applyState.kind === 'saved' ? (_jsx("p", { style: savedStyle, role: "status", children: t('card.saved') })) : null, _jsx("button", { type: "button", style: ghostBtnStyle, disabled: !model.dirty || busy, onClick: model.discard, children: t('card.discard') }), _jsx("button", { type: "button", style: {
                            ...primaryBtnStyle,
                            opacity: !model.dirty || busy ? DISABLED_OPACITY : 1,
                            cursor: !model.dirty || busy ? 'default' : 'pointer'
                        }, disabled: !model.dirty || busy, onClick: () => void model.save(), children: busy ? t('card.saving') : t('card.save') })] })] }));
}
// ========== 卡片 ==========
/**
 * 渲染「AquaSense 设置」卡片。
 * @param props - locale 座位(t)+ 注入面(api)。
 * @returns `<li>` 卡片元素。
 */
export function AquaSettingsCard({ t, api }) {
    const [open, setOpen] = useState(false);
    const model = useAquaSettings(api, t);
    /** 接口不可用时强制展开(展示重试入口) */
    const expanded = open || model.phase === 'unavailable';
    return (_jsxs("li", { style: expanded ? { ...cardStyle, ...cardOpenStyle } : cardStyle, children: [_jsxs("div", { style: headerStyle, children: [_jsxs("button", { type: "button", style: expandStyle, "aria-expanded": expanded, onClick: () => {
                            setOpen((value) => !value);
                        }, children: [_jsxs("span", { style: headTextStyle, children: [_jsx("span", { style: nameStyle, children: t('card.title') }), _jsx("span", { style: descStyle, children: t('card.intro') })] }), model.dirty ? _jsx("span", { style: unsavedStyle, children: t('card.unsaved') }) : null] }), _jsx("button", { type: "button", style: toggleStyle, "aria-label": expanded ? t('card.collapse') : t('card.expand'), onClick: () => {
                            setOpen((value) => !value);
                        }, children: _jsx("span", { style: chevronStyle(expanded), children: CHEVRON_SVG }) })] }), _jsx("div", { style: expanded ? bodyStyle : HIDDEN_STYLE, children: _jsx(PoolsForm, { model: model, t: t }) })] }));
}
