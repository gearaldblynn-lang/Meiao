import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProductReplaceAnalysisPrompt,
  parseProductReplaceAnalysis,
} from './productReplaceAnalysis.mjs';

const bindings = [
  {
    regionId: 'product-replace-region-1',
    regionIndex: 1,
    productGroupId: 'group-a',
    productNumber: 1,
    targetInputImageIndexes: [3, 4],
    xRatio: 0.12,
    yRatio: 0.18,
    widthRatio: 0.31,
    heightRatio: 0.64,
  },
  {
    regionId: 'product-replace-region-2',
    regionIndex: 2,
    productGroupId: 'group-b',
    productNumber: 2,
    targetInputImageIndexes: [5],
    xRatio: 0.56,
    yRatio: 0.42,
    widthRatio: 0.28,
    heightRatio: 0.39,
  },
];

const analysis = {
  version: 5,
  taskType: 'combination_product_replacement',
  referenceSummary: 'Two products on a bathroom counter.',
  products: bindings.map((binding) => ({
    productGroupId: binding.productGroupId,
    productNumber: binding.productNumber,
    targetInputImageIndexes: binding.targetInputImageIndexes,
    identitySummary: `product ${binding.productNumber} identity`,
    silhouetteAndProportions: 'exact outer contour, height-to-width ratio, and component proportions',
    structureAndAccessories: 'all caps, pumps, seams, handles, and attachments',
    materialsAndFinish: 'exact substrate, gloss, texture, transparency, and reflective finish',
    colorsAndPatterns: 'exact base colors, gradients, borders, and printed patterns',
    logosAndGraphics: 'exact logo shape, placement, color, and graphic topology',
    visiblePackagingText: 'preserve every legible packaging character; do not invent unreadable text',
    subjectBoundary: 'the physical product silhouette only, excluding the surrounding reference-card background',
    nonProductReferenceArtifacts: ['technical region badge outside the product', 'explanatory header outside the product'],
    exactVisualAnchors: ['pump nozzle geometry', 'label panel proportions and text layout'],
    invariantDetails: ['do not redesign the package', 'do not simplify small visible components'],
    identityLock: {
      materials: 'lock the exact bottle, cap, label, and accessory materials plus their surface finishes',
      details: 'lock every visible edge, seam, nozzle, label boundary, and small attached component',
      colors: 'lock intrinsic base, secondary, accent, and component colors without hue drift',
      colorPreservation: {
        componentColorMap: ['hat crown: neutral medium gray with unchanged boundary', 'trim: darker neutral gray'],
        relativeColorRelationships: ['hat crown remains lighter than the trim without collapsing either into black'],
        midtoneAndWhiteBalanceRule: 'match source-image product midtones after discounting highlights, shadows, and scene color cast',
        forbiddenColorShifts: ['no hue-family shift', 'no saturation drift', 'no midtone lightness compression'],
      },
      patterns: 'lock printed artwork, repeated motifs, gradients, borders, and their exact placement',
      structure: 'lock silhouette, proportions, component geometry, assembly order, and relative positions',
      forbiddenChanges: ['no redesign', 'no generic substitute', 'no component deletion or invention'],
    },
  })),
  regions: bindings.map((binding) => ({
    ...binding,
    oldProduct: `old product in P${binding.productNumber}`,
    placement: 'keep marked position and visual footprint',
    scale: 'match the marked region',
    perspective: 'follow the counter perspective',
    lighting: 'soft light from upper left',
    materialInteraction: 'preserve local reflections',
    occlusion: 'keep foreground overlap',
    contactShadow: 'rebuild contact shadow on the counter',
    generationInstruction: `replace only P${binding.productNumber}`,
  })),
  globalConstraints: ['preserve all unmarked content'],
  generationPrompt: 'Replace both marked products with their bound product identity images.',
  validationChecklist: ['P1 and P2 mapping remains exact'],
};

const executionAnalysis = {
  version: 6,
  taskType: 'combination_product_replacement',
  regions: bindings.map((binding) => ({
    regionId: binding.regionId,
    regionIndex: binding.regionIndex,
    productGroupId: binding.productGroupId,
    productNumber: binding.productNumber,
    placement: '保持用户标记区域内的原视觉中心和占比',
    perspective: '匹配台面透视与相机俯视角度',
    materialInteraction: '只继承局部高光和反射，不改变产品固有外观',
    occlusion: '保持前景物体对产品边缘的现有遮挡',
    contactShadow: '在台面重建与产品接触一致的短软阴影',
  })),
};

