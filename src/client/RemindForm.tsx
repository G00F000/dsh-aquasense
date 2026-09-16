/**
 * RemindForm —— S9 每日任务提醒的共享配置表单(需求 R6.5 原型 3)
 *
 * 两处复用同一份实现:
 *  - RemindCard:设置 → 插件 → 插件配置 内的卡片;
 *  - AquaConfigPage:侧栏「🐟 AquaSense 配置」一级入口打开的独立配置页。
 *
 * 配置状态与动作由 useRemindConfig 提供(拉取/草稿/dirty/保存/发送测试/放弃修改),
 * 本组件只负责渲染;样式对齐 SkillHub 设置卡(.sh-cfg 体系):字段分隔线、
 * 底部「发送测试 / 放弃修改 / 保存配置」操作区。
 */

import { useCallback, useEffect, useId, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FeishuGroup, RemindApi, RemindConfigInput, RemindStatus, RemindTask } from './api.js'

/** 词典翻译函数(命名空间 aquasense-remind) */
export type RemindTranslate = PropsLocale<'aquasense-remind'>['t']

/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
export const MAX_TASKS = 50

/** 操作/提交状态 */
type ApplyState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'testing' }
  | { kind: 'testSent' }
  | { kind: 'error'; message: string }

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column'
}

/** 字段容器:字段间补分隔线(对齐 .sh-cfg-f),首字段无分隔线 */
const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 0',
  borderTop: '1px solid var(--dsw-alias-border-l2, #eee)'
}

const fieldFirstStyle: CSSProperties = {
  ...fieldStyle,
  borderTop: 'none'
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary, inherit)'
}

const switchRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--dsw-alias-label-primary, inherit)'
}

const inputStyle: CSSProperties = {
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
}

const taskRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8
}

const timeInputStyle: CSSProperties = {
  ...inputStyle,
  width: 104,
  flex: 'none'
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-caption, #6b7280)',
  margin: 0,
  lineHeight: 1.5
}

const footerStyle: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 8,
  padding: '12px 0 4px',
  display: 'flex'
}

/** 按钮基础(对齐 .sh-cfg-ft button) */
const btnBase: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  cursor: 'pointer',
  borderRadius: 8,
  padding: '5px 14px',
  fontSize: 13,
  lineHeight: '20px',
  transition: 'background .16s, opacity .16s'
}

/** 次级按钮:透明底 + 描边(对齐 .sh-cfg-disc) */
const ghostBtnStyle: CSSProperties = {
  ...btnBase,
  background: 'transparent',
  border: '1px solid var(--dsw-alias-border-l2, #d1d5db)',
  color: 'var(--dsw-alias-label-secondary, #4b5563)'
}

/** 主按钮(对齐 .sh-cfg-save) */
const primaryBtnStyle: CSSProperties = {
  ...btnBase,
  background: 'var(--dsw-alias-button-primary-fill, #111827)',
  border: '1px solid var(--dsw-alias-button-primary-fill, #111827)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)'
}

/** 禁用态透明度(对齐 .sh-cfg-ft button:disabled) */
const DISABLED_OPACITY = 0.4

const noticeStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-caption, #6b7280)',
  margin: '0 0 8px',
  fontSize: 12,
  lineHeight: 1.5
}

const savedStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-success-primary, #047857)',
  margin: '0 0 8px',
  fontSize: 12,
  lineHeight: 1.5
}

/** 错误文本(对齐 .sh-cfg-err,位于操作行左侧) */
const errorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary, #b91c1c)',
  flex: 1,
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  minWidth: 0
}

/** 取配置快照为可编辑草稿(深拷贝任务数组) */
function toDraft(config: { enabled: boolean; group: string; tasks: RemindTask[] }): RemindConfigInput {
  return {
    enabled: config.enabled,
    group: config.group,
    tasks: config.tasks.map((task) => ({ ...task }))
  }
}

