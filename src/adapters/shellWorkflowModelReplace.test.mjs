import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildModelReplacePrompt, normalizeModelReplacementScope } from '../utils/modelReplacePrompt.mjs';
import { normalizeModelReplaceRawUserPrompt } from '../utils/modelReplacePromptInput.mjs';
import { selectVirtualModelIdentityAssets } from '../utils/virtualModelSelection.mjs';

const workflowSource = readFileSync(new URL('./shellWorkflow.ts', import.meta.url), 'utf8');
const shellAppSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const kieAiServiceSource = readFileSync(new URL('../services/kieAiService.ts', import.meta.url), 'utf8');
const maxForAiProviderSource = readFileSync(
  new URL('../../server/providerMaxForAiImage.mjs', import.meta.url),
  'utf8',
);

test('shell workflow keeps current MaxForAI output resolution on the shared model-quality contract', () => {
  assert.match(workflowSource, /const quality = toQuality\(firstParam\(input\.params, \['quality', 'resolution'\], '1K'\)\)/);
  assert.match(kieAiServiceSource, /resolution:[\s\S]*moduleConfig\.quality\.toUpperCase\(\)/);
  assert.match(maxForAiProviderSource, /resolveMaxForAiImageSize\(payload\.aspectRatio \|\| 'auto', payload\.resolution \|\| '1K'\)/);
  assert.doesNotMatch(workflowSource, /gpt-image-2-1k|gpt-image-2-2k/);
});

const evaluateModelReplaceWorkflowFactory = () => {
  const block = workflowSource.match(
    /const createModelReplaceWorkflow: ModelReplaceWorkflowFactory = [\s\S]*?(?=\n\nconst runModelReplaceWorkflow)/,
  )?.[0] || '';
  assert.ok(block, 'missing model replacement workflow factory');
  const executable = block
    .replace(
      'const createModelReplaceWorkflow: ModelReplaceWorkflowFactory =',
      'const createModelReplaceWorkflow =',
    )
    .replace(/\(error as any\)/g, 'error');
  return Function(`${executable}\nreturn createModelReplaceWorkflow;`)();
};

const material = (type, index, dimensions = {}) => ({
  id: `${type}-${index}`,
  type,
  url: `blob:${type}-${index}`,
  remoteUrl: `https://assets.example/${type}-${index}.png`,
  fileName: `${type}-${index}.png`,
  ...dimensions,
});

const baseInput = ({ identityCount = 2, referenceCount = 2, signal = new AbortController().signal } = {}) => ({
  module: 'everything_replace',
  subFeature: 'model_replace',
  prompt: '保留参考图中的手提包',
  params: { replacementScope: '全部替换' },
  materials: {
    model: Array.from({ length: identityCount }, (_, index) => material('identity', index + 1)),
    styleRef: Array.from({ length: referenceCount }, (_, index) => material(
      'reference',
      index + 1,
      index === 0 ? { originalWidth: 900, originalHeight: 1600 } : { originalWidth: 1600, originalHeight: 900 },
    )),
  },
  signal,
  publicBaseUrl: 'https://meiao.local',
  taskMetadata: {
    shellProjectId: 'project-1',
    shellProjectName: 'Model project',
    subFeature: 'unsafe-override',
    batchIndex: 99,
    replacementScope: 'unsafe-override',
  },
  onJobCreated: () => undefined,
});

