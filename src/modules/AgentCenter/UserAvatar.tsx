import React from 'react';
import { findAgentAvatarPreset } from './agentAvatarOptions';

interface Props {
  name?: string;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
  className?: string;
}

const UserAvatar: React.FC<Props> = ({ name = '我', avatarUrl, avatarPreset, className = 'h-12 w-12 rounded-full text-sm font-black' }) => {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${name} 头像`}
        className={`${className} object-cover border shadow-none`}
        style={{ borderColor: 'var(--border-subtle)' }}
      />
    );
  }

  const initial = String(name || '我').trim().charAt(0).toUpperCase() || '我';
  const preset = findAgentAvatarPreset(avatarPreset);
  return (
    <div
      className={`${className} flex items-center justify-center rounded-full border shadow-none`}
      data-avatar-preset={preset.id}
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--accent)',
      }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
};

export default UserAvatar;
