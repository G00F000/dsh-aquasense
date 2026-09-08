#!/usr/bin/env node
/**
 * 每日任务提醒调度器(场景 S9,独立于 DSH 的定时进程)
 *
 * 读取 IMA 知识库《每日操作手册》,按任务时间点向巡检群主动推送提醒。
 * 不注册为 DSH Tool(Tool 只能被 Agent 按需调用,无法主动定时触发),与 DSH 并行运行。
 *
 * 启动方式:
 *   npm run remind        # 开发:npx tsx src/scheduler/daily-reminder.ts
 *   npm run remind:prod   # 发布:node dist/scheduler/daily-reminder.js
 *
 * 行为约定(与轻量化模块设计文档一致):
 *  - 每日 07:00 推送当日任务总览(当日仅一次,磁盘标记防重启重复)
 *  - 每分钟 tick,当前 HH:MM 与任务时间相等且未推过 → 推送单条提醒
 *  - 重启不补推已过时间点的任务;手册缺失 → 群内提醒维护人,当日跳过
 *  - 手册按「日」粒度缓存,当日编辑次日生效
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getFeishuToken } from '../feishu/token.js'
import { searchKnowledge, getMediaContent } from '../ima/ima-api.js'

// ========== 数据结构 ==========

interface TaskItem {
  time: string // "HH:MM"
  task: string
}

interface DailyManual {
  date: string
  tasks: TaskItem[]
}

const TICK_MS = 60_000
const OVERVIEW_TIME = '07:00'

function cacheDir(): string {
  const dir = process.env.AQUASENSE_CACHE_DIR || './cache'
  mkdirSync(dir, { recursive: true })
  return dir
}

function cacheFile(name: string): string {
  return join(cacheDir(), name)
}

/** 当日标记写入(总览/手册缺失均按日去重) */
function markDay(prefix: string, date: string): void {
  writeFileSync(cacheFile(`${prefix}-${date}.mark`), Date.now().toString(), 'utf8')
}

function isDayMarked(prefix: string, date: string): boolean {
  return existsSync(cacheFile(`${prefix}-${date}.mark`))
}

// ========== 1. 读取并解析操作手册 ==========

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 手册按日缓存:当日已缓存直接返回,否则读知识库并落缓存 */
async function loadTodayManual(): Promise<DailyManual | null> {
  const date = today()
  const cachedPath = cacheFile(`manual-${date}.json`)
  if (existsSync(cachedPath)) {
    try {
      return JSON.parse(readFileSync(cachedPath, 'utf8')) as DailyManual
    } catch {
      // 缓存损坏则重新拉取
    }
  }

  // ① 搜索命中《每日操作手册》条目
  console.log(`[aquasense-remind] ${date} 搜索知识库《每日操作手册》...`)
  const hit = await searchKnowledge('每日操作手册')
  if (!hit.items.length) return null

  // ② 获取条目正文并逐行解析 "HH:MM 任务"
  const content = await getMediaContent(hit.items[0].media_id)
  const tasks: TaskItem[] = []
  let skipped = 0
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(\d{1,2}[:：]\d{2})\s*(.+)$/)
    if (m) {
      tasks.push({ time: normalizeTime(m[1]), task: m[2] })
    } else {
      // 解析失败的行:记录跳过数(设计上可接 LLM 兜底,当前降级为跳过并可见)
      skipped++
    }
  }
  if (skipped > 0) {
    console.warn(`[aquasense-remind] ${skipped} 行无法解析已跳过(手册需按 "HH:MM 任务" 每行一条)`)
  }

  const manual: DailyManual = { date, tasks: tasks.sort((a, b) => a.time.localeCompare(b.time)) }
  // ③ 写缓存,当日生效(当日编辑次日生效,避免中途改动引发重复推送)
  writeFileSync(cachedPath, JSON.stringify(manual, null, 2), 'utf8')
  return manual
}

/** 时间归一:"8:30"/"08：30" → "08:30" */
function normalizeTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})[:：](\d{2})$/)
  if (!m) return raw.trim()
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return raw.trim()
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function currentHHMM(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

// ========== 2. 推送提醒(复用飞书凭证,同 record-ledger) ==========

async function pushText(text: string): Promise<void> {
  const chatId = process.env.FEISHU_WORKER_GROUP
  if (!chatId) {
    throw new Error('[aquasense-remind] FEISHU_WORKER_GROUP 未配置(巡检群 chat_id)')
  }
  const token = await getFeishuToken()
  const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text })
    })
  })
  const result = (await response.json()) as { code: number; msg?: string }
  if (result.code !== 0) {
    throw new Error(`飞书消息推送失败:${result.msg}`)
  }
}

