/**
 * R8 分析记录器(Trace 埋点 + AnalysisRecord 组装,见 docs/r8-traceability-architecture.md §3.2)
 *
 * 借鉴 Langfuse Trace/Span 层级模型:
 *  - Trace  = 一次完整 AI 分析(RPT-YYYYMMDD-HHmmss)
 *  - Span   = 管线中的每个步骤(upload/analyze/retrieve/advice/ledger)
 *
 * 使用方式(H5 全量采集):
 *   const tracer = new AnalysisTracer({ pool, reporter, reporter_open_id, source: 'h5_upload' })
 *   tracer.startSpan('analyze'); ...; tracer.endSpan('analyze', { cls, ... })
 *   await tracer.flush()   // 写 reports/RPT-*.json + 更新 index.json
 *
 * 群聊场景(后置收集,无耗时/Token)用 recordSpan 直接落数据,见 §4.1 方案 A。
 */
/** 记录来源:h5_upload=拍照汇报页 / group_chat=群聊发图后置收集 / api=外部调用 */
export type RecordSource = 'h5_upload' | 'group_chat' | 'api';
/** Span: 图片上传 */
export interface SpanUpload {
    image_count: number;
    /** 图片文件名(H5:提交采集;群聊:下载/落盘名) */
    image_names?: string[];
    /** 服务端收到的图片字节数(H5 为客户端压缩后) */
    image_sizes: number[];
    compressed_sizes?: number[];
    duration_ms?: number;
    error?: string;
}
/** Span: AI 视觉分析 */
export interface SpanAnalyze {
    prompt_length: number;
    input_tokens: number;
    output_tokens: number;
    /** 模型原始输出(截断保留前 500 字) */
    output_raw: string;
    cls: string;
    symptoms: string[];
    severity: string;
    confidence: number;
    scene_hint: string;
    /** 解剖场景可见器官(仅 scene_hint=dissection) */
    organs?: string[];
    duration_ms?: number;
    error?: string;
}
/** Span: 知识库检索 */
export interface SpanRetrieve {
    query: string;
    /** 三通道命中数(H5 全量埋点必有;群聊 degraded 反解时缺通道数据,缺省不写) */
    channel_a_wiki?: number;
    channel_b_note?: number;
    channel_c_pdf?: number;
    merged_count?: number;
    excerpts: Array<{
        title: string;
        from?: string;
        locator?: string;
        excerpt_preview: string;
    }>;
    duration_ms?: number;
    error?: string;
}
/** Span: 处置建议生成 */
export interface SpanAdvice {
    input_cls: string;
    alert_level: string;
    knowledge_refs_count: number;
    diagnosis_summary: string;
    reasoning_preview: string;
    /** 知识库原文引用(群聊后置收集透传,供详情页 retrieve 兜底展示) */
    knowledge_excerpt?: string[];
    duration_ms?: number;
    error?: string;
}
/** Span: 台账写入 */
export interface SpanLedger {
    target_table: string;
    operation: 'create' | 'update';
    record_id?: string;
    success?: boolean;
    message?: string;
    duration_ms?: number;
    error?: string;
}
/** Agent 决策链中的单次工具调用(会话事件 tool/call ↔ tool/result 配对) */
export interface AgentToolCall {
    tool: 'aquasense_analyze' | 'aquasense_advice' | 'aquasense_ledger';
    /** 会话事件 callId */
    call_id: string;
    /** 第几次尝试(1 起,>1 表示重试) */
    attempt: number;
    /** tool/call → tool/result 时间戳差(毫秒) */
    duration_ms: number;
    status: 'ok' | 'error';
    /** 失败原因码(如 ABORTED/超时) */
    error_code?: string;
    /** 工具 presentationMeta 透传的结构化摘要(供 UI 展示关键业务字段) */
    meta?: Record<string, unknown>;
}
/**
 * Agent 决策链(v1.8,仅群聊场景;由 session-trace-bridge 会话事件桥接采集)。
 * 记录 Agent 层的 turn/step 上下文与工具调用序列,支撑详情态
 * 「Agent 决策链」区块回放"AI 为什么这么分析"。
 */
