# 方案 D：三通道混合检索 — 功能实现文档

## 1. 概述

本文档是 [pdf-search-channel-architecture.md](./pdf-search-channel-architecture.md) 的实现指南，按文件逐步描述代码变更，开发者可按顺序完成实现。

**实现范围**：

| 操作 | 文件 | 变更量估计 |
|------|------|----------|
| 新增 | `src/ima/pdf-content-search.ts` | ~350 行 |
| 修改 | `src/ima/ima-api.ts` | ~50 行改动 |
| 修改 | `src/tools/generate-advice.ts` | ~30 行改动 |
| 修改 | `src/scripts/warm-kb-cache.ts` | ~20 行改动 |
| 新增 | `src/ima/pdf-content-search.test.ts` | ~200 行测试 |

**前置依赖**：无新 npm 依赖。分词使用内置 n-gram 兜底方案，可选安装 `jieba-wasm` 提升精度。

> **⚠️ 前置条件（必须先完成）**
>
> 本实现文档描述的是方案 D 完整版（P2 阶段）。在开始实现前，必须先完成以下前置工作，否则索引建好了，最关键的病害书籍依然在盲区：
>
> 1. **OCR 12 本扫描件（2,572 页）**：CPU 一次性批处理，解锁全部病害/鲈鱼/用药内容
> 2. **处理 3 本超限书（>100MB）**：提高上限或流式分片解析
> 3. **修复缓存目录 CWD 漂移**：`AQUASENSE_CACHE_DIR` 默认值改为绝对路径
> 4. **P1 轻量验证**：在缓存上做 substring 检索，验证 PDF 通道引用质量
>
> 详见 [ima-pdf-note-limitation.md §8](./ima-pdf-note-limitation.md#8-建议与下一步) 和 [pdf-search-channel-architecture.md §1.4](./pdf-search-channel-architecture.md#14-前置条件实测验证)。

---

## 2. 实现步骤

### Step 1: 新增 `src/ima/pdf-content-search.ts`

这是核心新模块，包含离线索引构建和运行时检索两大功能。

#### 2.1 类型定义

```typescript
/** 切片(Chunk) */
export interface PdfChunk {
  mediaId: string
  title: string
  page: number
  chapter: string | null
  text: string
  index: number
}

/** 倒排索引条目(序列化到 index.json) */
interface SerializableIndexEntry {
  chunkIndices: number[]
  termFreqs: Record<string, number>  // key 是 chunkIndex 的字符串形式
}

/** 索引元数据 */
export interface PdfIndexMeta {
  builtAt: string
  totalChunks: number
  pdfCount: number
  pdfs: Array<{
    mediaId: string
    title: string
    chunkCount: number
    totalPages: number
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
  page: number
  chapter: string | null
  score: number
  matchedTerms: string[]
  from: 'pdf_content'
}

/** 索引数据(运行时) */
interface PdfIndexData {
  meta: PdfIndexMeta
  chunks: PdfChunk[]
  invertedIndex: Map<string, { chunkIndices: number[]; termFreqs: Map<number, number> }>
}
```

#### 2.2 常量与配置

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 切片大小(字符数) */
const CHUNK_SIZE = 512
/** 切片重叠(字符数) */
const CHUNK_OVERLAP = 100
/** 检索返回条数上限 */
const SEARCH_TOP_K = 5
/** 索引有效期(7天) */
const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** 章节标题检测正则 */
const CHAPTER_PATTERNS = [
  /^(第[一二三四五六七八九十百千\d]+[章节篇])\s*(.+)/,      // 第X章/第X节
  /^Chapter\s+(\d+)\s+(.+)/i,                               // Chapter X
  /^(\d+(?:\.\d+)*)\s+(.{2,20})$/,                          // 3.2.1 白点病
  /^([A-Z]\.\d+(?:\.\d+)*)\s+(.{2,20})$/,                  // A.1 附录
]

/** 水产领域自定义词典(提升分词精度) */
const AQUACULTURE_LEXICON = [
  '白点病', '小瓜虫', '水霉病', '烂鳃病', '肠炎病', '赤皮病',
  '氨氮', '亚硝酸盐', '溶氧', '水色',
  '鲈鱼', '草鱼', '鲤鱼', '鲫鱼', '对虾',
  '福尔马林', '亚甲基蓝', '高锰酸钾', '二氧化氯', '聚维酮碘',
  '罗茨风机', '微孔曝气', '循环水', '生物滤池',
]

/** 停用词 */
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '有', '把', '被', '对', '为',
  '与', '及', '或', '等', '中', '上', '下', '内', '外', '不',
  '也', '都', '就', '到', '从', '以', '用', '可', '能', '会',
  '这', '那', '其', '所', '之', '但', '而', '则', '因', '由',
  '将', '已', '于', '每', '各', '按', '经', '使', '如', '若',
])
```

#### 2.3 中文分词(三级降级)

```typescript
/**
 * 中文分词:三级降级策略
 * Level 1: jieba-wasm 精确模式(需安装,准确率高)
 * Level 2: n-gram 滑窗(n=2,3) 兜底(零依赖)
 * Level 3: 原始关键词直接匹配(最终兜底,在 searchPdfContent 中处理)
 */
