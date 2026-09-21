/**
 * R8 群聊 Agent 决策链桥接(方式 B,见 docs/r8-traceability-architecture.md §3.6)
 *
 * 订阅 DSH 会话事件流(ctx.on('session/event')),对群聊场景的
 * aquasense_analyze/advice/ledger 三工具调用做 tool/call ↔ tool/result 配对,
 * 采集 turn/step/call_id/重试/精确耗时,组装 AnalysisRecord.agent 并回填到
 * trace-ledger-wrap 后置收集写入的分析记录(业务数据仍由包装器负责)。
 *
 * 借鉴 dsh-observe(Apache-2.0)的设计模式,原创实现(无代码复制,无许可证义务):
 *  纪律1 开闭配对  / 纪律2 悬挂兜底  / 纪律3 WeakMap  / 纪律4 回调 try-catch
 *
 * 关联方式(会话事件拿不到 chat_id,以池号+时间窗口关联):
 *  ledger 工具参数提取 pool_id → index.json 中查找「同池号 + group_chat +
 *  无 agent 字段 + turn/start 时间之后」的最新记录回填;ledger-wrap 写盘可能
 *  晚于 ledger tool/result 事件(图片下载耗时),故回填带延迟重试。
 *
 * 边界(诚实声明):
 *  - 视觉模型 Token/知识库命中数在 agent 层拿不到(仍由工具内埋点负责);
 *  - 不读日志文件(~/.dsh/sessions/*.jsonl),只订阅进程内实时事件;
 *    插件晚挂载/中途重启的历史事件不可回溯(记录缺失 agent,UI 自动隐藏)。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentToolCall, AgentTraceData } from './trace-recorder.js'
import { findPendingAgentRecord, patchReportAgent } from './trace-store.js'

// ========== 本地最小事件结构(防御式读取) ==========
// dsh-session 为传递依赖,不直接 import;事件字段按需宽松读取,
// 未识别的字段/类型一律忽略(回调内已 try-catch,不影响宿主)。

/** 会话对象最小面(仅取 id 作 WeakMap 键关联调试,非必需) */
interface TraceSession {
  id?: unknown
}

/** 会话事件最小面(type/seq/time/data,与 dsh-session SessionEvent 对齐) */
interface TraceEvent {
  type?: unknown
  seq?: unknown
  /** Unix epoch milliseconds */
  time?: unknown
  data?: unknown
}

type TraceEventCallback = (session: TraceSession, event: TraceEvent) => void

/** 桥接所需的 ctx 事件面(根上下文订阅 session 事件 + 工具注册表事件) */
interface TraceEventHost {
  on(name: 'session/event', cb: TraceEventCallback): () => void
  on(name: 'session/disposed', cb: (session: TraceSession) => void): () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools/result 事件签名来自 dsh-tools,此处最小化声明
  on(name: string, cb: (...args: any[]) => void): () => void
}

// ========== 常量 ==========

/** 参与决策链采集的工具名(与 Agent 编排链一致) */
const TRACE_TOOLS = new Set(['aquasense_analyze', 'aquasense_advice', 'aquasense_ledger'])

/** 回填重试间隔(毫秒):ledger-wrap 写盘可能晚于 ledger tool/result 事件 */
const FILL_DELAYS = [0, 3_000, 10_000, 30_000] as const

// ========== tools/result metadata 缓存(补充 presentationMeta 不可用的 agent 派发调用) ==========
// DSH 核心:exec.parent !== undefined 时跳过 presentationMeta 计算;
// agent loop 派发的工具调用 exec.parent 总被设置,因此 tool/result session 事件的 meta 永远为空。
// 解决方案:订阅 tools/result registry 事件(在 session 事件之前触发),从 result.value 自行计算
// metadata 存入 Map;bridge 处理 tool/result session 事件时查表补充 call.meta。
const toolsMetaCache = new Map<string, Record<string, unknown>>()

