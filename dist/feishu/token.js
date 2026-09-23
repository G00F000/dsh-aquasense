/**
 * 飞书 tenant_access_token 获取与进程内缓存
 * 供 record-ledger(台账写入)与 s9-reminder(S9 推送)复用,避免每个工具各自实现鉴权。
 */
let cache = null;
/**
 * 获取飞书 tenant_access_token(自动缓存,官方有效期 2 小时,提前 5 分钟过期)
 */
export async function getFeishuToken() {
    if (cache && Date.now() < cache.expiresAt) {
        return cache.token;
    }
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) {
        throw new Error('[aquasense] 飞书凭证未配置:请设置 FEISHU_APP_ID / FEISHU_APP_SECRET');
    }
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const result = (await response.json());
    if (result.code !== 0 || !result.tenant_access_token) {
        throw new Error(`[aquasense] 飞书鉴权失败: ${result.msg || result.code}`);
    }
    const ttlSeconds = (Number(result.expire) || 7200) - 300;
    cache = { token: result.tenant_access_token, expiresAt: Date.now() + ttlSeconds * 1000 };
    return cache.token;
}
/** 用户显示名称缓存(open_id → name),进程生命周期内有效 */
const userNameCache = new Map();
/**
 * 根据飞书 open_id 获取用户显示名称
 * 优先命中进程内缓存,未命中时调用飞书通讯录 API
 */
export async function getFeishuUserName(openId) {
    if (!openId)
        return '';
    const cached = userNameCache.get(openId);
    if (cached)
        return cached;
    const token = await getFeishuToken();
    const response = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`, { headers: { Authorization: `Bearer ${token}` } });
    const result = (await response.json());
    if (result.code !== 0 || !result.data?.user?.name) {
        console.error(`[aquasense] 获取飞书用户名失败: open_id=${openId}, ${result.msg || result.code}`);
        return '';
    }
    const name = result.data.user.name;
    userNameCache.set(openId, name);
    return name;
}
/**
 * 获取飞书群成员列表
 * @param chatId 群 ID
 * @returns 群成员列表(包含 open_id 和 name)
 */
export async function getFeishuChatMembers(chatId) {
    if (!chatId)
        return [];
    const token = await getFeishuToken();
    const members = [];
    let pageToken = '';
    let hasMore = true;
    while (hasMore) {
        const url = new URL(`https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members`);
        url.searchParams.set('member_id_type', 'open_id');
        url.searchParams.set('page_size', '100');
        if (pageToken) {
            url.searchParams.set('page_token', pageToken);
        }
        const response = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` }
        });
        const result = (await response.json());
        if (result.code !== 0) {
            console.error(`[aquasense] 获取飞书群成员失败: chatId=${chatId}, ${result.msg || result.code}`);
            break;
        }
        const items = result.data?.items || [];
        for (const item of items) {
            if (item.member_id && item.name) {
                members.push({
                    open_id: item.member_id,
                    name: item.name,
                    member_id_type: item.member_id_type
                });
            }
        }
        hasMore = result.data?.has_more || false;
        pageToken = result.data?.page_token || '';
    }
    return members;
}
/**
 * 上传图片 URL 到飞书云文档,返回 Bitable 附件格式
 * 支持三种输入:
 *  - data URL(H5 上传页场景,R8):直接解析 base64,不经网络;
 *  - HTTP(S) URL:下载为 buffer 后再上传;
 *  - 飞书内部URL:使用飞书API下载后上传。
 */
