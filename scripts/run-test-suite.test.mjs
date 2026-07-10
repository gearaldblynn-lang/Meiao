import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildNodeTestArgs, collectTestFiles } from './run-test-suite.mjs';

test('collectTestFiles finds nested test files in stable order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'meiao-tests-'));
  try {
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await writeFile(path.join(root, 'z.test.mjs'), '');
    await writeFile(path.join(root, 'nested', 'a.test.mjs'), '');
    await writeFile(path.join(root, 'nested', 'not-a-test.mjs'), '');

    assert.deepEqual(await collectTestFiles(root), [
      path.join(root, 'nested', 'a.test.mjs'),
      path.join(root, 'z.test.mjs'),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('frontend test args enable TypeScript stripping while server args do not', () => {
  const files = ['/repo/example.test.mjs'];
  assert.deepEqual(buildNodeTestArgs('frontend', files), [
    '--experimental-strip-types',
    '--test',
    '--test-reporter=dot',
    ...files,
  ]);
  assert.deepEqual(buildNodeTestArgs('server', files), [
    '--test',
    '--test-reporter=dot',
    ...files,
  ]);
});
