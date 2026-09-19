# R8：AI 分析结果可追溯 — 功能架构设计文档

> - 总文档：[architecture.md](./architecture.md)（本文为其 R8 专题**分文档**，展开模块级/接口级设计）
> - 需求依据：[r8-traceability-requirements.md](./r8-traceability-requirements.md)（R8 专题需求分文档，现行 v1.7）
> - 状态：✅ 已实现（M1-M9、M11、M12 完成，含单元测试与构建验证）；**v1.6 展示归并调整待代码对齐**（见 M10）
> - 设计参考：Langfuse Trace/Span 模型、Arize Phoenix 嵌入可视化、MedgeClaw Dashboard 分步骤展开
> - **v1.6 展示归并（同步自需求）**：入口 A（H5）提交后仅「提交成功」反馈——不跳转、不展示进度与结果明细；分析记录查看统一到入口 C（PC 端面板，列表态 ⇄ 详情态同页切换）；独立列表/详情页路由停用（仅保留趋势页 + API），移动端不再承载查看界面

---

## 1. 背景与目标

### 1.1 问题回顾

AquaSense 的 AI 分析管线已完整运行（图片 → 视觉分析 → 知识库检索 → 处置建议 → 台账写入），但：

- 分析结果仅在飞书群聊中回显，无持久化记录
- 每步耗时、Token 消耗无记录
- 知识库命中来源不透明
- 无趋势分析能力

### 1.2 设计目标

借鉴 **Langfuse 的 Trace/Span 层级模型** + **Phoenix 的嵌入可视化思路** + **MedgeClaw 的分步骤展开交互**，自建轻量版 AI 分析可追溯系统。

核心原则：**固定管线 + 硬编码 Span + JSON 存储 + 轻量前端（入口 C 面板内 React 组件 + 纯 HTML 趋势页）**。

### 1.3 设计约束

| 约束 | 说明 |
|------|------|
| 服务器 | 4 核 4G，零额外依赖（不引入 MySQL/Redis/ClickHouse） |
| 存储 | JSON 文件（`$AQUASENSE_CACHE_DIR/reports/`） |
| 前端 | 入口 C 为面板内 React 组件（复用 DSH 客户端运行时）；趋势页为纯 HTML + Vanilla JS + CSS Variables，无构建步骤 |
| 规模 | 4 池 × ~20 次/天 ≈ 200 条/月，JSON 完全可承载 |
| 复用 | 复用现有 `remind-gateway.ts` 的 HTTP 服务和路由注册机制 |

---

## 2. 整体架构

### 2.1 组件架构

```
┌───────────────────────────────────────────────────────────────────┐
│                    插件进程 (DSH 宿主内)                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  现有 AI 管线 (3 Tools)                                      │  │
│  │                                                             │  │
│  │  analyze-image.ts ──→ generate-advice.ts ──→ record-ledger.ts│  │
│  │       │                    │                       │        │  │
│  │       ▼                    ▼                       ▼        │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │  trace-recorder.ts (新增)                             │   │  │
│  │  │                                                      │   │  │
│  │  │  在每个 Tool 执行前后埋点，收集 Span 数据              │   │  │
│  │  │  → 组装 AnalysisRecord                                │   │  │
│  │  │  → 写入 reports/RPT-*.json + 更新 index.json          │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  trace-gateway.ts (新增)                                    │  │
│  │                                                             │  │
│  │  HTTP 路由注册（复用 webServer）:                             │  │
│  │  GET  /aquasense-reports/trend                → 趋势页 HTML  │  │
│  │  GET  /aquasense-reports/api/records          → 列表 JSON    │  │
│  │  GET  /aquasense-reports/api/records/:id      → 详情 JSON    │  │
  │  GET  /aquasense-reports/api/records/:id/images/:index → 原图 │  │
│  │  GET  /aquasense-reports/api/trend/:pool      → 趋势 JSON    │  │
│  │  GET  /aquasense-reports/api/pools          → 池号枚举 JSON│  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  入口 C 面板 (React 客户端组件)                              │  │
│  │                                                             │  │
│  │  src/client/TraceRecordList.tsx → 列表态 ⇄ 详情态同页切换     │  │
│  │  src/client/AquaConfig.tsx      → 顶栏「📊 分析记录」页签     │  │
│  │  （直调 /aquasense-reports/api/*，PC 端唯一查看入口）         │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  静态文件 (新增)                                            │  │
│  │                                                             │  │
│  │  src/web/trace-trend.html      → 池号趋势页（唯一静态页面）   │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                  $AQUASENSE_CACHE_DIR/reports/
                    index.json                 ← 轻量索引
                    RPT-*.json                 ← 完整记录
                    images/<RPT-id>/img-NNN.ext ← 工人发送的原图(详情页展示;随记录清理)
```

### 2.2 在总架构中的位置

| 方向 | 说明 |
|------|------|
| 上游 | AI 管线（analyze → advice → ledger）执行完成后自动埋点 |
| 下游 | 入口 C（PC 端配置页面板，React 组件）：列表态 ⇄ 详情态同页切换（v1.6 唯一查看入口）；池号趋势页（静态 HTML）；H5 提交后仅「提交成功」反馈 |
| 与现有模块关系 | **只读**：不修改 analyze/advice/ledger 的输出接口，仅在执行前后收集数据 |
| 共享设施 | 飞书 token 缓存（`src/feishu/token.ts`）、缓存目录（`AQUASENSE_CACHE_DIR`） |

---

## 3. 核心模块设计

### 3.1 模块划分

| 模块 | 文件 | 职责 |
|------|------|------|
| Trace 记录器 | `src/web/trace-recorder.ts` | Span 数据收集 + AnalysisRecord 组装 + JSON 写入 |
| Trace 网关 | `src/web/trace-gateway.ts` | HTTP 路由注册 + API 处理 + 趋势页托管（v1.6：列表/详情页路由停用） |
| Trace 存储 | `src/web/trace-store.ts` | index.json 读写 + reports/ 目录管理 + 图片落盘/读取/清理 |
| 分析记录视图（入口 C） | `src/client/TraceRecordList.tsx` + `src/client/AquaConfig.tsx` | 面板内列表态 ⇄ 详情态同页切换（React 组件直调 JSON API）；PC 端唯一查看入口 |
| 趋势页 | `src/web/trace-trend.html` | 池号趋势分析（纯 HTML） |

