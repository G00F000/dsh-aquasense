# R6：S9 每日任务提醒 — 功能架构设计文档

> - 总文档：[architecture.md](./architecture.md)（本文为其 S9 专题**分文档**，展开模块级/接口级设计；总文档仅保留概述与引用）
> - 需求依据：[requirements.md §R6](./requirements.md)
> - 状态：✅ 已实现（V2 插件内调度 + 原型 3 单入口；v1.7 起侧栏一级入口「🐟 AquaSense 配置」+ 会话列独立配置页，v1.8 移除设置卡片入口；见 §3.6 与 §8.5）

---

## 1. 背景与目标

### 1.1 需求回顾（V1 → V2）

| 维度 | V1（当前实现） | V2（目标方案） |
|------|----------------|----------------|
| 运行形态 | 独立调度器进程 `daily-reminder.ts` | 插件进程内模块（无独立进程） |
| 任务来源 | 插件端配置任务表（`S9_REMIND_TASKS`） | 同左（不再依赖知识库） |
| 推送方式 | 进程内 tick + 立即调用飞书消息 API | 同左（见 §1.4 决策） |
| 总览推送 | 固定 07:00 | `S9_REMIND_CRON` 定义（默认 07:00） |
| 重启语义 | 不补推、重启丢计划 | 恢复当日剩余计划、已推送不重复、已过时间点不补推 |
| 运维成本 | 需保活独立进程 | 随插件部署，零额外运维 |

### 1.2 设计目标

- 去掉独立调度器进程，S9 生命周期由插件托管（`apply()` 启动）
- 提醒内容仅来自插件端配置，支持部署（环境变量）与配置页（配置文件）两种来源
- 到点推送任务提醒卡片；工人按提醒拍照/汇报（落场景台账），异常自动预警
- 重启可恢复、当日不重复、已过时间点不补推
- 不新增 Tool、不引入外部调度组件（Redis/队列/cron 系统服务等）

### 1.3 设计约束

- **环境**：4 核 4G 服务器，轻量化优先
- **复用既有设施**：飞书 token 缓存（`src/feishu/token.ts`）、缓存目录约定（`AQUASENSE_CACHE_DIR`，绝对路径）
- **推送前置**：飞书应用已被添加为目标群机器人（`S9_REMIND_GROUP` 为群 `chat_id`）
- **仅提醒**：S9 不写任何多维表格、无打卡交互；工人响应仍走 S1-S8 主链路落场景表
- **不注册新 Tool**：S9 由插件宿主生命周期驱动，不经 Agent 按需调用

### 1.4 关键设计决策：定时机制选型

需求 R6.1/R6.3 初稿曾假定：调用“飞书定时消息 API”注册推送，由飞书平台按时推送（已按本决策同步修订，见 §7.2）。

**核实结论**：

- 飞书开放平台**没有**"注册式定时消息"能力；消息 API（`im/v1/messages`）均为即时发送
- 飞书客户端"定时发送消息"仅面向人工消息，不属于开放 API
- DSH 宿主未提供调度服务（`@deepseek-ai/*` 无调度组件）

**决策**：采用**插件内轻量调度** —— 插件进程内按任务表到点触发，调用飞书消息 API 即时推送；飞书平台仅承担消息投递。V1 的 tick 调度机制保留（已被验证可用），只是宿主从独立进程切换到插件进程。

| V1 问题 | V2 解决情况 |
|---------|-------------|
| 需要独立进程保活 | 随插件进程运行，无独立进程 ✅ |
| 运维成本高 | 仅一份配置，随插件部署/升级 ✅ |
| 重启后不补推 | 恢复当日剩余计划；已推送不重复（已过时间点仍不补推）✅ |
| 定时依赖平台能力 | 不依赖，进程内计时 ✅ |

> ✅ **需求文档已同步**：R6.1“飞书原生定时能力”、R6.3“调用飞书定时消息 API 注册推送”、R6.6“重启后重新注册推送（不持久化）”三处措辞已按 §7.2 修订为插件内调度语义。

---

## 2. 整体架构

### 2.1 组件架构

```
                         插件进程 (DSH 宿主内)
┌───────────────────────────────────────────────────────────────┐
│  dsh-aquasense 插件                                             │
│                                                               │
│  ┌───────────────┐    ┌────────────────────────────────────┐  │
│  │ index.ts      │    │  s9-reminder (插件内模块)            │  │
│  │ apply()       │───▶│                                    │  │
│  └───────────────┘    │  ┌──────────┐   ┌──────────────┐    │  │
│                       │  │ 配置解析  │──▶│ 推送计划生成  │    │  │
│                       │  └──────────┘   └──────┬───────┘    │  │
│                       │                        │            │  │
│                       │  ┌──────────┐   ┌──────▼───────┐    │  │
│                       │  │ 卡片构建  │◀──│ tick 执行器   │    │  │
│                       │  └────┬─────┘   │ (60s, 按日)  │    │  │
│                       │       │         └──────┬───────┘    │  │
│                       │       ▼                │            │  │
│                       │  ┌─────────────────────▼─────────┐  │  │
│                       │  │ 推送器 (飞书消息 API, token 复用)│  │  │
│                       │  └───────────────────────────────┘  │  │
│                       └────────────────────────────────────┘  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ 既有主链路: intent-router → analyze → advice → ledger   │   │
│  └───────────────────────────┬────────────────────────────┘   │
│                              │ analyze.abnormal → 触发预警卡片 │
│                              ▼                                │
│                      (复用 S9 推送器)                          │
└───────────────────────────────────────────────────────────────┘
                               │
                               ▼
                 飞书开放平台 (im/v1/messages, 即时投递)
                               │
                               ▼
                     清徐基地巡检群 (S9_REMIND_GROUP)
```

