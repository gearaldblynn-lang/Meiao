import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createServer } from 'vite';

const workflowPath = new URL('./shellProductRestoreWorkflow.ts', import.meta.url);
const shellWorkflowPath = new URL('./shellWorkflow.ts', import.meta.url);
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
let moduleSequence = 0;

const loadActiveModule = async (modulePath) => {
  const viteServer = await createServer({
    root: projectRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  try {
    return await viteServer.ssrLoadModule(modulePath);
  } finally {
    await viteServer.close();
  }
};

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
};

const durableCallbacks = {
  onAnalysisCompleted: async () => {},
};

const analysisFixture = {
  productIdentitySummary: 'Verified product identity',
  invariantFeatures: ['Keep the exact bottle body'],
  shapeAndStructure: ['Tall cylindrical body'],
  proportionAndContour: ['Narrow neck'],
  materialAndTexture: ['Frosted glass'],
  colorAndGloss: ['Amber body'],
  logoLabelAndText: ['Centered white label'],
  componentsAndCraft: ['Translucent cap'],
  targetSetIssues: ['Generated contours drift'],
  nonProductPreservationRules: ['Keep every background pixel'],
};

const makeContext = (overrides = {}) => ({
  version: 1,
  analysisJobId: 'analysis-job-1',
  analysisProviderTaskId: 'analysis-provider-1',
  analysisModel: 'analysis-model',
  analysisCreditsConsumed: 4,
  normalizedAnalysis: analysisFixture,
  sharedRestorationPrompt: 'shared product restoration prompt',
  focusIds: ['shape_structure', 'material_texture'],
  targetMaterialIds: ['target-a', 'target-b', 'target-c'],
  productReferenceMaterialIds: ['reference-a', 'reference-b'],
  selectedImageModel: 'gpt-image-2',
  resolution: '2K',
  userRequirement: 'Keep the cap translucency.',
  createdAt: 1_780_000_000_000,
  ...overrides,
});

const makeMaterial = (id, type, width = 1200, height = 1600) => ({
  id,
  type,
  url: `https://assets.test/${id}.png`,
  remoteUrl: `https://assets.test/${id}.png`,
  fileName: `${id}.png`,
  subFeature: 'product_restore',
  originalWidth: width,
  originalHeight: height,
});

const makeInput = ({ targetCount = 2, context, params = {}, taskMetadata = {} } = {}) => ({
  module: 'retouch',
  subFeature: 'product_restore',
  prompt: 'Keep the cap translucency.',
  params: {
    restoreFocusIds: 'shape_structure,material_texture',
    quality: '1K',
    ratio: '16:9',
    ...params,
  },
  materials: {
    restoreTarget: ['target-a', 'target-b', 'target-c']
      .slice(0, targetCount)
      .map((id, index) => makeMaterial(id, 'restoreTarget', 1200 + index * 100, 1600)),
    productReference: [
      makeMaterial('reference-a', 'productReference'),
      makeMaterial('reference-b', 'productReference'),
    ],
  },
  signal: new AbortController().signal,
  publicBaseUrl: 'https://assets.test',
  taskMetadata: {
    shellProjectId: 'shell-project-1',
    shellProjectName: 'Product Restore Project',
    userId: 'user-1',
    ...taskMetadata,
  },
  productRestoreContext: context,
});

const makeConfig = (overrides = {}) => ({
  targetLanguage: 'zh',
  customLanguage: '',
  removeWatermark: false,
  aspectRatio: '16:9',
  quality: '1k',
  model: 'gpt-image-2',
  resolutionMode: 'custom',
  targetWidth: 800,
  targetHeight: 1200,
  maxFileSize: 2,
  ...overrides,
});

const successAnalysisResult = (overrides = {}) => ({
  status: 'success',
  jobId: 'analysis-job-1',
  providerTaskId: 'analysis-provider-1',
  modelUsed: 'analysis-model',
  creditsConsumed: 4,
  normalizedAnalysis: analysisFixture,
  sharedRestorationPrompt: 'shared product restoration prompt',
  ...overrides,
});

const stripRuntimeImports = (source) => source.replace(/^import[\s\S]*?;\n/gm, '');

const loadWorkflowModule = async ({ logs = [] } = {}) => {
  const source = readFileSync(workflowPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const runtimeSource = `
const {
  analyzeProductRestoreBatch,
  processWithKieAi,
  persistGeneratedAsset,
  normalizeFetchedImageBlob,
  normalizeProductRestoreFocusIds,
  normalizeProductRestoreResolution,
  parseProductRestoreAnalysis,
  resolvePublicAssetUrl,
  safeCreateInternalLog,
  validateProductRestoreInput,
  AspectRatio,
} = globalThis.__shellProductRestoreWorkflowTestDeps;
${stripRuntimeImports(transpiled)}
`;
  globalThis.__shellProductRestoreWorkflowTestDeps = {
    analyzeProductRestoreBatch: async () => {
      throw new Error('production analysis default must be dependency-injected in tests');
    },
    processWithKieAi: async () => {
      throw new Error('production image default must be dependency-injected in tests');
    },
    persistGeneratedAsset: async () => {
      throw new Error('production persistence default must be dependency-injected in tests');
    },
    normalizeFetchedImageBlob: async (blob) => blob,
    normalizeProductRestoreFocusIds: (value) => {
      const requested = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      return requested.length > 0 ? [...new Set(requested)] : ['shape_structure', 'material_texture'];
    },
    normalizeProductRestoreResolution: (_model, value) => String(value || '').toUpperCase() === '4K' ? '4K' : '2K',
    parseProductRestoreAnalysis: (value) => {
      try {
        const parsed = JSON.parse(String(value || ''));
        const requiredArrays = [
          'invariantFeatures',
          'shapeAndStructure',
          'proportionAndContour',
          'materialAndTexture',
          'colorAndGloss',
          'logoLabelAndText',
          'componentsAndCraft',
          'targetSetIssues',
          'nonProductPreservationRules',
        ];
        const valid = Boolean(
          parsed
          && typeof parsed.productIdentitySummary === 'string'
          && parsed.productIdentitySummary.trim()
          && requiredArrays.every((key) => Array.isArray(parsed[key])),
        );
        return valid
          ? { ok: true, value: parsed }
          : { ok: false, errorCode: 'product_restore_analysis_invalid' };
      } catch {
        return { ok: false, errorCode: 'product_restore_analysis_invalid' };
      }
    },
    resolvePublicAssetUrl: (value) => String(value || '').trim(),
    safeCreateInternalLog: async (entry) => {
      logs.push(entry);
      return null;
    },
    validateProductRestoreInput: ({ restoreTargets, productReferences }) => {
      if (!restoreTargets?.length) return { ok: false, errorCode: 'target_required', message: 'target required' };
      if (!productReferences?.length) return { ok: false, errorCode: 'reference_required', message: 'reference required' };
      return { ok: true };
    },
    AspectRatio: { AUTO: 'auto' },
  };
  const encodedSource = Buffer.from(runtimeSource).toString('base64');
  try {
    return await import(`data:text/javascript;base64,${encodedSource}#product-restore-${++moduleSequence}`);
  } finally {
    delete globalThis.__shellProductRestoreWorkflowTestDeps;
  }
};

const createHarness = ({ analysisResult, imageResults, generateImage } = {}) => {
  const calls = {
    analysis: [],
    images: [],
    persist: [],
  };
  const queuedResults = imageResults || [];
  const deps = {
    analyzeBatch: async (input) => {
      calls.analysis.push(input);
      return analysisResult || successAnalysisResult();
    },
    generateImage: generateImage || (async (...args) => {
      const index = calls.images.length;
      calls.images.push(args);
      const onJobCreated = args[10];
      onJobCreated?.(`backend-job-${index + 1}`);
      return queuedResults[index] || {
        imageUrl: `https://provider.test/result-${index + 1}.png`,
        taskId: `provider-task-${index + 1}`,
        backendJobId: `backend-job-${index + 1}`,
        status: 'success',
        creditsConsumed: 2,
      };
    }),
    persistImage: async (url, fileName, signal) => {
      calls.persist.push({ url, fileName, signal });
      return `https://assets.test/persisted/${fileName}`;
    },
  };
  return { calls, deps };
};

test('submits one analysis call with every target and ordered product reference', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { calls, deps } = createHarness();
  const input = makeInput();

  await runShellProductRestoreWorkflow(input, makeConfig(), durableCallbacks, deps);

  assert.equal(calls.analysis.length, 1);
  assert.deepEqual(calls.analysis[0].targetUrls, [
    'https://assets.test/target-a.png',
    'https://assets.test/target-b.png',
  ]);
  assert.deepEqual(calls.analysis[0].productReferenceUrls, [
    'https://assets.test/reference-a.png',
    'https://assets.test/reference-b.png',
  ]);
});

test('awaits durable analysis persistence before starting the first image job', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => {
    releasePersistence = resolve;
  });
  const { calls, deps } = createHarness();

  const run = runShellProductRestoreWorkflow(makeInput(), makeConfig(), {
    onAnalysisCompleted: async () => persistenceGate,
  }, deps);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.analysis.length, 1);
  assert.equal(calls.images.length, 0);
  releasePersistence();
  await run;
  assert.equal(calls.images.length, 2);
});

