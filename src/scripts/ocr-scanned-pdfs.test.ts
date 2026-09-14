/**
 * OCR 生产端契约测试(scripts/ocr-scanned-pdfs.ts ↔ ima/pdf-content-search.ts)
 *
 * 锁住"生产端产出 → 消费端可用"的完整链路,对应用户实测踩出的四条血泪规则:
 *  - 规则 1(语言包 4.0.0_best_int):4.0.0 包与 tesseract.js-core 7 不兼容,解析结果锁定版本目录;
 *  - 规则 2(逐页 checkpoint 续跑):PDF 内容/页数/lang/psm/scale 任一变化即作废重跑;
 *  - 规则 3(整本跑完才发布):--pages 冒烟即使页齐也必须拒绝发布(防原子覆写回归);
 *  - 规则 4(入库前去字间空格):'白 点 病' 形态直接入库检索命中 0,发布文本须可被消费端直接检索。
 * 另验证 \f 分页 1-based 页码、空白页占位(保块数=页数,引用页码不前移)与待办发现只认 [扫描件 标记。
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  LANG_PACK_DIR,
  buildOcrHeader,
  buildPublishText,
  canPublish,
  checkpointMatches,
  parseOcrArgs,
  readScannedTargets,
  resolveLangPath,
  type OcrCheckpointState,
  type OcrOptions
} from './ocr-scanned-pdfs.js'
import { OCR_MARK, buildPdfIndex, searchPdfContent } from '../ima/pdf-content-search.js'

const TEST_ROOT = './test-ocr-cache'
const TEST_CACHE_DIR = join(TEST_ROOT, 'pdf')
const TEST_INDEX_DIR = join(TEST_ROOT, 'pdf-index')
const TEST_TARGETS_DIR = join(TEST_ROOT, 'scan-targets')

/** 模拟 Tesseract chi_sim 输出:相邻汉字间插空格(即规则 4 的困境:'白 点 病' 匹配不到 '白点病') */
function spread(text: string): string {
  return text.replace(/([\u4e00-\u9fff])(?=[\u4e00-\u9fff])/g, '$1 ')
}

const RAW_PAGE_1 = [
  '第一章 白点病防治',
  '',
  '白点病(小瓜虫病)病原为多子小瓜虫,适宜水温 15-28 度,病鱼体表与鳃部出现白色点状囊泡,游动迟缓并伴有蹭网现象,常用福尔马林药浴处理。'
].join('\n')

const RAW_PAGE_3 = [
  '第三章 水质管理',
  '',
  '氨氮超标是养殖水体最常见的急性风险之一,罗茨风机与增氧设备须保持全天运转,发现超标应立即换水并加大增氧,夜间尤其需要关注凌晨时段的溶氧低谷。'
].join('\n')

/** 生产端视角的三页扫描件:第 2 页为空白页(扫描常见),须占位以保持页码不错位 */
const PAGES_SPACED = [spread(RAW_PAGE_1), '', spread(RAW_PAGE_3)]

const HEADER = buildOcrHeader({
  lang: 'chi_sim',
  psm: '6',
  scale: 4,
  pageCount: 3,
  ocrAt: '2026-09-14T00:00:00.000Z'
})

const PUBLISHED = buildPublishText(PAGES_SPACED, HEADER)

/** 与 parseOcrArgs([]) 一致的基准参数(供 resolveLangPath 用例构造入参) */
function baseOptions(overrides: Partial<OcrOptions> = {}): OcrOptions {
  return {
    limit: Number.POSITIVE_INFINITY,
    only: null,
    smokePages: null,
    scale: 4,
    lang: 'chi_sim',
    langPath: null,
    psm: '6',
    warm: true,
    help: false,
    ...overrides
  }
}

