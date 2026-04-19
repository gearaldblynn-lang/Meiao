import React, { useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { PopoverSelect } from '../../components/ui/workspacePrimitives';
import { MODULE_LABELS } from '../../services/loggingService';
import { backfillUsageStats, fetchUsageStats } from '../../services/internalApi';

const USAGE_MODULE_IDS = ['agent_center', 'one_click', 'translation', 'buyer_show', 'retouch', 'video'];
const USAGE_LIST_PREVIEW_LIMIT = 8;

type UsageRow = {
  statDate: string;
  userId: string;
  username: string;
  displayName: string;
  module: string;
  successCount: number;
  failedCount: number;
  interruptedCount: number;
};

type UsageByUserRow = {
  userId: string;
  displayName: string;
  total: number;
  success: number;
  failed: number;
  interrupted: number;
};

type UsageByModuleRow = {
  module: string;
  total: number;
  success: number;
  failed: number;
  interrupted: number;
};

const UsageStatsPanel: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [knownUsers, setKnownUsers] = useState<Array<{ id: string; label: string }>>([]);
  const [confirmBackfillOpen, setConfirmBackfillOpen] = useState(false);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [showAllModules, setShowAllModules] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const allResult = await fetchUsageStats({});
        const userMap = new Map<string, string>();
        for (const row of allResult.rows) {
          if (!userMap.has(row.userId)) {
            userMap.set(row.userId, row.displayName || row.username);
          }
        }
        setKnownUsers(Array.from(userMap.entries()).map(([id, label]) => ({ id, label })));
      } catch {
        // 静默预载失败，避免影响主流程
      }
    })();
  }, []);

  const refreshKnownUsers = (nextRows: UsageRow[]) => {
    const userMap = new Map<string, string>();
    for (const row of [...rows, ...nextRows]) {
      if (!userMap.has(row.userId)) {
        userMap.set(row.userId, row.displayName || row.username);
      }
    }
    setKnownUsers(Array.from(userMap.entries()).map(([id, label]) => ({ id, label })));
  };

  const handleQuery = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await fetchUsageStats({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        userId: userFilter,
        module: moduleFilter,
      });
      setRows(result.rows);
      refreshKnownUsers(result.rows);
      setMessage(`查询到 ${result.rows.length} 条统计记录`);
    } catch (err: any) {
      setError(err.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBackfill = async () => {
    setConfirmBackfillOpen(true);
  };

  const confirmBackfill = async () => {
    setConfirmBackfillOpen(false);
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await backfillUsageStats();
      setMessage(`补录完成，共 ${result.upserted} 条记录`);
    } catch (err: any) {
      setError(err.message || '补录失败');
    } finally {
      setLoading(false);
    }
  };

  const overview = useMemo(() => rows.reduce((acc, row) => {
    acc.success += row.successCount;
    acc.failed += row.failedCount;
    acc.interrupted += row.interruptedCount;
    return acc;
  }, { success: 0, failed: 0, interrupted: 0 }), [rows]);

  const totalFinished = overview.success + overview.failed;
  const successRate = totalFinished > 0 ? `${((overview.success / totalFinished) * 100).toFixed(1)}%` : '--';

  const byUser = useMemo<UsageByUserRow[]>(() => (Object.values(
    rows.reduce<Record<string, UsageByUserRow>>((acc, row) => {
      if (!acc[row.userId]) {
        acc[row.userId] = {
          userId: row.userId,
          displayName: row.displayName || row.username,
          total: 0,
          success: 0,
          failed: 0,
          interrupted: 0,
        };
      }
      acc[row.userId].total += row.successCount + row.failedCount;
      acc[row.userId].success += row.successCount;
      acc[row.userId].failed += row.failedCount;
      acc[row.userId].interrupted += row.interruptedCount;
      return acc;
    }, {})
  ) as UsageByUserRow[]).sort((a, b) => b.total - a.total), [rows]);

  const byModule = useMemo<UsageByModuleRow[]>(() => (Object.values(
    rows.reduce<Record<string, UsageByModuleRow>>((acc, row) => {
      if (!acc[row.module]) {
        acc[row.module] = { module: row.module, total: 0, success: 0, failed: 0, interrupted: 0 };
      }
      acc[row.module].total += row.successCount + row.failedCount;
      acc[row.module].success += row.successCount;
      acc[row.module].failed += row.failedCount;
      acc[row.module].interrupted += row.interruptedCount;
      return acc;
    }, {})
  ) as UsageByModuleRow[]).sort((a, b) => b.total - a.total), [rows]);

  const summaryCards = [
    { label: '总调用量', value: totalFinished, tone: 'text-slate-900', desc: '成功 + 失败' },
    { label: '成功', value: overview.success, tone: 'text-emerald-600', desc: '已完成请求' },
    { label: '失败', value: overview.failed, tone: 'text-rose-600', desc: '执行失败请求' },
    { label: '成功率', value: successRate, tone: 'text-sky-600', desc: '按成功 / 完成计算' },
  ];
  const getModuleLabel = (id: string) => MODULE_LABELS[id] || id;
  const moduleFilterOptions = useMemo(() => ([
    { value: 'all', label: '全部功能' },
    ...USAGE_MODULE_IDS.map((moduleId) => ({ value: moduleId, label: getModuleLabel(moduleId) })),
  ]), []);
  const userFilterOptions = useMemo(() => ([
    { value: 'all', label: '全部人员' },
    ...knownUsers.map((user) => ({ value: user.id, label: user.label })),
  ]), [knownUsers]);

  const maxUserTotal = Math.max(1, ...byUser.map((item) => item.total));
  const maxModuleTotal = Math.max(1, ...byModule.map((item) => item.total));
  const visibleUserRows = showAllUsers ? byUser : byUser.slice(0, USAGE_LIST_PREVIEW_LIMIT);
  const visibleModuleRows = showAllModules ? byModule : byModule.slice(0, USAGE_LIST_PREVIEW_LIMIT);

  return (
    <>
    <section className="mt-8">
      <div className="rounded-[28px] border border-white/75 bg-white/84 p-5 shadow-[0_18px_44px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
                <i className="fas fa-chart-pie text-sm" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[19px] font-black tracking-[-0.03em] text-slate-900">用量统计</h3>
                <p className="mt-0.5 text-[12px] font-medium text-slate-500">按日期、人员、功能查看调用情况。</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleBackfill}
            disabled={loading}
            className="rounded-[16px] border border-amber-200/80 bg-amber-50/90 px-3.5 py-2 text-[12px] font-black text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
          >
            补录历史数据
          </button>
        </div>

        <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-3.5">
          <div className="grid gap-3 md:grid-cols-5">
            <label className="space-y-1">
              <span className="ml-1 text-[11px] font-semibold text-slate-500">开始日期</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 outline-none transition focus:border-slate-300"
              />
            </label>
            <label className="space-y-1">
              <span className="ml-1 text-[11px] font-semibold text-slate-500">结束日期</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 outline-none transition focus:border-slate-300"
              />
            </label>
            <label className="space-y-1">
              <span className="ml-1 text-[11px] font-semibold text-slate-500">人员</span>
              <PopoverSelect
                value={userFilter}
                onChange={setUserFilter}
                options={userFilterOptions}
                buttonClassName="h-10 rounded-[14px] bg-white px-3 text-[12px] font-medium"
              />
            </label>
            <label className="space-y-1">
              <span className="ml-1 text-[11px] font-semibold text-slate-500">功能</span>
              <PopoverSelect
                value={moduleFilter}
                onChange={setModuleFilter}
                options={moduleFilterOptions}
                buttonClassName="h-10 rounded-[14px] bg-white px-3 text-[12px] font-medium"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleQuery}
                disabled={loading}
                className="w-full rounded-[16px] bg-slate-900 px-3.5 py-2.5 text-[12px] font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? '查询中...' : '查询统计'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-3 rounded-[16px] border border-rose-100 bg-rose-50 px-3.5 py-2 text-[12px] font-medium text-rose-600">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-3 rounded-[16px] border border-emerald-100 bg-emerald-50 px-3.5 py-2 text-[12px] font-medium text-emerald-700">
              {message}
            </div>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center text-[13px] font-medium text-slate-400">
            请选择筛选条件后点击“查询统计”
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="text-[14px] font-black text-slate-900">用量概览</h4>
                <p className="text-[11px] font-medium text-slate-400">只保留关键结果，避免页面过重。</p>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {summaryCards.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[20px] border border-slate-200/80 bg-white/92 px-4 py-3 shadow-[0_10px_24px_rgba(148,163,184,0.08)]"
                  >
                    <p className="text-[11px] font-semibold text-slate-500">{item.label}</p>
                    <p className={`mt-1 text-[24px] font-black tracking-[-0.03em] ${item.tone}`}>{item.value}</p>
                    <p className="mt-1 text-[11px] font-medium text-slate-400">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_10px_24px_rgba(148,163,184,0.08)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[14px] font-black text-slate-900">人员用量</h4>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">按当前查询结果排序。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                      {byUser.length} 人
                    </span>
                    {byUser.length > USAGE_LIST_PREVIEW_LIMIT ? (
                      <button
                        type="button"
                        onClick={() => setShowAllUsers((prev) => !prev)}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                      >
                        {showAllUsers ? '收起' : `展开全部 (${byUser.length})`}
                      </button>
                    ) : null}
                  </div>
                </div>
                {byUser.length === 0 ? (
                  <div className="rounded-[18px] bg-slate-50 px-4 py-6 text-[12px] text-slate-400">暂无数据</div>
                ) : (
                  <div className="space-y-2">
                    {visibleUserRows.map((user) => (
                      <div key={user.userId} className="rounded-[18px] border border-slate-100 bg-slate-50/70 px-3.5 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-black text-slate-800">{user.displayName}</p>
                            <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                              成功 {user.success} · 失败 {user.failed}
                            </p>
                          </div>
                          <span className="shrink-0 text-[16px] font-black tracking-[-0.03em] text-slate-900">{user.total}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                          <div
                            className="h-full rounded-full bg-slate-900"
                            style={{ width: `${(user.total / maxUserTotal) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_10px_24px_rgba(148,163,184,0.08)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[14px] font-black text-slate-900">功能用量</h4>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">智能体已并入统一统计。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                      {byModule.length} 项
                    </span>
                    {byModule.length > USAGE_LIST_PREVIEW_LIMIT ? (
                      <button
                        type="button"
                        onClick={() => setShowAllModules((prev) => !prev)}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600"
                      >
                        {showAllModules ? '收起' : `展开全部 (${byModule.length})`}
                      </button>
                    ) : null}
                  </div>
                </div>
                {byModule.length === 0 ? (
                  <div className="rounded-[18px] bg-slate-50 px-4 py-6 text-[12px] text-slate-400">暂无数据</div>
                ) : (
                  <div className="space-y-2">
                    {visibleModuleRows.map((moduleItem) => (
                      <div key={moduleItem.module} className="rounded-[18px] border border-slate-100 bg-slate-50/70 px-3.5 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-black text-slate-800">{getModuleLabel(moduleItem.module)}</p>
                            <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                              成功 {moduleItem.success} · 失败 {moduleItem.failed}
                            </p>
                          </div>
                          <span className="shrink-0 text-[16px] font-black tracking-[-0.03em] text-slate-900">{moduleItem.total}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                          <div
                            className="h-full rounded-full bg-sky-500"
                            style={{ width: `${(moduleItem.total / maxModuleTotal) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </section>
    <ConfirmDialog
      open={confirmBackfillOpen}
      title="确认补录统计"
      message="确认从历史日志补录统计数据？此操作可能需要几秒钟。"
      confirmLabel="确认补录"
      onCancel={() => setConfirmBackfillOpen(false)}
      onConfirm={confirmBackfill}
      tone="default"
    />
    </>
  );
};

export default UsageStatsPanel;
