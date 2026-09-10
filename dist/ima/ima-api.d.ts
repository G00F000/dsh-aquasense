/**
 * IMA API 封装模块
 * 封装 IMA 知识库查询接口,供 generate-advice(处置建议内置查询)与 daily-reminder(S9 手册读取)调用。
 *
 * 正文层:
 *  - PDF(media_type=1):经 get_media_info 的 url_info 下载,用 unpdf(pdf.js)提取文本层并按 media_id 缓存;
 *    扫描件(无文本层)留标记,待 OCR 兜底。
 *  - 笔记(media_type=11):经 notebook_ext_info.notebook_id 调 notes 接口读纯文本并按 media_id 缓存;
 *    权限类确定性失败留标记,临时失败(频控/网络)不缓存、下次重试。
 *  - 其他类型:沿用字段提取与占位标记(见 extractMediaText)。
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
 * 定位知识库 ID:按名称搜索"水产养殖"知识库并取第一个匹配项
 * (searchKnowledge 与批量预热脚本共用)
 */
export declare function resolveKnowledgeBaseId(query?: string): Promise<string | null>;
/**
 * 搜索知识库:自动定位"水产养殖"知识库后执行关键词搜索
 */
export declare function searchKnowledge(query: string, kbId?: string): Promise<SearchResult>;
/** 知识库列表条目(文件夹或文件) */
export interface KnowledgeListItem {
    kind: 'folder' | 'file';
    title: string;
    /** kind='file' 时存在 */
    mediaId?: string;
    /** kind='folder' 时存在 */
    folderId?: string;
}
/**
 * 浏览知识库内容(单页):供批量预热/巡检脚本逐级遍历使用
 * 文件夹条目含 folder_id,文件条目含 media_id;cursor 首次传空字符串
 */
export declare function listKnowledge(kbId: string, cursor?: string, folderId?: string, limit?: number): Promise<{
    items: KnowledgeListItem[];
    nextCursor: string;
    isEnd: boolean;
}>;
/**
 * 获取媒体详情(原始返回值)
 */
export declare function getMediaInfo(mediaId: string): Promise<any>;
/**
 * 获取媒体正文文本(如《每日操作手册》条目内容)
 * PDF(media_type=1)走"下载 + unpdf 解析 + 缓存",笔记(media_type=11)走 notes 接口读取+缓存;其余类型沿用字段提取。
 */
export declare function getMediaContent(mediaId: string): Promise<string>;
