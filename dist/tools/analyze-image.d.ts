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
    /** 实际分析的图片数量(由调用方设置,解析函数不填充) */
    image_count?: number;
    /** 解剖场景下可见的器官列表(仅 scene_hint=dissection 时填充;枚举与 record-ledger DISSECTION_ORGAN_OPTIONS 一致) */
    organs?: string[];
    /** 工人发送的图片总数(由调用方通过 expected_image_count 传入,用于检测丢失) */
    expected_image_count?: number;
    /** 数据完整性标记:图片齐全时为 'complete',有图片丢失时标注丢失详情 */
    data_completeness?: 'complete' | 'partial' | 'empty';
}
export declare const analyzeImage: import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * 下载图片为 base64(仅用于 HTTP URL 场景)
 * 导出供 R8 H5 管线复用(构造视觉模型输入)
 */
export interface ImageDownloadResult {
    data: string;
    mimeType: string;
}
/** 视觉模型 Token 用量(OpenAI 兼容 usage 字段) */
export interface VisionModelUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
}
/** 视觉模型返回(文本 + Token 用量,R8 trace 埋点用) */
export interface VisionModelResult {
    content: string;
    usage: VisionModelUsage;
}
/**
 * 构建视觉分析提示词
 * 关键安全原则:工人描述(description)绝不进入此 prompt,只用于意图路由。
 * 视觉模型的 cls/severity/symptoms 必须完全基于图片像素判断,防止描述注入。
 */
export declare function buildPrompt(poolId?: string): string;
/**
 * 调用 DeepSeek 视觉模型,返回文本与 Token 用量(R8 H5 管线埋点需要 usage;
 * callVisionModel 为其薄包装,行为不变)。
 */
export declare function callVisionModelWithUsage(images: ImageDownloadResult[], prompt: string): Promise<VisionModelResult>;
/**
 * 解析模型输出 JSON(容错:提取首个 JSON 对象并按白名单归一,失败降级 unknown)
 * 归一化保证输出始终满足 output.schema(enum/类型/多余键),避免注册表校验失败
 */
export declare function parseAnalysisResponse(response: string): AnalysisResult;