test('fans out one image job per target with current target first and all references ordered', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { calls, deps } = createHarness();

  await runShellProductRestoreWorkflow(makeInput({ targetCount: 3 }), makeConfig(), durableCallbacks, deps);

  assert.equal(calls.images.length, 3);
  assert.deepEqual(calls.images.map((args) => args[0]), [
    [
      'https://assets.test/target-a.png',
      'https://assets.test/reference-a.png',
      'https://assets.test/reference-b.png',
    ],
    [
      'https://assets.test/target-b.png',
      'https://assets.test/reference-a.png',
      'https://assets.test/reference-b.png',
    ],
    [
      'https://assets.test/target-c.png',
      'https://assets.test/reference-a.png',
      'https://assets.test/reference-b.png',
    ],
  ]);
});

test('adds stable product restoration identity and batch metadata to every image job', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { calls, deps } = createHarness();

  const result = await runShellProductRestoreWorkflow(makeInput(), makeConfig(), durableCallbacks, deps);

  assert.deepEqual(calls.images.map((args) => {
    const metadata = args[9];
    return {
      taskPurpose: metadata.taskPurpose,
      shellProjectId: metadata.shellProjectId,
      analysisJobId: metadata.analysisJobId,
      targetMaterialId: metadata.targetMaterialId,
      batchIndex: metadata.batchIndex,
      batchCount: metadata.batchCount,
      clientSubmissionKey: metadata.clientSubmissionKey,
    };
  }), [
    {
      taskPurpose: 'product_restore_generation',
      shellProjectId: 'shell-project-1',
      analysisJobId: 'analysis-job-1',
      targetMaterialId: 'target-a',
      batchIndex: 1,
      batchCount: 2,
      clientSubmissionKey: 'shell-project-1:product_restore:analysis-job-1:target-a:v1',
    },
    {
      taskPurpose: 'product_restore_generation',
      shellProjectId: 'shell-project-1',
      analysisJobId: 'analysis-job-1',
      targetMaterialId: 'target-b',
      batchIndex: 2,
      batchCount: 2,
      clientSubmissionKey: 'shell-project-1:product_restore:analysis-job-1:target-b:v1',
    },
  ]);
  assert.deepEqual(result.results.map((item) => item.targetMaterialId), ['target-a', 'target-b']);
  assert.deepEqual(result.results.map((item) => item.analysisJobId), ['analysis-job-1', 'analysis-job-1']);
});