> **v1.6 展示归并注**：分析记录不再有独立「列表页 / 详情页」——v1.5 已将两态合并为同一页面的列表态 ⇄ 详情态（同页切换），v1.6 进一步收口到入口 C 面板（`TraceRecordList.tsx`）；原页面路由（`/aquasense-reports`、`/aquasense-reports/report`）停用，`trace-list.html` / `trace-detail.html` 待清理。

### 3.2 Trace 记录器（trace-recorder.ts）

**核心设计**：借鉴 Langfuse 的 `@observe()` 装饰器模式，在 AquaSense 的固定管线中硬编码 5 个 Span 埋点。

```typescript
// src/web/trace-recorder.ts

/**
 * 单条分析的 Span 数据收集器
 * 借鉴 Langfuse Trace/Span 层级模型：
 * - Trace = 一次完整分析（RPT-YYYYMMDD-HHmmss）
 * - Span = 管线中的每个步骤（upload/analyze/retrieve/advice/ledger）
 */
export class AnalysisTracer {
  private record: AnalysisRecord
  private spans: Map<string, SpanState>

  constructor(params: {
    pool: string
    reporter: string
    reporter_open_id: string
    source: 'h5_upload' | 'group_chat' | 'api'
    task?: string
    chat_id?: string
  }) {
    this.record = {
      id: generateReportId(),  // RPT-YYYYMMDD-HHmmss
      ...params,
      created_at: new Date().toISOString(),
      model: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash',
      total_duration_ms: 0,
      total_tokens: 0,
    }
    this.spans = new Map()
  }

  /** 开始一个 Span（记录起始时间） */
  startSpan(name: string): void {
    this.spans.set(name, { start: performance.now() })
  }

  /** 结束一个 Span（记录耗时和数据） */
  endSpan(name: string, data: Partial<SpanData>): void {
    const span = this.spans.get(name)
    if (!span) return
    span.duration_ms = Math.round(performance.now() - span.start)
    span.data = { ...span.data, ...data }
  }

  /** 设置 Trace 级别元信息 */
  setTraceMeta(meta: Partial<AnalysisRecord>): void {
    Object.assign(this.record, meta)
  }

  /** 写入磁盘（管线执行完成后调用） */
  async flush(): Promise<string> {
    // 汇总各 Span 数据到 record
    this.record.total_duration_ms = this.sumSpanDurations()
    this.record.total_tokens = this.sumTokens()
    this.record.span_upload = this.spans.get('upload')?.data
    this.record.span_analyze = this.spans.get('analyze')?.data
    this.record.span_retrieve = this.spans.get('retrieve')?.data
    this.record.span_advice = this.spans.get('advice')?.data
    this.record.span_ledger = this.spans.get('ledger')?.data

    // 写入 JSON 文件
    await writeReport(this.record)
    await updateIndex(this.record)

    return this.record.id
  }
}
```

**与现有管线的集成方式**：

```
实际实现: 增量导出 + 管线直调（对外行为不变）
─────────────────────────────────────────────

src/tools/analyze-image.ts       ← 增量导出（新增 callVisionModelWithUsage 采集 Token,
                                     导出 buildPrompt/parseAnalysisResponse;对外行为不变）
src/tools/generate-advice.ts     ← 增量导出（抽取 retrieveKnowledge + generateAdviceInternal,
                                     execute 改为两步调用,行为等价）
src/tools/record-ledger.ts       ← 零修改（群聊场景经包装器后置收集）
src/feishu/token.ts              ← 增量导出（uploadImageToFeishu 支持 data URL,H5 内存图片
                                     可直接上传;导出 uploadBufferToFeishu/parseDataUrl）

src/web/trace-recorder.ts        ← 新增（AnalysisRecord + AnalysisTracer）
src/web/trace-store.ts           ← 新增（index.json 读写 + reports/ 管理）
src/web/trace-gateway.ts         ← 新增（/aquasense-reports 页面 + API）
src/web/report-handler.ts        ← 新增（H5 提交/进度接口 + 5 Span 管线埋点）
src/web/trace-ledger-wrap.ts     ← 新增（群聊场景 recordLedger 注册包装器）

src/index.ts                     ← 修改（注册 trace/report 路由 + 包装台账工具）
```

**包装器伪代码**（H5 上传场景）：

