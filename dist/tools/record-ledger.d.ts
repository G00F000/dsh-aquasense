/**
 * 台账写入工具(aquasense_ledger,场景 S1-S8 落表)
 *
 * 将巡检记录写入飞书多维表格(仅追加,满足政府两年台账要求)。
 *  - scene 决定写入哪张表(每张表在 .env 中配置 table id)
 *  - inspection 场景:传 analysis/advice 时自动按巡检表列名组装
 *  - 其他场景:由 Agent 按表格实际列名提供 fields(键为表格列名)
 *  - 池号缺失时不落表,返回追问,由 Agent 向工人补充提问
 *  - 上报人只取当前消息发送者 open_id 解析(禁止凭记忆填写),解析不出时同样追问
 *  - dissection 场景:「解剖器官」写入前归一为下拉框选项(可多选),拒绝选项外自由文本
 */
import { type Scene } from '../router/intent-router.js';
/** 台账场景 = S1-S8 中所有落表场景(排除 S3 知识询问) */
export type LedgerScene = Exclude<Scene, 'knowledge'>;
export declare const recordLedger: import("@deepseek-ai/dsh-tools").ToolDefinition;
