import React, { useEffect, useState } from 'react';
import { AuthUser, GlobalApiConfig, SystemPublicConfig } from '../../types';
import { fetchSystemConfig } from '../../services/internalApi';
import { getEffectiveConcurrency } from '../Account/accountManagementUtils.mjs';
import { InfoPill, WorkspaceShellCard } from '../../components/ui/workspacePrimitives';

interface Props {
  apiConfig: GlobalApiConfig;
  onApiConfigChange: (config: GlobalApiConfig) => void;
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  isActive?: boolean;
}

const ProviderCard: React.FC<{ title: string; configured: boolean; description: string }> = ({ title, configured, description }) => (
  <section className="space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-100">
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-lg font-black text-slate-800">{title}</h3>
        <p className="text-xs text-slate-400 mt-1">{description}</p>
      </div>
      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${configured ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
        {configured ? '已配置' : '未配置'}
      </span>
    </div>
    <p className="text-sm leading-7 text-slate-600">
      密钥已全部收回服务端环境变量，前端不再保存或展示真实值。
    </p>
  </section>
);

const GlobalApiSettings: React.FC<Props> = ({ apiConfig, onApiConfigChange, currentUser = null, internalMode = false, isActive = false }) => {
  const [systemConfig, setSystemConfig] = useState<SystemPublicConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onApiConfigChange({ ...apiConfig, kieApiKey: '', arkApiKey: '' });
  }, []);

  useEffect(() => {
    if (!internalMode || !isActive) return;
    let disposed = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await fetchSystemConfig();
        if (!disposed) {
          setSystemConfig(result.config);
          const effectiveConcurrency = getEffectiveConcurrency(
            result.config.queue.maxConcurrency,
            currentUser?.jobConcurrency
          );
          onApiConfigChange({
            ...apiConfig,
            kieApiKey: '',
            arkApiKey: '',
            concurrency: effectiveConcurrency,
          });
        }
      } catch (loadError: any) {
        if (!disposed) {
          setError(loadError.message || '系统配置读取失败');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [internalMode, isActive, currentUser?.id, currentUser?.jobConcurrency]);

  return (
    <div className="h-full overflow-y-auto px-6 pb-6 pt-5">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 rounded-[32px] border border-slate-200/80 bg-white/90 px-8 py-8 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Infrastructure & Queue Status</p>
          <h2 className="mt-3 text-3xl font-black text-slate-900">梅奥 AI · 系统配置</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">这里只显示系统状态、环境是否齐全和当前队列信息，不再展示任何真实密钥。管理员看得到运行情况，员工只看到与自己使用相关的公开信息。</p>
        </header>

        {internalMode ? (
          <>
            <WorkspaceShellCard className="mb-8 bg-slate-50/90 px-6 py-5">
              <p className="text-sm font-black text-slate-900">当前模式</p>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                已切换为内部服务端托管模式。第三方 API Key 与模型调用全部由服务器接管，当前登录身份为 {currentUser?.role === 'admin' ? '管理员' : '员工'}。
              </p>
            </WorkspaceShellCard>

            {error ? (
              <div className="mb-8 rounded-3xl border border-rose-200 bg-rose-50 px-6 py-5 text-sm font-bold text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ProviderCard title="Kie 引擎" configured={Boolean(systemConfig?.providers.kie.configured)} description="图片生成、视频生成、分镜脚本对话" />
              <ProviderCard title="Ark 分析" configured={Boolean(systemConfig?.providers.ark.configured)} description="策划、分析、脚本生成" />
            </div>

            <div className="mt-8 grid md:grid-cols-3 gap-4">
              <InfoPill label="可用并发" value={loading ? '...' : String(getEffectiveConcurrency(systemConfig?.queue.maxConcurrency, currentUser?.jobConcurrency))} />
              <InfoPill label="待执行任务" value={loading ? '...' : String(systemConfig?.queue.queuedCount ?? '-')} />
              <InfoPill label="执行中任务" value={loading ? '...' : String(systemConfig?.queue.runningCount ?? '-')} />
            </div>

            <p className="mt-4 text-xs font-bold text-slate-400">
              当前只保留一个并发值，按账号并发上限直接展示和执行。
            </p>
          </>
        ) : (
          <WorkspaceShellCard className="bg-amber-50 px-6 py-5 border-amber-200">
            <p className="text-sm font-black text-amber-900">本地模式说明</p>
            <p className="mt-2 text-sm leading-7 text-amber-800">
              本地模式仅用于单机调试。完整的服务端任务队列、密钥托管和多人能力需要 MySQL 内部版环境。
            </p>
          </WorkspaceShellCard>
        )}
      </div>
    </div>
  );
};

export default GlobalApiSettings;
