/**
 * AquaSense 设置页 Web 面(Host 侧)——池号枚举配置
 *
 *  - settings 配对:注册命名空间 'aquasense-settings'(仅作配对键——设置页
 *    「插件配置」tab 扫描到命名空间后才派发浏览器侧同 key 卡片;配置读写仍
 *    以 $AQUASENSE_CACHE_DIR/aqua/settings.json 为唯一事实源,见 aqua-settings)
 *  - HTTP 路由:在宿主 webServer 上注册 /aquasense-settings/api 前缀,供
 *    浏览器侧卡片 fetch 调用 get/save 两个方法
 *
 * 说明:本地 DSH 依赖线为 0.0.1-rc.5,而 dsh-settings 及 client 包为 0.1.5-rc.2,
 * 混装会引发 peer 冲突,故 settings/webServer 均按最小鸭子类型访问,不引入其类型。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type ApiResult } from './remind-gateway.js';
import { type AquaSettings } from '../config/aqua-settings.js';
import { type FeishuChatMember } from '../feishu/token.js';
/** 设置页 API 路由前缀(同源 fetch;方法追加在其后,如 /get) */
export declare const AQUA_SETTINGS_API_PREFIX = "/aquasense-settings/api";
/** settings 命名空间(小写连字符;仅作 Host/浏览器卡片配对键) */
export declare const AQUA_SETTINGS_NAMESPACE = "aquasense-settings";
/** 设置页 API 数据依赖(注入以便独立测试) */
export interface AquaSettingsApiDeps {
    getSettings(): AquaSettings;
    saveSettings(input: {
        pools: unknown;
        userMap?: Record<string, unknown>;
        visionModel?: unknown;
    }): AquaSettings;
    listChatMembers(chatId: string): Promise<FeishuChatMember[]>;
    testVisionModel(config: {
        apiKey: string;
        modelName: string;
        baseUrl: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
}
/**
 * 注册 settings 命名空间。
 * 设置页「插件配置」tab 只有扫描到命名空间才派发本插件卡片(见
 * ui-settings-plugins 的 settings.plugin.item 合同);重复注册属多 fiber
 * 正常情形,静默跳过。
 */
export declare function registerAquaSettingsNamespace(ctx: Context): void;
/**
 * 校验并归一化「保存设置」请求体(导出供测试)。
 * body 形如 { settings: { pools: [...], userMap: { ... }, visionModel: { ... } } }。
 */
export declare function parseAquaSettingsInput(body: unknown): {
    pools: unknown;
    userMap?: Record<string, unknown>;
    visionModel?: unknown;
};
/** 获取群成员请求体校验 */
export declare function parseChatId(body: unknown): string;
/** 视觉模型测试请求体校验 */
export declare function parseVisionModelTestInput(body: unknown): {
    apiKey: string;
    modelName: string;
    baseUrl: string;
};
/**
 * 创建设置页 API 分发函数(注入依赖便于测试)。
 * 返回 (method, body) => ApiResult;HTTP 层负责信封序列化。
 */
export declare function createAquaSettingsApi(deps: AquaSettingsApiDeps): (method: string, body: unknown) => Promise<ApiResult>;
/**
 * 处理一次 HTTP 请求:协议层校验 + 方法分发 + 信封写回。
 * 协议:POST only、同源(Origin 与 Host 一致)、Content-Type application/json
 * (与 remind-gateway 一致)。
 */
export declare function handleAquaSettingsHttp(dispatch: (method: string, body: unknown) => Promise<ApiResult>, req: IncomingMessage, res: ServerResponse): Promise<void>;
/**
 * 安装 AquaSense 设置 Web 面:settings 命名空间 + HTTP API 路由。
 * 由插件 apply() 调用;webServer 缺失时仅跳过 API(卡片配对仍保留)。
 */
export declare function installAquaSettingsWeb(ctx: Context): void;
