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
        className={`${className} shrink-0 object-cover border shadow-none`}
        style={{ borderColor: 'var(--border-subtle)' }}
      />
    );
  }

  const preset = findAgentAvatarPreset(avatarPreset);
  const initial = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
  return (
    <div
      className={`${className} shrink-0 flex items-center justify-center border font-black shadow-none`}
      data-avatar-preset={preset.id}
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--accent)',
      }}
    >
      {initial}
    </div>
  );
};

export default AgentAvatar;
