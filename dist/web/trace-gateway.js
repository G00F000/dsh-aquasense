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
 *  - GET /aquasense-reports/api/pools       → 池号枚举 JSON(设置页配置,筛选/趋势用)
 *
 * 协议层防护(与 remind-gateway.ts 一致):仅 GET(405)、同源校验(403)、
 * 路径解析(404)、参数校验(400)、兜底 500。
 *
 * 说明:本地 DSH 依赖线为 0.0.1-rc.5,而 client 包为 0.1.5-rc.2,混装会引发
 * peer 冲突,故 webServer 按最小鸭子类型访问,不引入其类型。
 */
import { readFile } from 'node:fs/promises';
import { HttpError } from './remind-gateway.js';
import { getPoolIds } from '../config/aqua-settings.js';
import { computeTrend, listReportImages, queryIndex, readReport, readReportImage } from './trace-store.js';
// ========== 常量 ==========
/** 分析记录路由前缀 */
export const TRACE_PREFIX = '/aquasense-reports';
/** 记录 ID 白名单:防止路径穿越(仅 RPT-YYYYMMDD-HHmmss 或带 -N 序号) */
const REPORT_ID_RE = /^RPT-\d{8}-\d{6}(-\d+)?$/;
/** 趋势查询天数上限(约 10 年,覆盖"全部"语义) */
const MAX_TREND_DAYS = 3650;
/** 趋势查询天数下限 */
const MIN_TREND_DAYS = 1;
/** 池号参数最大长度(过滤条件,不参与路径拼接,仅限制异常长输入) */
const MAX_POOL_LENGTH = 32;
/** 图片序号上限(单次最多 9 张,留余量) */
const MAX_IMAGE_INDEX = 99;
// ========== 路由解析 ==========
/**
 * 将路径解析为路由(纯函数,导出供测试)。
 * 输入为 URL pathname(已含编码);池号按需 decodeURIComponent。
 */
export function resolveTraceRoute(pathname) {
    if (pathname !== TRACE_PREFIX && !pathname.startsWith(`${TRACE_PREFIX}/`)) {
        return { kind: 'unknown' };
    }
    const rest = pathname === TRACE_PREFIX ? '' : pathname.slice(TRACE_PREFIX.length + 1);
    if (rest === '' || rest === '/')
        return { kind: 'page', page: 'list' };
    if (rest === 'report')
        return { kind: 'page', page: 'detail' };
    if (rest === 'trend')
        return { kind: 'page', page: 'trend' };
    if (rest === 'api/records')
        return { kind: 'api-records' };
    if (rest === 'api/pools')
        return { kind: 'api-pools' };
    if (rest.startsWith('api/records/')) {
        const tail = rest.slice('api/records/'.length);
        // 图片二进制:api/records/<id>/images/<index>
        const imageMatch = /^([^/]+)\/images\/(\d{1,3})$/.exec(tail);
        if (imageMatch) {
            return { kind: 'api-record-image', id: safeDecode(imageMatch[1]), index: Number(imageMatch[2]) };
        }
        const id = safeDecode(tail);
        return { kind: 'api-record', id };
    }
    if (rest.startsWith('api/trend/')) {
        const pool = safeDecode(rest.slice('api/trend/'.length));
        return { kind: 'api-trend', pool };
    }
    return { kind: 'unknown' };
}
/** URL 解码(非法编码时原样返回,交由后续校验拒绝) */
function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
// ========== 参数解析 ==========
/** 解析正整数查询参数;缺省返回 fallback,非法抛 400 */
function parsePositiveInt(raw, name, fallback) {
    if (raw === null || raw === '')
        return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw new HttpError(400, 'invalid-param', `${name} 必须为非负整数,收到: ${raw}`);
    }
    return value;
}
/** 从 searchParams 构建列表查询(非法参数抛 400) */
export function parseRecordQuery(params) {
    const pool = params.get('pool') || undefined;
    if (pool && pool.length > MAX_POOL_LENGTH) {
        throw new HttpError(400, 'invalid-param', `pool 长度不能超过 ${MAX_POOL_LENGTH}`);
    }
    const cls = params.get('cls') || undefined;
    if (cls && !['normal', 'early', 'disease', 'unknown'].includes(cls)) {
        throw new HttpError(400, 'invalid-param', `cls 必须为 normal/early/disease/unknown,收到: ${cls}`);
    }
    const date = params.get('date') || undefined;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new HttpError(400, 'invalid-param', `date 必须为 YYYY-MM-DD,收到: ${date}`);
    }
    return {
        pool,
        cls,
        date,
        low_confidence: params.get('low_confidence') === '1' || params.get('low_confidence') === 'true',
        has_error: params.get('has_error') === '1' || params.get('has_error') === 'true',
        limit: parsePositiveInt(params.get('limit'), 'limit', 50),
        offset: parsePositiveInt(params.get('offset'), 'offset', 0)
    };
}
/** 解析趋势天数(clamp 到 [1, 3650],非法抛 400) */
export function parseTrendDays(params) {
    const raw = params.get('days');
    if (raw === null || raw === '')
        return 7;
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
        throw new HttpError(400, 'invalid-param', `days 必须为正整数,收到: ${raw}`);
    }
    return Math.min(value, MAX_TREND_DAYS);
}
// ========== HTTP 层 ==========
/** 页面路由 → HTML 文件名 */
const PAGE_FILE = {
    list: 'trace-list.html',
    detail: 'trace-detail.html',
    trend: 'trace-trend.html'
};
/**
 * 默认页面读取器:从本模块同目录读取 HTML(tsc 产物 dist/web/ 与源码
 * src/web/ 同构,运行时按 import.meta.url 定位)。
 */
