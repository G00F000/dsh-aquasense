/**
 * 配置页文案(命名空间 aquasense-remind,zh/en 双语词典)
 */

/** 字典命名空间(与 Host 侧 API 路径前缀同源) */
export const NS = 'aquasense-remind'

/** 中文字典 */
export const zh = {
  'card.loading': '加载中…',
  'card.unavailable': '设置接口不可用,请确认插件已随 Web 界面加载后重试',
  'card.retry': '重试',
  'card.saved': '已保存,当日推送计划已重建',
  'card.saving': '保存中…',
  'card.save': '保存配置',
  'card.discard': '放弃修改',
  'card.test': '发送测试提醒',
  'card.testing': '发送中…',
  'card.testSent': '测试提醒已发送,请到飞书群查收',
  'card.unsavedHint': '有未保存的修改,发送测试提醒前请先保存',
  'entry.label': 'AquaSense 配置',
  'page.title': '每日任务提醒',
  'page.close': '关闭',
  'field.enabled.label': '启用每日任务提醒',
  'field.enabled.hint': '关闭后不再推送任务提醒与异常预警',
  'field.group.label': '推送目标群',
  'field.group.placeholder': '请选择飞书群(机器人已加入)',
  'field.group.listFailed': '群列表获取失败:{message}',
  'field.group.current': '(当前配置)',
  'field.group.manualHint': '群列表不可用,可直接填写群 chat_id(oc_ 开头)',
  'field.tasks.label': '任务列表',
  'field.tasks.hint': '时间格式 HH:MM,最多 {max} 条',
  'field.tasks.empty': '暂无任务,点击「添加任务」新增',
  'field.tasks.add': '添加任务',
  'field.tasks.remove': '删除',
  'field.tasks.contentPlaceholder': '任务内容(如:投喂饲料并拍照)',
  'field.tasks.invalid': '第 {index} 条任务非法:请补全时间(HH:MM)与内容',
  'status.summary': '当日:{planned} 项计划,已推送 {sent} 项,下一项 {next}',
  'status.summaryDone': '当日:{planned} 项计划已全部推送',
  'status.summaryIdle': '今日调度未启动(启用并保存后开始)'
} as const

/** 英文字典(与中文 key 一一对应) */
export const en: Record<keyof typeof zh, string> = {
  'card.loading': 'Loading…',
  'card.unavailable': 'Settings API unavailable — make sure the plugin is loaded in the web UI',
  'card.retry': 'Retry',
  'card.saved': "Saved — today's push plan was rebuilt",
  'card.saving': 'Saving…',
  'card.save': 'Save',
  'card.discard': 'Discard',
  'card.test': 'Send test reminder',
  'card.testing': 'Sending…',
  'card.testSent': 'Test reminder sent — check the Feishu group',
  'card.unsavedHint': 'Unsaved changes — save before sending a test reminder',
  'entry.label': 'AquaSense settings',
  'page.title': 'Daily task reminders',
  'page.close': 'Close',
  'field.enabled.label': 'Enable daily task reminders',
  'field.enabled.hint': 'When off, no task reminders or abnormality alerts are pushed',
  'field.group.label': 'Target group',
  'field.group.placeholder': 'Select a Feishu group (bot must have joined)',
  'field.group.listFailed': 'Failed to load groups: {message}',
  'field.group.current': '(current)',
  'field.group.manualHint': 'Group list unavailable — enter the chat_id (starting with oc_) manually',
  'field.tasks.label': 'Tasks',
  'field.tasks.hint': 'Time format HH:MM, up to {max} tasks',
  'field.tasks.empty': 'No tasks yet — click "Add task"',
  'field.tasks.add': 'Add task',
  'field.tasks.remove': 'Remove',
  'field.tasks.contentPlaceholder': 'Task (e.g. feed and take photos)',
  'field.tasks.invalid': 'Task {index} is invalid — fill in time (HH:MM) and content',
  'status.summary': 'Today: {planned} planned, {sent} pushed, next {next}',
  'status.summaryDone': 'Today: all {planned} planned items pushed',
  'status.summaryIdle': "Today's schedule is not running (enable and save to start)"
}

/** 配置页文案的 key 联合(LocaleNamespaceMap 合并用) */
export type RemindLocaleKey = keyof typeof zh
