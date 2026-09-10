/**
 * 处置建议工具(aquasense_advice,场景 S2/S4/S5/S8 巡检诊断后调用)
 *
 * 自动查询 IMA 获取疾病诊疗参考,双通道合并:知识库名称检索 + 笔记正文检索(带高亮);
 * 有高亮的直接引用,其余读取命中条目正文(PDF/笔记)摘取原文片段,
 * 按「原文引用→逻辑推理→总结」输出分级处置建议。
 * 容错原则:知识库不可用不阻断主流程,降级为内置通用建议模板。
 */
export declare const generateAdvice: import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * 从正文中定位与症状最相关的片段:
 * 按句切分 → 命中关键词最多的句子取前后各一句作上下文 → 限长截断;
 * 无关键词命中时退化为正文开头。导出供测试。
 */
export declare function extractRelevantSnippet(content: string, keywords: string[]): string;
