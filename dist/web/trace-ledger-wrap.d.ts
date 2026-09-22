/**
 * R8 群聊场景 trace 集成(后置收集,见 docs/r8-traceability-architecture.md §4.1 方案 A)
 *
 * 以包装器替换 recordLedger 注册(不修改其实现):台账写入完成后,从
 * args(analysis/advice/open_id)与返回值(record_id/message)组装**简化版**
 * AnalysisRecord(source='group_chat')并落盘。
 *
 * 简化模式说明:群聊场景由 Agent 编排调用,无法分段计时,故只有 ledger
 * 步骤有真实耗时(包装器测量);analyze/advice 数据来自 Agent 透传的参数,
 * 无 Token 数据(记录中为 0)。
 *
 * 安全边界:
 *  - trace 写入为 fire-and-forget,任何失败不影响台账主链路(内部全量捕获);
 *  - 追问类失败(missing 非空)不记录(高频且无分析价值,避免噪声);
 *  - H5 场景调用原始 recordLedger(未包装),由 report-handler 全量埋点,不重复记录。
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/**
 * 反解 knowledge_excerpt 字符串(格式《标题》[定位]:「原文」)为结构化摘录;
 * 降级路径拿不到通道归属(from),逐条容错(解析失败跳过)。导出供测试。
 */
export declare function parseExcerpts(list: string[]): Array<{
    title: string;
    locator?: string;
    excerpt_preview: string;
}>;
/**
 * 组装并写入一条简化分析记录;全量捕获异常,不向调用方抛出。
 */
export declare function recordChatTrace(args: unknown, result: unknown, ledgerDurationMs: number): Promise<void>;
/**
 * 包装台账工具:透传全部定义,仅在 execute 后追加一次后置收集。
 * trace 写入为 fire-and-forget(不 await),不改变工具返回时机与结果。
 */
export declare function wrapLedgerWithTrace(tool: ToolDefinition): ToolDefinition;