const createHarness = ({
  processResult,
  maxInputImages = 8,
  assertCounts = () => undefined,
  resolveAspectRatio,
} = {}) => {
  const calls = { process: [], aspect: [], converted: [] };
  const createWorkflow = evaluateModelReplaceWorkflowFactory();
  const workflow = createWorkflow({
    collectRequiredMaterialUrls: (items, _publicBaseUrl, label) => {
      assert.ok(label === '人物身份图' || label === '待替换参考图');
      return items.map((item) => item.remoteUrl);
    },
    assertModelReplaceMaterialCounts: assertCounts,
    getImageModelCapabilities: () => ({ maxInputImages }),
    normalizeModelReplacementScope,
    normalizeModelReplaceRawUserPrompt,
    selectVirtualModelIdentityAssets,
    resolveProductReplaceReferenceAspectRatio: async (reference, config, publicBaseUrl, signal) => {
      calls.aspect.push({ reference, config, publicBaseUrl, signal });
      if (resolveAspectRatio) return resolveAspectRatio(reference);
      return reference.fileName === 'reference-1.png' ? '9:16' : '16:9';
    },
    buildModelReplacePrompt,
    processWithKieAi: async (...args) => {
      calls.process.push(args);
      return processResult ? processResult(calls.process.length, args) : {
        status: 'success',
        imageUrl: `https://results.example/${calls.process.length}.png`,
        taskId: `provider-${calls.process.length}`,
        creditsConsumed: calls.process.length + 1,
      };
    },
    toProductReplaceResultItem: async (...args) => {
      calls.converted.push(args);
      const [generation, prompt, config, aspectRatio, batchIndex, , sourceUrl, , taskLabel] = args;
      if (generation.status !== 'success') {
        return {
          imageUrl: '', prompt, model: config.model, aspectRatio, sourceUrl, batchIndex,
          taskId: generation.taskId,
          status: generation.status === 'generating' ? 'generating' : 'error',
          error: generation.message,
          message: generation.message,
          errorCode: generation.errorCode,
        };
      }
      return {
        imageUrl: generation.imageUrl,
        prompt,
        model: config.model,
        aspectRatio,
        sourceUrl,
        batchIndex,
        status: 'completed',
        taskId: generation.taskId,
        creditsConsumed: generation.creditsConsumed,
        taskLabel,
      };
    },
    getImageResultModelLabel: (config) => config.model,
  });
  return { workflow, calls };
};

const librarySnapshot = {
  identitySource: 'library',
  virtualModelId: 'model-1',
  virtualModelVersionId: 'version-1',
  modelName: 'Han Dongsheng',
  modelCode: 'HD-001',
  versionNumber: 2,
  selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
};

test('library mode submits only selection and reference analysis', async () => {
  const { workflow, calls } = createHarness();
  const input = baseInput({ identityCount: 0, referenceCount: 2 });
  input.identitySource = 'library';
  input.virtualModelSnapshot = librarySnapshot;
  input.preflight = {
    referenceAnalysis: [
      {
        index: 1,
        framing: 'half_body',
        faceDirection: 'front',
        headPitch: 'level',
        occlusion: 'low',
        exposedSkinRegions: ['face', 'ears', 'neck', 'hands'],
      },
      {
        index: 2,
        framing: 'full_body',
        faceDirection: 'right',
        headPitch: 'down',
        occlusion: 'medium',
        exposedSkinRegions: ['face', 'neck', 'arms', 'hands', 'legs'],
      },
    ],
  };

  const result = await workflow(input, { model: 'gpt-image-2', aspectRatio: 'auto' }, {});

  assert.deepEqual(result.results.map((item) => item.status), ['completed', 'completed']);

  assert.deepEqual(calls.process.map((call) => call[0]), [['https://assets.example/reference-1.png'], ['https://assets.example/reference-2.png']]);
  assert.equal(calls.process[0][9].identitySource, 'library');
  assert.equal(calls.process[0][9].virtualModelId, 'model-1');
  assert.equal(calls.process[0][9].virtualModelVersionId, 'version-1');
  assert.equal(calls.process[0][9].modelName, 'Han Dongsheng');
  assert.equal(calls.process[0][9].modelCode, 'HD-001');
  assert.equal(calls.process[0][9].versionNumber, 2);
  assert.equal(calls.process[0][9].identityImageCount, 3);
  assert.deepEqual(calls.process.map((call) => call[9].referenceAnalysis?.index), [1, 2]);
  assert.match(calls.process[0][5], /轻量分析：半身构图，脸部正面，头部平视，遮挡较少/);
  assert.match(calls.process[0][5], /裸露皮肤区域：脸部、耳朵、颈部、手部/);
  assert.doesNotMatch(calls.process[0][5], /全身构图，脸部朝右|腿部/);
  assert.match(calls.process[1][5], /轻量分析：全身构图，脸部朝右，头部微低，存在中等遮挡/);
  assert.match(calls.process[1][5], /裸露皮肤区域：脸部、颈部、手臂、手部、腿部/);
  assert.doesNotMatch(calls.process[1][5], /半身构图，脸部正面/);
  assert.equal(JSON.stringify(calls.process[0][9]).includes('library.example'), false);
});