### 2.2 在总架构中的位置

| 方向 | 说明 |
|------|------|
| 上游 | 无外部上游（定时触发，不依赖工人消息） |
| 下游 | 飞书消息 API（卡片推送/更新）；工人响应后进入 S1-S8 主链路 |
| 主链路交点 | ① 工人按提醒拍照/汇报 → `intent-router` → S1-S8 正常落表；② `analyze` 检出 `early`/`disease` → 推送异常预警卡片（§4.3） |
| 共享设施 | 飞书 token 缓存（`src/feishu/token.ts`）、缓存目录 `AQUASENSE_CACHE_DIR/remind/` |

---

## 3. 核心模块设计

### 3.1 模块划分

| 模块 | 文件 | 职责 |
|------|------|------|
| S9 提醒主模块 | `src/scheduler/s9-reminder.ts` | 配置解析 + 计划生成 + tick 调度 + 卡片构建 + 推送 |
| 插件入口 | `src/index.ts` | `apply()` 中调用 `setupS9Reminder(ctx)`（enabled=false 时直接返回） |
| 飞书凭证 | `src/feishu/token.ts` | 复用，无改动 |

S9 主模块对外只暴露 2 个函数：

```typescript
// src/scheduler/s9-reminder.ts
export function setupS9Reminder(ctx: Context): void        // 插件启动/配置变更时调用
export async function pushAbnormalAlert(input: AbnormalAlertInput): Promise<void>  // 异常预警(供主链路调用)
```

### 3.2 配置模型

配置来源与优先级：**插件配置文件 > 环境变量**（配置文件为配置页「保存配置」的持久化产物；环境变量用于部署初始化；配置页入口见 §4.1）。

| 配置项 | 必填 | 默认 | 说明 |
|--------|:----:|------|------|
| `S9_REMIND_ENABLED` | 否 | `false` | 是否启用 S9 提醒 |
| `S9_REMIND_GROUP` | 启用时 ✅ | — | 推送目标群 `chat_id`（机器人须已入群） |
| `S9_REMIND_CRON` | 否 | `0 7 * * *` | 每日总览推送时刻（标准 5 段 cron；本场景仅使用"每天 HH:MM"语义） |
| `S9_REMIND_TASKS` | 否 | — | 任务列表（JSON 数组），元素形如 `{"time":"07:00","task":"开启增氧机,检查水质"}` |

配置文件位置：`$AQUASENSE_CACHE_DIR/remind/config.json`（与运行状态同目录，缓存目录已在 .gitignore 中）。

**校验规则**（非法值不阻断插件启动）：

| 校验项 | 规则 | 失败行为 |
|--------|------|----------|
| `S9_REMIND_GROUP` | 启用时必须非空 | 整体跳过 + warn |
| `S9_REMIND_CRON` | 5 段标准 cron，可解析出每日时刻 | 跳过总览项 + warn（单条提醒不受影响） |
| `S9_REMIND_TASKS` | JSON 数组；`time` 为合法 `HH:MM`；`task` 非空 | 非法条目跳过并计数 warn；全部非法 → 跳过当日推送 |
| 任务排序 | 按 `time` 升序 | 自动排序 |

### 3.3 推送计划生成

```
配置 (cron + tasks)
    │
    ▼
生成当日推送计划 PushPlan
  ├─ 总览项:  { time: <cron 解析时刻>, type: 'overview' }
  └─ 任务项:  { time: "07:00", type: 'task', task: "开启增氧机..." }
              { time: "08:00", type: 'task', ... } × N
    │
    ▼
按 time 升序 → 落盘 $AQUASENSE_CACHE_DIR/remind/plan-{date}.json
    │
    ▼
tick 执行器逐项消费
```

- 计划按"日"生成：启动时生成当日计划；tick 检测到日期变更时滚动生成新计划（任务配置变更次日生效 / 配置变更立即重建，见 §4.1）
- 落盘目的：重启后复用当日计划，保证"当日语义一致"（推送项不因重启而漂移）

### 3.4 调度执行器（tick）

```
setupS9Reminder(ctx)
    │
    ▼
读取配置 → enabled=false ? 返回 : 继续
    │
    ▼
加载/生成当日计划 (plan-{date}.json)
    │
    ▼
加载已推送标记 (sent-{date}.json) → 恢复内存去重集合
    │
    ▼
setInterval 60s tick:
    ① 日期变更? → 生成新一日计划 + 重置标记
    ② current = "HH:MM"(本地时区)
    ③ 计划中 time === current 且未推送过 → 推送 → 记录标记
    ④ 已过时间点 (time < current 且未推送) → 不补推, 留待次日
```

