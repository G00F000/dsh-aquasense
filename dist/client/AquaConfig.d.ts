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
import type { ReactNode } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemindApi } from './api.js';
/**
 * 槽位契约:宿主侧由 @deepseek-ai/dsh-client-ui-sidebar 声明(侧栏页脚动作,
 * 位于设置座位之外的 footerActions 容器)。本包依赖面未包含该包,此处按同一
 * 形状合并声明,仅用于本包的注册与组件类型检查;运行时以宿主声明为准。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'sidebar.footer.action': {
            kind: 'list';
            scope: 'root';
            owner: SidebarFooterActionOwnerProps;
        };
    }
}
/** 侧栏页脚动作的 owner 共享位(宿主传入):false = 56px 收起轨道 */
export interface SidebarFooterActionOwnerProps {
    wide: boolean;
}
/** 入口注入面(注册时提供,见 index.ts) */
export interface AquaConfigInjected {
    readonly api: RemindApi;
}
/** 入口组件 props:owner 共享位 + locale 座位 + 注入面 */
export type AquaConfigEntryProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'aquasense-remind'> & AquaConfigInjected;
/** 注入入口/配置页样式(幂等;返回无操作清理器以适配 ctx.effect) */
export declare function ensureAquaConfigStyle(): () => void;
/**
 * 渲染侧栏页脚入口:触发器 + (展开时)配置页 portal。
 * @param props - owner 共享位(wide)+ locale 座位(t)+ 注入面(api)。
 * @returns 入口元素。
 */
export declare function AquaConfigEntry({ wide, t, api }: AquaConfigEntryProps): ReactNode;
