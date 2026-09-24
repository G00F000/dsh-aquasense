/**
 * attachment-inject wrapper 单元测试
 *
 * 核心回归:@deepseek-ai/dsh-tools 在触发 tools/pre-execute 之前已对 exec.arguments
 * 做 deepFreeze,ESM 严格模式下改写冻结对象会抛 TypeError。本测试构造被 Object.freeze
 * (模拟 deepFreeze)的 args,验证 withAttachmentInject 包装的 execute:
 *  1. 传给原始工具的是**新对象**(非冻结原对象),且含注入字段
 *  2. 原始冻结 args **未被修改**(不会触发 TypeError)
 *  3. 仅在目标字段为空时注入,不覆盖 Agent 已显式传入的值
 *  4. 无图片 / 无 agent 时安全降级为浅拷贝,不抛异常
 */

import { describe, it, expect } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { withAttachmentInject, mergeAttachmentsFromSession, extractAttachmentsFromSession } from './attachment-inject.js'

/** 构造一个含单张 ImageBlock 的会话 Agent(模拟飞书图片进入上下文) */
function makeAgentWithImage(attachmentId = 'att-1') {
  return {
    session: {
      deriveMessages: () => [
        { role: 'system', content: [{ type: 'text', text: 'sys' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: '看看这条鱼' },
            {
              type: 'image',
              attachment: { attachmentId, mediaType: 'image/jpeg', bytes: 1234, width: 800, height: 600, name: 'fish.jpg' }
            }
          ]
        }
      ]
    }
  }
}

/** 构造一个只记录收到 args 的假工具 */
function makeSpyTool() {
  const received: { args: unknown } = { args: undefined }
  const tool = {
    name: 'aquasense_analyze',
    async execute(args: unknown) {
      received.args = args
      return { cls: 'normal' }
    }
  } as unknown as ToolDefinition
  return { tool, received }
}

describe('extractAttachmentsFromSession', () => {
  it('从最近一条 user 消息提取 ImageBlock 的 attachment', () => {
    const refs = extractAttachmentsFromSession(makeAgentWithImage('att-xyz'))
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ attachmentId: 'att-xyz', mediaType: 'image/jpeg', name: 'fish.jpg' })
  })

  it('agent/session 缺失时返回空数组,不抛异常', () => {
    expect(extractAttachmentsFromSession(undefined)).toEqual([])
    expect(extractAttachmentsFromSession(null)).toEqual([])
    expect(extractAttachmentsFromSession({})).toEqual([])
  })
})

describe('mergeAttachmentsFromSession (纯函数)', () => {
  it('对冻结 args 返回新对象且含注入字段,原对象未被修改', () => {
    const frozen = Object.freeze({ pool_id: '池1' }) as Record<string, unknown>
    const merged = mergeAttachmentsFromSession(frozen, makeAgentWithImage('att-9'), 'image_attachment')

    // 新对象,不是原引用
    expect(merged).not.toBe(frozen)
    // 注入字段存在
    expect(Array.isArray(merged.image_attachment)).toBe(true)
    expect((merged.image_attachment as unknown[])[0]).toMatchObject({ attachmentId: 'att-9' })
    // 同时注入 expected_image_count
    expect(merged.expected_image_count).toBe(1)
    // 保留原始字段
    expect(merged.pool_id).toBe('池1')
    // 原冻结对象未被修改(关键回归:不会触发 TypeError)
    expect(Object.keys(frozen)).toEqual(['pool_id'])
    expect(frozen.image_attachment).toBeUndefined()
  })

  it('Agent 已显式传入目标字段时不覆盖', () => {
    const frozen = Object.freeze({ image_attachments: [{ attachmentId: 'explicit' }] }) as Record<string, unknown>
    const merged = mergeAttachmentsFromSession(frozen, makeAgentWithImage('att-session'), 'image_attachments')
    expect(merged.image_attachments).toEqual([{ attachmentId: 'explicit' }])
    expect(merged).not.toBe(frozen)
  })

  it('会话无图片时返回浅拷贝,不注入', () => {
    const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } }
    const frozen = Object.freeze({ pool_id: '池2' }) as Record<string, unknown>
    const merged = mergeAttachmentsFromSession(frozen, agent, 'image_attachment')
    expect(merged).not.toBe(frozen)
    expect(merged.image_attachment).toBeUndefined()
    expect(merged.pool_id).toBe('池2')
  })

  it('无 agent 时安全降级为浅拷贝', () => {
    const frozen = Object.freeze({ pool_id: '池3' }) as Record<string, unknown>
    const merged = mergeAttachmentsFromSession(frozen, undefined, 'image_attachment')
    expect(merged).not.toBe(frozen)
    expect(merged.image_attachment).toBeUndefined()
  })
})

describe('withAttachmentInject (wrapper)', () => {
  it('冻结 args 下,原始工具收到的是含注入字段的新对象,原 args 未被修改', async () => {
    const { tool, received } = makeSpyTool()
    const wrapped = withAttachmentInject(tool, 'image_attachment')

    // 模拟 dsh-tools deepFreeze:冻结整个 args
    const frozenArgs = Object.freeze({ pool_id: '池1', description: '死鱼' }) as Record<string, unknown>
    const exec = { callId: 'c1', agent: makeAgentWithImage('att-wrap') } as unknown as ToolRunContext

    const result = await wrapped.execute(frozenArgs, exec)

    // 工具正常返回
    expect(result).toMatchObject({ cls: 'normal' })
    // 原始工具收到的是**新对象**,非冻结原对象
    expect(received.args).not.toBe(frozenArgs)
    const gotArgs = received.args as Record<string, unknown>
    expect(Array.isArray(gotArgs.image_attachment)).toBe(true)
    expect((gotArgs.image_attachment as unknown[])[0]).toMatchObject({ attachmentId: 'att-wrap' })
    expect(gotArgs.expected_image_count).toBe(1)
    // 原始字段透传
    expect(gotArgs.pool_id).toBe('池1')
    expect(gotArgs.description).toBe('死鱼')
    // 关键回归:原冻结 args 未被修改(旧 pre-execute 方案在此会抛 TypeError)
    expect(Object.isFrozen(frozenArgs)).toBe(true)
    expect(frozenArgs.image_attachment).toBeUndefined()
    expect(Object.keys(frozenArgs).sort()).toEqual(['description', 'pool_id'])
  })

  it('透传除 execute 外的工具定义字段(name 等)', () => {
    const { tool } = makeSpyTool()
    const wrapped = withAttachmentInject(tool, 'image_attachment')
    expect(wrapped.name).toBe('aquasense_analyze')
    expect(typeof wrapped.execute).toBe('function')
  })

  it('exec.agent 缺失时不抛异常,原样透传参数浅拷贝', async () => {
    const { tool, received } = makeSpyTool()
    const wrapped = withAttachmentInject(tool, 'image_attachment')
    const exec = { callId: 'c2' } as unknown as ToolRunContext
    await wrapped.execute({ pool_id: '池4' }, exec)
    const gotArgs = received.args as Record<string, unknown>
    expect(gotArgs.pool_id).toBe('池4')
    expect(gotArgs.image_attachment).toBeUndefined()
  })
})
