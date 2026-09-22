/**
 * R8 会话事件桥接(session-trace-bridge)单元测试
 *
 * 测试重点(方式 B 四纪律):
 *  - 完整链路:turn/start → step/start → tool/call ↔ tool/result → ledger 收尾回填
 *  - 重试推导:同 step 同 (name, arguments) 再次调用 → attempt 递增
 *  - 悬挂兜底:turn/end 未闭合调用以 error=ABORTED 强制关闭
 *  - 过滤与降级:非目标工具忽略;无池号不回填;已有 agent(turn 不同)不覆盖
 *  - 宿主安全:installSessionTraceBridge 回调异常不向宿主传播
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionTraceBridge, installSessionTraceBridge } from './session-trace-bridge.js'
import { readReport, updateIndex, writeReport } from './trace-store.js'
import type { AnalysisRecord } from './trace-recorder.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquasense-bridge-'))
  process.env.AQUASENSE_CACHE_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.AQUASENSE_CACHE_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 事件时间基准(Unix ms);记录 created_at 取 T0 之后,满足时间窗口过滤 */
const T0 = 1_760_000_000_000

/** 造一条群聊记录(无 agent,待桥接回填) */
function makeGroupRecord(id: string, pool: string, createdAt: string): AnalysisRecord {
  return {
    id,
    pool,
    reporter: '张三',
    reporter_open_id: 'ou_1',
    source: 'group_chat',
    created_at: createdAt,
    model: 'deepseek-flash',
    total_duration_ms: 800,
    total_tokens: 100,
    status: 'success'
  }
}

/** 构造会话事件(字段与 dsh-session SessionEvent 对齐的最小面) */
function ev(type: string, time: number, data?: Record<string, unknown>): { type: string; seq: number; time: number; data?: Record<string, unknown> } {
  return { type, seq: 0, time, data }
}

/** 预写一条群聊记录到报告目录与索引(供桥接回填) */
async function seedRecord(id: string, pool: string, createdOffsetMs = 5000): Promise<void> {
  const record = makeGroupRecord(id, pool, new Date(T0 + createdOffsetMs).toISOString())
  await writeReport(record)
  await updateIndex(record)
}

