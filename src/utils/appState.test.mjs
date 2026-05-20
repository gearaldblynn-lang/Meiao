import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultOneClickState, createDefaultVideoState, getPersistedAppStateKey, loadPersistedAppState, normalizeLoadedPersistedAppState, PERSISTENCE_KEY } from './appState.ts';
import { getShellDraftStateKey, loadShellDraftState, normalizeShellDraftState, saveShellDraftState, SHELL_DRAFT_STATE_KEY } from './shellDraftState.ts';

test('loadPersistedAppState reuses cached normalized state when storage payload is unchanged', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalParse = JSON.parse;
  const payload = JSON.stringify({
    activeModule: 'one_click',
    oneClickMemory: {
      firstImage: { projects: [] },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  });
  let parseCount = 0;

  globalThis.localStorage = {
    getItem(key) {
      return key === PERSISTENCE_KEY ? payload : null;
    },
    setItem() {},
    removeItem() {},
  };
  JSON.parse = (...args) => {
    parseCount += 1;
    return originalParse(...args);
  };

  try {
    const first = loadPersistedAppState();
    const second = loadPersistedAppState();

    assert.equal(parseCount, 1);
    assert.equal(first, second);
  } finally {
    JSON.parse = originalParse;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('loadPersistedAppState uses account scoped keys without reading legacy global state', () => {
  const originalLocalStorage = globalThis.localStorage;
  const legacyPayload = JSON.stringify({ activeModule: 'translation' });
  const scopedPayload = JSON.stringify({ activeModule: 'video' });
  const reads = [];

  globalThis.localStorage = {
    getItem(key) {
      reads.push(key);
      if (key === PERSISTENCE_KEY) return legacyPayload;
      if (key === getPersistedAppStateKey('user-a')) return scopedPayload;
      return null;
    },
    setItem() {},
    removeItem() {},
  };

  try {
    const scoped = loadPersistedAppState('user-a');
    const missingScoped = loadPersistedAppState('user-b');

    assert.equal(scoped.activeModule, 'video');
    assert.deepEqual(missingScoped, {});
    assert.deepEqual(reads, [getPersistedAppStateKey('user-a'), getPersistedAppStateKey('user-b')]);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('createDefaultVideoState defaults GPT Image 2 storyboard quality to 2k', () => {
  const state = createDefaultVideoState();

  assert.equal(state.storyboard.config.model, 'gpt-image-2');
  assert.equal(state.storyboard.config.quality, '2k');
  assert.equal(state.storyboard.config.videoGenerationMode, 'original');
  assert.equal(state.storyboard.config.viralVariationCount, 3);
  assert.equal(state.storyboard.config.viralVariationStrength, '10');
  assert.equal(state.storyboard.config.viralCustomVariationStrength, '');
});

test('normalizeLoadedPersistedAppState preserves shell draft input for refresh recovery', () => {
  const normalized = normalizeLoadedPersistedAppState({
    shellDraft: {
      inputStateByScope: {
        'video:storyboard': {
          promptText: '自己的产品卖点',
          params: {
            videoMode: '爆款复刻',
            ratio: '9:16',
          },
        },
      },
      materials: {
        product: [{
          id: 'product-1',
          type: 'product',
          url: 'https://example.com/product.png',
          remoteUrl: 'https://example.com/product.png',
          fileName: 'product.png',
        }],
      },
      updatedAt: 1778670000000,
    },
  });

  assert.equal(normalized.shellDraft.inputStateByScope['video:storyboard'].promptText, '自己的产品卖点');
  assert.equal(normalized.shellDraft.inputStateByScope['video:storyboard'].params.videoMode, '爆款复刻');
  assert.equal(normalized.shellDraft.materials.product[0].remoteUrl, 'https://example.com/product.png');
});

test('shell draft persists local materials as lightweight asset references only', () => {
  const draft = {
    materials: {
      product: [{
        id: 'local-product',
        type: 'product',
        url: 'blob:http://localhost/local-product',
        localAssetId: 'asset-local-product',
        fileName: 'local.png',
      }],
    },
  };

  const localDraft = normalizeShellDraftState(draft);
  const remoteDraft = normalizeShellDraftState(localDraft);

  assert.equal(localDraft.materials.product[0].url, '');
  assert.equal(localDraft.materials.product[0].localAssetId, 'asset-local-product');
  assert.equal(remoteDraft.materials.product[0].url, '');
  assert.equal(remoteDraft.materials.product[0].localAssetId, 'asset-local-product');
  assert.equal(JSON.stringify(localDraft).includes('blob:http://localhost/local-product'), false);
});

test('shell draft local storage is scoped by authenticated user', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const store = new Map();

  const localStorage = {
    getItem(key) {
      return store.get(key) || null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
  globalThis.localStorage = localStorage;
  globalThis.window = { localStorage };

  try {
    assert.equal(getShellDraftStateKey('user-a'), `${SHELL_DRAFT_STATE_KEY}:user-a`);
    assert.equal(getShellDraftStateKey('user-b'), `${SHELL_DRAFT_STATE_KEY}:user-b`);
    assert.equal(getShellDraftStateKey(null), SHELL_DRAFT_STATE_KEY);

    saveShellDraftState({
      inputStateByScope: {
        'one_click:first_image': { promptText: 'A 的草稿', params: { mode: '首图' } },
      },
      materials: {},
    }, 'user-a');

    saveShellDraftState({
      inputStateByScope: {
        'one_click:first_image': { promptText: 'B 的草稿', params: { mode: '首图' } },
      },
      materials: {},
    }, 'user-b');

    assert.equal(loadShellDraftState('user-a').inputStateByScope['one_click:first_image'].promptText, 'A 的草稿');
    assert.equal(loadShellDraftState('user-b').inputStateByScope['one_click:first_image'].promptText, 'B 的草稿');
    assert.deepEqual(loadShellDraftState(null).inputStateByScope, {});
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.window = originalWindow;
  }
});


test('normalizeLoadedPersistedAppState backfills video generation storyboard fields', () => {
  const normalized = normalizeLoadedPersistedAppState({
    videoMemory: {
      storyboard: {
        config: {
          productImages: [],
          uploadedProductUrls: [],
          productInfo: 'demo',
          scriptLogic: '',
          scriptPreset: 'custom',
          aspectRatio: '9:16',
          duration: '15s',
          shotCount: 9,
          actorType: 'no_real_face',
          projectCount: 1,
          scenes: [''],
          countryLanguage: '中国/中文',
          generateWhiteBg: false,
          model: 'gpt-image-2',
          quality: '2k',
          generationMode: 'single_image',
        },
        projects: [
          {
            id: 'project_1',
            name: '视频方案 1',
            config: {
              productImages: [],
              uploadedProductUrls: [],
              productInfo: 'demo',
              scriptLogic: '',
              scriptPreset: 'custom',
              aspectRatio: '9:16',
              duration: '15s',
              shotCount: 9,
              actorType: 'no_real_face',
              projectCount: 1,
              scenes: [''],
              countryLanguage: '中国/中文',
              generateWhiteBg: false,
              model: 'gpt-image-2',
              quality: '2k',
              generationMode: 'single_image',
            },
            status: 'completed',
            script: 'demo',
            shots: [],
            boards: [],
            createdAt: 1,
          },
        ],
        downloadingProjectId: null,
      },
    },
  });

  assert.equal(normalized.videoMemory.storyboard.config.videoGenerationMode, 'original');
  assert.equal(normalized.videoMemory.storyboard.config.viralVariationCount, 3);
  assert.equal(normalized.videoMemory.storyboard.config.viralVariationStrength, '10');
  assert.equal(normalized.videoMemory.storyboard.config.referenceVideoFile, null);
  assert.equal(normalized.videoMemory.storyboard.config.uploadedReferenceVideoUrl, '');
  assert.equal(normalized.videoMemory.storyboard.projects[0].config.videoGenerationMode, 'original');
  assert.equal(normalized.videoMemory.storyboard.projects[0].config.viralVariationCount, 3);
  assert.equal(normalized.videoMemory.storyboard.projects[0].config.uploadedReferenceVideoUrl, '');
});

test('default one click state includes independent first image state with one default output', () => {
  const state = createDefaultOneClickState();

  assert.ok(state.firstImage);
  assert.equal(state.firstImage.config.count, 1);
  assert.equal(state.firstImage.config.aspectRatio, '1:1');
  assert.equal(state.mainImage.config.aspectRatio, '1:1');
  assert.equal(state.detailPage.config.aspectRatio, '3:4');
  assert.equal(state.sku.config.aspectRatio, '1:1');
  assert.notEqual(state.firstImage, state.mainImage);
  assert.deepEqual(state.firstImage.productImages, []);
  assert.deepEqual(state.firstImage.schemes, []);
});

test('normalizeLoadedPersistedAppState backfills missing first image state', () => {
  const state = createDefaultOneClickState();
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      mainImage: state.mainImage,
      detailPage: state.detailPage,
      sku: state.sku,
    },
  });

  assert.ok(normalized.oneClickMemory.firstImage);
  assert.equal(normalized.oneClickMemory.firstImage.config.count, 1);
});

test('normalizeLoadedPersistedAppState splits mixed one-click projects into separate subfeature projects', () => {
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      firstImage: {
        ...createDefaultOneClickState().firstImage,
        projects: [
          {
            id: 'mixed-project',
            name: '旧混合项目',
            createdAt: 1,
            updatedAt: 1,
            productImages: [],
            logoImage: null,
            uploadedLogoUrl: null,
            styleImage: null,
            designReferences: [],
            uploadedDesignReferenceUrls: [],
            referenceDimensions: [],
            referenceAnalysis: { status: 'idle', summary: '', analyzedAt: null },
            schemes: [
              { id: 'first-result', subFeature: 'first_image' },
              { id: 'main-result', subFeature: 'main_image' },
              { id: 'detail-result', subFeature: 'detail_page' },
              { id: 'sku-result', subFeature: 'sku' },
            ],
            config: {
              description: '',
              platformType: 'domestic',
              platform: '淘宝',
              language: '中文',
              count: 1,
              aspectRatio: '1:1',
              firstImageColorMode: 'product_adaptive',
              quality: '1k',
              model: 'nano-banana-2',
              styleStrength: 'medium',
              resolutionMode: 'custom',
              targetWidth: 800,
              targetHeight: 800,
              maxFileSize: 2,
            },
            lastStyleUrl: null,
            uploadedProductUrls: [],
            directions: [],
          },
        ],
      },
      mainImage: { ...createDefaultOneClickState().mainImage, projects: [] },
      detailPage: { ...createDefaultOneClickState().detailPage, projects: [] },
      sku: { ...createDefaultOneClickState().sku, projects: [] },
    },
  });

  const splitProjects = normalized.oneClickMemory.firstImage.projects.filter((project) => project.name.startsWith('旧混合项目'));
  assert.equal(splitProjects.length, 4);
  assert.deepEqual(splitProjects.map((project) => project.schemes.length).sort(), [1, 1, 1, 1]);
});

test('default one click state includes empty reference preset library', () => {
  const state = createDefaultOneClickState();

  assert.deepEqual(state.referencePresets, {
    presets: [],
  });
});

test('normalizeLoadedPersistedAppState backfills and sanitizes reference presets', () => {
  const state = createDefaultOneClickState();
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      mainImage: state.mainImage,
      detailPage: state.detailPage,
      sku: state.sku,
      referencePresets: {
        textPresets: [
          {
            id: 'text_1',
            name: '详情节奏',
            sourceSubMode: 'detail_page',
            summary: '统一浅色背景与卡片式信息层级',
            referenceDimensions: ['layout', 'bad_dimension'],
            createdAt: 100,
            updatedAt: 200,
          },
          { id: '', name: '', summary: '' },
        ],
        firstImageImagePresets: [
          {
            id: 'first_1',
            name: '首图参考',
            sourceSubMode: 'first_image',
            imageUrl: 'https://example.com/first.png',
            assetId: 'asset_first',
            createdAt: 300,
            updatedAt: 400,
          },
        ],
        skuImagePresets: [
          {
            id: 'sku_1',
            name: 'SKU参考',
            sourceSubMode: 'sku',
            imageUrl: 'https://example.com/sku.png',
            assetId: 'asset_sku',
            createdAt: 500,
            updatedAt: 600,
          },
          { id: 'broken', name: '缺图' },
        ],
      },
    },
  });

  assert.equal(normalized.oneClickMemory.referencePresets.presets.length, 3);
  assert.deepEqual(
    normalized.oneClickMemory.referencePresets.presets.map((preset) => preset.subMode),
    ['detail_page', 'first_image', 'sku'],
  );
  assert.deepEqual(normalized.oneClickMemory.referencePresets.presets[0].referenceDimensions, ['layout']);
  assert.equal(normalized.oneClickMemory.referencePresets.presets[1].coverImageUrl, 'https://example.com/first.png');
  assert.deepEqual(normalized.oneClickMemory.referencePresets.presets[2].referenceImageUrls, ['https://example.com/sku.png']);
});

