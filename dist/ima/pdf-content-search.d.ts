/**
 * PDF 原文检索模块(方案 D 通道 C)
 *
 * 在 warm-kb-cache 预热的 cache/pdf/*.txt 上构建切片索引,运行时以关键词扫描返回 PDF 原文片段。
 * 与 IMA 检索通道互补:wiki 仅索引文件名、note 索引 AI 二次汇总;
 * 本模块直接检索 PDF 原文(一手文献),命中处带章节/页码定位。
 *
 * 为什么不做倒排索引(与 docs/pdf-search-channel-architecture.md 设计稿的偏差,实测为准):
 *  - 实测当前语料(61 份有效 PDF,313 万字,6145 切片)按 2/3-gram 建倒排,唯一词项 50 万+,
 *    index.json 估算 51MB(设计稿预估 500KB 的百倍),加载后的 Map 结构与 4G 服务器内存预算不匹配;
 *  - chunks.json 仅 3.3MB,查询侧逐切片扫描为毫秒级,命中结果与倒排完全等价(同一词元生成逻辑);
 *  - 与 docs/ima-pdf-note-limitation.md §7.2 结论一致(该规模下倒排索引投入产出比不高)。
 *
 * 缓存格式与页码:
 *  - 分页符(\f):OCR/逐页提取写入的缓存用它分隔页,页码可取(1-based);
 *  - 实测 unpdf(mergePages: true) 输出的原生 PDF 文本只用 \n 拼接页,无页边界信息,
 *    此时按连续空行切段且页码记 null——不臆造页码(展示层自动省略)。
 */
import type { KnowledgeItem } from './ima-api.js';
/** 切片(Chunk) */
export interface PdfChunk {
    /** 所属 PDF 的 IMA media_id */
    mediaId: string;
    /** PDF 标题(知识库书名;预热脚本提供,缺省从文本头部提取) */
    title: string;
    /** 页码(1-based):缓存含分页符时可用;合并文本无页边界时为 null */
    page: number | null;
    /** 所属章节(正则检测并向后继承,可为 null) */
    chapter: string | null;
    /** 切片文本内容 */
    text: string;
    /** 切片在 PDF 全文中的起始字符偏移(近似:不计块间分隔符;用于重叠切片去重) */
    offset: number;
    /** 切片在 chunks.json 中的索引位置 */
    index: number;
}
/** 索引元数据(index.json 持久化) */
export interface PdfIndexMeta {
    builtAt: string;
    totalChunks: number;
    pdfCount: number;
    pdfs: Array<{
        mediaId: string;
        title: string;
        chunkCount: number;
        /** 页数:缓存含分页符时可用,否则 null */
        pageCount: number | null;
    }>;
    config: {
        chunkSize: number;
        chunkOverlap: number;
    };
}
/** 检索结果 */
export interface PdfSearchHit {
    mediaId: string;
    title: string;
    text: string;
    page: number | null;
    chapter: string | null;
    score: number;
    matchedTerms: string[];
    from: 'pdf_content';
}
/** buildPdfIndex 可选参数 */
export interface BuildPdfIndexOptions {
    /** mediaId → 书名(来自知识库条目列表);缺省时从缓存文本头部提取 */
    titles?: Record<string, string>;
}
/** 索引有效期(7 天):超期告警并触发 kb:warm 重建;过期不影响查询 */
export declare const INDEX_MAX_AGE_MS: number;
/** 索引格式版本:结构变化时递增,旧版本索引视为不可用(由 kb:warm 重建) */
export declare const PDF_INDEX_FORMAT_VERSION = 1;
/**
 * OCR 文本头标记:生产端(scripts/ocr-scanned-pdfs.ts)覆写缓存时写入的文件头。
 * 导出供生产端复用同一字面量——两边分头维护标记必然漂移(曾从 dist 反推正则才知道要写什么头)。
 */
export declare const OCR_MARK = "[OCR \u6279\u5904\u7406]";
/**
 * 从 cache/pdf/*.txt 构建切片索引(chunks.json + index.json)
 * @param cachePdfDir PDF 文本缓存目录(如 /data/aquasense/cache/pdf)
 * @param indexDir   索引输出目录(如 /data/aquasense/cache/pdf-index)
 * @param options    titles:mediaId → 书名映射(预热脚本提供,优先于文本提取)
 */
export declare function buildPdfIndex(cachePdfDir: string, indexDir: string, options?: BuildPdfIndexOptions): Promise<PdfIndexMeta>;
/**
 * OCR 文本归一化:剥离文件头 OCR 标记,去除汉字间空格
 * Tesseract chi_sim 输出"流 行 性"形态,不去空格则子串/词元匹配全部失效;
 * 用 lookbehind/lookahead 一次性处理任意长度空格序列(两轮 replace 对长间隔不彻底)。
 * 导出供生产端在发布缓存前调用(入库前去空格),与索引层共用同一实现;重复调用幂等。
 */
export declare function normalizeOcrText(text: string): string;
/**
 * 在 PDF 原文中检索关键词,返回带页码/章节的命中切片
 * @param query 用户查询(如 "白点 小瓜虫 治疗")
 * @param indexDir 索引目录
 */
export declare function searchPdfContent(query: string, indexDir: string): PdfSearchHit[];
/** 检查索引是否可用:文件存在且未过期(过期仅告警不阻断,由 kb:warm 重建) */
export declare function isPdfIndexReady(indexDir: string): boolean;
/** 获取索引元数据(不加载完整索引) */
export declare function getPdfIndexMeta(indexDir: string): PdfIndexMeta | null;
/**
 * 将 PDF 检索结果转换为 KnowledgeItem
 * highlight 用 <em> 标记命中词(与 note 通道格式一致,展示前由 cleanHighlight 统一剥离)
 */
export declare function pdfHitToKnowledgeItem(hit: PdfSearchHit): KnowledgeItem;
