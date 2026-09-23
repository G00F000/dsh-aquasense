/**
 * AquaSettingsCard —— settings.plugin.item 槽位卡片(设置 → 插件 → 插件配置)
 *
 * 「AquaSense 设置」:配置池号枚举,保存后整个插件系统(台账白名单、
 * H5 拍照汇报校验、分析记录筛选/趋势)统一按该池号生效。
 *
 * 卡片外壳:标题/描述/未保存徽标 + 展开/收起按钮;展开区为池号列表编辑表单。
 * 数据经 /aquasense-settings/api 与 Host 侧读写(见 src/web/aqua-settings-gateway.ts)。
 *
 * UI 对齐 SkillHub(插件广场)设置卡(.sh-cfg 体系):展开区 + 独立收起按钮、
 * 未保存徽标、字段分隔线、底部「放弃修改 / 保存配置」操作区。
 */
import type { ReactNode } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { AquaSettingsApi, FeishuChatMember, VisionModelConfig } from './api.js';
/** 词典翻译函数(命名空间 aquasense-settings) */
export type AquaSettingsTranslate = PropsLocale<'aquasense-settings'>['t'];
/** 卡片注入面(注册时提供,见 index.ts) */
export interface AquaSettingsCardInjected {
    readonly api: AquaSettingsApi;
}
/** 卡片 props:locale 座位 + 注入面 */
export type AquaSettingsCardProps = PropsLocale<'aquasense-settings'> & AquaSettingsCardInjected;
/** 池号数量/长度上限(与 Host 侧 aqua-settings.ts 保持一致) */
export declare const MAX_POOLS = 20;
export declare const MAX_POOL_LENGTH = 16;
/** 用户映射表单个姓名最大长度 */
export declare const MAX_USER_NAME_LENGTH = 32;
/** 操作/提交状态 */
type ApplyState = {
    kind: 'idle';
} | {
    kind: 'saving';
} | {
    kind: 'saved';
} | {
    kind: 'error';
    message: string;
};
/** 配置状态模型(表单渲染与动作统一入口) */
interface AquaSettingsModel {
    phase: 'loading' | 'ready' | 'unavailable';
    /** 已保存池号快照 */
    saved: string[] | null;
    /** 草稿(编辑中) */
    draft: string[] | null;
    /** 已保存用户映射快照 */
    savedUserMap: Record<string, string> | null;
    /** 用户映射草稿(编辑中) */
    draftUserMap: Record<string, string> | null;
    /** 已保存视觉模型配置快照 */
    savedVisionModel: VisionModelConfig | null;
    /** 视觉模型配置草稿(编辑中) */
    draftVisionModel: VisionModelConfig | null;
    dirty: boolean;
    applyState: ApplyState;
    /** 视觉模型测试状态 */
    testState: {
        kind: 'idle';
    } | {
        kind: 'testing';
    } | {
        kind: 'success';
        message: string;
    } | {
        kind: 'error';
        message: string;
    };
    /** 飞书群成员列表(用于自动填充 open_id) */
    chatMembers: FeishuChatMember[];
    /** 加载群成员中 */
    loadingMembers: boolean;
    load(): Promise<void>;
    editPool(index: number, value: string): void;
    addPool(): void;
    removePool(index: number): void;
    /** 编辑用户映射(设置 open_id → 姓名) */
    editUserMap(openId: string, name: string): void;
    /** 删除用户映射 */
    removeUserMap(openId: string): void;
    /** 加载飞书群成员 */
    loadChatMembers(chatId: string): Promise<void>;
    /** 编辑视觉模型配置 */
    editVisionModel(field: keyof VisionModelConfig, value: string): void;
    /** 测试视觉模型配置 */
    testVisionModel(): Promise<void>;
    save(): Promise<void>;
    discard(): void;
}
/** 池号配置加载/编辑/保存(与 useRemindConfig 同构) */
export declare function useAquaSettings(api: AquaSettingsApi, t: AquaSettingsTranslate): AquaSettingsModel;
/**
 * 渲染「AquaSense 设置」卡片。
 * @param props - locale 座位(t)+ 注入面(api)。
 * @returns `<li>` 卡片元素。
 */
export declare function AquaSettingsCard({ t, api }: AquaSettingsCardProps): ReactNode;
export {};