test('emits the pending backend identity while the image provider work is still running', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const pendingEvents = [];
  let releaseImage;
  const imageGate = new Promise((resolve) => {
    releaseImage = resolve;
  });
  const calls = { images: [] };
  const { deps } = createHarness({
    generateImage: async (...args) => {
      calls.images.push(args);
      args[10]?.('backend-pending-1');
      await imageGate;
      return {
        imageUrl: 'https://provider.test/final.png',
        taskId: 'provider-final-1',
        backendJobId: 'backend-pending-1',
        status: 'success',
      };
    },
  });

  const run = runShellProductRestoreWorkflow(makeInput({ targetCount: 1 }), makeConfig(), {
    onAnalysisCompleted: durableCallbacks.onAnalysisCompleted,
    onItemChanged: async (item) => {
      pendingEvents.push(item);
    },
  }, deps);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.images.length, 1);
  assert.equal(pendingEvents.length, 1);
  assert.equal(pendingEvents[0].status, 'generating');
  assert.equal(pendingEvents[0].backendJobId, 'backend-pending-1');
  releaseImage();
  await run;
});

test('preserves input order and successful URLs across mixed success, error, and pending settlement', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { deps } = createHarness({
    imageResults: [
      {
        imageUrl: 'https://provider.test/success-a.png',
        taskId: 'provider-a',
        backendJobId: 'backend-job-1',
        status: 'success',
        creditsConsumed: 3,
      },
      {
        imageUrl: '',
        taskId: 'provider-b',
        backendJobId: 'backend-job-2',
        status: 'error',
        message: 'second target failed',
        errorCode: 'provider_bad_response',
      },
      {
        imageUrl: '',
        taskId: 'provider-c',
        backendJobId: 'backend-job-3',
        status: 'generating',
        message: 'still running',
      },
    ],
  });

  const result = await runShellProductRestoreWorkflow(
    makeInput({ targetCount: 3 }),
    makeConfig(),
    durableCallbacks,
    deps,
  );

  assert.deepEqual(result.results.map((item) => item.targetMaterialId), ['target-a', 'target-b', 'target-c']);
  assert.deepEqual(result.results.map((item) => item.status), ['completed', 'error', 'generating']);
  assert.match(result.results[0].imageUrl, /persisted/);
  assert.equal(result.results[1].imageUrl, '');
  assert.equal(result.results[2].backendJobId, 'backend-job-3');
  assert.equal(result.creditsConsumed, 7);
});

