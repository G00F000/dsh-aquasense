/**
 * 配置页 API 客户端(浏览器侧)
 *
 * 与 Host 侧 src/web/remind-gateway.ts 的 /aquasense-remind/api 路由对应:
 *   get    → { config, status }
 *   save   → { config, status }(body: { config })
 *   test   → { sent: true }
 *   groups → { groups, error? }
 * 与 Host 侧 src/web/aqua-settings-gateway.ts 的 /aquasense-settings/api 路由对应:
 *   get    → { settings }
 *   save   → { settings }(body: { settings })
 * 信封协议 { ok, value } / { ok, error: { code, message } }。
 */

/** 配置页 API 前缀(与 Host 侧常量一致) */
const API_PREFIX = '/aquasense-remind/api'

/** AquaSense 设置页 API 前缀(与 Host 侧常量一致) */
const AQUA_SETTINGS_API_PREFIX = '/aquasense-settings/api'

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

/** 配置页 API 合同 */
export interface RemindApi {
  get(): Promise<{ config: RemindConfig; status: RemindStatus }>
  save(input: RemindConfigInput): Promise<{ config: RemindConfig; status: RemindStatus }>
  test(): Promise<{ sent: boolean }>
  groups(): Promise<{ groups: FeishuGroup[]; error?: string }>
}

/** 请求失败(信封 error.message 或 HTTP 状态) */
export class RemindApiError extends Error {}

/** 调用一次 API 并解包信封 */
async function call<T>(prefix: string, method: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${prefix}/${method}`, {
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

/** 配置页 API 客户端 */
export const remindApi: RemindApi = {
  get: () => call(API_PREFIX, 'get'),
  save: (input) => call(API_PREFIX, 'save', { config: input }),
  test: () => call(API_PREFIX, 'test'),
  groups: () => call(API_PREFIX, 'groups')
}

// ========== AquaSense 设置 API ==========

/** 池号设置(settings.json 快照) */
export interface AquaSettings {
  pools: string[]
  /** 用户映射表:open_id → 姓名 */
  userMap: Record<string, string>
}

/** 飞书群成员信息 */
export interface FeishuChatMember {
  open_id: string
  name: string
  member_id_type?: string
}

/** 设置页 API 合同(设置 → 插件 → 插件配置 中的「AquaSense 设置」卡片) */
export interface AquaSettingsApi {
  get(): Promise<{ settings: AquaSettings }>
  save(input: AquaSettings): Promise<{ settings: AquaSettings }>
  listChatMembers(chatId: string): Promise<{ members: FeishuChatMember[] }>
}

/** 设置页 API 客户端 */
export const aquaSettingsApi: AquaSettingsApi = {
  get: () => call(AQUA_SETTINGS_API_PREFIX, 'get'),
  save: (input) => call(AQUA_SETTINGS_API_PREFIX, 'save', { settings: input }),
  listChatMembers: (chatId) => call(AQUA_SETTINGS_API_PREFIX, 'list-members', { chat_id: chatId })
}
