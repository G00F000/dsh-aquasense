/**
 * RemindCard —— settings.plugin.item 槽位卡片(设置 → 插件 → 插件配置)
 *
 * 卡片外壳:标题/描述/未保存徽标 + 展开/收起按钮;展开区表单由 RemindForm
 * 提供(与侧栏「🐟 AquaSense 配置」入口打开的独立配置页共用同一份实现)。
 * 交互(需求 R6.5 原型 3):启用开关 / 推送目标群下拉 / 任务列表增删 /
 * [保存配置](持久化并重建当日推送计划) [发送测试提醒](立即推一次总览卡片)。
 * 数据经 /aquasense-remind/api 与 Host 侧读写(见 src/web/remind-gateway.ts)。
 *
 * UI 对齐 SkillHub(插件广场)设置卡:展开区 + 独立收起按钮、未保存徽标、
 * 字段分隔线、底部「发送测试 / 放弃修改 / 保存配置」操作区。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemindApi } from './api.js';
/** 卡片注入面(注册时提供,见 index.ts) */
export interface RemindCardInjected {
    readonly api: RemindApi;
}
/** 卡片 props:locale 座位 + 注入面 */
export type RemindCardProps = PropsLocale<'aquasense-remind'> & RemindCardInjected;
/**
 * 渲染 S9 提醒设置卡片。
 * @param props - locale 座位(t)+ 注入面(api)。
 * @returns `<li>` 卡片元素。
 */
export declare function RemindCard({ t, api }: RemindCardProps): import("react").JSX.Element;
