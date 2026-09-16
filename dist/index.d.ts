/**
 * dsh-aquasense 插件入口
 *
 * 注册 3 个业务工具(只开发 3 个 Tool 是轻量化方案的核心简化):
 *  - aquasense_analyze   :视觉模型分析养殖照片(鲈鱼三分类)
 *  - aquasense_advice    :内置 IMA 知识库查询,生成分级处置建议
 *  - aquasense_ledger    :写入飞书多维表格台账(S1-S8 落表)
 *
 * 意图路由(intent-router)为纯函数模块,由消息宿主/Agent 技能调用,不注册为 Tool;
 * S9 每日任务提醒由插件内模块 s9-reminder 托管(apply() 启动,见 docs/s9-daily-reminder-architecture.md)。
 * S9 配置页(原型 3)由 web/remind-gateway 提供:/aquasense-remind/api 路由
 * (浏览器侧「🐟 AquaSense 配置」入口读写;web 面缺失时静默跳过,不影响定时推送)。
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "aquasense-plugin";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
