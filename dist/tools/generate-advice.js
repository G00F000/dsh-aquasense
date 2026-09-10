/**
 * 处置建议工具(aquasense_advice,场景 S2/S4/S5/S8 巡检诊断后调用)
 *
 * 自动查询 IMA 获取疾病诊疗参考,双通道合并:知识库名称检索 + 笔记正文检索(带高亮);
 * 有高亮的直接引用,其余读取命中条目正文(PDF/笔记)摘取原文片段,
 * 按「原文引用→逻辑推理→总结」输出分级处置建议。
 * 容错原则:知识库不可用不阻断主流程,降级为内置通用建议模板。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { searchKnowledge, searchNote, getMediaContent, getNoteContentByNoteId } from '../ima/ima-api.js';
export const generateAdvice = defineTool({
    name: 'aquasense_advice',
    description: '基于分析结果和知识库生成处置建议。自动查询 IMA 知识库,读取命中条目正文(PDF/笔记)摘取原文引用,按严重程度分级。',
    parameters: {
        analysis: { type: 'object', additionalProperties: true, required: true, description: 'aquasense_analyze 的图片分析结果(abnormal/cls/symptoms/severity/confidence)' }
    },
    output: {
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                diagnosis_summary: { type: 'string' },
                immediate_actions: { type: 'array', items: { type: 'string' } },
                follow_up_actions: { type: 'array', items: { type: 'string' } },
                medication: { type: 'string' },
                alert_level: { type: 'string', enum: ['P0', 'P1', 'P2'] },
                knowledge_refs: { type: 'array', items: { type: 'string' }, description: '知识库参考来源' },
                knowledge_excerpt: { type: 'array', items: { type: 'string' }, description: '知识库正文原文引用(三段式之"原文引用",格式:《标题》:「摘录」)' },
                reasoning: { type: 'string', description: '逻辑推理说明(三段式之"逻辑推理",含结论边界声明)' }
            }
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    async execute(args) {
        const analysis = args.analysis;
        // ========== 步骤 1:自动查询 IMA 知识库 ==========
        let knowledge = null;
        let knowledgeRefs = [];
        try {
            // 根据症状构建搜索关键词(IMA 是关键词匹配非语义检索,多词拼接会 0 命中)
            const query = buildKnowledgeQuery(analysis);
            console.log(`[aquasense] 查询知识库:${query}`);
            // 逐关键词查询再合并去重(解决多词空格拼接 0 命中的问题)
            knowledge = await searchKnowledgeMerged(query);
            if (knowledge.items.length > 0) {
                knowledgeRefs = knowledge.items.map((item) => `《${item.title}》${item.source ? `- ${item.source}` : ''}`);
                console.log(`[aquasense] 找到 ${knowledge.items.length} 条相关知识`);
            }
        }
        catch (error) {
            // 查询失败不影响主流程,继续生成建议
            console.error('[aquasense] 知识库查询失败:', error);
        }
        // ========== 步骤 2:读取命中条目正文,摘取原文片段(三段式之"原文引用") ==========
        // 正文由 ima-api 正文层提供:PDF 走下载+unpdf 解析缓存,笔记走 notes 接口缓存,冷启动自动建缓存
        let excerpts = [];
        if (knowledge && needsExcerpts(analysis)) {
            excerpts = await extractExcerpts(knowledge.items, buildExcerptKeywords(analysis));
            if (excerpts.length > 0) {
                console.log(`[aquasense] 摘取知识库原文 ${excerpts.length} 条`);
            }
        }
        // ========== 步骤 3:根据严重程度生成建议 ==========
        const immediateActions = [];
        const followUpActions = [];
        const severity = analysis.severity || 'low';
        switch (severity) {
            case 'critical':
                immediateActions.push('🚨 立即通知负责人');
                immediateActions.push('隔离病鱼');
                immediateActions.push('紧急检测水质指标');
                break;
            case 'high':
                immediateActions.push('加强巡塘至每日 3 次');
                immediateActions.push('检测溶氧、氨氮');
                immediateActions.push('减料 50%');
                break;
            case 'medium':
                immediateActions.push('减料 50%');
                immediateActions.push('密切观察 24 小时');
                break;
            default:
                immediateActions.push('保持观察');
        }
        followUpActions.push('持续观察 48 小时');
        followUpActions.push('记录水质变化');
        // ========== 步骤 4:用药建议(知识库仅作参考,具体处方须兽医确认) ==========
        let medication = '暂不需要用药';
        if (analysis.cls === 'disease') {
            // 优先引用正文中治疗/用药相关片段(正文层);无可用正文时退化为标题+摘要参考
            const treatment = excerpts.find((e) => /用药|药浴|泼洒|拌料|消毒|治疗/.test(e.text));
            const hits = knowledge?.items ?? [];
            if (treatment) {
                medication = `建议咨询专业兽医获取针对性用药方案(知识库《${treatment.title}》原文:「${treatment.text}」)`;
            }
            else if (hits.length > 0) {
                const first = hits[0];
                const summary = first.summary ? `;摘要:${first.summary.slice(0, 120)}` : '';
                medication = `建议咨询专业兽医,获取针对性用药方案(知识库参考:《${first.title}》${summary})`;
            }
            else {
                medication = '建议咨询专业兽医,获取针对性用药方案';
            }
        }
        // ========== 步骤 5:确定预警级别(P0/P1/P2,与飞书告警方案一致) ==========
        let alertLevel = 'P2';
        if (analysis.cls === 'disease' && severity === 'critical')
            alertLevel = 'P0';
        else if (analysis.cls === 'disease' || severity === 'high')
            alertLevel = 'P1';
        const symptoms = analysis.symptoms?.length ? analysis.symptoms.join('、') : '无明显症状';
        return {
            diagnosis_summary: `状态:${analysis.cls || 'unknown'},症状:${symptoms}`,
            immediate_actions: immediateActions,
            follow_up_actions: followUpActions,
            medication,
            alert_level: alertLevel,
            knowledge_refs: knowledgeRefs,
            knowledge_excerpt: excerpts.map((e) => `《${e.title}》:「${e.text}」`),
            reasoning: buildReasoning(analysis, excerpts, knowledgeRefs.length)
        };
    }
});
/**
 * 根据分析结果构建知识库查询关键词
 */
