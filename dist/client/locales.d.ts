/**
 * 配置页文案(命名空间 aquasense-remind,zh/en 双语词典)
 */
/** 字典命名空间(与 Host 侧 API 路径前缀同源) */
export declare const NS = "aquasense-remind";
/** 中文字典 */
export declare const zh: {
    readonly 'card.loading': "加载中…";
    readonly 'card.unavailable': "设置接口不可用,请确认插件已随 Web 界面加载后重试";
    readonly 'card.retry': "重试";
    readonly 'card.saved': "已保存,当日推送计划已重建";
    readonly 'card.saving': "保存中…";
    readonly 'card.save': "保存配置";
    readonly 'card.discard': "放弃修改";
    readonly 'card.test': "发送测试提醒";
    readonly 'card.testing': "发送中…";
    readonly 'card.testSent': "测试提醒已发送,请到飞书群查收";
    readonly 'card.unsavedHint': "有未保存的修改,发送测试提醒前请先保存";
    readonly 'entry.label': "智慧渔业";
    readonly 'page.title': "每日任务提醒";
    readonly 'page.tab.reports': "分析记录";
    readonly 'page.close': "关闭";
    readonly 'field.enabled.label': "启用每日任务提醒";
    readonly 'field.enabled.hint': "关闭后不再推送任务提醒与异常预警";
    readonly 'field.group.label': "推送目标群";
    readonly 'field.group.placeholder': "请选择飞书群(机器人已加入)";
    readonly 'field.group.listFailed': "群列表获取失败:{message}";
    readonly 'field.group.current': "(当前配置)";
    readonly 'field.group.manualHint': "群列表不可用,可直接填写群 chat_id(oc_ 开头)";
    readonly 'field.tasks.label': "任务列表";
    readonly 'field.tasks.hint': "时间格式 HH:MM,最多 {max} 条";
    readonly 'field.tasks.empty': "暂无任务,点击「添加任务」新增";
    readonly 'field.tasks.add': "添加任务";
    readonly 'field.tasks.remove': "删除";
    readonly 'field.tasks.contentPlaceholder': "任务内容(如:投喂饲料并拍照)";
    readonly 'field.tasks.invalid': "第 {index} 条任务非法:请补全时间(HH:MM)与内容";
    readonly 'status.summary': "当日:{planned} 项计划,已推送 {sent} 项,下一项 {next}";
    readonly 'status.summaryDone': "当日:{planned} 项计划已全部推送";
    readonly 'status.summaryIdle': "今日调度未启动(启用并保存后开始)";
};
/** 英文字典(与中文 key 一一对应) */
export declare const en: Record<keyof typeof zh, string>;
/** 配置页文案的 key 联合(LocaleNamespaceMap 合并用) */
export type RemindLocaleKey = keyof typeof zh;
