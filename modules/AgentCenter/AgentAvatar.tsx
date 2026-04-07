import React from 'react';
import { findAgentAvatarPreset } from './agentAvatarOptions';

interface Props {
  name: string;
  iconUrl?: string | null;
  avatarPreset?: string | null;
  className?: string;
}

const AgentAvatar: React.FC<Props> = ({ name, iconUrl, avatarPreset, className = 'h-12 w-12 rounded-2xl text-sm' }) => {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={`${name} 图标`}
        className={`${className} shrink-0 object-cover shadow-sm`}
      />
    );
  }

  const preset = findAgentAvatarPreset(avatarPreset);
  return (
    <div className={`${className} shrink-0 flex items-center justify-center bg-gradient-to-br ${preset.gradientClassName} font-black text-white shadow-sm`}>
      {String(name || '?').slice(0, 1).toUpperCase()}
    </div>
  );
};

export default AgentAvatar;
