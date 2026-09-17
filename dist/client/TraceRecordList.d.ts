/**
 * TraceRecordList —— 配置页面板内「📊 分析记录」列表(v1.3,去 iframe 化)
 *
 * 直接调用 /aquasense-reports/api/records JSON 接口,
 * 在面板内容区渲染记录列表;不再依赖 iframe 加载独立 HTML 页面,
 * 从根本上规避跨域/反向代理路径不通等问题。
 *
 * 设计:
 *  - 状态: 'list'(列表) / 'detail'(单条详情)
 *  - 筛选: 池号 / 状态,即时生效;分页用「加载更多」
 *  - 样式复用面板 CSS 变量体系,与 每日任务提醒 表单视觉一致
 *  - API 失败时显示友好提示(非 iframe 崩溃页面)
 */
import type { ReactNode } from 'react';
interface TraceRecordListProps {
    /** API 前缀(默认 /aquasense-reports) */
    apiBase?: string;
}
export declare function TraceRecordList({ apiBase }: TraceRecordListProps): ReactNode;
export {};
