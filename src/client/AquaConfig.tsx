/**
 * AquaConfig —— 侧栏一级入口 + 独立配置页(需求 R6.5,UI 对齐 SkillHub 插件广场)
 *
 * 注册到 `sidebar.footer.action` 槽位:与设置按钮同级的侧栏页脚动作:
 *  - 触发器:「智慧渔业」(v1.9 更名;图标为与插件广场同风格的内联线性 SVG,
 *    见 WavesIcon;wide 显示文字,rail 仅图标,悬停/展开态对齐侧栏导航项);
 *  - 点击在会话列上打开独立配置页(createPortal 到 body,fixed 定位,随会话列尺寸变化);
 *  - 页顶页签组「每日任务提醒 | 📊 分析记录」+ 右上角 × 关闭;
 *  - 「📊 分析记录」页签在面板内切换展示列表页(React 组件直接调 /aquasense-reports
 *    API;v1.3 去 iframe 化;不再新开标签页,详情亦收在面板内);
 *  - Esc / 点击面板外关闭(交互与布局对齐 SkillHub 插件广场页面)。
 *
 * 布局适配(v1.8):宿主页脚动作容器(footerActions)为单行 flex(nowrap),
 * 多个整宽条目并排会互相挤压(插件广场被压窄、本入口贴边);样式注入中以
 * :has() 命中该容器并允许换行,使「插件广场 / 智慧渔业 / 设置」
 * 各占一整行(rail 收起态下圆钮亦垂直堆叠)。
 *
 * 配置内容由 RemindForm 提供(v1.8 起为唯一使用方)。
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemindApi } from './api.js'
import { RemindForm, useRemindConfig, type RemindTranslate } from './RemindForm.js'
import { TraceRecordList, TraceTrendView } from './TraceRecordList.js'

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

/** 配置页页签(remind=每日任务提醒表单,reports=分析记录列表,trend=趋势分析) */
type PageTab = 'remind' | 'reports' | 'trend'

/** 非当前页签内容的隐藏样式(保留挂载:不丢表单草稿与列表页滚动/筛选状态) */
const HIDDEN: CSSProperties = { display: 'none' }

const STYLE_ID = 'aquasense-config-style'

/**
 * 入口与配置页样式(类名 aqs- 前缀,令牌与尺寸对齐 SkillHub 的
 * .sh-plaza-trigger / .sh-plaza-page / .sh-plaza-close 体系)。
 */
const CSS = `
.aqs-wrap{width:100%}
.aqs-wrap.rail{display:flex;justify-content:center}
/* 宿主页脚动作容器:默认单行 flex(nowrap),多个整宽条目并排会互相挤压;
   允许换行使各条目独占整行(与设置行堆叠)。 */
div:has(> [data-slot="sidebar.footer.action"]){flex-wrap:wrap}
.aqs-trigger{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.aqs-wrap.rail .aqs-trigger{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.aqs-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.aqs-trigger.on,.aqs-trigger[aria-expanded=true]{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}
.aqs-ico{flex:none;display:block;width:16px;height:16px}
.aqs-wrap.rail .aqs-ico{width:18px;height:18px}
.aqs-txt{white-space:nowrap;overflow:hidden}
.aqs-page{position:fixed;z-index:40;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-top{display:flex;align-items:center;gap:12px;flex:none;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-base,#fff)}
/* 顶栏页签组：「每日任务提醒」与「📊 分析记录」（入口 C，R8 需求 v1.3）为同页
   切换的两个页签（role=tablist，样式对齐 SkillHub 插件广场「插件 / 技能」），
   后者在面板内容区以 React 组件直调 API 展示（去 iframe 化），不新开标签页 */
.aqs-tabs{display:flex;align-items:center;gap:2px;min-width:0}
.aqs-tab{position:relative;display:flex;align-items:center;gap:4px;padding:6px 10px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer}
.aqs-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on{color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on::after{content:'';position:absolute;left:10px;right:10px;bottom:1px;height:2px;border-radius:2px;background:var(--dsw-alias-button-primary-fill,#4d6bfe)}
.aqs-close{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary,#4b5563)}
.aqs-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.aqs-body{flex:1;min-height:0;overflow:auto;padding:18px 20px 32px}
/* 分析记录页签:内容区去掉内边距,React 组件铺满(自带筛选条与滚动) */
.aqs-body.flush{display:flex;flex-direction:column;padding:0;overflow:hidden}
.aqs-reports{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
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
  const [tab, setTab] = useState<PageTab>('remind')
  // v1.3:改用 TraceRecordList React 组件直接调 API(不再 iframe,规避跨域/代理路径不通)
  // 切换用 display 控制,保留表单草稿与列表页状态;首次切到 reports 时才挂载
  const [reportsOn, setReportsOn] = useState(false)
  // 趋势分析状态：记录当前查看的池号
  const [trendPool, setTrendPool] = useState<string>('')

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
        <div className="aqs-tabs" role="tablist" aria-label={t('page.title')}>
          <button
            type="button"
            role="tab"
            className={'aqs-tab' + (tab === 'remind' ? ' on' : '')}
            aria-selected={tab === 'remind'}
            onClick={() => {
              setTab('remind')
            }}
          >
            {t('page.title')}
          </button>
          <button
            type="button"
            role="tab"
            className={'aqs-tab' + (tab === 'reports' ? ' on' : '')}
            aria-selected={tab === 'reports'}
            onClick={() => {
              setReportsOn(true)
              setTab('reports')
            }}
          >
            📊 {t('page.tab.reports')}
          </button>
        </div>
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
      <div className={'aqs-body' + (tab === 'reports' || tab === 'trend' ? ' flush' : '')}>
        <div className="aqs-form" style={tab === 'remind' ? undefined : HIDDEN}>
          <RemindForm model={model} t={t} />
        </div>
        {reportsOn ? (
          <div className="aqs-reports" style={tab === 'reports' ? undefined : HIDDEN}>
            <TraceRecordList
              onOpenTrend={(pool) => {
                setTrendPool(pool)
                setTab('trend')
              }}
            />
          </div>
        ) : null}
        {tab === 'trend' && trendPool ? (
          <div className="aqs-reports" style={{ width: '100%', height: '100%' }}>
            <TraceTrendView
              pool={trendPool}
              onBack={() => { setTab('reports') }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 入口图标:三道水波线性 SVG,规格与插件广场入口图标(PlazaIcon)同风格——
 * 16×16 视窗、无填充、描边取 currentColor、strokeWidth 1.4,
 * 随按钮文字色与悬停/展开态自动着色(尺寸档由 .aqs-ico 控制)。
 * @returns 图标元素。
 */
function WavesIcon(): ReactNode {
  return (
    <svg className="aqs-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.7 4c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.7 8c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.7 12c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
        <WavesIcon />
        {wide ? <span className="aqs-txt">{t('entry.label')}</span> : null}
      </button>
      {panel}
    </div>
  )
}
