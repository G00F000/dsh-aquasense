/**
 * AquaSense 池号配置(唯一事实源: $AQUASENSE_CACHE_DIR/aqua/settings.json)
 *
 * 设置页「AquaSense 设置」卡片经 /aquasense-settings/api 读写本文件,
 * 设置整个插件系统的池号枚举;消费方:
 *  - record-ledger     :台账池号白名单(拒绝枚举外文本)
 *  - report-handler    :H5 拍照汇报池号校验
 *  - trace-gateway     :/api/pools 接口(列表筛选/趋势页选项)
 *  - report-upload.html:H5 页池号按钮(服务端注入)
 *
 * 优先级:配置文件 > 环境变量 AQUA_POOLS(JSON 数组)> 默认 4 池。
 * 与 s9-reminder 的 remind/config.json 同构:非法值不阻断启动,静默回退。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveCacheRoot } from '../ima/ima-api.js'

// ========== 常量 ==========

/** 默认池号枚举(与清徐基地循环水池编号一致) */
export const DEFAULT_POOLS = ['池1', '池2', '池3', '池4']

/** 池号数量上限 */
export const MAX_POOLS = 20
/** 单个池号最大长度(字符) */
export const MAX_POOL_LENGTH = 16
/** 用户映射表单个姓名最大长度(字符) */
export const MAX_USER_NAME_LENGTH = 32

// ========== 数据结构 ==========

/** 池号设置(settings.json 为唯一事实源) */
export interface AquaSettings {
  pools: string[]
  /** 用户映射表:open_id → 姓名(用于台账自动填充上报人) */
  userMap: Record<string, string>
}

// ========== 配置目录 ==========

/** 配置文件目录路径(读取零副作用:目录不存在时 existsSync 自然为 false;仅保存时创建) */
function settingsDirPath(): string {
  return join(resolveCacheRoot(), 'aqua')
}

/** 配置文件路径: $AQUASENSE_CACHE_DIR/aqua/settings.json */
function settingsFile(): string {
  return join(settingsDirPath(), 'settings.json')
}

// ========== 归一化 ==========

/**
 * 归一化池号列表(导出供测试与网关共用同一口径):
 * trim、去空、去重、限长限量;非法项跳过,结果为空时回退默认 4 池。
 */
export function sanitizePools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_POOLS]

  const pools: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const value = item.trim()
    if (!value || value.length > MAX_POOL_LENGTH) continue
    if (seen.has(value)) continue
    seen.add(value)
    pools.push(value)
    if (pools.length >= MAX_POOLS) break
  }
  return pools.length > 0 ? pools : [...DEFAULT_POOLS]
}

// ========== 读取 ==========

/** 从配置文件读取池号(不存在/解析失败返回 null) */
function readSettingsFile(): AquaSettings | null {
  const path = settingsFile()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AquaSettings>
    if (parsed && typeof parsed === 'object') {
      return {
        pools: sanitizePools(parsed.pools),
        userMap: sanitizeUserMap(parsed.userMap)
      }
    }
    return null
  } catch {
    console.warn('[aquasense-settings] settings.json 解析失败,忽略并回退默认池号')
    return null
  }
}

/** 解析环境变量 AQUA_POOLS(JSON 数组;非法静默回退) */
function readEnvPools(): string[] | null {
  const raw = process.env.AQUA_POOLS?.trim()
  if (!raw) return null
  try {
    return sanitizePools(JSON.parse(raw))
  } catch {
    console.warn('[aquasense-settings] AQUA_POOLS 不是合法 JSON 数组,已忽略')
    return null
  }
}

/**
 * 读取当前生效池号配置(文件 > 环境变量 > 默认)。
 * 每次读盘(文件 <1KB,微秒级开销),确保外部修改/同毫秒写盘均立即生效;
 * 与 s9-reminder 的 loadConfig 同构。
 */
export function getAquaSettings(): AquaSettings {
  const fileSettings = readSettingsFile()
  if (fileSettings) return fileSettings
  return { pools: readEnvPools() ?? [...DEFAULT_POOLS], userMap: {} }
}

/** 当前生效池号(业务消费:台账白名单、H5 校验) */
export function getPoolIds(): string[] {
  return getAquaSettings().pools
}

/** 当前生效池号集合(record-ledger/report-handler 白名单查询) */
export function getValidPoolIds(): Set<string> {
  return new Set(getPoolIds())
}

/** 池号枚举文案(如「池1/池2/池3/池4」,供错误消息与追问使用) */
export function formatPoolIds(pools?: string[]): string {
  return (pools ?? getPoolIds()).join('/')
}

// ========== 用户映射表 ==========

/** 归一化用户映射表(open_id → 姓名):trim、去空键、限长;非法项跳过 */
export function sanitizeUserMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || typeof value !== 'string') continue
    const trimmedKey = key.trim()
    const trimmedValue = value.trim()
    if (!trimmedKey || !trimmedValue) continue
    if (trimmedValue.length > MAX_USER_NAME_LENGTH) continue
    map[trimmedKey] = trimmedValue
  }
  return map
}

/** 当前生效用户映射表(业务消费:台账自动填充上报人) */
export function getUserMap(): Record<string, string> {
  return getAquaSettings().userMap
}

/** 根据 open_id 获取用户名(优先映射表,未命中返回空字符串)
 *
 * 匹配策略(应对 dsh-lark 消息桥截断 open_id 的情况):
 *  1. 精确匹配(快速路径)
 *  2. 前缀匹配:若传入的 open_id 是映射表某 key 的前缀,且仅命中一条,则采纳(高置信度)
 *  3. 映射表 key 以传入 open_id 开头:同上前缀方向反转(映射表 key 被截断的场景)
 *  4. 以上均未命中则返回空字符串
 */
export function getUserNameByOpenId(openId: string): string {
  if (!openId) return ''
  const map = getUserMap()

  // 1) 精确匹配
  const exact = map[openId]
  if (exact) return exact

  // 2) 前缀匹配:open_id 是某 key 的前缀(消息桥截断了完整 ID)
  const prefixHits: string[] = []
  for (const [key, name] of Object.entries(map)) {
    if (key.startsWith(openId) && key !== openId) {
      prefixHits.push(name)
    }
  }
  if (prefixHits.length === 1) return prefixHits[0]

  // 3) 反向前缀匹配:映射表 key 以 open_id 开头(配置侧截断)
  if (prefixHits.length === 0) {
    const reverseHits: string[] = []
    for (const [key, name] of Object.entries(map)) {
      if (openId.startsWith(key) && key !== openId) {
        reverseHits.push(name)
      }
    }
    if (reverseHits.length === 1) return reverseHits[0]
  }

  return ''
}

// ========== 保存 ==========

/**
 * 保存池号配置(设置页「保存配置」;sanitize 后写盘并刷新缓存)。
 * 写盘失败向上抛,由网关映射 500。
 */
export function saveAquaSettings(input: { pools: unknown; userMap?: Record<string, unknown> }): AquaSettings {
  const pools = sanitizePools(input.pools)
  const userMap = sanitizeUserMap(input.userMap)
  const settings: AquaSettings = { pools, userMap }
  mkdirSync(settingsDirPath(), { recursive: true })
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
  return settings
}
