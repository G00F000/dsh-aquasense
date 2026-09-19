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
/** 池号设置(settings.json 为唯一事实源) */
export interface AquaSettings {
    pools: string[];
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
/**
 * 保存池号配置(设置页「保存配置」;sanitize 后写盘并刷新缓存)。
 * 写盘失败向上抛,由网关映射 500。
 */
export declare function saveAquaSettings(input: {
    pools: unknown;
}): AquaSettings;
