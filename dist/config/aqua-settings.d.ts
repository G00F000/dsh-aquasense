/**
 * AquaSense 池号配置(唯一事实源: $AQUASENSE_CACHE_DIR/aqua/settings.json)
 *
 * 设置页「AquaSense 设置」卡片经 /aquasense-settings/api 读写本文件,
 * 设置整个插件系统的池号枚举;消费方:
 *  - record-ledger     :台账池号白名单(拒绝枚举外文本)
 *  - report-handler    :H5 拍照汇报池号校验
 *  - trace-gateway     :/api/pools 接口(列表筛选/趋势页选项)
 *  - report-upload.html:H5 页池号按钮(服务端注入)
 *
 * 优先级:配置文件 > 环境变量 AQUA_POOLS(JSON 数组)> 默认 4 池。
 * 与 s9-reminder 的 remind/config.json 同构:非法值不阻断启动,静默回退。
 */
/** 默认池号枚举(与清徐基地循环水池编号一致) */
export declare const DEFAULT_POOLS: string[];
/** 池号数量上限 */
export declare const MAX_POOLS = 20;
/** 单个池号最大长度(字符) */
export declare const MAX_POOL_LENGTH = 16;
/** 用户映射表单个姓名最大长度(字符) */
export declare const MAX_USER_NAME_LENGTH = 32;
/** 池号设置(settings.json 为唯一事实源) */
export interface AquaSettings {
    pools: string[];
    /** 用户映射表:open_id → 姓名(用于台账自动填充上报人) */
    userMap: Record<string, string>;
    /** 视觉模型配置 */
    visionModel?: VisionModelConfig;
}
/** 视觉模型配置 */
export interface VisionModelConfig {
    /** DeepSeek API Key */
    apiKey: string;
    /** 视觉模型名称 */
    modelName: string;
    /** API 基础 URL */
    baseUrl: string;
}
/**
 * 归一化池号列表(导出供测试与网关共用同一口径):
 * trim、去空、去重、限长限量;非法项跳过,结果为空时回退默认 4 池。
 */
export declare function sanitizePools(raw: unknown): string[];
/**
 * 读取当前生效池号配置(文件 > 环境变量 > 默认)。
 * 每次读盘(文件 <1KB,微秒级开销),确保外部修改/同毫秒写盘均立即生效;
 * 与 s9-reminder 的 loadConfig 同构。
 */
export declare function getAquaSettings(): AquaSettings;
/** 当前生效池号(业务消费:台账白名单、H5 校验) */
export declare function getPoolIds(): string[];
/** 当前生效池号集合(record-ledger/report-handler 白名单查询) */
export declare function getValidPoolIds(): Set<string>;
/** 池号枚举文案(如「池1/池2/池3/池4」,供错误消息与追问使用) */
export declare function formatPoolIds(pools?: string[]): string;
/** 归一化用户映射表(open_id → 姓名):trim、去空键、限长;非法项跳过 */
export declare function sanitizeUserMap(raw: unknown): Record<string, string>;
/** 当前生效用户映射表(业务消费:台账自动填充上报人) */
export declare function getUserMap(): Record<string, string>;
/** 默认视觉模型名称 */
export declare const DEFAULT_VISION_MODEL = "deepseek-flash";
/** 默认 API 基础 URL */
export declare const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** 归一化视觉模型配置 */
export declare function sanitizeVisionModel(raw: unknown): VisionModelConfig | undefined;
/** 当前生效视觉模型配置 */
export declare function getVisionModelConfig(): VisionModelConfig | undefined;
/** 根据 open_id 获取用户名(优先映射表,未命中返回空字符串)
 *
 * 匹配策略(应对 dsh-lark 消息桥截断 open_id 的情况):
 *  1. 精确匹配(快速路径)
 *  2. 前缀匹配:若传入的 open_id 是映射表某 key 的前缀,且仅命中一条,则采纳(高置信度)
 *  3. 映射表 key 以传入 open_id 开头:同上前缀方向反转(映射表 key 被截断的场景)
 *  4. 以上均未命中则返回空字符串
 */
export declare function getUserNameByOpenId(openId: string): string;
/**
 * 保存池号配置(设置页「保存配置」;sanitize 后写盘并刷新缓存)。
 * 写盘失败向上抛,由网关映射 500。
 */
export declare function saveAquaSettings(input: {
    pools: unknown;
    userMap?: Record<string, unknown>;
    visionModel?: unknown;
}): AquaSettings;
