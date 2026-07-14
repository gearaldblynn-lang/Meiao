import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveJobSubmissionPolicy } from './jobSubmissionPolicy.mjs';

const ROLLOUT_ERROR = Object.freeze({
  code: 'product_restore_rollout_forbidden',
  message: '产品还原当前未对该账号开放，历史项目仍可查看。',
  statusCode: 403,
});

const PRODUCT_RESTORE_SHAPES = Object.freeze([
  {
    name: 'analysis',
    taskType: 'kie_chat',
    provider: 'kie',
    payload: {
      subFeature: 'product_restore',
      taskPurpose: 'product_restore_analysis',
    },
  },
  {
    name: 'generation',
    taskType: 'kie_image',
    provider: 'kie',
    payload: {
      taskPurpose: 'product_restore_generation',
    },
  },
]);

const assertRolloutRejected = (run, label) => {
  assert.throws(
    run,
    (error) => {
      assert.equal(error?.code, ROLLOUT_ERROR.code, label);
      assert.equal(error?.message, ROLLOUT_ERROR.message, label);
      assert.equal(error?.statusCode, ROLLOUT_ERROR.statusCode, label);
      return true;
    },
    label,
  );
};

test('Product Restoration analysis and generation obey the full rollout-role matrix', () => {
  const matrix = [
    { rollout: 'off', role: 'admin', allowed: false },
    { rollout: 'off', role: 'staff', allowed: false },
    { rollout: 'admin', role: 'admin', allowed: true },
    { rollout: 'admin', role: 'staff', allowed: false },
    { rollout: 'all', role: 'admin', allowed: true },
    { rollout: 'all', role: 'staff', allowed: true },
  ];

  for (const shape of PRODUCT_RESTORE_SHAPES) {
    for (const entry of matrix) {
      const input = {
        module: ' ReToUcH ',
        taskType: shape.taskType,
        provider: shape.provider,
        payload: shape.payload,
        userRole: entry.role,
        productRestoreRollout: entry.rollout,
      };
      const label = `${shape.name}:${entry.rollout}:${entry.role}`;
      if (entry.allowed) {
        const policy = resolveJobSubmissionPolicy(input);
        assert.equal(policy.taskType, shape.taskType, label);
        assert.equal(policy.provider, shape.provider, label);
      } else {
        assertRolloutRejected(() => resolveJobSubmissionPolicy(input), label);
      }
    }
  }
});

test('missing and invalid rollout values fail closed for every Product Restoration job shape', () => {
  for (const shape of PRODUCT_RESTORE_SHAPES) {
    for (const rollout of [undefined, '', 'beta', 'ADMIN_ONLY']) {
      assertRolloutRejected(
        () => resolveJobSubmissionPolicy({
          module: 'retouch',
          taskType: shape.taskType,
          provider: shape.provider,
          payload: shape.payload,
          userRole: 'admin',
          productRestoreRollout: rollout,
        }),
        `${shape.name}:${String(rollout)}`,
      );
    }
  }
});

test('ordinary Retouch and other modules remain compatible when Product Restoration rollout is off', () => {
  const ordinaryRetouch = resolveJobSubmissionPolicy({
    module: 'retouch',
    taskType: 'kie_chat',
    provider: 'kie',
    payload: { subFeature: 'original', taskPurpose: 'retouch_analysis' },
    userRole: 'staff',
    productRestoreRollout: 'off',
  });
  assert.equal(ordinaryRetouch.taskType, 'kie_chat');

  const otherModule = resolveJobSubmissionPolicy({
    module: 'translation',
    taskType: 'kie_image',
    provider: 'kie',
    payload: {
      subFeature: 'product_restore',
      taskPurpose: 'product_restore_generation',
    },
    userRole: 'staff',
    productRestoreRollout: 'off',
  });
  assert.equal(otherModule.taskType, 'kie_image');
});

