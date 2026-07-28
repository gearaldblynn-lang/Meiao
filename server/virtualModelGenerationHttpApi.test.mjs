import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { handleVirtualModelGenerationApiRequest } from './virtualModelGenerationHttpApi.mjs';

const createResponse = () => {
  const response = { statusCode: null, body: null };
  response.writeHead = (statusCode) => { response.statusCode = statusCode; };
  response.end = (body) => { response.body = JSON.parse(body); };
  return response;
};

const createService = (calls) => ({
  create: async (input) => { calls.push(['create', input]); return { id: 'batch-1' }; },
  find: async (input) => { calls.push(['find', input]); return { id: 'batch-1' }; },
  get: async (input) => { calls.push(['get', input]); return { id: 'batch-1' }; },
  retry: async (input) => { calls.push(['retry', input]); return { id: 'batch-1' }; },
  regenerateDerived: async (input) => { calls.push(['regenerateDerived', input]); return { id: 'batch-1' }; },
  cancel: async (input) => { calls.push(['cancel', input]); return { id: 'batch-1' }; },
  finalize: async (input) => {
    calls.push(['finalize', input]);
    return { virtualModelId: 'model-1', assets: [] };
  },
});

test('generation API dispatches all seven admin routes with the authenticated owner', async () => {
  const cases = [
    ['POST', '/api/admin/virtual-model-generation-batches', 'create', 201, {
      userId: 'forged-user',
      virtualModelId: 'model-1',
      clientSubmissionKey: 'client-submit-1',
    }],
    ['GET', '/api/admin/virtual-model-generation-batches?virtualModelId=model%201&virtualModelVersionId=version%201', 'find', 200, null],
    ['GET', '/api/admin/virtual-model-generation-batches/batch%201', 'get', 200, null],
    ['POST', '/api/admin/virtual-model-generation-batches/batch%201/poses/C02/retry', 'retry', 200, {}],
    ['POST', '/api/admin/virtual-model-generation-batches/batch%201/regenerate-derived', 'regenerateDerived', 200, {}],
    ['POST', '/api/admin/virtual-model-generation-batches/batch%201/cancel', 'cancel', 200, {}],
    ['POST', '/api/admin/virtual-model-generation-batches/batch%201/finalize', 'finalize', 200, {}],
  ];

  for (const [method, pathname, action, status, body] of cases) {
    const calls = [];
    const res = createResponse();
    const handled = await handleVirtualModelGenerationApiRequest({
      req: { method },
      res,
      url: new URL(`http://localhost${pathname}`),
      user: { id: 'admin-1', role: 'admin' },
      readJson: async () => body,
      service: createService(calls),
    });

    assert.equal(handled, true);
    assert.equal(res.statusCode, status);
    assert.equal(calls[0][0], action);
    assert.equal(calls[0][1].userId, 'admin-1');
    if (action === 'find') {
      assert.deepEqual(calls[0][1], {
        userId: 'admin-1',
        virtualModelId: 'model 1',
        virtualModelVersionId: 'version 1',
      });
    } else if (action !== 'create') {
      assert.equal(calls[0][1].batchId, 'batch 1');
    }
    if (action === 'retry') assert.equal(calls[0][1].poseId, 'C02');
  }
});

test('generation API rejects unauthenticated and non-admin requests before reading JSON', async () => {
  for (const [user, expectedStatus, expectedCode] of [
    [null, 401, 'MODEL_AUTH_REQUIRED'],
    [{ id: 'user-1', role: 'user' }, 403, 'MODEL_PERMISSION_DENIED'],
  ]) {
    const res = createResponse();
    let reads = 0;
    const handled = await handleVirtualModelGenerationApiRequest({
      req: { method: 'POST' },
      res,
      url: new URL('http://localhost/api/admin/virtual-model-generation-batches'),
      user,
      readJson: async () => { reads += 1; return {}; },
      service: createService([]),
    });
    assert.equal(handled, true);
    assert.equal(reads, 0);
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(res.body.code, expectedCode);
  }
});

