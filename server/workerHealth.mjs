// Temporal worker 健康探测(S1 止血):
// 后台症结是 worker poller 静默死亡——HTTP 服务活着、/api/health 报 ok,但任务永远 queued。
// 这里用 gRPC describeTaskQueue 查 task queue 上有没有活的 poller,暴露给 /api/health 和 local-dev 体检。

const TASK_QUEUE_TYPE_WORKFLOW = 1;
const TASK_QUEUE_TYPE_ACTIVITY = 2;

const DEFAULT_CACHE_TTL_MS = 10000;
const DEFAULT_RPC_TIMEOUT_MS = 5000;

const normalizeEnvString = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const resolveTemporalEnvConfig = (env = process.env) => ({
  // 与 server/temporalTaskAdapter.mjs buildConfig 保持同一套 env 读法
  address: normalizeEnvString(env.MEIAO_TEMPORAL_ADDRESS || env.TEMPORAL_ADDRESS),
  namespace: normalizeEnvString(env.MEIAO_TEMPORAL_NAMESPACE || env.TEMPORAL_NAMESPACE, 'default'),
  taskQueue: normalizeEnvString(env.MEIAO_TEMPORAL_TASK_QUEUE || env.TEMPORAL_TASK_QUEUE, 'meiao-local'),
});

const withTimeout = async (promise, timeoutMs) => {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`temporal worker 健康检查超时(${timeoutMs}ms)`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const countPollers = (response) => (Array.isArray(response?.pollers) ? response.pollers.length : 0);

// 核心纯函数:依赖注入,不真连 Temporal。
// deps: {
//   describeTaskQueue: async ({namespace, taskQueue:{name}, taskQueueType}) => ({pollers:[...]})
//   namespace / taskQueue: 目标队列
//   now: 时间函数(测试注入)
//   cache: 可变对象,同一实例内做 TTL 缓存
//   cacheTtlMs / rpcTimeoutMs
// }
// 返回值永不抛错:
//   有任一 poller → {healthy:true, workflowPollers, activityPollers, checkedAt}
//   全空          → {healthy:false, workflowPollers:0, activityPollers:0, checkedAt}
//   探测失败      → {healthy:false, error:'<message>', checkedAt}
export const checkTemporalWorkerHealth = async (deps = {}) => {
  const {
    describeTaskQueue,
    namespace = 'default',
    taskQueue = 'meiao-local',
    now = Date.now,
    cache = null,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    rpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  } = deps;

  const currentTime = now();
  if (
    cache
    && cache.result
    && Number.isFinite(cache.checkedAt)
    && currentTime - cache.checkedAt < cacheTtlMs
  ) {
    return cache.result;
  }

  let result;
  try {
    if (typeof describeTaskQueue !== 'function') {
      throw new Error('describeTaskQueue 依赖缺失');
    }
    const describe = (taskQueueType) => describeTaskQueue({
      namespace,
      taskQueue: { name: taskQueue },
      taskQueueType,
    });
    const [workflowResponse, activityResponse] = await withTimeout(
      Promise.all([describe(TASK_QUEUE_TYPE_WORKFLOW), describe(TASK_QUEUE_TYPE_ACTIVITY)]),
      rpcTimeoutMs
    );
    const workflowPollers = countPollers(workflowResponse);
    const activityPollers = countPollers(activityResponse);
    result = {
      healthy: workflowPollers > 0 || activityPollers > 0,
      workflowPollers,
      activityPollers,
      checkedAt: currentTime,
    };
  } catch (error) {
    result = {
      healthy: false,
      error: String(error?.message || error),
      checkedAt: currentTime,
    };
  }

  if (cache) {
    cache.result = result;
    cache.checkedAt = currentTime;
  }
  return result;
};

// ---- 生产封装:懒加载 @temporalio/client,连接失败同样降级为 {healthy:false, error} ----

let connectionPromise = null;
const snapshotCache = {};

const getTemporalConnection = async (address) => {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const temporal = await import('@temporalio/client');
      return temporal.Connection.connect({ address });
    })().catch((error) => {
      // 连接失败不要缓存失败的 promise,下次调用重试
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
};

const resolveCacheTtlMs = (env = process.env) => {
  const parsed = Number(env.MEIAO_WORKER_HEALTH_CACHE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
};

export const getWorkerHealthSnapshot = async (env = process.env) => {
  const config = resolveTemporalEnvConfig(env);
  if (!config.address) {
    // 与 temporalTaskAdapter 同语义:address 未配置时 Temporal worker 根本不会启动,
    // 而 taskEngine=temporal 时进程内 jobWorker 也不启动 → 任务必卡,如实报不健康。
    return {
      healthy: false,
      error: 'Temporal address is not configured.',
      checkedAt: Date.now(),
    };
  }
  return checkTemporalWorkerHealth({
    describeTaskQueue: async (request) => {
      const connection = await getTemporalConnection(config.address);
      return connection.workflowService.describeTaskQueue(request);
    },
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    cache: snapshotCache,
    cacheTtlMs: resolveCacheTtlMs(env),
  });
};
