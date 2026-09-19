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

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AquaSettings, AquaSettingsApi } from './api.js'

/** 词典翻译函数(命名空间 aquasense-settings) */
export type AquaSettingsTranslate = PropsLocale<'aquasense-settings'>['t']

/** 卡片注入面(注册时提供,见 index.ts) */
export interface AquaSettingsCardInjected {
  readonly api: AquaSettingsApi
}

/** 卡片 props:locale 座位 + 注入面 */
export type AquaSettingsCardProps = PropsLocale<'aquasense-settings'> & AquaSettingsCardInjected

/** 池号数量/长度上限(与 Host 侧 aqua-settings.ts 保持一致) */
export const MAX_POOLS = 20
export const MAX_POOL_LENGTH = 16

/** 操作/提交状态 */
type ApplyState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

// ========== 卡片外壳样式(对齐 SkillHub .sh-cfg 体系) ==========

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

/** 收起态仅隐藏卡体(表单保持挂载,展开不重新拉取) */
const HIDDEN_STYLE: CSSProperties = {
  display: 'none'
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

// ========== 表单样式(对齐 RemindForm) ==========

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column'
}

const labelStyle: CSSProperties = {
  display: 'block',
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

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8
}

/** 行内删除按钮(对齐 .sh-cfg-disc 语义,精简为 28×34 图标钮) */
const removeBtnStyle: CSSProperties = {
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
}

const addBtnStyle: CSSProperties = {
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
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-caption, #6b7280)',
  margin: 0,
  lineHeight: 1.5
}

