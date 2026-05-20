import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Cpu, KeyRound, Link2, LogIn, LogOut, Moon, RefreshCcw, Server, Shield } from 'lucide-react';
import { createDefaultWorkspacePreferences, loadPersistedAppState, savePersistedAppState, buildPersistedAppState } from '../../../utils/appState';
import {
  checkDreaminaLogin,
  fetchDreaminaStatus,
  fetchSystemConfig,
  logoutDreamina,
  startDreaminaLogin,
  updateSystemConfig,
} from '../../../services/internalApi';
import { getEffectiveConcurrency } from '../../../modules/Account/accountManagementUtils.mjs';
import { PopoverSelect } from '../../../components/ui/workspacePrimitives';
import type { AuthUser, SystemPublicConfig, WorkspacePreferences } from '../../../types';
import type { DreaminaLoginStart, DreaminaStatus } from '../../../services/internalApi';

const Toggle: React.FC<{ label: string; desc: string; checked: boolean; onChange: (next: boolean) => void }> = ({ label, desc, checked, onChange }) => (
  <div className="flex items-center justify-between py-3">
    <div>
      <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
    </div>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-elevated)' }}
    >
      <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform" style={{ left: checked ? 22 : 2 }} />
    </button>
  </div>
);

const GlobalApiSettings: React.FC<{ currentUser?: AuthUser | null }> = ({ currentUser = null }) => {
  const persisted = useMemo(() => buildPersistedAppState(loadPersistedAppState()), []);
  const [concurrency, setConcurrency] = useState(persisted.apiConfig.concurrency);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(
    persisted.apiConfig.workspacePreferences || createDefaultWorkspacePreferences(),
  );
  const [systemConfig, setSystemConfig] = useState<SystemPublicConfig | null>(null);
  const [loadingSystemConfig, setLoadingSystemConfig] = useState(false);
  const [systemConfigError, setSystemConfigError] = useState('');
  const [analysisModel, setAnalysisModel] = useState('');
  const [videoAnalysisModel, setVideoAnalysisModel] = useState('');
  const [savingAnalysisModel, setSavingAnalysisModel] = useState(false);
  const [analysisModelMessage, setAnalysisModelMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [dreaminaStatus, setDreaminaStatus] = useState<DreaminaStatus | null>(null);
  const [dreaminaLogin, setDreaminaLogin] = useState<DreaminaLoginStart | null>(null);
  const [dreaminaLoading, setDreaminaLoading] = useState(false);
  const [dreaminaMessage, setDreaminaMessage] = useState('');
  const canManageSystemSettings = currentUser?.role === 'admin';
  const effectiveConcurrency = getEffectiveConcurrency(systemConfig?.queue.maxConcurrency, currentUser?.jobConcurrency);

  useEffect(() => {
    let disposed = false;
    setLoadingSystemConfig(true);
    setSystemConfigError('');
    void fetchSystemConfig()
      .then((result) => {
        if (disposed) return;
        setSystemConfig(result.config);
        setAnalysisModel(result.config.systemSettings.analysisModel || '');
        setVideoAnalysisModel(result.config.systemSettings.videoAnalysisModel || '');
      })
      .catch((error) => {
        if (disposed) return;
        setSystemConfigError(error instanceof Error ? error.message : '系统配置读取失败');
      })
      .finally(() => {
        if (!disposed) setLoadingSystemConfig(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('meiao:workspace-preferences-updated', { detail: preferences }));
  }, [preferences]);

  useEffect(() => {
    if (!canManageSystemSettings) return;
    let disposed = false;

    const loadDreaminaStatus = async () => {
      setDreaminaLoading(true);
      try {
        const result = await fetchDreaminaStatus();
        if (disposed) return;
        setDreaminaStatus(result.status);
        setDreaminaMessage(result.status.message || '');
      } catch (error) {
        if (disposed) return;
        setDreaminaMessage(error instanceof Error ? error.message : '即梦状态读取失败');
      } finally {
        if (!disposed) setDreaminaLoading(false);
      }
    };

    void loadDreaminaStatus();

    return () => {
      disposed = true;
    };
  }, [canManageSystemSettings]);

  useEffect(() => {
    if (!canManageSystemSettings || !dreaminaLogin?.deviceCode || dreaminaStatus?.authenticated) return undefined;
    let active = true;
    let inFlight = false;

    const refreshDreaminaStatus = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const result = await checkDreaminaLogin({ deviceCode: dreaminaLogin.deviceCode, poll: 5 });
        if (!active) return;
        setDreaminaStatus(result.status);
        if (result.login.authenticated || result.status.authenticated) {
          setDreaminaLogin(null);
          setDreaminaMessage('即梦登录已完成。');
        } else {
          setDreaminaMessage('正在等待网页登录完成，页面会自动检测状态。');
        }
      } catch (error) {
        if (!active) return;
        setDreaminaMessage(error instanceof Error ? error.message : '即梦状态刷新失败');
      } finally {
        inFlight = false;
      }
    };

    void refreshDreaminaStatus();
    const timer = window.setInterval(() => {
      void refreshDreaminaStatus();
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canManageSystemSettings, dreaminaLogin?.deviceCode, dreaminaStatus?.authenticated]);

  const preferenceRows = useMemo(() => ([
    { key: 'compressImagesBeforeUpload', label: '上传前压缩图片', desc: '在上传前自动压缩大体积图片' },
    { key: 'playSoundAfterGeneration', label: '生成完成后播放提示音', desc: '任务完成时播放声音提醒' },
    { key: 'showGenerationProgress', label: '显示生成进度条', desc: '在卡片上显示实时生成进度' },
  ] as const), []);

  const handleSave = () => {
    const nextState = {
      ...persisted,
      apiConfig: {
        ...persisted.apiConfig,
        concurrency: canManageSystemSettings ? concurrency : effectiveConcurrency,
        workspacePreferences: preferences,
      },
    };
    savePersistedAppState(nextState);
    window.dispatchEvent(new CustomEvent('meiao:workspace-preferences-updated', { detail: preferences }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveAnalysisModel = async () => {
    if (!canManageSystemSettings) {
      setAnalysisModelMessage('仅管理员可以修改分析模型。');
      return;
    }
    setSavingAnalysisModel(true);
    setAnalysisModelMessage('');
    try {
      const result = await updateSystemConfig({ analysisModel, videoAnalysisModel });
      setSystemConfig(result.config);
      setAnalysisModel(result.config.systemSettings.analysisModel || '');
      setVideoAnalysisModel(result.config.systemSettings.videoAnalysisModel || '');
      setAnalysisModelMessage('已保存分析模型。');
    } catch (error) {
      setAnalysisModelMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingAnalysisModel(false);
    }
  };

  const handleStartDreaminaLogin = async () => {
    setDreaminaLoading(true);
    setDreaminaMessage('');
    setDreaminaLogin(null);
    try {
      const result = await startDreaminaLogin();
      setDreaminaLogin(result.login);
      setDreaminaStatus((prev) => prev ? {
        ...prev,
        authenticated: false,
        creditText: '',
        message: '正在等待网页登录完成，页面会自动检测状态。',
      } : prev);
      setDreaminaMessage('请完成即梦 OAuth 授权，页面会自动检测状态。');
    } catch (error) {
      setDreaminaMessage(error instanceof Error ? error.message : '启动登录失败');
    } finally {
      setDreaminaLoading(false);
    }
  };

  const handleCheckDreaminaLogin = async () => {
    if (!dreaminaLogin?.deviceCode) {
      setDreaminaMessage('请先开始即梦登录。');
      return;
    }
    setDreaminaLoading(true);
    setDreaminaMessage('');
    try {
      const result = await checkDreaminaLogin({ deviceCode: dreaminaLogin.deviceCode, poll: 30 });
      setDreaminaStatus(result.status);
      if (result.login.authenticated || result.status.authenticated) {
        setDreaminaLogin(null);
      }
      setDreaminaMessage(result.login.authenticated ? '即梦登录已完成。' : '授权尚未完成，请稍后再试。');
    } catch (error) {
      setDreaminaMessage(error instanceof Error ? error.message : '确认登录失败');
    } finally {
      setDreaminaLoading(false);
    }
  };

  const handleLogoutDreamina = async () => {
    setDreaminaLoading(true);
    setDreaminaMessage('');
    try {
      const result = await logoutDreamina();
      setDreaminaStatus(result.status);
      setDreaminaLogin(null);
      setDreaminaMessage('即梦登录已退出。');
    } catch (error) {
      setDreaminaMessage(error instanceof Error ? error.message : '退出失败');
    } finally {
      setDreaminaLoading(false);
    }
  };

  return (
    <div className="workspace-shell">
      <div className="workspace-content workspace-content-form">
        <div className="mb-6">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>系统设置</h2>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>配置 API 密钥、并发数等全局参数</p>
        </div>

      <div className="space-y-4">
          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <Server size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>内部服务托管</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>KIE 密钥由服务端统一接管，前端不再录入真实 Key</p>
              </div>
            </div>
            <div className="rounded-2xl border border-dashed px-4 py-3 text-[12px] leading-6" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              这里仅保留本地工作区偏好与并发控制，真实模型调用和密钥管理都走内部后端。
            </div>
            <div className="mt-4">
              <label className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>并发任务数</label>
              {canManageSystemSettings ? (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                    className="flex-1"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span className="w-6 text-center text-[14px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{concurrency}</span>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>由管理员统一设置</span>
                  <span className="text-[14px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{loadingSystemConfig ? '...' : String(effectiveConcurrency)}</span>
                </div>
              )}
            </div>
          </div>

          {canManageSystemSettings ? (
            <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                    <KeyRound size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>即梦视频服务</h3>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>仅管理员可配置，登录态保存在服务器侧 Dreamina CLI</p>
                  </div>
                </div>
                <span
                  className="rounded-full border px-3 py-1.5 text-[11px] font-medium"
                  style={{
                    borderColor: dreaminaStatus?.authenticated ? 'rgba(34,197,94,0.28)' : 'rgba(245,158,11,0.28)',
                    background: dreaminaStatus?.authenticated ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                    color: dreaminaStatus?.authenticated ? 'var(--success)' : 'rgb(180,83,9)',
                  }}
                >
                  {dreaminaStatus?.authenticated ? '已登录' : dreaminaStatus?.installed === false ? '未安装' : '未登录'}
                </span>
              </div>

              <div className="rounded-2xl border border-dashed px-4 py-3 text-[12px] leading-6" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                {dreaminaStatus?.installed === false
                  ? '未检测到 Dreamina CLI，请先在服务器安装 dreamina 命令，或配置 MEIAO_DREAMINA_CLI_PATH。'
                  : (dreaminaStatus?.message || '点击开始登录后，系统会返回即梦 OAuth 设备码授权信息。')}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl p-3" style={{ background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>CLI 路径</p>
                  <p className="mt-1 break-all text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{dreaminaStatus?.cliPath || 'dreamina'}</p>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>余额状态</p>
                  <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{dreaminaStatus?.creditText || '登录后可读取'}</p>
                  {dreaminaStatus?.userId || dreaminaStatus?.vipLevel ? (
                    <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {dreaminaStatus?.userId ? `账号 ID ${dreaminaStatus.userId}` : '账号信息已同步'}
                      {dreaminaStatus?.vipLevel ? ` · 等级 ${dreaminaStatus.vipLevel}` : ''}
                    </p>
                  ) : null}
                </div>
              </div>

              {dreaminaLogin ? (
                <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>登录授权信息</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>授权链接</p>
                      <a href={dreaminaLogin.verificationUri} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 break-all text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        <Link2 size={13} />
                        {dreaminaLogin.verificationUri || '未返回'}
                      </a>
                    </div>
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>用户码</p>
                      <p className="mt-1 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{dreaminaLogin.userCode || '未返回'}</p>
                    </div>
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>设备码</p>
                      <p className="mt-1 break-all text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{dreaminaLogin.deviceCode || '未返回'}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleStartDreaminaLogin()}
                  disabled={dreaminaLoading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-[13px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LogIn size={14} />
                  {dreaminaStatus?.authenticated ? '重新登录' : '开始登录'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCheckDreaminaLogin()}
                  disabled={dreaminaLoading || !dreaminaLogin?.deviceCode}
                  className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                >
                  <RefreshCcw size={14} />
                  确认登录
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogoutDreamina()}
                  disabled={dreaminaLoading || !dreaminaStatus?.authenticated}
                  className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
                >
                  <LogOut size={14} />
                  退出登录
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {dreaminaStatus?.authenticated ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> : <AlertCircle size={14} style={{ color: 'rgb(245,158,11)' }} />}
                <span>{dreaminaLoading ? '处理中...' : dreaminaMessage || (dreaminaStatus?.authenticated ? '即梦已可用于视频生成。' : '即梦尚未登录。')}</span>
              </div>
            </div>
          ) : null}

          {systemConfigError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
              {systemConfigError}
            </div>
          ) : null}

          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(34,197,94,0.1)' }}>
                <Server size={16} style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>系统状态</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>当前服务运行状态</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '服务状态', value: loadingSystemConfig ? '读取中' : systemConfigError ? '异常' : '正常', color: systemConfigError ? 'var(--error)' : 'var(--success)', icon: <Shield size={14} /> },
                { label: '当前并发', value: loadingSystemConfig ? '...' : String(effectiveConcurrency), color: 'var(--text-primary)', icon: <Cpu size={14} /> },
                { label: '队列中', value: loadingSystemConfig ? '...' : String(systemConfig?.queue.queuedCount ?? '0'), color: 'var(--text-primary)', icon: <Server size={14} /> },
              ].map((item) => (
                <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--bg-base)' }}>
                  <div className="mb-1.5 flex items-center justify-center gap-1" style={{ color: item.color }}>
                    {item.icon}
                    <span className="text-[11px] font-medium">{item.value}</span>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <Shield size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>策划分析模型</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>服务端策划、知识整理等文本/图片分析共用</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>策划分析模型</p>
                  <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>当前生效：{systemConfig?.systemSettings.effectiveAnalysisModel || '自动'}</span>
                </div>
              <PopoverSelect
                value={analysisModel}
                onChange={setAnalysisModel}
                disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel}
                className="min-w-0"
                buttonClassName="h-12 rounded-[22px] px-4 text-[13px]"
                options={[
                  { value: '', label: '自动选择默认分析模型' },
                  ...(systemConfig?.agentModels.chat || []).map((model) => ({
                    value: model.id,
                    label: model.label,
                  })),
                ]}
              />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>视频分析模型</p>
                  <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>当前生效：{systemConfig?.systemSettings.effectiveVideoAnalysisModel || 'gemini-3-flash-openai'} · High</span>
                </div>
                <PopoverSelect
                  value={videoAnalysisModel}
                  onChange={setVideoAnalysisModel}
                  disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel}
                  className="min-w-0"
                  buttonClassName="h-12 rounded-[22px] px-4 text-[13px]"
                  options={[
                    { value: '', label: '默认 Gemini 3 Flash（High）' },
                    ...(systemConfig?.agentModels.chat || []).map((model) => ({
                      value: model.id,
                      label: model.label,
                    })),
                  ]}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
              <p className="min-w-0 flex-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
                视频分析模型专用于爆款视频拆解、上传视频分析等需要读取视频素材的流程，默认使用 Gemini 3 Flash，思考强度固定 High。
              </p>
              <button
                type="button"
                onClick={() => void handleSaveAnalysisModel()}
                disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-[13px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingAnalysisModel ? '保存中...' : '保存设置'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
              <span className="text-slate-400">
                {canManageSystemSettings ? '管理员可修改，全局生效。' : '仅管理员可修改，当前仅展示。'}
              </span>
              {analysisModelMessage ? <span className="font-medium text-slate-600">{analysisModelMessage}</span> : null}
            </div>
          </div>

          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <Moon size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>偏好设置</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>自定义工作台行为</p>
              </div>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {preferenceRows.map((item) => (
                <Toggle
                  key={item.key}
                  label={item.label}
                  desc={item.desc}
                  checked={preferences[item.key]}
                  onChange={(next) => setPreferences((prev) => ({ ...prev, [item.key]: next }))}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSave} className="btn-primary" style={{ background: saved ? 'var(--success)' : undefined }}>
              {saved ? '已保存' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalApiSettings;
