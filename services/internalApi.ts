import {
  AgentChatMessage,
  AgentChatSession,
  AgentKnowledgeDocumentBinding,
  AgentSummary,
  AgentUsageRow,
  AgentVersion,
  AuthUser,
  InternalJob,
  InternalLogEntry,
  KnowledgeBaseSummary,
  KnowledgeDocumentSummary,
  StudioConfigDiff,
  SystemPublicConfig,
  VideoDiagnosisAccessMode,
  VideoDiagnosisAnalysisItem,
  VideoDiagnosisPlatform,
  VideoDiagnosisProbeResult,
  VideoDiagnosisReportResult,
} from '../types';
import { PersistedAppState } from '../utils/appState';

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

export const storeSessionToken = (token: string) => {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
};

export const clearSessionToken = () => {
  localStorage.removeItem(SESSION_TOKEN_KEY);
};

export const storeCurrentUserContext = (user: Pick<AuthUser, 'id' | 'username' | 'role' | 'avatarUrl' | 'avatarPreset'>) => {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
};

export const getCurrentUserContext = (): Pick<AuthUser, 'id' | 'username' | 'role' | 'avatarUrl' | 'avatarPreset'> | null => {
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

const classifyError = (status: number, serverMessage: string): ApiError => {
  if (status === 0)
    return new ApiError('网络连接失败，请检查网络后重试', 'network_error', 0);
  if (status === 408 || serverMessage.includes('timeout'))
    return new ApiError('请求超时，请稍后重试', 'timeout', status);
  if (status === 429)
    return new ApiError('请求过于频繁，请稍后再试', 'rate_limited', status);
  if (status === 401)
    return new ApiError('登录已过期，请重新登录', 'unauthorized', status);
  if (status === 403)
    return new ApiError('没有权限执行此操作', 'forbidden', status);
  if (status >= 500)
    return new ApiError('服务暂时不可用，请稍后再试', 'server_error', status);
  return new ApiError(
    serverMessage || '请求失败',
    'request_failed',
    status,
  );
};

// --------------- 超时控制 ---------------
const DEFAULT_TIMEOUT_MS = 30_000;

const fetchWithTimeout = (
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> => {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init;
  const controller = new AbortController();
  const existingSignal = fetchInit.signal;
  if (existingSignal?.aborted) {
    controller.abort(existingSignal.reason);
  } else {
    existingSignal?.addEventListener('abort', () =>
      controller.abort(existingSignal.reason),
    );
  }
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  return fetch(url, { ...fetchInit, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
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

const buildDedupeKey = (path: string, method: string, body?: BodyInit | null) => {
  if (method === 'GET') return `GET:${path}`;
  const bodyStr = typeof body === 'string' ? body : '';
  return `${method}:${path}:${bodyStr}`;
};

// --------------- 核心 request ---------------
interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  dedupe?: boolean;
}

const request = async <T>(
  path: string,
  init?: RequestOptions,
): Promise<T> => {
  const method = (init?.method || 'GET').toUpperCase();
  const dedupe = init?.dedupe !== false;
  const dedupeKey = dedupe ? buildDedupeKey(path, method, init?.body) : '';

  if (dedupe && dedupeKey && inflightRequests.has(dedupeKey)) {
    return inflightRequests.get(dedupeKey) as Promise<T>;
  }

  const execute = async (): Promise<T> => {
    const token = getSessionToken();
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (!headers['Content-Type'] && init?.body) {
      headers['Content-Type'] = 'application/json';
    }

    let lastError: unknown;
    const maxAttempts = method === 'GET' ? MAX_GET_RETRIES + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) await wait(500 * attempt);
        const response = await fetchWithTimeout(path, {
          ...init,
          cache: 'no-store' as RequestCache,
          headers,
          timeoutMs: init?.timeoutMs,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const err = classifyError(response.status, data.message || '');
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
          if (init?.signal?.aborted) throw error;
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
    const response = await fetch('/api/health');
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

export const saveRemoteAppState = async (state: PersistedAppState) => {
  return request<{ ok: boolean }>('/api/state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
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
    }>;
  }>(`/api/stats/usage${query ? `?${query}` : ''}`);
};

export const backfillUsageStats = async () => {
  return request<{ ok: boolean; upserted: number }>('/api/stats/backfill', {
    method: 'POST',
  });
};

export const fetchSystemConfig = async () => {
  return request<{ config: SystemPublicConfig }>('/api/system/config');
};

export const updateSystemConfig = async (payload: {
  analysisModel?: string;
}) => {
  return request<{ config: SystemPublicConfig }>('/api/system/config', {
    method: 'PATCH',
    body: JSON.stringify(payload),
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

export const fetchChatMessages = async (sessionId: string) => {
  return request<{ messages: AgentChatMessage[] }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
};

export type ChatProgressEvent = {
  stage: 'thinking' | 'retrieved';
  round: number;
  queries?: string[];
  chunkCount?: number;
  docTitles?: string[];
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
}) => {
  const clientRequestId = payload.clientRequestId;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

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
    return await request<{
      userMessage: AgentChatMessage;
      assistantMessage: AgentChatMessage;
      usage: Record<string, unknown>;
    }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: options?.signal,
      timeoutMs: payload.requestMode === 'image_generation' ? 300_000 : 240_000,
      dedupe: false,
    });
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
  fileName: string;
  mimeType: string;
  base64Data: string;
}) => {
  return request<{ fileUrl: string }>('/api/assets/upload', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 120_000,
  });
};

export const uploadInternalAssetStream = async (payload: {
  module: string;
  file: File;
  fileName?: string;
}) => {
  const token = getSessionToken();
  const formData = new FormData();
  formData.append('module', payload.module);
  formData.append('file', payload.file, payload.fileName || payload.file.name || 'upload.bin');

  const response = await fetchWithTimeout('/api/assets/upload-stream', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
    timeoutMs: 120_000,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw classifyError(response.status, data.message || '');
  }
  return data as { fileUrl: string };
};

export const createInternalJob = async (payload: {
  module: string;
  taskType: string;
  provider: string;
  payload: Record<string, unknown>;
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

export const cancelInternalJob = async (jobId: string) => {
  return request<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
};

export const retryInternalJob = async (jobId: string) => {
  return request<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
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

export const waitForInternalJob = async (
  jobId: string,
  signal?: AbortSignal,
  intervalMs = 2500,
  maxWaitMs = 0,
): Promise<InternalJob> => {
  const deadline = maxWaitMs > 0 ? Date.now() + maxWaitMs : 0;
  while (true) {
    if (signal?.aborted) {
      throw new Error('INTERRUPTED');
    }
    if (deadline > 0 && Date.now() > deadline) {
      throw new ApiError('任务等待超时，请稍后在任务列表中查看结果', 'job_timeout', 408);
    }

    const { job } = await fetchInternalJob(jobId);
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
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