test('keeps consumed image credits when provider success later fails asset persistence', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { deps } = createHarness({
    imageResults: [
      {
        imageUrl: 'https://provider.test/success-a.png',
        taskId: 'provider-a',
        backendJobId: 'backend-job-1',
        status: 'success',
        creditsConsumed: 5,
      },
      {
        imageUrl: 'https://provider.test/success-b.png',
        taskId: 'provider-b',
        backendJobId: 'backend-job-2',
        status: 'success',
        creditsConsumed: 2,
      },
    ],
  });
  let persistCount = 0;
  deps.persistImage = async (_url, fileName) => {
    persistCount += 1;
    if (persistCount === 1) {
      throw Object.assign(new Error('asset persistence failed'), {
        code: 'product_restore_asset_download_failed',
      });
    }
    return `https://assets.test/persisted/${fileName}`;
  };

  const result = await runShellProductRestoreWorkflow(makeInput(), makeConfig(), durableCallbacks, deps);

  assert.deepEqual(result.results.map((item) => item.status), ['error', 'completed']);
  assert.equal(result.results[0].creditsConsumed, 5);
  assert.equal(result.creditsConsumed, 11);
});

test('terminal analysis failure creates zero image jobs and rejects without fallback generation', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { calls, deps } = createHarness({
    analysisResult: {
      status: 'error',
      errorCode: 'provider_refusal',
      message: 'analysis refused',
      jobId: 'analysis-job-1',
      providerTaskId: 'analysis-provider-1',
    },
  });

  await assert.rejects(
    runShellProductRestoreWorkflow(makeInput(), makeConfig(), durableCallbacks, deps),
    (error) => error.code === 'provider_refusal' && error.jobId === 'analysis-job-1',
  );
  assert.equal(calls.images.length, 0);
});

test('recoverable pending analysis returns planning state and creates zero image jobs', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { calls, deps } = createHarness({
    analysisResult: {
      status: 'generating',
      jobId: 'analysis-job-pending',
      providerTaskId: 'analysis-provider-pending',
      errorCode: 'analysis_result_pending',
      message: '产品还原分析已提交，结果仍在生成中。',
    },
  });

  const result = await runShellProductRestoreWorkflow(makeInput(), makeConfig(), durableCallbacks, deps);

  assert.deepEqual(result, {
    results: [],
    analysisStatus: 'generating',
    analysisJobId: 'analysis-job-pending',
    message: '产品还原分析已提交，结果仍在生成中。',
  });
  assert.equal(calls.images.length, 0);
});

test('resumes with an existing successful analysis context without creating a new chat job', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const context = makeContext({ targetMaterialIds: ['target-a', 'target-b'] });
  const { calls, deps } = createHarness();

  const result = await runShellProductRestoreWorkflow(
    makeInput({ context }),
    makeConfig(),
    {},
    deps,
  );

  assert.equal(calls.analysis.length, 0);
  assert.equal(calls.images.length, 2);
  assert.equal(result.productRestoreContext, context);
  assert.equal(result.analysisJobId, 'analysis-job-1');
});

test('single-item entry consumes existing context and performs zero analysis calls', async () => {
  const { runShellProductRestoreItem } = await loadWorkflowModule();
  const input = makeInput({ targetCount: 3 });
  const context = makeContext();
  const { calls, deps } = createHarness();

  const result = await runShellProductRestoreItem({
    input,
    config: makeConfig(),
    context,
    target: input.materials.restoreTarget[1],
    productReferences: input.materials.productReference,
    batchIndex: 2,
    batchCount: 3,
  }, {}, deps);

  assert.equal(calls.analysis.length, 0);
  assert.equal(calls.images.length, 1);
  assert.equal(result.targetMaterialId, 'target-b');
  assert.equal(calls.images[0][9].batchIndex, 2);
});

test('single-result retry resolves the exact target and restores reference order from persisted context', async () => {
  const { runShellProductRestoreSingleRetry } = await loadWorkflowModule();
  const context = makeContext();
  const input = makeInput({ targetCount: 3, context });
  input.materials.restoreTarget.reverse();
  input.materials.productReference.reverse();
  const { calls, deps } = createHarness();

  const result = await runShellProductRestoreSingleRetry({
    input,
    config: makeConfig({ quality: '4k', model: 'gemini-3-pro-image-preview' }),
    result: {
      id: 'persisted-result-b',
      targetMaterialId: 'target-b',
      sourceUrl: 'https://assets.test/target-b.png',
    },
  }, {}, deps);

  assert.equal(calls.analysis.length, 0);
  assert.equal(calls.images.length, 1);
  assert.equal(result.targetMaterialId, 'target-b');
  assert.deepEqual(calls.images[0][0], [
    'https://assets.test/target-b.png',
    'https://assets.test/reference-a.png',
    'https://assets.test/reference-b.png',
  ]);
  assert.equal(calls.images[0][2].model, 'gpt-image-2');
  assert.equal(calls.images[0][2].quality, '2k');
  assert.equal(calls.images[0][9].batchIndex, 2);
  assert.equal(calls.images[0][9].batchCount, 3);
});

