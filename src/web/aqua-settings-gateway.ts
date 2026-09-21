/**
 * AquaSense 设置页 Web 面(Host 侧)——池号枚举配置
 *
 *  - settings 配对:注册命名空间 'aquasense-settings'(仅作配对键——设置页
 *    「插件配置」tab 扫描到命名空间后才派发浏览器侧同 key 卡片;配置读写仍
 *    以 $AQUASENSE_CACHE_DIR/aqua/settings.json 为唯一事实源,见 aqua-settings)
 *  - HTTP 路由:在宿主 webServer 上注册 /aquasense-settings/api 前缀,供
 *    浏览器侧卡片 fetch 调用 get/save 两个方法
 *
 * 说明:本地 DSH 依赖线为 0.0.1-rc.5,而 dsh-settings 及 client 包为 0.1.5-rc.2,
 * 混装会引发 peer 冲突,故 settings/webServer 均按最小鸭子类型访问,不引入其类型。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HttpError, type ApiEnvelope, type ApiResult } from './remind-gateway.js'
import {
  DEFAULT_POOLS,
  getAquaSettings,
  saveAquaSettings,
  type AquaSettings
} from '../config/aqua-settings.js'
import { getFeishuChatMembers, type FeishuChatMember } from '../feishu/token.js'

// ========== 常量 ==========

/** 设置页 API 路由前缀(同源 fetch;方法追加在其后,如 /get) */
export const AQUA_SETTINGS_API_PREFIX = '/aquasense-settings/api'
/** settings 命名空间(小写连字符;仅作 Host/浏览器卡片配对键) */
export const AQUA_SETTINGS_NAMESPACE = 'aquasense-settings'

/** 请求体上限(字节) */
const MAX_BODY_BYTES = 16 * 1024

// ========== 类型 ==========

/** 设置页 API 数据依赖(注入以便独立测试) */
export interface AquaSettingsApiDeps {
  getSettings(): AquaSettings
  saveSettings(input: { pools: unknown; userMap?: Record<string, unknown> }): AquaSettings
  listChatMembers(chatId: string): Promise<FeishuChatMember[]>
}

/** webServer 服务最小鸭子类型(仅用到 register) */
interface WebServerLike {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
  }): () => void
}

/** settings 服务最小鸭子类型(仅用到 register) */
interface SettingsLike {
  register(namespace: string, schema: unknown, options?: { base?: unknown }): void
}

/** 携带宿主可选服务的 Context(本地未安装对应类型包,按需访问) */
type ContextWithServices = Context & {
  webServer?: WebServerLike
  settings?: SettingsLike
}

// ========== settings 命名空间(配对键) ==========

/** settings 命名空间 schema:与 AquaSettings 形状对齐(base 取当前生效配置) */
const AquaSettingsSchema = z.object({
  pools: z.array(z.string()).default(DEFAULT_POOLS)
})

/**
 * 注册 settings 命名空间。
 * 设置页「插件配置」tab 只有扫描到命名空间才派发本插件卡片(见
 * ui-settings-plugins 的 settings.plugin.item 合同);重复注册属多 fiber
 * 正常情形,静默跳过。
 */
export function registerAquaSettingsNamespace(ctx: Context): void {
  ctx.inject(['settings'], (sctx) => {
    const settings = (sctx as ContextWithServices).settings
    if (!settings || typeof settings.register !== 'function') return
    try {
      settings.register(AQUA_SETTINGS_NAMESPACE, AquaSettingsSchema, { base: getAquaSettings() })
    } catch (error) {
      if (error instanceof Error && error.message.includes('already registered')) return
      console.warn('[aquasense-settings] settings 命名空间注册失败(设置页卡片可能不可用):', error)
    }
  })
}

// ========== 请求校验 ==========

/**
 * 校验并归一化「保存设置」请求体(导出供测试)。
 * body 形如 { settings: { pools: [...], userMap: { ... } } }。
 */
export function parseAquaSettingsInput(body: unknown): { pools: unknown; userMap?: Record<string, unknown> } {
  const raw = (body as { settings?: unknown } | null)?.settings
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'invalid-config', '请求体缺少 settings 对象')
  }
  const input = raw as Record<string, unknown>
  if (!Array.isArray(input.pools)) {
    throw new HttpError(400, 'invalid-config', 'pools 必须为数组')
  }
  return { pools: input.pools, userMap: input.userMap as Record<string, unknown> | undefined }
}

/** 获取群成员请求体校验 */
export function parseChatId(body: unknown): string {
  const raw = (body as { chat_id?: unknown } | null)?.chat_id
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new HttpError(400, 'invalid-chat-id', '请求体缺少 chat_id 字符串')
  }
  return raw.trim()
}

// ========== API 分发 ==========

