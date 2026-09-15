# 飞书图片下载 400 导致进程崩溃修复规范

## 严重性: P0 — 进程级崩溃

工人连发多张图片时，DSH harness inbound 层将不同消息的 `fileKey` 与外层 `messageId` 错配，
调用飞书 `GET /im/v1/messages/{messageId}/resources/{fileKey}` 返回 400，
异常未被捕获，向上传播为 `fatal load failure` → `process.exit(1)` → systemd 重启 → 全部会话中断。

**已确认复现 3 次**: Sep 14 09:18, Sep 14 09:24, Sep 15 10:42

---

## 根因分析

### 错配机制

```
Worker 发图 A (msg_1, key_A)
Worker 发图 B (msg_2, key_B)   ← 紧随 A 到达

DSH harness inbound:
  message.messageId = msg_1    ← 外层消息 ID
  message.resources = [key_A, key_B]  ← 混入了 msg_2 的 key_B

下载循环:
  for (const image of imageResources) {
    channel.downloadMessageResource(message.messageId, image.fileKey, ...)
    // → msg_1 + key_B → 400 File not in msg
  }
```

飞书 API 返回:
```json
{"code": 234003, "msg": "File not in msg."}
```

### 为什么 .slice(0, maxImagesPerMessage) 无效

截断只限制数量，不修正配对。如果 `resources` 数组第一个元素就是错配的 key，
截断为 1 张也一样 400。

---

## 修复要求

### 修复 ① [CRITICAL] 进程崩溃防护

**位置**: `deepseek-harness-lark/src/inbound.ts` 的 `downloadMessageResource` 调用处

**要求**: 单张图片下载失败（HTTP 400/403/404/5xx/timeout）必须被限制在当前 turn 内。
错误处理方式:
1. 记录日志（含 messageId + fileKey 前 12 位）
2. 向当前 turn 文本追加提示（如 `[图片下载失败:file_key 不属于该消息,已跳过]`）
3. **绝不**向上传播为 unhandled rejection 或 fatal error
4. 继续处理剩余 resource

### 修复 ② [ROOT CAUSE] 修正 resource 归属绑定

**位置**: `deepseek-harness-lark/src/inbound.ts` 的 `NormalizedMessage` 构造层

**核心原则**: 每个 resource 必须携带它所属的 `message_id`，不要在下载时用外层 `message.messageId` 兜底。

```typescript
// 推荐接口定义
interface InboundResource {
  type: 'image' | 'file'
  fileKey: string
  /** 该 resource 所属的消息 ID（从产生该 resource 的飞书事件中提取） */
  messageId: string
}
```

**飞书事件结构参考**: 飞书 `im.message.receive_v1` 事件中，每条消息事件包含
`event.message.message_id` 和 `event.message.content`（含 `image_key`）。
当 Worker 连发多张图时，每张图产生独立的事件，各自拥有独立的 `message_id`。

**正确做法**:
- 在事件解析层（webhook handler）将 `event.message.message_id` 与 `image_key` 绑定
- `NormalizedMessage.resources` 中的每个 resource 自带 `messageId`
- 下载时使用 `resource.messageId` 而非 `message.messageId`

**错误做法**（当前）:
- 多个消息事件的 resource 被聚合到同一个 `NormalizedMessage`
- 下载时统一使用外层 `message.messageId`，导致 A 的 key 配 B 的 ID

### 修复 ③ [防御] 遇到 234003 时跳过而非抛出

```typescript
try {
  const data = await channel.downloadMessageResource(resource.messageId, resource.fileKey, 'image')
  // ...
} catch (e) {
  if (isFeishuCode(e, 234003)) {
    textParts.push('[图片下载失败:file_key 不属于该消息,已跳过]')
    continue  // 跳过该 resource，继续处理下一张
  }
  throw e  // 其他错误由调用方收敛到本 turn
}
```

---

## 可观测性建议

下载前打印诊断日志:
```
[aquasense] downloading resource msg=<messageId> key=<fileKey前12位>
```

一眼就能看出 messageId 和 fileKey 的配对是否正确。

---

## 实际影响案例（已验证）

### 案例: Sep 15 13:22 池1 漏诊

工人发送 5 张鲈鱼体表照片（"1号池 鲈鱼体表"），harness 只收到 1 张。

| 维度 | 仅 1 张图（实际发生） | 全 5 张图（恢复验证） |
|------|----------------------|----------------------|
| cls | **normal** | **disease** |
| severity | low | **high** |
| symptoms | （无） | 腹部体侧红色溃疡、皮肤充血渗血、体表光泽度下降 |
| confidence | - | 0.92 |
| 台账记录 | 13:22:29 池1 "体表正常" | **不应写入正常结论** |

**结论**: 基于 20% 信息写下的 "正常" 台账记录，是**审计级错误前提**。

---

## 漏诊防护方案（已实施）

### ④ [防漏诊] analyze-image.ts — 数据完整性检测

新增参数 `expected_image_count`：Agent 传入工人实际发送的图片数量。

输出新增字段：
- `image_count`: 实际分析的图片数
- `expected_image_count`: 期望的图片数
- `data_completeness`: `'complete'` / `'partial'` / `'empty'`

**防漏诊规则**: 当 `data_completeness === 'partial'` 且视觉模型判定 `cls === 'normal'` 时，自动将 `cls` 降级为 `'unknown'`，症状注入 "图片不完整" 警告。

**理由**: 仅看到部分图片就下 "正常" 结论是危险的——遗漏的图可能包含病灶。

### ⑤ [防漏诊] record-ledger.ts — 拒绝不完整数据落表

在 `buildFields` 中，当 `analysis.data_completeness` 为 `'partial'` 或 `'empty'` 时，`throw` 错误拒绝写入，返回 `success: false`。

**效果**: 图片丢失时，台账不会记录任何结论（无论正常还是异常），迫使 Agent 要求工人重新发送全部图片。

### ⑥ [前置] DSH harness 需传递 expected_image_count

**位置**: `deepseek-harness-lark` 的消息上下文构建层

harness 应在消息上下文中提供 `expected_image_count`（即该会话中 worker 发送的图片消息数），Agent 才能将其传入 `aquasense_analyze`。

---

## 插件层已实施的防御（dsh-aquasense）

以下修复在 `dsh-aquasense` 插件中已实施，作为 depth-in-defense：

1. **analyze-image.ts**: `downloadImage` 增加下载前后日志（URL 摘要 + 响应体错误码）
2. **analyze-image.ts**: 多图下载改用 `Promise.allSettled` 逐张容错，单张失败不阻断
3. **analyze-image.ts**: 全部图片下载失败时返回 `unknown` 降级结果而非 `throw`
4. **record-ledger.ts**: `uploadImages` 改用 `Promise.allSettled` + 失败计数日志
5. **analyze-image.ts**: 新增 `expected_image_count` 参数 + `data_completeness` 输出字段
6. **analyze-image.ts**: 图片不完整时 `cls=normal` 自动降级为 `unknown`（防漏诊）
7. **record-ledger.ts**: `data_completeness` 为 partial/empty 时拒绝写入台账
8. **SKILL.md**: Agent 技能文档增加数据完整性检测规范

**注意**: 插件层修复**无法阻止** harness 层的 `process.exit(1)`。
根因修复必须在 `deepseek-harness-lark/src/inbound.ts` 中完成。
