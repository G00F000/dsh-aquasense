/**
 * R8 群聊 Agent 决策链桥接(方式 B,见 docs/r8-traceability-architecture.md §3.6)
 *
 * 订阅 DSH 会话事件流(ctx.on('session/event')),对群聊场景的
 * aquasense_analyze/advice/ledger 三工具调用做 tool/call ↔ tool/result 配对,
 * 采集 turn/step/call_id/重试/精确耗时,组装 AnalysisRecord.agent 并回填到
 * trace-ledger-wrap 后置收集写入的分析记录(业务数据仍由包装器负责)。
 *
 * 借鉴 dsh-observe(Apache-2.0)的设计模式,原创实现(无代码复制,无许可证义务):
 *  纪律1 开闭配对  / 纪律2 悬挂兜底  / 纪律3 WeakMap  / 纪律4 回调 try-catch
 *
 * 关联方式(会话事件拿不到 chat_id,以池号+时间窗口关联):
 *  ledger 工具参数提取 pool_id → index.json 中查找「同池号 + group_chat +
 *  无 agent 字段 + turn/start 时间之后」的最新记录回填;ledger-wrap 写盘可能
 *  晚于 ledger tool/result 事件(图片下载耗时),故回填带延迟重试。
 *
 * 边界(诚实声明):
 *  - 视觉模型 Token/知识库命中数在 agent 层拿不到(仍由工具内埋点负责);
 *  - 不读日志文件(~/.dsh/sessions/*.jsonl),只订阅进程内实时事件;
 *    插件晚挂载/中途重启的历史事件不可回溯(记录缺失 agent,UI 自动隐藏)。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 会话对象最小面(仅取 id 作 WeakMap 键关联调试,非必需) */
interface TraceSession {
    id?: unknown;
}
/** 会话事件最小面(type/seq/time/data,与 dsh-session SessionEvent 对齐) */
interface TraceEvent {
    type?: unknown;
    seq?: unknown;
    /** Unix epoch milliseconds */
    time?: unknown;
    data?: unknown;
}
/** 从工具 result.value 计算结构化元数据(供 UI Agent 决策链摘要);导出供测试 */
export declare function computeToolMeta(toolName: string, value: unknown): Record<string, unknown> | undefined;
export declare class SessionTraceBridge {
    private readonly states;
    /** 会话事件入口(纪律4:调用方已包 try-catch,此处仍防御) */
    handleEvent(session: TraceSession, event: TraceEvent): void;
    /** 会话销毁兜底(纪律2):未闭合调用强制关闭并尝试回填 */
    handleSessionDisposed(session: TraceSession): void;
    /** 获取/创建会话状态(WeakMap) */
    private stateOf;
    /** 悬挂兜底:未闭合调用以 error 状态并入 done;willFill=true 时触发回填 */
    private closeHanging;
    /** 组装 AgentTraceData 并异步回填(延迟重试,防重复) */
    private fill;
}
/**
 * 订阅 DSH 会话事件,启动群聊 Agent 决策链采集(v1.8)。
 * enabled=false/宿主不支持 session 事件时静默跳过(零注册)。
 * 注册与注销经 ctx.effect 统一收口,回调内全量 try-catch(纪律4)。
 */
export declare function installSessionTraceBridge(ctx: Context): void;
export {};
