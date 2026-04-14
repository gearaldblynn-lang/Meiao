import React from 'react';
import { VideoDiagnosisAnalysisItem, VideoDiagnosisState, VideoSubMode } from '../../types';
import {
  PopoverSelect,
  PrimaryActionButton,
  SectionCard,
  SegmentedTabs,
  SidebarShell,
  WorkspaceShellCard,
} from '../../components/ui/workspacePrimitives';
import { formatEvidenceValue, summarizeProbeOutcome } from './videoDiagnosisUtils.mjs';

interface Props {
  state: VideoDiagnosisState;
  subMode: VideoSubMode;
  onSubModeChange: (next: VideoSubMode) => void;
  onChange: (updates: Partial<VideoDiagnosisState>) => void;
  onProbe: () => void | Promise<void>;
}

const ANALYSIS_ITEM_OPTIONS: Array<{ value: VideoDiagnosisAnalysisItem; label: string; hint: string }> = [
  { value: 'video_basic', label: '视频基础信息', hint: '标题、描述、发布时间等' },
  { value: 'video_metrics', label: '视频互动指标', hint: '点赞、评论、分享、播放等' },
  { value: 'author_profile', label: '作者画像', hint: '主页信息、粉丝数等' },
  { value: 'comment_sample', label: '评论抽样', hint: '部分热门评论内容' },
  { value: 'recent_posts', label: '最近作品', hint: '作者近期作品列表' },
  { value: 'risk_signals', label: '风险信号', hint: '可能的限流/违规/敏感提示' },
];

const joinClasses = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

const safeJsonStringify = (value: unknown, space = 2) => {
  const visited = new WeakSet<object>();
  const replacer = (_key: string, next: any) => {
    if (typeof next === 'bigint') return `${next.toString()}n`;
    if (typeof next === 'object' && next !== null) {
      if (visited.has(next)) return '[Circular]';
      visited.add(next);
    }
    return next;
  };

  try {
    const result = JSON.stringify(value, replacer, space);
    return typeof result === 'string' ? result : '';
  } catch (_err) {
    try {
      return String(value);
    } catch (_err2) {
      return '';
    }
  }
};

