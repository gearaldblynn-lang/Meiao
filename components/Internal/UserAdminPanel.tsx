import React, { useEffect, useState } from 'react';
import { AuthUser } from '../../types';
import ConfirmDialog from '../ConfirmDialog';
import { createInternalUser, deleteInternalUser, fetchInternalUsers, updateInternalUser } from '../../services/internalApi';
import { shouldRefreshCurrentUser } from '../../modules/Account/accountManagementUtils.mjs';

interface Props {
  enabled: boolean;
  currentUserId?: string;
  onCurrentUserChange?: (user: AuthUser) => void;
}

const UserAdminPanel: React.FC<Props> = ({ enabled, currentUserId = '', onCurrentUserChange }) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionUserId, setActionUserId] = useState('');
  const [expandedUserId, setExpandedUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<AuthUser | null>(null);
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'staff' as 'admin' | 'staff',
    jobConcurrency: 5,
  });
  const [userConcurrencyDrafts, setUserConcurrencyDrafts] = useState<Record<string, number>>({});

  const loadUsers = async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const result = await fetchInternalUsers();
      setUsers(result.users);
      setUserConcurrencyDrafts(
        result.users.reduce<Record<string, number>>((acc, user) => {
          acc[user.id] = user.jobConcurrency;
          return acc;
        }, {})
      );
    } catch (requestError: any) {
      setError(requestError.message || '账号列表读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccessMessage('');
    try {
      await createInternalUser(form);
      setForm({ username: '', displayName: '', password: '', role: 'staff', jobConcurrency: 5 });
      await loadUsers();
      setSuccessMessage('新账号已创建。');
    } catch (requestError: any) {
      setError(requestError.message || '创建账号失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (user: AuthUser) => {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    setActionUserId(user.id);
    setError('');
    setSuccessMessage('');
    try {
      const result = await updateInternalUser(user.id, { status: nextStatus });
      if (shouldRefreshCurrentUser(currentUserId, user.id)) {
        onCurrentUserChange?.(result.user);
      }
      await loadUsers();
      setSuccessMessage(`账号 ${user.username} 已${nextStatus === 'active' ? '启用' : '禁用'}。`);
    } catch (requestError: any) {
      setError(requestError.message || '更新账号状态失败');
    } finally {
      setActionUserId('');
    }
  };

  const handleResetPassword = async (user: AuthUser) => {
    const newPassword = resetPassword.trim();
    if (!newPassword) {
      setError('请输入新密码后再确认重置。');
      return;
    }

    setActionUserId(user.id);
    setError('');
    setSuccessMessage('');
    try {
      const result = await updateInternalUser(user.id, { password: newPassword });
      if (shouldRefreshCurrentUser(currentUserId, user.id)) {
        onCurrentUserChange?.(result.user);
      }
      await loadUsers();
      setResetPassword('');
      setExpandedUserId('');
      setSuccessMessage(`账号 ${user.username} 的密码已重置。`);
    } catch (requestError: any) {
      setError(requestError.message || '重置密码失败');
    } finally {
      setActionUserId('');
    }
  };

  const handleDeleteUser = async (user: AuthUser) => {
    setConfirmDeleteUser(user);
  };

  const confirmDeleteSelectedUser = async () => {
    const user = confirmDeleteUser;
    if (!user) return;
    setConfirmDeleteUser(null);
    setActionUserId(user.id);
    setError('');
    setSuccessMessage('');
    try {
      await deleteInternalUser(user.id);
      await loadUsers();
      setExpandedUserId('');
      setSuccessMessage(`账号 ${user.username} 已删除。`);
    } catch (requestError: any) {
      setError(requestError.message || '删除账号失败');
    } finally {
      setActionUserId('');
    }
  };

  const handleSaveConcurrency = async (user: AuthUser) => {
    const nextConcurrency = Math.max(1, Math.floor(Number(userConcurrencyDrafts[user.id] || user.jobConcurrency || 1)));
    setActionUserId(user.id);
    setError('');
    setSuccessMessage('');
    try {
      const result = await updateInternalUser(user.id, { jobConcurrency: nextConcurrency });
      if (shouldRefreshCurrentUser(currentUserId, user.id)) {
        onCurrentUserChange?.(result.user);
      }
      await loadUsers();
      setSuccessMessage(`账号 ${user.username} 的并发数已更新为 ${nextConcurrency}。`);
    } catch (requestError: any) {
      setError(requestError.message || '更新账号并发数失败');
    } finally {
      setActionUserId('');
    }
  };

  return (
    <section className="mt-8">
      <div className="grid xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
        <form onSubmit={handleCreate} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
          <div>
            <h3 className="text-lg font-black text-slate-800">新建账号</h3>
            <p className="mt-1 text-xs text-slate-400">默认并发 5，可在创建后继续单独调整。</p>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">登录用户名</label>
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="例如：xiaoli"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">显示名称</label>
            <input
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="例如：小李"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">初始密码</label>
            <input
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="至少自己记得住"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">账号角色</label>
              <select
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'staff' })}
                className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="staff">员工</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">并发</label>
              <input
                type="number"
                min={1}
                step={1}
                value={form.jobConcurrency}
                onChange={(event) => setForm({ ...form, jobConcurrency: Math.max(1, Number(event.target.value || 1)) })}
                className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
              {error}
            </div>
          ) : null}

          {successMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
              {successMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-slate-900 text-white py-3 text-sm font-black hover:bg-slate-800 transition-colors disabled:opacity-60"
          >
            {submitting ? '创建中...' : '创建新账号'}
          </button>
        </form>

        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-black text-slate-800">账号列表</h4>
              <p className="text-xs text-slate-400 mt-1">默认紧凑显示，按需展开单个账号操作。</p>
            </div>
            <button onClick={() => void loadUsers()} className="text-xs font-black text-slate-500 hover:text-slate-900">
              刷新
            </button>
          </div>

          <div className="max-h-[min(560px,calc(100vh-260px))] overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <div className="px-6 py-5 text-sm font-bold text-slate-400">正在读取账号列表...</div>
            ) : users.length === 0 ? (
              <div className="px-6 py-5 text-sm font-bold text-slate-400">还没有创建其他账号</div>
            ) : (
              users.map((user) => {
                const expanded = expandedUserId === user.id;
                return (
                  <div key={user.id} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate">{user.displayName || user.username}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {user.username} · {user.role === 'admin' ? '管理员' : '员工'} · {user.status === 'active' ? '启用中' : '已禁用'} · 并发 {user.jobConcurrency}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => void handleToggleStatus(user)}
                          disabled={actionUserId === user.id}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors ${user.status === 'active' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-60`}
                        >
                          {actionUserId === user.id ? '处理中...' : user.status === 'active' ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => {
                            setExpandedUserId(expanded ? '' : user.id);
                            setResetPassword('');
                            setError('');
                            setSuccessMessage('');
                          }}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                        >
                          {expanded ? '收起' : '展开'}
                        </button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">账号并发</label>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={userConcurrencyDrafts[user.id] ?? user.jobConcurrency}
                              onChange={(event) => setUserConcurrencyDrafts((prev) => ({
                                ...prev,
                                [user.id]: Math.max(1, Number(event.target.value || 1)),
                              }))}
                              className="mt-1 w-28 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>
                          <button
                            onClick={() => void handleSaveConcurrency(user)}
                            disabled={actionUserId === user.id || (userConcurrencyDrafts[user.id] ?? user.jobConcurrency) === user.jobConcurrency}
                            className="px-4 py-2.5 rounded-xl text-xs font-black bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-60"
                          >
                            {actionUserId === user.id ? '保存中...' : '保存并发'}
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <input
                            type="password"
                            value={resetPassword}
                            onChange={(event) => setResetPassword(event.target.value)}
                            className="flex-1 min-w-[220px] bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                            placeholder={`给 ${user.username} 输入新密码`}
                          />
                          <button
                            onClick={() => void handleResetPassword(user)}
                            disabled={actionUserId === user.id}
                            className="px-4 py-2.5 rounded-xl text-xs font-black bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-60"
                          >
                            {actionUserId === user.id ? '处理中...' : '重置密码'}
                          </button>
                          <button
                            onClick={() => void handleDeleteUser(user)}
                            disabled={actionUserId === user.id}
                            className="px-4 py-2.5 rounded-xl text-xs font-black bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-60"
                          >
                            删除账号
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirmDeleteUser)}
        title="确认删除账号"
        message={confirmDeleteUser ? `确定删除账号 ${confirmDeleteUser.username} 吗？该账号的工作台数据也会一起删除。` : ''}
        confirmLabel="确认删除账号"
        onCancel={() => setConfirmDeleteUser(null)}
        onConfirm={confirmDeleteSelectedUser}
      />
    </section>
  );
};

export default UserAdminPanel;