**关键语义**：

| 语义 | 实现 |
|------|------|
| 同分钟防重复 | 进程内 `Set<time>` 去重（tick 对齐误差兜底） |
| 重启防重复 | 磁盘标记 `sent-{date}.json`（推送成功才写入） |
| 不补推 | 仅匹配 `time === current`；错过即跳过 |
| 跨天滚动 | tick 检测日期变化 → 加载/生成新计划 |
| 配置变更 | 重建计划并重新执行（旧计划执行器先停） |

### 3.5 推送器与卡片构建

```
推送项 (type, task?)
    │
    ▼
buildCard():
  overview → 总览卡片 (§5 卡片 A)
  task     → 单条提醒卡片 (卡片 B)
    │
    ▼
POST /open-apis/im/v1/messages?receive_id_type=chat_id
  { receive_id: S9_REMIND_GROUP, msg_type: 'interactive', content: <card_json> }
    │
    ├─ 成功 → 记录 sent 标记 + 日志
    └─ 失败 → 30s 后重试 1 次 → 仍失败仅记录 (不阻断后续)
```

- 消息类型：`interactive`（卡片）；卡片 JSON 构造异常时降级为 `text` 文本消息（沿用 V1 文本格式）
- 凭证：复用 `getFeishuToken()`（缓存 + 自动刷新）

### 3.6 配置页（原型 3，Web 面）

> 对应需求 R6.5 原型 3「管理员配置界面」。Host 侧文件 `src/web/remind-gateway.ts`，浏览器侧 `src/client/`。

**入口与实现（v1.7 单入口；v1.8 起为唯一入口）**：

| 项 | 说明 |
|------|------|
| 需求原文 | DSH 界面中 AquaSense 插件一级按钮位于**设置图标上方**，点击跳转设置网页 |
| 平台核实 | 设置座位旁的一级动作注册面为 `sidebar.footer.action` 列表槽（`@deepseek-ai/dsh-client-ui-sidebar` 声明，owner `{ wide }`，渲染于设置座位旁的 footerActions 容器）；v1.5「无此注册面」结论已由 v1.7 修正 |
| 唯一入口（v1.7 起） | 侧栏页脚「🐟 AquaSense 配置」一级按钮（与设置按钮同级）：点击在会话列上打开**独立配置页**（`src/client/AquaConfig.tsx`，portal + fixed 定位，顶栏二级标题 + 右上角关闭） |

**v1.8 变更注（单入口制 + 页脚换行）**：

- 设置卡片入口（`settings.plugin.item` 键位槽，v1.5 交付）与 Host 侧 settings 配对命名空间（`registerRemindSettingsNamespace`）随 v1.8 整体移除；「🐟 AquaSense 配置」为唯一入口
- 宿主页脚动作容器（footerActions）为单行 flex（nowrap），多个整宽条目并排会互相挤压（插件广场被压窄、本入口贴边）；v1.8 在样式注入中以 `div:has(> [data-slot="sidebar.footer.action"]){flex-wrap:wrap}` 允许换行，使「插件广场 / AquaSense 配置 / 设置」各占一整行（56px 收起轨道下圆钮亦垂直堆叠）
- 配置读写仍不走宿主 settings 服务，唯一事实源是 `config.json`（§9），经 `/aquasense-remind/api` 直连读写

**组件架构**：

```
浏览器半侧 (dist/client.js)                     插件进程 (Host)
┌────────────────────────────┐    POST      ┌─────────────────────────────────────┐
│ AquaConfigEntry(侧栏入口)  │ ───────────▶ │ /aquasense-remind/api/{method}      │
│  └─ AquaConfigPage(配置页) │ ◀─────────── │  handleRemindHttp（协议层/校验）      │
│      └ RemindForm(共享表单)│              │   └─ createRemindApi（分发）          │
└────────────────────────────┘              │        ├─ get    → 配置 + 当日状态    │
                                            │        ├─ save   → 写 config.json     │
                                            │        │           + 重建当日计划     │
                                            │        ├─ test   → 立即推总览卡片     │
                                            │        └─ groups → 飞书群列表         │
                                            └─────────────────────────────────────┘
```

**API 协议**：

| 方法 | 请求体 | 成功响应 `value` | 失败 |
|------|--------|------------------|------|
| `get` | — | `{ config, status }` | — |
| `save` | `{ config: { enabled, group, tasks } }` | `{ config, status }` | 400 `invalid-config` |
| `test` | — | `{ sent: true }` | 400 `group-missing` / 502 `push-failed` |
| `groups` | — | `{ groups }`；拉取失败降级 `{ groups: [], error }`（仍 200） | — |

