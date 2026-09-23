/**
 * 消息意图识别路由(场景 S1-S8)
 *
 * 纯函数模块:不注册为 Tool。
 * 在 DSH 消息链路中,由宿主消息层在把消息交给 Agent 前调用(dsh-lark 场景),
 * 或由 Agent 技能(见 skills/aquasense-expert)参考其场景判定结果编排工具调用。
 * S9(每日任务提醒)不经过意图识别——由插件内调度模块(scheduler/s9-reminder.ts)按《每日操作手册》主动触发。
 */
// ─── 领域关键词(飞书渠道:只回答鱼类/RAS 水循环养殖+工程设备+天气相关问题) ───
/** 水产养殖核心关键词——命中任意一个即视为领域内 */
const AQUACULTURE_KEYWORDS = [
    // 鱼类品种与通称
    /鱼|鲈鱼|草鱼|鲫鱼|鲤鱼|鳙鱼|鲢鱼|罗非|虹鳟|鲟鱼|大口鲶|黑鱼|黄颡|鳜鱼|鳗鱼|对虾|虾|蟹|贝|螺|蚌|海参|鲍鱼|扇贝|泥鳅|黄鳝|蛙|鳖|甲鱼|龟/,
    // 养殖场景与设施
    /养殖|鱼塘|鱼池|鱼场|渔场|水产|池塘|网箱|鱼缸|鱼箱|循环水|RAS|工厂化|车间|大棚|温棚|鱼室|养殖池|养殖车间|水循环/,
    // 水质与环境
    /水质|溶氧|溶解氧|氨氮|亚硝酸|pH|酸碱|水色|透明度|水温|棚温|水位|换水|排污|沉淀|过滤|生物滤池|硝化|反硝化|曝气|增氧|气泵|制氧|臭氧|紫外线|杀菌/,
    // 投喂与饲料
    /饲料|投喂|喂食|喂了|吃料|摄食|饵料|开口料|膨化料|颗粒料|料台|残饵|减料|加料|禁食|停食/,
    // 鱼病与用药
    /鱼病|病害|寄生虫|小瓜虫|指环虫|锚头鳋|车轮虫|水霉|烂鳃|肠炎|赤皮|竖鳞|出血|白点|烂身|脱鳞|蹭壁|打粉|白斑|水霉病|出血病|肠炎病|烂鳃病|白点病|白云病|打印病|/,
    /用药|药品|药量|泼洒|拌料|消毒|药物|杀虫|驱虫|抗菌|抗生素|聚维酮碘|二氧化氯|高锰酸钾|硫酸铜|敌百虫|甲苯咪唑|芬苯达唑|恩诺沙星|氟苯尼考|板蓝根|大蒜素|黄芪多糖|/,
    // 解剖与器官
    /解剖|内脏|器官|肝|胆|肠|鳃|脾|鳔|肾|腹腔|肝脏|胆囊|肠道|鱼鳃|鱼肝|鱼肠/,
    // 死亡与异常
    /死亡|死了|死鱼|浮尸|翻白|浮头|白肚|侧翻|失衡|狂游|离群|独游|聚群不动|偷死/,
    // 养殖管理
    /巡检|巡塘|值班|记录|台账|日报|周报|月报|盘点|捞鱼|拉网|分池|并池|转塘|过塘|称重|起捕|出鱼|卖鱼|放苗|放养|鱼苗|鱼种|苗种|夏花|春片|/,
    // 知识询问(与养殖相关)
    /怎么|如何|为什么|是什么|能不能|可以吗|请问|咨询|问题|技术|方法|管理|操作|注意|预防|处理|治疗|改善|调控/,
    // 工程设备与机械
    /微滤机|转鼓|滚筒|机械过滤|篮式过滤|自清洗|紫外线|UV|杀毒|杀菌灯|水泵|潜水泵|离心泵|管道泵|增压泵|罗茨风机|鼓风机|曝气机|空压机|压缩机|臭氧机|制氧机|蛋白分离器|虹吸|管路|阀门|电磁阀|止回阀|流量计|液位计|溶氧仪|电导率|变频|电机|轴承|密封|叶轮|机械密封|设备|机器|故障|维修|保养|检修|配件|型号|参数|功率|扬程|流量|转速/,
    // 天气相关
    /天气|气温|下雨|雨天|晴天|阴天|多云|台风|暴雨|大风|降温|升温|寒潮|高温|低温|闷热|雷电|雷雨|霜冻|下雪|雪天|湿度|风力|风向|预报|气象|季节|夏天|冬天|春天|秋天/,
];
/**
 * 服务器/脚本执行命令黑名单——命中即无论是否养殖相关都一律拒绝。
 * 原因:工人不应通过飞书操控服务器或执行任何系统命令。
 */
