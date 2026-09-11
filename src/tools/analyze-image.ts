/**
 * 图片分析工具(aquasense_analyze,场景 S1/S2/S4/S5/S8 共用)
 *
 * 调用 DeepSeek 视觉模型分析鲈鱼养殖现场照片:
 *  - 判断状态 normal(正常)/ early(前兆)/ disease(发病)
 *  - 提取症状、严重程度、置信度
 * 结果喂给 generate-advice(处置建议)与 record-ledger(台账)。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

export type SceneHint = 'inspection' | 'death' | 'water_quality' | 'medication' | 'feeding' | 'temperature' | 'dissection'

/** 模型输出 JSON 契约(与技术方案 YOLO 三分类语义一致) */
export interface AnalysisResult {
  abnormal: boolean
  cls: 'normal' | 'early' | 'disease' | 'unknown'
  symptoms: string[]
  severity: 'low' | 'medium' | 'high' | 'critical'
  confidence: number
  /** 图片场景提示:视觉模型判断该图属于哪类业务场景,供意图路由补充文字缺失时的分类 */
  scene_hint: SceneHint
}

export const analyzeImage = defineTool({
  name: 'aquasense_analyze',
  description: '分析鲈鱼养殖现场照片,识别异常症状',
  parameters: {
    image_url: {
      type: 'string',
      required: true,
      description: '图片 URL'
    },
    description: {
      type: 'string',
      description: '工人文字描述'
    },
    pool_id: {
      type: 'string',
      description: '池号(池1/池2/池3/池4)'
    }
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        abnormal: { type: 'boolean' },
        cls: { type: 'string', enum: ['normal', 'early', 'disease', 'unknown'] },
        symptoms: { type: 'array', items: { type: 'string' } },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        confidence: { type: 'number' },
        scene_hint: { type: 'string', enum: ['inspection', 'death', 'water_quality', 'medication', 'feeding', 'temperature', 'dissection'], description: '图片场景提示' }
      }
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  },
  async execute(args) {
    // 参数缺失由 defineTool 按 required 校验拦截,此处直接执行
    // 1. 下载图片并转 base64(30s 超时,避免坏图 URL 挂起)
    const { data: imageData, mimeType } = await downloadImage(args.image_url)

    // 2. 构建提示词并调用视觉模型
    const prompt = buildPrompt(args.description, args.pool_id)
    const response = await callVisionModel(imageData, mimeType, prompt)

    // 3. 解析结果(失败降级 normal,不阻断巡检流程)
    return parseAnalysisResponse(response)
  }
})

/**
 * 下载图片为 base64
 */
interface ImageDownloadResult {
  data: string
  mimeType: string
}

async function downloadImage(url: string): Promise<ImageDownloadResult> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`图片下载失败: HTTP ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  const data = Buffer.from(buffer).toString('base64')

  // 从 Content-Type 推断 MIME 类型,无法识别时降级 image/png
  const ct = response.headers.get('content-type') || ''
  let mimeType = 'image/png'
  if (ct.includes('jpeg') || ct.includes('jpg')) mimeType = 'image/jpeg'
  else if (ct.includes('png')) mimeType = 'image/png'
  else if (ct.includes('gif')) mimeType = 'image/gif'
  else if (ct.includes('webp')) mimeType = 'image/webp'

  return { data, mimeType }
}

/**
 * 构建视觉分析提示词
 */
function buildPrompt(description?: string, poolId?: string): string {
  let prompt = `你是水产养殖专家,分析鲈鱼养殖照片。
1. 判断鱼群状态:normal(正常)/early(前兆)/disease(发病)
2. 判断图片场景(scene_hint),从以下选一个:
   - death:图片中有死鱼漂浮/翻白/浮尸
   - water_quality:拍摄水质检测仪器/试纸/水色观察
   - medication:拍摄用药/药瓶/泼洒/消毒
   - feeding:拍摄饲料/投喂/喂食
   - temperature:拍摄温度计/测温
   - dissection:拍摄鱼体解剖/内脏/器官
   - inspection:其他常规巡检照片(默认)
输出 JSON:{"abnormal":bool, "cls":"...", "symptoms":[...], "severity":"low|medium|high|critical", "confidence":0.x, "scene_hint":"..."}
early=离群、蹭壁、呼吸急促;disease=浮头、烂身、白点。`

  if (poolId) prompt += `\n池号:${poolId}`
  if (description) prompt += `\n描述:${description}`

  return prompt
}

/**
 * 调用 DeepSeek 视觉模型(兼容 OpenAI chat completions 图片输入)
 */
async function callVisionModel(imageData: string, mimeType: string, prompt: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('[aquasense] DEEPSEEK_API_KEY 未配置')
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash'

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageData}` } },
          { type: 'text', text: prompt }
        ]
      }],
      max_tokens: 4096,
      temperature: 0.1
    })
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`视觉模型调用失败: HTTP ${response.status} - ${errBody}`)
  }

  const result = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = result.choices?.[0]?.message?.content
  // content 可能为字符串或内容段数组,统一转文本
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''))
      .join('')
  }
  return ''
}

// scene_hint 白名单:模型输出越界时降级为 inspection
const VALID_SCENE_HINTS: ReadonlySet<string> = new Set<SceneHint>(['inspection', 'death', 'water_quality', 'medication', 'feeding', 'temperature', 'dissection'])

/**
 * 解析模型输出 JSON(容错:提取首个 JSON 对象并按白名单归一,失败降级 normal)
 * 归一化保证输出始终满足 output.schema(enum/类型/多余键),避免注册表校验失败
 */
function parseAnalysisResponse(response: string): AnalysisResult {
  const fallback: AnalysisResult = { abnormal: false, cls: 'unknown', symptoms: ['AI分析失败,请人工复核'], severity: 'low', confidence: 0.3, scene_hint: 'inspection' }

  let raw: Record<string, unknown>
  try {
    const json = response.match(/\{[\s\S]*\}/)?.[0]
    if (!json) {
      console.error('[aquasense] 视觉模型返回空内容,降级为 unknown')
      return fallback
    }
    const parsed: unknown = JSON.parse(json)
    raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    console.error('[aquasense] 视觉模型返回无法解析的 JSON,降级为 unknown')
    return fallback
  }

  // 分类与严重程度白名单(模型输出越界时降级)
  const cls = raw.cls === 'early' || raw.cls === 'disease' ? raw.cls : 'normal'
  const severity = raw.severity === 'low' || raw.severity === 'medium' || raw.severity === 'high' || raw.severity === 'critical'
    ? raw.severity
    : 'low'
  const symptoms = Array.isArray(raw.symptoms)
    ? raw.symptoms.filter((s): s is string => typeof s === 'string')
    : []
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.min(1, Math.max(0, raw.confidence))
    : 0.3

  // abnormal 由三分类推导,避免与 cls 冲突(early/disease 即异常帧)
  const sceneHint = VALID_SCENE_HINTS.has(raw.scene_hint as string) ? (raw.scene_hint as SceneHint) : 'inspection'
  return { abnormal: cls !== 'normal', cls, symptoms, severity, confidence, scene_hint: sceneHint }
}
