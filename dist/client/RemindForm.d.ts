/**
 * RemindForm —— S9 每日任务提醒的配置表单(需求 R6.5 原型 3)
 *
 * 由侧栏「智慧渔业」一级入口打开的独立配置页(AquaConfigPage)使用
 * (v1.8 起设置页卡片已移除,本组件为唯一表单实现)。
 *
 * 配置状态与动作由 useRemindConfig 提供(拉取/草稿/dirty/保存/发送测试/放弃修改),
 * 本组件只负责渲染;样式对齐 SkillHub 设置卡(.sh-cfg 体系):字段分隔线、
 * 底部「发送测试 / 放弃修改 / 保存配置」操作区。
 */
import type { ReactNode } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { FeishuGroup, RemindApi, RemindConfigInput, RemindStatus, RemindTask } from './api.js';
/** 词典翻译函数(命名空间 aquasense-remind) */
export type RemindTranslate = PropsLocale<'aquasense-remind'>['t'];
/** 任务数上限(与 Host 侧 remind-gateway.ts 保持一致) */
export declare const MAX_TASKS = 50;
/** 操作/提交状态 */
type ApplyState = {
    kind: 'idle';
} | {
    kind: 'saving';
} | {
    kind: 'saved';
} | {
    kind: 'testing';
} | {
    kind: 'testSent';
} | {
    kind: 'error';
    message: string;
};
/** 配置模型:useRemindConfig 的返回值 */
export interface RemindModel {
    /** 拉取阶段 */
    readonly phase: 'loading' | 'ready' | 'unavailable';
    /** 编辑草稿(未就绪时为 null) */
    readonly draft: RemindConfigInput | null;
    /** 当日调度状态摘要(接口失败为 null) */
    readonly status: RemindStatus | null;
    /** 飞书群候选列表(空 = 允许手填 chat_id) */
    readonly groups: FeishuGroup[];
    /** 群列表获取失败信息 */
    readonly groupsError: string | null;
    /** 保存/测试的提交状态 */
    readonly applyState: ApplyState;
    /** 草稿与已保存快照是否有差异 */
    readonly dirty: boolean;
    /** 保存中 */
    readonly saving: boolean;
    /** 测试提醒发送中 */
    readonly testing: boolean;
    /** 任一提交进行中(表单禁用) */
    readonly busy: boolean;
    /** 重新拉取配置与群列表 */
    reload: () => Promise<void>;
    /** 编辑顶层字段 */
    edit: (patch: Partial<RemindConfigInput>) => void;
    /** 编辑第 index 条任务 */
    updateTask: (index: number, patch: Partial<RemindTask>) => void;
    /** 追加一条任务 */
    addTask: () => void;
    /** 删除第 index 条任务 */
    removeTask: (index: number) => void;
    /** 保存配置(持久化并重建当日推送计划) */
    save: () => Promise<void>;
    /** 放弃修改:草稿回滚为已保存快照 */
    discard: () => void;
    /** 发送测试提醒(基于已保存配置) */
    sendTest: () => Promise<void>;
}
/**
 * 配置状态与动作(配置页数据层)。
 * @param api - 浏览器半侧 API(经槽位注入面传入)。
 * @param t - 词典翻译函数。
 * @returns 表单渲染所需的全部状态与动作。
 */
export declare function useRemindConfig(api: RemindApi, t: RemindTranslate): RemindModel;
/**
 * 渲染配置表单(加载/不可用/就绪三分支)。
 * @param props - model:useRemindConfig 的返回值;t:词典翻译函数。
 * @returns 表单元素(不含卡片/页面外壳)。
 */
export declare function RemindForm({ model, t }: {
    model: RemindModel;
    t: RemindTranslate;
}): ReactNode;
export {};
