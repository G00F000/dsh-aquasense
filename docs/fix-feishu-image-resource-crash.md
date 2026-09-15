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

## 插件层已实施的防御（dsh-aquasense）

以下修复在 `dsh-aquasense` 插件中已实施，作为 depth-in-defense：

1. **analyze-image.ts**: `downloadImage` 增加下载前后日志（URL 摘要 + 响应体错误码）
2. **analyze-image.ts**: 多图下载改用 `Promise.allSettled` 逐张容错，单张失败不阻断
3. **analyze-image.ts**: 全部图片下载失败时返回 `unknown` 降级结果而非 `throw`
4. **record-ledger.ts**: `uploadImages` 改用 `Promise.allSettled` + 失败计数日志

**注意**: 插件层修复**无法阻止** harness 层的 `process.exit(1)`。
根因修复必须在 `deepseek-harness-lark/src/inbound.ts` 中完成。