- 响应信封：`{ ok: true, value }` / `{ ok: false, error: { code, message } }`
- 协议层防护：仅 POST（405）、同源校验（403，无 Origin 放行）、JSON Content-Type（415）、路径解析（404）、请求体 ≤ 16KB（413）、非法 JSON（400）、兜底 500
- 服务端校验：任务 ≤ 50 条、`time` 为 `HH:MM`（自动补零）、`task` 非空且 ≤ 200 字、`group` ≤ 128 字符
- `cron` 不在配置页暴露，保存时保留现值（§3.2）

**保存 / 测试语义**（对应 §4.1 流程）：

- 「保存配置」→ `saveRemindConfig()`：写 `config.json` → 立即 `setupS9Reminder()` 重建当日计划并重启 tick（已推送项由 sent 标记保留）
- 「发送测试提醒」→ `sendTestReminder()`：仅用**已保存**配置立即推送一次总览卡片；不落计划、不影响 sent 标记、不做 30s 重试
- 「放弃修改」→ 草稿回滚为已保存快照（不清空提示，回到 idle）
- 前端草稿未保存（dirty）时禁用「发送测试提醒」并提示先保存；加载失败可重试

**卡片 UI（v1.6 交付，随卡片于 v1.8 移除）**（对齐 SkillHub 插件广场设置卡，详见 requirements.md 原型 3「UI 实现注（v1.6）」）：

- 头部为「展开区 + 独立收起按钮」：展开区（标题/描述/未保存徽标，`aria-expanded`）+ 28×28 独立按钮（内嵌箭头，展开态 `rotate(180deg)`，`aria-label` 收起/展开）
- 展开态卡底色切换为 `--dsw-alias-bg-layer-2`；未保存徽标用 warn 色（`--dsw-alias-state-warn-*`）；字段间分隔线；输入框 `--dsw-specific-input-major`
- 底部操作区：「发送测试 / 放弃修改 / 保存配置」，错误信息在操作行左侧（`--dsw-alias-state-error-primary`）；主按钮用 `--dsw-alias-button-primary-fill`，禁用态 `opacity:.4`

**配置页 UI（v1.7，对齐 SkillHub 插件广场）**：

- 侧栏入口（`sidebar.footer.action`）：宽态为 42px 行内「🐟 + AquaSense 配置」；56px 收起轨道为 36×36 圆形图标按钮；悬停/展开态复用侧栏导航项令牌
- 配置页：`createPortal` 至 body，`fixed` 覆盖会话列（`[data-phase]` 矩形，经 ResizeObserver 跟踪尺寸变化与滚动；无会话列回退整窗）；顶栏为二级标题「每日任务提醒」（h2）+ 右上角 32×32 关闭按钮；内容区最大宽度 760px
- 交互：Esc / 点击面板外关闭（忽略面板与入口内的 pointerdown）
- 表单：配置页使用 `RemindForm.tsx`（`useRemindConfig` 数据层 + `RemindForm` 视图；v1.8 起为唯一使用方）
- 样式注入：`ensureAquaConfigStyle()` 幂等写入 `<style id="aquasense-config-style">`（类名 `aqs-` 前缀，经 `ctx.effect` 挂载）

**降级**：

| 场景 | 行为 |
|------|------|
| 群列表拉取失败（token/网络/权限） | 切换为手填输入框（chat_id），不阻断保存与测试 |
| `webServer` 服务缺失 | API 路由注册静默跳过；卡片显示不可用并可重试 |
| settings 命名空间重复注册 | 静默跳过（重复加载/热更新兜底） |

**构建与加载**：

- 浏览器半侧由 **tsdown** 打包为 `dist/client.js`（DSH module-loader 包裹的 CJS；React/cordis/client-store 保持 external，由运行时模块表提供）
- `package.json` → `dsh.client`（`platform: 'web'` + inject 4 个客户端包）；`exports['./client']` 指向该产物；类型声明由 `tsc` 产出（`dist/client/*.d.ts`）
- `npm run build` = `tsc -p tsconfig.build.json` + `tsdown -c tsdown.config.ts`；仅重建浏览器侧可用 `npm run build:client`

---

## 4. 关键流程

### 4.1 启动 / 配置变更

```
插件 apply() 触发
    │
    ▼
setupS9Reminder(ctx)
    │
    ├─ 读取配置(文件 > 环境变量)
    ├─ enabled=false → 日志跳过, 结束
    │
    ▼
校验 (group / cron / tasks) → 非法项跳过 + warn
    │
    ▼
计划存在(plan-{date}.json)? ──是──▶ 直接加载
    │ 否
    ▼
生成今日计划 → 落盘
    │
    ▼
启动 tick 执行器 (60s)
    │
    ▼
返回: 已加载 N 项推送(其中 M 项已推送)
```

- 配置页入口：侧栏页脚「🐟 AquaSense 配置」一级按钮（`sidebar.footer.action` 槽，v1.7 交付；原型还原与 v1.8 调整见 §3.6）
- 配置页「保存配置」→ 写 `config.json` → 重新调用 `setupS9Reminder`（重建计划）
- 配置页「发送测试提醒」→ 直接调用推送器发送一次总览卡片（不注册、不落计划）

### 4.2 到点推送

