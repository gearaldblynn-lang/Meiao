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
        className={`${className} object-cover shadow-[0_10px_25px_rgba(15,23,42,0.35)]`}
      />
    );
  }

  const initial = String(name || '我').trim().charAt(0).toUpperCase() || '我';
  const preset = findAgentAvatarPreset(avatarPreset);
  return (
    <div
      className={`${className} flex items-center justify-center rounded-full bg-gradient-to-br ${preset.gradientClassName} text-white shadow-[0_10px_25px_rgba(15,23,42,0.35)]`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
};

export default UserAvatar;
