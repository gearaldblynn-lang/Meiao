import { getModelCapability } from './modelCapabilities.mjs';

const HISTORY_BUDGET_RATIO = Number(process.env.CTX_HISTORY_BUDGET_RATIO || 0.5);
const SUMMARY_TRIGGER_RATIO = Number(process.env.CTX_SUMMARY_TRIGGER_RATIO || 0.6);
const AVG_TOKENS_PER_ROUND = Number(process.env.CTX_AVG_TOKENS_PER_ROUND || 800);
const MAX_SUMMARY_CHARS_CAP = Number(process.env.CTX_MAX_SUMMARY_CHARS || 1200);

const toPosInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

export const resolveContextLimits = ({ modelId, contextPolicy = {} } = {}) => {
  const cap = getModelCapability(modelId);
  const policy = contextPolicy || {};

  const usableForHistory = Math.floor(cap.contextWindowTokens * HISTORY_BUDGET_RATIO);
  const adaptiveRounds = Math.max(6, Math.floor(usableForHistory / AVG_TOKENS_PER_ROUND));
  const adaptiveThreshold = Math.max(10, Math.floor(adaptiveRounds * SUMMARY_TRIGGER_RATIO));

  return {
    maxHistoryRounds: toPosInt(policy.maxHistoryRounds) ?? adaptiveRounds,
    summaryTriggerThreshold: toPosInt(policy.summaryTriggerThreshold) ?? adaptiveThreshold,
    maxSummaryChars: toPosInt(policy.maxSummaryChars) ?? MAX_SUMMARY_CHARS_CAP,
    maxOutputTokens: toPosInt(policy.maxOutputTokens) ?? cap.maxOutputTokens,
    modelCapability: cap,
  };
};
