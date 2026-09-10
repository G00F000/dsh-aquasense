/**
 * IMA API 封装模块
 * 封装 IMA 知识库查询接口,供 generate-advice(处置建议内置查询)与 daily-reminder(S9 手册读取)调用。
 */
export interface KnowledgeItem {
    media_id: string;
    title: string;
    summary?: string;
    source?: string;
}
export interface SearchResult {
    items: KnowledgeItem[];
    total: number;
}
/**
 * 搜索知识库:自动定位"水产养殖"知识库后执行关键词搜索
 */
export declare function searchKnowledge(query: string, kbId?: string): Promise<SearchResult>;
/**
 * 获取媒体详情(原始返回值)
 */
export declare function getMediaInfo(mediaId: string): Promise<any>;
/**
 * 获取媒体正文文本(如《每日操作手册》条目内容)
 */
export declare function getMediaContent(mediaId: string): Promise<string>;
