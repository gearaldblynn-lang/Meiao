import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflowSource = readFileSync(new URL('./shellWorkflow.ts', import.meta.url), 'utf8');
const arkSource = readFileSync(new URL('../services/arkService.ts', import.meta.url), 'utf8');
const storyboardSource = readFileSync(new URL('../services/videoStoryboardService.ts', import.meta.url), 'utf8');
const shellAppSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('retouch analysis and image jobs inherit the pre-created shell project identity', () => {
  assert.match(
    workflowSource,
    /analyzeRetouchTask\([\s\S]{0,500}input\.onJobCreated[\s\S]{0,300}taskPurpose:\s*'retouch_analysis'/,
  );
  assert.match(
    arkSource,
    /analyzeRetouchTask[\s\S]{0,300}onJobCreated\?:\s*AnalysisJobCreatedCallback[\s\S]{0,180}jobMetadata\?:\s*Record<string, unknown>/,
  );
  assert.match(
    workflowSource,
    /processWithKieAi\([\s\S]{0,900}\.\.\.\(input\.taskMetadata\s*\|\|\s*\{\}\)[\s\S]{0,300}input\.onJobCreated/,
  );
});

test('storyboard planning and board image jobs carry project and board bindings', () => {
  assert.match(storyboardSource, /taskPurpose:\s*'storyboard_planning'/);
  assert.match(storyboardSource, /shellPlanningPurpose:\s*'storyboard_planning'/);
  assert.match(storyboardSource, /taskPurpose:\s*'storyboard_board_image'/);
  assert.match(storyboardSource, /shellBoardId:\s*board\.id/);
  assert.match(
    shellAppSource,
    /generateStoryboardScript\([\s\S]{0,500}shellProjectId:\s*project\.id[\s\S]{0,180}shellProjectName:\s*project\.name/,
  );
  assert.match(
    shellAppSource,
    /generateStoryboardBoardImage\([\s\S]{0,500}shellProjectId:\s*projectId[\s\S]{0,180}shellBoardId:\s*board\.id/,
  );
});