test('model replacement creates one ordered job per reference with exact inputs, prompts, metadata, and callbacks', async () => {
  const { workflow, calls } = createHarness();
  const input = baseInput();
  const createdJobs = [];
  input.onJobCreated = (...args) => createdJobs.push(args);
  const taskMetadataBefore = structuredClone(input.taskMetadata);
  const completed = [];
  const config = { model: 'gpt-image-2', aspectRatio: 'auto', targetWidth: 320, targetHeight: 480 };
  const apiConfig = { concurrency: 1 };

  const result = await workflow(input, config, apiConfig, (item, index, total) => {
    completed.push({ item, index, total });
  });

  assert.deepEqual(result.results.map((item) => item.sourceUrl), [
    'https://assets.example/reference-1.png',
    'https://assets.example/reference-2.png',
  ]);
  assert.deepEqual(result.results.map((item) => item.fileName), ['reference-1.png', 'reference-2.png']);
  assert.deepEqual(result.results.map((item) => item.aspectRatio), ['9:16', '16:9']);
  assert.deepEqual(result.results.map((item) => item.batchIndex), [1, 2]);
  assert.equal(result.creditsConsumed, 5);
  assert.deepEqual(input.taskMetadata, taskMetadataBefore);
  assert.deepEqual(completed.map(({ index, total }) => [index, total]), [[1, 2], [2, 2]]);
  assert.equal(new Set(completed.map(({ index }) => index)).size, 2);

  assert.deepEqual(calls.process.map((call) => call[0]), [
    [
      'https://assets.example/identity-1.png',
      'https://assets.example/identity-2.png',
      'https://assets.example/reference-1.png',
    ],
    [
      'https://assets.example/identity-1.png',
      'https://assets.example/identity-2.png',
      'https://assets.example/reference-2.png',
    ],
  ]);
  assert.equal(calls.process[0][1], apiConfig);
  assert.deepEqual(calls.process.map((call) => call[2]), [
    { ...config, aspectRatio: '9:16', targetLanguage: 'zh', removeWatermark: true, resolutionMode: 'original', targetWidth: 0, targetHeight: 0 },
    { ...config, aspectRatio: '16:9', targetLanguage: 'zh', removeWatermark: true, resolutionMode: 'original', targetWidth: 0, targetHeight: 0 },
  ]);
  assert.deepEqual(calls.process.map((call) => call[3]), [false, false]);
  assert.equal(calls.process[0][4], input.signal);
  assert.match(calls.process[0][5], /图3/);
  assert.match(calls.process[0][5], /第1张\/共2张/);
  assert.match(calls.process[1][5], /第2张\/共2张/);
  assert.match(calls.process[0][5], /比例为 9:16/);
  assert.match(calls.process[1][5], /比例为 16:9/);
  assert.match(calls.process[0][5], /保留参考图中的手提包/);
  assert.equal(calls.process[0][10], input.onJobCreated);
  calls.process[0][10]('job-1', 'provider-job-1');
  assert.deepEqual(createdJobs, [['job-1', 'provider-job-1']]);

  assert.deepEqual(calls.process.map((call) => call[9]), [
    {
      shellProjectId: 'project-1',
      shellProjectName: 'Model project',
      subFeature: 'model_replace',
      batchIndex: 1,
      replacementScope: 'identity_only',
      identityImageCount: 2,
      modelReplaceRawUserPrompt: '保留参考图中的手提包',
      preserveInputImageOrder: true,
      skipPromptCleanupSuffix: true,
      batchCount: 2,
      referenceIndex: 1,
      referenceCount: 2,
    },
    {
      shellProjectId: 'project-1',
      shellProjectName: 'Model project',
      subFeature: 'model_replace',
      batchIndex: 2,
      replacementScope: 'identity_only',
      identityImageCount: 2,
      modelReplaceRawUserPrompt: '保留参考图中的手提包',
      preserveInputImageOrder: true,
      skipPromptCleanupSuffix: true,
      batchCount: 2,
      referenceIndex: 2,
      referenceCount: 2,
    },
  ]);
  assert.equal(calls.converted.length, 2);
  assert.deepEqual(result.results.map((item) => item.imageUrl), [
    'https://results.example/1.png',
    'https://results.example/2.png',
  ]);
});

