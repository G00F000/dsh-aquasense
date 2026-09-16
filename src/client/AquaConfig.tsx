/**
 * AquaConfig —— 侧栏一级入口 + 独立配置页(需求 R6.5,UI 对齐 SkillHub 插件广场)
 *
 * 注册到 `sidebar.footer.action` 槽位:与设置按钮同级的侧栏页脚动作:
 *  - 触发器:🐟 AquaSense 配置(wide 显示文字,rail 仅图标,悬停/展开态对齐侧栏导航项);
 *  - 点击在会话列上打开独立配置页(createPortal 到 body,fixed 定位,随会话列尺寸变化);
 *  - 页顶二级标题「每日任务提醒」+ 右上角 × 关闭;
 *  - Esc / 点击面板外关闭(交互与布局对齐 SkillHub 插件广场页面)。
 *
 * 配置内容复用 RemindForm(与设置页卡片同一份实现)。
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemindApi } from './api.js'
import { RemindForm, useRemindConfig, type RemindTranslate } from './RemindForm.js'

/**
 * 槽位契约:宿主侧由 @deepseek-ai/dsh-client-ui-sidebar 声明(侧栏页脚动作,
 * 位于设置座位之外的 footerActions 容器)。本包依赖面未包含该包,此处按同一
 * 形状合并声明,仅用于本包的注册与组件类型检查;运行时以宿主声明为准。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: SidebarFooterActionOwnerProps
    }
  }
}

/** 侧栏页脚动作的 owner 共享位(宿主传入):false = 56px 收起轨道 */
export interface SidebarFooterActionOwnerProps {
  wide: boolean
}

/** 入口注入面(注册时提供,见 index.ts) */
export interface AquaConfigInjected {
  readonly api: RemindApi
}

/** 入口组件 props:owner 共享位 + locale 座位 + 注入面 */
export type AquaConfigEntryProps = PropsRuntime<'sidebar.footer.action'> &
  PropsLocale<'aquasense-remind'> &
  AquaConfigInjected

/** 面板定位框(会话列矩形;取不到时退化为整窗) */
interface OverlayBox {
  top: number
  left: number
  width: number
  height: number
}

const STYLE_ID = 'aquasense-config-style'

/**
 * 入口与配置页样式(类名 aqs- 前缀,令牌与尺寸对齐 SkillHub 的
 * .sh-plaza-trigger / .sh-plaza-page / .sh-plaza-close 体系)。
 */
const CSS = `
.aqs-wrap{width:100%}
.aqs-wrap.rail{display:flex;justify-content:center}
.aqs-trigger{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.aqs-wrap.rail .aqs-trigger{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.aqs-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.aqs-trigger.on,.aqs-trigger[aria-expanded=true]{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}
.aqs-ico{flex:none;width:16px;height:16px;display:grid;place-items:center;font-size:14px;line-height:1}
.aqs-wrap.rail .aqs-ico{width:18px;height:18px;font-size:16px}
.aqs-txt{white-space:nowrap;overflow:hidden}
.aqs-page{position:fixed;z-index:40;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-top{display:flex;align-items:center;gap:16px;flex:none;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-base,#fff)}
.aqs-title{margin:0;font-size:15px;font-weight:600;line-height:22px}
.aqs-close{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary,#4b5563)}
.aqs-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.aqs-body{flex:1;min-height:0;overflow:auto;padding:18px 20px 32px}
.aqs-form{max-width:760px}
`

/** 注入入口/配置页样式(幂等;返回无操作清理器以适配 ctx.effect) */
export function ensureAquaConfigStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = CSS
  return () => {}
}

/** 会话列根节点(SkillHub 同款定位锚点) */
function conversationRoot(): Element | null {
  return typeof document === 'undefined' ? null : document.querySelector('[data-phase]')
}

/** 会话列矩形;无会话列时回退整窗(配置页不受会话状态限制) */
function overlayBox(): OverlayBox {
  const root = conversationRoot()
  if (root) {
    const rect = root.getBoundingClientRect()
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  }
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }
}

/** 跟踪会话列矩形(展开时随尺寸/滚动变化更新) */
function useOverlayBox(active: boolean): OverlayBox | null {
  const [box, setBox] = useState<OverlayBox | null>(null)

  useEffect(() => {
    if (!active) {
      setBox(null)
      return
    }
    const update = (): void => {
      setBox(overlayBox())
    }
    update()
    const root = conversationRoot()
    const observer = root && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (root && observer) observer.observe(root)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active])

  return box
}

/** 配置页(portal 内容):二级标题 + 右上角关闭 + 共享表单 */
function AquaConfigPage({
  box,
  t,
  api,
  onClose
}: {
  box: OverlayBox
  t: RemindTranslate
  api: RemindApi
  onClose: () => void
}): ReactNode {
  const model = useRemindConfig(api, t)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="aqs-page"
      role="dialog"
      aria-modal="false"
      aria-label={t('page.title')}
      style={{ top: box.top, left: box.left, width: box.width, height: box.height } satisfies CSSProperties}
    >
      <div className="aqs-top">
        <h2 className="aqs-title">{t('page.title')}</h2>
        <button
          type="button"
          className="aqs-close"
          onClick={onClose}
          aria-label={t('page.close')}
          title={t('page.close')}
        >
          ×
        </button>
      </div>
      <div className="aqs-body">
        <div className="aqs-form">
          <RemindForm model={model} t={t} />
        </div>
      </div>
    </div>
  )
}

/**
 * 渲染侧栏页脚入口:触发器 + (展开时)配置页 portal。
 * @param props - owner 共享位(wide)+ locale 座位(t)+ 注入面(api)。
 * @returns 入口元素。
 */
export function AquaConfigEntry({ wide, t, api }: AquaConfigEntryProps): ReactNode {
  useEffect(() => {
    ensureAquaConfigStyle()
  }, [])

  const [open, setOpen] = useState(false)
  const box = useOverlayBox(open)
  const close = useCallback(() => {
    setOpen(false)
  }, [])

  // 点击面板与入口之外关闭(对齐 SkillHub 插件广场)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.aqs-page, .aqs-wrap')) return
      close()
    }
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open, close])

  const panel =
    open && box && typeof document !== 'undefined'
      ? createPortal(<AquaConfigPage box={box} t={t} api={api} onClose={close} />, document.body)
      : null

  return (
    <div className={'aqs-wrap' + (wide ? '' : ' rail')}>
      <button
        type="button"
        className={'aqs-trigger' + (open ? ' on' : '')}
        aria-label={t('entry.label')}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        <span className="aqs-ico" aria-hidden="true">
          🐟
        </span>
        {wide ? <span className="aqs-txt">{t('entry.label')}</span> : null}
      </button>
      {panel}
    </div>
  )
}
