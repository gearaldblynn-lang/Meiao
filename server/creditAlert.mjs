// KIE 等上游余额不足预警(S3)。
// 背景:云上7天"余额不足×6+积分不足×5"只出现在日志里,管理员毫无感知。
// 设计:错误驱动 + 内存状态 + 节流显著日志;/api/health 附快照供管理员查看。
// 注意:进程内存状态,重启即清零——预警是"最近有没有撞到余额墙"的信号,不是持久账本。

const DEFAULT_THROTTLE_MS = 3600000;

const alertState = new Map();

const getThrottleMs = () => {
  const raw = Number(process.env.MEIAO_CREDIT_ALERT_THROTTLE_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_THROTTLE_MS;
};

export const resetCreditAlertStateForTest = () => {
  alertState.clear();
};

export const recordCreditAlert = ({ provider = 'unknown', message = '', now = Date.now() } = {}) => {
  const key = String(provider || 'unknown').trim() || 'unknown';
  const entry = alertState.get(key) || { count: 0, lastAt: 0, lastMessage: '', lastProminentAt: 0 };
  entry.count += 1;
  entry.lastAt = now;
  entry.lastMessage = String(message || '');

  const throttleMs = getThrottleMs();
  const shouldLogProminent = !entry.lastProminentAt || now - entry.lastProminentAt >= throttleMs;
  if (shouldLogProminent) {
    entry.lastProminentAt = now;
  }
  alertState.set(key, entry);
  return { shouldLogProminent };
};

export const getCreditAlertSnapshot = ({ now = Date.now() } = {}) => {
  const snapshot = {};
  for (const [provider, entry] of alertState.entries()) {
    snapshot[provider] = {
      lastAt: entry.lastAt,
      count: entry.count,
      lastMessage: entry.lastMessage,
      ageMs: Math.max(0, now - entry.lastAt),
    };
  }
  return snapshot;
};

// 失败链路的单一接入函数:非余额错误零开销直返;createLog 异常绝不向外传播(预警不许破坏主链路)。
export const maybeRecordCreditAlertLog = async ({ error, job, user, createLog, now = Date.now() } = {}) => {
  if (String(error?.code || '') !== 'provider_credit_insufficient') return;
  const provider = String(job?.provider || error?.provider || 'kie').trim() || 'kie';
  const { shouldLogProminent } = recordCreditAlert({ provider, message: error?.message || '', now });
  if (!shouldLogProminent || typeof createLog !== 'function') return;
  try {
    await createLog({
      user: user || null,
      level: 'error',
      module: 'provider',
      action: 'credit_alert',
      message: `${provider} 余额不足:生成服务无法继续,请尽快充值(最近报错:${String(error?.message || '').slice(0, 120)})`,
      detail: String(error?.message || ''),
      status: 'failed',
      meta: { provider, alertKind: 'credit_insufficient' },
    });
  } catch {
    // 预警日志失败不影响任务失败主链路
  }
};
