import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AgentKnowledgeDocumentBinding, KnowledgeBaseSummary, KnowledgeDocumentSummary } from '../../types';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import AgentAvatar from './AgentAvatar';
import { AGENT_AVATAR_PRESETS } from './agentAvatarOptions';
import { MODULE_INTERFACES } from './agentCenterUtils.mjs';

interface WizardForm {
  name: string;
  description: string;
  department: string;
  iconUrl: string;
  avatarPreset: string;
  systemPrompt: string;
  openingRemarks: string;
  selectedKnowledgeBaseIds: string[];
  knowledgeDocumentBindings: AgentKnowledgeDocumentBinding[];
  allowedChatModels: string[];
  defaultChatModel: string;
  cheapModel: string;
  enableImageGeneration: boolean;
  imageModel: string;
  topK: number;
  linkedModuleInterfaces: string[];
}

interface Props {
  mode: 'create' | 'edit';
  currentStep: number;
  form: WizardForm;
  knowledgeBases: KnowledgeBaseSummary[];
  knowledgeDocumentsByBase: Record<string, KnowledgeDocumentSummary[]>;
  availableChatModels: Array<{ id: string; label: string }>;
  availableImageModels: Array<{ id: string; label: string; maxInputImages?: number }>;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onStepChange: (step: number) => void;
  onChange: <K extends keyof WizardForm>(field: K, value: WizardForm[K]) => void;
}

const steps = ['基础信息', '角色与提示词', '绑定知识库', '模型与策略', '检查并提交'];
const DEPARTMENT_PRESETS = ['通用', '设计', '运营', '投放', '客服', '商品', '市场', '技术'];

const stepMeta = [
  {
    title: '基础信息',
    eyebrow: '智能体身份',
    sectionTitle: '基础档案',
    detail: '确认头像、命名、部门和说明，让用户在广场与会话里一眼识别它。',
    icon: 'fa-id-badge',
    checkpoints: ['头像与归属', '名称说明', '部门分组'],
  },
  {
    title: '角色与提示词',
    eyebrow: '行为设定',
    sectionTitle: '提示词结构',
    detail: '定义智能体的职责、口吻、边界和新会话开场白。',
    icon: 'fa-message',
    checkpoints: ['系统提示词', '开场白', '使用边界'],
  },
  {
    title: '绑定知识库',
    eyebrow: '知识范围',
    sectionTitle: '知识库范围',
    detail: '选择可检索资料，并精确控制当前版本启用哪些文档。',
    icon: 'fa-book-open',
    checkpoints: ['知识库选择', '文档开关', '检索范围'],
  },
  {
    title: '模型与策略',
    eyebrow: '运行策略',
    sectionTitle: '策略面板',
    detail: '配置可选模型、生图能力、检索数量和跨模块输出接口。',
    icon: 'fa-sliders',
    checkpoints: ['模型权限', '生图能力', '功能接口'],
  },
  {
    title: '检查并提交',
    eyebrow: '提交前检查',
    sectionTitle: '提交前检查',
    detail: '最后核对身份、知识范围和模型策略，再创建或保存草稿。',
    icon: 'fa-check-double',
    checkpoints: ['基础信息', '提示词', '策略摘要'],
  },
];

const panelClassName = 'rounded-[22px] border border-white/70 bg-white/72 p-4 shadow-[0_16px_36px_rgba(148,163,184,0.1)] backdrop-blur-xl';
const subPanelClassName = 'rounded-[18px] border border-slate-200/70 bg-slate-50/70 p-4';
const inputClassName = 'w-full rounded-[16px] border border-slate-200/80 bg-white/92 px-4 py-3 text-[13px] font-medium text-slate-700 outline-none transition focus:border-cyan-300 focus:bg-white focus:ring-4 focus:ring-cyan-100/70';
const smallButtonClassName = 'inline-flex items-center justify-center gap-2 rounded-[14px] border border-slate-200/80 bg-white/90 px-3.5 py-2 text-[12px] font-black text-slate-700 shadow-[0_8px_18px_rgba(148,163,184,0.08)] transition hover:border-slate-300 hover:bg-white';