const detailedExecutionAnalysis = {
  version: 7,
  taskType: 'combination_product_replacement',
  generationPrompt: {
    products: bindings.map((binding) => ({
      productGroupId: binding.productGroupId,
      productNumber: binding.productNumber,
      identity: {
        physicalBoundary: '只包含产品实体，不包含白底、尺寸线、说明卡片或道具',
        silhouetteAndProportions: '保持主体长宽比例、顶部收窄轮廓和底部厚度关系',
        componentTopology: '主体、顶盖、侧边扣件和底座共四个组件；顶盖在主体上方，扣件固定在右侧，底座与主体连续连接',
        interfacesAndEdges: '保留顶盖接缝、右侧扣件开孔、底座包边和所有可见连接位置',
        materialsAndFinish: '主体为细哑光表面，扣件为半亮硬质材质，边缘无高光塑料化',
        intrinsicColors: '主体中灰、包边深灰、扣件黑色，保持三者相对明度关系',
        patternsLogosAndText: '保留正面图案、Logo 比例、方向和相对位置；不可辨文字不得猜测',
        rigidityAndAllowedDeformation: '主体结构保持刚性；只允许透视投影变化，不允许压扁、拉长或移动组件',
        criticalDetails: ['右侧扣件数量与孔位', '顶盖与主体之间的窄接缝', '底座包边厚度'],
        forbiddenChanges: ['不得删除或新增组件', '不得交换扣件与 Logo 位置', '不得把四组件结构简化为通用外壳'],
        missingCriticalEvidence: [],
      },
    })),
    regions: bindings.map((binding) => ({
      regionId: binding.regionId,
      regionIndex: binding.regionIndex,
      productGroupId: binding.productGroupId,
      productNumber: binding.productNumber,
      placement: '保持标记区域内的视觉中心与原占比',
      perspective: '匹配相机俯视角与台面消失线',
      requiredVisibleStructure: ['顶盖轮廓', '右侧扣件', '底座包边'],
      geometryAdaptation: '使用产品三分之四视角；刚性组件只做整体透视投影，不做非物理形变',
      lightingAndColorIntegration: '继承左上方柔光和局部反射，同时保持产品固有中间调',
      materialInteraction: '在半亮扣件上保留窄高光，主体维持细哑光反射',
      occlusion: '保持前景物体现有遮挡，但不得遮掉右侧扣件',
      contactShadow: '在台面重建短而柔和的接触阴影',
      oldProductRemoval: '完整清除旧产品轮廓、品牌、倒影和接触阴影后再放入新产品',
    })),
    scenePreservation: '保持未标记人物、背景、文案和其他产品不变',
    negativeConstraints: ['不得生成 P 编号或定位框', '不得把产品素材背景带入成图'],
  },
};

test('product replacement planning produces a product-specific structured generation prompt', () => {
  const prompt = buildProductReplaceAnalysisPrompt({
    referenceUrl: 'https://assets.test/reference.png',
    regionGuideUrl: 'https://assets.test/guide.png',
    productUrls: [
      'https://assets.test/a-front.png',
      'https://assets.test/a-side.png',
      'https://assets.test/b-front.png',
    ],
    bindings,
    globalRequirement: '保持画面高级简洁',
  });

  for (const field of [
    'generationPrompt',
    'componentTopology',
    'interfacesAndEdges',
    'criticalDetails',
    'forbiddenChanges',
    'geometryAdaptation',
    'oldProductRemoval',
  ]) {
    assert.match(prompt, new RegExp(`"${field}"`));
  }
  assert.doesNotMatch(prompt, /不输出产品的颜色、材质、图案、结构/);
});

test('product replacement parser accepts complete v7 product identity and fusion instructions', () => {
  const parsed = parseProductReplaceAnalysis(JSON.stringify(detailedExecutionAnalysis), {
    expectedBindings: bindings,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.version, 7);
  assert.match(parsed.value.generationPrompt.products[0].identity.componentTopology, /四个组件/);
  assert.deepEqual(parsed.value.generationPrompt.regions[0].requiredVisibleStructure, [
    '顶盖轮廓',
    '右侧扣件',
    '底座包边',
  ]);
});

test('v7 analysis rejects incomplete, invented, swapped, or oversized product instructions before generation', () => {
  const missingStructure = structuredClone(detailedExecutionAnalysis);
  delete missingStructure.generationPrompt.products[0].identity.componentTopology;
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(missingStructure), {
    expectedBindings: bindings,
  }).ok, false);

  const insufficientEvidence = structuredClone(detailedExecutionAnalysis);
  insufficientEvidence.generationPrompt.products[0].identity.missingCriticalEvidence = ['缺少底部接口视图'];
  const insufficientResult = parseProductReplaceAnalysis(JSON.stringify(insufficientEvidence), {
    expectedBindings: bindings,
  });
  assert.equal(insufficientResult.ok, false);
  assert.equal(insufficientResult.errorCode, 'product_replace_analysis_reference_insufficient');
  assert.match(insufficientResult.message, /产品1.*缺少底部接口视图/);

  const swapped = structuredClone(detailedExecutionAnalysis);
  swapped.generationPrompt.regions[0].productGroupId = 'group-b';
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(swapped), {
    expectedBindings: bindings,
  }).ok, false);

  const oversized = structuredClone(detailedExecutionAnalysis);
  oversized.generationPrompt.products[0].identity.componentTopology = '具体组件结构'.repeat(101);
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(oversized), {
    expectedBindings: bindings,
  }).ok, false);

  const oversizedTotal = structuredClone(detailedExecutionAnalysis);
  for (const product of oversizedTotal.generationPrompt.products) {
    for (const field of [
      'physicalBoundary',
      'silhouetteAndProportions',
      'componentTopology',
      'interfacesAndEdges',
      'materialsAndFinish',
      'intrinsicColors',
      'patternsLogosAndText',
      'rigidityAndAllowedDeformation',
    ]) product.identity[field] = '细'.repeat(600);
    product.identity.criticalDetails = Array.from({ length: 8 }, () => '点'.repeat(240));
    product.identity.forbiddenChanges = Array.from({ length: 8 }, () => '禁'.repeat(240));
  }
  const oversizedTotalResult = parseProductReplaceAnalysis(JSON.stringify(oversizedTotal), {
    expectedBindings: bindings,
  });
  assert.equal(oversizedTotalResult.ok, false);
  assert.equal(oversizedTotalResult.errorCode, 'product_replace_analysis_prompt_too_long');
});