/** 查找首条非法任务下标(时间非 HH:MM 或内容为空) */
function findInvalidTask(tasks: RemindTask[]): number | null {
  for (let index = 0; index < tasks.length; index++) {
    const { time, task } = tasks[index]
    if (!/^\d{2}:\d{2}$/.test(time) || !task.trim()) return index
  }
  return null
}

/** 错误信息提取 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 配置模型:useRemindConfig 的返回值,表单与卡片头部共用 */
export interface RemindModel {
  /** 拉取阶段(卡片在 unavailable 时强制展开) */
  readonly phase: 'loading' | 'ready' | 'unavailable'
  /** 编辑草稿(未就绪时为 null) */
  readonly draft: RemindConfigInput | null
  /** 当日调度状态摘要(接口失败为 null) */
  readonly status: RemindStatus | null
  /** 飞书群候选列表(空 = 允许手填 chat_id) */
  readonly groups: FeishuGroup[]
  /** 群列表获取失败信息 */
  readonly groupsError: string | null
  /** 保存/测试的提交状态 */
  readonly applyState: ApplyState
  /** 草稿与已保存快照是否有差异 */
  readonly dirty: boolean
  /** 保存中 */
  readonly saving: boolean
  /** 测试提醒发送中 */
  readonly testing: boolean
  /** 任一提交进行中(表单禁用) */
  readonly busy: boolean
  /** 重新拉取配置与群列表 */
  reload: () => Promise<void>
  /** 编辑顶层字段 */
  edit: (patch: Partial<RemindConfigInput>) => void
  /** 编辑第 index 条任务 */
  updateTask: (index: number, patch: Partial<RemindTask>) => void
  /** 追加一条任务 */
  addTask: () => void
  /** 删除第 index 条任务 */
  removeTask: (index: number) => void
  /** 保存配置(持久化并重建当日推送计划) */
  save: () => Promise<void>
  /** 放弃修改:草稿回滚为已保存快照 */
  discard: () => void
  /** 发送测试提醒(基于已保存配置) */
  sendTest: () => Promise<void>
}

/**
 * 配置状态与动作(卡片与配置页共用的数据层)。
 * @param api - 浏览器半侧 API(经槽位注入面传入)。
 * @param t - 词典翻译函数。
 * @returns 表单渲染与卡片头部所需的全部状态与动作。
 */
