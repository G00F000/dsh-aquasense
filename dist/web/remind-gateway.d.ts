/**
 * S9 提醒设置页 Web 面(Host 侧,原型 3)
 *
 *  - settings 配对:注册命名空间 'aquasense-remind'(仅作配对键——设置页插件
 *    tab 扫描到命名空间后才派发浏览器侧同 key 卡片;配置读写仍以
 *    remind/config.json 为唯一事实源,见 s9-reminder 第 7 节)
 *  - HTTP 路由:在宿主 webServer 上注册 /aquasense-remind/api 前缀,供浏览器
 *    卡片 fetch 调用 get/save/test/groups 四个方法
 *
 * 说明:本地 DSH 依赖线为 0.0.1-rc.5,而 dsh-settings 及 client 包为 0.1.5-rc.2,
 * 混装会引发 peer 冲突,故 settings/webServer 均按最小鸭子类型访问,不引入其类型。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { RemindConfig, RemindConfigInput, RemindStatus } from '../scheduler/s9-reminder.js';
/** 设置页 API 路由前缀(同源 fetch;方法追加在其后,如 /get) */
export declare const REMIND_API_PREFIX = "/aquasense-remind/api";
/** settings 命名空间(小写连字符;仅作 Host/浏览器卡片配对键) */
export declare const REMIND_SETTINGS_NAMESPACE = "aquasense-remind";
/** 飞书群条目(设置页下拉选项;机器人已加入的群) */
export interface FeishuGroup {
    chatId: string;
    name: string;
}
/** 响应信封:成功携带 value,失败携带 error */
export type ApiEnvelope = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
/** 分发结果(HTTP 层负责序列化) */
export interface ApiResult {
    status: number;
    body: ApiEnvelope;
}
/** 设置页 API 数据依赖(注入以便独立测试) */
export interface RemindApiDeps {
    getConfig(): RemindConfig;
    getStatus(): RemindStatus;
    saveConfig(input: RemindConfigInput): RemindConfig;
    sendTest(): Promise<void>;
    listGroups(): Promise<FeishuGroup[]>;
}
/** 校验/协议错误(映射为 HTTP 状态码) */
export declare class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
/**
 * 注册 settings 命名空间。
 * 设置页插件 tab 只有扫描到命名空间才派发本插件卡片(见 ui-settings-plugins
 * 的 settings.plugin.item 合同);重复注册属多 fiber 正常情形,静默跳过。
 */
export declare function registerRemindSettingsNamespace(ctx: Context): void;
/**
 * 校验并归一化「保存配置」请求体(导出供测试)。
 * body 形如 { config: { enabled, group, tasks } };cron 不在设置页暴露。
 */
export declare function parseRemindConfigInput(body: unknown): RemindConfigInput;
/**
 * 创建设置页 API 分发函数(注入依赖便于测试)。
 * 返回 (method, body) => ApiResult;HTTP 层负责信封序列化。
 */
export declare function createRemindApi(deps: RemindApiDeps): (method: string, body: unknown) => Promise<ApiResult>;
/** 飞书群列表(机器人已加入的群;分页拉取,失败向上抛,由 API 层降级) */
export declare function fetchFeishuGroups(): Promise<FeishuGroup[]>;
/**
 * 处理一次 HTTP 请求:协议层校验 + 方法分发 + 信封写回。
 * 协议:POST only、同源(Origin 与 Host 一致)、Content-Type application/json。
 */
export declare function handleRemindHttp(dispatch: (method: string, body: unknown) => Promise<ApiResult>, req: IncomingMessage, res: ServerResponse): Promise<void>;
/**
 * 安装设置页 Web 面:settings 配对命名空间 + HTTP API 路由。
 * 由插件 apply() 调用;web 面缺失(无 settings/webServer 服务)时静默跳过,
 * 不影响 S9 定时推送本身。
 */
export declare function installRemindWeb(ctx: Context): void;
