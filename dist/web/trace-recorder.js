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
import { writeReport, updateIndex } from './trace-store.js';
import { getVisionModelConfig } from '../config/aqua-settings.js';
// ========== 工具函数 ==========
const pad2 = (n) => String(n).padStart(2, '0');
/** 同秒冲突序号(lastBase 记录上一次的秒级前缀) */
let lastBase = '';
let lastSeq = 0;
/**
 * 生成报告 ID:RPT-YYYYMMDD-HHmmss;同一秒内多次生成时追加 -N 序号防重名覆盖。
 * 导出供测试。
 */
export function generateReportId(now = new Date()) {
    const base = `RPT-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    if (base === lastBase) {
        lastSeq += 1;
    }
    else {
        lastBase = base;
        lastSeq = 0;
    }
    return lastSeq === 0 ? base : `${base}-${lastSeq}`;
}
/** 重置 ID 序号(仅供测试) */
export function resetReportIdState() {
    lastBase = '';
    lastSeq = 0;
}
/** 模型原始输出截断长度(字符) */
export const MAX_OUTPUT_RAW = 500;
// ========== Trace 记录器 ==========
/**
 * 单条分析的 Span 数据收集器。
 * 生命周期与一次管线执行一致;flush() 落盘后不再复用。
 */
export class AnalysisTracer {
    record;
    spans = new Map();
    constructor(params) {
        // 优先使用设置文件中的视觉模型配置,其次使用环境变量,最后使用默认值
        const visionConfig = getVisionModelConfig();
        const model = visionConfig?.modelName || process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash';
        this.record = {
            id: generateReportId(),
            pool: params.pool,
            reporter: params.reporter,
            reporter_open_id: params.reporter_open_id,
            source: params.source,
            task: params.task,
            chat_id: params.chat_id,
            created_at: new Date().toISOString(),
            model,
            total_duration_ms: 0,
            total_tokens: 0,
            status: 'success'
        };
    }
    /** 报告 ID */
    get id() {
        return this.record.id;
    }
    /** 开始一个 Span(记录起始时刻) */
    startSpan(name) {
        this.spans.set(name, { start: performance.now(), data: {} });
    }
    /** 结束一个 Span(记录耗时并合并数据);未 startSpan 时忽略 */
    endSpan(name, data) {
        const span = this.spans.get(name);
        if (!span)
            return;
        span.duration_ms = Math.round(performance.now() - span.start);
        span.data = { ...span.data, ...data };
    }
    /**
     * 直接记录一个 Span 的数据(用于群聊后置收集:无实时耗时)。
     * durationMs 缺省时不写 duration_ms,前端展示为「—」。
     */
    recordSpan(name, data, durationMs) {
        const state = { start: performance.now(), data: { ...data } };
        if (durationMs !== undefined)
            state.duration_ms = durationMs;
        this.spans.set(name, state);
    }
    /** 设置 Trace 级别元信息(如 model / status / error) */
    setTraceMeta(meta) {
        Object.assign(this.record, meta);
    }
    /** 汇总各 Span 耗时(缺失视为 0) */
    sumSpanDurations() {
        let total = 0;
        for (const span of this.spans.values()) {
            if (span.duration_ms !== undefined)
                total += span.duration_ms;
        }
        return total;
    }
    /** 汇总 Token 消耗(从各 Span 数据的 input/output_tokens 提取) */
    sumTokens() {
        let total = 0;
        for (const span of this.spans.values()) {
            const input = span.data.input_tokens;
            const output = span.data.output_tokens;
            if (typeof input === 'number')
                total += input;
            if (typeof output === 'number')
                total += output;
        }
        return total;
    }
    /** 取某个 Span 的快照(数据 + duration_ms,数据在对象内部展开,与需求 §5.1 形态一致) */
    snapshot(name) {
        const span = this.spans.get(name);
        if (!span)
            return undefined;
        const out = { ...span.data };
        if (span.duration_ms !== undefined)
            out.duration_ms = span.duration_ms;
        return out;
    }
    /**
     * 写入磁盘(管线执行完成后调用):汇总 → 写 RPT-*.json → 更新 index.json。
     * @returns 报告 ID
     */
    async flush() {
        this.record.total_duration_ms = this.sumSpanDurations();
        this.record.total_tokens = this.sumTokens();
        this.record.span_upload = this.snapshot('upload');
        this.record.span_analyze = this.snapshot('analyze');
        this.record.span_retrieve = this.snapshot('retrieve');
        this.record.span_advice = this.snapshot('advice');
        this.record.span_ledger = this.snapshot('ledger');
        await writeReport(this.record);
        await updateIndex(this.record);
        console.log(`[aquasense-trace] 分析记录已写入: ${this.record.id} (${this.record.pool}, ` +
            `${this.record.span_analyze?.cls ?? 'n/a'}, ${(this.record.total_duration_ms / 1000).toFixed(1)}s)`);
        return this.record.id;
    }
}
