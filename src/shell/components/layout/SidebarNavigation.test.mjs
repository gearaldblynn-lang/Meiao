import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');

test('landing navigation uses the same item geometry as module navigation', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');

  assert.match(source, /const LANDING: SidebarNavDef =/);
  assert.match(source, /\{renderItem\(LANDING\)\}/);
  assert.match(source, /className=\{`group relative flex h-\[44px\] w-full items-center rounded-2xl transition-all/);
  assert.match(source, /const isActive = activeModule === item\.module/);
  assert.match(source, /background: isActive \? 'var\(--accent-soft\)' : 'transparent'/);
  assert.doesNotMatch(source, /flex h-9 w-full/);
  assert.doesNotMatch(source, /h-9 min-w-0/);
  assert.doesNotMatch(source, /collapsed \? 'w-8 justify-center'/);
});