const errorStyle: CSSProperties = {
  ...hintStyle,
  color: 'var(--dsw-alias-state-danger-label, #dc2626)',
  flex: 1
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

/** 已保存提示(对齐 .sh-cfg-ok) */
const savedStyle: CSSProperties = {
  ...hintStyle,
  color: 'var(--dsw-alias-state-success-label, #16a34a)',
  flex: 1
}

// ========== 状态 hook ==========

/** 配置状态模型(表单渲染与动作统一入口) */
interface AquaSettingsModel {
  phase: 'loading' | 'ready' | 'unavailable'
  /** 已保存池号快照 */
  saved: string[] | null
  /** 草稿(编辑中) */
  draft: string[] | null
  dirty: boolean
  applyState: ApplyState
  load(): Promise<void>
  editPool(index: number, value: string): void
  addPool(): void
  removePool(index: number): void
  save(): Promise<void>
  discard(): void
}

/** 错误信息提取 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 池号配置加载/编辑/保存(与 useRemindConfig 同构) */
export function useAquaSettings(api: AquaSettingsApi, t: AquaSettingsTranslate): AquaSettingsModel {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [saved, setSaved] = useState<string[] | null>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' })

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading')
    try {
      const result = await api.get()
      const pools = [...result.settings.pools]
      setSaved(pools)
      setDraft(pools)
      setApplyState({ kind: 'idle' })
      setPhase('ready')
    } catch {
      setPhase('unavailable')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  const saving = applyState.kind === 'saving'

  /** 编辑后回到 idle(清除「已保存」提示,由 dirty 徽标接管) */
  const markEdited = (): void => {
    setApplyState((state) => (state.kind === 'idle' ? state : { kind: 'idle' }))
  }

  const editPool = (index: number, value: string): void => {
    setDraft((current) => (current ? current.map((item, i) => (i === index ? value : item)) : current))
    markEdited()
  }

  const addPool = (): void => {
    setDraft((current) => (current && current.length < MAX_POOLS ? [...current, ''] : current))
    markEdited()
  }

  const removePool = (index: number): void => {
    setDraft((current) => (current ? current.filter((_, i) => i !== index) : current))
    markEdited()
  }

  const save = async (): Promise<void> => {
    if (!draft || saving) return

    // 前端预校验(与 Host 侧 sanitizePools 同一口径):trim 后非空、限长
    const trimmed = draft.map((item) => item.trim())
    const invalidIndex = trimmed.findIndex((item) => !item || item.length > MAX_POOL_LENGTH)
    if (invalidIndex !== -1) {
      setApplyState({ kind: 'error', message: t('field.pools.invalid', { index: invalidIndex + 1, len: MAX_POOL_LENGTH }) })
      return
    }
    if (trimmed.length === 0) {
      setApplyState({ kind: 'error', message: t('field.pools.empty') })
      return
    }

    setApplyState({ kind: 'saving' })
    try {
      const result = await api.save({ pools: trimmed })
      const pools = [...result.settings.pools]
      setSaved(pools)
      setDraft(pools)
      setApplyState({ kind: 'saved' })
    } catch (error) {
      setApplyState({ kind: 'error', message: messageOf(error) })
    }
  }

  const discard = (): void => {
    setDraft(saved ? [...saved] : null)
    setApplyState({ kind: 'idle' })
  }

  return { phase, saved, draft, dirty, applyState, load, editPool, addPool, removePool, save, discard }
}

// ========== 表单组件 ==========

/** 展开区表单:池号列表编辑 + 底部操作区 */
function PoolsForm({ model, t }: { model: AquaSettingsModel; t: AquaSettingsTranslate }): ReactNode {
  const draft = model.draft ?? []
  const busy = model.applyState.kind === 'saving'

  if (model.phase === 'unavailable') {
    return (
      <div style={formStyle}>
        <p style={errorStyle}>{t('card.unavailable')}</p>
        <div style={footerStyle}>
          <button type="button" style={ghostBtnStyle} onClick={() => void model.load()}>
            {t('card.retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={formStyle}>
      <div>
        <p style={labelStyle}>{t('field.pools.label')}</p>
        <p style={hintStyle}>{t('field.pools.hint', { max: MAX_POOLS, len: MAX_POOL_LENGTH })}</p>
      </div>

      {draft.map((value, index) => (
        <div key={index} style={{ ...rowStyle, marginTop: 8 }}>
          <input
            style={inputStyle}
            value={value}
            maxLength={MAX_POOL_LENGTH}
            placeholder={t('field.pools.placeholder')}
            aria-label={`${t('field.pools.label')} ${index + 1}`}
            onChange={(e) => model.editPool(index, e.target.value)}
          />
          <button
            type="button"
            style={removeBtnStyle}
            aria-label={t('field.pools.remove')}
            title={t('field.pools.remove')}
            disabled={draft.length <= 1}
            onClick={() => model.removePool(index)}
          >
            ✕
          </button>
        </div>
      ))}

      <div style={{ marginTop: 8 }}>
        <button type="button" style={addBtnStyle} disabled={draft.length >= MAX_POOLS} onClick={model.addPool}>
          ＋ {t('field.pools.add')}
        </button>
      </div>

      <div style={footerStyle}>
        {model.applyState.kind === 'error' ? (
          <p style={errorStyle} role="status">
            {model.applyState.message}
          </p>
        ) : null}
        {model.applyState.kind === 'saved' ? (
          <p style={savedStyle} role="status">
            {t('card.saved')}
          </p>
        ) : null}
        <button type="button" style={ghostBtnStyle} disabled={!model.dirty || busy} onClick={model.discard}>
          {t('card.discard')}
        </button>
        <button
          type="button"
          style={{
            ...primaryBtnStyle,
            opacity: !model.dirty || busy ? DISABLED_OPACITY : 1,
            cursor: !model.dirty || busy ? 'default' : 'pointer'
          }}
          disabled={!model.dirty || busy}
          onClick={() => void model.save()}
        >
          {busy ? t('card.saving') : t('card.save')}
        </button>
      </div>
    </div>
  )
}

// ========== 卡片 ==========

/**
 * 渲染「AquaSense 设置」卡片。
 * @param props - locale 座位(t)+ 注入面(api)。
 * @returns `<li>` 卡片元素。
 */
export function AquaSettingsCard({ t, api }: AquaSettingsCardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const model = useAquaSettings(api, t)

  /** 接口不可用时强制展开(展示重试入口) */
  const expanded = open || model.phase === 'unavailable'

  return (
    <li style={expanded ? { ...cardStyle, ...cardOpenStyle } : cardStyle}>
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
          {model.dirty ? <span style={unsavedStyle}>{t('card.unsaved')}</span> : null}
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
      <div style={expanded ? bodyStyle : HIDDEN_STYLE}>
        <PoolsForm model={model} t={t} />
      </div>
    </li>
  )
}
