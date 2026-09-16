# 方案 D：三通道混合检索 — 功能架构设计文档

## 1. 背景与目标

### 1.1 问题回顾

当前 `aquasense_advice` 工具通过 IMA 双通道检索获取知识库参考：

- **通道 A (wiki)**：`searchKnowledge` — 仅索引文件名/文件夹名，正文关键词命中率为 0
- **通道 B (note)**：`searchNote` — 索引笔记正文全文，命中处带回高亮原文

核心矛盾：笔记是 IMA 平台 AI 对原始 PDF 的**二次汇总**，信息保真度约 30%，经过搜索命中+截断后仅保留原始文献约 5% 的信息量。

### 1.2 方案目标

新增**通道 C (pdf_content)**，直接检索 PDF 原文内容，使引用信息源从"AI 二次汇总"提升为"原始文献原文"。

**量化目标**：

| 指标 | 当前（仅 note） | 目标（三通道） |
|------|----------------|---------------|
| 引用信息保真度 | ~5%（笔记摘录截断） | ~10%（PDF 原文片段） |
| 正文关键词可搜率 | 仅笔记覆盖的内容 | 所有 PDF 原文 |
| 信息源可信度 | AI 汇总（二手） | 原始文献（一手） |
| 检索延迟增量 | 0 | <50ms（本地索引查询） |
| 内存增量 | 0 | <300MB |

### 1.3 设计约束

- **4 核 4G 云服务器**：不引入向量模型、不使用 GPU、不做多模态
- **不改动 IMA 外部 API 调用**：通道 C 完全基于本地数据
- **复用已有的 PDF 缓存**：`warm-kb-cache` 预热的 `cache/pdf/*.txt` 文件
- **向后兼容**：通道 C 不可用时自动降级回双通道模式
- **零运维**：索引构建集成到 `warm-kb-cache` 脚本，运行时自动加载；扫描件兜底 OCR 为可选离线步骤（`npm run ocr`，不执行时通道 C 对扫描件保持降级）

### 1.4 前置条件（实测验证）

方案 D 的收益建立在"PDF 全文可提取"的假设上。对 25 本书的实测结果:

| 类别 | 数量 | 占比 | 影响 |
|------|------|------|------|
| 可索引(有文本层) | 10/25 | 40% | 营养/饲料/行为为主 |
| 不可用(扫描件) | 12/25 | 48% | **病害/鲈鱼/用药书籍**,2,572 页 |
| 不可用(超限 >100MB) | 3/25 | 12% | 含核心病害书《鱼类病毒和细菌》 |

