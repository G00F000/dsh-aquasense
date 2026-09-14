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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KnowledgeItem } from './ima-api.js'

// ========== 类型定义 ==========

/** 切片(Chunk) */
export interface PdfChunk {
  /** 所属 PDF 的 IMA media_id */
  mediaId: string
  /** PDF 标题(知识库书名;预热脚本提供,缺省从文本头部提取) */
  title: string
  /** 页码(1-based):缓存含分页符时可用;合并文本无页边界时为 null */
  page: number | null
  /** 所属章节(正则检测并向后继承,可为 null) */
  chapter: string | null
  /** 切片文本内容 */
  text: string
  /** 切片在 PDF 全文中的起始字符偏移(近似:不计块间分隔符;用于重叠切片去重) */
  offset: number
  /** 切片在 chunks.json 中的索引位置 */
  index: number
}

/** 索引元数据(index.json 持久化) */
export interface PdfIndexMeta {
  builtAt: string
  totalChunks: number
  pdfCount: number
  pdfs: Array<{
    mediaId: string
    title: string
    chunkCount: number
    /** 页数:缓存含分页符时可用,否则 null */
    pageCount: number | null
  }>
  config: {
    chunkSize: number
    chunkOverlap: number
  }
}

/** 检索结果 */
export interface PdfSearchHit {
  mediaId: string
  title: string
  text: string
  page: number | null
  chapter: string | null
  score: number
  matchedTerms: string[]
  from: 'pdf_content'
}

/** buildPdfIndex 可选参数 */
export interface BuildPdfIndexOptions {
  /** mediaId → 书名(来自知识库条目列表);缺省时从缓存文本头部提取 */
  titles?: Record<string, string>
}

/** 运行时索引数据 */
interface PdfIndexData {
  meta: PdfIndexMeta
  chunks: PdfChunk[]
}

// ========== 常量与配置 ==========

/** 切片大小(字符数) */
const CHUNK_SIZE = 512
/** 切片重叠(字符数) */
const CHUNK_OVERLAP = 100
/** 检索返回条数上限 */
const SEARCH_TOP_K = 5
/** 单次检索同一 PDF 最多保留条数(避免同一本书挤占引用名额) */
const MAX_HITS_PER_PDF = 2
/** 过短的尾段丢弃阈值(字符) */
const MIN_CHUNK_CHARS = 50
/** 有效文本最短长度(短于此视为异常缓存,不建索引) */
const MIN_TEXT_CHARS = 100
/** 高亮上下文长度(字符) */
const HIGHLIGHT_CONTEXT_CHARS = 300

/** 索引有效期(7 天):超期告警并触发 kb:warm 重建;过期不影响查询 */
export const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 索引格式版本:结构变化时递增,旧版本索引视为不可用(由 kb:warm 重建) */
export const PDF_INDEX_FORMAT_VERSION = 1

/** OCR 文本头标记:[OCR 批处理] / [OCR] 等 */
const OCR_MARK_RE = /^\[OCR[^\]]*\][ \t]*/

/** 章节标题检测(按行匹配;命中后向后继承到所属切片) */
const CHAPTER_PATTERNS = [
  /^(第[一二三四五六七八九十百千\d]+[章节篇])(\s*\S.*)?$/, // 第X章/第X节
  /^Chapter\s+\d+\b.*$/i, // Chapter X
  /^(\d+(?:\.\d+)+)\s+(.{2,20})$/, // 3.2.1 白点病(多级编号;需行内带标题)
  /^([A-Z]\.\d+(?:\.\d+)*)\s+(.{2,20})$/ // A.1 附录
]

/** 水产领域词典:2/3-gram 无法保证切出完整术语,词典词整词补充(索引与查询两侧一致) */
const AQUACULTURE_LEXICON = [
  '白点病', '小瓜虫', '水霉病', '烂鳃病', '肠炎病', '赤皮病',
  '氨氮', '亚硝酸盐', '溶氧', '水色',
  '鲈鱼', '草鱼', '鲤鱼', '鲫鱼', '对虾',
  '福尔马林', '亚甲基蓝', '高锰酸钾', '二氧化氯', '聚维酮碘',
  '罗茨风机', '微孔曝气', '循环水', '生物滤池'
]