test('single-result retry uses source fallback only when an old result lacks targetMaterialId', async (t) => {
  const { runShellProductRestoreSingleRetry } = await loadWorkflowModule();
  const context = makeContext();
  const input = makeInput({ targetCount: 3, context });

  await t.test('old local draft can fall back to sourceUrl', async () => {
    const { calls, deps } = createHarness();
    const result = await runShellProductRestoreSingleRetry({
      input,
      config: makeConfig(),
      result: {
        id: 'old-local-draft',
        sourceUrl: 'https://assets.test/target-c.png',
      },
    }, {}, deps);

    assert.equal(result.targetMaterialId, 'target-c');
    assert.equal(calls.images.length, 1);
    assert.equal(calls.images[0][9].batchIndex, 3);
  });

  await t.test('a present but unknown target id never falls back to sourceUrl', async () => {
    const { calls, deps } = createHarness();
    const outcome = await runShellProductRestoreSingleRetry({
      input,
      config: makeConfig(),
      result: {
        id: 'corrupt-result',
        targetMaterialId: 'unknown-target',
        sourceUrl: 'https://assets.test/target-c.png',
      },
    }, {}, deps).then(() => null, (error) => error);

    assert.equal(calls.analysis.length, 0);
    assert.equal(calls.images.length, 0);
    assert.equal(
      outcome?.message,
      '该历史任务缺少完整的产品还原分析或参考素材，无法安全单张重试，请重新创建产品还原任务。',
    );
  });
});

test('missing or corrupt persisted retry context fails locally before image job creation', async (t) => {
  const { runShellProductRestoreSingleRetry } = await loadWorkflowModule();
  const cases = [
    { name: 'missing context', context: undefined },
    {
      name: 'corrupt normalized analysis',
      context: makeContext({ normalizedAnalysis: { productIdentitySummary: 'partial only' } }),
    },
    {
      name: 'missing ordered reference snapshot',
      context: makeContext({ productReferenceMaterialIds: ['reference-a', 'missing-reference'] }),
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const input = makeInput({ targetCount: 3, context: testCase.context });
      const { calls, deps } = createHarness();
      const outcome = await runShellProductRestoreSingleRetry({
        input,
        config: makeConfig(),
        result: {
          id: 'persisted-result-a',
          targetMaterialId: 'target-a',
          sourceUrl: 'https://assets.test/target-a.png',
        },
      }, {}, deps).then(() => null, (error) => error);

      assert.equal(calls.analysis.length, 0);
      assert.equal(calls.images.length, 0);
      assert.equal(outcome?.code, 'product_restore_retry_context_invalid');
      assert.equal(
        outcome?.message,
        '该历史任务缺少完整的产品还原分析或参考素材，无法安全单张重试，请重新创建产品还原任务。',
      );
    });
  }
});

test('single-result retry replaces the same row, keeps taskCount, and adds only actual image credits', async () => {
  const { mergeProductRestoreSingleRetryProject } = await loadWorkflowModule();
  const project = {
    id: 'shell-project-1',
    status: 'error',
    taskCount: 2,
    completedCount: 1,
    creditsConsumed: 9,
    generationContext: {
      productRestore: makeContext({
        targetMaterialIds: ['target-a', 'target-b'],
        analysisCreditsConsumed: 4,
      }),
    },
    results: [
      {
        id: 'result-a',
        targetMaterialId: 'target-a',
        status: 'error',
        imageUrl: '',
        creditsConsumed: 3,
      },
      {
        id: 'result-b',
        targetMaterialId: 'target-b',
        status: 'completed',
        imageUrl: 'https://assets.test/result-b.png',
        creditsConsumed: 2,
      },
    ],
  };

  const merged = mergeProductRestoreSingleRetryProject(project, 'result-a', {
    imageUrl: 'https://assets.test/retry-a.png',
    status: 'completed',
    backendJobId: 'retry-backend-a',
    taskId: 'retry-provider-a',
    targetMaterialId: 'target-a',
    creditsConsumed: 5,
  });

  assert.equal(merged.results.length, 2);
  assert.deepEqual(merged.results.map((result) => result.id), ['result-a', 'result-b']);
  assert.equal(merged.results[0].creditsConsumed, 8);
  assert.equal(merged.results[0].backendJobId, 'retry-backend-a');
  assert.equal(merged.taskCount, 2);
  assert.equal(merged.completedCount, 2);
  assert.equal(merged.status, 'completed');
  assert.equal(merged.creditsConsumed, 14);
});

