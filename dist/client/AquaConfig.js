import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AquaConfig —— 侧栏一级入口 + 独立配置页(需求 R6.5,UI 对齐 SkillHub 插件广场)
 *
 * 注册到 `sidebar.footer.action` 槽位:与设置按钮同级的侧栏页脚动作:
 *  - 触发器:「智慧渔业」(v1.9 更名;图标为与插件广场同风格的内联线性 SVG,
 *    见 WavesIcon;wide 显示文字,rail 仅图标,悬停/展开态对齐侧栏导航项);
 *  - 点击在会话列上打开独立配置页(createPortal 到 body,fixed 定位,随会话列尺寸变化);
 *  - 页顶二级标题「每日任务提醒」+ 右上角 × 关闭;
 *  - Esc / 点击面板外关闭(交互与布局对齐 SkillHub 插件广场页面)。
 *
 * 布局适配(v1.8):宿主页脚动作容器(footerActions)为单行 flex(nowrap),
 * 多个整宽条目并排会互相挤压(插件广场被压窄、本入口贴边);样式注入中以
 * :has() 命中该容器并允许换行,使「插件广场 / 智慧渔业 / 设置」
 * 各占一整行(rail 收起态下圆钮亦垂直堆叠)。
 *
 * 配置内容由 RemindForm 提供(v1.8 起为唯一使用方)。
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RemindForm, useRemindConfig } from './RemindForm.js';
const STYLE_ID = 'aquasense-config-style';
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
/* 顶栏二级标题区（页签组）：「每日任务提醒」为当前页签，右侧并列「📊 分析记录」
   （入口 C，R8 需求 v1.1；样式对齐 SkillHub 插件广场的「插件 / 技能」页签） */
.aqs-tabs{display:flex;align-items:center;gap:2px;min-width:0}
.aqs-tab{position:relative;display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:8px;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-secondary,#4b5563);text-decoration:none;cursor:pointer}
.aqs-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on{color:var(--dsw-alias-label-primary,#17191c)}
.aqs-tab.on::after{content:'';position:absolute;left:10px;right:10px;bottom:1px;height:2px;border-radius:2px;background:var(--dsw-alias-button-primary-fill,#4d6bfe)}
.aqs-title{margin:0}
.aqs-close{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary,#4b5563)}
.aqs-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.aqs-body{flex:1;min-height:0;overflow:auto;padding:18px 20px 32px}
.aqs-form{max-width:760px}
`;
/** 注入入口/配置页样式(幂等;返回无操作清理器以适配 ctx.effect) */
export function ensureAquaConfigStyle() {
    if (typeof document === 'undefined')
        return () => { };
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.appendChild(style);
    }
    style.textContent = CSS;
    return () => { };
}
/** 会话列根节点(SkillHub 同款定位锚点) */
function conversationRoot() {
    return typeof document === 'undefined' ? null : document.querySelector('[data-phase]');
}
/** 会话列矩形;无会话列时回退整窗(配置页不受会话状态限制) */
function overlayBox() {
    const root = conversationRoot();
    if (root) {
        const rect = root.getBoundingClientRect();
        return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
}
/** 跟踪会话列矩形(展开时随尺寸/滚动变化更新) */
function useOverlayBox(active) {
    const [box, setBox] = useState(null);
    useEffect(() => {
        if (!active) {
            setBox(null);
            return;
        }
        const update = () => {
            setBox(overlayBox());
        };
        update();
        const root = conversationRoot();
        const observer = root && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        if (root && observer)
            observer.observe(root);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            if (observer)
                observer.disconnect();
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [active]);
    return box;
}
/** 配置页(portal 内容):二级标题 + 右上角关闭 + 共享表单 */
function AquaConfigPage({ box, t, api, onClose }) {
    const model = useRemindConfig(api, t);
    useEffect(() => {
        const onKey = (event) => {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);
    return (_jsxs("div", { className: "aqs-page", role: "dialog", "aria-modal": "false", "aria-label": t('page.title'), style: { top: box.top, left: box.left, width: box.width, height: box.height }, children: [_jsxs("div", { className: "aqs-top", children: [_jsxs("nav", { className: "aqs-tabs", "aria-label": t('page.title'), children: [_jsx("h2", { className: "aqs-title aqs-tab on", "aria-current": "page", children: t('page.title') }), _jsxs("a", { className: "aqs-tab", href: "/aquasense-reports", target: "_blank", rel: "noreferrer", children: ["\uD83D\uDCCA ", t('page.tab.reports')] })] }), _jsx("button", { type: "button", className: "aqs-close", onClick: onClose, "aria-label": t('page.close'), title: t('page.close'), children: "\u00D7" })] }), _jsx("div", { className: "aqs-body", children: _jsx("div", { className: "aqs-form", children: _jsx(RemindForm, { model: model, t: t }) }) })] }));
}
/**
 * 入口图标:三道水波线性 SVG,规格与插件广场入口图标(PlazaIcon)同风格——
 * 16×16 视窗、无填充、描边取 currentColor、strokeWidth 1.4,
 * 随按钮文字色与悬停/展开态自动着色(尺寸档由 .aqs-ico 控制)。
 * @returns 图标元素。
 */
function WavesIcon() {
    return (_jsxs("svg", { className: "aqs-ico", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [_jsx("path", { d: "M1.7 4c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }), _jsx("path", { d: "M1.7 8c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }), _jsx("path", { d: "M1.7 12c1.05-1 2.1-1 3.15 0s2.1 1 3.15 0 2.1-1 3.15 0 2.1 1 3.15 0", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" })] }));
}
/**
 * 渲染侧栏页脚入口:触发器 + (展开时)配置页 portal。
 * @param props - owner 共享位(wide)+ locale 座位(t)+ 注入面(api)。
 * @returns 入口元素。
 */
export function AquaConfigEntry({ wide, t, api }) {
    useEffect(() => {
        ensureAquaConfigStyle();
    }, []);
    const [open, setOpen] = useState(false);
    const box = useOverlayBox(open);
    const close = useCallback(() => {
        setOpen(false);
    }, []);
    // 点击面板与入口之外关闭(对齐 SkillHub 插件广场)
    useEffect(() => {
        if (!open)
            return;
        const onPointer = (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('.aqs-page, .aqs-wrap'))
                return;
            close();
        };
        document.addEventListener('pointerdown', onPointer, true);
        return () => {
            document.removeEventListener('pointerdown', onPointer, true);
        };
    }, [open, close]);
    const panel = open && box && typeof document !== 'undefined'
        ? createPortal(_jsx(AquaConfigPage, { box: box, t: t, api: api, onClose: close }), document.body)
        : null;
    return (_jsxs("div", { className: 'aqs-wrap' + (wide ? '' : ' rail'), children: [_jsxs("button", { type: "button", className: 'aqs-trigger' + (open ? ' on' : ''), "aria-label": t('entry.label'), "aria-expanded": open, onClick: () => {
                    setOpen((value) => !value);
                }, children: [_jsx(WavesIcon, {}), wide ? _jsx("span", { className: "aqs-txt", children: t('entry.label') }) : null] }), panel] }));
}