```typescript
// src/web/report-handler.ts（示意,实际为 5 Span 管线,见 §3.5）
export async function handleH5Report(params: H5ReportParams): Promise<{ record_id: string; analysis: AnalysisResult }> {
  const tracer = new AnalysisTracer({
    pool: params.pool_id,
    reporter: params.reporter_name,
    reporter_open_id: params.open_id,
    source: 'h5_upload',
    task: params.task,
    chat_id: params.chat_id,
  })

  // Span 1: 图片上传
  tracer.startSpan('upload')
  const images = await processUploadedImages(params.files)
  await saveReportImages(tracer.id, images)  // 落盘供详情态「现场照片」展示（失败仅 warn）
  tracer.endSpan('upload', {
    image_count: images.length,
    image_sizes: images.map(i => i.original_size),
    compressed_sizes: images.map(i => i.compressed_size),
  })

  // Span 2: AI 视觉分析
  tracer.startSpan('analyze')
  const analysis = await callVisionModel(images, buildPrompt(params.pool_id))
  const parsed = parseAnalysisResponse(analysis)
  tracer.endSpan('analyze', {
    prompt_length: buildPrompt(params.pool_id).length,
    input_tokens: 1200,  // 从 API 响应中提取
    output_tokens: 300,
    output_raw: analysis.slice(0, 500),
    cls: parsed.cls,
    symptoms: parsed.symptoms,
    severity: parsed.severity,
    confidence: parsed.confidence,
    scene_hint: parsed.scene_hint,
  })
  tracer.setTraceMeta({ model: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash' })

  // Span 3: 知识库检索（仅 early/disease）
  let knowledge: SearchResult | null = null
  if (parsed.cls !== 'normal') {
    tracer.startSpan('retrieve')
    knowledge = await searchKnowledgeMerged(buildKnowledgeQuery(parsed))
    tracer.endSpan('retrieve', {
      query: buildKnowledgeQuery(parsed),
      channel_a_wiki: knowledge.items.filter(i => i.from === 'wiki').length,
      channel_b_note: knowledge.items.filter(i => i.from === 'note').length,
      channel_c_pdf: knowledge.items.filter(i => i.from === 'pdf_content').length,
      merged_count: knowledge.items.length,
      excerpts: knowledge.items.slice(0, 5).map(i => ({
        title: i.title,
        from: i.from,
        locator: i.locator,
        excerpt_preview: (i.highlight || '').slice(0, 100),
      })),
    })
  }

  // Span 4: 处置建议生成（仅 early/disease）
  let advice: AdviceResult | null = null
  if (parsed.cls !== 'normal') {
    tracer.startSpan('advice')
    advice = await generateAdviceInternal(parsed, knowledge)
    tracer.endSpan('advice', {
      input_cls: parsed.cls,
      alert_level: advice.alert_level,
      knowledge_refs_count: advice.knowledge_refs.length,
      diagnosis_summary: advice.diagnosis_summary,
      reasoning_preview: advice.reasoning.slice(0, 200),
    })
  }

  // Span 5: 台账写入
  tracer.startSpan('ledger')
  const ledgerResult = await recordLedgerInternal({
    scene: 'inspection',
    pool_id: params.pool_id,
    open_id: params.open_id,
    analysis: parsed,
    advice,
  })
  tracer.endSpan('ledger', {
    target_table: '巡检记录表',
    operation: ledgerResult.is_update ? 'update' : 'create',
    record_id: ledgerResult.record_id,
  })

  // 写入磁盘
  const record_id = await tracer.flush()

  return { record_id, analysis: parsed }
}
```

### 3.3 Trace 存储（trace-store.ts）

```typescript
// src/web/trace-store.ts

const REPORTS_DIR = path.join(process.env.AQUASENSE_CACHE_DIR || '/data/aquasense/cache', 'reports')
const INDEX_FILE = path.join(REPORTS_DIR, 'index.json')

/**
 * 写入单条分析记录
 */
export async function writeReport(record: AnalysisRecord): Promise<void> {
  const filePath = path.join(REPORTS_DIR, `${record.id}.json`)
  await fs.mkdir(REPORTS_DIR, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8')
}

/**
 * 更新索引（在头部插入新记录，保持按时间倒序）
 */
export async function updateIndex(record: AnalysisRecord): Promise<void> {
  const index = await readIndex()
  index.records.unshift({
    id: record.id,
    pool: record.pool,
    reporter: record.reporter,
    source: record.source,
    cls: record.span_analyze?.cls ?? 'unknown',
    confidence: record.span_analyze?.confidence ?? 0,
    symptoms: record.span_analyze?.symptoms ?? [],
    alert_level: record.span_advice?.alert_level,
    created_at: record.created_at,
    total_duration_ms: record.total_duration_ms,
  })
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8')
}

/**
 * 读取索引（文件不存在时返回空结构）
 */
export async function readIndex(): Promise<AnalysisIndex> {
  try {
    const data = await fs.readFile(INDEX_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { version: 1, records: [] }
  }
}

/**
 * 读取单条完整记录
 */
export async function readReport(id: string): Promise<AnalysisRecord | null> {
  try {
    const filePath = path.join(REPORTS_DIR, `${id}.json`)
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * 索引损坏时从 reports/ 目录重建
 */
export async function rebuildIndex(): Promise<AnalysisIndex> {
  const files = await fs.readdir(REPORTS_DIR)
  const reports = files
    .filter(f => f.startsWith('RPT-') && f.endsWith('.json'))
    .map(async f => {
      const data = await fs.readFile(path.join(REPORTS_DIR, f), 'utf-8')
      return JSON.parse(data) as AnalysisRecord
    })
  const records = (await Promise.all(reports))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(r => ({
      id: r.id,
      pool: r.pool,
      reporter: r.reporter,
      source: r.source,
      cls: r.span_analyze?.cls ?? 'unknown',
      confidence: r.span_analyze?.confidence ?? 0,
      symptoms: r.span_analyze?.symptoms ?? [],
      alert_level: r.span_advice?.alert_level,
      created_at: r.created_at,
      total_duration_ms: r.total_duration_ms,
    }))
  const index: AnalysisIndex = { version: 1, records }
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8')
  return index
}
```

**存储目录结构**：

```
$AQUASENSE_CACHE_DIR/
  reports/                          # R8 分析记录
    index.json                      # 轻量索引（~500KB/年）
    RPT-20260917-100532.json        # 单条完整记录（~2KB）
    RPT-20260917-093015.json
    images/                         # 工人发送的原图（详情态「现场照片」）
      RPT-20260917-100532/
        img-000.jpg                 # img-NNN.<ext>（三位补零；扩展名按 MIME，未知降级 .jpg）
        img-001.jpg
      RPT-20260917-093015/
    ...
  remind/                           # S9 运行状态（已有）
    config.json
    plan-*.json
    sent-*.json
  pdf/                              # 知识库缓存（已有）
  note/                             # 笔记缓存（已有）
```

**图片存储（详情态展示）**：工人发送的原图按记录落盘（`reports/images/<RPT-id>/`），详情接口以元数据返回、经图片接口读取二进制：

