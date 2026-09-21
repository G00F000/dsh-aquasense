/**
 * 消息意图识别路由(场景 S1-S8)
 *
 * 纯函数模块:不注册为 Tool。
 * 在 DSH 消息链路中,由宿主消息层在把消息交给 Agent 前调用(dsh-lark 场景),
 * 或由 Agent 技能(见 skills/aquasense-expert)参考其场景判定结果编排工具调用。
 * S9(每日任务提醒)不经过意图识别——由插件内调度模块(scheduler/s9-reminder.ts)按《每日操作手册》主动触发。
 */
export type Scene = 'water_quality' | 'inspection' | 'knowledge' | 'death' | 'medication' | 'feeding' | 'temperature' | 'dissection';
export interface IntentResult {
    scene: Scene;
    confidence: number;
    needsImage: boolean;
    needsTable: boolean;
}
/** 领域过滤结果:与 IntentResult 分离,便于调用方区分"不在领域内"和"领域内但场景未识别" */
export interface DomainFilterResult {
    /** 是否属于水产养殖/RAS 领域 */
    inDomain: boolean;
    /** 不在领域时的拒绝回复(调用方直接返回给工人) */
    rejectReply?: string;
}
/**
 * 判断消息是否命中命令黑名单(服务器重启、脚本执行等一律禁止)。
 */
export declare function isCommandBlocked(content: string): boolean;
/**
 * 判断消息内容是否属于水产养殖/RAS 水循环养殖+工程设备+天气领域。
 *
 * 匹配策略:内容转小写后逐一比对 AQUACULTURE_KEYWORDS,
 * 命中任意一个关键词即判定为领域内。
 * 带图片的消息默认放行(图片可能包含养殖场景,由视觉模型进一步判断)。
 */
export declare function isAquacultureRelated(content: string, hasImage: boolean): boolean;
/**
 * 飞书渠道领域过滤入口。
 *
 * 过滤优先级:
 *  1. 命令黑名单(服务器重启/脚本执行) → 无论是否养殖相关都拒绝
 *  2. 领域关键词匹配 → 不在领域内则拒绝
 *  3. 带图片 → 默认放行
 *
 * 调用方拿到 inDomain=false 时,直接把 rejectReply 回复工人,不走后续意图识别。
 */
export declare function domainFilter(content: string, hasImage: boolean): DomainFilterResult;
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
