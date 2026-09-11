/**
 * 消息意图识别路由(场景 S1-S8)
 *
 * 纯函数模块:不注册为 Tool。
 * 在 DSH 消息链路中,由宿主消息层在把消息交给 Agent 前调用(dsh-lark 场景),
 * 或由 Agent 技能(见 skills/aquasense-expert)参考其场景判定结果编排工具调用。
 * S9(每日任务提醒)不经过意图识别——由 daily-reminder 调度器按《每日操作手册》主动触发。
 */

export type Scene =
  | 'water_quality'
  | 'inspection'
  | 'knowledge'
  | 'death'
  | 'medication'
  | 'feeding'
  | 'temperature'
  | 'dissection'

export interface IntentResult {
  scene: Scene
  confidence: number
  needsImage: boolean
  needsTable: boolean
}

/**
 * 按关键词优先级识别场景(S4 最高,常规巡检兜底)
 */
export function detectIntent(content: string, hasImage: boolean): IntentResult {
  const text = content.toLowerCase()

  // S4: 死亡汇报(最高优先级)
  if (text.match(/死亡|死了|死鱼|浮尸|翻白/)) {
    return { scene: 'death', confidence: 0.95, needsImage: false, needsTable: true }
  }

  // S7: 温度汇报
  if (text.match(/水温|棚温|温度|摄氏|度$/)) {
    return { scene: 'temperature', confidence: 0.9, needsImage: false, needsTable: true }
  }

  // S6: 喂食汇报
  if (text.match(/喂食|投喂|吃料|摄食|饲料|喂了|吃了/)) {
    return { scene: 'feeding', confidence: 0.9, needsImage: false, needsTable: true }
  }

  // S5: 药品使用
  if (text.match(/用药|药品|药量|泼洒|拌料|消毒|药物|下了药/)) {
    return { scene: 'medication', confidence: 0.85, needsImage: true, needsTable: true }
  }

  // S8: 解剖汇报
  if (text.match(/解剖|解开了|内脏|器官|肝|胆|肠|鳃|脾|鳔|肾/)) {
    return { scene: 'dissection', confidence: 0.85, needsImage: true, needsTable: true }
  }

  // S1: 水质检测
  if (text.match(/水质|溶氧|氨氮|pH|亚硝酸|水色|透明度/)) {
    return { scene: 'water_quality', confidence: 0.85, needsImage: true, needsTable: true }
  }

  // S3: 知识询问(不保存)
  if (text.match(/怎么|如何|为什么|是什么|能不能|可以吗|请问|咨询|问题/)) {
    return { scene: 'knowledge', confidence: 0.8, needsImage: false, needsTable: false }
  }

  // S2: 巡检(带图默认巡检)
  if (hasImage) {
    return { scene: 'inspection', confidence: 0.7, needsImage: true, needsTable: true }
  }

  // 默认:巡检
  return { scene: 'inspection', confidence: 0.5, needsImage: false, needsTable: true }
}

/**
 * 合并视觉场景提示与文字意图识别:文字关键词优先(语义明确),视觉 scene_hint 兜底(纯图片无文字时生效)。
 * 
 * 优先级规则:
 *  - 文字关键词命中且置信度 ≥ 0.85 → 直接采用文字结果(死亡/温度/喂食等确定性高)
 *  - 文字关键词命中但置信度 < 0.85 → 以文字为主,但若视觉 scene_hint 与文字一致则提升置信度
 *  - 无文字关键词匹配(纯图片) → 采用视觉 scene_hint 转换为 Scene
 *  - 视觉 scene_hint 缺失或无效 → 保持巡检兜底
 */
export function detectIntentWithVision(
  content: string,
  hasImage: boolean,
  sceneHint?: string
): IntentResult {
  const textResult = detectIntent(content, hasImage)

  // 有文字且置信度足够高:直接采用文字结果(文字语义明确,视觉仅辅助)
  if (textResult.confidence >= 0.85) return textResult

  // 尝试将视觉 scene_hint 转为 Scene
  const visionScene = sceneHintToScene(sceneHint)

  // 无视觉线索:保持文字结果
  if (!visionScene) return textResult

  // 视觉与文字一致:提升置信度
  if (textResult.scene === visionScene) {
    return { ...textResult, confidence: Math.min(1, textResult.confidence + 0.1) }
  }

  // 视觉与文字不一致且文字置信度低:优先采用视觉(纯图片场景)
  if (textResult.confidence < 0.7 && hasImage) {
    return { scene: visionScene, confidence: 0.75, needsImage: true, needsTable: true }
  }

  // 其他情况:保持文字结果(文字仍有一定依据)
  return textResult
}

/** 视觉 scene_hint → Scene 映射(inspection 和无效值返回 null,保持兜底) */
function sceneHintToScene(hint?: string): Scene | null {
  switch (hint) {
    case 'death': return 'death'
    case 'water_quality': return 'water_quality'
    case 'medication': return 'medication'
    case 'feeding': return 'feeding'
    case 'temperature': return 'temperature'
    case 'dissection': return 'dissection'
    default: return null // inspection 或无效值:不改变路由,保持兜底
  }
}