/** 从工具 result.value 计算结构化元数据(供 UI Agent 决策链摘要) */
function computeToolMeta(toolName: string, value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  try {
    if (toolName === 'aquasense_analyze') {
      return {
        cls: String(v.cls ?? ''),
        confidence: typeof v.confidence === 'number' ? v.confidence : 0,
        severity: String(v.severity ?? ''),
        image_count: typeof v.image_count === 'number' ? v.image_count : 0,
        scene_hint: String(v.scene_hint ?? '')
      }
    }
    if (toolName === 'aquasense_advice') {
      const refs = Array.isArray(v.knowledge_refs) ? v.knowledge_refs : []
      return {
        alert_level: String(v.alert_level ?? ''),
        knowledge_refs_count: refs.length,
        diagnosis_summary: String(v.diagnosis_summary ?? '').slice(0, 200)
      }
    }
    if (toolName === 'aquasense_ledger') {
      return {
        success: v.success === true,
        record_id: String(v.record_id ?? '')
      }
    }
  } catch { /* 防御:解析失败不阻断主链路 */ }
  return undefined
}

/** 悬挂兜底原因码(turn/end 或 session/disposed 时未闭合的调用) */
const ABORTED_CODE = 'ABORTED'

// ========== 状态 ==========

/** 单次工具调用的配对状态 */
interface PendingCall {
  callId: string
  tool: AgentToolCall['tool']
  turn: number
  step: number
  attempt: number
  /** tool/call 事件时间(Unix ms) */
  startedAt: number
  durationMs: number
  status: 'ok' | 'error'
  errorCode?: string
  arguments: string
  /** tool/result 事件中工具附加的 presentationMeta 结构化摘要 */
  meta?: Record<string, unknown>
}

/** 每个会话的采集状态(纪律3:WeakMap 键为 session 对象,自动回收) */
interface BridgeState {
  turn: number
  step: number
  /** turn/start 事件时间(Unix ms,回填时间窗口起点) */
  turnStartedAt: number
  /** step/start 事件时间(Unix ms,计算 Agent 决策耗时) */
  stepStartedAt: number
  /** 未闭合调用(tool/call 已开、tool/result 未到) */
  open: Map<string, PendingCall>
  /** 已闭合调用(ledger 收尾后整体回填) */
  done: PendingCall[]
  /** 同名同参计数(attempt 推导) */
  toolCounts: Map<string, number>
  /** ledger 工具参数中提取的池号(回填关联键) */
  pool: string
  /** 已触发回填的 turn(防重复) */
  filledTurns: Set<number>
}

// ========== 数据读取辅助 ==========

/** 从 unknown 中读取数字(非 number 返回 fallback) */
function numOf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 从 unknown 中读取字符串(非 string 返回 fallback) */
function strOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 从 ledger 工具 arguments JSON 中提取池号(解析失败返回 '') */
function poolOfArgs(argumentsJson: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (!parsed || typeof parsed !== 'object') return ''
    const args = parsed as Record<string, unknown>
    const direct = strOf(args.pool_id).trim()
    if (direct) return direct
    const fields = args.fields
    if (fields && typeof fields === 'object') {
      return strOf((fields as Record<string, unknown>)['池号']).trim()
    }
    return ''
  } catch {
    return ''
  }
}

// ========== 核心状态机(导出供测试) ==========

export class SessionTraceBridge {
  private readonly states = new WeakMap<object, BridgeState>()

