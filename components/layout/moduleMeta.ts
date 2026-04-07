import { AppModule } from '../../types';

export interface ModulePresentationMeta {
  title: string;
  subtitle: string;
  accentClass: string;
  accentTextClass: string;
  accentSoftClass: string;
  icon: string;
  label: string;
}

export const MODULE_META: Record<AppModule, ModulePresentationMeta> = {
  [AppModule.AGENT_CENTER]: {
    title: '智能体中心',
    subtitle: '部门专家与内部问答平台',
    accentClass: 'bg-cyan-600',
    accentTextClass: 'text-cyan-700',
    accentSoftClass: 'bg-cyan-50',
    icon: 'fa-robot',
    label: '智能体',
  },
  [AppModule.ONE_CLICK]: {
    title: '一键主详',
    subtitle: '全链路视觉生成',
    accentClass: 'bg-rose-600',
    accentTextClass: 'text-rose-600',
    accentSoftClass: 'bg-rose-50',
    icon: 'fa-magic',
    label: '一键主详',
  },
  [AppModule.TRANSLATION]: {
    title: '出海翻译',
    subtitle: '多语言视觉本地化',
    accentClass: 'bg-indigo-600',
    accentTextClass: 'text-indigo-600',
    accentSoftClass: 'bg-indigo-50',
    icon: 'fa-globe',
    label: '出海翻译',
  },
  [AppModule.BUYER_SHOW]: {
    title: '买家秀',
    subtitle: '真人质感模拟',
    accentClass: 'bg-amber-500',
    accentTextClass: 'text-amber-600',
    accentSoftClass: 'bg-amber-50',
    icon: 'fa-users',
    label: '买家秀',
  },
  [AppModule.RETOUCH]: {
    title: '产品精修',
    subtitle: '商业级画质提升',
    accentClass: 'bg-emerald-500',
    accentTextClass: 'text-emerald-600',
    accentSoftClass: 'bg-emerald-50',
    icon: 'fa-wand-magic-sparkles',
    label: '产品精修',
  },
  [AppModule.PHOTOGRAPHY]: {
    title: '产品摄影图',
    subtitle: 'AI 场景构筑',
    accentClass: 'bg-cyan-500',
    accentTextClass: 'text-cyan-600',
    accentSoftClass: 'bg-cyan-50',
    icon: 'fa-camera-retro',
    label: '摄影图',
  },
  [AppModule.VIDEO]: {
    title: '短视频分镜',
    subtitle: '脚本到画面工作流',
    accentClass: 'bg-fuchsia-600',
    accentTextClass: 'text-fuchsia-600',
    accentSoftClass: 'bg-fuchsia-50',
    icon: 'fa-play-circle',
    label: '短视频',
  },
  [AppModule.SETTINGS]: {
    title: '系统设置',
    subtitle: '环境与队列信息',
    accentClass: 'bg-slate-900',
    accentTextClass: 'text-slate-800',
    accentSoftClass: 'bg-slate-100',
    icon: 'fa-cog',
    label: '系统设置',
  },
  [AppModule.ACCOUNT]: {
    title: '账号管理',
    subtitle: '内部用户与运行日志',
    accentClass: 'bg-slate-900',
    accentTextClass: 'text-slate-800',
    accentSoftClass: 'bg-slate-100',
    icon: 'fa-user-circle',
    label: '账号管理',
  },
};

export const getModuleMeta = (module: AppModule): ModulePresentationMeta =>
  MODULE_META[module] || MODULE_META[AppModule.ONE_CLICK];
