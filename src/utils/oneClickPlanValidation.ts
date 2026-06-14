import { getPlanContent, isLegacyFailureText, isPlanFailed } from './planFailure.mjs';

type OneClickPlanLike = {
  title?: unknown;
  schemeContent?: unknown;
  textLayout?: unknown;
  sceneDescription?: unknown;
  styleDirection?: unknown;
  colorPalette?: unknown;
  composition?: unknown;
  originalContent?: unknown;
  editedContent?: unknown;
  prompt?: unknown;
  error?: unknown;
  planningFailed?: unknown;
  status?: unknown;
  errorCode?: unknown;
};

export const getOneClickPlanContent = (plan: OneClickPlanLike = {}) => getPlanContent(plan);

export const isInvalidOneClickPlanText = (value: unknown) => isLegacyFailureText(value);

export const isInvalidOneClickPlanLike = (plan: OneClickPlanLike = {}) => isPlanFailed(plan);
