/**
 * 图片附件自动注入(方案 A: tools/pre-execute 拦截)
 *
 * 解决的问题:
 *  飞书图片经 DSH 框架下载后以 ImageBlock (含 attachmentId) 注入 Agent 上下文,
 *  但 LLM 不知道 attachmentId 是什么,调用 aquasense_analyze 时不会填 image_attachment,
 *  导致图片参数为空 → 分析失败。
 *
 * 解决方案:
 *  在 tools/pre-execute waterfall 中拦截 aquasense_analyze 调用:
 *  1. 从 Agent 会话历史的最近一条 UserMessage 中提取 ImageBlock
 *  2. 将 ImageBlock 的 attachment 引用自动填入 args.image_attachment
 *  3. 同时注入 expected_image_count(当前消息中的图片数)
 *
 * 设计约束:
 *  - 仅在 args.image_attachment 为空/缺失时注入,不覆盖 Agent 主动传入的参数
 *  - 仅提取当前 turn 的 UserMessage 中的图片,不跨 turn 提取
 *  - 仅提取 type='image' 的 ContentBlock,忽略 text/tool-call 等其他块
 *  - 全程 try-catch 防御,注入失败不阻断工具执行
 */



/** aquasense_analyze 工具名(与 analyze-image.ts 保持一致) */
const ANALYZE_TOOL_NAME = 'aquasense_analyze'

/** tools/pre-execute 事件中 exec 的最小面(防御式读取) */
interface PreExecMinimal {
  name?: unknown
  arguments?: unknown
  agent?: {
    session?: {
      deriveMessages?: () => Array<{ role?: unknown; content?: unknown }>
    }
  } | null
}

/** ImageBlock 的最小面(防御式读取) */
interface ImageBlockMinimal {
  type?: unknown
  attachment?: {
    attachmentId?: unknown
    mediaType?: unknown
    bytes?: unknown
    width?: unknown
    height?: unknown
    name?: unknown
  }
}

/**
 * 从会话历史的最近一条 UserMessage 中提取图片 attachment 引用
 * @param agent - 当前执行 Agent(含 session)
 * @returns attachment 引用数组,无图片时返回空数组
 */
function extractAttachmentsFromSession(agent: { session?: { deriveMessages?: () => Array<{ role?: unknown; content?: unknown }> } }): Array<Record<string, unknown>> {
  const session = agent.session
  if (!session || typeof session.deriveMessages !== 'function') return []

  let messages: Array<{ role?: unknown; content?: unknown }>
  try {
    messages = session.deriveMessages()
  } catch {
    return []
  }

  if (!Array.isArray(messages) || messages.length === 0) return []

  // 从后往前找最后一条 role='user' 的消息(即当前 turn 的入站消息)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue

    const content = msg.content
    if (!Array.isArray(content)) continue

    // 提取所有 type='image' 的 ContentBlock 中的 attachment 引用
    const refs: Array<Record<string, unknown>> = []
    for (const block of content) {
      const b = block as ImageBlockMinimal
      if (b.type !== 'image' || !b.attachment) continue

      const att = b.attachment
      if (!att.attachmentId) continue

      refs.push({
        attachmentId: att.attachmentId,
        mediaType: att.mediaType,
        bytes: att.bytes,
        width: att.width,
        height: att.height,
        name: att.name
      })
    }

    // 找到了当前 turn 的用户消息,无论是否包含图片都返回
    // (不包含图片说明用户没有发图,不应该继续向前搜索)
    return refs
  }

  return []
}

/**
 * 安全读取 exec 上的字段(防御式)
 */
function safeStr(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined
}

function safeObj(val: unknown): Record<string, unknown> | undefined {
  return val !== null && typeof val === 'object' ? (val as Record<string, unknown>) : undefined
}

function safeNum(val: unknown): number | undefined {
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined
}

/**
 * tools/pre-execute 事件处理器
 *
 * 当检测到调用 aquasense_analyze 且 image_attachment 为空时,
 * 自动从当前会话的入站消息中提取图片 attachment 引用填入参数。
 *
 * @param exec - 待执行的工具调用(含 name/arguments/agent)
 * @param next - waterfall 链的下一个处理器
 */
export async function attachmentInjectPreExecute(
  exec: unknown,
  next: () => Promise<{ kind: string }>
): Promise<{ kind: string }> {
  try {
    const e = exec as PreExecMinimal

    // 仅拦截 aquasense_analyze 工具调用
    if (safeStr(e.name) !== ANALYZE_TOOL_NAME) {
      return next()
    }

    // 读取当前参数
    const args = safeObj(e.arguments)
    if (!args) return next()

    // 已有图片参数时跳过(Agent 已主动传入,不覆盖)
    if (
      (Array.isArray(args.image_attachment) && args.image_attachment.length > 0) ||
      (Array.isArray(args.image_data_list) && args.image_data_list.length > 0) ||
      (typeof args.image_data === 'string' && args.image_data) ||
      (Array.isArray(args.image_urls) && args.image_urls.length > 0) ||
      (typeof args.image_url === 'string' && args.image_url)
    ) {
      return next()
    }

    // 获取 Agent 和会话
    const agent = e.agent
    if (!agent) {
      console.warn('[aquasense-inject] tools/pre-execute: exec.agent 为空,无法提取 attachment')
      return next()
    }

    // 从会话历史中提取最近一条 UserMessage 的图片 attachment 引用
    const refs = extractAttachmentsFromSession(agent)
    if (refs.length === 0) {
      return next()
    }

    // 注入 image_attachment 参数
    args.image_attachment = refs
    // 同时注入期望图片数(与实际数一致,表示无丢失)
    if (safeNum(args.expected_image_count) === undefined) {
      args.expected_image_count = refs.length
    }

    console.log(`[aquasense-inject] 已从会话上下文提取 ${refs.length} 张图片 attachment,自动填入 image_attachment`)
  } catch (error) {
    // 注入失败不阻断工具执行,仅记录警告
    console.warn('[aquasense-inject] attachment 自动注入失败:', error instanceof Error ? error.message : error)
  }

  return next()
}
