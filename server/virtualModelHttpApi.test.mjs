import test from 'node:test';
import assert from 'node:assert/strict';
import { handleVirtualModelDeleteApiRequest, respondVirtualModelApiError } from './virtualModelHttpApi.mjs';

const createResponse = () => {
  const response = { statusCode: null, headers: null, body: null };
  response.writeHead = (statusCode, headers) => { response.statusCode = statusCode; response.headers = headers; };
  response.end = (body) => { response.body = JSON.parse(body); };
  return response;
};

const createDeleteRequest = () => {
  let bodyConsumed = false;
  return {
    req: {
      method: 'DELETE',
      [Symbol.asyncIterator]() {
        bodyConsumed = true;
        throw new Error('DELETE body must not be consumed');
      },
    },
    wasBodyConsumed: () => bodyConsumed,
  };
};

test('admin DELETE decodes the model ID, mutates the real local store, persists, and returns the result', async () => {
  const virtualModelId = 'model / one';
  const store = {
    virtualModels: [{ id: virtualModelId, status: 'draft', currentVersionId: null, updatedAt: 1 }],
    virtualModelVersions: [],
    virtualModelAssets: [],
  };
  const { req, wasBodyConsumed } = createDeleteRequest();
  const res = createResponse();
  let persistCalls = 0;

  const handled = await handleVirtualModelDeleteApiRequest({
    req,
    res,
    url: new URL(`http://localhost/api/admin/virtual-models/${encodeURIComponent(virtualModelId)}`),
    user: { role: 'admin' },
    store,
    persist: () => { persistCalls += 1; },
  });

  assert.equal(handled, true);
  assert.equal(store.virtualModels[0].status, 'deleted');
  assert.equal(persistCalls, 1);
  assert.equal(wasBodyConsumed(), false);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { result: { ok: true } });
});

test('non-admin DELETE is rejected before body consumption or mutation', async () => {
  const store = {
    virtualModels: [{ id: 'model-1', status: 'draft', currentVersionId: null, updatedAt: 1 }],
    virtualModelVersions: [],
    virtualModelAssets: [],
  };
  const { req, wasBodyConsumed } = createDeleteRequest();
  const res = createResponse();
  let persistCalls = 0;

  const handled = await handleVirtualModelDeleteApiRequest({
    req,
    res,
    url: new URL('http://localhost/api/admin/virtual-models/model-1'),
    user: { role: 'user' },
    store,
    persist: () => { persistCalls += 1; },
  });

  assert.equal(handled, true);
  assert.equal(store.virtualModels[0].status, 'draft');
  assert.equal(persistCalls, 0);
  assert.equal(wasBodyConsumed(), false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'MODEL_PERMISSION_DENIED');
});

test('DELETE returns 404 for a missing or already deleted model without persisting', async () => {
  for (const virtualModels of [[], [{ id: 'model-1', status: 'deleted', currentVersionId: null, updatedAt: 1 }]]) {
    const { req } = createDeleteRequest();
    const res = createResponse();
    let persistCalls = 0;
    await handleVirtualModelDeleteApiRequest({
      req,
      res,
      url: new URL('http://localhost/api/admin/virtual-models/model-1'),
      user: { role: 'admin' },
      store: { virtualModels, virtualModelVersions: [], virtualModelAssets: [] },
      persist: () => { persistCalls += 1; },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'MODEL_NOT_FOUND');
    assert.equal(persistCalls, 0);
  }
});

test('DELETE rejects malformed percent encoding as a sanitized 400 without mutation or persistence', async () => {
  const store = {
    virtualModels: [{ id: '%', status: 'draft', currentVersionId: null, updatedAt: 1 }],
    virtualModelVersions: [],
    virtualModelAssets: [],
  };
  const { req, wasBodyConsumed } = createDeleteRequest();
  const res = createResponse();
  let persistCalls = 0;

  const handled = await handleVirtualModelDeleteApiRequest({
    req,
    res,
    url: new URL('http://localhost/api/admin/virtual-models/%'),
    user: { role: 'admin' },
    store,
    persist: () => { persistCalls += 1; },
  });

  assert.equal(handled, true);
  assert.equal(store.virtualModels[0].status, 'draft');
  assert.equal(persistCalls, 0);
  assert.equal(wasBodyConsumed(), false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { code: 'MODEL_ID_INVALID', message: 'Virtual model ID is invalid.' });
  assert.equal(JSON.stringify(res.body).includes('URI malformed'), false);
});

test('DELETE maps an operational persistence failure to a sanitized 500 response', async () => {
  const { req } = createDeleteRequest();
  const res = createResponse();
  await handleVirtualModelDeleteApiRequest({
    req,
    res,
    url: new URL('http://localhost/api/admin/virtual-models/model-1'),
    user: { role: 'admin' },
    store: {
      virtualModels: [{ id: 'model-1', status: 'draft', currentVersionId: null, updatedAt: 1 }],
      virtualModelVersions: [],
      virtualModelAssets: [],
    },
    persist: () => { throw new Error('password=secret-database-detail'); },
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { code: 'MODEL_REQUEST_FAILED', message: 'Virtual model request failed.' });
  assert.equal(JSON.stringify(res.body).includes('secret-database-detail'), false);
});

test('virtual-model error responder keeps known domain errors at 400 and unknown errors at 500', () => {
  const validationResponse = createResponse();
  respondVirtualModelApiError(validationResponse, Object.assign(new Error('Assets are invalid'), {
    code: 'MODEL_ASSET_INVALID',
    issues: [{ code: 'ASSET_SLOT_INVALID' }],
  }));
  assert.equal(validationResponse.statusCode, 400);
  assert.deepEqual(validationResponse.body, {
    code: 'MODEL_ASSET_INVALID',
    message: 'Assets are invalid',
    issues: [{ code: 'ASSET_SLOT_INVALID' }],
  });

  const unknownResponse = createResponse();
  respondVirtualModelApiError(unknownResponse, new Error('private operational detail'));
  assert.equal(unknownResponse.statusCode, 500);
  assert.deepEqual(unknownResponse.body, { code: 'MODEL_REQUEST_FAILED', message: 'Virtual model request failed.' });
});

