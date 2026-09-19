/**
 * AquaSense 设置页 Web 面(gateway)单元测试
 *
 * 测试重点:
 *  - parseAquaSettingsInput:保存请求校验(settings 对象/pools 数组)
 *  - createAquaSettingsApi:get/save 分发与错误映射(400/404)
 *  - handleAquaSettingsHttp:协议层(405/403/415/404)与信封写回
 */

import { describe, it, expect } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AQUA_SETTINGS_API_PREFIX,
  createAquaSettingsApi,
  handleAquaSettingsHttp,
  parseAquaSettingsInput
} from './aqua-settings-gateway.js'
import type { AquaSettingsApiDeps } from './aqua-settings-gateway.js'
import { HttpError } from './remind-gateway.js'

/** 基础依赖(可按用例覆盖) */
function createDeps(overrides: Partial<AquaSettingsApiDeps> = {}): AquaSettingsApiDeps {
  return {
    getSettings: () => ({ pools: ['池1', '池2', '池3', '池4'] }),
    saveSettings: (input) => ({ pools: Array.isArray(input.pools) ? (input.pools as string[]) : [] }),
    ...overrides
  }
}

/** 构造最小 IncomingMessage mock */
function mockRequest(options: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
}): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body, 'utf8')]
  return {
    method: options.method ?? 'POST',
    url: options.url ?? `${AQUA_SETTINGS_API_PREFIX}/get`,
    headers: options.headers ?? { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  } as unknown as IncomingMessage
}

/** 响应 mock 的可读字段面 */
interface MockResponseFields {
  status: number
  body: string
  headers: Record<string, string>
  writeHead(status: number, headers?: Record<string, string>): void
  end(body: string): void
}

/** 构造最小 ServerResponse mock */
function mockResponse(): ServerResponse & MockResponseFields {
  const res: MockResponseFields = {
    status: 0,
    body: '',
    headers: {},
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? {}
    },
    end(body) {
      res.body = body
    }
  }
  return res as unknown as ServerResponse & MockResponseFields
}

/** 解析响应信封 */
function envelopeOf(res: { body: string }): { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } {
  return JSON.parse(res.body)
}

describe('parseAquaSettingsInput', () => {
  it('合法输入(settings.pools 数组)', () => {
    const input = parseAquaSettingsInput({ settings: { pools: ['池1', '池2'] } })
    expect(input).toEqual({ pools: ['池1', '池2'] })
  })

  it('缺少 settings 对象 → 400 invalid-config', () => {
    expect(() => parseAquaSettingsInput({})).toThrowError(/请求体缺少 settings 对象/)
    expect(() => parseAquaSettingsInput({ pools: ['池1'] })).toThrowError(HttpError)
  })

  it('pools 非数组 → 400', () => {
    expect(() => parseAquaSettingsInput({ settings: { pools: '池1' } })).toThrowError(/pools 必须为数组/)
  })
})

describe('createAquaSettingsApi', () => {
  it('get → { settings }', async () => {
    const dispatch = createAquaSettingsApi(createDeps())
    const result = await dispatch('get', {})
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, value: { settings: { pools: ['池1', '池2', '池3', '池4'] } } })
  })

  it('save → sanitize 后回写', async () => {
    const dispatch = createAquaSettingsApi(
      createDeps({
        saveSettings: () => ({ pools: ['池1', '池5'] })
      })
    )
    const result = await dispatch('save', { settings: { pools: [' 池1 ', '池5', '池1'] } })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, value: { settings: { pools: ['池1', '池5'] } } })
  })

  it('save 校验失败 → 400 invalid-config', async () => {
    const dispatch = createAquaSettingsApi(createDeps())
    const result = await dispatch('save', { settings: { pools: '池1' } })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'invalid-config' } })
  })

  it('未知方法 → 404', async () => {
    const dispatch = createAquaSettingsApi(createDeps())
    const result = await dispatch('delete', {})
    expect(result.status).toBe(404)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'unknown-method' } })
  })

  it('保存抛非 HttpError → 500 internal', async () => {
    const dispatch = createAquaSettingsApi(
      createDeps({
        saveSettings: () => {
          throw new Error('disk full')
        }
      })
    )
    const result = await dispatch('save', { settings: { pools: ['池1'] } })
    expect(result.status).toBe(500)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'internal', message: 'disk full' } })
  })
})

describe('handleAquaSettingsHttp', () => {
  const dispatch = createAquaSettingsApi(createDeps())

  it('GET 方法 → 405 method-not-allowed', async () => {
    const res = mockResponse()
    await handleAquaSettingsHttp(dispatch, mockRequest({ method: 'GET', url: `${AQUA_SETTINGS_API_PREFIX}/get` }), res)
    expect(res.status).toBe(405)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'method-not-allowed' } })
  })

  it('跨源 Origin → 403 origin-not-allowed', async () => {
    const res = mockResponse()
    await handleAquaSettingsHttp(
      dispatch,
      mockRequest({ url: `${AQUA_SETTINGS_API_PREFIX}/get`, headers: { origin: 'https://evil.example.com', host: 'dsh.internal', 'content-type': 'application/json' } }),
      res
    )
    expect(res.status).toBe(403)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'origin-not-allowed' } })
  })

  it('非 JSON Content-Type → 415', async () => {
    const res = mockResponse()
    await handleAquaSettingsHttp(
      dispatch,
      mockRequest({ url: `${AQUA_SETTINGS_API_PREFIX}/get`, headers: { 'content-type': 'text/plain' } }),
      res
    )
    expect(res.status).toBe(415)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'content-type-not-supported' } })
  })

  it('未知路径 → 404 not-found', async () => {
    const res = mockResponse()
    await handleAquaSettingsHttp(dispatch, mockRequest({ url: '/other/api/get' }), res)
    expect(res.status).toBe(404)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('get 正常信封写回', async () => {
    const res = mockResponse()
    await handleAquaSettingsHttp(dispatch, mockRequest({ url: `${AQUA_SETTINGS_API_PREFIX}/get` }), res)
    expect(res.status).toBe(200)
    expect(envelopeOf(res)).toEqual({ ok: true, value: { settings: { pools: ['池1', '池2', '池3', '池4'] } } })
  })

  it('save 请求体非法 JSON → 400 invalid-json', async () => {
    const res = mockResponse()
    await handleAquaSettingsHttp(
      dispatch,
      mockRequest({ url: `${AQUA_SETTINGS_API_PREFIX}/save`, body: '{broken' }),
      res
    )
    expect(res.status).toBe(400)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'invalid-json' } })
  })
})
