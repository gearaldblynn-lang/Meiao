const UNKNOWN_SUBMISSION_CODES = new Set([
  'job_creation_unknown',
  'provider_submission_unknown',
]);

const UNKNOWN_JOB_CREATION_CODES = new Set([
  'network_error',
  'server_error',
  'timeout',
]);

export const isSubtitleRemovalJobCreationUnknown = (error) => {
  const code = String(error?.code || '').trim();
  const status = Number(error?.status);
  return UNKNOWN_JOB_CREATION_CODES.has(code)
    || status === 0
    || status === 408
    || status >= 500;
};

export const getSubtitleRemovalRetryDecision = ({ errorCode = '' } = {}) => (
  UNKNOWN_SUBMISSION_CODES.has(String(errorCode || '').trim())
    ? { mode: 'blocked_unknown' }
    : { mode: 'confirm_required' }
);
