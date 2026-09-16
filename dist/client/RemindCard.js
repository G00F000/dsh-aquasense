import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * RemindCard —— settings.plugin.item 槽位卡片(设置 → 插件 → 插件配置)
 *
 * 卡片外壳:标题/描述/未保存徽标 + 展开/收起按钮;展开区表单由 RemindForm
 * 提供(与侧栏「🐟 AquaSense 配置」入口打开的独立配置页共用同一份实现)。
 * 交互(需求 R6.5 原型 3):启用开关 / 推送目标群下拉 / 任务列表增删 /
 * [保存配置](持久化并重建当日推送计划) [发送测试提醒](立即推一次总览卡片)。
 * 数据经 /aquasense-remind/api 与 Host 侧读写(见 src/web/remind-gateway.ts)。
 *
 * UI 对齐 SkillHub(插件广场)设置卡:展开区 + 独立收起按钮、未保存徽标、
 * 字段分隔线、底部「发送测试 / 放弃修改 / 保存配置」操作区。
 */
import { useState } from 'react';
import { RemindForm, useRemindConfig } from './RemindForm.js';
/**
 * 卡片样式对齐 SkillHub 设置卡(.sh-cfg 体系):
 * 展开区 + 独立收起按钮、未保存徽标;表单样式见 RemindForm。
 */
const cardStyle = {
    border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    background: 'var(--dsw-alias-bg-layer-3, #fff)',
    borderRadius: 12,
    boxSizing: 'border-box',
    listStyle: 'none',
    transition: 'border-color .16s, background .16s'
};
/** 展开态卡底色(对齐 .sh-cfg.open) */
const cardOpenStyle = {
    background: 'var(--dsw-alias-bg-layer-2, #fafafa)'
};
const headerStyle = {
    boxSizing: 'border-box',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    display: 'flex'
};
/** 展开区按钮:标题 + 描述 + 未保存徽标(对齐 .sh-cfg-expand) */
const expandStyle = {
    appearance: 'none',
    flex: 1,
    minWidth: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    background: 'transparent',
    border: 0,
    alignItems: 'center',
    gap: 12,
    padding: 0,
    display: 'flex'
};
/** 收起/展开按钮:28×28 独立热区(对齐 .sh-cfg-toggle) */
const toggleStyle = {
    appearance: 'none',
    flex: 'none',
    width: 28,
    height: 28,
    padding: 0,
    border: 0,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center'
};
const headTextStyle = {
    flexDirection: 'column',
    flex: 1,
    gap: 4,
    minWidth: 0,
    display: 'flex'
};
const nameStyle = {
    color: 'var(--dsw-alias-label-primary, inherit)',
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.4
};
const descStyle = {
    color: 'var(--dsw-alias-label-tertiary, #6b7280)',
    fontSize: 13,
    lineHeight: 1.5
};
/** 未保存徽标(对齐 .sh-tag.orange) */
const unsavedStyle = {
    flex: 'none',
    whiteSpace: 'nowrap',
    background: 'var(--dsw-alias-state-warn-tertiary, #fff7ed)',
    color: 'var(--dsw-alias-state-warn-label, #c2410c)',
    borderRadius: 6,
    padding: '2px 6px',
    fontSize: 11,
    lineHeight: '16px'
};
/** 收起箭头:展开态旋转 180°(对齐 .sh-cfg-ch) */
const chevronStyle = (open) => ({
    color: 'var(--dsw-alias-label-tertiary, #6b7280)',
    flex: 'none',
    width: 14,
    height: 14,
    transition: 'transform .16s',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: open ? 'rotate(180deg)' : 'none'
});
/** 卡体(对齐 .sh-cfg-b) */
const bodyStyle = {
    borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    margin: '0 16px',
    padding: '8px 0 12px'
};
/** 收起态仅隐藏卡体(表单保持挂载,展开不重新拉取) */
const HIDDEN_STYLE = {
    display: 'none'
};
const CHEVRON_SVG = (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M6 9l6 6 6-6" }) }));
/**
 * 渲染 S9 提醒设置卡片。
 * @param props - locale 座位(t)+ 注入面(api)。
 * @returns `<li>` 卡片元素。
 */
export function RemindCard({ t, api }) {
    const [open, setOpen] = useState(false);
    const model = useRemindConfig(api, t);
    /** 接口不可用时强制展开(展示重试入口) */
    const expanded = open || model.phase === 'unavailable';
    const header = (_jsxs("div", { style: headerStyle, children: [_jsxs("button", { type: "button", style: expandStyle, "aria-expanded": expanded, onClick: () => {
                    setOpen((value) => !value);
                }, children: [_jsxs("span", { style: headTextStyle, children: [_jsx("span", { style: nameStyle, children: t('card.title') }), _jsx("span", { style: descStyle, children: t('card.intro') })] }), model.dirty ? _jsx("span", { style: unsavedStyle, children: t('card.unsaved') }) : null] }), _jsx("button", { type: "button", style: toggleStyle, "aria-label": expanded ? t('card.collapse') : t('card.expand'), onClick: () => {
                    setOpen((value) => !value);
                }, children: _jsx("span", { style: chevronStyle(expanded), children: CHEVRON_SVG }) })] }));
    return (_jsxs("li", { style: expanded ? { ...cardStyle, ...cardOpenStyle } : cardStyle, children: [header, _jsx("div", { style: expanded ? bodyStyle : HIDDEN_STYLE, children: _jsx(RemindForm, { model: model, t: t }) })] }));
}
