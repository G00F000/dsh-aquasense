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
- **零运维**：索引构建集成到 `warm-kb-cache` 脚本，运行时自动加载

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

---

## 4. pdf-content-search.ts 详细设计

### 4.1 数据模型

```typescript
/** 切片(Chunk) */
interface PdfChunk {
  mediaId: string          // 所属 PDF 的 IMA media_id
  title: string            // PDF 文件标题(书名)
  page: number             // 所在页码 (1-based)
  chapter: string | null   // 章节标题(正则检测,可为 null)
  text: string             // 切片文本内容
  index: number            // 切片在 chunks.json 中的索引位置
}

/** 倒排索引条目 */
interface IndexEntry {
  term: string                           // 关键词(分词后)
  chunkIndices: number[]                 // 包含该词的 chunk 索引
  termFreqs: Record<number, number>      // 每个 chunk 中的词频
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
    totalPages: number
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
  page: number              // 命中页码
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
| `src/ima/pdf-content-search.ts` | ~350 行 | PDF 原文检索核心模块 |

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
  pdf/                     # [已有] PDF 全文缓存
  note/                    # [已有] 笔记正文缓存
  pdf-index/               # [新增] PDF 倒排索引
    index.json             # 倒排索引 + 元数据 (~500KB)
    chunks.json            # 切片原文数组 (~5-10MB)
```

### 7.2 索引大小预估

| 数据规模 | chunks 数 | 文本大小 | 索引大小 | 运行时内存 |
|----------|----------|---------|---------|----------|
| 50 PDF x 80 页 | ~8,000 | ~2.4MB | ~240KB | ~60MB |
| 84 PDF x 100 页 | ~16,800 | ~5MB | ~500KB | ~100MB |
| 200 PDF x 120 页 | ~48,000 | ~14MB | ~1.4MB | ~250MB |

---

## 8. 容错与降级设计

| 故障场景 | 检测方式 | 降级行为 |
|----------|---------|----------|
| index.json 不存在 | `existsSync` | 返回空结果,回退双通道 |
| index.json 解析失败 | `JSON.parse` try-catch | 返回空结果,日志 error |
| 倒排索引为空 | `invertedIndex.size === 0` | 返回空结果 |
| PDF 缓存与索引不一致 | `pdfFiles.length !== meta.pdfCount` | warn 日志,不阻断 |
| 索引过期(>7天) | `builtAt` 时间差 | warn 日志,仍可查询 |

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
export function buildPdfIndex(cachePdfDir: string, indexDir: string): Promise<PdfIndexMeta>
export function searchPdfContent(query: string, indexDir: string): PdfSearchHit[]
export function isPdfIndexReady(indexDir: string): boolean
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

| 阶段 | 内容 | 预估工时 |
|------|------|---------|
| M1 | pdf-content-search 模块开发 | 3 天 |
| M2 | warm-kb-cache 索引构建集成 | 1 天 |
| M3 | 三通道合并 + generate-advice 适配 | 2 天 |
| M4 | 单元测试 + 集成测试 | 2 天 |
| M5 | 部署验证 + 性能调优 | 1 天 |
| **合计** | | **9 天** |
