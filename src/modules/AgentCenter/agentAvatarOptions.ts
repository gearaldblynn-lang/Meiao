export interface AgentAvatarPreset {
  id: string;
  label: string;
  mark: string;
  gradient: string;
  foreground: string;
  borderColor: string;
}

export const AGENT_AVATAR_PRESETS: AgentAvatarPreset[] = [
  { id: 'aurora', label: '极光', mark: '光', gradient: 'linear-gradient(135deg,#22d3ee 0%,#0ea5e9 52%,#4f46e5 100%)', foreground: '#ffffff', borderColor: 'rgba(14,165,233,0.32)' },
  { id: 'ember', label: '余烬', mark: '焰', gradient: 'linear-gradient(135deg,#fbbf24 0%,#f97316 48%,#e11d48 100%)', foreground: '#ffffff', borderColor: 'rgba(249,115,22,0.32)' },
  { id: 'mint', label: '薄荷', mark: '薄', gradient: 'linear-gradient(135deg,#6ee7b7 0%,#14b8a6 50%,#06b6d4 100%)', foreground: '#063f46', borderColor: 'rgba(20,184,166,0.28)' },
  { id: 'slate', label: '石墨', mark: '墨', gradient: 'linear-gradient(135deg,#64748b 0%,#334155 52%,#0f172a 100%)', foreground: '#ffffff', borderColor: 'rgba(71,85,105,0.38)' },
  { id: 'peach', label: '蜜桃', mark: '桃', gradient: 'linear-gradient(135deg,#f9a8d4 0%,#fb7185 48%,#fb923c 100%)', foreground: '#ffffff', borderColor: 'rgba(251,113,133,0.3)' },
  { id: 'violet', label: '深海', mark: '海', gradient: 'linear-gradient(135deg,#818cf8 0%,#8b5cf6 52%,#d946ef 100%)', foreground: '#ffffff', borderColor: 'rgba(139,92,246,0.34)' },
];

export const findAgentAvatarPreset = (presetId?: string | null) =>
  AGENT_AVATAR_PRESETS.find((item) => item.id === presetId) || AGENT_AVATAR_PRESETS[0];
