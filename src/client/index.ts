/**
 * aquasense-remind —— 浏览器半侧入口(需求 R6.5 原型 3)
 *
 * 注册三项:
 *  - locale 字典(zh/en):配置页/设置卡片文案;
 *  - settings.plugin.item 键位槽卡片(key = settings 命名空间 'aquasense-settings'):
 *    设置页「插件配置」tab 扫描到同名 Host 命名空间后自动派发
 *    「AquaSense 设置」卡片(池号枚举配置);
 *  - sidebar.footer.action 列表槽入口(与设置按钮同级):侧栏页脚渲染
 *    「智慧渔业」,点击在会话列上打开独立配置页(见 AquaConfig.tsx)。
 *
 * 构建产物由 tsdown 打成 DSH module-loader 包裹的 dist/client.js
 * (package.json dsh.client.platform = 'web')。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { aquaSettingsApi, remindApi } from './api.js'
import { AquaConfigEntry, ensureAquaConfigStyle, type AquaConfigInjected } from './AquaConfig.js'
import { en, NS, zh, type RemindLocaleKey } from './locales.js'
import { AquaSettingsCard, type AquaSettingsCardInjected } from './AquaSettingsCard.js'
import { en as settingsEn, SETTINGS_NS, zh as settingsZh, type AquaSettingsLocaleKey } from './settings-locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** S9 提醒配置页文案。 */
    'aquasense-remind': RemindLocaleKey
    /** AquaSense 设置卡片文案。 */
    'aquasense-settings': AquaSettingsLocaleKey
  }
}

/** 所需服务:槽位注册 + 字典面 */
export const inject = ['slots', 'locale']

/** 侧栏入口标识(列表槽读 id;键控槽读 key,双携带以兼容两侧宿主形态) */
const SIDEBAR_ENTRY_ID = 'aquasense-config'

/**
 * 侧栏页脚入口注册选项:target name 为 sidebar.footer.action,id+key 双携带;
 * 经变量承载(as const 保持字面量类型)以规避字面量的多余属性检查
 * (本地声明的 list 形态只约束 id)。
 */
const sidebarEntryOptions = {
  name: 'sidebar.footer.action',
  id: SIDEBAR_ENTRY_ID,
  key: SIDEBAR_ENTRY_ID,
  order: 9,
  locale: NS,
  inject: (): AquaConfigInjected => ({ api: remindApi })
} as const

/**
 * 客户端插件体:注册字典、设置卡片与侧栏配置入口。
 * @param ctx - 浏览器侧根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'aquasense-remind: dictionaries')
  ctx.effect(
    () => ctx.locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn }),
    'aquasense-settings: dictionaries'
  )

  const settingsCardInjected = (): AquaSettingsCardInjected => ({ api: aquaSettingsApi })
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        locale: SETTINGS_NS,
        inject: settingsCardInjected
      },
      AquaSettingsCard
    )
  )

  ctx.effect(ensureAquaConfigStyle, 'aquasense-remind: config style')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(sidebarEntryOptions, AquaConfigEntry))
}
