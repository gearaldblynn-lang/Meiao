import React, { useMemo, useState } from 'react';
import { AuthUser } from '../../types';
import { updateCurrentUserProfile, uploadInternalAssetStream } from '../../services/internalApi';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import AgentAvatar from '../AgentCenter/AgentAvatar';
import { AGENT_AVATAR_PRESETS } from '../AgentCenter/agentAvatarOptions';

interface Props {
  currentUser: AuthUser;
  onUserChange?: (user: AuthUser) => void;
  compactOnly?: boolean;
}

const ProfileSettingsCard: React.FC<Props> = ({ currentUser, onUserChange, compactOnly = false }) => {
  const [displayName, setDisplayName] = useState(currentUser.displayName || currentUser.username);
  const [avatarPreset, setAvatarPreset] = useState(currentUser.avatarPreset || 'aurora');
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const previewName = useMemo(() => displayName || currentUser.displayName || currentUser.username, [currentUser.displayName, currentUser.username, displayName]);

  if (compactOnly) {
    return (
      <AgentAvatar
        name={previewName}
        iconUrl={avatarUrl}
        avatarPreset={avatarPreset}
        className="h-10 w-10 rounded-[14px] text-sm shadow-[0_10px_20px_rgba(148,163,184,0.12)]"
      />
    );
  }

  const saveProfile = async (next: { displayName?: string; avatarUrl?: string | null; avatarPreset?: string | null }) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await updateCurrentUserProfile({
        displayName: next.displayName ?? displayName,
        avatarUrl: next.avatarUrl ?? (avatarUrl || null),
        avatarPreset: next.avatarPreset ?? (avatarPreset || null),
      });
      setDisplayName(result.user.displayName || result.user.username);
      setAvatarPreset(result.user.avatarPreset || 'aurora');
      setAvatarUrl(result.user.avatarUrl || '');
      onUserChange?.(result.user);
      setMessage('个人资料已保存。');
    } catch (requestError: any) {
      setError(requestError.message || '保存个人资料失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const uploaded = await uploadInternalAssetStream({
        module: 'account_profile',
        file,
        fileName: file.name,
      });
      setAvatarUrl(uploaded.fileUrl);
      const result = await updateCurrentUserProfile({
        displayName,
        avatarUrl: uploaded.fileUrl,
        avatarPreset,
      });
      onUserChange?.(result.user);
      setMessage('头像已更新。');
    } catch (requestError: any) {
      setError(requestError.message || '上传头像失败');
    } finally {
      setSaving(false);
      event.target.value = '';
    }
  };

  return (
    <WorkspaceShellCard className="border border-white/70 bg-white/78 px-6 py-6 shadow-[0_24px_60px_rgba(148,163,184,0.12)] backdrop-blur-2xl">
      <div className="flex flex-wrap items-start gap-5">
        <div className="space-y-3">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">个人头像</p>
          <AgentAvatar name={previewName} iconUrl={avatarUrl} avatarPreset={avatarPreset} className="h-20 w-20 rounded-[28px] text-2xl shadow-[0_16px_34px_rgba(148,163,184,0.18)]" />
        </div>

        <div className="min-w-[260px] flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black tracking-[-0.03em] text-slate-900">个人资料</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">聊天区右侧用户消息会使用这里的头像。默认头像与智能体图标方案一致。</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">显示名称</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="显示名称"
                className="w-full rounded-[20px] border border-white/80 bg-white/85 px-4 py-3 text-sm font-medium text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
              />
            </label>

            <div className="md:col-span-2">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">默认头像</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {AGENT_AVATAR_PRESETS.map((item) => {
                  const active = avatarPreset === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setAvatarPreset(item.id);
                        void saveProfile({ avatarPreset: item.id });
                      }}
                      className={`rounded-2xl border px-3 py-3 transition ${active ? 'border-cyan-300 bg-cyan-50' : 'border-white/80 bg-white/75'}`}
                    >
                      <div className={`h-10 w-10 rounded-2xl bg-gradient-to-br ${item.gradientClassName}`} />
                      <p className="mt-2 text-xs font-black text-slate-700">{item.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm font-black text-slate-700 shadow-[0_12px_30px_rgba(148,163,184,0.12)]">
                上传头像
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </label>
              {avatarUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setAvatarUrl('');
                    void saveProfile({ avatarUrl: null });
                  }}
                  className="text-sm font-black text-rose-600"
                >
                  移除已上传头像
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void saveProfile({ displayName })}
                disabled={saving}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存资料'}
              </button>
            </div>
          </div>

          {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{error}</div> : null}
          {message ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}
        </div>
      </div>
    </WorkspaceShellCard>
  );
};

export default ProfileSettingsCard;
