import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firstImageSource = readFileSync(new URL('./FirstImageSubModule.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('./MainImageSubModule.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./DetailPageSubModule.tsx', import.meta.url), 'utf8');
const skuSource = readFileSync(new URL('./SkuSubModule.tsx', import.meta.url), 'utf8');
const shellAppSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const shellWorkflowSource = readFileSync(new URL('../../adapters/shellWorkflow.ts', import.meta.url), 'utf8');
const arkServiceSource = readFileSync(new URL('../../services/arkService.ts', import.meta.url), 'utf8');

test('one click modules auto-recover refresh-persisted recoverable kie errors instead of only resuming generating tasks', () => {
  assert.match(mainSource, /isRecoverableKieTaskResult/);
  assert.match(detailSource, /isRecoverableKieTaskResult/);
  assert.match(skuSource, /isRecoverableKieTaskResult/);
  assert.match(mainSource, /\(s\.status === 'generating' \|\| \(s\.status === 'error' && isRecoverableKieTaskResult\(s\.taskId, s\.error\)\)\)\s*&& s\.taskId/);
  assert.match(detailSource, /\(s\.status === 'generating' \|\| \(s\.status === 'error' && isRecoverableKieTaskResult\(s\.taskId, s\.error\)\)\)\s*&& s\.taskId/);
  assert.match(skuSource, /\(s\.status === 'generating' \|\| \(s\.status === 'error' && isRecoverableKieTaskResult\(s\.taskId, s\.error\)\)\)\s*&& s\.taskId/);
});

test('one click modules downgrade refresh-persisted generating tasks without task ids into retryable errors', () => {
  assert.match(
    mainSource,
    /const staleGeneratingIds = schemes\.filter\(s => s\.status === 'generating' && !s\.taskId\)\.map\(s => s\.id\);/
  );
  assert.match(
    detailSource,
    /const staleGeneratingIds = schemes\.filter\(s => s\.status === 'generating' && !s\.taskId\)\.map\(s => s\.id\);/
  );
  assert.match(
    skuSource,
    /const staleGeneratingIds = schemes\.filter\(s => s\.status === 'generating' && !s\.taskId\)\.map\(s => s\.id\);/
  );
  assert.match(
    mainSource,
    /status: 'error', error: '页面刷新过早，当前任务无法自动找回，请重新生成'/
  );
  assert.match(
    detailSource,
    /status: 'error', error: '页面刷新过早，当前任务无法自动找回，请重新生成'/
  );
  assert.match(
    skuSource,
    /status: 'error', error: '页面刷新过早，当前任务无法自动找回，请重新生成'/
  );
});

test('one click modules automatically discard refresh-abandoned draft projects with no schemes', () => {
  assert.match(firstImageSource, /activeProject\?\.isDraft && schemes\.length === 0 && projects\.length > 1/);
  assert.match(mainSource, /activeProject\?\.isDraft && schemes\.length === 0 && projects\.length > 1/);
  assert.match(detailSource, /activeProject\?\.isDraft && schemes\.length === 0 && projects\.length > 1/);
  assert.match(skuSource, /activeProject\?\.isDraft && schemes\.length === 0 && projects\.length > 1/);
  assert.match(firstImageSource, /已清理刷新中断留下的空草稿项目/);
});

test('one click shell planning jobs carry project metadata so completed text jobs can reconnect after refresh', () => {
  assert.match(shellAppSource, /taskMetadata:\s*\{[\s\S]*shellPlanningPurpose:\s*'one_click_planning'[\s\S]*shellProjectId:\s*projectId[\s\S]*subFeature:\s*targetSubFeature[\s\S]*\}/);
  assert.match(shellWorkflowSource, /input\.taskMetadata/);
  assert.match(arkServiceSource, /jobMetadata:\s*Record<string,\s*unknown>/);
  assert.match(arkServiceSource, /\.\.\.jobMetadata[\s\S]*model,[\s\S]*messages:/);
});
