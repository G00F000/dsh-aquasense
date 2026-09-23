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
/** 配置页 API 前缀(与 Host 侧常量一致) */
const API_PREFIX = '/aquasense-remind/api';
/** AquaSense 设置页 API 前缀(与 Host 侧常量一致) */
const AQUA_SETTINGS_API_PREFIX = '/aquasense-settings/api';
/** 请求失败(信封 error.message 或 HTTP 状态) */
export class RemindApiError extends Error {
}
/** 调用一次 API 并解包信封 */
async function call(prefix, method, body) {
    let response;
    try {
        response = await fetch(`${prefix}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body ?? {})
        });
    }
    catch (error) {
        throw new RemindApiError(error instanceof Error ? error.message : String(error));
    }
    let envelope;
    try {
        envelope = (await response.json());
    }
    catch {
        throw new RemindApiError(`HTTP ${response.status}`);
    }
    if (!envelope.ok) {
        throw new RemindApiError(envelope.error?.message || `HTTP ${response.status}`);
    }
    return envelope.value;
}
/** 配置页 API 客户端 */
export const remindApi = {
    get: () => call(API_PREFIX, 'get'),
    save: (input) => call(API_PREFIX, 'save', { config: input }),
    test: () => call(API_PREFIX, 'test'),
    groups: () => call(API_PREFIX, 'groups')
};
/** 设置页 API 客户端 */
export const aquaSettingsApi = {
    get: () => call(AQUA_SETTINGS_API_PREFIX, 'get'),
    save: (input) => call(AQUA_SETTINGS_API_PREFIX, 'save', { settings: input }),
    listChatMembers: (chatId) => call(AQUA_SETTINGS_API_PREFIX, 'list-members', { chat_id: chatId }),
    testVisionModel: (config) => call(AQUA_SETTINGS_API_PREFIX, 'test-vision-model', { config })
};
