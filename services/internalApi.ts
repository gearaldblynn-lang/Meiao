import { AuthUser, InternalJob, InternalLogEntry, SystemPublicConfig } from '../types';
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

export const storeCurrentUserContext = (user: Pick<AuthUser, 'id' | 'username' | 'role'>) => {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
};

export const getCurrentUserContext = (): Pick<AuthUser, 'id' | 'username' | 'role'> | null => {
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

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (!headers['Content-Type'] && init?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    ...init,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || '请求失败');
  }
  return data as T;
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
}>) => {
  const params = new URLSearchParams();
  if (filters?.module && filters.module !== 'all') params.set('module', filters.module);
  if (filters?.userId && filters.userId !== 'all') params.set('userId', filters.userId);
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters?.startAt) params.set('startAt', String(filters.startAt));
  if (filters?.endAt) params.set('endAt', String(filters.endAt));
  const query = params.toString();
  return request<{ logs: InternalLogEntry[] }>(`/api/logs${query ? `?${query}` : ''}`);
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

export const uploadInternalAsset = async (payload: {
  module: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}) => {
  return request<{ fileUrl: string }>('/api/assets/upload', {
    method: 'POST',
    body: JSON.stringify(payload),
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

  const response = await fetch('/api/assets/upload-stream', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || '请求失败');
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
  intervalMs = 2500
): Promise<InternalJob> => {
  while (true) {
    if (signal?.aborted) {
      throw new Error('INTERRUPTED');
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
