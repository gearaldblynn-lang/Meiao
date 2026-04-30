import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultOneClickState, createDefaultVideoState, normalizeLoadedPersistedAppState } from './appState.ts';

test('createDefaultVideoState defaults GPT Image 2 storyboard quality to 2k', () => {
  const state = createDefaultVideoState();

  assert.equal(state.storyboard.config.model, 'gpt-image-2');
  assert.equal(state.storyboard.config.quality, '2k');
  assert.equal(state.storyboard.config.videoGenerationMode, 'original');
  assert.equal(state.storyboard.config.viralVariationCount, 3);
  assert.equal(state.storyboard.config.viralVariationStrength, '10');
  assert.equal(state.storyboard.config.viralCustomVariationStrength, '');
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
