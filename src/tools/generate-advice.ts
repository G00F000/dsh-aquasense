/**
 * 处置建议工具(aquasense_advice,场景 S2/S4/S5/S8 巡检诊断后调用)
 *
 * 自动查询 IMA 知识库获取疾病诊疗参考,按严重程度分级生成处置建议。
 * 容错原则:知识库不可用不阻断主流程,降级为内置通用建议模板。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { searchKnowledge, type SearchResult, type KnowledgeItem } from '../ima/ima-api.js'

interface AnalysisInput {
  abnormal?: boolean
  cls?: string
  symptoms?: string[]
  severity?: string
}

export const generateAdvice = defineTool({
  name: 'aquasense_advice',
  description: '基于分析结果和知识库,生成处置建议。自动查询 IMA 知识库获取疾病诊疗方案。',
  parameters: {
    analysis: { type: 'object', additionalProperties: true, required: true, description: 'aquasense_analyze 的图片分析结果(abnormal/cls/symptoms/severity/confidence)' }
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        diagnosis_summary: { type: 'string' },
        immediate_actions: { type: 'array', items: { type: 'string' } },
        follow_up_actions: { type: 'array', items: { type: 'string' } },
        medication: { type: 'string' },
        alert_level: { type: 'string', enum: ['P0', 'P1', 'P2'] },
        knowledge_refs: { type: 'array', items: { type: 'string' }, description: '知识库参考来源' }
      }
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  },
  async execute(args) {
    const analysis = args.analysis as AnalysisInput

    // ========== 步骤 1:自动查询 IMA 知识库 ==========
    let knowledge: Awaited<ReturnType<typeof searchKnowledge>> | null = null
    let knowledgeRefs: string[] = []

    try {
      // 根据症状构建搜索关键词(IMA 是关键词匹配非语义检索,多词拼接会 0 命中)
      const query = buildKnowledgeQuery(analysis)
      console.log(`[aquasense] 查询知识库:${query}`)

      // 逐关键词查询再合并去重(解决多词空格拼接 0 命中的问题)
      knowledge = await searchKnowledgeMerged(query)

      if (knowledge.items.length > 0) {
        knowledgeRefs = knowledge.items.map((item) => `《${item.title}》${item.source ? `- ${item.source}` : ''}`)
        console.log(`[aquasense] 找到 ${knowledge.items.length} 条相关知识`)
      }
    } catch (error) {
      // 查询失败不影响主流程,继续生成建议
      console.error('[aquasense] 知识库查询失败:', error)
    }

    // ========== 步骤 2:根据严重程度生成建议 ==========
    const immediateActions: string[] = []
    const followUpActions: string[] = []
    const severity = analysis.severity || 'low'

    switch (severity) {
      case 'critical':
        immediateActions.push('🚨 立即通知负责人')
        immediateActions.push('隔离病鱼')
        immediateActions.push('紧急检测水质指标')
        break
      case 'high':
        immediateActions.push('加强巡塘至每日 3 次')
        immediateActions.push('检测溶氧、氨氮')
        immediateActions.push('减料 50%')
        break
      case 'medium':
        immediateActions.push('减料 50%')
        immediateActions.push('密切观察 24 小时')
        break
      default:
        immediateActions.push('保持观察')
    }

    followUpActions.push('持续观察 48 小时')
    followUpActions.push('记录水质变化')

    // ========== 步骤 3:用药建议(知识库仅作参考,具体处方须兽医确认) ==========
    let medication = '暂不需要用药'

    if (analysis.cls === 'disease') {
      // 知识库命中时给出参考标题,便于人工核对;不代替兽医处方
      const hits = knowledge?.items ?? []
      if (hits.length > 0) {
        const first = hits[0]
        const summary = first.summary ? `;摘要:${first.summary.slice(0, 120)}` : ''
        medication = `建议咨询专业兽医,获取针对性用药方案(知识库参考:《${first.title}》${summary})`
      } else {
        medication = '建议咨询专业兽医,获取针对性用药方案'
      }
    }

    // ========== 步骤 4:确定预警级别(P0/P1/P2,与飞书告警方案一致) ==========
    let alertLevel: 'P0' | 'P1' | 'P2' = 'P2'
    if (analysis.cls === 'disease' && severity === 'critical') alertLevel = 'P0'
    else if (analysis.cls === 'disease' || severity === 'high') alertLevel = 'P1'

    const symptoms = analysis.symptoms?.length ? analysis.symptoms.join('、') : '无明显症状'

    return {
      diagnosis_summary: `状态:${analysis.cls || 'unknown'},症状:${symptoms}`,
      immediate_actions: immediateActions,
      follow_up_actions: followUpActions,
      medication,
      alert_level: alertLevel,
      knowledge_refs: knowledgeRefs
    }
  }
})

/**
 * 根据分析结果构建知识库查询关键词
 */
function buildKnowledgeQuery(analysis: AnalysisInput): string {
  const keywords: string[] = []

  // 症状关键词
  if (analysis.symptoms?.length) {
    keywords.push(...analysis.symptoms)
  }

  // 疾病类别关键词
  if (analysis.cls === 'disease') {
    keywords.push('疾病', '治疗')
  } else if (analysis.cls === 'early') {
    keywords.push('前兆', '预防')
  }

  // 鱼类品种(默认鲈鱼)
  keywords.push('鲈鱼')

  return keywords.join(' ')
}

/**
 * 合并多关键词查询结果(IMA 是关键词匹配,多词空格拼接会 0 命中)
 * 策略:逐词查询 → 按命中数排序 → 合并去重取前 5 条
 */
async function searchKnowledgeMerged(rawQuery: string): Promise<SearchResult> {
  // 拆分原始查询为独立关键词,过滤空串和低价值词
  const lowValueWords = new Set(['的', '了', '和', '是', '在', '有', '把', '被'])
  const keywords = rawQuery
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 1 && !lowValueWords.has(w))

  // 去重
  const uniqueKeywords = [...new Set(keywords)]

  // 如果只有 1 个词,直接查
  if (uniqueKeywords.length <= 1) {
    return searchKnowledge(uniqueKeywords[0] || rawQuery)
  }

  // 逐词查询,收集所有结果
  const allItems: Map<string, { item: KnowledgeItem; hits: number }> = new Map()

  for (const kw of uniqueKeywords) {
    try {
      const result = await searchKnowledge(kw)
      for (const item of result.items) {
        const existing = allItems.get(item.media_id)
        if (existing) {
          existing.hits++
        } else {
          allItems.set(item.media_id, { item, hits: 1 })
        }
      }
    } catch {
      // 单个词查询失败不影响整体
    }
  }

  // 按命中关键词数降序排序,取前 5 条
  const sorted = [...allItems.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5)
    .map((entry) => entry.item)

  return { items: sorted, total: sorted.length }
}