test('manual reanalysis eligibility requires a confirmed terminal analysis failure with no image results', async (t) => {
  const { canManuallyReanalyzeProductRestore } = await loadWorkflowModule();
  const base = {
    module: 'retouch',
    subFeature: 'product_restore',
    projectStatus: 'error',
    resultCount: 0,
    analysisJobId: 'analysis-job-1',
  };

  assert.equal(canManuallyReanalyzeProductRestore({
    ...base,
    analysisJobStatus: 'failed',
    analysisErrorCode: 'provider_refusal',
  }), true);
  assert.equal(canManuallyReanalyzeProductRestore({
    ...base,
    analysisJobStatus: 'succeeded',
    analysisErrorCode: 'product_restore_analysis_invalid',
  }), true);

  const blocked = [
    { analysisJobStatus: 'queued', analysisErrorCode: 'analysis_result_pending' },
    { analysisJobStatus: 'running', analysisErrorCode: 'analysis_result_pending' },
    { analysisJobStatus: 'retry_waiting', analysisErrorCode: 'analysis_result_pending' },
    { analysisJobStatus: 'cancelled', analysisErrorCode: 'interrupted' },
    { analysisJobStatus: 'failed', analysisErrorCode: 'provider_submission_unknown' },
  ];
  for (const state of blocked) {
    await t.test(`${state.analysisJobStatus}:${state.analysisErrorCode}`, () => {
      assert.equal(canManuallyReanalyzeProductRestore({ ...base, ...state }), false);
    });
  }
  assert.equal(canManuallyReanalyzeProductRestore({
    ...base,
    resultCount: 1,
    analysisJobStatus: 'failed',
    analysisErrorCode: 'provider_refusal',
  }), false);
});

test('manual reanalysis creates one deliberate analysis attempt and persists before image fan-out', async () => {
  const logs = [];
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule({ logs });
  const { calls, deps } = createHarness();
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => {
    releasePersistence = resolve;
  });
  const input = makeInput({
    targetCount: 2,
    taskMetadata: {
      productRestoreManualRetry: true,
      productRestoreAnalysisSubmissionKey: 'shell-project-1:product_restore:analysis:manual:attempt-2',
    },
  });

  const run = runShellProductRestoreWorkflow(input, makeConfig(), {
    onAnalysisCompleted: async () => persistenceGate,
  }, deps);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.analysis.length, 1);
  assert.equal(calls.images.length, 0);
  assert.equal(
    calls.analysis[0].jobMetadata.clientSubmissionKey,
    'shell-project-1:product_restore:analysis:manual:attempt-2',
  );
  assert.equal(calls.analysis[0].jobMetadata.productRestoreManualRetry, true);
  const startedLog = logs.find((entry) => entry.action === 'product_restore_analysis_started');
  assert.equal(startedLog?.meta?.manualRetry, true);

  releasePersistence();
  await run;
  assert.equal(calls.analysis.length, 1);
  assert.equal(calls.images.length, 2);
});

test('single-result retry logs the existing analysis and new image identity without an analysis call', async () => {
  const logs = [];
  const { runShellProductRestoreSingleRetry } = await loadWorkflowModule({ logs });
  const context = makeContext({ targetMaterialIds: ['target-a'] });
  const input = makeInput({ targetCount: 1, context });
  const { calls, deps } = createHarness();

  await runShellProductRestoreSingleRetry({
    input,
    config: makeConfig(),
    result: {
      id: 'result-a',
      targetMaterialId: 'target-a',
      sourceUrl: 'https://assets.test/target-a.png',
    },
  }, {}, deps);

  assert.equal(calls.analysis.length, 0);
  assert.equal(calls.images.length, 1);
  const retryLog = logs.find((entry) => entry.action === 'product_restore_single_retry');
  assert.equal(retryLog?.meta?.analysisJobId, 'analysis-job-1');
  assert.equal(retryLog?.meta?.backendJobId, 'backend-job-1');
  assert.equal(retryLog?.meta?.providerTaskId, 'provider-task-1');
  assert.equal(retryLog?.meta?.targetMaterialId, 'target-a');
});

test('normalizes 1K to 2K and ignores selector ratio in favor of original target ratio', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { calls, deps } = createHarness();

  await runShellProductRestoreWorkflow(
    makeInput({ targetCount: 1, params: { quality: '1K', ratio: '9:16' } }),
    makeConfig({ quality: '1k', aspectRatio: '9:16' }),
    durableCallbacks,
    deps,
  );

  const generationArgs = calls.images[0];
  assert.equal(generationArgs[2].quality, '2k');
  assert.equal(generationArgs[2].aspectRatio, 'auto');
  assert.equal(generationArgs[2].resolutionMode, 'original');
  assert.equal(generationArgs[2].targetWidth, 0);
  assert.equal(generationArgs[2].targetHeight, 0);
  assert.equal(generationArgs[3], true);
  assert.deepEqual(generationArgs[7], {
    width: 1200,
    height: 1600,
    ratioLabel: '3:4',
  });
});

test('reuses the same stable submission key for the same logical target on retry', async () => {
  const { runShellProductRestoreItem } = await loadWorkflowModule();
  const input = makeInput({ targetCount: 2 });
  const context = makeContext();
  const { calls, deps } = createHarness();
  const itemInput = {
    input,
    config: makeConfig(),
    context,
    target: input.materials.restoreTarget[0],
    productReferences: input.materials.productReference,
    batchIndex: 1,
    batchCount: 2,
  };

  await runShellProductRestoreItem(itemInput, {}, deps);
  await runShellProductRestoreItem(itemInput, {}, deps);

  assert.equal(calls.images[0][9].clientSubmissionKey, calls.images[1][9].clientSubmissionKey);
  assert.equal(
    calls.images[0][9].clientSubmissionKey,
    'shell-project-1:product_restore:analysis-job-1:target-a:v1',
  );
});

