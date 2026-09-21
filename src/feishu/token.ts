/**
 * 飞书 tenant_access_token 获取与进程内缓存
 * 供 record-ledger(台账写入)与 s9-reminder(S9 推送)复用,避免每个工具各自实现鉴权。
 */

interface TokenCache {
  token: string
  expiresAt: number
}

let cache: TokenCache | null = null

/**
 * 获取飞书 tenant_access_token(自动缓存,官方有效期 2 小时,提前 5 分钟过期)
 */
export async function getFeishuToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.token
  }

  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    throw new Error('[aquasense] 飞书凭证未配置:请设置 FEISHU_APP_ID / FEISHU_APP_SECRET')
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  })
  const result = (await response.json()) as { code: number; msg?: string; tenant_access_token?: string; expire?: number }

  if (result.code !== 0 || !result.tenant_access_token) {
    throw new Error(`[aquasense] 飞书鉴权失败: ${result.msg || result.code}`)
  }

  const ttlSeconds = (Number(result.expire) || 7200) - 300
  cache = { token: result.tenant_access_token, expiresAt: Date.now() + ttlSeconds * 1000 }
  return cache.token
}

/** 用户显示名称缓存(open_id → name),进程生命周期内有效 */
const userNameCache = new Map<string, string>()

/**
 * 根据飞书 open_id 获取用户显示名称
 * 优先命中进程内缓存,未命中时调用飞书通讯录 API
 */
export async function getFeishuUserName(openId: string): Promise<string> {
  if (!openId) return ''
  const cached = userNameCache.get(openId)
  if (cached) return cached

  const token = await getFeishuToken()
  const response = await fetch(
    `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const result = (await response.json()) as {
    code: number; msg?: string;
    data?: { user?: { name?: string } }
  }

  if (result.code !== 0 || !result.data?.user?.name) {
    console.error(`[aquasense] 获取飞书用户名失败: open_id=${openId}, ${result.msg || result.code}`)
    return ''
  }

  const name = result.data.user.name
  userNameCache.set(openId, name)
  return name
}

/** 飞书群成员信息 */
export interface FeishuChatMember {
  /** 用户 open_id */
  open_id: string
  /** 用户名称 */
  name: string
  /** 成员在群中的类型 */
  member_id_type?: string
}

/**
 * 获取飞书群成员列表
 * @param chatId 群 ID
 * @returns 群成员列表(包含 open_id 和 name)
 */
export async function getFeishuChatMembers(chatId: string): Promise<FeishuChatMember[]> {
  if (!chatId) return []

  const token = await getFeishuToken()
  const members: FeishuChatMember[] = []
  let pageToken = ''
  let hasMore = true

  while (hasMore) {
    const url = new URL(`https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members`)
    url.searchParams.set('member_id_type', 'open_id')
    url.searchParams.set('page_size', '100')
    if (pageToken) {
      url.searchParams.set('page_token', pageToken)
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    })
    const result = (await response.json()) as {
      code: number; msg?: string;
      data?: {
        items?: Array<{ member_id?: string; name?: string; member_id_type?: string }>
        page_token?: string
        has_more?: boolean
      }
    }

    if (result.code !== 0) {
      console.error(`[aquasense] 获取飞书群成员失败: chatId=${chatId}, ${result.msg || result.code}`)
      break
    }

    const items = result.data?.items || []
    for (const item of items) {
      if (item.member_id && item.name) {
        members.push({
          open_id: item.member_id,
          name: item.name,
          member_id_type: item.member_id_type
        })
      }
    }

    hasMore = result.data?.has_more || false
    pageToken = result.data?.page_token || ''
  }

  return members
}

/**
 * 上传图片 URL 到飞书云文档,返回 Bitable 附件格式
 * 支持两种输入:
 *  - data URL(H5 上传页场景,R8):直接解析 base64,不经网络;
 *  - HTTP(S) URL:下载为 buffer 后再上传。
 */
export async function uploadImageToFeishu(imageUrl: string): Promise<{ file_token: string } | null> {
  try {
    // 0. data URL:H5 上传页传入的内存图片(R8),直接解析
    if (imageUrl.startsWith('data:')) {
      const parsed = parseDataUrl(imageUrl)
      if (!parsed) {
        console.error('[aquasense] data URL 解析失败(H5 图片)')
        return null
      }
      return uploadBufferToFeishu(parsed.buffer, `h5-${Date.now()}${extOfMime(parsed.mimeType)}`, parsed.mimeType)
    }

    // 1. 下载图片(30s 超时)
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
    if (!imgResp.ok) return null
    const buffer = await imgResp.arrayBuffer()
    const fileName = imageUrl.split('/').pop()?.split('?')[0] || 'image.jpg'

    return uploadBufferToFeishu(buffer, fileName, imgResp.headers.get('content-type') || '')
  } catch (err) {
    console.error(`[aquasense] 图片上传异常: ${imageUrl}`, err)
    return null
  }
}

/**
 * 上传图片 buffer 到飞书云文档,返回 Bitable 附件格式(失败返回 null,不抛异常)。
 * 导出供 R8 H5 上传页复用(H5 图片为内存 buffer,无 URL 可下载)。
 */
export async function uploadBufferToFeishu(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
  mimeType = ''
): Promise<{ file_token: string } | null> {
  try {
    // Uint8Array.from 生成 ArrayBuffer 支撑的新视图(规避 SharedArrayBuffer 类型不兼容)
    const bytes = buffer instanceof Uint8Array ? Uint8Array.from(buffer) : new Uint8Array(buffer)
    const name = fileName || `image-${Date.now()}${extOfMime(mimeType)}`

    const token = await getFeishuToken()
    const form = new FormData()
    form.append('file_name', name)
    form.append('parent_type', 'bitable_image')
    form.append('parent_node', process.env.FEISHU_BITABLE_APP_TOKEN || '')
    form.append('size', String(bytes.byteLength))
    form.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), name)

    const resp = await fetch(
      'https://open.feishu.cn/open-apis/drive/v1/medias/upload_all',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      }
    )
    const result = (await resp.json()) as {
      code: number; msg?: string;
      data?: { file_token?: string }
    }

    if (result.code !== 0 || !result.data?.file_token) {
      console.error(`[aquasense] 图片上传失败: ${name}, ${result.msg || result.code}`)
      return null
    }
    return { file_token: result.data.file_token }
  } catch (err) {
    console.error(`[aquasense] 图片上传异常: ${fileName}`, err)
    return null
  }
}

/** 解析 base64 data URL 为 buffer + MIME(非 base64 或空内容返回 null) */
export function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  const mimeType = match[1] || 'image/jpeg'
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.byteLength === 0) return null
  return { buffer, mimeType }
}

/** MIME → 扩展名(构造上传文件名) */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

/** MIME 类型 → 文件扩展名(未知类型降级 .jpg) */
function extOfMime(mimeType: string): string {
  const key = (mimeType || '').split(';')[0].trim().toLowerCase()
  return MIME_EXT[key] || '.jpg'
}
