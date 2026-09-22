/**
 * 群聊台账包装器后置收集(trace-ledger-wrap)单元测试
 *
 * 测试重点:
 *  - span_retrieve 合成:结构化 retrieve_excerpts 透传 → 全量 span(query/三通道计数/摘录)
 *  - 降级反解:仅 knowledge_excerpt 字符串 → 反解摘录(无通道计数,不臆造 0)
 *  - span_advice.knowledge_excerpt 原文引用保留(修复埋点丢弃原文)
 *  - parseExcerpts 逐条容错
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { recordChatTrace, parseExcerpts } from './trace-ledger-wrap.js'
import { readIndex, readReport } from './trace-store.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aquasense-wrap-'))
  process.env.AQUASENSE_CACHE_DIR = tmpDir
})

afterEach(async () => {
  delete process.env.AQUASENSE_CACHE_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** 构造台账工具 args(群聊 Agent 透传形态;images/open_id 置空避开网络) */
function ledgerArgs(advice: Record<string, unknown>): Record<string, unknown> {
  return {
    scene: 'inspection',
    pool_id: '池1',
    open_id: '',
    images: [],
    analysis: { cls: 'disease', symptoms: ['烂鳃'], severity: 'high', confidence: 0.9 },
    advice
  }
}

const RESULT = { success: true, message: '台账已写入', record_id: 'rec-1' }

/** 执行后置收集并读取落盘记录 */
async function traceOnce(advice: Record<string, unknown>) {
  await recordChatTrace(ledgerArgs(advice), RESULT, 120)
  const index = await readIndex()
  const id = index.records[0]?.id
  expect(id).toBeDefined()
  return readReport(id as string)
}

describe('recordChatTrace span_retrieve 合成', () => {
  it('结构化透传:query/三通道计数/摘录写入 span_retrieve,原文引用保留在 span_advice', async () => {
    const record = await traceOnce({
      diagnosis_summary: '状态:disease',
      alert_level: 'P1',
      knowledge_refs: ['《大口黑鲈.pdf》'],
      knowledge_excerpt: ['《大口黑鲈.pdf》第126页:「原文一」'],
      reasoning: '推理说明',
      query: '烂鳃 疾病 治疗 鲈鱼',
      channel_a_wiki: 0,
      channel_b_note: 0,
      channel_c_pdf: 3,
      merged_count: 3,
      retrieve_excerpts: [
        { title: '大口黑鲈.pdf', text: '原文一', from: 'pdf_content', locator: '第126页' }
      ]
    })
    expect(record?.span_retrieve).toMatchObject({
      query: '烂鳃 疾病 治疗 鲈鱼',
      channel_a_wiki: 0,
      channel_b_note: 0,
      channel_c_pdf: 3,
      merged_count: 3
    })
    expect(record?.span_retrieve?.excerpts).toEqual([
      { title: '大口黑鲈.pdf', from: 'pdf_content', locator: '第126页', excerpt_preview: '原文一' }
    ])
    expect(record?.span_advice?.knowledge_excerpt).toEqual(['《大口黑鲈.pdf》第126页:「原文一」'])
  })

  it('降级反解:仅 knowledge_excerpt 字符串 → 摘录反解,通道计数缺省不写', async () => {
    const record = await traceOnce({
      diagnosis_summary: '状态:disease',
      alert_level: 'P1',
      knowledge_refs: ['《A》', '《B》'],
      knowledge_excerpt: ['《A》第3页:「原文一」', '《B》:「原文二」'],
      reasoning: '推理说明'
    })
    expect(record?.span_retrieve).toBeDefined()
    expect(record?.span_retrieve?.query).toBe('')
    expect(record?.span_retrieve?.channel_c_pdf).toBeUndefined()
    expect(record?.span_retrieve?.excerpts).toEqual([
      { title: 'A', locator: '第3页', excerpt_preview: '原文一' },
      { title: 'B', excerpt_preview: '原文二' }
    ])
    expect(record?.span_advice?.knowledge_excerpt).toHaveLength(2)
  })

  it('无任何检索数据时不写 span_retrieve,也不写空原文引用', async () => {
    const record = await traceOnce({
      diagnosis_summary: '状态:normal',
      alert_level: 'P2',
      knowledge_refs: [],
      knowledge_excerpt: [],
      reasoning: '通用模板'
    })
    expect(record?.span_retrieve).toBeUndefined()
    expect(record?.span_advice?.knowledge_excerpt).toBeUndefined()
  })
})

describe('parseExcerpts', () => {
  it('解析《标题》[定位]:「原文」格式;畸形/空条目逐条跳过', () => {
    expect(parseExcerpts([
      '《A》第3页:「原文一」',
      '《B》:「原文二」',
      '畸形条目',
      '《》:「」'
    ])).toEqual([
      { title: 'A', locator: '第3页', excerpt_preview: '原文一' },
      { title: 'B', excerpt_preview: '原文二' }
    ])
  })
})
