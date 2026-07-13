import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('all standalone image model selectors consume the shared model list', () => {
  for (const file of [
    '../components/SettingsSidebar.tsx',
    '../modules/OneClick/ConfigSidebar.tsx',
    '../modules/OneClick/SkuSidebar.tsx',
    '../modules/Retouch/RetouchSidebar.tsx',
    '../modules/BuyerShow/BuyerShowSidebar.tsx',
  ]) {
    assert.match(read(file), /MODEL_OPTIONS\.map/);
  }
});

test('shell quick parameters and Agent Center include shared MaxForAI model definitions', () => {
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const agentCenterManager = read('../modules/AgentCenter/AgentCenterManager.tsx');

  assert.match(bottomInputBar, /const IMAGE_MODEL_LABEL_OPTIONS = MODEL_OPTIONS\.map\(getModelDisplayName\)/);
  assert.doesNotMatch(bottomInputBar, /\['GPT Image 2', 'GPT Image 2（副）', 'Nano Banana 2'\]/);
  assert.match(agentCenterManager, /MAXFORAI_IMAGE_MODELS/);
});

test('shell model normalization preserves MaxForAI site ids and labels', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const shellWorkflow = read('../adapters/shellWorkflow.ts');

  assert.match(shellApp, /resolveMaxForAiImageModelId/);
  assert.match(shellApp, /const maxForAiModel = resolveMaxForAiImageModelId\(value\)/);
  assert.match(shellWorkflow, /resolveMaxForAiImageModelId/);
  assert.match(shellWorkflow, /const maxForAiModel = resolveMaxForAiImageModelId\(value\)/);
});

test('all button-style model selectors use a wrapping grid for six options', () => {
  for (const file of [
    '../components/SettingsSidebar.tsx',
    '../modules/OneClick/ConfigSidebar.tsx',
    '../modules/OneClick/SkuSidebar.tsx',
    '../modules/Retouch/RetouchSidebar.tsx',
    '../modules/BuyerShow/BuyerShowSidebar.tsx',
  ]) {
    assert.match(read(file), /grid grid-cols-2 gap-2 xl:grid-cols-3/);
  }
});
