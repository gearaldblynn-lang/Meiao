import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCT_REPLACE_MAX_REFERENCE_IMAGES,
  assertProductReplaceInputBudget,
  assertProductReplaceReferenceCount,
  buildProductReplaceEditPrompt,
  buildProductReplacePrompt,
  compileProductReplaceGroups,
  mapProductReplaceWithConcurrency,
  normalizeProductReplacementLogic,
  resolveProductReplaceSubmissionConcurrency,
} from './productReplaceContract.mjs';

const basePromptInput = {
  referenceUrl: 'https://assets.example.com/reference.png',
  userPrompt: '保持画面高级简洁',
  referenceStrength: 'exact_replicate',
  textPolicy: 'keep_text',
  aspectRatio: '4:3',
  batchIndex: 1,
  batchCount: 2,
};

const readTaggedPromptJson = (prompt, tagName) => {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const start = prompt.indexOf(openTag);
  const end = prompt.indexOf(closeTag, start + openTag.length);
  assert.ok(start >= 0 && end > start, `${tagName} should exist in the prompt`);
  return JSON.parse(prompt.slice(start + openTag.length, end).trim());
};

test('product replacement logic normalizes current and historical combination values', () => {
  assert.equal(normalizeProductReplacementLogic('combination_replace'), 'combination_replace');
  assert.equal(normalizeProductReplacementLogic('组合替换'), 'combination_replace');
  assert.equal(normalizeProductReplacementLogic('single_replace'), 'single_replace');
  assert.equal(normalizeProductReplacementLogic('单品替换'), 'single_replace');
});

test('product replacement prompt is full RTCFE and omits Logo insertion when no Logo exists', () => {
  const productGroups = compileProductReplaceGroups([
    { id: 'front', url: 'https://assets.example.com/product-front.png' },
    { id: 'detail', url: 'https://assets.example.com/product-detail.png' },
  ], false);
  const prompt = buildProductReplacePrompt({
    ...basePromptInput,
    productGroups,
    isCombination: false,
  });

  const sections = ['R Role 角色', 'T Task 任务', 'C Constraint 约束', 'F Format 格式', 'E Example 示例'];
  sections.reduce((previousIndex, section) => {
    const currentIndex = prompt.indexOf(section);
    assert.ok(currentIndex > previousIndex, `${section} should follow the previous RTCFE section`);
    return currentIndex;
  }, -1);
  assert.match(prompt, /产品1[\s\S]*product-front\.png[\s\S]*product-detail\.png/);
  assert.match(prompt, /产品主体中间调的色相、明度层级、饱和度、灰阶关系/);
  assert.match(prompt, /禁止对产品蒙版应用参考图的全局 LUT、滤镜、统一色温、统一饱和度或统一曝光/);
  assert.match(prompt, /不能把中灰压成深灰或黑色/);
  assert.match(prompt, /用户补充要求不能重新定义产品颜色、材质、结构、组件、数量或产品组映射/);
  assert.match(prompt, /与产品输入图或颜色保真合同冲突的旧描述必须忽略/);
  assert.doesNotMatch(prompt, /允许根据场景调整[\s\S]{0,30}整体明暗/);
  assert.doesNotMatch(prompt, /Logo 原图|Logo 位置示意图|植入上传 Logo|Logo 必须植入|指定 Logo|上传的 Logo/);
});

test('product replacement prompt adds Logo roles and constraints only when both Logo inputs exist', () => {
  const productGroups = compileProductReplaceGroups([
    { id: 'product', url: 'https://assets.example.com/product.png' },
  ], false);
  const prompt = buildProductReplacePrompt({
    ...basePromptInput,
    productGroups,
    isCombination: false,
    logo: {
      url: 'https://assets.example.com/logo.png',
      placementGuideUrl: 'https://assets.example.com/logo-guide.png',
      placementRatio: '16:9',
    },
  });

  assert.match(prompt, /Logo 原图：https:\/\/assets\.example\.com\/logo\.png/);
  assert.match(prompt, /Logo 位置示意图：https:\/\/assets\.example\.com\/logo-guide\.png/);
  assert.match(prompt, /按 Logo 位置示意图植入上传 Logo/);
});

