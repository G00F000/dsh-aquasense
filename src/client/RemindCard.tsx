/**
 * RemindCard —— settings.plugin.item 槽位卡片(设置 → 插件 → 插件配置)
 *
 * 交互(需求 R6.5 原型 3):启用开关 / 推送目标群下拉 / 任务列表增删 /
 * [保存配置](持久化并重建当日推送计划) [发送测试提醒](立即推一次总览卡片)。
 * 数据经 /aquasense-remind/api 与 Host 侧读写(见 src/web/remind-gateway.ts)。
 *
 * UI 对齐 SkillHub(插件广场)设置卡:展开区 + 独立收起按钮、未保存徽标、
 * 字段分隔线、底部「发送测试 / 放弃修改 / 保存配置」操作区。
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FeishuGroup, RemindApi, RemindConfigInput, RemindStatus, RemindTask } from './api.js'

/** 卡片注入面(注册时提供,见 index.ts) */
export interface RemindCardInjected {
  readonly api: RemindApi
}

/** 卡片 props:locale 座位 + 注入面 */
export type RemindCardProps = PropsLocale<'aquasense-remind'> & RemindCardInjected

/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
const MAX_TASKS = 50

/** 操作/提交状态 */
type ApplyState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'testing' }
  | { kind: 'testSent' }
  | { kind: 'error'; message: string }

/**
 * 卡片样式对齐 SkillHub 设置卡(.sh-cfg 体系):
 * 展开区 + 独立收起按钮、字段分隔线、底部操作区。
 */
const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
  background: 'var(--dsw-alias-bg-layer-3, #fff)',
  borderRadius: 12,
  boxSizing: 'border-box',
  listStyle: 'none',
  transition: 'border-color .16s, background .16s'
}

/** 展开态卡底色(对齐 .sh-cfg.open) */
const cardOpenStyle: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-2, #fafafa)'
}

const headerStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  display: 'flex'
}

/** 展开区按钮:标题 + 描述 + 未保存徽标(对齐 .sh-cfg-expand) */
const expandStyle: CSSProperties = {
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
}

/** 收起/展开按钮:28×28 独立热区(对齐 .sh-cfg-toggle) */
const toggleStyle: CSSProperties = {
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
}

const headTextStyle: CSSProperties = {
  flexDirection: 'column',
  flex: 1,
  gap: 4,
  minWidth: 0,
  display: 'flex'
}

const nameStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-primary, inherit)',
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.4
}

const descStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary, #6b7280)',
  fontSize: 13,
  lineHeight: 1.5
}

/** 未保存徽标(对齐 .sh-tag.orange) */
const unsavedStyle: CSSProperties = {
  flex: 'none',
  whiteSpace: 'nowrap',
  background: 'var(--dsw-alias-state-warn-tertiary, #fff7ed)',
  color: 'var(--dsw-alias-state-warn-label, #c2410c)',
  borderRadius: 6,
  padding: '2px 6px',
  fontSize: 11,
  lineHeight: '16px'
}

/** 收起箭头:展开态旋转 180°(对齐 .sh-cfg-ch) */
const chevronStyle = (open: boolean): CSSProperties => ({
  color: 'var(--dsw-alias-label-tertiary, #6b7280)',
  flex: 'none',
  width: 14,
  height: 14,
  transition: 'transform .16s',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transform: open ? 'rotate(180deg)' : 'none'
})

/** 卡体(对齐 .sh-cfg-b) */
const bodyStyle: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
  margin: '0 16px',
  padding: '8px 0 12px'
}

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

const CHEVRON_SVG = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
)

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

/**
 * 渲染 S9 提醒设置卡片。
 * @param props - locale 座位(t)+ 注入面(api)。
 * @returns `<li>` 卡片元素。
 */
