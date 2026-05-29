import { proxyActivities, sleep, workflowInfo } from '@temporalio/workflow';

const { executeLocalJobAttemptActivity, executeMysqlJobAttemptActivity } = proxyActivities({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
    maximumAttempts: 3,
  },
});

export async function meiaoTaskWorkflow(input) {
  if (input?.executionMode !== 'execute') {
    return {
      jobId: String(input?.jobId || ''),
      status: 'observed',
      executionMode: input?.executionMode || 'observe',
    };
  }

  const info = workflowInfo();
  const activityInput = {
    ...input,
    workflowId: info.workflowId,
    runId: info.runId,
  };
  const executeJobAttempt = input?.ledger === 'mysql'
    ? executeMysqlJobAttemptActivity
    : executeLocalJobAttemptActivity;

  while (true) {
    const result = await executeJobAttempt(activityInput);
    if (!['queued', 'retry_waiting'].includes(String(result?.status || ''))) {
      return result;
    }
    await sleep('5 seconds');
  }
}