function tokenizeChinese(text: string): string[] {
  // 尝试 Level 1: jieba-wasm
  try {
    // jieba-wasm 的 Node.js 用法
    const jieba = require('jieba-wasm')
    jieba.loadDict()  // 首次加载
    const words: string[] = jieba.cut(text, true)  // 精确模式
    return words
      .filter(w => w.trim().length > 0 && !STOP_WORDS.has(w))
  } catch {
    // jieba-wasm 不可用,降级到 Level 2
  }

  // Level 2: n-gram
  return ngramTokenize(text)
}

/** n-gram 分词(2-gram + 3-gram) */
function ngramTokenize(text: string): string[] {
  const clean = text.replace(/[\s\n\r\t,，。！？、；：""''（）\[\]【】]/g, '')
  const terms = new Set<string>()

  // 2-gram
  for (let i = 0; i < clean.length - 1; i++) {
    const bigram = clean.slice(i, i + 2)
    if (!STOP_WORDS.has(bigram)) terms.add(bigram)
  }
  // 3-gram
  for (let i = 0; i < clean.length - 2; i++) {
    const trigram = clean.slice(i, i + 3)
    if (!STOP_WORDS.has(trigram)) terms.add(trigram)
  }

  return [...terms]
}

/** 查询词分词:对用户输入做分词 */
function tokenizeQuery(query: string): string[] {
  const terms = tokenizeChinese(query)
  // 同时保留原始查询词(兜底:确保原始关键词能匹配)
  const rawTerms = query.split(/\s+/).filter(w => w.length >= 2)
  return [...new Set([...terms, ...rawTerms])]
}
```

#### 2.4 离线索引构建

```typescript
/**
 * 从 cache/pdf/*.txt 构建倒排索引
 * @param cachePdfDir  PDF 缓存目录(如 ./cache/pdf/)
 * @param indexDir     索引输出目录(如 ./cache/pdf-index/)
 * @returns 构建的索引元数据
 */
export async function buildPdfIndex(
  cachePdfDir: string,
  indexDir: string
): Promise<PdfIndexMeta> {
  mkdirSync(indexDir, { recursive: true })

  // Step 1: 加载有效 PDF 文本
  const pdfFiles = readdirSync(cachePdfDir).filter(f => f.endsWith('.txt'))
  const pdfTexts: Array<{ mediaId: string; text: string }> = []

  for (const filename of pdfFiles) {
    const mediaId = filename.replace('.txt', '')
    const text = readFileSync(join(cachePdfDir, filename), 'utf8')
    // 跳过标记文件
    if (text.startsWith('[')) continue
    if (text.length < 100) continue  // 太短无意义
    pdfTexts.push({ mediaId, text })
  }

  console.log(`[pdf-index] 加载 ${pdfTexts.length} 个有效 PDF 文本`)

  // Step 2: 按页分割 + 语义切片
  const allChunks: PdfChunk[] = []
  const pdfMeta: PdfIndexMeta['pdfs'] = []

  for (const { mediaId, text } of pdfTexts) {
    const title = extractTitleFromContent(text, mediaId)
    const pages = splitByPages(text)
    const chunks = chunkPages(pages, mediaId, title)

    pdfMeta.push({
      mediaId,
      title,
      chunkCount: chunks.length,
      totalPages: pages.length,
    })
    allChunks.push(...chunks)
  }

  // Step 3: 构建倒排索引
  const invertedIndex = new Map<string, { chunkIndices: number[]; termFreqs: Map<number, number> }>()

  for (const chunk of allChunks) {
    const terms = tokenizeChinese(chunk.text)
    const termCounts = new Map<string, number>()
    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) || 0) + 1)
    }

    for (const [term, count] of termCounts) {
      let entry = invertedIndex.get(term)
      if (!entry) {
        entry = { chunkIndices: [], termFreqs: new Map() }
        invertedIndex.set(term, entry)
      }
      entry.chunkIndices.push(chunk.index)
      entry.termFreqs.set(chunk.index, count)
    }
  }

  // Step 4: 持久化
  const meta: PdfIndexMeta = {
    builtAt: new Date().toISOString(),
    totalChunks: allChunks.length,
    pdfCount: pdfMeta.length,
    pdfs: pdfMeta,
    config: { chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP },
  }

  // 序列化倒排索引(Map -> Plain Object)
  const serializableIndex: Record<string, SerializableIndexEntry> = {}
  for (const [term, entry] of invertedIndex) {
    serializableIndex[term] = {
      chunkIndices: entry.chunkIndices,
      termFreqs: Object.fromEntries(entry.termFreqs),
    }
  }

  writeFileSync(join(indexDir, 'index.json'), JSON.stringify({ meta, invertedIndex: serializableIndex }), 'utf8')
  writeFileSync(join(indexDir, 'chunks.json'), JSON.stringify(allChunks), 'utf8')

  console.log(`[pdf-index] 构建完成: ${allChunks.length} 切片, ${invertedIndex.size} 词项, 索引 ${formatBytes(JSON.stringify(serializableIndex).length)}`)

  return meta
}

