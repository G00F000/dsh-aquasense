/**
 * 日报文本解析器(纯函数模块)
 *
 * 将工人发送的自由格式日报文本拆分为多条结构化台账记录。
 * 支持的场景:水温(temperature)、喂食(feeding)、用药(medication)。
 *
 * 典型输入:
 *   水温：23℃
 *   喂食：1号池3.2kg   2号池2.6kg， 3号池2.7kg， 4号池1.6kg，
 *   吃食情况: 秒光
 *   拌药情况：.金莲清毒康:280g ...
 *   拌药的第三天
 *
 * 规则(来源于开发规范 memory):
 *  - 池号未指定时默认"全塘"→展开为所有配置池
 *  - 药品标记"暂无"→跳过
 *  - 上报人由台账工具运行时解析 open_id,此处不填充
 *  - 按行块拆分,逐场景提取数值,不做 AI 推断
 */
import { type Scene } from '../router/intent-router.js';
export type LedgerScene = Exclude<Scene, 'knowledge' | 'inspection' | 'death' | 'dissection' | 'water_quality'>;
export interface LedgerEntry {
    scene: LedgerScene;
    fields: Record<string, unknown>;
}
export interface ParseResult {
    entries: LedgerEntry[];
    /** 解析过程中发现的问题(如缺失字段),供日志/调试使用 */
    warnings: string[];
}
/**
 * 解析日报文本,输出结构化台账条目。
 *
 * @param text    工人发送的原始日报文本
 * @param pools   当前配置的池号列表(可选,缺省从配置读取)
 * @returns       拆分后的台账条目数组 + 警告信息
 */
export declare function parseDailyReport(text: string, pools?: string[]): ParseResult;
/** 多场景日报文本拆分工具:将自由格式日报文本拆分为多条结构化台账记录 */
export declare const parseReport: import("@deepseek-ai/dsh-tools").ToolDefinition;
