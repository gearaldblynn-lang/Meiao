import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('./MainImageSubModule.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./DetailPageSubModule.tsx', import.meta.url), 'utf8');
const buyerShowSource = readFileSync(new URL('../BuyerShow/BuyerShowModule.tsx', import.meta.url), 'utf8');
const skuSource = readFileSync(new URL('./SkuSubModule.tsx', import.meta.url), 'utf8');
const oneClickModuleSource = readFileSync(new URL('./OneClickModule.tsx', import.meta.url), 'utf8');

test('one click generation prompt keeps strict product consistency guardrails', () => {
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

test('buyer show workspace keeps download capability via single-image and batch download actions', () => {
  assert.match(buyerShowSource, /handleBatchDownload/);
  assert.match(buyerShowSource, /打包下载/);
  assert.match(buyerShowSource, /onDownload=\{handleDownloadSingle\}/);
  assert.match(buyerShowSource, /下载买家秀单图/);
});

test('one click redo flow clears stale task id before starting a brand new generation task', () => {
  assert.match(mainSource, /handleRedoSingle[\s\S]*updateSingleScheme\(schemeId, \{ status: 'generating', error: '正在准备素材\.\.\.', taskId: undefined, resultUrl: undefined \}\)/);
  assert.match(detailSource, /updateSingleScreen\(id, \{ status: 'generating', error: '正在准备素材\.\.\.', taskId: undefined, resultUrl: undefined \}\)/);
});

test('one click generation prompts explain that parentheses are requirements and quoted text is the only renderable copy', () => {
  assert.match(mainSource, /文案内容排版中，圆括号（或半角括号）内的内容全部是排版要求/);
  assert.match(mainSource, /只有中文引号“”内的文字才是最终需要渲染到画面中的正文文案/);
  assert.match(mainSource, /角色名\(要求\):“正文文案”/);
  assert.match(detailSource, /文案内容排版中，圆括号（或半角括号）内的内容全部是排版要求/);
  assert.match(detailSource, /只有中文引号“”内的文字才是最终需要渲染到画面中的正文文案/);
  assert.match(detailSource, /角色名\(要求\):“正文文案”/);
  assert.match(skuSource, /文案内容排版中，圆括号（或半角括号）内的内容全部是排版要求/);
  assert.match(skuSource, /只有中文引号“”内的文字才是最终需要渲染到画面中的正文文案/);
  assert.match(skuSource, /角色名\(要求\):“正文文案”/);
});

test('one click planning and generation paths normalize legacy copy layout rows before rendering', () => {
  assert.match(mainSource, /normalizeCopyLayoutText/);
  assert.match(detailSource, /normalizeCopyLayoutText/);
  assert.match(skuSource, /normalizeCopyLayoutText/);
});

test('main image planning flow exposes a real cancel path that aborts the active analysis job', () => {
  assert.match(mainSource, /const handleCancelAnalysis = async \(\) =>/);
  assert.match(mainSource, /globalAbortRef\.current\?\.abort\(\)/);
  assert.match(mainSource, /analysisJobIdRef\.current/);
  assert.match(mainSource, /await cancelInternalJob\(analysisJobIdRef\.current\)/);
  assert.match(mainSource, /取消策划/);
});

test('one click workspace only mounts the active submodule to avoid hidden-module side effects', () => {
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.MAIN_IMAGE \? \(/);
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.DETAIL_PAGE \? \(/);
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.SKU \? \(/);
  assert.doesNotMatch(oneClickModuleSource, /className=\{`h-full w-full flex overflow-hidden \$\{subMode === OneClickSubMode\.MAIN_IMAGE \? '' : 'hidden'\}`\}/);
});