/** 停用字:含停用字的 2/3-gram 不入索引(减少"的/了/是"类噪声组合) */
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '有', '把', '被', '对', '为',
  '与', '及', '或', '等', '中', '上', '下', '内', '外', '不',
  '也', '都', '就', '到', '从', '以', '用', '可', '能', '会',
  '这', '那', '其', '所', '之', '但', '而', '则', '因', '由',
  '将', '已', '于', '每', '各', '按', '经', '使', '如', '若', '要', '并'
])

// ========== 中文分词(可选 jieba + n-gram 兜底 + 词典增强) ==========

/** jieba-wasm 分词函数(可选依赖:安装后自动启用,未安装用 n-gram 兜底) */
let jiebaCut: ((text: string) => string[]) | null = null
let jiebaProbed = false

/** 异步探测 jieba-wasm(不阻塞;首次探测未完成期间用 n-gram) */
function probeJieba(): void {
  if (jiebaProbed) return
  jiebaProbed = true
  const moduleName = 'jieba-wasm'
  void import(moduleName)
    .then((mod: any) => {
      if (typeof mod?.cut === 'function') {
        jiebaCut = (text: string) => mod.cut(text, true) as string[]
        console.log('[pdf-index] 分词模式:jieba-wasm(精确模式)')
      }
    })
    .catch(() => {
      // 未安装 jieba-wasm:使用内置 n-gram(零依赖)
    })
}

/** 分词:jieba 可用时用精确模式,否则 n-gram;两侧都叠加水产词典词(整词) */
function tokenizeChinese(text: string): string[] {
  probeJieba()
  const terms = new Set<string>()
  if (jiebaCut) {
    for (const word of jiebaCut(text)) {
      const trimmed = word.trim()
      if (trimmed.length > 0 && !STOP_WORDS.has(trimmed)) terms.add(trimmed)
    }
  } else {
    for (const term of ngramTokenize(text)) terms.add(term)
  }
  for (const word of lexiconHits(text)) terms.add(word)
  return [...terms]
}

/** n-gram 分词(2-gram + 3-gram;含停用字的组合剔除) */
function ngramTokenize(text: string): string[] {
  const clean = text.replace(/[^\u4e00-\u9fff0-9a-zA-Z]+/g, '')
  const terms = new Set<string>()
  for (let i = 0; i < clean.length - 1; i++) {
    const bigram = clean.slice(i, i + 2)
    if (!hasStopChar(bigram)) terms.add(bigram)
  }
  for (let i = 0; i < clean.length - 2; i++) {
    const trigram = clean.slice(i, i + 3)
    if (!hasStopChar(trigram)) terms.add(trigram)
  }
  return [...terms]
}

/** 词典词整词命中(弥补 n-gram 切不出完整术语的问题) */
function lexiconHits(text: string): string[] {
  const hits: string[] = []
  for (const word of AQUACULTURE_LEXICON) {
    if (text.includes(word)) hits.push(word)
  }
  return hits
}

/** 是否含停用字 */
function hasStopChar(token: string): boolean {
  for (const ch of token) {
    if (STOP_WORDS.has(ch)) return true
  }
  return false
}

