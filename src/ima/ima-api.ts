/**
 * IMA API 封装模块
 * 封装 IMA 知识库查询接口,供 generate-advice(处置建议内置查询)与 daily-reminder(S9 手册读取)调用。
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const IMA_BASE_URL = 'https://ima.qq.com'

export interface KnowledgeItem {
  media_id: string
  title: string
  summary?: string
  source?: string
}

export interface SearchResult {
  items: KnowledgeItem[]
  total: number
}

interface Credentials {
  clientId: string
  apiKey: string
}

/**
 * 获取 IMA API 凭证
 * 方式 A:环境变量 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY
 * 方式 B:配置文件 ~/.config/ima/client_id 与 ~/.config/ima/api_key(与 IMA Skill 共用)
 */
function getCredentials(): Credentials {
  const envClientId = process.env.IMA_OPENAPI_CLIENTID
  const envApiKey = process.env.IMA_OPENAPI_APIKEY
  if (envClientId && envApiKey) {
    return { clientId: envClientId.trim(), apiKey: envApiKey.trim() }
  }

  const configDir = join(homedir(), '.config', 'ima')
  const clientIdFile = join(configDir, 'client_id')
  const apiKeyFile = join(configDir, 'api_key')
  if (existsSync(clientIdFile) && existsSync(apiKeyFile)) {
    return {
      clientId: readFileSync(clientIdFile, 'utf8').trim(),
      apiKey: readFileSync(apiKeyFile, 'utf8').trim()
    }
  }

  throw new Error('[aquasense] IMA 凭证未配置:请设置 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY,或写入 ~/.config/ima/client_id 与 api_key')
}

/**
 * 调用 IMA API
 */
async function callIMAApi(apiPath: string, body: Record<string, unknown>): Promise<any> {
  const { clientId, apiKey } = getCredentials()

  const response = await fetch(`${IMA_BASE_URL}/${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IMA-Client-ID': clientId,
      'X-IMA-API-Key': apiKey
    },
    body: JSON.stringify(body)
  })

  const result = (await response.json()) as { code: number; msg?: string; data?: any }

  if (result.code !== 0) {
    throw new Error(`IMA API 错误: ${result.msg}`)
  }

  return result.data
}

/**
 * 搜索知识库:自动定位"水产养殖"知识库后执行关键词搜索
 */
export async function searchKnowledge(query: string, kbId?: string): Promise<SearchResult> {
  try {
    // 1. 先获取知识库列表,找到目标知识库
    if (!kbId) {
      const kbList = await callIMAApi('openapi/wiki/v1/search_knowledge_base', {
        query: '水产养殖',
        limit: 10
      })

      // 选择第一个匹配的知识库
      if (kbList?.knowledge_bases?.length > 0) {
        kbId = kbList.knowledge_bases[0].knowledge_base_id
      } else {
        console.log('[ima] 未找到水产养殖知识库')
        return { items: [], total: 0 }
      }
    }

    // 2. 搜索知识库内容
    const searchResult = await callIMAApi('openapi/wiki/v1/search_knowledge', {
      query,
      knowledge_base_id: kbId,
      limit: 5
    })

    // 3. 解析搜索结果
    const items: KnowledgeItem[] = (searchResult.info_list || []).map((item: any) => ({
      media_id: item.media_id,
      title: item.title,
      summary: item.summary,
      source: item.url_info?.url
    }))

    return { items, total: items.length }
  } catch (error) {
    // 查询失败不影响主流程(生成建议/提醒照常,仅知识参考为空)
    console.error('[ima] 搜索知识库失败:', error)
    return { items: [], total: 0 }
  }
}

/**
 * 获取媒体详情(原始返回值)
 */
export async function getMediaInfo(mediaId: string): Promise<any> {
  return callIMAApi('openapi/wiki/v1/get_media_info', { media_id: mediaId })
}

/**
 * 从 get_media_info 的原始返回值中提取正文文本
 * IMA 各媒体类型的正文字段不同,按常见字段名依次尝试,兜底序列化。
 */
function extractMediaText(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const key of ['content', 'media_content', 'text', 'title', 'abstract']) {
      const value = obj[key]
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    }
  }
  return JSON.stringify(raw)
}

/**
 * 获取媒体正文文本(如《每日操作手册》条目内容)
 */
export async function getMediaContent(mediaId: string): Promise<string> {
  const data = await getMediaInfo(mediaId)
  return extractMediaText(data)
}
