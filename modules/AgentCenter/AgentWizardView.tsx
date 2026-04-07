import React, { useMemo, useState } from 'react';
import { KnowledgeBaseSummary } from '../../types';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import AgentAvatar from './AgentAvatar';
import { AGENT_AVATAR_PRESETS } from './agentAvatarOptions';

interface WizardForm {
  name: string;
  description: string;
  department: string;
  iconUrl: string;
  avatarPreset: string;
  systemPrompt: string;
  selectedKnowledgeBaseIds: string[];
  allowedChatModels: string[];
  defaultChatModel: string;
  cheapModel: string;
  enableImageGeneration: boolean;
  imageModel: string;
  topK: number;
}

interface Props {
  mode: 'create' | 'edit';
  currentStep: number;
  form: WizardForm;
  knowledgeBases: KnowledgeBaseSummary[];
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

const AgentWizardView: React.FC<Props> = ({
  mode,
  currentStep,
  form,
  knowledgeBases,
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
  const canJumpToStep = mode === 'edit';
  const defaultChatOptions = availableChatModels.filter((item) => form.allowedChatModels.includes(item.id));
  const cheapChatOptions = defaultChatOptions.length ? defaultChatOptions : availableChatModels;
  const departmentOptions = useMemo(() => {
    const current = form.department?.trim();
    return current && !DEPARTMENT_PRESETS.includes(current) ? [...DEPARTMENT_PRESETS, current] : DEPARTMENT_PRESETS;
  }, [form.department]);

  return (
    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
      <WorkspaceShellCard className="h-fit bg-white/82 px-4 py-4 backdrop-blur-xl">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/82 px-3 py-2 text-sm font-black text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        >
          <i className="fas fa-arrow-left text-xs" />
          返回
        </button>
        <h3 className="mt-4 text-[18px] font-black text-slate-900">{mode === 'create' ? '新建智能体' : '编辑草稿'}</h3>
        <div className="mt-5 space-y-2.5">
          {steps.map((step, index) => (
            <button
              key={step}
              type="button"
              onClick={() => {
                if (!canJumpToStep) return;
                onStepChange(index);
              }}
              disabled={!canJumpToStep}
              className={`w-full rounded-[22px] border px-4 py-3 text-left ${
                index === currentStep ? 'border-cyan-300/80 bg-cyan-50/80 shadow-[0_16px_30px_rgba(14,165,233,0.12)]' : 'border-slate-200/80 bg-white/74'
              } ${canJumpToStep ? 'transition hover:border-slate-300 hover:bg-white' : 'cursor-default'}`}
            >
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">步骤 {index + 1}</p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="text-sm font-black text-slate-900">{step}</p>
                {canJumpToStep ? <span className="text-[11px] font-black text-slate-400">可直接编辑</span> : null}
              </div>
            </button>
          ))}
        </div>
      </WorkspaceShellCard>

      <WorkspaceShellCard className="bg-white/82 px-5 py-5 backdrop-blur-xl">
        {currentStep === 0 ? (
          <div className="grid gap-5">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4">
              <div className="flex flex-wrap items-start gap-5">
                <div className="space-y-3">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">图标预览</p>
                  <AgentAvatar name={form.name || 'A'} iconUrl={form.iconUrl} avatarPreset={form.avatarPreset} className="h-18 w-18 rounded-[24px] text-xl" />
                </div>
                <div className="min-w-[260px] flex-1">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">默认头像</p>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    {AGENT_AVATAR_PRESETS.map((item) => {
                      const active = form.avatarPreset === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onChange('avatarPreset', item.id)}
                          className={`rounded-2xl border px-3 py-2.5 ${
                            active ? 'border-cyan-300/80 bg-cyan-50/80' : 'border-slate-200/80 bg-white/90'
                          }`}
                        >
                          <div className={`h-10 w-10 rounded-2xl bg-gradient-to-br ${item.gradientClassName}`} />
                          <p className="mt-2 text-xs font-black text-slate-700">{item.label}</p>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm font-black text-slate-700">
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
                      <button type="button" onClick={() => onChange('iconUrl', '')} className="text-sm font-black text-rose-600">
                        移除已上传图标
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                value={form.name}
                onChange={(event) => onChange('name', event.target.value)}
                placeholder="智能体名称"
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 outline-none"
              />
              <div className="space-y-3">
                <select
                  value={form.department || '通用'}
                  onChange={(event) => onChange('department', event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                >
                  {departmentOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    value={customDepartment}
                    onChange={(event) => setCustomDepartment(event.target.value)}
                    placeholder="自定义部门"
                    className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const nextDepartment = customDepartment.trim();
                      if (!nextDepartment) return;
                      onChange('department', nextDepartment);
                      setCustomDepartment('');
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700"
                  >
                    添加部门
                  </button>
                </div>
              </div>
              <textarea
                value={form.description}
                onChange={(event) => onChange('description', event.target.value)}
                placeholder="智能体说明"
                className="min-h-[120px] rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 outline-none md:col-span-2"
              />
            </div>
          </div>
        ) : null}

        {currentStep === 1 ? (
          <textarea
            value={form.systemPrompt}
            onChange={(event) => onChange('systemPrompt', event.target.value)}
            placeholder="系统提示词"
            className="min-h-[300px] w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 outline-none"
          />
        ) : null}

        {currentStep === 2 ? (
          <div>
            <p className="text-sm font-medium text-slate-500">只绑定已有知识库，不在这里直接编辑知识库内容。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {knowledgeBases.map((item) => {
                const checked = form.selectedKnowledgeBaseIds.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className={`flex min-h-[148px] cursor-pointer flex-col rounded-[22px] border px-4 py-4 transition ${
                      checked ? 'border-cyan-300 bg-cyan-50 shadow-[0_14px_30px_rgba(14,165,233,0.08)]' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-slate-900 text-sm text-white shadow-[0_10px_22px_rgba(15,23,42,0.14)]">
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
            </div>
          </div>
        ) : null}

        {currentStep === 3 ? (
          <div className="grid gap-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
              <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">聊天模型</p>
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
                  <span className="rounded-full bg-white/85 px-3 py-1 text-[11px] font-black text-slate-500">
                    已选 {form.allowedChatModels.length} 个
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {availableChatModels.map((item) => {
                    const checked = form.allowedChatModels.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 ${
                          checked ? 'border-cyan-300/80 bg-white/95' : 'border-slate-200/80 bg-white/72'
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
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
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

                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">简单问题模型</span>
                  <select
                    value={form.cheapModel}
                    onChange={(event) => onChange('cheapModel', event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                  >
                    {cheapChatOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">默认聊天模型</span>
                  <select
                    value={form.defaultChatModel}
                    onChange={(event) => onChange('defaultChatModel', event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                  >
                    {defaultChatOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">默认生图模型</span>
                  <select
                    value={form.imageModel}
                    onChange={(event) => onChange('imageModel', event.target.value)}
                    disabled={!form.enableImageGeneration}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                  >
                    {availableImageModels.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {form.enableImageGeneration ? (
                    <p className="text-[12px] font-medium text-slate-500">
                      当前模型最多支持输入 {availableImageModels.find((item) => item.id === form.imageModel)?.maxInputImages || '-'} 张图。
                    </p>
                  ) : null}
                </label>

                <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4">
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
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {currentStep === 4 ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase text-slate-500">基础信息</p>
              <p className="mt-2 text-sm font-black text-slate-900">{form.name || '未填写名称'}</p>
              <p className="mt-1 text-sm font-medium text-slate-600">{form.department || '未填写部门'}</p>
              <p className="mt-2 text-sm font-medium text-slate-600">{form.description || '未填写说明'}</p>
              <p className="mt-2 text-sm font-medium text-slate-600">头像来源：{form.iconUrl ? '已上传图标' : '默认头像'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase text-slate-500">知识库与策略</p>
              <p className="mt-2 text-sm font-medium text-slate-600">绑定知识库 {form.selectedKnowledgeBaseIds.length} 个</p>
              <p className="mt-1 text-sm font-medium text-slate-600">默认聊天模型：{form.defaultChatModel || '-'}</p>
              <p className="mt-1 text-sm font-medium text-slate-600">简单问题模型：{form.cheapModel || '-'}</p>
              <p className="mt-1 text-sm font-medium text-slate-600">默认生图模型：{form.imageModel || '-'}</p>
              <p className="mt-1 text-sm font-medium text-slate-600">已启用聊天模型：{form.allowedChatModels.length} 个</p>
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={onPrev}
            disabled={currentStep === 0}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-50"
          >
            上一步
          </button>
          {currentStep < steps.length - 1 ? (
            <button onClick={onNext} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white">
              下一步
            </button>
          ) : (
            <button onClick={onSubmit} className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">
              {mode === 'create' ? '创建智能体' : '保存草稿'}
            </button>
          )}
        </div>
      </WorkspaceShellCard>
    </div>
  );
};

export default AgentWizardView;