export function RemindCard({ t, api }: RemindCardProps) {
  const [open, setOpen] = useState(false)
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

  /** 当日调度状态摘要 */
  const summarize = (value: RemindStatus): string => {
    if (value.planned === 0) return t('status.summaryIdle')
    if (value.nextTime === null) return t('status.summaryDone', { planned: value.planned })
    return t('status.summary', { planned: value.planned, sent: value.sent, next: value.nextTime })
  }

  const expanded = open || phase === 'unavailable'

  const header = (
    <div style={headerStyle}>
      <button
        type="button"
        style={expandStyle}
        aria-expanded={expanded}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        <span style={headTextStyle}>
          <span style={nameStyle}>{t('card.title')}</span>
          <span style={descStyle}>{t('card.intro')}</span>
        </span>
        {dirty ? <span style={unsavedStyle}>{t('card.unsaved')}</span> : null}
      </button>
      <button
        type="button"
        style={toggleStyle}
        aria-label={expanded ? t('card.collapse') : t('card.expand')}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        <span style={chevronStyle(expanded)}>{CHEVRON_SVG}</span>
      </button>
    </div>
  )

  let body: React.ReactNode = null
  if (expanded) {
    if (phase === 'unavailable') {
      body = (
        <div style={bodyStyle}>
          <p style={noticeStyle} role="status">
            {t('card.unavailable')}
          </p>
          <div style={footerStyle}>
            <button
              type="button"
              style={ghostBtnStyle}
              onClick={() => {
                void load()
              }}
            >
              {t('card.retry')}
            </button>
          </div>
        </div>
      )
    } else if (phase === 'ready' && draft) {
      body = (
        <div style={bodyStyle}>
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
                    edit({ enabled: event.target.checked })
                  }}
                />
                <span>{t('field.enabled.label')}</span>
              </label>
              <p style={hintStyle}>{t('field.enabled.hint')}</p>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="aqs-remind-group">
                {t('field.group.label')}
              </label>
              {groups.length > 0 ? (
                <select
                  id="aqs-remind-group"
                  style={inputStyle}
                  value={draft.group}
                  disabled={busy}
                  onChange={(event) => {
                    edit({ group: event.target.value })
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
                  id="aqs-remind-group"
                  type="text"
                  style={inputStyle}
                  value={draft.group}
                  disabled={busy}
                  placeholder="oc_xxxxxxxx"
                  onChange={(event) => {
                    edit({ group: event.target.value })
                  }}
                />
              )}
              {groupsError ? (
                <p style={hintStyle}>{t('field.group.listFailed', { message: groupsError })}</p>
              ) : null}
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
                      updateTask(index, { time: event.target.value })
                    }}
                  />
                  <input
                    type="text"
                    style={{ ...inputStyle, flex: 1 }}
                    value={task.task}
                    disabled={busy}
                    placeholder={t('field.tasks.contentPlaceholder')}
                    onChange={(event) => {
                      updateTask(index, { task: event.target.value })
                    }}
                  />
                  <button
                    type="button"
                    style={{ ...ghostBtnStyle, flex: 'none', opacity: busy ? DISABLED_OPACITY : 1 }}
                    disabled={busy}
                    onClick={() => {
                      removeTask(index)
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
                  onClick={addTask}
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
                void sendTest()
              }}
            >
              {testing ? t('card.testing') : t('card.test')}
            </button>
            <button
              type="button"
              style={{ ...ghostBtnStyle, opacity: !dirty || busy ? DISABLED_OPACITY : 1 }}
              disabled={!dirty || busy}
              onClick={discard}
            >
              {t('card.discard')}
            </button>
            <button
              type="button"
              style={{ ...primaryBtnStyle, opacity: !dirty || busy ? DISABLED_OPACITY : 1 }}
              disabled={!dirty || busy}
              onClick={() => {
                void save()
              }}
            >
              {saving ? t('card.saving') : t('card.save')}
            </button>
          </div>
        </div>
      )
    } else {
      body = (
        <div style={bodyStyle}>
          <p style={noticeStyle} role="status">
            {t('card.loading')}
          </p>
        </div>
      )
    }
  }

  return (
    <li style={expanded ? { ...cardStyle, ...cardOpenStyle } : cardStyle}>
      {header}
      {expanded ? body : null}
    </li>
  )
}
