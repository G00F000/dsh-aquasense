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
 * (浏览器侧「智慧渔业」入口读写;web 面缺失时静默跳过,不影响定时推送)。
 * R8 分析记录可追溯(见 docs/r8-traceability-architecture.md):
 *  - 分析记录列表/详情/趋势页由 web/trace-gateway 提供(/aquasense-reports 路由;
 *    列表页经配置页页签 React 组件直调 API 展示(v1.3 去 iframe 化),不新开标签页);
 *  - H5 拍照汇报页由 web/report-handler 提供(/aquasense-remind/report 页面 +
 *    /aquasense-remind/api/report/{submit,progress} 提交与进度接口);
 *  - 群聊场景经 recordLedger 包装器后置收集简化记录(方案 A)。
 */
import { analyzeImage } from './tools/analyze-image.js';
import { generateAdvice } from './tools/generate-advice.js';
import { recordLedger } from './tools/record-ledger.js';
import { setupS9Reminder } from './scheduler/s9-reminder.js';
import { installRemindWeb } from './web/remind-gateway.js';
import { installTraceWeb } from './web/trace-gateway.js';
import { installReportWeb } from './web/report-handler.js';
import { wrapLedgerWithTrace } from './web/trace-ledger-wrap.js';
export const name = 'aquasense-plugin';
export const inject = ['tools'];
export function apply(ctx) {
    console.log('[aquasense] 加载水产养殖工具...');
    // 注册 3 个业务工具
    ctx.tools.register(analyzeImage);
    ctx.tools.register(generateAdvice);
    // 台账工具经 R8 trace 包装:写入成功后自动后置收集简化分析记录(群聊场景)
    ctx.tools.register(wrapLedgerWithTrace(recordLedger));
    // S9 每日任务提醒(插件内调度,enabled=false 时内部直接跳过)
    setupS9Reminder(ctx);
    // S9 配置页(原型 3):HTTP 路由
    installRemindWeb(ctx);
    // R8 H5 拍照汇报页:页面路由(提交/进度接口由 remind-gateway 分流)
    installReportWeb(ctx);
    // R8 分析记录 Web 面:列表/详情/趋势页 + 查询 API(/aquasense-reports)
    installTraceWeb(ctx);
    console.log('[aquasense] 工具加载完成');
    console.log('[aquasense] 知识库查询:generate-advice 内置 IMA API 自动查询');
}