export async function readTracePage(page) {
    return readFile(new URL(`./${PAGE_FILE[page]}`, import.meta.url), 'utf-8');
}
/**
 * 处理一次 HTTP 请求:方法/同源校验 → 路由分发 → 信封或 HTML 写回。
 * 仅 GET;导航请求通常无 Origin 头(有则校同源)。
 */
export function createTraceHandler(deps) {
    return async (req, res) => {
        try {
            if ((req.method ?? '') !== 'GET') {
                writeEnvelope(res, 405, fail(405, 'method-not-allowed', '仅支持 GET').body);
                return;
            }
            // 同源校验:带 Origin 时要求与 Host 一致(与 remind-gateway 一致;无 Origin 放行)
            const origin = req.headers.origin;
            if (typeof origin === 'string' && origin) {
                let originHost;
                try {
                    originHost = new URL(origin).host;
                }
                catch {
                    writeEnvelope(res, 400, fail(400, 'invalid-origin', 'Origin 头非法').body);
                    return;
                }
                const reqHost = req.headers.host;
                if (typeof reqHost === 'string' && reqHost && originHost !== reqHost) {
                    writeEnvelope(res, 403, fail(403, 'origin-not-allowed', '仅允许同源请求').body);
                    return;
                }
            }
            const url = new URL(req.url ?? '/', 'http://dsh.internal');
            const route = resolveTraceRoute(url.pathname);
            switch (route.kind) {
                case 'page':
                    await servePage(deps, route.page, res);
                    return;
                case 'api-records': {
                    const value = await deps.queryIndex(parseRecordQuery(url.searchParams));
                    writeEnvelope(res, 200, ok(value).body);
                    return;
                }
                case 'api-record': {
                    if (!REPORT_ID_RE.test(route.id)) {
                        writeEnvelope(res, 400, fail(400, 'invalid-id', `记录 ID 非法: ${route.id}`).body);
                        return;
                    }
                    const record = await deps.readReport(route.id);
                    if (!record) {
                        writeEnvelope(res, 404, fail(404, 'not-found', `记录不存在: ${route.id}`).body);
                        return;
                    }
                    // 附加工人发送的图片元数据(URL 供详情页 <img> 直接加载)
                    const images = (await deps.listImages(route.id)).map((img) => ({
                        ...img,
                        url: `${TRACE_PREFIX}/api/records/${route.id}/images/${img.index}`
                    }));
                    writeEnvelope(res, 200, ok({ ...record, images }).body);
                    return;
                }
                case 'api-record-image': {
                    if (!REPORT_ID_RE.test(route.id)) {
                        writeEnvelope(res, 400, fail(400, 'invalid-id', `记录 ID 非法: ${route.id}`).body);
                        return;
                    }
                    if (!Number.isInteger(route.index) || route.index < 0 || route.index > MAX_IMAGE_INDEX) {
                        writeEnvelope(res, 400, fail(400, 'invalid-param', `图片序号非法: ${route.index}`).body);
                        return;
                    }
                    const image = await deps.readImage(route.id, route.index);
                    if (!image) {
                        writeEnvelope(res, 404, fail(404, 'not-found', `图片不存在: ${route.id}#${route.index}`).body);
                        return;
                    }
                    res.writeHead(200, {
                        'content-type': image.mimeType || 'image/jpeg',
                        // 图片内容不可变:长缓存 + 防嗅探
                        'cache-control': 'public, max-age=31536000, immutable',
                        'x-content-type-options': 'nosniff'
                    });
                    res.end(image.buffer);
                    return;
                }
                case 'api-trend': {
                    if (!route.pool || route.pool.length > MAX_POOL_LENGTH) {
                        writeEnvelope(res, 400, fail(400, 'invalid-param', 'pool 不能为空且长度不超过 32').body);
                        return;
                    }
                    const value = await deps.computeTrend(route.pool, parseTrendDays(url.searchParams));
                    writeEnvelope(res, 200, ok(value).body);
                    return;
                }
                case 'api-pools': {
                    writeEnvelope(res, 200, ok({ pools: deps.getPools() }).body);
                    return;
                }
                default:
                    writeEnvelope(res, 404, fail(404, 'not-found', `未知路径: ${url.pathname}`).body);
            }
        }
        catch (error) {
            if (error instanceof HttpError) {
                writeEnvelope(res, error.status, fail(error.status, error.code, error.message).body);
                return;
            }
            writeEnvelope(res, 500, fail(500, 'internal', messageOf(error)).body);
        }
    };
}
/** 写回页面 HTML(文件缺失时降级为提示页,不抛裸 500) */
async function servePage(deps, page, res) {
    let html;
    try {
        html = await deps.readPage(page);
        // 池号枚举按设置页「AquaSense 设置」配置注入(占位符替换;JSON 即 JS 字面量)
        html = html.replace('__AQUA_POOLS__', JSON.stringify(deps.getPools()));
    }
    catch (error) {
        console.error(`[aquasense-trace] 页面读取失败(${page}):`, messageOf(error));
        res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><p>页面资源缺失,请重新构建插件(npm run build)。</p>');
        return;
    }
    res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        // 不缓存:插件升级后页面即时生效(飞书内置浏览器缓存较激进)
        'cache-control': 'no-cache'
    });
    res.end(html);
}
/** 写回 JSON 信封 */
function writeEnvelope(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
/** 构造成功结果 */
function ok(value) {
    return { status: 200, body: { ok: true, value } };
}
/** 构造失败结果 */
function fail(status, code, message) {
    return { status, body: { ok: false, error: { code, message } } };
}
/** 错误信息提取 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
// ========== 插件接线 ==========
/**
 * 安装 R8 分析记录 Web 面:HTTP 路由。
 * 由插件 apply() 调用;webServer 服务缺失时静默跳过,不影响分析管线。
 */
export function installTraceWeb(ctx) {
    const deps = {
        queryIndex,
        readReport,
        computeTrend,
        listImages: listReportImages,
        readImage: readReportImage,
        getPools: getPoolIds,
        readPage: readTracePage
    };
    const handler = createTraceHandler(deps);
    ctx.inject(['webServer'], (sctx) => {
        sctx.effect(() => {
            const webServer = sctx.webServer;
            if (!webServer || typeof webServer.register !== 'function') {
                console.warn('[aquasense-trace] webServer 不存在,跳过 R8 路由注册');
                return () => { };
            }
            const dispose = webServer.register({
                kind: 'prefix',
                path: TRACE_PREFIX,
                handler
            });
            console.log('[aquasense-trace] R8 分析记录路由已注册');
            return dispose;
        }, 'aquasense: R8 分析记录路由');
    });
}
