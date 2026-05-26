import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = fileURLToPath(new URL('../', import.meta.url));

const listSourceFiles = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    if (/\.(tsx?|mjs)$/.test(entry.name)) return [path];
    return [];
  });
};

test('business code uses the shared safe clipboard helper instead of direct clipboard writes', () => {
  const offenders = listSourceFiles(srcRoot)
    .filter((path) => !path.endsWith('/utils/clipboard.mjs'))
    .filter((path) => !path.endsWith('/utils/clipboardFallback.test.mjs'))
    .filter((path) => readFileSync(path, 'utf8').includes('navigator.clipboard'));

  assert.deepEqual(
    offenders.map((path) => relative(srcRoot, path)),
    [],
  );
});

test('copyTextToClipboard falls back without throwing when navigator.clipboard is unavailable', async () => {
  const { copyTextToClipboard } = await import('./clipboard.mjs');
  const appended = [];
  const env = {
    navigator: {},
    document: {
      body: {
        appendChild(element) {
          appended.push(element);
        },
      },
      createElement() {
        return {
          value: '',
          style: {},
          setAttribute() {},
          select() {},
          remove() {
            appended.pop();
          },
        };
      },
      execCommand(command) {
        return command === 'copy';
      },
    },
  };

  const copied = await copyTextToClipboard('hello', env);

  assert.equal(copied, true);
  assert.equal(appended.length, 0);
});
