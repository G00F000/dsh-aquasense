/**
 * R8 存储层(reports/ 目录 + index.json 读写,见 docs/r8-traceability-architecture.md §3.3)
 *
 * 磁盘布局($AQUASENSE_CACHE_DIR/reports/):
 *   index.json                轻量索引(摘要字段,倒序)
 *   RPT-20260917-100532.json  单条完整记录
 *
 * 容错(需求 §9):目录不存在自动创建;index.json 损坏时从 reports/ 扫描重建;
 * 单条记录损坏时读取返回 null(列表跳过,不阻断整体)。
 * 并发:索引更新经进程内串行队列,避免读-改-写竞争丢条目。
 */
import type { AnalysisIndex, AnalysisRecord, RecordSummary } from './trace-recorder.js';
/** 报告目录 */
export declare function reportsDir(): string;
/** 索引文件路径 */
export declare function indexFile(): string;
/** 写入单条完整记录(目录不存在时自动创建) */
export declare function writeReport(record: AnalysisRecord): Promise<void>;
/** 图片元数据(详情接口附加、前端渲染 <img> 用) */
export interface ReportImageMeta {
    /** 图片序号(0 起,与 <img> 接口路径对应) */
    index: number;
    fileName: string;
    mimeType: string;
    size: number;
}
/**
 * 将工人发送的图片(base64 data)按序落盘到 reports/images/<id>/。
 * 写入失败不阻断管线,由调用方捕获后仅告警。
 * @returns 已保存的图片元数据(按 index 升序)
 */
export declare function saveReportImages(id: string, images: Array<{
    data: string;
    mimeType: string;
}>): Promise<ReportImageMeta[]>;
/** 列出某条记录的已保存图片(不存在/为空返回 []) */
export declare function listReportImages(id: string): Promise<ReportImageMeta[]>;
/** 读取某条记录的第 index 张图片(不存在/越界返回 null) */
export declare function readReportImage(id: string, index: number): Promise<{
    buffer: Buffer;
    mimeType: string;
} | null>;
/** 删除某条记录的图片目录(随记录清理) */
export declare function removeReportImages(id: string): Promise<void>;
/** 摘要条目(从完整记录提取;索引与重建共用) */
export declare function toSummary(record: AnalysisRecord): RecordSummary;
/**
 * 更新索引(在头部插入新记录,保持按时间倒序)。
 * 同 ID 已存在时先移除旧条目再插入(重建/补录场景防重复)。
 */
export declare function updateIndex(record: AnalysisRecord): Promise<void>;
/**
 * 读取索引;文件不存在时返回空结构,解析失败/结构非法时自动重建(§4.5)。
 */
export declare function readIndex(): Promise<AnalysisIndex>;
/** 读取单条完整记录;不存在或损坏时返回 null */
export declare function readReport(id: string): Promise<AnalysisRecord | null>;
/** 从 reports/ 目录扫描全部记录并重建索引(按 created_at 倒序) */
export declare function rebuildIndex(): Promise<AnalysisIndex>;
/**
 * 清理超过保留期的旧记录(默认 90 天)并裁剪索引。
 * @returns 清理条数
 */
export declare function cleanupOldReports(daysToKeep?: number): Promise<number>;
/** 列表查询参数 */
export interface RecordQuery {
    pool?: string;
    cls?: string;
    /** 本地日期 YYYY-MM-DD(按记录 ID 的日期段匹配) */
    date?: string;
    limit?: number;
    offset?: number;
}
/** 列表查询结果 */
export interface RecordQueryResult {
    records: RecordSummary[];
    total: number;
    has_more: boolean;
}
/** 单页最大条数 */
export declare const MAX_PAGE_SIZE = 200;
/**
 * 索引查询:过滤(pool/cls/date) → 分页(limit/offset)。
 * date 按记录 ID 中的本地日期段匹配(RPT-YYYYMMDD-...)。
 */
export declare function queryIndex(query: RecordQuery): Promise<RecordQueryResult>;
/** 趋势统计结果(需求 §6.2 趋势查询响应) */
export interface TrendData {
    pool: string;
    days: number;
    total: number;
    distribution: {
        normal: number;
        early: number;
        disease: number;
        unknown: number;
    };
    top_symptoms: Array<{
        symptom: string;
        count: number;
    }>;
    recent_records: RecordSummary[];
}
/**
 * 池号趋势统计:近 N 天的状态分布 + 症状频次 + 最近 10 条摘要。
 */
export declare function computeTrend(pool: string, days: number): Promise<TrendData>;
