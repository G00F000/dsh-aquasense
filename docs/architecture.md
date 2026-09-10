# dsh-aquasense 插件架构说明

## 1. 项目概述

dsh-aquasense 是一个基于 DeepSeek Harness (DSH) 的水产养殖 AI 巡检插件，服务于清徐县森科水产养殖基地的 4 池循环水鲈鱼养殖场景（池1-池4）。插件通过飞书机器人接收工人发送的文字和照片，自动完成鲈鱼健康诊断、处置建议生成和台账登记。

**核心理念**: 轻量化架构 — 仅开发 3 个业务 Tool，其余复用 DSH 生态（dsh-lark 飞书消息桥、IMA 知识库 API）。

### 业务价值

- 工人拍照发飞书 → AI 自动诊断健康状态 → 知识库匹配处置方案 → 台账自动登记
- 鱼病前兆提前 12~48 小时预警（`early` 分类）
- 满足政府要求的 2 年养殖台账保存规范
- 每日操作手册自动定时提醒工人巡检任务

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     飞书 (Feishu/Lark)                      │
│  工人发消息/图片 → 飞书机器人 → dsh-lark 消息桥              │
└────────────────────────────┬────────────────────────────────┘
                             │ 消息
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  DeepSeek Harness (DSH)                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │ intent-router │  │  Agent 技能    │  │  dsh-lark 插件   │ │
│  │ (纯函数路由)  │  │ (aquasense-   │  │  (飞书消息桥)    │ │
│  │  S1-S8 场景   │  │  expert)      │  │                  │ │
│  └──────┬───────┘  └───────┬───────┘  └──────────────────┘ │
│         │                  │ 编排工具调用                     │
│         ▼                  ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              dsh-aquasense 插件 (3 Tools)            │    │
│  │  ┌────────────────┐ ┌──────────────┐ ┌───────────┐ │    │
│  │  │ aquasense_     │ │ aquasense_   │ │ aquasense_│ │    │
│  │  │ analyze        │ │ advice       │ │ ledger    │ │    │
│  │  │ (视觉分析)     │ │ (处置建议)   │ │ (台账写入)│ │    │
│  │  └───────┬────────┘ └──────┬───────┘ └─────┬─────┘ │    │
│  │          │                 │               │        │    │
│  │          ▼                 ▼               ▼        │    │
│  │   DeepSeek Vision    IMA 知识库 API   飞书 Bitable  │    │
│  │   (Vision 三分类)     (疾病诊疗参考)   (多维表格)    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │         daily-reminder (S9 独立调度器)               │    │
│  │  IMA 知识库《每日操作手册》→ 定时推送飞书群          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
dsh-aquasense/
├── src/
│   ├── index.ts                       # Cordis 插件入口 (name/inject/apply)
│   ├── tools/
│   │   ├── analyze-image.ts           # aquasense_analyze: 视觉三分类
│   │   ├── generate-advice.ts         # aquasense_advice: IMA 知识库查询 + 分级建议
│   │   └── record-ledger.ts           # aquasense_ledger: 飞书 Bitable 追加写入
│   │   └── train_aquaspecies.py       # 水生物种识别模型训练脚本 (Python)
│   ├── ima/
│   │   └── ima-api.ts                 # IMA 知识库 API 封装
│   ├── feishu/
│   │   └── token.ts                   # 飞书 tenant_access_token 缓存
│   ├── router/
│   │   └── intent-router.ts           # 消息意图识别 (S1-S8 纯函数)
│   └── scheduler/
│       └── daily-reminder.ts          # S9 每日任务提醒独立进程
├── skills/
│   └── aquasense-expert/
│       └── SKILL.md                   # Agent 专家技能定义
├── docs/
│   ├── architecture.md                # 架构说明 (本文件)
│   ├── deployment.md                  # 部署文档
│   └── user-manual.md                 # 使用手册
├── .env.example                       # 环境变量模板
├── cordis.patch.yml                   # DSH 插件注册补丁
├── package.json                       # NPM 包配置
├── tsconfig.json                      # TypeScript 编译配置
└── .github/workflows/ci.yml           # GitHub Actions CI
```

---

## 4. 核心模块详解

### 4.1 插件入口 (`src/index.ts`)

Cordis 插件标准入口，负责注册 3 个业务 Tool：

```typescript
export const name = 'aquasense-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(analyzeImage)
  ctx.tools.register(generateAdvice)
  ctx.tools.register(recordLedger)
}
```

- `inject: ['tools']` — 声明依赖 DSH 的 tools 注册表
- `apply` — 插件激活时调用，注册 3 个工具

### 4.2 视觉分析工具 (`aquasense_analyze`)

**文件**: `src/tools/analyze-image.ts`
**场景**: S1/S2/S4/S5/S8（需要图片分析的场景共用）

**处理流程**:
1. 下载工人发送的图片，转 base64（30 秒超时）
2. 构建专家级提示词，调用 DeepSeek Vision 模型（默认 deepseek-flash）
3. 解析模型输出为结构化 JSON，归一化到三分类白名单

**输出契约**:
```typescript
interface AnalysisResult {
  abnormal: boolean        // 是否异常
  cls: 'normal' | 'early' | 'disease'  // 三分类
  symptoms: string[]       // 症状列表
  severity: 'low' | 'medium' | 'high' | 'critical'
  confidence: number       // 置信度 0-1
}
```

**容错设计**: 模型输出解析失败时降级为 `normal`，不阻断巡检流程。

### 4.3 处置建议工具 (`aquasense_advice`)

**文件**: `src/tools/generate-advice.ts`
**场景**: S2/S4/S5/S8（巡检诊断后调用）

**处理流程**:
1. 从 analyze 输出中提取症状关键词
2. 调用 IMA 知识库搜索疾病诊疗方案（`searchKnowledge`）
3. 根据严重程度（critical/high/medium/low）生成分级处置建议
4. 确定预警级别（P0/P1/P2）

**输出契约**:
```typescript
interface AdviceResult {
  diagnosis_summary: string       // 诊断摘要
  immediate_actions: string[]     // 立即行动
  follow_up_actions: string[]     // 后续观察
  medication: string              // 用药建议（疾病时建议咨询兽医）
  alert_level: 'P0' | 'P1' | 'P2'
  knowledge_refs: string[]        // 知识库参考来源
}
```

**安全原则**: 知识库仅作参考，疾病场景明确建议咨询专业兽医，不代替兽医开药。

### 4.4 台账写入工具 (`aquasense_ledger`)

**文件**: `src/tools/record-ledger.ts`
**场景**: S1-S8 中所有落表场景（排除 S3 知识询问）

**处理流程**:
1. 校验池号（缺失时返回追问，不写无池号脏数据）
2. 根据 scene 选择对应的飞书多维表格
3. 组装字段并调用飞书 Bitable API 追加写入

**场景-表格映射**:

| 场景 | 环境变量 | 表格列 |
|------|----------|--------|
| inspection | `TABLE_ID_INSPECTION` | 池号、巡检时间、巡检人、鱼群状态、症状描述、严重程度、AI诊断、处置建议、知识来源、是否预警 |
| water_quality | `TABLE_ID_WATER_QUALITY` | 池号、检测时间、溶氧、氨氮、pH、亚硝酸盐、AI分析 |
| medication | `TABLE_ID_MEDICATION` | 池号、用药时间、药品名称、用药剂量、用药方式 |
| feeding | `TABLE_ID_FEEDING` | 池号、喂食时间、饲料种类、投喂量、摄食情况 |
| temperature | `TABLE_ID_TEMPERATURE` | 池号、测量时间、水温、棚温 |
| death | `TABLE_ID_DEATH` | 池号、汇报时间、死亡数量、死亡状态、预警级别 |
| dissection | `TABLE_ID_DISSECTION` | 池号、汇报时间、解剖器官、异常信号 |

**inspection 便捷路径**: 传入 `analysis` + `advice` 时自动按巡检表列名组装字段，无需手动填写。

### 4.5 意图路由 (`intent-router.ts`)

**文件**: `src/router/intent-router.ts`
**类型**: 纯函数模块，不注册为 Tool

**场景识别优先级**（从高到低）:

| 优先级 | 场景 | 关键词 |
|--------|------|--------|
| 1 | S4 死亡汇报 | 死亡/死了/死鱼/浮尸/翻白 |
| 2 | S7 温度汇报 | 水温/棚温/温度 |
| 3 | S6 喂食汇报 | 喂食/投喂/吃料/饲料 |
| 4 | S5 用药 | 用药/药品/泼洒/拌料/消毒 |
| 5 | S8 解剖汇报 | 解剖/内脏/肝/胆/肠/鳃 |
| 6 | S1 水质汇报 | 水质/溶氧/氨氮/pH |
| 7 | S3 知识询问 | 怎么/如何/为什么/咨询 |
| 8 | S2 巡检（默认） | 带图消息或兜底 |

由消息宿主（dsh-lark）或 Agent 技能在消息处理前调用，确定场景后再编排工具调用链。

### 4.6 IMA 知识库封装 (`ima-api.ts`)

**文件**: `src/ima/ima-api.ts`

提供两个核心函数:
- `searchKnowledge(query)` — 搜索"水产养殖"知识库，返回匹配的知识条目
- `getMediaContent(mediaId)` — 获取知识条目正文文本（如《每日操作手册》内容）

**凭证获取**（两种方式任选）:
- 环境变量: `IMA_OPENAPI_CLIENTID` + `IMA_OPENAPI_APIKEY`
- 配置文件: `~/.config/ima/client_id` + `~/.config/ima/api_key`

### 4.7 飞书 Token 缓存 (`token.ts`)

**文件**: `src/feishu/token.ts`

获取飞书 `tenant_access_token` 并在进程内缓存，提前 5 分钟过期刷新。供台账写入和 S9 推送共用。

### 4.8 每日任务提醒 (`daily-reminder.ts`)

**文件**: `src/scheduler/daily-reminder.ts`
**运行方式**: 独立 Node.js 进程，与 DSH 并行运行

**工作流程**:
1. 启动时从 IMA 知识库拉取《每日操作手册》并按日缓存
2. 07:00 推送当日任务总览到飞书巡检群
3. 每分钟 tick，匹配任务时间点推送单条提醒
4. 重启不补推已过时间点的任务，防止重复打扰

**手册格式要求**: 每行一条任务，格式为 `HH:MM 任务描述`。

### 4.9 Agent 专家技能 (`skills/aquasense-expert/SKILL.md`)

定义 Agent 的行为规范:
- 三分类语义（normal/early/disease）
- 场景路由规则
- 工具编排顺序
- 数据准确度要求（池号必填、口语补全）
- 回复风格（简洁分点、预警标注）

---

## 5. 数据流

### 5.1 巡检流程（S2 默认场景）

```
工人发图+文字 → dsh-lark 转发 → intent-router 识别为 S2
    → aquasense_analyze(图片) → 三分类结果
    → aquasense_advice(分析结果) → IMA 查询 + 分级建议
    → aquasense_ledger(analysis + advice) → 飞书多维表格
    → Agent 回复工人诊断结论 + 台账确认
