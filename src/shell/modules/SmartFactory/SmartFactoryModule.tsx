import React, { useState } from 'react';
import SmartFactoryPanel from '../../../modules/AgentCenter/SmartFactoryPanel';

const SmartFactoryModule: React.FC = () => {
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <h1 className="text-[28px] font-semibold tracking-[0]" style={{ color: 'var(--text-primary)' }}>智能工厂</h1>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            统一管理模型、知识库和工具调用，用来搭建可试运行的智能体能力。
          </p>
        </div>
        {loading && (
          <div className="rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            运行中
          </div>
        )}
      </div>

      {(statusMessage || errorMessage) && (
        <div
          className="mb-3 flex min-h-9 items-center rounded-[8px] border px-3 py-2 text-[12px]"
          style={{
            borderColor: errorMessage ? 'rgba(239,68,68,0.24)' : 'var(--border-subtle)',
            background: errorMessage ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)',
            color: errorMessage ? '#dc2626' : 'var(--text-secondary)',
          }}
        >
          {errorMessage || statusMessage}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <SmartFactoryPanel
          onStatusMessage={setStatusMessage}
          onErrorMessage={setErrorMessage}
          onLoadingChange={setLoading}
        />
      </div>
    </div>
  );
};

export default SmartFactoryModule;