const VideoDiagnosisPanel: React.FC<Props> = ({ state, subMode, onSubModeChange, onChange, onProbe }) => {
  const safeUrl = state.url ?? '';
  const safePlatform = state.platform || 'tiktok';
  const safeAccessMode = state.accessMode || 'spider_api';
  const safeAnalysisItems = Array.isArray(state.analysisItems) ? state.analysisItems : [];
  const probeStatus = state.probe?.status || 'idle';
  const isProbing = probeStatus === 'loading';
  const isSupportedAccessMode = safeAccessMode === 'spider_api';
  const canProbe = Boolean(safeUrl.trim()) && !isProbing && isSupportedAccessMode;

  const probeSummary = summarizeProbeOutcome(state.probe);
  const reportSummary = state.report?.summary?.trim() || '暂无诊断报告（先进行勘探）';
  const rawPreview = state.probe?.raw ? safeJsonStringify(state.probe.raw, 2) : '';

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-50">
      <SidebarShell
        accentClass="bg-emerald-600"
        title="视频诊断配置"
        subtitle="诊断勘探模式"
        titleClassName="text-sm font-bold tracking-[0.02em] text-slate-500"
        subtitleClassName="text-[11px] font-black tracking-[0.18em] text-slate-900"
        headerContent={
          <SegmentedTabs
            items={[
              { value: VideoSubMode.STORYBOARD, label: '脚本分镜', icon: 'fa-clapperboard' },
              { value: VideoSubMode.DIAGNOSIS, label: '视频诊断', icon: 'fa-magnifying-glass' },
            ]}
            value={subMode}
            onChange={onSubModeChange}
            accentClass="bg-slate-950 text-white"
          />
        }
        footer={
          <PrimaryActionButton
            label={
              !safeUrl.trim()
                ? '请输入链接'
                : !isSupportedAccessMode
                  ? '仅支持 Spider API'
                  : isProbing
                    ? '勘探中...'
                    : '开始勘探'
            }
            icon="fa-magnifying-glass"
            disabled={!canProbe}
            onClick={onProbe}
          />
        }
      >
        <SectionCard
          title="目标输入"
          icon="fa-link"
          accentTextClass="text-emerald-600"
          description="选择平台，粘贴视频链接，开始字段勘探。"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">平台</div>
                <PopoverSelect
                  value={safePlatform}
                  options={[
                    { value: 'tiktok', label: 'TikTok' },
                    { value: 'douyin', label: '抖音' },
                  ]}
                  onChange={(next) => onChange({ platform: next })}
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">接入方式</div>
                <PopoverSelect
                  value={safeAccessMode}
                  options={[
                    { value: 'spider_api', label: 'Spider API' },
                    { value: 'web_session', label: 'Web Session' },
                  ]}
                  onChange={(next) => onChange({ accessMode: next })}
                />
                {!isSupportedAccessMode ? (
                  <div className="mt-2 text-[11px] font-semibold text-rose-600">当前探测接口仅支持 Spider API。</div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">视频链接</div>
                {safeUrl.trim() ? (
                  <button
                    type="button"
                    onClick={() => onChange({ url: '' })}
                    className="text-[10px] font-black text-slate-300 transition-colors hover:text-rose-500"
                  >
                    清空
                  </button>
                ) : null}
              </div>
              <textarea
                value={safeUrl}
                onChange={(event) => onChange({ url: event.target.value })}
                placeholder="粘贴 TikTok / 抖音 视频链接..."
                className="h-28 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700 shadow-inner outline-none transition-all focus:border-emerald-300 focus:bg-white"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="勘探范围"
          icon="fa-layer-group"
          accentTextClass="text-slate-700"
          description="MVP 默认勾选三项，可按需调整。"
        >
          <div className="space-y-2">
            {ANALYSIS_ITEM_OPTIONS.map((option) => {
              const active = safeAnalysisItems.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    const nextItems = active
                      ? safeAnalysisItems.filter((item) => item !== option.value)
                      : [...safeAnalysisItems, option.value];
                    onChange({ analysisItems: nextItems });
                  }}
                  className={joinClasses(
                    'flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition-all',
                    active
                      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-black">{option.label}</div>
                    <div className={joinClasses('mt-1 text-[11px] leading-5', active ? 'text-emerald-600/80' : 'text-slate-400')}>
                      {option.hint}
                    </div>
                  </div>
                  <div className={joinClasses('mt-0.5 shrink-0 text-[10px]', active ? 'text-emerald-600' : 'text-slate-300')}>
                    <i className={joinClasses('fas', active ? 'fa-check-circle' : 'fa-circle')}></i>
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="当前状态" icon="fa-gauge" accentTextClass="text-slate-700">
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Probe</span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">
                {probeStatus}
              </span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[11px] font-black text-slate-700">{probeSummary}</div>
              {state.probe?.error ? <div className="mt-2 text-[11px] text-rose-600">{state.probe.error}</div> : null}
              {Array.isArray(state.probe?.missingCriticalFields) && state.probe.missingCriticalFields.length ? (
                <div className="mt-2 text-[11px] text-slate-500">
                  缺失字段: <span className="font-semibold">{state.probe.missingCriticalFields.join(', ')}</span>
                </div>
              ) : null}
            </div>
          </div>
        </SectionCard>
      </SidebarShell>

      <div className="min-w-0 flex-1 overflow-hidden p-6">
        <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          <WorkspaceShellCard className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">勘探原始结果</div>
                <div className="mt-1 text-[11px] text-slate-400">展示 `probe.raw` 的 JSON 预览（后续将接入更友好的字段面板）。</div>
              </div>
              <div className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-600">
                {state.probe?.completedAt ? `完成于 ${new Date(state.probe.completedAt).toLocaleString()}` : '尚未完成'}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-5 text-slate-100">
              {state.probe?.raw ? (
                <pre className="whitespace-pre-wrap break-words text-[11px] leading-5">
                  {rawPreview || '(无法序列化为 JSON)'}
                </pre>
              ) : (
                <div className="flex h-full items-center justify-center text-[11px] font-semibold text-slate-400">
                  暂无原始数据
                </div>
              )}
            </div>
          </WorkspaceShellCard>

          <WorkspaceShellCard className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">诊断报告预览</div>
              <div className="mt-1 text-[11px] text-slate-400">展示 `report.summary` 与少量证据样本（MVP）。</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-sm">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Summary</div>
                <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{reportSummary}</p>
              </div>

              {Array.isArray(state.report?.evidence) && state.report.evidence.length ? (
                <div className="mt-5 space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Evidence</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {state.report.evidence.slice(0, 6).map((item, index) => (
                      <div key={`${item.fieldPath}-${index}`} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-black text-slate-800">{item.label}</div>
                            <div className="mt-1 truncate text-[11px] font-semibold text-slate-400">{item.fieldPath}</div>
                          </div>
                          <div className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-700">
                            {item.source}
                          </div>
                        </div>
                        <div className="mt-3 rounded-2xl bg-slate-950 px-3 py-2 text-[11px] font-semibold text-slate-100">
                          {formatEvidenceValue(item.value) || '(空)'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-5 text-[11px] font-semibold text-slate-400">暂无证据卡片</div>
              )}
            </div>
          </WorkspaceShellCard>
        </div>
      </div>
    </div>
  );
};

export default VideoDiagnosisPanel;