function buildKnowledgeQuery(analysis) {
    const keywords = [];
    // 症状关键词
    if (analysis.symptoms?.length) {
        keywords.push(...analysis.symptoms);
    }
    // 疾病类别关键词
    if (analysis.cls === 'disease') {
        keywords.push('疾病', '治疗');
    }
    else if (analysis.cls === 'early') {
        keywords.push('前兆', '预防');
    }
    // 鱼类品种(默认鲈鱼)
    keywords.push('鲈鱼');
    return keywords.join(' ');
}
/** 各通道合并后保留条数:note 命中(正文相关、带高亮)优先,wiki 命中(名称相关,多为 PDF 书名)作补充 */
const NOTE_MERGE_LIMIT = 3;
const WIKI_MERGE_LIMIT = 2;
/** 合并结果总条数上限 */
const MERGED_LIMIT = 5;
/**
 * 合并多关键词、双通道检索结果(IMA 是关键词匹配,多词空格拼接会 0 命中)
 * 双通道:知识库检索仅索引名称(正文词命中为 0),笔记检索索引正文并回带高亮原文。
 * 策略:逐词两路查询 → 各通道按命中词数排序 → note 在前、wiki 在后 → 去重 → 取前 N 条。
 * 去重须同时比对标题:同一篇笔记可能被两路各命中一次(媒体标识不同但标题相同)。
 */
