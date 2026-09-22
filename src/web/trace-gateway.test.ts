/**
 * R8 分析记录 Web 面(trace-gateway)单元测试
 *
 * 测试重点:
 *  - resolveTraceRoute:页面/API 路由解析与路径穿越防护
 *  - parseRecordQuery / parseTrendDays:参数校验(400)
 *  - createTraceHandler:协议层(405/403/404/400/500)与页面/API 分发
 */

import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createTraceHandler,
  parseRecordQuery,
  parseTrendDays,
  readTracePage,
  resolveTraceRoute,
  TRACE_PREFIX,
  type TraceServerDeps
} from './trace-gateway.js'
import { HttpError } from './remind-gateway.js'
import type { AnalysisRecord } from './trace-recorder.js'

/** 构造最小 IncomingMessage mock(网关只读 method/url/headers) */
function mockRequest(options: { method?: string; url?: string; headers?: Record<string, string> } = {}): IncomingMessage {
  return {
    method: options.method ?? 'GET',
    url: options.url ?? TRACE_PREFIX,
    headers: options.headers ?? {}
  } as unknown as IncomingMessage
}

/** 响应 mock 的可读字段面 */
interface MockResponseFields {
  status: number
  body: string | Uint8Array
  headers: Record<string, string>
  writeHead(status: number, headers?: Record<string, string>): void
  end(body: string | Uint8Array): void
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

/** 基础依赖(可按用例覆盖) */
function createDeps(overrides: Partial<TraceServerDeps> = {}): TraceServerDeps {
  return {
    queryIndex: async () => ({ records: [], total: 0, has_more: false }),
    readReport: async () => null,
    computeTrend: async (pool, days) => ({
      pool,
      days,
      total: 0,
      distribution: { normal: 0, early: 0, disease: 0, unknown: 0 },
      top_symptoms: [],
      recent_records: []
    }),
    listImages: async () => [],
    readImage: async () => null,
    getPools: () => ['池1', '池2', '池3', '池4'],
    readPage: async () => '<!doctype html><html><body>page</body></html>',
    ...overrides
  }
}

/** 解析响应信封 */
function envelopeOf(res: { body: string | Uint8Array }): unknown {
  return JSON.parse(String(res.body))
}

describe('resolveTraceRoute', () => {
  it('页面路由:列表/详情/趋势', () => {
    expect(resolveTraceRoute(TRACE_PREFIX)).toEqual({ kind: 'page', page: 'list' })
    expect(resolveTraceRoute(`${TRACE_PREFIX}/`)).toEqual({ kind: 'page', page: 'list' })
    expect(resolveTraceRoute(`${TRACE_PREFIX}/report`)).toEqual({ kind: 'page', page: 'detail' })
    expect(resolveTraceRoute(`${TRACE_PREFIX}/trend`)).toEqual({ kind: 'page', page: 'trend' })
  })

  it('API 路由:列表/详情/趋势(池号解码)', () => {
    expect(resolveTraceRoute(`${TRACE_PREFIX}/api/records`)).toEqual({ kind: 'api-records' })
    expect(resolveTraceRoute(`${TRACE_PREFIX}/api/records/RPT-20260917-100532`)).toEqual({
      kind: 'api-record',
      id: 'RPT-20260917-100532'
    })
    expect(resolveTraceRoute(`${TRACE_PREFIX}/api/trend/%E6%B1%A01`)).toEqual({ kind: 'api-trend', pool: '池1' })
  })

  it('API 路由:记录图片二进制(api/records/:id/images/:index)', () => {
    expect(resolveTraceRoute(`${TRACE_PREFIX}/api/records/RPT-20260917-100532/images/0`)).toEqual({
      kind: 'api-record-image',
      id: 'RPT-20260917-100532',
      index: 0
    })
    expect(resolveTraceRoute(`${TRACE_PREFIX}/api/records/RPT-20260917-100532/images/12`)).toEqual({
      kind: 'api-record-image',
      id: 'RPT-20260917-100532',
      index: 12
    })
    // 非数字/带后缀 → 落入普通详情路由(ID 校验拦截)
    expect(resolveTraceRoute(`${TRACE_PREFIX}/api/records/RPT-20260917-100532/images/abc`)).toEqual({
      kind: 'api-record',
      id: 'RPT-20260917-100532/images/abc'
    })
  })

  it('前缀外/未知子路径 → unknown', () => {
    expect(resolveTraceRoute('/other')).toEqual({ kind: 'unknown' })
    expect(resolveTraceRoute(`${TRACE_PREFIX}2`)).toEqual({ kind: 'unknown' })
    expect(resolveTraceRoute(`${TRACE_PREFIX}/xyz`)).toEqual({ kind: 'unknown' })
  })

  it('非法 URL 编码原样返回(交由后续 ID 校验拒绝)', () => {
    expect(resolveTraceRoute(`${TRACE_PREFIX}/api/records/%E0%A4%A`)).toEqual({ kind: 'api-record', id: '%E0%A4%A' })
  })
})

describe('parseRecordQuery', () => {
  it('缺省值:limit=50 offset=0', () => {
    expect(parseRecordQuery(new URLSearchParams())).toEqual({
      pool: undefined,
      cls: undefined,
      date: undefined,
      low_confidence: false,
      has_error: false,
      limit: 50,
      offset: 0
    })
  })

  it('合法过滤条件透传', () => {
    const query = parseRecordQuery(new URLSearchParams('pool=池2&cls=early&date=2026-09-17&limit=10&offset=5&low_confidence=1&has_error=1'))
    expect(query).toEqual({ pool: '池2', cls: 'early', date: '2026-09-17', low_confidence: true, has_error: true, limit: 10, offset: 5 })
  })

  it('非法 cls/date/limit/pool 超长 → 400 invalid-param', () => {
    const badParams = ['cls=bad', 'date=2026/09/17', 'limit=abc', 'limit=-1', `pool=${'x'.repeat(33)}`]
    for (const params of badParams) {
      expect(() => parseRecordQuery(new URLSearchParams(params))).toThrowError(HttpError)
    }
    try {
      parseRecordQuery(new URLSearchParams('cls=bad'))
    } catch (error) {
      expect((error as HttpError).status).toBe(400)
      expect((error as HttpError).code).toBe('invalid-param')
    }
  })
})

describe('parseTrendDays', () => {
  it('缺省 7 天;合法值透传', () => {
    expect(parseTrendDays(new URLSearchParams())).toBe(7)
    expect(parseTrendDays(new URLSearchParams('days=30'))).toBe(30)
  })

  it('非法值 → 400;超上限裁剪为 3650', () => {
    expect(() => parseTrendDays(new URLSearchParams('days=0'))).toThrowError(HttpError)
    expect(() => parseTrendDays(new URLSearchParams('days=abc'))).toThrowError(HttpError)
    expect(parseTrendDays(new URLSearchParams('days=99999'))).toBe(3650)
  })
})

describe('createTraceHandler(协议层)', () => {
  it('非 GET → 405', async () => {
    const res = mockResponse()
    await createTraceHandler(createDeps())(mockRequest({ method: 'POST' }), res)
    expect(res.status).toBe(405)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'method-not-allowed' } })
  })

  it('跨域 Origin → 403;非法 Origin → 400', async () => {
    const handler = createTraceHandler(createDeps())

    const res403 = mockResponse()
    await handler(mockRequest({ headers: { origin: 'https://evil.example', host: 'dsh.internal' } }), res403)
    expect(res403.status).toBe(403)
    expect(envelopeOf(res403)).toMatchObject({ ok: false, error: { code: 'origin-not-allowed' } })

    const res400 = mockResponse()
    await handler(mockRequest({ headers: { origin: 'not-a-url' } }), res400)
    expect(res400.status).toBe(400)
    expect(envelopeOf(res400)).toMatchObject({ ok: false, error: { code: 'invalid-origin' } })
  })

  it('页面路由返回 HTML(no-cache);页面读取失败 → 500 提示页', async () => {
    const readPage = vi.fn(async () => '<!doctype html><html><body>trend page</body></html>')
    const res = mockResponse()
    await createTraceHandler(createDeps({ readPage }))(mockRequest({ url: `${TRACE_PREFIX}/trend` }), res)
    expect(readPage).toHaveBeenCalledWith('trend')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.body).toContain('trend page')

    const resFail = mockResponse()
    await createTraceHandler(
      createDeps({
        readPage: async () => {
          throw new Error('missing file')
        }
      })
    )(mockRequest({}), resFail)
    expect(resFail.status).toBe(500)
    expect(resFail.body).toContain('页面资源缺失')
  })

  it('api/records:查询参数透传并写回信封', async () => {
    const queryIndex = vi.fn(async () => ({ records: [], total: 0, has_more: false }))
    const res = mockResponse()
    await createTraceHandler(createDeps({ queryIndex }))(
      mockRequest({ url: `${TRACE_PREFIX}/api/records?pool=池1&limit=10` }),
      res
    )
    expect(queryIndex).toHaveBeenCalledWith(expect.objectContaining({ pool: '池1', limit: 10 }))
    expect(res.status).toBe(200)
    expect(envelopeOf(res)).toMatchObject({ ok: true, value: { total: 0, has_more: false } })
  })

  it('api/records/:id 存在 → 200 并附带图片元数据(含 url)', async () => {
    const found = mockResponse()
    const record = { id: 'RPT-20260917-100532', pool: '池1' } as unknown as AnalysisRecord
    await createTraceHandler(
      createDeps({
        readReport: async () => record,
        listImages: async () => [
          { index: 0, fileName: 'img-000.jpg', mimeType: 'image/jpeg', size: 1024 },
          { index: 1, fileName: 'img-001.png', mimeType: 'image/png', size: 2048 }
        ]
      })
    )(mockRequest({ url: `${TRACE_PREFIX}/api/records/RPT-20260917-100532` }), found)
    expect(found.status).toBe(200)
    const value = (envelopeOf(found) as { value: { images: unknown[] } }).value
    expect(value.images).toHaveLength(2)
    expect(value.images[0]).toMatchObject({
      index: 0,
      url: `${TRACE_PREFIX}/api/records/RPT-20260917-100532/images/0`
    })
    expect(value.images[1]).toMatchObject({
      index: 1,
      url: `${TRACE_PREFIX}/api/records/RPT-20260917-100532/images/1`
    })
  })

  it('api/records/:id/images/:index:非法 ID/序号 → 400;不存在 → 404;存在 → 二进制', async () => {
    const handler = createTraceHandler(
      createDeps({
        readImage: async (id, index) => {
          if (index === 0) return { buffer: Buffer.from('fake-image'), mimeType: 'image/jpeg' }
          return null
        }
      })
    )

    const badId = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/records/${encodeURIComponent('../etc')}/images/0` }), badId)
    expect(badId.status).toBe(400)

    const missing = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/records/RPT-20260917-100532/images/3` }), missing)
    expect(missing.status).toBe(404)
    expect(envelopeOf(missing)).toMatchObject({ ok: false, error: { code: 'not-found' } })

    const okRes = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/records/RPT-20260917-100532/images/0` }), okRes)
    expect(okRes.status).toBe(200)
    expect(okRes.headers['content-type']).toBe('image/jpeg')
    expect(okRes.headers['cache-control']).toContain('immutable')
    expect(String(okRes.body)).toBe('fake-image')
  })

  it('api/records/:id ID 非法 → 400(含穿越尝试);不存在 → 404', async () => {
    const readReport = vi.fn(async () => null)
    const handler = createTraceHandler(createDeps({ readReport }))

    const bad = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/records/BAD-ID` }), bad)
    expect(bad.status).toBe(400)
    expect(envelopeOf(bad)).toMatchObject({ ok: false, error: { code: 'invalid-id' } })
    expect(readReport).not.toHaveBeenCalled()

    const traversal = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/records/${encodeURIComponent('../etc/passwd')}` }), traversal)
    expect(traversal.status).toBe(400)

    const missing = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/records/RPT-20260917-100532` }), missing)
    expect(missing.status).toBe(404)
    expect(envelopeOf(missing)).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('api/trend/:pool:天数透传;空池号 → 400', async () => {
    const computeTrend = vi.fn(async (pool: string, days: number) => ({
      pool,
      days,
      total: 0,
      distribution: { normal: 0, early: 0, disease: 0, unknown: 0 },
      top_symptoms: [],
      recent_records: []
    }))
    const handler = createTraceHandler(createDeps({ computeTrend }))

    const ok = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/trend/池1?days=30` }), ok)
    expect(computeTrend).toHaveBeenCalledWith('池1', 30)
    expect(ok.status).toBe(200)

    const empty = mockResponse()
    await handler(mockRequest({ url: `${TRACE_PREFIX}/api/trend/` }), empty)
    expect(empty.status).toBe(400)
  })

  it('未知路径 → 404;HttpError 映射;意外异常 → 500 兜底', async () => {
    const unknown = mockResponse()
    await createTraceHandler(createDeps())(mockRequest({ url: `${TRACE_PREFIX}/nope` }), unknown)
    expect(unknown.status).toBe(404)

    const mapped = mockResponse()
    await createTraceHandler(
      createDeps({
        queryIndex: async () => {
          throw new HttpError(400, 'invalid-param', 'x')
        }
      })
    )(mockRequest({ url: `${TRACE_PREFIX}/api/records` }), mapped)
    expect(mapped.status).toBe(400)

    const boom = mockResponse()
    await createTraceHandler(
      createDeps({
        queryIndex: async () => {
          throw new Error('boom')
        }
      })
    )(mockRequest({ url: `${TRACE_PREFIX}/api/records` }), boom)
    expect(boom.status).toBe(500)
    expect(envelopeOf(boom)).toMatchObject({ ok: false, error: { code: 'internal', message: 'boom' } })
  })
})

describe('页面资源', () => {
  it('三个 HTML 页面可从源码目录读取(构建时拷入 dist/web/)', async () => {
    const list = await readTracePage('list')
    const detail = await readTracePage('detail')
    const trend = await readTracePage('trend')
    for (const html of [list, detail, trend]) {
      expect(html).toContain('<!doctype html')
      expect(html).toContain('AquaSense')
    }
  })
})