test('writes bounded structured lifecycle logs without prompts or image URLs', async () => {
  const logs = [];
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule({ logs });
  const { deps } = createHarness({
    imageResults: [
      {
        imageUrl: 'https://provider.test/success-a.png',
        taskId: 'provider-a',
        backendJobId: 'backend-job-1',
        status: 'success',
        creditsConsumed: 2,
      },
      {
        imageUrl: '',
        taskId: 'provider-b',
        backendJobId: 'backend-job-2',
        status: 'error',
        message: 'provider failed',
        errorCode: 'provider_bad_response',
      },
    ],
  });

  await runShellProductRestoreWorkflow(makeInput(), makeConfig(), durableCallbacks, deps);

  const actions = logs.map((entry) => entry.action);
  for (const action of [
    'product_restore_batch_started',
    'product_restore_analysis_started',
    'product_restore_analysis_succeeded',
    'product_restore_generation_created',
    'product_restore_generation_succeeded',
    'product_restore_generation_failed',
    'product_restore_partial_completed',
  ]) {
    assert.ok(actions.includes(action), `missing ${action}`);
  }
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /https:\/\//);
  assert.doesNotMatch(serialized, /shared product restoration prompt/);
  assert.match(serialized, /provider_bad_response/);
});

test('statically keeps product_restore isolated to Retouch and out of EverythingReplace', () => {
  const source = readFileSync(shellWorkflowPath, 'utf8');
  assert.match(source, /type ShellRetouchMode[\s\S]*'product_restore'/);
  assert.match(source, /mode === 'product_restore'[\s\S]*runShellProductRestoreWorkflow/);
  assert.doesNotMatch(source, /AppModule\.EVERYTHING_REPLACE[^\n]*product_restore/);
});

test('fresh analysis fails closed before creating any job without durable persistence', async () => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const { calls, deps } = createHarness();

  const outcome = await runShellProductRestoreWorkflow(makeInput(), makeConfig(), {}, deps)
    .then(() => null, (error) => error);

  assert.equal(calls.analysis.length, 0);
  assert.equal(calls.images.length, 0);
  assert.equal(outcome?.code, 'product_restore_analysis_persistence_required');
});

test('full-batch reuse requires exact ordered context provenance', async (t) => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();
  const cases = [
    {
      name: 'ordered target ids',
      configure: (input) => input.materials.restoreTarget.reverse(),
    },
    {
      name: 'ordered reference ids',
      configure: (input) => input.materials.productReference.reverse(),
    },
    {
      name: 'normalized focus ids',
      configure: (input) => { input.params.restoreFocusIds = 'logo_label_text'; },
    },
    {
      name: 'user requirement',
      configure: (input) => { input.prompt = 'Preserve the revised shoulder geometry.'; },
    },
    {
      name: 'selected model',
      configure: (_input, config) => { config.model = 'gemini-3-pro-image-preview'; },
    },
    {
      name: 'normalized resolution',
      configure: (_input, config) => { config.quality = '4k'; },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const staleContext = makeContext({ targetMaterialIds: ['target-a', 'target-b'] });
      const input = makeInput({ context: staleContext });
      const config = makeConfig();
      testCase.configure(input, config);
      const persisted = [];
      const { calls, deps } = createHarness();

      const result = await runShellProductRestoreWorkflow(input, config, {
        onAnalysisCompleted: async (context) => persisted.push(context),
      }, deps);

      assert.equal(calls.analysis.length, 1);
      assert.equal(persisted.length, 1);
      assert.notEqual(result.productRestoreContext, staleContext);
    });
  }
});

test('single-item retry rejects a target or reference order outside persisted context', async (t) => {
  const { runShellProductRestoreItem } = await loadWorkflowModule();
  const input = makeInput({ targetCount: 3 });
  const context = makeContext();

  await t.test('selected target does not match its persisted batch position', async () => {
    const { calls, deps } = createHarness();
    const outcome = await runShellProductRestoreItem({
      input,
      config: makeConfig(),
      context,
      target: input.materials.restoreTarget[1],
      productReferences: input.materials.productReference,
      batchIndex: 1,
      batchCount: 3,
    }, {}, deps).then(() => null, (error) => error);

    assert.equal(calls.images.length, 0);
    assert.equal(outcome?.code, 'product_restore_context_mismatch');
  });

  await t.test('ordered references differ from persisted analysis', async () => {
    const { calls, deps } = createHarness();
    const outcome = await runShellProductRestoreItem({
      input,
      config: makeConfig(),
      context,
      target: input.materials.restoreTarget[0],
      productReferences: [...input.materials.productReference].reverse(),
      batchIndex: 1,
      batchCount: 3,
    }, {}, deps).then(() => null, (error) => error);

    assert.equal(calls.images.length, 0);
    assert.equal(outcome?.code, 'product_restore_context_mismatch');
  });
});

