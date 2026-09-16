/**
 * S9 配置页 Web 面(gateway)单元测试
 *
 * 测试重点:
 *  - parseRemindConfigInput:保存请求校验(字段类型/长度/任务归一化)
 *  - createRemindApi:get/save/test/groups 分发与错误映射(400/404/502)
 *  - handleRemindHttp:协议层(405/403/415/404/413)与信封写回
 */

import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRemindApi, handleRemindHttp, parseRemindConfigInput, HttpError } from './remind-gateway.js'
import type { RemindApiDeps } from './remind-gateway.js'

/** 基础依赖(可按用例覆盖) */
function createDeps(overrides: Partial<RemindApiDeps> = {}): RemindApiDeps {
  return {
    getConfig: () => ({
      enabled: true,
      group: 'oc_test_group',
      cron: '0 7 * * *',
      tasks: [{ time: '08:00', task: '投喂并拍照' }]
    }),
    getStatus: () => ({ date: '2026-09-16', planned: 2, sent: 1, nextTime: '08:00', running: true }),
    saveConfig: (input) => ({
      enabled: input.enabled ?? false,
      group: input.group ?? '',
      cron: '0 7 * * *',
      tasks: input.tasks ?? []
    }),
    sendTest: vi.fn(async () => {}),
    listGroups: vi.fn(async () => [{ chatId: 'oc_1', name: '巡检群' }]),
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
    url: options.url ?? '/aquasense-remind/api/get',
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
function envelopeOf(res: { body: string }): unknown {
  return JSON.parse(res.body)
}

describe('parseRemindConfigInput', () => {
  it('合法输入归一化(时间补零、内容 trim)', () => {
    const input = parseRemindConfigInput({
      config: {
        enabled: true,
        group: ' oc_1 ',
        tasks: [{ time: '8:05', task: ' 投喂 ' }]
      }
    })
    expect(input).toEqual({ enabled: true, group: 'oc_1', tasks: [{ time: '08:05', task: '投喂' }] })
  })

  it('缺少 config 对象 → 400 invalid-config', () => {
    expect(() => parseRemindConfigInput({})).toThrowError(HttpError)
    try {
      parseRemindConfigInput(null)
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(400)
      expect((error as HttpError).code).toBe('invalid-config')
    }
  })

  it('enabled 非布尔值 → 400', () => {
    expect(() => parseRemindConfigInput({ config: { enabled: 'yes', group: '', tasks: [] } })).toThrowError(
      /enabled 必须为布尔值/
    )
  })

  it('group 超长(>128) → 400', () => {
    expect(() =>
      parseRemindConfigInput({ config: { enabled: true, group: 'x'.repeat(129), tasks: [] } })
    ).toThrowError(/group 长度/)
  })

  it('tasks 非数组 → 400', () => {
    expect(() => parseRemindConfigInput({ config: { enabled: true, group: '', tasks: 'nope' } })).toThrowError(
      /tasks 必须为数组/
    )
  })

  it('任务数超过 50 条 → 400', () => {
    const tasks = Array.from({ length: 51 }, (_, i) => ({ time: '08:00', task: `任务${i}` }))
    expect(() => parseRemindConfigInput({ config: { enabled: true, group: '', tasks } })).toThrowError(/任务数量/)
  })

  it('非法任务(空内容)→ 400 并指出序号', () => {
    expect(() =>
      parseRemindConfigInput({
        config: { enabled: true, group: '', tasks: [{ time: '08:00', task: 'ok' }, { time: '09:00', task: '  ' }] }
      })
    ).toThrowError(/第 2 条任务非法/)
  })

  it('任务内容超长(>200) → 400', () => {
    expect(() =>
      parseRemindConfigInput({
        config: { enabled: true, group: '', tasks: [{ time: '08:00', task: 'x'.repeat(201) }] }
      })
    ).toThrowError(/任务内容/)
  })
})

describe('createRemindApi', () => {
  it('get 返回配置与当日状态', async () => {
    const dispatch = createRemindApi(createDeps())
    const result = await dispatch('get', {})
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      ok: true,
      value: {
        config: { enabled: true, group: 'oc_test_group' },
        status: { planned: 2, sent: 1, nextTime: '08:00' }
      }
    })
  })

  it('save 校验后保存并返回新配置/状态', async () => {
    const saveConfig = vi.fn((input) => ({
      enabled: input.enabled ?? false,
      group: input.group ?? '',
      cron: '0 7 * * *',
      tasks: input.tasks ?? []
    }))
    const dispatch = createRemindApi(createDeps({ saveConfig }))
    const result = await dispatch('save', { config: { enabled: false, group: 'oc_2', tasks: [] } })

    expect(saveConfig).toHaveBeenCalledWith({ enabled: false, group: 'oc_2', tasks: [] })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, value: { config: { enabled: false, group: 'oc_2' } } })
  })

  it('save 非法请求体 → 400 且不调用 saveConfig', async () => {
    const saveConfig = vi.fn()
    const dispatch = createRemindApi(createDeps({ saveConfig: saveConfig as unknown as RemindApiDeps['saveConfig'] }))
    const result = await dispatch('save', { config: { enabled: 1, group: '', tasks: [] } })

    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'invalid-config' } })
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('test 未配置目标群 → 400 group-missing', async () => {
    const sendTest = vi.fn(async () => {})
    const dispatch = createRemindApi(
      createDeps({
        getConfig: () => ({ enabled: true, group: '', cron: '0 7 * * *', tasks: [] }),
        sendTest
      })
    )
    const result = await dispatch('test', {})
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'group-missing' } })
    expect(sendTest).not.toHaveBeenCalled()
  })

  it('test 成功 → { sent: true }', async () => {
    const sendTest = vi.fn(async () => {})
    const dispatch = createRemindApi(createDeps({ sendTest }))
    const result = await dispatch('test', {})
    expect(sendTest).toHaveBeenCalledTimes(1)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, value: { sent: true } })
  })

  it('test 推送失败 → 502 push-failed(带原因)', async () => {
    const dispatch = createRemindApi(
      createDeps({
        sendTest: async () => {
          throw new Error('飞书推送失败:机器人不在群内')
        }
      })
    )
    const result = await dispatch('test', {})
    expect(result.status).toBe(502)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'push-failed', message: '飞书推送失败:机器人不在群内' } })
  })

  it('groups 成功返回群列表', async () => {
    const dispatch = createRemindApi(createDeps())
    const result = await dispatch('groups', {})
    expect(result.body).toMatchObject({ ok: true, value: { groups: [{ chatId: 'oc_1', name: '巡检群' }] } })
  })

  it('groups 失败降级为空列表 + error(仍 200)', async () => {
    const dispatch = createRemindApi(
      createDeps({
        listGroups: async () => {
          throw new Error('飞书鉴权失败')
        }
      })
    )
    const result = await dispatch('groups', {})
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, value: { groups: [], error: '飞书鉴权失败' } })
  })

  it('未知方法 → 404 unknown-method', async () => {
    const dispatch = createRemindApi(createDeps())
    const result = await dispatch('nope', {})
    expect(result.status).toBe(404)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'unknown-method' } })
  })
})

