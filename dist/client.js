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
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/client/api.ts
/**
* 设置页 API 客户端(浏览器侧)
*
* 与 Host 侧 src/web/remind-gateway.ts 的 /aquasense-remind/api 路由对应:
*   get    → { config, status }
*   save   → { config, status }(body: { config })
*   test   → { sent: true }
*   groups → { groups, error? }
* 信封协议 { ok, value } / { ok, error: { code, message } }。
*/
/** 设置页 API 前缀(与 Host 侧常量一致) */
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
/** 设置页 API 客户端 */
const remindApi = {
	get: () => call("get"),
	save: (input) => call("save", { config: input }),
	test: () => call("test"),
	groups: () => call("groups")
};

//#endregion
//#region src/client/RemindCard.tsx
/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
const MAX_TASKS = 50;
/**
* 卡片样式对齐 SkillHub 设置卡(.sh-cfg 体系):
* 展开区 + 独立收起按钮、字段分隔线、底部操作区。
*/
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
* 渲染 S9 提醒设置卡片。
* @param props - locale 座位(t)+ 注入面(api)。
* @returns `<li>` 卡片元素。
*/
function RemindCard({ t, api }) {
	const [open, setOpen] = (0, react.useState)(false);
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
	const expanded = open || phase === "unavailable";
	const header = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
			}), dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
	});
	let body = null;
	if (expanded) if (phase === "unavailable") body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: bodyStyle,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: noticeStyle,
			role: "status",
			children: t("card.unavailable")
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: footerStyle,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: ghostBtnStyle,
				onClick: () => {
					load();
				},
				children: t("card.retry")
			})
		})]
	});
	else if (phase === "ready" && draft) body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: bodyStyle,
		children: [
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
									edit({ enabled: event.target.checked });
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
								htmlFor: "aqs-remind-group",
								children: t("field.group.label")
							}),
							groups.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								id: "aqs-remind-group",
								style: inputStyle,
								value: draft.group,
								disabled: busy,
								onChange: (event) => {
									edit({ group: event.target.value });
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
								id: "aqs-remind-group",
								type: "text",
								style: inputStyle,
								value: draft.group,
								disabled: busy,
								placeholder: "oc_xxxxxxxx",
								onChange: (event) => {
									edit({ group: event.target.value });
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
											updateTask(index, { time: event.target.value });
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
											updateTask(index, { task: event.target.value });
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
											removeTask(index);
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
									onClick: addTask,
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
							sendTest();
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
						onClick: discard,
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
							save();
						},
						children: saving ? t("card.saving") : t("card.save")
					})
				]
			})
		]
	});
	else body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: bodyStyle,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			style: noticeStyle,
			role: "status",
			children: t("card.loading")
		})
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		style: expanded ? {
			...cardStyle,
			...cardOpenStyle
		} : cardStyle,
		children: [header, expanded ? body : null]
	});
}

//#endregion
//#region src/client/locales.ts
/**
* 设置卡片文案(命名空间 aquasense-remind,zh/en 双语词典)
*/
/** 字典命名空间(与 Host 侧 settings 命名空间、卡片 key 三者一致) */
const NS = "aquasense-remind";
/** 中文字典 */
const zh = {
	"card.title": "S9 每日任务提醒",
	"card.intro": "巡检任务定时提醒(每日总览 + 到点任务卡片),经飞书群推送",
	"card.unsaved": "未保存",
	"card.expand": "展开",
	"card.collapse": "收起",
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
	"card.title": "S9 daily task reminders",
	"card.intro": "Scheduled inspection reminders (daily overview + per-task cards) pushed to a Feishu group",
	"card.unsaved": "Unsaved",
	"card.expand": "Expand",
	"card.collapse": "Collapse",
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
/**
* 客户端插件体:注册字典与设置卡片。
* @param ctx - 浏览器侧根上下文。
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "aquasense-remind: dictionaries");
	const cardInjected = () => ({ api: remindApi });
	ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
		name: "settings.plugin.item",
		key: NS,
		locale: NS,
		inject: cardInjected
	}, RemindCard));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map