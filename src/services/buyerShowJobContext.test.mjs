import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
};

test('buyer-show planning preserves named JobContext fields in the durable job payload', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  let jobPayload = null;

  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  sessionStorage.setItem('MEIAO_ACTIVE_MODULE', 'buyer_show');
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path === '/api/system/config') {
      return new Response(JSON.stringify({
        config: {
          publicBaseUrl: 'https://assets.example.com',
          agentModels: { chat: [{ id: 'gpt-5.4' }] },
          systemSettings: { effectiveAnalysisModel: 'gpt-5.4' },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/jobs') {
      jobPayload = JSON.parse(String(init.body)).payload;
      return new Response(JSON.stringify({ job: { id: 'buyer-show-plan-job', providerTaskId: '' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/api/jobs/buyer-show-plan-job') {
      return new Response(JSON.stringify({
        job: {
          id: 'buyer-show-plan-job',
          status: 'succeeded',
          providerTaskId: 'provider-plan-1',
          result: {
            content: JSON.stringify({
              tasks: [{ prompt: 'A product on a clean desk', style: '桌面展示', hasFace: false }],
              evaluation: '适合目标用户',
            }),
            creditsConsumed: 1,
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/logs') {
      return new Response(JSON.stringify({ ok: true, log: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected request: ${path}`);
  };

  try {
    const arkService = await vite.ssrLoadModule('/src/services/arkService.ts');
    const result = await arkService.generateBuyerShowPrompts(
      ['https://assets.example.com/product.png'],
      null,
      {
        subMode: 'integrated',
        productImages: [],
        referenceImage: null,
        referenceStrength: 'medium',
        productName: '咖啡杯',
        productFeatures: '耐热陶瓷',
        userRequirement: '',
        targetCountry: 'United States',
        includeModel: false,
        aspectRatio: '1:1',
        quality: '1k',
        model: 'gpt-image-2',
        imageCount: 1,
        setCount: 1,
        sets: [],
        tasks: [],
        evaluationText: '',
        pureEvaluations: [],
        firstImageConfirmed: false,
        isAnalyzing: false,
        isGenerating: false,
      },
      { kieApiKey: '', concurrency: 1 },
      0,
      undefined,
      undefined,
      {
        taskPurpose: 'buyer_show_planning',
        shellProjectId: 'proj-buyer-set-1',
        shellProjectName: '买家秀第1套',
        subFeature: 'image',
        traceId: 'trace-buyer-show-1',
      },
    );

    assert.equal(result.status, 'success');
    assert.deepEqual(
      {
        taskPurpose: jobPayload?.taskPurpose,
        shellProjectId: jobPayload?.shellProjectId,
        shellProjectName: jobPayload?.shellProjectName,
        subFeature: jobPayload?.subFeature,
        traceId: jobPayload?.traceId,
      },
      {
        taskPurpose: 'buyer_show_planning',
        shellProjectId: 'proj-buyer-set-1',
        shellProjectName: '买家秀第1套',
        subFeature: 'image',
        traceId: 'trace-buyer-show-1',
      },
    );
  } finally {
    await vite.close();
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.window = originalWindow;
  }
});
