import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const authenticatedImagePath = 'components/AuthenticatedAssetImage.tsx';

const collectTsxFiles = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });

test('all runtime images cross the authenticated managed-asset rendering boundary', () => {
  const rawImageConsumers = collectTsxFiles(srcRoot)
    .filter((path) => relative(srcRoot, path) !== authenticatedImagePath)
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return Array.from(source.matchAll(/<img\b/g), (match) => {
        const line = source.slice(0, match.index).split('\n').length;
        return `${relative(srcRoot, path)}:${line}`;
      });
    });

  assert.deepEqual(
    rawImageConsumers,
    [],
    `raw <img> bypasses managed-asset authentication:\n${rawImageConsumers.join('\n')}`,
  );
});

