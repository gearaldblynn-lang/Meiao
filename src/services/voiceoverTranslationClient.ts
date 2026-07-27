import type { InternalJob, VoiceoverTranslationPayload } from '../types';
import { buildGenerationSubmissionKey } from '../utils/generationSubmissionKey.ts';
import { clampSubtitleRegion } from '../utils/subtitleRemovalRegion.mjs';

export type VoiceoverTranslationMode = 'natural' | 'literal';
export type VoiceoverVoiceMode = 'auto' | 'preset';

export type VoiceoverTranslationSource = {
  sourceAssetId?: string;
  sourceUrl: string;
  sourceProjectId?: string;
  sourceResultId?: string;
};

export type VoiceoverTranslationDraft = VoiceoverTranslationSource & {
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
  width: number;
  height: number;
  targetLanguage: string;
  translationMode: VoiceoverTranslationMode;
  voiceMode: VoiceoverVoiceMode;
  voiceName?: string;
  removeText: boolean;
  subtitleRegionNormalized?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type VoiceoverSubmissionInput = VoiceoverTranslationSource & {
  userId: string;
  shellProjectId: string;
  shellProjectName: string;
  shellResultId: string;
  targetLanguage: string;
  translationMode: VoiceoverTranslationMode;
  voiceMode: VoiceoverVoiceMode;
  voiceName?: string;
  removeText: boolean;
  subtitleRegionNormalized?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type VoiceoverRetryOptions = {
  confirmNewProviderAttempt?: boolean;
  [key: string]: unknown;
};

type VoiceoverSubmissionResultLike = {
  id?: string;
  status?: string;
  backendJobId?: string;
  clientSubmissionKey?: string;
  errorCode?: string;
};

type VoiceoverSubmissionProjectLike = {
  id?: string;
  status?: string;
  subFeature?: string;
  backendJobId?: string;
  results?: VoiceoverSubmissionResultLike[];
};

export type VoiceoverShellIdentity = {
  shellProjectId: string;
  shellProjectName: string;
  shellResultId: string;
};

type VoiceoverClientError = Error & { code: string };

const MANAGED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const MANAGED_SCHEME_PATTERN = /^(?:managed|asset):\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,159})$/u;
const MANAGED_ROUTE_PATTERN = /^\/api\/(?:(?:assets\/file\/)|assets\/|media\/)([A-Za-z0-9][A-Za-z0-9._-]{0,159})(?:\/[^?#]*)?$/u;

const clientError = (code: string, message: string): VoiceoverClientError => (
  Object.assign(new Error(message), { code })
);

const requiredText = (value: unknown, field: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw clientError('voiceover_request_invalid', `${field}不能为空`);
  return normalized;
};

const optionalText = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized || undefined;
};

const assetIdFromSourceUrl = (sourceUrl: unknown) => {
  const raw = String(sourceUrl || '').trim();
  const schemeMatch = raw.match(MANAGED_SCHEME_PATTERN);
  if (schemeMatch) return schemeMatch[1];
  if (!raw || raw.includes('\\') || raw.startsWith('//')) return '';
  const routeAssetId = (path: string) => path.match(MANAGED_ROUTE_PATTERN)?.[1] || '';
  const pathBeforeQuery = (value: string) => value.split(/[?#]/u, 1)[0];
  if (raw.startsWith('/api/')) {
    return routeAssetId(pathBeforeQuery(raw));
  }
  if (!/^[a-z][a-z\d+.-]*:\/\//iu.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password) return '';
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (typeof window === 'undefined' || parsed.origin !== window.location.origin) return '';
    const authorityEnd = raw.indexOf('://') + 3;
    const pathStart = raw.indexOf('/', authorityEnd);
    const rawPath = pathBeforeQuery(pathStart >= 0 ? raw.slice(pathStart) : '/');
    if (rawPath !== parsed.pathname) return '';
    return routeAssetId(rawPath);
  } catch {
    return '';
  }
};

const resolveManagedSourceIdentity = (input: VoiceoverTranslationSource) => {
  const explicitAssetId = String(input.sourceAssetId || '').trim();
  const routeAssetId = assetIdFromSourceUrl(input.sourceUrl);
  if (
    (explicitAssetId && !MANAGED_ID_PATTERN.test(explicitAssetId))
    || (!explicitAssetId && !routeAssetId)
    || (explicitAssetId && input.sourceUrl && !routeAssetId)
    || (explicitAssetId && routeAssetId && explicitAssetId !== routeAssetId)
  ) {
    throw clientError('voiceover_source_invalid', '请选择当前账号拥有的梅奥托管视频');
  }
  return explicitAssetId || routeAssetId;
};

const normalizeRegion = (input: VoiceoverSubmissionInput) => {
  if (!input.removeText) return undefined;
  if (!input.subtitleRegionNormalized) {
    throw clientError('voiceover_request_invalid', '同时去文案时请选择文案区域');
  }
  return clampSubtitleRegion(input.subtitleRegionNormalized);
};

const normalizeSubmission = (input: VoiceoverSubmissionInput) => {
  const sourceAssetId = resolveManagedSourceIdentity(input);
  const userId = requiredText(input.userId, '用户');
  const targetLanguage = requiredText(input.targetLanguage, '目标语言');
  const translationMode = String(input.translationMode || '') as VoiceoverTranslationMode;
  const voiceMode = String(input.voiceMode || '') as VoiceoverVoiceMode;
  if (!['natural', 'literal'].includes(translationMode)) {
    throw clientError('voiceover_request_invalid', '翻译模式无效');
  }
  if (!['auto', 'preset'].includes(voiceMode)) {
    throw clientError('voiceover_request_invalid', '音色模式无效');
  }
  const voiceName = optionalText(input.voiceName);
  if (voiceMode === 'preset' && !voiceName) {
    throw clientError('voiceover_request_invalid', '请选择预设音色');
  }
  if (voiceMode === 'auto' && voiceName) {
    throw clientError('voiceover_request_invalid', '自动音色模式不能指定预设音色');
  }
  return {
    sourceAssetId,
    userId,
    targetLanguage,
    translationMode,
    voiceMode,
    voiceName,
    removeText: input.removeText === true,
    subtitleRegionNormalized: normalizeRegion(input),
  };
};

export const buildVoiceoverSubmissionKey = (input: VoiceoverSubmissionInput) => {
  const normalized = normalizeSubmission(input);
  return buildGenerationSubmissionKey({
    module: 'video',
    subFeature: 'voiceover_translation',
    params: {
      userId: normalized.userId,
      sourceIdentity: normalized.sourceAssetId,
      targetLanguage: normalized.targetLanguage,
      translationMode: normalized.translationMode,
      voiceMode: normalized.voiceMode,
      voiceName: normalized.voiceName || '',
      removeText: normalized.removeText,
      subtitleRegionNormalized: normalized.subtitleRegionNormalized || null,
    },
  });
};

export const buildVoiceoverJobRequest = (input: VoiceoverSubmissionInput) => {
  const normalized = normalizeSubmission(input);
  const clientSubmissionKey = buildVoiceoverSubmissionKey(input);
  const payload: VoiceoverTranslationPayload
    & Record<string, unknown>
    & { subFeature: 'voiceover_translation' } = {
    taskType: 'voiceover_translate_video',
    taskPurpose: 'voiceover_translation',
    subFeature: 'voiceover_translation',
    userId: normalized.userId,
    sourceAssetId: normalized.sourceAssetId,
    ...(optionalText(input.sourceProjectId) ? { sourceProjectId: optionalText(input.sourceProjectId) } : {}),
    ...(optionalText(input.sourceResultId) ? { sourceResultId: optionalText(input.sourceResultId) } : {}),
    shellProjectId: requiredText(input.shellProjectId, '项目'),
    shellProjectName: requiredText(input.shellProjectName, '项目名称'),
    shellResultId: requiredText(input.shellResultId, '结果'),
    clientSubmissionKey,
    targetLanguage: normalized.targetLanguage,
    translationMode: normalized.translationMode,
    voiceMode: normalized.voiceMode,
    ...(normalized.voiceName ? { voiceName: normalized.voiceName } : {}),
    removeText: normalized.removeText,
    ...(normalized.subtitleRegionNormalized
      ? { subtitleRegionNormalized: normalized.subtitleRegionNormalized }
      : {}),
  };
  return {
    module: 'video',
    subFeature: 'voiceover_translation',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    maxRetries: 0,
    payload,
  } as const;
};

export const buildVoiceoverRetryRequest = (
  job: Pick<InternalJob, 'taskType' | 'provider'>,
  options: VoiceoverRetryOptions = {},
) => {
  if (job?.taskType !== 'voiceover_translate_video' || job?.provider !== 'internal') {
    throw clientError('voiceover_retry_invalid', '当前任务不是口播翻译父任务');
  }
  return {
    confirmNewProviderAttempt: options.confirmNewProviderAttempt === true,
  };
};

export const findActiveVoiceoverSubmissionIdentity = (
  projects: VoiceoverSubmissionProjectLike[],
  clientSubmissionKey: string,
) => {
  const normalizedKey = String(clientSubmissionKey || '').trim();
  if (!normalizedKey) return null;
  for (const project of projects || []) {
    if (project?.subFeature !== 'voiceover_translation') continue;
    const result = (project.results || []).find((item) => (
      String(item?.clientSubmissionKey || '').trim() === normalizedKey
    ));
    if (!result) continue;
    const creationUncertain = ['voiceover_job_create_ready', 'job_creation_unknown']
      .includes(String(result.errorCode || ''));
    const active = project.status === 'generating'
      || ['generating', 'retry_waiting'].includes(String(result.status || ''))
      || creationUncertain;
    if (!active) continue;
    const shellProjectId = String(project.id || '').trim();
    const shellResultId = String(result.id || '').trim();
    if (!shellProjectId || !shellResultId) continue;
    return {
      shellProjectId,
      shellResultId,
      backendJobId: optionalText(result.backendJobId) || optionalText(project.backendJobId),
      creationUncertain,
    };
  }
  return null;
};

export const resolveVoiceoverCreatedJobIdentity = (
  job: Pick<InternalJob, 'taskType' | 'provider' | 'payload'>,
  fallback: VoiceoverShellIdentity,
) => {
  if (job?.taskType !== 'voiceover_translate_video' || job?.provider !== 'internal') {
    return fallback;
  }
  const payload = job.payload as Partial<VoiceoverTranslationPayload>;
  const shellProjectId = optionalText(payload?.shellProjectId);
  const shellProjectName = optionalText(payload?.shellProjectName);
  const shellResultId = optionalText(payload?.shellResultId);
  if (!shellProjectId || !shellProjectName || !shellResultId) return fallback;
  return { shellProjectId, shellProjectName, shellResultId };
};