/** 推送失败重试一次,仍失败仅记录(不影响后续任务) */
async function pushWithRetry(text: string, label: string): Promise<void> {
  try {
    await pushText(text)
    console.log(`[aquasense-remind] 已推送:${label}`)
  } catch (error) {
    console.error(`[aquasense-remind] 推送失败(${label}),30s 后重试:`, error)
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    try {
      await pushText(text)
      console.log(`[aquasense-remind] 重试成功:${label}`)
    } catch (retryError) {
      console.error(`[aquasense-remind] 重试仍失败(${label}):`, retryError)
    }
  }
}

/** 到点任务卡片:任务 + 今日剩余(最多 3 条) */
function buildTaskCard(task: TaskItem, remaining: string[]): string {
  const lines = [`⏰ ${task.time} 任务提醒`, `📋 ${task.task}`]
  if (remaining.length > 0) {
    lines.push(`💡 今日剩余:${remaining.join('、')}`)
  }
  lines.push('✅ 完成后按平时格式发消息汇报(如「池3水质:溶氧5.2 氨氮0.1 pH7.4」)')
  return lines.join('\n')
}

function pushReminder(task: TaskItem, remaining: string[]): Promise<void> {
  return pushWithRetry(buildTaskCard(task, remaining), `${task.time} ${task.task.slice(0, 20)}`)
}

/** 07:00 晨间总览 */
function pushDailyOverview(manual: DailyManual): Promise<void> {
  const lines = [`📅 ${manual.date} 今日任务总览(${manual.tasks.length} 项)`]
  for (const t of manual.tasks) {
    lines.push(`${t.time} ${t.task}`)
  }
  return pushWithRetry(lines.join('\n'), '晨间总览')
}

/** 手册缺失:提醒维护人到 IMA 知识库更新 */
function pushMissingManualAlert(): Promise<void> {
  const text = '⚠️ 《每日操作手册》未找到,请到 IMA 知识库更新(标题需含「每日操作手册」,每行 "HH:MM 任务"),今日任务提醒已跳过。'
  return pushWithRetry(text, '手册缺失提醒')
}

// ========== 3. 主循环:每分钟 tick,到点推送 ==========

async function main(): Promise<void> {
  const date = today()
  const manual = await loadTodayManual()

  if (!manual) {
    // 手册缺失:当日仅提醒一次,跳过本日
    if (!isDayMarked('missing', date)) {
      markDay('missing', date)
      await pushMissingManualAlert()
    }
    return
  }

  if (manual.tasks.length === 0) {
    console.warn('[aquasense-remind] 手册解析结果为空,今日跳过(请检查手册格式)')
    return
  }

  // 已推送任务(进程内去重,防止同一分钟 tick 重复推送)
  const pushed = new Set<string>()
  const now = currentHHMM()

  // 启动时若已过 07:00 且当日未推过总览 → 补推一次(重启场景),否则等 07:00 由 tick 触发
  if (now >= OVERVIEW_TIME && !isDayMarked('overview', date)) {
    markDay('overview', date)
    await pushDailyOverview(manual)
  }

  console.log(`[aquasense-remind] ${date} 调度启动,今日任务 ${manual.tasks.length} 项,当前 ${now}(总览在 ${OVERVIEW_TIME} 推送)`)

  setInterval(async () => {
    const current = currentHHMM()

    // 晨间总览(当日未推过时才推)
    if (current === OVERVIEW_TIME && !isDayMarked('overview', date)) {
      markDay('overview', date)
      await pushDailyOverview(manual)
    }

    // 到点任务:时间相等且本进程未推过(重启不补推已过时间点)
    for (const t of manual.tasks) {
      if (t.time === current && !pushed.has(t.time)) {
        pushed.add(t.time)
        const remaining = manual.tasks
          .filter((x) => x.time > current)
          .slice(0, 3)
          .map((x) => `${x.time} ${x.task}`)
        await pushReminder(t, remaining)
      }
    }
  }, TICK_MS)
}

main().catch((error) => {
  console.error('[aquasense-remind] 启动失败:', error)
  process.exit(1)
})
