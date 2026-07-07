// S4 治本一环:前端主动探测新版本,长驻标签页不再靠"踩到 chunk 404"才被动发现新版。
// 逻辑:定时 + 页面回到前台时拉 /version.json(no-cache),buildId 与编译进 bundle 的
// __BUILD_ID__ 不一致 → 通知调用方。是否立即刷新由调用方决定(有活跃任务时只提示不打断)。
// 单一职责:本文件只做"探测 + 判定",不直接 reload。

export const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface VersionWatchOptions {
  currentBuildId: string;
  fetchVersion?: () => Promise<{ buildId?: string } | null>;
  intervalMs?: number;
  onNewVersion: (remoteBuildId: string) => void;
}

export const defaultFetchVersion = async (): Promise<{ buildId?: string } | null> => {
  try {
    const response = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as { buildId?: string };
  } catch {
    // 网络瞬断/部署窗口内拉不到都不算新版本,静默等下一轮
    return null;
  }
};

// 纯判定:远端 buildId 有值且与本地不同才算新版本(拉不到/为空一律不是)。
export const isNewVersion = (currentBuildId: string, remote: { buildId?: string } | null): boolean => {
  const remoteId = String(remote?.buildId || '').trim();
  return Boolean(remoteId) && remoteId !== String(currentBuildId || '').trim();
};

export const startVersionWatch = (options: VersionWatchOptions): (() => void) => {
  const fetchVersion = options.fetchVersion || defaultFetchVersion;
  const intervalMs = options.intervalMs || VERSION_POLL_INTERVAL_MS;
  let stopped = false;
  let notified = false;

  const check = async () => {
    if (stopped || notified) return;
    const remote = await fetchVersion();
    if (stopped || notified) return;
    if (isNewVersion(options.currentBuildId, remote)) {
      notified = true;
      options.onNewVersion(String(remote?.buildId));
    }
  };

  const timer = setInterval(() => { void check(); }, intervalMs);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
};