test('model replacement isolates a thrown reference failure and retains sibling success credits', async () => {
  const { workflow, calls } = createHarness({
    processResult: async (callIndex) => {
      if (callIndex === 1) {
        const error = new Error('first reference exploded');
        error.code = 'provider_request_limit';
        throw error;
      }
      return { status: 'success', imageUrl: 'https://results.example/second.png', creditsConsumed: 7 };
    },
  });
  const completed = [];

  const result = await workflow(
    baseInput(),
    { model: 'gpt-image-2', aspectRatio: 'auto' },
    {},
    (item, index, total) => completed.push({ item, index, total }),
  );

  assert.equal(calls.process.length, 2);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((item) => item.status), ['error', 'completed']);
  assert.equal(result.results[0].imageUrl, '');
  assert.equal(result.results[0].fileName, 'reference-1.png');
  assert.equal(result.results[0].sourceUrl, 'https://assets.example/reference-1.png');
  assert.equal(result.results[0].error, 'first reference exploded');
  assert.equal(result.results[0].message, 'first reference exploded');
  assert.equal(result.results[0].errorCode, 'provider_request_limit');
  assert.equal(result.results[0].batchIndex, 1);
  assert.match(result.results[0].prompt, /第1张\/共2张/);
  assert.equal(result.creditsConsumed, 7);
  assert.deepEqual(completed.map(({ index, total }) => [index, total]), [[1, 2], [2, 2]]);
  assert.equal(completed[0].item, result.results[0]);
  assert.equal(completed[1].item, result.results[1]);
});

test('model replacement isolates aspect resolution rejection and uses a stable reference filename fallback', async () => {
  const { workflow, calls } = createHarness({
    resolveAspectRatio: (reference) => {
      if (reference.id === 'reference-1') throw new Error('aspect lookup failed');
      return '16:9';
    },
  });
  const input = baseInput();
  delete input.materials.styleRef[0].fileName;
  const completed = [];

  const result = await workflow(
    input,
    { model: 'gpt-image-2', aspectRatio: 'auto' },
    {},
    (item, index, total) => completed.push({ item, index, total }),
  );

  assert.equal(calls.process.length, 1);
  assert.deepEqual(result.results.map((item) => item.status), ['error', 'completed']);
  assert.equal(result.results[0].error, 'aspect lookup failed');
  assert.equal(result.results[0].errorCode, 'model_replace_failed');
  assert.equal(result.results[0].fileName, '待替换参考图 1');
  assert.equal(result.results[1].fileName, 'reference-2.png');
  assert.equal(result.creditsConsumed, 2);
  assert.deepEqual(completed.map(({ index, total }) => [index, total]), [[1, 2], [2, 2]]);
});