describe('ocr-scanned-pdfs(生产端契约)', () => {
  beforeAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(TEST_CACHE_DIR, { recursive: true })
    mkdirSync(TEST_INDEX_DIR, { recursive: true })
    mkdirSync(TEST_TARGETS_DIR, { recursive: true })
  })

  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('发布文本:共享 OCR_MARK 头 + \\f 分页 + 空白页占位 + 去字间空格', () => {
    // 头标记以消费端常量开头(元信息写在方括号内,归一化时整段剥离,不污染正文)
    expect(PUBLISHED.startsWith(`${OCR_MARK.slice(0, -1)} `)).toBe(true)
    expect(PUBLISHED.split('\n')[0]).toContain('lang=chi_sim psm=6 scale=4 pages=3 ocrAt=')

    // \f 分隔:3 页 = 2 个分页符;空白页写成占位(短于切片下限不产生切片,但保持块数=页数)
    expect(PUBLISHED.match(/\f/g)).toHaveLength(2)
    expect(PUBLISHED).toContain('（本页无文字）')

    // 规则 4:原始识别文本匹配不到,发布文本(入库前归一化)可直接匹配且无汉字间空格
    expect(spread(RAW_PAGE_1)).not.toContain('白点病')
    expect(PUBLISHED).toContain('白点病')
    expect(PUBLISHED).not.toMatch(/[\u4e00-\u9fff] [\u4e00-\u9fff]/)
  })

  it('端到端:发布文本经 buildPdfIndex 后可直接检索,页码 1-based 且空白页不前移', async () => {
    writeFileSync(join(TEST_CACHE_DIR, 'test-ocr-book.txt'), PUBLISHED, 'utf8')
    const meta = await buildPdfIndex(TEST_CACHE_DIR, TEST_INDEX_DIR)

    expect(meta.pdfCount).toBe(1)
    // 3 个 \f 块(含空白页占位)→ 页数 3:空白页不会让第 3 页的引用页码变成第 2 页
    expect(meta.pdfs[0].pageCount).toBe(3)

    const page1Hits = searchPdfContent('白点病 小瓜虫', TEST_INDEX_DIR)
    expect(page1Hits.length).toBeGreaterThan(0)
    expect(page1Hits[0].page).toBe(1)
    expect(page1Hits[0].matchedTerms).toContain('白点病')
    expect(page1Hits[0].text).not.toMatch(/[\u4e00-\u9fff] [\u4e00-\u9fff]/)

    const page3Hits = searchPdfContent('罗茨风机', TEST_INDEX_DIR)
    expect(page3Hits.length).toBeGreaterThan(0)
    expect(page3Hits[0].page).toBe(3)
    expect(page3Hits[0].chapter).toContain('第三章')

    // 消费端归一化后回写缓存:OCR 头被剥离、正文与占位保留(避免重复处理)
    const cached = readFileSync(join(TEST_CACHE_DIR, 'test-ocr-book.txt'), 'utf8')
    expect(cached).not.toContain(OCR_MARK)
    expect(cached).toContain('（本页无文字）')
    expect(cached).toContain('白点病')
  })

  it('规则 3:--pages 冒烟即使页齐也绝不发布(防原子覆写正式缓存回归)', () => {
    // 曾出现的 bug:--pages 2 冒烟跑把 2 页内容原子替换进缓存,插件当整本书用
    expect(canPublish(3, 3, 2)).toBe(false)
    expect(canPublish(3, 2, 2)).toBe(false)
    expect(canPublish(3, 2, null)).toBe(false)
    expect(canPublish(0, 0, null)).toBe(false)
    expect(canPublish(3, 3, null)).toBe(true)
  })

  it('规则 2:checkpoint 与本次输入/参数不一致即作废重跑', () => {
    const state: OcrCheckpointState = {
      mediaId: 'book-1',
      title: '鱼病图鉴',
      sourceBytes: 1024,
      sourceSha256: 'aaa',
      pageCount: 187,
      lang: 'chi_sim',
      psm: '6',
      scale: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      publishedAt: null
    }
    const params = { sourceSha256: 'aaa', pageCount: 187, lang: 'chi_sim', psm: '6', scale: 4 }
    expect(checkpointMatches(state, params)).toBe(true)
    // 续跑前提是输入一致:任一变化都必须重跑,而不是复用旧页(3.3 小时作业的中间产物不得串味)
    expect(checkpointMatches(state, { ...params, sourceSha256: 'bbb' })).toBe(false)
    expect(checkpointMatches(state, { ...params, pageCount: 188 })).toBe(false)
    expect(checkpointMatches(state, { ...params, lang: 'chi_tra' })).toBe(false)
    expect(checkpointMatches(state, { ...params, psm: '3' })).toBe(false)
    expect(checkpointMatches(state, { ...params, scale: 6 })).toBe(false)
    expect(checkpointMatches(null, params)).toBe(false)
  })

  it('待办发现:只认 [扫描件 标记(已 OCR/超限/正文缓存不重复处理)', () => {
    writeFileSync(join(TEST_TARGETS_DIR, 'scanned-1.txt'), '[扫描件 PDF:共 187 页,无文本层,需 OCR 兜底]\n', 'utf8')
    writeFileSync(join(TEST_TARGETS_DIR, 'scanned-2.txt'), '[扫描件 PDF:共 12 页,无文本层,需 OCR 兜底]\n', 'utf8')
    writeFileSync(join(TEST_TARGETS_DIR, 'ocr-done-1.txt'), PUBLISHED, 'utf8')
    writeFileSync(join(TEST_TARGETS_DIR, 'oversize-1.txt'), '[PDF 超限:120.0MB,已跳过解析]', 'utf8')
    writeFileSync(join(TEST_TARGETS_DIR, 'normal-1.txt'), '第一章 正常文本层缓存\n正文内容。', 'utf8')

    const targets = readScannedTargets(TEST_TARGETS_DIR)
    expect(targets.map((target) => target.mediaId)).toEqual(['scanned-1', 'scanned-2'])
    expect(targets[0].markText).toContain('共 187 页')
  })

  it('参数解析:默认值锁定(chi_sim/psm=6/scale=4,完成后自动重建索引)', () => {
    const options = parseOcrArgs([])
    expect(options.lang).toBe('chi_sim')
    expect(options.psm).toBe('6')
    expect(options.scale).toBe(4)
    expect(options.smokePages).toBeNull()
    expect(options.warm).toBe(true)
    expect(options.only).toBeNull()
  })

  it('参数解析:冒烟 --pages、--no-warm、--only 生效,未知参数直接报错', () => {
    const options = parseOcrArgs(['--pages', '2', '--no-warm', '--only=鱼病', '--limit', '1'])
    expect(options.smokePages).toBe(2)
    expect(options.warm).toBe(false)
    expect(options.only).toBe('鱼病')
    expect(options.limit).toBe(1)
    expect(() => parseOcrArgs(['--page', '2'])).toThrow(/未知参数/)
  })

  it('语言包解析:--lang-path > 环境变量 > 本机 npm 包/CDN,路径转绝对(防 CWD 漂移)', () => {
    vi.stubEnv('AQUASENSE_OCR_LANG_PATH', '/data/tessdata-from-env')

    // 显式 --lang-path 优先;相对路径转绝对(启动目录不同也能找到语言包)
    const explicit = resolveLangPath(baseOptions({ langPath: './tessdata' }))
    expect(explicit.value).toBe(resolve('./tessdata'))
    expect(explicit.source).toContain('--lang-path')

    // URL 原样保留(可指向内网静态服务)
    const url = resolveLangPath(baseOptions({ langPath: 'https://intra.example.com/tessdata' }))
    expect(url.value).toBe('https://intra.example.com/tessdata')

    // 环境变量次之
    const fromEnv = resolveLangPath(baseOptions())
    expect(fromEnv.value).toBe('/data/tessdata-from-env')
    expect(fromEnv.source).toContain('AQUASENSE_OCR_LANG_PATH')

    // 未配置时回退自动探测本机 npm 语言包,其次默认 CDN;两者都必须锁定 best_int 版本目录
    vi.stubEnv('AQUASENSE_OCR_LANG_PATH', '')
    const fallback = resolveLangPath(baseOptions())
    expect(fallback.source).toContain(LANG_PACK_DIR)
    if (fallback.value !== null) expect(existsSync(fallback.value)).toBe(true)
  })
})
