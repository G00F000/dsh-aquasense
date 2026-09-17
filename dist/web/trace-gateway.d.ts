/**
 * R8 分析记录 Web 面(Host 侧,见 docs/r8-traceability-architecture.md §3.4)
 *
 * 在宿主 webServer 上注册 /aquasense-reports 前缀:
 *  - GET /aquasense-reports                → 列表页 HTML
 *  - GET /aquasense-reports/report?id=...  → 详情页 HTML
 *  - GET /aquasense-reports/trend?pool=... → 趋势页 HTML
 *  - GET /aquasense-reports/api/records    → 列表 JSON(?pool=&cls=&date=&limit=&offset=)
 *  - GET /aquasense-reports/api/records/:id → 详情 JSON
 *  - GET /aquasense-reports/api/trend/:pool → 趋势 JSON(?days=7)
 *
 * 协议层防护(与 remind-gateway.ts 一致):仅 GET(405)、同源校验(403)、
 * 路径解析(404)、参数校验(400)、兜底 500。
 *
 * 说明:本地 DSH 依赖线为 0.0.1-rc.5,而 client 包为 0.1.5-rc.2,混装会引发
 * peer 冲突,故 webServer 按最小鸭子类型访问,不引入其类型。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type RecordQuery, type RecordQueryResult, type TrendData } from './trace-store.js';
import type { AnalysisRecord } from './trace-recorder.js';
/** 分析记录路由前缀 */
export declare const TRACE_PREFIX = "/aquasense-reports";
/** 静态页面标识 */
export type TracePage = 'list' | 'detail' | 'trend';
/** 解析后的路由 */
export type TraceRoute = {
    kind: 'page';
    page: TracePage;
} | {
    kind: 'api-records';
} | {
    kind: 'api-record';
    id: string;
} | {
    kind: 'api-trend';
    pool: string;
} | {
    kind: 'unknown';
};
/** 网关数据依赖(注入以便独立测试) */
export interface TraceServerDeps {
    queryIndex(query: RecordQuery): Promise<RecordQueryResult>;
    readReport(id: string): Promise<AnalysisRecord | null>;
    computeTrend(pool: string, days: number): Promise<TrendData>;
    /** 读取页面 HTML(生产环境从 dist/web/ 同目录读取) */
    readPage(page: TracePage): Promise<string>;
}
/**
 * 将路径解析为路由(纯函数,导出供测试)。
 * 输入为 URL pathname(已含编码);池号按需 decodeURIComponent。
 */
export declare function resolveTraceRoute(pathname: string): TraceRoute;
/** 从 searchParams 构建列表查询(非法参数抛 400) */
export declare function parseRecordQuery(params: URLSearchParams): RecordQuery;
/** 解析趋势天数(clamp 到 [1, 3650],非法抛 400) */
export declare function parseTrendDays(params: URLSearchParams): number;
/**
 * 默认页面读取器:从本模块同目录读取 HTML(tsc 产物 dist/web/ 与源码
 * src/web/ 同构,运行时按 import.meta.url 定位)。
 */
export declare function readTracePage(page: TracePage): Promise<string>;
/**
 * 处理一次 HTTP 请求:方法/同源校验 → 路由分发 → 信封或 HTML 写回。
 * 仅 GET;导航请求通常无 Origin 头(有则校同源)。
 */
export declare function createTraceHandler(deps: TraceServerDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * 安装 R8 分析记录 Web 面:HTTP 路由。
 * 由插件 apply() 调用;webServer 服务缺失时静默跳过,不影响分析管线。
 */
export declare function installTraceWeb(ctx: Context): void;
