import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildImageOutputTransformFromJob, transformImageOutputBuffer } from '../../../server/imagePostProcess.mjs';

import {
  acquireTranslationRetryScopeLock,
  appendTranslationRetrySuffix,
  buildTranslationResultDownloadPath,
  buildTranslationGenerationPrompt,
  buildTranslationRetryDescriptor,
  createTranslationConfigSnapshot,
  executeTranslationRetryPipeline,
  extractTranslationParamsFromPrompt,
  getTranslationRetryLineageLabel,
  isTranslationResultRetryEligible,
  mergeTranslationRetryResultIntoProjects,
  normalizeTranslationGenerationMode,
  resolveTranslationRetrySnapshot,
  resolveFailedTranslationRetryLifecycle,
  sortTranslationRetryResults,
  sumTranslationRetryCredits,
  translationSnapshotToParams,
  releaseTranslationRetryScopeLock,
  reduceTranslationRetryProjectMutation,
  upsertTranslationRetryResultInProject,
} from './translationRetryUtils.mjs';
import * as translationRetryUtils from './translationRetryUtils.mjs';

const completeParams = (overrides = {}) => ({
  lang: 'Japanese',
  customLanguage: '',
  model: 'GPT Image 2',
  quality: '2K',
  resolutionMode: 'custom',
  targetWidth: '1200',
  targetHeight: '0',
  maxFileSize: '2.5',
  ratio: '3:4',
  translationGenerationMode: 'AI优化',
  ...overrides,
});

test('failed translation retry metadata preserves the original-size output contract', () => {
  const buildMetadata = translationRetryUtils.buildTranslationRetryTaskMetadata;
  assert.equal(typeof buildMetadata, 'function');
  if (typeof buildMetadata !== 'function') return;

  const snapshot = createTranslationConfigSnapshot(completeParams({
    resolutionMode: 'original',
    ratio: 'auto',
    model: 'GPT Image 2',
    translationGenerationMode: 'AI直出',
  }));
  const metadata = buildMetadata({
    projectId: 'translation-project',
    projectName: '详情出海 · 1张',
    resultId: 'translation-result',
    subFeature: 'detail',
    sourceUrl: 'https://example.com/source.jpg',
    sourceFileName: 'source.jpg',
    sourceRelativePath: 'folder/source.jpg',
    sourceDimensions: { width: 790, height: 2132 },
    translationConfigSnapshot: snapshot,
  });

  assert.deepEqual(metadata, {
    shellPurpose: 'translation_result_retry',
    shellProjectId: 'translation-project',
    shellProjectName: '详情出海 · 1张',
    shellResultId: 'translation-result',
    subFeature: 'detail',
    sourceUrl: 'https://example.com/source.jpg',
    sourcePreviewUrl: 'https://example.com/source.jpg',
    sourceFileName: 'source.jpg',
    sourceRelativePath: 'folder/source.jpg',
    finalSize: { width: 790, height: 2132 },
    translationConfigSnapshot: snapshot,
    translationScope: 'product_isolation',
    translationGenerationMode: 'AI直出',
  });
});

test('original-size translation retry refuses to submit without source dimensions', () => {
  const buildMetadata = translationRetryUtils.buildTranslationRetryTaskMetadata;
  assert.equal(typeof buildMetadata, 'function');
  if (typeof buildMetadata !== 'function') return;

  assert.throws(
    () => buildMetadata({
      projectId: 'translation-project',
      resultId: 'translation-result',
      subFeature: 'detail',
      sourceUrl: 'https://example.com/source.jpg',
      translationConfigSnapshot: createTranslationConfigSnapshot(completeParams({
        resolutionMode: 'original',
        translationGenerationMode: 'AI直出',
      })),
    }),
    /原图尺寸读取失败/,
  );
});

test('translation ratio label keeps original-size selection distinct from provider matching ratio', () => {
  const getRatioLabel = translationRetryUtils.getTranslationResultRatioLabel;
  assert.equal(typeof getRatioLabel, 'function');
  if (typeof getRatioLabel !== 'function') return;

  assert.equal(getRatioLabel({
    aspectRatio: '1:4',
    matchedAspectRatio: '1:4',
    translationConfigSnapshot: createTranslationConfigSnapshot(completeParams({
      resolutionMode: 'original',
      ratio: 'auto',
      translationGenerationMode: 'AI直出',
    })),
  }), 'auto');
  assert.equal(getRatioLabel({
    aspectRatio: '3:4',
    matchedAspectRatio: '3:4',
    translationConfigSnapshot: createTranslationConfigSnapshot(completeParams({
      resolutionMode: 'custom',
      ratio: '3:4',
      translationGenerationMode: 'AI直出',
    })),
  }), '3:4');
});

test('failed retry plan keeps historical auto and preserves mismatched provider geometry instead of stretching', async () => {
  const buildPlan = translationRetryUtils.buildTranslationFailedRetryPlan;
  assert.equal(typeof buildPlan, 'function');
  if (typeof buildPlan !== 'function') return;

  const historicalSnapshot = createTranslationConfigSnapshot(completeParams({
    model: 'GPT Image 2',
    resolutionMode: 'original',
    ratio: 'auto',
    translationGenerationMode: 'AI直出',
  }));
  const plan = buildPlan({
    result: { translationConfigSnapshot: historicalSnapshot },
    projectParams: completeParams({ model: 'Nano Banana 2' }),
    projectId: 'translation-project',
    projectName: '详情出海 · 1张',
    resultId: 'translation-result',
    subFeature: 'detail',
    sourceUrl: 'https://example.com/source.jpg',
    sourceFileName: 'source.jpg',
    sourceRelativePath: 'folder/source.jpg',
    sourceDimensions: { width: 790, height: 2132 },
  });

  assert.equal(plan.snapshot.model, 'GPT Image 2');
  assert.equal(plan.moduleConfig.model, 'GPT Image 2');
  assert.equal(plan.moduleConfig.resolutionMode, 'original');
  assert.equal(plan.moduleConfig.aspectRatio, 'auto');
  assert.equal(plan.retryParams.model, 'GPT Image 2');
  assert.deepEqual(plan.taskMetadata.finalSize, { width: 790, height: 2132 });

  const outputTransform = buildImageOutputTransformFromJob({
    module: 'translation',
    taskType: 'kie_image',
    payload: {
      ...plan.taskMetadata,
      model: plan.moduleConfig.model,
      resolutionMode: plan.moduleConfig.resolutionMode,
      aspectRatio: '1:4',
      maxFileSize: 10,
    },
  });
  assert.deepEqual(outputTransform, {
    width: 790,
    height: 2132,
    maxFileSize: 10,
    preserveAspectRatio: true,
  });

  const providerOutput = await sharp({
    create: {
      width: 512,
      height: 2064,
      channels: 3,
      background: '#ffffff',
    },
  }).jpeg().toBuffer();
  const transformed = await transformImageOutputBuffer(providerOutput, outputTransform);
  assert.equal(transformed.width, 512);
  assert.equal(transformed.height, 2064);
  assert.equal(transformed.transformSkippedReason, 'aspect_ratio_mismatch');
});

test('failed retry plan supports each translation subfeature and keeps remove-text on its native direct prompt', () => {
  const buildPlan = translationRetryUtils.buildTranslationFailedRetryPlan;
  assert.equal(typeof buildPlan, 'function');
  if (typeof buildPlan !== 'function') return;

  for (const subFeature of ['main', 'detail', 'remove_text']) {
    for (const translationGenerationMode of ['AI直出', 'AI优化']) {
      const plan = buildPlan({
        result: {
          translationConfigSnapshot: createTranslationConfigSnapshot(completeParams({
            model: 'GPT Image 2',
            resolutionMode: 'custom',
            ratio: '3:4',
            translationGenerationMode,
          })),
        },
        projectParams: completeParams({ model: 'Nano Banana 2' }),
        projectId: 'translation-project',
        resultId: `translation-${subFeature}-${translationGenerationMode}`,
        subFeature,
        sourceUrl: 'https://example.com/source.jpg',
        sourceDimensions: { width: 790, height: 2132 },
      });
      assert.equal(plan.snapshot.model, 'GPT Image 2');
      assert.equal(
        plan.snapshot.translationGenerationMode,
        subFeature === 'remove_text' ? 'AI直出' : translationGenerationMode,
      );
      assert.equal(plan.taskMetadata.subFeature, subFeature);
      assert.equal(plan.moduleConfig.resolutionMode, 'custom');
      assert.equal(plan.moduleConfig.targetWidth, 1200);
    }
  }
});

