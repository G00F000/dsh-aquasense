/**
 * aquasense_analyze 工具单元测试
 *
 * 测试重点:
 *  - base64 图片数据入参(image_data/image_data_list)
 *  - HTTP URL 入参(image_url/image_urls)回退
 *  - 参数校验与错误处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

// mock fetch 以避免真实网络调用
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// mock DEEPSEEK_API_KEY
process.env.DEEPSEEK_API_KEY = 'test-api-key'
process.env.DEEPSEEK_VISION_MODEL = 'deepseek-flash'

// mock attachment store
const mockReadImage = vi.fn()
vi.mock('./attachment-store.js', () => ({
  resolveAttachments: vi.fn(async (refs: unknown[]) => {
    if (!refs || !Array.isArray(refs) || refs.length === 0) return []
    return refs.map(() => ({ data: 'attBase64Data', mimeType: 'image/jpeg' }))
  }),
  getAttachmentStore: vi.fn(() => ({ readImage: mockReadImage }))
}))

// 导入工具(在 mock 之后)
import { analyzeImage } from './analyze-image.js'

// mock ToolRunContext
const mockExec = { callId: 'test-call-id' } as unknown as ToolRunContext

describe('aquasense_analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('base64 图片数据入参', () => {
    it('应支持 image_data 单张 base64 图片', async () => {
      // mock 视觉模型响应
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                abnormal: false,
                cls: 'normal',
                symptoms: [],
                severity: 'low',
                confidence: 0.9,
                scene_hint: 'inspection'
              })
            }
          }]
        })
      })

      const result = await analyzeImage.execute({
        image_data: 'base64encodedImageData',
        image_mime: 'image/jpeg',
        pool_id: '池1'
      }, mockExec)

      expect(result).toMatchObject({
        abnormal: false,
        cls: 'normal',
        image_count: 1
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('应支持 image_data_list 多张 base64 图片', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                abnormal: true,
                cls: 'early',
                symptoms: ['离群独游'],
                severity: 'medium',
                confidence: 0.8,
                scene_hint: 'inspection'
              })
            }
          }]
        })
      })

      const result = await analyzeImage.execute({
        image_data_list: ['base64img1', 'base64img2', 'base64img3'],
        image_mime: 'image/png',
        pool_id: '池2'
      }, mockExec)

      expect(result).toMatchObject({
        abnormal: true,
        cls: 'early',
        image_count: 3
      })
    })

    it('未指定 image_mime 时应默认使用 image/jpeg', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                abnormal: false,
                cls: 'normal',
                symptoms: [],
                severity: 'low',
                confidence: 0.9,
                scene_hint: 'inspection'
              })
            }
          }]
        })
      })

      await analyzeImage.execute({
        image_data: 'base64data',
        pool_id: '池1'
      }, mockExec)

      // 验证请求体中包含正确的 MIME 类型
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      const imageUrl = requestBody.messages[0].content[0].image_url.url
      expect(imageUrl).toMatch(/^data:image\/jpeg;base64,/)
    })
  })

  describe('HTTP URL 入参回退', () => {
    it('当 image_data 不可用时应回退到 image_url', async () => {
      // mock 图片下载
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'image/jpeg' },
          arrayBuffer: async () => new ArrayBuffer(100)
        })
        // mock 视觉模型响应
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  abnormal: false,
                  cls: 'normal',
                  symptoms: [],
                  severity: 'low',
                  confidence: 0.9,
                  scene_hint: 'inspection'
                })
              }
            }]
          })
        })

      const result = await analyzeImage.execute({
        image_url: 'https://example.com/photo.jpg',
        pool_id: '池1'
      }, mockExec)

      expect(result).toMatchObject({
        abnormal: false,
        cls: 'normal',
        image_count: 1
      })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('当 image_data_list 不可用时应回退到 image_urls', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => new ArrayBuffer(100)
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => new ArrayBuffer(100)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  abnormal: false,
                  cls: 'normal',
                  symptoms: [],
                  severity: 'low',
                  confidence: 0.9,
                  scene_hint: 'inspection'
                })
              }
            }]
          })
        })

      const result = await analyzeImage.execute({
        image_urls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
        pool_id: '池1'
      }, mockExec) as { image_count?: number }

      expect(result.image_count).toBe(2)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('DSH Attachment 直传入参', () => {
    it('应优先使用 image_attachment 并调用 resolveAttachments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ abnormal: false, cls: 'normal', symptoms: [], severity: 'low', confidence: 0.9, scene_hint: 'inspection' }) } }]
        })
      })

      const result = await analyzeImage.execute({
        image_attachment: [{ attachmentId: 'att-001', mediaType: 'image/jpeg' }],
        pool_id: '池1'
      }, mockExec)

      expect(result).toMatchObject({ abnormal: false, cls: 'normal', image_count: 1 })
      expect(mockFetch).toHaveBeenCalledTimes(1)
      // 验证发送给视觉模型的是 base64 data URL(而非原始 attachmentId)
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      const imageUrl = requestBody.messages[0].content[0].image_url.url
      expect(imageUrl).toMatch(/^data:image\/jpeg;base64,attBase64Data$/)
    })

    it('应支持多张 DSH Attachment', async () => {
      const { resolveAttachments } = await import('./attachment-store.js')
      // 多张图 mock 为返回 3 张
      vi.mocked(resolveAttachments).mockResolvedValueOnce([
        { data: 'b64-1', mimeType: 'image/jpeg' },
        { data: 'b64-2', mimeType: 'image/png' },
        { data: 'b64-3', mimeType: 'image/jpeg' }
      ])

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ abnormal: true, cls: 'disease', symptoms: ['烂鳃'], severity: 'high', confidence: 0.85, scene_hint: 'inspection' }) } }]
        })
      })

      const result = await analyzeImage.execute({
        image_attachment: [
          { attachmentId: 'att-1' },
          { attachmentId: 'att-2' },
          { attachmentId: 'att-3' }
        ],
        pool_id: '池1'
      }, mockExec) as { image_count?: number }

      expect(result.image_count).toBe(3)
    })

    it('attachment 解析失败时应跳过并降级', async () => {
      const { resolveAttachments } = await import('./attachment-store.js')
      // attachment 全部解析失败返回空数组
      vi.mocked(resolveAttachments).mockResolvedValueOnce([])

      const result = await analyzeImage.execute({
        image_attachment: [{ attachmentId: 'att-fail' }],
        pool_id: '池1'
      }, mockExec)

      expect(result).toMatchObject({
        cls: 'unknown',
        image_count: 0
      })
    })
  })

  describe('错误处理', () => {
    it('未提供任何图片时应返回降级结果', async () => {
      const result = await analyzeImage.execute({ pool_id: '池1' }, mockExec)

      expect(result).toMatchObject({
        abnormal: false,
        cls: 'unknown',
        symptoms: ['全部图片下载失败,无法分析,请重发图片'],
        severity: 'low',
        confidence: 0.3,
        scene_hint: 'inspection',
        image_count: 0
      })
    })

    it('非 HTTP URL 应返回降级结果', async () => {
      const result = await analyzeImage.execute(
        { image_url: 'ftp://example.com/photo.jpg', pool_id: '池1' },
        mockExec
      )

      expect(result).toMatchObject({
        abnormal: false,
        cls: 'unknown',
        symptoms: ['全部图片下载失败,无法分析,请重发图片'],
        severity: 'low',
        confidence: 0.3,
        scene_hint: 'inspection',
        image_count: 0
      })
    })
  })

  describe('lossless JSON 兼容(不含 undefined 字段)', () => {
    it('降级路径:未传 expected_image_count 时返回值不应含该键', async () => {
      const result = await analyzeImage.execute({ pool_id: '池1' }, mockExec) as Record<string, unknown>

      // undefined 字段必须"省略键"而非"赋 undefined",否则 DSH lossless JSON 校验失败
      expect('expected_image_count' in result).toBe(false)
      // 所有 enumerable own property 的值都不是 undefined
      expect(Object.values(result).every((v) => v !== undefined)).toBe(true)
    })

    it('成功路径:未传 expected_image_count 时返回值不应含该键', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ abnormal: false, cls: 'normal', symptoms: [], severity: 'low', confidence: 0.9, scene_hint: 'inspection' }) } }]
        })
      })

      const result = await analyzeImage.execute({
        image_data: 'base64data',
        image_mime: 'image/jpeg',
        pool_id: '池1'
      }, mockExec) as Record<string, unknown>

      expect('expected_image_count' in result).toBe(false)
      expect(Object.values(result).every((v) => v !== undefined)).toBe(true)
    })

    it('传入 expected_image_count 时应正常写入该字段', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ abnormal: false, cls: 'normal', symptoms: [], severity: 'low', confidence: 0.9, scene_hint: 'inspection' }) } }]
        })
      })

      const result = await analyzeImage.execute({
        image_data: 'base64data',
        image_mime: 'image/jpeg',
        expected_image_count: 1,
        pool_id: '池1'
      }, mockExec) as Record<string, unknown>

      expect(result.expected_image_count).toBe(1)
      expect(Object.values(result).every((v) => v !== undefined)).toBe(true)
    })

    it('返回值可被 JSON 无损序列化(不含 undefined)', async () => {
      const result = await analyzeImage.execute({ pool_id: '池1' }, mockExec) as Record<string, unknown>
      // lossless JSON 拒绝 undefined;JSON.stringify 会静默丢弃 undefined 键,
      // 因此对比"键集合"是否一致来间接验证不含 undefined
      const roundTripped = JSON.parse(JSON.stringify(result)) as Record<string, unknown>
      expect(Object.keys(roundTripped).sort()).toEqual(Object.keys(result).sort())
    })
  })
})
