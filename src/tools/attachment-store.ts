/**
 * DSH Attachment 引用解析(桥接 DSH 附件存储与 aquasense 工具)
 *
 * 飞书图片经 Lark 插件下载后保存为 DSH Attachment(引用 ID),
 * aquasense_analyze / aquasense_ledger 工具需要 base64 数据或 HTTP URL。
 * 本模块提供:
 *  - 模块级 store 引用:插件 apply() 时注入 ctx.attachments
 *  - resolveAttachments():将 Attachment 引用数组解析为 base64 图片数组
 *  - resolveAttachmentBuffers():将 Attachment 引用数组解析为 Uint8Array + mimeType(台账上传用)
 *
 * 设计决策:工具 defineTool 的 execute(args) 无 ctx 参数,
 * 因此通过模块级变量在 apply() 时注入,工具运行时读取。
 */

import type { AttachmentStore, ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'

/** 模块级 attachment store 引用(插件 apply() 时注入,工具运行时读取) */
let store: AttachmentStore | null = null

/**
 * 注入 DSH attachment store(插件入口 apply() 时调用)
 * @param s - ctx.attachments,若宿主未挂载 dsh-attachment 服务则为 undefined
 */
export function setAttachmentStore(s: AttachmentStore | undefined): void {
  store = s ?? null
  if (store) {
    console.log('[aquasense] attachment store 已注入,支持飞书图片直传')
  }
}

/** 获取当前 attachment store(供工具内部调用) */
export function getAttachmentStore(): AttachmentStore | null {
  return store
}

/**
 * 工具参数中的 attachment 引用最小面(DSH 品牌类型在 JSON Schema 参数中退化为普通对象)
 * Agent 传入时只包含 attachmentId + mediaType,bytes/width/height 可选
 */
export interface AttachmentRefInput {
  attachmentId: string
  mediaType?: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

/** 解析后的 base64 图片(供 aquasense_analyze 视觉模型输入) */
export interface ResolvedBase64Image {
  data: string
  mimeType: string
}

/** 解析后的二进制图片(供 aquasense_ledger 上传飞书云文档) */
export interface ResolvedBufferImage {
  buffer: Uint8Array
  mimeType: string
  name: string
}

/**
 * 将 Attachment 引用数组解析为 base64 图片数组(视觉模型输入)
 * 逐张容错:单张失败跳过继续,不阻断其余图片分析
 * @returns 成功解析的图片数组(可能为空)
 */
export async function resolveAttachments(refs: AttachmentRefInput[]): Promise<ResolvedBase64Image[]> {
  if (!store) {
    console.warn('[aquasense] attachment store 未注入,无法解析 DSH Attachment 引用')
    return []
  }
  if (!Array.isArray(refs) || refs.length === 0) return []

  const results: ResolvedBase64Image[] = []
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]
    if (!ref?.attachmentId) {
      console.warn(`[aquasense] attachment[${i}] 缺少 attachmentId,跳过`)
      continue
    }
    try {
      // 构造最小 ImageAttachmentRef:attachmentId + mediaType 必需,其余从 store 读取时验证
      const inputRef: ImageAttachmentRef = {
        attachmentId: ref.attachmentId as ImageAttachmentRef['attachmentId'],
        mediaType: normalizeMediaType(ref.mediaType),
        bytes: ref.bytes ?? 0,
        width: ref.width ?? 0,
        height: ref.height ?? 0,
        name: ref.name
      }
      const stored: StoredImageAttachment = await store.readImage(inputRef)
      const b64 = Buffer.from(stored.data).toString('base64')
      results.push({
        data: b64,
        mimeType: stored.ref.mediaType || normalizeMediaType(ref.mediaType)
      })
      console.log(`[aquasense] attachment[${i}] 解析成功(${stored.data.byteLength} bytes,${stored.ref.mediaType})`)
    } catch (error) {
      console.error(`[aquasense] attachment[${i}] 解析失败:${error instanceof Error ? error.message : error}`)
    }
  }
  return results
}

/**
 * 将 Attachment 引用数组解析为 Buffer 图片数组(台账上传飞书云文档用)
 * 逐张容错:单张失败跳过继续
 * @returns 成功解析的图片数组(可能为空)
 */
export async function resolveAttachmentBuffers(refs: AttachmentRefInput[]): Promise<ResolvedBufferImage[]> {
  if (!store) {
    console.warn('[aquasense] attachment store 未注入,无法解析 DSH Attachment 引用')
    return []
  }
  if (!Array.isArray(refs) || refs.length === 0) return []

  const results: ResolvedBufferImage[] = []
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]
    if (!ref?.attachmentId) {
      console.warn(`[aquasense] attachment[${i}] 缺少 attachmentId,跳过`)
      continue
    }
    try {
      const inputRef: ImageAttachmentRef = {
        attachmentId: ref.attachmentId as ImageAttachmentRef['attachmentId'],
        mediaType: normalizeMediaType(ref.mediaType),
        bytes: ref.bytes ?? 0,
        width: ref.width ?? 0,
        height: ref.height ?? 0,
        name: ref.name
      }
      const stored: StoredImageAttachment = await store.readImage(inputRef)
      const fileName = ref.name || `att-${i}-${Date.now()}${extOfMediaType(stored.ref.mediaType)}`
      results.push({
        buffer: stored.data,
        mimeType: stored.ref.mediaType || normalizeMediaType(ref.mediaType),
        name: fileName
      })
      console.log(`[aquasense] attachment[${i}] 解析为 Buffer 成功(${stored.data.byteLength} bytes)`)
    } catch (error) {
      console.error(`[aquasense] attachment[${i}] Buffer 解析失败:${error instanceof Error ? error.message : error}`)
    }
  }
  return results
}

/** 归一化 mediaType:未提供时降级 image/jpeg(与 analyze-image 默认值一致) */
function normalizeMediaType(mt?: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  const key = (mt || '').toLowerCase()
  if (key === 'image/png' || key === 'image/webp' || key === 'image/gif') return key
  return 'image/jpeg'
}

/** mediaType → 文件扩展名(构造上传文件名) */
function extOfMediaType(mt: string): string {
  if (mt === 'image/png') return '.png'
  if (mt === 'image/webp') return '.webp'
  if (mt === 'image/gif') return '.gif'
  return '.jpg'
}
