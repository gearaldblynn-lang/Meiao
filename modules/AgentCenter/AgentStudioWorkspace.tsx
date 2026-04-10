import React, { useCallback, useState } from 'react';
import { AgentSummary, AgentVersion, StudioChannel, SystemPublicConfig } from '../../types';
import AgentAvatar from './AgentAvatar';
import AgentStudioTrainingPane from './AgentStudioTrainingPane';
import AgentStudioTestingPane from './AgentStudioTestingPane';

interface Props {
  agent: AgentSummary;
  draftVersion: AgentVersion;
  availableChatModels: SystemPublicConfig['agentModels']['chat'];
  onBack: () => void;
  onVersionUpdated: (version: AgentVersion) => void;
  onStatusMessage: (msg: string) => void;
  onErrorMessage: (msg: string) => void;
}

const glassPanel = 'rounded-[30px] border border-white/70 bg-white/72 shadow-[0_25px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl';
const pillBase = 'px-4 py-2 text-[12px] font-black rounded-[20px] transition cursor-pointer';
const pillActive = 'bg-[#0f172a] text-white';
const pillInactive = 'text-slate-400 hover:text-slate-600';
const AGENT_STUDIO_CHANNEL_KEY = 'MEIAO_AGENT_STUDIO_CHANNEL';

const AgentStudioWorkspace: React.FC<Props> = ({
  agent, draftVersion, availableChatModels, onBack, onVersionUpdated, onStatusMessage, onErrorMessage,
}) => {
  const channelStorageKey = `${AGENT_STUDIO_CHANNEL_KEY}:${agent.id}:${draftVersion.id}`;
  const [channel, setChannel] = useState<StudioChannel>(() => {
    try {
      return sessionStorage.getItem(channelStorageKey) === 'testing' ? 'testing' : 'training';
    } catch {
      return 'training';
    }
  });
  const [correctionContext, setCorrectionContext] = useState('');
  const [currentVersion, setCurrentVersion] = useState<AgentVersion>(draftVersion);

  const handleVersionUpdated = useCallback((v: AgentVersion) => {
    setCurrentVersion(v);
    onVersionUpdated(v);
  }, [onVersionUpdated]);

  const handleCorrection = useCallback((question: string, answer: string) => {
    const ctx = `测试中发现问题：用户问"${question.slice(0, 80)}"，智能体回答不符合预期："${answer.slice(0, 120)}"。请帮我调整，应该`;
    setCorrectionContext(ctx);
    setChannel('training');
  }, []);

  const handleCorrectionConsumed = useCallback(() => setCorrectionContext(''), []);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(channelStorageKey, channel);
    } catch {
      // ignore storage errors
    }
  }, [channel, channelStorageKey]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <div className={`${glassPanel} px-4 py-3`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onBack}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200/85 bg-white/90 px-3 text-[11px] font-black text-slate-700">
              <i className="fas fa-arrow-left text-xs" /> 返回
            </button>
            <AgentAvatar name={agent.name} iconUrl={agent.iconUrl || undefined}
              avatarPreset={agent.avatarPreset || undefined}
              className="h-10 w-10 rounded-[15px] text-sm shadow-[0_8px_18px_rgba(56,189,248,0.14)]" />
            <div className="min-w-0">
              <p className="text-[14px] font-black tracking-[-0.02em] text-slate-950">{agent.name}</p>
              <p className="text-[11px] font-medium text-slate-500">
                工作室 · 草稿 v{currentVersion.versionNo}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-[22px] border border-slate-200/85 bg-white/90 p-1">
              <button type="button" onClick={() => setChannel('training')}
                className={`${pillBase} ${channel === 'training' ? pillActive : pillInactive}`}>
                训练
              </button>
              <button type="button" onClick={() => setChannel('testing')}
                className={`${pillBase} ${channel === 'testing' ? pillActive : pillInactive}`}>
                测试
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Channel Pane */}
      <div className="min-h-0 flex-1">
        {channel === 'training' ? (
          <AgentStudioTrainingPane
            agent={agent} draftVersion={currentVersion}
            availableChatModels={availableChatModels}
            correctionContext={correctionContext}
            onCorrectionConsumed={handleCorrectionConsumed}
            onVersionUpdated={handleVersionUpdated}
            onStatusMessage={onStatusMessage} onErrorMessage={onErrorMessage} />
        ) : (
          <AgentStudioTestingPane
            agent={agent} draftVersion={currentVersion}
            availableChatModels={availableChatModels}
            onCorrection={handleCorrection}
            onStatusMessage={onStatusMessage} onErrorMessage={onErrorMessage} />
        )}
      </div>
    </div>
  );
};

export default AgentStudioWorkspace;
