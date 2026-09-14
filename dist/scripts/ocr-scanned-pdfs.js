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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { getMediaInfo, resolveCacheRoot } from '../ima/ima-api.js';
import { OCR_MARK, getPdfIndexMeta, normalizeOcrText } from '../ima/pdf-content-search.js';
// ========== 常量与配置 ==========
/** 单文件大小上限(与 ima-api.ts 的 MAX_PDF_BYTES 一致;扫描件不会超限,此处为防御性校验) */
const MAX_PDF_BYTES = 100 * 1024 * 1024;
/** 默认渲染缩放:实测 scale=2 中文识别率仅约 50%,scale=4 为验证过的稳定值 */
const DEFAULT_SCALE = 4;
/** 默认页面分割模式:SINGLE_BLOCK(6),整页正文按块识别,适配书籍扫描页 */
const DEFAULT_PSM = '6';
/** 默认 OCR 语言:简体中文 */
const DEFAULT_LANG = 'chi_sim';
/** 语言包版本目录:tessdata best_int(LSTM-only);标准 4.0.0 包与 tesseract.js-core 7 不兼容(API version 不匹配) */
export const LANG_PACK_DIR = '4.0.0_best_int';
/** 语言包默认 CDN(与 tesseract.js 内部默认一致;内网通常不可达,可用 --lang-path 指本地) */
const LANG_CDN_PREFIX = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
/** 扫描件状态标记前缀(ima-api.ts 写入 cache/pdf/<media_id>.txt,即本脚本的待办来源) */
const SCANNED_MARK_PREFIX = '[扫描件';
/** checkpoint 子目录(resolveCacheRoot() 下,与 pdf/note 并列) */
const CHECKPOINT_SUBDIR = 'ocr';
/** 页文件名:page-0001.txt(1-based,与索引页码语义一致) */
const PAGE_FILE_PREFIX = 'page-';
/** 空白页占位:短于消费端切片下限(50 字)不产生切片,但保证 \f 分块数=页数(引用页码不错位) */
const BLANK_PAGE_PLACEHOLDER = '（本页无文字）';
/** unpdf 渲染页图所需画布(可选依赖;用变量名动态 import,未安装时不阻塞类型检查) */
const CANVAS_MODULE = '@napi-rs/canvas';
/** OCR 引擎(可选依赖;同上用变量名动态 import,未安装时由 loadTesseract 给出安装提示) */
const TESSERACT_MODULE = 'tesseract.js';
const DOWNLOAD_ATTEMPTS = 3;
const RECOGNIZE_ATTEMPTS = 2;
const RETRY_SLEEP_MS = 2000;
const OCR_DEPS_HINT = [
    '[ocr] 安装 OCR 可选依赖(已声明在 package.json 的 optionalDependencies,随 npm install 自动拉取):',
    '[ocr]   npm install                            # 重新安装即可',
    '[ocr]   npm i tesseract.js @napi-rs/canvas      # 手动补装(OCR 引擎与页图渲染)',
    `[ocr]   npm i @tesseract.js-data/${DEFAULT_LANG}                    # 内网/离线:随包附带中文语言包(不走 CDN)`,
    '[ocr] 说明:依赖保持可选,核心运行不依赖 tesseract;语言包需 4.0.0_best_int 版本,详见 --help'
].join('\n');
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 解析命令行参数(支持 `--key value` 与 `--key=value`;未知参数直接报错,避免拼错静默) */
export function parseOcrArgs(argv) {
    const options = {
        limit: Number.POSITIVE_INFINITY,
        only: null,
        smokePages: null,
        scale: DEFAULT_SCALE,
        lang: DEFAULT_LANG,
        langPath: null,
        psm: DEFAULT_PSM,
        warm: true,
        help: false
    };
    for (let i = 0; i < argv.length; i++) {
        const raw = argv[i];
        const eq = raw.indexOf('=');
        const flag = eq >= 0 ? raw.slice(0, eq) : raw;
        const inlineValue = eq >= 0 ? raw.slice(eq + 1) : null;
        const takeValue = () => {
            if (inlineValue !== null)
                return inlineValue;
            i += 1;
            return argv[i] ?? '';
        };
        const takeNumber = () => {
            const value = Number(takeValue());
            return Number.isFinite(value) && value > 0 ? value : null;
        };
        switch (flag) {
            case '--help':
            case '-h':
                options.help = true;
                break;
            case '--limit': {
                const value = takeNumber();
                options.limit = value === null ? Number.POSITIVE_INFINITY : Math.floor(value);
                break;
            }
            case '--only':
                options.only = takeValue().trim() || null;
                break;
            case '--pages': {
                const value = takeNumber();
                options.smokePages = value === null ? null : Math.floor(value);
                break;
            }
            case '--scale': {
                const value = takeNumber();
                if (value !== null)
                    options.scale = value;
                break;
            }
            case '--lang':
                options.lang = takeValue().trim() || DEFAULT_LANG;
                break;
            case '--lang-path':
                options.langPath = takeValue().trim() || null;
                break;
            case '--psm':
                options.psm = takeValue().trim() || DEFAULT_PSM;
                break;
            case '--no-warm':
                options.warm = false;
                break;
            default:
                throw new Error(`未知参数 ${raw}(npm run ocr -- --help 查看用法)`);
        }
    }
    return options;
}
function printHelp() {
    console.log([
        '扫描件 PDF OCR 离线批处理(生产端)',
        '',
        '用法: npm run ocr [-- 选项]',
        '',
        '选项:',
        '  --limit N          最多处理 N 本(默认全部)',
        '  --only 关键字      只处理 mediaId/书名包含该关键字的扫描件',
        '  --pages N          冒烟模式:每本只 OCR 前 N 页,校验语言包与识别质量(不覆写正式缓存)',
        `  --scale N          页面渲染缩放(默认 ${DEFAULT_SCALE};实测 scale=2 中文识别率约 50%,不建议降低)`,
        `  --lang 代码        OCR 语言(默认 ${DEFAULT_LANG})`,
        '  --lang-path 路径   语言包目录或 URL(默认自动探测本机 npm 语言包,其次官方 CDN)',
        `  --psm 模式         页面分割模式(默认 ${DEFAULT_PSM}/SINGLE_BLOCK)`,
        '  --no-warm          完成后不自动重建索引(默认完成后执行 npm run kb:warm)',
        '  --help             显示本帮助',
        '',
        '依赖(可选;已声明在 optionalDependencies,随 npm install 自动拉取,缺失时本脚本不可用):',
        `  npm i tesseract.js @napi-rs/canvas           # 手动补装:引擎与页图渲染(${CANVAS_MODULE})`,
        '',
        `语言包(${DEFAULT_LANG},${LANG_PACK_DIR} 版本;标准 4.0.0 包与 tesseract.js-core 7 不兼容):`,
        `  a) 离线推荐:npm i @tesseract.js-data/${DEFAULT_LANG}   # 自动探测,无需 --lang-path`,
        '  b) 自备目录:npm run ocr -- --lang-path /path/to/tessdata  # 放 tessdata_best 的 chi_sim.traineddata',
        `  c) 默认 CDN:${LANG_CDN_PREFIX}/${DEFAULT_LANG}/${LANG_PACK_DIR}(内网通常不可达)`,
        '  也可用环境变量 AQUASENSE_OCR_LANG_PATH 指定,优先级低于 --lang-path',
        '',
        '缓存与断点:',
        '  checkpoint  <缓存根>/ocr/<media_id>/page-0001.txt 逐页落盘,中断后重跑自动续跑',
        '  正式缓存    <缓存根>/pdf/<media_id>.txt 只有整本 OCR 完成才原子覆写(冒烟模式不覆写)',
        '  说明        >100MB 的超限 PDF 不在本脚本范围(参见 docs/ima-pdf-note-limitation.md)'
    ].join('\n'));
}
/** 读取文件头部若干字节(判定状态标记无需读全文;OCR 后的缓存可达数 MB) */
function readHead(path, bytes) {
    const fd = openSync(path, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const read = readSync(fd, buffer, 0, bytes, 0);
        return buffer.subarray(0, read).toString('utf8');
    }
    finally {
        closeSync(fd);
    }
}
/** 扫描缓存目录,收集待 OCR 的扫描件(仅认 `[扫描件` 标记;已 OCR 覆写/超限/正文缓存自动排除) */
export function readScannedTargets(cachePdfDir) {
    const targets = [];
    for (const filename of readdirSync(cachePdfDir).sort()) {
        if (!filename.endsWith('.txt'))
            continue;
        const head = readHead(join(cachePdfDir, filename), 256);
        if (!head.startsWith(SCANNED_MARK_PREFIX))
            continue;
        targets.push({ mediaId: filename.slice(0, -4), markText: head.split('\n')[0] });
    }
    return targets;
}
/** 从既有索引读取 mediaId → 书名(kb:warm 构建;索引缺失时日志退回 mediaId,不额外调用 IMA 接口) */
function loadTitleMap(cacheRoot) {
    const titles = {};
    const meta = getPdfIndexMeta(join(cacheRoot, 'pdf-index'));
    for (const pdf of meta?.pdfs ?? []) {
        if (pdf.title)
            titles[pdf.mediaId] = pdf.title;
    }
    return titles;
}
function stateFilePath(dir) {
    return join(dir, 'state.json');
}
function pageFileName(pageNo) {
    return `${PAGE_FILE_PREFIX}${String(pageNo).padStart(4, '0')}.txt`;
}
function loadState(dir) {
    try {
        return JSON.parse(readFileSync(stateFilePath(dir), 'utf8'));
    }
    catch {
        return null;
    }
}
function saveState(dir, state) {
    state.updatedAt = new Date().toISOString();
    writeFileSync(stateFilePath(dir), JSON.stringify(state, null, 2), 'utf8');
}
/** checkpoint 是否与本次输入/参数一致(PDF 内容、页数、lang/psm/scale 任一变化都作废重跑) */
export function checkpointMatches(state, params) {
    if (!state)
        return false;
    return (state.sourceSha256 === params.sourceSha256 &&
        state.pageCount === params.pageCount &&
        state.lang === params.lang &&
        state.psm === params.psm &&
        state.scale === params.scale);
}
/** 准备 checkpoint 目录:参数不一致时作废旧页(逐页产物的正确性以本次输入为准) */
function prepareCheckpoint(dir, target, title, sourceBytes, params) {
    const existing = loadState(dir);
    if (checkpointMatches(existing, params))
        return existing;
    if (existing) {
        console.warn(`[ocr] ${target.mediaId} checkpoint 与本次输入不一致(PDF 内容/页数/参数已变),作废重跑`);
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const state = {
        mediaId: target.mediaId,
        title,
        sourceBytes,
        sourceSha256: params.sourceSha256,
        pageCount: params.pageCount,
        lang: params.lang,
        psm: params.psm,
        scale: params.scale,
        createdAt: now,
        updatedAt: now,
        publishedAt: null
    };
    saveState(dir, state);
    return state;
}
/** 已完成页数(仅统计存在且非空名的页文件;空页也写文件,存在即已完成) */
function countCompletedPages(dir, pageCount) {
    let count = 0;
    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
        if (existsSync(join(dir, pageFileName(pageNo))))
            count++;
    }
    return count;
}
function readAllPages(dir, pageCount) {
    const pages = [];
    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
        pages.push(readFileSync(join(dir, pageFileName(pageNo)), 'utf8'));
    }
    return pages;
}
/** 原子写:先写同目录临时文件再 rename,避免"半截文件"被当成有效页/有效缓存 */
function writeAtomic(path, text) {
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, text, 'utf8');
    try {
        renameSync(tmpPath, path);
    }
    catch (error) {
        rmSync(tmpPath, { force: true });
        throw error;
    }
}
// ========== 发布文本组装(导出供测试) ==========
/**
 * 缓存文件头:元信息写在方括号内,消费端归一化正则整段剥离,不污染正文;同时供人工排查格式与版本。
 * 标记本体取自 OCR_MARK(去掉右括号后拼元信息),生产端与检测端共用同一字面量。
 */
