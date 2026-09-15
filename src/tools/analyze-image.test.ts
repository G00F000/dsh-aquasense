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

  describe('错误处理', () => {
    it('未提供任何图片时应返回降级结果', async () => {
      const result = await analyzeImage.execute({ pool_id: '池1' }, mockExec)

      expect(result).toMatchObject({
        abnormal: false,
        cls: 'unknown',
        symptoms: ['图片下载失败,请重发图片'],
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
        symptoms: ['图片下载失败,请重发图片'],
        severity: 'low',
        confidence: 0.3,
        scene_hint: 'inspection',
        image_count: 0
      })
    })
  })
})
