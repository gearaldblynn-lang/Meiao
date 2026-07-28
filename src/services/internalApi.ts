import type {
  AgentChatMessage,
  AgentChatSession,
  AgentKnowledgeDocumentBinding,
  AgentSummary,
  AgentUsageRow,
  AgentVersion,
  AuthUser,
  InternalJob,
  InternalJobPayload,
  InternalLogEntry,
  KnowledgeBaseSummary,
  KnowledgeDocumentSummary,
  StudioConfigDiff,
  SystemPublicConfig,
  SystemAnnouncement,
  TaskPlatformAttempt,
  TaskPlatformEvent,
  TaskPlatformHealth,
  TaskPlatformJob,
  VideoDiagnosisAccessMode,
  VideoDiagnosisAnalysisItem,
  VideoDiagnosisPlatform,
  VideoDiagnosisProbeResult,
  VideoDiagnosisReportResult,
} from '../types';
import type { PersistedAppState } from '../utils/appState';
import { ensureUploadFileName } from '../utils/uploadFileName.mjs';
import { parseChatSseChunk, type ChatStreamEvent } from './chatStreamParse.ts';
import {
  FACTORY_MANAGED_AGENT_ERROR_CODE,
  FACTORY_MANAGED_AGENT_NOTICE,
} from '../modules/AgentCenter/factoryManagedConstants.ts';

const SESSION_TOKEN_KEY = 'MEIAO_INTERNAL_SESSION_TOKEN';
const CURRENT_USER_KEY = 'MEIAO_INTERNAL_CURRENT_USER';
const ACTIVE_MODULE_KEY = 'MEIAO_ACTIVE_MODULE';

const getSessionToken = () => {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const captureInternalSessionToken = () => getSessionToken();

export const hasStoredSessionToken = () => Boolean(getSessionToken());

export const storeSessionToken = (token: string) => {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
};

export const clearSessionToken = () => {
  localStorage.removeItem(SESSION_TOKEN_KEY);
};

type StoredCurrentUserContext = Pick<AuthUser,
  | 'id'
  | 'username'
  | 'role'
  | 'avatarUrl'
  | 'avatarPreset'
  | 'featurePermissions'
  | 'analysisModel'
  | 'creditLimitMode'
  | 'creditBalance'
  | 'creditReserved'
  | 'creditConsumed'
  | 'creditAvailable'
>;

export const storeCurrentUserContext = (user: StoredCurrentUserContext) => {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
};

export const getCurrentUserContext = (): StoredCurrentUserContext | null => {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.username) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const clearCurrentUserContext = () => {
  localStorage.removeItem(CURRENT_USER_KEY);
};

export const storeActiveModuleContext = (moduleId: string) => {
  sessionStorage.setItem(ACTIVE_MODULE_KEY, moduleId);
};

export const getActiveModuleContext = () => {
  try {
    return sessionStorage.getItem(ACTIVE_MODULE_KEY) || '';
  } catch {
    return '';
  }
};

// --------------- 错误分类 ---------------
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const classifyError = (status: number, serverMessage: string, serverErrorCode?: string): ApiError => {
  if (status === 0)
    return new ApiError('网络连接失败，请检查网络后重试', 'network_error', 0);
  if (status === 408 || serverMessage.includes('timeout'))
    return new ApiError('请求超时，请稍后重试', 'timeout', status);
  if (status === 429)
    return new ApiError('请求过于频繁，请稍后再试', 'rate_limited', status);
  if (status === 401)
    return new ApiError('登录已过期，请重新登录', 'unauthorized', status);
  if (status === 403) {
    // factory_managed_agent: 后端返回人话 message，直接透传给用户
    if (serverErrorCode === FACTORY_MANAGED_AGENT_ERROR_CODE)
      return new ApiError(serverMessage || FACTORY_MANAGED_AGENT_NOTICE, FACTORY_MANAGED_AGENT_ERROR_CODE, status);
    return new ApiError('没有权限执行此操作', 'forbidden', status);
  }
  if (status >= 500 && /^managed_image_/.test(serverErrorCode || ''))
    return new ApiError(serverMessage || '图片上传服务暂时不可用', serverErrorCode || 'managed_image_error', status);
  if (status >= 500)
    return new ApiError('服务暂时不可用，请稍后再试', 'server_error', status);
  return new ApiError(
    serverMessage || '请求失败',
    serverErrorCode || 'request_failed',
    status,
  );
};

// --------------- 超时控制 ---------------
const DEFAULT_TIMEOUT_MS = 30_000;
const CHAT_MESSAGE_TIMEOUT_MS = 240_000;
const IMAGE_GENERATION_CHAT_TIMEOUT_MS = 900_000;

const fetchWithTimeout = (
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> => {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init;
  const controller = new AbortController();
  const existingSignal = fetchInit.signal;
  const onAbort = () => controller.abort(existingSignal.reason);
  if (existingSignal?.aborted) {
    controller.abort(existingSignal.reason);
  } else {
    existingSignal?.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  return fetch(url, { ...fetchInit, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    existingSignal?.removeEventListener?.('abort', onAbort);
  });
};

// --------------- GET 自动重试 ---------------
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_GET_RETRIES = 2;

const isRetryable = (method: string, status: number, error: unknown) => {
  if (method !== 'GET') return false;
  if (status > 0 && RETRYABLE_STATUSES.has(status)) return true;
  if (error instanceof TypeError) return true; // 网络错误
  return false;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --------------- 防重复提交 ---------------
const inflightRequests = new Map<string, Promise<unknown>>();

const buildDedupeKey = (path: string, method: string, body?: BodyInit | null, token = '') => {
  const authScope = token ? `auth:${token}` : 'auth:anonymous';
  if (method === 'GET') return `GET:${path}:${authScope}`;
  const bodyStr = typeof body === 'string' ? body : '';
  return `${method}:${path}:${authScope}:${bodyStr}`;
};

// --------------- 核心 request ---------------
interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  dedupe?: boolean;
  sessionToken?: string;
}

const request = async <T>(
  path: string,
  init?: RequestOptions,
): Promise<T> => {
  const { sessionToken, ...requestInit } = init || {};
  const method = (requestInit.method || 'GET').toUpperCase();
  const dedupe = requestInit.dedupe !== false;
  const token = sessionToken === undefined ? getSessionToken() : sessionToken;
  const dedupeKey = dedupe ? buildDedupeKey(path, method, requestInit.body, token) : '';

  if (dedupe && dedupeKey && inflightRequests.has(dedupeKey)) {
    return inflightRequests.get(dedupeKey) as Promise<T>;
  }

  const execute = async (): Promise<T> => {
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(requestInit.headers as Record<string, string> | undefined),
    };
    if (!headers['Content-Type'] && requestInit.body) {
      headers['Content-Type'] = 'application/json';
    }

    let lastError: unknown;
    const maxAttempts = method === 'GET' ? MAX_GET_RETRIES + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) await wait(500 * attempt);
        const response = await fetchWithTimeout(path, {
          ...requestInit,
          cache: 'no-store' as RequestCache,
          headers,
          timeoutMs: requestInit.timeoutMs,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const err = classifyError(response.status, data.message || '', data.errorCode || data.code || '');
          if (isRetryable(method, response.status, null) && attempt < maxAttempts - 1) {
            lastError = err;
            continue;
          }
          throw err;
        }
        return data as T;
      } catch (error: any) {
        if (error instanceof ApiError) throw error;
        const isAbort = error?.name === 'AbortError' || error instanceof DOMException;
        if (isAbort) {
          // 如果外部 signal 已经 aborted，说明是手动中断，重新抛出原始错误，让调用方检测
          if (requestInit.signal?.aborted) throw error;
          // 否则是内部超时 abort
          throw new ApiError('请求超时，请稍后重试', 'timeout', 408);
        }
        if (isRetryable(method, 0, error) && attempt < maxAttempts - 1) {
          lastError = error;
          continue;
        }
        throw classifyError(0, error?.message || '');
      }
    }
    throw lastError;
  };

  const promise = execute().finally(() => {
    if (dedupeKey) inflightRequests.delete(dedupeKey);
  });

  if (dedupe && dedupeKey) {
    inflightRequests.set(dedupeKey, promise);
  }

  return promise;
};

export const probeInternalApi = async (): Promise<boolean> => {
  try {
    const response = await fetchWithTimeout('/api/health', { timeoutMs: 1200 });
    return response.ok;
  } catch {
    return false;
  }
};