test('generation API validates lookup input and sanitizes known and unknown failures', async () => {
  const missingSubmissionKey = createResponse();
  await handleVirtualModelGenerationApiRequest({
    req: { method: 'POST' },
    res: missingSubmissionKey,
    url: new URL('http://localhost/api/admin/virtual-model-generation-batches'),
    user: { id: 'admin-1', role: 'admin' },
    readJson: async () => ({ virtualModelId: 'model-1' }),
    service: createService([]),
  });
  assert.equal(missingSubmissionKey.statusCode, 400);
  assert.equal(missingSubmissionKey.body.code, 'MODEL_GENERATION_BATCH_INVALID');

  const missingVersion = createResponse();
  await handleVirtualModelGenerationApiRequest({
    req: { method: 'GET' },
    res: missingVersion,
    url: new URL('http://localhost/api/admin/virtual-model-generation-batches?virtualModelId=model-1'),
    user: { id: 'admin-1', role: 'admin' },
    service: createService([]),
  });
  assert.equal(missingVersion.statusCode, 400);
  assert.equal(missingVersion.body.code, 'MODEL_GENERATION_BATCH_INVALID');

  const missing = createResponse();
  await handleVirtualModelGenerationApiRequest({
    req: { method: 'GET' },
    res: missing,
    url: new URL('http://localhost/api/admin/virtual-model-generation-batches/batch-1'),
    user: { id: 'admin-1', role: 'admin' },
    service: {
      ...createService([]),
      get: async () => {
        throw Object.assign(new Error('Missing'), { code: 'MODEL_GENERATION_BATCH_NOT_FOUND' });
      },
    },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.code, 'MODEL_GENERATION_BATCH_NOT_FOUND');

  const invalid = createResponse();
  await handleVirtualModelGenerationApiRequest({
    req: { method: 'POST' },
    res: invalid,
    url: new URL('http://localhost/api/admin/virtual-model-generation-batches/batch-1/finalize'),
    user: { id: 'admin-1', role: 'admin' },
    readJson: async () => ({}),
    service: {
      ...createService([]),
      finalize: async () => {
        throw Object.assign(new Error('Incomplete'), { code: 'MODEL_GENERATION_INCOMPLETE' });
      },
    },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.code, 'MODEL_GENERATION_INCOMPLETE');

  const unknown = createResponse();
  await handleVirtualModelGenerationApiRequest({
    req: { method: 'GET' },
    res: unknown,
    url: new URL('http://localhost/api/admin/virtual-model-generation-batches/batch-1'),
    user: { id: 'admin-1', role: 'admin' },
    service: {
      ...createService([]),
      get: async () => { throw new Error('password=secret'); },
    },
  });
  assert.equal(unknown.statusCode, 500);
  assert.deepEqual(unknown.body, {
    code: 'MODEL_GENERATION_REQUEST_FAILED',
    message: 'Virtual model generation request failed.',
  });
});

test('generation API preserves only allowlisted adapter 4xx failures with sanitized messages', async () => {
  for (const [code, status, message] of [
    ['account_credit_insufficient', 402, 'Insufficient account credits.'],
    ['managed_asset_forbidden', 403, 'Managed asset is unavailable.'],
    ['job_submission_lock_timeout', 409, 'Matching job submission is already in progress.'],
  ]) {
    const res = createResponse();
    await handleVirtualModelGenerationApiRequest({
      req: { method: 'POST' },
      res,
      url: new URL('http://localhost/api/admin/virtual-model-generation-batches'),
      user: { id: 'admin-1', role: 'admin' },
      readJson: async () => ({
        virtualModelId: 'model-1',
        clientSubmissionKey: 'client-submit-1',
      }),
      service: {
        ...createService([]),
        create: async () => {
          throw Object.assign(new Error('secret upstream response'), {
            code,
            statusCode: status,
          });
        },
      },
    });
    assert.equal(res.statusCode, status);
    assert.deepEqual(res.body, { code, message });
  }
});

test('generation API rejects malformed encoded path components without leaking URI errors', async () => {
  const res = createResponse();
  await handleVirtualModelGenerationApiRequest({
    req: { method: 'GET' },
    res,
    url: new URL('http://localhost/api/admin/virtual-model-generation-batches/%'),
    user: { id: 'admin-1', role: 'admin' },
    service: createService([]),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'MODEL_GENERATION_BATCH_INVALID');
  assert.equal(JSON.stringify(res.body).includes('URI malformed'), false);
});

test('current server wires both data sources through durable generation and paid-job boundaries', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

  assert.match(source, /ensureVirtualModelGenerationSchema\(pool\)/);
  assert.match(source, /normalizeVirtualModelGenerationStore\(store\)/);
  assert.equal((source.match(/handleVirtualModelGenerationApiRequest\(\{/g) || []).length, 2);
  assert.match(source, /createVirtualModelGenerationApiService/);

  for (const dependency of [
    'createOrFindBatchRecord',
    'getBatchRecord',
    'findLatestBatchRecord',
    'updateBatchRecord',
    'claimPoseSubmission',
    'bindPoseJob',
    'failPoseSubmission',
    'advancePoseAttempt',
    'findJobByIdempotencyKey',
  ]) {
    assert.match(source, new RegExp(`${dependency}:`));
  }

  assert.match(source, /createSerializedJobSubmission\(\{/);
  assert.match(source, /findReusableLocalJobRecord\(/);
  assert.match(source, /clientSubmissionKey/);
  assert.match(source, /maxRetries:\s*request\.maxRetries/);
  assert.match(source, /listActiveVirtualModelGenerationProtectedAssetReferences\(\{/);
});

test('baseline stabilization fully downloads, decodes, persists, and creates a stable provider reference', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

  assert.match(source, /stabilizeGeneratedReference:\s*async\s*\(\{\s*batch,\s*task,\s*url\s*\}\)\s*=>/);
  assert.match(source, /fetchRemoteAssetBufferWithRetry/);
  assert.match(source, /sharp\(fileBuffer,\s*\{\s*failOn:\s*'error'\s*\}\)\.metadata\(\)/);
  assert.match(source, /sharp\(fileBuffer,\s*\{\s*failOn:\s*'error'\s*\}\)\.toBuffer\(\)/);
  assert.match(source, /persistGeneratedAsset\(\{\s*batch,\s*task,\s*fileBuffer,\s*mimeType/);
  assert.match(source, /uploadAssetViaKieStream\(\{/);
  assert.match(source, /stableReferenceUrl/);
  assert.match(source, /const withGenerationAssetOwnerLock/);
  assert.match(source, /persistGeneratedAsset:[\s\S]*?withGenerationAssetOwnerLock/);
  assert.match(source, /createPreviewAsset:[\s\S]*?withGenerationAssetOwnerLock/);
});
