/**
 * PDF 原文检索模块测试(方案 D 通道 C)
 *
 * 与实现文档 Step 5 的用例对齐,按实测调整三处:
 *  - 有效文本下限 MIN_TEXT_CHARS=100、切片下限 MIN_CHUNK_CHARS=50,测试语料须足量,否则不建索引;
 *  - 无分页符(\f)的文本按段落切块,页码为 null(不臆造);分页符场景另设用例验证 1-based 页码;
 *  - 补充 pdfHitToKnowledgeItem 映射用例(locator 页码回带 + 无分页符不臆造,三通道合并的接入点)。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INDEX_MAX_AGE_MS,
  PDF_INDEX_FORMAT_VERSION,
  buildPdfIndex,
  getPdfIndexMeta,
  isPdfIndexReady,
  pdfHitToKnowledgeItem,
  searchPdfContent
} from './pdf-content-search.js'

const TEST_ROOT = './test-cache'
const TEST_CACHE_DIR = join(TEST_ROOT, 'pdf')
const TEST_INDEX_DIR = join(TEST_ROOT, 'pdf-index')

/** 无分页符语料(模拟 unpdf 合并文本:仅 \n 拼页,无页边界;每个段落均 > 50 字) */
const PDF_1_TEXT = [
  '第一章 鲈鱼养殖概述',
  '',
  '鲈鱼是我国重要的淡水养殖鱼类之一,肉质鲜美、生长速度快、适合集约化养殖,近年来在华东与华南地区发展迅速。鲈鱼养殖需要注意水质管理、饲料投喂和病害防治三个方面,其中水质是影响成活率的关键因素。',
  '',
  '第二章 常见病害',
  '',
  '白点病(小瓜虫病)病原为多子小瓜虫,适宜水温 15-28 度,病鱼体表与鳃部出现白色点状囊泡,游动迟缓并伴有蹭网现象。',
  '治疗方案:福尔马林 25ppm 药浴,或亚甲基蓝 2ppm 全池泼洒,连续使用三天后换水增氧。',
  '注意事项:鲈鱼对有机磷类药物敏感,禁用敌百虫,用药后须停料一天并加强增氧。'
].join('\n')

const PDF_2_TEXT = [
  '第三章 水质管理',
  '',
  '氨氮是水产养殖水质管理的重要指标之一,氨氮超标会导致鱼类中毒,表现为鳃丝发暗、摄食下降、游动无力,严重时造成急性死亡,发现超标须立即换水并加强增氧。',
  '',
  '氨氮处理:使用沸石粉吸附,或加大换水量稀释浓度;溶氧应保持在 5mg/L 以上,高温季节每日检测两次,夜间尤其需要关注凌晨时段的溶氧低谷。',
  '',
  '水质突变常见诱因:暴雨后底泥翻起、投喂过量残饵腐败、增氧机故障停转,需每日巡塘排查并在台账中记录异常,便于追溯处置。'
].join('\n')

/** OCR 语料:模拟 Tesseract chi_sim 输出(汉字间插空格),归一化后应可直接检索 */
const OCR_TEXT = [
  '[OCR 批处理] 流 行 性 造 血 器 官 坏 死 病',
  '易 感 宿 主:仅 感 染 河 鲈、虹 鳟 与 大 西 洋 鲑,水 温 8-18 度 时 发 病 率 最 高,死 亡 率 可 达 八 成 以 上。',
  '主 要 症 状:体 表 发 黑,腹 部 膨 大,肝 脾 肾 明 显 肿 大 充 血,鳍 条 基 部 出 血。',
  '防 治 措 施:加 强 苗 种 检 疫,发 病 池 塘 全 池 泼 洒 聚 维 酮 碘 消 毒,并 加 大 换 水 量 改 善 水 质。',
  '流 行 季 节:多 发 于 春 末 夏 初,水 温 波 动 大 的 时 段 尤 须 加 强 巡 塘 观 察。'
].join('\n')