```

### 5.2 死亡汇报流程（S4 紧急场景）

```
工人发"池3死了3条鱼" → intent-router 识别为 S4（最高优先级）
    → aquasense_analyze(如有图) → 确认死亡状态
    → aquasense_advice → 紧急建议 + P0/P1 预警
    → aquasense_ledger(death, fields含死亡数量3) → 死亡记录表
    → Agent 回复 + 提醒 @负责人
```

### 5.3 每日提醒流程（S9）

```
daily-reminder 启动 → IMA 搜索《每日操作手册》→ 解析任务列表
    → 07:00 推送总览 → 每分钟 tick → 到点推送单条提醒
    → 工人按提醒执行 → 发消息汇报 → 进入 S1-S8 流程
```

---

## 6. 外部依赖

| 服务 | 用途 | 凭证 |
|------|------|------|
| DeepSeek Vision API | 图片分析（三分类） | `DEEPSEEK_API_KEY` |
| IMA 知识库 | 疾病诊疗方案 + 每日操作手册 | `IMA_OPENAPI_CLIENTID` + `IMA_OPENAPI_APIKEY` |
| 飞书开放平台 | 消息接收 + 多维表格写入 + 群消息推送 | `FEISHU_APP_ID` + `FEISHU_APP_SECRET` |
| DeepSeek Harness | Agent 框架 + 工具注册 + 消息路由 | 框架自身 |

---

## 7. 设计约束

- **台账只追加不修改**: 满足政府 2 年台账审计要求
- **池号必填校验**: 缺失池号时返回追问，不写脏数据
- **知识库降级容错**: IMA 不可用时使用内置通用建议模板，不阻断主流程
- **用药不代替兽医**: 疾病场景明确建议咨询专业兽医，知识库仅作参考
- **S9 重启不补推**: 防止重启后重复推送已过时间点的任务
- **仅 3 个 Tool**: 最大化复用 DSH 生态，降低维护成本
