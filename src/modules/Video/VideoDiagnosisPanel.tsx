import React from 'react';
import { SystemPublicConfig, VideoDiagnosisAnalysisSection, VideoDiagnosisAnalysisItem, VideoDiagnosisState, VideoSubMode } from '../../types';
import {
  PopoverSelect,
  PrimaryActionButton,
  SectionCard,
  SegmentedTabs,
  SidebarShell,
  WorkspaceShellCard,
} from '../../components/ui/workspacePrimitives';
import { summarizeProbeOutcome } from './videoDiagnosisUtils.mjs';

interface Props {
  state: VideoDiagnosisState;
  chatModels: SystemPublicConfig['agentModels']['chat'];
  subMode: VideoSubMode;
  onSubModeChange: (next: VideoSubMode) => void;
  onChange: (updates: Partial<VideoDiagnosisState>) => void;
  onProbe: () => void | Promise<void>;
  onAnalyze: () => void | Promise<void>;
}

const ANALYSIS_ITEM_OPTIONS: Array<{ value: VideoDiagnosisAnalysisItem; label: string; hint: string }> = [
  { value: 'video_basic', label: '视频基础信息', hint: '标题、描述、发布时间等' },
  { value: 'video_metrics', label: '视频互动指标', hint: '点赞、评论、分享、播放等' },
  { value: 'author_profile', label: '作者画像', hint: '主页信息、粉丝数等' },
  { value: 'comment_sample', label: '评论抽样', hint: '部分热门评论内容' },
  { value: 'recent_posts', label: '最近作品', hint: '作者近期作品列表' },
  { value: 'risk_signals', label: '风险信号', hint: '可能的限流/违规/敏感提示' },
];

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