test('invalid or duplicate target identities fail before analysis and image creation', async (t) => {
  const { runShellProductRestoreWorkflow } = await loadWorkflowModule();

  await t.test('missing target id', async () => {
    const input = makeInput();
    input.materials.restoreTarget[1].id = '';
    const { calls, deps } = createHarness();
    const outcome = await runShellProductRestoreWorkflow(input, makeConfig(), durableCallbacks, deps)
      .then(() => null, (error) => error);

    assert.equal(calls.analysis.length, 0);
    assert.equal(calls.images.length, 0);
    assert.equal(outcome?.code, 'product_restore_target_id_missing');
  });

  await t.test('duplicate target id', async () => {
    const input = makeInput();
    input.materials.restoreTarget[1].id = input.materials.restoreTarget[0].id;
    const { calls, deps } = createHarness();
    const outcome = await runShellProductRestoreWorkflow(input, makeConfig(), durableCallbacks, deps)
      .then(() => null, (error) => error);

    assert.equal(calls.analysis.length, 0);
    assert.equal(calls.images.length, 0);
    assert.equal(outcome?.code, 'product_restore_target_id_duplicate');
  });
});

test('real Retouch route returns the pending analysis contract additively', async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  try {
    const { runShellRetouchWorkflow } = await loadActiveModule('/src/adapters/shellWorkflow.ts');
    const { calls, deps } = createHarness({
      analysisResult: {
        status: 'generating',
        jobId: 'analysis-job-route-pending',
        providerTaskId: 'analysis-provider-route-pending',
        errorCode: 'analysis_result_pending',
        message: '产品还原分析仍在生成。',
      },
    });
    const result = await runShellRetouchWorkflow({
      ...makeInput(),
      onProductRestoreAnalysisCompleted: durableCallbacks.onAnalysisCompleted,
    }, undefined, deps);

    assert.equal(calls.analysis.length, 1);
    assert.equal(calls.images.length, 0);
    assert.deepEqual(result, {
      results: [],
      analysisStatus: 'generating',
      analysisJobId: 'analysis-job-route-pending',
      message: '产品还原分析仍在生成。',
    });
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.window = originalWindow;
  }
});

test('outer shell assembles pending Product Restoration project and task cardinality from targets', async () => {
  const {
    assembleProductRestorePendingProjectTaskState,
    getProductRestoreAnalysisPendingState,
  } = await loadActiveModule('/src/adapters/shellProductRestorePendingState.ts');
  const materials = {
    restoreTarget: [
      makeMaterial('target-a', 'restoreTarget'),
      makeMaterial('target-b', 'restoreTarget'),
      makeMaterial('target-c', 'restoreTarget'),
    ],
  };

  assert.deepEqual(assembleProductRestorePendingProjectTaskState(materials), {
    project: { status: 'planning', taskCount: 3 },
    task: { status: 'generating', total: 3 },
  });
  assert.deepEqual(getProductRestoreAnalysisPendingState('retouch', 'product_restore', {
    results: [],
    analysisStatus: 'generating',
    analysisJobId: 'analysis-job-shell-pending',
    message: '产品还原分析仍在生成。',
  }, materials), {
    isPending: true,
    project: { status: 'planning', taskCount: 3 },
    task: { status: 'generating', total: 3 },
    analysisJobId: 'analysis-job-shell-pending',
    message: '产品还原分析仍在生成。',
  });
  assert.deepEqual(getProductRestoreAnalysisPendingState('everything_replace', 'product_restore', {
    results: [],
    analysisStatus: 'generating',
    analysisJobId: 'analysis-job-ignored',
  }, materials), { isPending: false });
});

test('EverythingReplace rejects Product Restoration aliases without breaking product-replace aliases', async () => {
  const { resolveShellRetouchMode } = await loadActiveModule('/src/adapters/shellWorkflow.ts');
  const input = makeInput();

  for (const alias of ['product_restore', '产品还原', '开始产品还原']) {
    assert.throws(() => resolveShellRetouchMode({
      ...input,
      module: 'everything_replace',
      subFeature: alias,
    }), /产品还原仅支持图片升级/);
  }

  for (const alias of ['product_replace', '产品替换', '替换产品']) {
    assert.equal(resolveShellRetouchMode({
      ...input,
      module: 'everything_replace',
      subFeature: alias,
    }), 'product_replace');
  }
  assert.equal(resolveShellRetouchMode({
    ...input,
    module: 'retouch',
    subFeature: '产品还原',
  }), 'product_restore');
});
