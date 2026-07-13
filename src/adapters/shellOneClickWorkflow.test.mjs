import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

const loadActiveWorkflow = async () => {
  const viteServer = await createServer({
    root: projectRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  try {
    return await viteServer.ssrLoadModule('/src/adapters/shellWorkflow.ts');
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

const baseInput = (taskMetadata = {}) => ({
  module: 'one_click',
  subFeature: 'main_image',
  prompt: '生成一张商品主图',
  params: {
    aspectRatio: '1:1',
    count: '1',
    model: 'GPT Image 2',
    resolutionMode: 'original',
  },
  materials: {
    product: [{
      id: 'product-1',
      type: 'product',
      url: 'https://example.com/product.png',
      fileName: 'product.png',
    }],
  },
  signal: new AbortController().signal,
  taskMetadata: {
    shellProjectId: 'project-1',
    shellPlanId: 'plan-1',
    subFeature: 'main_image',
    shellPlanningPurpose: 'one_click_planning',
    ...taskMetadata,
  },
});

const planningContent = [
  '[SCHEME_START]',
  '- 屏序/类型：主图1-核心视觉',
  '- 设计意图：突出商品卖点',
  '- 画面风格：简洁商业风',
  '- 画面描述：商品居中展示，背景干净',
  '- 文案内容排版：核心卖点清晰可读',
  '- 画面比例：1:1',
  '[SCHEME_END]',
].join('\n');

test('active OneClick planning and generation preserve job identity and provider task ids', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;
  const requests = [];
  const createdJobs = new Map();

  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    const method = String(init.method || 'GET').toUpperCase();
    if (requestUrl === '/api/system/config') {
      return new Response(JSON.stringify({
        config: {
          publicBaseUrl: 'https://meiaoyuntai.com',
          agentModels: { chat: ['gpt-5-4'] },
          systemSettings: { effectiveAnalysisModel: 'gpt-5-4' },
        },
      }), { status: 200 });
    }
    if (requestUrl === '/api/jobs' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      const jobId = body.taskType === 'kie_chat' ? 'planning-job-1' : 'image-job-1';
      const providerTaskId = body.taskType === 'kie_chat' ? 'planning-provider-1' : 'image-provider-1';
      requests.push({ kind: 'create', body });
      createdJobs.set(jobId, {
        id: jobId,
        module: body.module,
        taskType: body.taskType,
        provider: body.provider,
        status: 'succeeded',
        providerTaskId,
        payload: body.payload,
        result: body.taskType === 'kie_chat'
          ? { content: planningContent, providerTaskId, creditsConsumed: 2 }
          : { imageUrl: 'https://example.com/generated.png', providerTaskId, creditsConsumed: 5 },
      });
      return new Response(JSON.stringify({ job: { id: jobId } }), { status: 200 });
    }
    if (requestUrl.startsWith('/api/jobs/') && method === 'GET') {
      const jobId = requestUrl.split('/').at(-1);
      requests.push({ kind: 'poll', jobId });
      return new Response(JSON.stringify({ job: createdJobs.get(jobId) }), { status: 200 });
    }
    throw new Error(`unexpected request: ${method} ${requestUrl}`);
  };

  try {
    const { runShellImageGeneration, runShellOneClickPlanning } = await loadActiveWorkflow();
    const callbacks = [];
    const input = baseInput();
    const planning = await runShellOneClickPlanning({
      ...input,
      onJobCreated: (jobId, providerTaskId) => callbacks.push({ jobId, providerTaskId }),
    });
    const generation = await runShellImageGeneration({
      ...input,
      taskMetadata: {
        ...input.taskMetadata,
        schemeContent: planning.plans[0].schemeContent,
      },
      onJobCreated: (jobId, providerTaskId) => callbacks.push({ jobId, providerTaskId }),
    });

    const planningRequest = requests.find((request) => request.kind === 'create' && request.body.taskType === 'kie_chat');
    const imageRequest = requests.find((request) => request.kind === 'create' && request.body.taskType === 'kie_image');
    assert.deepEqual(
      {
        module: planningRequest.body.module,
        taskType: planningRequest.body.taskType,
        payload: {
          shellProjectId: planningRequest.body.payload.shellProjectId,
          shellPlanId: planningRequest.body.payload.shellPlanId,
          subFeature: planningRequest.body.payload.subFeature,
        },
      },
      {
        module: 'one_click',
        taskType: 'kie_chat',
        payload: { shellProjectId: 'project-1', shellPlanId: 'plan-1', subFeature: 'main_image' },
      },
    );
    assert.deepEqual(
      {
        module: imageRequest.body.module,
        taskType: imageRequest.body.taskType,
        payload: {
          shellProjectId: imageRequest.body.payload.shellProjectId,
          shellPlanId: imageRequest.body.payload.shellPlanId,
          subFeature: imageRequest.body.payload.subFeature,
        },
      },
      {
        module: 'one_click',
        taskType: 'kie_image',
        payload: { shellProjectId: 'project-1', shellPlanId: 'plan-1', subFeature: 'main_image' },
      },
    );
    assert.equal(planning.taskId, 'planning-provider-1');
    assert.equal(generation.taskId, 'image-provider-1');
    assert.deepEqual(callbacks, [
      { jobId: 'planning-job-1', providerTaskId: undefined },
      { jobId: 'planning-job-1', providerTaskId: 'planning-provider-1' },
      { jobId: 'image-job-1', providerTaskId: undefined },
      { jobId: 'image-job-1', providerTaskId: 'image-provider-1' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.window = originalWindow;
  }
});