async function searchKnowledgeMerged(rawQuery) {
    // 拆分原始查询为独立关键词,过滤空串和低价值词
    const lowValueWords = new Set(['的', '了', '和', '是', '在', '有', '把', '被']);
    const keywords = rawQuery
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 1 && !lowValueWords.has(w));
    // 去重
    const uniqueKeywords = [...new Set(keywords)];
    if (uniqueKeywords.length === 0)
        uniqueKeywords.push(rawQuery);
    // 逐词两路查询,分别收集命中并统计命中关键词数(单词/单通道失败均不影响整体)
    const wikiHits = new Map();
    const noteHits = new Map();
    for (const kw of uniqueKeywords) {
        try {
            collectHits(await searchKnowledge(kw), wikiHits);
        }
        catch {
            // 忽略:单通道查询失败不阻断另一通道
        }
        try {
            collectHits(await searchNote(kw), noteHits);
        }
        catch {
            // 忽略:单通道查询失败不阻断另一通道
        }
    }
    // 合并去重:note 优先,wiki 补充
    const merged = [];
    const seenIds = new Set();
    const seenTitles = new Set();
    const candidates = [
        ...rankByHits(noteHits).slice(0, NOTE_MERGE_LIMIT),
        ...rankByHits(wikiHits).slice(0, WIKI_MERGE_LIMIT)
    ];
    for (const item of candidates) {
        if (seenIds.has(item.media_id) || seenTitles.has(item.title))
            continue;
        seenIds.add(item.media_id);
        seenTitles.add(item.title);
        merged.push(item);
    }
    return { items: merged.slice(0, MERGED_LIMIT), total: merged.length };
}
/** 累加一次检索结果到命中池(同一标识保留首条,重复命中累加计数) */
function collectHits(result, pool) {
    for (const item of result.items) {
        const existing = pool.get(item.media_id);
        if (existing)
            existing.hits++;
        else
            pool.set(item.media_id, { item, hits: 1 });
    }
}
/** 按命中关键词数降序取出条目 */
function rankByHits(pool) {
    return [...pool.values()].sort((a, b) => b.hits - a.hits).map((entry) => entry.item);
}
// ========== 正文引用:从命中条目正文摘取原文片段(三段式之"原文引用") ==========
/** 单条摘录最大长度(字符) */
const MAX_EXCERPT_CHARS = 240;
/** 无关键词命中时的退化摘录长度(正文开头) */
const FALLBACK_EXCERPT_CHARS = 160;
/** 最多摘取的引用条数(note 高亮直接成引用;其余读正文摘取,不可读的跳过继续向后取) */
const MAX_EXCERPT_DOCS = 2;
/** 是否需要读取正文:有症状或非 normal 状态(disease/early/知识问答)时需要 */
function needsExcerpts(analysis) {
    return (analysis.symptoms?.length ?? 0) > 0 || analysis.cls !== 'normal';
}
/** 摘录定位关键词:症状词优先,叠加类别相关的防治/用药词 */
function buildExcerptKeywords(analysis) {
    const keywords = [...(analysis.symptoms ?? [])];
    if (analysis.cls === 'disease')
        keywords.push('治疗', '用药', '疾病', '防治', '症状');
    else if (analysis.cls === 'early')
        keywords.push('预防', '前兆', '应激', '防治');
    return [...new Set(keywords.filter(Boolean))];
}
/**
 * 读取命中文档正文并摘取相关片段;单条失败不影响整体(容错)。
 * 优先用 note 高亮:高亮即命中处原文,免下载解析,不受扫描件/超限影响。
 * 其余条目读正文:扫描件/超限/无权限笔记返回占位标记(以 [ 开头),只跳过、不提前结束——
 * 排名靠前的命中常是扫描大部头或超限大文件,可读正文可能排在后面,按"只取前 N 条"截断会导致引用长期为空。
 */
async function extractExcerpts(items, keywords) {
    const results = [];
    for (const item of items) {
        if (results.length >= MAX_EXCERPT_DOCS)
            break;
        try {
            // 1. note 命中带高亮:高亮即接口给出的命中处原文,直接作引用
            if (item.highlight) {
                const quote = cleanHighlight(item.highlight, keywords);
                if (quote)
                    results.push({ title: item.title, text: quote });
                continue;
            }
            // 2. 无高亮:读正文摘取(note 命中走 note_id 直读,标识与 media_id 不同)
            const content = item.from === 'note' ? await getNoteContentByNoteId(item.media_id) : await getMediaContent(item.media_id);
            if (!content || content.startsWith('[')) {
                console.log(`[aquasense] 跳过不可读条目(《${item.title}》):${(content || '').slice(0, 60)}`);
                continue;
            }
            const text = extractRelevantSnippet(content, keywords);
            if (text)
                results.push({ title: item.title, text });
        }
        catch (error) {
            console.warn(`[aquasense] 正文读取失败(《${item.title}》):`, error instanceof Error ? error.message : error);
        }
    }
    return results;
}
/**
 * 清理 note 高亮为可展示的引用原文:去 <em> 标记、压缩空白,
 * 超长时围绕命中关键词截断(高亮是接口给出的命中段落,可能含较长上下文)。
 */