export const loginInternalUser = async (username: string, password: string) => {
  return request<{ token: string; user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
};

export const fetchCurrentUser = async () => {
  return request<{ user: AuthUser }>('/api/auth/me');
};

export const updateCurrentUserProfile = async (payload: Partial<{
  displayName: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
}>) => {
  return request<{ user: AuthUser }>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const logoutInternalUser = async () => {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
};

export const fetchRemoteAppState = async () => {
  return request<{ state: PersistedAppState }>('/api/state');
};

export const saveRemoteAppState = async (
  state: Partial<PersistedAppState>,
  options: {
    mode?: 'merge' | 'replace';
    includeCanonicalState?: boolean;
    sessionToken?: string;
    signal?: AbortSignal;
  } = {},
) => {
  return request<{ ok: boolean; state?: PersistedAppState }>('/api/state', {
    method: 'PUT',
    sessionToken: options.sessionToken,
    signal: options.signal,
    body: JSON.stringify({
      state,
      mode: options.mode || 'merge',
      ...(options.includeCanonicalState ? { includeCanonicalState: true } : {}),
    }),
  });
};

export const probeVideoDiagnosis = async (payload: {
  platform: VideoDiagnosisPlatform;
  url: string;
  analysisItems: VideoDiagnosisAnalysisItem[];
  accessMode: VideoDiagnosisAccessMode;
}) => {
  return request<{
    probe: VideoDiagnosisProbeResult;
    report: VideoDiagnosisReportResult;
  }>('/api/video-diagnosis/probe', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 120_000,
  });
};

export const analyzeVideoDiagnosis = async (payload: {
  diagData: unknown;
  platform: VideoDiagnosisPlatform;
  model: string;
}) => {
  return request<{
    analysis: {
      summary: string;
      overallRisk: 'low' | 'medium' | 'high' | 'unknown';
      sections: Array<{
        id: string;
        title: string;
        level: 'normal' | 'warning' | 'danger';
        findings: string[];
        suggestion: string;
      }>;
      topActions: string[];
    };
    rawContent: string;
  }>('/api/video-diagnosis/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 120_000,
  });
};

export const fetchInternalUsers = async () => {
  return request<{ users: AuthUser[] }>('/api/users');
};

export const createInternalUser = async (payload: {
  username: string;
  displayName: string;
  password: string;
  role: 'admin' | 'staff';
  jobConcurrency: number;
  featurePermissions?: AuthUser['featurePermissions'];
  creditLimitMode?: 'unlimited' | 'limited';
  creditBalance?: number;
}) => {
  return request<{ user: AuthUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const updateInternalUser = async (
  userId: string,
  payload: Partial<{
    displayName: string;
    password: string;
    role: 'admin' | 'staff';
    status: 'active' | 'disabled';
    jobConcurrency: number;
    featurePermissions: AuthUser['featurePermissions'];
    creditLimitMode?: 'unlimited' | 'limited';
    creditBalance?: number;
  }>
) => {
  return request<{ user: AuthUser }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const deleteInternalUser = async (userId: string) => {
  return request<{ ok: boolean }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
};

export const createInternalLog = async (payload: {
  level: 'info' | 'error';
  module: string;
  action: string;
  message: string;
  detail?: string;
  status: 'success' | 'failed' | 'started' | 'interrupted';
  meta?: Record<string, unknown>;
}) => {
  return request<{ ok: boolean; log: InternalLogEntry }>('/api/logs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const safeCreateInternalLog = async (payload: Parameters<typeof createInternalLog>[0]) => {
  try {
    if (!getSessionToken()) return null;
    return await createInternalLog(payload);
  } catch (error) {
    console.error('Failed to write internal log', error);
    return null;
  }
};

export const fetchInternalLogs = async (filters?: Partial<{
  module: string;
  userId: string;
  status: string;
  startAt: number;
  endAt: number;
  page: number;
  pageSize: number;
}>) => {
  const params = new URLSearchParams();
  if (filters?.module && filters.module !== 'all') params.set('module', filters.module);
  if (filters?.userId && filters.userId !== 'all') params.set('userId', filters.userId);
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters?.startAt) params.set('startAt', String(filters.startAt));
  if (filters?.endAt) params.set('endAt', String(filters.endAt));
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.pageSize) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();
  return request<{ logs: InternalLogEntry[]; total: number; page: number; pageSize: number }>(`/api/logs${query ? `?${query}` : ''}`);
};

export const fetchInternalLogMeta = async () => {
  return request<{
    modules: string[];
    users: Array<{ id: string; label: string }>;
  }>('/api/logs/meta');
};

export const deleteInternalLogs = async (payload?: Partial<{
  module: string;
  userId: string;
  status: string;
  startAt: number;
  endAt: number;
}>) => {
  return request<{ ok: boolean; deletedCount: number }>('/api/logs', {
    method: 'DELETE',
    body: JSON.stringify(payload || {}),
  });
};

export const fetchUsageStats = async (filters?: Partial<{
  startDate: string;
  endDate: string;
  userId: string;
  module: string;
}>) => {
  const params = new URLSearchParams();
  if (filters?.startDate) params.set('startDate', filters.startDate);
  if (filters?.endDate) params.set('endDate', filters.endDate);
  if (filters?.userId && filters.userId !== 'all') params.set('userId', filters.userId);
  if (filters?.module && filters.module !== 'all') params.set('module', filters.module);
  const query = params.toString();
  return request<{
    rows: Array<{
      statDate: string;
      userId: string;
      username: string;
      displayName: string;
      module: string;
      successCount: number;
      failedCount: number;
      interruptedCount: number;
      creditsConsumed?: number;
    }>;
  }>(`/api/stats/usage${query ? `?${query}` : ''}`);
};

export const backfillUsageStats = async () => {
  return request<{ ok: boolean; upserted: number }>('/api/stats/backfill', {
    method: 'POST',
  });
};

export const fetchTaskPlatformHealth = async () => {
  return request<TaskPlatformHealth>('/api/admin/task-platform/health');
};

const INTERNAL_JOB_STATUSES = new Set([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'retry_waiting',
]);

const TASK_EVENT_STATUSES = new Set(['success', 'failed', 'started', 'interrupted']);
const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const hasStringFields = (value: Record<string, unknown>, fields: string[]) => (
  fields.every((field) => typeof value[field] === 'string')
);
const hasNumberFields = (value: Record<string, unknown>, fields: string[]) => (
  fields.every((field) => typeof value[field] === 'number' && Number.isFinite(value[field]))
);
const isNullableNumber = (value: unknown) => value === null
  || (typeof value === 'number' && Number.isFinite(value));

const isInternalJobResponse = (value: unknown): value is InternalJob => {
  if (!isObjectRecord(value)) return false;
  return hasStringFields(value, [
    'id', 'userId', 'module', 'taskType', 'provider', 'status', 'providerTaskId',
    'errorCode', 'errorMessage',
  ])
    && INTERNAL_JOB_STATUSES.has(value.status as string)
    && hasNumberFields(value, ['priority', 'retryCount', 'maxRetries', 'createdAt', 'updatedAt'])
    && isObjectRecord(value.payload)
    && (value.result === null || isObjectRecord(value.result))
    && isNullableNumber(value.startedAt)
    && isNullableNumber(value.finishedAt)
    && isNullableNumber(value.cancelRequestedAt)
    && (value.errorDetail === undefined || typeof value.errorDetail === 'string');
};

const isTaskPlatformJobResponse = (value: unknown): value is TaskPlatformJob => {
  if (!isObjectRecord(value) || !isObjectRecord(value.user) || !isObjectRecord(value.submissionResolution)) return false;
  return hasStringFields(value, [
    'id', 'userId', 'module', 'taskType', 'provider', 'status', 'providerTaskId',
    'errorCode', 'errorMessage', 'latestAttemptStatus', 'latestStage', 'latestEventStatus',
    'errorFingerprint', 'workflowId', 'runId', 'traceId',
  ])
    && INTERNAL_JOB_STATUSES.has(value.status as string)
    && hasStringFields(value.user, ['id', 'username', 'displayName'])
    && hasNumberFields(value, ['retryCount', 'maxRetries', 'createdAt', 'updatedAt', 'attemptCount'])
    && isNullableNumber(value.startedAt)
    && isNullableNumber(value.finishedAt)
    && isNullableNumber(value.latestEventAt)
    && typeof value.providerSubmitted === 'boolean'
    && typeof value.retryable === 'boolean'
    && typeof value.submissionResolution.allowed === 'boolean'
    && typeof value.submissionResolution.canBind === 'boolean';
};

const isTaskPlatformAttemptResponse = (value: unknown): value is TaskPlatformAttempt => {
  if (!isObjectRecord(value)) return false;
  return hasStringFields(value, [
    'id', 'jobId', 'engine', 'workflowId', 'runId', 'traceId', 'status',
    'providerTaskId', 'errorCode', 'errorMessage',
  ])
    && hasNumberFields(value, ['attemptNo', 'startedAt'])
    && isNullableNumber(value.finishedAt);
};

const isTaskPlatformEventResponse = (value: unknown): value is TaskPlatformEvent => {
  if (!isObjectRecord(value)) return false;
  return hasStringFields(value, [
    'id', 'jobId', 'attemptId', 'traceId', 'stage', 'eventName', 'status', 'engine',
    'errorCode', 'errorMessage', 'errorFingerprint', 'providerTaskId', 'workflowId', 'runId',
  ])
    && TASK_EVENT_STATUSES.has(value.status as string)
    && typeof value.providerSubmitted === 'boolean'
    && typeof value.retryable === 'boolean'
    && (value.meta === null || isObjectRecord(value.meta))
    && hasNumberFields(value, ['createdAt']);
};

const invalidTaskPlatformResponse = (): never => {
  throw new ApiError('任务平台响应格式异常，请刷新后重试', 'invalid_response', 502);
};

export const fetchTaskPlatformJobs = async (filters?: Partial<{
  status: string;
  module: string;
  provider: string;
  taskType: string;
  userId: string;
  traceId: string;
  page: number;
  pageSize: number;
}>) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters?.module && filters.module !== 'all') params.set('module', filters.module);
  if (filters?.provider && filters.provider !== 'all') params.set('provider', filters.provider);
  if (filters?.taskType) params.set('taskType', filters.taskType);
  if (filters?.userId && filters.userId !== 'all') params.set('userId', filters.userId);
  if (filters?.traceId) params.set('traceId', filters.traceId);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.pageSize) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();
  const result = await request<unknown>(
    `/api/admin/task-platform/jobs${query ? `?${query}` : ''}`,
  );
  if (
    !isObjectRecord(result)
    || !Array.isArray(result.jobs)
    || !result.jobs.every(isTaskPlatformJobResponse)
    || !hasNumberFields(result, ['total', 'page', 'pageSize'])
  ) invalidTaskPlatformResponse();
  return result as { jobs: TaskPlatformJob[]; total: number; page: number; pageSize: number };
};