  /** 会话事件入口(纪律4:调用方已包 try-catch,此处仍防御) */
  handleEvent(session: TraceSession, event: TraceEvent): void {
    const type = strOf(event.type)
    if (type === 'turn/start') {
      const turn = numOf(readField(event, 'turn'))
      if (turn <= 0) return
      // 新 turn 开始:上一 turn 若仍有未闭合调用,悬挂兜底关闭(纪律2)
      const prev = this.stateOf(session)
      if (prev.open.size > 0) this.closeHanging(prev, false)
      const state = this.stateOf(session)
      state.turn = turn
      state.turnStartedAt = numOf(event.time)
      state.open.clear()
      state.done = []
      state.toolCounts.clear()
      state.pool = ''
      return
    }

    if (type === 'step/start') {
      const state = this.stateOf(session)
      state.step = numOf(readField(event, 'step'), state.step)
      state.stepStartedAt = numOf(event.time, state.stepStartedAt)
      return
    }

    if (type === 'tool/call') {
      const data = event.data as Record<string, unknown> | undefined
      if (!data) return
      const name = strOf(data.name)
      if (!TRACE_TOOLS.has(name)) return
      const callId = strOf(data.callId)
      if (!callId) return
      const argumentsJson = strOf(data.arguments)
      const turn = numOf(data.turn)
      const step = numOf(data.step)
      const state = this.stateOf(session)
      if (turn > 0) state.turn = turn
      if (step > 0) state.step = step

      // 重试推导:同一 step 内相同 (name, arguments) 的再次调用 → attempt 递增
      const key = `${name}\u0000${argumentsJson}`
      const attempt = (state.toolCounts.get(key) ?? 0) + 1
      state.toolCounts.set(key, attempt)

      const call: PendingCall = {
        callId,
        tool: name as AgentToolCall['tool'],
        turn: state.turn,
        step: state.step,
        attempt,
        startedAt: numOf(event.time),
        durationMs: 0,
        status: 'error',
        arguments: argumentsJson
      }
      state.open.set(callId, call)
      // ledger 参数携带池号 → 记录为回填关联键
      if (name === 'aquasense_ledger') {
        const pool = poolOfArgs(argumentsJson)
        if (pool) state.pool = pool
      }
      return
    }

    if (type === 'tool/result') {
      const data = event.data as Record<string, unknown> | undefined
      if (!data) return
      const callId = strOf(data.callId)
      if (!callId) return
      const state = this.stateOf(session)
      const call = state.open.get(callId)
      if (!call) return
      call.durationMs = Math.max(0, Math.round(numOf(event.time) - call.startedAt))
      const error = data.error as { name?: unknown; code?: unknown } | undefined
      if (error) {
        call.status = 'error'
        call.errorCode = strOf(error.code, strOf(error.name))
      } else {
        call.status = 'ok'
      }
      // 读取工具 metadata:优先 tools/result cache(agent 派发调用),回退 session 事件 meta(直接调用)
      const cached = toolsMetaCache.get(callId)
      if (cached) {
        call.meta = cached
        toolsMetaCache.delete(callId)
      } else {
        const rawMeta = data.meta
        if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
          call.meta = rawMeta as Record<string, unknown>
        }
      }
      state.open.delete(callId)
      state.done.push(call)
      // ledger 收尾 → 组装并回填 agent
      if (call.tool === 'aquasense_ledger') {
        this.fill(session, state)
      }
      return
    }

    if (type === 'turn/end') {
      const state = this.stateOf(session)
      // 悬挂兜底:turn 结束时未闭合的调用以 error 状态强制关闭
      this.closeHanging(state, true)
      return
    }
  }

  /** 会话销毁兜底(纪律2):未闭合调用强制关闭并尝试回填 */
  handleSessionDisposed(session: TraceSession): void {
    const state = this.states.get(session as object)
    if (!state) return
    this.closeHanging(state, true)
    this.states.delete(session as object)
  }

  /** 获取/创建会话状态(WeakMap) */
  private stateOf(session: TraceSession): BridgeState {
    const key = session as object
    let state = this.states.get(key)
    if (!state) {
      state = {
        turn: 0,
        step: 0,
        turnStartedAt: 0,
        stepStartedAt: 0,
        open: new Map(),
        done: [],
        toolCounts: new Map(),
        pool: '',
        filledTurns: new Set()
      }
      this.states.set(key, state)
    }
    return state
  }

  /** 悬挂兜底:未闭合调用以 error 状态并入 done;willFill=true 时触发回填 */
  private closeHanging(state: BridgeState, willFill: boolean): void {
    if (state.open.size === 0) return
    for (const call of state.open.values()) {
      call.status = 'error'
      call.errorCode = call.errorCode ?? ABORTED_CODE
      state.done.push(call)
    }
    state.open.clear()
    if (willFill) this.fill(undefined, state)
  }

  /** 组装 AgentTraceData 并异步回填(延迟重试,防重复) */
  private fill(session: TraceSession | undefined, state: BridgeState): void {
    if (state.filledTurns.has(state.turn)) return
    const agent = buildAgentData(state)
    if (!agent) return
    state.filledTurns.add(state.turn)
    // 若无池号,清空 done 避免累积;不重试
    if (!state.pool) {
      state.done = []
      return
    }
    const sinceIso = new Date(state.turnStartedAt > 0 ? state.turnStartedAt : Date.now() - 600_000).toISOString()
    void attachWithRetry(state.pool, sinceIso, agent, 0)
    state.done = []
  }
}

/** 从事件 data 读取字段(data 可能缺失) */
function readField(event: TraceEvent, field: string): unknown {
  const data = event.data
  if (!data || typeof data !== 'object') return undefined
  return (data as Record<string, unknown>)[field]
}