test('failed retry plan resumes a completed planning stage without charging for planning twice', () => {
  const buildPlan = translationRetryUtils.buildTranslationFailedRetryPlan;
  assert.equal(typeof buildPlan, 'function');
  if (typeof buildPlan !== 'function') return;

  const plan = buildPlan({
    result: {
      id: 'translation-result',
      translationRetryStage: 'generation_pending',
      translationPlanningText: 'Translate title to "Storage Basket".',
      translationPlanningTaskId: 'planning-provider-1',
      translationPlanningCreditsConsumed: 1.5,
      translationConfigSnapshot: createTranslationConfigSnapshot(completeParams({
        translationGenerationMode: 'AI优化',
      })),
    },
    projectId: 'translation-project',
    resultId: 'translation-result',
    subFeature: 'detail',
    sourceUrl: 'https://example.com/source.jpg',
    sourceDimensions: { width: 790, height: 2132 },
  });

  assert.deepEqual(plan.resumePlanningResult, {
    description: 'Translate title to "Storage Basket".',
    taskId: 'planning-provider-1',
    creditsConsumed: 1.5,
  });
});

test('normalizeTranslationGenerationMode accepts the legacy planning label', () => {
  assert.equal(normalizeTranslationGenerationMode('AI优化'), 'AI优化');
  assert.equal(normalizeTranslationGenerationMode('策划分析'), 'AI优化');
  assert.equal(normalizeTranslationGenerationMode('AI直出'), 'AI直出');
  assert.equal(normalizeTranslationGenerationMode('unknown'), '');
});

