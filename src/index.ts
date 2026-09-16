/**
 * dsh-aquasense 插件入口
 *
 * 注册 3 个业务工具(只开发 3 个 Tool 是轻量化方案的核心简化):
 *  - aquasense_analyze   :视觉模型分析养殖照片(鲈鱼三分类)
 *  - aquasense_advice    :内置 IMA 知识库查询,生成分级处置建议
 *  - aquasense_ledger    :写入飞书多维表格台账(S1-S8 落表)
 *
 * 意图路由(intent-router)为纯函数模块,由消息宿主/Agent 技能调用,不注册为 Tool;
 * S9 每日任务提醒由插件内模块 s9-reminder 托管(apply() 启动,见 docs/s9-daily-reminder-architecture.md)。
 * S9 设置页(原型 3)由 web/remind-gateway 提供:settings 配对命名空间 +
 * /aquasense-remind/api 路由(web 面缺失时静默跳过,不影响定时推送)。
 */

import type { Context } from '@deepseek-ai/cordis'
import { analyzeImage } from './tools/analyze-image.js'
import { generateAdvice } from './tools/generate-advice.js'
import { recordLedger } from './tools/record-ledger.js'
import { setupS9Reminder } from './scheduler/s9-reminder.js'
import { installRemindWeb } from './web/remind-gateway.js'

export const name = 'aquasense-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  console.log('[aquasense] 加载水产养殖工具...')

  // 注册 3 个业务工具
  ctx.tools.register(analyzeImage)
  ctx.tools.register(generateAdvice)
  ctx.tools.register(recordLedger)

  // S9 每日任务提醒(插件内调度,enabled=false 时内部直接跳过)
  setupS9Reminder(ctx)

  // S9 设置页(原型 3):settings 配对命名空间 + HTTP API 路由
  installRemindWeb(ctx)

  console.log('[aquasense] 工具加载完成')
  console.log('[aquasense] 知识库查询:generate-advice 内置 IMA API 自动查询')
}
