#!/usr/bin/env node
/**
 * 扫描件 PDF OCR 离线批处理(OCR 兜底的生产端)
 *
 * 背景:kb:warm 预热时对无文本层的 PDF 写入 `[扫描件 PDF:...]` 标记并提示"需 OCR 兜底";
 * 本脚本以这些标记为待办,用 unpdf 渲染页图 + tesseract.js 逐页 OCR,完成后覆写同名缓存,
 * 通道 C(PDF 原文检索)与运行时正文读取即可拿到 OCR 内容(配合 kb:warm 重建索引)。
 *
 * 与 pdf-content-search.ts 的缓存契约(常量与归一化实现均从该模块导入,勿单方面修改):
 *  - 文件头写 OCR_MARK(`[OCR 批处理]` + 元信息写进方括号内,归一化时整段剥离,不污染正文);
 *  - 页间以 \f 分隔(索引按页切块,引用可回带 1-based 页码);
 *  - 发布前去汉字间空格(chi_sim 逐字插空格,不去则子串/词元检索命中 0,实测 0/8 → 8/8);
 *  - 只有整本 OCR 完成才原子覆写 cache/pdf/<media_id>.txt;--pages 冒烟只写 checkpoint 不发布。
 *
 * 断点续跑:checkpoint 逐页落盘在 <缓存根>/ocr/<media_id>/page-NNNN.txt,中断后重跑自动跳过
 * 已完成页;PDF 内容(sha256)/页数/lang/psm/scale 任一变化则旧 checkpoint 自动作废重跑。
 *
 * 运行前提与耗时:先跑 npm run kb:warm(产生扫描件标记与书名索引);
 * 实测约 4.6s/页(scale=4 + chi_sim + psm=6),12 本扫描件 2,572 页约 3.3 小时(CPU 单线程)。
 * 依赖与语言包安装方式见 --help 与 docs/deployment.md。
 *
 * 启动方式:
 *   npm run ocr                    # 处理全部待 OCR 扫描件,完成后自动重建索引(--no-warm 可关)
 *   npm run ocr -- --pages 2       # 冒烟:每本只 OCR 前 2 页,校验语言包与识别质量(不覆写缓存)
 *   npm run ocr -- --only 鱼病     # 只处理 mediaId/书名包含"鱼病"的扫描件
 *   npm run ocr -- --help          # 完整参数与依赖/语言包说明
 */
/** 语言包版本目录:tessdata best_int(LSTM-only);标准 4.0.0 包与 tesseract.js-core 7 不兼容(API version 不匹配) */
export declare const LANG_PACK_DIR = "4.0.0_best_int";
export interface OcrOptions {
    /** 最多处理的扫描件本数(默认全部) */
    limit: number;
    /** 只处理 mediaId/书名包含该关键字的扫描件 */
    only: string | null;
    /** 冒烟模式:每本只 OCR 前 N 页,不覆写正式缓存(校验语言包与识别质量) */
    smokePages: number | null;
    /** 页面渲染缩放 */
    scale: number;
    /** OCR 语言 */
    lang: string;
    /** 语言包目录或 URL(null = 自动探测/默认 CDN) */
    langPath: string | null;
    /** 页面分割模式 */
    psm: string;
    /** OCR 完成后是否自动重建索引(默认开启:缓存已变,通道 C 需要新索引才生效) */
    warm: boolean;
    help: boolean;
}
/** 解析命令行参数(支持 `--key value` 与 `--key=value`;未知参数直接报错,避免拼错静默) */
export declare function parseOcrArgs(argv: string[]): OcrOptions;
export interface ScannedTarget {
    mediaId: string;
    /** 状态标记原文(如 `[扫描件 PDF:共 187 页,无文本层,需 OCR 兜底]`),日志用 */
    markText: string;
}
/** 扫描缓存目录,收集待 OCR 的扫描件(仅认 `[扫描件` 标记;已 OCR 覆写/超限/正文缓存自动排除) */
export declare function readScannedTargets(cachePdfDir: string): ScannedTarget[];
export interface OcrCheckpointState {
    mediaId: string;
    title: string;
    sourceBytes: number;
    sourceSha256: string;
    pageCount: number;
    lang: string;
    psm: string;
    scale: number;
    createdAt: string;
    updatedAt: string;
    publishedAt: string | null;
}
interface CheckpointParams {
    sourceSha256: string;
    pageCount: number;
    lang: string;
    psm: string;
    scale: number;
}
/** checkpoint 是否与本次输入/参数一致(PDF 内容、页数、lang/psm/scale 任一变化都作废重跑) */
export declare function checkpointMatches(state: OcrCheckpointState | null, params: CheckpointParams): boolean;
/**
 * 缓存文件头:元信息写在方括号内,消费端归一化正则整段剥离,不污染正文;同时供人工排查格式与版本。
 * 标记本体取自 OCR_MARK(去掉右括号后拼元信息),生产端与检测端共用同一字面量。
 */
export declare function buildOcrHeader(meta: {
    lang: string;
    psm: string;
    scale: number;
    pageCount: number;
    ocrAt: string;
}): string;
/**
 * 组装发布文本:头标记 + 去字间空格后的各页(页间 \f 分页,索引按页切块、引用回带 1-based 页码)。
 * 空白页保留占位:不产生切片,但维持 \f 分块数与页数一致(否则后续页的引用页码整体前移)。
 */
export declare function buildPublishText(pages: string[], header: string): string;
/** 发布条件:非冒烟模式且整本页齐(--pages 冒烟只作校验,不得覆写正式缓存) */
export declare function canPublish(pageCount: number, completedPages: number, smokePages: number | null): boolean;
interface LangPathInfo {
    /** 传给 tesseract.js 的 langPath(null = 使用 tesseract.js 默认 CDN) */
    value: string | null;
    /** 来源说明(日志用) */
    source: string;
}
/** 语言包解析优先级:--lang-path → AQUASENSE_OCR_LANG_PATH → 本机 npm 包 → tesseract.js 默认 CDN */
export declare function resolveLangPath(options: OcrOptions): LangPathInfo;
export {};
