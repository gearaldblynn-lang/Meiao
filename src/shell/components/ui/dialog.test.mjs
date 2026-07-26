import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const source = () => readFileSync(join(root, 'src/shell/components/ui/dialog.tsx'), 'utf8');

test('dialog content uses the application theme surface and readable text colors', () => {
  const content = source();
  assert.match(content, /bg-\[var\(--bg-surface\)\]/);
  assert.match(content, /text-\[var\(--text-primary\)\]/);
  assert.match(content, /border-\[var\(--border-default\)\]/);
  assert.match(content, /data-slot="dialog-overlay"[\s\S]*?z-50/);
  assert.match(content, /data-slot="dialog-content"[\s\S]*?z-50/);
  assert.doesNotMatch(content, /"bg-background data-\[state=open\]/);
});