```typescript
// src/web/trace-store.ts（图片存储部分）

export interface ReportImageMeta {
  index: number      // 图片序号（0 起，与图片接口路径对应）
  fileName: string   // img-NNN.<ext>
  mimeType: string
  size: number       // 字节数
}

/** 批量落盘图片（H5：base64 直存；群聊：下载后转 base64）；返回落盘清单 */
export async function saveReportImages(id: string, images: Array<{ data: string; mimeType: string }>): Promise<ReportImageMeta[]>

/** 列出记录的图片清单（按 index 升序；目录不存在返回空数组） */
export async function listReportImages(id: string): Promise<ReportImageMeta[]>

/** 读取单张图片（按扩展名 .jpg/.png/.webp/.gif 依次探测） */
export async function readReportImage(id: string, index: number): Promise<{ buffer: Buffer; mimeType: string } | null>

/** 删除记录的图片目录（随记录清理） */
export async function removeReportImages(id: string): Promise<void>
```

**清理策略**：
- 保留最近 90 天的记录（约 6000 条，~12MB）
- 超过 90 天的记录归档或删除（可通过 cron 脚本）
- index.json 自动裁剪旧记录
- 图片随记录同步清理：`cleanupOldReports` 删除 RPT-*.json 时调用 `removeReportImages(id)` 一并删除图片目录

### 3.4 Trace 网关（trace-gateway.ts）

```typescript
// src/web/trace-gateway.ts

/**
 * 注册 R8 分析记录相关 HTTP 路由
 * 复用 DSH webServer 的路由注册机制（与 remind-gateway.ts 一致）
 */
export function installTraceWeb(ctx: Context): void {
  const webServer = ctx.webServer
  if (!webServer) {
    console.warn('[aquasense-trace] webServer 不存在,跳过 R8 路由注册')
    return
  }

  // 静态页面路由（v1.6：仅趋势页；原 /aquasense-reports 与 /report 列表/详情页路由停用）
  webServer.router.get('/aquasense-reports/trend', handleTrendPage)

  // API 路由
  webServer.router.get('/aquasense-reports/api/records', handleRecordsList)
  webServer.router.get('/aquasense-reports/api/records/:id', handleRecordDetail)
  webServer.router.get('/aquasense-reports/api/records/:id/images/:index', handleRecordImage)
  webServer.router.get('/aquasense-reports/api/trend/:pool', handleTrendData)
  // + /aquasense-reports/api/pools 池号枚举（2026-09 随设置页「AquaSense 设置」新增，供筛选/趋势页选项）

  console.log('[aquasense-trace] R8 分析记录路由已注册')
}
```

**API 协议**：

| 方法 | 路由 | 参数 | 响应 | 说明 |
|------|------|------|------|------|
| GET | `/aquasense-reports/api/records` | `pool`, `cls`, `date`, `limit`, `offset` | `{ ok, value: { records, total, has_more } }` | 列表查询 |
| GET | `/aquasense-reports/api/records/:id` | — | `{ ok, value: AnalysisRecord & { images } }` | 单条详情（附图片元数据，每项含 `url`） |
| GET | `/aquasense-reports/api/records/:id/images/:index` | — | 原图二进制（`content-type` 按 MIME） | 现场照片原图（`cache-control: immutable` + `nosniff`） |
| GET | `/aquasense-reports/api/trend/:pool` | `days` | `{ ok, value: TrendData }` | 趋势统计 |
| GET | `/aquasense-reports/api/pools` | — | `{ ok, value: { pools } }` | 池号枚举（设置页「AquaSense 设置」配置；列表筛选/趋势页选项来源） |

**协议层防护**（与 `remind-gateway.ts` 一致）：
- 仅 GET（405）
- 同源校验（403）
- 路径解析（404）
- 兜底 500
- 防路径穿越：记录 ID 走 `REPORT_ID_RE` 白名单（`RPT-YYYYMMDD-HHmmss` 及带序号变体），图片序号为 `0~99` 数字白名单（`MAX_IMAGE_INDEX`），非法一律 400

### 3.5 H5 上传页集成

H5 拍照汇报页（`src/web/report-upload.html`）提交后，服务端处理链路增加 trace 埋点：

```
H5 提交 (POST /aquasense-remind/api/report/submit)
    │
    ▼
report-handler.ts:
  创建 AnalysisTracer
    │
    ├─ Span 1: 图片处理 → tracer.startSpan('upload') / endSpan
    │    └─ 图片落盘 → saveReportImages(tracer.id, 图片)（失败仅 warn，不阻断管线）
    ├─ Span 2: 视觉分析 → tracer.startSpan('analyze') / endSpan
    ├─ Span 3: 知识检索 → tracer.startSpan('retrieve') / endSpan (仅 early/disease)
    ├─ Span 4: 建议生成 → tracer.startSpan('advice') / endSpan (仅 early/disease)
    ├─ Span 5: 台账写入 → tracer.startSpan('ledger') / endSpan
    │
    ▼
  tracer.flush() → 写入 reports/RPT-*.json + 更新 index.json
    │
    ▼
  返回 202 { job_id, record_id } → H5 仅展示「提交成功」反馈（不跳转、不展示明细；v1.6）
```

**H5 页面反馈（v1.6 精简）**：

提交后仅展示「提交成功」反馈（成功图标 + 一句话，可提示结果在 PC 端查看）——不跳转、不展示 5 步进度与结果明细；上传失败/提交异常时仍展示失败提示与「重新汇报」。

服务端 job 机制保留：`POST submit` 立即返回 `202 {job_id, record_id}`，分析管线后台异步执行（`GET progress?job_id=` 接口保留）；原「1.5s 轮询进度条展示 + 完成后跳转详情页」交互不再使用——展示统一入口 C：

```
原交互（v1.6 前）：进度条 20% → 40% → 60% → 80% → 100% 「跳转详情页 →」
新交互（v1.6 起）：仅「提交成功」反馈（不跳转、不展示进度/明细）
```

---

## 4. 关键流程

### 4.1 管线内 trace 埋点（群聊发图场景）