/** 分页符语料:OCR/逐页提取的缓存用 \f 分隔页,页码应可取(1-based) */
const FF_TEXT = [
  '第一章 苗种培育',
  '',
  '苗种阶段的开口饵料以轮虫与卤虫为主,培育池需提前肥水,保持水体透明度在 30 厘米左右,并每日监测水温与溶氧变化。',
  '\f第二章 成鱼养殖',
  '',
  '成鱼阶段可采用网箱养殖模式,网箱规格与布设密度需根据水体交换能力确定,日常管理重点是投喂控制与网衣清洗维护。'
].join('\n')

describe('pdf-content-search', () => {
  beforeAll(() => {
    // 清理历史残留,保证从零构建
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(TEST_CACHE_DIR, { recursive: true })
    mkdirSync(TEST_INDEX_DIR, { recursive: true })

    // 创建测试 PDF 文本缓存
    writeFileSync(join(TEST_CACHE_DIR, 'test-pdf-1.txt'), PDF_1_TEXT, 'utf8')
    writeFileSync(join(TEST_CACHE_DIR, 'test-pdf-2.txt'), PDF_2_TEXT, 'utf8')
  })

  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  it('buildPdfIndex 应正确构建索引', async () => {
    const meta = await buildPdfIndex(TEST_CACHE_DIR, TEST_INDEX_DIR)

    expect(meta.pdfCount).toBe(2)
    expect(meta.totalChunks).toBeGreaterThan(0)
    expect(existsSync(join(TEST_INDEX_DIR, 'index.json'))).toBe(true)
    expect(existsSync(join(TEST_INDEX_DIR, 'chunks.json'))).toBe(true)

    // 格式版本与新鲜度:版本不符会被 loadIndex 视为不可用,过期由 kb:warm 重建
    const raw = JSON.parse(readFileSync(join(TEST_INDEX_DIR, 'index.json'), 'utf8'))
    expect(raw.version).toBe(PDF_INDEX_FORMAT_VERSION)
    const persisted = getPdfIndexMeta(TEST_INDEX_DIR)
    expect(persisted?.builtAt).toBe(meta.builtAt)
    expect(Date.now() - new Date(meta.builtAt).getTime()).toBeLessThan(INDEX_MAX_AGE_MS)
  })

  it('isPdfIndexReady 应返回 true', () => {
    expect(isPdfIndexReady(TEST_INDEX_DIR)).toBe(true)
  })

  it('searchPdfContent 应命中白点病相关切片', () => {
    const results = searchPdfContent('白点病 小瓜虫', TEST_INDEX_DIR)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].from).toBe('pdf_content')
    // 书名未提供且首行是章节标题 → 回退 mediaId
    expect(results[0].title).toContain('test-pdf')
    // 实测 unpdf 合并文本无页边界 → 页码为 null(不臆造页码)
    expect(results[0].page).toBeNull()
    expect(results[0].matchedTerms).toContain('白点病')
  })

  it('searchPdfContent 应命中氨氮相关切片', () => {
    const results = searchPdfContent('氨氮 水质', TEST_INDEX_DIR)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].text).toContain('氨氮')
  })

  it('searchPdfContent 应对无匹配返回空', () => {
    // 查询词需与语料无任何 2/3-gram 重合(n-gram 召回会命中语料中的同字片段)
    const results = searchPdfContent('鲟鱼软骨病XYZ', TEST_INDEX_DIR)
    expect(results.length).toBe(0)
  })

  it('searchPdfContent 索引不存在时应返回空', () => {
    const results = searchPdfContent('白点病', './nonexistent-dir')
    expect(results.length).toBe(0)
  })

  it('OCR 空格文本应被正确归一化', async () => {
    writeFileSync(join(TEST_CACHE_DIR, 'test-pdf-ocr.txt'), OCR_TEXT, 'utf8')

    const meta = await buildPdfIndex(TEST_CACHE_DIR, TEST_INDEX_DIR)
    expect(meta.pdfCount).toBe(3)

    // 归一化后应能命中
    const results = searchPdfContent('流行性造血器官坏死病', TEST_INDEX_DIR)
    expect(results.length).toBeGreaterThan(0)
    // 验证归一化后的文本不含汉字间空格
    expect(results[0].text).not.toMatch(/[\u4e00-\u9fff] [\u4e00-\u9fff]/)
    // 归一化结果已回写缓存(避免每次构建重复处理)
    expect(readFileSync(join(TEST_CACHE_DIR, 'test-pdf-ocr.txt'), 'utf8')).not.toContain('[OCR')
  })

  it('含分页符文本应回带 1-based 页码与章节', async () => {
    writeFileSync(join(TEST_CACHE_DIR, 'test-ff-1.txt'), FF_TEXT, 'utf8')

    const meta = await buildPdfIndex(TEST_CACHE_DIR, TEST_INDEX_DIR)
    expect(meta.pdfCount).toBe(4)
    const ffMeta = meta.pdfs.find((p) => p.mediaId === 'test-ff-1')
    expect(ffMeta?.pageCount).toBe(2)

    // "网箱"仅出现在第二页
    const results = searchPdfContent('网箱', TEST_INDEX_DIR)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].page).toBe(2)
    expect(results[0].chapter).toContain('第二章')
  })

  it('pdfHitToKnowledgeItem 应生成带定位摘要与高亮的条目', () => {
    const hits = searchPdfContent('网箱', TEST_INDEX_DIR)
    const items = hits.map((hit) => pdfHitToKnowledgeItem(hit))

    expect(items.length).toBeGreaterThan(0)
    expect(items[0].from).toBe('pdf_content')
    expect(items[0].summary).toContain('第2页')
    // 页码独立回带 locator:最终引用(knowledge_excerpt)靠它透出,不能只留在 summary
    expect(items[0].locator).toContain('第2页')
    expect(items[0].highlight).toContain('<em>网箱</em>')
    // 高亮合并为单次替换:不应出现嵌套标记
    expect(items[0].highlight).not.toContain('<em><em>')
  })

  it('pdfHitToKnowledgeItem 无分页符命中不应臆造页码', () => {
    const hits = searchPdfContent('白点病 小瓜虫', TEST_INDEX_DIR)
    const items = hits.map((hit) => pdfHitToKnowledgeItem(hit))

    expect(items.length).toBeGreaterThan(0)
    expect(hits[0].page).toBeNull()
    // 页码不可取时不得臆造:定位只可能来自章节检测,不含"第N页"
    expect(items[0].locator).not.toMatch(/第\d+页/)
    expect(items[0].summary).not.toMatch(/第\d+页/)
  })

  it('重叠切片不应产生重复引用(同一处命中只保留一条)', async () => {
    // 长段落跨切片边界:命中词落在相邻切片的 100 字重叠区内,
    // 无重叠去重时同一处命中会以两条近似引用同时进入结果
    const rep = (s: string, n: number): string => s.repeat(n)
    const overlapFixture = [
      `${rep('鲈鱼养殖技术要点', 37)}。`,
      `${rep('水质调控方法详述', 26)}肝胆综合征${rep('水质调控方法详述', 6)}。`,
      `${rep('增氧与投喂管理', 20)}。`
    ].join('')
    writeFileSync(join(TEST_CACHE_DIR, 'test-overlap-1.txt'), overlapFixture, 'utf8')

    const meta = await buildPdfIndex(TEST_CACHE_DIR, TEST_INDEX_DIR)
    expect(meta.pdfCount).toBe(5)
    expect(meta.pdfs.find((p) => p.mediaId === 'test-overlap-1')?.chunkCount).toBeGreaterThan(1)

    const results = searchPdfContent('肝胆综合征', TEST_INDEX_DIR)
    const fromOverlap = results.filter((r) => r.mediaId === 'test-overlap-1')
    expect(fromOverlap.length).toBe(1)
  })
})