/** 查询词分词:叠加原始分隔词兜底,保证用户显式给出的关键词(含未收录术语)能直接匹配 */
function tokenizeQuery(query: string): string[] {
  const terms = tokenizeChinese(query)
  const rawTerms = query
    .split(/[\s,，、;；:：]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
  return [...new Set([...terms, ...rawTerms])]
}

// ========== 离线索引构建 ==========

/**
 * 从 cache/pdf/*.txt 构建切片索引(chunks.json + index.json)
 * @param cachePdfDir PDF 文本缓存目录(如 /data/aquasense/cache/pdf)
 * @param indexDir   索引输出目录(如 /data/aquasense/cache/pdf-index)
 * @param options    titles:mediaId → 书名映射(预热脚本提供,优先于文本提取)
 */
export async function buildPdfIndex(
  cachePdfDir: string,
  indexDir: string,
  options: BuildPdfIndexOptions = {}
): Promise<PdfIndexMeta> {
  const startedAt = Date.now()
  mkdirSync(indexDir, { recursive: true })

  // Step 1: 加载有效 PDF 文本(跳过状态标记文件;OCR 文本归一化后回写缓存,一次性操作)
  const pdfTexts: Array<{ mediaId: string; text: string }> = []
  let skippedMarks = 0
  let skippedShort = 0

  for (const filename of readdirSync(cachePdfDir)) {
    if (!filename.endsWith('.txt')) continue
    const cachePath = join(cachePdfDir, filename)
    const raw = readFileSync(cachePath, 'utf8')

    // 状态标记文件([扫描件 PDF:]/[PDF 超限:]/[笔记无法读取:])不参与索引;
    // OCR 文本头部也有 [OCR] 标记,但那是真实内容,须归一化而非跳过
    if (isStatusMark(raw)) {
      skippedMarks++
      continue
    }

    let text = raw
    if (isOcrText(text)) {
      text = normalizeOcrText(text)
      // 归一化结果回写缓存,避免每次构建重复处理(内容无变化则不写,保持 mtime 稳定)
      if (text !== raw) writeFileSync(cachePath, text, 'utf8')
    }
    if (text.trim().length < MIN_TEXT_CHARS) {
      skippedShort++
      continue
    }

    pdfTexts.push({ mediaId: filename.slice(0, -4), text })
  }

  console.log(
    `[pdf-index] 加载 ${pdfTexts.length} 个有效 PDF 文本(跳过标记 ${skippedMarks},过短 ${skippedShort})`
  )

  // Step 2: 分块切片(含章节检测与继承)
  const allChunks: PdfChunk[] = []
  const pdfMeta: PdfIndexMeta['pdfs'] = []

  for (const { mediaId, text } of pdfTexts) {
    const title = options.titles?.[mediaId]?.trim() || extractTitleFromContent(text, mediaId)
    const { blocks, pageMarked } = splitIntoBlocks(text)
    const chunks = chunkBlocks(blocks, mediaId, title, pageMarked)

    pdfMeta.push({
      mediaId,
      title,
      chunkCount: chunks.length,
      pageCount: pageMarked ? blocks.length : null
    })
    allChunks.push(...chunks)
  }

  // Step 3: 持久化(index.json 仅元数据;检索靠 chunks 在线扫描,见模块头注释)
  const meta: PdfIndexMeta = {
    builtAt: new Date().toISOString(),
    totalChunks: allChunks.length,
    pdfCount: pdfMeta.length,
    pdfs: pdfMeta,
    config: { chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP }
  }

  const chunksJson = JSON.stringify(allChunks)
  writeFileSync(join(indexDir, 'index.json'), JSON.stringify({ version: PDF_INDEX_FORMAT_VERSION, meta }), 'utf8')
  writeFileSync(join(indexDir, 'chunks.json'), chunksJson, 'utf8')

  // 内存缓存失效:同进程内后续检索应加载新索引
  if (cachedIndex?.dir === indexDir) cachedIndex = null

  console.log(
    `[pdf-index] 构建完成: ${allChunks.length} 切片, ${pdfMeta.length} PDF, 耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s, chunks ${formatBytes(chunksJson.length)}`
  )
  return meta
}

/** 状态标记文件判定:内容以 [ 开头(OCR 文本头标记除外,那是真实内容) */
function isStatusMark(text: string): boolean {
  return text.startsWith('[') && !OCR_MARK_RE.test(text)
}

/**
 * 检测是否为 OCR 来源文本
 * 方法 1:文件头含 [OCR] 标记(OCR 批处理脚本写入)
 * 方法 2:Tesseract chi_sim 会在汉字间插空格,统计字间空格比例(原生 PDF 无此特征)
 */
function isOcrText(text: string): boolean {
  if (OCR_MARK_RE.test(text)) return true
  const sample = text.slice(0, 2000)
  const chineseChars = sample.match(/[\u4e00-\u9fff]/g)
  if (!chineseChars || chineseChars.length < 50) return false
  const spacedPattern = sample.match(/[\u4e00-\u9fff][ \t]+[\u4e00-\u9fff]/g)
  const ratio = (spacedPattern?.length ?? 0) / chineseChars.length
  return ratio > 0.3
}

/**
 * OCR 文本归一化:剥离文件头 OCR 标记,去除汉字间空格
 * Tesseract chi_sim 输出"流 行 性"形态,不去空格则子串/词元匹配全部失效;
 * 用 lookbehind/lookahead 一次性处理任意长度空格序列(两轮 replace 对长间隔不彻底)。
 */
function normalizeOcrText(text: string): string {
  return text
    .replace(OCR_MARK_RE, '')
    .replace(/(?<=[\u4e00-\u9fff])[ \t\u3000]+(?=[\u4e00-\u9fff])/g, '')
}

/** 块(含在源文本中的起始偏移;偏移仅用于重叠切片去重,允许数个字符的近似) */
interface TextBlock {
  text: string
  start: number
}

/**
 * 分块:优先按分页符(\f)——OCR/逐页提取的缓存用 \f 分隔页,页码可取;
 * 否则按连续空行切段(实测 unpdf 合并文本页间只有 \n,页边界不可恢复,page 记 null)。
 * 同时记录各块在源文本中的起始偏移。
 */
function splitIntoBlocks(text: string): { blocks: TextBlock[]; pageMarked: boolean } {
  const blocks: TextBlock[] = []
  const push = (segment: string, segStart: number): void => {
    const leading = segment.length - segment.trimStart().length
    const trimmed = segment.trim()
    if (trimmed.length > 0) blocks.push({ text: trimmed, start: segStart + leading })
  }

  if (text.includes('\f')) {
    let cursor = 0
    for (const part of text.split('\f')) {
      push(part, cursor)
      cursor += part.length + 1
    }
    return { blocks, pageMarked: true }
  }

  const separator = /\n{2,}/g
  let cursor = 0
  for (const match of text.matchAll(separator)) {
    push(text.slice(cursor, match.index), cursor)
    cursor = (match.index ?? 0) + match[0].length
  }
  push(text.slice(cursor), cursor)
  return { blocks, pageMarked: false }
}

/** 对每个块做滑动窗口切片(buffer 不跨块,保证切片归属单一页/段;并记录切片在全文中的偏移) */
function chunkBlocks(blocks: TextBlock[], mediaId: string, title: string, pageMarked: boolean): PdfChunk[] {
  const chunks: PdfChunk[] = []
  let chapter: string | null = null

  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
    const block = blocks[blockIdx]
    const page = pageMarked ? blockIdx + 1 : null

    // 章节检测并向后继承:同章后续切片都带章节名,命中引用时可标注所属章节
    const detected = detectChapter(block.text)
    if (detected) chapter = detected

    const sentences = block.text
      .split(/(?<=[。！？!?;；\n])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    let buffer = ''
    let bufferStart = 0 // buffer 在块内的起始偏移(逐句拼接,句首句尾空白不计,允许数十字近似)
    for (const sentence of sentences) {
      const candidate = buffer ? buffer + sentence : sentence
      if (candidate.length > CHUNK_SIZE && buffer.length > 0) {
        chunks.push({
          mediaId,
          title,
          page,
          chapter,
          text: buffer.trim(),
          offset: block.start + bufferStart,
          index: chunks.length
        })
        // overlap:保留 buffer 末尾片段,保证跨切片语境连续
        const overlapText = buffer.length > CHUNK_OVERLAP ? buffer.slice(buffer.length - CHUNK_OVERLAP) : buffer
        bufferStart = bufferStart + buffer.length - overlapText.length
        buffer = overlapText + sentence
      } else {
        buffer = candidate
      }
    }
    if (buffer.trim().length >= MIN_CHUNK_CHARS) {
      chunks.push({
        mediaId,
        title,
        page,
        chapter,
        text: buffer.trim(),
        offset: block.start + bufferStart,
        index: chunks.length
      })
    }
  }

  return chunks
}

/** 检测章节标题(检查块头部若干行,避免把正文长行误判为标题) */
function detectChapter(text: string): string | null {
  for (const line of text.split('\n').slice(0, 5)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length > 60) continue
    for (const pattern of CHAPTER_PATTERNS) {
      const match = trimmed.match(pattern)
      if (match) return match[0].trim().slice(0, 60)
    }
  }
  return null
}

