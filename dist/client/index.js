/**
 * aquasense-remind —— 浏览器半侧入口(需求 R6.5 原型 3)
 *
 * 注册两项(v1.8 起单入口:设置页卡片已移除):
 *  - locale 字典(zh/en):配置页文案;
 *  - sidebar.footer.action 列表槽入口(与设置按钮同级):侧栏页脚渲染
 *    「🐟 AquaSense 配置」,点击在会话列上打开独立配置页(见 AquaConfig.tsx)。
 *
 * 构建产物由 tsdown 打成 DSH module-loader 包裹的 dist/client.js
 * (package.json dsh.client.platform = 'web')。
 */
import { remindApi } from './api.js';
import { AquaConfigEntry, ensureAquaConfigStyle } from './AquaConfig.js';
import { en, NS, zh } from './locales.js';
/** 所需服务:槽位注册 + 字典面 */
export const inject = ['slots', 'locale'];
/** 侧栏入口标识(列表槽读 id;键控槽读 key,双携带以兼容两侧宿主形态) */
const SIDEBAR_ENTRY_ID = 'aquasense-config';
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
    inject: () => ({ api: remindApi })
};
/**
 * 客户端插件体:注册字典与侧栏配置入口。
 * @param ctx - 浏览器侧根上下文。
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'aquasense-remind: dictionaries');
    ctx.effect(ensureAquaConfigStyle, 'aquasense-remind: config style');
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(sidebarEntryOptions, AquaConfigEntry));
}
