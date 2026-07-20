import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeId } from './runtimeId.mjs';

test('createRuntimeId uses browser randomUUID when it is callable', () => {
  const cryptoObject = {
    randomUUID() {
      assert.equal(this, cryptoObject);
      return '11111111-2222-4333-8444-555555555555';
    },
  };

  assert.equal(
    createRuntimeId('result-retry-', { cryptoObject }),
    'result-retry-11111111-2222-4333-8444-555555555555',
  );
});

test('createRuntimeId falls back when browser randomUUID is missing, non-callable, or throws', () => {
  const dependencies = {
    now: () => 1_784_512_938_467,
    random: () => 0.25,
  };
  const ids = [
    createRuntimeId('translation-edit-', { ...dependencies, cryptoObject: {} }),
    createRuntimeId('translation-edit-', { ...dependencies, cryptoObject: { randomUUID: undefined } }),
    createRuntimeId('translation-edit-', { ...dependencies, cryptoObject: { randomUUID: 'unsupported' } }),
    createRuntimeId('translation-edit-', { ...dependencies, cryptoObject: { randomUUID: () => '  ' } }),
    createRuntimeId('translation-edit-', {
      ...dependencies,
      cryptoObject: { randomUUID: () => { throw new Error('not available'); } },
    }),
  ];

  ids.forEach((id) => assert.match(id, /^translation-edit-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/));
  assert.equal(new Set(ids).size, ids.length);
});
