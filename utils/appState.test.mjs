import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLoadedPersistedAppState } from './appState.ts';

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
