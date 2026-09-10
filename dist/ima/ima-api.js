/**
 * IMA API 封装模块
 * 封装 IMA 知识库查询接口,供 generate-advice(处置建议内置查询)与 daily-reminder(S9 手册读取)调用。
 *
 * 检索层(双通道互补):
 *  - searchKnowledge:知识库检索(wiki/v1/search_knowledge),仅索引名称(文件名/文件夹名),正文词命中为 0。
 *  - searchNote:笔记正文检索(note/v1/search_note),索引正文并回带命中处高亮原文。
 *
 * 正文层:
 *  - PDF(media_type=1):经 get_media_info 的 url_info 下载,用 unpdf(pdf.js)提取文本层并按 media_id 缓存;
 *    扫描件(无文本层)留标记,待 OCR 兜底。
 *  - 笔记(media_type=11):经 notebook_ext_info.notebook_id 调 notes 接口读纯文本并按 media_id 缓存;
 *    权限类确定性失败留标记,临时失败(频控/网络)不缓存、下次重试。
 *  - 其他类型:沿用字段提取与占位标记(见 extractMediaText)。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
const IMA_BASE_URL = 'https://ima.qq.com';
/**
 * 获取 IMA API 凭证
 * 方式 A:环境变量 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY
 * 方式 B:配置文件 ~/.config/ima/client_id 与 ~/.config/ima/api_key(与 IMA Skill 共用)
 */
function getCredentials() {
    const envClientId = process.env.IMA_OPENAPI_CLIENTID;
    const envApiKey = process.env.IMA_OPENAPI_APIKEY;
    if (envClientId && envApiKey) {
        return { clientId: envClientId.trim(), apiKey: envApiKey.trim() };
    }
    const configDir = join(homedir(), '.config', 'ima');
    const clientIdFile = join(configDir, 'client_id');
    const apiKeyFile = join(configDir, 'api_key');
    if (existsSync(clientIdFile) && existsSync(apiKeyFile)) {
        return {
            clientId: readFileSync(clientIdFile, 'utf8').trim(),
            apiKey: readFileSync(apiKeyFile, 'utf8').trim()
        };
    }
    throw new Error('[aquasense] IMA 凭证未配置:请设置 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY,或写入 ~/.config/ima/client_id 与 api_key');
}
/** IMA API 业务错误(携带错误码,便于区分确定性失败与临时失败,如笔记权限 vs 频控) */
class IMAError extends Error {
    code;
    constructor(code, msg) {
        super(`IMA API 错误: ${msg}`);
        this.name = 'IMAError';
        this.code = code;
    }
}
/**
 * 调用 IMA API
 */