/**
 * 创建设置页 API 分发函数(注入依赖便于测试)。
 * 返回 (method, body) => ApiResult;HTTP 层负责信封序列化。
 */
export function createAquaSettingsApi(deps: AquaSettingsApiDeps): (method: string, body: unknown) => Promise<ApiResult> {
  return async function dispatch(method, body) {
    try {
      switch (method) {
        case 'get':
          return ok({ settings: deps.getSettings() })

        case 'save': {
          const settings = deps.saveSettings(parseAquaSettingsInput(body))
          return ok({ settings })
        }

        case 'list-members': {
          const chatId = parseChatId(body)
          const members = await deps.listChatMembers(chatId)
          return ok({ members })
        }

        default:
          return fail(404, 'unknown-method', `未知方法: ${method}`)
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return fail(error.status, error.code, error.message)
      }
      return fail(500, 'internal', messageOf(error))
    }
  }
}

// ========== HTTP 层 ==========

/**
 * 处理一次 HTTP 请求:协议层校验 + 方法分发 + 信封写回。
 * 协议:POST only、同源(Origin 与 Host 一致)、Content-Type application/json
 * (与 remind-gateway 一致)。
 */
export async function handleAquaSettingsHttp(
  dispatch: (method: string, body: unknown) => Promise<ApiResult>,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname

    if ((req.method ?? '') !== 'POST') {
      writeEnvelope(res, 405, fail(405, 'method-not-allowed', '仅支持 POST').body)
      return
    }

    const origin = req.headers.origin
    if (typeof origin === 'string' && origin) {
      let originHost: string
      try {
        originHost = new URL(origin).host
      } catch {
        writeEnvelope(res, 400, fail(400, 'invalid-origin', 'Origin 头非法').body)
        return
      }
      const reqHost = req.headers.host
      if (typeof reqHost === 'string' && reqHost && originHost !== reqHost) {
        writeEnvelope(res, 403, fail(403, 'origin-not-allowed', '仅允许同源请求').body)
        return
      }
    }

    const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      writeEnvelope(res, 415, fail(415, 'content-type-not-supported', '请求体需为 application/json').body)
      return
    }

    const method = pathname.startsWith(`${AQUA_SETTINGS_API_PREFIX}/`)
      ? pathname.slice(AQUA_SETTINGS_API_PREFIX.length + 1)
      : ''
    if (!method || method.includes('/')) {
      writeEnvelope(res, 404, fail(404, 'not-found', `未知路径: ${pathname}`).body)
      return
    }

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (error) {
      if (error instanceof HttpError) {
        writeEnvelope(res, error.status, fail(error.status, error.code, error.message).body)
        return
      }
      throw error
    }

    const result = await dispatch(method, body)
    writeEnvelope(res, result.status, result.body)
  } catch (error) {
    writeEnvelope(res, 500, fail(500, 'internal', messageOf(error)).body)
  }
}

/** 读取并解析 JSON 请求体(超限 413、解析失败 400) */
async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.length
    if (bytes > maxBytes) {
      throw new HttpError(413, 'payload-too-large', `请求体超过 ${maxBytes} 字节上限`)
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid-json', '请求体不是合法 JSON')
  }
}

/** 写回 JSON 信封 */
function writeEnvelope(res: ServerResponse, status: number, body: ApiEnvelope): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 构造成功结果 */
function ok(value: unknown): ApiResult {
  return { status: 200, body: { ok: true, value } }
}

/** 构造失败结果 */
function fail(status: number, code: string, message: string): ApiResult {
  return { status, body: { ok: false, error: { code, message } } }
}

/** 错误信息提取 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ========== 插件接线 ==========

/**
 * 安装 AquaSense 设置 Web 面:settings 命名空间 + HTTP API 路由。
 * 由插件 apply() 调用;webServer 缺失时仅跳过 API(卡片配对仍保留)。
 */
export function installAquaSettingsWeb(ctx: Context): void {
  registerAquaSettingsNamespace(ctx)

  const dispatch = createAquaSettingsApi({
    getSettings: getAquaSettings,
    saveSettings: saveAquaSettings,
    listChatMembers: getFeishuChatMembers
  })

  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const webServer = (sctx as ContextWithServices).webServer
      if (!webServer || typeof webServer.register !== 'function') {
        console.warn('[aquasense-settings] webServer 不存在,跳过设置 API 注册')
        return () => {}
      }
      const dispose = webServer.register({
        kind: 'prefix',
        path: AQUA_SETTINGS_API_PREFIX,
        handler: (req, res) => handleAquaSettingsHttp(dispatch, req, res)
      })
      console.log('[aquasense-settings] AquaSense 设置 API 已注册')
      return dispose
    }, 'aquasense: 池号设置 API 路由')
  })
}