test('product replacement planning stays evidence-bound, product-specific, and bounded', () => {
  const prompt = buildProductReplaceAnalysisPrompt({
    referenceUrl: 'https://assets.test/reference.png',
    regionGuideUrl: 'https://assets.test/guide.png',
    productUrls: [
      'https://assets.test/a-front.png',
      'https://assets.test/a-side.png',
      'https://assets.test/b-front.png',
    ],
    bindings,
    globalRequirement: '保持画面高级简洁',
  });

  for (const section of ['R Role 角色', 'T Task 任务', 'C Constraint 约束', 'F Format 格式', 'E Example 示例']) {
    assert.match(prompt, new RegExp(section));
  }
  assert.match(prompt, /Image 1 是当前唯一待替换参考图/);
  assert.match(prompt, /Image 2 是带有 P1、P2 编号的产品位置标记图/);
  assert.match(prompt, /P1 固定绑定 Image 3、Image 4/);
  assert.match(prompt, /P2 固定绑定 Image 5/);
  assert.match(prompt, /generationPrompt\.products 与 generationPrompt\.regions 都必须恰好包含 2 项/);
  assert.match(prompt, /产品图片是视觉身份最高真值/);
  assert.match(prompt, /不得发明图片中不可见的组件、颜色、文字、材质或功能/);
  for (const field of [
    'physicalBoundary',
    'componentTopology',
    'intrinsicColors',
    'placement',
    'geometryAdaptation',
    'lightingAndColorIntegration',
    'oldProductRemoval',
  ]) {
    assert.match(prompt, new RegExp(`"${field}"`));
  }
  assert.doesNotMatch(prompt, /"xRatio"/);
  assert.doesNotMatch(prompt, /https:\/\/assets\.test/);
  assert.ok(prompt.length < 10_000, `product-specific planning prompt should stay bounded, got ${prompt.length}`);
});

test('product replacement analysis parser accepts v6 only for explicit read-only recovery', () => {
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(executionAnalysis), {
    expectedBindings: bindings,
  }).ok, false);
  const parsed = parseProductReplaceAnalysis(JSON.stringify(executionAnalysis), {
    expectedBindings: bindings,
    allowLegacyV6: true,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.regions.map((region) => region.productGroupId), ['group-a', 'group-b']);
  assert.deepEqual(parsed.value.regions[0].targetInputImageIndexes, [3, 4]);
  assert.equal('products' in parsed.value, false);
  assert.equal('generationPrompt' in parsed.value, false);

  const swapped = structuredClone(executionAnalysis);
  swapped.regions[0].productGroupId = 'group-b';
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(swapped), {
    expectedBindings: bindings,
    allowLegacyV6: true,
  }).ok, false);

  const incomplete = structuredClone(executionAnalysis);
  incomplete.regions.pop();
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(incomplete), {
    expectedBindings: bindings,
    allowLegacyV6: true,
  }).ok, false);

  for (const field of ['placement', 'perspective', 'materialInteraction', 'occlusion', 'contactShadow']) {
    const missingDecision = structuredClone(executionAnalysis);
    delete missingDecision.regions[0][field];
    assert.equal(parseProductReplaceAnalysis(JSON.stringify(missingDecision), {
      expectedBindings: bindings,
      allowLegacyV6: true,
    }).ok, false, `missing execution decision should fail: ${field}`);
  }
  const overlongDecision = structuredClone(executionAnalysis);
  overlongDecision.regions[0].placement = '过长执行描述'.repeat(30);
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(overlongDecision), {
    expectedBindings: bindings,
    allowLegacyV6: true,
  }).ok, false);
});

