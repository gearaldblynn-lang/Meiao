import assert from 'node:assert/strict';
import { getMaxListeners } from 'node:events';
import test from 'node:test';
import {
  allowConcurrentAbortListeners,
  readResponseBodyWithTimeout,
} from './providerBodyRead.mjs';

test('allowConcurrentAbortListeners raises the listener budget for provider media fanout', () => {
  const signal = new AbortController().signal;

  allowConcurrentAbortListeners(signal, 32);

  assert.equal(getMaxListeners(signal) >= 36, true);
});

test('readResponseBodyWithTimeout reads streamed chunks and removes abort listener', async () => {
  const encoder = new TextEncoder();
  let addedListener = null;
  let removedListener = null;
  const signal = {
    aborted: false,
    addEventListener: (type, listener) => {
      if (type === 'abort') addedListener = listener;
    },
    removeEventListener: (type, listener) => {
      if (type === 'abort') removedListener = listener;
    },
  };
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('hello '));
      controller.enqueue(encoder.encode('world'));
      controller.close();
    },
  }));

  const body = await readResponseBodyWithTimeout(response, {
    signal,
    timeoutMs: 1000,
  });

  assert.equal(body.toString('utf8'), 'hello world');
  assert.equal(removedListener, addedListener);
});

test('readResponseBodyWithTimeout times out stalled streams and cancels the reader', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    cancel() {
      cancelled = true;
    },
  }));

  await assert.rejects(
    () => readResponseBodyWithTimeout(response, {
      timeoutMessage: '内部素材下载超时',
      timeoutMs: 1,
      providerStage: 'asset_download',
    }),
    (error) => error?.code === 'provider_timeout'
      && error?.providerStage === 'asset_download'
      && /内部素材下载超时/.test(error.message)
  );
  assert.equal(cancelled, true);
});
