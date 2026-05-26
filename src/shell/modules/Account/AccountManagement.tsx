import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Download,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import type { AuthUser, InternalLogEntry } from '../../../types';
import {
  backfillUsageStats,
  createInternalUser,
  deleteInternalUser,
  fetchInternalLogMeta,
  fetchInternalLogs,
  fetchInternalUsers,
  fetchUsageStats,
  updateInternalUser,
} from '../../../services/internalApi';
import { ACTION_LABELS, MODULE_LABELS, STATUS_LABELS } from '../../../services/loggingService';
import { PopoverSelect } from '../../../components/ui/workspacePrimitives';
import { buildLogCsv, deriveLogFailureReason, shouldRefreshCurrentUser } from './accountManagementUtils.mjs';

interface Props {
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onCurrentUserChange?: (user: AuthUser) => void;
  onLogout?: () => void;
}

type TabId = 'users' | 'logs' | 'stats';
type UsageRow = {
  statDate: string;
  userId: string;
  username: string;
  displayName: string;
  module: string;
  successCount: number;
  failedCount: number;
  interruptedCount: number;
  creditsConsumed?: number;
};
type ConfirmState = { title: string; detail: string; action: () => Promise<void> } | null;

const PAGE_SIZE = 10;
const USERS_PAGE_SIZE = 12;
const isMissingAccountError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'status' in error
  && Number((error as { status?: number }).status) === 404
);

const formatTime = (value?: number | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const normalizeFeaturePermissions = (permissions?: AuthUser['featurePermissions']) => ({
  videoGeneration: Boolean(permissions?.videoGeneration),
});

const canUseVideoGeneration = (user?: AuthUser | null) =>
  user?.role === 'admin' || normalizeFeaturePermissions(user?.featurePermissions).videoGeneration;

const formatVideoGenerationAccess = (user?: AuthUser | null) => {
  if (user?.role === 'admin') return '管理员默认开放';
  return canUseVideoGeneration(user) ? '短视频生成已开放' : '短视频生成未开放';
};

const SelectField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
}> = ({ value, onChange, options, label }) => (
  <label className="min-w-[150px] flex-1">
    <span className="ml-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
    <PopoverSelect
      value={value}
      onChange={onChange}
      options={options}
      className="mt-1"
      buttonClassName="h-10 rounded-2xl px-3 text-[12px] font-medium"
    />
  </label>
);

const TextField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  type?: string;
}> = ({ value, onChange, label, placeholder, type = 'text' }) => (
  <label>
    <span className="ml-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
    <input
      value={value}
      type={type}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 h-10 w-full rounded-2xl border bg-transparent px-3 text-[12px] font-medium outline-none"
      style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
    />
  </label>
);