const LEVEL_STYLES = {
  normal: { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check text-emerald-500' },
  warning: { bar: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-triangle-exclamation text-amber-400' },
  danger: { bar: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-circle-xmark text-rose-500' },
};

const RISK_STYLES = {
  low: { label: '低风险', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  medium: { label: '中风险', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  high: { label: '高风险', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  unknown: { label: '未知', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const DiagnosisSection: React.FC<{ section: VideoDiagnosisAnalysisSection }> = ({ section }) => {
  const style = LEVEL_STYLES[section.level] || LEVEL_STYLES.normal;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className={`h-1 w-full ${style.bar}`} />
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <i className={`fas ${style.icon} text-sm`} />
          <span className="text-[13px] font-black text-slate-800">{section.title}</span>
          <span className={cx('ml-auto text-[10px] font-black px-2 py-0.5 rounded-full border', style.badge)}>
            {section.level === 'normal' ? '正常' : section.level === 'warning' ? '注意' : '风险'}
          </span>
        </div>
        {section.findings.length > 0 && (
          <ul className="space-y-2 mb-3">
            {section.findings.map((finding, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-slate-600 leading-5">
                <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-slate-300" />
                {finding}
              </li>
            ))}
          </ul>
        )}
        {section.suggestion && (
          <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-[11px] font-semibold text-slate-600 leading-5">
            <i className="fas fa-lightbulb text-amber-400 mr-1.5" />
            {section.suggestion}
          </div>
        )}
      </div>
    </div>
  );
};

const VideoDiagnosisPanel: React.FC<Props> = ({ state, chatModels, subMode, onSubModeChange, onChange, onProbe }) => {
  const safeUrl = state.url ?? '';
  const safePlatform = state.platform || 'tiktok';
  const safeAnalysisItems = Array.isArray(state.analysisItems) ? state.analysisItems : [];
  const probeStatus = state.probe?.status || 'idle';
  const isProbing = probeStatus === 'loading';

  const platformMismatch = (() => {
    const url = safeUrl.trim();
    if (!url) return null;
    const isTikTok = /tiktok\.com|vm\.tiktok\.com/i.test(url);
    const isDouyin = /douyin\.com|v\.douyin\.com/i.test(url);
    const isXhs = /xiaohongshu\.com|xhslink\.com|xhs\.cn/i.test(url);
    if (safePlatform === 'tiktok' && (isDouyin || isXhs)) return isDouyin ? '链接看起来是抖音，请切换平台' : '链接看起来是小红书，请切换平台';
    if (safePlatform === 'douyin' && (isTikTok || isXhs)) return isTikTok ? '链接看起来是 TikTok，请切换平台' : '链接看起来是小红书，请切换平台';
    if (safePlatform === 'xhs' && (isTikTok || isDouyin)) return isTikTok ? '链接看起来是 TikTok，请切换平台' : '链接看起来是抖音，请切换平台';
    return null;
  })();

  const canProbe = Boolean(safeUrl.trim()) && !isProbing && !platformMismatch;
  const hasProbeData = probeStatus === 'success' && state.probe?.normalized?.diag;
  const aiStatus = state.aiAnalysis?.status || 'idle';
  const isAnalyzing = aiStatus === 'loading';
  const canAnalyze = Boolean(hasProbeData) && !isAnalyzing && Boolean(state.analysisModel);
  const probeSummary = summarizeProbeOutcome(state.probe);
  const riskStyle = RISK_STYLES[state.aiAnalysis?.overallRisk || 'unknown'] || RISK_STYLES.unknown;

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
          <div className="space-y-2">
            <PrimaryActionButton
              label={
                !safeUrl.trim() ? '请输入链接'
                : platformMismatch ? '平台与链接不匹配'
                : isProbing ? '勘探中...'
                : isAnalyzing ? 'AI 分析中...'
                : '一键勘探深度分析'
              }
              icon={isProbing || isAnalyzing ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}
              disabled={!canProbe || isAnalyzing}
              onClick={onProbe}
            />
          </div>
        }
      >
        <SectionCard title="目标输入" icon="fa-link" accentTextClass="text-emerald-600" description="选择平台，粘贴视频/笔记链接，开始字段勘探。">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">平台</div>
              <PopoverSelect
                value={safePlatform}
                options={[{ value: 'tiktok', label: 'TikTok' }, { value: 'douyin', label: '抖音' }, { value: 'xhs', label: '小红书' }]}
                onChange={(next) => onChange({ platform: next as any })}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{safePlatform === 'xhs' ? '笔记链接' : '视频链接'}</div>
                {safeUrl.trim() && (
                  <button type="button" onClick={() => onChange({ url: '' })} className="text-[10px] font-black text-slate-300 hover:text-rose-500">清空</button>
                )}
              </div>
              <textarea
                value={safeUrl}
                onChange={(e) => onChange({ url: e.target.value })}
                placeholder={safePlatform === 'xhs' ? '粘贴小红书笔记链接或分享文本...' : '粘贴 TikTok / 抖音 视频链接...'}
                className={cx('h-24 w-full resize-none rounded-2xl border px-4 py-3 text-xs font-semibold text-slate-700 shadow-inner outline-none transition-all focus:bg-white', platformMismatch ? 'border-rose-300 bg-rose-50 focus:border-rose-400' : 'border-slate-200 bg-slate-50 focus:border-emerald-300')}
              />
              {platformMismatch && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-rose-500">
                  <i className="fas fa-triangle-exclamation" />
                  {platformMismatch}
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="AI 分析模型" icon="fa-brain" accentTextClass="text-emerald-600" description="勘探完成后，选择模型进行深度诊断。">
          <PopoverSelect
            value={state.analysisModel || ''}
            options={chatModels.length > 0 ? chatModels.map((m) => ({ value: m.id, label: m.label })) : [{ value: '', label: '加载中...' }]}
            onChange={(next) => onChange({ analysisModel: next })}
            buttonClassName="h-10 rounded-2xl px-4 text-xs"
          />
        </SectionCard>

        <SectionCard title="勘探状态" icon="fa-gauge" accentTextClass="text-slate-700">
          <div className="space-y-2">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">状态</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">{probeStatus}</span>
              </div>
              <div className="text-[11px] font-black text-slate-700">{probeSummary}</div>
              {state.probe?.error && <div className="mt-1 text-[11px] text-rose-600">{state.probe.error}</div>}
            </div>
            {Array.isArray(state.probe?.sources) && state.probe.sources.length > 0 && (
              <div className="space-y-1">
                {state.probe.sources.map((src) => (
                  <div key={src.key} className="flex items-center gap-2 px-1">
                    <i className={cx('fas text-[10px]',
                      src.status === 'success' ? 'fa-circle-check text-emerald-500' :
                      src.status === 'error' ? 'fa-circle-xmark text-rose-400' :
                      'fa-circle-minus text-slate-300'
                    )} />
                    <span className="text-[11px] text-slate-500">{src.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      </SidebarShell>

      <div className="min-w-0 flex-1 overflow-auto p-6">
        {aiStatus === 'idle' && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <i className="fas fa-brain text-4xl text-slate-200" />
              <p className="text-[13px] font-semibold text-slate-400">
                {hasProbeData ? '点击「AI 深度分析」生成诊断报告' : `先输入${safePlatform === 'xhs' ? '笔记' : '视频'}链接并完成勘探`}
              </p>
            </div>
          </div>
        )}

        {aiStatus === 'loading' && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <i className="fas fa-spinner fa-spin text-3xl text-emerald-500" />
              <p className="text-[13px] font-semibold text-slate-500">AI 正在分析视频数据...</p>
            </div>
          </div>
        )}

        {aiStatus === 'error' && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <i className="fas fa-circle-xmark text-3xl text-rose-400" />
              <p className="text-[13px] font-semibold text-rose-500">{state.aiAnalysis?.error || 'AI 分析失败'}</p>
            </div>
          </div>
        )}

        {aiStatus === 'success' && state.aiAnalysis && (
          <div className="space-y-5 max-w-3xl mx-auto">
            <WorkspaceShellCard className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-2">诊断总结</div>
                  <p className="text-sm font-semibold leading-6 text-slate-700">{state.aiAnalysis.summary}</p>
                </div>
                <span className={cx('shrink-0 text-[11px] font-black px-3 py-1.5 rounded-full border', riskStyle.cls)}>
                  {riskStyle.label}
                </span>
              </div>
            </WorkspaceShellCard>

            {state.aiAnalysis.sections.map((section) => (
              <DiagnosisSection key={section.id} section={section} />
            ))}

            {state.aiAnalysis.topActions.length > 0 && (
              <WorkspaceShellCard className="p-5">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-3">优先操作建议</div>
                <ol className="space-y-2">
                  {state.aiAnalysis.topActions.map((action, i) => (
                    <li key={i} className="flex items-start gap-3 text-[12px] text-slate-700 leading-5">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black flex items-center justify-center">{i + 1}</span>
                      {action}
                    </li>
                  ))}
                </ol>
              </WorkspaceShellCard>
            )}

            <div className="text-center text-[10px] text-slate-300 pb-4">
              {state.aiAnalysis.completedAt ? `分析完成于 ${new Date(state.aiAnalysis.completedAt).toLocaleString()}` : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoDiagnosisPanel;