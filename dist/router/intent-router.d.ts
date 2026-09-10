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
