/**
 * 图片附件自动注入(方案 B: 注册前 wrapper 包装)
 *
 * 解决的问题:
 *  飞书图片经 DSH 框架下载后以 ImageBlock (含 attachment) 注入 Agent 上下文,
 *  但 LLM 不知道 attachmentId 是什么,调用 aquasense_analyze / aquasense_ledger 时
 *  不会填 image_attachment(s),导致图片参数为空 → 视觉模型看不到图片 → 分析失败。
 *
 * 为什么不能用 tools/pre-execute(旧方案 A,已废弃):
 *  @deepseek-ai/dsh-tools 在 createExecution 中对 exec.arguments 做了 deepFreeze
 *  (lib/index.js: `arguments: deepFreeze(detached)`),且官方契约明确写道
 *  "Input rewriting is excluded because arguments are already logged and presented"。
 *  本项目是 ESM(package.json "type":"module"),永远运行在严格模式下,
 *  对冻结对象赋值(args.image_attachment = refs)会抛
 *  `TypeError: Cannot add property image_attachment, object is not extensible`,
 *  被 try/catch 吞掉后工具拿到的仍是空的原始参数。tools/execute、tools/post-execute
 *  三个 waterfall 同样不能改写 arguments。
 *
 * 解决方案(唯一可行注入点):
 *  在 ctx.tools.register 之前用 withAttachmentInject(tool, paramName) 包装工具定义,
 *  重写其 execute:从 exec.agent.session 反向找最近一条 UserMessage,提取 ImageBlock
 *  的 attachment 引用,**构造一个新的参数对象**(含注入字段)传给原始 execute,
 *  绝不改写传入的(已冻结的)args。
 *
 * 设计约束:
 *  - 仅当 args[paramName] 为空/缺失时注入,不覆盖 Agent 主动传入的值
 *  - 仅提取当前 turn(最后一条 role='user' 消息)的图片,不跨 turn
 *  - 仅提取 type='image' 的 ContentBlock,忽略 text/tool-call 等其他块
 *  - 全程 try-catch 防御,注入失败不阻断工具执行(降级为原始 args 的浅拷贝)
 */

import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { stripUndefinedDeep } from './json-safe.js'

/** Agent/session 的最小面(防御式读取,不依赖 dsh-agent 品牌类型) */
interface AgentMinimal {
  session?: {
    deriveMessages?: () => Array<{ role?: unknown; content?: unknown }>
  }
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
export function extractAttachmentsFromSession(agent: AgentMinimal | null | undefined): Array<Record<string, unknown>> {
  const session = agent?.session
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

function safeObj(val: unknown): Record<string, unknown> | undefined {
  return val !== null && typeof val === 'object' ? (val as Record<string, unknown>) : undefined
}

function safeNum(val: unknown): number | undefined {
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined
}

/** args[paramName] 是否已由 Agent 显式提供(非空数组) */
function hasOwnAttachment(args: Record<string, unknown>, paramName: string): boolean {
  const v = args[paramName]
  return Array.isArray(v) && v.length > 0
}

/**
 * 纯函数:将当前会话最近一条 UserMessage 的图片 attachment 合并进 args。
 *
 * **绝不改写传入的 args**(它可能已被 dsh-tools deepFreeze),而是返回一个新对象。
 * 仅当 args[paramName] 为空/缺失且会话中存在图片时才注入;否则返回 args 的浅拷贝。
 *
 * @param args     - 原始工具参数(可能被冻结)
 * @param agent    - exec.agent(含 session),用于提取会话图片
 * @param paramName - 注入字段名(analyze 用 image_attachment;ledger 用 image_attachments)
 * @returns 新的参数对象(含注入字段);无注入时为 args 的浅拷贝
 */
export function mergeAttachmentsFromSession(
  args: unknown,
  agent: AgentMinimal | null | undefined,
  paramName: string
): Record<string, unknown> {
  const base = safeObj(args) ?? {}
  // 始终返回新对象:即使无需注入也不把(可能冻结的)原对象透传给下游改写
  const merged: Record<string, unknown> = { ...base }

  try {
    // Agent 已显式传入该字段时不覆盖
    if (hasOwnAttachment(base, paramName)) return merged

    const refs = extractAttachmentsFromSession(agent)
    if (refs.length === 0) return merged

    merged[paramName] = refs
    // 同时注入期望图片数(与实际数一致,表示无丢失),仅当调用方未提供时
    if (safeNum(merged.expected_image_count) === undefined) {
      merged.expected_image_count = refs.length
    }

    console.log(`[aquasense-inject] 已从会话上下文提取 ${refs.length} 张图片 attachment,自动填入 ${paramName}`)
  } catch (error) {
    // 注入失败不阻断工具执行,降级为原始 args 的浅拷贝
    console.warn('[aquasense-inject] attachment 自动注入失败:', error instanceof Error ? error.message : error)
    return { ...base }
  }

  return merged
}

/**
 * 工具定义包装工厂:在原始 execute 之前,从会话上下文注入图片 attachment。
 *
 * 用法(注册前包装,见 src/index.ts):
 *   ctx.tools.register(withAttachmentInject(analyzeImage, 'image_attachment'))
 *   ctx.tools.register(withAttachmentInject(wrapLedgerWithTrace(recordLedger), 'image_attachments'))
 *
 * @param tool      - 原始工具定义(透传除 execute 外的全部字段)
 * @param paramName - 注入字段名(须与工具 parameters 中声明的一致)
 */
export function withAttachmentInject(tool: ToolDefinition, paramName: string): ToolDefinition {
  return {
    ...tool,
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const merged = mergeAttachmentsFromSession(args, exec?.agent, paramName)
      const out = await tool.execute(merged, exec)
      // 防御兜底:递归剥离产出中的 undefined 字段,避免 DSH lossless JSON 校验失败(ToolOutputError)
      return stripUndefinedDeep(out)
    }
  }
}
