#!/usr/bin/env node
/**
 * 每日任务提醒调度器(场景 S9,独立于 DSH 的定时进程)
 *
 * 读取 IMA 知识库《每日操作手册》,按任务时间点向巡检群主动推送提醒。
 * 不注册为 DSH Tool(Tool 只能被 Agent 按需调用,无法主动定时触发),与 DSH 并行运行。
 *
 * 启动方式:
 *   npm run remind        # 开发:npx tsx src/scheduler/daily-reminder.ts
 *   npm run remind:prod   # 发布:node dist/scheduler/daily-reminder.js
 *
 * 行为约定(与轻量化模块设计文档一致):
 *  - 每日 07:00 推送当日任务总览(当日仅一次,磁盘标记防重启重复)
 *  - 每分钟 tick,当前 HH:MM 与任务时间相等且未推过 → 推送单条提醒
 *  - 重启不补推已过时间点的任务;手册缺失 → 群内提醒维护人,当日跳过
 *  - 手册按「日」粒度缓存,当日编辑次日生效
 */
export {};