/** 按 Form Feed 或连续空行分割页 */
function splitByPages(text: string): string[] {
  // unpdf 输出用 \u0c (Form Feed) 分隔页
  let pages = text.split(/\u0c/)
  // 兜底:如果无 FF,按连续空行分割(每页间通常有 2+ 空行)
  if (pages.length <= 1) {
    pages = text.split(/\n{3,}/)
  }
  return pages.map(p => p.trim()).filter(p => p.length > 0)
}

/** 对每页做语义切片 */
function chunkPages(
  pages: string[],
  mediaId: string,
  title: string
): PdfChunk[] {
  const chunks: PdfChunk[] = []
  let globalIndex = 0

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx]
    const page = pageIdx + 1  // 1-based

    // 检测章节标题
    const chapter = detectChapter(pageText)

    // 按句切分
    const sentences = pageText
      .split(/(?<=[。！？!?;；\n])/)
      .map(s => s.trim())
      .filter(s => s.length > 0)

    // 滑动窗口切片
    let buffer = ''
    let bufferStart = 0
    for (let i = 0; i < sentences.length; i++) {
      const candidate = buffer ? buffer + sentences[i] : sentences[i]
      if (candidate.length > CHUNK_SIZE && buffer.length > 0) {
        // 输出当前 buffer 为一个 chunk
        chunks.push({
          mediaId, title, page, chapter,
          text: buffer.trim(),
          index: globalIndex++,
        })
        // overlap: 保留 buffer 末尾 OVERLAP 字符
        const overlapText = buffer.length > CHUNK_OVERLAP
          ? buffer.slice(buffer.length - CHUNK_OVERLAP)
          : buffer
        buffer = overlapText + sentences[i]
      } else {
        buffer = candidate
      }
    }
    // 输出剩余 buffer
    if (buffer.trim().length > 50) {  // 太短的 chunk 丢弃
      chunks.push({
        mediaId, title, page, chapter,
        text: buffer.trim(),
        index: globalIndex++,
      })
    }
  }

  return chunks
}

/** 检测章节标题 */
function detectChapter(text: string): string | null {
  // 取文本前200字符检测(章节标题通常在段落开头)
  const head = text.slice(0, 200)
  for (const pattern of CHAPTER_PATTERNS) {
    const match = head.match(pattern)
    if (match) {
      return match[0].trim().slice(0, 60)  // 限制长度
    }
  }
  return null
}

/** 从文本开头提取标题(文件名 fallback) */
function extractTitleFromContent(text: string, mediaId: string): string {
  // 尝试从文本前几行提取标题
  const lines = text.split('\n').slice(0, 5)
  for (const line of lines) {
    const trimmed = line.trim()
    // 标题特征:较短、无句号、中文字数 > 4
    if (trimmed.length >= 4 && trimmed.length <= 40 && !/[。！？]/.test(trimmed)) {
      return trimmed
    }
  }
  return mediaId  // fallback 用 mediaId
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}
```

#### 2.5 运行时检索

```typescript
/** 运行时索引缓存(单例) */
let cachedIndex: PdfIndexData | null = null