const AccountManagement: React.FC<Props> = ({ currentUser = null, internalMode = false, onCurrentUserChange, onLogout }) => {
  const isAdmin = Boolean(internalMode && currentUser?.role === 'admin');
  const canManageAccounts = isAdmin;
  const canViewStats = Boolean(currentUser);
  const [tab, setTab] = useState<TabId>('users');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [usersPage, setUsersPage] = useState(1);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [createForm, setCreateForm] = useState({ username: '', displayName: '', password: '', role: 'staff' as 'admin' | 'staff', jobConcurrency: '5', videoGeneration: false });
  const [expandedUserId, setExpandedUserId] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');

  const [logs, setLogs] = useState<InternalLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsQueried, setLogsQueried] = useState(false);
  const [logMeta, setLogMeta] = useState<{ modules: string[]; users: Array<{ id: string; label: string }> }>({ modules: [], users: [] });
  const [logFilters, setLogFilters] = useState({ module: 'all', userId: 'all', status: 'all', startAt: '', endAt: '' });

  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageFilters, setUsageFilters] = useState({ startDate: '', endDate: todayInputDate(), userId: 'all', module: 'all' });
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const usersFetchRequestedRef = useRef(false);
  const logMetaFetchRequestedRef = useRef(false);

  const loadUsers = async () => {
    if (!canManageAccounts) return;
    setUsersLoading(true);
    setError('');
    try {
      const result = await fetchInternalUsers();
      setUsers(result.users);
    } catch (err: any) {
      setError(err.message || '账号列表读取失败');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (!canManageAccounts) return;
    if (tab !== 'users') {
      usersFetchRequestedRef.current = false;
      return;
    }
    if (usersFetchRequestedRef.current) return;
    usersFetchRequestedRef.current = true;
    void loadUsers();
  }, [canManageAccounts, tab]);

  useEffect(() => {
    if (!canManageAccounts) return;
    if (tab !== 'logs' && tab !== 'stats') {
      logMetaFetchRequestedRef.current = false;
      return;
    }
    if (logMetaFetchRequestedRef.current) return;
    logMetaFetchRequestedRef.current = true;
    void fetchInternalLogMeta().then(setLogMeta).catch(() => null);
  }, [canManageAccounts, tab]);

  const moduleOptions = useMemo(() => [
    { value: 'all', label: '全部功能' },
    ...Array.from(new Set(['agent_center', 'one_click', 'translation', 'buyer_show', 'retouch', 'video', 'xhs_cover', 'account', ...logMeta.modules]))
      .map((id) => ({ value: id, label: MODULE_LABELS[id] || id })),
  ], [logMeta.modules]);
  const userOptions = useMemo(() => [
    { value: 'all', label: '全部人员' },
    ...logMeta.users.map((user) => ({ value: user.id, label: user.label })),
  ], [logMeta.users]);
  const statusOptions = [
    { value: 'all', label: '全部结果' },
    { value: 'started', label: '进行中' },
    { value: 'success', label: '成功' },
    { value: 'failed', label: '失败' },
    { value: 'interrupted', label: '中断' },
  ];

  const roleLabel = currentUser?.role === 'admin' ? '管理员' : '员工';
  const logsPageCount = Math.max(1, Math.ceil(logsTotal / PAGE_SIZE));
  const filteredUsers = useMemo(() => {
    const keyword = userSearch.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((user) => [
      user.username,
      user.displayName,
      user.role === 'admin' ? '管理员' : '员工',
      user.status === 'active' ? '启用' : '禁用',
      formatVideoGenerationAccess(user),
    ].some((value) => String(value || '').toLowerCase().includes(keyword)));
  }, [userSearch, users]);
  const usersPageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  const pagedUsers = filteredUsers.slice((usersPage - 1) * USERS_PAGE_SIZE, usersPage * USERS_PAGE_SIZE);
  const usageSummary = usageRows.reduce((acc, row) => {
    acc.success += row.successCount;
    acc.failed += row.failedCount;
    acc.interrupted += row.interruptedCount;
    acc.credits += Number(row.creditsConsumed || 0);
    return acc;
  }, { success: 0, failed: 0, interrupted: 0, credits: 0 });
  const usageTotal = usageSummary.success + usageSummary.failed;
  const usageByModule = Object.values(usageRows.reduce<Record<string, { module: string; total: number; failed: number; creditsConsumed: number }>>((acc, row) => {
    if (!acc[row.module]) acc[row.module] = { module: row.module, total: 0, failed: 0, creditsConsumed: 0 };
    acc[row.module].total += row.successCount + row.failedCount;
    acc[row.module].failed += row.failedCount;
    acc[row.module].creditsConsumed += Number(row.creditsConsumed || 0);
    return acc;
  }, {})).sort((a, b) => b.total - a.total);

  useEffect(() => {
    setUsersPage(1);
  }, [userSearch, users.length]);

  useEffect(() => {
    if (usersPage > usersPageCount) setUsersPage(usersPageCount);
  }, [usersPage, usersPageCount]);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await createInternalUser({
        username: createForm.username.trim(),
        displayName: createForm.displayName.trim(),
        password: createForm.password,
        role: createForm.role,
        jobConcurrency: Math.max(1, Number(createForm.jobConcurrency || 1)),
        featurePermissions: normalizeFeaturePermissions({ videoGeneration: createForm.videoGeneration }),
      });
      setCreateForm({ username: '', displayName: '', password: '', role: 'staff', jobConcurrency: '5', videoGeneration: false });
      setMessage('新账号已创建');
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '创建账号失败');
    }
  };

  const updateUser = async (user: AuthUser, payload: Partial<Pick<AuthUser, 'role' | 'status' | 'jobConcurrency' | 'featurePermissions'> & { password: string }>) => {
    setError('');
    setMessage('');
    try {
      const result = await updateInternalUser(user.id, payload);
      if (shouldRefreshCurrentUser(currentUser?.id, user.id)) onCurrentUserChange?.(result.user);
      setMessage(`账号 ${user.username} 已更新`);
      setPasswordDraft('');
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '更新账号失败');
    }
  };

  const deleteUser = (user: AuthUser) => {
    setConfirmState({
      title: '删除账号',
      detail: `确认删除账号 ${user.username}？该账号的工作台状态、任务、日志、上传资产和智能体数据会被清理，用量统计会保留。`,
      action: async () => {
        setError('');
        setMessage('');
        try {
          await deleteInternalUser(user.id);
          setMessage(`账号 ${user.username} 已删除，统计数据已保留`);
          if (expandedUserId === user.id) setExpandedUserId('');
          await loadUsers();
        } catch (err: any) {
          if (isMissingAccountError(err)) {
            setUsers((items) => items.filter((item) => item.id !== user.id));
            if (expandedUserId === user.id) setExpandedUserId('');
            setMessage(`账号 ${user.username} 已不在后端列表，已从当前页面移除`);
            void loadUsers();
            return;
          }
          setError(err.message || '删除账号失败');
        }
      },
    });
  };

  const runConfirmed = async () => {
    const pending = confirmState;
    if (!pending) return;
    setConfirmState(null);
    await pending.action();
  };

  const queryLogs = async (page = 1) => {
    if (!isAdmin) return;
    setLogsLoading(true);
    setError('');
    setMessage('');
    try {
      const startAt = logFilters.startAt ? new Date(logFilters.startAt).getTime() : undefined;
      const endAt = logFilters.endAt ? new Date(logFilters.endAt).getTime() + 59_999 : undefined;
      const result = await fetchInternalLogs({ ...logFilters, startAt, endAt, page, pageSize: PAGE_SIZE });
      setLogs(result.logs);
      setLogsTotal(result.total);
      setLogsPage(result.page);
      setLogsQueried(true);
    } catch (err: any) {
      setError(err.message || '日志读取失败');
    } finally {
      setLogsLoading(false);
    }
  };

  const exportLogs = async () => {
    if (!logsTotal) return;
    setError('');
    setMessage('');
    try {
      const startAt = logFilters.startAt ? new Date(logFilters.startAt).getTime() : undefined;
      const endAt = logFilters.endAt ? new Date(logFilters.endAt).getTime() + 59_999 : undefined;
      const totalToExport = logsTotal;
      const exportPageSize = 200;
      const exportedLogs: InternalLogEntry[] = [];
      let exportPage = 1;

      while (exportedLogs.length < totalToExport) {
        const result = await fetchInternalLogs({
          ...logFilters,
          startAt,
          endAt,
          page: exportPage,
          pageSize: exportPageSize,
        });
        exportedLogs.push(...result.logs);
        if (result.logs.length === 0 || exportedLogs.length >= result.total) break;
        exportPage += 1;
      }

      const blob = new Blob([`\uFEFF${buildLogCsv(exportedLogs)}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `meiao-logs-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage(`已导出 ${exportedLogs.length} 条日志`);
    } catch (err: any) {
      setError(err.message || '导出日志失败');
    }
  };

  const backfillUsageNow = async () => {
    setUsageLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await backfillUsageStats();
      setMessage(`补录完成：${result.upserted} 条`);
      await queryUsage();
    } catch (err: any) {
      setError(err.message || '补录失败');
    } finally {
      setUsageLoading(false);
    }
  };

  const queryUsage = async () => {
    setUsageLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await fetchUsageStats(usageFilters);
      setUsageRows(result.rows);
      setMessage(`查询到 ${result.rows.length} 条统计记录`);
    } catch (err: any) {
      setError(err.message || '查询统计失败');
    } finally {
      setUsageLoading(false);
    }
  };

  const backfillUsage = async () => {
    setConfirmState({
      title: '补录用量统计',
      detail: '确认补录历史用量统计？系统会根据后端日志重新写入统计记录。',
      action: backfillUsageNow,
    });
  };

  return (
    <div className="workspace-shell">
      <div className="workspace-content">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>账号管理</h2>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>账号、运行日志、使用统计都来自共享 3100 后端</p>
        </div>
        <div className="flex items-center">
          <div className="flex items-center gap-3 rounded-3xl border px-4 py-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Shield size={18} />
            </div>
            <div className="min-w-[180px]">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{currentUser?.displayName || currentUser?.username || '未登录'}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{roleLabel} · 并发 {currentUser?.jobConcurrency ?? '-'} · {formatVideoGenerationAccess(currentUser)}</p>
            </div>
            {onLogout ? (
              <button
                type="button"
                onClick={onLogout}
                title="退出登录"
                className="ml-1 flex h-9 items-center gap-1.5 border-l pl-3 pr-1 text-[12px] font-semibold transition hover:opacity-75"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--error)' }}
              >
                <LogOut size={14} />
                <span>退出登录</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-3xl border p-1.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        {[
          { id: 'users' as const, label: '账号', icon: <Users size={14} /> },
          ...(canManageAccounts ? [{ id: 'logs' as const, label: '日志', icon: <Search size={14} /> }] : []),
          { id: 'stats' as const, label: '统计', icon: <BarChart3 size={14} /> },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className="flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[12px] font-medium"
            style={{ background: tab === item.id ? 'var(--accent-soft)' : 'transparent', color: tab === item.id ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-2xl border px-4 py-3 text-[13px] font-medium" style={{ borderColor: 'rgba(239,68,68,0.22)', background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}>{error}</div>}
      {message && <div className="mb-4 rounded-2xl border px-4 py-3 text-[13px] font-medium" style={{ borderColor: 'rgba(34,197,94,0.22)', background: 'rgba(34,197,94,0.08)', color: 'var(--success)' }}>{message}</div>}

      {!canManageAccounts && tab === 'users' && (
        <div className="rounded-3xl border p-8 text-center" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
          <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{currentUser?.displayName || currentUser?.username || '当前账号'}</p>
          <p className="mt-2 text-[13px]">员工账号 · 并发 {currentUser?.jobConcurrency ?? '-'}</p>
          <p className="mt-1 text-[12px]">{formatVideoGenerationAccess(currentUser)}</p>
          <p className="mt-1 text-[12px]">账号资料只读，如需调整请联系管理员。</p>
        </div>
      )}

      {canManageAccounts && tab === 'users' && (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <form onSubmit={createUser} className="rounded-3xl border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center gap-2">
              <Plus size={15} style={{ color: 'var(--accent)' }} />
              <span className="section-title mb-0">新建账号</span>
            </div>
            <div className="space-y-3">
              <TextField label="登录用户名" value={createForm.username} onChange={(username) => setCreateForm({ ...createForm, username })} placeholder="xiaoli" />
              <TextField label="显示名称" value={createForm.displayName} onChange={(displayName) => setCreateForm({ ...createForm, displayName })} placeholder="小李" />
              <TextField label="初始密码" value={createForm.password} onChange={(password) => setCreateForm({ ...createForm, password })} type="password" />
              <div className="grid grid-cols-2 gap-2">
                <SelectField label="角色" value={createForm.role} onChange={(role) => setCreateForm({ ...createForm, role: role as 'admin' | 'staff' })} options={[{ value: 'staff', label: '员工' }, { value: 'admin', label: '管理员' }]} />
                <TextField label="并发" value={createForm.jobConcurrency} onChange={(jobConcurrency) => setCreateForm({ ...createForm, jobConcurrency })} type="number" />
              </div>
              <button
                type="button"
                onClick={() => setCreateForm({ ...createForm, videoGeneration: !createForm.videoGeneration })}
                className="flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left text-[12px] font-medium"
                style={{ background: createForm.videoGeneration ? 'var(--accent-soft)' : 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: createForm.videoGeneration ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                <span>短视频生成</span>
                <span>{createForm.role === 'admin' ? '管理员默认开放' : createForm.videoGeneration ? '已开放' : '默认关闭'}</span>
              </button>
              <button type="submit" className="btn-primary w-full"><Plus size={14} /> 创建</button>
            </div>
          </form>

          <div className="rounded-3xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <span className="section-title mb-0">账号列表</span>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>共 {users.length} 个账号，当前显示 {filteredUsers.length} 个</p>
              </div>
              <div className="flex min-w-[240px] flex-1 items-center justify-end gap-2">
                <label className="relative min-w-[220px] max-w-sm flex-1">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="搜索账号、名称、状态"
                    className="h-10 w-full rounded-2xl border bg-transparent pl-9 pr-3 text-[12px] font-medium outline-none"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                </label>
                <button type="button" onClick={() => void loadUsers()} className="btn-secondary px-3 py-2 text-[12px]"><RefreshCw size={13} /> 刷新</button>
              </div>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {usersLoading ? <div className="p-5 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>正在读取账号...</div> : pagedUsers.length === 0 ? (
                <div className="p-5 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>{userSearch.trim() ? '没有匹配账号' : '还没有创建账号'}</div>
              ) : pagedUsers.map((user) => (
                <div key={user.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onClick={() => setExpandedUserId(expandedUserId === user.id ? '' : user.id)} className="flex min-w-0 items-center gap-2 text-left">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                        <UserCog size={15} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{user.displayName || user.username}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{user.username} · {user.role === 'admin' ? '管理员' : '员工'} · 并发 {user.jobConcurrency} · {formatVideoGenerationAccess(user)}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <span className="pill" style={{ color: user.status === 'active' ? 'var(--success)' : 'var(--text-tertiary)' }}>{user.status === 'active' ? '启用' : '禁用'}</span>
                      <button type="button" className="btn-secondary px-2.5 py-1.5 text-[12px]" onClick={() => void updateUser(user, { status: user.status === 'active' ? 'disabled' : 'active' })}>{user.status === 'active' ? '禁用' : '启用'}</button>
                      <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => void deleteUser(user)} style={{ color: 'var(--error)' }} aria-label={`删除账号 ${user.username}`}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  {expandedUserId === user.id && (
                    <div className="mt-3 grid gap-2 rounded-2xl border p-3 sm:grid-cols-[120px_1fr_auto]" style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)' }}>
                      <SelectField label="角色" value={user.role} onChange={(role) => void updateUser(user, { role: role as 'admin' | 'staff' })} options={[{ value: 'staff', label: '员工' }, { value: 'admin', label: '管理员' }]} />
                      <TextField label="新密码" value={passwordDraft} onChange={setPasswordDraft} type="password" />
                      <button type="button" disabled={!passwordDraft.trim()} className="btn-primary self-end px-3 py-2 text-[12px]" onClick={() => void updateUser(user, { password: passwordDraft.trim() })}><KeyRound size={13} /> 重置</button>
                      <button
                        type="button"
                        disabled={user.role === 'admin'}
                        className="rounded-2xl border px-3 py-2 text-left text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-70 sm:col-span-3"
                        onClick={() => {
                          const current = normalizeFeaturePermissions(user.featurePermissions);
                          void updateUser(user, { featurePermissions: { ...current, videoGeneration: !current.videoGeneration } });
                        }}
                        style={{
                          background: canUseVideoGeneration(user) ? 'var(--accent-soft)' : 'var(--bg-input)',
                          borderColor: 'var(--border-subtle)',
                          color: canUseVideoGeneration(user) ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >
                        短视频生成 · {user.role === 'admin' ? '管理员默认开放' : canUseVideoGeneration(user) ? '已开放' : '未开放'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {filteredUsers.length > USERS_PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4 text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                <span>第 {usersPage} / {usersPageCount} 页</span>
                <div className="flex gap-2">
                  <button type="button" disabled={usersPage <= 1} onClick={() => setUsersPage((page) => Math.max(1, page - 1))} className="btn-secondary px-3 py-2 text-[12px]">上一页</button>
                  <button type="button" disabled={usersPage >= usersPageCount} onClick={() => setUsersPage((page) => Math.min(usersPageCount, page + 1))} className="btn-secondary px-3 py-2 text-[12px]">下一页</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {canManageAccounts && tab === 'logs' && (
        <div className="rounded-3xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="border-b p-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label="功能" value={logFilters.module} onChange={(module) => setLogFilters({ ...logFilters, module })} options={moduleOptions} />
              <SelectField label="人员" value={logFilters.userId} onChange={(userId) => setLogFilters({ ...logFilters, userId })} options={userOptions} />
              <SelectField label="结果" value={logFilters.status} onChange={(status) => setLogFilters({ ...logFilters, status })} options={statusOptions} />
              <TextField label="开始时间" type="datetime-local" value={logFilters.startAt} onChange={(startAt) => setLogFilters({ ...logFilters, startAt })} />
              <TextField label="结束时间" type="datetime-local" value={logFilters.endAt} onChange={(endAt) => setLogFilters({ ...logFilters, endAt })} />
              <button type="button" onClick={() => void queryLogs(1)} className="btn-primary h-10 px-4 text-[12px]"><Search size={14} /> 查询</button>
              <button type="button" onClick={() => void exportLogs()} disabled={!logsTotal} className="btn-secondary h-10 px-3 text-[12px]"><Download size={14} /></button>
              <span className="pb-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>日志保留最近 7 天，不提供手动清理。</span>
            </div>
          </div>
          {!logsQueried ? (
            <div className="p-8 text-center text-[13px]" style={{ color: 'var(--text-tertiary)' }}>选择条件后查询日志</div>
          ) : logsLoading ? (
            <div className="p-8 text-center text-[13px]" style={{ color: 'var(--text-tertiary)' }}>正在读取日志...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-[13px]" style={{ color: 'var(--text-tertiary)' }}>没有匹配日志</div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {logs.map((log) => {
                const failure = deriveLogFailureReason(log);
                return (
                  <details key={log.id} className="group p-4">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="pill">{MODULE_LABELS[log.module] || log.module}</span>
                          <span className="pill">{ACTION_LABELS[log.action] || log.action}</span>
                          <span className="pill" style={{ color: log.status === 'failed' ? 'var(--error)' : log.status === 'success' ? 'var(--success)' : 'var(--text-secondary)' }}>{STATUS_LABELS[log.status] || log.status}</span>
                          {failure && <span className="pill" style={{ color: 'var(--warning)' }}>{failure}</span>}
                        </div>
                        <p className="mt-2 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{log.message}</p>
                      </div>
                      <div className="shrink-0 text-right text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        <p>{log.displayName || log.username}</p>
                        <p>{formatTime(log.createdAt)}</p>
                      </div>
                    </summary>
                    {(log.detail || log.meta) && <pre className="mt-3 whitespace-pre-wrap rounded-2xl border p-3 text-[11px] leading-5" style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>{log.detail || JSON.stringify(log.meta, null, 2)}</pre>}
                  </details>
                );
              })}
              <div className="flex items-center justify-between p-4 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                <span>第 {logsPage} / {logsPageCount} 页，共 {logsTotal} 条</span>
                <div className="flex gap-2">
                  <button type="button" disabled={logsPage <= 1} onClick={() => void queryLogs(logsPage - 1)} className="btn-secondary px-3 py-2 text-[12px]">上一页</button>
                  <button type="button" disabled={logsPage >= logsPageCount} onClick={() => void queryLogs(logsPage + 1)} className="btn-secondary px-3 py-2 text-[12px]">下一页</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {canViewStats && tab === 'stats' && (
        <div className="space-y-4">
          <div className="rounded-3xl border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="开始日期" type="date" value={usageFilters.startDate} onChange={(startDate) => setUsageFilters({ ...usageFilters, startDate })} />
              <TextField label="结束日期" type="date" value={usageFilters.endDate} onChange={(endDate) => setUsageFilters({ ...usageFilters, endDate })} />
              {canManageAccounts && <SelectField label="人员" value={usageFilters.userId} onChange={(userId) => setUsageFilters({ ...usageFilters, userId })} options={userOptions} />}
              <SelectField label="功能" value={usageFilters.module} onChange={(module) => setUsageFilters({ ...usageFilters, module })} options={moduleOptions} />
              <button type="button" onClick={() => void queryUsage()} className="btn-primary h-10 px-4 text-[12px]"><Search size={14} /> 查询</button>
              {canManageAccounts && <button type="button" onClick={() => void backfillUsage()} disabled={usageLoading} className="btn-secondary h-10 px-4 text-[12px]"><RefreshCw size={14} /> 补录</button>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {[
              ['总调用', usageTotal, 'var(--text-primary)'],
              ['成功', usageSummary.success, 'var(--success)'],
              ['失败', usageSummary.failed, 'var(--error)'],
              ['中断', usageSummary.interrupted, 'var(--warning)'],
              ['总积分', usageSummary.credits, 'var(--accent)'],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-3xl border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
                <p className="mt-2 text-[26px] font-semibold tabular-nums" style={{ color: String(color) }}>{String(value)}</p>
              </div>
            ))}
          </div>
          <div className="rounded-3xl border p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="mb-3 flex items-center gap-2"><BarChart3 size={15} style={{ color: 'var(--accent)' }} /><span className="section-title mb-0">按功能统计</span></div>
            {usageLoading ? <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>正在查询...</p> : usageByModule.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>暂无统计记录</p> : usageByModule.map((item) => (
              <div key={item.module} className="mb-3 last:mb-0">
                <div className="mb-1 flex justify-between text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  <span>{MODULE_LABELS[item.module] || item.module}</span>
                  <span>{item.total} 次 · {item.creditsConsumed} 积分</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (item.total / Math.max(1, usageTotal)) * 100)}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-3xl border p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{confirmState.title}</p>
            <p className="mt-2 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>{confirmState.detail}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmState(null)} className="btn-secondary px-4 py-2 text-[12px]">取消</button>
              <button type="button" onClick={() => void runConfirmed()} className="btn-ghost px-4 py-2 text-[12px]" style={{ color: 'var(--error)' }}>确认</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default AccountManagement;
