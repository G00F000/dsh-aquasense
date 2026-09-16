import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * RemindCard —— settings.plugin.item 槽位卡片(设置 → 插件 → 插件配置)
 *
 * 交互(需求 R6.5 原型 3):启用开关 / 推送目标群下拉 / 任务列表增删 /
 * [保存配置](持久化并重建当日推送计划) [发送测试提醒](立即推一次总览卡片)。
 * 数据经 /aquasense-remind/api 与 Host 侧读写(见 src/web/remind-gateway.ts)。
 */
import { useCallback, useEffect, useState } from 'react';
/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
const MAX_TASKS = 50;
const cardStyle = {
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22))',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    borderRadius: 12,
    listStyle: 'none',
    transition: 'border-color .16s, background .16s'
};
const headerStyle = {
    appearance: 'none',
    width: '100%',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    background: 'transparent',
    border: 0,
    borderRadius: 12,
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    display: 'flex'
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
    color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.7))',
    fontSize: 13,
    lineHeight: 1.5
};
const pendingStyle = {
    whiteSpace: 'nowrap',
    background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.12))',
    color: 'var(--dsw-alias-label-secondary, inherit)',
    borderRadius: 999,
    flex: 'none',
    padding: '1px 8px',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: '17px'
};
const chevronStyle = (open) => ({
    color: 'var(--dsw-alias-label-tertiary, inherit)',
    flex: 'none',
    transition: 'transform .16s',
    display: 'inline-flex',
    alignItems: 'center',
    transform: open ? 'rotate(180deg)' : 'none'
});
const bodyStyle = {
    borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22))',
    margin: '0 16px',
    padding: '12px 0 4px'
};
const formStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 14
};
const fieldStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
};
const labelStyle = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--dsw-alias-label-primary, inherit)'
};
const switchRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--dsw-alias-label-primary, inherit)'
};
const inputStyle = {
    width: '100%',
    padding: '6px 10px',
    fontSize: 13,
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
};
const taskRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8
};
const timeInputStyle = {
    ...inputStyle,
    width: 104,
    flex: 'none'
};
const hintStyle = {
    fontSize: 12,
    color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.6))',
    margin: 0,
    lineHeight: 1.5
};
const footerStyle = {
    borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22))',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    padding: '12px 0 4px',
    display: 'flex'
};
const btnBase = {
    appearance: 'none',
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '5px 14px',
    fontSize: 13,
    fontWeight: 500,
    lineHeight: '20px',
    color: 'var(--dsw-alias-label-primary, inherit)',
    background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.12))',
    transition: 'background .16s, opacity .16s'
};
const noticeStyle = {
    color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.7))',
    margin: '0 0 8px',
    fontSize: 12,
    lineHeight: 1.5
};
const savedStyle = {
    color: 'var(--dsw-alias-state-success-primary, #30d158)',
    margin: '0 0 8px',
    fontSize: 12,
    lineHeight: 1.5
};
const errorStyle = {
    color: 'var(--dsw-alias-label-error, #ff453a)',
    margin: '0 0 8px',
    fontSize: 12,
    lineHeight: 1.5,
    minWidth: 0
};
const CHEVRON_SVG = (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M6 9l6 6 6-6" }) }));
/** 取配置快照为可编辑草稿(深拷贝任务数组) */
function toDraft(config) {
    return {
        enabled: config.enabled,
        group: config.group,
        tasks: config.tasks.map((task) => ({ ...task }))
    };
}
/** 查找首条非法任务下标(时间非 HH:MM 或内容为空) */
function findInvalidTask(tasks) {
    for (let index = 0; index < tasks.length; index++) {
        const { time, task } = tasks[index];
        if (!/^\d{2}:\d{2}$/.test(time) || !task.trim())
            return index;
    }
    return null;
}
/** 错误信息提取 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * 渲染 S9 提醒设置卡片。
 * @param props - locale 座位(t)+ 注入面(api)。
 * @returns `<li>` 卡片元素。
 */
export function RemindCard({ t, api }) {
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState('loading');
    const [saved, setSaved] = useState(null);
    const [draft, setDraft] = useState(null);
    const [status, setStatus] = useState(null);
    const [groups, setGroups] = useState([]);
    const [groupsError, setGroupsError] = useState(null);
    const [applyState, setApplyState] = useState({ kind: 'idle' });
    const load = useCallback(async () => {
        setPhase('loading');
        setGroups([]);
        setGroupsError(null);
        const [configResult, groupsResult] = await Promise.allSettled([api.get(), api.groups()]);
        if (configResult.status === 'fulfilled') {
            const snapshot = toDraft(configResult.value.config);
            setSaved(snapshot);
            setDraft(toDraft(snapshot));
            setStatus(configResult.value.status);
            setApplyState({ kind: 'idle' });
            setPhase('ready');
        }
        else {
            setPhase('unavailable');
        }
        if (groupsResult.status === 'fulfilled') {
            setGroups(groupsResult.value.groups);
            setGroupsError(groupsResult.value.error ?? null);
        }
        else {
            setGroupsError(messageOf(groupsResult.reason));
        }
    }, [api]);
    useEffect(() => {
        void load();
    }, [load]);
    const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
    const saving = applyState.kind === 'saving';
    const testing = applyState.kind === 'testing';
    const busy = saving || testing;
    /** 编辑后回到 idle(清除「已保存/已发送」提示,由 dirty 徽标接管) */
    const markEdited = () => {
        setApplyState((state) => (state.kind === 'idle' ? state : { kind: 'idle' }));
    };
    const edit = (patch) => {
        setDraft((current) => (current ? { ...current, ...patch } : current));
        markEdited();
    };
    const updateTask = (index, patch) => {
        setDraft((current) => current
            ? { ...current, tasks: current.tasks.map((task, i) => (i === index ? { ...task, ...patch } : task)) }
            : current);
        markEdited();
    };
    const addTask = () => {
        setDraft((current) => (current ? { ...current, tasks: [...current.tasks, { time: '08:00', task: '' }] } : current));
        markEdited();
    };
    const removeTask = (index) => {
        setDraft((current) => (current ? { ...current, tasks: current.tasks.filter((_, i) => i !== index) } : current));
        markEdited();
    };
    const save = async () => {
        if (!draft)
            return;
        const invalid = findInvalidTask(draft.tasks);
        if (invalid !== null) {
            setApplyState({ kind: 'error', message: t('field.tasks.invalid', { index: invalid + 1 }) });
            return;
        }
        setApplyState({ kind: 'saving' });
        try {
            const result = await api.save(draft);
            const snapshot = toDraft(result.config);
            setSaved(snapshot);
            setDraft(toDraft(snapshot));
            setStatus(result.status);
            setApplyState({ kind: 'saved' });
        }
        catch (error) {
            setApplyState({ kind: 'error', message: messageOf(error) });
        }
    };
    const sendTest = async () => {
        setApplyState({ kind: 'testing' });
        try {
            await api.test();
            setApplyState({ kind: 'testSent' });
        }
        catch (error) {
            setApplyState({ kind: 'error', message: messageOf(error) });
        }
    };
    /** 当日调度状态摘要 */
    const summarize = (value) => {
        if (value.planned === 0)
            return t('status.summaryIdle');
        if (value.nextTime === null)
            return t('status.summaryDone', { planned: value.planned });
        return t('status.summary', { planned: value.planned, sent: value.sent, next: value.nextTime });
    };
    const expanded = open || phase === 'unavailable';
    const header = (_jsxs("button", { type: "button", style: headerStyle, "aria-expanded": expanded, "aria-label": t('card.title'), onClick: () => {
            setOpen((value) => !value);
        }, children: [_jsxs("span", { style: headTextStyle, children: [_jsx("span", { style: nameStyle, children: t('card.title') }), _jsx("span", { style: descStyle, children: t('card.intro') })] }), dirty ? _jsx("span", { style: pendingStyle, children: t('card.unsaved') }) : null, _jsx("span", { style: chevronStyle(expanded), children: CHEVRON_SVG })] }));
    let body = null;
    if (expanded) {
        if (phase === 'unavailable') {
            body = (_jsxs("div", { style: bodyStyle, children: [_jsx("p", { style: noticeStyle, role: "status", children: t('card.unavailable') }), _jsx("div", { style: footerStyle, children: _jsx("button", { type: "button", style: btnBase, onClick: () => {
                                void load();
                            }, children: t('card.retry') }) })] }));
        }
        else if (phase === 'ready' && draft) {
            body = (_jsxs("div", { style: bodyStyle, children: [applyState.kind === 'saved' ? (_jsx("p", { style: savedStyle, role: "status", children: t('card.saved') })) : null, applyState.kind === 'testSent' ? (_jsx("p", { style: savedStyle, role: "status", children: t('card.testSent') })) : null, applyState.kind === 'error' ? (_jsx("p", { style: errorStyle, role: "status", children: applyState.message })) : null, dirty && !saving ? _jsx("p", { style: noticeStyle, children: t('card.unsavedHint') }) : null, _jsxs("div", { style: formStyle, children: [_jsxs("div", { style: fieldStyle, children: [_jsxs("label", { style: switchRowStyle, children: [_jsx("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: (event) => {
                                                    edit({ enabled: event.target.checked });
                                                } }), _jsx("span", { children: t('field.enabled.label') })] }), _jsx("p", { style: hintStyle, children: t('field.enabled.hint') })] }), _jsxs("div", { style: fieldStyle, children: [_jsx("label", { style: labelStyle, htmlFor: "aqs-remind-group", children: t('field.group.label') }), groups.length > 0 ? (_jsxs("select", { id: "aqs-remind-group", style: inputStyle, value: draft.group, disabled: busy, onChange: (event) => {
                                            edit({ group: event.target.value });
                                        }, children: [_jsx("option", { value: "", children: t('field.group.placeholder') }), groups.map((group) => (_jsx("option", { value: group.chatId, children: `${group.name} (${group.chatId})` }, group.chatId))), draft.group && !groups.some((group) => group.chatId === draft.group) ? (_jsx("option", { value: draft.group, children: `${draft.group} ${t('field.group.current')}` })) : null] })) : (_jsx("input", { id: "aqs-remind-group", type: "text", style: inputStyle, value: draft.group, disabled: busy, placeholder: "oc_xxxxxxxx", onChange: (event) => {
                                            edit({ group: event.target.value });
                                        } })), groupsError ? (_jsx("p", { style: hintStyle, children: t('field.group.listFailed', { message: groupsError }) })) : null, groups.length === 0 && !groupsError ? _jsx("p", { style: hintStyle, children: t('field.group.manualHint') }) : null] }), _jsxs("div", { style: fieldStyle, children: [_jsx("label", { style: labelStyle, children: t('field.tasks.label') }), draft.tasks.length === 0 ? _jsx("p", { style: hintStyle, children: t('field.tasks.empty') }) : null, draft.tasks.map((task, index) => (_jsxs("div", { style: taskRowStyle, children: [_jsx("input", { type: "time", style: timeInputStyle, value: task.time, disabled: busy, onChange: (event) => {
                                                    updateTask(index, { time: event.target.value });
                                                } }), _jsx("input", { type: "text", style: { ...inputStyle, flex: 1 }, value: task.task, disabled: busy, placeholder: t('field.tasks.contentPlaceholder'), onChange: (event) => {
                                                    updateTask(index, { task: event.target.value });
                                                } }), _jsx("button", { type: "button", style: { ...btnBase, flex: 'none' }, disabled: busy, onClick: () => {
                                                    removeTask(index);
                                                }, children: t('field.tasks.remove') })] }, index))), _jsx("div", { style: { display: 'flex' }, children: _jsx("button", { type: "button", style: btnBase, disabled: busy || draft.tasks.length >= MAX_TASKS, onClick: addTask, children: t('field.tasks.add') }) }), _jsx("p", { style: hintStyle, children: t('field.tasks.hint', { max: MAX_TASKS }) })] })] }), status ? _jsx("p", { style: { ...hintStyle, marginTop: 12 }, children: summarize(status) }) : null, _jsxs("div", { style: footerStyle, children: [_jsx("button", { type: "button", style: { ...btnBase, opacity: !dirty || busy ? 0.5 : 1 }, disabled: !dirty || busy, onClick: () => {
                                    void sendTest();
                                }, children: testing ? t('card.testing') : t('card.test') }), _jsx("button", { type: "button", style: {
                                    ...btnBase,
                                    background: 'var(--dsw-alias-brand-primary, #0a84ff)',
                                    color: 'var(--dsw-alias-bg-layer-1, #fff)',
                                    opacity: !dirty || saving ? 0.5 : 1
                                }, disabled: !dirty || saving, onClick: () => {
                                    void save();
                                }, children: saving ? t('card.saving') : t('card.save') })] })] }));
        }
        else {
            body = (_jsx("div", { style: bodyStyle, children: _jsx("p", { style: noticeStyle, role: "status", children: t('card.loading') }) }));
        }
    }
    return (_jsxs("li", { style: cardStyle, children: [header, expanded ? body : null] }));
}
