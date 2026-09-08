/**
 * dsh-aquasense 插件入口
 *
 * 注册 3 个业务工具(只开发 3 个 Tool 是轻量化方案的核心简化):
 *  - aquasense_analyze   :视觉模型分析养殖照片(鲈鱼三分类)
 *  - aquasense_advice    :内置 IMA 知识库查询,生成分级处置建议
 *  - aquasense_ledger    :写入飞书多维表格台账(S1-S8 落表)
 *
 * 意图路由(intent-router)为纯函数模块,由消息宿主/Agent 技能调用,不注册为 Tool;
 * S9 定时提醒由独立的 daily-reminder 调度器进程负责,与本插件并行运行。
 */

import type { Context } from '@deepseek-ai/cordis'
import { analyzeImage } from './tools/analyze-image.js'
import { generateAdvice } from './tools/generate-advice.js'
import { recordLedger } from './tools/record-ledger.js'

export const name = 'aquasense-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  console.log('[aquasense] 加载水产养殖工具...')

  // 注册 3 个业务工具
  ctx.tools.register(analyzeImage)
  ctx.tools.register(generateAdvice)
  ctx.tools.register(recordLedger)

  console.log('[aquasense] 工具加载完成')
  console.log('[aquasense] 知识库查询:generate-advice 内置 IMA API 自动查询')
}
