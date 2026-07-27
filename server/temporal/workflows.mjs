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
const defaultActivities = { executeLocalJobAttemptActivity, executeMysqlJobAttemptActivity };
const singleAttemptActivities = proxyActivities({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    maximumAttempts: 1,
  },
});
const SINGLE_ATTEMPT_PROVIDERS = new Set(['maxforai', 'golden_subtitle']);
const SINGLE_ATTEMPT_TASK_TYPES = new Set(['voiceover_translate_video']);

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
  const activities = (
    SINGLE_ATTEMPT_PROVIDERS.has(String(input?.provider || ''))
    || SINGLE_ATTEMPT_TASK_TYPES.has(String(input?.taskType || ''))
  )
    ? singleAttemptActivities
    : defaultActivities;
  const executeJobAttempt = input?.ledger === 'mysql'
    ? activities.executeMysqlJobAttemptActivity
    : activities.executeLocalJobAttemptActivity;

  while (true) {
    const result = await executeJobAttempt(activityInput);
    if (!['queued', 'retry_waiting'].includes(String(result?.status || ''))) {
      return result;
    }
    await sleep('5 seconds');
  }
}