```
工人在飞书群发图 → dsh-lark → intent-router → Agent 编排 3 个 Tool
    │
    ▼
Agent 调用 aquasense_analyze:
  → trace-recorder: startSpan('analyze')
  → callVisionModel()
  → parseAnalysisResponse()
  → trace-recorder: endSpan('analyze', { cls, symptoms, ... })
    │
    ▼
Agent 调用 aquasense_advice (仅 early/disease):
  → trace-recorder: startSpan('retrieve')
  → searchKnowledgeMerged()
  → trace-recorder: endSpan('retrieve', { query, merged_count, ... })
  → trace-recorder: startSpan('advice')
  → generateAdviceInternal()
  → trace-recorder: endSpan('advice', { alert_level, ... })
    │
    ▼
Agent 调用 aquasense_ledger:
  → trace-recorder: startSpan('ledger')
  → recordLedgerInternal()
  → trace-recorder: endSpan('ledger', { record_id, ... })
    │
    ▼
管线完成 → trace-ledger-wrap: 下载工人图片并落盘（saveChatImages，逐张容错）→ 补记 Span upload
  → trace-recorder.flush()
    → writeReport(record) → reports/RPT-*.json
    → updateIndex(record) → index.json
```

**集成方式（群聊场景）**：

群聊场景的 trace 埋点需要在 Agent 编排层（SKILL.md 定义的工具调用链）中收集数据。有两种方案：

| 方案 | 说明 | 优缺点 |
|------|------|--------|
| **方案 A: 后置收集** | 分析完成后，从飞书 Bitable 读取刚写入的记录，组装 AnalysisRecord | 不侵入现有 Tool；但无法收集 Token/耗时 |
| **方案 B: 中间件包装** | 在 `index.ts` 注册 Tool 时用包装器拦截输入/输出，自动埋点 | 可收集完整数据；但需要修改 Tool 注册方式 |

**推荐方案 A**（后置收集）：群聊场景优先保证稳定性，不侵入现有 Tool。通过飞书 Bitable API 读取刚写入的记录，组装简化的 AnalysisRecord（缺少 Token/耗时，但包含核心分析结果）。

**实际实现**：群聊场景用「注册期包装（后置收集）」的 `trace-ledger-wrap.ts`——透传台账工具定义、仅在 execute 后追加简化记录（零修改 record-ledger.ts；耗时取包装器实测、无 Token 数据）；H5 场景由 `report-handler.ts` 直调底层导出函数（`callVisionModelWithUsage`/`retrieveKnowledge`/`generateAdviceInternal`/`recordLedger.execute`），精确收集每个 Span 的耗时与 Token。

**图片素材落盘（两路）**：群聊侧 `saveChatImages` 下载工人图片（data URL 直解析／http(s) URL 走网络，30s 超时，逐张容错）→ `saveReportImages` 落盘并补记 upload Span（image_count/image_names/image_sizes）；H5 侧管线收到 base64 后直接 `saveReportImages` 落盘。落盘失败仅 warn，不影响 trace 与主链路。

### 4.2 索引查询流程

```
GET /aquasense-reports/api/records?pool=池3&cls=early&limit=20
    │
    ▼
trace-gateway:
  1. 解析查询参数 (pool, cls, date, limit, offset)
  2. readIndex() → 读取 index.json
  3. 按参数过滤 (pool / cls / date)
  4. 分页 (limit / offset)
  5. 返回 { ok, value: { records, total, has_more } }
```

### 4.3 详情查询流程

```
GET /aquasense-reports/api/records/RPT-20260917-100532
    │
    ▼
trace-gateway:
  1. 提取 record ID（REPORT_ID_RE 白名单校验，非法 → 400）
  2. readReport(id) → 读取 reports/RPT-*.json
  3. 文件不存在 → 404
  4. listReportImages(id) → 附加图片元数据（每项含图片接口 url）
  5. 返回 { ...AnalysisRecord, images }
```

**图片读取流程**（详情态每张缩略图独立请求）：

```
GET /aquasense-reports/api/records/RPT-20260917-100532/images/0
    │
    ▼
trace-gateway:
  1. 记录 ID 与序号（0~99）白名单校验，非法 → 400
  2. readReportImage(id, index) → 读取 reports/images/<id>/img-NNN.<ext>
  3. 文件不存在 → 404
  4. 返回原图二进制（content-type 按 MIME；cache-control immutable + nosniff）
```

### 4.4 趋势统计流程

```
GET /aquasense-reports/api/trend/池3?days=7
    │
    ▼
trace-gateway:
  1. readIndex() → 读取 index.json
  2. 过滤: pool === '池3' && created_at >= 7天前
  3. 统计: distribution = { normal: N, early: M, disease: K }
  4. 统计: top_symptoms = 症状频次排序
  5. 返回最近 10 条记录摘要
```

### 4.5 索引损坏重建

```
readIndex() 解析失败 (JSON.parse error)
    │
    ▼
console.warn('[aquasense-trace] index.json 损坏,正在重建...')
    │
    ▼
rebuildIndex():
  1. readdir(reports/) → 扫描所有 RPT-*.json
  2. 逐条读取并解析
  3. 按 created_at 倒序排列
  4. 重建 index.json
    │
    ▼
返回重建后的索引
```

---

## 5. 前端设计

### 5.1 技术选型

| 维度 | 选型 | 理由 |
|------|------|------|
| 框架 | 入口 C：面板内 React 组件（分析记录查看）；趋势页：无框架 Vanilla JS | 分析记录复用 DSH 客户端运行时与面板组件体系；趋势页零依赖、无构建步骤 |
| 样式 | CSS Variables + `prefers-color-scheme` | 跟随系统主题 |
| 图表 | CSS 柱状图 + Canvas 散点图 | 无需引入 Chart.js |
| 布局 | CSS Grid + Flexbox | 响应式（查看端以 PC 为主，宽窄屏自适应） |
| 路由 | 面板内状态切换（列表态 ⇄ 详情态） | 展示统一入口 C 面板内，无独立页面路由依赖 |
| 交互 | `<details>/<summary>` + CSS Transition | 原生 Accordion |

