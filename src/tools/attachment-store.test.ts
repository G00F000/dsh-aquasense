/**
 * attachment-store 单元测试
 *
 * 测试重点:
 *  - setAttachmentStore / getAttachmentStore 生命周期
 *  - resolveAttachments:Attachment → base64 解析(正常/异常/空输入)
 *  - resolveAttachmentBuffers:Attachment → Buffer 解析(台账上传用)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setAttachmentStore, getAttachmentStore, resolveAttachments, resolveAttachmentBuffers } from './attachment-store.js'
import type { AttachmentStore, ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'

/** 构造 mock StoredImageAttachment(模拟 DSH store.readImage 返回) */
function mockStored(ref: Partial<ImageAttachmentRef> = {}): StoredImageAttachment {
  return {
    ref: {
      attachmentId: 'mock-id' as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/jpeg',
      bytes: 100,
      width: 800,
      height: 600,
      ...ref
    },
    data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) // JPEG SOI marker
  }
}

describe('attachment-store', () => {
  let mockStore: { readImage: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    // 重置 store 引用(每个测试前清空)
    setAttachmentStore(undefined)
    mockStore = { readImage: vi.fn() }
  })

  describe('setAttachmentStore / getAttachmentStore', () => {
    it('未注入时 getAttachmentStore 返回 null', () => {
      expect(getAttachmentStore()).toBeNull()
    })

    it('注入后 getAttachmentStore 返回 store', () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      expect(getAttachmentStore()).toBe(mockStore)
    })

    it('注入 undefined 时 store 置为 null', () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      setAttachmentStore(undefined)
      expect(getAttachmentStore()).toBeNull()
    })
  })

  describe('resolveAttachments', () => {
    it('store 未注入时返回空数组', async () => {
      const result = await resolveAttachments([{ attachmentId: 'att-1' }])
      expect(result).toEqual([])
    })

    it('空数组输入返回空数组', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      const result = await resolveAttachments([])
      expect(result).toEqual([])
      expect(mockStore.readImage).not.toHaveBeenCalled()
    })

    it('正常解析单张 Attachment', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      mockStore.readImage.mockResolvedValueOnce(mockStored())

      const result = await resolveAttachments([{ attachmentId: 'att-1', mediaType: 'image/jpeg' }])

      expect(result).toHaveLength(1)
      expect(result[0].mimeType).toBe('image/jpeg')
      expect(typeof result[0].data).toBe('string')
      // base64 编码的 JPEG SOI marker
      expect(result[0].data).toBe(Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'))
      expect(mockStore.readImage).toHaveBeenCalledTimes(1)
    })

    it('正常解析多张 Attachment', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      mockStore.readImage
        .mockResolvedValueOnce(mockStored({ mediaType: 'image/jpeg' }))
        .mockResolvedValueOnce(mockStored({ mediaType: 'image/png' }))

      const result = await resolveAttachments([
        { attachmentId: 'att-1', mediaType: 'image/jpeg' },
        { attachmentId: 'att-2', mediaType: 'image/png' }
      ])

      expect(result).toHaveLength(2)
      expect(result[0].mimeType).toBe('image/jpeg')
      expect(result[1].mimeType).toBe('image/png')
    })

    it('单张解析失败时跳过该张,不阻断其余', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      mockStore.readImage
        .mockRejectedValueOnce(new Error('storage error'))
        .mockResolvedValueOnce(mockStored())

      const result = await resolveAttachments([
        { attachmentId: 'att-fail' },
        { attachmentId: 'att-ok' }
      ])

      expect(result).toHaveLength(1)
      expect(result[0].mimeType).toBe('image/jpeg')
    })

    it('缺少 attachmentId 的条目应跳过', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)

      const result = await resolveAttachments([{ attachmentId: '' }])

      expect(result).toEqual([])
      expect(mockStore.readImage).not.toHaveBeenCalled()
    })

    it('mediaType 缺失时应默认 image/jpeg', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      mockStore.readImage.mockResolvedValueOnce(mockStored())

      await resolveAttachments([{ attachmentId: 'att-1' }])

      const inputRef = mockStore.readImage.mock.calls[0][0]
      expect(inputRef.mediaType).toBe('image/jpeg')
    })
  })

  describe('resolveAttachmentBuffers', () => {
    it('store 未注入时返回空数组', async () => {
      const result = await resolveAttachmentBuffers([{ attachmentId: 'att-1' }])
      expect(result).toEqual([])
    })

    it('正常解析为 Buffer 格式(台账上传用)', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      mockStore.readImage.mockResolvedValueOnce(mockStored({ mediaType: 'image/png' }))

      const result = await resolveAttachmentBuffers([
        { attachmentId: 'att-1', mediaType: 'image/png', name: 'worker-photo.png' }
      ])

      expect(result).toHaveLength(1)
      expect(result[0].mimeType).toBe('image/png')
      expect(result[0].name).toBe('worker-photo.png')
      expect(result[0].buffer).toBeInstanceOf(Uint8Array)
    })

    it('name 缺失时应自动生成文件名', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      mockStore.readImage.mockResolvedValueOnce(mockStored())

      const result = await resolveAttachmentBuffers([{ attachmentId: 'att-1' }])

      expect(result).toHaveLength(1)
      expect(result[0].name).toMatch(/^att-0-/)
      expect(result[0].name).toMatch(/\.jpg$/)
    })

    it('解析失败时跳过并返回空数组', async () => {
      setAttachmentStore(mockStore as unknown as AttachmentStore)
      mockStore.readImage.mockRejectedValueOnce(new Error('corrupted'))

      const result = await resolveAttachmentBuffers([{ attachmentId: 'att-fail' }])

      expect(result).toEqual([])
    })
  })
})
