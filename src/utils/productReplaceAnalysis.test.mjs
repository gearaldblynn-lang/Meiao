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

test('product replacement analysis prompt uses ordered image roles and a strict RTCFE JSON contract', () => {
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
  assert.match(prompt, /regions 必须恰好包含 2 项/);
  assert.match(prompt, /"products"/);
  assert.match(prompt, /"silhouetteAndProportions"/);
  assert.match(prompt, /"visiblePackagingText"/);
  assert.match(prompt, /"subjectBoundary"/);
  assert.match(prompt, /"nonProductReferenceArtifacts"/);
  assert.match(prompt, /"exactVisualAnchors"/);
  assert.match(prompt, /"identityLock"/);
  for (const field of ['materials', 'details', 'colors', 'patterns', 'structure', 'forbiddenChanges']) {
    assert.match(prompt, new RegExp(`"${field}"`));
  }
  assert.match(prompt, /五维产品身份锁定/);
  assert.match(prompt, /逐组件颜色地图/);
  assert.match(prompt, /中间调与白平衡/);
  assert.match(prompt, /禁止把场景色温、滤镜或全局调色写入产品固有色/);
  assert.match(prompt, /用户要求若与绑定产品素材的颜色、材质、结构或数量冲突，必须忽略冲突部分/);
  assert.match(prompt, /只有物理附着在产品本体或包装上的文字/);
  assert.match(prompt, /技术编号、定位徽标、箭头、说明标题/);
  assert.match(prompt, /identityLock 是产品身份的唯一权威详细记录/);
  assert.match(prompt, /generationInstruction 只写当前区域的局部例外/);
  assert.match(prompt, /不重述产品身份或其他字段/);
  assert.match(prompt, /identityLock 中每个文本字段最多两个短句/);
  assert.match(prompt, /regions 中 placement、scale、perspective/);
  assert.match(prompt, /"xRatio": 0\.12/);
});

test('product replacement analysis parser requires v5 color-fidelity locks and rejects swapped or incomplete mappings', () => {
  const parsed = parseProductReplaceAnalysis(JSON.stringify(analysis), {
    expectedBindings: bindings,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.regions.map((region) => region.productGroupId), ['group-a', 'group-b']);
  assert.deepEqual(parsed.value.products.map((product) => product.productGroupId), ['group-a', 'group-b']);

  const swapped = structuredClone(analysis);
  swapped.regions[0].productGroupId = 'group-b';
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(swapped), {
    expectedBindings: bindings,
  }).ok, false);

  const incomplete = structuredClone(analysis);
  incomplete.regions.pop();
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(incomplete), {
    expectedBindings: bindings,
  }).ok, false);

  const missingIdentity = structuredClone(analysis);
  delete missingIdentity.products[0].visiblePackagingText;
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(missingIdentity), {
    expectedBindings: bindings,
  }).ok, false);

  const missingBoundary = structuredClone(analysis);
  delete missingBoundary.products[0].subjectBoundary;
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(missingBoundary), {
    expectedBindings: bindings,
  }).ok, false);

  const missingExclusions = structuredClone(analysis);
  delete missingExclusions.products[0].nonProductReferenceArtifacts;
  assert.equal(parseProductReplaceAnalysis(JSON.stringify(missingExclusions), {
    expectedBindings: bindings,
  }).ok, false);

  for (const field of ['materials', 'details', 'colors', 'patterns', 'structure', 'forbiddenChanges']) {
    const missingLockField = structuredClone(analysis);
    delete missingLockField.products[0].identityLock[field];
    assert.equal(parseProductReplaceAnalysis(JSON.stringify(missingLockField), {
      expectedBindings: bindings,
    }).ok, false, `missing identity lock field should fail: ${field}`);
  }
  for (const field of ['componentColorMap', 'relativeColorRelationships', 'midtoneAndWhiteBalanceRule', 'forbiddenColorShifts']) {
    const missingColorField = structuredClone(analysis);
    delete missingColorField.products[0].identityLock.colorPreservation[field];
    assert.equal(parseProductReplaceAnalysis(JSON.stringify(missingColorField), {
      expectedBindings: bindings,
    }).ok, false, `missing color preservation field should fail: ${field}`);
  }
});

test('new product replacement analysis rejects v1 through v4 while explicit recovery accepts them read-only', () => {
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
    JSON.stringify(analysis),
    'final_answer',
  ].join('\n');

  const parsed = parseProductReplaceAnalysis(wrapped, {
    expectedBindings: bindings,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.regions.map((region) => region.regionId), [
    'product-replace-region-1',
    'product-replace-region-2',
  ]);

  assert.equal(parseProductReplaceAnalysis([
    wrapped,
    JSON.stringify(analysis),
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    '先按标记关系核对产品位置。',
    JSON.stringify(analysis),
    'final_answer',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    'commentary',
    JSON.stringify(analysis),
    'unexpected_tail',
    'final_answer',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
});

test('product replacement analysis parser accepts provider JSON followed only by final_answer', () => {
  const providerResponse = [
    JSON.stringify(analysis, null, 2),
    'final_answer',
  ].join('\n');

  const parsed = parseProductReplaceAnalysis(providerResponse, {
    expectedBindings: bindings,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.products.map((product) => product.productNumber), [1, 2]);

  assert.equal(parseProductReplaceAnalysis([
    JSON.stringify(analysis),
    'unexpected_tail',
    'final_answer',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    JSON.stringify(analysis),
    'final_answer',
    'unexpected_tail',
  ].join('\n'), { expectedBindings: bindings }).ok, false);
  assert.equal(parseProductReplaceAnalysis([
    JSON.stringify(analysis),
    'final_answer',
    JSON.stringify(analysis),
  ].join('\n'), { expectedBindings: bindings }).ok, false);
});
