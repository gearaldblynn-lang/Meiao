import React, { useEffect, useMemo, useState } from 'react';
import { AuthUser, InternalLogEntry } from '../../types';
import UserAdminPanel from '../../components/Internal/UserAdminPanel';
import { deleteInternalLogs, fetchInternalLogs } from '../../services/internalApi';
import { ACTION_LABELS, MODULE_LABELS, STATUS_LABELS } from '../../services/loggingService';
import { buildLogCsv, filterLogs } from './accountManagementUtils.mjs';
import { SegmentedTabs, WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import UsageStatsPanel from './UsageStatsPanel';

interface Props {
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onCurrentUserChange?: (user: AuthUser) => void;
}

const AccountManagement: React.FC<Props> = ({ currentUser = null, internalMode = false, onCurrentUserChange }) => {
  const isAdmin = Boolean(internalMode && currentUser?.role === 'admin');
  const [activeTab, setActiveTab] = useState<'users' | 'logs' | 'stats'>('users');
  const [allLogs, setAllLogs] = useState<InternalLogEntry[]>([]);
  const [logs, setLogs] = useState<InternalLogEntry[]>([]);
  const [logsQueried, setLogsQueried] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logsMessage, setLogsMessage] = useState('');
  const [deletingLogs, setDeletingLogs] = useState(false);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [startTimeFilter, setStartTimeFilter] = useState('');
  const [endTimeFilter, setEndTimeFilter] = useState('');

  const toTimestamp = (value: string, boundary: 'start' | 'end') => {
    if (!value) return undefined;
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) return undefined;
    if (boundary === 'start') return parsed;
    return parsed + 59_999;
  };

  const loadLogs = async () => {
    if (!isAdmin) return;
    setLoadingLogs(true);
    setLogsError('');
    try {
      const result = await fetchInternalLogs({
        module: moduleFilter,
        userId: userFilter,
        status: statusFilter,
        startAt: toTimestamp(startTimeFilter, 'start'),
        endAt: toTimestamp(endTimeFilter, 'end'),
      });
      setLogs(result.logs);
      setLogsQueried(true);
    } catch (error: any) {
      setLogsError(error.message || '运行日志读取失败');
    } finally {
      setLoadingLogs(false);
    }
  };

  // 预加载全量日志用于填充筛选选项（不展示数据）
  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      try {
        const allResult = await fetchInternalLogs({});
        setAllLogs(allResult.logs);
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
      { key: 'retryCount', label: '重试' },
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

  const filteredLogs = useMemo(() => filterLogs(logs, {
    module: moduleFilter,
    userId: userFilter,
    status: statusFilter,
    startAt: toTimestamp(startTimeFilter, 'start'),
    endAt: toTimestamp(endTimeFilter, 'end'),
  }), [logs, moduleFilter, userFilter, statusFilter, startTimeFilter, endTimeFilter]);

  const groupedLogEntries = Object.entries(
    filteredLogs.reduce<Record<string, InternalLogEntry[]>>((acc, log) => {
      const dayKey = formatDay(log.createdAt);
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push(log);
      return acc;
    }, {})
  ) as Array<[string, InternalLogEntry[]]>;

  const moduleOptions = Array.from(new Set(allLogs.map((log) => log.module))).filter(Boolean) as string[];
  const userOptions = Array.from(
    new Map<string, { id: string; label: string }>(
      allLogs.map((log) => [log.userId, { id: log.userId, label: log.displayName || log.username }])
    ).values()
  );

  const handleExportLogs = () => {
    if (filteredLogs.length === 0) return;
    const csv = buildLogCsv(filteredLogs);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meiao-logs-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setLogsMessage(`已导出 ${filteredLogs.length} 条日志。`);
    setLogsError('');
  };

  const handleDeleteLogs = async () => {
    if (filteredLogs.length === 0) return;
    const confirmed = window.confirm(`确认清理当前筛选结果中的 ${filteredLogs.length} 条日志吗？`);
    if (!confirmed) return;

    setDeletingLogs(true);
    setLogsError('');
    setLogsMessage('');
    try {
      const result = await deleteInternalLogs({
        module: moduleFilter,
        userId: userFilter,
        status: statusFilter,
        startAt: toTimestamp(startTimeFilter, 'start'),
        endAt: toTimestamp(endTimeFilter, 'end'),
      });
      await loadLogs();
      setLogsMessage(`已清理 ${result.deletedCount} 条日志。`);
    } catch (error: any) {
      setLogsError(error.message || '清理日志失败');
    } finally {
      setDeletingLogs(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 pb-6 pt-5">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-[32px] border border-slate-200/80 bg-white/90 px-8 py-8 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <h2 className="text-3xl font-black text-slate-900">账号管理工作台</h2>
        </header>

        <WorkspaceShellCard className="bg-slate-50/90 px-8 py-7">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg">
              <i className="fas fa-user-shield text-xl"></i>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-black text-slate-800">当前登录账号</h3>
              <p className="mt-2 text-sm text-slate-600 leading-7">
                {currentUser?.displayName || currentUser?.username || '未登录'} · {currentUser?.role === 'admin' ? '管理员' : '员工'} · 账号并发 {currentUser?.jobConcurrency ?? '-'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {internalMode ? '把账号和运行日志分开管理，页面会更短也更适合多人日常使用。' : '当前为本地模式，账号管理仅在内部版启用。'}
              </p>
            </div>
          </div>
        </WorkspaceShellCard>

        {isAdmin ? (
          <>
            <div className="mt-8">
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
              <section className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-lg">
                      <i className="fas fa-clipboard-list text-xl"></i>
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-slate-800">运行日志</h3>
                      <p className="text-xs text-slate-400">按筛选结果导出或清理，更适合真实排障使用。</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleExportLogs} disabled={filteredLogs.length === 0} className="px-4 py-2 rounded-xl text-xs font-black bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-60">
                      导出当前结果
                    </button>
                    <button
                      onClick={() => void handleDeleteLogs()}
                      disabled={deletingLogs || filteredLogs.length === 0}
                      className="px-4 py-2 rounded-xl text-xs font-black bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-60"
                    >
                      {deletingLogs ? '清理中...' : '清理当前结果'}
                    </button>
                    <button onClick={() => void loadLogs()} disabled={loadingLogs} className="px-4 py-2 rounded-xl text-xs font-black bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60">
                      {loadingLogs ? '查询中...' : '查询日志'}
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
                  <div className="px-6 py-5 border-b border-slate-100 bg-slate-50">
                    <div className="grid md:grid-cols-5 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">按功能筛选</label>
                        <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none">
                          <option value="all">全部功能</option>
                          {moduleOptions.map((moduleId) => (
                            <option key={moduleId} value={moduleId}>{getModuleLabel(moduleId)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">按人员筛选</label>
                        <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)} className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none">
                          <option value="all">全部人员</option>
                          {userOptions.map((user) => (
                            <option key={user.id} value={user.id}>{user.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">开始时间</label>
                        <input
                          type="datetime-local"
                          value={startTimeFilter}
                          onChange={(event) => setStartTimeFilter(event.target.value)}
                          className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">结束时间</label>
                        <input
                          type="datetime-local"
                          value={endTimeFilter}
                          onChange={(event) => setEndTimeFilter(event.target.value)}
                          className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-1">按结果筛选</label>
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none">
                          <option value="all">全部结果</option>
                          <option value="started">进行中</option>
                          <option value="success">成功</option>
                          <option value="failed">失败</option>
                          <option value="interrupted">中断</option>
                        </select>
                      </div>
                      <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-black text-slate-500 uppercase">当前结果数</p>
                          <p className="mt-1 text-lg font-black text-slate-800">{filteredLogs.length}</p>
                        </div>
                        <i className="fas fa-filter text-slate-300 text-xl"></i>
                      </div>
                    </div>
                  </div>

                  {logsError ? <div className="px-6 py-4 text-sm font-bold text-rose-600 bg-rose-50 border-b border-rose-100">{logsError}</div> : null}
                  {logsMessage ? <div className="px-6 py-4 text-sm font-bold text-emerald-700 bg-emerald-50 border-b border-emerald-100">{logsMessage}</div> : null}

                  {loadingLogs ? (
                    <div className="px-6 py-5 text-sm font-bold text-slate-400">正在读取运行日志...</div>
                  ) : !logsQueried ? (
                    <div className="px-6 py-8 text-sm font-bold text-slate-400 text-center">请选择筛选条件后点击「查询日志」</div>
                  ) : filteredLogs.length === 0 ? (
                    <div className="px-6 py-5 text-sm font-bold text-slate-400">当前筛选条件下没有日志</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {groupedLogEntries.map(([day, dayLogs]) => (
                        <div key={day}>
                          <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                            <p className="text-sm font-black text-slate-700">{day}</p>
                            <p className="text-xs font-bold text-slate-400">{dayLogs.length} 条</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {dayLogs.map((log) => {
                              const metaSummary = getMetaSummary(log.meta);
                              return (
                                <div key={log.id} className="px-6 py-5">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${log.level === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                          {log.level === 'error' ? '错误' : '记录'}
                                        </span>
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${getStatusBadgeClass(log.status)}`}>
                                          {getStatusLabel(log.status)}
                                        </span>
                                        <span className="text-[11px] font-black text-slate-500">{getModuleLabel(log.module)}</span>
                                        <span className="text-[11px] text-slate-400">·</span>
                                        <span className="text-[11px] font-bold text-slate-500">{getActionLabel(log.action)}</span>
                                      </div>
                                      <p className="mt-3 text-sm font-black text-slate-800 break-words">{log.message}</p>
                                      {metaSummary.length > 0 ? (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {metaSummary.map((item) => (
                                            <span key={item.key} className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-500">
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
                                    <div className="text-right shrink-0">
                                      <p className="text-xs font-black text-slate-600">{log.displayName || log.username}</p>
                                      <p className="text-[11px] text-slate-400 mt-1">{formatTime(log.createdAt)}</p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === 'stats' ? (
              <UsageStatsPanel />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};

export default AccountManagement;