/** 组装 AgentTraceData(按开始时间排序;think_ms 为 step 开始 → 首个工具调用) */
function buildAgentData(state: BridgeState): AgentTraceData | null {
  if (state.done.length === 0 || state.turn <= 0) return null
  const calls = [...state.done].sort((a, b) => a.startedAt - b.startedAt || a.attempt - b.attempt)
  const first = calls[0]
  const thinkMs =
    state.stepStartedAt > 0 && first.startedAt > 0 ? Math.max(0, first.startedAt - state.stepStartedAt) : 0
  return {
    turn: state.turn,
    step: state.step,
    think_ms: Math.round(thinkMs),
    calls: calls.map((c) => ({
      tool: c.tool,
      call_id: c.callId,
      attempt: c.attempt,
      duration_ms: c.durationMs,
      status: c.status,
      ...(c.errorCode ? { error_code: c.errorCode } : {}),
      ...(c.meta ? { meta: c.meta } : {})
    }))
  }
}

/** 回填(带延迟重试:ledger-wrap 写盘可能晚于 ledger tool/result 事件) */
async function attachWithRetry(pool: string, sinceIso: string, agent: AgentTraceData, delayIdx: number): Promise<void> {
  try {
    const ids = await findPendingAgentRecord(pool, sinceIso)
    for (const id of ids) {
      if (await patchReportAgent(id, agent)) return
    }
    const next = delayIdx + 1
    if (next < FILL_DELAYS.length) {
      setTimeout(() => {
        void attachWithRetry(pool, sinceIso, agent, next)
      }, FILL_DELAYS[next])
    } else {
      console.warn(`[aquasense-trace] Agent 决策链回填失败(无匹配记录): 池号 ${pool}, turn ${agent.turn}`)
    }
  } catch (error) {
    console.warn('[aquasense-trace] Agent 决策链回填异常:', error instanceof Error ? error.message : error)
  }
}

// ========== 插件接线 ==========

/**
 * 订阅 DSH 会话事件,启动群聊 Agent 决策链采集(v1.8)。
 * enabled=false/宿主不支持 session 事件时静默跳过(零注册)。
 * 注册与注销经 ctx.effect 统一收口,回调内全量 try-catch(纪律4)。
 */
export function installSessionTraceBridge(ctx: Context): void {
  const host = ctx as unknown as TraceEventHost
  if (typeof host.on !== 'function') {
    console.warn('[aquasense-trace] 宿主不支持 session/event 订阅,跳过 Agent 决策链桥接')
    return
  }

  ctx.effect(() => {
    const bridge = new SessionTraceBridge()
    let offEvent: (() => void) | undefined
    let offDisposed: (() => void) | undefined
    let offToolsResult: (() => void) | undefined
    try {
      offEvent = host.on('session/event', (session, event) => {
        try {
          bridge.handleEvent(session, event)
        } catch (error) {
          console.warn('[aquasense-trace] 会话事件处理失败:', error instanceof Error ? error.message : error)
        }
      })
      offDisposed = host.on('session/disposed', (session) => {
        try {
          bridge.handleSessionDisposed(session)
        } catch {
          /* 忽略:销毁兜底失败不影响宿主 */
        }
      })
      // 订阅 tools/result registry 事件:在 agent loop 追加 session 事件之前触发,
      // 从 result.value 计算 presentationMeta(DSH 核心对 agent 派发调用跳过此计算)
      offToolsResult = host.on('tools/result', (exec: { callId?: unknown; name?: unknown }, result: { value?: unknown }) => {
        try {
          const callId = strOf(exec?.callId)
          const name = strOf(exec?.name)
          if (!callId || !TRACE_TOOLS.has(name)) return
          const meta = computeToolMeta(name, result?.value)
          if (meta) toolsMetaCache.set(callId, meta)
        } catch { /* 防御:metadata 计算失败不阻断主链路 */ }
      })
    } catch (error) {
      console.warn('[aquasense-trace] 会话事件桥接启动失败:', error instanceof Error ? error.message : error)
      return () => {}
    }

    console.log('[aquasense-trace] 会话事件桥接已启动(方式B): 订阅 session/event + tools/result, 目标工具 aquasense_analyze/advice/ledger')
    return () => {
      offEvent?.()
      offDisposed?.()
      offToolsResult?.()
    }
  }, 'aquasense-trace-bridge')
}
