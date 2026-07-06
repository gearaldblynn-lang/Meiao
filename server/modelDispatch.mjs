// 模型单一调度入口(Task I2)。
// 目标:板块只声明需求(need + capabilities),模型选择逻辑收敛到这一处;
// 解析顺序是硬规则:preferred(用户显式配置) > env 兼容层 > 注册表能力匹配 > fallback(空)。
// 纯函数:registry 与 env 全部依赖注入,便于测试与排障(source 字段说明命中哪一级)。
import { normalizeCapabilityTag, normalizeModelMode } from './modelProviderRegistry.mjs';

// need → 既有 env 的兼容映射(第一批只覆盖散落在 server/ 的四个历史 env)。
// analysis 按 analysisKind 分流:planning→MEIAO_PLANNING_ANALYSIS_MODEL,agent→MEIAO_AGENT_ANALYSIS_MODEL;
// 不带 kind 时按 index.mjs 既有优先序 agent 先于 planning。
const resolveEnvKeysForNeed = (need = '', analysisKind = '') => {
  if (need === 'analysis') {
    if (analysisKind === 'planning') return ['MEIAO_PLANNING_ANALYSIS_MODEL'];
    if (analysisKind === 'agent') return ['MEIAO_AGENT_ANALYSIS_MODEL'];
    return ['MEIAO_AGENT_ANALYSIS_MODEL', 'MEIAO_PLANNING_ANALYSIS_MODEL'];
  }
  if (need === 'chat') return ['MEIAO_DEFAULT_CHAT_MODEL'];
  if (need === 'kie-chat') return ['KIE_CHAT_MODEL'];
  return [];
};

// need → 注册表 mode。分析/对话类都落在 chat 档案上;媒体类 need 直接对应 mode。
const NEED_MODE_MAP = {
  analysis: 'chat',
  chat: 'chat',
  'kie-chat': 'chat',
  embedding: 'embedding',
  rerank: 'rerank',
  image: 'image',
  video: 'video',
};

const trimmed = (value) => String(value ?? '').trim();

export const resolveModelForNeed = ({
  need = '',
  capabilities = [],
  preferredModel = '',
  registry = null,
  env = process.env,
  analysisKind = '',
} = {}) => {
  // ① 用户显式配置永远最高。
  const preferred = trimmed(preferredModel);
  if (preferred) return { model: preferred, source: 'preferred' };

  // ② env 兼容层:有值即用(仅空白视为未配置)。
  for (const envKey of resolveEnvKeysForNeed(trimmed(need), trimmed(analysisKind))) {
    const envValue = trimmed(env?.[envKey]);
    if (envValue) return { model: envValue, source: 'env' };
  }

  // ③ 注册表:按 mode + capabilities 全匹配选第一个。
  const mode = NEED_MODE_MAP[trimmed(need)] || 'chat';
  const requiredTags = (Array.isArray(capabilities) ? capabilities : [])
    .map((tag) => normalizeCapabilityTag(tag))
    .filter(Boolean);
  const providers = Array.isArray(registry?.providers) ? registry.providers : [];
  for (const provider of providers) {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    for (const model of models) {
      const modelId = trimmed(model?.id);
      if (!modelId || normalizeModelMode(model?.mode) !== mode) continue;
      const features = new Set(
        (Array.isArray(model?.features) ? model.features : [])
          .map((tag) => normalizeCapabilityTag(tag))
          .filter(Boolean),
      );
      if (requiredTags.every((tag) => features.has(tag))) {
        return { model: modelId, source: 'registry' };
      }
    }
  }

  // ④ 无匹配:不臆造模型名,让调用方保持它现有的默认值逻辑。
  return { model: '', source: 'fallback' };
};