const COMMAND_BLOCKLIST = [
    // 服务器操作
    /服务器|重启|关机|开机|重启服务|重启机器|重启插件|重启系统|shutdown|reboot|restart/,
    // 脚本与命令执行
    /脚本|执行脚本|运行脚本|跑脚本|bash|shell|命令行|终端|terminal|cmd|powershell|npm|node |python |pip |apt |yum |docker |kubectl/,
    // 系统管理
    /部署|发布|更新版本|升级|回滚|数据库|redis|mysql|nginx|日志|log|ssh|telnet|远程连接/,
];
/**
 * 判断消息是否命中命令黑名单(服务器重启、脚本执行等一律禁止)。
 */
export function isCommandBlocked(content) {
    const text = content.toLowerCase();
    return COMMAND_BLOCKLIST.some(re => re.test(text));
}
/**
 * 判断消息内容是否属于水产养殖/RAS 水循环养殖+工程设备+天气领域。
 *
 * 匹配策略:内容转小写后逐一比对 AQUACULTURE_KEYWORDS,
 * 命中任意一个关键词即判定为领域内。
 * 带图片的消息默认放行(图片可能包含养殖场景,由视觉模型进一步判断)。
 */
export function isAquacultureRelated(content, hasImage) {
    // 有图片时默认放行——图片可能拍的是鱼塘/水质/鱼体等,交给视觉模型判断
    if (hasImage)
        return true;
    const text = content.toLowerCase();
    return AQUACULTURE_KEYWORDS.some(re => re.test(text));
}
/**
 * 飞书渠道领域过滤入口。
 *
 * 过滤优先级:
 *  1. 命令黑名单(服务器重启/脚本执行) → 无论是否养殖相关都拒绝
 *  2. 领域关键词匹配 → 不在领域内则拒绝
 *  3. 带图片 → 默认放行
 *
 * 调用方拿到 inDomain=false 时,直接把 rejectReply 回复工人,不走后续意图识别。
 */
export function domainFilter(content, hasImage) {
    // 最高优先级:命令黑名单——服务器/脚本操作一律禁止
    if (isCommandBlocked(content)) {
        return {
            inDomain: false,
            rejectReply: '抱歉,该操作已被禁止。如需养殖相关问题咨询,请重新提问。'
        };
    }
    if (isAquacultureRelated(content, hasImage)) {
        return { inDomain: true };
    }
    return {
        inDomain: false,
        rejectReply: '抱歉,我没有回答该问题的权限。如需养殖相关问题咨询,请重新提问。'
    };
}
/**
 * 按关键词优先级识别场景(S4 最高,常规巡检兜底)
 */
export function detectIntent(content, hasImage) {
    const text = content.toLowerCase();
    // S4: 死亡汇报(最高优先级)
    if (text.match(/死亡|死了|死鱼|浮尸|翻白/)) {
        return { scene: 'death', confidence: 0.95, needsImage: false, needsTable: true };
    }
    // S7: 温度汇报
    if (text.match(/水温|棚温|温度|摄氏|度$/)) {
        return { scene: 'temperature', confidence: 0.9, needsImage: false, needsTable: true };
    }
    // S6: 喂食汇报
    if (text.match(/喂食|投喂|吃料|摄食|饲料|喂了|吃了/)) {
        return { scene: 'feeding', confidence: 0.9, needsImage: false, needsTable: true };
    }
    // S5: 药品使用
    if (text.match(/用药|药品|药量|泼洒|拌料|消毒|药物|下了药/)) {
        return { scene: 'medication', confidence: 0.85, needsImage: true, needsTable: true };
    }
    // S8: 解剖汇报
    if (text.match(/解剖|解开了|内脏|器官|肝|胆|肠|鳃|脾|鳔|肾/)) {
        return { scene: 'dissection', confidence: 0.85, needsImage: true, needsTable: true };
    }
    // S1: 水质检测(图片可选,纯文本如 "pH 7.2" 也应路由到水质表)
    if (text.match(/水质|溶氧|氨氮|ph|亚硝酸|水色|透明度/)) {
        return { scene: 'water_quality', confidence: 0.85, needsImage: false, needsTable: true };
    }
    // S3: 知识询问(不保存,仅限纯文本且无图片;有图片时优先路由到对应台账表)
    if (!hasImage && text.match(/怎么|如何|为什么|是什么|能不能|可以吗|请问|咨询|问题/)) {
        return { scene: 'knowledge', confidence: 0.8, needsImage: false, needsTable: false };
    }
    // S2: 巡检(带图默认巡检)
    if (hasImage) {
        return { scene: 'inspection', confidence: 0.7, needsImage: true, needsTable: true };
    }
    // 默认:巡检
    return { scene: 'inspection', confidence: 0.5, needsImage: false, needsTable: true };
}
/**
 * 合并视觉场景提示与文字意图识别:文字关键词优先(语义明确),视觉 scene_hint 兜底(纯图片无文字时生效)。
 *
 * 优先级规则:
 *  - 文字关键词命中且置信度 ≥ 0.85 → 直接采用文字结果(死亡/温度/喂食等确定性高)
 *  - 文字关键词命中但置信度 < 0.85 → 以文字为主,但若视觉 scene_hint 与文字一致则提升置信度
 *  - 无文字关键词匹配(纯图片) → 采用视觉 scene_hint 转换为 Scene
 *  - 视觉 scene_hint 缺失或无效 → 保持巡检兜底
 */
