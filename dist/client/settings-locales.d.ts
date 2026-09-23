/**
 * AquaSense 设置卡片文案(命名空间 aquasense-settings,zh/en 双语词典)
 *
 * 与 Host 侧 settings 命名空间、settings.plugin.item 卡片 key 三者一致;
 * 设置 → 插件 → 插件配置 tab 扫描到命名空间后派发 AquaSettingsCard。
 */
/** 字典命名空间(与 Host 侧 settings 命名空间、卡片 key 三者一致) */
export declare const SETTINGS_NS = "aquasense-settings";
/** 中文字典 */
export declare const zh: {
    readonly 'card.title': "AquaSense 设置";
    readonly 'card.intro': "池号枚举配置:台账白名单、H5 拍照汇报、分析记录筛选统一按此池号生效";
    readonly 'card.unsaved': "未保存";
    readonly 'card.expand': "展开";
    readonly 'card.collapse': "收起";
    readonly 'card.loading': "加载中…";
    readonly 'card.unavailable': "设置接口不可用,请确认插件已随 Web 界面加载后重试";
    readonly 'card.retry': "重试";
    readonly 'card.saved': "已保存,整个插件系统池号已更新";
    readonly 'card.saving': "保存中…";
    readonly 'card.save': "保存配置";
    readonly 'card.discard': "放弃修改";
    readonly 'card.unsavedHint': "有未保存的修改";
    readonly 'field.pools.label': "池号枚举";
    readonly 'field.pools.hint': "按实际养殖池编号填写,最多 {max} 个,每项不超过 {len} 字";
    readonly 'field.pools.add': "添加池号";
    readonly 'field.pools.remove': "删除";
    readonly 'field.pools.placeholder': "如:池1";
    readonly 'field.pools.empty': "至少需要 1 个池号";
    readonly 'field.pools.invalid': "第 {index} 项池号非法:不能为空、不能超过 {len} 字";
    readonly 'field.pools.duplicate': "池号「{name}」重复,已自动去重";
    readonly 'field.userMap.label': "人员映射表";
    readonly 'field.userMap.hint': "配置飞书 open_id 与姓名的映射关系,用于台账自动填充上报人";
    readonly 'field.userMap.chatIdPlaceholder': "输入飞书群 ID";
    readonly 'field.userMap.loadMembers': "加载群成员";
    readonly 'field.userMap.loading': "加载中…";
    readonly 'field.userMap.namePlaceholder': "输入姓名";
    readonly 'field.userMap.nameLabel': "姓名";
    readonly 'field.userMap.remove': "删除";
    readonly 'field.userMap.empty': "暂无映射记录,请通过上方加载群成员或手动添加";
    readonly 'field.userMap.chatMembersHint': "群内共 {count} 人,以下为未添加的成员:";
    readonly 'field.visionModel.label': "视觉模型配置";
    readonly 'field.visionModel.hint': "配置整个养鱼系统的视觉模型,用于图片分析";
    readonly 'field.visionModel.apiKey.label': "API Key";
    readonly 'field.visionModel.apiKey.placeholder': "输入 DeepSeek API Key";
    readonly 'field.visionModel.modelName.label': "模型名称";
    readonly 'field.visionModel.modelName.placeholder': "如:deepseek-flash";
    readonly 'field.visionModel.baseUrl.label': "API 基础 URL";
    readonly 'field.visionModel.baseUrl.placeholder': "如:https://api.deepseek.com";
    readonly 'field.visionModel.test': "测试连接";
    readonly 'field.visionModel.testing': "测试中…";
    readonly 'field.visionModel.testSuccess': "视觉模型配置测试成功";
    readonly 'field.visionModel.testFailed': "视觉模型配置测试失败:{message}";
    readonly 'field.visionModel.testHint': "点击测试按钮验证 API Key 和模型配置是否正确";
};
/** 英文字典(与中文 key 一一对应) */
export declare const en: Record<keyof typeof zh, string>;
/** 设置卡片文案的 key 联合(LocaleNamespaceMap 合并用) */
export type AquaSettingsLocaleKey = keyof typeof zh;
