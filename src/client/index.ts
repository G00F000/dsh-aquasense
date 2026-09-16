/**
 * aquasense-remind 设置卡片 —— 浏览器半侧入口(需求 R6.5 原型 3)
 *
 * 注册两项:
 *  - locale 字典(zh/en):卡片文案;
 *  - settings.plugin.item 键位槽卡片(key = settings 命名空间 'aquasense-remind'):
 *    设置页「插件配置」tab 扫描到同名 Host 命名空间后自动派发本卡片。
 *
 * 构建产物由 tsdown 打成 DSH module-loader 包裹的 dist/client.js
 * (package.json dsh.client.platform = 'web')。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { remindApi } from './api.js'
import { RemindCard, type RemindCardInjected } from './RemindCard.js'
import { en, NS, zh, type RemindCardKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** S9 提醒设置卡片文案。 */
    'aquasense-remind': RemindCardKey
  }
}

/** 所需服务:槽位注册 + 字典面 */
export const inject = ['slots', 'locale']

/**
 * 客户端插件体:注册字典与设置卡片。
 * @param ctx - 浏览器侧根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'aquasense-remind: dictionaries')

  const cardInjected = (): RemindCardInjected => ({ api: remindApi })
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: NS,
        locale: NS,
        inject: cardInjected
      },
      RemindCard
    )
  )
}