export const fetchTaskPlatformTimeline = async (jobId: string) => {
  const result = await request<unknown>(`/api/admin/task-platform/jobs/${encodeURIComponent(jobId)}/timeline`);
  const timeline = isObjectRecord(result) ? result.timeline : null;
  if (
    !isObjectRecord(result)
    || !isInternalJobResponse(result.job)
    || !isObjectRecord(timeline)
    || !Array.isArray(timeline.attempts)
    || !timeline.attempts.every(isTaskPlatformAttemptResponse)
    || !Array.isArray(timeline.events)
    || !timeline.events.every(isTaskPlatformEventResponse)
  ) invalidTaskPlatformResponse();
  return result as {
    job: InternalJob;
    timeline: { attempts: TaskPlatformAttempt[]; events: TaskPlatformEvent[] };
  };
};

export const resolveTaskPlatformSubmission = async (
  jobId: string,
  input: {
    action: 'bind' | 'release' | 'settle';
    providerTaskId?: string;
    actualCreditsConsumed?: number;
    verificationNote?: string;
  },
) => {
  const result = await request<unknown>(
    `/api/admin/task-platform/jobs/${encodeURIComponent(jobId)}/submission-resolution`,
    { method: 'POST', body: JSON.stringify(input), dedupe: false },
  );
  if (
    !isObjectRecord(result)
    || !['bind', 'release', 'settle'].includes(String(result.action || ''))
    || !isInternalJobResponse(result.job)
  ) invalidTaskPlatformResponse();
  return result as { action: 'bind' | 'release' | 'settle'; job: InternalJob };
};

export const fetchSystemConfig = async () => {
  const result = await request<unknown>('/api/system/config');
  const config = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as { config?: unknown }).config
    : null;
  if (
    !config
    || typeof config !== 'object'
    || Array.isArray(config)
    || typeof (config as { publicBaseUrl?: unknown }).publicBaseUrl !== 'string'
  ) {
    throw new ApiError('系统配置响应格式异常，请稍后重试', 'invalid_response', 502);
  }
  return result as { config: SystemPublicConfig };
};

export const updateSystemConfig = async (payload: {
  analysisModel?: string;
  videoAnalysisModel?: string;
  announcement?: Partial<SystemAnnouncement>;
  openaiCompatible?: {
    apiKey?: string;
    baseUrl?: string;
    models?: string;
  };
}) => {
  return request<{ config: SystemPublicConfig }>('/api/system/config', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const updateCurrentUserAnalysisModel = async (analysisModel: string) => {
  return request<{ user: AuthUser }>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ analysisModel }),
  });
};

export const broadcastSystemAnalysisModel = async () => {
  return request<{ ok: boolean; analysisModel: string; config: SystemPublicConfig }>('/api/system/analysis-model/broadcast', {
    method: 'POST',
  });
};

export type SystemModelProvider = {
  provider: string;
  displayName?: string;
  baseUrl?: string;
  customBaseUrlRequired?: boolean;
  hasCredential?: boolean;
  defaultModel?: string;
  fallbackModel?: string;
  capabilityCounts?: Record<string, number>;
  models: Array<{ id: string; mode?: string; features?: string[] }>;
};

export type SystemModelProviderRegistry = {
  providers: SystemModelProvider[];
  defaultChatModel?: string;
  defaultEmbeddingModel?: string;
  defaultRerankModel?: string;
  defaultImageModel?: string;
  defaultVideoModel?: string;
};

export type SystemModelProviderPreset = {
  provider: string;
  displayName: string;
  baseUrl?: string;
  credentialRef?: string;
  customBaseUrlRequired?: boolean;
  models: Array<{ id: string; mode?: string; features?: string[] }>;
};

export type SystemModelProviderPayload = {
  provider: string;
  displayName?: string;
  baseUrl?: string;
  credentialRef?: string;
  apiKey?: string;
  modelsText?: string;
  models?: Array<{ id: string; mode?: string; features?: string[] }> | string[];
  defaultModel?: string;
  fallbackModel?: string;
};

export const fetchSystemModelProviders = async () => {
  return request<{ registry: SystemModelProviderRegistry; presets: SystemModelProviderPreset[] }>('/api/system/model-providers');
};

