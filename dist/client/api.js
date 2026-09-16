/**
 * 配置页 API 客户端(浏览器侧)
 *
 * 与 Host 侧 src/web/remind-gateway.ts 的 /aquasense-remind/api 路由对应:
 *   get    → { config, status }
 *   save   → { config, status }(body: { config })
 *   test   → { sent: true }
 *   groups → { groups, error? }
 * 信封协议 { ok, value } / { ok, error: { code, message } }。
 */
/** 配置页 API 前缀(与 Host 侧常量一致) */
const API_PREFIX = '/aquasense-remind/api';
/** 请求失败(信封 error.message 或 HTTP 状态) */
export class RemindApiError extends Error {
}
/** 调用一次 API 并解包信封 */
async function call(method, body) {
    let response;
    try {
        response = await fetch(`${API_PREFIX}/${method}`, {
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
    get: () => call('get'),
    save: (input) => call('save', { config: input }),
    test: () => call('test'),
    groups: () => call('groups')
};