const FieldLabel: React.FC<{ title: string; detail?: string }> = ({ title, detail }) => (
  <div className="mb-2">
    <p className="text-[12px] font-black text-slate-700">{title}</p>
    {detail ? <p className="mt-0.5 text-[11px] font-medium leading-5 text-slate-400">{detail}</p> : null}
  </div>
);

const SectionTitle: React.FC<{ eyebrow: string; title: string; detail?: string; icon?: string }> = ({ eyebrow, title, detail, icon }) => (
  <div className="mb-4 flex items-start gap-3">
    {icon ? (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)]">
        <i className={`fas ${icon} text-sm`} />
      </div>
    ) : null}
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.18em] text-slate-400">{eyebrow}</p>
      <h4 className="mt-0.5 text-[17px] font-black tracking-[-0.02em] text-slate-900">{title}</h4>
      {detail ? <p className="mt-1 max-w-2xl text-[12px] font-medium leading-5 text-slate-500">{detail}</p> : null}
    </div>
  </div>
);

const AgentWizardView: React.FC<Props> = ({
  mode,
  currentStep,
  form,
  knowledgeBases,
  knowledgeDocumentsByBase,
  availableChatModels,
  availableImageModels,
  onBack,
  onPrev,
  onNext,
  onSubmit,
  onStepChange,
  onChange,
}) => {
  const [customDepartment, setCustomDepartment] = useState('');
  const contentTopRef = useRef<HTMLDivElement | null>(null);
  const canJumpToStep = mode === 'edit';
  const defaultChatOptions = availableChatModels.filter((item) => form.allowedChatModels.includes(item.id));
  const cheapChatOptions = defaultChatOptions.length ? defaultChatOptions : availableChatModels;
  const departmentOptions = useMemo(() => {
    const current = form.department?.trim();
    return current && !DEPARTMENT_PRESETS.includes(current) ? [...DEPARTMENT_PRESETS, current] : DEPARTMENT_PRESETS;
  }, [form.department]);
  const resolveEnabledDocumentIds = (knowledgeBaseId: string) => {
    const documents = knowledgeDocumentsByBase[knowledgeBaseId] || [];
    const binding = form.knowledgeDocumentBindings.find((item) => item.knowledgeBaseId === knowledgeBaseId);
    if (!binding) return documents.map((item) => item.id);
    return binding.enabledDocumentIds;
  };
  const currentMeta = stepMeta[currentStep] || stepMeta[0];
  const selectedKnowledgeDocumentCount = form.selectedKnowledgeBaseIds.reduce((total, knowledgeBaseId) => {
    return total + resolveEnabledDocumentIds(knowledgeBaseId).length;
  }, 0);
  const enabledInterfaceLabels = form.linkedModuleInterfaces
    .map((id) => MODULE_INTERFACES[id as keyof typeof MODULE_INTERFACES]?.label || id)
    .filter(Boolean);

  useEffect(() => {
    contentTopRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [currentStep]);

  return (
    <div className="mx-auto grid max-w-7xl gap-4 pb-8 xl:grid-cols-[280px_minmax(0,1fr)]">
      <WorkspaceShellCard className="h-fit overflow-hidden border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.72))] px-4 py-4 shadow-[0_20px_48px_rgba(148,163,184,0.12)] backdrop-blur-2xl">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/80 px-3.5 py-2 text-[13px] font-black text-slate-600 shadow-[0_8px_18px_rgba(148,163,184,0.1)] transition hover:border-slate-300 hover:text-slate-900"
        >
          <i className="fas fa-arrow-left text-xs" />
          返回
        </button>
        <div className="mt-5">
          <p className="text-[10px] font-black tracking-[0.18em] text-slate-400">AGENT BUILDER</p>
          <h3 className="mt-1 text-[22px] font-black tracking-[-0.04em] text-slate-950">{mode === 'create' ? '新建智能体' : '编辑草稿'}</h3>
          <p className="mt-2 text-[12px] font-medium leading-5 text-slate-500">
            {mode === 'create' ? '从零配置可发布的智能体。' : '正在编辑未发布草稿，保存后回到详情页验证与发布。'}
          </p>
        </div>
        <div className="mt-5 space-y-2.5">
          {stepMeta.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => {
                if (!canJumpToStep) return;
                onStepChange(index);
              }}
              disabled={!canJumpToStep}
              className={`w-full rounded-[20px] border px-3.5 py-3 text-left ${
                index === currentStep ? 'border-cyan-200 bg-[linear-gradient(135deg,rgba(236,254,255,0.92),rgba(255,255,255,0.86))] shadow-[0_16px_30px_rgba(14,165,233,0.12)]' : 'border-white/75 bg-white/62'
              } ${canJumpToStep ? 'transition hover:border-slate-300 hover:bg-white' : 'cursor-default'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[13px] ${index === currentStep ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  <i className={`fas ${step.icon} text-[12px]`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black tracking-[0.16em] text-slate-400">步骤 {index + 1}</p>
                    {canJumpToStep ? <span className="text-[10px] font-black text-slate-400">可直接编辑</span> : null}
                  </div>
                  <p className="mt-1 text-[13px] font-black text-slate-900">{step.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-5 text-slate-500">{step.detail}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </WorkspaceShellCard>

      <WorkspaceShellCard className="overflow-hidden border border-white/70 bg-white/82 shadow-[0_24px_60px_rgba(148,163,184,0.13)] backdrop-blur-2xl">
        <div ref={contentTopRef} />
        <div className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.66))] px-5 py-4">
          <SectionTitle eyebrow={currentMeta.eyebrow} title={currentMeta.sectionTitle} detail={currentMeta.detail} icon={currentMeta.icon} />
          <div className="flex flex-wrap gap-2">
            {currentMeta.checkpoints.map((item) => (
              <span key={item} className="rounded-full border border-white/75 bg-white/72 px-3 py-1 text-[11px] font-black text-slate-500 shadow-[0_8px_18px_rgba(148,163,184,0.08)]">
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="px-5 py-5">
        {currentStep === 0 ? (
          <div className="grid gap-5">
            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className={panelClassName}>
                <FieldLabel title="图标预览" detail="头像会出现在广场、会话列表和消息头部。" />
                <div className="flex items-center gap-4 rounded-[20px] border border-slate-200/70 bg-slate-50/80 p-4">
                  <AgentAvatar name={form.name || 'A'} iconUrl={form.iconUrl} avatarPreset={form.avatarPreset} className="h-[76px] w-[76px] rounded-[26px] text-2xl shadow-[0_14px_30px_rgba(148,163,184,0.18)]" />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-black text-slate-900">{form.name || '未命名智能体'}</p>
                    <p className="mt-1 text-[12px] font-medium text-slate-500">{form.department || '通用'} · {form.iconUrl ? '已上传图标' : '默认头像'}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <FieldLabel title="默认头像" detail="没有上传图标时使用，和当前工作台卡片风格保持一致。" />
                  <div className="grid grid-cols-3 gap-2">
                    {AGENT_AVATAR_PRESETS.map((item) => {
                      const active = form.avatarPreset === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onChange('avatarPreset', item.id)}
                          className={`rounded-[18px] border px-2.5 py-3 text-center transition ${
                            active ? 'border-cyan-200 bg-cyan-50/90 shadow-[0_12px_24px_rgba(14,165,233,0.1)]' : 'border-slate-200/80 bg-white/82 hover:border-slate-300'
                          }`}
                        >
                          <div className={`mx-auto h-9 w-9 rounded-[15px] bg-gradient-to-br ${item.gradientClassName}`} />
                          <p className="mt-2 text-[11px] font-black text-slate-700">{item.label}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <label className={smallButtonClassName}>
                    <i className="fas fa-upload text-[11px]" />
                    上传图标
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => onChange('iconUrl', String(reader.result || ''));
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  {form.iconUrl ? (
                    <button type="button" onClick={() => onChange('iconUrl', '')} className="rounded-[14px] px-3 py-2 text-[12px] font-black text-rose-600 transition hover:bg-rose-50">
                      移除已上传图标
                    </button>
                  ) : null}
                </div>
              </div>

              <div className={panelClassName}>
                <SectionTitle eyebrow="基础档案" title="名称、说明与部门" detail="这里决定管理列表和用户入口看到的第一层信息。" icon="fa-pen-to-square" />
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <FieldLabel title="智能体名称" />
                    <input
                      value={form.name}
                      onChange={(event) => onChange('name', event.target.value)}
                      placeholder="智能体名称"
                      className={inputClassName}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel title="所属部门" />
                    <select
                      value={form.department || '通用'}
                      onChange={(event) => onChange('department', event.target.value)}
                      className={inputClassName}
                    >
                      {departmentOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="md:col-span-2">
                    <FieldLabel title="自定义部门" detail="输入后点添加，会立即作为当前部门使用。" />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={customDepartment}
                        onChange={(event) => setCustomDepartment(event.target.value)}
                        placeholder="自定义部门"
                        className={inputClassName}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextDepartment = customDepartment.trim();
                          if (!nextDepartment) return;
                          onChange('department', nextDepartment);
                          setCustomDepartment('');
                        }}
                        className={`${smallButtonClassName} sm:w-[112px]`}
                      >
                        添加部门
                      </button>
                    </div>
                  </div>
                  <label className="block md:col-span-2">
                    <FieldLabel title="智能体说明" detail="建议写清楚适用任务，避免和其它智能体混淆。" />
                    <textarea
                      value={form.description}
                      onChange={(event) => onChange('description', event.target.value)}
                      placeholder="智能体说明"
                      className={`${inputClassName} min-h-[132px] resize-y leading-6`}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep === 1 ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
            <div className={panelClassName}>
              <SectionTitle eyebrow="提示词结构" title="系统提示词" detail="写清楚角色、流程、边界、输出格式和禁止事项。" icon="fa-terminal" />
              <textarea
                value={form.systemPrompt}
                onChange={(event) => onChange('systemPrompt', event.target.value)}
                placeholder="系统提示词"
                className={`${inputClassName} min-h-[360px] resize-y leading-7`}
              />
            </div>
            <div className="space-y-4">
              <div className={panelClassName}>
                <SectionTitle eyebrow="首次会话" title="开场白" detail="新会话时自动发送，留空则不发送。" icon="fa-comments" />
                <textarea
                  value={form.openingRemarks}
                  onChange={(event) => onChange('openingRemarks', event.target.value)}
                  placeholder="新会话时自动发送，向用户介绍智能体功能和使用方法（留空则不发送）"
                  className={`${inputClassName} min-h-[180px] resize-y leading-6`}
                />
              </div>
              <div className={subPanelClassName}>
                <p className="text-[12px] font-black text-slate-700">建议结构</p>
                <div className="mt-3 grid gap-2 text-[12px] font-medium leading-5 text-slate-500">
                  <p>1. 角色身份：这个智能体代表谁、服务什么任务。</p>
                  <p>2. 工作流程：先问什么，再判断什么，最后输出什么。</p>
                  <p>3. 输出边界：不确定时如何追问，不能做什么承诺。</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep === 2 ? (
          <div className="space-y-5">
            <div className={panelClassName}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle eyebrow="知识库范围" title="选择可检索知识库" detail="只绑定已有知识库，不在这里直接编辑知识库内容。" icon="fa-book-bookmark" />
                <div className="rounded-full border border-white/75 bg-white/75 px-3 py-1.5 text-[11px] font-black text-slate-500">
                  已选 {form.selectedKnowledgeBaseIds.length} 个库 · {selectedKnowledgeDocumentCount} 个文档
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {knowledgeBases.map((item) => {
                const checked = form.selectedKnowledgeBaseIds.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className={`flex min-h-[148px] cursor-pointer flex-col rounded-[20px] border px-4 py-4 transition ${
                      checked ? 'border-cyan-200 bg-cyan-50/90 shadow-[0_14px_30px_rgba(14,165,233,0.08)]' : 'border-slate-200/80 bg-white/76 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-[14px] text-sm shadow-[0_10px_22px_rgba(15,23,42,0.12)] ${checked ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        <i className="fas fa-book-open" />
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          onChange(
                            'selectedKnowledgeBaseIds',
                            event.target.checked
                              ? [...form.selectedKnowledgeBaseIds, item.id]
                              : form.selectedKnowledgeBaseIds.filter((id) => id !== item.id)
                          )
                        }
                        className="mt-1"
                      />
                    </div>
                    <div className="mt-3 min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-slate-900">{item.name}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">{item.documentCount} 个文档{item.department ? ` · ${item.department}` : ''}</p>
                      <p className="mt-2 line-clamp-3 text-[12px] font-medium leading-5 text-slate-500">
                        {item.description || '暂无说明'}
                      </p>
                    </div>
                  </label>
                );
              })}
              {knowledgeBases.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-[13px] font-medium text-slate-500 sm:col-span-2 xl:col-span-3">
                  暂无可绑定知识库，请先到知识库管理创建。
                </div>
              ) : null}
              </div>
            </div>
            {form.selectedKnowledgeBaseIds.length > 0 ? (
              <div className="space-y-4">
                {form.selectedKnowledgeBaseIds.map((knowledgeBaseId) => {
                  const knowledgeBase = knowledgeBases.find((item) => item.id === knowledgeBaseId);
                  const documents = knowledgeDocumentsByBase[knowledgeBaseId] || [];
                  const enabledDocumentIds = resolveEnabledDocumentIds(knowledgeBaseId);
                  return (
                    <div key={knowledgeBaseId} className={panelClassName}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-900">{knowledgeBase?.name || '已绑定知识库'}</p>
                          <p className="mt-1 text-[12px] font-medium text-slate-500">文档启用设置只影响当前智能体版本。已启用 {enabledDocumentIds.length}/{documents.length}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onChange(
                              'knowledgeDocumentBindings',
                              form.knowledgeDocumentBindings
                                .filter((item) => item.knowledgeBaseId !== knowledgeBaseId)
                                .concat([{ knowledgeBaseId, enabledDocumentIds: documents.map((item) => item.id) }])
                            )}
                            className={smallButtonClassName}
                          >
                            全选
                          </button>
                          <button
                            type="button"
                            onClick={() => onChange(
                              'knowledgeDocumentBindings',
                              form.knowledgeDocumentBindings
                                .filter((item) => item.knowledgeBaseId !== knowledgeBaseId)
                                .concat([{ knowledgeBaseId, enabledDocumentIds: [] }])
                            )}
                            className={smallButtonClassName}
                          >
                            全不选
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        {documents.map((document) => {
                          const checked = enabledDocumentIds.includes(document.id);
                          return (
                            <label key={document.id} className={`flex items-start gap-3 rounded-[18px] border px-4 py-3 transition ${checked ? 'border-cyan-100 bg-cyan-50/50' : 'border-slate-200/80 bg-slate-50/70'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  const nextIds = event.target.checked
                                    ? [...enabledDocumentIds, document.id]
                                    : enabledDocumentIds.filter((id) => id !== document.id);
                                  onChange(
                                    'knowledgeDocumentBindings',
                                    form.knowledgeDocumentBindings
                                      .filter((item) => item.knowledgeBaseId !== knowledgeBaseId)
                                      .concat([{ knowledgeBaseId, enabledDocumentIds: Array.from(new Set(nextIds)) }])
                                  );
                                }}
                                className="mt-1"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-black text-slate-900">{document.title}</p>
                                <p className="mt-1 text-[11px] font-medium text-slate-500">
                                  {document.chunkStrategy} · {document.chunkCount} 个片段
                                </p>
                              </div>
                            </label>
                          );
                        })}
                        {documents.length === 0 ? (
                          <p className="text-[12px] font-medium text-slate-500">该知识库下暂无文档可供配置。</p>
                        ) : null}
                        {documents.length > 0 && enabledDocumentIds.length === 0 ? (
                          <p className="text-[12px] font-medium text-amber-600">该知识库当前不会提供检索内容</p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {currentStep === 3 ? (
          <div className="grid gap-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
              <div className={panelClassName}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-black tracking-[0.18em] text-slate-500">聊天模型</p>
                    <div className="group relative">
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-500 transition hover:text-slate-900"
                        aria-label="聊天模型说明"
                        title="聊天模型说明"
                      >
                        <i className="fas fa-circle-question text-xs" />
                      </button>
                      <div className="pointer-events-none absolute left-0 top-8 z-10 hidden w-72 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-medium leading-6 text-white shadow-[0_18px_40px_rgba(15,23,42,0.24)] group-hover:block">
                        用户在聊天页只能看到并选择这里启用的模型。
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full border border-white/75 bg-white/85 px-3 py-1 text-[11px] font-black text-slate-500">
                    已选 {form.allowedChatModels.length} 个
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {availableChatModels.map((item) => {
                    const checked = form.allowedChatModels.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-[18px] border px-4 py-3 transition ${
                          checked ? 'border-cyan-200 bg-cyan-50/60' : 'border-slate-200/80 bg-white/72 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...form.allowedChatModels, item.id]
                              : form.allowedChatModels.filter((modelId) => modelId !== item.id);
                            onChange('allowedChatModels', next);
                          }}
                          className="mt-1"
                        />
                        <div>
                          <p className="text-sm font-black text-slate-900">{item.label}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{item.id}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                <label className="flex items-center justify-between gap-3 rounded-[20px] border border-slate-200/80 bg-white/82 px-4 py-3 shadow-[0_10px_22px_rgba(148,163,184,0.08)]">
                  <div>
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">启用生图模型</span>
                    <p className="mt-1 text-[12px] font-medium text-slate-500">开启后，聊天会话页会显示生图模式按钮。</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.enableImageGeneration}
                    onChange={(event) => onChange('enableImageGeneration', event.target.checked)}
                    className="h-4 w-4"
                  />
                </label>

                <label className="block">
                  <FieldLabel title="简单问题模型" />
                  <select
                    value={form.cheapModel}
                    onChange={(event) => onChange('cheapModel', event.target.value)}
                    className={inputClassName}
                  >
                    {cheapChatOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <FieldLabel title="默认聊天模型" />
                  <select
                    value={form.defaultChatModel}
                    onChange={(event) => onChange('defaultChatModel', event.target.value)}
                    className={inputClassName}
                  >
                    {defaultChatOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <FieldLabel title="默认生图模型" detail={form.enableImageGeneration ? `当前模型最多支持输入 ${availableImageModels.find((item) => item.id === form.imageModel)?.maxInputImages || '-'} 张图。` : '启用生图模型后生效。'} />
                  <select
                    value={form.imageModel}
                    onChange={(event) => onChange('imageModel', event.target.value)}
                    disabled={!form.enableImageGeneration}
                    className={inputClassName}
                  >
                    {availableImageModels.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className={subPanelClassName}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">检索参考数量</span>
                    <div className="group relative">
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-500 transition hover:text-slate-900"
                        aria-label="检索参考数量说明"
                        title="检索参考数量说明"
                      >
                        <i className="fas fa-circle-question text-xs" />
                      </button>
                      <div className="pointer-events-none absolute left-0 top-8 z-10 hidden w-72 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-medium leading-6 text-white shadow-[0_18px_40px_rgba(15,23,42,0.24)] group-hover:block">
                        检索参考数量说明：当问题需要查知识库时，系统最多带给模型参考的片段数量。越大，信息越多，但响应会更慢、成本也更高。
                      </div>
                    </div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={String(form.topK)}
                    onChange={(event) => onChange('topK', Number(event.target.value || 3))}
                    className={inputClassName}
                  />
                </div>
              </div>
            </div>
            {/* 功能接口 */}
            <div className={panelClassName}>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">功能接口</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">启用后，智能体将按接口规范输出策划内容，用户可一键发送到对应功能生成。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.values(MODULE_INTERFACES).map((iface) => {
                  const active = form.linkedModuleInterfaces.includes(iface.id);
                  return (
                    <label
                      key={iface.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-[16px] border px-3 py-2 text-[12px] font-black transition ${
                        active ? 'border-violet-200 bg-violet-50 text-violet-700 shadow-[0_10px_20px_rgba(124,58,237,0.08)]' : 'border-slate-200 bg-white/80 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...form.linkedModuleInterfaces, iface.id]
                            : form.linkedModuleInterfaces.filter((id) => id !== iface.id);
                          onChange('linkedModuleInterfaces', next);
                        }}
                        className="hidden"
                      />
                      <i className={`fas ${active ? 'fa-check-circle' : 'fa-circle'} text-[10px]`} />
                      {iface.label}
                      <span className="text-[10px] font-medium opacity-60">{iface.description}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {currentStep === 4 ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className={panelClassName}>
              <SectionTitle eyebrow="提交前检查" title="基础信息" detail="确认用户在入口看到的信息准确。" icon="fa-clipboard-check" />
              <div className="flex items-center gap-4 rounded-[20px] border border-slate-200/70 bg-slate-50/70 p-4">
                <AgentAvatar name={form.name || 'A'} iconUrl={form.iconUrl} avatarPreset={form.avatarPreset} className="h-[64px] w-[64px] rounded-[22px] text-xl shadow-[0_12px_24px_rgba(148,163,184,0.18)]" />
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-black text-slate-900">{form.name || '未填写名称'}</p>
                  <p className="mt-1 text-[12px] font-medium text-slate-500">{form.department || '未填写部门'} · {form.iconUrl ? '已上传图标' : '默认头像'}</p>
                  <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-5 text-slate-600">{form.description || '未填写说明'}</p>
                </div>
              </div>
              <div className="mt-4 rounded-[18px] border border-slate-200/70 bg-white/70 p-4">
                <p className="text-[12px] font-black text-slate-700">提示词状态</p>
                <p className="mt-2 text-[12px] font-medium leading-6 text-slate-500">
                  系统提示词 {form.systemPrompt.trim() ? `${form.systemPrompt.trim().length} 字` : '未填写'} · 开场白 {form.openingRemarks.trim() ? `${form.openingRemarks.trim().length} 字` : '未填写'}
                </p>
              </div>
            </div>
            <div className={panelClassName}>
              <SectionTitle eyebrow="策略摘要" title="知识库与模型" detail="确认草稿保存后会按这些策略运行。" icon="fa-diagram-project" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={subPanelClassName}>
                  <p className="text-[11px] font-black text-slate-400">绑定知识库</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{form.selectedKnowledgeBaseIds.length} 个</p>
                  <p className="mt-1 text-[12px] font-medium text-slate-500">启用文档 {selectedKnowledgeDocumentCount} 个</p>
                </div>
                <div className={subPanelClassName}>
                  <p className="text-[11px] font-black text-slate-400">已启用聊天模型</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{form.allowedChatModels.length} 个</p>
                  <p className="mt-1 text-[12px] font-medium text-slate-500">默认：{form.defaultChatModel || '-'}</p>
                </div>
                <div className={subPanelClassName}>
                  <p className="text-[11px] font-black text-slate-400">简单问题模型</p>
                  <p className="mt-2 truncate text-[13px] font-black text-slate-900">{form.cheapModel || '-'}</p>
                  <p className="mt-1 text-[12px] font-medium text-slate-500">检索参考 {form.topK} 条</p>
                </div>
                <div className={subPanelClassName}>
                  <p className="text-[11px] font-black text-slate-400">生图模型</p>
                  <p className="mt-2 truncate text-[13px] font-black text-slate-900">{form.enableImageGeneration ? form.imageModel || '-' : '未启用'}</p>
                  <p className="mt-1 text-[12px] font-medium text-slate-500">功能接口：{enabledInterfaceLabels.length ? enabledInterfaceLabels.join('、') : '未启用'}</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-slate-100/80 bg-white/88 px-5 py-4 backdrop-blur-2xl">
          <button
            onClick={onPrev}
            disabled={currentStep === 0}
            className="rounded-[16px] border border-slate-200/80 bg-white/90 px-4 py-3 text-[13px] font-black text-slate-700 shadow-[0_8px_18px_rgba(148,163,184,0.08)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            上一步
          </button>
          <div className="hidden text-center text-[11px] font-medium text-slate-400 sm:block">
            第 {currentStep + 1} 步 / 共 {steps.length} 步
          </div>
          {currentStep < steps.length - 1 ? (
            <button onClick={onNext} className="rounded-[16px] bg-slate-900 px-5 py-3 text-[13px] font-black text-white shadow-[0_14px_28px_rgba(15,23,42,0.16)]">
              下一步
            </button>
          ) : (
            <button onClick={onSubmit} className="rounded-[16px] bg-emerald-600 px-5 py-3 text-[13px] font-black text-white shadow-[0_14px_28px_rgba(5,150,105,0.18)]">
              {mode === 'create' ? '创建智能体' : '保存草稿'}
            </button>
          )}
        </div>
      </WorkspaceShellCard>
    </div>
  );
};

export default AgentWizardView;
