/**
 * aquasense-remind —— 浏览器半侧入口(需求 R6.5 原型 3)
 *
 * 注册三项:
 *  - locale 字典(zh/en):卡片与配置页文案;
 *  - settings.plugin.item 键位槽卡片(key = settings 命名空间 'aquasense-remind'):
 *    设置页「插件配置」tab 扫描到同名 Host 命名空间后自动派发本卡片;
 *  - sidebar.footer.action 列表槽入口(与设置按钮同级):侧栏页脚渲染
 *    「🐟 AquaSense 配置」,点击在会话列上打开独立配置页(见 AquaConfig.tsx)。
 *
 * 构建产物由 tsdown 打成 DSH module-loader 包裹的 dist/client.js
 * (package.json dsh.client.platform = 'web')。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type RemindCardKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** S9 提醒设置卡片文案。 */
        'aquasense-remind': RemindCardKey;
    }
}
/** 所需服务:槽位注册 + 字典面 */
export declare const inject: string[];
/**
 * 客户端插件体:注册字典、设置卡片与侧栏配置入口。
 * @param ctx - 浏览器侧根上下文。
 */
export declare function apply(ctx: ClientContext): void;
