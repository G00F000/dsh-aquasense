/**
 * 处置建议工具(aquasense_advice,场景 S2/S4/S5/S8 巡检诊断后调用)
 *
 * 自动查询 IMA 获取疾病诊疗参考,三通道合并(见 ima-api.searchKnowledgeMerged):
 * 笔记正文检索(带高亮)+ 本地 PDF 原文检索 + 知识库名称检索;
 * 有高亮的直接引用,其余读取命中条目正文(PDF/笔记)摘取原文片段,
 * 引用格式《标题》[定位]:「摘录」,定位(如 PDF 页码)可定位时透出,供审计溯源到页;
 * 按「原文引用→逻辑推理→总结」输出分级处置建议。
 * 容错原则:知识库不可用不阻断主流程,降级为内置通用建议模板。
 */
import { type SearchResult } from '../ima/ima-api.js';
export interface AnalysisInput {
    abnormal?: boolean;
    cls?: string;
    symptoms?: string[];
    severity?: string;
}
/** 引用摘录:正文片段 + 定位信息(如 "第56页";PDF 命中且缓存含分页符时才有,无则不臆造) */
export interface Excerpt {
    title: string;
    text: string;
    from?: string;
    locator?: string;
}
/** 处置建议产出(与工具 output.schema 一致) */
export interface AdviceResult {
    diagnosis_summary: string;
    immediate_actions: string[];
    follow_up_actions: string[];
    medication: string;
    alert_level: 'P0' | 'P1' | 'P2';
    knowledge_refs: string[];
    knowledge_excerpt: string[];
    reasoning: string;
}
/** 工具最终产出(AdviceResult + 检索元数据):让检索数据走出工具边界,供 R8 埋点与桥接层合成 span_retrieve */
export interface AdviceToolOutput extends AdviceResult {
    /** 知识库查询词 */
    query: string;
    /** 三通道合并后命中数(按 item.from 归属计数,与 R8 span_retrieve 语义一致) */
    channel_a_wiki: number;
    channel_b_note: number;
    channel_c_pdf: number;
    /** 合并去重后条目总数 */
    merged_count: number;
    /** 检索原文摘录结构化数据(比 knowledge_excerpt 字符串多保留通道归属 from,供审计埋点) */
    retrieve_excerpts: Excerpt[];
}
/** 知识检索结果(retrieve 步骤产出:查询词 + 三通道命中 + 原文摘录) */
export interface KnowledgeRetrieval {
    query: string;
    knowledge: SearchResult | null;
    excerpts: Excerpt[];
}
export declare const generateAdvice: import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * 组装工具最终产出:处置建议 + 检索元数据(让检索数据走出工具边界,供埋点/桥接层合成 span_retrieve)。
 * 导出供测试(纯函数,不依赖 IMA 网络)。
 */
export declare function buildAdviceToolOutput(retrieval: KnowledgeRetrieval, advice: AdviceResult): AdviceToolOutput;
/**
 * 步骤 1-2:查询 IMA 知识库(三通道合并)并读取命中条目正文摘取原文片段。
 * 导出供 R8 H5 管线分段埋点(retrieve span)复用;任何失败降级不抛异常。
 */
export declare function retrieveKnowledge(analysis: AnalysisInput): Promise<KnowledgeRetrieval>;
/**
 * 步骤 3-5:根据严重程度生成分级处置建议(用药建议 + 预警级别)。
 * 导出供 R8 H5 管线分段埋点(advice span)复用;knowledge/excerpts 来自 retrieveKnowledge。
 */
export declare function generateAdviceInternal(analysis: AnalysisInput, knowledge: SearchResult | null, excerpts: Excerpt[]): Promise<AdviceResult>;
/**
 * 从正文中定位与症状最相关的片段:
 * 按句切分 → 命中关键词最多的句子取前后各一句作上下文 → 限长截断;
 * 无关键词命中时退化为正文开头。导出供测试。
 */
export declare function extractRelevantSnippet(content: string, keywords: string[]): string;
