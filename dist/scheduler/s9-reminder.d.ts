/**
 * S9 每日任务提醒(插件内模块,V2)
 *
 * 由插件 apply() 托管生命周期,设计详见 docs/s9-daily-reminder-architecture.md:
 *  - 配置来源: 插件配置文件 > 环境变量(remind/config.json 为设置页持久化产物)
 *  - 到点推送任务提醒卡片;工人按提醒拍照/汇报(落 S1-S8 场景台账),异常自动预警
 *  - 重启恢复当日剩余计划: 已推送不重复、已过时间点不补推、同一时间点仅推送一次
 *  - 仅提醒: 不写任何多维表格、卡片无打卡交互
 *
 * 对外暴露入口:
 *  - setupS9Reminder(ctx)          插件启动/配置变更时调用(enabled=false 时直接跳过)
 *  - pushAbnormalAlert(input)      异常预警(供 analyze 主链路调用)
 *  - getRemindConfig()             读取当前生效配置(设置页 gateway 使用)
 *  - saveRemindConfig(input)       保存配置并重建当日推送计划(设置页「保存配置」)
 *  - sendTestReminder()            立即推送一次总览卡片(设置页「发送测试提醒」)
 *  - getRemindStatus()             当日计划/已推送/下一项(设置页状态展示)
 */
import type { Context } from '@deepseek-ai/cordis';
/** 默认总览推送时刻(设置页 settings schema 默认值共用同一口径) */
export declare const DEFAULT_CRON = "0 7 * * *";
export interface RemindTask {
    time: string;
    task: string;
}
/** 提醒配置(remind/config.json 为唯一事实源;设置页经 gateway 读写该文件) */
export interface RemindConfig {
    enabled: boolean;
    group: string;
    /** 总览推送时刻(5 段 cron,仅使用"每天 HH:MM"语义) */
    cron: string;
    tasks: RemindTask[];
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
/** 单条任务归一化:非法返回 null(设置页校验与配置解析共用同一口径) */
export declare function normalizeRemindTask(input: unknown): RemindTask | null;
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
/** 设置页保存输入(草稿整体提交;cron 不在设置页暴露,保存时保留现值) */
export interface RemindConfigInput {
    enabled?: boolean;
    group?: string;
    tasks?: RemindTask[];
}
/** 读取当前生效配置(文件 > 环境变量) */
export declare function getRemindConfig(): RemindConfig;
/**
 * 保存配置(设置页「保存配置」):
 * 写入 remind/config.json 后调用 setupS9Reminder() 重建当日推送计划,
 * 使调度立即随新配置运行(需求 R6.5 交互说明「持久化配置并重建当日推送计划」)。
 */
export declare function saveRemindConfig(input: RemindConfigInput): RemindConfig;
/**
 * 发送测试提醒(设置页「发送测试提醒」):
 * 用已保存配置立即推送一次总览卡片;不落当日计划、不影响 sent 标记。
 * 失败直接抛出(与调度推送不同,不做 30s 重试),由 gateway 转为错误响应。
 */
export declare function sendTestReminder(): Promise<void>;
/** 当日运行状态(设置页状态行;调度未运行时全为 0) */
export interface RemindStatus {
    /** 当前调度日(本地日期) */
    date: string;
    /** 当日计划项数(总览 + 任务) */
    planned: number;
    /** 已成功推送项数 */
    sent: number;
    /** 下一个待推送时刻(HH:MM),无则 null */
    nextTime: string | null;
    /** 调度器（60s tick）是否在运行 */
    running: boolean;
}
export declare function getRemindStatus(): RemindStatus;
