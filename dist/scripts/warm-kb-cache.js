#!/usr/bin/env node
/**
 * 知识库正文层批量预热脚本(PDF + 笔记)
 *
 * 遍历 IMA 知识库全部条目,按媒体类型预热正文缓存:
 *  - PDF(media_type=1):下载 → unpdf 提取文本层 → 按 media_id 落盘
 *  - 笔记(media_type=11):notes 接口读纯文本 → 按 media_id 落盘
 * 预热末尾构建 PDF 原文切片索引(cache/pdf-index),供 aquasense_advice 的通道 C 检索;
 * 索引是否重建按"缓存 mtime 是否新于 builtAt"判定(OCR 覆写缓存/手工补录也能触发重建)。
 * 已缓存条目自动跳过,可重复执行(增量);建议部署后或知识库更新后各跑一次。
 *
 * 启动方式:
 *   npm run kb:warm                 # 全量预热(已缓存自动跳过)
 *   npm run kb:warm -- --limit 10   # 只处理前 10 份正文(PDF+笔记,抽样探测覆盖率)
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveKnowledgeBaseId, listKnowledge, getMediaInfo, getMediaContent, resolveCacheRoot } from '../ima/ima-api.js';
import { buildPdfIndex, getPdfIndexMeta, INDEX_MAX_AGE_MS } from '../ima/pdf-content-search.js';
const SLEEP_MS = 300; // 条目间请求间隔,规避 IMA 频控(110021)
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 逐级遍历知识库文件夹,收集全部文件条目 */
async function collectFiles(kbId) {
    const files = [];
    const folderQueue = [undefined]; // undefined 表示根目录
    while (folderQueue.length > 0) {
        const folderId = folderQueue.shift();
        let cursor = '';
        for (;;) {
            const page = await listKnowledge(kbId, cursor, folderId);
            for (const item of page.items) {
                if (item.kind === 'folder' && item.folderId) {
                    folderQueue.push(item.folderId);
                }
                else if (item.mediaId) {
                    files.push(item);
                }
            }
            if (page.isEnd)
                break;
            cursor = page.nextCursor;
            await sleep(SLEEP_MS);
        }
    }
    return files;
}
/** PDF 缓存目录内 .txt 的最新修改时间(ms);目录不存在返回 0。用于判定索引是否落后于缓存 */
function newestCacheMtime(dir) {
    try {
        let newest = 0;
        for (const name of readdirSync(dir)) {
            if (!name.endsWith('.txt'))
                continue;
            const mtime = statSync(join(dir, name)).mtimeMs;
            if (mtime > newest)
                newest = mtime;
        }
        return newest;
    }
    catch {
        return 0;
    }
}
async function main() {
    const limitIndex = process.argv.indexOf('--limit');
    const limited = limitIndex >= 0;
    const limit = limited ? Number(process.argv[limitIndex + 1]) : Number.POSITIVE_INFINITY;
    const kbId = await resolveKnowledgeBaseId();
    if (!kbId) {
        console.error('[kb:warm] 未找到"水产养殖"知识库,请检查 IMA 凭证与知识库名称');
        process.exitCode = 1;
        return;
    }
    console.log(`[kb:warm] 知识库 ID:${kbId},开始遍历条目...`);
    const files = await collectFiles(kbId);
    console.log(`[kb:warm] 共 ${files.length} 个文件条目,开始探测媒体类型(PDF/笔记参与正文预热)...`);
    let processed = 0;
    let pdfTotal = 0;
    let pdfOk = 0;
    let scannedCount = 0;
    let oversizedCount = 0;
    let noteTotal = 0;
    let noteOk = 0;
    let noteUnreadable = 0;
    let skipped = 0;
    const failures = [];
    // 书名映射:供索引切片标注来源书名(扫描件/超限也记录,OCR 覆写缓存后无需再改标题)
    const titles = {};
    for (const file of files) {
        if (limited && processed >= limit)
            break;
        const mediaId = file.mediaId;
        if (!mediaId)
            continue;
        try {
            const info = await getMediaInfo(mediaId);
            const mediaType = info?.media_type;
            if (mediaType !== 1 && mediaType !== 11) {
                skipped++;
                continue;
            }
            processed++;
            const text = await getMediaContent(mediaId);
            if (mediaType === 1) {
                pdfTotal++;
                titles[mediaId] = file.title;
                if (text.startsWith('[扫描件')) {
                    scannedCount++;
                    console.warn(`[kb:warm] PDF 扫描件(需 OCR):${file.title}`);
                }
                else if (text.startsWith('[PDF 超限')) {
                    oversizedCount++;
                    console.warn(`[kb:warm] PDF 超限跳过:${file.title}`);
                }
                else {
                    pdfOk++;
                    console.log(`[kb:warm] PDF OK ${file.title}(${text.length} 字)`);
                }
            }
            else {
                noteTotal++;
                if (text.startsWith('[笔记无法读取')) {
                    noteUnreadable++;
                    console.warn(`[kb:warm] 笔记不可读:${file.title}`);
                }
                else {
                    noteOk++;
                    console.log(`[kb:warm] 笔记 OK ${file.title}(${text.length} 字)`);
                }
            }
        }
        catch (error) {
            failures.push(`${file.title}: ${error instanceof Error ? error.message : String(error)}`);
            console.error(`[kb:warm] 失败:${file.title}`, error);
        }
        await sleep(SLEEP_MS);
    }
    console.log('');
    console.log('[kb:warm] ===== 汇总 =====');
    console.log(`[kb:warm] 文件条目 ${files.length}(其他类型跳过 ${skipped}),处理 ${processed}(PDF ${pdfTotal} + 笔记 ${noteTotal})`);
    console.log(`[kb:warm] PDF:成功 ${pdfOk},扫描件 ${scannedCount},超限 ${oversizedCount}`);
    console.log(`[kb:warm] 笔记:成功 ${noteOk},不可读 ${noteUnreadable}`);
    console.log(`[kb:warm] 失败 ${failures.length}`);
    if (failures.length > 0) {
        console.log('[kb:warm] 失败清单:');
        for (const item of failures) {
            console.log(`  - ${item}`);
        }
    }
    if (scannedCount > 0) {
        console.log('[kb:warm] 提示:扫描件无文本层,接入 OCR 兜底后覆写对应缓存文件即可生效');
    }
    if (noteUnreadable > 0) {
        console.log('[kb:warm] 提示:不可读笔记(非本人/已删除/共享无权限)已写入标记缓存,如需正文请在 IMA 客户端确认归属');
    }
    // ===== PDF 原文索引构建(通道 C;kb:warm 是索引的唯一构建入口) =====
    console.log('');
    console.log('[kb:warm] ===== PDF 原文索引 =====');
    const cachePdfDir = join(resolveCacheRoot(), 'pdf');
    const indexDir = join(resolveCacheRoot(), 'pdf-index');
    const existingMeta = getPdfIndexMeta(indexDir);
    const cacheMtime = newestCacheMtime(cachePdfDir);
    const staleReason = !existingMeta
        ? '索引不存在'
        : Date.now() - new Date(existingMeta.builtAt).getTime() > INDEX_MAX_AGE_MS
            ? '索引已过期'
            : cacheMtime > new Date(existingMeta.builtAt).getTime()
                ? '缓存有更新(有新缓存/OCR 覆写)'
                : null;
    if (!staleReason && existingMeta) {
        console.log(`[kb:warm] 索引已是最新(${existingMeta.pdfCount} PDF, ${existingMeta.totalChunks} 切片),跳过构建`);
    }
    else {
        console.log(`[kb:warm] 需要重建索引:${staleReason}`);
        try {
            const meta = await buildPdfIndex(cachePdfDir, indexDir, { titles });
            console.log(`[kb:warm] 索引构建完成:${meta.pdfCount} PDF, ${meta.totalChunks} 切片`);
        }
        catch (error) {
            // 构建失败不影响正文缓存与运行时降级(通道 C 自动跳过,双通道照常)
            console.error('[kb:warm] PDF 索引构建失败:', error instanceof Error ? error.message : error);
        }
    }
    if (limited) {
        console.log('[kb:warm] 提示:--limit 为抽样模式,索引按当前缓存现状构建(未预热条目不在索引内)');
    }
}
main().catch((error) => {
    console.error('[kb:warm] 执行失败:', error);
    process.exit(1);
});
