import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runManagedImageCosProbe,
  runManagedImageCosProbeCli,
} from './probe-managed-image-cos.mjs';

const env = {
  MEIAO_IMAGE_COS_SECRET_ID: 'probe-secret-id',
  MEIAO_IMAGE_COS_SECRET_KEY: 'probe-secret-key',
  MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
  MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
};

test('managed image COS probe verifies the full object lifecycle without leaking credentials or signed URLs', async () => {
  const calls = [];
  const output = [];
  const expectedBytes = Buffer.from('tiny-png');
  const result = await runManagedImageCosProbe({
    env,
    imageBytes: expectedBytes,
    writeLine: (line) => output.push(String(line)),
    deps: {
      randomId: () => 'probe123',
      putImage: async (payload) => {
        calls.push(['put', payload.storageKey, payload.fileBuffer]);
        return { storageKey: payload.storageKey, etag: 'etag-probe' };
      },
      headImage: async (storageKey) => {
        calls.push(['head', storageKey]);
        return { exists: calls.filter(([name]) => name === 'delete').length === 0, contentLength: expectedBytes.length };
      },
      createReadUrl: async (storageKey, purpose) => {
        calls.push(['sign', storageKey, purpose]);
        return `https://example.cos.myqcloud.com/${storageKey}?q-signature=private-signature`;
      },
      fetchUrl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => expectedBytes,
      }),
      deleteImage: async (storageKey) => {
        calls.push(['delete', storageKey]);
        return { deleted: true, missing: false };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(([name]) => name), ['put', 'head', 'sign', 'delete', 'head']);
  assert.match(calls[0][1], /^managed-images\/users\/_probe\/source\/probe123\/probe\.png$/);
  assert.deepEqual(calls[0][2], expectedBytes);
  const visibleOutput = output.join('\n');
  assert.match(visibleOutput, /put: ok/);
  assert.match(visibleOutput, /delete: ok/);
  assert.doesNotMatch(visibleOutput, /probe-secret|private-signature|q-signature|https:\/\//);
});

test('managed image COS probe attempts exact-key cleanup when verification fails', async () => {
  const deletes = [];
  await assert.rejects(
    () => runManagedImageCosProbe({
      env,
      imageBytes: Buffer.from('expected'),
      writeLine: () => {},
      deps: {
        randomId: () => 'failed123',
        putImage: async ({ storageKey }) => ({ storageKey }),
        headImage: async () => ({ exists: true }),
        createReadUrl: async () => 'https://example.cos.myqcloud.com/probe?q-signature=hidden',
        fetchUrl: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('wrong') }),
        deleteImage: async (storageKey) => {
          deletes.push(storageKey);
          return { deleted: true, missing: false };
        },
      },
    }),
    /byte equality/i,
  );

  assert.deepEqual(deletes, ['managed-images/users/_probe/source/failed123/probe.png']);
});

test('managed image COS probe CLI stays alive through async retries and exits as a visible failure', async () => {
  const output = [];
  const errors = [];
  const keepAliveHandle = Symbol('keep-alive');
  let keepAliveStarted = 0;
  let keepAliveCleared = 0;

  const ok = await runManagedImageCosProbeCli({
    runProbe: async () => {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5);
        timer.unref();
      });
      throw new Error('signature mismatch');
    },
    writeLine: (line) => output.push(String(line)),
    writeError: (line) => errors.push(String(line)),
    startKeepAlive: () => {
      keepAliveStarted += 1;
      return keepAliveHandle;
    },
    stopKeepAlive: (handle) => {
      assert.equal(handle, keepAliveHandle);
      keepAliveCleared += 1;
    },
  });

  assert.equal(ok, false);
  assert.equal(keepAliveStarted, 1);
  assert.equal(keepAliveCleared, 1);
  assert.deepEqual(output, []);
  assert.deepEqual(errors, ['managed image COS probe: FAIL (signature mismatch)']);
});