/**
 * 加载索引到内存(懒加载,首次调用时加载)
 */
function loadIndex(indexDir: string): PdfIndexData | null {
  if (cachedIndex) return cachedIndex

  const indexPath = join(indexDir, 'index.json')
  const chunksPath = join(indexDir, 'chunks.json')

  if (!existsSync(indexPath) || !existsSync(chunksPath)) {
    console.warn('[pdf-index] 索引文件不存在,通道 C 不可用')
    return null
  }

  try {
    const raw = JSON.parse(readFileSync(indexPath, 'utf8'))
    const chunks: PdfChunk[] = JSON.parse(readFileSync(chunksPath, 'utf8'))

    // 反序列化倒排索引(Plain Object -> Map)
    const invertedIndex = new Map<string, { chunkIndices: number[]; termFreqs: Map<number, number> }>()
    for (const [term, entry] of Object.entries(raw.invertedIndex as Record<string, SerializableIndexEntry>)) {
      invertedIndex.set(term, {
        chunkIndices: entry.chunkIndices,
        termFreqs: new Map(Object.entries(entry.termFreqs).map(([k, v]) => [Number(k), v])),
      })
    }

    cachedIndex = { meta: raw.meta, chunks, invertedIndex }
    console.log(`[pdf-index] 加载成功(${raw.meta.pdfCount} PDF, ${raw.meta.totalChunks} chunks)`)
    return cachedIndex
  } catch (error) {
    console.error('[pdf-index] 索引加载失败:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 在 PDF 原文中检索关键词
 * @param query 用户查询(如 "白点 小瓜虫 治疗")
 * @param indexDir 索引目录
 * @returns 匹配结果(含页码/章节/上下文)
 */
export function searchPdfContent(query: string, indexDir: string): PdfSearchHit[] {
  const index = loadIndex(indexDir)
  if (!index) return []

  // 1. 查询分词
  const queryTerms = tokenizeQuery(query)
  if (queryTerms.length === 0) return []

  // 2. 倒排索引查询:统计每个 chunk 的得分
  const chunkScores = new Map<number, { score: number; matchedTerms: string[] }>()

  for (const term of queryTerms) {
    const entry = index.invertedIndex.get(term)
    if (!entry) continue

    for (const chunkIdx of entry.chunkIndices) {
      const tf = entry.termFreqs.get(chunkIdx) || 1
      const existing = chunkScores.get(chunkIdx)
      if (existing) {
        existing.score += tf
        existing.matchedTerms.push(term)
      } else {
        chunkScores.set(chunkIdx, { score: tf, matchedTerms: [term] })
      }
    }
  }

  // 3. 排序 + 取 top-K
  const sorted = [...chunkScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, SEARCH_TOP_K * 2)  // 先多取,后面去重

  // 4. 相邻 chunk 合并 + 去重
  const results: PdfSearchHit[] = []
  const seenPdfPage = new Set<string>()

  for (const [chunkIdx, { score, matchedTerms }] of sorted) {
    const chunk = index.chunks[chunkIdx]
    if (!chunk) continue

    // 同一 PDF 同一页只保留最高分
    const dedupeKey = `${chunk.mediaId}:${chunk.page}`
    if (seenPdfPage.has(dedupeKey)) continue
    seenPdfPage.add(dedupeKey)

    results.push({
      mediaId: chunk.mediaId,
      title: chunk.title,
      text: chunk.text,
      page: chunk.page,
      chapter: chunk.chapter,
      score,
      matchedTerms: [...new Set(matchedTerms)],
      from: 'pdf_content',
    })

    if (results.length >= SEARCH_TOP_K) break
  }

  console.log(`[pdf-index] 检索"${query.slice(0, 30)}" -> ${results.length} 条命中`)
  return results
}

/**
 * 检查索引是否可用
 */
export function isPdfIndexReady(indexDir: string): boolean {
  const indexPath = join(indexDir, 'index.json')
  if (!existsSync(indexPath)) return false
  try {
    const raw = JSON.parse(readFileSync(indexPath, 'utf8'))
    const builtAt = new Date(raw.meta.builtAt).getTime()
    return Date.now() - builtAt < INDEX_MAX_AGE_MS
  } catch {
    return false
  }
}

/**
 * 获取索引元数据(不加载完整索引)
 */
export function getPdfIndexMeta(indexDir: string): PdfIndexMeta | null {
  const indexPath = join(indexDir, 'index.json')
  if (!existsSync(indexPath)) return null
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8')).meta
  } catch {
    return null
  }
}
```

---

### Step 2: 修改 `src/ima/ima-api.ts`

#### 2.1 KnowledgeItem 类型扩展

在 `KnowledgeItem` 接口中新增 `'pdf_content'` 来源：

```typescript
// 修改前
from?: 'wiki' | 'note'

// 修改后
from?: 'wiki' | 'note' | 'pdf_content'
```

#### 2.2 新增导出 searchKnowledgeMerged

将 `generate-advice.ts` 中的 `searchKnowledgeMerged` 函数**迁移**到 `ima-api.ts` 中，使其成为 `ima-api` 模块的公开 API。原因：三通道合并逻辑依赖 `pdf-content-search` 模块，放在 `ima-api` 中更合理。

具体操作：

1. 从 `generate-advice.ts` 中**剪切** `searchKnowledgeMerged`、`HitPool`、`collectHits`、`rankByHits` 函数
2. 在 `ima-api.ts` 中**粘贴**这些函数，并修改 import
3. 在 `generate-advice.ts` 中改为从 `ima-api.js` 导入 `searchKnowledgeMerged`

#### 2.3 searchKnowledgeMerged 三通道改造

在 `searchKnowledgeMerged` 函数中新增通道 C：

```typescript
// 在 ima-api.ts 中新增 import
import {
  searchPdfContent,
  isPdfIndexReady,
  pdfHitToKnowledgeItem  // 需要从 pdf-content-search 导出
} from './pdf-content-search.js'

// 修改后的 searchKnowledgeMerged
async function searchKnowledgeMerged(rawQuery: string): Promise<SearchResult> {
  const lowValueWords = new Set(['的', '了', '和', '是', '在', '有', '把', '被'])
  const keywords = rawQuery
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 1 && !lowValueWords.has(w))
  const uniqueKeywords = [...new Set(keywords)]
  if (uniqueKeywords.length === 0) uniqueKeywords.push(rawQuery)

  // 通道 A + B (原有逻辑不变)
  const wikiHits: HitPool = new Map()
  const noteHits: HitPool = new Map()
  for (const kw of uniqueKeywords) {
    try { collectHits(await searchKnowledge(kw), wikiHits) } catch {}
    try { collectHits(await searchNote(kw), noteHits) } catch {}
  }

  // 通道 C: 本地 PDF 原文检索 (新增)
  const pdfHits = isPdfIndexReady(PDF_INDEX_DIR)
    ? searchPdfContent(rawQuery, PDF_INDEX_DIR)
    : []

  // 三通道合并
  const merged: KnowledgeItem[] = []
  const seenIds = new Set<string>()
  const seenTitles = new Set<string>()

  // 第一轮: 各通道最高质量
  const noteRanked = rankByHits(noteHits)
  const wikiRanked = rankByHits(wikiHits)

  // note 高亮优先(有 highlight 的)
  const noteHighlights = noteRanked.filter(item => item.highlight)
  const noteBodies = noteRanked.filter(item => !item.highlight)

  const candidates: KnowledgeItem[] = [
    ...noteHighlights.slice(0, 2),
    ...pdfHits.slice(0, 3).map(hit => pdfHitToKnowledgeItem(hit)),
    ...noteBodies.slice(0, 1),
    ...wikiRanked.slice(0, 1),
  ]

  for (const item of candidates) {
    if (seenIds.has(item.media_id) || seenTitles.has(item.title)) continue
    seenIds.add(item.media_id)
    seenTitles.add(item.title)
    merged.push(item)
  }

  // 补充: 如果不够 7 条,从各通道继续补充
  const补充源 = [
    ...noteHighlights.slice(2),
    ...pdfHits.slice(3),
    ...noteBodies.slice(1),
    ...wikiRanked.slice(1),
  ]
  for (const item of 补充源) {
    if (merged.length >= 7) break
    if (seenIds.has(item.media_id) || seenTitles.has(item.title)) continue
    seenIds.add(item.media_id)
    seenTitles.add(item.title)
    merged.push(item)
  }

  return { items: merged.slice(0, 7), total: merged.length }
}
```

#### 2.4 pdfHitToKnowledgeItem 函数

在 `pdf-content-search.ts` 中导出：

```typescript
import { KnowledgeItem } from './ima-api.js'

/**
 * 将 PDF 检索结果转换为 KnowledgeItem
 * highlight 字段用 <em> 标记命中关键词,复用 extractExcerpts 的 cleanHighlight 逻辑
 */
export function pdfHitToKnowledgeItem(hit: PdfSearchHit): KnowledgeItem {
  return {
    media_id: hit.mediaId,
    title: hit.title,
    summary: `[PDF ${hit.page}页${hit.chapter ? ' ' + hit.chapter : ''}]`,
    from: 'pdf_content',
    highlight: markHighlightTerms(hit.text, hit.matchedTerms),
  }
}

/** 在文本中用 <em> 标记匹配的关键词 */
function markHighlightTerms(text: string, terms: string[]): string {
  if (terms.length === 0) return text
  // 找到第一个关键词的位置,截取上下文
  let earliest = text.length
  for (const term of terms) {
    const idx = text.indexOf(term)
    if (idx >= 0 && idx < earliest) earliest = idx
  }
  // 围绕第一个命中词截取上下文(约 300 字符)
  const start = Math.max(0, earliest - 100)
  const end = Math.min(text.length, earliest + 200)
  let snippet = text.slice(start, end)
  if (start > 0) snippet = '...' + snippet
  if (end < text.length) snippet = snippet + '...'

  // 标记关键词
  for (const term of terms) {
    snippet = snippet.replace(new RegExp(escapeRegex(term), 'g'), `<em>${term}</em>`)
  }
  return snippet
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

---

### Step 3: 修改 `src/tools/generate-advice.ts`

#### 3.1 更新 import

```typescript
// 修改前
import {
  searchKnowledge,
  searchNote,
  getMediaContent,
  getNoteContentByNoteId,
  type SearchResult,
  type KnowledgeItem
} from '../ima/ima-api.js'

// 修改后
import {
  searchKnowledgeMerged,  // 新增:从 ima-api 导入三通道版本
  getMediaContent,
  getNoteContentByNoteId,
  type SearchResult,
  type KnowledgeItem
} from '../ima/ima-api.js'
```

#### 3.2 删除迁移的函数

从 `generate-advice.ts` 中删除以下函数（已迁移到 `ima-api.ts`）：
- `searchKnowledgeMerged`
- `HitPool` 类型
- `collectHits`
- `rankByHits`

删除合并参数常量（已迁移到 `ima-api.ts`）：
- `NOTE_MERGE_LIMIT`
- `WIKI_MERGE_LIMIT`
- `MERGED_LIMIT`

#### 3.3 extractExcerpts 适配

在 `extractExcerpts` 函数中，pdf_content 通道的条目已经通过 `highlight` 字段传递了标记后的文本，所以**现有逻辑无需修改**——`item.highlight` 非空时会走 `cleanHighlight` 路径。

只需确认 `cleanHighlight` 能正确处理 pdf_content 的 `<em>` 标记（现有实现已支持）。

#### 3.4 buildReasoning 适配

在 `buildReasoning` 函数中，可以增加 PDF 原文引用的信息源标注：

```typescript
function buildReasoning(
  analysis: AnalysisInput,
  excerpts: Array<{ title: string; text: string; from?: string }>,
  hitCount: number
): string {
  const symptoms = analysis.symptoms?.length ? analysis.symptoms.join('、') : '无明显症状'
  if (excerpts.length > 0) {
    const pdfCount = excerpts.filter(e => e.from === 'pdf_content').length
    const noteCount = excerpts.length - pdfCount
    const titles = excerpts.map(e => `《${e.title}》`).join('')

    let sourceNote = ''
    if (pdfCount > 0 && noteCount > 0) {
      sourceNote = `引用来源: ${pdfCount} 条 PDF 原文 + ${noteCount} 条笔记`
    } else if (pdfCount > 0) {
      sourceNote = '引用来源: PDF 原文(一手文献)'
    } else {
      sourceNote = '引用来源: 笔记(AI 二次汇总)'
    }

    return `症状「${symptoms}」在知识库${titles}中定位到相关原文(见 knowledge_excerpt);${sourceNote};结合视觉分类「${analysis.cls || 'unknown'}」与严重程度「${analysis.severity || 'low'}」按疑似情形处置。知识库比对不构成确诊,重症请兽医到场核实。`
  }
  // ... 其余分支不变
}
```

**注意**：需要在 `extractExcerpts` 返回的数组中携带 `from` 信息。可以在返回时添加：

```typescript
// 在 extractExcerpts 的 results.push 中增加 from
results.push({ title: item.title, text: quote, from: item.from })
```

---

### Step 4: 修改 `src/scripts/warm-kb-cache.ts`

#### 4.1 新增 import

```typescript
import {
  // ... 原有 import 不变
} from '../ima/ima-api.js'

// 新增
import { buildPdfIndex, getPdfIndexMeta } from '../ima/pdf-content-search.js'
import { join } from 'node:path'
```

#### 4.2 预热结束后触发索引构建

在 `main()` 函数的汇总输出之后，新增索引构建步骤：

```typescript
async function main(): Promise<void> {
  // ... 原有预热逻辑不变 ...

  // ===== 新增: 构建 PDF 倒排索引 =====
  console.log('')
  console.log('[kb:warm] ===== PDF 索引构建 =====')

  const cachePdfDir = join(process.env.AQUASENSE_CACHE_DIR || './cache', 'pdf')
  const indexDir = join(process.env.AQUASENSE_CACHE_DIR || './cache', 'pdf-index')

  // 检查是否需要重建
  const existingMeta = getPdfIndexMeta(indexDir)
  const pdfTxtCount = readdirSync(cachePdfDir)
    .filter(f => f.endsWith('.txt') && !f.startsWith('[')).length

  if (existingMeta && existingMeta.pdfCount === pdfTxtCount && !isIndexStale(existingMeta)) {
    console.log(`[kb:warm] PDF 索引已是最新(${existingMeta.pdfCount} PDF, ${existingMeta.totalChunks} chunks),跳过`)
  } else {
    const reason = !existingMeta ? '索引不存在'
      : existingMeta.pdfCount !== pdfTxtCount ? `PDF 数量变化(${existingMeta.pdfCount} -> ${pdfTxtCount})`
      : '索引已过期'
    console.log(`[kb:warm] 需要重建索引: ${reason}`)

    try {
      const meta = await buildPdfIndex(cachePdfDir, indexDir)
      console.log(`[kb:warm] PDF 索引构建完成: ${meta.totalChunks} 切片, ${meta.pdfCount} PDF`)
    } catch (error) {
      console.error('[kb:warm] PDF 索引构建失败:', error instanceof Error ? error.message : error)
      console.log('[kb:warm] 提示: 索引构建失败不影响运行时降级,通道 C 将不可用')
    }
  }
}

function isIndexStale(meta: { builtAt: string }): boolean {
  const builtAt = new Date(meta.builtAt).getTime()
  return Date.now() - builtAt > 7 * 24 * 60 * 60 * 1000
}
```

---

### Step 5: 新增测试文件 `src/ima/pdf-content-search.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildPdfIndex, searchPdfContent, isPdfIndexReady } from './pdf-content-search.js'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TEST_CACHE_DIR = './test-cache/pdf'
const TEST_INDEX_DIR = './test-cache/pdf-index'

describe('pdf-content-search', () => {
  beforeAll(() => {
    mkdirSync(TEST_CACHE_DIR, { recursive: true })
    mkdirSync(TEST_INDEX_DIR, { recursive: true })

    // 创建测试 PDF 文本缓存
    writeFileSync(join(TEST_CACHE_DIR, 'test-pdf-1.txt'),
      '第一章 鲈鱼养殖概述\n\n鲈鱼是我国重要的淡水养殖鱼类。鲈鱼养殖需要注意水质管理。\n\n' +
      '第二章 常见病害\n\n白点病(小瓜虫病):病原为多子小瓜虫,适宜水温15-28度。\n' +
      '治疗方案:①福尔马林25ppm药浴 ②亚甲基蓝2ppm全池泼洒。\n' +
      '注意事项:鲈鱼对有机磷敏感,禁用敌百虫。'
    , 'utf8')

    writeFileSync(join(TEST_CACHE_DIR, 'test-pdf-2.txt'),
      '第三章 水质管理\n\n氨氮是水质管理的重要指标。氨氮超标会导致鱼类中毒。\n' +
      '氨氮处理:使用沸石粉吸附,或加大换水量。溶氧应保持在5mg/L以上。'
    , 'utf8')
  })

  afterAll(() => {
    rmSync('./test-cache', { recursive: true, force: true })
  })

  it('buildPdfIndex 应正确构建索引', async () => {
    const meta = await buildPdfIndex(TEST_CACHE_DIR, TEST_INDEX_DIR)

    expect(meta.pdfCount).toBe(2)
    expect(meta.totalChunks).toBeGreaterThan(0)
    expect(existsSync(join(TEST_INDEX_DIR, 'index.json'))).toBe(true)
    expect(existsSync(join(TEST_INDEX_DIR, 'chunks.json'))).toBe(true)
  })

  it('isPdfIndexReady 应返回 true', () => {
    expect(isPdfIndexReady(TEST_INDEX_DIR)).toBe(true)
  })

  it('searchPdfContent 应命中白点病相关切片', () => {
    const results = searchPdfContent('白点病 小瓜虫', TEST_INDEX_DIR)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].from).toBe('pdf_content')
    expect(results[0].title).toContain('test-pdf')
    expect(results[0].page).toBeGreaterThan(0)
    expect(results[0].matchedTerms).toContain('白点病')
  })

  it('searchPdfContent 应命中氨氮相关切片', () => {
    const results = searchPdfContent('氨氮 水质', TEST_INDEX_DIR)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].text).toContain('氨氮')
  })

  it('searchPdfContent 应对无匹配返回空', () => {
    const results = searchPdfContent('完全不存在的关键词XYZ', TEST_INDEX_DIR)
    expect(results.length).toBe(0)
  })

  it('searchPdfContent 索引不存在时应返回空', () => {
    const results = searchPdfContent('白点病', './nonexistent-dir')
    expect(results.length).toBe(0)
  })
})
```

---

## 3. 部署清单

### 3.1 环境检查

```bash
# 确认 Node.js 版本 >= 22.19.0
node --version

