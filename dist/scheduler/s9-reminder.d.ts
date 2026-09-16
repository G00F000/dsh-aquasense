/**
 * S9 每日任务提醒(插件内模块,V2)
 *
 * 由插件 apply() 托管生命周期,设计详见 docs/s9-daily-reminder-architecture.md:
 *  - 配置来源: 插件配置文件 > 环境变量(remind/config.json 为设置页持久化产物)
 *  - 到点推送任务提醒卡片;工人按提醒拍照/汇报(落 S1-S8 场景台账),异常自动预警
 *  - 重启恢复当日剩余计划: 已推送不重复、已过时间点不补推、同一时间点仅推送一次
 *  - 仅提醒: 不写任何多维表格、卡片无打卡交互
 *
 * 对外暴露 2 个函数:
 *  - setupS9Reminder(ctx)      插件启动/配置变更时调用(enabled=false 时直接跳过)
 *  - pushAbnormalAlert(input)  异常预警(供 analyze 主链路调用)
 */
import type { Context } from '@deepseek-ai/cordis';
export interface RemindTask {
    time: string;
    task: string;
}
/** 异常预警输入(analyze 检出 early/disease 时由主链路调用) */
export interface AbnormalAlertInput {
    poolId?: string;
    cls: 'early' | 'disease';
    symptoms: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    /** 处置建议(可选;analyze 阶段通常未生成,由 advise 环节补充) */
    advice?: string[];
    /** 详情链接(可选,有值才显示「查看详情」按钮) */
    detailUrl?: string;
}
/**
 * 插件启动/配置变更时调用:
 * 读取配置 → 生成或复用当日计划 → 恢复 sent 标记 → 启动 60s tick。
 * enabled=false 或群未配置时记录日志后跳过,绝不阻断插件启动。
 */
export declare function setupS9Reminder(ctx?: Context): void;
/**
 * 异常预警卡片(卡片 C): 由主链路在 analyze 检出 early/disease 后调用。
 * 任何失败仅记录日志,绝不向主链路抛出异常。
 */
export declare function pushAbnormalAlert(input: AbnormalAlertInput): Promise<void>;