export function useRemindConfig(api: RemindApi, t: RemindTranslate): RemindModel {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [saved, setSaved] = useState<RemindConfigInput | null>(null)
  const [draft, setDraft] = useState<RemindConfigInput | null>(null)
  const [status, setStatus] = useState<RemindStatus | null>(null)
  const [groups, setGroups] = useState<FeishuGroup[]>([])
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' })

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading')
    setGroups([])
    setGroupsError(null)
    const [configResult, groupsResult] = await Promise.allSettled([api.get(), api.groups()])

    if (configResult.status === 'fulfilled') {
      const snapshot = toDraft(configResult.value.config)
      setSaved(snapshot)
      setDraft(toDraft(snapshot))
      setStatus(configResult.value.status)
      setApplyState({ kind: 'idle' })
      setPhase('ready')
    } else {
      setPhase('unavailable')
    }

    if (groupsResult.status === 'fulfilled') {
      setGroups(groupsResult.value.groups)
      setGroupsError(groupsResult.value.error ?? null)
    } else {
      setGroupsError(messageOf(groupsResult.reason))
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  const saving = applyState.kind === 'saving'
  const testing = applyState.kind === 'testing'
  const busy = saving || testing

  /** 编辑后回到 idle(清除「已保存/已发送」提示,由 dirty 徽标接管) */
  const markEdited = (): void => {
    setApplyState((state) => (state.kind === 'idle' ? state : { kind: 'idle' }))
  }

  const edit = (patch: Partial<RemindConfigInput>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    markEdited()
  }

  const updateTask = (index: number, patch: Partial<RemindTask>): void => {
    setDraft((current) =>
      current
        ? { ...current, tasks: current.tasks.map((task, i) => (i === index ? { ...task, ...patch } : task)) }
        : current
    )
    markEdited()
  }

  const addTask = (): void => {
    setDraft((current) => (current ? { ...current, tasks: [...current.tasks, { time: '08:00', task: '' }] } : current))
    markEdited()
  }

  const removeTask = (index: number): void => {
    setDraft((current) => (current ? { ...current, tasks: current.tasks.filter((_, i) => i !== index) } : current))
    markEdited()
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    const invalid = findInvalidTask(draft.tasks)
    if (invalid !== null) {
      setApplyState({ kind: 'error', message: t('field.tasks.invalid', { index: invalid + 1 }) })
      return
    }
    setApplyState({ kind: 'saving' })
    try {
      const result = await api.save(draft)
      const snapshot = toDraft(result.config)
      setSaved(snapshot)
      setDraft(toDraft(snapshot))
      setStatus(result.status)
      setApplyState({ kind: 'saved' })
    } catch (error) {
      setApplyState({ kind: 'error', message: messageOf(error) })
    }
  }

  /** 放弃修改:草稿回滚为已保存快照(对齐 SkillHub「放弃修改」) */
  const discard = (): void => {
    if (!saved) return
    setDraft(toDraft(saved))
    setApplyState({ kind: 'idle' })
  }

  const sendTest = async (): Promise<void> => {
    setApplyState({ kind: 'testing' })
    try {
      await api.test()
      setApplyState({ kind: 'testSent' })
    } catch (error) {
      setApplyState({ kind: 'error', message: messageOf(error) })
    }
  }

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
  }
}

/**
 * 渲染配置表单(加载/不可用/就绪三分支)。
 * @param props - model:useRemindConfig 的返回值;t:词典翻译函数。
 * @returns 表单元素(不含卡片/页面外壳)。
 */
