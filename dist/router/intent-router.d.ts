/**
 * 消息意图识别路由(场景 S1-S8)
 *
 * 纯函数模块:不注册为 Tool。
 * 在 DSH 消息链路中,由宿主消息层在把消息交给 Agent 前调用(dsh-lark 场景),
 * 或由 Agent 技能(见 skills/aquasense-expert)参考其场景判定结果编排工具调用。
 * S9(每日任务提醒)不经过意图识别——由 daily-reminder 调度器按《每日操作手册》主动触发。
 */
export type Scene = 'water_quality' | 'inspection' | 'knowledge' | 'death' | 'medication' | 'feeding' | 'temperature' | 'dissection';
export interface IntentResult {
    scene: Scene;
    confidence: number;
    needsImage: boolean;
    needsTable: boolean;
}
/**
 * 按关键词优先级识别场景(S4 最高,常规巡检兜底)
 */
export declare function detectIntent(content: string, hasImage: boolean): IntentResult;
/**
 * 合并视觉场景提示与文字意图识别:文字关键词优先(语义明确),视觉 scene_hint 兜底(纯图片无文字时生效)。
 *
 * 优先级规则:
 *  - 文字关键词命中且置信度 ≥ 0.85 → 直接采用文字结果(死亡/温度/喂食等确定性高)
 *  - 文字关键词命中但置信度 < 0.85 → 以文字为主,但若视觉 scene_hint 与文字一致则提升置信度
 *  - 无文字关键词匹配(纯图片) → 采用视觉 scene_hint 转换为 Scene
 *  - 视觉 scene_hint 缺失或无效 → 保持巡检兜底
 */
export declare function detectIntentWithVision(content: string, hasImage: boolean, sceneHint?: string): IntentResult;