test('normalizeLoadedPersistedAppState keeps unified presets and sanitizes missing optional fields', () => {
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      referencePresets: {
        presets: [
          {
            id: 'preset_1',
            name: '主图参考',
            subMode: 'main_image',
            coverImageUrl: '',
            referenceImageUrls: ['https://example.com/a.png'],
            summary: '统一暖色氛围',
            detail: '',
            referenceDimensions: ['layout', 'copy_content', 'bad_dimension'],
            tags: ['暖色', '', 123],
            createdAt: 100,
          },
        ],
      },
    },
  });

  assert.equal(normalized.oneClickMemory.referencePresets.presets.length, 1);
  assert.equal(normalized.oneClickMemory.referencePresets.presets[0].coverImageUrl, 'https://example.com/a.png');
  assert.equal(normalized.oneClickMemory.referencePresets.presets[0].detail, '统一暖色氛围');
  assert.deepEqual(normalized.oneClickMemory.referencePresets.presets[0].referenceDimensions, ['layout', 'copy_content']);
  assert.deepEqual(normalized.oneClickMemory.referencePresets.presets[0].tags, ['暖色']);
});

test('normalizeLoadedPersistedAppState strips serialized null file references from persisted module memory', () => {
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      mainImage: {
        productImages: [null, { name: 'not-a-file' }],
        styleImage: null,
        schemes: [],
        config: {},
        lastStyleUrl: null,
        uploadedProductUrls: [],
        directions: [],
      },
      detailPage: {
        productImages: [null],
        styleImage: null,
        schemes: [],
        config: {},
        lastStyleUrl: null,
        uploadedProductUrls: [],
        directions: [],
      },
    },
    retouchMemory: {
      tasks: [
        {
          id: 'task_1',
          file: null,
          relativePath: 'demo.png',
          status: 'pending',
          progress: 0,
          mode: 'original',
        },
      ],
      pendingFiles: [null],
      referenceImage: null,
      uploadedReferenceUrl: null,
      mode: 'white_bg',
      aspectRatio: 'auto',
      quality: '1k',
      model: 'nano-banana-2',
      resolutionMode: 'original',
      targetWidth: 0,
      targetHeight: 0,
    },
    buyerShowMemory: {
      productImages: [null],
      uploadedProductUrls: [],
      referenceImage: null,
      uploadedReferenceUrl: null,
      targetCountry: '美国',
      customCountry: '',
      includeModel: true,
      aspectRatio: '3:4',
      quality: '1k',
      model: 'nano-banana-2',
      imageCount: 3,
      setCount: 1,
      sets: [],
      tasks: [],
      evaluationText: '',
      pureEvaluations: [],
      firstImageConfirmed: false,
      isAnalyzing: false,
      isGenerating: false,
      subMode: 'integrated',
      referenceStrength: 'medium',
      productName: '',
      productFeatures: '',
      userRequirement: '',
    },
    videoMemory: {
      subMode: 'long_video',
      config: {
        duration: '15',
        aspectRatio: 'landscape',
        promptMode: 'ai',
        script: '',
        scenes: [],
        productInfo: '',
        requirements: '',
        targetCountry: '美国',
        customCountry: '',
        referenceVideoUrl: '',
        videoCount: 1,
        targetLanguage: '',
        sellingPoints: '',
        logicInfo: '',
      },
      productImages: [null],
      referenceVideoFile: null,
      tasks: [],
      veoProjects: [],
      veoReferenceImages: [null],
      isAnalyzing: false,
      isGenerating: false,
      storyboard: {
        config: {
          productImages: [null],
          uploadedProductUrls: [],
          productInfo: '',
          scriptLogic: '',
          scriptPreset: 'custom',
          aspectRatio: '9:16',
          duration: '15s',
          shotCount: 9,
          actorType: 'no_real_face',
          projectCount: 1,
          scenes: [''],
          countryLanguage: '中国/中文',
          generateWhiteBg: false,
          model: 'nano-banana-pro',
          quality: '2k',
        },
        projects: [],
        downloadingProjectId: null,
      },
    },
  });

  assert.deepEqual(normalized.oneClickMemory.mainImage.productImages, []);
  assert.deepEqual(normalized.oneClickMemory.detailPage.productImages, []);
  assert.deepEqual(normalized.retouchMemory.pendingFiles, []);
  assert.equal(normalized.retouchMemory.tasks.length, 0);
  assert.deepEqual(normalized.buyerShowMemory.productImages, []);
  assert.deepEqual(normalized.videoMemory.productImages, []);
  assert.deepEqual(normalized.videoMemory.veoReferenceImages, []);
  assert.deepEqual(normalized.videoMemory.storyboard.config.productImages, []);
});