export function RemindForm({ model, t }: { model: RemindModel; t: RemindTranslate }): ReactNode {
  const { phase, draft, status, groups, groupsError, applyState, dirty, saving, testing, busy } = model

  /** 群输入框 id 每实例唯一(设置卡与配置页可能同时挂载) */
  const groupInputId = useId()

  if (phase === 'unavailable') {
    return (
      <>
        <p style={noticeStyle} role="status">
          {t('card.unavailable')}
        </p>
        <div style={footerStyle}>
          <button
            type="button"
            style={ghostBtnStyle}
            onClick={() => {
              void model.reload()
            }}
          >
            {t('card.retry')}
          </button>
        </div>
      </>
    )
  }

  if (phase !== 'ready' || !draft) {
    return (
      <p style={noticeStyle} role="status">
        {t('card.loading')}
      </p>
    )
  }

  /** 当日调度状态摘要 */
  const summarize = (value: RemindStatus): string => {
    if (value.planned === 0) return t('status.summaryIdle')
    if (value.nextTime === null) return t('status.summaryDone', { planned: value.planned })
    return t('status.summary', { planned: value.planned, sent: value.sent, next: value.nextTime })
  }

  return (
    <>
      {applyState.kind === 'saved' ? (
        <p style={savedStyle} role="status">
          {t('card.saved')}
        </p>
      ) : null}
      {applyState.kind === 'testSent' ? (
        <p style={savedStyle} role="status">
          {t('card.testSent')}
        </p>
      ) : null}
      {dirty && !saving ? <p style={noticeStyle}>{t('card.unsavedHint')}</p> : null}

      <div style={formStyle}>
        <div style={fieldFirstStyle}>
          <label style={switchRowStyle}>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(event) => {
                model.edit({ enabled: event.target.checked })
              }}
            />
            <span>{t('field.enabled.label')}</span>
          </label>
          <p style={hintStyle}>{t('field.enabled.hint')}</p>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor={groupInputId}>
            {t('field.group.label')}
          </label>
          {groups.length > 0 ? (
            <select
              id={groupInputId}
              style={inputStyle}
              value={draft.group}
              disabled={busy}
              onChange={(event) => {
                model.edit({ group: event.target.value })
              }}
            >
              <option value="">{t('field.group.placeholder')}</option>
              {groups.map((group) => (
                <option key={group.chatId} value={group.chatId}>
                  {`${group.name} (${group.chatId})`}
                </option>
              ))}
              {draft.group && !groups.some((group) => group.chatId === draft.group) ? (
                <option value={draft.group}>{`${draft.group} ${t('field.group.current')}`}</option>
              ) : null}
            </select>
          ) : (
            <input
              id={groupInputId}
              type="text"
              style={inputStyle}
              value={draft.group}
              disabled={busy}
              placeholder="oc_xxxxxxxx"
              onChange={(event) => {
                model.edit({ group: event.target.value })
              }}
            />
          )}
          {groupsError ? <p style={hintStyle}>{t('field.group.listFailed', { message: groupsError })}</p> : null}
          {groups.length === 0 && !groupsError ? <p style={hintStyle}>{t('field.group.manualHint')}</p> : null}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>{t('field.tasks.label')}</label>
          {draft.tasks.length === 0 ? <p style={hintStyle}>{t('field.tasks.empty')}</p> : null}
          {draft.tasks.map((task, index) => (
            <div key={index} style={taskRowStyle}>
              <input
                type="time"
                style={timeInputStyle}
                value={task.time}
                disabled={busy}
                onChange={(event) => {
                  model.updateTask(index, { time: event.target.value })
                }}
              />
              <input
                type="text"
                style={{ ...inputStyle, flex: 1 }}
                value={task.task}
                disabled={busy}
                placeholder={t('field.tasks.contentPlaceholder')}
                onChange={(event) => {
                  model.updateTask(index, { task: event.target.value })
                }}
              />
              <button
                type="button"
                style={{ ...ghostBtnStyle, flex: 'none', opacity: busy ? DISABLED_OPACITY : 1 }}
                disabled={busy}
                onClick={() => {
                  model.removeTask(index)
                }}
              >
                {t('field.tasks.remove')}
              </button>
            </div>
          ))}
          <div style={{ display: 'flex' }}>
            <button
              type="button"
              style={{
                ...ghostBtnStyle,
                opacity: busy || draft.tasks.length >= MAX_TASKS ? DISABLED_OPACITY : 1
              }}
              disabled={busy || draft.tasks.length >= MAX_TASKS}
              onClick={model.addTask}
            >
              {t('field.tasks.add')}
            </button>
          </div>
          <p style={hintStyle}>{t('field.tasks.hint', { max: MAX_TASKS })}</p>
        </div>
      </div>

      {status ? <p style={{ ...hintStyle, marginTop: 12 }}>{summarize(status)}</p> : null}

      <div style={footerStyle}>
        {applyState.kind === 'error' ? (
          <p style={errorStyle} role="status">
            {applyState.message}
          </p>
        ) : null}
        <button
          type="button"
          style={{ ...ghostBtnStyle, opacity: dirty || busy ? DISABLED_OPACITY : 1 }}
          disabled={dirty || busy}
          onClick={() => {
            void model.sendTest()
          }}
        >
          {testing ? t('card.testing') : t('card.test')}
        </button>
        <button
          type="button"
          style={{ ...ghostBtnStyle, opacity: !dirty || busy ? DISABLED_OPACITY : 1 }}
          disabled={!dirty || busy}
          onClick={model.discard}
        >
          {t('card.discard')}
        </button>
        <button
          type="button"
          style={{ ...primaryBtnStyle, opacity: !dirty || busy ? DISABLED_OPACITY : 1 }}
          disabled={!dirty || busy}
          onClick={() => {
            void model.save()
          }}
        >
          {saving ? t('card.saving') : t('card.save')}
        </button>
      </div>
    </>
  )
}
