/**
 * 设置页 API 客户端(浏览器侧)
 *
 * 与 Host 侧 src/web/remind-gateway.ts 的 /aquasense-remind/api 路由对应:
 *   get    → { config, status }
 *   save   → { config, status }(body: { config })
 *   test   → { sent: true }
 *   groups → { groups, error? }
 * 信封协议 { ok, value } / { ok, error: { code, message } }。
 */

/** 设置页 API 前缀(与 Host 侧常量一致) */
const API_PREFIX = '/aquasense-remind/api'

/** 飞书群条目(下拉选项) */
export interface FeishuGroup {
  chatId: string
  name: string
}

/** 任务条目 */
export interface RemindTask {
  time: string
  task: string
}

/** 已保存配置(config.json 快照) */
export interface RemindConfig {
  enabled: boolean
  group: string
  cron: string
  tasks: RemindTask[]
}

/** 保存请求体(status 不在其中) */
export interface RemindConfigInput {
  enabled: boolean
  group: string
  tasks: RemindTask[]
}

/** 当日运行状态 */
export interface RemindStatus {
  date: string
  planned: number
  sent: number
  nextTime: string | null
  running: boolean
}

/** 设置页 API 合同 */
export interface RemindApi {
  get(): Promise<{ config: RemindConfig; status: RemindStatus }>
  save(input: RemindConfigInput): Promise<{ config: RemindConfig; status: RemindStatus }>
  test(): Promise<{ sent: boolean }>
  groups(): Promise<{ groups: FeishuGroup[]; error?: string }>
}

/** 请求失败(信封 error.message 或 HTTP 状态) */
export class RemindApiError extends Error {}

/** 调用一次 API 并解包信封 */
async function call<T>(method: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    })
  } catch (error) {
    throw new RemindApiError(error instanceof Error ? error.message : String(error))
  }

  let envelope: { ok?: boolean; value?: unknown; error?: { message?: string } }
  try {
    envelope = (await response.json()) as typeof envelope
  } catch {
    throw new RemindApiError(`HTTP ${response.status}`)
  }
  if (!envelope.ok) {
    throw new RemindApiError(envelope.error?.message || `HTTP ${response.status}`)
  }
  return envelope.value as T
}

/** 设置页 API 客户端 */
export const remindApi: RemindApi = {
  get: () => call('get'),
  save: (input) => call('save', { config: input }),
  test: () => call('test'),
  groups: () => call('groups')
}
