import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canCreateProductRestore,
  normalizeProductRestoreRollout,
} from './productRestoreRollout.mjs';

test('normalizeProductRestoreRollout accepts only the explicit rollout modes', () => {
  const cases = [
    [undefined, 'off'],
    ['', 'off'],
    ['   ', 'off'],
    ['off', 'off'],
    ['ADMIN', 'admin'],
    [' all ', 'all'],
    ['beta', 'off'],
    [true, 'off'],
  ];

  for (const [value, expected] of cases) {
    assert.equal(normalizeProductRestoreRollout(value), expected);
  }
});

test('canCreateProductRestore gates creation by normalized mode and authenticated role', () => {
  const cases = [
    ['off', 'admin', false],
    ['off', 'user', false],
    ['admin', 'admin', true],
    ['ADMIN', 'admin', true],
    ['admin', 'user', false],
    ['all', 'admin', true],
    ['all', 'user', true],
    ['all', '', false],
    ['beta', 'admin', false],
  ];

  for (const [mode, role, expected] of cases) {
    assert.equal(canCreateProductRestore(mode, role), expected);
  }
});