```
tick 60s
    │
    ▼
current = "10:00"
    │
    ▼
匹配计划项 time === "10:00" 且未推送
    │
    ├─ 总览项 → 总览卡片 (任务表 + 台账链接)
    └─ 任务项 → 单条提醒卡片 (任务 + 检查要点 + 拍照URL跳转 + 剩余任务)
    │
    ▼
推送成功 → sent-{date}.json 追加记录
```

卡片中「📷 拍照汇报」按钮为 URL 类型，点击后在飞书内置浏览器打开 H5 上传页（§5.4），工人选图+填描述+提交 → 服务端 AI 分析 → 落台账。

### 4.3 异常预警卡片

```
工人响应提醒(两种路径):
  路径A: 点击卡片「📷 拍照汇报」→ H5 上传页 → 提交 → 服务端分析
  路径B: 群聊中直接发送图片 → S1-S8 主链路(降级路径)
    │
    ▼
analyze.abnormal === true (cls = early/disease) ?
    │ 是
    ▼
pushAbnormalAlert() → 异常预警卡片 (卡片 C):
  ⚠️ 异常预警 + 池号/状态/症状/严重度 + 处置建议 + 查看详情/通知负责人
    │ 否
    ▼
正常落表, 不发预警
```

---

## 5. 消息卡片设计

### 5.1 卡片与原型映射

| 卡片 | 触发时机 | 需求原型 | 关键按钮 |
|------|----------|----------|----------|
| A 每日任务总览 | 每日 cron 时刻（默认 07:00） | 原型 1 | 查看今日台账 |
| B 单条任务提醒 | 任务 `time` 到点 | 原型 2 | 拍照汇报（URL → H5 上传页） |
| C 异常预警 | `analyze` 检出 `early`/`disease` | 原型 4 | 查看详情 / 通知负责人 |

> 原型 3（管理员配置界面）不是飞书消息卡片，而是 DSH 侧栏入口打开的独立配置页，见 §3.6。

### 5.2 卡片 JSON 骨架（以卡片 B 为例）

```json
{
  "config": { "wide_screen_mode": true },
  "header": { "template": "blue", "title": { "tag": "plain_text", "content": "⏰ 10:00 巡检提醒" } },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "**📋 巡检各池鱼群状态（池1→池4）**" } },
    { "tag": "div", "text": { "tag": "lark_md", "content": "**检查要点:**\n• 鱼群活动状态（集群/离群/浮头）\n• 水色变化\n• 有无死鱼" } },
    { "tag": "action", "actions": [
      { "tag": "button", "text": { "tag": "plain_text", "content": "📷 拍照汇报" }, "type": "primary",
        "url": "http://SERVER:PORT/aquasense-remind/report?task=巡检各池鱼群状态&time=10:00&chat_id=oc_xxx" }
    ]},
    { "tag": "note", "elements": [ { "tag": "plain_text", "content": "剩余任务: 14:00 投喂午餐 / 16:00 下午巡检 / 18:00 晚餐" } ] }
  ]
}
```

> 按钮采用 `url` 类型（非 `value` 回调），点击后在飞书内置浏览器打开 H5 上传页。URL 参数携带任务描述、时间和群 ID，H5 页面据此初始化表单。

### 5.3 按钮交互链路（URL 跳转 → H5 上传页）

```
按钮点击 (卡片 url 属性,飞书内置浏览器打开)
    │
    ▼
H5 上传页加载 (/aquasense-remind/report?task=...&time=...&chat_id=...)
    │
    ├─ 顶部:展示任务描述 + 时间(从 URL 参数读取)
    ├─ 照片区:<input type="file" accept="image/*" multiple capture="environment">
    │         → 手机端自动调起相机/相册,支持多选
    ├─ 池号:下拉选择(池1/池2/池3/池4)
    ├─ 描述:文字输入框(可选)
    │
    ▼
工人点击「完成汇报」→ 前端压缩图片(≤1024px) → multipart POST
    │
    ▼
POST /aquasense-remind/api/report/submit
    │
    ├─ 1. 接收:images[] + description + pool_id + task + time + chat_id
    ├─ 2. 图片转 base64(复用 analyze-image.ts 逻辑)
    ├─ 3. 调用 DeepSeek 视觉模型分析(aquasense_analyze)
    ├─ 4. 生成处置建议(aquasense_advice)
    ├─ 5. 落入多维表格台账(aquasense_ledger)
    │
    ├─ 成功 → 返回分析结果 JSON → H5 页面展示摘要
    │         + 可选:群内推送分析摘要消息
    └─ 失败 → 返回错误 → H5 页面展示错误提示
```

**降级路径（H5 上传页不可达时）**：

如果工人手机无法访问 H5 页面（网络不通、服务器未启动等），保留原有引导文案作为降级——卡片按钮回调触发机器人回复 "请直接拍照发送到本群,我会自动记录台账"，工人在群聊中手动发送图片走 S1-S8 主链路。

> 实现注：飞书卡片 `url` 类型按钮在手机端自动用内置浏览器打开，可同时支持 `<input capture="environment">`（后置摄像头拍照）和相册多选。服务端复用现有 `callVisionModel` + `buildFields` + 飞书多维表格 API，无需新增 AI 分析能力。