test('combination grouping treats repeated group ids as angles of one product and maps groups deterministically', () => {
  const groups = compileProductReplaceGroups([
    { id: 'a-front', url: 'https://assets.example.com/product-p1-front.png', productGroupId: 'group-a' },
    { id: 'b-front', url: 'https://assets.example.com/product_p2_front.png', productGroupId: 'group-b' },
    { id: 'a-side', url: 'https://assets.example.com/product-P-1-side.png', productGroupId: 'group-a' },
    { id: 'ungrouped', url: 'https://assets.example.com/c.png' },
  ], true);

  assert.deepEqual(groups.map((group) => ({
    productNumber: group.productNumber,
    materialIds: group.materialIds,
    urls: group.urls,
  })), [
    {
      productNumber: 1,
      materialIds: ['a-front', 'a-side'],
      urls: ['https://assets.example.com/product-p1-front.png', 'https://assets.example.com/product-P-1-side.png'],
    },
    {
      productNumber: 2,
      materialIds: ['b-front'],
      urls: ['https://assets.example.com/product_p2_front.png'],
    },
    {
      productNumber: 3,
      materialIds: ['ungrouped'],
      urls: ['https://assets.example.com/c.png'],
    },
  ]);

  const prompt = buildProductReplacePrompt({
    ...basePromptInput,
    productGroups: groups.map((group, index) => ({
      ...group,
      inputImageIndexes: index === 0 ? [2, 4] : index === 1 ? [3] : [5],
    })),
    isCombination: true,
    regionBindings: [
      {
        regionId: 'product-replace-region-1',
        regionIndex: 1,
        productGroupId: 'group-a',
        productNumber: 1,
        targetInputImageIndexes: [2, 4],
        xRatio: 0.1,
        yRatio: 0.2,
        widthRatio: 0.3,
        heightRatio: 0.6,
      },
      {
        regionId: 'product-replace-region-2',
        regionIndex: 2,
        productGroupId: 'group-b',
        productNumber: 2,
        targetInputImageIndexes: [3],
        xRatio: 0.55,
        yRatio: 0.44,
        widthRatio: 0.28,
        heightRatio: 0.4,
      },
      {
        regionId: 'product-replace-region-3',
        regionIndex: 3,
        productGroupId: groups[2].id,
        productNumber: 3,
        targetInputImageIndexes: [5],
        xRatio: 0.42,
        yRatio: 0.1,
        widthRatio: 0.15,
        heightRatio: 0.2,
      },
    ],
    planningAnalysis: {
      version: 5,
      taskType: 'combination_product_replacement',
      referenceSummary: 'keep P1, P 2, and P-3 planned perspective and occlusion',
      products: groups.map((group, index) => ({
        productGroupId: group.id,
        productNumber: index + 1,
        targetInputImageIndexes: index === 0 ? [3, 5] : index === 1 ? [4] : [6],
        identitySummary: `identity ${index + 1}`,
        silhouetteAndProportions: 'exact silhouette',
        structureAndAccessories: 'exact structure',
        materialsAndFinish: 'exact material',
        colorsAndPatterns: 'exact colors',
        logosAndGraphics: 'exact graphics',
        visiblePackagingText: `physical package text only, never P${index + 1} technical badges`,
        subjectBoundary: 'physical product only',
        nonProductReferenceArtifacts: [`P-${index + 1} badge outside the product`, 'reference-card header'],
        exactVisualAnchors: ['exact component geometry', 'exact label layout'],
        invariantDetails: [`preserve all P_${index + 1} visible product details`],
        identityLock: {
          materials: 'exact substrate, coating, transparency, gloss, texture, and reflection behavior',
          details: 'exact seams, edges, interfaces, closures, labels, and small visible components',
          colors: 'exact intrinsic base, secondary, accent, and component colors',
          colorPreservation: {
            componentColorMap: ['main shell: neutral medium gray', 'edge trim: darker neutral gray'],
            relativeColorRelationships: ['main shell stays visibly lighter than the edge trim'],
            midtoneAndWhiteBalanceRule: 'source-image midtones are the color truth after excluding highlights and shadows',
            forbiddenColorShifts: ['no hue shift', 'no saturation drift', 'no midtone lightness compression'],
          },
          patterns: 'exact printed graphics, motifs, gradients, borders, and placement',
          structure: 'exact silhouette, proportions, component geometry, assembly, and relative positions',
          forbiddenChanges: ['no redesign', 'no generic substitute', 'no missing or invented components'],
        },
      })),
      regions: [],
      globalConstraints: ['preserve scene'],
    },
  });
  assert.match(prompt, /Image 1 是当前唯一替换参考图/);
  assert.match(prompt, /当前生图输入不包含产品位置标记图/);
  assert.match(prompt, /目标区域 1 → 产品1 → Image 2、Image 4/);
  assert.match(prompt, /目标区域 2 → 产品2 → Image 3/);
  assert.match(prompt, /keep 目标区域 1, 目标区域 2, and 目标区域 3 planned perspective and occlusion/);
  assert.match(prompt, /"xRatio":\s*0\.1/);
  assert.match(prompt, /"widthRatio":\s*0\.3/);
  assert.match(prompt, /不得把具体产品概括成同类通用产品/);
  assert.match(prompt, /必须直接观察对应输入图像素/);
  assert.match(prompt, /非产品参考元素不得进入最终图/);
  assert.match(prompt, /<product_identity_lock_contract>/);
  assert.match(prompt, /<product_color_fidelity_contract>/);
  assert.match(prompt, /五维产品身份硬锁定/);
  assert.match(prompt, /"materials":\s*"exact substrate/);
  assert.match(prompt, /"details":\s*"exact seams/);
  assert.match(prompt, /"intrinsicColors":\s*"exact intrinsic/);
  assert.match(prompt, /"componentColorMap"/);
  assert.match(prompt, /"relativeColorRelationships"/);
  assert.match(prompt, /"midtoneAndWhiteBalanceRule"/);
  assert.match(prompt, /"forbiddenColorShifts"/);
  assert.match(prompt, /禁止对产品区域应用全局 LUT、滤镜、统一色调或整体压暗/);
  assert.match(prompt, /产品中间调必须与产品素材图保持同一明度层级/);
  assert.doesNotMatch(prompt, /允许根据场景调整[\s\S]{0,30}整体明暗/);
  assert.match(prompt, /"patterns":\s*"exact printed/);
  assert.match(prompt, /"structure":\s*"exact silhouette/);
  assert.match(prompt, /"forbiddenChanges"/);
  assert.ok(
    prompt.indexOf('<product_identity_lock_contract>') < prompt.indexOf('<product_replace_planning_data>'),
    'five-dimension identity lock must precede the broader planning data',
  );
  assert.doesNotMatch(prompt, /product[-_]p[-_]?[1-3]/i);
  assert.doesNotMatch(prompt, /\bP[\s_-]*[1-3]\b/i);
  assert.doesNotMatch(prompt, /从左到右、从上到下/);
});

test('verbose v5 planning is projected into one non-duplicated execution contract under the provider-safe limit', () => {
  const detail = (label, count = 18) => Array.from(
    { length: count },
    (_, index) => `${label}-${index + 1}: exact evidence`,
  ).join('; ');
  const productGroups = Array.from({ length: 3 }, (_, index) => ({
    id: `group-${index + 1}`,
    productNumber: index + 1,
    inputImageIndexes: [index + 2],
    urls: [`https://assets.example.com/product-${index + 1}.png`],
  }));
  const regionBindings = productGroups.map((group, index) => ({
    regionId: `product-replace-region-${index + 1}`,
    regionIndex: index + 1,
    productGroupId: group.id,
    productNumber: group.productNumber,
    targetInputImageIndexes: group.inputImageIndexes,
    xRatio: 0.05 + (index * 0.3),
    yRatio: 0.2,
    widthRatio: 0.2,
    heightRatio: 0.5,
  }));
  const planningAnalysis = {
    version: 5,
    taskType: 'combination_product_replacement',
    referenceSummary: detail('scene-summary', 5),
    products: productGroups.map((group, index) => ({
      productGroupId: group.id,
      productNumber: group.productNumber,
      targetInputImageIndexes: group.inputImageIndexes,
      identitySummary: detail(`legacy-identity-${index + 1}`, 8),
      silhouetteAndProportions: detail(`legacy-silhouette-${index + 1}`, 7),
      structureAndAccessories: detail(`legacy-structure-${index + 1}`, 7),
      materialsAndFinish: detail(`legacy-material-${index + 1}`, 7),
      colorsAndPatterns: detail(`legacy-color-pattern-${index + 1}`, 7),
      logosAndGraphics: detail(`legacy-graphics-${index + 1}`, 4),
      visiblePackagingText: `physical-package-text-${index + 1}`,
      subjectBoundary: detail(`physical-boundary-${index + 1}`, 4),
      nonProductReferenceArtifacts: [detail(`excluded-artifact-${index + 1}`, 3)],
      exactVisualAnchors: [detail(`visual-anchor-${index + 1}`, 5)],
      invariantDetails: [detail(`legacy-invariant-${index + 1}`, 3)],
      identityLock: {
        materials: detail(`canonical-material-${index + 1}`, 8),
        details: detail(`canonical-detail-${index + 1}`, 8),
        colors: detail(`canonical-color-${index + 1}`, 6),
        colorPreservation: {
          componentColorMap: [detail(`component-color-${index + 1}`, 5)],
          relativeColorRelationships: [detail(`relative-color-${index + 1}`, 4)],
          midtoneAndWhiteBalanceRule: detail(`midtone-rule-${index + 1}`, 5),
          forbiddenColorShifts: [detail(`forbidden-color-${index + 1}`, 5)],
        },
        patterns: detail(`canonical-pattern-${index + 1}`, 7),
        structure: detail(`canonical-structure-${index + 1}`, 7),
        forbiddenChanges: [detail(`forbidden-change-${index + 1}`, 6)],
      },
    })),
    regions: regionBindings.map((binding, index) => ({
      ...binding,
      oldProduct: detail(`old-product-${index + 1}`, 3),
      placement: detail(`placement-${index + 1}`, 4),
      scale: detail(`scale-${index + 1}`, 3),
      perspective: detail(`perspective-${index + 1}`, 3),
      lighting: detail(`lighting-${index + 1}`, 4),
      materialInteraction: detail(`material-interaction-${index + 1}`, 4),
      occlusion: detail(`occlusion-${index + 1}`, 4),
      contactShadow: detail(`contact-shadow-${index + 1}`, 4),
      generationInstruction: detail(`duplicate-region-instruction-${index + 1}`, 14),
    })),
    globalConstraints: [detail('global-scene-constraint', 4)],
    generationPrompt: detail('unused-generation-prompt', 20),
    validationChecklist: [detail('unused-validation-checklist', 10)],
  };

  const prompt = buildProductReplacePrompt({
    ...basePromptInput,
    productGroups,
    isCombination: true,
    regionBindings,
    planningAnalysis,
  });
  const identityContract = readTaggedPromptJson(prompt, 'product_identity_lock_contract');
  const colorContract = readTaggedPromptJson(prompt, 'product_color_fidelity_contract');
  const executionPlan = readTaggedPromptJson(prompt, 'product_replace_planning_data');

  assert.ok(prompt.length < 18_000, `generation prompt should stay under the conservative provider limit, got ${prompt.length}`);
  assert.equal('products' in executionPlan, false);
  assert.equal('generationInstruction' in executionPlan.regions[0], false);
  assert.equal('colorPreservation' in identityContract[0], false);
  assert.equal('colors' in identityContract[0], false);
  assert.equal(identityContract[0].physicalProductBoundary, planningAnalysis.products[0].subjectBoundary);
  assert.equal(identityContract[0].logosAndGraphics, planningAnalysis.products[0].logosAndGraphics);
  assert.deepEqual(identityContract[0].visualAnchors, planningAnalysis.products[0].exactVisualAnchors);
  assert.deepEqual(identityContract[0].invariantDetails, planningAnalysis.products[0].invariantDetails);
  assert.deepEqual(identityContract[0].excludedReferenceArtifacts, planningAnalysis.products[0].nonProductReferenceArtifacts);
  assert.equal(colorContract[0].intrinsicColors, planningAnalysis.products[0].identityLock.colors);
  const uniqueColorRule = planningAnalysis.products[0].identityLock.colorPreservation.midtoneAndWhiteBalanceRule;
  assert.equal(prompt.split(uniqueColorRule).length - 1, 1, 'canonical color evidence must appear exactly once');
  assert.doesNotMatch(prompt, /unused-generation-prompt|unused-validation-checklist|legacy-identity|duplicate-region-instruction/);
});

test('product replacement refuses an oversized generation prompt before provider submission', () => {
  assert.throws(
    () => buildProductReplacePrompt({
      ...basePromptInput,
      productGroups: compileProductReplaceGroups([
        { id: 'product', url: 'https://assets.example.com/product.png' },
      ], false),
      userPrompt: 'oversized-user-requirement '.repeat(1_000),
      isCombination: false,
    }),
    (error) => (
      error?.code === 'product_replace_generation_prompt_too_long'
      && error?.maxPromptChars === 18_000
      && error?.promptLength > error?.maxPromptChars
    ),
  );
});

test('generation input budget reserves the clean reference and optional Logo inputs but not the planning-only location guide', () => {
  assert.doesNotThrow(() => assertProductReplaceInputBudget({
    model: 'nano-banana-2',
    productImageCount: 6,
    hasLogo: true,
    hasLocationGuide: false,
  }));
  assert.throws(
    () => assertProductReplaceInputBudget({
      model: 'nano-banana-2',
      productImageCount: 8,
      hasLogo: true,
      hasLocationGuide: false,
    }),
    /Nano Banana 2[\s\S]*最多 10 张[\s\S]*当前需要 11 张/,
  );
  assert.doesNotThrow(() => assertProductReplaceInputBudget({
    model: 'gpt-image-2',
    productImageCount: 12,
    hasLogo: true,
    hasLocationGuide: false,
  }));
  assert.throws(
    () => assertProductReplaceInputBudget({
      model: 'gpt-image-2',
      productImageCount: 14,
      hasLogo: true,
      hasLocationGuide: false,
    }),
    /GPT Image 2[\s\S]*最多 16 张[\s\S]*当前需要 17 张/,
  );
});

test('reference batch limit rejects the 41st image instead of silently billing or executing it', () => {
  assert.equal(PRODUCT_REPLACE_MAX_REFERENCE_IMAGES, 40);
  assert.equal(assertProductReplaceReferenceCount(40), 40);
  assert.throws(() => assertProductReplaceReferenceCount(41), /替换参考图最多 40 张/);
});

test('product-preserving and free result edits compile different RTCFE contracts', () => {
  const productGroups = compileProductReplaceGroups([
    { id: 'product', url: 'https://assets.example.com/product.png' },
  ], false);
  const preserving = buildProductReplaceEditPrompt({
    mode: 'preserve_product',
    previousResultUrl: 'https://assets.example.com/result.png',
    editInstruction: '背景改成浴室',
    productGroups,
  });
  const free = buildProductReplaceEditPrompt({
    mode: 'free_edit',
    previousResultUrl: 'https://assets.example.com/result.png',
    editInstruction: '产品改成蓝色',
    productGroups,
  });

  assert.match(preserving, /产品硬锁定/);
  assert.match(preserving, /product\.png/);
  assert.match(preserving, /只允许修改用户明确指定的非产品内容/);
  assert.doesNotMatch(preserving, /产品锁定等约束均不再生效/);

  assert.match(free, /当前结果图是唯一图片依据/);
  assert.match(free, /允许修改产品本身/);
  assert.doesNotMatch(free, /product\.png|产品硬锁定/);
});

test('bounded product replacement mapper preserves output order and never exceeds the configured limit', async () => {
  let active = 0;
  let maxActive = 0;
  const output = await mapProductReplaceWithConcurrency([30, 5, 20, 1], 2, async (delay, index) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return `result-${index}`;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(output, ['result-0', 'result-1', 'result-2', 'result-3']);
});

test('product replacement submission concurrency uses a conservative default and clamps configuration', () => {
  assert.equal(resolveProductReplaceSubmissionConcurrency(undefined), 3);
  assert.equal(resolveProductReplaceSubmissionConcurrency('0'), 3);
  assert.equal(resolveProductReplaceSubmissionConcurrency('2'), 2);
  assert.equal(resolveProductReplaceSubmissionConcurrency('99'), 6);
});
