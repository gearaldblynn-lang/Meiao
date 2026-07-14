import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveJobSubmissionPolicy } from './jobSubmissionPolicy.mjs';
import { createAuthorizedProviderRecovery } from './jobRecoveryService.mjs';

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

test('conflicting top-level and payload markers cannot hide Product Restoration', () => {
  const shapes = [
    { name: 'analysis', taskType: 'kie_chat', purpose: 'product_restore_analysis' },
    { name: 'generation', taskType: 'kie_image', purpose: 'product_restore_generation' },
  ];
  const rollouts = ['off', undefined, 'invalid'];

  for (const shape of shapes) {
    const conflicts = [
      {
        name: 'payload subFeature survives top-level decoy',
        subFeature: 'original',
        taskPurpose: 'retouch_analysis',
        payload: { subFeature: 'product_restore', taskPurpose: 'retouch_analysis' },
      },
      {
        name: 'top-level subFeature survives payload decoy',
        subFeature: 'product_restore',
        taskPurpose: 'retouch_analysis',
        payload: { subFeature: 'original', taskPurpose: 'retouch_analysis' },
      },
      {
        name: 'payload taskPurpose survives top-level decoy',
        subFeature: 'original',
        taskPurpose: 'retouch_analysis',
        payload: { subFeature: 'original', taskPurpose: shape.purpose },
      },
      {
        name: 'top-level taskPurpose survives payload decoy',
        subFeature: 'original',
        taskPurpose: shape.purpose,
        payload: { subFeature: 'original', taskPurpose: 'retouch_analysis' },
      },
    ];

    for (const conflict of conflicts) {
      for (const rollout of rollouts) {
        assertRolloutRejected(
          () => resolveJobSubmissionPolicy({
            module: 'retouch',
            taskType: shape.taskType,
            provider: 'kie',
            subFeature: conflict.subFeature,
            taskPurpose: conflict.taskPurpose,
            payload: conflict.payload,
            userRole: 'staff',
            productRestoreRollout: rollout,
          }),
          `${shape.name}:${conflict.name}:${String(rollout)}`,
        );
      }
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

test('generic kie_recover submissions remain new creation and cannot claim recovery exemption', () => {
  assertRolloutRejected(
    () => resolveJobSubmissionPolicy({
      module: 'retouch',
      taskType: 'kie_recover',
      provider: 'kie',
      payload: {
        subFeature: 'product_restore',
        taskPurpose: 'product_restore_generation',
      },
      userRole: 'staff',
      productRestoreRollout: 'off',
    }),
    'generic kie_recover must be treated as create',
  );
});

test('same-user dedicated recovery can pass trusted recovery context only after source authorization', async () => {
  let policyCalls = 0;
  const response = await createAuthorizedProviderRecovery({
    userId: 'user-a',
    request: {
      providerTaskId: 'provider-owned-1',
      provider: 'kie',
      taskType: 'kie_recover',
      payload: { isVideo: false },
    },
    findSourceJob: async () => ({
      id: 'source-owned-1',
      userId: 'user-a',
      taskType: 'kie_image',
      provider: 'kie',
      providerTaskId: 'provider-owned-1',
    }),
    createRecoveryJob: async () => {
      policyCalls += 1;
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
      return { taskType: policy.taskType };
    },
  });

  assert.deepEqual(response, { taskType: 'kie_recover' });
  assert.equal(policyCalls, 1);
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
  assert.match(source, /resolveAuthorizedJobSubmissionPolicy = \(user, body, \{ submissionOperation = 'create' \} = \{\}\)/);
  assert.match(source, /submissionOperation,\s*\n\}\);/);
  assert.doesNotMatch(source, /submissionOperation:\s*body\?\.taskType === 'kie_recover'/);
});

test('dedicated recovery passes trusted context only inside the post-authorization callback', () => {
  const mysqlStart = source.indexOf('const handleMysqlRequest =');
  const localStart = source.indexOf('const handleLocalRequest =');
  const handlers = [
    ['mysql', source.slice(mysqlStart, localStart)],
    ['local', source.slice(localStart)],
  ];

  for (const [label, handler] of handlers) {
    const start = handler.indexOf("if (url.pathname === '/api/jobs/recover' && req.method === 'POST')");
    const end = handler.indexOf("json(res, 404, { message: '接口不存在。' });", start);
    assert.ok(start >= 0 && end > start, `${label}: dedicated recovery route missing`);
    const route = handler.slice(start, end);
    const authorizationIndex = route.indexOf('createAuthorizedProviderRecovery({');
    const callbackIndex = route.indexOf('createRecoveryJob: async () => {');
    const trustedPolicyIndex = route.search(
      /resolveAuthorizedJobSubmissionPolicy\([\s\S]{0,160}submissionOperation:\s*'recover'/,
    );
    assert.ok(authorizationIndex >= 0, `${label}: source authorization missing`);
    assert.ok(callbackIndex > authorizationIndex, `${label}: recovery callback must follow authorization entry`);
    assert.ok(trustedPolicyIndex > callbackIndex, `${label}: trusted recovery policy must run inside authorized callback`);
  }
});

test('job retry remains a create operation and cannot inherit recovery from historical taskType', () => {
  const mysqlStart = source.indexOf('const handleMysqlRequest =');
  const localStart = source.indexOf('const handleLocalRequest =');
  const handlers = [source.slice(mysqlStart, localStart), source.slice(localStart)];

  for (const handler of handlers) {
    const retryStart = handler.indexOf("if (jobRetryMatch && req.method === 'POST')");
    const recoverStart = handler.indexOf("if (url.pathname === '/api/jobs/recover'", retryStart);
    assert.ok(retryStart >= 0 && recoverStart > retryStart);
    const retryRoute = handler.slice(retryStart, recoverStart);
    assert.match(retryRoute, /resolveAuthorizedJobSubmissionPolicy\(user, job\)/);
    assert.doesNotMatch(retryRoute, /submissionOperation:\s*'recover'/);
  }
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
