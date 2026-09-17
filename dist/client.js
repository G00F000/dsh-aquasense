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
* 信封协议 { ok, value } / { ok, error: { code, message } }。
*/
/** 配置页 API 前缀(与 Host 侧常量一致) */
const API_PREFIX = "/aquasense-remind/api";
/** 请求失败(信封 error.message 或 HTTP 状态) */
var RemindApiError = class extends Error {};
/** 调用一次 API 并解包信封 */
async function call(method, body) {
	let response;
	try {
		response = await fetch(`${API_PREFIX}/${method}`, {
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
	get: () => call("get"),
	save: (input) => call("save", { config: input }),
	test: () => call("test"),
	groups: () => call("groups")
};

//#endregion
//#region src/client/RemindForm.tsx
/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
const MAX_TASKS = 50;
const formStyle = {
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
const labelStyle = {
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
const taskRowStyle = {
	display: "flex",
	alignItems: "center",
	gap: 8
};
const timeInputStyle = {
	...inputStyle,
	width: 104,
	flex: "none"
};
const hintStyle = {
	fontSize: 12,
	color: "var(--dsw-alias-label-caption, #6b7280)",
	margin: 0,
	lineHeight: 1.5
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
const noticeStyle = {
	color: "var(--dsw-alias-label-caption, #6b7280)",
	margin: "0 0 8px",
	fontSize: 12,
	lineHeight: 1.5
};
const savedStyle = {
	color: "var(--dsw-alias-state-success-primary, #047857)",
	margin: "0 0 8px",
	fontSize: 12,
	lineHeight: 1.5
};
/** 错误文本(对齐 .sh-cfg-err,位于操作行左侧) */
const errorStyle = {
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
function messageOf(error) {
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
		} else setGroupsError(messageOf(groupsResult.reason));
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
				message: messageOf(error)
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
				message: messageOf(error)
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
		style: footerStyle,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			style: ghostBtnStyle,
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
			style: savedStyle,
			role: "status",
			children: t("card.saved")
		}) : null,
		applyState.kind === "testSent" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: savedStyle,
			role: "status",
			children: t("card.testSent")
		}) : null,
		dirty && !saving ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: noticeStyle,
			children: t("card.unsavedHint")
		}) : null,
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: formStyle,
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
						style: hintStyle,
						children: t("field.enabled.hint")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: fieldStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							style: labelStyle,
							htmlFor: groupInputId,
							children: t("field.group.label")
						}),
						groups.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							id: groupInputId,
							style: inputStyle,
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
							style: inputStyle,
							value: draft.group,
							disabled: busy,
							placeholder: "oc_xxxxxxxx",
							onChange: (event) => {
								model.edit({ group: event.target.value });
							}
						}),
						groupsError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle,
							children: t("field.group.listFailed", { message: groupsError })
						}) : null,
						groups.length === 0 && !groupsError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle,
							children: t("field.group.manualHint")
						}) : null
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: fieldStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							style: labelStyle,
							children: t("field.tasks.label")
						}),
						draft.tasks.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle,
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
										...inputStyle,
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
										...ghostBtnStyle,
										flex: "none",
										opacity: busy ? DISABLED_OPACITY : 1
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
									...ghostBtnStyle,
									opacity: busy || draft.tasks.length >= MAX_TASKS ? DISABLED_OPACITY : 1
								},
								disabled: busy || draft.tasks.length >= MAX_TASKS,
								onClick: model.addTask,
								children: t("field.tasks.add")
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle,
							children: t("field.tasks.hint", { max: MAX_TASKS })
						})
					]
				})
			]
		}),
		status ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: {
				...hintStyle,
				marginTop: 12
			},
			children: summarize(status)
		}) : null,
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: footerStyle,
			children: [
				applyState.kind === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: errorStyle,
					role: "status",
					children: applyState.message
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...ghostBtnStyle,
						opacity: dirty || busy ? DISABLED_OPACITY : 1
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
						...ghostBtnStyle,
						opacity: !dirty || busy ? DISABLED_OPACITY : 1
					},
					disabled: !dirty || busy,
					onClick: model.discard,
					children: t("card.discard")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...primaryBtnStyle,
						opacity: !dirty || busy ? DISABLED_OPACITY : 1
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
/** 详情接口信封 = 单条 TraceRecord */
const PAGE_LIMIT = 20;
const POOL_OPTIONS = [
	"",
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
	normal: "正常",
	early: "前兆",
	disease: "发病",
	unknown: "未知"
};
const SOURCE_LABEL = {
	h5_upload: "H5上传",
	group_chat: "群聊发图",
	api: "API"
};
const S = {
	filterBar: {
		display: "flex",
		gap: 8,
		padding: "12px 20px",
		borderBottom: "1px solid var(--dsw-alias-border-l2,#e2e4e8)",
		flexShrink: 0
	},
	select: {
		appearance: "none",
		padding: "6px 28px 6px 10px",
		border: "1px solid var(--dsw-alias-border-l2,#d1d5db)",
		borderRadius: 8,
		background: "var(--dsw-alias-bg-layer-3,#fff)",
		color: "var(--dsw-alias-label-primary,#17191c)",
		fontSize: 13,
		lineHeight: "20px"
	},
	list: {
		flex: "1 1 auto",
		minHeight: 0,
		overflow: "auto",
		padding: "12px 20px 32px"
	},
	empty: {
		padding: "60px 0",
		textAlign: "center",
		color: "var(--dsw-alias-label-secondary,#7b8088)"
	},
	groupTitle: {
		margin: "18px 0 8px",
		fontSize: 13,
		color: "var(--dsw-alias-label-secondary,#7b8088)"
	},
	row: {
		display: "block",
		padding: "12px 14px",
		color: "inherit",
		textDecoration: "none",
		borderBottom: "1px solid var(--dsw-alias-border-l2,#e2e4e8)",
		cursor: "pointer",
		background: "transparent"
	},
	line1: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: 8,
		fontSize: 13
	},
	dot: (cls) => ({
		flex: "none",
		width: 8,
		height: 8,
		borderRadius: "50%",
		background: {
			normal: "#52c41a",
			early: "#faad14",
			disease: "#ff4d4f",
			unknown: "#9ca3af"
		}[cls] || "#9ca3af"
	}),
	line2: {
		display: "flex",
		flexWrap: "wrap",
		gap: 6,
		marginTop: 6,
		fontSize: 12,
		color: "var(--dsw-alias-label-secondary,#7b8088)"
	},
	chip: {
		padding: "1px 8px",
		borderRadius: 999,
		background: "var(--dsw-alias-bg-secondary,#eef2f7)",
		fontSize: 12
	},
	moreBtn: {
		display: "block",
		width: "100%",
		margin: "16px 0 0",
		padding: 10,
		border: "1px solid var(--dsw-alias-border-l2,#d1d5db)",
		borderRadius: 10,
		background: "var(--dsw-alias-bg-layer-3,#fff)",
		color: "var(--dsw-alias-button-primary-fill,#4d6bfe)",
		fontSize: 14,
		cursor: "pointer"
	},
	err: {
		margin: 12,
		padding: "10px 12px",
		borderRadius: 10,
		border: "1px solid #ff4d4f",
		background: "var(--dsw-alias-bg-layer-3,#fff)",
		color: "#ff4d4f",
		fontSize: 13
	},
	detailWrap: { padding: "16px 20px 32px" },
	detailBack: {
		display: "inline-flex",
		alignItems: "center",
		gap: 4,
		padding: "6px 10px",
		border: 0,
		borderRadius: 8,
		background: "transparent",
		color: "var(--dsw-alias-button-primary-fill,#4d6bfe)",
		fontSize: 14,
		cursor: "pointer",
		marginBottom: 12
	},
	detailGrid: {
		display: "grid",
		gridTemplateColumns: "auto 1fr",
		gap: "8px 12px",
		fontSize: 14
	},
	detailLabel: {
		color: "var(--dsw-alias-label-secondary,#7b8088)",
		whiteSpace: "nowrap"
	},
	detailValue: {
		color: "var(--dsw-alias-label-primary,#17191c)",
		wordBreak: "break-all"
	}
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
function TraceRecordList({ apiBase = "/aquasense-reports" }) {
	const [records, setRecords] = (0, react.useState)([]);
	const [total, setTotal] = (0, react.useState)(0);
	const [hasMore, setHasMore] = (0, react.useState)(false);
	const [offset, setOffset] = (0, react.useState)(0);
	const [loading, setLoading] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)(null);
	const [pool, setPool] = (0, react.useState)("");
	const [cls, setCls] = (0, react.useState)("");
	const [detailId, setDetailId] = (0, react.useState)(null);
	const [detailRecord, setDetailRecord] = (0, react.useState)(null);
	const [detailLoading, setDetailLoading] = (0, react.useState)(false);
	const [detailError, setDetailError] = (0, react.useState)(null);
	/** 获取记录列表;错误信息区分网络/HTTP/信封三类 */
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
				throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})
