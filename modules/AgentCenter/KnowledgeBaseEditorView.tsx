import React, { useState } from 'react';
import { KnowledgeBaseSummary, KnowledgeDocumentSummary } from '../../types';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import { KNOWLEDGE_CHUNK_STRATEGY_META } from './agentCenterUtils.mjs';

interface Props {
  knowledgeBase: KnowledgeBaseSummary | null;
  documents: KnowledgeDocumentSummary[];
  form: { name: string; description: string; department: string };
  documentForm: {
    title: string;
    rawText: string;
    sourceType: 'manual' | 'upload';
    chunkStrategy: 'general' | 'rule' | 'sop' | 'faq' | 'case';
    normalizationEnabled: boolean;
  };
  editingDocumentId: string;
  onBack: () => void;
  onFormChange: (field: 'name' | 'description' | 'department', value: string) => void;
  onDocumentFormChange: (
    field: 'title' | 'rawText' | 'sourceType' | 'chunkStrategy' | 'normalizationEnabled',
    value: string | boolean,
  ) => void;
  onUploadTextFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onDeleteKnowledgeBase: () => void;
  onCreateDocument: () => void;
  onCancelDocumentEdit: () => void;
  onEditDocument: (documentId: string) => void;
  onDeleteDocument: (documentId: string) => void;
}

const fieldClassName =
  'w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-[14px] font-medium text-slate-700 outline-none';