/** 从文本头部提取书名(跳过章节标题/带句读的行;失败返回 mediaId) */
function extractTitleFromContent(text: string, mediaId: string): string {
  for (const line of text.split('\n').slice(0, 5)) {
    const trimmed = line.trim()
    if (trimmed.length < 4 || trimmed.length > 40) continue
    if (/[。！？：:;；]/.test(trimmed)) continue
    if (/^[（(]\d+[)）]/.test(trimmed)) continue // 专利首页头"(19)国家知识产权局"等
    if (detectChapter(trimmed)) continue // 章节标题不是书名
    return trimmed
  }
  return mediaId
}

/** 字节数格式化(仅日志用) */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

// ========== 运行时检索 ==========

/** 运行时索引缓存(按目录,单例;构建后失效) */
let cachedIndex: { dir: string; data: PdfIndexData } | null = null

/** 加载索引到内存(懒加载;索引缺失/版本不符返回 null,调用方降级) */
function loadIndex(indexDir: string): PdfIndexData | null {
  if (cachedIndex?.dir === indexDir) return cachedIndex.data

  const indexPath = join(indexDir, 'index.json')
  const chunksPath = join(indexDir, 'chunks.json')
  if (!existsSync(indexPath) || !existsSync(chunksPath)) return null

  try {
    const raw = JSON.parse(readFileSync(indexPath, 'utf8'))
    if (raw?.version !== PDF_INDEX_FORMAT_VERSION || !raw?.meta) {
      console.warn(`[pdf-index] 索引格式版本不符(需 ${PDF_INDEX_FORMAT_VERSION}),等待 kb:warm 重建`)
      return null
    }
    const chunks: PdfChunk[] = JSON.parse(readFileSync(chunksPath, 'utf8'))
    cachedIndex = { dir: indexDir, data: { meta: raw.meta, chunks } }
    console.log(`[pdf-index] 加载成功(${raw.meta.pdfCount} PDF, ${raw.meta.totalChunks} chunks)`)
    return cachedIndex.data
  } catch (error) {
    console.error('[pdf-index] 索引加载失败:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 在 PDF 原文中检索关键词,返回带页码/章节的命中切片
 * @param query 用户查询(如 "白点 小瓜虫 治疗")
 * @param indexDir 索引目录
 */
export function searchPdfContent(query: string, indexDir: string): PdfSearchHit[] {
  const startedAt = Date.now()
  const index = loadIndex(indexDir)
  if (!index || index.chunks.length === 0) return []

  const queryTerms = tokenizeQuery(query)
  if (queryTerms.length === 0) return []

  // 逐切片扫描,统计命中词元数与词频(与倒排索引结果等价);matchPos 供重叠切片去重
  const scored: Array<{ chunkIdx: number; score: number; matchedTerms: string[]; matchPos: number }> = []
  for (let i = 0; i < index.chunks.length; i++) {
    const text = index.chunks[i].text
    let score = 0
    let matchPos = -1
    let matchedTerms: string[] | null = null
    for (const term of queryTerms) {
      const { count, first } = countOccurrences(text, term)
      if (count > 0) {
        score += count
        if (first >= 0 && (matchPos < 0 || first < matchPos)) matchPos = first
        ;(matchedTerms ??= []).push(term)
      }
    }
    if (matchedTerms) scored.push({ chunkIdx: i, score, matchedTerms, matchPos: matchPos < 0 ? 0 : matchPos })
  }

  // 排序:命中不同词元数优先(避免"鲈鱼"类高频词靠词频主导),再按词频和
  scored.sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || b.score - a.score)

  // 去重:同一 PDF 同一页只保留最高分;无页边界时按命中词全文位置剔除重叠切片重复;
  // 同一 PDF 至多 MAX_HITS_PER_PDF 条
  const results: PdfSearchHit[] = []
  const seenPdfPage = new Set<string>()
  const acceptedPositions = new Map<string, number[]>()
  const perPdfCount = new Map<string, number>()
  for (const hit of scored) {
    const chunk = index.chunks[hit.chunkIdx]
    if (!chunk) continue
    if (chunk.page !== null) {
      const pageKey = `${chunk.mediaId}:page:${chunk.page}`
      if (seenPdfPage.has(pageKey)) continue
      seenPdfPage.add(pageKey)
    } else {
      // 切片窗口有 CHUNK_OVERLAP 字重叠,同一处命中会在相邻切片各出现一次;
      // 相邻切片的偏移与命中位置出自同一套累计,位置差约 0(±数十字),取 64 字冗余
      const globalPos = chunk.offset + hit.matchPos
      const positions = acceptedPositions.get(chunk.mediaId) ?? []
      if (positions.some((p) => Math.abs(p - globalPos) < 64)) continue
      positions.push(globalPos)
      acceptedPositions.set(chunk.mediaId, positions)
    }
    const pdfCount = perPdfCount.get(chunk.mediaId) ?? 0
    if (pdfCount >= MAX_HITS_PER_PDF) continue
    perPdfCount.set(chunk.mediaId, pdfCount + 1)

    results.push({
      mediaId: chunk.mediaId,
      title: chunk.title,
      text: chunk.text,
      page: chunk.page,
      chapter: chunk.chapter,
      score: hit.score,
      matchedTerms: hit.matchedTerms,
      from: 'pdf_content'
    })
    if (results.length >= SEARCH_TOP_K) break
  }

  console.log(
    `[pdf-index] 检索"${query.slice(0, 30)}" -> ${results.length} 条命中,耗时 ${Date.now() - startedAt}ms`
  )
  return results
}

/** 统计词元在文本中的出现次数,并回带首次出现位置(供重叠去重) */
function countOccurrences(text: string, term: string): { count: number; first: number } {
  let count = 0
  let first = -1
  let pos = 0
  for (;;) {
    const found = text.indexOf(term, pos)
    if (found < 0) return { count, first }
    if (first < 0) first = found
    count++
    pos = found + term.length
  }
}

/** 检查索引是否可用:文件存在且未过期(过期仅告警不阻断,由 kb:warm 重建) */
export function isPdfIndexReady(indexDir: string): boolean {
  const meta = getPdfIndexMeta(indexDir)
  if (!meta) return false
  const builtAt = new Date(meta.builtAt).getTime()
  return Date.now() - builtAt < INDEX_MAX_AGE_MS
}

/** 获取索引元数据(不加载完整索引) */
export function getPdfIndexMeta(indexDir: string): PdfIndexMeta | null {
  const indexPath = join(indexDir, 'index.json')
  if (!existsSync(indexPath)) return null
  try {
    const raw = JSON.parse(readFileSync(indexPath, 'utf8'))
    if (raw?.version !== PDF_INDEX_FORMAT_VERSION || !raw?.meta) return null
    return raw.meta as PdfIndexMeta
  } catch {
    return null
  }
}

// ========== KnowledgeItem 映射(供 ima-api 三通道合并使用) ==========

/**
 * 将 PDF 检索结果转换为 KnowledgeItem
 * highlight 用 <em> 标记命中词(与 note 通道格式一致,展示前由 cleanHighlight 统一剥离)
 */
export function pdfHitToKnowledgeItem(hit: PdfSearchHit): KnowledgeItem {
  const locator = [hit.page ? `第${hit.page}页` : '', hit.chapter ?? ''].filter(Boolean).join(' ')
  return {
    media_id: hit.mediaId,
    title: hit.title,
    summary: locator ? `[PDF ${locator}]` : '[PDF 原文]',
    from: 'pdf_content',
    highlight: markHighlightTerms(hit.text, hit.matchedTerms)
  }
}

/** 围绕最早命中的关键词截取上下文并标记 */
function markHighlightTerms(text: string, terms: string[]): string {
  let earliest = -1
  for (const term of terms) {
    const idx = text.indexOf(term)
    if (idx >= 0 && (earliest < 0 || idx < earliest)) earliest = idx
  }
  if (earliest < 0) {
    return text.length > HIGHLIGHT_CONTEXT_CHARS ? `${text.slice(0, HIGHLIGHT_CONTEXT_CHARS)}…` : text
  }
  const start = Math.max(0, earliest - 100)
  const end = Math.min(text.length, earliest + HIGHLIGHT_CONTEXT_CHARS - 100)
  let snippet = text.slice(start, end)
  if (start > 0) snippet = `…${snippet}`
  if (end < text.length) snippet = `${snippet}…`

  // 合并为单次替换且长词优先:逐个 replace 会让短词命中已插入的 <em> 标签内部(产生嵌套标记)
  const pattern = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((term) => escapeRegex(term))
    .join('|')
  if (!pattern) return snippet
  return snippet.replace(new RegExp(pattern, 'g'), (match) => `<em>${match}</em>`)
}

/** 正则转义(词元可能含 + . 等符号) */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
