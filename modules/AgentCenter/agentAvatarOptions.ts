export interface AgentAvatarPreset {
  id: string;
  label: string;
  gradientClassName: string;
}

export const AGENT_AVATAR_PRESETS: AgentAvatarPreset[] = [
  { id: 'aurora', label: '极光', gradientClassName: 'from-cyan-400 via-sky-500 to-indigo-600' },
  { id: 'ember', label: '余烬', gradientClassName: 'from-amber-400 via-orange-500 to-rose-500' },
  { id: 'mint', label: '薄荷', gradientClassName: 'from-emerald-300 via-teal-400 to-cyan-500' },
  { id: 'slate', label: '石墨', gradientClassName: 'from-slate-500 via-slate-700 to-slate-900' },
  { id: 'peach', label: '蜜桃', gradientClassName: 'from-pink-300 via-rose-400 to-orange-400' },
  { id: 'violet', label: '深海', gradientClassName: 'from-indigo-400 via-violet-500 to-fuchsia-500' },
];

export const findAgentAvatarPreset = (presetId?: string | null) =>
  AGENT_AVATAR_PRESETS.find((item) => item.id === presetId) || AGENT_AVATAR_PRESETS[0];
