
import React from 'react';
import { AuthUser, GlobalApiConfig } from '../../types';

interface Props {
  apiConfig: GlobalApiConfig;
  onApiConfigChange: (config: GlobalApiConfig) => void;
  currentUser?: AuthUser | null;
  internalMode?: boolean;
}

const GlobalApiSettings: React.FC<Props> = ({ apiConfig, onApiConfigChange, currentUser = null, internalMode = false }) => {
  const canEditApiConfig = !internalMode || currentUser?.role === 'admin';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    const finalValue = type === 'number' ? parseInt(value, 10) : value;
    onApiConfigChange({ ...apiConfig, [name]: finalValue });
  };

  return (
    <div className="h-full bg-white p-12 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12">
          <h2 className="text-3xl font-black text-slate-900 mb-2">梅奥AI · 核心基础设施</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Infrastructure Management Console</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Volcengine Ark / Doubao Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-rose-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
                <i className="fas fa-brain text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">火山引擎 (豆包)</h3>
                <p className="text-xs text-slate-400">负责商品视觉语义分析</p>
              </div>
            </div>
            
            <div className="space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Ark API Key (Bearer)</label>
                <input
                  type="password"
                  name="arkApiKey"
                  value={apiConfig.arkApiKey}
                  onChange={handleChange}
                  disabled={!canEditApiConfig}
                  className="w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-rose-500 outline-none shadow-sm font-mono"
                  placeholder="ad4fa376-..."
                />
              </div>
              <div className="p-3 bg-rose-50 rounded-xl">
                 <p className="text-[10px] text-rose-600 font-bold">
                    <i className="fas fa-shield-alt mr-1"></i>
                    基于 Doubao-Seed-2.0-lite 提供精准内容理解。
                 </p>
              </div>
            </div>
          </section>

          {/* Kie.ai Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
                <i className="fas fa-bolt text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">Kie.ai 引擎中心</h3>
                <p className="text-xs text-slate-400">渲染生成 & 免费云存储</p>
              </div>
            </div>
            
            <div className="space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Kie.ai API Key</label>
                <input
                  type="password"
                  name="kieApiKey"
                  value={apiConfig.kieApiKey}
                  onChange={handleChange}
                  disabled={!canEditApiConfig}
                  className="w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm font-mono"
                  placeholder="26526246..."
                />
              </div>
              <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-1">并发执行数</label>
                  <input
                    type="number"
                    name="concurrency"
                  min="1"
                  max="50"
                  value={apiConfig.concurrency}
                  onChange={handleChange}
                  disabled={!canEditApiConfig}
                  className="w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                />
              </div>
              <div className="p-3 bg-indigo-50 rounded-xl">
                 <p className="text-[10px] text-indigo-600 font-bold">
                    <i className="fas fa-cloud-upload-alt mr-1"></i>
                    已启用 Kie 免费图床 (文件有效期3天)。
                 </p>
              </div>
            </div>
          </section>
        </div>

        {internalMode ? (
          <div className="mt-10 rounded-3xl border border-amber-200 bg-amber-50 px-6 py-5">
            <p className="text-sm font-black text-amber-900">内部版说明</p>
            <p className="mt-2 text-sm leading-7 text-amber-800">
              这一版已经加上登录和账号管理，但外部模型调用还没有完全收回到服务器端。
              所以它已经适合公司内部起步联调，不适合直接公开给外部人员使用。
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default GlobalApiSettings;