function cleanHighlight(html, keywords) {
    const text = cleanupDisplay(html.replace(/<\/?em>/g, ''));
    if (text.length <= MAX_EXCERPT_CHARS)
        return text;
    return truncateAroundKeyword(text, keywords.map((kw) => kw.replace(/\s+/g, '')), MAX_EXCERPT_CHARS);
}
/**
 * 从正文中定位与症状最相关的片段:
 * 按句切分 → 命中关键词最多的句子取前后各一句作上下文 → 限长截断;
 * 无关键词命中时退化为正文开头。导出供测试。
 */
export function extractRelevantSnippet(content, keywords) {
    const normalized = content.replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
    if (!normalized)
        return '';
    const sentences = normalized
        .split(/(?<=[。！？!?;；\n])/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (sentences.length === 0)
        return '';
    // 评分:包含不同关键词的个数,取最高分句
    // PDF 提取的中文常带字间空格(如"烂 鳃"),匹配时统一去空白,保证关键词命中
    const flattened = sentences.map((s) => s.replace(/\s+/g, ''));
    const flatKeywords = keywords.map((kw) => kw.replace(/\s+/g, ''));
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < sentences.length; i++) {
        const score = flatKeywords.filter((kw) => flattened[i].includes(kw)).length;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }
    if (bestIndex < 0) {
        // 无命中:退化为正文开头(限长截断)
        const head = cleanupDisplay(normalized);
        return head.length > FALLBACK_EXCERPT_CHARS ? `${head.slice(0, FALLBACK_EXCERPT_CHARS)}…` : head;
    }
    // 命中句 + 前后各一句上下文;超长时围绕命中关键词截断,保证引用里看得到命中词
    const window = sentences.slice(Math.max(0, bestIndex - 1), Math.min(sentences.length, bestIndex + 2));
    const snippet = cleanupDisplay(window.join(''));
    if (snippet.length <= MAX_EXCERPT_CHARS)
        return snippet;
    return truncateAroundKeyword(snippet, flatKeywords, MAX_EXCERPT_CHARS);
}
/**
 * 超长摘录围绕命中的关键词截断(优先保留命中词附近的上下文)。
 * 关键词语句在技术文档中可能很长,直接从头截会丢掉命中词本身。
 */
function truncateAroundKeyword(text, flatKeywords, max) {
    const flat = text.replace(/\s+/g, '');
    let pos = -1;
    for (const kw of flatKeywords) {
        const i = flat.indexOf(kw);
        if (i >= 0 && (pos < 0 || i < pos))
            pos = i;
    }
    if (pos < 0)
        return `${text.slice(0, max)}…`;
    const start = Math.max(0, pos - Math.floor(max / 3));
    const end = Math.min(text.length, start + max);
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
/** 展示清理:压缩换行,并去除中文/中文标点之间的字间空格(PDF 提取特征"加 工 工 艺"→"加工工艺") */
function cleanupDisplay(text) {
    return text
        .replace(/\n+/g, ' ')
        .replace(/(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\s+(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g, '')
        .trim();
}
/** 三段式之"逻辑推理":说明症状与知识库的比对关系,并声明结论边界(不确诊) */
function buildReasoning(analysis, excerpts, hitCount) {
    const symptoms = analysis.symptoms?.length ? analysis.symptoms.join('、') : '无明显症状';
    if (excerpts.length > 0) {
        const titles = excerpts.map((e) => `《${e.title}》`).join('');
        return `症状「${symptoms}」在知识库${titles}中定位到相关原文(见 knowledge_excerpt);结合视觉分类「${analysis.cls || 'unknown'}」与严重程度「${analysis.severity || 'low'}」按疑似情形处置。知识库比对不构成确诊,重症请兽医到场核实。`;
    }
    if (hitCount > 0) {
        return `知识库命中 ${hitCount} 条相关条目,但正文暂不可读(扫描件/超限或无权限),建议按严重程度先行处置,并人工查阅原文确认。`;
    }
    return `知识库未检索到与「${symptoms}」直接相关的条目,以下建议为通用处置模板,请结合现场情况判断。`;
}