export function buildOcrHeader(meta) {
    return `${OCR_MARK.slice(0, -1)} lang=${meta.lang} psm=${meta.psm} scale=${meta.scale} pages=${meta.pageCount} ocrAt=${meta.ocrAt}]`;
}
/**
 * 组装发布文本:头标记 + 去字间空格后的各页(页间 \f 分页,索引按页切块、引用回带 1-based 页码)。
 * 空白页保留占位:不产生切片,但维持 \f 分块数与页数一致(否则后续页的引用页码整体前移)。
 */
export function buildPublishText(pages, header) {
    const parts = pages.map((page) => {
        const normalized = normalizeOcrText(page).trim();
        return normalized.length > 0 ? normalized : BLANK_PAGE_PLACEHOLDER;
    });
    return `${header}\n\n${parts.join('\n\f\n')}\n`;
}
/** 发布条件:非冒烟模式且整本页齐(--pages 冒烟只作校验,不得覆写正式缓存) */
export function canPublish(pageCount, completedPages, smokePages) {
    if (smokePages !== null)
        return false;
    return pageCount > 0 && completedPages >= pageCount;
}
/** 本地路径转绝对(URL 原样);相对路径按当前 CWD 解析,避免启动目录不同导致语言包找不到 */
function toAbsolutePath(value) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : resolvePath(value);
}
/** 探测本机 npm 语言包(@tesseract.js-data/<lang>/4.0.0_best_int);未安装返回 null */
function detectLocalLangPack(lang) {
    try {
        const require = createRequire(import.meta.url);
        const entry = require.resolve(`@tesseract.js-data/${lang}`);
        const dir = join(dirname(entry), LANG_PACK_DIR);
        return existsSync(dir) ? dir : null;
    }
    catch {
        return null;
    }
}
/** 语言包解析优先级:--lang-path → AQUASENSE_OCR_LANG_PATH → 本机 npm 包 → tesseract.js 默认 CDN */
export function resolveLangPath(options) {
    if (options.langPath) {
        return { value: toAbsolutePath(options.langPath), source: '--lang-path' };
    }
    const fromEnv = process.env.AQUASENSE_OCR_LANG_PATH?.trim();
    if (fromEnv) {
        return { value: toAbsolutePath(fromEnv), source: '环境变量 AQUASENSE_OCR_LANG_PATH' };
    }
    const detected = detectLocalLangPack(options.lang);
    if (detected) {
        return { value: detected, source: `本机 @tesseract.js-data/${options.lang}(${LANG_PACK_DIR})` };
    }
    return { value: null, source: `tesseract.js 默认 CDN(${LANG_CDN_PREFIX}/${options.lang}/${LANG_PACK_DIR})` };
}
/** 本地语言包目录做存在性预检(CDN/URL 无法预检),尽早暴露"照着装不起来"的问题 */
function checkLangPathUsable(langPath, lang) {
    if (!langPath || /^[a-z][a-z0-9+.-]*:\/\//i.test(langPath))
        return;
    const found = [`${lang}.traineddata`, `${lang}.traineddata.gz`].some((name) => existsSync(join(langPath, name)));
    if (!found) {
        console.warn(`[ocr] 警告:${langPath} 下未找到 ${lang}.traineddata(.gz);需 ${LANG_PACK_DIR} 版本的 chi_sim 语言包,加载可能失败`);
    }
}
/** 加载可选依赖 tesseract.js(OCR 引擎),缺失时给出可照做的安装提示 */
async function loadTesseract() {
    try {
        return await import(TESSERACT_MODULE);
    }
    catch {
        console.error('[ocr] 缺少可选依赖 tesseract.js(OCR 引擎),本脚本无法执行。');
        console.error(OCR_DEPS_HINT);
        throw new Error('缺少可选依赖 tesseract.js');
    }
}
/** 预检页图渲染所需的画布依赖(unpdf 的 renderPageAsImage 在 Node 下必须提供) */
async function loadCanvas() {
    try {
        await import(CANVAS_MODULE);
    }
    catch {
        console.error(`[ocr] 缺少可选依赖 ${CANVAS_MODULE}(unpdf 渲染页图所需),本脚本无法执行。`);
        console.error(OCR_DEPS_HINT);
        throw new Error(`缺少可选依赖 ${CANVAS_MODULE}`);
    }
}
/** unpdf 渲染页图所需的画布注入(Node 环境必须) */
const canvasImport = async () => import(CANVAS_MODULE);
/** 创建 OCR worker:整批复用同一 worker(lang 与 psm 只初始化一次) */
async function createOcrWorker(tesseract, options, langPath) {
    let progressPrinted = false;
    const workerOptions = {
        // 语言包加载进度(首次可能下载/解压,给运维可见反馈)
        logger: (message) => {
            if (message?.status === 'loading language traineddata' && typeof message.progress === 'number') {
                process.stdout.write(`\r[ocr] 加载语言包 ${(message.progress * 100).toFixed(0)}%`);
                progressPrinted = true;
            }
        }
    };
    if (langPath)
        workerOptions.langPath = langPath;
    // OEM 固定 LSTM_ONLY:tesseract.js 据此选择 4.0.0_best_int 语言源(与 core 7 匹配)
    const worker = await tesseract.createWorker(options.lang, tesseract.OEM?.LSTM_ONLY ?? 1, workerOptions);
    if (progressPrinted)
        process.stdout.write('\n');
    await worker.setParameters({ tessedit_pageseg_mode: options.psm });
    return worker;
}
/** 解析 get_media_info 的下载链接(签名 URL + 必须随请求携带的鉴权头) */
function resolveUrlInfo(info) {
    const urlInfo = info?.url_info;
    if (!urlInfo || typeof urlInfo.url !== 'string' || !urlInfo.url.startsWith('http'))
        return null;
    const headers = urlInfo.headers && typeof urlInfo.headers === 'object' ? urlInfo.headers : undefined;
    return { url: urlInfo.url, headers };
}
/** 不可重试错误:确定性失败(如超限),重试只会把整个文件再下几遍 */
class UnretryableError extends Error {
}
/** 下载 PDF(带鉴权头;网络抖动重试,签名 URL 仅本次运行有效,续跑时重新获取) */
async function downloadPdf(urlInfo, label) {
    let lastError = null;
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(urlInfo.url, { headers: urlInfo.headers });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.byteLength > MAX_PDF_BYTES) {
                throw new UnretryableError(`${label} 超过 ${MAX_PDF_BYTES / 1024 / 1024}MB 上限,已跳过`);
            }
            console.log(`[ocr] ${label} 下载完成:${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`);
            return buffer;
        }
        catch (error) {
            lastError = error;
            if (error instanceof UnretryableError)
                break;
            if (attempt < DOWNLOAD_ATTEMPTS) {
                const reason = error instanceof Error ? error.message : String(error);
                console.warn(`[ocr] ${label} 下载失败(第 ${attempt} 次):${reason},重试...`);
                await sleep(RETRY_SLEEP_MS * attempt);
            }
        }
    }
    if (lastError instanceof UnretryableError)
        throw lastError;
    throw new Error(`${label} 下载失败:${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
/** 单页识别(失败重试一次后上抛;已完成页由 checkpoint 保证不重复识别) */
async function recognizePage(worker, image, label, pageNo) {
    let lastError = null;
    for (let attempt = 1; attempt <= RECOGNIZE_ATTEMPTS; attempt++) {
        try {
            const result = await worker.recognize(image);
            return typeof result?.data?.text === 'string' ? result.data.text : '';
        }
        catch (error) {
            lastError = error;
            if (attempt < RECOGNIZE_ATTEMPTS)
                await sleep(RETRY_SLEEP_MS);
        }
    }
    throw new Error(`${label} 第 ${pageNo} 页识别失败:${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
function bookLabel(mediaId, title) {
    if (title && title !== mediaId)
        return `《${title}》`;
    return mediaId.length > 18 ? `${mediaId.slice(0, 18)}…` : mediaId;
}
function formatEta(ms) {
    const minutes = ms / 60000;
    if (minutes < 1)
        return '<1 分钟';
    if (minutes < 60)
        return `${minutes.toFixed(1)} 分钟`;
    return `${(minutes / 60).toFixed(1)} 小时`;
}
/** 处理单本扫描件:下载 → 逐页渲染识别(checkpoint 续跑)→ 整本完成后原子覆写缓存 */
async function processTarget(target, title, urlInfo, ctx) {
    const label = bookLabel(target.mediaId, title);
    console.log(`[ocr] ${label} 开始(${target.markText})`);
    const buffer = await downloadPdf(urlInfo, label);
    const sourceSha256 = createHash('sha256').update(buffer).digest('hex');
    // 文档只打开一次,逐页渲染复用(每页重新打开会把 PDF 解析开销乘以页数)
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    try {
        const pageCount = pdf.numPages;
        if (pageCount <= 0)
            throw new Error(`${label} 页数为 0,无法 OCR`);
        const checkpointDir = join(ctx.checkpointRoot, target.mediaId);
        const params = {
            sourceSha256,
            pageCount,
            lang: ctx.options.lang,
            psm: ctx.options.psm,
            scale: ctx.options.scale
        };
        const completedBefore = countCompletedPages(checkpointDir, pageCount);
        const state = prepareCheckpoint(checkpointDir, target, title, buffer.byteLength, params);
        // checkpoint 命中时目录已存在;仅校验需要重建目录
        void state;
        const smokePages = ctx.options.smokePages;
        const totalPages = pageCount;
        const targetPages = smokePages === null ? pageCount : Math.min(smokePages, pageCount);
        if (completedBefore > 0) {
            console.log(`[ocr] ${label} 命中 checkpoint:已完成 ${completedBefore}/${pageCount} 页,续跑剩余页`);
        }
        console.log(`[ocr] ${label} ${pageCount} 页,本次处理至第 ${targetPages} 页`);
        const startedAt = Date.now();
        let newlyDone = 0;
        for (let pageNo = 1; pageNo <= targetPages; pageNo++) {
            const pagePath = join(checkpointDir, pageFileName(pageNo));
            if (existsSync(pagePath))
                continue;
            const image = await renderPageAsImage(pdf, pageNo, { canvasImport, scale: ctx.options.scale });
            const text = await recognizePage(ctx.worker, Buffer.from(image), label, pageNo);
            writeAtomic(pagePath, text);
            newlyDone++;
            const elapsed = Date.now() - startedAt;
            const perPage = elapsed / newlyDone;
            const remaining = perPage * (targetPages - pageNo);
            console.log(`[ocr] ${label} ${pageNo}/${targetPages} 页(${(perPage / 1000).toFixed(1)}s/页,剩余约 ${formatEta(remaining)})`);
        }
        // 冒烟模式:只校验语言包与识别质量,绝不覆写正式缓存
        if (smokePages !== null) {
            const sample = readFileSync(join(checkpointDir, pageFileName(1)), 'utf8');
            console.log(`[ocr] ${label} 冒烟完成:前 ${targetPages} 页已 OCR(未覆写正式缓存)`);
            console.log(`[ocr] ${label} 第 1 页识别样例:${sample.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
            return { mediaId: target.mediaId, title, status: 'smoke', pages: targetPages, cleanChars: 0, rawChars: 0 };
        }
        const completed = countCompletedPages(checkpointDir, pageCount);
        if (!canPublish(pageCount, completed, smokePages)) {
            throw new Error(`${label} 页面不齐(${completed}/${pageCount}),保留 checkpoint 待续跑`);
        }
        const pages = readAllPages(checkpointDir, pageCount);
        const header = buildOcrHeader({
            lang: ctx.options.lang,
            psm: ctx.options.psm,
            scale: ctx.options.scale,
            pageCount,
            ocrAt: new Date().toISOString()
        });
        const published = buildPublishText(pages, header);
        const cachePath = join(ctx.cachePdfDir, `${target.mediaId}.txt`);
        writeAtomic(cachePath, published);
        state.publishedAt = new Date().toISOString();
        saveState(checkpointDir, state);
        const rawChars = pages.join('').length;
        const cleanChars = pages.map((page) => normalizeOcrText(page)).join('').length;
        console.log(`[ocr] ${label} 发布:${cachePath}(${pageCount} 页,${formatWan(cleanChars)};去字间空格前 ${formatWan(rawChars)})`);
        return { mediaId: target.mediaId, title, status: 'published', pages: pageCount, cleanChars, rawChars };
    }
    finally {
        // 释放文档与底层传输资源,避免长时间批处理累积内存
        // (PDFDocumentProxy 无 destroy,销毁入口在 loadingTask 上——与 unpdf withDocument 内部同款写法)
        await pdf.loadingTask?.destroy?.().catch(() => undefined);
    }
}
/** 字数格式化(万为单位,日志用) */
function formatWan(chars) {
    const wan = chars / 10000;
    return wan >= 1 ? `${wan.toFixed(1)} 万字` : `${chars} 字`;
}
// ========== 索引重建(复用 kb:warm 的书名映射与 mtime/过期判定,不重复实现) ==========
function runKbWarm() {
    console.log('[ocr] 重建 PDF 原文索引:npm run kb:warm(按缓存 mtime 自动判定是否重建)');
    const npmExecPath = process.env.npm_execpath;
    const result = npmExecPath
        ? spawnSync(process.execPath, [npmExecPath, 'run', 'kb:warm'], { stdio: 'inherit' })
        : spawnSync('npm', ['run', 'kb:warm'], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error || result.status !== 0) {
        console.warn(`[ocr] 索引重建未完成(${result.error?.message ?? `exit ${result.status}`});请手动运行 npm run kb:warm`);
    }
}
// ========== 主流程 ==========
async function main() {
    const options = parseOcrArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    const cacheRoot = resolveCacheRoot();
    const cachePdfDir = join(cacheRoot, 'pdf');
    const checkpointRoot = join(cacheRoot, CHECKPOINT_SUBDIR);
    if (!existsSync(cachePdfDir)) {
        console.error(`[ocr] 未找到 PDF 缓存目录:${cachePdfDir}`);
        console.error('[ocr] 请先运行 npm run kb:warm 预热知识库(扫描件会被标记 [扫描件 PDF:...],即本脚本的待办来源)');
        process.exitCode = 1;
        return;
    }
    const targets = readScannedTargets(cachePdfDir);
    if (targets.length === 0) {
        console.log(`[ocr] 没有待 OCR 的扫描件(${cachePdfDir})`);
        console.log('[ocr] 若刚更新过知识库,请先运行 npm run kb:warm 生成扫描件标记;若已全部 OCR,可运行 npm run kb:warm 重建索引');
        return;
    }
    const smokeNote = options.smokePages !== null ? `,--pages ${options.smokePages} 冒烟模式(不覆写正式缓存)` : '';
    console.log(`[ocr] 缓存根目录:${cacheRoot}`);
    console.log(`[ocr] 待 OCR 扫描件 ${targets.length} 本${smokeNote}`);
    // 可选依赖与语言包(尽早失败,避免跑到第 3 小时才发现装不上)
    const tesseract = await loadTesseract();
    await loadCanvas();
    const langPath = resolveLangPath(options);
    console.log(`[ocr] 引擎:tesseract.js(${options.lang}, psm=${options.psm}, scale=${options.scale}),语言包:${langPath.source}`);
    checkLangPathUsable(langPath.value, options.lang);
    const worker = await createOcrWorker(tesseract, options, langPath.value);
    const titleMap = loadTitleMap(cacheRoot);
    const outcomes = [];
    const failures = [];
    let processed = 0;
    let filtered = 0;
    try {
        for (const target of targets) {
            if (processed >= options.limit)
                break;
            const title = titleMap[target.mediaId] ?? '';
            const label = bookLabel(target.mediaId, title);
            // --only 匹配 mediaId 或书名(书名来自 kb:warm 构建的索引,索引缺失时退化为 mediaId 匹配)
            if (options.only && !target.mediaId.includes(options.only) && !title.includes(options.only)) {
                filtered++;
                continue;
            }
            try {
                const info = await getMediaInfo(target.mediaId);
                const urlInfo = resolveUrlInfo(info);
                if (!urlInfo)
                    throw new Error('get_media_info 未返回下载链接(url_info.url 缺失)');
                processed++;
                outcomes.push(await processTarget(target, title, urlInfo, { cachePdfDir, checkpointRoot, options, worker }));
            }
            catch (error) {
                processed++;
                const message = error instanceof Error ? error.message : String(error);
                failures.push(`${label}: ${message}`);
                console.error(`[ocr] 失败:${label}:${message}`);
            }
        }
    }
    finally {
        // worker 必须终止:worker_thread 会阻止进程退出(异常路径也要走到)
        await worker.terminate().catch(() => undefined);
    }
    // ===== 汇总 =====
    const published = outcomes.filter((outcome) => outcome.status === 'published');
    const smoked = outcomes.filter((outcome) => outcome.status === 'smoke');
    const totalPages = published.reduce((sum, outcome) => sum + outcome.pages, 0);
    const totalClean = published.reduce((sum, outcome) => sum + outcome.cleanChars, 0);
    const totalRaw = published.reduce((sum, outcome) => sum + outcome.rawChars, 0);
    console.log('');
    console.log('[ocr] ===== 汇总 =====');
    console.log(`[ocr] 待办 ${targets.length} 本,处理 ${processed} 本(发布 ${published.length},冒烟 ${smoked.length},失败 ${failures.length}${filtered > 0 ? `,--only 过滤 ${filtered}` : ''})`);
    if (published.length > 0) {
        console.log(`[ocr] 覆写缓存 ${published.length} 本:${totalPages} 页,${formatWan(totalClean)}(去字间空格前 ${formatWan(totalRaw)})`);
    }
    if (failures.length > 0) {
        console.log('[ocr] 失败清单:');
        for (const item of failures) {
            console.log(`  - ${item}`);
        }
        console.log(`[ocr] 失败本重跑即续跑(checkpoint 保留在 ${checkpointRoot}/),不会从头开始`);
    }
    if (smoked.length > 0) {
        console.log('[ocr] 冒烟模式未覆写正式缓存;确认识别质量后去掉 --pages 正式运行');
    }
    // ===== 索引重建(默认开启:缓存已变,通道 C 需要新索引才能检索到 OCR 内容) =====
    if (published.length > 0) {
        console.log('');
        if (options.warm) {
            runKbWarm();
        }
        else {
            console.log('[ocr] 下一步:运行 npm run kb:warm 重建 PDF 索引(缓存已更新,mtime 判定会触发重建)');
        }
    }
    if (published.length > 0) {
        console.log(`[ocr] checkpoint 保留在 ${checkpointRoot}/,如需重新发布可复用;确认无需可手动删除`);
    }
    if (failures.length > 0)
        process.exitCode = 1;
}
// 仅直接运行(npm run ocr / node dist/...)时执行批处理;
// 被测试 import 时只暴露纯函数,不启动 OCR(依赖 tesseract 的可选性不受影响)
const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href : false;
if (isDirectRun) {
    main().catch((error) => {
        console.error('[ocr] 执行失败:', error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