test('historical provider-task recovery is not treated as a new Product Restoration creation', () => {
  const policy = resolveJobSubmissionPolicy({
    module: 'retouch',
    taskType: 'kie_recover',
    provider: 'kie',
    payload: {
      subFeature: 'product_restore',
      taskPurpose: 'product_restore_generation',
    },
    userRole: 'staff',
    productRestoreRollout: 'off',
    submissionOperation: 'recover',
  });

  assert.equal(policy.taskType, 'kie_recover');
  assert.equal(policy.provider, 'kie');
});

test('only the kie_recover task type can use the historical recovery exemption', () => {
  assertRolloutRejected(
    () => resolveJobSubmissionPolicy({
      module: 'retouch',
      taskType: 'kie_image',
      provider: 'kie',
      payload: { taskPurpose: 'product_restore_generation' },
      userRole: 'staff',
      productRestoreRollout: 'off',
      submissionOperation: 'recover',
    }),
    'generation job cannot claim recovery exemption',
  );
});

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const extractRouteBlock = (handlerSource, method) => {
  const startMarker = `if (url.pathname === '/api/jobs' && req.method === '${method}')`;
  const start = handlerSource.indexOf(startMarker);
  assert.notEqual(start, -1, `${method} /api/jobs route must exist`);
  const nextRoute = handlerSource.indexOf("if (url.pathname === '/api/jobs'", start + startMarker.length);
  return handlerSource.slice(start, nextRoute === -1 ? handlerSource.length : nextRoute);
};

test('MySQL and local POST authorities enforce rollout before dedupe, reservation, and creation', () => {
  const mysqlStart = source.indexOf('const handleMysqlRequest =');
  const localStart = source.indexOf('const handleLocalRequest =');
  assert.ok(mysqlStart >= 0 && localStart > mysqlStart);
  const mysqlHandler = source.slice(mysqlStart, localStart);
  const localHandler = source.slice(localStart);
  const mysqlPost = extractRouteBlock(mysqlHandler, 'POST');
  const localPost = extractRouteBlock(localHandler, 'POST');

  const assertBefore = (route, first, later, label) => {
    const firstIndex = route.indexOf(first);
    const laterIndex = route.indexOf(later);
    assert.notEqual(firstIndex, -1, `${label}: missing ${first}`);
    assert.notEqual(laterIndex, -1, `${label}: missing ${later}`);
    assert.ok(firstIndex < laterIndex, `${label}: ${first} must run before ${later}`);
  };

  for (const later of [
    'findReusableJobRecord',
    'reserveDbJobCreditsForSubmission',
    'createDbJobRecordWithReservation',
  ]) {
    assertBefore(mysqlPost, 'resolveAuthorizedJobSubmissionPolicy(user, body)', later, `mysql:${later}`);
  }
  for (const later of [
    'findReusableLocalJobRecord',
    'reserveLocalJobCredits',
    'createLocalJobRecord',
  ]) {
    assertBefore(localPost, 'resolveAuthorizedJobSubmissionPolicy(user, body)', later, `local:${later}`);
  }

  assert.match(source, /userRole:\s*user\?\.role/);
  assert.match(source, /productRestoreRollout:\s*process\.env\.MEIAO_PRODUCT_RESTORE_ROLLOUT/);
  assert.match(source, /submissionOperation:\s*body\?\.taskType === 'kie_recover' \? 'recover' : 'create'/);
});

test('historical GET routes do not invoke the new-creation submission authority', () => {
  const mysqlStart = source.indexOf('const handleMysqlRequest =');
  const localStart = source.indexOf('const handleLocalRequest =');
  const extractListGetBlock = (handlerSource) => {
    const start = handlerSource.indexOf("if (url.pathname === '/api/jobs' && req.method === 'GET')");
    const end = handlerSource.indexOf('const jobDetailMatch', start);
    assert.ok(start >= 0 && end > start);
    return handlerSource.slice(start, end);
  };
  const mysqlGet = extractListGetBlock(source.slice(mysqlStart, localStart));
  const localGet = extractListGetBlock(source.slice(localStart));

  assert.doesNotMatch(mysqlGet, /resolveAuthorizedJobSubmissionPolicy/);
  assert.doesNotMatch(localGet, /resolveAuthorizedJobSubmissionPolicy/);
});