请求: ${url}`);
			}
			if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}
请求: ${url}`);
			const body = await resp.json();
			if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败
请求: ${url}`);
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
	/** 筛选变更 → 重置列表 */
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
	/** pool/cls 变化后自动加载重置列表 */
	(0, react.useEffect)(() => {
		if (records.length === 0 && offset === 0 && !loading) fetchPage(true);
	}, [pool, cls]);
	/** 首次挂载加载 */
	(0, react.useEffect)(() => {
		fetchPage(true);
	}, []);
	/** 获取详情;错误信息区分网络/HTTP/信封三类 */
	const openDetail = (0, react.useCallback)(async (id) => {
		setDetailId(id);
		setDetailRecord(null);
		setDetailLoading(true);
		setDetailError(null);
		try {
			const url = `${apiBase}/api/records/${encodeURIComponent(id)}`;
			let resp;
			try {
				resp = await fetch(url);
			} catch (netErr) {
				throw new Error(`网络错误(${netErr instanceof Error ? netErr.message : String(netErr)})
请求: ${url}`);
			}
			if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}
请求: ${url}`);
			const body = await resp.json();
			if (!body?.ok) throw new Error(body?.error?.message || `接口返回失败
请求: ${url}`);
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
	}, []);
	if (detailId) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: S.detailWrap,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: S.detailBack,
				onClick: backToList,
				children: "← 返回列表"
			}),
			detailLoading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: S.empty,
				children: "加载中…"
			}),
			detailError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: S.err,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						whiteSpace: "pre-wrap",
						wordBreak: "break-all"
					},
					children: detailError
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...S.moreBtn,
						marginTop: 8,
						width: "auto",
						display: "inline-block"
					},
					onClick: backToList,
					children: "返回列表"
				})]
			}),
			detailRecord && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: S.detailGrid,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "记录 ID"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: detailRecord.id
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "池号"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: detailRecord.pool
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "状态"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: CLS_LABEL[detailRecord.cls] || detailRecord.cls
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "置信度"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: (detailRecord.confidence || 0).toFixed(2)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "症状"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: detailRecord.symptoms?.join("、") || "无异常"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "来源"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: SOURCE_LABEL[detailRecord.source || ""] || detailRecord.source
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "知识库增强"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: detailRecord.alert_level ? "是" : "否"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "耗时"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: durationText(detailRecord.total_duration_ms)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "Token"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: tokenText(detailRecord.total_tokens)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailLabel,
						children: "创建时间"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: S.detailValue,
						children: new Date(detailRecord.created_at).toLocaleString("zh-CN")
					})
				]
			}) })
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
		style: S.filterBar,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
				style: S.select,
				value: pool,
				onChange: (e) => {
					applyFilter(e.target.value, cls);
				},
				"aria-label": "按池号筛选",
				children: POOL_OPTIONS.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: p,
					children: p || "全部池号"
				}, p))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
				style: S.select,
				value: cls,
				onChange: (e) => {
					applyFilter(pool, e.target.value);
				},
				"aria-label": "按状态筛选",
				children: CLS_OPTIONS.map(([v, l]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: v,
					children: l
				}, v))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: {
					marginLeft: "auto",
					fontSize: 12,
					color: "var(--dsw-alias-label-secondary,#7b8088)",
					alignSelf: "center"
				},
				children: [total, " 条记录"]
			})
		]
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: S.list,
		children: [
			error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: S.err,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						whiteSpace: "pre-wrap",
						wordBreak: "break-all"
					},
					children: error
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: {
						...S.moreBtn,
						marginTop: 8,
						width: "auto",
						display: "inline-block"
					},
					onClick: () => {
						fetchPage(true);
					},
					children: "重试"
				})]
			}),
			!error && records.length === 0 && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: S.empty,
				children: "暂无分析记录"
			}),
			loading && records.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: S.empty,
				children: "加载中…"
			}),
			groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: S.groupTitle,
				children: g.title
			}), g.items.map((r) => {
				const clsName = CLS_LABEL[r.cls] || r.cls || "未知";
				const sym = r.symptoms?.length ? r.symptoms.join("、") : "无异常";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: S.row,
					onClick: () => {
						openDetail(r.id);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: S.line1,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: S.dot(r.cls) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontFamily: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
									fontSize: 12,
									color: "var(--dsw-alias-label-secondary,#7b8088)"
								},
								children: r.id
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { fontWeight: 600 },
								children: r.pool
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontWeight: 600,
									color: {
										normal: "#52c41a",
										early: "#faad14",
										disease: "#ff4d4f",
										unknown: "#9ca3af"
									}[r.cls] || "#9ca3af"
								},
								children: clsName
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { color: "var(--dsw-alias-label-secondary,#7b8088)" },
								children: (r.confidence || 0).toFixed(2)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									flex: "1 1 100%",
									color: r.cls === "disease" ? "#ff4d4f" : "var(--dsw-alias-label-secondary,#7b8088)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: sym
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: S.line2,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: timeText(r.created_at) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: SOURCE_LABEL[r.source || ""] || r.source }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: r.alert_level ? "AI视觉+知识库" : "AI视觉" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: durationText(r.total_duration_ms) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "·" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [tokenText(r.total_tokens), " tokens"] })
						]
					})]
				}, r.id);
			})] }, g.title)),
			hasMore && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: S.moreBtn,
				onClick: () => {
					fetchPage(false);
				},
				children: "加载更多"
			}),
			loading && records.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...S.empty,
					padding: "20px 0"
				},
				children: "加载中…"
			})
		]
	})] });
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
.aqs-page{position:fixed;z-index:40;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-top{display:flex;align-items:center;gap:12px;flex:none;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-base,#fff)}
/* 顶栏页签组：「每日任务提醒」与「📊 分析记录」（入口 C，R8 需求 v1.3）为同页
   切换的两个页签（role=tablist，样式对齐 SkillHub 插件广场「插件 / 技能」），
   后者在面板内容区以 React 组件直调 API 展示（去 iframe 化），不新开标签页 */
.aqs-tabs{display:flex;align-items:center;gap:2px;min-width:0}
.aqs-tab{position:relative;display:flex;align-items:center;gap:4px;padding:6px 10px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer}
.aqs-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on{color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on::after{content:'';position:absolute;left:10px;right:10px;bottom:1px;height:2px;border-radius:2px;background:var(--dsw-alias-button-primary-fill,#4d6bfe)}
.aqs-close{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary,#4b5563)}
.aqs-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.aqs-body{flex:1;min-height:0;overflow:auto;padding:18px 20px 32px}
/* 分析记录页签:内容区去掉内边距,React 组件铺满(自带筛选条与滚动) */
.aqs-body.flush{display:flex;padding:0;overflow:hidden}
.aqs-reports{display:flex;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
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
			className: "aqs-body" + (tab === "reports" ? " flush" : ""),
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "aqs-form",
				style: tab === "remind" ? void 0 : HIDDEN,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemindForm, {
					model,
					t
				})
			}), reportsOn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "aqs-reports",
				style: tab === "reports" ? void 0 : HIDDEN,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TraceRecordList, {})
			}) : null]
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
* 客户端插件体:注册字典与侧栏配置入口。
* @param ctx - 浏览器侧根上下文。
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "aquasense-remind: dictionaries");
	ctx.effect(ensureAquaConfigStyle, "aquasense-remind: config style");
	ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(sidebarEntryOptions, AquaConfigEntry));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map