### 5.2 暗色/亮色主题

```css
/* 跟随系统设置 */
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f7fa;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border: #e0e0e0;
  --accent: #1677ff;
  --success: #52c41a;
  --warning: #faad14;
  --danger: #ff4d4f;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a1a1a;
    --bg-secondary: #2a2a2a;
    --text-primary: #e0e0e0;
    --text-secondary: #999999;
    --border: #3a3a3a;
    --accent: #4096ff;
    --success: #49aa19;
    --warning: #d89614;
    --danger: #dc4446;
  }
}
```

### 5.3 瀑布图 CSS

```css
/* 借鉴 Langfuse 的时间轴瀑布图 */
.span-bar {
  height: 24px;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.span-upload  { background: var(--text-secondary); }
.span-analyze { background: var(--accent); }
.span-retrieve { background: #fa8c16; }
.span-advice  { background: var(--success); }
.span-ledger  { background: #722ed1; }
```

### 5.4 步骤 Accordion

```html
<!-- 借鉴 MedgeClaw 的分步骤展开 -->
<details class="span-step">
  <summary>
    <span class="step-icon">🧠</span>
    <span class="step-name">AI 视觉分析</span>
    <span class="step-duration">1.2s</span>
    <span class="step-status">✅</span>
  </summary>
  <div class="step-detail">
    <!-- Input/Output/Model/Tokens -->
  </div>
</details>
```

### 5.5 语义聚类图（简化嵌入投影）

借鉴 Arize Phoenix 的 UMAP 嵌入投影，但用简化方案：

```javascript
// 简化版：基于症状向量的 2D 投影
// 不引入真正的 UMAP（太重），用简单的 TF-IDF + PCA 降维
function renderCluster(records, canvas) {
  // 1. 构建症状向量 (所有记录的症状词 → one-hot 编码)
  // 2. 简单 PCA 降到 2D
  // 3. Canvas 绘制散点图
  //    颜色: normal=绿, early=黄, disease=红
  //    大小: 置信度越高越大
  //    标注: 最新记录 ★, 最远记录 ●
}
```

---

## 6. 文件变更矩阵

### 6.1 新增文件（已实现）

| 文件路径 | 实际行数 | 说明 |
|----------|---------|------|
| `src/web/trace-recorder.ts` | ~314 行 | Trace 记录器：Span 收集 + AnalysisRecord 组装 + RPT ID 生成 |
| `src/web/trace-store.ts` | ~379 行 | 存储层：index.json 读写 + reports/ 重建/清理/查询 + 图片落盘/读取/清理 |
| `src/web/trace-gateway.ts` | ~393 行 | 趋势页路由 + 查询 API + 图片二进制接口（v1.6：列表/详情页路由停用） |
| `src/web/report-handler.ts` | ~753 行 | H5 提交/进度接口 + 5 Span 管线 + 图片落盘 + job 表（内存 30min TTL） |
| `src/web/trace-ledger-wrap.ts` | ~291 行 | 群聊场景 recordLedger 注册包装器（后置收集简化记录 + 图片下载落盘） |
| `src/client/TraceRecordList.tsx` | ~1252 行 | 入口 C 面板内分析记录视图：列表态 ⇄ 详情态同页切换 + 现场照片/灯箱（直调 JSON API；v1.3 起替代 iframe 内嵌） |
| `src/web/trace-list.html` | 列表页 | 分析记录列表页（v1.6：展示归并入口 C 面板，页面路由停用 ⏳ 待清理） |
| `src/web/trace-detail.html` | 详情页 | 分析详情页 Trace 视图（v1.6：同上停用 ⏳ 待清理） |
| `src/web/trace-trend.html` | 趋势页 | 池号趋势页（状态分布 + 症状频次 + 语义聚类图） |
| `src/web/report-upload.html` | ~479 行 | H5 拍照汇报页（客户端压缩/提交；v1.6：仅「提交成功」反馈，进度轮询/跳详情停用 ⏳ 待对齐） |
| `src/web/trace-recorder.test.ts` | ~138 行 | 记录器单元测试 |
| `src/web/trace-store.test.ts` | ~273 行 | 存储层单元测试（含损坏重建/清理/趋势/图片存取） |
| `src/web/trace-gateway.test.ts` | ~361 行 | 网关单元测试（路由/参数/协议层/图片接口） |
| `src/web/report-handler.test.ts` | ~554 行 | H5 管线与协议层单元测试（含图片落盘断言） |

### 6.2 修改文件（已实现）