test('runTranslationRetriesSequentially awaits controlled retries in strict order', async () => {
  const runSequentially = translationRetryUtils.runTranslationRetriesSequentially;
  assert.equal(typeof runSequentially, 'function');
  if (typeof runSequentially !== 'function') return;

  const gates = new Map();
  const events = [];
  let active = 0;
  let maxActive = 0;
  const runPromise = runSequentially(['first', 'second', 'third'], (item) => new Promise((resolve) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${item}`);
    gates.set(item, () => {
      events.push(`end:${item}`);
      active -= 1;
      resolve();
    });
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['start:first']);
  gates.get('first')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['start:first', 'end:first', 'start:second']);
  gates.get('second')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['start:first', 'end:first', 'start:second', 'end:second', 'start:third']);
  gates.get('third')();

  assert.equal(await runPromise, 3);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, [
    'start:first', 'end:first',
    'start:second', 'end:second',
    'start:third', 'end:third',
  ]);
});

test('runTranslationRetriesSequentially supports synchronous callbacks and returns the processed count', async () => {
  const runSequentially = translationRetryUtils.runTranslationRetriesSequentially;
  assert.equal(typeof runSequentially, 'function');
  if (typeof runSequentially !== 'function') return;

  const visited = [];
  const count = await runSequentially([1, 2, 3], (item) => {
    visited.push(item);
  });

  assert.equal(count, 3);
  assert.deepEqual(visited, [1, 2, 3]);
});

test('runTranslationRetriesSequentially does nothing for an empty collection', async () => {
  const runSequentially = translationRetryUtils.runTranslationRetriesSequentially;
  assert.equal(typeof runSequentially, 'function');
  if (typeof runSequentially !== 'function') return;

  let calls = 0;
  const count = await runSequentially([], () => {
    calls += 1;
  });

  assert.equal(count, 0);
  assert.equal(calls, 0);
});

test('createTranslationConfigSnapshot normalizes current parameter aliases', () => {
  assert.deepEqual(createTranslationConfigSnapshot(completeParams()), {
    targetLanguage: 'Japanese',
    customLanguage: '',
    model: 'GPT Image 2',
    quality: '2k',
    resolutionMode: 'custom',
    targetWidth: 1200,
    maxFileSize: 2.5,
    aspectRatio: '3:4',
    translationGenerationMode: 'AI优化',
    translationScope: 'product_isolation',
  });
});

test('createTranslationConfigSnapshot normalizes translation scope aliases', () => {
  assert.equal(createTranslationConfigSnapshot(completeParams()).translationScope, 'product_isolation');
  assert.equal(createTranslationConfigSnapshot(completeParams({ translationScope: 'global_translation' })).translationScope, 'global_translation');
  assert.equal(createTranslationConfigSnapshot(completeParams({ translationScope: '产品隔离' })).translationScope, 'product_isolation');
  assert.equal(createTranslationConfigSnapshot(completeParams({ translationScope: '全局翻译' })).translationScope, 'global_translation');
});

test('createTranslationConfigSnapshot rejects explicit unknown translation scope', () => {
  assert.equal(createTranslationConfigSnapshot(completeParams({ translationScope: 'legacy-unknown' })), null);
});

test('createTranslationConfigSnapshot normalizes supported quality labels', () => {
  assert.equal(createTranslationConfigSnapshot(completeParams({ quality: '1K' })).quality, '1k');
  assert.equal(createTranslationConfigSnapshot(completeParams({ quality: '4K' })).quality, '4k');
});

test('createTranslationConfigSnapshot normalizes original resolution labels from current and legacy keys', () => {
  assert.equal(createTranslationConfigSnapshot(completeParams({ resolutionMode: '原图' })).resolutionMode, 'original');
  assert.equal(createTranslationConfigSnapshot(completeParams({
    resolutionMode: '',
    sizeMode: 'original',
  })).resolutionMode, 'original');
});

test('createTranslationConfigSnapshot refuses incomplete language or generation mode', () => {
  assert.equal(createTranslationConfigSnapshot(completeParams({ lang: '' })), null);
  assert.equal(createTranslationConfigSnapshot(completeParams({ translationGenerationMode: '' })), null);
  assert.equal(createTranslationConfigSnapshot(completeParams({ translationGenerationMode: 'legacy-unknown' })), null);
});

test('createTranslationConfigSnapshot falls back from blank canonical numeric fields to legacy aliases', () => {
  const snapshot = createTranslationConfigSnapshot(completeParams({
    targetWidth: '',
    width: '900',
    targetHeight: '',
    height: '1200',
    maxFileSize: '',
    maxSize: '3',
  }));

  assert.equal(snapshot.targetWidth, 900);
  assert.equal(snapshot.targetHeight, 1200);
  assert.equal(snapshot.maxFileSize, 3);
});

test('createTranslationConfigSnapshot omits zero and negative optional numeric values', () => {
  const zeroSnapshot = createTranslationConfigSnapshot(completeParams({
    targetWidth: '0',
    targetHeight: '0',
    maxFileSize: '0',
  }));
  const negativeSnapshot = createTranslationConfigSnapshot(completeParams({
    targetWidth: '-1',
    targetHeight: '-1',
    maxFileSize: '-1',
  }));

  assert.equal(zeroSnapshot.targetWidth, undefined);
  assert.equal(zeroSnapshot.targetHeight, undefined);
  assert.equal(zeroSnapshot.maxFileSize, undefined);
  assert.equal(negativeSnapshot.targetWidth, undefined);
  assert.equal(negativeSnapshot.targetHeight, undefined);
  assert.equal(negativeSnapshot.maxFileSize, undefined);
});

test('createTranslationConfigSnapshot accepts frozen input without mutating it', () => {
  const params = Object.freeze(completeParams({
    lang: '',
    language: 'Italian',
    quality: '4K',
    resolutionMode: '',
    sizeMode: '原图',
  }));

  const snapshot = createTranslationConfigSnapshot(params);

  assert.equal(snapshot.targetLanguage, 'Italian');
  assert.equal(snapshot.quality, '4k');
  assert.equal(snapshot.resolutionMode, 'original');
  assert.equal(params.lang, '');
  assert.equal(params.language, 'Italian');
  assert.equal(params.quality, '4K');
  assert.equal(params.sizeMode, '原图');
});

test('extractTranslationParamsFromPrompt parses the structured front-end parameter line', () => {
  const params = extractTranslationParamsFromPrompt([
    '模块：出海翻译',
    '前端参数：{"lang":"Korean","translationGenerationMode":"AI直出"}',
    '继续处理图片。',
  ].join('\n'));

  assert.deepEqual(params, {
    lang: 'Korean',
    translationGenerationMode: 'AI直出',
  });
});

test('extractTranslationParamsFromPrompt rejects invalid JSON and non-object JSON', () => {
  assert.equal(extractTranslationParamsFromPrompt('前端参数：{invalid-json}'), null);
  assert.equal(extractTranslationParamsFromPrompt('前端参数：["Japanese"]'), null);
  assert.equal(extractTranslationParamsFromPrompt('没有结构化参数'), null);
});

test('resolveTranslationRetrySnapshot prefers a valid result snapshot over project and prompt params', () => {
  const promptParams = completeParams({
    lang: 'French',
    model: 'Prompt Model',
    translationGenerationMode: '策划分析',
  });
  const projectParams = completeParams({
    lang: 'Korean',
    model: 'Project Model',
    translationGenerationMode: 'AI直出',
  });
  const resultSnapshot = completeParams({
    lang: 'German',
    model: 'Result Model',
    translationGenerationMode: 'AI优化',
  });

  const resolved = resolveTranslationRetrySnapshot({
    result: {
      translationConfigSnapshot: resultSnapshot,
      prompt: `前端参数：${JSON.stringify(promptParams)}`,
    },
    projectParams,
  });

  assert.equal(resolved.targetLanguage, 'German');
  assert.equal(resolved.model, 'Result Model');
  assert.equal(resolved.translationGenerationMode, 'AI优化');
});

test('resolveTranslationRetrySnapshot prefers valid project params when the result snapshot is invalid', () => {
  const promptParams = completeParams({
    lang: 'French',
    model: 'Prompt Model',
    translationGenerationMode: '策划分析',
  });
  const projectParams = completeParams({
    lang: 'Korean',
    model: 'Project Model',
    translationGenerationMode: 'AI直出',
  });

  const resolved = resolveTranslationRetrySnapshot({
    result: {
      translationConfigSnapshot: {
        model: 'Invalid Result Model',
        translationGenerationMode: 'AI优化',
      },
      prompt: `前端参数：${JSON.stringify(promptParams)}`,
    },
    projectParams,
  });

  assert.equal(resolved.targetLanguage, 'Korean');
  assert.equal(resolved.model, 'Project Model');
  assert.equal(resolved.translationGenerationMode, 'AI直出');
});

test('resolveTranslationRetrySnapshot uses prompt params when higher-priority candidates are invalid', () => {
  const promptParams = completeParams({
    lang: 'French',
    model: 'Prompt Model',
    translationGenerationMode: '策划分析',
  });

  const resolved = resolveTranslationRetrySnapshot({
    result: {
      translationConfigSnapshot: null,
      prompt: `前端参数：${JSON.stringify(promptParams)}`,
    },
    projectParams: {
      lang: 'Korean',
      model: 'Invalid Project Model',
      translationGenerationMode: 'unknown',
    },
  });

  assert.equal(resolved.targetLanguage, 'French');
  assert.equal(resolved.model, 'Prompt Model');
  assert.equal(resolved.translationGenerationMode, 'AI优化');
});

test('resolveTranslationRetrySnapshot returns null when no candidate is complete', () => {
  assert.equal(resolveTranslationRetrySnapshot({ result: {}, projectParams: {} }), null);
});

test('resolveTranslationRetrySnapshot accepts frozen fallback candidates without mutating them', () => {
  const promptParams = Object.freeze(completeParams({
    lang: 'French',
    model: 'Frozen Prompt Model',
    translationGenerationMode: 'AI直出',
  }));
  const result = Object.freeze({
    translationConfigSnapshot: Object.freeze({
      lang: '',
      translationGenerationMode: 'AI优化',
    }),
    prompt: `前端参数：${JSON.stringify(promptParams)}`,
  });
  const projectParams = Object.freeze({
    lang: 'Korean',
    translationGenerationMode: 'unknown',
  });
  const input = Object.freeze({ result, projectParams });

  const resolved = resolveTranslationRetrySnapshot(input);

  assert.equal(resolved.targetLanguage, 'French');
  assert.equal(resolved.model, 'Frozen Prompt Model');
  assert.equal(result.translationConfigSnapshot.lang, '');
  assert.equal(projectParams.translationGenerationMode, 'unknown');
});

test('translationSnapshotToParams restores current and legacy generation aliases', () => {
  const snapshot = createTranslationConfigSnapshot(completeParams());

  assert.deepEqual(translationSnapshotToParams(snapshot), {
    lang: 'Japanese',
    language: 'Japanese',
    customLanguage: '',
    model: 'GPT Image 2',
    quality: '2k',
    resolutionMode: 'custom',
    sizeMode: 'custom',
    targetWidth: 1200,
    width: 1200,
    targetHeight: undefined,
    height: undefined,
    maxFileSize: 2.5,
    maxSize: 2.5,
    ratio: '3:4',
    aspectRatio: '3:4',
    translationGenerationMode: 'AI优化',
    translationScope: 'product_isolation',
    translationScopeLabel: '产品隔离',
  });
});

test('buildTranslationGenerationPrompt uses the newly generated optimization planning text verbatim', () => {
  const planningText = '本次新策划：将“Summer Sale”本地化为“夏日特惠”。';
  const prompt = buildTranslationGenerationPrompt({
    mode: 'AI优化',
    subFeatureLabel: '主图翻译',
    planningText,
    params: completeParams(),
    fileName: 'main.png',
    relativePath: 'sku/main.png',
    batchIndex: 1,
    batchCount: 2,
  });

  assert.match(prompt, /角色：商业图像文案翻译与修复助手/);
  assert.match(prompt, /根据 AI优化结果生成主图翻译成品图/);
  assert.match(prompt, /所有替换文案必须逐字照抄 AI优化结果中右侧引号内的本地化文案/);
  assert.match(prompt, /产品主体、包装、logo、画面主题和版式位置保持不变/);
  assert.match(prompt, /产品\/包装表面文字、实拍压印文字视为图片内容，不翻译、不重绘、不移动/);
  assert.match(prompt, /参数、尺寸、温度、数量等数值信息必须准确保留/);
  assert.match(prompt, /表格\/参数\/尺码类图片保持原表格行列、单元格位置和边框/);
  assert.match(prompt, /不新增原图不存在的信息或虚假卖点/);
  assert.match(prompt, /本次新生成的 AI优化结果/);
  assert.match(prompt, new RegExp(planningText));
});

test('buildTranslationGenerationPrompt global optimized mode translates product and packaging text with preserve exceptions', () => {
  const prompt = buildTranslationGenerationPrompt({
    mode: 'AI优化',
    subFeatureLabel: '主图翻译',
    planningText: '- [包装正面] “Fresh Mint”本地化为“フレッシュミント”\n- [保留项：型号] “ABC-1200”保持不变',
    params: completeParams({ translationScope: 'global_translation' }),
    fileName: 'main.png',
    relativePath: 'sku/main.png',
    batchIndex: 1,
    batchCount: 1,
  });

  assert.match(prompt, /全局翻译/);
  assert.match(prompt, /包装、标签、参数、警示、说明、压印、贴纸或屏幕文字/);
  assert.match(prompt, /仍保持 Logo、商标图形和产品型号不变/);
  assert.match(prompt, /不得猜测不可读文字/);
  assert.doesNotMatch(prompt, /产品\/包装表面文字、实拍压印文字视为图片内容，不翻译、不重绘、不移动/);
});

test('buildTranslationGenerationPrompt rejects blank optimization planning text', () => {
  assert.throws(
    () => buildTranslationGenerationPrompt({
      mode: 'AI优化',
      subFeatureLabel: '详情页翻译',
      planningText: '   ',
      params: completeParams(),
      fileName: 'detail.png',
      relativePath: 'detail/detail.png',
      batchIndex: 1,
      batchCount: 1,
    }),
    (error) => error instanceof TypeError && /planning text/i.test(error.message),
  );
});

test('buildTranslationGenerationPrompt direct mode serializes source metadata and requires fresh translation', () => {
  const params = completeParams({
    translationGenerationMode: 'AI直出',
    ratio: '4:5',
    aspectRatio: '4:5',
    __workspacePreferences: '{"showGenerationProgress":true}',
    __internalToken: 'must-not-leak',
    arbitraryInternalFlag: 'must-not-leak',
  });
  const prompt = buildTranslationGenerationPrompt({
    mode: 'AI直出',
    subFeatureLabel: '详情页翻译',
    planningText: '',
    params,
    fileName: 'detail-01.png',
    relativePath: 'details/detail-01.png',
    batchIndex: 2,
    batchCount: 3,
  });
  const structuredParams = JSON.parse(
    prompt.split('\n').find((line) => line.startsWith('前端参数：')).slice('前端参数：'.length),
  );

  assert.match(prompt, /模块：出海翻译/);
  assert.match(prompt, /子功能：详情页翻译/);
  assert.match(prompt, /生成逻辑：AI直出/);
  assert.match(prompt, /用户需求：重新翻译当前图片中的文案/);
  assert.match(prompt, /必须重新识别并重新翻译当前输入图片中的文案/);
  assert.match(prompt, /不得复用旧结果图或旧结果图中的翻译结果/);
  assert.deepEqual(structuredParams, {
    lang: 'Japanese',
    customLanguage: '',
    model: 'GPT Image 2',
    quality: '2K',
    resolutionMode: 'custom',
    targetWidth: '1200',
    targetHeight: '0',
    maxFileSize: '2.5',
    ratio: '4:5',
    aspectRatio: '4:5',
    translationGenerationMode: 'AI直出',
    __batchIndex: '2',
    __batchCount: '3',
    __sourceFileName: 'detail-01.png',
    __sourceRelativePath: 'details/detail-01.png',
  });
  assert.equal('__workspacePreferences' in structuredParams, false);
  assert.equal('__internalToken' in structuredParams, false);
  assert.equal('arbitraryInternalFlag' in structuredParams, false);
});

test('buildTranslationGenerationPrompt direct global mode includes global translation guardrails', () => {
  const prompt = buildTranslationGenerationPrompt({
    mode: 'AI直出',
    subFeatureLabel: '详情页翻译',
    planningText: '',
    params: completeParams({
      translationGenerationMode: 'AI直出',
      translationScope: '全局翻译',
    }),
    fileName: 'detail-01.png',
    relativePath: 'details/detail-01.png',
    batchIndex: 1,
    batchCount: 1,
  });

  const structuredParams = JSON.parse(
    prompt.split('\n').find((line) => line.startsWith('前端参数：')).slice('前端参数：'.length),
  );

  assert.equal(structuredParams.translationScope, '全局翻译');
  assert.match(prompt, /全局翻译/);
  assert.match(prompt, /翻译图片中所有可读文案/);
  assert.match(prompt, /仍保持 Logo、商标图形和产品型号不变/);
});

test('buildTranslationRetryDescriptor keeps the root and advances the largest attempt', () => {
  const results = [
    { id: 'root-a', sourceOrder: 4, retryAttempt: 0 },
    { id: 'root-a-retry-1', retryRootResultId: 'root-a', retryAttempt: 1, sourceOrder: 4 },
    { id: 'root-a-retry-3', retryRootResultId: 'root-a', retryAttempt: 3, sourceOrder: 4 },
    { id: 'root-b', sourceOrder: 5 },
  ];

  assert.deepEqual(buildTranslationRetryDescriptor({
    results,
    sourceResult: results[1],
    createId: () => 'root-a-retry-4',
    createdAt: () => 12345,
  }), {
    id: 'root-a-retry-4',
    retryOfResultId: 'root-a-retry-1',
    retryRootResultId: 'root-a',
    retryAttempt: 4,
    sourceOrder: 4,
    createdAt: 12345,
  });
});

test('buildTranslationRetryDescriptor falls back to the original root index for source order', () => {
  const results = [{ id: 'root-a' }, { id: 'root-b' }];

  assert.equal(buildTranslationRetryDescriptor({
    results,
    sourceResult: results[1],
    createId: 'root-b-retry-1',
    createdAt: 222,
  }).sourceOrder, 1);
});

test('buildTranslationRetryDescriptor rejects a missing or blank source result id', () => {
  for (const sourceResult of [{}, { id: '   ' }]) {
    assert.throws(
      () => buildTranslationRetryDescriptor({
        results: [],
        sourceResult,
        createId: () => 'retry-1',
        createdAt: 123,
      }),
      (error) => error instanceof TypeError
        && /sourceResult\.id must be a non-empty string/.test(error.message),
    );
  }
});

test('buildTranslationRetryDescriptor rejects a blank retry id returned by createId', () => {
  assert.throws(
    () => buildTranslationRetryDescriptor({
      results: [{ id: 'root-a' }],
      sourceResult: { id: 'root-a' },
      createId: () => '   ',
      createdAt: 123,
    }),
    (error) => error instanceof TypeError
      && /retry id must be a non-empty string/.test(error.message),
  );
});

test('buildTranslationRetryDescriptor accepts frozen inputs without mutating them', () => {
  const root = Object.freeze({ id: 'root-a', sourceOrder: 0, retryAttempt: 0 });
  const retry = Object.freeze({
    id: 'root-a-retry-1',
    retryRootResultId: 'root-a',
    retryAttempt: 1,
    sourceOrder: 0,
  });
  const results = Object.freeze([root, retry]);
  const input = Object.freeze({
    results,
    sourceResult: retry,
    createId: () => 'root-a-retry-2',
    createdAt: 456,
  });

  const descriptor = buildTranslationRetryDescriptor(input);

  assert.equal(descriptor.retryAttempt, 2);
  assert.equal(results.length, 2);
  assert.equal(retry.retryAttempt, 1);
});

test('sortTranslationRetryResults stably groups retries immediately below each original', () => {
  const retryA2 = { id: 'a-r2', retryRootResultId: 'a', retryAttempt: 2, sourceOrder: 0, createdAt: 30 };
  const originalB = { id: 'b', sourceOrder: 1, createdAt: 10 };
  const retryA1Later = { id: 'a-r1-z', retryRootResultId: 'a', retryAttempt: 1, sourceOrder: 0, createdAt: 22 };
  const originalA = { id: 'a', sourceOrder: 0, createdAt: 10 };
  const retryB1 = { id: 'b-r1', retryRootResultId: 'b', retryAttempt: 1, sourceOrder: 1, createdAt: 20 };
  const retryA1Earlier = { id: 'a-r1-a', retryRootResultId: 'a', retryAttempt: 1, sourceOrder: 0, createdAt: 20 };
  const input = [retryA2, originalB, retryA1Later, originalA, retryB1, retryA1Earlier];

  assert.deepEqual(sortTranslationRetryResults(input).map((item) => item.id), [
    'a',
    'a-r1-a',
    'a-r1-z',
    'a-r2',
    'b',
    'b-r1',
  ]);
  assert.deepEqual(input.map((item) => item.id), [
    'a-r2',
    'b',
    'a-r1-z',
    'a',
    'b-r1',
    'a-r1-a',
  ]);
});

test('sortTranslationRetryResults accepts a frozen array of frozen results without mutation', () => {
  const original = Object.freeze({ id: 'root-a', sourceOrder: 0, createdAt: 10 });
  const retry = Object.freeze({
    id: 'root-a-retry-1',
    retryRootResultId: 'root-a',
    retryAttempt: 1,
    sourceOrder: 0,
    createdAt: 20,
  });
  const other = Object.freeze({ id: 'root-b', sourceOrder: 1, createdAt: 11 });
  const results = Object.freeze([retry, other, original]);

  assert.deepEqual(sortTranslationRetryResults(results).map((result) => result.id), [
    'root-a',
    'root-a-retry-1',
    'root-b',
  ]);
  assert.deepEqual(results.map((result) => result.id), ['root-a-retry-1', 'root-b', 'root-a']);
});

test('appendTranslationRetrySuffix normalizes slashes and adds retry suffix before extension', () => {
  assert.equal(appendTranslationRetrySuffix('detail\\item-01.jpg', 0, 'png'), 'detail/item-01.png');
  assert.equal(appendTranslationRetrySuffix('detail\\item-01.jpg', 3, '.png'), 'detail/item-01__retry-3.png');
});

test('buildTranslationResultDownloadPath preserves established names for one source and its retries', () => {
  const original = { id: 'root', relativePath: 'folder/detail.jpg', sourceOrder: 0, retryAttempt: 0 };
  const retry = {
    id: 'retry-1',
    relativePath: 'folder/detail.jpg',
    retryRootResultId: 'root',
    sourceOrder: 0,
    retryAttempt: 1,
  };
  const results = [original, retry];
  const paths = results.map((result) => buildTranslationResultDownloadPath({ results, result, extension: 'png' }));

  assert.deepEqual(paths, ['folder/detail.png', 'folder/detail__retry-1.png']);
  assert.equal(new Set(paths).size, results.length);
  assert.equal(new Set(paths.map((path) => path.split('/').pop())).size, results.length);
});

test('buildTranslationResultDownloadPath makes same-path roots and retries globally unique', () => {
  const first = { id: 'root-a', relativePath: 'folder/detail.jpg', sourceOrder: 0, retryAttempt: 0 };
  const firstRetry = { id: 'retry-a', relativePath: 'folder/detail.jpg', retryRootResultId: 'root-a', sourceOrder: 0, retryAttempt: 1 };
  const second = { id: 'root-b', relativePath: 'folder/detail.jpg', sourceOrder: 1, retryAttempt: 0 };
  const secondRetry = { id: 'retry-b', relativePath: 'folder/detail.jpg', retryRootResultId: 'root-b', sourceOrder: 1, retryAttempt: 1 };
  const results = [secondRetry, second, firstRetry, first];
  const paths = results.map((result) => buildTranslationResultDownloadPath({ results, result, extension: 'png' }));

  assert.deepEqual(paths, [
    'folder/detail__source-2__retry-1.png',
    'folder/detail__source-2.png',
    'folder/detail__retry-1.png',
    'folder/detail.png',
  ]);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(new Set(paths.map((path) => path.split('/').pop())).size, paths.length);
});

test('buildTranslationResultDownloadPath prevents single-download basename collisions across folders', () => {
  const first = { id: 'root-a', relativePath: 'one/detail.jpg', sourceOrder: 0 };
  const second = { id: 'root-b', relativePath: 'two/detail.jpg', sourceOrder: 1 };
  const results = [first, second];
  const paths = results.map((result) => buildTranslationResultDownloadPath({ results, result, extension: 'png' }));

  assert.deepEqual(paths, ['one/detail.png', 'two/detail__source-2.png']);
  assert.equal(new Set(paths).size, results.length);
  assert.equal(new Set(paths.map((path) => path.split('/').pop())).size, results.length);
});

test('buildTranslationResultDownloadPath gives missing paths stable index fallbacks', () => {
  const first = { id: 'root-a' };
  const second = { id: 'root-b' };
  const secondRetry = { id: 'retry-b', retryRootResultId: 'root-b', retryAttempt: 1 };
  const results = [first, second, secondRetry];
  const paths = results.map((result) => buildTranslationResultDownloadPath({ results, result, extension: 'png' }));

  assert.deepEqual(paths, ['translation_1.png', 'translation_2.png', 'translation_2__retry-1.png']);
  assert.equal(new Set(paths).size, results.length);
  assert.equal(new Set(paths.map((path) => path.split('/').pop())).size, results.length);
  assert.equal(
    buildTranslationResultDownloadPath({ results, result: secondRetry, extension: 'png' }),
    buildTranslationResultDownloadPath({ results, result: secondRetry, extension: 'png' }),
  );
});

test('buildTranslationResultDownloadPath avoids collisions with source-like names already supplied by users', () => {
  const first = { id: 'a', relativePath: 'detail.jpg', sourceOrder: 0 };
  const second = { id: 'b', relativePath: 'detail.jpg', sourceOrder: 1 };
  const reserved = { id: 'c', relativePath: 'detail__source-2.jpg', sourceOrder: 2 };
  const results = [first, second, reserved];
  const paths = results.map((result) => buildTranslationResultDownloadPath({ results, result, extension: 'png' }));
  const basenames = paths.map((path) => path.split('/').pop());

  assert.equal(new Set(paths).size, results.length);
  assert.equal(new Set(basenames).size, results.length);
  assert.deepEqual(paths, ['detail.png', 'detail__source-2.png', 'detail__source-2__source-3.png']);
});

test('buildTranslationResultDownloadPath avoids collisions with retry-like names already supplied by users', () => {
  const original = { id: 'a', relativePath: 'detail.jpg', sourceOrder: 0 };
  const retry = { id: 'a-retry', relativePath: 'detail.jpg', retryRootResultId: 'a', retryAttempt: 1, sourceOrder: 0 };
  const reserved = { id: 'b', relativePath: 'detail__retry-1.jpg', sourceOrder: 1 };
  const results = [original, retry, reserved];
  const paths = results.map((result) => buildTranslationResultDownloadPath({ results, result, extension: 'png' }));
  const basenames = paths.map((path) => path.split('/').pop());

  assert.equal(new Set(paths).size, results.length);
  assert.equal(new Set(basenames).size, results.length);
  assert.equal(paths[0], 'detail.png');
  assert.equal(paths[1], 'detail__retry-1.png');
  assert.notEqual(paths[2], 'detail__retry-1.png');
});

test('buildTranslationResultDownloadPath deterministically disambiguates duplicate retry attempts', () => {
  const original = { id: 'root', relativePath: 'folder/detail.jpg', createdAt: 1 };
  const retryA = { id: 'retry-a', retryRootResultId: 'root', retryAttempt: 1, createdAt: 2 };
  const retryB = { id: 'retry-b', retryRootResultId: 'root', retryAttempt: 1, createdAt: 3 };
  const results = [original, retryA, retryB];
  const paths = results.map((result) => buildTranslationResultDownloadPath({ results, result, extension: 'png' }));
  const basenames = paths.map((path) => path.split('/').pop());

  assert.equal(new Set(paths).size, results.length);
  assert.equal(new Set(basenames).size, results.length);
  assert.equal(paths[0], 'folder/detail.png');
  assert.match(paths[1], /__retry-1\.png$/);
  assert.match(paths[2], /__source-[^/]+__retry-1\.png$/);
});

test('buildTranslationResultDownloadPath is stable when legacy results are reordered', () => {
  const older = { id: 'root-z', relativePath: 'folder/detail.jpg', createdAt: 10 };
  const newer = { id: 'root-a', relativePath: 'folder/detail.jpg', createdAt: 20 };
  const noTimestamp = { id: 'root-m', relativePath: 'folder/detail.jpg' };
  const forward = [older, newer, noTimestamp];
  const reverse = [...forward].reverse();
  const forwardPaths = Object.fromEntries(forward.map((result) => [
    result.id,
    buildTranslationResultDownloadPath({ results: forward, result, extension: 'png' }),
  ]));
  const reversePaths = Object.fromEntries(reverse.map((result) => [
    result.id,
    buildTranslationResultDownloadPath({ results: reverse, result, extension: 'png' }),
  ]));

  assert.deepEqual(reversePaths, forwardPaths);
  assert.equal(new Set(Object.values(forwardPaths)).size, forward.length);
  assert.equal(new Set(Object.values(forwardPaths).map((path) => path.split('/').pop())).size, forward.length);
});

test('buildTranslationResultDownloadPath keeps empty-path legacy records unique after reorder', () => {
  const first = { id: 'legacy-b' };
  const second = { id: 'legacy-a' };
  const orders = [[first, second], [second, first]];
  const mappings = orders.map((results) => Object.fromEntries(results.map((result) => [
    result.id,
    buildTranslationResultDownloadPath({ results, result, extension: 'png' }),
  ])));

  assert.deepEqual(mappings[0], mappings[1]);
  for (const mapping of mappings) {
    const paths = Object.values(mapping);
    assert.equal(new Set(paths).size, paths.length);
    assert.equal(new Set(paths.map((path) => path.split('/').pop())).size, paths.length);
  }
});

test('isTranslationResultRetryEligible accepts errors and completed main or detail images only', () => {
  assert.equal(isTranslationResultRetryEligible('remove_text', { status: 'error' }), true);
  assert.equal(isTranslationResultRetryEligible('main', { status: 'completed', imageUrl: 'main.png' }), true);
  assert.equal(isTranslationResultRetryEligible('detail', { status: 'completed', imageUrl: 'detail.png' }), true);
  assert.equal(isTranslationResultRetryEligible('main', { status: 'completed', imageUrl: '' }), false);
  assert.equal(isTranslationResultRetryEligible('remove_text', { status: 'completed', imageUrl: 'clean.png' }), false);
  assert.equal(isTranslationResultRetryEligible('detail', { status: 'generating', imageUrl: '' }), false);
});

test('getTranslationRetryLineageLabel hides originals and identifies direct and chained retry sources', () => {
  const original = { id: 'original', retryAttempt: 0 };
  const retryOne = { id: 'retry-1', retryOfResultId: 'original', retryAttempt: 1 };
  const retryTwo = { id: 'retry-2', retryOfResultId: 'retry-1', retryAttempt: 2 };
  const results = [original, retryOne, retryTwo];

  assert.equal(getTranslationRetryLineageLabel(original, results), '');
  assert.equal(getTranslationRetryLineageLabel(retryOne, results), '重试 1 · 来源：原始结果');
  assert.equal(getTranslationRetryLineageLabel(retryTwo, results), '重试 2 · 来源：重试 1');
});

test('getTranslationRetryLineageLabel reports unknown when retry lineage has no source id', () => {
  assert.equal(
    getTranslationRetryLineageLabel({ id: 'legacy-retry-2', retryAttempt: 2 }, []),
    '重试 2 · 来源：未知',
  );
});

test('getTranslationRetryLineageLabel distinguishes provably deleted originals from unknown deleted sources', () => {
  assert.equal(
    getTranslationRetryLineageLabel({ id: 'retry-1', retryOfResultId: 'deleted-original', retryRootResultId: 'deleted-original', retryAttempt: 1 }, []),
    '重试 1 · 来源：原始结果已删除',
  );
  assert.equal(
    getTranslationRetryLineageLabel({ id: 'retry-3', retryOfResultId: 'deleted-retry-1', retryRootResultId: 'original', retryAttempt: 3 }, []),
    '重试 3 · 来源：来源结果已删除',
  );
  assert.equal(
    getTranslationRetryLineageLabel({ id: 'retry-3', retryOfResultId: 'deleted-original', retryRootResultId: 'deleted-original', retryAttempt: 3 }, []),
    '重试 3 · 来源：原始结果已删除',
  );
});

test('getTranslationRetryLineageLabel reports a branched retry source without guessing a missing generation', () => {
  const original = { id: 'original', retryAttempt: 0 };
  const retryOne = { id: 'retry-1', retryOfResultId: 'original', retryRootResultId: 'original', retryAttempt: 1 };
  const retryThree = { id: 'retry-3', retryOfResultId: 'retry-1', retryRootResultId: 'original', retryAttempt: 3 };

  assert.equal(getTranslationRetryLineageLabel(retryThree, [original, retryOne]), '重试 3 · 来源：重试 1');
  assert.equal(getTranslationRetryLineageLabel(retryThree, [original]), '重试 3 · 来源：来源结果已删除');
});

test('sumTranslationRetryCredits includes each finite positive charge once', () => {
  assert.equal(sumTranslationRetryCredits(0.25, 3), 3.25);
  assert.equal(sumTranslationRetryCredits(Number.NaN, -3), undefined);
  assert.equal(sumTranslationRetryCredits(0, undefined), undefined);
});

test('executeTranslationRetryPipeline runs fresh planning before building and generating', async () => {
  const calls = [];
  const snapshot = createTranslationConfigSnapshot(completeParams());

  const result = await executeTranslationRetryPipeline({
    snapshot,
    runPlanning: async (receivedSnapshot) => {
      calls.push(`planning:${receivedSnapshot.targetLanguage}`);
      return { description: 'fresh localized copy', taskId: 'plan-2', creditsConsumed: 0.25 };
    },
    buildPrompt: (planningText) => {
      calls.push(`prompt:${planningText}`);
      return `generate from ${planningText}`;
    },
    runGeneration: async (prompt) => {
      calls.push(`generation:${prompt}`);
      return { status: 'success', imageUrl: '/result.png', creditsConsumed: 3 };
    },
  });

  assert.deepEqual(calls, [
    'planning:Japanese',
    'prompt:fresh localized copy',
    'generation:generate from fresh localized copy',
  ]);
  assert.deepEqual(result, {
    status: 'success',
    imageUrl: '/result.png',
    creditsConsumed: 3.25,
    prompt: 'generate from fresh localized copy',
    planningText: 'fresh localized copy',
    planningTaskId: 'plan-2',
    planningCreditsConsumed: 0.25,
    generationCreditsConsumed: 3,
  });
});

test('executeTranslationRetryPipeline preserves planning and generation charges when image generation fails', async () => {
  const snapshot = createTranslationConfigSnapshot(completeParams());

  const result = await executeTranslationRetryPipeline({
    snapshot,
    runPlanning: async () => ({
      description: 'fresh failed-generation plan',
      taskId: 'planning-provider-failed-image',
      creditsConsumed: 1,
    }),
    buildPrompt: (planningText) => `generate from ${planningText}`,
    runGeneration: async () => ({
      status: 'error',
      message: 'charged image generation failed',
      creditsConsumed: 3,
    }),
  });

  assert.equal(result.status, 'error');
  assert.equal(result.planningTaskId, 'planning-provider-failed-image');
  assert.equal(result.planningCreditsConsumed, 1);
  assert.equal(result.generationCreditsConsumed, 3);
  assert.equal(result.creditsConsumed, 4);
});

test('executeTranslationRetryPipeline rejects invalid snapshots before invoking any pipeline callback', async () => {
  for (const snapshot of [
    { targetLanguage: 'Japanese', translationGenerationMode: 'unknown' },
    { translationGenerationMode: 'AI优化' },
  ]) {
    const calls = [];
    await assert.rejects(
      executeTranslationRetryPipeline({
        snapshot,
        runPlanning: async () => {
          calls.push('planning');
          return { description: 'unused' };
        },
        buildPrompt: () => {
          calls.push('prompt');
          return 'unused';
        },
        runGeneration: async () => {
          calls.push('generation');
          return { status: 'success' };
        },
      }),
      (error) => error instanceof TypeError
        && /Invalid translation retry snapshot/.test(error.message),
    );
    assert.deepEqual(calls, []);
  }
});

test('executeTranslationRetryPipeline normalizes a frozen snapshot once for every pipeline stage', async () => {
  const receivedSnapshots = [];
  const snapshot = Object.freeze({
    language: 'Italian',
    customLanguage: '',
    model: 'Frozen Model',
    quality: '4K',
    sizeMode: '原图',
    ratio: '16:9',
    translationGenerationMode: '策划分析',
  });
  const input = Object.freeze({
    snapshot,
    runPlanning: async (normalizedSnapshot) => {
      receivedSnapshots.push(normalizedSnapshot);
      return { description: 'fresh plan' };
    },
    buildPrompt: (planningText, normalizedSnapshot) => {
      receivedSnapshots.push(normalizedSnapshot);
      return planningText;
    },
    runGeneration: async (_prompt, normalizedSnapshot) => {
      receivedSnapshots.push(normalizedSnapshot);
      return { status: 'success' };
    },
  });

  await executeTranslationRetryPipeline(input);

  assert.equal(receivedSnapshots.length, 3);
  assert.equal(receivedSnapshots[0], receivedSnapshots[1]);
  assert.equal(receivedSnapshots[1], receivedSnapshots[2]);
  assert.deepEqual(receivedSnapshots[0], {
    targetLanguage: 'Italian',
    customLanguage: '',
    model: 'Frozen Model',
    quality: '4k',
    resolutionMode: 'original',
    translationScope: 'product_isolation',
    aspectRatio: '16:9',
    translationGenerationMode: 'AI优化',
  });
  assert.equal(snapshot.quality, '4K');
  assert.equal(snapshot.sizeMode, '原图');
  assert.equal(snapshot.translationGenerationMode, '策划分析');
});

test('executeTranslationRetryPipeline skips planning in direct generation mode', async () => {
  let planningCalls = 0;
  const snapshot = createTranslationConfigSnapshot(completeParams({ translationGenerationMode: 'AI直出' }));

  const result = await executeTranslationRetryPipeline({
    snapshot,
    runPlanning: async () => {
      planningCalls += 1;
      return { description: 'must not be used', creditsConsumed: 10 };
    },
    buildPrompt: (planningText) => `direct:${planningText}`,
    runGeneration: async () => ({ status: 'success', creditsConsumed: 2 }),
  });

  assert.equal(planningCalls, 0);
  assert.deepEqual(result, {
    status: 'success',
    creditsConsumed: 2,
    prompt: 'direct:',
    planningText: '',
    planningTaskId: undefined,
    planningCreditsConsumed: undefined,
    generationCreditsConsumed: 2,
  });
});

test('executeTranslationRetryPipeline reuses a persisted completed planning stage', async () => {
  let planningCalls = 0;
  const result = await executeTranslationRetryPipeline({
    snapshot: completeParams({ translationGenerationMode: 'AI优化' }),
    resumePlanningResult: {
      description: 'persisted fresh planning',
      taskId: 'planning-provider-resume',
      creditsConsumed: 1.25,
    },
    runPlanning: async () => {
      planningCalls += 1;
      throw new Error('must not re-plan');
    },
    buildPrompt: (planningText) => `prompt:${planningText}`,
    runGeneration: async () => ({ status: 'success', imageUrl: 'result.png', creditsConsumed: 3 }),
  });

  assert.equal(planningCalls, 0);
  assert.equal(result.planningText, 'persisted fresh planning');
  assert.equal(result.planningTaskId, 'planning-provider-resume');
  assert.equal(result.planningCreditsConsumed, 1.25);
  assert.equal(result.generationCreditsConsumed, 3);
  assert.equal(result.creditsConsumed, 4.25);
});

test('upsertTranslationRetryResultInProject appends immutably and updates one retry without duplication', () => {
  const original = Object.freeze({
    id: 'translation-original',
    imageUrl: 'https://example.com/original.png',
    status: 'completed',
    sourceOrder: 0,
    retryAttempt: 0,
  });
  const other = Object.freeze({
    id: 'translation-other',
    imageUrl: 'https://example.com/other.png',
    status: 'completed',
    sourceOrder: 1,
    retryAttempt: 0,
  });
  const project = Object.freeze({
    id: 'translation-project',
    status: 'completed',
    taskCount: 2,
    completedCount: 2,
    results: Object.freeze([other, original]),
  });
  const pendingRetry = Object.freeze({
    id: 'result-retry-new',
    imageUrl: '',
    status: 'generating',
    retryOfResultId: original.id,
    retryRootResultId: original.id,
    retryAttempt: 1,
    sourceOrder: 0,
    createdAt: 30,
  });

  const appended = upsertTranslationRetryResultInProject(project, pendingRetry);

  assert.notEqual(appended, project);
  assert.deepEqual(appended.results.map((result) => result.id), [
    original.id,
    pendingRetry.id,
    other.id,
  ]);
  assert.equal(appended.results[0], original);
  assert.equal(appended.taskCount, 3);
  assert.equal(appended.completedCount, 2);
  assert.equal(appended.status, 'generating');
  assert.deepEqual(project.results.map((result) => result.id), [other.id, original.id]);

  const completedRetry = Object.freeze({
    ...pendingRetry,
    imageUrl: 'https://example.com/retry.png',
    status: 'completed',
  });
  const completed = upsertTranslationRetryResultInProject(appended, completedRetry);

  assert.equal(completed.results.filter((result) => result.id === pendingRetry.id).length, 1);
  assert.equal(completed.results.find((result) => result.id === pendingRetry.id), completedRetry);
  assert.equal(completed.taskCount, 3);
  assert.equal(completed.completedCount, 3);
  assert.equal(completed.status, 'completed');
  assert.equal(appended.results.find((result) => result.id === pendingRetry.id), pendingRetry);
});

test('resolveFailedTranslationRetryLifecycle completes the same failed result on success', () => {
  const currentResult = Object.freeze({
    id: 'failed-original',
    status: 'generating',
    imageUrl: '',
    prompt: 'retry prompt',
    translationPlanningCreditsConsumed: 1,
  });

  const lifecycle = resolveFailedTranslationRetryLifecycle({
    currentResult,
    generation: {
      status: 'success',
      imageUrl: 'https://example.com/recovered.png',
      prompt: 'provider prompt',
      taskId: 'provider-success',
      backendJobId: 'job-success',
      creditsConsumed: 3,
    },
  });

  assert.equal(lifecycle.kind, 'success');
  assert.equal(lifecycle.fileStatus, 'completed');
  assert.equal(lifecycle.result.id, currentResult.id);
  assert.equal(lifecycle.result.status, 'completed');
  assert.equal(lifecycle.result.imageUrl, 'https://example.com/recovered.png');
  assert.equal(lifecycle.result.translationGenerationCreditsConsumed, 3);
  assert.equal(lifecycle.result.creditsConsumed, 4);
  assert.equal(currentResult.status, 'generating');
});

test('resolveFailedTranslationRetryLifecycle keeps recoverable provider results generating', () => {
  const lifecycle = resolveFailedTranslationRetryLifecycle({
    currentResult: {
      id: 'failed-original',
      status: 'generating',
      imageUrl: '',
      backendJobId: 'known-job',
    },
    generation: {
      status: 'accepted',
      taskId: 'provider-pending',
      creditsConsumed: 2,
    },
    recoverable: true,
  });

  assert.equal(lifecycle.kind, 'recoverable');
  assert.equal(lifecycle.fileStatus, 'processing');
  assert.equal(lifecycle.result.status, 'generating');
  assert.equal(lifecycle.result.taskId, 'provider-pending');
  assert.equal(lifecycle.result.backendJobId, 'known-job');
  assert.equal(lifecycle.result.error, '任务已提交云端，结果待同步');
  assert.equal(lifecycle.result.translationGenerationCreditsConsumed, 2);
  assert.equal(lifecycle.result.creditsConsumed, 2);
});

test('resolveFailedTranslationRetryLifecycle records returned terminal provider failure and credits', () => {
  const lifecycle = resolveFailedTranslationRetryLifecycle({
    currentResult: {
      id: 'failed-original',
      status: 'generating',
      imageUrl: '',
      taskId: 'known-provider',
      translationPlanningCreditsConsumed: 0.5,
    },
    generation: {
      status: 'error',
      backendJobId: 'job-terminal',
      creditsConsumed: 2.5,
      message: 'provider rejected retry',
    },
  });

  assert.equal(lifecycle.kind, 'error');
  assert.equal(lifecycle.fileStatus, 'error');
  assert.equal(lifecycle.result.status, 'error');
  assert.equal(lifecycle.result.taskId, 'known-provider');
  assert.equal(lifecycle.result.backendJobId, 'job-terminal');
  assert.equal(lifecycle.result.error, 'provider rejected retry');
  assert.equal(lifecycle.result.translationGenerationCreditsConsumed, 2.5);
  assert.equal(lifecycle.result.creditsConsumed, 3);
});

test('resolveFailedTranslationRetryLifecycle records thrown failures without fabricating success', () => {
  const lifecycle = resolveFailedTranslationRetryLifecycle({
    currentResult: {
      id: 'failed-original',
      status: 'generating',
      imageUrl: '',
      taskId: 'known-provider',
      backendJobId: 'known-job',
      creditsConsumed: 2,
      translationGenerationCreditsConsumed: 2,
    },
    error: new DOMException('retry aborted', 'AbortError'),
  });

  assert.equal(lifecycle.kind, 'error');
  assert.equal(lifecycle.fileStatus, 'error');
  assert.equal(lifecycle.result.status, 'error');
  assert.equal(lifecycle.result.imageUrl, '');
  assert.equal(lifecycle.result.error, 'retry aborted');
  assert.equal(lifecycle.result.taskId, 'known-provider');
  assert.equal(lifecycle.result.backendJobId, 'known-job');
  assert.equal(lifecycle.result.creditsConsumed, 2);
});

test('mergeTranslationRetryResultIntoProjects preserves interleaved hydration and sibling retries', () => {
  const root = Object.freeze({
    id: 'root-result',
    status: 'completed',
    imageUrl: 'https://example.com/root.png',
    sourceOrder: 0,
  });
  const initialProject = Object.freeze({
    id: 'project-live',
    name: 'initial project',
    status: 'completed',
    results: Object.freeze([root]),
    taskCount: 1,
    completedCount: 1,
  });
  const retryA = Object.freeze({
    id: 'retry-a',
    retryOfResultId: root.id,
    retryRootResultId: root.id,
    retryAttempt: 1,
    sourceOrder: 0,
    status: 'generating',
    imageUrl: '',
  });

  const appended = mergeTranslationRetryResultIntoProjects({
    projects: Object.freeze([initialProject]),
    projectId: initialProject.id,
    retryResult: retryA,
    allowAppend: true,
  });
  assert.equal(appended.updated, true);
  assert.deepEqual(appended.project.results.map((result) => result.id), [root.id, retryA.id]);

  const hydratedSibling = Object.freeze({
    id: 'hydrated-sibling',
    status: 'completed',
    imageUrl: 'https://example.com/sibling.png',
    sourceOrder: 1,
  });
  const retryB = Object.freeze({
    id: 'retry-b',
    retryOfResultId: hydratedSibling.id,
    retryRootResultId: hydratedSibling.id,
    retryAttempt: 1,
    sourceOrder: 1,
    status: 'generating',
    imageUrl: '',
  });
  const liveProject = Object.freeze({
    ...appended.project,
    name: 'hydrated project name',
    hydratedRevision: 'server-newer',
    results: Object.freeze([...appended.project.results, hydratedSibling, retryB]),
  });
  const completedA = Object.freeze({
    ...retryA,
    status: 'completed',
    imageUrl: 'https://example.com/retry-a.png',
  });

  const updated = mergeTranslationRetryResultIntoProjects({
    projects: Object.freeze([liveProject]),
    projectId: initialProject.id,
    retryResult: completedA,
  });

  assert.equal(updated.updated, true);
  assert.equal(updated.project.name, 'hydrated project name');
  assert.equal(updated.project.hydratedRevision, 'server-newer');
  assert.deepEqual(updated.project.results.map((result) => result.id), [
    root.id,
    completedA.id,
    hydratedSibling.id,
    retryB.id,
  ]);
  assert.equal(updated.project.results.find((result) => result.id === retryB.id), retryB);

  const projectAfterDeletion = Object.freeze({
    ...updated.project,
    results: Object.freeze(updated.project.results.filter((result) => result.id !== retryA.id)),
  });
  const ignored = mergeTranslationRetryResultIntoProjects({
    projects: Object.freeze([projectAfterDeletion]),
    projectId: initialProject.id,
    retryResult: { ...completedA, status: 'error' },
  });

  assert.equal(ignored.updated, false);
  assert.equal(ignored.project, null);
  assert.equal(ignored.projects[0], projectAfterDeletion);
  assert.equal(ignored.projects[0].results.some((result) => result.id === retryA.id), false);
});

test('translation retry scope lock atomically blocks a second result in the same subfeature', () => {
  const locks = new Set();

  assert.equal(acquireTranslationRetryScopeLock(locks, 'translation:main'), true);
  assert.equal(acquireTranslationRetryScopeLock(locks, 'translation:main'), false);
  assert.equal(acquireTranslationRetryScopeLock(locks, 'translation:detail'), true);
  assert.deepEqual([...locks].sort(), ['translation:detail', 'translation:main']);

  assert.equal(releaseTranslationRetryScopeLock(locks, 'translation:main'), true);
  assert.equal(acquireTranslationRetryScopeLock(locks, 'translation:main'), true);
  assert.equal(releaseTranslationRetryScopeLock(locks, 'translation:missing'), false);
});

test('reduceTranslationRetryProjectMutation observes queued hydration and deletion before retry transitions', () => {
  const root = {
    id: 'root-queued',
    status: 'completed',
    imageUrl: 'https://example.com/root.png',
    sourceOrder: 0,
  };
  const retry = {
    id: 'retry-queued',
    retryOfResultId: root.id,
    retryRootResultId: root.id,
    retryAttempt: 1,
    sourceOrder: 0,
    status: 'generating',
    imageUrl: '',
    prompt: 'pending prompt',
  };
  const initialProjects = [{
    id: 'project-queued',
    name: 'initial',
    status: 'generating',
    taskCount: 2,
    completedCount: 1,
    results: [root, retry],
  }];
  const hydratedSibling = {
    id: 'hydrated-queued-sibling',
    status: 'completed',
    imageUrl: 'https://example.com/sibling.png',
    sourceOrder: 1,
  };
  const queuedHydration = (projects) => projects.map((project) => project.id === 'project-queued'
    ? {
        ...project,
        name: 'hydrated queued name',
        hydrationRevision: 9,
        results: project.results.map((result) => result.id === retry.id
          ? { ...result, backendJobId: 'hydrated-job', hydratedResultField: 'keep-me' }
          : result).concat(hydratedSibling),
      }
    : project);
  const queuedRetryTransition = (projects) => reduceTranslationRetryProjectMutation(projects, {
    projectId: 'project-queued',
    retryResult: {
      ...retry,
      status: 'completed',
      imageUrl: 'https://example.com/retry.png',
      prompt: 'completed prompt',
    },
  }).projects;

  const hydratedThenCompleted = queuedRetryTransition(queuedHydration(initialProjects));
  const completedProject = hydratedThenCompleted[0];
  const completedRetry = completedProject.results.find((result) => result.id === retry.id);
  assert.equal(completedProject.name, 'hydrated queued name');
  assert.equal(completedProject.hydrationRevision, 9);
  assert.equal(completedProject.results.includes(hydratedSibling), true);
  assert.equal(completedRetry.backendJobId, 'hydrated-job');
  assert.equal(completedRetry.hydratedResultField, 'keep-me');
  assert.equal(completedRetry.status, 'completed');
  assert.equal(completedRetry.imageUrl, 'https://example.com/retry.png');

  const queuedDeletion = (projects) => projects.map((project) => project.id === 'project-queued'
    ? { ...project, results: project.results.filter((result) => result.id !== retry.id) }
    : project);
  const deletedProjects = queuedDeletion(initialProjects);
  const ignored = reduceTranslationRetryProjectMutation(deletedProjects, {
    projectId: 'project-queued',
    retryResult: { ...retry, status: 'error', error: 'late failure' },
  });
  assert.equal(ignored.updated, false);
  assert.equal(ignored.project, null);
  assert.equal(ignored.projects, deletedProjects);
  assert.equal(ignored.projects[0].results.some((result) => result.id === retry.id), false);
});