**关键发现**:失败的 60% 恰好是 aquasense_advice 真正需要的病害/用药内容。可索引的 327 万字中,病害症状词仅 ~39 次命中。详见 [ima-pdf-note-limitation.md §5.4](./ima-pdf-note-limitation.md#54-实测验证pdf-可索引性分析)。

**因此,以下为方案 D 的硬性前置**:

| 前置项 | 成本 | 解锁内容 |
|--------|------|----------|
| OCR 12 本扫描件 | CPU 一次性批处理 3.3 小时(已验证);生产端已交付(`npm run ocr`,安装与语言包见 [deployment.md §3.7](./deployment.md)),批处理执行属运维操作 | 全部病害/鲈鱼/用药内容 |
| 处理 3 本超限书 | 提高上限或流式分片(上限已放宽至 100MB) | 3 本核心书籍 |
| 修复缓存 CWD 漂移 | 默认值改为绝对路径(如 Linux: `/data/aquasense/cache/`, Windows: `D:\data\aquasense\cache\`) | 索引与缓存一致性 + OCR 成果持久化 |

**⚠️ OCR 空格陷阱**:Tesseract chi_sim 会在每个汉字间插空格,入库前必须去空格归一化,否则通道 C 子串匹配全部失效(`白 点 病` 匹配不到 `白点病`,回归探测 0/8 → 去空格后 8/8)。落地为双保险:生产端整本发布前 strip,索引层对既有 OCR 缓存再做一次汉字间空格归一化并回写(实现见 [pdf-search-channel-implementation.md §5.1](./pdf-search-channel-implementation.md))。此问题仅影响 OCR 文本——unpdf 提取原生 PDF 的文本无此问题。

**当前状态**:通道 C(M1/M2)已交付并冒烟通过;M0 中仅 OCR 批处理执行为待办——执行 `npm run ocr` 后病害/用药内容即从索引盲区解锁(超限书仍待处理,见 [pdf-search-channel-implementation.md §5.4](./pdf-search-channel-implementation.md))。

---

## 2. 整体架构

### 2.1 三通道检索架构

```
用户查询: "白点 蹭壁 鲈鱼"
    |
    v
+----------------------------------------------------------+
|              searchKnowledgeMerged (三通道)                 |
|                                                          |
|  +----------+  +----------+  +--------------------+     |
|  | 通道 A    |  | 通道 B    |  | 通道 C (新增)       |     |
|  | wiki      |  | note     |  | pdf_content         |     |
|  |           |  |          |  |                      |     |
|  | 仅索引    |  | 索引笔记  |  | 索引 PDF 全文        |     |
|  | 文件名    |  | 正文全文  |  | (本地倒排索引)        |     |
|  |           |  | +高亮原文 |  | +上下文定位           |     |
|  | API:      |  | API:     |  | 本地:                 |     |
|  | search_   |  | search_  |  | pdf-index.json        |     |
|  | knowledge |  | note     |  | (离线构建)            |     |
|  +-----+-----+  +----+-----+  +-----------+--------+     |
|        |             |                     |              |
|        +-------------+---------------------+              |
|                      |                                    |
|           +----------------------+                        |
|           | 三路合并 + 去重 + 排序 |                        |
|           |                      |                        |
|           | 优先级:               |                        |
|           |  note 高亮 >         |                        |
|           |  pdf_content 原文 >  |                        |
|           |  note 正文摘取 >      |                        |
|           |  wiki 标题匹配       |                        |
|           +----------------------+                        |
|                      |                                    |
|                      v                                    |
|              KnowledgeItem[] (最多 7 条)                   |
+----------------------------------------------------------+
```

### 2.2 信息流全景

```
                    离线预处理                          实时查询
                    --------                          --------
                    IMA OpenAPI                       IMA OpenAPI
                        |                               |
          +-------------+-------------+                 |
          v             v             v                 v
     PDF 下载    getMediaInfo     笔记读取     searchKnowledge
     (url_info)  (media_type)     (笔记)      searchNote
          |             |             |                 |
          v             v             v                 v
     unpdf         分类判定       缓存笔记        双通道查询
     文本提取      PDF/笔记
          |
          v
   cache/pdf/*.txt  <-- PDF 全文缓存
          |
          v                    warm-kb-cache.ts
   离线索引构建器  <---------- (扩展现有脚本)
   - 文本预处理
   - 按页/语义切片
   - 生成倒排索引
          |
          v
   cache/pdf-index/  <-- 索引存储目录
     index.json       (倒排索引 + 元数据)
     chunks.json      (切片原文)
          |
          v (运行时加载到内存)
   PdfContentSearch  <-- 新增模块
     searchPdfContent
     关键词匹配 + 上下文定位
          |
          v
   通道 C 结果 --> 合并到三通道 --> extractExcerpts --> 三段式输出
```

> **OCR 注**:扫描件(无文本层)的缓存落 `[扫描件 PDF:...]` 占位标记;`npm run ocr`(`src/scripts/ocr-scanned-pdfs.ts`)对标记文件逐页 OCR,整本完成后覆写同名缓存并触发索引重建——见 [deployment.md §3.7](./deployment.md)。

---

## 3. 核心模块设计

### 3.1 模块划分

```
src/
  ima/
    ima-api.ts              # [修改] 导出 searchKnowledgeMerged 三通道版本
    pdf-content-search.ts   # [新增] PDF 原文检索模块
  scripts/
    warm-kb-cache.ts        # [修改] 预热结束后触发索引构建
    ocr-scanned-pdfs.ts     # [新增] 扫描件 OCR 兜底生产端(npm run ocr)
  tools/
    generate-advice.ts      # [修改] extractExcerpts 支持 pdf_content 通道
```

### 3.2 模块职责

| 模块 | 文件 | 职责 | 依赖 |
|------|------|------|------|
| PDF 原文检索 | `pdf-content-search.ts` | 索引构建 + 关键词检索 + 页码定位 | `node:fs`, `node:path` |
| IMA API 封装 | `ima-api.ts` | 三通道合并检索 | `pdf-content-search.ts` |
| 处置建议生成 | `generate-advice.ts` | 引用提取与三段式输出 | `ima-api.ts` |
| 批量预热 | `warm-kb-cache.ts` | PDF 缓存预热 + 索引构建触发 | `ima-api.ts`, `pdf-content-search.ts` |
| OCR 兜底生产端 | `ocr-scanned-pdfs.ts` | 扫描件逐页 OCR + 逐页 checkpoint 续跑 + 整本完成才发布 | `unpdf`;`tesseract.js`/`@napi-rs/canvas`(可选依赖) |

---

## 4. pdf-content-search.ts 详细设计

### 4.1 数据模型

```typescript
/** 切片(Chunk) */
interface PdfChunk {
  mediaId: string          // 所属 PDF 的 IMA media_id
  title: string            // PDF 文件标题(书名)
  page: number | null      // 所在页码(1-based);无分页符时为 null
  chapter: string | null   // 章节标题(正则检测,可为 null)
  text: string             // 切片文本内容
  offset: number           // 切片在 PDF 全文中的起始字符偏移(用于重叠切片去重)
  index: number            // 切片在 chunks.json 中的索引位置
}

/** 索引元数据 */
interface PdfIndexMeta {
  builtAt: string          // 构建时间 ISO string
  totalChunks: number      // 总切片数
  pdfCount: number         // 索引的 PDF 数量
  pdfs: Array<{
    mediaId: string
    title: string
    chunkCount: number
    pageCount: number | null  // 页数;无分页符时为 null
  }>
  config: {
    chunkSize: number      // 默认 512 字符
    chunkOverlap: number   // 默认 100 字符
  }
}

/** 检索结果 */
interface PdfSearchHit {
  mediaId: string           // 所属 PDF 的 media_id
  title: string             // PDF 文件标题
  text: string              // 命中的切片文本
  page: number | null       // 命中页码(可能为 null)
  chapter: string | null    // 命中章节
  score: number             // 匹配得分
  matchedTerms: string[]    // 命中的关键词列表
  from: 'pdf_content'       // 固定来源标记
}
```

### 4.2 离线索引构建流程

```
cache/pdf/*.txt (已由 warm-kb-cache 预热)
    |
    v
Step 1: 加载 PDF 文本文件
  for each mediaId.txt in cache/pdf/
    - 跳过 [PDF 超限:...] 和 [扫描件 PDF:...] 标记文件
    - 读取 getMediaInfo 获取 title
    - 保留有效文本内容
    - **OCR 文本归一化**:检测是否为 OCR 来源(如文件头含 [OCR 批处理] 标记)
      → 去除汉字间空格(落地修正:改为单次 lookbehind/lookahead 正则;
         replace(/\s+/g,'') 对长间隔空格序列不彻底。生产端发布时已 strip,此处为兜底)
      → 归一化后覆写缓存(一次性操作)

    |
    v
Step 2: 按页分割
  - unpdf 默认输出用 Form Feed (\\f) 分隔页
  - 按 \\f 或连续空行识别页边界
  - 每页记录: page_number + page_text

    |
    v
Step 3: 语义切片
  对每页文本:
    - 按句号(。！？)切分为句子
    - 滑动窗口: chunk_size=512 字符, overlap=100 字符
    - 保留上下文连续性(不在句子中间截断)
    - 每个 chunk 附加元数据: { mediaId, title, page, chapter, text }

  章节检测(正则):
    - 第\\d+章 / 第\\d+节 / Chapter \\d+
    - \\d+\\.\\d+ (如 3.2.1 白点病)
    - 目录式标题: 标题在行首 + 行尾无标点

    |
    v
Step 4: 中文分词 + 倒排索引
  分词策略(三级降级):
    Level 1: jieba-wasm 精确模式 (准确率高)
    Level 2: n-gram 滑窗(n=2,3) 兜底 (零依赖)
    Level 3: 原始关键词直接匹配 (最终兜底)

  自定义词典(水产领域高频词):
    白点病,小瓜虫,水霉病,烂鳃病,肠炎病,赤皮病
    氨氮,亚硝酸盐,溶氧,pH,水色
    鲈鱼,草鱼,鲤鱼,鲫鱼,对虾
    福尔马林,亚甲基蓝,高锰酸钾,二氧化氯,聚维酮碘
    罗茨风机,微孔曝气,循环水,生物滤池

  倒排索引结构:
    invertedIndex: Map<string, IndexEntry>
    chunks: PdfChunk[]
    meta: PdfIndexMeta

    |
    v
Step 5: 持久化
  写入 cache/pdf-index/:
    index.json  -> 倒排索引 + meta (约 500KB)
    chunks.json -> 切片原文数组 (约 5-10MB)
```

### 4.3 运行时检索流程

```
用户查询: "白点 小瓜虫 治疗"
    |
    v
Step 1: 查询预处理
  ① 分词: ["白点", "小瓜虫", "治疗"]
  ② 过滤停用词 + 低频单字
  ③ 输出: termList = ["白点", "小瓜虫", "治疗"]

    |
    v
Step 2: 倒排索引查询
  for each term in termList:
    hits[term] = invertedIndex.get(term)

  合并: 每个 chunk 的总分 = sum(命中词数 * 词频)

  示例:
    chunk #1023: 命中"白点"(x2) + "小瓜虫"(x1) -> score=3
    chunk #1045: 命中"白点"(x1) + "治疗"(x1)   -> score=2
    chunk #1100: 命中"小瓜虫"(x3) + "治疗"(x2)  -> score=5 (最高)

    |
    v
Step 3: 排序 + 上下文合并
  ① 按 score 降序排列
  ② 相邻 chunk 合并(同 PDF + 页码差 <= 2)
  ③ 去重: 同一 PDF 页码只保留最高分 chunk
  ④ 取 top-K (默认 K=5)
  ⑤ 输出: PdfSearchHit[]
```

---

## 5. 三通道合并策略

### 5.1 合并优先级

```
note 高亮 (IMA 搜索引擎精确命中,最高优先级)
    | 补充
pdf_content 原文 (本地 PDF 全文,原始文献,带页码)
    | 补充
note 正文摘取 (笔记正文,AI 二次汇总)
    | 补充
wiki 标题匹配 (仅文件名匹配,无正文)
```

### 5.2 合并参数

```typescript
const MERGE_CONFIG = {
  noteHighlightLimit: 2,    // note 高亮条目保留上限
  pdfContentLimit: 3,       // pdf_content 条目保留上限
  noteBodyLimit: 1,         // note 正文摘取条目保留上限
  wikiLimit: 1,             // wiki 标题条目保留上限
  totalLimit: 7,            // 合并后总条数上限(从5提升到7)
}
```

### 5.3 pdf_content 到 KnowledgeItem 的映射

```typescript
function pdfHitToKnowledgeItem(hit: PdfSearchHit): KnowledgeItem {
  return {
    media_id: hit.mediaId,
    title: hit.title,
    summary: `[PDF ${hit.page}页${hit.chapter ? ' ' + hit.chapter : ''}]`,
    from: 'pdf_content',
    // 高亮字段: 将命中关键词用 <em> 标记, 复用现有 cleanHighlight 逻辑
    highlight: markHighlightTerms(hit.text, hit.matchedTerms)
  }
}
```

---

## 6. 文件变更矩阵

### 6.1 新增文件

| 文件路径 | 行数估计 | 说明 |
|----------|---------|------|
| `src/ima/pdf-content-search.ts` | ~350 行 | PDF 原文检索核心模块(OCR_MARK/normalizeOcrText 契约定义处) |
| `src/scripts/ocr-scanned-pdfs.ts` | ~840 行 | OCR 兜底生产端(离线脚本 `npm run ocr`;可选依赖,缺失时给安装提示) |

### 6.2 修改文件

| 文件路径 | 变更类型 | 变更说明 |
|----------|---------|----------|
| `src/ima/ima-api.ts` | 导出扩展 | `KnowledgeItem.from` 新增 `'pdf_content'`；导出 `searchKnowledgeMerged` |
| `src/tools/generate-advice.ts` | 逻辑适配 | `extractExcerpts` 识别 `from='pdf_content'`；合并上限从5提升到7 |
| `src/scripts/warm-kb-cache.ts` | 流程扩展 | 预热结束后调用 `buildPdfIndex()` |

### 6.3 不变更文件

| 文件 | 理由 |
|------|------|
| `src/tools/analyze-image.ts` | 不涉及知识库 |
| `src/tools/record-ledger.ts` | 不涉及知识库 |
| `src/router/intent-router.ts` | 不涉及知识库 |
| `src/index.ts` | 无新 Tool 注册 |

---

## 7. 存储设计

### 7.1 目录结构

```
$AQUASENSE_CACHE_DIR/
  pdf/                     # [已有] PDF 全文缓存(OCR 完成后覆写为带 [OCR 批处理] 头的正文)
  note/                    # [已有] 笔记正文缓存
  ocr/                     # [新增] OCR 逐页 checkpoint(<media_id>/page-0001.txt + state.json;发布后保留,缓存丢失时可免重新 OCR 快速重建)
  pdf-index/               # [新增] PDF 倒排索引
    index.json             # 倒排索引 + 元数据 (~500KB)
    chunks.json            # 切片原文数组 (~5-10MB)
```

### 7.2 索引大小预估(理论值 vs 实测)

| 数据规模 | chunks 数 | 文本大小 | 索引大小 | 运行时内存 |
|----------|----------|---------|---------|----------|
| 50 PDF x 80 页 | ~8,000 | ~2.4MB | ~240KB | ~60MB |
| 84 PDF x 100 页 | ~16,800 | ~5MB | ~500KB | ~100MB |
| 200 PDF x 120 页 | ~48,000 | ~14MB | ~1.4MB | ~250MB |

**实测修正**:25 本书中仅10 本可索引(40%),可提取正文约 3.4MB。在 P0(OCR + 超限处理)完成前,实际可索引规模远小于理论值。且索引产物(chunks.json ~5-10MB)比它索引的正文(~3.4MB)还大——几 MB 的中文做 substring 扫描是毫秒级,倒排索引的复杂度在此规模下投入产出比不高。

**最终落地**:按上述结论,通道 C 未引入倒排索引——在切片(chunks.json)上运行时扫描,检索结果与倒排等价(同一套词元生成逻辑)。实测全量语料 61 PDF / 7707 切片 / 约 313 万字:chunks.json 10.3MB,索引构建 0.6s,单次检索 15-243ms(含首次加载)。架构图与 §4.2/§4.3 仍保留倒排版设计意图作为背景;设计稿与实现的全部偏差见 `pdf-search-channel-implementation.md` §5。

---

## 8. 容错与降级设计

| 故障场景 | 检测方式 | 降级行为 |
|----------|---------|----------|
| index.json 不存在 | `existsSync` | 返回空结果,回退双通道 |
| index.json 解析失败 | `JSON.parse` try-catch | 返回空结果,日志 error |
| 倒排索引为空 | `invertedIndex.size === 0` | 返回空结果 |
| PDF 缓存与索引不一致 | `pdfFiles.length !== meta.pdfCount` | warn 日志,不阻断 |
| 索引过期(>7天) | `builtAt` 时间差 | warn 日志,仍可查询 |
| **缓存目录 CWD 漂移** | **不同启动方式各建一份缓存** | **索引与缓存互相看不见,必须修复** |

**缓存目录 CWD 漂移问题**:当前 `AQUASENSE_CACHE_DIR` 默认值为 `./cache`(相对路径),不同启动方式(systemd/手工/cron)会各建一份缓存。方案 D 要建索引的话,这必须先修——否则会出现"索引里有、缓存里没有"的不一致。

**修复方案**:默认值改为绝对路径(Linux: `/data/aquasense/cache/`, Windows: `D:\data\aquasense\cache\`)。好处:
- 不受项目目录重装/迁移/git clean 影响,OCR 3.3 小时成果持久保存
- 不同进程(DSH 主服务 + S9 提醒 + 预热脚本 + OCR 批处理)共享同一份缓存
- cache/ 已在 .gitignore 中,不纳入版本控制,可独立备份
- 修复后 `pdfFiles.length !== meta.pdfCount` 告警自动消除

---

## 9. 资源评估 (4核4G 服务器)

### 9.1 内存占用

| 组件 | 峰值内存 | 稳态内存 |
|------|---------|----------|
| 现有系统 (Node.js + IMA + 飞书) | ~400MB | ~300MB |
| pdf-content-search (新增) | ~16MB | ~16MB |
| **合计** | **~416MB** | **~316MB** |
| **4G 服务器剩余** | **~3.6GB** | **~3.7GB** |

### 9.2 CPU 占用

| 操作 | 耗时 | 频率 |
|------|------|------|
| 索引构建(离线) | ~30s(84 PDF) | 知识库更新后 |
| 索引加载(启动) | <1s | 进程启动时 |
| 单次查询 | <10ms | 每次 advice 调用 |

---

## 10. 接口变更

### 10.1 KnowledgeItem 类型扩展

```typescript
export interface KnowledgeItem {
  media_id: string
  title: string
  summary?: string
  source?: string
  from?: 'wiki' | 'note' | 'pdf_content'  // 新增
  highlight?: string
}
```

### 10.2 新增导出函数

```typescript
// src/ima/pdf-content-search.ts
export const OCR_MARK = '[OCR 批处理]'                // 新增:OCR 契约标记(与生产端 ocr-scanned-pdfs.ts 共用,防漂移)
export function normalizeOcrText(text: string): string  // 新增:剥离标记 + 去字间空格(生产端发布与索引层归一化共用)
export async function buildPdfIndex(cachePdfDir: string, indexDir: string, options?: BuildPdfIndexOptions): Promise<PdfIndexMeta>
export function searchPdfContent(query: string, indexDir: string): PdfSearchHit[]
export function isPdfIndexReady(indexDir: string): boolean
export function getPdfIndexStatus(indexDir: string): 'ready' | 'not_found' | 'expired'
export function getPdfIndexMeta(indexDir: string): PdfIndexMeta | null
export function pdfHitToKnowledgeItem(hit: PdfSearchHit): KnowledgeItem
```

---

## 11. 可观测性

```
[ima] PDF 索引构建:开始(84 个 PDF)
[ima] PDF 索引构建:分词模式=jieba-wasm,词典=水产领域(28 词)
[ima] PDF 索引构建:完成 16,800 切片,耗时 28s,索引 500KB
[ima] PDF 索引:加载成功(84 PDF, 16,800 chunks, 构建于 2026-09-14)
[ima] PDF 检索:"白点 小瓜虫 治疗" -> 5 条命中,耗时 8ms
[aquasense] 三通道检索:note=3, pdf=2, wiki=1, 合并后=6
```

---

## 12. 里程碑

> **注意**:M0 为方案 D 的硬性前置。实际落地时 M2 先于 M0a 批处理执行完成(索引机制不受 OCR 阻塞);M0a 生产端已随插件交付,执行 `npm run ocr` 后病害内容即从盲区解锁。详见 [ima-pdf-note-limitation.md §8](./ima-pdf-note-limitation.md#8-建议与下一步)。

| 阶段 | 内容 | 预估工时 | 前置 | 状态 |
|------|------|---------|------|------|
| **M0** | **语料修复(前置条件)** | | | |
| M0a | OCR 12 本扫描件(2,572 页) | 3.3 小时(CPU 批处理,已验证) | 无 | 生产端已交付(`npm run ocr`),批处理执行待运维安排 |
| M0a' | OCR 文本归一化(去空格) | 0.5 天(含批处理脚本开发) | M0a | ✅ 已落地(生产端 strip + 索引层归一化回写) |
| M0b | 处理 3 本超限书(>100MB) | 0.5 天 | 无 | ⚠️ 部分:上限已放宽至 100MB,超限书仍待处理 |
| M0c | 修复缓存目录 CWD 漂移(改绝对路径) | 0.5 天 | 无 | ✅ 已落地(`resolveCacheRoot()` 平台绝对路径) |
| **M1** | **轻量验证(P1)** | | | |
| M1a | 缓存 substring 检索 | 0.5 天 | M0 完成 | ✅ 已落地 |
| M1b | 验证 PDF 通道引用质量 | 0.5 天 | M1a 完成 | ✅ 已落地(冒烟数据见 [implementation.md §5.3](./pdf-search-channel-implementation.md)) |
| **M2** | **完整索引(P2)** | | | |
| M2a | pdf-content-search 模块开发 | 3 天 | M1b 验证通过 | ✅ 已落地 |
| M2b | warm-kb-cache 索引构建集成 | 1 天 | M2a 完成 | ✅ 已落地 |
| M2c | 三通道合并 + generate-advice 适配 | 2 天 | M2b 完成 | ✅ 已落地 |
| M2d | 单元测试 + 集成测试 | 2 天 | M2c 完成 | ✅ 已落地(vitest,18 用例) |
| M2e | 部署验证 + 性能调优 | 1 天 | M2d 完成 | ✅ 已落地(冒烟数据见 [implementation.md §5.3](./pdf-search-channel-implementation.md)) |
| **合计** | | **~12 天** | | M1/M2 已交付;M0a 批处理执行待运维安排 |
