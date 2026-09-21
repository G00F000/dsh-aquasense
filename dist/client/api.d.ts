/**
 * 配置页 API 客户端(浏览器侧)
 *
 * 与 Host 侧 src/web/remind-gateway.ts 的 /aquasense-remind/api 路由对应:
 *   get    → { config, status }
 *   save   → { config, status }(body: { config })
 *   test   → { sent: true }
 *   groups → { groups, error? }
 * 与 Host 侧 src/web/aqua-settings-gateway.ts 的 /aquasense-settings/api 路由对应:
 *   get    → { settings }
 *   save   → { settings }(body: { settings })
 * 信封协议 { ok, value } / { ok, error: { code, message } }。
 */
/** 飞书群条目(下拉选项) */
export interface FeishuGroup {
    chatId: string;
    name: string;
}
/** 任务条目 */
export interface RemindTask {
    time: string;
    task: string;
}
/** 已保存配置(config.json 快照) */
export interface RemindConfig {
    enabled: boolean;
    group: string;
    cron: string;
    tasks: RemindTask[];
}
/** 保存请求体(status 不在其中) */
export interface RemindConfigInput {
    enabled: boolean;
    group: string;
    tasks: RemindTask[];
}
/** 当日运行状态 */
export interface RemindStatus {
    date: string;
    planned: number;
    sent: number;
    nextTime: string | null;
    running: boolean;
}
/** 配置页 API 合同 */
export interface RemindApi {
    get(): Promise<{
        config: RemindConfig;
        status: RemindStatus;
    }>;
    save(input: RemindConfigInput): Promise<{
        config: RemindConfig;
        status: RemindStatus;
    }>;
    test(): Promise<{
        sent: boolean;
    }>;
    groups(): Promise<{
        groups: FeishuGroup[];
        error?: string;
    }>;
}
/** 请求失败(信封 error.message 或 HTTP 状态) */
export declare class RemindApiError extends Error {
}
/** 配置页 API 客户端 */
export declare const remindApi: RemindApi;
/** 池号设置(settings.json 快照) */
export interface AquaSettings {
    pools: string[];
    /** 用户映射表:open_id → 姓名 */
    userMap: Record<string, string>;
}
/** 飞书群成员信息 */
export interface FeishuChatMember {
    open_id: string;
    name: string;
    member_id_type?: string;
}
/** 设置页 API 合同(设置 → 插件 → 插件配置 中的「AquaSense 设置」卡片) */
export interface AquaSettingsApi {
    get(): Promise<{
        settings: AquaSettings;
    }>;
    save(input: AquaSettings): Promise<{
        settings: AquaSettings;
    }>;
    listChatMembers(chatId: string): Promise<{
        members: FeishuChatMember[];
    }>;
}
/** 设置页 API 客户端 */
export declare const aquaSettingsApi: AquaSettingsApi;