describe('SessionTraceBridge 状态机', () => {
  it('完整链路:ledger 收尾后回填 agent(think_ms/耗时/状态)', async () => {
    await seedRecord('RPT-20260920-1000', '池1')
    const bridge = new SessionTraceBridge()
    const session: object = {}

    bridge.handleEvent(session, ev('turn/start', T0, { turn: 3 }))
    bridge.handleEvent(session, ev('step/start', T0 + 400, { step: 1 }))
    bridge.handleEvent(session, ev('tool/call', T0 + 800, { name: 'aquasense_analyze', callId: 'c1', arguments: '{"image":"a"}', turn: 3, step: 1 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 1200, { callId: 'c1' }))
    bridge.handleEvent(session, ev('tool/call', T0 + 1300, { name: 'aquasense_ledger', callId: 'c2', arguments: '{"pool_id":"池1"}', turn: 3, step: 1 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 1700, { callId: 'c2' }))

    await sleep(100)

    const record = await readReport('RPT-20260920-1000')
    expect(record?.agent).toBeDefined()
    expect(record?.agent?.turn).toBe(3)
    expect(record?.agent?.step).toBe(1)
    // step/start(T0+400) → 首个 tool/call(T0+800)
    expect(record?.agent?.think_ms).toBe(400)
    expect(record?.agent?.calls).toHaveLength(2)
    expect(record?.agent?.calls[0]).toMatchObject({ tool: 'aquasense_analyze', call_id: 'c1', attempt: 1, status: 'ok', duration_ms: 400 })
    expect(record?.agent?.calls[1]).toMatchObject({ tool: 'aquasense_ledger', call_id: 'c2', attempt: 1, status: 'ok', duration_ms: 400 })
  })

  it('兼容新版事件结构:tool/result 的 callId 位于 message.source 时正常闭合', async () => {
    await seedRecord('RPT-20260920-1010', '池1')
    const bridge = new SessionTraceBridge()
    const session: object = {}

    bridge.handleEvent(session, ev('turn/start', T0, { turn: 4 }))
    bridge.handleEvent(session, ev('step/start', T0 + 200, { step: 1 }))
    bridge.handleEvent(session, ev('tool/call', T0 + 500, { name: 'aquasense_analyze', callId: 'c1', arguments: '{"image":"a"}', turn: 4, step: 1 }))
    // 新版 DSH:tool/result 顶层无 callId,位于 message.source.callId(ToolMessageSource)
    bridge.handleEvent(session, ev('tool/result', T0 + 900, { message: { source: { kind: 'tool', callId: 'c1' } }, error: { name: 'RateLimitError', code: 'RATE_LIMIT' } }))
    bridge.handleEvent(session, ev('tool/call', T0 + 1000, { name: 'aquasense_ledger', callId: 'c2', arguments: '{"pool_id":"池1"}', turn: 4, step: 1 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 1500, { message: { source: { kind: 'tool', callId: 'c2' } } }))

    await sleep(100)

    const record = await readReport('RPT-20260920-1010')
    expect(record?.agent).toBeDefined()
    expect(record?.agent?.calls).toHaveLength(2)
    expect(record?.agent?.calls[0]).toMatchObject({ tool: 'aquasense_analyze', call_id: 'c1', status: 'error', error_code: 'RATE_LIMIT', duration_ms: 400 })
    expect(record?.agent?.calls[1]).toMatchObject({ tool: 'aquasense_ledger', call_id: 'c2', status: 'ok', duration_ms: 500 })
  })

  it('重试推导:同 step 同参数再次调用 attempt 递增;前次 error_code 保留', async () => {
    await seedRecord('RPT-20260920-1001', '池2')
    const bridge = new SessionTraceBridge()
    const session: object = {}

    bridge.handleEvent(session, ev('turn/start', T0, { turn: 5 }))
    bridge.handleEvent(session, ev('step/start', T0 + 100, { step: 2 }))
    bridge.handleEvent(session, ev('tool/call', T0 + 200, { name: 'aquasense_analyze', callId: 'a1', arguments: '{"image":"x"}', turn: 5, step: 2 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 300, { callId: 'a1', error: { name: 'RateLimitError', code: 'RATE_LIMIT' } }))
    bridge.handleEvent(session, ev('tool/call', T0 + 400, { name: 'aquasense_analyze', callId: 'a2', arguments: '{"image":"x"}', turn: 5, step: 2 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 700, { callId: 'a2' }))
    bridge.handleEvent(session, ev('tool/call', T0 + 800, { name: 'aquasense_ledger', callId: 'l1', arguments: '{"fields":{"池号":"池2"}}', turn: 5, step: 2 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 1000, { callId: 'l1' }))

    await sleep(100)

    const record = await readReport('RPT-20260920-1001')
    const analyzeCalls = record?.agent?.calls.filter((c) => c.tool === 'aquasense_analyze') ?? []
    expect(analyzeCalls).toHaveLength(2)
    expect(analyzeCalls[0]).toMatchObject({ attempt: 1, status: 'error', error_code: 'RATE_LIMIT' })
    expect(analyzeCalls[1]).toMatchObject({ attempt: 2, status: 'ok' })
    expect(analyzeCalls[1].error_code).toBeUndefined()
  })

  it('悬挂兜底:turn/end 未闭合调用以 error=ABORTED 强制关闭并回填', async () => {
    await seedRecord('RPT-20260920-1002', '池3')
    const bridge = new SessionTraceBridge()
    const session: object = {}

    bridge.handleEvent(session, ev('turn/start', T0, { turn: 7 }))
    bridge.handleEvent(session, ev('step/start', T0 + 100, { step: 1 }))
    bridge.handleEvent(session, ev('tool/call', T0 + 200, { name: 'aquasense_ledger', callId: 'l9', arguments: '{"pool_id":"池3"}', turn: 7, step: 1 }))
    // 不发送 tool/result → 悬挂
    bridge.handleEvent(session, ev('turn/end', T0 + 5000, { turn: 7, reason: 'limit' }))

    await sleep(100)

    const record = await readReport('RPT-20260920-1002')
    expect(record?.agent?.turn).toBe(7)
    expect(record?.agent?.calls[0]).toMatchObject({ tool: 'aquasense_ledger', status: 'error', error_code: 'ABORTED' })
  })

  it('过滤与降级:非目标工具忽略;ledger 无池号则不回填', async () => {
    await seedRecord('RPT-20260920-1003', '池4')
    const bridge = new SessionTraceBridge()
    const session: object = {}

    bridge.handleEvent(session, ev('turn/start', T0, { turn: 8 }))
    bridge.handleEvent(session, ev('tool/call', T0 + 100, { name: 'some_other_tool', callId: 'x1', arguments: '{}', turn: 8, step: 1 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 200, { callId: 'x1' }))
    bridge.handleEvent(session, ev('tool/call', T0 + 300, { name: 'aquasense_ledger', callId: 'l2', arguments: '{"foo":"bar"}', turn: 8, step: 1 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 400, { callId: 'l2' }))

    await sleep(100)

    const record = await readReport('RPT-20260920-1003')
    expect(record?.agent).toBeUndefined()
  })

  it('幂等:已有 agent(其他 turn)的记录不被覆盖', async () => {
    const record = makeGroupRecord('RPT-20260920-1004', '池1', new Date(T0 + 5000).toISOString())
    record.agent = { turn: 1, step: 1, think_ms: 0, calls: [] }
    await writeReport(record)
    await updateIndex(record)

    const bridge = new SessionTraceBridge()
    const session: object = {}

    bridge.handleEvent(session, ev('turn/start', T0, { turn: 9 }))
    bridge.handleEvent(session, ev('tool/call', T0 + 100, { name: 'aquasense_ledger', callId: 'l3', arguments: '{"pool_id":"池1"}', turn: 9, step: 1 }))
    bridge.handleEvent(session, ev('tool/result', T0 + 300, { callId: 'l3' }))

    await sleep(100)

    const after = await readReport('RPT-20260920-1004')
    expect(after?.agent?.turn).toBe(1)
  })

  it('畸形事件防御读取不抛异常', () => {
    const bridge = new SessionTraceBridge()
    const session: object = {}
    expect(() => bridge.handleEvent(session, { type: 'tool/call', data: null })).not.toThrow()
    expect(() => bridge.handleEvent(session, { type: 'tool/call', data: { name: 42, callId: {} } })).not.toThrow()
    expect(() => bridge.handleEvent(session, { type: 'tool/result', data: null })).not.toThrow()
    expect(() => bridge.handleEvent(session, { type: 'tool/result', data: { message: null } })).not.toThrow()
    expect(() => bridge.handleEvent(session, { type: 'tool/result', data: { message: { source: null } } })).not.toThrow()
    expect(() => bridge.handleEvent(session, { type: 'tool/result', data: { message: {} } })).not.toThrow()
    expect(() => bridge.handleEvent(session, { type: 'unknown/type' })).not.toThrow()
    expect(() => bridge.handleEvent(session, { type: 'turn/start', data: { turn: 'x' } })).not.toThrow()
  })
})

describe('installSessionTraceBridge 宿主安全', () => {
  it('回调异常不向宿主传播(纪律4)', () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    const fakeCtx = {
      on(name: string, cb: (...args: unknown[]) => void): () => void {
        const list = listeners.get(name) ?? []
        list.push(cb)
        listeners.set(name, list)
        return () => {}
      },
      effect(fn: () => unknown): void {
        fn()
      }
    }

    expect(() => installSessionTraceBridge(fakeCtx as never)).not.toThrow()
    const eventCb = listeners.get('session/event')?.[0]
    const disposedCb = listeners.get('session/disposed')?.[0]
    expect(eventCb).toBeDefined()
    expect(disposedCb).toBeDefined()

    // 畸形事件(内部抛错被 try-catch 兜住,不外抛)
    expect(() => eventCb?.({}, { type: 'tool/call', data: { name: 'aquasense_analyze', callId: 1, arguments: null } })).not.toThrow()
    expect(() => eventCb?.({}, null)).not.toThrow()
    expect(() => disposedCb?.({})).not.toThrow()
  })

  it('宿主无 on 事件面时静默跳过', () => {
    const fakeCtx = { effect: (fn: () => unknown) => { fn() } }
    expect(() => installSessionTraceBridge(fakeCtx as never)).not.toThrow()
  })
})
