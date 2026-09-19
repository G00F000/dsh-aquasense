/**
 * TraceRecordList v2.0 — 配置页面板内「📊 分析记录」(列表态 ⇄ 详情态)
 *
 * 列表态：调用 /aquasense-reports/api/records(JSON index 摘要)；
 * 详情态：调用 /aquasense-reports/api/records/:id(完整 AnalysisRecord)，
 *   展示元信息 + 瀑布图(Trace Timeline) + 5 步骤 Accordion 展开。
 *
 * 原型依据：docs/r8-traceability-requirements.md §4.1 原型 A
 * 样式复用面板 CSS 变量体系，与每日任务提醒表单视觉一致。
 */
import type { ReactNode } from 'react';
interface TraceRecordListProps {
    apiBase?: string;
    /** 点击趋势分析时的回调（面板内切换） */
    onOpenTrend?: (pool: string) => void;
}
export declare function TraceRecordList({ apiBase, onOpenTrend }: TraceRecordListProps): ReactNode;
interface TraceTrendViewProps {
    pool: string;
    apiBase?: string;
    onBack?: () => void;
}
export declare function TraceTrendView({ pool: initPool, apiBase, onBack }: TraceTrendViewProps): ReactNode;
export {};
