import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('one-click planning receives the remotely prepared generation materials', () => {
  const uploadIndex = shellSource.indexOf(
    'generationMaterials = await ensureMaterialRemoteUrls(generationMaterials, targetModule);',
  );
  const planIndex = shellSource.indexOf('const planResult = await runShellOneClickPlanning({', uploadIndex);
  const planBlock = shellSource.slice(planIndex, planIndex + 700);

  assert.ok(uploadIndex >= 0, 'generation material upload gate must exist');
  assert.ok(planIndex > uploadIndex, 'one-click planning must run after the upload gate');
  assert.match(planBlock, /materials:\s*generationMaterials,/);
  assert.doesNotMatch(planBlock, /materials:\s*filteredMaterials,/);
});