describe('handleRemindHttp(协议层)', () => {
  const dispatch = createRemindApi(createDeps())

  it('非 POST → 405', async () => {
    const res = mockResponse()
    await handleRemindHttp(dispatch, mockRequest({ method: 'GET' }), res)
    expect(res.status).toBe(405)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'method-not-allowed' } })
  })

  it('跨域 Origin → 403', async () => {
    const res = mockResponse()
    await handleRemindHttp(
      dispatch,
      mockRequest({ headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'dsh.internal' } }),
      res
    )
    expect(res.status).toBe(403)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'origin-not-allowed' } })
  })

  it('同源 Origin 放行', async () => {
    const res = mockResponse()
    await handleRemindHttp(
      dispatch,
      mockRequest({ headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' } }),
      res
    )
    expect(res.status).toBe(200)
  })

  it('非 JSON Content-Type → 415', async () => {
    const res = mockResponse()
    await handleRemindHttp(dispatch, mockRequest({ headers: { 'content-type': 'text/plain' } }), res)
    expect(res.status).toBe(415)
  })

  it('未知路径 → 404(前缀外/多级/空方法名)', async () => {
    for (const url of ['/other/api/get', '/aquasense-remind/api/a/b', '/aquasense-remind/api/']) {
      const res = mockResponse()
      await handleRemindHttp(dispatch, mockRequest({ url }), res)
      expect(res.status).toBe(404)
    }
  })

  it('请求体非法 JSON → 400 invalid-json', async () => {
    const res = mockResponse()
    await handleRemindHttp(dispatch, mockRequest({ body: '{oops' }), res)
    expect(res.status).toBe(400)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'invalid-json' } })
  })

  it('请求体超限 → 413 payload-too-large', async () => {
    const res = mockResponse()
    await handleRemindHttp(dispatch, mockRequest({ body: JSON.stringify({ pad: 'x'.repeat(17 * 1024) }) }), res)
    expect(res.status).toBe(413)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'payload-too-large' } })
  })

  it('正常请求走完整链路并写回信封', async () => {
    const res = mockResponse()
    await handleRemindHttp(
      dispatch,
      mockRequest({ url: '/aquasense-remind/api/save', body: JSON.stringify({ config: { enabled: true, group: 'oc_x', tasks: [] } }) }),
      res
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(envelopeOf(res)).toMatchObject({ ok: true, value: { config: { group: 'oc_x' } } })
  })

  it('dispatch 意外抛错 → 500 兜底', async () => {
    const res = mockResponse()
    await handleRemindHttp(
      async () => {
        throw new Error('boom')
      },
      mockRequest({}),
      res
    )
    expect(res.status).toBe(500)
    expect(envelopeOf(res)).toMatchObject({ ok: false, error: { code: 'internal', message: 'boom' } })
  })
})