| 文件路径 | 变更类型 | 变更说明 |
|----------|---------|----------|
| `src/index.ts` | 接入 | 调用 `installTraceWeb`/`installReportWeb`；台账工具经 `wrapLedgerWithTrace` 注册 |
| `src/web/remind-gateway.ts` | 分流 | `/aquasense-remind/api/report/{submit,progress}` 在 POST-only 检查前分流到 `handleReportHttp` |
| `src/client/AquaConfig.tsx` | 页签集成 | 顶栏「📊 分析记录」页签 + 面板内「列表 ⇄ 详情」React 视图（`.aqs-reports` / `.aqs-body.flush`；替代 v1.2 iframe 内嵌） |
| `src/tools/analyze-image.ts` | 增量导出 | 新增 `callVisionModelWithUsage`（ Token 采集）、导出 `buildPrompt`/`parseAnalysisResponse`/`ImageDownloadResult`；`callVisionModel` 变为薄包装，对外行为不变 |
| `src/tools/generate-advice.ts` | 增量导出 | 抽取导出 `retrieveKnowledge`/`generateAdviceInternal`（含 `AdviceResult`/`KnowledgeRetrieval` 类型），execute 改为两步调用（行为等价） |
| `src/feishu/token.ts` | 增量导出 | `uploadImageToFeishu` 新增 data URL 分支（H5 内存图片）；导出 `uploadBufferToFeishu`/`parseDataUrl` |
| `src/web/trace-gateway.ts` | 增量/动态化 | 新增 `GET /aquasense-reports/api/pools`（池号枚举，设置页「AquaSense 设置」配置）；趋势页池号选项动态化 |
| `src/web/report-handler.ts` | 动态化 | H5 提交池号白名单校验改读设置页配置枚举（`getValidPoolIds`） |
| `src/web/report-upload.html` | 动态化 | 池号按钮由服务端注入 `__AQUA_POOLS__`（设置页配置枚举，缺失时兜底默认 4 池） |
| `src/client/TraceRecordList.tsx` | 动态化 | 列表态池号筛选下拉改由 `/api/pools` 加载（接口不可用时兜底默认 4 池） |
| `src/web/trace-store.ts` | 图片存储 | 新增 `saveReportImages`/`listReportImages`/`readReportImage`/`removeReportImages`；`cleanupOldReports` 联动删除图片目录 |
| `src/web/trace-gateway.ts` | 图片接口 | 新增 `GET /api/records/:id/images/:index`（原图二进制 + immutable 缓存头）；详情接口附带 `images` 元数据；`REPORT_ID_RE` + 序号白名单防护 |
| `src/web/trace-ledger-wrap.ts` | 图片落盘 | 群聊链路下载工人图片（data URL/http(s)、30s 超时、逐张容错）→ `saveReportImages`，并补记 upload Span |
| `src/web/report-handler.ts` | 图片落盘 | H5 管线 upload Span 后落盘 base64 图片（失败仅 warn，不阻断管线） |
| `src/client/TraceRecordList.tsx` | 图片展示 | 详情态「现场照片」缩略图网格 + 灯箱（左右切换/计数/点击关闭） |
| `src/web/trace-detail.html` | 图片展示 | 停用页面同步对齐现场照片区 + 灯箱（与面板行为一致） |
| `package.json` | 构建 | build 脚本追加 `mkdir -p dist/web && cp src/web/*.html dist/web/`（页面随包发布） |
| `docs/architecture.md` | 引用 | R8 概述为摘要 + 指向本文（分-总关系） |
| `docs/requirements.md` | 引用 | R8 需求指向专题需求分文档 |

### 6.3 行为不变约束（原「不变更文件」的实际落地）

| 文件 | 落地方式 |
|------|----------|
| `src/tools/analyze-image.ts` | 对外行为不变：仅新增导出与薄包装，`analyzeImage.execute` 输出/副作用一致 |
| `src/tools/generate-advice.ts` | 对外行为不变：`retrieveKnowledge` + `generateAdviceInternal` 两步调用等价原五步流程 |
| `src/tools/record-ledger.ts` | 零修改：群聊场景经 `trace-ledger-wrap.ts` 包装注册，H5 场景直接调用 `recordLedger.execute` |
| `src/router/intent-router.ts` | R8 不经意图路由，不涉及 |
| `src/scheduler/s9-reminder.ts` | 不修改（复用其 `pushAbnormalAlert` 推送异常预警） |

---

## 7. 存储设计

### 7.1 磁盘布局

```
$AQUASENSE_CACHE_DIR/
  reports/                          # R8 分析记录（新增）
    index.json                      # 轻量索引
    RPT-20260917-100532.json        # 单条完整记录
    RPT-20260917-093015.json
    images/                         # 工人发送的原图（详情态展示；随记录清理）
      RPT-20260917-100532/img-NNN.<ext>
    ...
  remind/                           # S9 运行状态（已有，不变更）
  pdf/                              # 知识库缓存（已有，不变更）
  note/                             # 笔记缓存（已有，不变更）
```

### 7.2 容量估算

| 指标 | 数值 |
|------|------|
| 每条记录 JSON 大小 | ~2KB（含 5 个 Span 详情） |
| 每日记录数（4 池 × ~5 次） | ~20 条 |
| 每月记录数 | ~600 条 |
| 每月 JSON 总大小 | ~1.2MB |
| 每年 JSON 总大小 | ~14.4MB |
| index.json 大小（1 年） | ~500KB（仅摘要字段） |
| index.json 大小（3 年） | ~1.5MB |
| 每张图片（H5 客户端压缩后 ≤1024px JPEG 0.8） | ~100~400KB（群聊原图未压缩，可能更大） |
| 每日图片大小（~20 条 × 平均 2 张 × ~300KB） | ~12MB |
| 90 天图片大小 | ~1GB |

**结论**：JSON 文件存储在 4G 服务器上完全可承载，无需引入数据库；图片为主要磁盘占用（90 天量级 ~1GB），随记录按 90 天清理策略同步释放。

### 7.3 清理策略

```typescript
// 定期清理旧记录（可选，通过 cron 或手动触发）
async function cleanupOldReports(daysToKeep: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * 86400000).toISOString()
  const index = await readIndex()
  const toRemove = index.records.filter(r => r.created_at < cutoff)

  for (const record of toRemove) {
    await fs.unlink(path.join(REPORTS_DIR, `${record.id}.json`)).catch(() => {})
    await removeReportImages(record.id)  // 图片目录随记录同步删除
  }

  index.records = index.records.filter(r => r.created_at >= cutoff)
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8')

  return toRemove.length
}
```

---

## 8. 容错与降级