test('normalizeLoadedPersistedAppState preserves remote asset urls for refresh recovery', () => {
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      mainImage: {
        productImages: [],
        styleImage: null,
        schemes: [],
        config: {},
        lastStyleUrl: 'https://example.com/style-main.png',
        uploadedProductUrls: ['https://example.com/main-a.png'],
        directions: [],
      },
      detailPage: {
        productImages: [],
        styleImage: null,
        schemes: [],
        config: {},
        lastStyleUrl: 'https://example.com/style-detail.png',
        uploadedProductUrls: ['https://example.com/detail-a.png'],
        directions: [],
      },
    },
    retouchMemory: {
      tasks: [],
      pendingFiles: [],
      referenceImage: null,
      uploadedReferenceUrl: 'https://example.com/retouch-ref.png',
      mode: 'white_bg',
      aspectRatio: 'auto',
      quality: '1k',
      model: 'nano-banana-2',
      resolutionMode: 'original',
      targetWidth: 0,
      targetHeight: 0,
    },
    buyerShowMemory: {
      productImages: [],
      uploadedProductUrls: ['https://example.com/buyer-a.png'],
      referenceImage: null,
      uploadedReferenceUrl: 'https://example.com/buyer-ref.png',
      targetCountry: '美国',
      customCountry: '',
      includeModel: true,
      aspectRatio: '3:4',
      quality: '1k',
      model: 'nano-banana-2',
      imageCount: 3,
      setCount: 1,
      sets: [],
      tasks: [],
      evaluationText: '',
      pureEvaluations: [],
      firstImageConfirmed: false,
      isAnalyzing: false,
      isGenerating: false,
      subMode: 'integrated',
      referenceStrength: 'medium',
      productName: '',
      productFeatures: '',
      userRequirement: '',
    },
  });

  assert.deepEqual(normalized.oneClickMemory.mainImage.uploadedProductUrls, ['https://example.com/main-a.png']);
  assert.equal(normalized.oneClickMemory.mainImage.lastStyleUrl, 'https://example.com/style-main.png');
  assert.deepEqual(normalized.oneClickMemory.detailPage.uploadedProductUrls, ['https://example.com/detail-a.png']);
  assert.equal(normalized.oneClickMemory.detailPage.lastStyleUrl, 'https://example.com/style-detail.png');
  assert.equal(normalized.retouchMemory.uploadedReferenceUrl, 'https://example.com/retouch-ref.png');
  assert.deepEqual(normalized.buyerShowMemory.uploadedProductUrls, ['https://example.com/buyer-a.png']);
  assert.equal(normalized.buyerShowMemory.uploadedReferenceUrl, 'https://example.com/buyer-ref.png');
});

