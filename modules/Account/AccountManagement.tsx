import React, { useEffect, useMemo, useState } from 'react';
import { AuthUser, InternalLogEntry } from '../../types';
import UserAdminPanel from '../../components/Internal/UserAdminPanel';
import { deleteInternalLogs, fetchInternalLogMeta, fetchInternalLogs } from '../../services/internalApi';
import { ACTION_LABELS, MODULE_LABELS, STATUS_LABELS } from '../../services/loggingService';
import { buildLogCsv, deriveLogFailureReason } from './accountManagementUtils.mjs';
import { buildLogFilterOptions } from './logQueryUtils.mjs';
import { PopoverSelect, SegmentedTabs, WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import ConfirmDialog from '../../components/ConfirmDialog';
import UsageStatsPanel from './UsageStatsPanel';
import ProfileSettingsCard from './ProfileSettingsCard';

interface Props {
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onCurrentUserChange?: (user: AuthUser) => void;
  entryMode?: 'default' | 'profile' | 'manage';
}

type LogQueryFilters = Partial<{
  module: string;
  userId: string;
  status: string;
  startAt: number;
  endAt: number;
}>;

const AccountManagement: React.FC<Props> = ({ currentUser = null, internalMode = false, onCurrentUserChange, entryMode = 'default' }) => {
  const isAdmin = Boolean(internalMode && currentUser?.role === 'admin');
  const [activeTab, setActiveTab] = useState<'users' | 'logs' | 'stats'>('users');
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [logs, setLogs] = useState<InternalLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsQueried, setLogsQueried] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logsMessage, setLogsMessage] = useState('');
  const [deletingLogs, setDeletingLogs] = useState(false);
  const [logMeta, setLogMeta] = useState<{ modules: string[]; users: Array<{ id: string; label: string }> }>({ modules: [], users: [] });
  const [moduleFilter, setModuleFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [startTimeFilter, setStartTimeFilter] = useState('');
  const [endTimeFilter, setEndTimeFilter] = useState('');
  const [logsPage, setLogsPage] = useState(1);
  const [lastLogQueryFilters, setLastLogQueryFilters] = useState<LogQueryFilters | null>(null);
  const [confirmDeleteLogsOpen, setConfirmDeleteLogsOpen] = useState(false);
  const LOGS_PAGE_SIZE = 10;

  useEffect(() => {
    if (entryMode === 'profile') {
      setProfilePanelOpen(true);
    }
    if (entryMode === 'manage' && isAdmin) {
      setActiveTab('users');
    }
  }, [entryMode, isAdmin]);

  const toTimestamp = (value: string, boundary: 'start' | 'end') => {
    if (!value) return undefined;
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) return undefined;
    if (boundary === 'start') return parsed;
    return parsed + 59_999;
  };

  const buildLogQueryFilters = (): LogQueryFilters => ({
    module: moduleFilter,
    userId: userFilter,
    status: statusFilter,
    startAt: toTimestamp(startTimeFilter, 'start'),
    endAt: toTimestamp(endTimeFilter, 'end'),
  });

  const loadLogs = async (page = logsPage, queryFilters = buildLogQueryFilters()) => {
    if (!isAdmin) return;
    setLoadingLogs(true);
    setLogsError('');
    try {
      const result = await fetchInternalLogs({
        ...queryFilters,
        page,
        pageSize: LOGS_PAGE_SIZE,
      });
      setLogs(result.logs);
      setLogsTotal(result.total);
      setLogsPage(result.page);
      setLastLogQueryFilters(queryFilters);
      setLogsQueried(true);
    } catch (error: any) {
      setLogsError(error.message || '运行日志读取失败');
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      try {
        const meta = await fetchInternalLogMeta();
        setLogMeta(meta);
      } catch { /* 静默失败 */ }
    })();
  }, [isAdmin]);

  const formatTime = (value: number) => {
    try {
      return new Date(value).toLocaleString('zh-CN', { hour12: false });
    } catch {
      return String(value);
    }
  };

  const formatDay = (value: number) => {
    try {
      return new Date(value).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return '未知日期';
    }
  };

  const getModuleLabel = (moduleId: string) => MODULE_LABELS[moduleId] || '其他';
  const getActionLabel = (action: string) => ACTION_LABELS[action] || action.replace(/_/g, ' ');
  const getStatusLabel = (status: string) => STATUS_LABELS[status] || status;

  const getStatusBadgeClass = (status: string) => {
    if (status === 'failed') return 'bg-rose-50 text-rose-600';
    if (status === 'success') return 'bg-emerald-50 text-emerald-600';
    if (status === 'interrupted') return 'bg-amber-50 text-amber-700';
    return 'bg-indigo-50 text-indigo-600';
  };

  const getMetaSummary = (meta?: Record<string, unknown>) => {
    if (!meta) return [];
    const itemMap: Array<{ key: string; label: string }> = [
      { key: 'jobId', label: '内部任务' },
      { key: 'providerTaskId', label: '外部任务' },
      { key: 'provider', label: '引擎' },
      { key: 'agentName', label: '智能体' },
      { key: 'requestType', label: '请求类型' },
      { key: 'selectedModel', label: '模型' },
      { key: 'sessionId', label: '会话' },
      { key: 'retryCount', label: '重试' },
      { key: 'errorCode', label: '错误码' },
      { key: 'fileName', label: '文件' },
      { key: 'count', label: '数量' },
      { key: 'targetUsername', label: '目标账号' },
    ];

    return itemMap
      .filter(({ key }) => meta[key] !== undefined && meta[key] !== null && meta[key] !== '')
      .slice(0, 5)
      .map(({ key, label }) => ({
        key,
        label,
        value: String(meta[key]),
      }));
  };

  const logsPageCount = Math.max(1, Math.ceil(logsTotal / LOGS_PAGE_SIZE));

  const groupedLogEntries = Object.entries(
    logs.reduce<Record<string, InternalLogEntry[]>>((acc, log) => {
      const dayKey = formatDay(log.createdAt);
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push(log);
      return acc;
    }, {})
  ) as Array<[string, InternalLogEntry[]]>;

  const fallbackOptions = useMemo(() => buildLogFilterOptions(logs), [logs]);
  const moduleOptions = logMeta.modules.length > 0 ? logMeta.modules : fallbackOptions.modules;
  const userOptions = logMeta.users.length > 0 ? logMeta.users : fallbackOptions.users;
  const moduleFilterOptions = useMemo(() => ([
    { value: 'all', label: '全部功能' },
    ...moduleOptions.map((moduleId) => ({ value: moduleId, label: getModuleLabel(moduleId) })),
  ]), [moduleOptions]);
  const userFilterOptions = useMemo(() => ([
    { value: 'all', label: '全部人员' },
    ...userOptions.map((user) => ({ value: user.id, label: user.label })),
  ]), [userOptions]);
  const statusFilterOptions = useMemo(() => ([
    { value: 'all', label: '全部结果' },
    { value: 'started', label: '进行中' },
    { value: 'success', label: '成功' },
    { value: 'failed', label: '失败' },
    { value: 'interrupted', label: '中断' },
  ]), []);

  const handleExportLogs = async () => {
    if (!isAdmin) return;
    const exportFilters = buildLogQueryFilters();
    const totalToExport = logsTotal > 0 ? logsTotal : logs.length;
    if (totalToExport === 0) return;

    try {
      const exportPageSize = 200;
      const exportedLogs: InternalLogEntry[] = [];
      let exportPage = 1;

      while (exportedLogs.length < totalToExport) {
        const result = await fetchInternalLogs({
          ...exportFilters,
          page: exportPage,
          pageSize: exportPageSize,
        });
        exportedLogs.push(...result.logs);
        if (result.logs.length === 0 || exportedLogs.length >= result.total) break;
        exportPage += 1;
      }

      const csv = buildLogCsv(exportedLogs);
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `meiao-logs-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setLogsMessage(`已导出筛选结果 ${exportedLogs.length} 条日志。`);
      setLogsError('');
    } catch (error: any) {
      setLogsError(error.message || '导出日志失败');
      setLogsMessage('');
    }
  };

  const handleDeleteLogs = async () => {
    if (logsTotal === 0 || !lastLogQueryFilters) return;
    setConfirmDeleteLogsOpen(true);
  };

  const confirmDeleteLogs = async () => {
    if (logsTotal === 0 || !lastLogQueryFilters) return;
    setConfirmDeleteLogsOpen(false);
    setDeletingLogs(true);
    setLogsError('');
    setLogsMessage('');
    try {
      const result = await deleteInternalLogs(lastLogQueryFilters);
      await loadLogs(1, lastLogQueryFilters);
      setLogsMessage(`已清理 ${result.deletedCount} 条日志。`);
    } catch (error: any) {
      setLogsError(error.message || '清理日志失败');
    } finally {
      setDeletingLogs(false);
    }
  };

  const currentUserLabel = currentUser?.displayName || currentUser?.username || '未登录';

  return (
    <>
    <div className="h-full overflow-y-auto px-6 pb-6 pt-5">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 rounded-[24px] border border-white/75 bg-white/84 px-4 py-3.5 shadow-[0_18px_44px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)]">
                <i className="fas fa-user-shield text-sm" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-[20px] font-black tracking-[-0.03em] text-slate-900">账号管理</h2>
                <p className="mt-0.5 text-[12px] font-medium text-slate-500">账号、日志、用量统一查看</p>
              </div>
            </div>
            {currentUser ? (
              <div className="flex items-center gap-3 rounded-[18px] border border-slate-200/80 bg-white/82 px-3 py-2 shadow-[0_10px_24px_rgba(148,163,184,0.08)]">
                <ProfileSettingsCard
                  currentUser={currentUser}
                  onUserChange={onCurrentUserChange}
                  compactOnly
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-black text-slate-900">{currentUserLabel}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                    {currentUser?.role === 'admin' ? '管理员' : '员工'} · 并发 {currentUser?.jobConcurrency ?? '-'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProfilePanelOpen(true)}
                  className="rounded-[15px] border border-slate-200/80 bg-white px-3 py-1.5 text-[12px] font-black text-slate-700"
                >
                  编辑资料
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {profilePanelOpen ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/20 px-6">
            <div className="w-full max-w-4xl rounded-[28px] border border-white/80 bg-white/92 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.14)] backdrop-blur-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[18px] font-black text-slate-900">个人资料</h3>
                  <p className="mt-1 text-[12px] font-medium text-slate-500">这里只在需要时打开，不再常驻占据页面。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setProfilePanelOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-500"
                  aria-label="关闭个人资料"
                >
                  <i className="fas fa-xmark text-sm" />
                </button>
              </div>
              {currentUser ? (
                <ProfileSettingsCard currentUser={currentUser} onUserChange={onCurrentUserChange} />
              ) : null}
            </div>
          </div>
        ) : null}

        {isAdmin ? (
          <>
            <div className="mt-4">
              <SegmentedTabs
                value={activeTab}
                onChange={setActiveTab}
                items={[
                  { value: 'users', label: '账号管理', icon: 'fa-user-shield' },
                  { value: 'logs', label: '运行日志', icon: 'fa-clipboard-list' },
                  { value: 'stats', label: '用量统计', icon: 'fa-chart-bar' },
                ]}
              />
            </div>

            {activeTab === 'users' ? (
              <UserAdminPanel
                enabled={isAdmin}
                currentUserId={currentUser?.id || ''}
                onCurrentUserChange={onCurrentUserChange}
              />
            ) : null}

            {activeTab === 'logs' ? (
              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-slate-900 text-white shadow-[0_10px_22px_rgba(15,23,42,0.12)]">
                      <i className="fas fa-clipboard-list text-base"></i>
                    </div>
                    <div>
                      <h3 className="text-[18px] font-black text-slate-800">运行日志</h3>
                      <p className="text-[12px] text-slate-400">单页 10 条，优先短列表和清晰筛选。</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleExportLogs} disabled={logsTotal === 0} className="rounded-[16px] bg-slate-100 px-3.5 py-2 text-[12px] font-black text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-60">
                      导出筛选结果
                    </button>
                    <button
                      onClick={() => void handleDeleteLogs()}
                      disabled={deletingLogs || logsTotal === 0 || !lastLogQueryFilters}
                      className="rounded-[16px] bg-rose-50 px-3.5 py-2 text-[12px] font-black text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-60"
                    >
                      {deletingLogs ? '清理中...' : '清理当前结果'}
                    </button>
                    <button onClick={() => void loadLogs(1)} disabled={loadingLogs} className="rounded-[16px] bg-indigo-600 px-3.5 py-2 text-[12px] font-black text-white hover:bg-indigo-700 transition-colors disabled:opacity-60">
                      {loadingLogs ? '查询中...' : '查询日志'}
                    </button>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
                    <div className="grid gap-3 xl:grid-cols-[1.1fr_1.1fr_1fr_1fr_1fr_auto]">
                      <div>
                        <label className="ml-1 text-[10px] font-black uppercase text-slate-500">按功能筛选</label>
                        <PopoverSelect
                          value={moduleFilter}
                          onChange={setModuleFilter}
                          options={moduleFilterOptions}
                          className="mt-1"
                          buttonClassName="h-[42px] rounded-[16px] bg-white px-3 py-2.5 text-[12px] font-bold"
                        />
                      </div>
                      <div>
                        <label className="ml-1 text-[10px] font-black uppercase text-slate-500">按人员筛选</label>
                        <PopoverSelect
                          value={userFilter}
                          onChange={setUserFilter}
                          options={userFilterOptions}
                          className="mt-1"
                          buttonClassName="h-[42px] rounded-[16px] bg-white px-3 py-2.5 text-[12px] font-bold"
                        />
                      </div>
                      <div>
                        <label className="ml-1 text-[10px] font-black uppercase text-slate-500">开始时间</label>
                        <input
                          type="datetime-local"
                          value={startTimeFilter}
                          onChange={(event) => setStartTimeFilter(event.target.value)}
                          className="mt-1 w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 text-[12px] font-bold text-slate-700 outline-none"
                        />
                      </div>
                      <div>
                        <label className="ml-1 text-[10px] font-black uppercase text-slate-500">结束时间</label>
                        <input
                          type="datetime-local"
                          value={endTimeFilter}
                          onChange={(event) => setEndTimeFilter(event.target.value)}
                          className="mt-1 w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 text-[12px] font-bold text-slate-700 outline-none"
                        />
                      </div>
                      <div>
                        <label className="ml-1 text-[10px] font-black uppercase text-slate-500">按结果筛选</label>
                        <PopoverSelect
                          value={statusFilter}
                          onChange={setStatusFilter}
                          options={statusFilterOptions}
                          className="mt-1"
                          buttonClassName="h-[42px] rounded-[16px] bg-white px-3 py-2.5 text-[12px] font-bold"
                        />
                      </div>
                      <div className="flex items-end">
                        <div className="flex w-full items-center justify-between rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                        <div>
                            <p className="text-[10px] font-black uppercase text-slate-500">当前结果数</p>
                            <p className="mt-1 text-[18px] font-black text-slate-800">{logsTotal}</p>
                          </div>
                          <i className="fas fa-filter text-slate-300 text-lg"></i>
                        </div>
                      </div>
                    </div>
                  </div>

                  {logsError ? <div className="px-6 py-4 text-sm font-bold text-rose-600 bg-rose-50 border-b border-rose-100">{logsError}</div> : null}
                  {logsMessage ? <div className="px-6 py-4 text-sm font-bold text-emerald-700 bg-emerald-50 border-b border-emerald-100">{logsMessage}</div> : null}

                  {loadingLogs ? (
                    <div className="px-6 py-5 text-sm font-bold text-slate-400">正在读取运行日志...</div>
                  ) : !logsQueried ? (
                    <div className="px-6 py-8 text-sm font-bold text-slate-400 text-center">请选择筛选条件后点击「查询日志」</div>
                  ) : logs.length === 0 ? (
                    <div className="px-6 py-5 text-sm font-bold text-slate-400">当前筛选条件下没有日志</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {groupedLogEntries.map(([day, dayLogs]) => (
                        <div key={day}>
                          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                            <p className="text-[13px] font-black text-slate-700">{day}</p>
                            <p className="text-[11px] font-bold text-slate-400">{dayLogs.length} 条</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {dayLogs.map((log) => {
                              const metaSummary = getMetaSummary(log.meta);
                              const failureReason = deriveLogFailureReason(log);
                              return (
                                <details key={log.id} className="group px-5 py-4">
                                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${log.level === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                          {log.level === 'error' ? '错误' : '记录'}
                                        </span>
                                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${getStatusBadgeClass(log.status)}`}>
                                          {getStatusLabel(log.status)}
                                        </span>
                                        {failureReason ? (
                                          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                                            {failureReason}
                                          </span>
                                        ) : null}
                                        <span className="text-[11px] font-black text-slate-500">{getModuleLabel(log.module)}</span>
                                        <span className="text-[11px] text-slate-400">·</span>
                                        <span className="text-[11px] font-bold text-slate-500">{getActionLabel(log.action)}</span>
                                      </div>
                                      <p className="mt-2 text-[13px] font-black text-slate-800 break-words">{log.message}</p>
                                      {metaSummary.length > 0 ? (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {metaSummary.slice(0, 3).map((item) => (
                                            <span key={item.key} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                                              {item.label}：{item.value}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <p className="text-[12px] font-black text-slate-600">{log.displayName || log.username}</p>
                                      <p className="mt-1 text-[11px] text-slate-400">{formatTime(log.createdAt)}</p>
                                      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 group-open:text-slate-600">
                                        <i className="fas fa-chevron-down text-[10px] transition group-open:rotate-180" />
                                        详情
                                      </span>
                                    </div>
                                  </summary>
                                  {log.detail || metaSummary.length > 3 ? (
                                    <div className="mt-3 border-t border-slate-100 pt-3">
                                      {metaSummary.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                          {metaSummary.map((item) => (
                                            <span key={item.key} className="rounded-full bg-slate-50 border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                                              {item.label}：{item.value}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                      {log.detail ? (
                                        <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs leading-6 text-slate-500 font-medium">
                                          {log.detail}
                                        </pre>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </details>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-between bg-slate-50 px-5 py-4">
                        <p className="text-[12px] font-bold text-slate-500">第 {logsPage} / {logsPageCount} 页，共 {logsTotal} 条</p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void loadLogs(logsPage - 1)}
                            disabled={loadingLogs || logsPage <= 1}
                            className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-black text-slate-700 disabled:opacity-40"
                          >
                            上一页
                          </button>
                          <button
                            onClick={() => void loadLogs(logsPage + 1)}
                            disabled={loadingLogs || logsPage >= logsPageCount}
                            className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-black text-slate-700 disabled:opacity-40"
                          >
                            下一页
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === 'stats' ? (
              <UsageStatsPanel />
            ) : null}
          </>
        ) : currentUser ? (
          <div className="mt-6">
            <WorkspaceShellCard className="border border-white/75 bg-white/84 px-5 py-5 shadow-[0_18px_44px_rgba(148,163,184,0.08)] backdrop-blur-xl">
              <p className="text-[14px] font-medium text-slate-500">当前账号不是管理员，仅可维护个人资料。</p>
            </WorkspaceShellCard>
          </div>
        ) : null}
      </div>
    </div>
    <ConfirmDialog
      open={confirmDeleteLogsOpen}
      title="确认清理日志"
      message={`确认清理当前查询结果中的 ${logsTotal} 条日志吗？此操作不会影响其他未命中的日志数据。`}
      confirmLabel="确认清理日志"
      onCancel={() => setConfirmDeleteLogsOpen(false)}
      onConfirm={confirmDeleteLogs}
    />
    </>
  );
};

export default AccountManagement;
