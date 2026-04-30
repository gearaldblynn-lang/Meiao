import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stylesSource = readFileSync(new URL('./xhsCoverStyles.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('./XhsCoverSidebar.tsx', import.meta.url), 'utf8');

test('xhs cover style previews do not depend on expiring managed asset urls', () => {
  assert.doesNotMatch(stylesSource, /api\/assets\/file/);
  assert.match(stylesSource, /const ASSET = '\/xhs-cover-previews';/);
  assert.match(stylesSource, /previewImage: `\$\{ASSET\}\/workplace_big_text\.png`/);
});

test('xhs cover style cards render a text fallback when preview images fail', () => {
  assert.match(sidebarSource, /const \[previewFailed, setPreviewFailed\] = useState\(false\);/);
  assert.match(sidebarSource, /onError=\{\(\) => setPreviewFailed\(true\)\}/);
  assert.match(sidebarSource, /previewFailed \? \(/);
});
