import React, { useEffect, useState } from 'react';
import { MODULE_LABELS } from '../../services/loggingService';
import { fetchUsageStats, backfillUsageStats } from '../../services/internalApi';

const USAGE_MODULE_IDS = ['one_click', 'translation', 'buyer_show', 'retouch', 'video'];

const UsageStatsPanel: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [knownUsers, setKnownUsers] = useState<Array<{ id: string; label: string }>>([]);

  // 预加载用户列表
  useEffect(() => {
    void (async () => {
      try {
        const allResult = await fetchUsageStats({});
        const userMap = new Map<string, string>();
        for (const r of allResult.rows) {
          if (!userMap.has(r.userId)) userMap.set(r.userId, r.displayName || r.username);
        }
        setKnownUsers(Array.from(userMap.entries()).map(([id, label]) => ({ id, label })));
      } catch { /* 静默 */ }
    })();
  }, []);

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
      // 查询后也更新用户列表
      const userMap = new Map<string, string>();
      for (const r of result.rows) {
        if (!userMap.has(r.userId)) userMap.set(r.userId, r.displayName || r.username);
      }
      const newUsers = Array.from(userMap.entries()).map(([id, label]) => ({ id, label }));
      if (newUsers.length > knownUsers.length) setKnownUsers(newUsers);
      setMessage(`查询到 ${result.rows.length} 条统计记录`);
    } catch (err: any) {
      setError(err.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBackfill = async () => {
    if (!window.confirm('确认从历史日志补录统计数据？此操作可能需要几秒钟。')) return;
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

  const overview = rows.reduce((acc, r) => {
    acc.success += r.successCount;
    acc.failed += r.failedCount;
    acc.interrupted += r.interruptedCount;
    return acc;
  }, { success: 0, failed: 0, interrupted: 0 });
  const totalFinished = overview.success + overview.failed;
  const rate = totalFinished > 0 ? ((overview.success / totalFinished) * 100).toFixed(1) + '%' : '--';

  const byUser = Object.values(
    rows.reduce((acc: any, r) => {
      if (!acc[r.userId]) acc[r.userId] = { userId: r.userId, displayName: r.displayName, total: 0, success: 0, failed: 0 };
      acc[r.userId].total += r.successCount + r.failedCount;
      acc[r.userId].success += r.successCount;
      acc[r.userId].failed += r.failedCount;
      return acc;
    }, {})
  ).sort((a: any, b: any) => b.total - a.total);

  const byModule = Object.values(
    rows.reduce((acc: any, r) => {
      if (!acc[r.module]) acc[r.module] = { module: r.module, total: 0, success: 0, failed: 0 };
      acc[r.module].total += r.successCount + r.failedCount;
      acc[r.module].success += r.successCount;
      acc[r.module].failed += r.failedCount;
      return acc;
    }, {})
  ).sort((a: any, b: any) => b.total - a.total);

  const byDate = Object.values(
    rows.reduce((acc: any, r) => {
      if (!acc[r.statDate]) acc[r.statDate] = { date: r.statDate, success: 0, failed: 0 };
      acc[r.statDate].success += r.successCount;
      acc[r.statDate].failed += r.failedCount;
      return acc;
    }, {})
  ).sort((a: any, b: any) => a.date.localeCompare(b.date)) as Array<{ date: string; success: number; failed: number }>;
  const maxDaily = Math.max(1, ...byDate.map((d) => d.success + d.failed));

  const getModuleLabel = (id: string) => MODULE_LABELS[id] || id;

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
            <i className="fas fa-chart-bar text-xl"></i>
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-800">用量统计</h3>
            <p className="text-xs text-slate-400">永久记录，按日期/人员/模块聚合</p>
          </div>
        </div>
        <button onClick={handleBackfill} disabled={loading} className="px-4 py-2 rounded-xl text-xs font-black bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-60">
          补录历史数据
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden mb-6">
        <div className="px-6 py-5 bg-slate-50">
          <div className="grid md:grid-cols-5 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">开始日期</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">结束日期</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">按人员筛选</label>
              <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none">
                <option value="all">全部人员</option>
                {knownUsers.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">按功能筛选</label>
              <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none">
                <option value="all">全部功能</option>
                {USAGE_MODULE_IDS.map((m) => <option key={m} value={m}>{getModuleLabel(m)}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={handleQuery} disabled={loading} className="w-full px-4 py-2.5 rounded-xl text-xs font-black bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60">
                {loading ? '查询中...' : '查询统计'}
              </button>
            </div>
          </div>
        </div>
        {error && <div className="px-6 py-4 text-sm font-bold text-rose-600 bg-rose-50 border-t border-rose-100">{error}</div>}
        {message && <div className="px-6 py-4 text-sm font-bold text-emerald-700 bg-emerald-50 border-t border-emerald-100">{message}</div>}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-400">请选择筛选条件后点击「查询统计」</div>
      ) : (
        <>
          {/* 总览卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-900 px-5 py-4 text-white">
              <p className="text-[10px] font-black uppercase tracking-wider opacity-60">生图总量</p>
              <p className="mt-2 text-3xl font-black">{totalFinished}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">成功</p>
              <p className="mt-2 text-3xl font-black text-emerald-700">{overview.success}</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">失败</p>
              <p className="mt-2 text-3xl font-black text-rose-700">{overview.failed}</p>
            </div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">成功率</p>
              <p className="mt-2 text-3xl font-black text-indigo-700">{rate}</p>
            </div>
          </div>

          {/* 日趋势柱状图 */}
          {byDate.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden mb-6">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
                <h4 className="text-sm font-black text-slate-700"><i className="fas fa-chart-line mr-2 text-slate-400"></i>每日趋势</h4>
              </div>
              <div className="px-6 py-5">
                <div className="flex items-end gap-1 h-40" style={{ minWidth: byDate.length * 28 }}>
                  {byDate.map((d) => {
                    const total = d.success + d.failed;
                    const successH = (d.success / maxDaily) * 100;
                    const failedH = (d.failed / maxDaily) * 100;
                    return (
                      <div key={d.date} className="flex-1 min-w-[20px] max-w-[48px] flex flex-col items-center gap-0.5 group relative">
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap z-10">
                          {d.date.slice(5)} · {total}次
                        </div>
                        <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                          {failedH > 0 && <div className="w-full bg-rose-400 rounded-t" style={{ height: `${failedH}%`, minHeight: failedH > 0 ? 2 : 0 }}></div>}
                          {successH > 0 && <div className={`w-full bg-emerald-400 ${failedH > 0 ? '' : 'rounded-t'} rounded-b`} style={{ height: `${successH}%`, minHeight: successH > 0 ? 2 : 0 }}></div>}
                        </div>
                        <span className="text-[9px] text-slate-400 mt-1 truncate w-full text-center">{d.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3 justify-end">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500"><span className="w-2.5 h-2.5 rounded bg-emerald-400"></span>成功</span>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500"><span className="w-2.5 h-2.5 rounded bg-rose-400"></span>失败</span>
                </div>
              </div>
            </div>
          )}

          {/* 人员用量 + 模块用量 */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
                <h4 className="text-sm font-black text-slate-700"><i className="fas fa-users mr-2 text-slate-400"></i>人员用量</h4>
              </div>
              {byUser.length === 0 ? (
                <div className="px-6 py-5 text-sm text-slate-400">暂无数据</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  <div className="grid grid-cols-5 px-6 py-3 text-[10px] font-black text-slate-500 uppercase">
                    <span className="col-span-2">人员</span><span>总数</span><span>成功</span><span>失败</span>
                  </div>
                  {byUser.map((u: any) => {
                    const maxUserTotal = Math.max(1, ...(byUser as any[]).map((x: any) => x.total));
                    const barW = (u.total / maxUserTotal) * 100;
                    return (
                      <div key={u.userId} className="px-6 py-3">
                        <div className="grid grid-cols-5 text-sm items-center">
                          <span className="col-span-2 font-bold text-slate-700 truncate">{u.displayName}</span>
                          <span className="font-black text-slate-800">{u.total}</span>
                          <span className="font-bold text-emerald-600">{u.success}</span>
                          <span className="font-bold text-rose-600">{u.failed}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${barW}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
                <h4 className="text-sm font-black text-slate-700"><i className="fas fa-th-large mr-2 text-slate-400"></i>模块用量</h4>
              </div>
              {byModule.length === 0 ? (
                <div className="px-6 py-5 text-sm text-slate-400">暂无数据</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  <div className="grid grid-cols-4 px-6 py-3 text-[10px] font-black text-slate-500 uppercase">
                    <span>模块</span><span>总数</span><span>成功</span><span>失败</span>
                  </div>
                  {byModule.map((m: any) => {
                    const maxModTotal = Math.max(1, ...(byModule as any[]).map((x: any) => x.total));
                    const barW = (m.total / maxModTotal) * 100;
                    return (
                      <div key={m.module} className="px-6 py-3">
                        <div className="grid grid-cols-4 text-sm items-center">
                          <span className="font-bold text-slate-700">{getModuleLabel(m.module)}</span>
                          <span className="font-black text-slate-800">{m.total}</span>
                          <span className="font-bold text-emerald-600">{m.success}</span>
                          <span className="font-bold text-rose-600">{m.failed}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-fuchsia-400 rounded-full transition-all" style={{ width: `${barW}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default UsageStatsPanel;
