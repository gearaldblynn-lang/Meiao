import React, { useEffect, useState } from 'react';
import { AgentSummary, AgentVersion, KnowledgeBaseSummary } from '../../types';
import { SegmentedTabs, WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import AgentAvatar from './AgentAvatar';

interface Props {
  agent: AgentSummary | null;
  versions: AgentVersion[];
  selectedVersionId: string;
  detailTab: 'config' | 'knowledge' | 'test' | 'versions';
  selectedKnowledgeBaseIds: string[];
  knowledgeBases: KnowledgeBaseSummary[];
  validationMessage: string;
  validationResult: Record<string, unknown> | null;
  onBack: () => void;
  onDetailTabChange: (tab: Props['detailTab']) => void;
  onEditDraft: () => void;
  onEditConfig: () => void;
  onEditKnowledge: () => void;
  onCreateDraft: () => void;
  onPublish: () => void;
  onDeleteAgent: () => void;
  onSelectVersion: (versionId: string) => void;
  onRollback: (versionId: string) => void;
  onDeleteVersion: (versionId: string) => void;
  onVersionNameChange: (versionId: string, versionName: string) => void;
  onKnowledgeBaseEditor: () => void;
  onValidationMessageChange: (value: string) => void;
  onValidate: () => void;
  onOpenStudio?: () => void;
}

const formatVersionMeta = (version: AgentVersion | null) => {
  if (!version) return '-';
  return `${version.versionName} · V${version.versionNo}`;
};

const formatCost = (value: unknown) => Number(value || 0).toFixed(6);

const baseInfoCardClass = 'rounded-[16px] border border-white/70 bg-white/58 px-3 py-2.5 shadow-[0_8px_18px_rgba(148,163,184,0.06)] backdrop-blur-xl';

const AgentDetailView: React.FC<Props> = ({
  agent,
  versions,
  selectedVersionId,
  detailTab,
  selectedKnowledgeBaseIds,
  knowledgeBases,
  validationMessage,
  validationResult,
  onBack,
  onDetailTabChange,
  onEditDraft,
  onEditConfig,
  onEditKnowledge,
  onCreateDraft,
  onPublish,
  onDeleteAgent,
  onSelectVersion,
  onRollback,
  onDeleteVersion,
  onVersionNameChange,
  onKnowledgeBaseEditor,
  onValidationMessageChange,
  onValidate,
  onOpenStudio,
}) => {
  const selectedVersion = versions.find((item) => item.id === selectedVersionId) || versions[0] || null;
  const publishedVersion = versions.find((item) => item.isPublished) || null;
  const draftVersion = versions.find((item) => !item.isPublished) || null;
  const boundKnowledgeBases = knowledgeBases.filter((item) => selectedKnowledgeBaseIds.includes(item.id));
  const [versionNameDrafts, setVersionNameDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setVersionNameDrafts(Object.fromEntries(versions.map((version) => [version.id, version.versionName])));
  }, [versions]);

  if (!agent) return null;

  const publishReady = Boolean(draftVersion && draftVersion.validationStatus === 'success');

  return (
    <div className="w-full space-y-4 pb-4">
      <WorkspaceShellCard className="overflow-hidden border border-white/65 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(248,250,252,0.68))] px-4 py-3.5 shadow-[0_20px_48px_rgba(148,163,184,0.12)] backdrop-blur-2xl xl:px-5">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="flex min-w-0 items-start gap-3.5">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/75 bg-white/70 text-sm font-black text-slate-700 shadow-[0_8px_20px_rgba(148,163,184,0.14)] backdrop-blur-xl transition hover:-translate-y-0.5"
              aria-label="返回列表"
              title="返回列表"
            >
              ←
            </button>
            <AgentAvatar name={agent.name} iconUrl={agent.iconUrl} avatarPreset={agent.avatarPreset} className="mt-0.5 h-12 w-12 shrink-0 rounded-[18px] text-base shadow-[0_8px_20px_rgba(148,163,184,0.16)]" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-full border border-white/75 bg-white/78 px-2.5 py-0.5 text-[10px] font-black tracking-[0.14em] text-slate-500 shadow-[0_8px_18px_rgba(148,163,184,0.1)] backdrop-blur-xl">
                  智能体管理
                </div>
                <span className="text-[12px] font-medium text-slate-500">{agent.department || '通用'}</span>
                <span className="text-slate-300">·</span>
                <span className="text-[12px] font-medium text-slate-500">{agent.ownerDisplayName || '当前管理员'}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
                <h3 className="text-[21px] font-black tracking-[-0.04em] text-slate-950">{agent.name}</h3>
              </div>
              <p className="mt-1 text-[12px] font-medium leading-5 text-slate-500">{agent.description || '暂无说明'}</p>
            </div>
          </div>

          <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
            {onOpenStudio && (
              <button type="button" onClick={onOpenStudio} className="rounded-[18px] bg-[linear-gradient(135deg,#06b6d4,#0891b2)] px-3.5 py-2 text-[13px] font-black text-white shadow-[0_10px_24px_rgba(6,182,212,0.22)]">智能体工作室</button>
            )}
            <button onClick={onEditDraft} className="rounded-[18px] border border-white/75 bg-white/70 px-3.5 py-2 text-[13px] font-black text-slate-700 shadow-[0_8px_20px_rgba(148,163,184,0.12)] backdrop-blur-xl">编辑草稿</button>
            <button onClick={onCreateDraft} className="rounded-[18px] border border-white/75 bg-white/70 px-3.5 py-2 text-[13px] font-black text-slate-700 shadow-[0_8px_20px_rgba(148,163,184,0.12)] backdrop-blur-xl">新建草稿</button>
            <button
              onClick={onPublish}
              className={`rounded-[18px] px-3.5 py-2 text-[13px] font-black shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition ${publishReady ? 'bg-[linear-gradient(135deg,#10b981,#059669)] text-white' : 'cursor-pointer border border-slate-200 bg-slate-200 text-slate-500'}`}
              title={publishReady ? '发布当前草稿' : '请先完成测试验证'}
            >
              发布
            </button>
            <button onClick={onDeleteAgent} className="rounded-[18px] border border-rose-200/80 bg-white/70 px-3.5 py-2 text-[13px] font-black text-rose-600 shadow-[0_8px_20px_rgba(244,63,94,0.08)] backdrop-blur-xl">删除</button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div className={baseInfoCardClass}>
            <p className="text-[10px] font-bold tracking-[0.04em] text-slate-400">发布版本</p>
            <p className="mt-0.5 text-[12px] font-medium leading-5 text-slate-700">{formatVersionMeta(publishedVersion)}</p>
          </div>
          <div className={baseInfoCardClass}>
            <p className="text-[10px] font-bold tracking-[0.04em] text-slate-400">草稿版本</p>
            <p className="mt-0.5 text-[12px] font-medium leading-5 text-slate-700">{formatVersionMeta(draftVersion)}</p>
          </div>
          <div className={baseInfoCardClass}>
            <p className="text-[10px] font-bold tracking-[0.04em] text-slate-400">当前查看</p>
            <p className="mt-0.5 text-[12px] font-medium leading-5 text-slate-700">{formatVersionMeta(selectedVersion)}</p>
          </div>
          <div className={baseInfoCardClass}>
            <p className="text-[10px] font-bold tracking-[0.04em] text-slate-400">验证状态</p>
            <p className="mt-0.5 text-[12px] font-medium capitalize leading-5 text-slate-700">{selectedVersion?.validationStatus || '-'}</p>
          </div>
        </div>
      </WorkspaceShellCard>

      <SegmentedTabs
        value={detailTab}
        onChange={(value) => onDetailTabChange(value as Props['detailTab'])}
        items={[
          { value: 'config', label: '配置', icon: 'fa-sliders' },
          { value: 'knowledge', label: '知识库', icon: 'fa-book-open' },
          { value: 'test', label: '测试', icon: 'fa-vial' },
          { value: 'versions', label: '版本', icon: 'fa-code-branch' },
        ]}
      />

      {detailTab === 'config' ? (
        <WorkspaceShellCard className="border border-white/65 bg-white/78 px-6 py-6 shadow-[0_24px_60px_rgba(148,163,184,0.14)] backdrop-blur-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-[18px] font-black tracking-[-0.03em] text-slate-900">配置</h4>
              <p className="mt-1 text-[13px] font-medium text-slate-500">这里展示当前版本配置，也可以直接进入对应草稿步骤编辑。</p>
            </div>
            <button onClick={onEditConfig} className="rounded-[16px] border border-white/75 bg-white/72 px-3.5 py-2 text-[12px] font-black text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.12)] backdrop-blur-xl">编辑配置</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">默认模型</p><p className="mt-2 text-sm font-black text-slate-900">{selectedVersion?.modelPolicy.defaultModel || '-'}</p></div>
            <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">简单问题模型</p><p className="mt-2 text-sm font-black text-slate-900">{selectedVersion?.modelPolicy.cheapModel || '-'}</p></div>
            <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">检索参考数量</p><p className="mt-2 text-sm font-black text-slate-900">{selectedVersion?.retrievalPolicy.topK || '-'}</p></div>
            <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">绑定知识库</p><p className="mt-2 text-sm font-black text-slate-900">{selectedVersion?.knowledgeBaseIds.length || 0} 个</p></div>
          </div>
          <div className="mt-6 rounded-[28px] border border-white/70 bg-white/72 p-5 shadow-[0_18px_40px_rgba(148,163,184,0.12)] backdrop-blur-xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">系统提示词</p>
            <p className="mt-3 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700">{selectedVersion?.systemPrompt || '暂无配置。'}</p>
          </div>
        </WorkspaceShellCard>
      ) : null}

      {detailTab === 'knowledge' ? (
        <WorkspaceShellCard className="border border-white/65 bg-white/78 px-6 py-6 shadow-[0_24px_60px_rgba(148,163,184,0.14)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xl font-black tracking-[-0.03em] text-slate-900">已绑定知识库</h4>
              <p className="mt-1 text-sm font-medium text-slate-500">可直接编辑当前草稿的绑定关系，知识库内容本身仍在独立页面维护。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={onEditKnowledge} className="rounded-2xl border border-white/75 bg-white/72 px-4 py-3 text-sm font-black text-slate-700 shadow-[0_12px_30px_rgba(148,163,184,0.16)] backdrop-blur-xl">编辑知识库</button>
              <button onClick={onKnowledgeBaseEditor} className="rounded-2xl border border-white/75 bg-white/72 px-4 py-3 text-sm font-black text-slate-700 shadow-[0_12px_30px_rgba(148,163,184,0.16)] backdrop-blur-xl">去知识库管理</button>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {boundKnowledgeBases.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-slate-200 bg-white/55 px-4 py-10 text-center text-sm font-medium text-slate-500 backdrop-blur-xl">当前版本未绑定知识库。</div>
            ) : boundKnowledgeBases.map((item) => (
              <div key={item.id} className="rounded-[26px] border border-white/70 bg-white/72 px-4 py-4 shadow-[0_16px_32px_rgba(148,163,184,0.1)] backdrop-blur-xl">
                <p className="text-sm font-black text-slate-900">{item.name}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">{item.department} · {item.documentCount} 个文档</p>
              </div>
            ))}
          </div>
        </WorkspaceShellCard>
      ) : null}

      {detailTab === 'test' ? (
        <WorkspaceShellCard className="border border-white/65 bg-white/78 px-6 py-6 shadow-[0_24px_60px_rgba(148,163,184,0.14)] backdrop-blur-2xl">
          <div className="grid gap-4">
            <textarea value={validationMessage} onChange={(event) => onValidationMessageChange(event.target.value)} placeholder="输入测试问题" className="min-h-[120px] rounded-[24px] border border-white/75 bg-white/72 px-4 py-3 text-sm font-medium text-slate-700 outline-none shadow-[0_12px_30px_rgba(148,163,184,0.12)] backdrop-blur-xl" />
            <div>
              <button onClick={onValidate} disabled={!selectedVersion} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-50">执行验证</button>
            </div>
            {validationResult ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">验证状态</p><p className="mt-2 text-sm font-black text-slate-900">{selectedVersion?.validationStatus || '-'}</p></div>
                <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">使用模型</p><p className="mt-2 text-sm font-black text-slate-900">{String(validationResult.selectedModel || '-')}</p></div>
                <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">是否检索</p><p className="mt-2 text-sm font-black text-slate-900">{validationResult.usedRetrieval ? '是' : '否'}</p></div>
                <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">总 Token</p><p className="mt-2 text-sm font-black text-slate-900">{String(validationResult.totalTokens || 0)}</p></div>
                <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">预计成本</p><p className="mt-2 text-sm font-black text-slate-900">{formatCost(validationResult.estimatedCost)}</p></div>
                <div className={baseInfoCardClass}><p className="text-xs font-black text-slate-500">耗时</p><p className="mt-2 text-sm font-black text-slate-900">{String(validationResult.latencyMs || 0)} ms</p></div>
                <div className="rounded-[28px] border border-white/70 bg-white/72 p-5 shadow-[0_18px_40px_rgba(148,163,184,0.12)] backdrop-blur-xl md:col-span-2 xl:col-span-3">
                  <p className="text-xs font-black text-slate-500">输出摘要</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700">{String(validationResult.outputPreview || validationResult.content || '暂无结果')}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-[26px] border border-dashed border-slate-200 bg-white/55 px-4 py-10 text-center text-sm font-medium text-slate-500 backdrop-blur-xl">执行验证后，这里会展示可读的结果摘要，不再直接输出原始 JSON。</div>
            )}
          </div>
        </WorkspaceShellCard>
      ) : null}

      {detailTab === 'versions' ? (
        <WorkspaceShellCard className="border border-white/65 bg-white/78 px-6 py-6 shadow-[0_24px_60px_rgba(148,163,184,0.14)] backdrop-blur-2xl">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <h4 className="text-[20px] font-black tracking-[-0.03em] text-slate-900">版本管理</h4>
              <p className="mt-1 text-[13px] font-medium text-slate-500">用卡牌查看每个版本的状态、命名和可执行操作。</p>
            </div>
            <div className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[11px] font-black text-slate-500">
              共 {versions.length} 个版本
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {versions.map((version) => {
              const canRename = !version.isPublished;
              const versionName = versionNameDrafts[version.id] ?? version.versionName;
              const active = selectedVersionId === version.id;
              return (
                <div key={version.id} className={`rounded-[20px] border p-3.5 shadow-[0_12px_28px_rgba(148,163,184,0.08)] backdrop-blur-xl ${active ? 'border-cyan-200 bg-[linear-gradient(135deg,rgba(236,254,255,0.88),rgba(255,255,255,0.78))]' : 'border-white/70 bg-white/72'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className={`rounded-full px-2.5 py-1 text-[10px] font-black tracking-[0.08em] ${version.isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {version.isPublished ? '已发布' : '草稿'}
                      </div>
                      <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                        V{version.versionNo}
                      </div>
                    </div>
                    <div className="rounded-full bg-white/72 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                      验证 {version.validationStatus}
                    </div>
                  </div>

                  <div className="mt-2.5">
                    {canRename ? (
                      <input
                        value={versionName}
                        onChange={(event) => setVersionNameDrafts((prev) => ({ ...prev, [version.id]: event.target.value }))}
                        onBlur={() => {
                          if (versionName.trim() && versionName.trim() !== version.versionName) {
                            onVersionNameChange(version.id, versionName);
                          }
                        }}
                        className="w-full rounded-[14px] border border-white/75 bg-white/82 px-3 py-2.5 text-[13px] font-semibold text-slate-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
                      />
                    ) : (
                      <p className="text-[15px] font-black text-slate-900">{version.versionName}</p>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
                    <span>{new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    <span className="text-slate-300">·</span>
                    <span>{version.id === publishedVersion?.id ? '当前发布中' : active ? '当前查看中' : '可切换'}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => onSelectVersion(version.id)} className="rounded-[14px] border border-white/75 bg-white/72 px-3 py-1.5 text-[12px] font-black text-slate-700 shadow-[0_8px_18px_rgba(148,163,184,0.1)] backdrop-blur-xl">查看</button>
                    <button onClick={() => onRollback(version.id)} disabled={version.id === publishedVersion?.id} className="rounded-[14px] border border-white/75 bg-white/72 px-3 py-1.5 text-[12px] font-black text-slate-700 shadow-[0_8px_18px_rgba(148,163,184,0.1)] backdrop-blur-xl disabled:opacity-50">回滚</button>
                    <button onClick={() => onDeleteVersion(version.id)} disabled={version.isPublished} className="rounded-[14px] border border-rose-200/80 bg-white/72 px-3 py-1.5 text-[12px] font-black text-rose-600 shadow-[0_8px_18px_rgba(244,63,94,0.08)] backdrop-blur-xl disabled:opacity-50">删除版本</button>
                  </div>
                </div>
              );
            })}
          </div>
        </WorkspaceShellCard>
      ) : null}

    </div>
  );
};

export default AgentDetailView;