### 5.4 H5 上传页设计

**页面路由**：`GET /aquasense-remind/report`（静态 HTML，由插件 Web 服务托管）

**URL 参数**（由卡片按钮携带）：

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `task` | 是 | 任务描述（URL 编码），如 `巡检各池鱼群状态` |
| `time` | 是 | 任务时间 `HH:MM` |
| `chat_id` | 否 | 群 ID，用于服务端关联消息上下文 |

**页面结构**：

```
┌─────────────────────────────────────┐
│  📋 {task}                          │
│  ⏰ {time}                          │
├─────────────────────────────────────┤
│                                     │
│  📷 选择照片                         │
│  ┌─────────────────────────────┐    │
│  │  拍照  |  从相册选择          │    │
│  │  支持多张，建议 ≤5 张         │    │
│  └─────────────────────────────┘    │
│  已选: [缩略图1 ✕] [缩略图2 ✕]     │
│                                     │
│  池号: [请选择 ▼]                    │
│  描述: [________________]           │
│                                     │
│  [ ✅ 完成汇报 ]                     │
└─────────────────────────────────────┘
```

**前端处理**：

1. 图片选择：`<input type="file" accept="image/*" multiple capture="environment" />`
   - 移动端：点击触发相机/相册选择器（系统原生 UI）
   - 桌面端：文件选择器
2. 图片压缩：Canvas 缩放至最长边 ≤1024px，JPEG 质量 0.8（减少上传体积，手机原图通常 3-5MB → 压缩后 ~200-500KB）
3. 提交：`multipart/form-data` POST 到 `/aquasense-remind/api/report/submit`
4. 结果展示：页面显示分析摘要（状态/置信度/症状）

**服务端 API**：

```
POST /aquasense-remind/api/report/submit
Content-Type: multipart/form-data

字段:
  images[]     - 图片文件(多张)
  description  - 文字描述(可选)
  pool_id      - 池号
  task         - 任务描述
  time         - 任务时间
  chat_id      - 群 ID(可选)
```

**服务端处理链路**（复用现有模块）：

```
接收 multipart → 图片 Buffer → base64 编码
    │
    ▼
callVisionModel(images, prompt)    ← 复用 analyze-image.ts
    │
    ▼
生成处置建议                        ← 复用 generate-advice.ts
    │
    ▼
buildFields + 飞书多维表格 API      ← 复用 record-ledger.ts
    │
    ▼
返回 { success, analysis, advice, ledger_url }
```

**安全性**：

- 同源校验：与现有 `/aquasense-remind/api` 路由共用 Origin 检查
- 图片大小限制：单张 ≤10MB，总数 ≤9 张
- 池号白名单：仅允许 池1/池2/池3/池4
- 无认证 token 场景：依赖同源校验 + 群 ID 关联；如需更强认证可后续增加一次性 token

---

## 6. 容错与降级

| 故障场景 | 检测方式 | 降级行为 |
|----------|----------|----------|
| 飞书 API 不可用 | 推送请求失败 | 重试 1 次(30s)；仍失败仅记录日志，不阻断插件启动与后续任务 |
| `S9_REMIND_GROUP` 未配置 | 启动校验 | 整体跳过 + warn（不推送任何消息） |
| Cron 表达式非法 | 解析失败 | 跳过总览项 + warn；单条提醒照常 |
| 任务列表为空/全部非法 | 解析后计数 | 跳过当日推送 + warn |
| Token 失效 | 推送返回鉴权错误 | 清缓存重取 token 重试（`getFeishuToken` 缓存机制内处理） |
| 卡片 JSON 构造失败 | try-catch | 降级 `text` 文本消息推送 |
| 重启 | 启动时加载 | 复用当日计划 + sent 标记；已推送不重复、已过时间点不补推 |
| 跨天滚动 | tick 日期比对 | 自动生成新一日计划 |
| 同分钟重复 tick | 进程内 Set | 跳过重复推送 |
| H5 上传页不可达（网络不通/服务器未启动） | 卡片按钮 URL 打开失败 | 工人回退到群聊手动发送图片 → S1-S8 主链路 |
| H5 上传页图片提交失败 | POST 返回非 200 | 页面展示错误提示，工人可重试或回退群聊发图 |
| H5 上传页图片超限（>10MB 或 >9 张） | 前端校验 | 提交前拦截并提示工人减少图片数量或压缩 |

---

## 7. 与 V1 的差异及迁移

### 7.1 差异清单

| 项 | V1 | V2 |
|----|----|----|
| 运行形态 | 独立进程（`npm run remind`） | 插件内模块（`apply()` 托管） |
| 包入口 | `bin.dsh-aquasense-remind` | 移除 |
| 任务来源 | 知识库《每日操作手册》 | 插件端配置任务表（已迁移） |
| 消息形态 | 纯文本 | interactive 卡片（降级文本） |
| 状态文件 | `manual-{date}.json` / `overview/missing.mark` | `plan-{date}.json` / `sent-{date}.json` |
| 总览语义 | 进程启动补推当日总览 | 计划内总览项到点推送；重启恢复 |

