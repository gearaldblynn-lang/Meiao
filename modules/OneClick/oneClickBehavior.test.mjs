import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('./MainImageSubModule.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./DetailPageSubModule.tsx', import.meta.url), 'utf8');
const buyerShowSource = readFileSync(new URL('../BuyerShow/BuyerShowModule.tsx', import.meta.url), 'utf8');

test('one click generation prompt keeps strict product consistency and usage correctness suffix', () => {
  assert.match(mainSource, /correct usage/i);
  assert.match(detailSource, /correct usage/i);
  assert.match(mainSource, /STRICT PRODUCT CONSISTENCY/);
  assert.match(detailSource, /STRICT PRODUCT CONSISTENCY/);
});

test('one click analysis overlay is scoped inside module workspace instead of full-screen fixed layer', () => {
  assert.doesNotMatch(mainSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
  assert.doesNotMatch(detailSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
});

test('buyer show analysis overlay is scoped inside module workspace instead of full-screen fixed layer', () => {
  assert.doesNotMatch(buyerShowSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
});

test('buyer show workspace offers per-project download action in set header', () => {
  assert.match(buyerShowSource, /onDownloadSet/);
  assert.match(buyerShowSource, /下载项目/);
});

test('one click redo flow clears stale task id before starting a brand new generation task', () => {
  assert.match(mainSource, /handleRedoSingle[\s\S]*updateSingleScheme\(schemeId, \{ status: 'generating', error: '正在准备素材\.\.\.', taskId: undefined, resultUrl: undefined \}\)/);
  assert.match(detailSource, /updateSingleScreen\(id, \{ status: 'generating', error: '正在准备素材\.\.\.', taskId: undefined, resultUrl: undefined \}\)/);
});