# 确认 PDF 缓存已预热
ls cache/pdf/*.txt | wc -l  # 应 > 50

# 可选: 安装 jieba-wasm 提升分词精度
npm install jieba-wasm
```

### 3.2 构建索引

```bash
# 方式 1: 在预热脚本中自动构建(推荐)
npm run kb:warm

# 方式 2: 单独运行索引构建(调试用)
npx tsx -e "
  import { buildPdfIndex } from './src/ima/pdf-content-search.js'
  buildPdfIndex('./cache/pdf', './cache/pdf-index')
    .then(m => console.log('Done:', m.totalChunks, 'chunks'))
"
```

### 3.3 验证

```bash
# 验证索引文件生成
ls -la cache/pdf-index/
# 应看到 index.json (~500KB) 和 chunks.json (~5MB)

# 验证查询
npx tsx -e "
  import { searchPdfContent } from './src/ima/pdf-content-search.js'
  const hits = searchPdfContent('白点病 治疗', './cache/pdf-index')
  hits.forEach(h => console.log(h.title, h.page + '页', h.text.slice(0, 80)))
"

# 运行测试
npx vitest run src/ima/pdf-content-search.test.ts
```

### 3.4 回滚方案

如果通道 C 出现问题：

1. 删除 `cache/pdf-index/` 目录 -> 系统自动降级回双通道
2. 或在 `ima-api.ts` 中注释掉通道 C 的调用行

---

## 4. 常见问题

### Q: 索引构建很慢怎么办？

84 个 PDF 约需 30 秒。如果更慢，检查：
- PDF 缓存文件是否过大（>100MB 的文件已被 warm-kb-cache 跳过）
- 是否安装了 jieba-wasm（未安装时 n-gram 分词更快但精度略低）

### Q: 分词效果不好导致召回率低？

1. 安装 jieba-wasm: `npm install jieba-wasm`
2. 扩充水产词典: 在 `AQUACULTURE_LEXICON` 中添加新词
3. 查询时用空格分隔关键词（如 "白点 小瓜虫 治疗"），系统会逐词查询

### Q: 4G 服务器内存不够？

检查索引大小:
```bash
wc -c cache/pdf-index/chunks.json
```
如果 > 20MB，考虑减少 `CHUNK_SIZE`（从 512 降到 256）以减少 chunks 数量。

### Q: 如何更新索引？

执行 `npm run kb:warm`，脚本会自动检测 PDF 数量变化并重建索引。