test('model replacement preserves provider generating and error conversion', async () => {
  const { workflow } = createHarness({
    processResult: (callIndex) => callIndex === 1
      ? { status: 'generating', taskId: 'pending-1', message: 'pending' }
      : { status: 'error', taskId: 'failed-2', message: 'provider rejected', errorCode: 'provider_error' },
  });

  const result = await workflow(baseInput(), { model: 'gpt-image-2', aspectRatio: 'auto' }, {});

  assert.deepEqual(result.results.map((item) => item.status), ['generating', 'error']);
  assert.deepEqual(result.results.map((item) => item.taskId), ['pending-1', 'failed-2']);
  assert.equal(result.results[1].errorCode, 'provider_error');
});

test('model replacement preserves provider interruption instead of reporting an ordinary failure', () => {
  const converter = workflowSource.match(
    /const toProductReplaceResultItem = async \([\s\S]*?(?=\n\ntype ModelReplaceWorkflowDependencies)/,
  )?.[0] || '';

  assert.ok(converter, 'missing product replacement result converter');
  assert.match(converter, /generation\.status === 'interrupted' \? 'interrupted'/);
  assert.match(converter, /errorCode: generation\.status === 'interrupted' \? 'INTERRUPTED' : generation\.errorCode/);
});

test('model replacement count and capability guards run before image generation', async () => {
  let countCalls = 0;
  const invalidCounts = createHarness({
    assertCounts: () => {
      countCalls += 1;
      throw new Error('count guard');
    },
  });
  await assert.rejects(
    () => invalidCounts.workflow(baseInput({ identityCount: 0 }), { model: 'gpt-image-2', aspectRatio: 'auto' }, {}),
    /count guard/,
  );
  assert.equal(countCalls, 1);
  assert.equal(invalidCounts.calls.process.length, 0);

  const overCapacity = createHarness({ maxInputImages: 4 });
  await assert.rejects(
    () => overCapacity.workflow(baseInput({ identityCount: 4, referenceCount: 1 }), { model: 'limited-model', aspectRatio: 'auto' }, {}),
    /最多支持 4 张输入图片.*每个任务需要 5 张/,
  );
  assert.equal(overCapacity.calls.process.length, 0);

  const libraryOverCapacity = createHarness({ maxInputImages: 3 });
  const libraryInput = baseInput({ identityCount: 0, referenceCount: 1 });
  libraryInput.identitySource = 'library';
  libraryInput.virtualModelSnapshot = librarySnapshot;
  await assert.rejects(
    () => libraryOverCapacity.workflow(libraryInput, { model: 'limited-model', aspectRatio: 'auto' }, {}),
    /最多支持 3 张输入图片.*每个任务需要 4 张/,
  );
  assert.equal(libraryOverCapacity.calls.process.length, 0);

  const libraryAtCapacity = createHarness({ maxInputImages: 4 });
  const result = await libraryAtCapacity.workflow(libraryInput, { model: 'limited-model', aspectRatio: 'auto' }, {});
  assert.equal(result.results[0].status, 'completed');
  assert.equal(libraryAtCapacity.calls.process.length, 1);
});

test('model replacement respects an already aborted signal without starting image jobs', async () => {
  const controller = new AbortController();
  controller.abort();
  const { workflow, calls } = createHarness();
  const result = await workflow(baseInput({ signal: controller.signal }), { model: 'gpt-image-2', aspectRatio: 'auto' }, {});

  assert.equal(calls.process.length, 0);
  assert.deepEqual(result.results.map((item) => item.status), ['interrupted', 'interrupted']);
  assert.deepEqual(result.results.map((item) => item.errorCode), ['INTERRUPTED', 'INTERRUPTED']);
});

test('model replacement aborted during aspect resolution never starts an image job', async () => {
  const controller = new AbortController();
  let releaseAspectRatio;
  const aspectRatioPending = new Promise((resolve) => {
    releaseAspectRatio = resolve;
  });
  const { workflow, calls } = createHarness({
    resolveAspectRatio: () => aspectRatioPending,
  });
  const jobCalls = [];
  const completed = [];
  const input = baseInput({ referenceCount: 1, signal: controller.signal });
  input.onJobCreated = (...args) => jobCalls.push(args);

  const pendingResult = workflow(
    input,
    { model: 'gpt-image-2', aspectRatio: 'auto' },
    {},
    (item, index, total) => completed.push({ item, index, total }),
  );
  await Promise.resolve();
  assert.equal(calls.aspect.length, 1);
  controller.abort();
  releaseAspectRatio('1:1');

  const result = await pendingResult;
  assert.equal(calls.process.length, 0);
  assert.deepEqual(jobCalls, []);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, 'interrupted');
  assert.equal(result.results[0].error, 'INTERRUPTED');
  assert.equal(result.results[0].errorCode, 'INTERRUPTED');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].item, result.results[0]);
  assert.deepEqual([completed[0].index, completed[0].total], [1, 1]);
});

