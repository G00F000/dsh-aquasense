/**
 * generate-advice 检索元数据输出单元测试
 *
 * 测试重点:
 *  - buildAdviceToolOutput:工具产出合并检索元数据(query/三通道计数/结构化摘录)
 *  - countChannel:合并结果按 item.from 归属计数(与 R8 span_retrieve 语义一致)
 *  - 知识库查询失败(knowledge=null)不阻断产出,通道计数为 0
 */

import { describe, it, expect } from 'vitest'
import { countChannel, type SearchResult, type KnowledgeItem } from '../ima/ima-api.js'
import { buildAdviceToolOutput, type AdviceResult, type Excerpt, type KnowledgeRetrieval } from './generate-advice.js'

function item(from: KnowledgeItem['from'], title: string): KnowledgeItem {
  return { media_id: `id-${title}`, title, from }
}

const BASE_ADVICE: AdviceResult = {
  diagnosis_summary: '状态:disease,症状:烂鳃',
  immediate_actions: ['隔离病鱼'],
  follow_up_actions: ['持续观察 48 小时'],
  medication: '建议咨询专业兽医',
  alert_level: 'P1',
  knowledge_refs: ['《A》', '《B》'],
  knowledge_excerpt: ['《A》第3页:「原文一」'],
  reasoning: '推理说明'
}

describe('countChannel', () => {
  it('按 item.from 归属统计三通道命中数', () => {
    const knowledge: SearchResult = {
      items: [item('wiki', 'W'), item('pdf_content', 'P1'), item('pdf_content', 'P2'), item('note', 'N')],
      total: 4
    }
    expect(countChannel(knowledge, 'wiki')).toBe(1)
    expect(countChannel(knowledge, 'note')).toBe(1)
    expect(countChannel(knowledge, 'pdf_content')).toBe(2)
    expect(countChannel(null, 'wiki')).toBe(0)
  })
})

describe('buildAdviceToolOutput', () => {
  it('合并检索元数据:query/三通道计数/merged_count/结构化摘录,建议字段原样保留', () => {
    const excerpts: Excerpt[] = [
      { title: '大口黑鲈.pdf', text: '原文一', from: 'pdf_content', locator: '第126页' },
      { title: '图谱.pdf', text: '原文二', from: 'pdf_content' }
    ]
    const retrieval: KnowledgeRetrieval = {
      query: '烂鳃 疾病 治疗 鲈鱼',
      knowledge: {
        items: [item('pdf_content', '大口黑鲈.pdf'), item('pdf_content', '图谱.pdf'), item('wiki', 'W')],
        total: 3
      },
      excerpts
    }
    const out = buildAdviceToolOutput(retrieval, BASE_ADVICE)
    expect(out.query).toBe('烂鳃 疾病 治疗 鲈鱼')
    expect(out.channel_a_wiki).toBe(1)
    expect(out.channel_b_note).toBe(0)
    expect(out.channel_c_pdf).toBe(2)
    expect(out.merged_count).toBe(3)
    expect(out.retrieve_excerpts).toEqual(excerpts)
    expect(out.knowledge_refs).toEqual(BASE_ADVICE.knowledge_refs)
    expect(out.diagnosis_summary).toBe(BASE_ADVICE.diagnosis_summary)
  })

  it('知识库查询失败(knowledge=null)时通道计数为 0,不阻断产出', () => {
    const retrieval: KnowledgeRetrieval = { query: '', knowledge: null, excerpts: [] }
    const out = buildAdviceToolOutput(retrieval, BASE_ADVICE)
    expect(out.channel_a_wiki).toBe(0)
    expect(out.channel_b_note).toBe(0)
    expect(out.channel_c_pdf).toBe(0)
    expect(out.merged_count).toBe(0)
    expect(out.retrieve_excerpts).toEqual([])
  })

  it('摘录可选字段(locator/from)为 undefined 时从产出省略键(避免 DSH 非 lossless JSON 报错)', () => {
    const retrieval: KnowledgeRetrieval = {
      query: '烂鳃',
      knowledge: { items: [], total: 0 },
      // wiki 命中无 locator、无页码 PDF 命中 locator 为 undefined,构造时不得残留 undefined 键
      excerpts: [{ title: '图谱.pdf', text: '原文二', from: 'pdf_content', locator: undefined }]
    }
    const out = buildAdviceToolOutput(retrieval, BASE_ADVICE)
    expect(Object.keys(out.retrieve_excerpts[0])).toEqual(['title', 'text', 'from'])
  })
})
