/**
 * 图片分析工具(aquasense_analyze,场景 S1/S2/S4/S5/S8 共用)
 *
 * 调用 DeepSeek 视觉模型分析鲈鱼养殖现场照片:
 *  - 判断状态 normal(正常)/ early(前兆)/ disease(发病)
 *  - 提取症状、严重程度、置信度
 * 结果喂给 generate-advice(处置建议)与 record-ledger(台账)。
 */
export type SceneHint = 'inspection' | 'death' | 'water_quality' | 'medication' | 'feeding' | 'temperature' | 'dissection';
/** 模型输出 JSON 契约(与技术方案 YOLO 三分类语义一致) */
export interface AnalysisResult {
    abnormal: boolean;
    cls: 'normal' | 'early' | 'disease' | 'unknown';
    symptoms: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    /** 图片场景提示:视觉模型判断该图属于哪类业务场景,供意图路由补充文字缺失时的分类 */
    scene_hint: SceneHint;
}
export declare const analyzeImage: import("@deepseek-ai/dsh-tools").ToolDefinition;
