import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSubtitleRemovalRetryDecision,
  isSubtitleRemovalJobCreationUnknown,
} from './subtitleRemovalRetrySafety.mjs';

test('network, timeout and server failures leave subtitle job creation in an unknown state', () => {
  assert.equal(isSubtitleRemovalJobCreationUnknown({ code: 'network_error', status: 0 }), true);
  assert.equal(isSubtitleRemovalJobCreationUnknown({ code: 'timeout', status: 408 }), true);
  assert.equal(isSubtitleRemovalJobCreationUnknown({ code: 'server_error', status: 503 }), true);
  assert.equal(isSubtitleRemovalJobCreationUnknown({ code: 'request_failed', status: 400 }), false);
  assert.equal(isSubtitleRemovalJobCreationUnknown({ code: 'rate_limited', status: 429 }), false);
});

test('unknown subtitle submissions are blocked while every other failed retry needs confirmation', () => {
  assert.deepEqual(
    getSubtitleRemovalRetryDecision({ errorCode: 'job_creation_unknown' }),
    { mode: 'blocked_unknown' },
  );
  assert.deepEqual(
    getSubtitleRemovalRetryDecision({ errorCode: 'provider_submission_unknown' }),
    { mode: 'blocked_unknown' },
  );
  assert.deepEqual(
    getSubtitleRemovalRetryDecision({ errorCode: 'provider_submission_released', backendJobId: 'job-1' }),
    { mode: 'confirm_required' },
  );
  assert.deepEqual(
    getSubtitleRemovalRetryDecision({ errorCode: 'subtitle_job_create_failed' }),
    { mode: 'confirm_required' },
  );
});