export async function uploadImageToFeishu(imageUrl) {
    try {
        // 0. data URL:H5 上传页传入的内存图片(R8),直接解析
        if (imageUrl.startsWith('data:')) {
            const parsed = parseDataUrl(imageUrl);
            if (!parsed) {
                console.error('[aquasense] data URL 解析失败(H5 图片)');
                return null;
            }
            return uploadBufferToFeishu(parsed.buffer, `h5-${Date.now()}${extOfMime(parsed.mimeType)}`, parsed.mimeType);
        }
        // 方案4: 检查URL是否可能已过期
        if (isImageUrlExpired(imageUrl)) {
            console.warn(`[aquasense] 图片URL可能已过期: ${imageUrl.slice(0, 80)}`);
            // 继续尝试下载，但记录警告
        }
        // 方案2&3: 使用带回退逻辑的下载函数(支持HTTP/HTTPS URL和飞书内部URL)
        const downloaded = await downloadImageWithFallback(imageUrl, 1);
        if (!downloaded) {
            console.error(`[aquasense] 图片下载失败(所有方式): ${imageUrl.slice(0, 80)}`);
            return null;
        }
        // 将base64转换为buffer
        const buffer = Buffer.from(downloaded.data, 'base64');
        const fileName = imageUrl.split('/').pop()?.split('?')[0] || 'image.jpg';
        return uploadBufferToFeishu(buffer, fileName, `image/${downloaded.mimeType.split('/')[1] || 'jpeg'}`);
    }
    catch (err) {
        console.error(`[aquasense] 图片上传异常: ${imageUrl.slice(0, 80)}`, err);
        return null;
    }
}
/**
 * 上传图片 buffer 到飞书云文档,返回 Bitable 附件格式(失败返回 null,不抛异常)。
 * 导出供 R8 H5 上传页复用(H5 图片为内存 buffer,无 URL 可下载)。
 */
export async function uploadBufferToFeishu(buffer, fileName, mimeType = '') {
    try {
        // Uint8Array.from 生成 ArrayBuffer 支撑的新视图(规避 SharedArrayBuffer 类型不兼容)
        const bytes = buffer instanceof Uint8Array ? Uint8Array.from(buffer) : new Uint8Array(buffer);
        const name = fileName || `image-${Date.now()}${extOfMime(mimeType)}`;
        const token = await getFeishuToken();
        const form = new FormData();
        form.append('file_name', name);
        form.append('parent_type', 'bitable_image');
        form.append('parent_node', process.env.FEISHU_BITABLE_APP_TOKEN || '');
        form.append('size', String(bytes.byteLength));
        form.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), name);
        const resp = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });
        const result = (await resp.json());
        if (result.code !== 0 || !result.data?.file_token) {
            console.error(`[aquasense] 图片上传失败: ${name}, ${result.msg || result.code}`);
            return null;
        }
        return { file_token: result.data.file_token };
    }
    catch (err) {
        console.error(`[aquasense] 图片上传异常: ${fileName}`, err);
        return null;
    }
}
/** 解析 base64 data URL 为 buffer + MIME(非 base64 或空内容返回 null) */
export function parseDataUrl(dataUrl) {
    const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl);
    if (!match)
        return null;
    const mimeType = match[1] || 'image/jpeg';
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0)
        return null;
    return { buffer, mimeType };
}
/** MIME → 扩展名(构造上传文件名) */
const MIME_EXT = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};
/** MIME 类型 → 文件扩展名(未知类型降级 .jpg) */
function extOfMime(mimeType) {
    const key = (mimeType || '').split(';')[0].trim().toLowerCase();
    return MIME_EXT[key] || '.jpg';
}
/**
 * 判断是否是飞书内部URL(非标准HTTP/HTTPS协议)
 * 飞书内部URL格式示例:
 *  - internal-file-service.internal
 *  - feishu-internal://xxx
 *  - lark://xxx
 */
export function isFeishuInternalUrl(url) {
    if (!url)
        return false;
    // 标准HTTP/HTTPS URL不是内部URL
    if (url.startsWith('http://') || url.startsWith('https://'))
        return false;
    // 检查是否是飞书内部URL格式
    return url.includes('internal') || url.includes('feishu') || url.includes('lark') || !url.startsWith('http');
}
/**
 * 下载飞书内部URL的图片
 * 使用飞书API下载消息中的图片资源
 * @param messageKey 飞书消息ID或文件key
 * @returns 图片数据(base64)和MIME类型，失败返回null
 */
