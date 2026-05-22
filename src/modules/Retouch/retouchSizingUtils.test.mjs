import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getRetouchCustomSizeRatioWarning,
  getRetouchSupportedAspectRatiosForModel,
  getSafeRetouchAspectRatioForModel,
} from './retouchSizingUtils.mjs';

const bottomInputSource = readFileSync(new URL('../../shell/components/layout/BottomInputBar.tsx', import.meta.url), 'utf8');
const shellAppSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('retouch custom size warns only when both dimensions conflict with a fixed ratio', () => {
  assert.equal(getRetouchCustomSizeRatioWarning({ aspectRatio: '1:1', resolutionMode: 'custom', width: 800, height: 800 }), '');
  assert.equal(getRetouchCustomSizeRatioWarning({ aspectRatio: '3:4', resolutionMode: 'custom', width: 900, height: 1200 }), '');
  assert.match(
    getRetouchCustomSizeRatioWarning({ aspectRatio: '3:4', resolutionMode: 'custom', width: 800, height: 800 }),
    /当前自定义尺寸与所选比例不一致/
  );
  assert.equal(getRetouchCustomSizeRatioWarning({ aspectRatio: 'auto', resolutionMode: 'custom', width: 800, height: 800 }), '');
  assert.equal(getRetouchCustomSizeRatioWarning({ aspectRatio: '1:1', resolutionMode: 'original', width: 800, height: 1200 }), '');
  assert.equal(getRetouchCustomSizeRatioWarning({ aspectRatio: '1:1', resolutionMode: 'custom', width: 800, height: 0 }), '');
});

test('retouch shell controls expose recommended ratios and AI adaptive size', () => {
  assert.match(bottomInputSource, /key: 'ratio'[\s\S]*title: '出图比例'/);
  assert.match(bottomInputSource, /recommendedValue: '1:1'/);
  assert.match(bottomInputSource, /secondaryRecommendedValue: '3:4'/);
  assert.match(bottomInputSource, /AI 自适应尺寸/);
  assert.match(bottomInputSource, /getRetouchQuickParams/);
  assert.match(bottomInputSource, /getSafeRetouchAspectRatioForModel/);
  assert.match(shellAppSource, /normalizeRetouchParamsForGeneration/);
  assert.match(shellAppSource, /getRetouchCustomSizeRatioWarning/);
  assert.match(shellAppSource, /getSafeRetouchAspectRatioForModel/);
});

test('retouch model changes keep ratios inside the selected model capability list', () => {
  assert.deepEqual(
    getRetouchSupportedAspectRatiosForModel('GPT Image 2'),
    ['auto', '1:1', '3:4', '4:3', '9:16', '16:9']
  );
  assert.equal(getSafeRetouchAspectRatioForModel('GPT Image 2', '21:9'), 'auto');
  assert.equal(getSafeRetouchAspectRatioForModel('Nano Banana 2', '21:9'), '21:9');
});
