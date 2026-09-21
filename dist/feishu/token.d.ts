/**
 * 飞书 tenant_access_token 获取与进程内缓存
 * 供 record-ledger(台账写入)与 s9-reminder(S9 推送)复用,避免每个工具各自实现鉴权。
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
/** 飞书群成员信息 */
export interface FeishuChatMember {
    /** 用户 open_id */
    open_id: string;
    /** 用户名称 */
    name: string;
    /** 成员在群中的类型 */
    member_id_type?: string;
}
/**
 * 获取飞书群成员列表
 * @param chatId 群 ID
 * @returns 群成员列表(包含 open_id 和 name)
 */
export declare function getFeishuChatMembers(chatId: string): Promise<FeishuChatMember[]>;
/**
 * 上传图片 URL 到飞书云文档,返回 Bitable 附件格式
 * 支持两种输入:
 *  - data URL(H5 上传页场景,R8):直接解析 base64,不经网络;
 *  - HTTP(S) URL:下载为 buffer 后再上传。
 */
export declare function uploadImageToFeishu(imageUrl: string): Promise<{
    file_token: string;
} | null>;
/**
 * 上传图片 buffer 到飞书云文档,返回 Bitable 附件格式(失败返回 null,不抛异常)。
 * 导出供 R8 H5 上传页复用(H5 图片为内存 buffer,无 URL 可下载)。
 */
export declare function uploadBufferToFeishu(buffer: ArrayBuffer | Uint8Array, fileName: string, mimeType?: string): Promise<{
    file_token: string;
} | null>;
/** 解析 base64 data URL 为 buffer + MIME(非 base64 或空内容返回 null) */
export declare function parseDataUrl(dataUrl: string): {
    buffer: Buffer;
    mimeType: string;
} | null;