export function detectIntentWithVision(content, hasImage, sceneHint) {
    const textResult = detectIntent(content, hasImage);
    // 有文字且置信度足够高:直接采用文字结果(文字语义明确,视觉仅辅助)
    if (textResult.confidence >= 0.85)
        return textResult;
    // 尝试将视觉 scene_hint 转为 Scene
    const visionScene = sceneHintToScene(sceneHint);
    // 无视觉线索:保持文字结果
    if (!visionScene)
        return textResult;
    // 视觉与文字一致:提升置信度
    if (textResult.scene === visionScene) {
        return { ...textResult, confidence: Math.min(1, textResult.confidence + 0.1) };
    }
    // 视觉与文字不一致:有图片时优先采用视觉场景(如纯图死鱼照场景提示为 death)
    // 无图片时保持文字结果(文字仍有一定依据)
    if (hasImage) {
        return { scene: visionScene, confidence: 0.75, needsImage: true, needsTable: true };
    }
    // 其他情况:保持文字结果
    return textResult;
}
/** 视觉 scene_hint → Scene 映射(inspection 和无效值返回 null,保持兜底) */
function sceneHintToScene(hint) {
    switch (hint) {
        case 'death': return 'death';
        case 'water_quality': return 'water_quality';
        case 'medication': return 'medication';
        case 'feeding': return 'feeding';
        case 'temperature': return 'temperature';
        case 'dissection': return 'dissection';
        default: return null; // inspection 或无效值:不改变路由,保持兜底
    }
}
// ─── 多场景文本检测 ───
/** 可被文本解析器拆分的场景关键词(与 detectIntent 的匹配规则对齐) */
const SCENE_DETECT_PATTERNS = [
    { scene: 'temperature', pattern: /水温|棚温|温度|摄氏/ },
    { scene: 'feeding', pattern: /喂食|投喂|吃料|摄食|饲料|喂了|吃了/ },
    { scene: 'medication', pattern: /用药|药品|药量|泼洒|拌料|消毒|药物|拌药/ },
    { scene: 'water_quality', pattern: /水质|溶氧|氨氮|ph|亚硝酸|水色|透明度/ },
    { scene: 'death', pattern: /死亡|死了|死鱼|浮尸|翻白/ },
    { scene: 'dissection', pattern: /解剖|解开了|内脏|器官|肝|胆|肠|鳃|脾|鳔|肾/ },
];
/**
 * 检测文本是否包含多个场景类型(日报合并文本)
 *
 * 返回命中的场景列表(去重,按优先级排序)。
 * 仅 temperature/feeding/medication 支持程序化拆分;
 * 其他场景(如 death+temperature)返回单场景,由 Agent 正常编排。
 *
 * @returns 命中的可拆分场景列表,0 或 1 个元素表示单场景文本
 */
export function detectMultiScene(content) {
    const text = content.toLowerCase();
    const hitScenes = new Set();
    for (const { scene, pattern } of SCENE_DETECT_PATTERNS) {
        if (pattern.test(text)) {
            hitScenes.add(scene);
        }
    }
    // 仅 temperature/feeding/medication 支持程序化拆分
    const splittable = [];
    for (const s of hitScenes) {
        if (s === 'temperature' || s === 'feeding' || s === 'medication') {
            splittable.push(s);
        }
    }
    return splittable;
}
