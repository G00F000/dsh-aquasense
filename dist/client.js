window.__ModuleLoader__.load({ id: "dsh-aquasense", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let react_dom = require("react-dom");
react_dom = __toESM(react_dom);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/client/api.ts
/**
* 配置页 API 客户端(浏览器侧)
*
* 与 Host 侧 src/web/remind-gateway.ts 的 /aquasense-remind/api 路由对应:
*   get    → { config, status }
*   save   → { config, status }(body: { config })
*   test   → { sent: true }
*   groups → { groups, error? }
* 与 Host 侧 src/web/aqua-settings-gateway.ts 的 /aquasense-settings/api 路由对应:
*   get    → { settings }
*   save   → { settings }(body: { settings })
* 信封协议 { ok, value } / { ok, error: { code, message } }。
*/
/** 配置页 API 前缀(与 Host 侧常量一致) */
const API_PREFIX = "/aquasense-remind/api";
/** AquaSense 设置页 API 前缀(与 Host 侧常量一致) */
const AQUA_SETTINGS_API_PREFIX = "/aquasense-settings/api";
/** 请求失败(信封 error.message 或 HTTP 状态) */
var RemindApiError = class extends Error {};
/** 调用一次 API 并解包信封 */
async function call(prefix, method, body) {
	let response;
	try {
		response = await fetch(`${prefix}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body ?? {})
		});
	} catch (error) {
		throw new RemindApiError(error instanceof Error ? error.message : String(error));
	}
	let envelope;
	try {
		envelope = await response.json();
	} catch {
		throw new RemindApiError(`HTTP ${response.status}`);
	}
	if (!envelope.ok) throw new RemindApiError(envelope.error?.message || `HTTP ${response.status}`);
	return envelope.value;
}
/** 配置页 API 客户端 */
const remindApi = {
	get: () => call(API_PREFIX, "get"),
	save: (input) => call(API_PREFIX, "save", { config: input }),
	test: () => call(API_PREFIX, "test"),
	groups: () => call(API_PREFIX, "groups")
};
/** 设置页 API 客户端 */
const aquaSettingsApi = {
	get: () => call(AQUA_SETTINGS_API_PREFIX, "get"),
	save: (input) => call(AQUA_SETTINGS_API_PREFIX, "save", { settings: input }),
	listChatMembers: (chatId) => call(AQUA_SETTINGS_API_PREFIX, "list-members", { chat_id: chatId })
};

//#endregion
//#region src/client/RemindForm.tsx
/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
const MAX_TASKS = 50;
const formStyle$1 = {
	display: "flex",
	flexDirection: "column"
};
/** 字段容器:字段间补分隔线(对齐 .sh-cfg-f),首字段无分隔线 */
const fieldStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 6,
	padding: "10px 0",
	borderTop: "1px solid var(--dsw-alias-border-l2, #eee)"
};
const fieldFirstStyle = {
	...fieldStyle,
	borderTop: "none"
};
const labelStyle$1 = {
	display: "block",
	fontSize: 13,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary, inherit)"
};
const switchRowStyle = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	cursor: "pointer",
	fontSize: 13,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary, inherit)"
};
const inputStyle$1 = {
	width: "100%",
	height: 34,
	padding: "0 12px",
	fontSize: 13,
	borderRadius: 8,
	border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
	background: "var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-3, #fff))",
	color: "var(--dsw-alias-label-primary, inherit)",
	boxSizing: "border-box",
	fontFamily: "inherit"
};
const taskRowStyle = {
	display: "flex",
	alignItems: "center",
	gap: 8
};
const timeInputStyle = {
	...inputStyle$1,
	width: 104,
	flex: "none"
};
const hintStyle$1 = {
	fontSize: 12,
	color: "var(--dsw-alias-label-caption, #6b7280)",
	margin: 0,
	lineHeight: 1.5
};
const footerStyle$1 = {
	borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
	justifyContent: "flex-end",
	alignItems: "center",
	gap: 8,
	padding: "12px 0 4px",
	display: "flex"
};
/** 按钮基础(对齐 .sh-cfg-ft button) */
const btnBase$1 = {
	appearance: "none",
	font: "inherit",
	cursor: "pointer",
	borderRadius: 8,
	padding: "5px 14px",
	fontSize: 13,
	lineHeight: "20px",
	transition: "background .16s, opacity .16s"
};
/** 次级按钮:透明底 + 描边(对齐 .sh-cfg-disc) */
const ghostBtnStyle$1 = {
	...btnBase$1,
	background: "transparent",
	border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
	color: "var(--dsw-alias-label-secondary, #4b5563)"
};
/** 主按钮(对齐 .sh-cfg-save) */
const primaryBtnStyle$1 = {
	...btnBase$1,
	background: "var(--dsw-alias-button-primary-fill, #111827)",
	border: "1px solid var(--dsw-alias-button-primary-fill, #111827)",
	color: "var(--dsw-alias-label-primary-foreground, #fff)"
};
/** 禁用态透明度(对齐 .sh-cfg-ft button:disabled) */
const DISABLED_OPACITY$1 = .4;
const noticeStyle = {
	color: "var(--dsw-alias-label-caption, #6b7280)",
	margin: "0 0 8px",
	fontSize: 12,
	lineHeight: 1.5
};
const savedStyle$1 = {
	color: "var(--dsw-alias-state-success-primary, #047857)",
	margin: "0 0 8px",
	fontSize: 12,
	lineHeight: 1.5
};
/** 错误文本(对齐 .sh-cfg-err,位于操作行左侧) */
const errorStyle$1 = {
	color: "var(--dsw-alias-state-error-primary, #b91c1c)",
	flex: 1,
	margin: 0,
	fontSize: 12,
	lineHeight: 1.5,
	minWidth: 0
};
/** 取配置快照为可编辑草稿(深拷贝任务数组) */
function toDraft(config) {
	return {
		enabled: config.enabled,
		group: config.group,
		tasks: config.tasks.map((task) => ({ ...task }))
	};
}
/** 查找首条非法任务下标(时间非 HH:MM 或内容为空) */
function findInvalidTask(tasks) {
	for (let index = 0; index < tasks.length; index++) {
		const { time, task } = tasks[index];
		if (!/^\d{2}:\d{2}$/.test(time) || !task.trim()) return index;
	}
	return null;
}
/** 错误信息提取 */
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 配置状态与动作(配置页数据层)。
* @param api - 浏览器半侧 API(经槽位注入面传入)。
* @param t - 词典翻译函数。
* @returns 表单渲染所需的全部状态与动作。
*/
function useRemindConfig(api, t) {
	const [phase, setPhase] = (0, react.useState)("loading");
	const [saved, setSaved] = (0, react.useState)(null);
	const [draft, setDraft] = (0, react.useState)(null);
	const [status, setStatus] = (0, react.useState)(null);
	const [groups, setGroups] = (0, react.useState)([]);
	const [groupsError, setGroupsError] = (0, react.useState)(null);
	const [applyState, setApplyState] = (0, react.useState)({ kind: "idle" });
	const load = (0, react.useCallback)(async () => {
		setPhase("loading");
		setGroups([]);
		setGroupsError(null);
		const [configResult, groupsResult] = await Promise.allSettled([api.get(), api.groups()]);
		if (configResult.status === "fulfilled") {
			const snapshot = toDraft(configResult.value.config);
			setSaved(snapshot);
			setDraft(toDraft(snapshot));
			setStatus(configResult.value.status);
			setApplyState({ kind: "idle" });
			setPhase("ready");
		} else setPhase("unavailable");
		if (groupsResult.status === "fulfilled") {
			setGroups(groupsResult.value.groups);
			setGroupsError(groupsResult.value.error ?? null);
		} else setGroupsError(messageOf$1(groupsResult.reason));
	}, [api]);
	(0, react.useEffect)(() => {
		load();
	}, [load]);
	const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
	const saving = applyState.kind === "saving";
	const testing = applyState.kind === "testing";
	const busy = saving || testing;
	/** 编辑后回到 idle(清除「已保存/已发送」提示,由 dirty 徽标接管) */
	const markEdited = () => {
		setApplyState((state) => state.kind === "idle" ? state : { kind: "idle" });
	};
	const edit = (patch) => {
		setDraft((current) => current ? {
			...current,
			...patch
		} : current);
		markEdited();
	};
	const updateTask = (index, patch) => {
		setDraft((current) => current ? {
			...current,
			tasks: current.tasks.map((task, i) => i === index ? {
				...task,
				...patch
			} : task)
		} : current);
		markEdited();
	};
	const addTask = () => {
		setDraft((current) => current ? {
			...current,
			tasks: [...current.tasks, {
				time: "08:00",
				task: ""
			}]
		} : current);
		markEdited();
	};
	const removeTask = (index) => {
		setDraft((current) => current ? {
			...current,
			tasks: current.tasks.filter((_, i) => i !== index)
		} : current);
		markEdited();
	};
	const save = async () => {
		if (!draft) return;
		const invalid = findInvalidTask(draft.tasks);
		if (invalid !== null) {
			setApplyState({
				kind: "error",
				message: t("field.tasks.invalid", { index: invalid + 1 })
			});
			return;
		}
		setApplyState({ kind: "saving" });
		try {
			const result = await api.save(draft);
			const snapshot = toDraft(result.config);
			setSaved(snapshot);
			setDraft(toDraft(snapshot));
			setStatus(result.status);
			setApplyState({ kind: "saved" });
		} catch (error) {
			setApplyState({
				kind: "error",
				message: messageOf$1(error)
			});
		}
	};
	/** 放弃修改:草稿回滚为已保存快照(对齐 SkillHub「放弃修改」) */
	const discard = () => {
		if (!saved) return;
		setDraft(toDraft(saved));
		setApplyState({ kind: "idle" });
	};
	const sendTest = async () => {
		setApplyState({ kind: "testing" });
		try {
			await api.test();
			setApplyState({ kind: "testSent" });
		} catch (error) {
			setApplyState({
				kind: "error",
				message: messageOf$1(error)
			});
		}
	};
	return {
		phase,
		draft,
		status,
		groups,
		groupsError,
		applyState,
		dirty,
		saving,
		testing,
		busy,
		reload: load,
		edit,
		updateTask,
		addTask,
		removeTask,
		save,
		discard,
		sendTest
	};
}
/**
* 渲染配置表单(加载/不可用/就绪三分支)。
* @param props - model:useRemindConfig 的返回值;t:词典翻译函数。
* @returns 表单元素(不含卡片/页面外壳)。
*/
function RemindForm({ model, t }) {
	const { phase, draft, status, groups, groupsError, applyState, dirty, saving, testing, busy } = model;
	/** 群输入框 id 每实例唯一 */
	const groupInputId = (0, react.useId)();
	if (phase === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		style: noticeStyle,
		role: "status",
		children: t("card.unavailable")
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: footerStyle$1,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			style: ghostBtnStyle$1,
			onClick: () => {
				model.reload();
			},
			children: t("card.retry")
		})
	})] });
	if (phase !== "ready" || !draft) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		style: noticeStyle,
		role: "status",
		children: t("card.loading")
	});
	/** 当日调度状态摘要 */
	const summarize = (value) => {
		if (value.planned === 0) return t("status.summaryIdle");
		if (value.nextTime === null) return t("status.summaryDone", { planned: value.planned });
		return t("status.summary", {
			planned: value.planned,
			sent: value.sent,
			next: value.nextTime
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		applyState.kind === "saved" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: savedStyle$1,
			role: "status",
			children: t("card.saved")
		}) : null,
		applyState.kind === "testSent" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: savedStyle$1,
			role: "status",
			children: t("card.testSent")
		}) : null,
		dirty && !saving ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: noticeStyle,
			children: t("card.unsavedHint")
		}) : null,
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: formStyle$1,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: fieldFirstStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: switchRowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: draft.enabled,
							disabled: busy,
							onChange: (event) => {
								model.edit({ enabled: event.target.checked });
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("field.enabled.label") })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: hintStyle$1,
						children: t("field.enabled.hint")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: fieldStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							style: labelStyle$1,
							htmlFor: groupInputId,
							children: t("field.group.label")
						}),
						groups.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							id: groupInputId,
							style: inputStyle$1,
							value: draft.group,
							disabled: busy,
							onChange: (event) => {
								model.edit({ group: event.target.value });
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("field.group.placeholder")
								}),
								groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: group.chatId,
									children: `${group.name} (${group.chatId})`
								}, group.chatId)),
								draft.group && !groups.some((group) => group.chatId === draft.group) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: draft.group,
									children: `${draft.group} ${t("field.group.current")}`
								}) : null
							]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: groupInputId,
							type: "text",
							style: inputStyle$1,
							value: draft.group,
							disabled: busy,
							placeholder: "oc_xxxxxxxx",
							onChange: (event) => {
								model.edit({ group: event.target.value });
							}
						}),
						groupsError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle$1,
							children: t("field.group.listFailed", { message: groupsError })
						}) : null,
						groups.length === 0 && !groupsError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle$1,
							children: t("field.group.manualHint")
						}) : null
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: fieldStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							style: labelStyle$1,
							children: t("field.tasks.label")
						}),
						draft.tasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle$1,
							children: t("field.tasks.empty")
						}) : null,
						draft.tasks.map((task, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: taskRowStyle,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "time",
									style: timeInputStyle,
									value: task.time,
									disabled: busy,
									onChange: (event) => {
										model.updateTask(index, { time: event.target.value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "text",
									style: {
										...inputStyle$1,
										flex: 1
									},
									value: task.task,
									disabled: busy,
									placeholder: t("field.tasks.contentPlaceholder"),
									onChange: (event) => {
										model.updateTask(index, { task: event.target.value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: {
										...ghostBtnStyle$1,
										flex: "none",
										opacity: busy ? DISABLED_OPACITY$1 : 1
									},
									disabled: busy,
									onClick: () => {
										model.removeTask(index);
									},
									children: t("field.tasks.remove")
								})
							]
						}, index)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { display: "flex" },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...ghostBtnStyle$1,
									opacity: busy || draft.tasks.length >= MAX_TASKS ? DISABLED_OPACITY$1 : 1
								},
								disabled: busy || draft.tasks.length >= MAX_TASKS,
								onClick: model.addTask,
								children: t("field.tasks.add")
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle$1,
							children: t("field.tasks.hint", { max: MAX_TASKS })
						})
					]
				})
			]
		}),
		status ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: {
				...hintStyle$1,
				marginTop: 12
			},
			children: summarize(status)
		}) : null,
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: footerStyle$1,
			children: [
				applyState.kind === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: errorStyle$1,
					role: "status",
					children: applyState.message
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...ghostBtnStyle$1,
						opacity: dirty || busy ? DISABLED_OPACITY$1 : 1
					},
					disabled: dirty || busy,
					onClick: () => {
						model.sendTest();
					},
					children: testing ? t("card.testing") : t("card.test")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...ghostBtnStyle$1,
						opacity: !dirty || busy ? DISABLED_OPACITY$1 : 1
					},
					disabled: !dirty || busy,
					onClick: model.discard,
					children: t("card.discard")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...primaryBtnStyle$1,
						opacity: !dirty || busy ? DISABLED_OPACITY$1 : 1
					},
					disabled: !dirty || busy,
					onClick: () => {
						model.save();
					},
					children: saving ? t("card.saving") : t("card.save")
				})
			]
		})
	] });
}

//#endregion
//#region src/client/TraceRecordList.tsx
const PAGE_LIMIT = 20;
/** 池号兜底枚举(/api/pools 不可用时,与设置页默认一致) */
const FALLBACK_POOLS = [
	"池1",
	"池2",
	"池3",
	"池4"
];
const CLS_OPTIONS = [
	["", "全部状态"],
	["normal", "正常"],
	["early", "前兆"],
	["disease", "发病"],
	["unknown", "未知"]
];
const CLS_LABEL = {
	normal: "normal",
	early: "early",
	disease: "disease",
	unknown: "unknown"
};
const CLS_COLOR = {
	normal: "#52c41a",
	early: "#faad14",
	disease: "#ff4d4f",
	unknown: "#9ca3af"
};
const SOURCE_LABEL = {
	h5_upload: "H5上传",
	group_chat: "群聊发图",
	api: "API"
};
/** 步骤配置 */
const SPAN_DEFS = [
	{
		key: "upload",
		label: "图片上传",
		icon: "📷",
		color: "#8c8c8c",
		field: "span_upload"
	},
	{
		key: "analyze",
		label: "AI 视觉分析",
		icon: "🧠",
		color: "#1677ff",
		field: "span_analyze"
	},
	{
		key: "retrieve",
		label: "知识库检索",
		icon: "📚",
		color: "#fa8c16",
		field: "span_retrieve"
	},
	{
		key: "advice",
		label: "处置建议生成",
		icon: "💡",
		color: "#52c41a",
		field: "span_advice"
	},
	{
		key: "ledger",
		label: "台账写入",
		icon: "📝",
		color: "#722ed1",
		field: "span_ledger"
	}
];
const TRACE_STYLE_ID = "aquasense-trace-style";
/**
* 分析记录页静态样式(类名 trc- 前缀):布局/hover/动画收敛于此;
* 动态颜色(状态色、瀑布图渐变)由内联样式提供。令牌沿用 DSH
* --dsw-alias-* 体系并保留亮色 fallback,兼容宿主暗色主题。
*/
const TRACE_CSS = `
/* 筛选条 */
.trc-filterbar{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);flex-shrink:0;background:var(--dsw-alias-bg-base,#fff)}
.trc-select-wrap{position:relative;display:inline-flex;flex:none;min-width:0}
.trc-select{appearance:none;width:100%;padding:7px 30px 7px 12px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#17191c);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease}
.trc-select:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe)}
.trc-select:focus-visible{outline:none;border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 0 0 3px rgba(77,107,254,.16)}
.trc-select-caret{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary,#7b8088);pointer-events:none}
.trc-count{display:inline-flex;align-items:center;margin-left:auto;padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-secondary,#f0f2f5);color:var(--dsw-alias-label-secondary,#7b8088);font-size:12px;white-space:nowrap;flex:none}
.trc-trend-btn{display:inline-flex;align-items:center;gap:5px;flex:none;padding:7px 14px;border:0;border-radius:10px;background:linear-gradient(135deg,#4d6bfe 0%,#7c5cf6 100%);color:#fff;font:inherit;font-size:13px;font-weight:600;line-height:20px;cursor:pointer;box-shadow:0 4px 14px rgba(77,107,254,.3);transition:box-shadow .18s ease,transform .18s ease,filter .18s ease}
.trc-trend-btn:hover{box-shadow:0 6px 20px rgba(77,107,254,.45);transform:translateY(-1px);filter:saturate(1.12)}
.trc-trend-btn:active{transform:translateY(0);box-shadow:0 2px 8px rgba(77,107,254,.3)}
/* 列表区 */
.trc-list{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px 32px}
.trc-group-title{display:flex;align-items:center;gap:8px;margin:20px 2px 10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-group-title::after{content:'';flex:1;height:1px;background:var(--dsw-alias-border-l2,#e8eaed)}
/* 记录卡片 */
.trc-row{display:block;width:100%;box-sizing:border-box;margin-bottom:10px;padding:14px 16px;text-align:left;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.trc-row:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 8px 24px rgba(77,107,254,.14);transform:translateY(-1px)}
.trc-row:active{transform:translateY(0)}
.trc-line1{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}
.trc-line2{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-dot{flex:none;width:9px;height:9px;border-radius:50%;animation:trc-pulse 2.4s ease-in-out infinite}
@keyframes trc-pulse{0%,100%{opacity:1}50%{opacity:.55}}
.trc-idchip{display:inline-flex;align-items:center;padding:2px 10px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f0f2f5);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 9px;border-radius:999px;font-size:11px;font-weight:700;line-height:18px;flex:none}
.trc-badge-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.trc-symptom{flex:1 1 0;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
/* 空态 / 加载态 / 错误 */
.trc-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:64px 0;text-align:center;color:var(--dsw-alias-label-secondary,#7b8088);font-size:13px}
.trc-empty-icon{font-size:44px;line-height:1;animation:trc-float 3s ease-in-out infinite;filter:drop-shadow(0 6px 12px rgba(77,107,254,.2))}
@keyframes trc-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.trc-spin{width:22px;height:22px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,#e2e4e8);border-top-color:var(--dsw-alias-button-primary-fill,#4d6bfe);animation:trc-spin .7s linear infinite}
@keyframes trc-spin{to{transform:rotate(360deg)}}
.trc-err{margin:4px 0 12px;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-state-error-primary,#ff4d4f);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-state-error-primary,#ff4d4f);font-size:13px}
.trc-more-btn{display:block;width:100%;margin:16px 0 0;padding:10px;border:1px solid transparent;border-radius:12px;background:linear-gradient(var(--dsw-alias-bg-layer-3,#fff),var(--dsw-alias-bg-layer-3,#fff)) padding-box,linear-gradient(135deg,#4d6bfe,#7c5cf6) border-box;color:var(--dsw-alias-button-primary-fill,#4d6bfe);font:inherit;font-size:14px;cursor:pointer;transition:box-shadow .16s ease,transform .16s ease}
.trc-more-btn:hover{box-shadow:0 4px 14px rgba(77,107,254,.18);transform:translateY(-1px)}
/* ===== 详情态 ===== */
.trc-detail{flex:1;overflow:auto;padding:16px 20px 36px;animation:trc-fade-up .28s ease}
@keyframes trc-fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.trc-back{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-button-primary-fill,#4d6bfe);font:inherit;font-size:13px;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease}
.trc-back:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 2px 10px rgba(77,107,254,.14)}
.trc-title{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:15px;font-weight:600;margin-bottom:16px}
.trc-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px}
.trc-meta-item{display:flex;align-items:baseline;gap:8px;min-width:0;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);font-size:13px;transition:border-color .16s ease}
.trc-meta-item:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe)}
.trc-meta-label{flex:none;color:var(--dsw-alias-label-secondary,#7b8088);white-space:nowrap}
.trc-meta-value{color:var(--dsw-alias-label-primary,#17191c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trc-section-title{display:flex;align-items:center;gap:8px;margin:22px 0 12px;font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#17191c)}
.trc-section-title::after{content:'';flex:1;height:1px;background:var(--dsw-alias-border-l2,#e8eaed)}
/* 瀑布图 */
.trc-wf{display:flex;flex-direction:column;gap:6px}
.trc-wf-row{display:flex;align-items:center;gap:10px}
.trc-wf-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border-radius:9px;font-size:14px}
.trc-wf-label{width:110px;flex:none;font-size:12px;color:var(--dsw-alias-label-primary,#17191c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.trc-wf-track{flex:1 1 auto;height:20px;border-radius:999px;background:var(--dsw-alias-bg-secondary,#f0f1f3);position:relative;overflow:hidden}
.trc-wf-bar{position:absolute;top:0;left:0;height:100%;border-radius:999px;transition:width .5s cubic-bezier(.22,.61,.36,1)}
.trc-wf-dur{width:46px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088);text-align:right}
.trc-wf-status{width:20px;flex:none;font-size:12px;text-align:center}
/* 步骤 Accordion */
.trc-steps{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
.trc-step{border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s ease,box-shadow .16s ease}
.trc-step:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 2px 12px rgba(77,107,254,.1)}
.trc-step-head{display:flex;align-items:center;gap:10px;width:100%;padding:11px 14px;border:0;background:transparent;cursor:pointer;font:inherit;font-size:13px;text-align:left;color:var(--dsw-alias-label-primary,#17191c)}
.trc-step-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border-radius:8px;font-size:13px}
.trc-step-arrow{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary,#7b8088);transition:transform .2s ease}
.trc-step-right{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-step-body{padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-secondary,#f9fafb);font-size:13px;animation:trc-fade-up .2s ease}
.trc-step-field{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px}
.trc-step-label{color:var(--dsw-alias-label-secondary,#7b8088);white-space:nowrap}
.trc-step-value{color:var(--dsw-alias-label-primary,#17191c);word-break:break-all;white-space:pre-wrap}
.trc-excerpt{padding:8px 12px;margin-bottom:4px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e8eaed)}
.trc-excerpt-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#17191c);margin-bottom:2px}
.trc-excerpt-meta{font-size:11px;color:var(--dsw-alias-label-secondary,#7b8088);margin-bottom:2px}
.trc-excerpt-text{font-size:12px;color:var(--dsw-alias-label-secondary,#555);font-style:italic}
/* ===== 趋势态 ===== */
.trc-trend-top{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-base,#fff)}
.trc-trend-body{padding:16px 20px 36px;animation:trc-fade-up .28s ease}
.trc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:20px}
.trc-kpi{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.trc-kpi:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 4px 16px rgba(77,107,254,.12);transform:translateY(-1px)}
.trc-kpi-num{font-size:24px;font-weight:700;line-height:1.1}
.trc-kpi-label{font-size:12px;color:var(--dsw-alias-label-secondary,#7b8088)}
.trc-card{padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#e8eaed);border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);margin-bottom:20px}
.trc-bar-row{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px}
.trc-bar-track{flex:1;height:16px;border-radius:999px;background:var(--dsw-alias-bg-secondary,#f0f1f3);overflow:hidden}
.trc-bar{height:100%;border-radius:999px;transition:width .5s cubic-bezier(.22,.61,.36,1)}
.trc-back-link{display:inline-flex;align-items:center;gap:4px;flex:none;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-button-primary-fill,#4d6bfe);font:inherit;font-size:13px;cursor:pointer;transition:background .16s ease}
.trc-back-link:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
/* ===== 现场照片(详情页) ===== */
.trc-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.trc-photo{position:relative;aspect-ratio:1/1;padding:0;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-secondary,#f0f1f3);cursor:zoom-in;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.trc-photo:hover{border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:0 4px 14px rgba(77,107,254,.18);transform:translateY(-1px)}
.trc-photo img{display:block;width:100%;height:100%;object-fit:cover}
.trc-photo-idx{position:absolute;left:6px;bottom:6px;padding:1px 7px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:16px}
.trc-lightbox{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.82);animation:trc-fade-up .18s ease;cursor:zoom-out}
.trc-lightbox img{max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.5)}
.trc-lightbox-close{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:16px;cursor:pointer;transition:background .16s ease}
.trc-lightbox-close:hover{background:rgba(255,255,255,.32)}
.trc-lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer;transition:background .16s ease}
.trc-lightbox-nav:hover{background:rgba(255,255,255,.32)}
.trc-lightbox-nav.prev{left:14px}.trc-lightbox-nav.next{right:14px}
`;
/** 注入分析记录页样式(幂等,SSR 安全) */
function ensureTraceStyle() {
	if (typeof document === "undefined") return;
	let style = document.getElementById(TRACE_STYLE_ID);
	if (!style) {
		style = document.createElement("style");
		style.id = TRACE_STYLE_ID;
		document.head.appendChild(style);
	}
	style.textContent = TRACE_CSS;
}
const S = {
	dot: (cls) => ({
		background: CLS_COLOR[cls] || "#9ca3af",
		boxShadow: `0 0 8px ${CLS_COLOR[cls] || "#9ca3af"}`
	}),
	badge: (cls) => {
		const color = CLS_COLOR[cls] || "#9ca3af";
		return {
			background: color + "1a",
			color,
			boxShadow: `0 0 10px ${color}40`
		};
	},
	wfBar: (color, pct) => ({
		width: `${Math.max(pct, 2)}%`,
		background: `linear-gradient(90deg, ${color}, ${color}b3)`,
		boxShadow: `0 0 10px ${color}66`
	}),
	iconBg: (color) => ({ background: color + "1c" }),
	bar: (color, pct) => ({
		width: `${pct}%`,
		background: `linear-gradient(90deg, ${color}66, ${color})`,
		boxShadow: `0 0 10px ${color}55`
	}),
	barAccent: (pct) => ({
		width: `${pct}%`,
		background: "linear-gradient(90deg, #4d6bfe, #8b5cf6)",
		boxShadow: "0 0 10px rgba(77,107,254,.4)"
	})
};
function dayKey(iso) {
	const d = new Date(iso);
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function dayLabel(iso) {
	const d = new Date(iso);
	const now = /* @__PURE__ */ new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
	if (diff === 0) return `今天 (${d.getMonth() + 1}月${d.getDate()}日)`;
	if (diff === 1) return `昨天 (${d.getMonth() + 1}月${d.getDate()}日)`;
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function timeText(iso) {
	const d = new Date(iso);
	const p = (n) => (n < 10 ? "0" : "") + n;
	return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function durationText(ms) {
	return ms > 0 ? (ms / 1e3).toFixed(1) + "s" : "—";
}
function tokenText(n) {
	return n > 0 ? n.toLocaleString("en-US") : "—";
}
function formatDateTime(iso) {
	const d = new Date(iso);
	const p = (n) => (n < 10 ? "0" : "") + n;
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** Agent 决策链工具元信息(v1.8 详情态区块;未知工具降级灰图标) */
const AGENT_TOOL_META = {
	aquasense_analyze: {
		icon: "🧠",
		label: "AI 视觉分析",
		color: "#1677ff"
	},
	aquasense_advice: {
		icon: "💡",
		label: "处置建议生成",
		color: "#52c41a"
	},
	aquasense_ledger: {
		icon: "📝",
		label: "台账写入",
		color: "#722ed1"
	}
};
/** Agent 决策链区块(v1.8,仅群聊记录;数据来自 DSH 会话事件,agent 缺失时自动隐藏) */
function AgentChain({ agent }) {
	if (!agent || agent.calls.length === 0) return null;
	const total = Math.max(agent.think_ms, ...agent.calls.map((c) => c.duration_ms), 1);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: { marginBottom: 20 },
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-section-title",
				children: ["Agent 决策链", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: {
						fontWeight: 400,
						fontSize: 12,
						color: "var(--dsw-alias-label-secondary,#7b8088)"
					},
					children: [
						"（turn ",
						agent.turn,
						" · step ",
						agent.step,
						" · 会话事件自动记录）"
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-wf",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-wf-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-wf-icon",
							style: S.iconBg("#8c8c8c"),
							children: "🔄"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-wf-label",
							children: "Agent 思考"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "trc-wf-track",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "trc-wf-bar",
								style: S.wfBar("#8c8c8c", agent.think_ms / total * 100)
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-wf-dur",
							children: durationText(agent.think_ms)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-wf-status",
							children: "—"
						})
					]
				}), agent.calls.map((call$1) => {
					const toolMeta = AGENT_TOOL_META[call$1.tool] ?? {
						icon: "🔧",
						label: call$1.tool,
						color: "#9ca3af"
					};
					const summary = formatCallMeta(call$1);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "trc-wf-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-wf-icon",
								style: S.iconBg(toolMeta.color),
								children: toolMeta.icon
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "trc-wf-label",
								children: [toolMeta.label, summary && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										marginLeft: 6,
										fontSize: 11,
										color: "var(--dsw-alias-label-secondary,#7b8088)"
									},
									children: summary
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "trc-wf-track",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "trc-wf-bar",
									style: S.wfBar(call$1.status === "error" ? "#ff4d4f" : toolMeta.color, call$1.duration_ms / total * 100)
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-wf-dur",
								children: durationText(call$1.duration_ms)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-wf-status",
								children: call$1.status === "ok" ? "✅" : "❌"
							})
						]
					}), call$1.attempt > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							margin: "-2px 0 6px 128px",
							fontSize: 11,
							color: "var(--dsw-alias-label-secondary,#7b8088)"
						},
						children: [
							"🔁 第 ",
							call$1.attempt,
							" 次尝试",
							call$1.error_code ? `（前次失败: ${call$1.error_code}）` : "",
							" · call ",
							call$1.call_id
						]
					})] }, `${call$1.call_id}-${call$1.attempt}`);
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					marginTop: 6,
					fontSize: 11,
					color: "var(--dsw-alias-label-secondary,#7b8088)"
				},
				children: "数据来源: DSH 会话事件边界（工具内部 Token/知识库命中明细见下方步骤详情）"
			})
		]
	});
}
/** 格式化单次工具调用的 meta 摘要(显示关键业务字段) */
function formatCallMeta(call$1) {
	const m = call$1.meta;
	if (!m) return "";
	if (call$1.tool === "aquasense_analyze") return [
		m.cls ? String(m.cls) : "",
		typeof m.confidence === "number" ? m.confidence.toFixed(2) : "",
		typeof m.image_count === "number" && m.image_count > 0 ? `${m.image_count}张` : ""
	].filter(Boolean).join(" · ");
	if (call$1.tool === "aquasense_advice") return [m.alert_level ? String(m.alert_level) : "", typeof m.knowledge_refs_count === "number" ? `${m.knowledge_refs_count}条知识` : ""].filter(Boolean).join(" · ");
	if (call$1.tool === "aquasense_ledger") return [m.success === true ? "✅" : m.success === false ? "❌" : "", m.record_id ? String(m.record_id).slice(-8) : ""].filter(Boolean).join(" · ");
	return "";
}
/** 瀑布图：5 个 span 的时间轴可视化 */
function WaterfallChart({ record }) {
	const spans = SPAN_DEFS.map((def) => ({
		...def,
		data: record[def.field],
		duration: record[def.field]?.duration_ms ?? 0
	}));
	const total = record.total_duration_ms || 1;
	if (!spans.some((s) => s.duration > 0)) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: { marginBottom: 20 },
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "trc-section-title",
			children: "瀑布图 · Trace Timeline"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "trc-wf",
			children: spans.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-wf-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "trc-wf-icon",
						style: S.iconBg(s.color),
						children: s.icon
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "trc-wf-label",
						children: s.label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "trc-wf-track",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "trc-wf-bar",
							style: S.wfBar(s.color, s.duration / total * 100)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "trc-wf-dur",
						children: durationText(s.duration)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "trc-wf-status",
						children: s.data?.error ? "❌" : s.duration > 0 ? "✅" : "—"
					})
				]
			}, s.key))
		})]
	});
}
/** 单个步骤 Accordion */
function StepAccordion({ def, record, isOpen, onToggle }) {
	const data = record[def.field];
	const dur = data?.duration_ms ?? 0;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-step",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: "trc-step-head",
			onClick: onToggle,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "trc-step-icon",
					style: S.iconBg(def.color),
					children: def.icon
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: { fontWeight: 600 },
					children: def.label
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "trc-step-right",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: durationText(dur) }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: data?.error ? "❌" : dur > 0 ? "✅" : "—" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-step-arrow",
							style: { transform: isOpen ? "rotate(90deg)" : void 0 },
							children: "▶"
						})
					]
				})
			]
		}), isOpen && data && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "trc-step-body",
			children: renderStepContent(def.key, data, record)
		})]
	});
}
/** 根据步骤类型渲染不同内容 */
function renderStepContent(key, data, record) {
	switch (key) {
		case "upload": return renderUploadStep(data);
		case "analyze": return renderAnalyzeStep(data, record);
		case "retrieve": return renderRetrieveStep(data);
		case "advice": return renderAdviceStep(data);
		case "ledger": return renderLedgerStep(data);
		default: return null;
	}
}
function renderUploadStep(data) {
	const imageCount = data.image_count ?? 0;
	const sizes = data.image_sizes ?? [];
	const compressed = data.compressed_sizes ?? [];
	const names = data.image_names ?? [];
	const err = data.error;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-step-field",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "输入"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [imageCount, " 张图片"]
			}),
			sizes.map((size, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: " "
			}, `k${i}`), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"🐟 ",
					names[i] || `image_${String(i + 1).padStart(3, "0")}`,
					" ",
					"(",
					formatBytes(size),
					compressed[i] ? ` → ${formatBytes(compressed[i])}` : "",
					")"
				]
			}, `v${i}`)] })),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "输出"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [imageCount, " 张图片已压缩并转为 base64"]
			}),
			err && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				style: { color: "#ff4d4f" },
				children: "错误"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				style: { color: "#ff4d4f" },
				children: err
			})] })
		]
	});
}
function renderAnalyzeStep(data, record) {
	const cls = data.cls ?? "unknown";
	const confidence = data.confidence ?? 0;
	const symptoms = data.symptoms ?? [];
	const severity = data.severity ?? "";
	const organs = data.organs ?? [];
	const promptLen = data.prompt_length ?? 0;
	const inputTok = data.input_tokens ?? 0;
	const outputTok = data.output_tokens ?? 0;
	const raw = data.output_raw ?? "";
	const err = data.error;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-step-field",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "模型"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [record?.model || "—", " (temperature=0.1)"]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "输入"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"system prompt (",
					promptLen,
					" chars) + 图片"
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "输出"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"状态: ",
					CLS_LABEL[cls] || cls,
					"（",
					cls,
					"）",
					"\n",
					"置信度: ",
					confidence.toFixed(2),
					"\n",
					"症状: ",
					symptoms.length > 0 ? symptoms.join("、") : "无异常",
					severity ? `\n严重度: ${severity}` : "",
					organs.length > 0 ? `\n器官: ${organs.join("、")}` : ""
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "Token"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"input=",
					tokenText(inputTok),
					" output=",
					tokenText(outputTok)
				]
			}),
			raw && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "原始输出"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: raw
			})] }),
			err && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				style: { color: "#ff4d4f" },
				children: "错误"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				style: { color: "#ff4d4f" },
				children: err
			})] })
		]
	});
}
function renderRetrieveStep(data) {
	const query = data.query ?? "";
	const chA = data.channel_a_wiki ?? 0;
	const chB = data.channel_b_note ?? 0;
	const chC = data.channel_c_pdf ?? 0;
	const merged = data.merged_count ?? 0;
	const excerpts = data.excerpts ?? [];
	const err = data.error;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-step-field",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "查询"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"\"",
					query,
					"\""
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "通道A (wiki)"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"命中 ",
					chA,
					" 条"
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "通道B (note)"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"命中 ",
					chB,
					" 条"
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "通道C (PDF)"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [
					"命中 ",
					chC,
					" 条"
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "合并去重"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [merged, " 条"]
			}),
			excerpts.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "命中条目"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: excerpts.map((ex, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-excerpt",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-excerpt-title",
							children: [
								"📄 《",
								ex.title,
								"》",
								ex.from ? `[${fromLabel(ex.from)}]` : ""
							]
						}),
						ex.locator && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "trc-excerpt-meta",
							children: ex.locator
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-excerpt-text",
							children: [
								"「",
								ex.excerpt_preview,
								"」"
							]
						})
					]
				}, i))
			})] }),
			err && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				style: { color: "#ff4d4f" },
				children: "错误"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				style: { color: "#ff4d4f" },
				children: err
			})] })
		]
	});
}
function renderAdviceStep(data) {
	const alertLevel = data.alert_level ?? "";
	const refsCount = data.knowledge_refs_count ?? 0;
	const diagnosis = data.diagnosis_summary ?? "";
	const reasoning = data.reasoning_preview ?? "";
	const err = data.error;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-step-field",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "预警级别"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: alertLevel || "—"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "知识来源"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-step-value",
				children: [refsCount, " 条"]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "诊断"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: diagnosis || "—"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "推理"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: reasoning || "—"
			}),
			err && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				style: { color: "#ff4d4f" },
				children: "错误"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				style: { color: "#ff4d4f" },
				children: err
			})] })
		]
	});
}
function renderLedgerStep(data) {
	const table = data.target_table ?? "";
	const op = data.operation ?? "";
	const recId = data.record_id ?? "";
	const success = data.success;
	const message = data.message ?? "";
	const err = data.error;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-step-field",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "目标表"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: table || "—"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "操作"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: op === "create" ? "新增" : op === "update" ? "更新" : op || "—"
			}),
			recId && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "记录ID"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: recId
			})] }),
			success !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "结果"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: success ? "✅ 成功" : "❌ 失败"
			})] }),
			message && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				children: "信息"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				children: message
			})] }),
			err && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-label",
				style: { color: "#ff4d4f" },
				children: "错误"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "trc-step-value",
				style: { color: "#ff4d4f" },
				children: err
			})] })
		]
	});
}
/** 知识来源通道名翻译 */
function fromLabel(from) {
	return {
		pdf_content: "PDF",
		note: "笔记",
		wiki: "wiki"
	}[from] || from;
}
/** 字节格式化 */
function formatBytes(bytes) {
	if (bytes < 1024) return bytes + "B";
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
	return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}
function TraceRecordList({ apiBase = "/aquasense-reports", onOpenTrend }) {
	const [records, setRecords] = (0, react.useState)([]);
	(0, react.useEffect)(() => {
		ensureTraceStyle();
	}, []);
	const [total, setTotal] = (0, react.useState)(0);
	const [hasMore, setHasMore] = (0, react.useState)(false);
	const [offset, setOffset] = (0, react.useState)(0);
	const [loading, setLoading] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)(null);
	const [pool, setPool] = (0, react.useState)("");
	const [cls, setCls] = (0, react.useState)("");
	/** 池号枚举(设置页「AquaSense 设置」配置;/api/pools 拉取失败时兜底默认 4 池) */
	const [pools, setPools] = (0, react.useState)(FALLBACK_POOLS);
	const [detailId, setDetailId] = (0, react.useState)(null);
	const [detailRecord, setDetailRecord] = (0, react.useState)(null);
	const [detailLoading, setDetailLoading] = (0, react.useState)(false);
	const [detailError, setDetailError] = (0, react.useState)(null);
	const [openSteps, setOpenSteps] = (0, react.useState)(/* @__PURE__ */ new Set());
	/** 灯箱预览的图片序号(null=关闭) */
	const [previewIndex, setPreviewIndex] = (0, react.useState)(null);
	const fetchPage = (0, react.useCallback)(async (reset) => {
		if (loading) return;
		setLoading(true);
		const off = reset ? 0 : offset;
		try {
			let url = `${apiBase}/api/records?limit=${PAGE_LIMIT}&offset=${off}`;
			if (pool) url += `&pool=${encodeURIComponent(pool)}`;
			if (cls) url += `&cls=${encodeURIComponent(cls)}`;
			let resp;
			try {
				resp = await fetch(url);
			} catch (netErr) {
				throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})\n请求: ${url}`);
			}
			if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}\n请求: ${url}`);
			const body = await resp.json();
			if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败\n请求: ${url}`);
			const page = body.value;
			setRecords(reset ? page.records : [...records, ...page.records]);
			setTotal(page.total);
			setHasMore(page.has_more);
			setOffset((reset ? 0 : offset) + page.records.length);
			setError(null);
		} catch (err) {
			setError(`加载失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setLoading(false);
		}
	}, [
		loading,
		offset,
		pool,
		cls,
		records,
		apiBase
	]);
	const applyFilter = (0, react.useCallback)((newPool, newCls) => {
		setPool(newPool);
		setCls(newCls);
		setRecords([]);
		setOffset(0);
		setHasMore(false);
		setError(null);
		setDetailId(null);
		setDetailRecord(null);
	}, []);
	(0, react.useEffect)(() => {
		if (records.length === 0 && offset === 0 && !loading) fetchPage(true);
	}, [pool, cls]);
	(0, react.useEffect)(() => {
		fetchPage(true);
	}, []);
	(0, react.useEffect)(() => {
		let cancelled = false;
		(async () => {
			try {
				const resp = await fetch(`${apiBase}/api/pools`);
				if (!resp.ok) return;
				const body = await resp.json();
				const value = Array.isArray(body?.value?.pools) ? body.value.pools : [];
				if (!cancelled && value.length > 0) setPools(value.filter((item) => typeof item === "string"));
			} catch {}
		})();
		return () => {
			cancelled = true;
		};
	}, [apiBase]);
	const openDetail = (0, react.useCallback)(async (id) => {
		setDetailId(id);
		setDetailRecord(null);
		setDetailLoading(true);
		setDetailError(null);
		setOpenSteps(/* @__PURE__ */ new Set());
		setPreviewIndex(null);
		try {
			const url = `${apiBase}/api/records/${encodeURIComponent(id)}`;
			let resp;
			try {
				resp = await fetch(url);
			} catch (netErr) {
				throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})\n请求: ${url}`);
			}
			if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}\n请求: ${url}`);
			const body = await resp.json();
			if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败\n请求: ${url}`);
			setDetailRecord(body.value);
		} catch (err) {
			setDetailError(`加载失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setDetailLoading(false);
		}
	}, [apiBase]);
	const backToList = (0, react.useCallback)(() => {
		setDetailId(null);
		setDetailRecord(null);
		setDetailError(null);
		setPreviewIndex(null);
	}, []);
	const toggleStep = (0, react.useCallback)((key) => {
		setOpenSteps((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);
	if (detailId) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-detail",
		children: [
			detailLoading && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-empty",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "trc-spin" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "加载中…" })]
			}),
			detailError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-err",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						whiteSpace: "pre-wrap",
						wordBreak: "break-all"
					},
					children: detailError
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "trc-more-btn",
					style: {
						marginTop: 8,
						width: "auto",
						display: "inline-block",
						padding: "6px 14px",
						fontSize: 13
					},
					onClick: backToList,
					children: "返回列表"
				})]
			}),
			detailRecord && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-title",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "trc-back",
							onClick: backToList,
							children: "← 返回"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-idchip",
							children: detailRecord.id
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { fontWeight: 600 },
							children: detailRecord.pool
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { fontWeight: 600 },
							children: "巡检分析"
						}),
						(() => {
							const cls$1 = detailRecord.span_analyze?.cls ?? "unknown";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "trc-badge",
								style: S.badge(cls$1),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "trc-badge-dot" }), CLS_LABEL[cls$1] || cls$1]
							});
						})()
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-meta-grid",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "池号:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-value",
								children: detailRecord.pool
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "上报人:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-value",
								children: detailRecord.reporter || "—"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "来源:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-value",
								children: SOURCE_LABEL[detailRecord.source] || detailRecord.source
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "时间:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-value",
								children: formatDateTime(detailRecord.created_at)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "总耗时:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-value",
								children: durationText(detailRecord.total_duration_ms)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "模型:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-value",
								children: detailRecord.model || "—"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							style: { gridColumn: "1 / -1" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "Token:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "trc-meta-value",
								children: [
									"input=",
									tokenText(detailRecord.span_analyze?.input_tokens ?? 0),
									" output=",
									tokenText(detailRecord.span_analyze?.output_tokens ?? 0)
								]
							})]
						}),
						detailRecord.agent && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-meta-item",
							style: { gridColumn: "1 / -1" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-meta-label",
								children: "Agent:"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "trc-meta-value",
								children: [
									"turn ",
									detailRecord.agent.turn,
									" · step ",
									detailRecord.agent.step,
									" · 工具 ",
									detailRecord.agent.calls.length,
									" 次",
									(() => {
										const retries = detailRecord.agent.calls.reduce((n, c) => n + Math.max(0, c.attempt - 1), 0);
										return retries > 0 ? ` · 重试 ${retries} 次` : "";
									})()
								]
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentChain, { agent: detailRecord.agent }),
				detailRecord.images && detailRecord.images.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { marginBottom: 20 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "trc-section-title",
						children: [
							"现场照片 · ",
							detailRecord.images.length,
							" 张"
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "trc-photos",
						children: detailRecord.images.map((img, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "trc-photo",
							onClick: () => {
								setPreviewIndex(i);
							},
							"aria-label": `查看第 ${i + 1} 张现场照片`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: img.url,
								alt: `现场照片 ${i + 1}`,
								loading: "lazy"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-photo-idx",
								children: i + 1
							})]
						}, img.index))
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WaterfallChart, { record: detailRecord }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "trc-section-title",
					children: "步骤详情"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "trc-steps",
					children: SPAN_DEFS.map((def) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StepAccordion, {
						def,
						record: detailRecord,
						isOpen: openSteps.has(def.key),
						onToggle: () => {
							toggleStep(def.key);
						}
					}, def.key))
				})
			] }),
			previewIndex !== null && detailRecord?.images && detailRecord.images[previewIndex] && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-lightbox",
				role: "dialog",
				"aria-modal": "true",
				onClick: () => {
					setPreviewIndex(null);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "trc-lightbox-close",
						onClick: (e) => {
							e.stopPropagation();
							setPreviewIndex(null);
						},
						"aria-label": "关闭预览",
						children: "✕"
					}),
					previewIndex > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "trc-lightbox-nav prev",
						onClick: (e) => {
							e.stopPropagation();
							setPreviewIndex(previewIndex - 1);
						},
						"aria-label": "上一张",
						children: "‹"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						src: detailRecord.images[previewIndex].url,
						alt: `现场照片 ${previewIndex + 1}`,
						onClick: (e) => {
							e.stopPropagation();
						}
					}),
					previewIndex < detailRecord.images.length - 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "trc-lightbox-nav next",
						onClick: (e) => {
							e.stopPropagation();
							setPreviewIndex(previewIndex + 1);
						},
						"aria-label": "下一张",
						children: "›"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							position: "absolute",
							bottom: 16,
							left: "50%",
							transform: "translateX(-50%)",
							color: "rgba(255,255,255,.85)",
							fontSize: 13
						},
						children: [
							previewIndex + 1,
							" / ",
							detailRecord.images.length
						]
					})
				]
			})
		]
	});
	const groups = [];
	let lastKey = "";
	for (const r of records) {
		const key = dayKey(r.created_at);
		if (key !== lastKey) {
			groups.push({
				title: dayLabel(r.created_at),
				items: []
			});
			lastKey = key;
		}
		groups[groups.length - 1].items.push(r);
	}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-filterbar",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-select-wrap",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
					className: "trc-select",
					value: pool,
					onChange: (e) => {
						applyFilter(e.target.value, cls);
					},
					"aria-label": "按池号筛选",
					children: ["", ...pools].map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: p,
						children: p || "全部池号"
					}, p))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "trc-select-caret",
					children: "▾"
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-select-wrap",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
					className: "trc-select",
					value: cls,
					onChange: (e) => {
						applyFilter(pool, e.target.value);
					},
					"aria-label": "按状态筛选",
					children: CLS_OPTIONS.map(([v, l]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: v,
						children: l
					}, v))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "trc-select-caret",
					children: "▾"
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "trc-count",
				children: [total, " 条记录"]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "trc-trend-btn",
				onClick: () => {
					const targetPool = pool || pools[0] || "池1";
					onOpenTrend?.(targetPool);
				},
				children: "📈 池号趋势分析 →"
			})
		]
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-list",
		children: [
			error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-err",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						whiteSpace: "pre-wrap",
						wordBreak: "break-all"
					},
					children: error
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "trc-more-btn",
					style: {
						marginTop: 8,
						width: "auto",
						display: "inline-block",
						padding: "6px 14px",
						fontSize: 13
					},
					onClick: () => {
						fetchPage(true);
					},
					children: "重试"
				})]
			}),
			!error && records.length === 0 && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-empty",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "trc-empty-icon",
					children: "🐟"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "暂无分析记录" })]
			}),
			loading && records.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "trc-empty",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "trc-spin" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "加载中…" })]
			}),
			groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "trc-group-title",
				children: g.title
			}), g.items.map((r) => {
				const clsName = CLS_LABEL[r.cls] || r.cls || "未知";
				const sym = r.symptoms?.length ? r.symptoms.join("、") : "无异常";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "trc-row",
					onClick: () => {
						openDetail(r.id);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "trc-line1",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-dot",
								style: S.dot(r.cls)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-idchip",
								children: r.id
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { fontWeight: 600 },
								children: r.pool
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "trc-badge",
								style: S.badge(r.cls),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "trc-badge-dot" }), clsName]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									color: "var(--dsw-alias-label-secondary,#7b8088)",
									fontSize: 12
								},
								children: (r.confidence || 0).toFixed(2)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-symptom",
								style: { color: r.cls === "disease" ? "#ff4d4f" : "var(--dsw-alias-label-secondary,#7b8088)" },
								children: sym
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "trc-line2",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: timeText(r.created_at) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: SOURCE_LABEL[r.source || ""] || r.source }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							r.agent_retries !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "trc-badge",
								style: {
									background: "#4d6bfe1a",
									color: "#4d6bfe",
									fontWeight: 600
								},
								children: "Agent链路"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: r.alert_level ? "AI视觉+知识库" : "AI视觉" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: durationText(r.total_duration_ms) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							r.agent_retries !== void 0 && r.agent_retries > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								"🔁 ",
								(r.agent_retry_tool || "tool").replace(/^aquasense_/, ""),
								" ×",
								r.agent_retries
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [tokenText(r.total_tokens), " tokens"] })
						]
					})]
				}, r.id);
			})] }, g.title)),
			hasMore && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "trc-more-btn",
				onClick: () => {
					fetchPage(false);
				},
				children: "加载更多"
			}),
			loading && records.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "trc-empty",
				style: { padding: "20px 0" },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "trc-spin" })
			})
		]
	})] });
}
function TraceTrendView({ pool: initPool, apiBase = "/aquasense-reports", onBack }) {
	const [pool, setPool] = (0, react.useState)(initPool);
	const [pools, setPools] = (0, react.useState)([initPool]);
	const [data, setData] = (0, react.useState)(null);
	const [loading, setLoading] = (0, react.useState)(true);
	const [error, setError] = (0, react.useState)(null);
	const [days, setDays] = (0, react.useState)(7);
	(0, react.useEffect)(() => {
		const apply$1 = (list) => {
			if (list.length === 0) return;
			setPools((current) => {
				const next = [...list];
				if (!next.includes(initPool)) next.unshift(initPool);
				return next.length > 0 ? next : current;
			});
		};
		fetch(`${apiBase}/api/pools`).then((r) => r.ok ? r.json() : null).then((b) => {
			if (b?.ok && Array.isArray(b.value?.pools) && b.value.pools.length > 0) {
				apply$1(b.value.pools.filter((p) => typeof p === "string"));
				return null;
			}
			return fetch(`${apiBase}/api/records`).then((r) => r.ok ? r.json() : null).then((b2) => {
				if (!b2?.ok) return;
				const recs = b2.value || [];
				const poolSet = /* @__PURE__ */ new Set();
				recs.forEach((r) => poolSet.add(r.pool));
				if (poolSet.size > 0) apply$1(Array.from(poolSet).sort());
			});
		}).catch(() => {});
	}, [apiBase, initPool]);
	(0, react.useEffect)(() => {
		setLoading(true);
		setError(null);
		fetch(`${apiBase}/api/trend/${encodeURIComponent(pool)}?days=${days}`).then((resp) => {
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			return resp.json();
		}).then((body) => {
			if (!body?.ok) throw new Error(body?.error?.message || "请求失败");
			setData(body.value);
		}).catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false));
	}, [
		pool,
		days,
		apiBase
	]);
	if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "trc-empty",
		style: { flex: 1 },
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "trc-spin" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "加载中…" })]
	});
	if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			padding: 20,
			color: "#ff4d4f"
		},
		children: ["加载失败: ", error]
	});
	if (!data) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: {
			padding: 20,
			color: "var(--dsw-alias-label-secondary,#7b8088)"
		},
		children: "无数据"
	});
	const dist = data.distribution || {};
	const total = data.total || 0;
	const distOrder = [
		[
			"normal",
			"正常",
			"#52c41a"
		],
		[
			"early",
			"前兆",
			"#faad14"
		],
		[
			"disease",
			"发病",
			"#ff4d4f"
		],
		[
			"unknown",
			"未知",
			"#9ca3af"
		]
	];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			flex: 1,
			overflow: "auto"
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "trc-trend-top",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "trc-back-link",
					onClick: onBack,
					children: "← 返回列表"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "trc-select-wrap",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
						className: "trc-select",
						style: { fontWeight: 600 },
						value: pool,
						onChange: (e) => setPool(e.target.value),
						children: pools.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: p,
							children: p
						}, p))
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "trc-select-caret",
						children: "▾"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						fontSize: 14,
						fontWeight: 600
					},
					children: "趋势分析"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: { marginLeft: "auto" },
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "trc-select-wrap",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "trc-select",
							style: { fontSize: 12 },
							value: days,
							onChange: (e) => setDays(Number(e.target.value)),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: 7,
									children: "近7天"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: 30,
									children: "近30天"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: 3650,
									children: "全部"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-select-caret",
							children: "▾"
						})]
					})
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "trc-trend-body",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-kpis",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "trc-kpi",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-kpi-num",
							style: { color: "var(--dsw-alias-label-primary,#17191c)" },
							children: total
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "trc-kpi-label",
							children: [
								"近 ",
								days,
								" 天分析记录"
							]
						})]
					}), distOrder.slice(0, 3).map(([key, label, color]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "trc-kpi",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-kpi-num",
							style: { color },
							children: dist[key] || 0
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "trc-kpi-label",
							children: label
						})]
					}, key))]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-card",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "trc-section-title",
						style: { margin: "0 0 12px" },
						children: "状态分布"
					}), total > 0 ? distOrder.map(([key, label, color]) => {
						const n = dist[key] || 0;
						const pct = Math.round(n / total * 100);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-bar-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										width: 48,
										flexShrink: 0
									},
									children: label
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "trc-bar-track",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "trc-bar",
										style: S.bar(color, pct)
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										width: 96,
										textAlign: "right",
										fontSize: 12,
										color: "var(--dsw-alias-label-secondary,#7b8088)",
										flexShrink: 0
									},
									children: [
										pct,
										"% (",
										n,
										"次)"
									]
								})
							]
						}, key);
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							color: "var(--dsw-alias-label-secondary,#7b8088)",
							fontSize: 13
						},
						children: "暂无数据"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-card",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "trc-section-title",
						style: { margin: "0 0 12px" },
						children: "症状频次 TOP"
					}), data.top_symptoms.length > 0 ? (() => {
						const max = data.top_symptoms[0]?.count || 1;
						return data.top_symptoms.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "trc-bar-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										width: 80,
										flexShrink: 0,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap"
									},
									children: s.symptom
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "trc-bar-track",
									style: { height: 14 },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "trc-bar",
										style: S.barAccent(Math.round(s.count / max * 100))
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										width: 44,
										textAlign: "right",
										fontSize: 12,
										color: "var(--dsw-alias-label-secondary,#7b8088)",
										flexShrink: 0
									},
									children: [s.count, "次"]
								})
							]
						}, s.symptom));
					})() : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							color: "var(--dsw-alias-label-secondary,#7b8088)",
							fontSize: 13
						},
						children: "暂无异常症状记录"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "trc-card",
					style: { marginBottom: 0 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "trc-section-title",
						style: { margin: "0 0 4px" },
						children: "最近记录"
					}), data.recent_records.length > 0 ? data.recent_records.map((r) => {
						const sym = r.symptoms?.length ? r.symptoms.join("、") : "无异常";
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "8px 0",
								borderBottom: "1px solid var(--dsw-alias-border-l2,#e8eaed)",
								fontSize: 13
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										width: 44,
										flexShrink: 0,
										color: "var(--dsw-alias-label-secondary,#7b8088)",
										fontSize: 12
									},
									children: timeText(r.created_at)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "trc-badge",
									style: S.badge(r.cls),
									children: CLS_LABEL[r.cls] || r.cls
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										width: 36,
										flexShrink: 0,
										color: "var(--dsw-alias-label-secondary,#7b8088)",
										fontSize: 12
									},
									children: (r.confidence || 0).toFixed(2)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										flex: 1,
										minWidth: 0,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										color: "var(--dsw-alias-label-secondary,#7b8088)"
									},
									children: sym
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										flexShrink: 0,
										color: "var(--dsw-alias-label-secondary,#7b8088)",
										fontSize: 12
									},
									children: durationText(r.total_duration_ms)
								})
							]
						}, r.id);
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: 20,
							textAlign: "center",
							color: "var(--dsw-alias-label-secondary,#7b8088)"
						},
						children: "暂无记录"
					})]
				})
			]
		})]
	});
}

//#endregion
//#region src/client/AquaConfig.tsx
/** 非当前页签内容的隐藏样式(保留挂载:不丢表单草稿与列表页滚动/筛选状态) */
const HIDDEN = { display: "none" };
const STYLE_ID = "aquasense-config-style";
/**
* 入口与配置页样式(类名 aqs- 前缀,令牌与尺寸对齐 SkillHub 的
* .sh-plaza-trigger / .sh-plaza-page / .sh-plaza-close 体系)。
*/
const CSS = `
.aqs-wrap{width:100%}
.aqs-wrap.rail{display:flex;justify-content:center}
/* 宿主页脚动作容器:默认单行 flex(nowrap),多个整宽条目并排会互相挤压;
   允许换行使各条目独占整行(与设置行堆叠)。 */
div:has(> [data-slot="sidebar.footer.action"]){flex-wrap:wrap}
.aqs-trigger{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.aqs-wrap.rail .aqs-trigger{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.aqs-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.aqs-trigger.on,.aqs-trigger[aria-expanded=true]{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}
.aqs-ico{flex:none;display:block;width:16px;height:16px}
.aqs-wrap.rail .aqs-ico{width:18px;height:18px}
.aqs-txt{white-space:nowrap;overflow:hidden}
.aqs-page{position:fixed;z-index:40;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#17191c);box-shadow:0 12px 40px rgba(15,23,42,.14),0 0 0 1px var(--dsw-alias-border-l2,#e2e4e8)}
.aqs-top{display:flex;align-items:center;gap:12px;flex:none;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:linear-gradient(180deg,rgba(77,107,254,.06),rgba(77,107,254,0) 56px) var(--dsw-alias-bg-base,#fff)}
/* 顶栏页签组：「每日任务提醒」与「📊 分析记录」（入口 C，R8 需求 v1.3）为同页
   切换的两个页签（role=tablist，样式对齐 SkillHub 插件广场「插件 / 技能」），
   后者在面板内容区以 React 组件直调 API 展示（去 iframe 化），不新开标签页 */
.aqs-tabs{display:flex;align-items:center;gap:2px;min-width:0}
.aqs-tab{position:relative;display:flex;align-items:center;gap:4px;padding:6px 10px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;transition:background .16s ease,color .16s ease}
.aqs-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on{color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on::after{content:'';position:absolute;left:10px;right:10px;bottom:1px;height:2.5px;border-radius:999px;background:linear-gradient(90deg,var(--dsw-alias-button-primary-fill,#4d6bfe),#8b5cf6)}
.aqs-close{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary,#4b5563);transition:background .16s ease,border-color .16s ease,color .16s ease}
.aqs-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);border-color:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-body{flex:1;min-height:0;overflow:auto;padding:18px 20px 32px}
/* 分析记录页签:内容区去掉内边距,React 组件铺满(自带筛选条与滚动) */
.aqs-body.flush{display:flex;flex-direction:column;padding:0;overflow:hidden}
.aqs-reports{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.aqs-form{max-width:760px}
`;
/** 注入入口/配置页样式(幂等;返回无操作清理器以适配 ctx.effect) */
function ensureAquaConfigStyle() {
	if (typeof document === "undefined") return () => {};
	let style = document.getElementById(STYLE_ID);
	if (!style) {
		style = document.createElement("style");
		style.id = STYLE_ID;
		document.head.appendChild(style);
	}
	style.textContent = CSS;
	return () => {};
}
/** 会话列根节点(SkillHub 同款定位锚点) */
function conversationRoot() {
	return typeof document === "undefined" ? null : document.querySelector("[data-phase]");
}
/** 会话列矩形;无会话列时回退整窗(配置页不受会话状态限制) */
function overlayBox() {
	const root = conversationRoot();
	if (root) {
		const rect = root.getBoundingClientRect();
		return {
			top: rect.top,
			left: rect.left,
			width: rect.width,
			height: rect.height
		};
	}
	return {
		top: 0,
		left: 0,
		width: window.innerWidth,
		height: window.innerHeight
	};
}
/** 跟踪会话列矩形(展开时随尺寸/滚动变化更新) */
function useOverlayBox(active) {
	const [box, setBox] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		if (!active) {
			setBox(null);
			return;
		}
		const update = () => {
			setBox(overlayBox());
		};
		update();
		const root = conversationRoot();
		const observer = root && typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
		if (root && observer) observer.observe(root);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			if (observer) observer.disconnect();
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [active]);
	return box;
}
/** 配置页(portal 内容):二级标题 + 右上角关闭 + 共享表单 */
function AquaConfigPage({ box, t, api, onClose }) {
	const model = useRemindConfig(api, t);
	const [tab, setTab] = (0, react.useState)("remind");
	const [reportsOn, setReportsOn] = (0, react.useState)(false);
	const [trendPool, setTrendPool] = (0, react.useState)("");
	(0, react.useEffect)(() => {
		const onKey = (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
		};
	}, [onClose]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "aqs-page",
		role: "dialog",
		"aria-modal": "false",
		"aria-label": t("page.title"),
		style: {
			top: box.top,
			left: box.left,
			width: box.width,
			height: box.height
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "aqs-top",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "aqs-tabs",
				role: "tablist",
				"aria-label": t("page.title"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					role: "tab",
					className: "aqs-tab" + (tab === "remind" ? " on" : ""),
					"aria-selected": tab === "remind",
					onClick: () => {
						setTab("remind");
					},
					children: t("page.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					role: "tab",
					className: "aqs-tab" + (tab === "reports" ? " on" : ""),
					"aria-selected": tab === "reports",
					onClick: () => {
						setReportsOn(true);
						setTab("reports");
					},
					children: ["📊 ", t("page.tab.reports")]
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "aqs-close",
				onClick: onClose,
				"aria-label": t("page.close"),
				title: t("page.close"),
				children: "×"
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "aqs-body" + (tab === "reports" || tab === "trend" ? " flush" : ""),
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "aqs-form",
					style: tab === "remind" ? void 0 : HIDDEN,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemindForm, {
						model,
						t
					})
				}),
				reportsOn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "aqs-reports",
					style: tab === "reports" ? void 0 : HIDDEN,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TraceRecordList, { onOpenTrend: (pool) => {
						setTrendPool(pool);
						setTab("trend");
					} })
				}) : null,
				tab === "trend" && trendPool ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "aqs-reports",
					style: {
						width: "100%",
						height: "100%"
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TraceTrendView, {
						pool: trendPool,
						onBack: () => {
							setTab("reports");
						}
					})
				}) : null
			]
		})]
	});
}
/**
* 入口图标:三道水波线性 SVG,规格与插件广场入口图标(PlazaIcon)同风格——
* 16×16 视窗、无填充、描边取 currentColor、strokeWidth 1.4,
* 随按钮文字色与悬停/展开态自动着色(尺寸档由 .aqs-ico 控制)。
* @returns 图标元素。
*/
function WavesIcon() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
		className: "aqs-ico",
		viewBox: "0 0 16 16",
		fill: "none",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M1.7 4c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M1.7 8c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M1.7 12c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round"
			})
		]
	});
}
/**
* 渲染侧栏页脚入口:触发器 + (展开时)配置页 portal。
* @param props - owner 共享位(wide)+ locale 座位(t)+ 注入面(api)。
* @returns 入口元素。
*/
function AquaConfigEntry({ wide, t, api }) {
	(0, react.useEffect)(() => {
		ensureAquaConfigStyle();
	}, []);
	const [open, setOpen] = (0, react.useState)(false);
	const box = useOverlayBox(open);
	const close = (0, react.useCallback)(() => {
		setOpen(false);
	}, []);
	(0, react.useEffect)(() => {
		if (!open) return;
		const onPointer = (event) => {
			const target = event.target;
			if (target instanceof Element && target.closest(".aqs-page, .aqs-wrap")) return;
			close();
		};
		document.addEventListener("pointerdown", onPointer, true);
		return () => {
			document.removeEventListener("pointerdown", onPointer, true);
		};
	}, [open, close]);
	const panel = open && box && typeof document !== "undefined" ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AquaConfigPage, {
		box,
		t,
		api,
		onClose: close
	}), document.body) : null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "aqs-wrap" + (wide ? "" : " rail"),
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: "aqs-trigger" + (open ? " on" : ""),
			"aria-label": t("entry.label"),
			"aria-expanded": open,
			onClick: () => {
				setOpen((value) => !value);
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WavesIcon, {}), wide ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "aqs-txt",
				children: t("entry.label")
			}) : null]
		}), panel]
	});
}

//#endregion
//#region src/client/locales.ts
/**
* 配置页文案(命名空间 aquasense-remind,zh/en 双语词典)
*/
/** 字典命名空间(与 Host 侧 API 路径前缀同源) */
const NS = "aquasense-remind";
/** 中文字典 */
const zh = {
	"card.loading": "加载中…",
	"card.unavailable": "设置接口不可用,请确认插件已随 Web 界面加载后重试",
	"card.retry": "重试",
	"card.saved": "已保存,当日推送计划已重建",
	"card.saving": "保存中…",
	"card.save": "保存配置",
	"card.discard": "放弃修改",
	"card.test": "发送测试提醒",
	"card.testing": "发送中…",
	"card.testSent": "测试提醒已发送,请到飞书群查收",
	"card.unsavedHint": "有未保存的修改,发送测试提醒前请先保存",
	"entry.label": "智慧渔业",
	"page.title": "每日任务提醒",
	"page.tab.reports": "分析记录",
	"page.close": "关闭",
	"field.enabled.label": "启用每日任务提醒",
	"field.enabled.hint": "关闭后不再推送任务提醒与异常预警",
	"field.group.label": "推送目标群",
	"field.group.placeholder": "请选择飞书群(机器人已加入)",
	"field.group.listFailed": "群列表获取失败:{message}",
	"field.group.current": "(当前配置)",
	"field.group.manualHint": "群列表不可用,可直接填写群 chat_id(oc_ 开头)",
	"field.tasks.label": "任务列表",
	"field.tasks.hint": "时间格式 HH:MM,最多 {max} 条",
	"field.tasks.empty": "暂无任务,点击「添加任务」新增",
	"field.tasks.add": "添加任务",
	"field.tasks.remove": "删除",
	"field.tasks.contentPlaceholder": "任务内容(如:投喂饲料并拍照)",
	"field.tasks.invalid": "第 {index} 条任务非法:请补全时间(HH:MM)与内容",
	"status.summary": "当日:{planned} 项计划,已推送 {sent} 项,下一项 {next}",
	"status.summaryDone": "当日:{planned} 项计划已全部推送",
	"status.summaryIdle": "今日调度未启动(启用并保存后开始)"
};
/** 英文字典(与中文 key 一一对应) */
const en = {
	"card.loading": "Loading…",
	"card.unavailable": "Settings API unavailable — make sure the plugin is loaded in the web UI",
	"card.retry": "Retry",
	"card.saved": "Saved — today's push plan was rebuilt",
	"card.saving": "Saving…",
	"card.save": "Save",
	"card.discard": "Discard",
	"card.test": "Send test reminder",
	"card.testing": "Sending…",
	"card.testSent": "Test reminder sent — check the Feishu group",
	"card.unsavedHint": "Unsaved changes — save before sending a test reminder",
	"entry.label": "Smart Fishery",
	"page.title": "Daily task reminders",
	"page.tab.reports": "Analysis records",
	"page.close": "Close",
	"field.enabled.label": "Enable daily task reminders",
	"field.enabled.hint": "When off, no task reminders or abnormality alerts are pushed",
	"field.group.label": "Target group",
	"field.group.placeholder": "Select a Feishu group (bot must have joined)",
	"field.group.listFailed": "Failed to load groups: {message}",
	"field.group.current": "(current)",
	"field.group.manualHint": "Group list unavailable — enter the chat_id (starting with oc_) manually",
	"field.tasks.label": "Tasks",
	"field.tasks.hint": "Time format HH:MM, up to {max} tasks",
	"field.tasks.empty": "No tasks yet — click \"Add task\"",
	"field.tasks.add": "Add task",
	"field.tasks.remove": "Remove",
	"field.tasks.contentPlaceholder": "Task (e.g. feed and take photos)",
	"field.tasks.invalid": "Task {index} is invalid — fill in time (HH:MM) and content",
	"status.summary": "Today: {planned} planned, {sent} pushed, next {next}",
	"status.summaryDone": "Today: all {planned} planned items pushed",
	"status.summaryIdle": "Today's schedule is not running (enable and save to start)"
};

//#endregion
//#region src/client/AquaSettingsCard.tsx
/** 池号数量/长度上限(与 Host 侧 aqua-settings.ts 保持一致) */
const MAX_POOLS = 20;
const MAX_POOL_LENGTH = 16;
/** 用户映射表单个姓名最大长度 */
const MAX_USER_NAME_LENGTH = 32;
const cardStyle = {
	border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
	background: "var(--dsw-alias-bg-layer-3, #fff)",
	borderRadius: 12,
	boxSizing: "border-box",
	listStyle: "none",
	transition: "border-color .16s, background .16s"
};
/** 展开态卡底色(对齐 .sh-cfg.open) */
const cardOpenStyle = { background: "var(--dsw-alias-bg-layer-2, #fafafa)" };
const headerStyle = {
	boxSizing: "border-box",
	width: "100%",
	alignItems: "center",
	gap: 12,
	padding: "14px 16px",
	display: "flex"
};
/** 展开区按钮:标题 + 描述 + 未保存徽标(对齐 .sh-cfg-expand) */
const expandStyle = {
	appearance: "none",
	flex: 1,
	minWidth: 0,
	font: "inherit",
	color: "inherit",
	textAlign: "left",
	cursor: "pointer",
	background: "transparent",
	border: 0,
	alignItems: "center",
	gap: 12,
	padding: 0,
	display: "flex"
};
/** 收起/展开按钮:28×28 独立热区(对齐 .sh-cfg-toggle) */
const toggleStyle = {
	appearance: "none",
	flex: "none",
	width: 28,
	height: 28,
	padding: 0,
	border: 0,
	background: "transparent",
	color: "inherit",
	cursor: "pointer",
	display: "grid",
	placeItems: "center"
};
const headTextStyle = {
	flexDirection: "column",
	flex: 1,
	gap: 4,
	minWidth: 0,
	display: "flex"
};
const nameStyle = {
	color: "var(--dsw-alias-label-primary, inherit)",
	fontSize: 15,
	fontWeight: 600,
	lineHeight: 1.4
};
const descStyle = {
	color: "var(--dsw-alias-label-tertiary, #6b7280)",
	fontSize: 13,
	lineHeight: 1.5
};
/** 未保存徽标(对齐 .sh-tag.orange) */
const unsavedStyle = {
	flex: "none",
	whiteSpace: "nowrap",
	background: "var(--dsw-alias-state-warn-tertiary, #fff7ed)",
	color: "var(--dsw-alias-state-warn-label, #c2410c)",
	borderRadius: 6,
	padding: "2px 6px",
	fontSize: 11,
	lineHeight: "16px"
};
/** 收起箭头:展开态旋转 180°(对齐 .sh-cfg-ch) */
const chevronStyle = (open) => ({
	color: "var(--dsw-alias-label-tertiary, #6b7280)",
	flex: "none",
	width: 14,
	height: 14,
	transition: "transform .16s",
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	transform: open ? "rotate(180deg)" : "none"
});
/** 卡体(对齐 .sh-cfg-b) */
const bodyStyle = {
	borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
	margin: "0 16px",
	padding: "8px 0 12px"
};
/** 收起态仅隐藏卡体(表单保持挂载,展开不重新拉取) */
const HIDDEN_STYLE = { display: "none" };
const CHEVRON_SVG = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
	width: "14",
	height: "14",
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round",
	children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 9l6 6 6-6" })
});
const formStyle = {
	display: "flex",
	flexDirection: "column"
};
const labelStyle = {
	display: "block",
	fontSize: 13,
	fontWeight: 500,
	color: "var(--dsw-alias-label-primary, inherit)"
};
const inputStyle = {
	width: "100%",
	height: 34,
	padding: "0 12px",
	fontSize: 13,
	borderRadius: 8,
	border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
	background: "var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-3, #fff))",
	color: "var(--dsw-alias-label-primary, inherit)",
	boxSizing: "border-box",
	fontFamily: "inherit"
};
const rowStyle = {
	display: "flex",
	alignItems: "center",
	gap: 8
};
/** 行内删除按钮(对齐 .sh-cfg-disc 语义,精简为 28×34 图标钮) */
const removeBtnStyle = {
	appearance: "none",
	flex: "none",
	width: 34,
	height: 34,
	padding: 0,
	font: "inherit",
	fontSize: 14,
	cursor: "pointer",
	borderRadius: 8,
	background: "transparent",
	border: "1px solid transparent",
	color: "var(--dsw-alias-label-tertiary, #6b7280)",
	transition: "color .16s, border-color .16s"
};
const addBtnStyle = {
	appearance: "none",
	alignSelf: "flex-start",
	font: "inherit",
	cursor: "pointer",
	borderRadius: 8,
	padding: "5px 14px",
	fontSize: 13,
	lineHeight: "20px",
	background: "transparent",
	border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
	color: "var(--dsw-alias-label-secondary, #4b5563)",
	transition: "background .16s, opacity .16s"
};
const hintStyle = {
	fontSize: 12,
	color: "var(--dsw-alias-label-caption, #6b7280)",
	margin: 0,
	lineHeight: 1.5
};
/** 分隔线样式 */
const dividerStyle = {
	borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
	margin: "16px 0"
};
/** 用户映射表头样式 */
const userMapHeaderStyle = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	marginBottom: 8
};
/** 用户映射行样式 */
const userMapRowStyle = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	marginTop: 8
};
/** open_id 输入框样式(只读) */
const openIdInputStyle = {
	...inputStyle,
	width: 200,
	flex: "none",
	background: "var(--dsw-alias-bg-layer-2, #f3f4f6)",
	color: "var(--dsw-alias-label-secondary, #6b7280)"
};
/** 姓名输入框样式 */
const nameInputStyle = {
	...inputStyle,
	flex: 1
};
/** 加载按钮样式 */
const loadBtnStyle = {
	...addBtnStyle,
	marginLeft: "auto"
};
/** 群ID输入框样式 */
const chatIdInputStyle = {
	...inputStyle,
	width: 280,
	flex: "none"
};
const errorStyle = {
	...hintStyle,
	color: "var(--dsw-alias-state-danger-label, #dc2626)",
	flex: 1
};
const footerStyle = {
	borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
	justifyContent: "flex-end",
	alignItems: "center",
	gap: 8,
	padding: "12px 0 4px",
	display: "flex"
};
/** 按钮基础(对齐 .sh-cfg-ft button) */
const btnBase = {
	appearance: "none",
	font: "inherit",
	cursor: "pointer",
	borderRadius: 8,
	padding: "5px 14px",
	fontSize: 13,
	lineHeight: "20px",
	transition: "background .16s, opacity .16s"
};
/** 次级按钮:透明底 + 描边(对齐 .sh-cfg-disc) */
const ghostBtnStyle = {
	...btnBase,
	background: "transparent",
	border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
	color: "var(--dsw-alias-label-secondary, #4b5563)"
};
/** 主按钮(对齐 .sh-cfg-save) */
const primaryBtnStyle = {
	...btnBase,
	background: "var(--dsw-alias-button-primary-fill, #111827)",
	border: "1px solid var(--dsw-alias-button-primary-fill, #111827)",
	color: "var(--dsw-alias-label-primary-foreground, #fff)"
};
/** 禁用态透明度(对齐 .sh-cfg-ft button:disabled) */
const DISABLED_OPACITY = .4;
/** 已保存提示(对齐 .sh-cfg-ok) */
const savedStyle = {
	...hintStyle,
	color: "var(--dsw-alias-state-success-label, #16a34a)",
	flex: 1
};
/** 错误信息提取 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** 池号配置加载/编辑/保存(与 useRemindConfig 同构) */
function useAquaSettings(api, t) {
	const [phase, setPhase] = (0, react.useState)("loading");
	const [saved, setSaved] = (0, react.useState)(null);
	const [draft, setDraft] = (0, react.useState)(null);
	const [savedUserMap, setSavedUserMap] = (0, react.useState)(null);
	const [draftUserMap, setDraftUserMap] = (0, react.useState)(null);
	const [applyState, setApplyState] = (0, react.useState)({ kind: "idle" });
	const [chatMembers, setChatMembers] = (0, react.useState)([]);
	const [loadingMembers, setLoadingMembers] = (0, react.useState)(false);
	const load = (0, react.useCallback)(async () => {
		setPhase("loading");
		try {
			const result = await api.get();
			const pools = [...result.settings.pools];
			const userMap = { ...result.settings.userMap };
			setSaved(pools);
			setDraft(pools);
			setSavedUserMap(userMap);
			setDraftUserMap(userMap);
			setApplyState({ kind: "idle" });
			setPhase("ready");
		} catch {
			setPhase("unavailable");
		}
	}, [api]);
	(0, react.useEffect)(() => {
		load();
	}, [load]);
	const dirty = draft !== null && saved !== null && (JSON.stringify(draft) !== JSON.stringify(saved) || JSON.stringify(draftUserMap) !== JSON.stringify(savedUserMap));
	const saving = applyState.kind === "saving";
	/** 编辑后回到 idle(清除「已保存」提示,由 dirty 徽标接管) */
	const markEdited = () => {
		setApplyState((state) => state.kind === "idle" ? state : { kind: "idle" });
	};
	const editPool = (index, value) => {
		setDraft((current) => current ? current.map((item, i) => i === index ? value : item) : current);
		markEdited();
	};
	const addPool = () => {
		setDraft((current) => current && current.length < MAX_POOLS ? [...current, ""] : current);
		markEdited();
	};
	const removePool = (index) => {
		setDraft((current) => current ? current.filter((_, i) => i !== index) : current);
		markEdited();
	};
	const editUserMap = (openId, name) => {
		setDraftUserMap((current) => {
			const next = { ...current || {} };
			if (name.trim()) next[openId] = name.trim();
			else delete next[openId];
			return next;
		});
		markEdited();
	};
	const removeUserMap = (openId) => {
		setDraftUserMap((current) => {
			if (!current) return current;
			const next = { ...current };
			delete next[openId];
			return next;
		});
		markEdited();
	};
	const loadChatMembers = (0, react.useCallback)(async (chatId) => {
		if (!chatId.trim()) return;
		setLoadingMembers(true);
		try {
			setChatMembers((await api.listChatMembers(chatId)).members);
		} catch {
			setChatMembers([]);
		} finally {
			setLoadingMembers(false);
		}
	}, [api]);
	const save = async () => {
		if (!draft || saving) return;
		const trimmed = draft.map((item) => item.trim());
		const invalidIndex = trimmed.findIndex((item) => !item || item.length > MAX_POOL_LENGTH);
		if (invalidIndex !== -1) {
			setApplyState({
				kind: "error",
				message: t("field.pools.invalid", {
					index: invalidIndex + 1,
					len: MAX_POOL_LENGTH
				})
			});
			return;
		}
		if (trimmed.length === 0) {
			setApplyState({
				kind: "error",
				message: t("field.pools.empty")
			});
			return;
		}
		setApplyState({ kind: "saving" });
		try {
			const result = await api.save({
				pools: trimmed,
				userMap: draftUserMap || {}
			});
			const pools = [...result.settings.pools];
			const userMap = { ...result.settings.userMap };
			setSaved(pools);
			setDraft(pools);
			setSavedUserMap(userMap);
			setDraftUserMap(userMap);
			setApplyState({ kind: "saved" });
		} catch (error) {
			setApplyState({
				kind: "error",
				message: messageOf(error)
			});
		}
	};
	const discard = () => {
		setDraft(saved ? [...saved] : null);
		setDraftUserMap(savedUserMap ? { ...savedUserMap } : null);
		setApplyState({ kind: "idle" });
	};
	return {
		phase,
		saved,
		draft,
		savedUserMap,
		draftUserMap,
		dirty,
		applyState,
		chatMembers,
		loadingMembers,
		load,
		editPool,
		addPool,
		removePool,
		editUserMap,
		removeUserMap,
		loadChatMembers,
		save,
		discard
	};
}
/** 展开区表单:池号列表编辑 + 用户映射配置 + 底部操作区 */
function PoolsForm({ model, t }) {
	const draft = model.draft ?? [];
	const draftUserMap = model.draftUserMap ?? {};
	const busy = model.applyState.kind === "saving";
	const [chatId, setChatId] = (0, react.useState)("");
	if (model.phase === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: formStyle,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: errorStyle,
			children: t("card.unavailable")
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: footerStyle,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: ghostBtnStyle,
				onClick: () => void model.load(),
				children: t("card.retry")
			})
		})]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: formStyle,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: labelStyle,
				children: t("field.pools.label")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: hintStyle,
				children: t("field.pools.hint", {
					max: MAX_POOLS,
					len: MAX_POOL_LENGTH
				})
			})] }),
			draft.map((value, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...rowStyle,
					marginTop: 8
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					style: inputStyle,
					value,
					maxLength: MAX_POOL_LENGTH,
					placeholder: t("field.pools.placeholder"),
					"aria-label": `${t("field.pools.label")} ${index + 1}`,
					onChange: (e) => model.editPool(index, e.target.value)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: removeBtnStyle,
					"aria-label": t("field.pools.remove"),
					title: t("field.pools.remove"),
					disabled: draft.length <= 1,
					onClick: () => model.removePool(index),
					children: "✕"
				})]
			}, index)),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { marginTop: 8 },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: addBtnStyle,
					disabled: draft.length >= MAX_POOLS,
					onClick: model.addPool,
					children: ["＋ ", t("field.pools.add")]
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: dividerStyle }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: labelStyle,
				children: t("field.userMap.label")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: hintStyle,
				children: t("field.userMap.hint")
			})] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...userMapHeaderStyle,
					marginTop: 8
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					style: chatIdInputStyle,
					value: chatId,
					placeholder: t("field.userMap.chatIdPlaceholder"),
					onChange: (e) => setChatId(e.target.value)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: loadBtnStyle,
					disabled: model.loadingMembers || !chatId.trim(),
					onClick: () => void model.loadChatMembers(chatId),
					children: model.loadingMembers ? t("field.userMap.loading") : t("field.userMap.loadMembers")
				})]
			}),
			Object.keys(draftUserMap).length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { marginTop: 12 },
				children: Object.entries(draftUserMap).map(([openId, name]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: userMapRowStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: openIdInputStyle,
							value: openId,
							readOnly: true,
							"aria-label": "open_id"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: nameInputStyle,
							value: name,
							maxLength: MAX_USER_NAME_LENGTH,
							placeholder: t("field.userMap.namePlaceholder"),
							"aria-label": t("field.userMap.nameLabel"),
							onChange: (e) => model.editUserMap(openId, e.target.value)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: removeBtnStyle,
							"aria-label": t("field.userMap.remove"),
							title: t("field.userMap.remove"),
							onClick: () => model.removeUserMap(openId),
							children: "✕"
						})
					]
				}, openId))
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: {
					...hintStyle,
					marginTop: 8
				},
				children: t("field.userMap.empty")
			}),
			model.chatMembers.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { marginTop: 12 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: hintStyle,
					children: t("field.userMap.chatMembersHint", { count: model.chatMembers.length })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						maxHeight: 150,
						overflowY: "auto",
						marginTop: 4
					},
					children: model.chatMembers.filter((m) => !draftUserMap[m.open_id]).map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...userMapRowStyle,
							marginTop: 4
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: openIdInputStyle,
								value: member.open_id,
								readOnly: true,
								"aria-label": "open_id"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: nameInputStyle,
								value: member.name,
								readOnly: true,
								"aria-label": t("field.userMap.nameLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: addBtnStyle,
								onClick: () => model.editUserMap(member.open_id, member.name),
								children: "＋"
							})
						]
					}, member.open_id))
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: footerStyle,
				children: [
					model.applyState.kind === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						role: "status",
						children: model.applyState.message
					}) : null,
					model.applyState.kind === "saved" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: savedStyle,
						role: "status",
						children: t("card.saved")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: ghostBtnStyle,
						disabled: !model.dirty || busy,
						onClick: model.discard,
						children: t("card.discard")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: {
							...primaryBtnStyle,
							opacity: !model.dirty || busy ? DISABLED_OPACITY : 1,
							cursor: !model.dirty || busy ? "default" : "pointer"
						},
						disabled: !model.dirty || busy,
						onClick: () => void model.save(),
						children: busy ? t("card.saving") : t("card.save")
					})
				]
			})
		]
	});
}
/**
* 渲染「AquaSense 设置」卡片。
* @param props - locale 座位(t)+ 注入面(api)。
* @returns `<li>` 卡片元素。
*/
function AquaSettingsCard({ t, api }) {
	const [open, setOpen] = (0, react.useState)(false);
	const model = useAquaSettings(api, t);
	/** 接口不可用时强制展开(展示重试入口) */
	const expanded = open || model.phase === "unavailable";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		style: expanded ? {
			...cardStyle,
			...cardOpenStyle
		} : cardStyle,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: headerStyle,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				style: expandStyle,
				"aria-expanded": expanded,
				onClick: () => {
					setOpen((value) => !value);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: headTextStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: nameStyle,
						children: t("card.title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: descStyle,
						children: t("card.intro")
					})]
				}), model.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: unsavedStyle,
					children: t("card.unsaved")
				}) : null]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: toggleStyle,
				"aria-label": expanded ? t("card.collapse") : t("card.expand"),
				onClick: () => {
					setOpen((value) => !value);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: chevronStyle(expanded),
					children: CHEVRON_SVG
				})
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: expanded ? bodyStyle : HIDDEN_STYLE,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PoolsForm, {
				model,
				t
			})
		})]
	});
}

//#endregion
//#region src/client/settings-locales.ts
/**
* AquaSense 设置卡片文案(命名空间 aquasense-settings,zh/en 双语词典)
*
* 与 Host 侧 settings 命名空间、settings.plugin.item 卡片 key 三者一致;
* 设置 → 插件 → 插件配置 tab 扫描到命名空间后派发 AquaSettingsCard。
*/
/** 字典命名空间(与 Host 侧 settings 命名空间、卡片 key 三者一致) */
const SETTINGS_NS = "aquasense-settings";
/** 中文字典 */
const zh$1 = {
	"card.title": "AquaSense 设置",
	"card.intro": "池号枚举配置:台账白名单、H5 拍照汇报、分析记录筛选统一按此池号生效",
	"card.unsaved": "未保存",
	"card.expand": "展开",
	"card.collapse": "收起",
	"card.loading": "加载中…",
	"card.unavailable": "设置接口不可用,请确认插件已随 Web 界面加载后重试",
	"card.retry": "重试",
	"card.saved": "已保存,整个插件系统池号已更新",
	"card.saving": "保存中…",
	"card.save": "保存配置",
	"card.discard": "放弃修改",
	"card.unsavedHint": "有未保存的修改",
	"field.pools.label": "池号枚举",
	"field.pools.hint": "按实际养殖池编号填写,最多 {max} 个,每项不超过 {len} 字",
	"field.pools.add": "添加池号",
	"field.pools.remove": "删除",
	"field.pools.placeholder": "如:池1",
	"field.pools.empty": "至少需要 1 个池号",
	"field.pools.invalid": "第 {index} 项池号非法:不能为空、不能超过 {len} 字",
	"field.pools.duplicate": "池号「{name}」重复,已自动去重",
	"field.userMap.label": "人员映射表",
	"field.userMap.hint": "配置飞书 open_id 与姓名的映射关系,用于台账自动填充上报人",
	"field.userMap.chatIdPlaceholder": "输入飞书群 ID",
	"field.userMap.loadMembers": "加载群成员",
	"field.userMap.loading": "加载中…",
	"field.userMap.namePlaceholder": "输入姓名",
	"field.userMap.nameLabel": "姓名",
	"field.userMap.remove": "删除",
	"field.userMap.empty": "暂无映射记录,请通过上方加载群成员或手动添加",
	"field.userMap.chatMembersHint": "群内共 {count} 人,以下为未添加的成员:"
};
/** 英文字典(与中文 key 一一对应) */
const en$1 = {
	"card.title": "AquaSense Settings",
	"card.intro": "Pool ID enumeration — the ledger whitelist, H5 photo reports and analysis-record filters all follow these pools",
	"card.unsaved": "Unsaved",
	"card.expand": "Expand",
	"card.collapse": "Collapse",
	"card.loading": "Loading…",
	"card.unavailable": "Settings API unavailable — make sure the plugin is loaded in the web UI",
	"card.retry": "Retry",
	"card.saved": "Saved — the pool IDs for the whole plugin system were updated",
	"card.saving": "Saving…",
	"card.save": "Save",
	"card.discard": "Discard",
	"card.unsavedHint": "Unsaved changes",
	"field.pools.label": "Pool ID enumeration",
	"field.pools.hint": "Enter the actual pond IDs, up to {max} entries and {len} characters each",
	"field.pools.add": "Add pool",
	"field.pools.remove": "Remove",
	"field.pools.placeholder": "e.g. Pond 1",
	"field.pools.empty": "At least 1 pool ID is required",
	"field.pools.invalid": "Pool {index} is invalid — must be non-empty and at most {len} characters",
	"field.pools.duplicate": "Pool \"{name}\" is duplicated and was deduplicated",
	"field.userMap.label": "User Mapping",
	"field.userMap.hint": "Configure Feishu open_id to name mappings for automatic ledger reporter filling",
	"field.userMap.chatIdPlaceholder": "Enter Feishu chat ID",
	"field.userMap.loadMembers": "Load Members",
	"field.userMap.loading": "Loading…",
	"field.userMap.namePlaceholder": "Enter name",
	"field.userMap.nameLabel": "Name",
	"field.userMap.remove": "Remove",
	"field.userMap.empty": "No mappings yet. Load members from chat or add manually above",
	"field.userMap.chatMembersHint": "{count} members in chat. Unadded members shown below:"
};

//#endregion
//#region src/client/index.ts
/** 所需服务:槽位注册 + 字典面 */
const inject = ["slots", "locale"];
/** 侧栏入口标识(列表槽读 id;键控槽读 key,双携带以兼容两侧宿主形态) */
const SIDEBAR_ENTRY_ID = "aquasense-config";
/**
* 侧栏页脚入口注册选项:target name 为 sidebar.footer.action,id+key 双携带;
* 经变量承载(as const 保持字面量类型)以规避字面量的多余属性检查
* (本地声明的 list 形态只约束 id)。
*/
const sidebarEntryOptions = {
	name: "sidebar.footer.action",
	id: SIDEBAR_ENTRY_ID,
	key: SIDEBAR_ENTRY_ID,
	order: 9,
	locale: NS,
	inject: () => ({ api: remindApi })
};
/**
* 客户端插件体:注册字典、设置卡片与侧栏配置入口。
* @param ctx - 浏览器侧根上下文。
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "aquasense-remind: dictionaries");
	ctx.effect(() => ctx.locale.register(SETTINGS_NS, {
		zh: zh$1,
		en: en$1
	}), "aquasense-settings: dictionaries");
	const settingsCardInjected = () => ({ api: aquaSettingsApi });
	ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
		name: "settings.plugin.item",
		key: SETTINGS_NS,
		locale: SETTINGS_NS,
		inject: settingsCardInjected
	}, AquaSettingsCard));
	ctx.effect(ensureAquaConfigStyle, "aquasense-remind: config style");
	ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(sidebarEntryOptions, AquaConfigEntry));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map