import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * RemindForm —— S9 每日任务提醒的配置表单(需求 R6.5 原型 3)
 *
 * 由侧栏「🐟 AquaSense 配置」一级入口打开的独立配置页(AquaConfigPage)使用
 * (v1.8 起设置页卡片已移除,本组件为唯一表单实现)。
 *
 * 配置状态与动作由 useRemindConfig 提供(拉取/草稿/dirty/保存/发送测试/放弃修改),
 * 本组件只负责渲染;样式对齐 SkillHub 设置卡(.sh-cfg 体系):字段分隔线、
 * 底部「发送测试 / 放弃修改 / 保存配置」操作区。
 */
import { useCallback, useEffect, useId, useState } from 'react';
/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
export const MAX_TASKS = 50;
const formStyle = {
    display: 'flex',
    flexDirection: 'column'
};
/** 字段容器:字段间补分隔线(对齐 .sh-cfg-f),首字段无分隔线 */
const fieldStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 0',
    borderTop: '1px solid var(--dsw-alias-border-l2, #eee)'
};
const fieldFirstStyle = {
    ...fieldStyle,
    borderTop: 'none'
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
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    margin: 0,
    lineHeight: 1.5
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
const noticeStyle = {
    color: 'var(--dsw-alias-label-caption, #6b7280)',
    margin: '0 0 8px',
    fontSize: 12,
    lineHeight: 1.5
};
const savedStyle = {
    color: 'var(--dsw-alias-state-success-primary, #047857)',
    margin: '0 0 8px',
    fontSize: 12,
    lineHeight: 1.5
};
/** 错误文本(对齐 .sh-cfg-err,位于操作行左侧) */
const errorStyle = {
    color: 'var(--dsw-alias-state-error-primary, #b91c1c)',
    flex: 1,
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    minWidth: 0
};
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
 * 配置状态与动作(配置页数据层)。
 * @param api - 浏览器半侧 API(经槽位注入面传入)。
 * @param t - 词典翻译函数。
 * @returns 表单渲染所需的全部状态与动作。
 */
export function useRemindConfig(api, t) {
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
    /** 放弃修改:草稿回滚为已保存快照(对齐 SkillHub「放弃修改」) */
    const discard = () => {
        if (!saved)
            return;
        setDraft(toDraft(saved));
        setApplyState({ kind: 'idle' });
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
    return {
        phase,
        draft,
        status,
        groups,
        groupsError,
        applyState,
        dirty,
        saving,
        testing,
        busy,
        reload: load,
        edit,
        updateTask,
        addTask,
        removeTask,
        save,
        discard,
        sendTest
    };
}
/**
 * 渲染配置表单(加载/不可用/就绪三分支)。
 * @param props - model:useRemindConfig 的返回值;t:词典翻译函数。
 * @returns 表单元素(不含卡片/页面外壳)。
 */
export function RemindForm({ model, t }) {
    const { phase, draft, status, groups, groupsError, applyState, dirty, saving, testing, busy } = model;
    /** 群输入框 id 每实例唯一 */
    const groupInputId = useId();
    if (phase === 'unavailable') {
        return (_jsxs(_Fragment, { children: [_jsx("p", { style: noticeStyle, role: "status", children: t('card.unavailable') }), _jsx("div", { style: footerStyle, children: _jsx("button", { type: "button", style: ghostBtnStyle, onClick: () => {
                            void model.reload();
                        }, children: t('card.retry') }) })] }));
    }
    if (phase !== 'ready' || !draft) {
        return (_jsx("p", { style: noticeStyle, role: "status", children: t('card.loading') }));
    }
    /** 当日调度状态摘要 */
    const summarize = (value) => {
        if (value.planned === 0)
            return t('status.summaryIdle');
        if (value.nextTime === null)
            return t('status.summaryDone', { planned: value.planned });
        return t('status.summary', { planned: value.planned, sent: value.sent, next: value.nextTime });
    };
    return (_jsxs(_Fragment, { children: [applyState.kind === 'saved' ? (_jsx("p", { style: savedStyle, role: "status", children: t('card.saved') })) : null, applyState.kind === 'testSent' ? (_jsx("p", { style: savedStyle, role: "status", children: t('card.testSent') })) : null, dirty && !saving ? _jsx("p", { style: noticeStyle, children: t('card.unsavedHint') }) : null, _jsxs("div", { style: formStyle, children: [_jsxs("div", { style: fieldFirstStyle, children: [_jsxs("label", { style: switchRowStyle, children: [_jsx("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: (event) => {
                                            model.edit({ enabled: event.target.checked });
                                        } }), _jsx("span", { children: t('field.enabled.label') })] }), _jsx("p", { style: hintStyle, children: t('field.enabled.hint') })] }), _jsxs("div", { style: fieldStyle, children: [_jsx("label", { style: labelStyle, htmlFor: groupInputId, children: t('field.group.label') }), groups.length > 0 ? (_jsxs("select", { id: groupInputId, style: inputStyle, value: draft.group, disabled: busy, onChange: (event) => {
                                    model.edit({ group: event.target.value });
                                }, children: [_jsx("option", { value: "", children: t('field.group.placeholder') }), groups.map((group) => (_jsx("option", { value: group.chatId, children: `${group.name} (${group.chatId})` }, group.chatId))), draft.group && !groups.some((group) => group.chatId === draft.group) ? (_jsx("option", { value: draft.group, children: `${draft.group} ${t('field.group.current')}` })) : null] })) : (_jsx("input", { id: groupInputId, type: "text", style: inputStyle, value: draft.group, disabled: busy, placeholder: "oc_xxxxxxxx", onChange: (event) => {
                                    model.edit({ group: event.target.value });
                                } })), groupsError ? _jsx("p", { style: hintStyle, children: t('field.group.listFailed', { message: groupsError }) }) : null, groups.length === 0 && !groupsError ? _jsx("p", { style: hintStyle, children: t('field.group.manualHint') }) : null] }), _jsxs("div", { style: fieldStyle, children: [_jsx("label", { style: labelStyle, children: t('field.tasks.label') }), draft.tasks.length === 0 ? _jsx("p", { style: hintStyle, children: t('field.tasks.empty') }) : null, draft.tasks.map((task, index) => (_jsxs("div", { style: taskRowStyle, children: [_jsx("input", { type: "time", style: timeInputStyle, value: task.time, disabled: busy, onChange: (event) => {
                                            model.updateTask(index, { time: event.target.value });
                                        } }), _jsx("input", { type: "text", style: { ...inputStyle, flex: 1 }, value: task.task, disabled: busy, placeholder: t('field.tasks.contentPlaceholder'), onChange: (event) => {
                                            model.updateTask(index, { task: event.target.value });
                                        } }), _jsx("button", { type: "button", style: { ...ghostBtnStyle, flex: 'none', opacity: busy ? DISABLED_OPACITY : 1 }, disabled: busy, onClick: () => {
                                            model.removeTask(index);
                                        }, children: t('field.tasks.remove') })] }, index))), _jsx("div", { style: { display: 'flex' }, children: _jsx("button", { type: "button", style: {
                                        ...ghostBtnStyle,
                                        opacity: busy || draft.tasks.length >= MAX_TASKS ? DISABLED_OPACITY : 1
                                    }, disabled: busy || draft.tasks.length >= MAX_TASKS, onClick: model.addTask, children: t('field.tasks.add') }) }), _jsx("p", { style: hintStyle, children: t('field.tasks.hint', { max: MAX_TASKS }) })] })] }), status ? _jsx("p", { style: { ...hintStyle, marginTop: 12 }, children: summarize(status) }) : null, _jsxs("div", { style: footerStyle, children: [applyState.kind === 'error' ? (_jsx("p", { style: errorStyle, role: "status", children: applyState.message })) : null, _jsx("button", { type: "button", style: { ...ghostBtnStyle, opacity: dirty || busy ? DISABLED_OPACITY : 1 }, disabled: dirty || busy, onClick: () => {
                            void model.sendTest();
                        }, children: testing ? t('card.testing') : t('card.test') }), _jsx("button", { type: "button", style: { ...ghostBtnStyle, opacity: !dirty || busy ? DISABLED_OPACITY : 1 }, disabled: !dirty || busy, onClick: model.discard, children: t('card.discard') }), _jsx("button", { type: "button", style: { ...primaryBtnStyle, opacity: !dirty || busy ? DISABLED_OPACITY : 1 }, disabled: !dirty || busy, onClick: () => {
                            void model.save();
                        }, children: saving ? t('card.saving') : t('card.save') })] })] }));
}
