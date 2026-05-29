const normalizeEnvString = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const buildConfig = (env = process.env) => ({
  address: normalizeEnvString(env.MEIAO_TEMPORAL_ADDRESS || env.TEMPORAL_ADDRESS),
  namespace: normalizeEnvString(env.MEIAO_TEMPORAL_NAMESPACE || env.TEMPORAL_NAMESPACE, 'default'),
  taskQueue: normalizeEnvString(env.MEIAO_TEMPORAL_TASK_QUEUE || env.TEMPORAL_TASK_QUEUE, 'meiao-local'),
});

const defaultConnectTemporalClient = async (config) => {
  const temporal = await import('@temporalio/client');
  return new temporal.Client({
    connection: await temporal.Connection.connect({ address: config.address }),
    namespace: config.namespace,
  });
};

const buildWorkflowId = (job) => `meiao-job-${String(job?.id || '').trim()}`;

const isWorkflowAlreadyStartedError = (error) => (
  error?.name === 'WorkflowExecutionAlreadyStartedError'
  || /WorkflowExecutionAlreadyStarted|already started/i.test(String(error?.message || ''))
);

const buildWorkflowArgs = (job, options = {}) => ({
  jobId: String(job?.id || ''),
  userId: String(job?.userId || ''),
  module: String(job?.module || 'system'),
  taskType: String(job?.taskType || 'unknown'),
  provider: String(job?.provider || 'internal'),
  createdAt: Number(job?.createdAt || Date.now()),
  executionMode: options.executionMode === 'execute' ? 'execute' : 'observe',
  ledger: options.ledger === 'mysql' ? 'mysql' : 'local',
});

export const createTemporalTaskAdapter = ({
  env = process.env,
  connectTemporalClient = defaultConnectTemporalClient,
} = {}) => {
  const config = buildConfig(env);
  const configured = Boolean(config.address);
  let clientPromise = null;

  const getClient = async () => {
    if (!configured) return null;
    if (!clientPromise) {
      clientPromise = connectTemporalClient(config);
    }
    return clientPromise;
  };

  return {
    config,
    configured,

    async health() {
      if (!configured) {
        return {
          configured: false,
          reachable: false,
          address: '',
          namespace: config.namespace,
          taskQueue: config.taskQueue,
          message: 'Temporal address is not configured.',
        };
      }

      try {
        const client = await getClient();
        if (client?.workflowService?.getSystemInfo) {
          await client.workflowService.getSystemInfo({});
        }
        return {
          configured: true,
          reachable: true,
          address: config.address,
          namespace: config.namespace,
          taskQueue: config.taskQueue,
          message: 'Temporal is reachable.',
        };
      } catch (error) {
        return {
          configured: true,
          reachable: false,
          address: config.address,
          namespace: config.namespace,
          taskQueue: config.taskQueue,
          message: error?.code === 'ERR_MODULE_NOT_FOUND'
            ? '@temporalio/client is not installed in this workspace.'
            : String(error?.message || 'Temporal health check failed.'),
        };
      }
    },

    async startJobWorkflow(job, options = {}) {
      if (!configured) {
        return {
          started: false,
          workflowId: '',
          runId: '',
          code: 'temporal_not_configured',
          message: 'Temporal address is not configured.',
        };
      }

      try {
        const client = await getClient();
        const workflowId = buildWorkflowId(job);
        const handle = await client.workflow.start('meiaoTaskWorkflow', {
          taskQueue: config.taskQueue,
          workflowId,
          args: [buildWorkflowArgs(job, options)],
        });
        return {
          started: true,
          workflowId: handle.workflowId || workflowId,
          runId: handle.firstExecutionRunId || handle.runId || '',
          code: '',
          message: 'Temporal workflow started.',
        };
      } catch (error) {
        if (isWorkflowAlreadyStartedError(error)) {
          return {
            started: false,
            workflowId: buildWorkflowId(job),
            runId: '',
            code: 'temporal_workflow_already_started',
            message: 'Temporal workflow is already running for this job.',
          };
        }
        return {
          started: false,
          workflowId: buildWorkflowId(job),
          runId: '',
          code: error?.code === 'ERR_MODULE_NOT_FOUND' ? 'temporal_sdk_missing' : 'temporal_start_failed',
          message: error?.code === 'ERR_MODULE_NOT_FOUND'
            ? '@temporalio/client is not installed in this workspace.'
            : String(error?.message || 'Temporal workflow start failed.'),
        };
      }
    },
  };
};