test('handleGenerate ignores every late workflow side effect after its task controller is cancelled', () => {
  const handleGenerate = shellAppSource.match(
    /const handleGenerate = useCallback\(async \(\) => \{[\s\S]*?^  \}, \[[^\n]+\]\);/m,
  )?.[0] || '';
  const standardGeneration = handleGenerate.slice(handleGenerate.lastIndexOf('    // Create project'));
  const specialCallback = standardGeneration.match(
    /const onSpecialItemCompleted = \([\s\S]*?(?=\n        const buyerShowSetCount)/,
  )?.[0] || '';
  const terminalSettlement = standardGeneration.match(
    /      setProjects\(\(prev\) => prev\.map\(\(p\) =>[\s\S]*?(?=\n    } catch \(error\))/,
  )?.[0] || '';
  const catchSettlement = standardGeneration.slice(standardGeneration.lastIndexOf('    } catch (error) {'));

  assert.ok(handleGenerate, 'missing handleGenerate');
  assert.match(handleGenerate, /const generationWasCancelled = \(\) => controller\.signal\.aborted\s*\|\| taskControllersRef\.current\[taskId\] !== controller/);
  assert.match(specialCallback, /if \(generationWasCancelled\(\)\) return/,
    'cancelled workflows must not deliver late onItemCompleted mutations');
  assert.match(standardGeneration, /}, onSpecialItemCompleted\);\s*if \(generationWasCancelled\(\)\) return;\s*if \(shouldStopProductRestore\(\)\) return;\s*const specialWorkflowResults/,
    'cancelled special workflows must stop before every terminal branch');
  assert.match(terminalSettlement, /^      if \(generationWasCancelled\(\)\) return;/m,
    'cancelled workflows must not write or persist a terminal project');
  assert.match(
    terminalSettlement,
    /const synced = await persistProjectToSharedState\(completedProject, \{\s*guard: \(\) => !generationWasCancelled\(\),\s*signal: controller\.signal,\s*\}\);\s*if \(generationWasCancelled\(\)\) return;/,
    'queued persistence and every post-persist effect must stop when cancellation wins the race',
  );
  assert.match(terminalSettlement, /addToast\(/,
    'the guarded terminal block includes the completion toast');
  assert.match(catchSettlement, /^      if \(generationWasCancelled\(\)\) return;/m,
    'cancelled workflows must not write a failure project or show an error toast');
  assert.match(catchSettlement, /await persistProjectToSharedState\(failedProject, \{\s*guard: \(\) => !generationWasCancelled\(\),\s*signal: controller\.signal,\s*\}\);\s*if \(generationWasCancelled\(\)\) return;/);
  assert.match(catchSettlement, /addToast\(message, isProductRestorePersistenceFailure \? 'warning' : 'error'\)/);
});

test('handleGenerate never completes or celebrates a provider-interrupted special workflow', () => {
  const handleGenerate = shellAppSource.match(
    /const handleGenerate = useCallback\(async \(\) => \{[\s\S]*?^  \}, \[[^\n]+\]\);/m,
  )?.[0] || '';
  const standardGeneration = handleGenerate.slice(handleGenerate.lastIndexOf('    // Create project'));
  const specialSettlement = standardGeneration.match(
    /const specialWorkflowResults:[\s\S]*?(?=\n        if \(isBuyerShowSetProjectWorkflow\))/,
  )?.[0] || '';

  assert.ok(specialSettlement, 'missing special workflow settlement');
  assert.match(specialSettlement, /const hasSpecialInterrupted = specialResult\.results\.some\(\(item\) => item\.status === 'interrupted'\)/);
  assert.match(specialSettlement, /if \(hasSpecialInterrupted\) \{[\s\S]*throw interruptedError;[\s\S]*\}/,
    'provider interruption must enter failure settlement before a completed project or completion toast');
  assert.ok(
    specialSettlement.indexOf('if (hasSpecialInterrupted)') < specialSettlement.indexOf('completedProject ='),
    'provider interruption guard must precede completed-project construction',
  );
});

test('model replacement route and source contracts stay separate from preflight and product-person rewrite logic', () => {
  const factoryBlock = workflowSource.match(
    /const createModelReplaceWorkflow: ModelReplaceWorkflowFactory = [\s\S]*?(?=\n\nconst runModelReplaceWorkflow)/,
  )?.[0] || '';
  const dispatcher = workflowSource.match(/export const runShellRetouchWorkflow = async \([\s\S]*?^};/m)?.[0] || '';

  assert.match(workflowSource, /import \{ buildModelReplacePrompt \} from '\.\.\/utils\/modelReplacePrompt\.mjs'/);
  assert.match(workflowSource, /type ShellRetouchMode = .*'model_replace'/);
  assert.match(workflowSource, /input\.module === AppModule\.EVERYTHING_REPLACE && \(value === 'model_replace' \|\| value\.includes\('模特'\)\)/);
  assert.match(dispatcher, /if \(mode === 'model_replace'\) \{\s*return runModelReplaceWorkflow\(/);
  assert.ok(dispatcher.indexOf("mode === 'model_replace'") < dispatcher.indexOf("mode === 'product_replace'"));
  const preflightFacade = workflowSource.match(/export const preflightShellModelReplace = async \([\s\S]*?^};/m)?.[0] || '';
  assert.equal((workflowSource.match(/analyzeModelReplaceMaterials\(\{/g) || []).length, 1);
  assert.match(preflightFacade, /analyzeModelReplaceMaterials\(\{/);
  assert.match(preflightFacade, /skipIdentityValidation: isLibraryIdentity/);
  assert.doesNotMatch(preflightFacade, /if \(!isLibraryIdentity\) return \{ passed: true, issues: \[\] \};/);
  assert.doesNotMatch(factoryBlock, /analyzeModelReplaceMaterials/);
  assert.doesNotMatch(factoryBlock, /expressionSource/);
  assert.doesNotMatch(factoryBlock, /必须重绘为不同人物/);
  assert.match(shellAppSource, /targetSubFeature === 'model_replace' \? ''/);
  assert.doesNotMatch(factoryBlock, /normalizeModelReplacementScope|input\.params\.replacementScope/);
  assert.match(factoryBlock, /const replacementScope = 'identity_only'/);
});

test('model replacement preflight keeps copy policy out of lightweight reference analysis', () => {
  const preflightFacade = workflowSource.match(
    /export const preflightShellModelReplace = async \([\s\S]*?^};/m,
  )?.[0] || '';

  assert.doesNotMatch(preflightFacade, /const textPolicy =/);
  assert.doesNotMatch(preflightFacade, /textPolicy,/);
  assert.doesNotMatch(preflightFacade, /normalizeModelReplacementScope|input\.params\.replacementScope/);
  assert.match(preflightFacade, /replacementScope: 'identity_only'/);
  assert.match(preflightFacade, /analyzeModelReplaceMaterials\(\{[\s\S]*?skipIdentityValidation: isLibraryIdentity/);
  assert.equal((preflightFacade.match(/analyzeModelReplaceMaterials\(\{/g) || []).length, 1);
});
