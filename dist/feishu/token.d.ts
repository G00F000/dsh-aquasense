/**
 * 飞书 tenant_access_token 获取与进程内缓存
 * 供 record-ledger(台账写入)与 daily-reminder(S9 推送)复用,避免每个工具各自实现鉴权。
 */
/**
 * 获取飞书 tenant_access_token(自动缓存,官方有效期 2 小时,提前 5 分钟过期)
 */
export declare function getFeishuToken(): Promise<string>;
/**
 * 根据飞书 open_id 获取用户显示名称
 * 优先命中进程内缓存,未命中时调用飞书通讯录 API
 */
export declare function getFeishuUserName(openId: string): Promise<string>;
/**
 * 上传图片 URL 到飞书云文档,返回 Bitable 附件格式
 * 图片先下载为 buffer,再通过 drive/v1/medias/upload_all 上传
 */
export declare function uploadImageToFeishu(imageUrl: string): Promise<{
    file_token: string;
} | null>;