const KnowledgeBaseEditorView: React.FC<Props> = ({
  knowledgeBase,
  documents,
  form,
  documentForm,
  editingDocumentId,
  onBack,
  onFormChange,
  onDocumentFormChange,
  onUploadTextFile,
  onSave,
  onDeleteKnowledgeBase,
  onCreateDocument,
  onCancelDocumentEdit,
  onEditDocument,
  onDeleteDocument,
}) => {
  const [showGuide, setShowGuide] = useState(false);
  const [showChunkGuide, setShowChunkGuide] = useState(false);
  const [showNormalizationGuide, setShowNormalizationGuide] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      <div className="mx-auto w-full max-w-[1520px] space-y-4 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/75 bg-white/70 text-sm font-black text-slate-700 shadow-[0_8px_20px_rgba(148,163,184,0.14)] transition hover:-translate-y-0.5"
              aria-label="返回知识库列表"
              title="返回知识库列表"
            >
              ←
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[20px] font-black text-slate-950">{knowledgeBase ? knowledgeBase.name : '新建知识库'}</h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                  aria-label="查看知识库说明"
                  title="知识库使用说明"
                >
                  <i className="fas fa-circle-question text-[12px]" />
                </button>
              </div>
              <p className="mt-1 text-[11px] font-medium text-slate-400">{knowledgeBase ? '维护基础信息与入库文档。' : '先创建知识库，再继续新增文档。'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!knowledgeBase}
              className="rounded-[18px] border border-rose-200 px-4 py-2.5 text-[13px] font-black text-rose-700 disabled:opacity-50"
            >
              删除
            </button>
            <button onClick={onSave} className="rounded-[18px] bg-slate-900 px-4 py-2.5 text-[13px] font-black text-white">保存</button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <WorkspaceShellCard className="bg-white px-4 py-4 shadow-[0_18px_44px_rgba(148,163,184,0.08)]">
            <div className="grid gap-3 md:grid-cols-2">
              <input value={form.name} onChange={(event) => onFormChange('name', event.target.value)} placeholder="知识库名称" className={fieldClassName} />
              <input value={form.department} onChange={(event) => onFormChange('department', event.target.value)} placeholder="所属部门" className={fieldClassName} />
              <textarea value={form.description} onChange={(event) => onFormChange('description', event.target.value)} placeholder="知识库说明" className="min-h-[104px] rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-[14px] font-medium text-slate-700 outline-none md:col-span-2" />
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-[16px] font-black text-slate-900">已入库文档</h4>
                <span className="text-[12px] font-medium text-slate-400">{documents.length} 个</span>
              </div>
              <div className="mt-3 space-y-3">
                {documents.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-slate-200 px-4 py-8 text-center text-[13px] font-medium text-slate-500">
                    当前还没有文档。
                  </div>
                ) : documents.map((document) => (
                  <div
                    key={document.id}
                    className={`flex items-start justify-between gap-3 rounded-[18px] border px-4 py-3.5 ${
                      editingDocumentId === document.id ? 'border-cyan-300 bg-cyan-50/70' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-black text-slate-900">{document.title}</p>
                      <p className="mt-1 text-[12px] font-medium text-slate-500">
                        {document.sourceType} · {KNOWLEDGE_CHUNK_STRATEGY_META[document.chunkStrategy || 'general']?.label || '通用型'} · {document.chunkCount} 个片段 · {document.parseStatus} · {document.chunkSource === 'normalized' ? 'AI整理切片' : '原文切片'}
                      </p>
                      {document.normalizationEnabled ? (
                        <>
                          <p className="mt-1 text-[11px] font-medium text-slate-400">
                            AI 规范整理：{document.normalizedStatus === 'success' ? '已完成' : document.normalizedStatus === 'failed' ? '失败，已回退原文' : '未执行'}
                          </p>
                          {document.normalizedStatus === 'failed' && document.normalizationError ? (
                            <p className="mt-1 text-[11px] font-medium leading-5 text-amber-600">
                              失败原因：{document.normalizationError}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onEditDocument(document.id)} className="rounded-[14px] border border-slate-200 px-3 py-2 text-[12px] font-black text-slate-700">编辑</button>
                      <button onClick={() => onDeleteDocument(document.id)} className="rounded-[14px] border border-rose-200 px-3 py-2 text-[12px] font-black text-rose-700">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </WorkspaceShellCard>

          <WorkspaceShellCard className="bg-white px-4 py-4 shadow-[0_18px_44px_rgba(148,163,184,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[16px] font-black text-slate-900">{editingDocumentId ? '编辑文档' : '新增文档'}</h4>
              <span className="text-[11px] font-medium text-slate-400">支持文本上传与手动粘贴</span>
            </div>

            <div className="mt-4 space-y-3">
              {editingDocumentId ? (
                <div className="flex flex-wrap gap-2">
                  <button onClick={onCancelDocumentEdit} type="button" className="rounded-[14px] border border-slate-200 px-3 py-2 text-[12px] font-black text-slate-700">
                    取消编辑
                  </button>
                </div>
              ) : null}
              <input value={documentForm.title} onChange={(event) => onDocumentFormChange('title', event.target.value)} placeholder="文档标题" className={fieldClassName} />
              <select value={documentForm.sourceType} onChange={(event) => onDocumentFormChange('sourceType', event.target.value)} className={fieldClassName}>
                <option value="manual">手动录入</option>
                <option value="upload">文本上传</option>
              </select>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-black text-slate-900">切片策略</span>
                  <button type="button" onClick={() => setShowChunkGuide(true)} className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500" aria-label="查看切片策略说明" title="查看切片策略说明">
                    <i className="fas fa-circle-question text-[10px]" />
                  </button>
                </div>
                <select value={documentForm.chunkStrategy} onChange={(event) => onDocumentFormChange('chunkStrategy', event.target.value)} className={fieldClassName}>
                  {Object.entries(KNOWLEDGE_CHUNK_STRATEGY_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                <p className="text-[12px] font-medium leading-5 text-slate-500">
                  {KNOWLEDGE_CHUNK_STRATEGY_META[documentForm.chunkStrategy]?.description}
                </p>
              </div>
              <label className="flex items-start gap-3 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={documentForm.normalizationEnabled}
                  onChange={(event) => onDocumentFormChange('normalizationEnabled', event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[13px] font-black text-slate-900">
                    入库前先做 AI 规范整理
                    <button type="button" onClick={() => setShowNormalizationGuide(true)} className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500" aria-label="查看 AI 规范整理说明" title="查看 AI 规范整理说明">
                      <i className="fas fa-circle-question text-[10px]" />
                    </button>
                  </span>
                  <p className="mt-1 text-[12px] font-medium leading-5 text-slate-500">
                    适合规则、SOP、提示词规范类文档；不适合案例库、原始素材记录和需要逐字保留原意的内容。
                  </p>
                </span>
              </label>
              <label className="block rounded-[18px] border border-dashed border-slate-300 px-4 py-5 text-center text-[13px] font-bold text-slate-500">
                上传文本文件
                <input type="file" accept=".txt,.md,.csv,.json" className="hidden" onChange={onUploadTextFile} />
              </label>
              <textarea value={documentForm.rawText} onChange={(event) => onDocumentFormChange('rawText', event.target.value)} placeholder="手动粘贴 SOP / FAQ / 规则内容" className="min-h-[240px] w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-[14px] font-medium text-slate-700 outline-none" />
              <button onClick={onCreateDocument} disabled={!knowledgeBase} className="w-full rounded-[18px] bg-slate-900 px-4 py-3 text-[14px] font-black text-white disabled:opacity-50">
                {editingDocumentId ? '保存并重新切片' : '入库并切片'}
              </button>
            </div>
          </WorkspaceShellCard>
        </div>
      </div>

      {showGuide ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/24 px-6">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[24px] font-black text-slate-950">知识库使用说明</h3>
                <p className="mt-1 text-[13px] font-medium text-slate-500">给第一次配置知识库的同事快速上手。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                aria-label="关闭知识库说明"
              >
                <i className="fas fa-xmark text-sm" />
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">怎么配置</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">先建知识库名称和部门，再新增文档。文档入库后，再回到智能体里绑定这个知识库。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">原理是什么</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">知识库不会整份塞给模型，而是先存文档，再按问题检索相关片段，把少量命中内容带给模型回答。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">什么是切片</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">切片就是把长文档拆成多个短片段，方便后续检索和引用。片段越清晰，命中越稳定。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">支持格式</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">当前支持 `.txt`、`.md`、`.csv`、`.json`，也支持直接手动粘贴文本。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 md:col-span-2">
                <h4 className="text-[15px] font-black text-slate-900">文档标准建议</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">一份文档尽量只讲一类主题。标题清楚、段落短、规则明确，避免把多个部门或多个流程混在同一份文档里。</p>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {showChunkGuide ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/24 px-6">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[24px] font-black text-slate-950">切片策略说明</h3>
                <p className="mt-1 text-[13px] font-medium text-slate-500">不同内容类型，适合不同的切片方式。</p>
              </div>
              <button type="button" onClick={() => setShowChunkGuide(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500" aria-label="关闭切片策略说明">
                <i className="fas fa-xmark text-sm" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {Object.entries(KNOWLEDGE_CHUNK_STRATEGY_META).map(([key, meta]) => (
                <section key={key} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <h4 className="text-[15px] font-black text-slate-900">{meta.label}</h4>
                  <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">{meta.description}</p>
                  <p className="mt-2 text-[12px] font-medium text-slate-400">默认单片长度上限：{meta.maxChunkChars} 字</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showNormalizationGuide ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/24 px-6">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[24px] font-black text-slate-950">AI 规范整理说明</h3>
                <p className="mt-1 text-[13px] font-medium text-slate-500">用于把杂乱规则整理成更适合检索的结构化表达。</p>
              </div>
              <button type="button" onClick={() => setShowNormalizationGuide(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500" aria-label="关闭 AI 规范整理说明">
                <i className="fas fa-xmark text-sm" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 md:col-span-2">
                <h4 className="text-[15px] font-black text-slate-900">什么是 AI 规范整理</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">系统会先保留原文，再用大模型把杂乱规则整理成更适合检索的结构化表达，然后优先对整理版切片。整理失败时，会自动回退为原文切片，不会阻止入库。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">什么时候建议开启</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">适合规则文档、SOP、参数规范、提示词规范、决策规则库。尤其适合你这种生图规则、SKU 规则、多图输入规则。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">什么时候不建议开启</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">不适合案例库、原始素材记录、需要逐字保留原文的文档，也不适合内容本身已经结构很清晰的短文档。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">优点</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">命中更稳、规则更完整、对“检索参考数量”更友好，尤其能减少规则被切得过碎导致只命中半条规则的问题。</p>
              </section>
              <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <h4 className="text-[15px] font-black text-slate-900">风险</h4>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">模型可能改变原文表达，所以系统始终保留原文；若文档强调逐字准确，请关闭该开关，直接按原文切片。</p>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/24 px-6">
          <div className="w-full max-w-md rounded-[24px] border border-white/80 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[20px] font-black text-slate-950">永久删除确认</h3>
                <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">确认删除后不可恢复，知识库、已入库文档和切片都会被一并删除。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                aria-label="关闭删除确认"
              >
                <i className="fas fa-xmark text-sm" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-[16px] border border-slate-200 bg-white px-4 py-2 text-[13px] font-black text-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDeleteKnowledgeBase();
                }}
                className="rounded-[16px] bg-rose-500 px-4 py-2 text-[13px] font-black text-white"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default KnowledgeBaseEditorView;