test('normalizeLoadedPersistedAppState migrates legacy xhs cover tasks into a managed project list', () => {
  const normalized = normalizeLoadedPersistedAppState({
    xhsCoverMemory: {
      productImages: [],
      uploadedProductUrls: [],
      title: '封面标题',
      subtitle: '副标题',
      selectedStyleIds: ['workplace_big_text'],
      fontStyle: 'variety',
      aspectRatio: '3:4',
      quality: '1k',
      model: 'nano-banana-2',
      decoration: '',
      extraRequirement: '',
      tasks: [
        {
          id: 'task_1',
          styleId: 'workplace_big_text',
          styleName: '职场大字',
          status: 'completed',
          resultUrl: 'https://example.com/xhs-1.png',
        },
      ],
      isGenerating: false,
    },
  });

  assert.equal(normalized.xhsCoverMemory.projects.length, 1);
  assert.equal(normalized.xhsCoverMemory.activeProjectId, normalized.xhsCoverMemory.projects[0].id);
  assert.equal(normalized.xhsCoverMemory.projects[0].tasks.length, 1);
  assert.equal(normalized.xhsCoverMemory.projects[0].tasks[0].resultUrl, 'https://example.com/xhs-1.png');
  assert.equal(normalized.xhsCoverMemory.tasks.length, 1);
});

