import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildShellImageInputUrls } from '../../adapters/shellOneClickMaterials.mjs';

const workflowSource = readFileSync(new URL('../../adapters/shellWorkflow.ts', import.meta.url), 'utf8');
const arkSource = readFileSync(new URL('../../services/arkService.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const projectCardSource = readFileSync(new URL('../../shell/components/ProjectCard.tsx', import.meta.url), 'utf8');
const shellBuyerShowModuleSource = readFileSync(new URL('../../shell/modules/BuyerShow/BuyerShowModule.tsx', import.meta.url), 'utf8');

test('buyer show planning returns provider usage and workflow persists display fields', () => {
  assert.match(arkSource, /requestAnalysisResponseDetailed/);
  assert.match(arkSource, /creditsConsumed:\s*analysis\.creditsConsumed/);
  assert.match(arkSource, /taskId:\s*analysis\.taskId/);
  assert.match(workflowSource, /buyerShowDisplayPrompt:\s*task\.prompt/);
  assert.match(workflowSource, /buyerShowEvaluation:\s*setPlan\.evaluation/);
  assert.match(workflowSource, /buyerShowPlanningCredits:\s*setPlan\.planningCreditsConsumed/);
  assert.match(workflowSource, /buyerShowPlanningTaskId:\s*setPlan\.planningTaskId/);
});

test('buyer show follow-up images wait for the first generated image as benchmark', () => {
  assert.match(workflowSource, /waitForInternalJob/);
  assert.match(workflowSource, /extractBuyerShowGeneratedImageUrl/);
  assert.match(workflowSource, /setPlan\.setBenchmarkUrl\s*=\s*benchmarkUrl/);
  assert.match(workflowSource, /buyerShowReferenceMode:\s*isFirstImage\s*\?\s*'set_reference'\s*:\s*'first_result_benchmark'/);
});

test('buyer show model references support local human models and animal models', () => {
  assert.match(arkSource, /If the model reference shows an animal or pet, the set MUST include that animal/);
  assert.match(arkSource, /Human models must look like real local users from \$\{state\.targetCountry\}/);
  assert.match(workflowSource, /If a model reference image shows an animal or pet, include that animal as the animal model/);
  assert.match(workflowSource, /If a human appears, they must look like a real local user from \$\{targetCountry\}/);
});

test('buyer show detail supports review display, readable prompts and in-place edits', () => {
  assert.match(projectCardSource, /买家评价/);
  assert.match(projectCardSource, /getBuyerShowReadablePrompt/);
  assert.match(projectCardSource, /project\.module === 'buyer_show'/);
  assert.match(projectCardSource, /isVersionedImageProject/);
  assert.match(shellBuyerShowModuleSource, /onEditResult\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(appSource, /handleBuyerShowEditResult/);
  assert.match(appSource, /project\.module === AppModuleObj\.BUYER_SHOW/);
  assert.match(
    appSource,
    /<BuyerShowModule[\s\S]*?onEditResult=\{handleEditResult\}/,
    'buyer show shell module must receive the edit handler so completed result buttons are enabled'
  );
  assert.match(appSource, /storyboardImageVersions:\s*nextVersions/);
  assert.doesNotMatch(appSource, /project-edit-\$\{Date\.now\(\)\}[\s\S]{0,600}module:\s*project\.module[\s\S]{0,600}buyer_show/);
});

test('buyer show edit sends the final image together with uploaded edit references', () => {
  const urls = buildShellImageInputUrls({
    module: 'buyer_show',
    subFeature: 'image',
    materials: {
      product: [{ remoteUrl: 'https://cdn.example.com/current-result.png' }],
      reference: [
        { remoteUrl: 'https://cdn.example.com/model-ref.png' },
        { remoteUrl: 'https://cdn.example.com/scene-ref.png' },
      ],
    },
    taskMetadata: {
      shellPurpose: 'buyer_show_result_edit',
      sourceResultUrl: 'https://cdn.example.com/current-result.png',
      editInstruction: '换成午后阳台氛围',
    },
  });

  assert.deepEqual(urls, [
    'https://cdn.example.com/current-result.png',
    'https://cdn.example.com/model-ref.png',
    'https://cdn.example.com/scene-ref.png',
  ]);
});

test('buyer show creates immediate set project cards without fake image results', () => {
  assert.match(appSource, /immediateBuyerShowProjects/);
  assert.match(appSource, /targetModule === AppModuleObj\.BUYER_SHOW/);
  assert.match(
    appSource,
    /immediateBuyerShowProjects[\s\S]*?results:\s*\[\]/,
    'buyer show immediate project cards should not synthesize pending image results before real jobs exist'
  );
  assert.match(
    appSource,
    /const projectId = immediateProject\?\.id \|\| immediateBuyerShowRootProjectId \|\| 'proj-' \+ Date\.now\(\)/,
    'buyer show real workflow should reuse the immediate root project id so later job results fill the same set cards'
  );
  assert.doesNotMatch(
    appSource,
    /买家秀策划中，正在准备生图任务/,
    'buyer show should not persist planning placeholder text as a fake image result'
  );
});