export const saveSystemModelProvider = async (payload: SystemModelProviderPayload) => {
  return request<{ registry: SystemModelProviderRegistry }>('/api/system/model-providers', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const deleteSystemModelProvider = async (provider: string) => {
  return request<{ registry: SystemModelProviderRegistry }>(`/api/system/model-providers/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    dedupe: false,
  });
};

export const testSystemModelProvider = async (payload: SystemModelProviderPayload) => {
  return request<{ ok: boolean; message: string }>('/api/system/model-providers/test', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export type DreaminaStatus = {
  installed: boolean;
  authenticated: boolean;
  cliPath: string;
  rawOutput: string;
  creditText: string;
  message: string;
  totalCredit?: number;
  userId?: string;
  userName?: string;
  vipLevel?: string;
};

export type DreaminaLoginStart = {
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  rawOutput: string;
};

export const fetchDreaminaStatus = async () => {
  return request<{ status: DreaminaStatus }>('/api/dreamina/status');
};

export const startDreaminaLogin = async () => {
  return request<{ login: DreaminaLoginStart }>('/api/dreamina/login', {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

export const checkDreaminaLogin = async (payload: { deviceCode: string; poll?: number }) => {
  return request<{ login: { authenticated: boolean; rawOutput: string }; status: DreaminaStatus }>('/api/dreamina/login/check', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: Math.max(45_000, ((payload.poll || 30) + 10) * 1000),
  });
};

export const logoutDreamina = async () => {
  return request<{ ok: boolean; result: { rawOutput: string }; status: DreaminaStatus }>('/api/dreamina/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

export const fetchAgentSummaries = async () => {
  return request<{ agents: AgentSummary[] }>('/api/agents');
};

export const createAgent = async (payload: {
  name: string;
  description: string;
  department: string;
  iconUrl?: string | null;
  avatarPreset?: string | null;
  systemPrompt: string;
  openingRemarks?: string | null;
  allowedChatModels?: string[];
  defaultChatModel?: string | null;
  replyStyleRules?: Record<string, unknown>;
  modelPolicy?: Record<string, unknown>;
  contextPolicy?: Record<string, unknown>;
  retrievalPolicy?: Record<string, unknown>;
  toolPolicy?: Record<string, unknown>;
  knowledgeBaseIds?: string[];
  knowledgeDocumentBindings?: AgentKnowledgeDocumentBinding[];
}) => {
  return request<{ agent: AgentSummary; version: AgentVersion }>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const fetchAgentDetail = async (agentId: string) => {
  return request<{ agent: AgentSummary; versions: AgentVersion[] }>(`/api/agents/${encodeURIComponent(agentId)}`);
};

export const updateAgent = async (agentId: string, payload: Partial<{
  name: string;
  description: string;
  department: string;
  iconUrl: string | null;
  avatarPreset: string | null;
  status: 'draft' | 'published' | 'archived';
}>) => {
  return request<{ agent: AgentSummary }>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const archiveAgent = async (agentId: string) => {
  return request<{ ok: boolean; deletedAgentId: string; message: string }>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  });
};

export const deleteAgentVersion = async (versionId: string) => {
  return request<{ ok: boolean; deletedVersionId: string; message: string }>(`/api/agent-versions/${encodeURIComponent(versionId)}`, {
    method: 'DELETE',
  });
};

export const createAgentDraft = async (agentId: string) => {
  return request<{ version: AgentVersion }>(`/api/agents/${encodeURIComponent(agentId)}/draft`, {
    method: 'POST',
  });
};

export const publishAgent = async (agentId: string, versionId?: string) => {
  return request<{ agent: AgentSummary }>(`/api/agents/${encodeURIComponent(agentId)}/publish`, {
    method: 'POST',
    body: JSON.stringify(versionId ? { versionId } : {}),
  });
};

export const rollbackAgent = async (agentId: string, versionId: string) => {
  return request<{ agent: AgentSummary }>(`/api/agents/${encodeURIComponent(agentId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
};

export const updateAgentVersion = async (versionId: string, payload: Partial<{
  versionName: string;
  systemPrompt: string;
  openingRemarks: string | null;
  allowedChatModels: string[];
  defaultChatModel: string | null;
  replyStyleRules: Record<string, unknown>;
  modelPolicy: Record<string, unknown>;
  contextPolicy: Record<string, unknown>;
  retrievalPolicy: Record<string, unknown>;
  toolPolicy: Record<string, unknown>;
  knowledgeBaseIds: string[];
  knowledgeDocumentBindings: AgentKnowledgeDocumentBinding[];
}>) => {
  return request<{ version: AgentVersion }>(`/api/agent-versions/${encodeURIComponent(versionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const validateAgentVersion = async (versionId: string, message: string) => {
  return request<{ version: AgentVersion; result: Record<string, unknown> }>(`/api/agent-versions/${encodeURIComponent(versionId)}/validate`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
};

export const fetchKnowledgeBases = async () => {
  return request<{ knowledgeBases: KnowledgeBaseSummary[] }>('/api/knowledge-bases');
};

export const createKnowledgeBase = async (payload: {
  name: string;
  description: string;
  department: string;
}) => {
  return request<{ knowledgeBase: KnowledgeBaseSummary }>('/api/knowledge-bases', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const fetchKnowledgeBaseDetail = async (knowledgeBaseId: string) => {
  return request<{ knowledgeBase: KnowledgeBaseSummary; documents: KnowledgeDocumentSummary[] }>(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`);
};

export const updateKnowledgeBase = async (knowledgeBaseId: string, payload: Partial<{
  name: string;
  description: string;
  department: string;
  status: 'active' | 'archived';
}>) => {
  return request<{ knowledgeBase: KnowledgeBaseSummary }>(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const deleteKnowledgeBase = async (knowledgeBaseId: string) => {
  return request<{ ok: boolean; deletedKnowledgeBaseId: string; message: string }>(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, {
    method: 'DELETE',
  });
};

export const fetchKnowledgeDocuments = async (knowledgeBaseId: string) => {
  const params = new URLSearchParams({ knowledgeBaseId });
  return request<{ documents: KnowledgeDocumentSummary[] }>(`/api/knowledge-documents?${params.toString()}`);
};

export const createKnowledgeDocument = async (payload: {
  knowledgeBaseId: string;
  title: string;
  sourceType: 'upload' | 'manual';
  chunkStrategy?: 'general' | 'rule' | 'sop' | 'faq' | 'case';
  rawText: string;
  normalizationEnabled?: boolean;
}) => {
  return request<{ document: KnowledgeDocumentSummary }>('/api/knowledge-documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const updateKnowledgeDocument = async (documentId: string, payload: Partial<{
  title: string;
  sourceType: 'upload' | 'manual';
  chunkStrategy: 'general' | 'rule' | 'sop' | 'faq' | 'case';
  rawText: string;
  normalizationEnabled: boolean;
}>) => {
  return request<{ document: KnowledgeDocumentSummary }>(`/api/knowledge-documents/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const deleteKnowledgeDocument = async (documentId: string) => {
  return request<{ ok: boolean; deletedCount: number }>(`/api/knowledge-documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
};

export const fetchChatAgents = async () => {
  return request<{ agents: AgentSummary[] }>('/api/chat/agents');
};

export const fetchChatSessions = async (agentId = '') => {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  return request<{ sessions: AgentChatSession[] }>(`/api/chat/sessions${params.toString() ? `?${params.toString()}` : ''}`);
};

export const createChatSession = async (agentId: string) => {
  return request<{ session: AgentChatSession; openingRemarks?: string | null }>('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
};

export const updateChatSession = async (sessionId: string, payload: Partial<{
  selectedModel: string;
  reasoningLevel: string | null;
  webSearchEnabled: boolean;
  lastImageMode: boolean;
}>) => {
  return request<{ session: AgentChatSession }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const deleteChatSession = async (sessionId: string) => {
  return request<{ ok: boolean; deletedSessionId: string }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
};

export const deleteUserAgentHistory = async (agentId: string) => {
  return request<{ ok: boolean; deletedSessionCount: number; deletedMessageCount: number; deletedUsageCount: number }>(
    `/api/chat/agents/${encodeURIComponent(agentId)}/history`,
    { method: 'DELETE' }
  );
};

export type SmartFactoryPreviewResult = {
  mode: 'preview' | 'production';
  agentId?: string;
  answer: string;
  modelRequest: {
    model?: Record<string, unknown>;
    systemPrompt?: string;
    messages?: Array<Record<string, unknown>>;
    tools?: Array<Record<string, unknown>>;
  };
  toolResults: Array<{
    name: string;
    observation: string;
    trace?: Record<string, unknown>;
  }>;
  citations?: Array<Record<string, unknown>>;
  trace: Array<Record<string, unknown>>;
  runLog?: Record<string, unknown>;
};

export type SmartFactoryConfig = {
  mode: 'preview' | 'production';
  modelProviders?: Array<{
    provider: string;
    displayName?: string;
    baseUrl?: string;
    defaultModel?: string;
    fallbackModel?: string;
    hasCredential?: boolean;
    models: Array<{ id: string; mode?: string; features?: string[] }>;
  }>;
  models: Array<{
    provider: string;
    name: string;
    mode?: string;
    features?: string[];
  }>;
  knowledgeBases: Array<{
    id: string;
    name: string;
    description?: string;
    status?: string;
    documentCount: number;
    readyDocumentCount?: number;
    failedDocumentCount?: number;
    chunkCount?: number;
    retrievalPolicy?: { topK?: number; similarityThreshold?: number; maxContextChars?: number };
    embeddingModel?: { provider: string; model: string } | null;
    rerankModel?: { provider: string; model: string } | null;
    documents?: Array<{
      id: string;
      title: string;
      fileName?: string;
      sourceType?: string;
      preview?: string;
      status?: string;
      error?: string;
      chunkStrategy?: 'general' | 'rule' | 'sop' | 'faq' | 'case';
      maxChunkChars?: number;
      chunkCount?: number;
      updatedAt?: number;
    }>;
  }>;
  tools: Array<{
    name: string;
    type: string;
    description?: string;
    authorized?: boolean;
    riskLevel?: string;
    executorRef?: string;
    capability?: string;
    icon?: string;
    modelProvider?: string;
    model?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  agents: Array<{
    id: string;
    name: string;
    description?: string;
    prompt?: string;
    enabled?: boolean;
    status?: 'draft' | 'published';
    publishedAt?: number;
    model?: Record<string, unknown>;
    knowledgeBaseIds?: string[];
    toolNames?: string[];
    variables?: Array<{ key: string; label?: string; type?: string; required?: boolean; defaultValue?: string }>;
    metadataFilters?: Array<{ key: string; operator?: string; value?: string }>;
    vision?: { enabled?: boolean; transferMethods?: string[]; imageFileSizeLimit?: number };
  }>;
  sessions: Array<{
    id: string;
    agentId: string;
    title: string;
    messageCount: number;
    messages: Array<{
      id?: string;
      role: string;
      content: string;
      createdAt?: number;
      trace?: Array<Record<string, unknown>>;
    }>;
  }>;
  runLogs?: Array<Record<string, unknown>>;
};

export type SmartFactoryModelProviderPreset = {
  provider: string;
  displayName: string;
  baseUrl?: string;
  credentialRef?: string;
  customBaseUrlRequired?: boolean;
  models: Array<{ id: string; mode?: string; features?: string[] }>;
};

export type SmartFactoryConfigUpdate = Partial<{
  modelProviders: Array<{
    provider: string;
    credentialRef?: string;
    models: Array<{
      id: string;
      mode?: string;
      features?: string[];
    }>;
  }>;
  knowledgeBases: Array<{
    id: string;
    name: string;
    documents?: Array<{
      id: string;
      title: string;
      content: string;
    }>;
  }>;
  tools: Array<{
    name: string;
    type: 'cli';
    description?: string;
    authorization_status?: string;
    risk_level?: string;
    invoke_metadata?: Record<string, unknown>;
  }>;
}>;

export const fetchSmartFactoryConfig = async () => {
  return request<{ config: SmartFactoryConfig }>('/api/smart-factory/config');
};

export const updateSmartFactoryConfig = async (smartFactory: SmartFactoryConfigUpdate) => {
  return request<{ config: SmartFactoryConfig }>('/api/smart-factory/config', {
    method: 'PATCH',
    body: JSON.stringify({ smartFactory }),
    dedupe: false,
  });
};

export const sendSmartFactoryChat = async (payload: { agentId: string; sessionId: string; message: string }) => {
  return request<{ result: SmartFactoryPreviewResult; config: SmartFactoryConfig }>('/api/smart-factory/chat', {
    method: 'POST',
    body: JSON.stringify({
      agentId: payload.agentId,
      sessionId: payload.sessionId,
      message: payload.message,
    }),
    timeoutMs: 120_000,
    dedupe: false,
  });
};

export const addSmartFactoryKnowledgeDocument = async (payload: {
  knowledgeBaseId: string;
  document: {
    id?: string;
    title: string;
    content: string;
    fileName?: string;
    sourceType?: string;
    chunkStrategy?: 'general' | 'rule' | 'sop' | 'faq' | 'case';
    maxChunkChars?: number;
  };
}) => {
  return request<{ config: SmartFactoryConfig }>('/api/smart-factory/knowledge-documents', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const saveSmartFactoryModelProvider = async (payload: {
  provider: string;
  displayName?: string;
  baseUrl?: string;
  credentialRef?: string;
  apiKey?: string;
  modelsText?: string;
  models?: Array<{ id: string; mode?: string; features?: string[] }> | string[];
  defaultModel?: string;
  fallbackModel?: string;
}) => {
  return request<{ config: SmartFactoryConfig }>('/api/smart-factory/model-providers', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const fetchSmartFactoryModelProviderPresets = async () => {
  return request<{ presets: SmartFactoryModelProviderPreset[] }>('/api/smart-factory/model-provider-presets');
};

export const deleteSmartFactoryModelProvider = async (provider: string) => {
  return request<{ config: SmartFactoryConfig }>(`/api/smart-factory/model-providers/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    dedupe: false,
  });
};

export const testSmartFactoryModelProvider = async (payload: {
  provider: string;
  baseUrl?: string;
  credentialRef?: string;
  modelsText?: string;
  models?: Array<{ id: string }> | string[];
}) => {
  return request<{ ok: boolean; message: string }>('/api/smart-factory/model-providers/test', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const createSmartFactoryAgent = async (payload: {
  name: string;
  description?: string;
  prompt?: string;
  model?: Record<string, unknown>;
  knowledgeBaseIds?: string[];
  toolNames?: string[];
  variables?: Array<{ key: string; label?: string; type?: string; required?: boolean; defaultValue?: string }>;
  metadataFilters?: Array<{ key: string; operator?: string; value?: string }>;
  vision?: { enabled?: boolean; transferMethods?: string[]; imageFileSizeLimit?: number };
}) => {
  return request<{ config: SmartFactoryConfig }>('/api/smart-factory/agents', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const updateSmartFactoryAgent = async (agentId: string, payload: {
  name?: string;
  description?: string;
  prompt?: string;
  model?: Record<string, unknown>;
  knowledgeBaseIds?: string[];
  toolNames?: string[];
  variables?: Array<{ key: string; label?: string; type?: string; required?: boolean; defaultValue?: string }>;
  metadataFilters?: Array<{ key: string; operator?: string; value?: string }>;
  vision?: { enabled?: boolean; transferMethods?: string[]; imageFileSizeLimit?: number };
  enabled?: boolean;
}) => {
  return request<{ config: SmartFactoryConfig }>(`/api/smart-factory/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export type SmartFactoryAgentCenterSync =
  | { synced: true; published: true; agentCenterAgentId: string }
  | { synced: true; published: false; agentCenterAgentId: string; validationFailed: true; errorMessage?: string }
  | { synced: true; published: false; agentCenterAgentId: string; syncError: string }
  | { synced: false; syncError: string }
  | { synced: false; skipped: 'not_admin' | 'no_plan' };

export type SmartFactoryAgentCenterUnlink =
  | { agentCenterAgentId: string; unpublished: true }
  | { error: string }
  | null;

export const deleteSmartFactoryAgent = async (agentId: string) => {
  return request<{ config: SmartFactoryConfig; agentCenterUnlink?: SmartFactoryAgentCenterUnlink }>(`/api/smart-factory/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    dedupe: false,
  });
};

export const publishSmartFactoryAgent = async (agentId: string) => {
  return request<{ config: SmartFactoryConfig; agentCenterSync?: SmartFactoryAgentCenterSync }>(`/api/smart-factory/agents/${encodeURIComponent(agentId)}/publish`, {
    method: 'POST',
    dedupe: false,
  });
};

// 接管中心存量智能体:导入工厂并建立 factoryAgentId 关联,之后在工厂编辑发布即原地更新中心同一智能体
export const adoptSmartFactoryCenterAgent = async (centerAgentId: string) => {
  return request<{
    config: SmartFactoryConfig;
    adopted: { factoryAgentId: string; agentCenterAgentId: string };
  }>(`/api/smart-factory/agents/adopt/${encodeURIComponent(centerAgentId)}`, {
    method: 'POST',
    dedupe: false,
  });
};

export const createSmartFactoryKnowledgeBase = async (payload: { name: string; description?: string }) => {
  return request<{ config: SmartFactoryConfig }>('/api/smart-factory/knowledge-bases', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const updateSmartFactoryKnowledgeBase = async (
  knowledgeBaseId: string,
  payload: {
    name?: string;
    description?: string;
    retrievalPolicy?: { topK?: number; similarityThreshold?: number; maxContextChars?: number };
    embeddingModel?: { provider: string; model: string };
    rerankModel?: { provider: string; model: string };
  },
) => {
  return request<{ config: SmartFactoryConfig }>(`/api/smart-factory/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const deleteSmartFactoryKnowledgeBase = async (knowledgeBaseId: string) => {
  return request<{ config: SmartFactoryConfig }>(`/api/smart-factory/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, {
    method: 'DELETE',
    dedupe: false,
  });
};

export const retrainSmartFactoryKnowledgeDocument = async (
  documentId: string,
  payload: { title?: string; content?: string; chunkStrategy?: 'general' | 'rule' | 'sop' | 'faq' | 'case'; maxChunkChars?: number },
) => {
  return request<{ config: SmartFactoryConfig }>(`/api/smart-factory/knowledge-documents/${encodeURIComponent(documentId)}/retrain`, {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const deleteSmartFactoryKnowledgeDocument = async (documentId: string) => {
  return request<{ config: SmartFactoryConfig }>(`/api/smart-factory/knowledge-documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    dedupe: false,
  });
};

export const searchSmartFactoryKnowledge = async (payload: {
  query: string;
  knowledgeBaseIds?: string[];
  retrievalPolicy?: { topK?: number; similarityThreshold?: number; maxContextChars?: number };
}) => {
  return request<{ search: { query: string; results: Array<Record<string, unknown>> } }>('/api/smart-factory/knowledge-search', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const saveSmartFactoryTool = async (payload: {
  name: string;
  type?: 'cli' | 'builtin';
  description?: string;
  executorRef?: string;
  riskLevel?: string;
  capability?: string;
  icon?: string;
  modelProvider?: string;
  model?: string;
  inputSchemaText?: string;
  inputSchema?: Record<string, unknown>;
}) => {
  return request<{ config: SmartFactoryConfig }>('/api/smart-factory/tools', {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const testSmartFactoryTool = async (toolName: string, payload: Record<string, unknown>) => {
  return request<{ ok: boolean; toolName: string; observation: string }>(`/api/smart-factory/tools/${encodeURIComponent(toolName)}/test`, {
    method: 'POST',
    body: JSON.stringify(payload),
    dedupe: false,
  });
};

export const deleteSmartFactoryTool = async (toolName: string) => {
  return request<{ config: SmartFactoryConfig }>(`/api/smart-factory/tools/${encodeURIComponent(toolName)}`, {
    method: 'DELETE',
    dedupe: false,
  });
};

export const runSmartFactoryPreviewTurn = async (payload: { message: string }) => {
  return request<{ result: SmartFactoryPreviewResult }>('/api/smart-factory/preview-turn', {
    method: 'POST',
    body: JSON.stringify({ message: payload.message }),
    timeoutMs: 120_000,
    dedupe: false,
  });
};

export const fetchChatMessages = async (sessionId: string) => {
  return request<{ messages: AgentChatMessage[] }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
};

export type ChatProgressEvent = {
  stage?: 'thinking' | 'retrieved' | 'searching_knowledge' | 'image_validating' | 'image_validation_failed' | 'image_regenerating';
  type?: 'thinking' | 'retrieved' | 'streaming' | 'compressed' | 'tool_calling' | 'searching_knowledge' | 'image_generating' | 'image_validating' | 'image_validation_failed' | 'image_regenerating' | 'image_ready' | 'done' | 'error';
  round?: number;
  queries?: string[];
  chunkCount?: number;
  docTitles?: string[];
  delta?: string;
  foldedRounds?: number;
  tool?: string;
  args?: Record<string, unknown>;
  model?: string;
  phase?: string;
  imageUrl?: string;
  imagePlan?: unknown;
  attempt?: number;
  issues?: string[];
  assistantMessage?: unknown;
  usage?: unknown;
  message?: string;
  code?: string;
};

type SendChatMessageResult = {
  userMessage: AgentChatMessage;
  assistantMessage: AgentChatMessage;
  usage: Record<string, unknown>;
};

export const sendChatMessage = async (sessionId: string, payload: {
  content: string;
  attachments?: Array<{ name: string; url?: string; assetId?: string; mimeType?: string; kind?: 'image' | 'file' }>;
  selectedModel?: string;
  reasoningLevel?: string | null;
  webSearchEnabled?: boolean;
  requestMode?: 'chat' | 'image_generation';
  clientRequestId?: string;
}, options?: {
  signal?: AbortSignal;
  onProgress?: (event: ChatProgressEvent) => void;
  stream?: boolean;
}): Promise<SendChatMessageResult> => {
  const clientRequestId = payload.clientRequestId;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const useStream = options?.stream === true;

  if (clientRequestId && options?.onProgress) {
    pollTimer = setInterval(async () => {
      try {
        const data = await request<{ progress: ChatProgressEvent | null }>(
          `/api/chat/progress/${encodeURIComponent(clientRequestId)}`,
        );
        if (data.progress) options.onProgress!(data.progress);
      } catch { /* ignore poll errors */ }
    }, 800);
  }

  try {
    const path = `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`;
    const timeoutMs = payload.requestMode === 'image_generation'
      ? IMAGE_GENERATION_CHAT_TIMEOUT_MS
      : CHAT_MESSAGE_TIMEOUT_MS;
    if (!useStream) {
      return await request<SendChatMessageResult>(path, {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: options?.signal,
        timeoutMs,
        dedupe: false,
      });
    }

    const token = getSessionToken();
    const response = await fetchWithTimeout(path, {
      method: 'POST',
      body: JSON.stringify({ ...payload, stream: true }),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      signal: options?.signal,
      timeoutMs,
      cache: 'no-store' as RequestCache,
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !response.body) {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw classifyError(response.status, data.message || '');
      return data as SendChatMessageResult;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw classifyError(response.status, data.message || '');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rest = '';
    let streamedContent = '';
    let doneMessage: AgentChatMessage | null = null;
    let doneUsage: Record<string, unknown> | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = rest + decoder.decode(value, { stream: true });
      const parsed = parseChatSseChunk(chunk, { withRest: true }) as { events: ChatStreamEvent[]; rest: string };
      rest = parsed.rest;
      for (const event of parsed.events) {
        options?.onProgress?.(event as ChatProgressEvent);
        if (event.type === 'streaming') {
          streamedContent += event.delta || '';
        } else if (event.type === 'done') {
          doneMessage = event.assistantMessage as AgentChatMessage | undefined || null;
          doneUsage = event.usage as Record<string, unknown> | undefined || null;
        } else if (event.type === 'error') {
          throw new ApiError(event.message || '聊天回复失败。', event.code || 'request_failed', 500);
        }
      }
    }

    if (!doneMessage) {
      throw new ApiError('聊天流式响应未返回完成消息', 'stream_incomplete', 500);
    }

    const userMessage: AgentChatMessage = {
      id: String(doneMessage.metadata?.messageIds?.userMessageId || ''),
      sessionId,
      userId: '',
      role: 'user',
      content: payload.content,
      attachments: payload.attachments || [],
      metadata: { clientRequestId },
      createdAt: Date.now(),
    };

    return {
      userMessage,
      assistantMessage: { ...doneMessage, content: doneMessage.content || streamedContent },
      usage: doneUsage || {},
    };
  } finally {
    if (pollTimer !== null) clearInterval(pollTimer);
  }
};

export const fetchAgentUsage = async () => {
  return request<{ rows: AgentUsageRow[] }>('/api/agent-usage');
};

export const fetchAgentUsageSummary = async () => {
  return request<{ summary: { totalCalls: number; successCount: number; failedCount: number; activeUsers: number; totalEstimatedCost: number } }>('/api/agent-usage/summary');
};

export const uploadInternalAsset = async (payload: {
  module: string;
  assetType?: 'source' | 'reference' | 'chat' | 'result' | 'guide';
  fileName: string;
  mimeType: string;
  base64Data: string;
}) => {
  return request<{ fileUrl: string }>('/api/assets/upload', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      fileName: ensureUploadFileName(payload.fileName, payload.mimeType),
    }),
    timeoutMs: 120_000,
  });
};

export const uploadInternalAssetStream = async (payload: {
  module: string;
  assetType?: 'source' | 'reference' | 'chat' | 'result' | 'guide';
  file: File;
  fileName?: string;
  signal?: AbortSignal;
}) => {
  const token = getSessionToken();
  const normalizedFileName = ensureUploadFileName(
    payload.fileName || payload.file.name || 'upload.bin',
    payload.file.type || ''
  );
  const formData = new FormData();
  formData.append('module', payload.module);
  formData.append('assetType', payload.assetType || 'source');
  formData.append('file', payload.file, normalizedFileName);

  const response = await fetchWithTimeout('/api/assets/upload-stream', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
    signal: payload.signal,
    timeoutMs: 120_000,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw classifyError(response.status, data.message || '', data.errorCode || data.code || '');
  }
  return data as { fileUrl: string; assetId?: string };
};

export const deleteInternalAssetByUrl = async (fileUrl: string) => {
  return request<{ ok: boolean }>('/api/assets/by-url', {
    method: 'DELETE',
    body: JSON.stringify({ fileUrl }),
    timeoutMs: 120_000,
    dedupe: false,
  });
};

export const createInternalJob = async (payload: {
  module: string;
  taskType: string;
  provider: string;
  payload: InternalJobPayload;
  priority?: number;
  maxRetries?: number;
}) => {
  return request<{ job: InternalJob }>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const fetchInternalJobs = async (limit = 100) => {
  return request<{ jobs: InternalJob[] }>(`/api/jobs?limit=${encodeURIComponent(String(limit))}`);
};

export const fetchInternalJob = async (jobId: string) => {
  return request<{ job: InternalJob }>(`/api/jobs/${encodeURIComponent(jobId)}`);
};

export const updateInternalJobResult = async (jobId: string, result: Record<string, unknown>) => {
  return request<{ job: InternalJob }>(`/api/jobs/${encodeURIComponent(jobId)}/result`, {
    method: 'PATCH',
    body: JSON.stringify({ result }),
    dedupe: false,
  });
};

export const deleteInternalJob = async (jobId: string) => {
  return request<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    dedupe: false,
  });
};

export const cancelInternalJob = async (jobId: string) => {
  return request<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
};

export const retryInternalJob = async (
  jobId: string,
  options: { confirmNewProviderAttempt?: boolean } = {},
) => {
  return request<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    ...(options.confirmNewProviderAttempt === true
      ? { body: JSON.stringify({ confirmNewProviderAttempt: true }) }
      : {}),
  });
};

export const recoverInternalJob = async (payload: {
  module: string;
  taskType: string;
  provider: string;
  providerTaskId: string;
  payload?: Record<string, unknown>;
  maxRetries?: number;
}) => {
  return request<{ job: InternalJob }>('/api/jobs/recover', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

const isTransientJobPollError = (error: unknown) => {
  if (!(error instanceof ApiError)) return false;
  return error.code === 'network_error'
    || error.code === 'timeout'
    || error.code === 'rate_limited'
    || error.code === 'server_error';
};

export const waitForInternalJob = async (
  jobId: string,
  signal?: AbortSignal,
  intervalMs = 2500,
  maxWaitMs = 0,
  onJobUpdate?: (job: InternalJob) => void,
): Promise<InternalJob> => {
  const deadline = maxWaitMs > 0 ? Date.now() + maxWaitMs : 0;
  let lastPollError: unknown = null;
  while (true) {
    if (signal?.aborted) {
      throw new Error('INTERRUPTED');
    }
    if (deadline > 0 && Date.now() > deadline) {
      if (lastPollError instanceof ApiError) {
        throw new ApiError(lastPollError.message, lastPollError.code, lastPollError.status);
      }
      throw new ApiError('任务等待超时，请稍后在任务列表中查看结果', 'job_timeout', 408);
    }

    try {
      const { job } = await fetchInternalJob(jobId);
      lastPollError = null;
      onJobUpdate?.(job);
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        return job;
      }
    } catch (error) {
      if (!isTransientJobPollError(error)) {
        throw error;
      }
      lastPollError = error;
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        signal?.removeEventListener?.('abort', onAbort);
        resolve();
      }, intervalMs);

      const onAbort = () => {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener?.('abort', onAbort);
        reject(new Error('INTERRUPTED'));
      };

      signal?.addEventListener?.('abort', onAbort);
    });
  }
};

// ── Studio API ──

export const sendStudioTrainingMessage = async (versionId: string, payload: {
  content: string;
  history: Array<{
    role: string;
    content: string;
    attachments?: Array<{ name: string; url?: string; mimeType?: string; kind?: 'image' | 'file' }>;
  }>;
  attachments?: Array<{ name: string; url?: string; mimeType?: string; kind?: 'image' | 'file' }>;
  selectedModel?: string;
  reasoningLevel?: string | null;
  webSearchEnabled?: boolean;
}) => {
  return request<{
    reply: string;
    configDiffs: StudioConfigDiff[];
    updatedVersion?: AgentVersion;
  }>(`/api/studio/training/${encodeURIComponent(versionId)}/message`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 240_000,
    dedupe: false,
  });
};

export const applyStudioTrainingChanges = async (versionId: string, payload: {
  changes: StudioConfigDiff[];
}) => {
  return request<{
    appliedChanges: StudioConfigDiff[];
    updatedVersion: AgentVersion;
  }>(`/api/studio/training/${encodeURIComponent(versionId)}/apply`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
    dedupe: false,
  });
};

export const createStudioTestSession = async (agentId: string, versionId: string) => {
  return request<{ session: AgentChatSession }>('/api/studio/test/sessions', {
    method: 'POST',
    body: JSON.stringify({ agentId, versionId }),
  });
};

export type ChatwootConnectionPayload = {
  baseUrl: string;
  accountId: string;
  inboxId: string;
  apiToken: string;
};

export type ChatwootConversationSummary = {
  id: string;
  status: string;
  inboxId: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  updatedAt: number;
};

export type ChatwootMessageSummary = {
  id: string;
  role: 'customer' | 'agent' | 'system';
  senderName: string;
  content: string;
  createdAt: number;
  private: boolean;
  attachments?: Array<{
    id: string;
    fileType: string;
    url: string;
  }>;
};

export type ChatwootLabelSummary = {
  id: string;
  title: string;
  color: string;
  description: string;
};

export type ChatwootAgentSummary = {
  id: string;
  name: string;
  email: string;
  availability: string;
};

export type ChatwootTeamSummary = {
  id: string;
  name: string;
  description: string;
};

export type ChatwootAssignmentSummary = {
  id: string;
  name: string;
  email: string;
};

export type ChatwootCannedResponseSummary = {
  id: string;
  shortCode: string;
  content: string;
};

export type ChatwootAutomationRuleSummary = {
  id: string;
  name: string;
  eventName: string;
  active: boolean;
};

export type ChatwootContactSummary = {
  id: string;
  name: string;
  email: string;
  phone: string;
  lastActivityAt: number;
  customAttributes?: Record<string, unknown>;
  additionalAttributes?: Record<string, unknown>;
};

export type ChatwootContactNoteSummary = {
  id: string;
  content: string;
  authorName: string;
  createdAt: number;
};

export type ChatwootMacroSummary = {
  id: string;
  name: string;
  visibility: string;
  actions: Array<Record<string, unknown>>;
};

export type ChatwootCampaignSummary = {
  id: string;
  title: string;
  message: string;
  enabled: boolean;
};

export type ChatwootWebhookSummary = {
  id: string;
  name: string;
  url: string;
  subscriptions: string[];
};

export type ChatwootInboxSummary = {
  id: string;
  name: string;
  channelType: string;
  enableAutoAssignment: boolean;
};

export type ChatwootReportSummary = Record<string, unknown>;

export const testChatwootConnection = async (payload: ChatwootConnectionPayload) => {
  return request<{ ok: boolean; inbox: Record<string, unknown> }>('/api/chatwoot/test-connection', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootConversationMessages = async (payload: ChatwootConnectionPayload & { conversationId: string }) => {
  return request<{ messages: ChatwootMessageSummary[] }>('/api/chatwoot/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const sendChatwootConversationMessage = async (payload: ChatwootConnectionPayload & { conversationId: string; content: string }) => {
  return request<{ message: ChatwootMessageSummary }>('/api/chatwoot/send-message', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const sendChatwootConversationAttachment = async (payload: ChatwootConnectionPayload & { conversationId: string; content?: string; file: File; fileName?: string }) => {
  const token = getSessionToken();
  const normalizedFileName = ensureUploadFileName(payload.fileName || payload.file.name || 'attachment.bin', payload.file.type || '');
  const formData = new FormData();
  formData.append('baseUrl', payload.baseUrl);
  formData.append('accountId', payload.accountId);
  formData.append('inboxId', payload.inboxId);
  formData.append('apiToken', payload.apiToken);
  formData.append('conversationId', payload.conversationId);
  formData.append('content', payload.content || '');
  formData.append('fileName', normalizedFileName);
  formData.append('file', payload.file, normalizedFileName);

  const response = await fetchWithTimeout('/api/chatwoot/send-attachment', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
    timeoutMs: 120_000,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw classifyError(response.status, data.message || '');
  }
  return data as { message: ChatwootMessageSummary };
};

export const fetchChatwootConversations = async (payload: ChatwootConnectionPayload) => {
  return request<{ conversations: ChatwootConversationSummary[] }>('/api/chatwoot/conversations', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const updateChatwootConversationStatus = async (payload: ChatwootConnectionPayload & { conversationId: string; status: 'open' | 'pending' | 'resolved' }) => {
  return request<{ conversation: { id: string; status: string } }>('/api/chatwoot/conversation-status', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const createChatwootInternalNote = async (payload: ChatwootConnectionPayload & { conversationId: string; content: string }) => {
  return request<{ message: ChatwootMessageSummary }>('/api/chatwoot/internal-note', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootLabels = async (payload: ChatwootConnectionPayload) => {
  return request<{ labels: ChatwootLabelSummary[] }>('/api/chatwoot/labels', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const updateChatwootConversationLabels = async (payload: ChatwootConnectionPayload & { conversationId: string; labels: string[] }) => {
  return request<{ labels: string[] }>('/api/chatwoot/conversation-labels', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootAssignableAgents = async (payload: ChatwootConnectionPayload) => {
  return request<{ agents: ChatwootAgentSummary[] }>('/api/chatwoot/assignable-agents', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootTeams = async (payload: ChatwootConnectionPayload) => {
  return request<{ teams: ChatwootTeamSummary[] }>('/api/chatwoot/teams', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const assignChatwootConversation = async (payload: ChatwootConnectionPayload & { conversationId: string; assigneeId?: string; teamId?: string }) => {
  return request<{ assignment: ChatwootAssignmentSummary }>('/api/chatwoot/assign-conversation', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootCannedResponses = async (payload: ChatwootConnectionPayload) => {
  return request<{ cannedResponses: ChatwootCannedResponseSummary[] }>('/api/chatwoot/canned-responses', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const createChatwootCannedResponse = async (payload: ChatwootConnectionPayload & { shortCode: string; content: string }) => {
  return request<{ cannedResponse: ChatwootCannedResponseSummary }>('/api/chatwoot/canned-response', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootAutomationRules = async (payload: ChatwootConnectionPayload) => {
  return request<{ automationRules: ChatwootAutomationRuleSummary[] }>('/api/chatwoot/automation-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootContacts = async (payload: ChatwootConnectionPayload) => {
  return request<{ contacts: ChatwootContactSummary[] }>('/api/chatwoot/contacts', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootContactNotes = async (payload: ChatwootConnectionPayload & { contactId: string }) => {
  return request<{ notes: ChatwootContactNoteSummary[] }>('/api/chatwoot/contact-notes', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const createChatwootContactNote = async (payload: ChatwootConnectionPayload & { contactId: string; content: string }) => {
  return request<{ note: ChatwootContactNoteSummary }>('/api/chatwoot/contact-note', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const updateChatwootContact = async (payload: ChatwootConnectionPayload & {
  contactId: string;
  name?: string;
  email?: string;
  phone?: string;
  customAttributes?: Record<string, unknown>;
  additionalAttributes?: Record<string, unknown>;
}) => {
  return request<{ contact: ChatwootContactSummary }>('/api/chatwoot/update-contact', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootContactConversations = async (payload: ChatwootConnectionPayload & { contactId: string }) => {
  return request<{ conversations: ChatwootConversationSummary[] }>('/api/chatwoot/contact-conversations', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const deleteChatwootConversationMessage = async (payload: ChatwootConnectionPayload & { conversationId: string; messageId: string }) => {
  return request<{ ok: boolean }>('/api/chatwoot/delete-message', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const retryChatwootConversationMessage = async (payload: ChatwootConnectionPayload & { conversationId: string; messageId: string }) => {
  return request<{ ok: boolean }>('/api/chatwoot/retry-message', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const translateChatwootConversationMessage = async (payload: ChatwootConnectionPayload & { conversationId: string; messageId: string; targetLanguage: string }) => {
  return request<{ translation: { content: string } }>('/api/chatwoot/translate-message', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootMacros = async (payload: ChatwootConnectionPayload) => {
  return request<{ macros: ChatwootMacroSummary[] }>('/api/chatwoot/macros', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const createChatwootMacro = async (payload: ChatwootConnectionPayload & { name: string; visibility?: string; actions: Array<{ actionName: string; actionParams: string[] }> }) => {
  return request<{ macro: ChatwootMacroSummary }>('/api/chatwoot/macro', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const executeChatwootMacro = async (payload: ChatwootConnectionPayload & { macroId: string; conversationIds: string[] }) => {
  return request<{ ok: boolean }>('/api/chatwoot/execute-macro', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootCampaigns = async (payload: ChatwootConnectionPayload) => {
  return request<{ campaigns: ChatwootCampaignSummary[] }>('/api/chatwoot/campaigns', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const createChatwootCampaign = async (payload: ChatwootConnectionPayload & {
  title: string;
  message: string;
  inboxId?: string;
  enabled?: boolean;
}) => {
  return request<{ campaign: ChatwootCampaignSummary }>('/api/chatwoot/campaign', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootWebhooks = async (payload: ChatwootConnectionPayload) => {
  return request<{ webhooks: ChatwootWebhookSummary[] }>('/api/chatwoot/webhooks', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const createChatwootWebhook = async (payload: ChatwootConnectionPayload & { name: string; url: string; subscriptions: string[] }) => {
  return request<{ webhook: ChatwootWebhookSummary }>('/api/chatwoot/webhook', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const updateChatwootWebhook = async (payload: ChatwootConnectionPayload & { webhookId: string; name: string; url: string; subscriptions: string[] }) => {
  return request<{ webhook: ChatwootWebhookSummary }>('/api/chatwoot/update-webhook', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootInboxes = async (payload: ChatwootConnectionPayload) => {
  return request<{ inboxes: ChatwootInboxSummary[] }>('/api/chatwoot/inboxes', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const updateChatwootInbox = async (payload: ChatwootConnectionPayload & { targetInboxId?: string; name?: string; enableAutoAssignment?: boolean }) => {
  return request<{ inbox: ChatwootInboxSummary }>('/api/chatwoot/update-inbox', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export const fetchChatwootReportsSummary = async (payload: ChatwootConnectionPayload & { since?: number; until?: number }) => {
  return request<{ summary: ChatwootReportSummary }>('/api/chatwoot/reports-summary', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
    dedupe: false,
  });
};

export type VirtualModelAsset = {
  assetId: string;
  url?: string;
  publicUrl?: string;
  previewAssetId?: string;
  previewUrl?: string;
  slot: string;
  position: number;
  isPrimary: boolean;
};

export type VirtualModelSummary = {
  id: string;
  code: string;
  name: string;
  tags: string[];
  status: 'draft' | 'published' | 'unpublished' | 'deleted';
  currentVersionId: string | null;
  coverUrl: string;
  updatedAt?: number;
  version?: {
    id: string;
    versionNumber: number;
    status: string;
    publishedAt: number | null;
    thumbnailUrl?: string;
  };
};

type VirtualModelDraftPayload = { code: string; name: string; tags?: string[] };
type VirtualModelVersionPayload = { identityProfile: Record<string, unknown> };
type VirtualModelAssetsPayload = {
  assets: Array<{
    slot: string;
    assetId: string;
    publicUrl?: string;
    previewAssetId?: string;
    previewUrl?: string;
    position?: number;
    isPrimary?: boolean;
    validationStatus?: 'pending' | 'passed' | 'failed';
  }>;
};

export const fetchVirtualModels = async () => request<{ models: VirtualModelSummary[] }>('/api/virtual-models');

export type AdminVirtualModel = Omit<VirtualModelSummary, 'version'> & { createdAt: number; updatedAt: number; version: ({ id: string; versionNumber: number; status: string; publishedAt: number | null; identityProfile: Record<string, unknown>; assets: VirtualModelAsset[] }) | null };

export const fetchAdminVirtualModels = async (status: 'draft' | 'published' | 'unpublished' | 'all' = 'all') => request<{ models: AdminVirtualModel[] }>(`/api/admin/virtual-models?status=${encodeURIComponent(status)}`);

export const fetchVirtualModel = async (virtualModelId: string) => {
  return request<{ model: VirtualModelSummary }>(`/api/virtual-models/${encodeURIComponent(virtualModelId)}`);
};

export const validateVirtualModelLibrarySelection = async (virtualModelId: string, virtualModelVersionId: string) => {
  const response = await request<{ ok: boolean }>('/api/virtual-models/validate-selection', {
    method: 'POST',
    body: JSON.stringify({ virtualModelId, virtualModelVersionId }),
  });
  if (response.ok !== true) throw new Error('当前公共模特选择已失效，请重新选择。');
  return response;
};

export const createVirtualModel = async (payload: VirtualModelDraftPayload) => {
  return request<{ model: VirtualModelSummary }>('/api/admin/virtual-models', { method: 'POST', body: JSON.stringify(payload) });
};

export const updateVirtualModel = async (virtualModelId: string, payload: Partial<VirtualModelDraftPayload>) => {
  return request<{ model: VirtualModelSummary }>(`/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
};

export const deleteVirtualModel = async (virtualModelId: string) => {
  return request<{ result: { ok: boolean } }>(`/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}`, { method: 'DELETE' });
};

export const createVirtualModelVersion = async (virtualModelId: string, payload: VirtualModelVersionPayload) => {
  return request<{ version: { id: string; virtualModelId: string; versionNumber: number; status: string } }>(`/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}/versions`, { method: 'POST', body: JSON.stringify(payload) });
};

export const updateVirtualModelVersion = async (virtualModelId: string, virtualModelVersionId: string, payload: VirtualModelVersionPayload) => {
  return request<{ version: { id: string; virtualModelId: string; versionNumber: number; status: string; identityProfile: Record<string, unknown> } }>(`/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}/versions/${encodeURIComponent(virtualModelVersionId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
};

export const replaceVirtualModelVersionAssets = async (virtualModelId: string, virtualModelVersionId: string, payload: VirtualModelAssetsPayload) => {
  return request<{ assets: VirtualModelAsset[] }>(`/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}/versions/${encodeURIComponent(virtualModelVersionId)}/assets`, { method: 'PUT', body: JSON.stringify(payload) });
};

export const publishVirtualModel = async (virtualModelId: string, virtualModelVersionId: string) => {
  return request<{ result: { ok: boolean; publishedAt?: number } }>(`/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}/publish`, { method: 'POST', body: JSON.stringify({ virtualModelVersionId }) });
};

export const unpublishVirtualModel = async (virtualModelId: string) => {
  return request<{ result: { ok: boolean } }>(`/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}/unpublish`, { method: 'POST', body: JSON.stringify({}) });
};

export type VirtualModelGenerationPoseTask = {
  poseId: string;
  slot: string;
  label: string;
  status: 'pending' | 'queued' | 'running' | 'retry_waiting' | 'succeeded' | 'persisting' | 'saved' | 'failed' | 'cancelled';
  jobId?: string;
  resultUrl?: string;
  temporaryResultUrl?: string;
  referenceStatus?: 'generated' | 'validating' | 'stabilizing' | 'baseline_ready' | 'reference_failed';
  managedReferenceAsset?: { assetId: string; publicUrl: string };
  stableReferenceUrl?: string;
  referenceErrorCode?: string;
  referenceErrorMessage?: string;
  errorCode?: string;
  errorMessage?: string;
  baselineRevision?: number;
};

export type VirtualModelGenerationBatch = {
  id: string;
  virtualModelId: string;
  virtualModelVersionId: string;
  clientSubmissionKey: string;
  sourceAssetIds: string[];
  primarySourceAssetId: string;
  status: string;
  poseTasks: VirtualModelGenerationPoseTask[];
  baselineRevision: number;
  derivedRegenerationRequired: boolean;
  finalizedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export const createVirtualModelGenerationBatch = async (payload: {
  virtualModelId: string;
  virtualModelVersionId: string;
  sourceAssetIds: string[];
  primarySourceAssetId: string;
  clientSubmissionKey: string;
}) => request<{ batch: VirtualModelGenerationBatch }>('/api/admin/virtual-model-generation-batches', {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const findVirtualModelGenerationBatch = async (
  virtualModelId: string,
  virtualModelVersionId: string,
) => {
  const query = new URLSearchParams({ virtualModelId, virtualModelVersionId });
  return request<{ batch: VirtualModelGenerationBatch | null }>(`/api/admin/virtual-model-generation-batches?${query.toString()}`);
};

export const fetchVirtualModelGenerationBatch = async (batchId: string) => (
  request<{ batch: VirtualModelGenerationBatch }>(`/api/admin/virtual-model-generation-batches/${encodeURIComponent(batchId)}`)
);

export const retryVirtualModelGenerationPose = async (batchId: string, poseId: string) => (
  request<{ batch: VirtualModelGenerationBatch }>(`/api/admin/virtual-model-generation-batches/${encodeURIComponent(batchId)}/poses/${encodeURIComponent(poseId)}/retry`, { method: 'POST', body: JSON.stringify({}) })
);

export const regenerateVirtualModelDerivedPoses = async (batchId: string) => (
  request<{ batch: VirtualModelGenerationBatch }>(`/api/admin/virtual-model-generation-batches/${encodeURIComponent(batchId)}/regenerate-derived`, { method: 'POST', body: JSON.stringify({}) })
);

export const cancelVirtualModelGenerationBatch = async (batchId: string) => (
  request<{ batch: VirtualModelGenerationBatch }>(`/api/admin/virtual-model-generation-batches/${encodeURIComponent(batchId)}/cancel`, { method: 'POST', body: JSON.stringify({}) })
);

export const finalizeVirtualModelGenerationBatch = async (batchId: string) => (
  request<{ result: { virtualModelId: string; virtualModelVersionId: string; assets: VirtualModelAsset[] } }>(`/api/admin/virtual-model-generation-batches/${encodeURIComponent(batchId)}/finalize`, { method: 'POST', body: JSON.stringify({}) })
);
