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
 * 支持三种输入:
 *  - data URL(H5 上传页场景,R8):直接解析 base64,不经网络;
 *  - HTTP(S) URL:下载为 buffer 后再上传;
 *  - 飞书内部URL:使用飞书API下载后上传。
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
/**
 * 判断是否是飞书内部URL(非标准HTTP/HTTPS协议)
 * 飞书内部URL格式示例:
 *  - internal-file-service.internal
 *  - feishu-internal://xxx
 *  - lark://xxx
 */
export declare function isFeishuInternalUrl(url: string): boolean;
/**
 * 下载飞书内部URL的图片
 * 使用飞书API下载消息中的图片资源
 * @param messageKey 飞书消息ID或文件key
 * @returns 图片数据(base64)和MIME类型，失败返回null
 */
export declare function downloadFeishuImage(messageKey: string): Promise<{
    data: string;
    mimeType: string;
} | null>;
/**
 * 下载图片(支持HTTP/HTTPS URL和飞书内部URL)
 * 带有回退逻辑：先尝试HTTP下载，失败后尝试飞书API下载
 * @param url 图片URL
 * @param retryCount 重试次数(默认1次)
 * @returns 图片数据(base64)和MIME类型，失败返回null
 */
export declare function downloadImageWithFallback(url: string, retryCount?: number): Promise<{
    data: string;
    mimeType: string;
} | null>;
/**
 * 检查图片URL是否可能已过期
 * 飞书图片URL通常包含时间戳或有效期参数
 * @param url 图片URL
 * @returns 是否可能已过期
 */
export declare function isImageUrlExpired(url: string): boolean;
