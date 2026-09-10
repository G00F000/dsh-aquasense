# dsh-aquasense 部署文档

## 1. 环境要求

### 1.1 运行环境

| 组件 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 22.19.0 | DSH 框架和插件运行时 |
| npm | 随 Node.js 安装 | 包管理器 |
| Python | >= 3.10（可选） | 仅物种识别模型训练脚本需要 |
| DeepSeek Harness | dsh-web 0.1.x | Agent 框架宿主 |

### 1.2 外部服务账号

部署前需提前开通以下服务并获取凭证:

| 服务 | 开通方式 | 所需权限 |
|------|----------|----------|
| DeepSeek API | [platform.deepseek.com](https://platform.deepseek.com) | 视觉模型调用额度 |
| IMA 知识库 | [ima.qq.com](https://ima.qq.com) | OpenAPI 接入权限 |
| 飞书开放平台 | [open.feishu.cn](https://open.feishu.cn) | `bitable:app`、`im:message` 权限 |

---

## 2. 飞书应用配置

### 2.1 创建飞书应用

1. 登录 [飞书开放平台](https://open.feishu.cn)，进入「开发者后台」
2. 创建企业自建应用，记录 `App ID` 和 `App Secret`
3. 在「权限管理」中申请以下权限:
   - `bitable:app` — 多维表格读写
   - `im:message` — 消息发送
4. 在「事件订阅」中配置消息接收地址（对接 dsh-lark 消息桥）

### 2.2 创建多维表格

1. 在飞书中创建多维表格，命名为「水产养殖台账」
2. 记录表格的 `app_token`（URL 中 `/base/` 后的字符串）
3. 创建至少一张巡检记录表，列名需与下表一致:

**巡检表（必须）列名**:

| 列名 | 类型 | 说明 |
|------|------|------|
| 池号 | 文本 | 池1/池2/池3/池4 |
| 巡检时间 | 日期时间 | 自动填入 |
| 巡检人 | 文本 | 工人姓名 |
| 鱼群状态 | 单选 | normal/early/disease |
| 症状描述 | 文本 | 症状关键词 |
| 严重程度 | 单选 | low/medium/high/critical |
| AI诊断 | 文本 | 模型诊断摘要 |
| 处置建议 | 文本 | 建议操作列表 |
| 知识来源 | 文本 | IMA 知识库参考 |
| 是否预警 | 复选框 | 是否触发预警 |

4. 按需创建其他场景表（水质、用药、喂食、温度、死亡、解剖），每张表创建后记录其 `table_id`
5. 为每张表记录 `table_id`（打开表后 URL 中 `/table/` 后的字符串）

### 2.3 配置飞书群机器人

1. 将飞书应用添加到巡检工作群
2. 记录群的 `chat_id`（作为 `FEISHU_WORKER_GROUP` 的值）

---

## 3. 代码部署

### 3.1 克隆代码

```bash
git clone https://github.com/G00F000/dsh-aquasense.git
cd dsh-aquasense
```

### 3.2 安装依赖

```bash
npm ci
```

### 3.3 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入实际凭证
```

**环境变量清单**:

```bash
# ===== 图像分析（必填）=====
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_VISION_MODEL=deepseek-flash          # 默认值，可不填
DEEPSEEK_BASE_URL=https://api.deepseek.com  # 默认值，可不填

# ===== IMA 知识库（必填）=====
# 方式 A: 环境变量
IMA_OPENAPI_CLIENTID=xxxxxxxx
IMA_OPENAPI_APIKEY=xxxxxxxx
# 方式 B: 配置文件（二选一）
# mkdir -p ~/.config/ima
# echo "your_client_id" > ~/.config/ima/client_id
# echo "your_api_key" > ~/.config/ima/api_key

# ===== 飞书应用凭证（必填）=====
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx

# ===== 飞书多维表格（必填 app_token + 巡检表）=====
FEISHU_BITABLE_APP_TOKEN=xxxxxxxx
FEISHU_BITABLE_TABLE_ID_INSPECTION=xxxxxxxx   # S2 巡检记录（必须）

# 可选场景表
FEISHU_BITABLE_TABLE_ID_WATER_QUALITY=xxxxxxxx
FEISHU_BITABLE_TABLE_ID_MEDICATION=xxxxxxxx
FEISHU_BITABLE_TABLE_ID_FEEDING=xxxxxxxx
FEISHU_BITABLE_TABLE_ID_TEMPERATURE=xxxxxxxx
FEISHU_BITABLE_TABLE_ID_DEATH=xxxxxxxx
FEISHU_BITABLE_TABLE_ID_DISSECTION=xxxxxxxx

# ===== S9 每日任务提醒（启用时必填）=====
FEISHU_WORKER_GROUP=oc_xxxxxxxx
AQUASENSE_CACHE_DIR=./cache                   # 可选，默认 ./cache
```

### 3.4 构建

```bash
npm run build
```

输出目录: `dist/`（ESM 格式，NodeNext 模块解析）。

### 3.5 类型检查

```bash
npm run typecheck
```

---

## 4. 安装到 DeepSeek Harness

### 4.1 安装飞书消息桥（前置依赖）

```bash
dsh plugin add dsh-lark
```

### 4.2 安装本插件

三种方式任选其一:

```bash
# 方式 A: npm 安装（推荐，需先发布到 npm）
dsh plugin add dsh-aquasense

# 方式 B: GitHub 安装（推荐，无需发布 npm）
dsh plugin add github:G00F000/dsh-aquasense

# 方式 C: 本地路径安装（开发调试用）
dsh plugin add /path/to/dsh-aquasense
```

**三种方式对比**:

| 对比项 | npm | GitHub | 本地路径 |
|--------|-----|--------|----------|
| 安装命令 | `dsh plugin add dsh-aquasense` | `dsh plugin add github:G00F000/dsh-aquasense` | `dsh plugin add /path/to/dsh-aquasense` |
| 版本管理 | `npm version` + `npm publish` | git tag | 手动管理 |
| 前置条件 | npm 账号 + 发布 | GitHub 仓库 | 本地代码 + 构建 |
| 适用场景 | 正式发布 | 源码分发 | 本地开发调试 |

> **注意**: 插件安装到 Profile 层（全局），所有工作区和飞书消息都会触发，无需每个工作区单独安装。

安装后重启 DSH 使其生效:

```bash
dsh restart
```

### 4.3 安装专家技能（可选）

```bash
dsh skill add ./skills/aquasense-expert
```

技能安装后，Agent 会自动加载巡检专家的场景路由规则和工具编排规范。

---

## 5. 启动服务

### 5.1 启动 DSH 主服务

```bash
# 启动 DeepSeek Harness（包含 dsh-aquasense 插件）
dsh start
```

插件会在 DSH 启动时自动加载，控制台输出:

```
[aquasense] 加载水产养殖工具...
[aquasense] 工具加载完成
[aquasense] 知识库查询:generate-advice 内置 IMA API 自动查询
```

### 5.2 启动 S9 每日任务提醒（独立进程）

```bash
# 开发模式
npm run remind

# 生产模式
npm run remind:prod
# 或直接运行
node dist/scheduler/daily-reminder.js
```

S9 调度器与 DSH 主服务**并行运行**，互不依赖。

### 5.3 后台运行（生产环境推荐）

使用进程管理器保持服务常驻:

**PM2 方式**:

```bash
# 安装 PM2
npm install -g pm2

# 启动 DSH
pm2 start dsh --name "dsh-main" -- start

# 启动 S9 提醒
pm2 start dist/scheduler/daily-reminder.js --name "aquasense-remind"

# 保存进程列表 & 设置开机自启
pm2 save
pm2 startup
```

**Docker 方式**（参考）:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY cordis.patch.yml skills/ ./
CMD ["node", "dist/index.js"]
```

---

## 6. 飞书多维表格列名适配

台账写入工具（`aquasense_ledger`）的字段键名必须与飞书多维表格的实际列名**完全一致**。

如果实际表格列名与默认值不同，有两种适配方式:

### 方式 A: 修改代码中的列名定义

编辑 `src/tools/record-ledger.ts` 中的 `SCENE_COLUMNS` 常量:

```typescript
const SCENE_COLUMNS: Record<LedgerScene, string[]> = {
  inspection: ['池号', '你的列名1', '你的列名2', ...],
  // ... 按实际表格修改
}
```

### 方式 B: Agent 调用时显式传入 fields

Agent 技能编排工具时，直接传入与表格列名一致的 `fields` 对象:

```json
{
  "scene": "water_quality",
  "pool_id": "池3",
  "fields": {
    "池号": "池3",
    "检测时间": "2026-09-10T14:30:00",
    "溶氧(mg/L)": 5.2,
    "氨氮(mg/L)": 0.1,
    "pH值": 7.4
  }
}
```

---

## 7. 验证部署

### 7.1 检查插件加载

启动 DSH 后，确认控制台输出:

```
[aquasense] 加载水产养殖工具...
[aquasense] 工具加载完成
```

### 7.2 测试图片分析

通过飞书向机器人发送一张鲈鱼照片，观察 Agent 是否调用 `aquasense_analyze` 工具并返回三分类结果。

### 7.3 测试台账写入

确认巡检记录成功写入飞书多维表格，检查字段是否正确填充。

### 7.4 测试 S9 提醒

```bash
# 手动触发一次提醒测试
node dist/scheduler/daily-reminder.js
```

确认飞书群收到任务提醒消息。

---

## 8. 常见问题

### Q1: 飞书写入报错 "字段不匹配"

**原因**: `aquasense_ledger` 的 `fields` 键名与飞书表格实际列名不一致。

**解决**: 对照飞书表格列名，修改 `record-ledger.ts` 中的 `SCENE_COLUMNS`，或让 Agent 调用时显式传入正确的 `fields`。

### Q2: IMA 知识库查询失败

**原因**: 凭证未配置或过期。

**解决**:
1. 检查环境变量 `IMA_OPENAPI_CLIENTID` 和 `IMA_OPENAPI_APIKEY` 是否正确
2. 或检查 `~/.config/ima/client_id` 和 `api_key` 文件是否存在
3. IMA 查询失败不阻断主流程，但处置建议中的知识参考会为空

### Q3: S9 提醒没有推送

**原因**: `FEISHU_WORKER_GROUP` 未配置，或飞书应用未加入巡检群。

**解决**:
1. 确认 `FEISHU_WORKER_GROUP` 已设置为群的 `chat_id`
2. 确认飞书应用已被添加为群机器人
3. 确认 IMA 知识库中存在标题含"每日操作手册"的知识条目

### Q4: 图片分析返回异常结果

**原因**: DeepSeek Vision API 额度不足或网络问题。

**解决**:
1. 检查 `DEEPSEEK_API_KEY` 是否有效
2. 检查网络是否能访问 `api.deepseek.com`
3. 分析失败时会降级为 `normal`，不会阻断流程

### Q5: 台账中池号缺失

**原因**: 工人发消息时未提及池号。

**解决**: 这是设计行为 — 池号缺失时工具返回追问，Agent 会自动向工人询问池号，补齐后再写入。无需人工干预。