test('normalizeLoadedPersistedAppState migrates legacy nano-banana-pro image models to gpt-image-2', () => {
  const normalized = normalizeLoadedPersistedAppState({
    moduleConfig: {
      targetLanguage: 'English',
      customLanguage: '',
      removeWatermark: true,
      aspectRatio: '1:1',
      quality: '2k',
      model: 'nano-banana-pro',
      resolutionMode: 'custom',
      targetWidth: 1200,
      targetHeight: 1200,
      maxFileSize: 2,
    },
    translationConfigs: {
      main: { model: 'nano-banana-pro' },
      detail: { model: 'nano-banana-pro' },
      removeText: { model: 'nano-banana-pro' },
    },
    retouchMemory: {
      tasks: [],
      pendingFiles: [],
      referenceImage: null,
      uploadedReferenceUrl: null,
      mode: 'white_bg',
      aspectRatio: 'auto',
      quality: '2k',
      model: 'nano-banana-pro',
      resolutionMode: 'original',
      targetWidth: 0,
      targetHeight: 0,
    },
    buyerShowMemory: {
      productImages: [],
      uploadedProductUrls: [],
      referenceImage: null,
      uploadedReferenceUrl: null,
      targetCountry: '美国',
      customCountry: '',
      includeModel: true,
      aspectRatio: '3:4',
      quality: '2k',
      model: 'nano-banana-pro',
      imageCount: 3,
      setCount: 1,
      sets: [],
      tasks: [],
      evaluationText: '',
      pureEvaluations: [],
      firstImageConfirmed: false,
      isAnalyzing: false,
      isGenerating: false,
      subMode: 'integrated',
      referenceStrength: 'medium',
      productName: '',
      productFeatures: '',
      userRequirement: '',
    },
    videoMemory: {
      subMode: 'storyboard',
      config: {
        duration: '15',
        aspectRatio: 'landscape',
        promptMode: 'ai',
        script: '',
        scenes: [],
        productInfo: '',
        requirements: '',
        targetCountry: '美国',
        customCountry: '',
        referenceVideoUrl: '',
        videoCount: 1,
        targetLanguage: '',
        sellingPoints: '',
        logicInfo: '',
      },
      productImages: [],
      uploadedProductUrls: [],
      referenceVideoFile: null,
      uploadedReferenceVideoUrl: '',
      tasks: [],
      diagnosis: {},
      veoProjects: [],
      veoReferenceImages: [],
      isAnalyzing: false,
      isGenerating: false,
      storyboard: {
        config: {
          productImages: [],
          uploadedProductUrls: [],
          productInfo: '',
          scriptLogic: '',
          scriptPreset: 'custom',
          aspectRatio: '9:16',
          duration: '15s',
          shotCount: 9,
          actorType: 'no_real_face',
          projectCount: 1,
          scenes: [''],
          countryLanguage: '中国/中文',
          generateWhiteBg: false,
          model: 'nano-banana-pro',
          quality: '2k',
          generationMode: 'single_image',
        },
        projects: [],
        downloadingProjectId: null,
      },
    },
  });

  assert.equal(normalized.moduleConfig.model, 'gpt-image-2');
  assert.equal(normalized.translationConfigs.main.model, 'gpt-image-2');
  assert.equal(normalized.translationConfigs.detail.model, 'gpt-image-2');
  assert.equal(normalized.translationConfigs.removeText.model, 'gpt-image-2');
  assert.equal(normalized.retouchMemory.model, 'gpt-image-2');
  assert.equal(normalized.buyerShowMemory.model, 'gpt-image-2');
  assert.equal(normalized.videoMemory.storyboard.config.model, 'gpt-image-2');
});
