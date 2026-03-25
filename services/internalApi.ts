import { AuthUser } from '../types';
import { PersistedAppState } from '../utils/appState';

const SESSION_TOKEN_KEY = 'MEIAO_INTERNAL_SESSION_TOKEN';

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

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = getSessionToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
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
}) => {
  return request<{ user: AuthUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};
