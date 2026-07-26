import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SubFeatureTabs.tsx', import.meta.url), 'utf8');

test('active subfeature stays visible inside a width-constrained horizontal scroller', () => {
  assert.match(source, /className="w-full max-w-full overflow-x-auto scrollbar-none"/);
  assert.match(source, /activeButtonRef/);
  assert.match(source, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/);
  assert.match(source, /window\.addEventListener\('resize', ensureActiveVisible\)/);
  assert.match(source, /window\.removeEventListener\('resize', ensureActiveVisible\)/);
});
