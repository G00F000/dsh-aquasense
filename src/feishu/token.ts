/**
 * 飞书 tenant_access_token 获取与进程内缓存
 * 供 record-ledger(台账写入)与 daily-reminder(S9 推送)复用,避免每个工具各自实现鉴权。
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