### 7.2 需求文档同步记录

> 依据 §1.4 决策，[requirements.md](./requirements.md) 以下措辞已同步修订（对照记录：中列为修订前原文，右列为现文）：

| 位置 | 修订前 | 现文 |
|------|------|------|
| R6.1 目标方案（V2） | "调用**飞书定时消息 API** 注册推送任务；飞书平台负责按时推送" | "插件进程内按任务表到点触发，调用飞书消息 API 即时推送" |
| R6.1 优势 | "飞书原生定时能力" | "无独立进程 + 重启恢复当日剩余计划" |
| R6.3 流程图 | "调用飞书定时消息 API 注册推送 / 返回: 已注册 N 条" | "启动 tick 执行器 → 到点调用飞书消息 API / 返回: 已加载 N 项推送" |
| R6.6 | "重启后重新注册推送（飞书定时消息不持久化）" | "重启后恢复当日剩余计划（已推送不重复、已过时间点不补推）" |

### 7.3 迁移步骤

1. 新增 `src/scheduler/s9-reminder.ts`（V2 主模块）
2. `src/index.ts` 的 `apply()` 接入 `setupS9Reminder(ctx)`
3. `package.json` 移除 `bin.dsh-aquasense-remind`、`remind`、`remind:prod`
4. 删除 `src/scheduler/daily-reminder.ts`（独立进程下线）
5. 按 §7.2 同步需求文档措辞；`.env.example` 更新（`FEISHU_WORKER_GROUP` → `S9_REMIND_GROUP`）
6. 清理旧状态文件（`manual-*.json` / `*.mark`），S9 缓存目录切换为 `remind/`

---

## 8. 文件变更矩阵

### 8.1 新增文件

| 文件路径 | 行数估计 | 说明 |
|----------|---------|------|
| `src/scheduler/s9-reminder.ts` | ~450 行 | S9 主模块：配置/计划/tick/卡片/推送 |
| `docs/s9-daily-reminder-architecture.md` | 本文 | S9 专题架构设计（分文档） |

### 8.2 修改文件

| 文件路径 | 变更类型 | 变更说明 |
|----------|---------|----------|
| `src/index.ts` | 接入 | `apply()` 调用 `setupS9Reminder(ctx)` |
| `src/scheduler/s9-reminder.ts` | 扩展 | 卡片 B 按钮从 `value` 回调改为 `url` 跳转（§5.2） |
| `src/web/remind-gateway.ts` | 扩展 | 新增 `/report` 静态页面路由 + `/api/report/submit` 上传处理路由（§5.4） |
| `package.json` | 清理 | 移除 `bin` 与 `remind`/`remind:prod` scripts |
| `.env.example` | 更新 | S9 段与 `S9_REMIND_*` 对齐（移除 `FEISHU_WORKER_GROUP` 旧项） |
| `docs/architecture.md` | 引用 | S9 概述改为摘要 + 指向本文（分-总关系） |

### 8.3 删除文件

| 文件 | 理由 |
|------|------|
| `src/scheduler/daily-reminder.ts` | 独立调度器进程下线，由 V2 插件内模块接替 |

### 8.4 不变更文件

| 文件 | 理由 |
|------|------|
| `src/feishu/token.ts` | 直接复用 |
| `src/tools/*` | 主链路不变；仅 `analyze` 结果驱动预警卡片（新增调用点） |
| `src/router/intent-router.ts` | S9 不经意图路由 |

### 8.5 原型 3（配置页）文件清单

| 文件路径 | 变更 | 说明 |
|----------|------|------|
| `src/web/remind-gateway.ts` | 新增 | Host 侧：`/aquasense-remind/api` 路由（校验/协议层/群列表）；v1.8 移除 settings 配对命名空间 |
| `src/client/index.ts` | 新增 | 浏览器侧入口：字典注册 + `sidebar.footer.action` 侧栏入口注册（v1.8 移除卡片注册） |
| `src/client/RemindCard.tsx` | 新增（v1.5）→ 删除（v1.8） | 设置卡片外壳（单入口制后移除，表单由 RemindForm 承接） |
| `src/client/RemindForm.tsx` | 新增（v1.7） | 配置表单：`useRemindConfig` 数据层 + `RemindForm` 视图（v1.8 起为配置页唯一使用方） |
| `src/client/AquaConfig.tsx` | 新增（v1.7） | 侧栏一级入口 + 会话列独立配置页（portal 定位 / Esc 与外点关闭 / `aqs-` 样式注入 / v1.8 页脚换行适配） |
| `src/client/api.ts` | 新增 | 浏览器侧 API 封装（信封解包） |
| `src/client/locales.ts` | 新增 | 配置页文案 zh/en 字典 |
| `src/web/remind-gateway.test.ts` | 新增 | gateway 单元测试（校验/分发/协议层，26 例） |
| `tsdown.config.ts` | 新增 | 浏览器 bundle 构建配置 |
| `src/scheduler/s9-reminder.ts` | 扩展 | 新增 §7 配置页接口（get/save/test/status）+ 导出 `DEFAULT_CRON` |
| `src/index.ts` | 接入 | `apply()` 增调 `installRemindWeb(ctx)` |
| `package.json` | 更新 | `exports['./client']`、`dsh.client`、`build:client` 脚本、客户端 peer 声明 |
| `tsconfig.json` | 更新 | `jsx: react-jsx`（客户端 TSX 编译） |