async function callIMAApi(apiPath, body) {
    const { clientId, apiKey } = getCredentials();
    const response = await fetch(`${IMA_BASE_URL}/${apiPath}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'ima-openapi-clientid': clientId,
            'ima-openapi-apikey': apiKey
        },
        body: JSON.stringify(body)
    });
    const result = (await response.json());
    if (result.code !== 0) {
        throw new IMAError(result.code, result.msg);
    }
    return result.data;
}
/**
 * 定位知识库 ID:按名称搜索"水产养殖"知识库并取第一个匹配项
 * (searchKnowledge 与批量预热脚本共用)
 */
export async function resolveKnowledgeBaseId(query = '水产养殖') {
    const kbList = await callIMAApi('openapi/wiki/v1/search_knowledge_base', { query, limit: 10 });
    const kbs = kbList?.info_list ?? [];
    return kbs.length > 0 ? kbs[0].kb_id : null;
}
/**
 * 搜索知识库:自动定位"水产养殖"知识库后执行关键词搜索
 */
export async function searchKnowledge(query, kbId) {
    try {
        // 1. 先定位目标知识库
        if (!kbId) {
            const resolved = await resolveKnowledgeBaseId();
            if (!resolved) {
                console.log('[ima] 未找到水产养殖知识库');
                return { items: [], total: 0 };
            }
            kbId = resolved;
        }
        // 2. 搜索知识库内容
        const searchResult = await callIMAApi('openapi/wiki/v1/search_knowledge', {
            query,
            knowledge_base_id: kbId,
            limit: 5
        });
        // 3. 解析搜索结果
        const items = (searchResult.info_list || []).map((item) => ({
            media_id: item.media_id,
            title: item.title,
            summary: item.summary,
            source: item.url_info?.url,
            from: 'wiki'
        }));
        return { items, total: items.length };
    }
    catch (error) {
        // 查询失败不影响主流程(生成建议/提醒照常,仅知识参考为空)
        console.error('[ima] 搜索知识库失败:', error);
        return { items: [], total: 0 };
    }
}
/**
 * 按正文检索笔记(note/v1/search_note)
 * 与 searchKnowledge 互补:知识库检索只索引名称(文件名/文件夹名),正文词(罗茨风机/氨氮等)命中为 0;
 * 笔记检索索引正文,并回带命中处高亮原文,可直接作引用、免下载解析。
 * 实测 search_type=0/1 返回值一致(接口无论如何都搜正文),固定传 1(DOC_CONTENT)。
 */
export async function searchNote(query, limit = 10) {
    try {
        const data = await callIMAApi('openapi/note/v1/search_note', {
            search_type: 1,
            query_info: { content: query },
            start: 0,
            // 接口限制 start/end 相差不超过 20
            end: Math.min(Math.max(limit, 1), 20)
        });
        const items = (data?.search_note_infos ?? [])
            .map((entry) => ({
            // note 命中的标识是 note_id(与知识库 media_id 不同),可经 notes 接口直接读正文
            media_id: entry?.note_book_info?.note_id ?? '',
            title: entry?.note_book_info?.title ?? '',
            summary: entry?.note_book_info?.summary,
            from: 'note',
            highlight: pickHighlight(entry?.highlightInfo)
        }))
            .filter((item) => item.media_id && item.title);
        return { items, total: Number(data?.total_hit_num ?? items.length) };
    }
    catch (error) {
        // 检索失败不影响主流程(wiki 通道结果仍可用)
        console.error('[ima] 检索笔记失败:', error);
        return { items: [], total: 0 };
    }
}
/**
 * 提取高亮原文:highlightInfo 为 map(官方文档标称 key 为 doc_title,实测为 format_content),
 * 取首个非空文本;含 <em> 标记,展示前由调用方清理。
 */
function pickHighlight(highlightInfo) {
    if (!highlightInfo || typeof highlightInfo !== 'object')
        return undefined;
    const texts = Object.values(highlightInfo).filter((value) => typeof value === 'string' && value.length > 0);
    return texts[0];
}
/**
 * 浏览知识库内容(单页):供批量预热/巡检脚本逐级遍历使用
 * 文件夹条目含 folder_id,文件条目含 media_id;cursor 首次传空字符串
 */
export async function listKnowledge(kbId, cursor = '', folderId, limit = 50) {
    const data = await callIMAApi('openapi/wiki/v1/get_knowledge_list', {
        cursor,
        limit,
        knowledge_base_id: kbId,
        ...(folderId ? { folder_id: folderId } : {})
    });
    const items = (data?.knowledge_list ?? []).map((entry) => {
        // 文件夹有两种返回形态:显式 folder_id 字段,或 media_id 以 folder_ 开头(此时可作 folder_id 下钻);
        // 后者若不识别会被误当文件,get_media_info 报错并遗漏整个子树(含笔记/专利 PDF)
        const folderId = entry?.folder_id ??
            (typeof entry?.media_id === 'string' && entry.media_id.startsWith('folder_') ? entry.media_id : undefined);
        if (folderId) {
            return { kind: 'folder', title: entry.name ?? entry.title ?? '', folderId };
        }
        return { kind: 'file', title: entry.title ?? '', mediaId: entry.media_id };
    });
    return { items, nextCursor: data?.next_cursor ?? '', isEnd: data?.is_end === true };
}
/**
 * 获取媒体详情(原始返回值)
 */
export async function getMediaInfo(mediaId) {
    return callIMAApi('openapi/wiki/v1/get_media_info', { media_id: mediaId });
}
// ========== 正文层:PDF(media_type=1) ==========
/**
 * 单文件大小上限:IMA 允许 200MB,超限直接跳过,避免内存与耗时失控。
 * 实测 50-100MB 区间仍有带文本层的大部头(如 87.5MB/163 页的养殖专著),
 * 故上限放到 100MB;>100MB 实测样本均为纯扫描件(无文本层),跳过收益更高。
 */
const MAX_PDF_BYTES = 100 * 1024 * 1024;
/** 扫描件判定阈值:页均字符数低于该值视为无文本层(pdf.js 提取不到,需 OCR 兜底) */
const MIN_CHARS_PER_PAGE = 50;
/** 正文缓存子目录(pdf/note;与 daily-reminder 共用 AQUASENSE_CACHE_DIR 约定) */
function cacheSubdir(sub) {
    const dir = join(process.env.AQUASENSE_CACHE_DIR || './cache', sub);
    mkdirSync(dir, { recursive: true });
    return dir;
}
/** 字节数格式化(仅用于超限标记文案) */
function formatSize(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
/**
 * 缓存中的超限标记是否已过期:标记里记录了跳过时的文件大小,
 * 若该大小已不大于当前上限(说明上限被调高过),应重新下载评估——否则旧标记会永久拦截这些文件。
 * 解析不出大小时保守沿用标记。
 */
function isStaleOversizeMark(cached) {
    const matched = /^\[PDF 超限:(\d+(?:\.\d+)?)([MK])B/.exec(cached);
    if (!matched)
        return false;
    const bytes = Number(matched[1]) * (matched[2] === 'M' ? 1024 * 1024 : 1024);
    return bytes <= MAX_PDF_BYTES;
}
/**
 * 下载并解析 PDF 正文(按 media_id 落盘缓存)
 * 首次访问承担下载+解析开销,其后命中缓存零成本;84 条 PDF 预热一次后运行时全走缓存。
 * unpdf 内置 pdf.js serverless 构建,Node 下自动配置标准字体与 CJK cMap,降低中文提取乱码风险。
 */
async function getPdfContent(mediaId, urlInfo) {
    const cachePath = join(cacheSubdir('pdf'), `${mediaId}.txt`);
    if (existsSync(cachePath)) {
        const cached = readFileSync(cachePath, 'utf8');
        // 超限标记可能因上限调高而过期,过期则落空重走下载评估
        if (!isStaleOversizeMark(cached))
            return cached;
    }
    // 1. 下载(url_info.headers 如鉴权头必须携带,否则下载失败)
    console.log(`[ima] 下载 PDF:${mediaId}`);
    const response = await fetch(urlInfo.url, { headers: urlInfo.headers });
    if (!response.ok) {
        throw new Error(`[ima] PDF 下载失败:HTTP ${response.status}`);
    }
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > MAX_PDF_BYTES) {
        // 缓存标记:避免后续调用重复下载大文件(扫描类大部头无法提取文本层,跳过代价低于每次重下)
        const mark = `[PDF 超限:${formatSize(declaredSize)},已跳过解析]`;
        writeFileSync(cachePath, mark, 'utf8');
        console.warn(`[ima] PDF ${mediaId} ${mark}`);
        return mark;
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_PDF_BYTES) {
        const mark = `[PDF 超限:${formatSize(buffer.byteLength)},已跳过解析]`;
        writeFileSync(cachePath, mark, 'utf8');
        console.warn(`[ima] PDF ${mediaId} ${mark}`);
        return mark;
    }
    // 2. 提取文本层
    const pdf = await getDocumentProxy(buffer);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const content = Array.isArray(text) ? text.join('\n') : text;
    // 3. 扫描件判定:文本层缺失时留标记(缓存写入真实提取结果,后续 OCR 兜底可覆写同名缓存)
    const avgChars = totalPages > 0 ? content.length / totalPages : 0;
    let result = content;
    if (avgChars < MIN_CHARS_PER_PAGE) {
        console.warn(`[ima] PDF ${mediaId} 疑似扫描件(页均 ${Math.round(avgChars)} 字),需 OCR 兜底`);
        result = `[扫描件 PDF:共 ${totalPages} 页,无文本层,需 OCR 兜底]\n${content}`;
    }
    writeFileSync(cachePath, result, 'utf8');
    console.log(`[ima] PDF ${mediaId} 解析完成:${totalPages} 页,${content.length} 字`);
    return result;
}
// ========== 正文层:笔记(media_type=11) ==========
/** 笔记确定性失败错误码:非作者(210005)/已删除(210006)/共享无权限(210011)——缓存标记,避免反复请求 */
const PERMANENT_NOTE_ERROR_CODES = new Set([210005, 210006, 210011]);
/**
 * 读取并缓存笔记正文(按 cacheKey 落盘)
 * 路径:get_media_info → notebook_ext_info.notebook_id → notes get_doc_content(target_content_format=0 纯文本)。
 * 注意:笔记内容仅用于内部建议生成与手册读取,不外传到群聊之外的渠道。
 */
async function getNoteContent(noteId, cacheKey) {
    const cachePath = join(cacheSubdir('note'), `${cacheKey}.txt`);
    if (existsSync(cachePath)) {
        return readFileSync(cachePath, 'utf8');
    }
    console.log(`[ima] 读取笔记:${noteId}`);
    try {
        const data = await callIMAApi('openapi/note/v1/get_doc_content', {
            note_id: noteId,
            target_content_format: 0
        });
        const content = typeof data?.content === 'string' ? data.content : '';
        writeFileSync(cachePath, content, 'utf8');
        console.log(`[ima] 笔记 ${noteId} 读取完成:${content.length} 字`);
        return content;
    }
    catch (error) {
        // 确定性失败(权限/已删除):写标记缓存;临时失败(频控/网络):不缓存,下次重试
        if (error instanceof IMAError && PERMANENT_NOTE_ERROR_CODES.has(error.code)) {
            const mark = `[笔记无法读取:${error.message}]`;
            writeFileSync(cachePath, mark, 'utf8');
            console.warn(`[ima] 笔记 ${noteId} ${mark}`);
            return mark;
        }
        throw error;
    }
}
/**
 * 按笔记 ID 直读正文(供 searchNote 命中但无高亮的条目使用)
 * 注意:note 检索的标识是 note_id,与知识库 media_id 不是同一命名空间,不能复用 getMediaContent。
 */
export async function getNoteContentByNoteId(noteId) {
    return getNoteContent(noteId, noteId);
}
/**
 * 从 get_media_info 的原始返回值中提取正文文本
 * IMA 各媒体类型的正文字段不同,按常见字段名依次尝试;
 * 笔记类文档(url_info.url 为 chrome://note?...)需二次请求获取正文。
 */
function extractMediaText(raw) {
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw && typeof raw === 'object') {
        const obj = raw;
        // 1. 直接字段匹配(文档/文本类媒体)
        for (const key of ['content', 'media_content', 'text', 'title', 'abstract']) {
            const value = obj[key];
            if (typeof value === 'string' && value.length > 0) {
                return value;
            }
        }
        // 2. 笔记类: url_info.url 可能是 chrome://note?... 协议(无法 fetch)
        //    或 http(s):// 链接(可 fetch 正文)
        const urlInfo = obj['url_info'];
        if (urlInfo && typeof urlInfo.url === 'string') {
            const url = urlInfo.url;
            if (url.startsWith('http://') || url.startsWith('https://')) {
                return `[需从 URL 获取正文] ${url}`;
            }
            // chrome://note?docid=... 等不可 fetch 协议
            return `[笔记协议无法直接读取] ${url}`;
        }
        // 3. notebook_ext_info 笔记扩展信息
        const nbExt = obj['notebook_ext_info'];
        if (nbExt?.notebook_id) {
            return `[笔记内容需要通过 IMA 客户端读取] notebook_id=${nbExt.notebook_id}`;
        }
    }
    return JSON.stringify(raw);
}
/**
 * 获取媒体正文文本(如《每日操作手册》条目内容)
 * PDF(media_type=1)走"下载 + unpdf 解析 + 缓存",笔记(media_type=11)走 notes 接口读取+缓存;其余类型沿用字段提取。
 */
export async function getMediaContent(mediaId) {
    const data = await getMediaInfo(mediaId);
    const obj = data && typeof data === 'object' ? data : undefined;
    // PDF 类:url_info 提供带鉴权头的下载链接
    if (obj?.media_type === 1) {
        const urlInfo = obj['url_info'];
        if (urlInfo?.url?.startsWith('http')) {
            return getPdfContent(mediaId, urlInfo);
        }
        return '[PDF 无下载链接,请使用 IMA 客户端查看原文]';
    }
    // 笔记类:notebook_ext_info 提供 notebook_id,经 notes 接口读纯文本
    if (obj?.media_type === 11) {
        const nbExt = obj['notebook_ext_info'];
        if (nbExt?.notebook_id) {
            return getNoteContent(nbExt.notebook_id, mediaId);
        }
        return '[笔记缺少 notebook_id,请使用 IMA 客户端查看原文]';
    }
    return extractMediaText(data);
}