export async function downloadFeishuImage(messageKey) {
    try {
        const token = await getFeishuToken();
        // 使用飞书API下载消息资源
        // 注意：这里需要根据实际的飞书API调用方式来实现
        // 飞书图片下载API: GET /im/v1/messages/{message_id}/resources/{file_key}
        // 但由于我们没有message_id，这里使用通用的文件下载方式
        // 尝试作为文件key下载
        const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageKey}/resources/${messageKey}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30_000)
        });
        if (!response.ok) {
            console.warn(`[aquasense] 飞书内部URL下载失败: HTTP ${response.status}, key=${messageKey}`);
            return null;
        }
        const buffer = await response.arrayBuffer();
        const data = Buffer.from(buffer).toString('base64');
        const ct = response.headers.get('content-type') || '';
        let mimeType = 'image/jpeg';
        if (ct.includes('png'))
            mimeType = 'image/png';
        else if (ct.includes('webp'))
            mimeType = 'image/webp';
        else if (ct.includes('gif'))
            mimeType = 'image/gif';
        return { data, mimeType };
    }
    catch (error) {
        console.warn(`[aquasense] 飞书内部URL下载异常: ${messageKey}`, error instanceof Error ? error.message : error);
        return null;
    }
}
/**
 * 下载图片(支持HTTP/HTTPS URL和飞书内部URL)
 * 带有回退逻辑：先尝试HTTP下载，失败后尝试飞书API下载
 * @param url 图片URL
 * @param retryCount 重试次数(默认1次)
 * @returns 图片数据(base64)和MIME类型，失败返回null
 */
export async function downloadImageWithFallback(url, retryCount = 1) {
    // 1. 优先尝试HTTP/HTTPS下载
    if (url.startsWith('http://') || url.startsWith('https://')) {
        for (let i = 0; i <= retryCount; i++) {
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    const data = Buffer.from(buffer).toString('base64');
                    const ct = response.headers.get('content-type') || '';
                    let mimeType = 'image/jpeg';
                    if (ct.includes('png'))
                        mimeType = 'image/png';
                    else if (ct.includes('webp'))
                        mimeType = 'image/webp';
                    else if (ct.includes('gif'))
                        mimeType = 'image/gif';
                    return { data, mimeType };
                }
                console.warn(`[aquasense] HTTP图片下载失败(尝试 ${i + 1}/${retryCount + 1}): HTTP ${response.status}, url=${url.slice(0, 80)}`);
            }
            catch (error) {
                console.warn(`[aquasense] HTTP图片下载异常(尝试 ${i + 1}/${retryCount + 1}): ${url.slice(0, 80)}`, error instanceof Error ? error.message : error);
            }
            // 重试前等待
            if (i < retryCount) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }
    // 2. 尝试飞书内部URL下载
    if (isFeishuInternalUrl(url)) {
        console.log(`[aquasense] 尝试飞书内部URL下载: ${url.slice(0, 80)}`);
        return await downloadFeishuImage(url);
    }
    return null;
}
/**
 * 检查图片URL是否可能已过期
 * 飞书图片URL通常包含时间戳或有效期参数
 * @param url 图片URL
 * @returns 是否可能已过期
 */
export function isImageUrlExpired(url) {
    if (!url)
        return true;
    // 检查URL中是否包含过期时间参数
    try {
        const urlObj = new URL(url);
        const expires = urlObj.searchParams.get('expires') || urlObj.searchParams.get('expire');
        if (expires) {
            const expiresAt = parseInt(expires, 10);
            // 如果过期时间已过，返回true
            if (expiresAt > 0 && expiresAt < Date.now() / 1000) {
                return true;
            }
        }
        // 检查URL路径中是否包含时间戳
        const pathMatch = url.match(/\/(\d{10,13})\//);
        if (pathMatch) {
            const timestamp = parseInt(pathMatch[1], 10);
            // 如果时间戳超过24小时，可能已过期
            if (timestamp > 0 && Date.now() - timestamp > 24 * 60 * 60 * 1000) {
                return true;
            }
        }
    }
    catch {
        // URL解析失败，可能已过期
        return true;
    }
    return false;
}