export interface AgentTraceData {
    /** 会话 turn 序号 */
    turn: number;
    /** 会话 step 序号 */
    step: number;
    /** step 开始 → 首个工具调用(Agent 决策耗时,毫秒) */
    think_ms: number;
    calls: AgentToolCall[];
}
/** Span 名 → 数据类型 */
export interface SpanDataMap {
    upload: SpanUpload;
    analyze: SpanAnalyze;
    retrieve: SpanRetrieve;
    advice: SpanAdvice;
    ledger: SpanLedger;
}
export type SpanName = keyof SpanDataMap;
/** 单条分析记录(完整 Trace,存 reports/RPT-*.json) */
export interface AnalysisRecord {
    /** 报告唯一 ID,RPT-YYYYMMDD-HHmmss(同秒冲突时追加 -N) */
    id: string;
    /** 池号:池1/池2/池3/池4 */
    pool: string;
    /** 上报人飞书姓名 */
    reporter: string;
    /** 上报人 open_id */
    reporter_open_id: string;
    source: RecordSource;
    /** 任务描述(S9 提醒场景) */
    task?: string;
    /** 群 ID(关联 S9 提醒卡片) */
    chat_id?: string;
    /** 创建时间 ISO 8601 */
    created_at: string;
    /** 使用的视觉模型名 */
    model: string;
    /** 总耗时(各 Span 之和) */
    total_duration_ms: number;
    /** 总 Token 消耗(视觉模型) */
    total_tokens: number;
    /** 管线结果:success=完成 / error=中断(仍落盘便于排查) */
    status: 'success' | 'error';
    /** 中断原因(status=error 时) */
    error?: string;
    span_upload?: SpanUpload;
    span_analyze?: SpanAnalyze;
    span_retrieve?: SpanRetrieve;
    span_advice?: SpanAdvice;
    span_ledger?: SpanLedger;
    /** Agent 决策链(v1.8,仅群聊场景;会话事件桥接回填,缺失时前端隐藏区块) */
    agent?: AgentTraceData;
}
/** 索引摘要条目(存 index.json,供列表/趋势页轻量加载) */
export interface RecordSummary {
    id: string;
    pool: string;
    reporter: string;
    source: string;
    cls: string;
    confidence: number;
    symptoms: string[];
    alert_level?: string;
    created_at: string;
    total_duration_ms: number;
    total_tokens: number;
    /** 群聊 Agent 重试次数汇总(v1.8;agent 存在时写入,>0 时列表态显示 🔁 角标) */
    agent_retries?: number;
    /** 重试最多的工具名(供列表态角标文案) */
    agent_retry_tool?: string;
}
/** 分析记录索引 */
export interface AnalysisIndex {
    version: 1;
    records: RecordSummary[];
}
/** Tracer 构造参数 */
export interface TracerParams {
    pool: string;
    reporter: string;
    reporter_open_id: string;
    source: RecordSource;
    task?: string;
    chat_id?: string;
}
/**
 * 生成报告 ID:RPT-YYYYMMDD-HHmmss;同一秒内多次生成时追加 -N 序号防重名覆盖。
 * 导出供测试。
 */
export declare function generateReportId(now?: Date): string;
/** 重置 ID 序号(仅供测试) */
export declare function resetReportIdState(): void;
/** 模型原始输出截断长度(字符) */
export declare const MAX_OUTPUT_RAW = 500;
/**
 * 单条分析的 Span 数据收集器。
 * 生命周期与一次管线执行一致;flush() 落盘后不再复用。
 */
export declare class AnalysisTracer {
    private readonly record;
    private readonly spans;
    constructor(params: TracerParams);
    /** 报告 ID */
    get id(): string;
    /** 开始一个 Span(记录起始时刻) */
    startSpan(name: SpanName): void;
    /** 结束一个 Span(记录耗时并合并数据);未 startSpan 时忽略 */
    endSpan<K extends SpanName>(name: K, data: Partial<SpanDataMap[K]>): void;
    /**
     * 直接记录一个 Span 的数据(用于群聊后置收集:无实时耗时)。
     * durationMs 缺省时不写 duration_ms,前端展示为「—」。
     */
    recordSpan<K extends SpanName>(name: K, data: Partial<SpanDataMap[K]>, durationMs?: number): void;
    /** 设置 Trace 级别元信息(如 model / status / error) */
    setTraceMeta(meta: Partial<AnalysisRecord>): void;
    /** 汇总各 Span 耗时(缺失视为 0) */
    private sumSpanDurations;
    /** 汇总 Token 消耗(从各 Span 数据的 input/output_tokens 提取) */
    private sumTokens;
    /** 取某个 Span 的快照(数据 + duration_ms,数据在对象内部展开,与需求 §5.1 形态一致) */
    private snapshot;
    /**
     * 写入磁盘(管线执行完成后调用):汇总 → 写 RPT-*.json → 更新 index.json。
     * @returns 报告 ID
     */
    flush(): Promise<string>;
}
