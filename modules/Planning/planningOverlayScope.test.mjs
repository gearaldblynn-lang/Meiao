import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../OneClick/MainImageSubModule.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../OneClick/DetailPageSubModule.tsx', import.meta.url), 'utf8');
const buyerShowSource = readFileSync(new URL('../BuyerShow/BuyerShowModule.tsx', import.meta.url), 'utf8');

test('planning overlays are scoped to module workspaces instead of full-screen fixed layers', () => {
  assert.doesNotMatch(mainSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
  assert.doesNotMatch(detailSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
  assert.doesNotMatch(buyerShowSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
  assert.match(mainSource, /\{isAnalyzing && \(\s*<div className="absolute inset-0/);
  assert.match(detailSource, /\{isAnalyzing && \(\s*<div className="absolute inset-0/);
  assert.match(buyerShowSource, /\{isAnalyzing && \(\s*<div className="absolute inset-0/);
});
