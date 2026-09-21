/**
 * AquaSense 设置卡片文案(命名空间 aquasense-settings,zh/en 双语词典)
 *
 * 与 Host 侧 settings 命名空间、settings.plugin.item 卡片 key 三者一致;
 * 设置 → 插件 → 插件配置 tab 扫描到命名空间后派发 AquaSettingsCard。
 */

/** 字典命名空间(与 Host 侧 settings 命名空间、卡片 key 三者一致) */
export const SETTINGS_NS = 'aquasense-settings'

/** 中文字典 */
export const zh = {
  'card.title': 'AquaSense 设置',
  'card.intro': '池号枚举配置:台账白名单、H5 拍照汇报、分析记录筛选统一按此池号生效',
  'card.unsaved': '未保存',
  'card.expand': '展开',
  'card.collapse': '收起',
  'card.loading': '加载中…',
  'card.unavailable': '设置接口不可用,请确认插件已随 Web 界面加载后重试',
  'card.retry': '重试',
  'card.saved': '已保存,整个插件系统池号已更新',
  'card.saving': '保存中…',
  'card.save': '保存配置',
  'card.discard': '放弃修改',
  'card.unsavedHint': '有未保存的修改',
  'field.pools.label': '池号枚举',
  'field.pools.hint': '按实际养殖池编号填写,最多 {max} 个,每项不超过 {len} 字',
  'field.pools.add': '添加池号',
  'field.pools.remove': '删除',
  'field.pools.placeholder': '如:池1',
  'field.pools.empty': '至少需要 1 个池号',
  'field.pools.invalid': '第 {index} 项池号非法:不能为空、不能超过 {len} 字',
  'field.pools.duplicate': '池号「{name}」重复,已自动去重',
  'field.userMap.label': '人员映射表',
  'field.userMap.hint': '配置飞书 open_id 与姓名的映射关系,用于台账自动填充上报人',
  'field.userMap.chatIdPlaceholder': '输入飞书群 ID',
  'field.userMap.loadMembers': '加载群成员',
  'field.userMap.loading': '加载中…',
  'field.userMap.namePlaceholder': '输入姓名',
  'field.userMap.nameLabel': '姓名',
  'field.userMap.remove': '删除',
  'field.userMap.empty': '暂无映射记录,请通过上方加载群成员或手动添加',
  'field.userMap.chatMembersHint': '群内共 {count} 人,以下为未添加的成员:'
} as const

/** 英文字典(与中文 key 一一对应) */
export const en: Record<keyof typeof zh, string> = {
  'card.title': 'AquaSense Settings',
  'card.intro': 'Pool ID enumeration — the ledger whitelist, H5 photo reports and analysis-record filters all follow these pools',
  'card.unsaved': 'Unsaved',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'card.loading': 'Loading…',
  'card.unavailable': 'Settings API unavailable — make sure the plugin is loaded in the web UI',
  'card.retry': 'Retry',
  'card.saved': 'Saved — the pool IDs for the whole plugin system were updated',
  'card.saving': 'Saving…',
  'card.save': 'Save',
  'card.discard': 'Discard',
  'card.unsavedHint': 'Unsaved changes',
  'field.pools.label': 'Pool ID enumeration',
  'field.pools.hint': 'Enter the actual pond IDs, up to {max} entries and {len} characters each',
  'field.pools.add': 'Add pool',
  'field.pools.remove': 'Remove',
  'field.pools.placeholder': 'e.g. Pond 1',
  'field.pools.empty': 'At least 1 pool ID is required',
  'field.pools.invalid': 'Pool {index} is invalid — must be non-empty and at most {len} characters',
  'field.pools.duplicate': 'Pool "{name}" is duplicated and was deduplicated',
  'field.userMap.label': 'User Mapping',
  'field.userMap.hint': 'Configure Feishu open_id to name mappings for automatic ledger reporter filling',
  'field.userMap.chatIdPlaceholder': 'Enter Feishu chat ID',
  'field.userMap.loadMembers': 'Load Members',
  'field.userMap.loading': 'Loading…',
  'field.userMap.namePlaceholder': 'Enter name',
  'field.userMap.nameLabel': 'Name',
  'field.userMap.remove': 'Remove',
  'field.userMap.empty': 'No mappings yet. Load members from chat or add manually above',
  'field.userMap.chatMembersHint': '{count} members in chat. Unadded members shown below:'
}

/** 设置卡片文案的 key 联合(LocaleNamespaceMap 合并用) */
export type AquaSettingsLocaleKey = keyof typeof zh
