/**
 * R8 H5 拍照汇报页服务端(见 docs/r8-traceability-architecture.md §3.5、S9 §5.3-5.4)
 *
 * 路由(挂在 remind-gateway 的 /aquasense-remind/api 前缀下,由其分流):
 *  - POST /aquasense-remind/api/report/submit   → multipart 表单 → 创建 job 立即返回 { job_id }
 *  - GET  /aquasense-remind/api/report/progress → ?job_id= → job 快照(进度/结果,前端轮询)
 *  - GET  /aquasense-remind/report?task=&time=&chat_id= → H5 页面 HTML(installReportWeb 注册)
 *
 * 管线(5 Span 埋点,进度 20/40/60/80/100):
 *  upload → analyze → retrieve/advice(仅 early/disease)→ ledger → flush
 *  - 进度反馈:轮询而非 SSE(飞书内置浏览器 + 反向代理场景更稳,见架构文档 §3.5)
 *  - trace 埋点失败不影响主流程(§8):记录写入为尽力而为,分析结果照常返回
 *  - 终态(job.status)在 flush 之后才置位,保证前端跳详情页时记录文件已可读
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { AnalysisTracer, type TracerParams } from './trace-recorder.js';
import { type AnalysisResult, type ImageDownloadResult, type VisionModelResult } from '../tools/analyze-image.js';
import { type AdviceResult, type AnalysisInput, type KnowledgeRetrieval } from '../tools/generate-advice.js';
import type { SearchResult } from '../ima/ima-api.js';
/** H5 提交/进度接口路径(remind-gateway 分流用) */
export declare const REPORT_SUBMIT_PATH = "/aquasense-remind/api/report/submit";
export declare const REPORT_PROGRESS_PATH = "/aquasense-remind/api/report/progress";
/** H5 页面路由前缀(卡片 B「📷 拍照汇报」按钮 URL) */
export declare const REPORT_PAGE_PREFIX = "/aquasense-remind/report";
/** H5 表单解析后的图片(服务端已转 base64) */
export interface ReportImage {
    name: string;
    mimeType: string;
    /** 服务端收到的字节数(前端已压缩) */
    size: number;
    base64: string;
    /** data URL(传给 record-ledger 作为「图片」列来源,由其上传飞书) */
    dataUrl: string;
}
/** H5 表单校验后的输入 */
export interface ReportFormInput {
    pool: string;
    reporter: string;
    description: string;
    images: ReportImage[];
    task?: string;
    time?: string;
    chat_id?: string;
}
/** 进度快照(轮询响应) */
export interface ReportJobView {
    status: 'running' | 'done' | 'error';
    /** 0-100 */
    progress: number;
    /** 当前步骤文案 */
    step: string;
    record_id?: string;
    pool: string;
    cls?: string;
    confidence?: number;
    symptoms?: string[];
    message?: string;
}
/** 内部 job 记录 */
export interface ReportJob extends ReportJobView {
    id: string;
    createdAt: number;
}
/** 管线依赖(注入以便独立测试;缺省用真实实现) */
export interface ReportPipelineDeps {
    callVision(images: ImageDownloadResult[], prompt: string): Promise<VisionModelResult>;
    parseAnalysis(raw: string): AnalysisResult;
    buildPrompt(poolId?: string): string;
    retrieve(analysis: AnalysisInput): Promise<KnowledgeRetrieval>;
    advise(analysis: AnalysisInput, knowledge: SearchResult | null, excerpts: KnowledgeRetrieval['excerpts']): Promise<AdviceResult>;
    writeLedger(args: Record<string, unknown>): Promise<unknown>;
    pushAlert(payload: {
        pool_id: string;
        cls: 'early' | 'disease';
        symptoms: string[];
        severity: string;
    }): void;
    createTracer(params: TracerParams): AnalysisTracer;
}
/** 读取请求体的最大字节数(超限 413) */
export declare function parseReportForm(req: IncomingMessage, maxBytes?: number): Promise<FormData>;
/**
 * 校验并归一化 H5 提交表单(导出供测试)。
 * 校验:池号白名单、上报人必填、图片 1-9 张且格式/大小合法。
 */
export declare function validateReportForm(form: FormData): Promise<ReportFormInput>;
/** 创建一次 H5 提交任务(导出供测试直接构造) */
export declare function createReportJob(): ReportJob;
/** 读取 job(不存在返回 null) */
export declare function getJob(id: string): ReportJob | null;
/** 清空 job 表(仅供测试) */
export declare function resetReportJobs(): void;
/** job → 响应视图(隐藏内部字段) */
export declare function jobView(job: ReportJob): ReportJobView;
/**
 * 启动一次 H5 提交处理:创建 job → 异步跑管线 → 立即返回 job。
 * 管线在首次 await 前同步执行到 record_id 生成,故返回时 job.record_id 已可读。
 */
export declare function startReportJob(input: ReportFormInput, uploadDurationMs: number, deps?: Partial<ReportPipelineDeps>): ReportJob;
/**
 * 执行 H5 分析管线(导出供测试直接 await):
 * upload → analyze → retrieve/advice(仅 early/disease)→ ledger → flush。
 * 终态在 flush 后置位,保证前端跳详情页时记录文件已可读。
 */
export declare function runReportPipeline(job: ReportJob, input: ReportFormInput, uploadDurationMs: number, depsOverride?: Partial<ReportPipelineDeps>): Promise<void>;
/**
 * H5 提交/进度接口请求处理(由 remind-gateway 在 /aquasense-remind/api 前缀下分流)。
 * 提交=POST multipart(立即返回 202 + job_id);进度=GET 轮询。
 */
export declare function handleReportHttp(req: IncomingMessage, res: ServerResponse, deps?: Partial<ReportPipelineDeps>): Promise<void>;
/** 默认页面读取器(tsc 产物 dist/web/ 与源码 src/web/ 同构) */
export declare function readReportPage(): Promise<string>;
/** 处理 H5 页面请求(仅 GET;文件缺失时降级提示) */
export declare function handleReportPage(req: IncomingMessage, res: ServerResponse): Promise<void>;
/**
 * 安装 R8 H5 拍照汇报页:页面路由。
 * 提交/进度接口由 remind-gateway 的 /aquasense-remind/api 前缀分流到 handleReportHttp;
 * webServer 缺失时静默跳过(与 remind/trace 网关一致)。
 */
export declare function installReportWeb(ctx: Context): void;