| 故障场景 | 检测方式 | 降级行为 |
|----------|----------|----------|
| reports/ 目录不存在 | 首次写入时 | 自动创建 |
| 单条记录 JSON 损坏 | readReport 解析失败 | 列表态跳过该条 + warn 日志 |
| index.json 损坏 | readIndex 解析失败 | 自动从 reports/ 目录重建 |
| index.json 与 reports/ 不一致 | readIndex 后发现记录缺失 | 静默不处理（下次写入时自动修复） |
| 查询参数非法 | 参数校验 | 返回 400 + 错误描述 |
| 图片文件缺失（原图未落盘/已清理） | 详情态加载时 | 缩略图显示占位背景，不阻断详情渲染 |
| 群聊图片下载失败（网络超时/URL 失效） | 单张下载异常 | 跳过该张 + warn；其余图片与 trace 照常写入 |
| 图片落盘失败（群聊/H5） | saveReportImages 异常 | 仅 warn，主链路与 trace 不受影响（详情页无图） |
| 图片序号非法（越界/非数字） | 路由解析 + 白名单校验 | 返回 400（invalid-param / invalid-id） |
| 记录数超过 1000 条 | 不拦截 | index.json 仍可承载（~300KB） |
| webServer 不存在 | 启动时检查 | 静默跳过路由注册 + warn |
| H5 上传 trace 埋点失败 | try-catch | 主流程不受影响（分析结果照常返回） |

---

## 9. 可观测性

```
[aquasense-trace] R8 分析记录路由已注册
[aquasense-trace] 分析记录已写入: RPT-20260917-100532 (池3, early, 2.8s)
[aquasense-trace] 索引已更新: 当前 42 条记录
[aquasense-trace] H5 汇报 trace: RPT-20260917-100532, 5 spans, 2.8s total
[aquasense-trace] 群聊 trace: RPT-20260917-093015, 简化模式(无 Token)
[aquasense-trace] 群聊图片已落盘: RPT-20260917-093015, 2 张
[aquasense-trace] 群聊图片下载失败(跳过): https://... (超时/HTTP 错误)
[aquasense-trace] H5 图片落盘失败(详情页将无图): ...
[aquasense-trace] 趋势查询: 池3, 近7天, 20 条记录
[aquasense-trace] index.json 损坏,正在重建... 重建完成: 41 条
```

关键事件：记录写入、索引更新、查询请求、索引重建、清理执行、图片落盘/下载失败。

---

## 10. 里程碑

| 阶段 | 内容 | 前置 | 状态 |
|------|------|------|------|
| M1 | AnalysisRecord 数据模型 + trace-recorder.ts | 无 | ✅ 已完成 |
| M2 | trace-store.ts（index.json 读写 + 重建） | M1 | ✅ 已完成 |
| M3 | trace-gateway.ts（HTTP 路由 + API） | M2 | ✅ 已完成 |
| M4 | trace-list.html（分析记录列表页） | M3 | ✅ 已完成（v1.6 展示归并入入口 C 面板） |
| M5 | trace-detail.html（分析详情页 Trace 视图） | M3 | ✅ 已完成（v1.6 展示归并入入口 C 面板） |
| M6 | trace-trend.html（池号趋势页） | M3 | ✅ 已完成 |
| M7 | H5 上传 trace 集成 + 实时进度反馈 | M1, M3 | ✅ 已完成（轮询方案，report-handler.ts；v1.6 精简为仅「提交成功」反馈，见 M10） |
| M8 | 群聊场景 trace 集成（后置收集） | M1 | ✅ 已完成（trace-ledger-wrap.ts） |
| M9 | 集成测试 + 构建验证 | M4-M8 | ✅ 已完成（新增 59 用例，全套 111 用例通过；typecheck + build 验证） |
| M10 | v1.6 展示归并对齐：H5 仅「提交成功」反馈；列表/详情统一入口 C 面板承载；列表/详情页路由停用 | M5, M7 | ⏳ 待实施 |
| M11 | 池号枚举动态化（/api/pools + 筛选/趋势选项） | M3 | ✅ 已完成（随设置页「AquaSense 设置」交付；全套 139 用例通过） |
| M12 | 详情态工人图片展示：群聊/H5 图片落盘 + 图片二进制接口 + 现场照片缩略图/灯箱 | M3, M7, M8 | ✅ 已完成（2026-09-19；全套 147 用例通过） |

**验收要点**（对应需求 R8.10）：

- [x] 每次 AI 分析自动写入 AnalysisRecord
- [x] index.json 与 reports/ 目录保持一致
- [x] 列表态按日期倒序展示，支持池号/状态筛选
- [x] 详情态展示完整 5 步 Trace 瀑布图 + 步骤 Accordion（独立详情页已实现；v1.6 归并入口 C 面板，待对齐）
- [x] 详情态展示工人发送的原始照片（「现场照片」缩略图网格 + 灯箱预览，覆盖 H5 与群聊两种来源）
- [x] 知识库检索步骤展示命中条目详情（标题/通道/页码/摘录）
- [x] 池号趋势页展示状态分布 + 症状频次 + 语义聚类
- [x] H5 提交后展示实时进度（5 步骤百分比）（v1.6 起改为仅「提交成功」反馈，见末项）
- [x] 移动端适配（飞书内置浏览器正常显示）（v1.6 收窄：H5 汇报页正常显示）
- [x] 暗色/亮色主题跟随系统设置
- [x] index.json 损坏时自动重建
- [x] 90 天以上的旧记录可清理
- [ ] ⏳ v1.6 展示归并对齐：H5 仅「提交成功」反馈（不跳转/不展示明细）；列表态 ⇄ 详情态统一入口 C 面板承载；列表/详情页路由停用

---

## 11. 与 S9 的关系

R8 和 S9（每日任务提醒）共享 `$AQUASENSE_CACHE_DIR` 缓存目录，但数据完全隔离：

| 维度 | S9 | R8 |
|------|-----|-----|
| 目录 | `remind/` | `reports/` |
| 数据 | config.json, plan-*.json, sent-*.json | index.json, RPT-*.json |
| 生命周期 | 按日滚动，保留 7 天 | 长期保留，90 天清理 |
| 来源 | 定时触发 | AI 分析管线触发 |
| 写入时机 | 推送成功时 | 分析完成时 |

**交集**：H5 拍照汇报页（S9 M7）提交后，同时触发 R8 的 trace 埋点。`report-handler.ts` 在处理 H5 提交时，既完成分析管线（复用三个工具导出的底层函数），又写入 AnalysisRecord。