test('new product replacement analysis rejects v1 through v6 while explicit recovery accepts them read-only', () => {
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(analysis), {
    expectedBindings: bindings,
  }).ok, false);
  const recoveredV5 = parseProductReplaceAnalysis(JSON.stringify(analysis), {
    expectedBindings: bindings,
    allowLegacyV5: true,
  });
  assert.equal(recoveredV5.ok, true);
  assert.equal(recoveredV5.value.version, 5);

  const recoveredV6 = parseProductReplaceAnalysis(JSON.stringify(executionAnalysis), {
    expectedBindings: bindings,
    allowLegacyV6: true,
  });
  assert.equal(recoveredV6.ok, true);
  assert.equal(recoveredV6.value.version, 6);

  const legacyV4 = structuredClone(analysis);
  legacyV4.version = 4;
  legacyV4.products.forEach((product) => delete product.identityLock.colorPreservation);
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(legacyV4), {
    expectedBindings: bindings,
  }).ok, false);
  const recoveredV4 = parseProductReplaceAnalysis(JSON.stringify(legacyV4), {
    expectedBindings: bindings,
    allowLegacyV4: true,
  });
  assert.equal(recoveredV4.ok, true);
  assert.equal(recoveredV4.value.version, 4);

  const legacyV3 = structuredClone(analysis);
  legacyV3.version = 3;
  legacyV3.products.forEach((product) => delete product.identityLock);
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(legacyV3), {
    expectedBindings: bindings,
  }).ok, false);
  const recoveredV3 = parseProductReplaceAnalysis(JSON.stringify(legacyV3), {
    expectedBindings: bindings,
    allowLegacyV3: true,
  });
  assert.equal(recoveredV3.ok, true);
  assert.equal(recoveredV3.value.version, 3);

  const legacy = structuredClone(analysis);
  legacy.version = 1;
  delete legacy.products;

  assert.equal(parseProductReplaceAnalysis(JSON.stringify(legacy), {
    expectedBindings: bindings,
  }).ok, false);
  const recovered = parseProductReplaceAnalysis(JSON.stringify(legacy), {
    expectedBindings: bindings,
    allowLegacyV1: true,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.value.version, 1);

  const legacyV2 = structuredClone(analysis);
  legacyV2.version = 2;
  legacyV2.products.forEach((product) => {
    delete product.subjectBoundary;
    delete product.nonProductReferenceArtifacts;
    delete product.exactVisualAnchors;
  });
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(legacyV2), {
    expectedBindings: bindings,
  }).ok, false);
  const recoveredV2 = parseProductReplaceAnalysis(JSON.stringify(legacyV2), {
    expectedBindings: bindings,
    allowLegacyV2: true,
  });
  assert.equal(recoveredV2.ok, true);
  assert.equal(recoveredV2.value.version, 2);
});

test('product replacement analysis parser accepts one provider channel-wrapped JSON object and rejects ambiguous wrappers', () => {
  const wrapped = [
    '先按标记关系核对产品位置、遮挡、光影和材质。',
    'commentary',
    JSON.stringify(detailedExecutionAnalysis),
    'final_answer',
  ].join('\n');

  const parsed = parseProductReplaceAnalysis(wrapped, {
    expectedBindings: bindings,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.generationPrompt.regions.map((region) => region.regionId), [
    'product-replace-region-1',
    'product-replace-region-2',
  ]);

  assert.equal(parseProductReplaceAnalysis([
    wrapped,
    JSON.stringify(detailedExecutionAnalysis),
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    '先按标记关系核对产品位置。',
    JSON.stringify(detailedExecutionAnalysis),
    'final_answer',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    'commentary',
    JSON.stringify(detailedExecutionAnalysis),
    'unexpected_tail',
    'final_answer',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
});

test('product replacement analysis parser accepts provider JSON followed only by final_answer', () => {
  const providerResponse = [
    JSON.stringify(detailedExecutionAnalysis, null, 2),
    'final_answer',
  ].join('\n');

  const parsed = parseProductReplaceAnalysis(providerResponse, {
    expectedBindings: bindings,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.generationPrompt.regions.map((region) => region.productNumber), [1, 2]);

  assert.equal(parseProductReplaceAnalysis([
    JSON.stringify(detailedExecutionAnalysis),
    'unexpected_tail',
    'final_answer',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    JSON.stringify(detailedExecutionAnalysis),
    'final_answer',
    'unexpected_tail',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    JSON.stringify(detailedExecutionAnalysis),
    'final_answer',
    JSON.stringify(detailedExecutionAnalysis),
  ].join('\n'), { expectedBindings: bindings }).ok, false);
});