### 8.6 H5 拍照上传页文件清单

| 文件路径 | 变更 | 说明 |
|----------|------|------|
| `src/web/report-upload.html` | 新增 | H5 拍照上传页（移动端优先，含图片压缩 + 表单提交 + 结果展示） |
| `src/web/report-handler.ts` | 新增 | 服务端上传处理：multipart 解析 → 图片 base64 → 调用 analyzeImage + generateAdvice + recordLedger |
| `src/web/remind-gateway.ts` | 扩展 | 新增 `GET /report` 路由（返回静态 HTML）+ `POST /api/report/submit` 路由（调用 report-handler） |
| `src/scheduler/s9-reminder.ts` | 扩展 | `buildTaskCard()` 按钮从 `value` 改为 `url`，URL 指向 H5 上传页 |

---

## 9. 存储设计

```
$AQUASENSE_CACHE_DIR/          # 绝对路径(Linux: /data/aquasense/cache)
  pdf/  note/  pdf-index/      # [已有] 知识库通道
  remind/                      # [新增] S9 运行状态
    config.json                #   配置页「保存配置」持久化(优先于环境变量)
    plan-2026-09-16.json       #   当日推送计划(重启复用)
    sent-2026-09-16.json       #   当日已推送标记(防重启重复)
```

- 均为**可重建状态**：`plan` 可由配置重建，`sent` 丢失最坏情况为重启后当日重复推送一次（可接受）
- 跨天自动滚动，历史文件保留最近 N 日（清理策略：保留 7 日）

---

## 10. 可观测性

```
[aquasense-remind] 配置加载: enabled=true, group=oc_xxx, 任务 N 项, 总览时刻 07:00
[aquasense-remind] 2026-09-16 计划生成: 7 项(总览1 + 任务6)
[aquasense-remind] 2026-09-16 调度启动, 当前 08:30(已推送 2, 待推送 4)
[aquasense-remind] 已推送: 08:00 投喂早餐
[aquasense-remind] 推送失败(10:00 巡检), 30s 后重试
[aquasense-remind] 重试仍失败(10:00 巡检): <error>
[aquasense-remind] 跨天滚动: 生成 2026-09-17 计划
[aquasense-remind] 预警卡片已推送: 池3 early(medium)
[aquasense-remind] H5 汇报已接收: 池1 巡检, 2 张图片, 来源 chat_id=oc_xxx
[aquasense-remind] H5 汇报分析完成: 池1 normal(0.92), 已落台账
[aquasense-remind] H5 汇报分析异常: 池3 early(0.85), 已落台账 + 预警卡片已推送
```

关键事件：配置加载、计划生成、逐条推送、失败重试、跨天滚动、预警推送、H5 汇报接收与分析。

---

## 11. 里程碑

| 阶段 | 内容 | 前置 | 状态 |
|------|------|------|------|
| M1 | 配置解析 + 计划生成 + 落盘 | 无 | ✅ 已实现 |
| M2 | tick 执行器 + 推送器（文本消息打通） | M1 | ✅ 已实现 |
| M3 | 总览/单条提醒卡片（interactive） | M2 | ✅ 已实现 |
| M4 | 按钮回调（拍照引导/台账跳转） | M3 | 🔄 部分实现（卡片按钮已下发；回调链见 §5.3） |
| M5 | 异常预警卡片 + 主链路接入 | M4 | ✅ 已实现 |
| M6 | V1 下线（进程/包入口/旧状态清理）+ 部署验证 | M5 | ✅ 已实现（部署验证见下方验收要点） |
| M7 | H5 拍照上传页 + 服务端分析链路 | M3 | 🔲 待实现（§5.4；卡片按钮 URL 跳转 → H5 选图 → AI 分析 → 落台账） |

**验收要点**（对应需求 R6.6）：

- [ ] 启用后到点推送总览与单条提醒，链接、剩余任务正确
- [ ] 重启插件：当日已推送不重复；已过时间点不补推；剩余计划恢复
- [ ] 同一时间点仅推送一次（幂等）
- [ ] 仅提醒：卡片无打卡交互，S9 不写任何多维表格
- [ ] 飞书不可用/群未配置/Cron 非法/任务表为空：降级为日志，不阻断插件启动
- [ ] `early`/`disease` 分析后自动推送异常预警卡片
- [ ] M7：卡片「拍照汇报」按钮点击后打开 H5 上传页
- [ ] M7：H5 页支持拍照+相册多选，图片压缩后提交
- [ ] M7：服务端接收图片 → AI 分析 → 落台账，结果回显 H5 页面
- [ ] M7：H5 不可达时降级为群聊发图走 S1-S8 主链路
