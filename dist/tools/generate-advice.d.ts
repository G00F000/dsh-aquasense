/**
 * 处置建议工具(aquasense_advice,场景 S2/S4/S5/S8 巡检诊断后调用)
 *
 * 自动查询 IMA 知识库获取疾病诊疗参考,按严重程度分级生成处置建议。
 * 容错原则:知识库不可用不阻断主流程,降级为内置通用建议模板。
 */
export declare const generateAdvice: import("@deepseek-ai/dsh-tools").ToolDefinition;
