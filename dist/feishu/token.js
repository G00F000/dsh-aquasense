/**
 * 飞书 tenant_access_token 获取与进程内缓存
 * 供 record-ledger(台账写入)与 daily-reminder(S9 推送)复用,避免每个工具各自实现鉴权。
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
 * 上传图片 URL 到飞书云文档,返回 Bitable 附件格式
 * 图片先下载为 buffer,再通过 drive/v1/medias/upload_all 上传
 */
export async function uploadImageToFeishu(imageUrl) {
    try {
        // 1. 下载图片(30s 超时)
        const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
        if (!imgResp.ok)
            return null;
        const buffer = await imgResp.arrayBuffer();
        const fileName = imageUrl.split('/').pop()?.split('?')[0] || 'image.jpg';
        // 2. 上传到飞书云文档
        const token = await getFeishuToken();
        const form = new FormData();
        form.append('file_name', fileName);
        form.append('parent_type', 'bitable_image');
        form.append('parent_node', process.env.FEISHU_BITABLE_APP_TOKEN || '');
        form.append('size', String(buffer.byteLength));
        form.append('file', new Blob([buffer]), fileName);
        const resp = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });
        const result = (await resp.json());
        if (result.code !== 0 || !result.data?.file_token) {
            console.error(`[aquasense] 图片上传失败: ${imageUrl}, ${result.msg || result.code}`);
            return null;
        }
        return { file_token: result.data.file_token };
    }
    catch (err) {
        console.error(`[aquasense] 图片上传异常: ${imageUrl}`, err);
        return null;
    }
}
