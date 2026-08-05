import { getImageModelCapabilities } from './modelCapabilities.mjs';

export const PRODUCT_REPLACE_MAX_REFERENCE_IMAGES = 40;
export const PRODUCT_REPLACE_DEFAULT_SUBMISSION_CONCURRENCY = 3;

const DEFAULT_PRODUCT_REPLACE_GENERATION_PROMPT_MAX_CHARS = 18_000;

const getProductReplaceGenerationPromptMaxChars = () => {
  const configured = Number(import.meta.env?.VITE_MEIAO_PRODUCT_REPLACE_GENERATION_PROMPT_MAX_CHARS);
  return Number.isFinite(configured) && configured >= 8_000
    ? Math.floor(configured)
    : DEFAULT_PRODUCT_REPLACE_GENERATION_PROMPT_MAX_CHARS;
};

const clean = (value) => String(value || '').trim();

export const normalizeProductReplacementLogic = (value) => {
  const normalized = clean(value);
  return normalized === 'combination_replace' || normalized.includes('组合')
    ? 'combination_replace'
    : 'single_replace';
};

const getModelLabel = (model) => {
  const normalized = clean(model).toLowerCase();
  if (normalized === 'nano-banana-2' || normalized.includes('nano') || normalized.includes('banana')) {
    return 'Nano Banana 2';
  }
  if (normalized === 'gpt-image-2-secondary' || normalized.includes('secondary') || normalized.includes('副')) {
    return 'GPT Image 2 副通道';
  }
  if (normalized === 'gpt-image-2' || normalized.includes('gpt')) return 'GPT Image 2';
  return clean(model) || '当前模型';
};

export const assertProductReplaceReferenceCount = (count) => {
  const normalized = Math.max(0, Math.floor(Number(count) || 0));
  if (normalized > PRODUCT_REPLACE_MAX_REFERENCE_IMAGES) {
    throw new Error(`替换参考图最多 ${PRODUCT_REPLACE_MAX_REFERENCE_IMAGES} 张，当前为 ${normalized} 张。请删除多余参考图后再生成。`);
  }
  return normalized;
};

export const assertProductReplaceInputBudget = ({
  model,
  productImageCount,
  hasLogo = false,
  hasLocationGuide = false,
}) => {
  const normalizedProductImageCount = Math.max(0, Math.floor(Number(productImageCount) || 0));
  const maxInputImages = Math.max(1, Number(getImageModelCapabilities(clean(model)).maxInputImages) || 1);
  const reservedInputCount = 1 + (hasLocationGuide ? 1 : 0) + (hasLogo ? 2 : 0);
  const inputImageCount = normalizedProductImageCount + reservedInputCount;
  if (inputImageCount > maxInputImages) {
    const locationGuideDetail = hasLocationGuide ? '、1 张产品位置标记图' : '';
    const logoDetail = hasLogo ? '、1 张 Logo 原图和 1 张 Logo 位置示意图' : '';
    throw new Error(
      `${getModelLabel(model)} 最多 ${maxInputImages} 张输入图，当前需要 ${inputImageCount} 张`
      + `（${normalizedProductImageCount} 张产品图、1 张替换参考图${locationGuideDetail}${logoDetail}）。请减少产品图、移除 Logo，或切换支持更多输入图的模型。`,
    );
  }
  return {
    maxInputImages,
    inputImageCount,
    productImageCount: normalizedProductImageCount,
    reservedInputCount,
  };
};

export const compileProductReplaceGroups = (materials = [], isCombination = false) => {
  const validMaterials = materials
    .map((material, index) => ({
      id: clean(material?.id) || `product-material-${index + 1}`,
      url: clean(material?.url),
      productGroupId: clean(material?.productGroupId),
      sourceIndex: index,
    }))
    .filter((material) => material.url);

  if (!isCombination) {
    if (validMaterials.length === 0) return [];
    return [{
      id: 'single-product',
      productNumber: 1,
      materialIds: validMaterials.map((material) => material.id),
      urls: validMaterials.map((material) => material.url),
    }];
  }

  const groupById = new Map();
  validMaterials.forEach((material) => {
    const groupId = material.productGroupId || `material:${material.sourceIndex + 1}:${material.id}`;
    const existing = groupById.get(groupId);
    if (existing) {
      existing.materialIds.push(material.id);
      existing.urls.push(material.url);
      return;
    }
    groupById.set(groupId, {
      id: groupId,
      productNumber: groupById.size + 1,
      materialIds: [material.id],
      urls: [material.url],
    });
  });
  return Array.from(groupById.values());
};

const buildProductManifest = (productGroups, { includeUrls = true } = {}) => productGroups
  .map((group) => (
    `产品${group.productNumber}：${includeUrls ? group.urls.join('、') : ''}\n`
    + `${Array.isArray(group.inputImageIndexes) && group.inputImageIndexes.length > 0
      ? `输入图编号：${group.inputImageIndexes.map((index) => `Image ${index}`).join('、')}\n`
      : ''}`
    + `用途：产品${group.productNumber}的唯一外观依据；同组图片是同一产品的多角度、细节或包装补充，不代表多个产品。`
  ))
  .join('\n');

const serializePromptData = (tagName, value) => [
  `<${tagName}>`,
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e'),
  `</${tagName}>`,
].join('\n');

const replaceProductMarkerLabels = (value) => (
  clean(value).replace(/\bP[\s_-]*(\d+)\b/gi, '目标区域 $1')
);

const scrubProductMarkerLabels = (value) => {
  if (typeof value === 'string') return replaceProductMarkerLabels(value);
  if (Array.isArray(value)) return value.map(scrubProductMarkerLabels);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, scrubProductMarkerLabels(entry)]),
  );
};

const compactRatio = (value) => Number(Number(value).toFixed(4));

const buildGenerationExecutionContract = (planningAnalysis, productGroups, regionBindings) => {
  const inputIndexesByGroupId = new Map(
    productGroups.map((group) => [String(group.id || ''), group.inputImageIndexes || []]),
  );
  if (planningAnalysis?.version === 7 && planningAnalysis?.generationPrompt) {
    const plannedProductsByGroupId = new Map(
      (Array.isArray(planningAnalysis.generationPrompt.products)
        ? planningAnalysis.generationPrompt.products
        : []).map((product) => [String(product?.productGroupId || ''), product]),
    );
    const plannedRegionsByGroupId = new Map(
      (Array.isArray(planningAnalysis.generationPrompt.regions)
        ? planningAnalysis.generationPrompt.regions
        : []).map((region) => [String(region?.productGroupId || ''), region]),
    );
    const products = [];
    const regions = [];
    regionBindings.forEach((binding) => {
      const groupId = String(binding.productGroupId || '');
      const plannedProduct = plannedProductsByGroupId.get(groupId);
      const plannedRegion = plannedRegionsByGroupId.get(groupId);
      if (!plannedProduct || !plannedRegion) return;
      const groupInputIndexes = inputIndexesByGroupId.get(groupId);
      const productInputImages = Array.isArray(groupInputIndexes) && groupInputIndexes.length > 0
        ? groupInputIndexes
        : binding.targetInputImageIndexes || [];
      products.push({
        productNumber: Number(binding.productNumber),
        productInputImages,
        identity: plannedProduct.identity,
      });
      regions.push({
        productNumber: Number(binding.productNumber),
        targetRegion: {
          xRatio: compactRatio(binding.xRatio),
          yRatio: compactRatio(binding.yRatio),
          widthRatio: compactRatio(binding.widthRatio),
          heightRatio: compactRatio(binding.heightRatio),
        },
        requiredVisibleStructure: plannedRegion.requiredVisibleStructure,
        placement: plannedRegion.placement,
        perspective: plannedRegion.perspective,
        geometryAdaptation: plannedRegion.geometryAdaptation,
        lightingAndColorIntegration: plannedRegion.lightingAndColorIntegration,
        materialInteraction: plannedRegion.materialInteraction,
        occlusion: plannedRegion.occlusion,
        contactShadow: plannedRegion.contactShadow,
        oldProductRemoval: plannedRegion.oldProductRemoval,
      });
    });
    if (products.length !== regionBindings.length || regions.length !== regionBindings.length) {
      throw new Error('产品替换策划与当前产品区域绑定不一致，请重新策划。');
    }
    return scrubProductMarkerLabels({
      products,
      regions,
      scenePreservation: planningAnalysis.generationPrompt.scenePreservation,
      negativeConstraints: planningAnalysis.generationPrompt.negativeConstraints,
    });
  }
  const planByGroupId = new Map(
    (Array.isArray(planningAnalysis?.regions) ? planningAnalysis.regions : [])
      .map((region) => [String(region?.productGroupId || ''), region]),
  );
  return scrubProductMarkerLabels(regionBindings.map((binding) => {
    const groupId = String(binding.productGroupId || '');
    const plan = planByGroupId.get(groupId) || {};
    const groupInputIndexes = inputIndexesByGroupId.get(groupId);
    return {
      productNumber: Number(binding.productNumber),
      productInputImages: Array.isArray(groupInputIndexes) && groupInputIndexes.length > 0
        ? groupInputIndexes
        : binding.targetInputImageIndexes || [],
      targetRegion: {
        xRatio: compactRatio(binding.xRatio),
        yRatio: compactRatio(binding.yRatio),
        widthRatio: compactRatio(binding.widthRatio),
        heightRatio: compactRatio(binding.heightRatio),
      },
      ...(clean(plan.placement) ? { placement: clean(plan.placement) } : {}),
      ...(clean(plan.perspective) ? { perspective: clean(plan.perspective) } : {}),
      ...(clean(plan.materialInteraction) ? { materialInteraction: clean(plan.materialInteraction) } : {}),
      ...(clean(plan.occlusion) ? { occlusion: clean(plan.occlusion) } : {}),
      ...(clean(plan.contactShadow) ? { contactShadow: clean(plan.contactShadow) } : {}),
    };
  }));
};

const buildReferenceStrengthConstraint = (referenceStrength, hasLogo = false) => {
  if (referenceStrength === 'person_adjust') {
    return '人物微调：保持参考图的场景、构图、动作、光影、景别和商业拍摄质感；若有人物，必须重绘为不同人物，脸型、五官、发型轮廓和可识别特征应有明确变化。';
  }
  if (referenceStrength === 'global_adjust') {
    return '全局微调：保持参考图的大致构图、主题、信息层级和商业风格；人物、场景、动作和局部细节允许轻微变化。';
  }
  return hasLogo
    ? '完全复刻：除待替换产品和指定 Logo 外，参考图中的场景、构图、人物、动作、光影和整体风格尽量保持一致。'
    : '完全复刻：除待替换产品外，参考图中的场景、构图、人物、动作、光影和整体风格尽量保持一致。';
};

const buildTextPolicyConstraint = (textPolicy) => (
  textPolicy === 'remove_text'
    ? '去除文案：去除参考图中的非产品宣传文案并自然修复背景；不得影响目标产品自身的 Logo、标签、包装文字或图案。'
    : '维持文案：参考图中的非产品宣传文案保持内容、语言、位置、字号层级和排版关系不变。'
);

/**
 * @param {{
 *   productGroups?: Array<Record<string, any>>,
 *   referenceUrl?: string,
 *   userPrompt?: string,
 *   referenceStrength?: string,
 *   textPolicy?: string,
 *   aspectRatio?: string,
 *   batchIndex?: number,
 *   batchCount?: number,
 *   isCombination?: boolean,
 *   logo?: Record<string, any>,
 *   regionBindings?: Array<Record<string, any>>,
 *   planningAnalysis?: Record<string, any>,
 * }} [input]
 */
export const buildProductReplacePrompt = ({
  productGroups = [],
  referenceUrl,
  userPrompt,
  referenceStrength,
  textPolicy,
  aspectRatio,
  batchIndex,
  batchCount,
  isCombination = false,
  logo,
  regionBindings = [],
  planningAnalysis,
} = {}) => {
  const validLogo = clean(logo?.url) && clean(logo?.placementGuideUrl)
    ? {
        url: clean(logo.url),
        placementGuideUrl: clean(logo.placementGuideUrl),
        placementRatio: clean(logo.placementRatio) || '相近比例',
      }
    : null;
  const productImageCount = productGroups.reduce((total, group) => total + (group.urls?.length || 0), 0);
  const referenceImageIndex = isCombination ? 1 : productImageCount + 1;
  const mapping = isCombination
    ? 'Image 1 是当前唯一替换参考图和最终构图基底；产品素材与目标区域的对应关系只以下方执行合同为准。当前生图输入不包含产品位置标记图。'
    : `Image 1 至 Image ${productImageCount} 共同描述产品1；Image ${referenceImageIndex} 是唯一待替换参考图。多张产品图只补充同一产品的角度和细节，不代表多个产品。`;
  const generationExecutionContract = isCombination
    ? buildGenerationExecutionContract(planningAnalysis, productGroups, regionBindings)
    : null;
  const logoImageIndex = isCombination ? productImageCount + 2 : referenceImageIndex + 1;
  const logoTask = validLogo
    ? `Image ${logoImageIndex} 是 Logo 原图；Image ${logoImageIndex + 1} 是 Logo 位置示意图，只提供位置、方向和比例（${validLogo.placementRatio}）。`
    : '';
  const logoConstraints = validLogo
    ? [
        'Logo 原图是新标识形状、颜色和细节的唯一依据；先移除旧标识再植入。',
        'Logo 位置示意图不得进入成图，包括边框、辅助线、底色、选区框和标记。',
      ]
    : [];

  const prompt = [
    [
      'R Role 角色',
      '你是精准的电商产品换图模型：保留产品身份，只在指定区域完成自然替换。',
    ].join('\n'),
    [
      'T Task 任务',
      mapping,
      generationExecutionContract && (
        Array.isArray(generationExecutionContract)
          ? generationExecutionContract.length > 0
          : generationExecutionContract.regions?.length > 0
      ) ? [
        '归一化坐标相对 Image 1 左上角。以下是策划模型基于当前产品素材与参考图生成的本图专用执行提示；产品图片仍是产品身份的最高真值：',
        serializePromptData('product_replace_execution_contract', generationExecutionContract),
      ].join('\n') : '',
      '移除目标区域内原产品及原品牌信息，放入绑定产品并保持原空间关系。',
      validLogo ? logoTask.trim() : '',
      `当前生成第 ${Number(batchIndex) || 1}/${Number(batchCount) || 1} 张。`,
    ].filter(Boolean).join('\n'),
    [
      'C Constraint 约束',
      '1. 产品输入图是产品身份的最高优先级依据。必须直接观察对应输入图像素；策划文字只能帮助定位和理解，不能替代、概括或覆盖图像中的真实产品。',
      '2. 五维产品身份硬锁定：材质、可识别细节、固有颜色、图案、结构，以及 Logo、文字、实体边界和视觉锚点均不得重新设计、删减或互换；不得把具体产品概括成同类通用产品。',
      '3. 产品中间调必须与产品素材图保持同一明度层级、色相和相对饱和度；不能把中灰压成深灰或黑色。禁止对产品区域应用全局 LUT、滤镜、统一色调或整体压暗；只允许物理合理的局部高光、阴影和反射。',
      '4. 不得将原产品的品牌、包装、文字或图案迁移到目标产品；产品素材中的背景、卡片、技术编号、箭头和说明文字不得进入最终图。',
      '5. 透视、遮挡、接触阴影、材质反光和边缘融合必须自然；自然融合不得覆盖产品身份。',
      `6. 参考强度：${buildReferenceStrengthConstraint(referenceStrength, Boolean(validLogo))}`,
      `7. 文案处理：${buildTextPolicyConstraint(textPolicy)}`,
      '8. 当前任务只使用这一张参考图；若产品准确性与参考效果冲突，优先产品准确。用户补充要求不能重新定义产品颜色、材质、结构、组件、数量或产品组映射；与产品输入图或合同冲突的旧描述必须忽略。',
      regionBindings.length > 0 ? '9. 生图输入不含位置标记图；只读取数值区域，不得生成编号、区域框、虚线、色块或标记。' : '',
      ...logoConstraints,
      clean(userPrompt) ? `用户补充要求：${replaceProductMarkerLabels(userPrompt)}` : '',
    ].filter(Boolean).join('\n'),
    [
      'F Format 格式',
      `只输出一张 ${clean(aspectRatio) || 'auto'} 的干净商业成图；不输出文字解释、辅助线、选区、蒙版、标记或对比图。`,
    ].join('\n'),
    [
      'E Example 示例',
      isCombination
        ? '产品1的多角度图共同约束同一区域，不生成多个产品。'
        : '多张产品图共同描述同一产品1，只替换参考图中的目标单品。',
    ].join('\n'),
  ].join('\n\n');
  const maxPromptChars = getProductReplaceGenerationPromptMaxChars();
  if (prompt.length > maxPromptChars) {
    throw Object.assign(new Error(`产品替换生图提示词超过 ${maxPromptChars} 字符限制，已在付费生图前停止。`), {
      code: 'product_replace_generation_prompt_too_long',
      promptLength: prompt.length,
      maxPromptChars,
    });
  }
  return prompt;
};

export const buildProductReplaceEditPrompt = ({
  mode = 'preserve_product',
  previousResultUrl,
  editInstruction,
  productGroups = [],
}) => {
  const isFreeEdit = mode === 'free_edit';
  const instruction = clean(editInstruction) || '按用户输入要求修改当前结果图。';
  const resultUrl = clean(previousResultUrl) || '当前产出的结果图';
  const productManifest = buildProductManifest(productGroups);

  return [
    [
      'R Role 角色',
      isFreeEdit
        ? '你是电商视觉自由编辑模型，负责直接修改当前生成结果。'
        : '你是电商视觉产品保护编辑模型，负责修改当前生成结果中的非产品内容，同时严格保持目标产品身份。',
    ].join('\n'),
    [
      'T Task 任务',
      `当前结果图：${resultUrl}`,
      isFreeEdit ? '当前结果图是唯一图片依据。' : `产品素材清单：\n${productManifest || '沿用当前结果图中的目标产品'}`,
      `修改要求：${instruction}`,
    ].join('\n'),
    [
      'C Constraint 约束',
      isFreeEdit
        ? '1. 原产品替换任务的产品锁定不再生效，允许修改产品本身；但只执行用户明确提出的修改，不主动改变未提及区域。'
        : '1. 产品硬锁定：产品外观、轮廓、结构、比例、颜色、材质、纹理、配件、包装文字、标签、Logo、图案、位置和数量必须与产品素材及当前结果保持一致。',
      isFreeEdit
        ? '2. 保持未被用户点名的主体、构图和画面区域稳定，确保修改边缘、光影和材质自然。'
        : '2. 只允许修改用户明确指定的非产品内容；不得换产品、改包装、改产品文字、改变产品数量或用当前结果中的生成误差覆盖产品素材真值。',
      '3. 不得输出分析文字、辅助线、蒙版、边框或对比图。',
    ].join('\n'),
    [
      'F Format 格式',
      '输出一张修改完成的干净商业效果图，沿用当前结果图的尺寸和画面比例，只输出最终图像。',
    ].join('\n'),
    [
      'E Example 示例',
      isFreeEdit
        ? '示例：用户要求把产品改成蓝色时，可以修改产品颜色，其余未提及的背景、构图和文字保持稳定。'
        : '示例：用户要求把背景改成浴室时，只重建背景并校准光影，产品包装、Logo、颜色、结构、位置和数量保持不变。',
    ].join('\n'),
  ].join('\n\n');
};

export const resolveProductReplaceSubmissionConcurrency = (
  value,
  fallback = PRODUCT_REPLACE_DEFAULT_SUBMISSION_CONCURRENCY,
) => {
  const parsed = Math.floor(Number(value));
  const normalizedFallback = Math.max(1, Math.min(6, Math.floor(Number(fallback) || 1)));
  if (!Number.isFinite(parsed) || parsed < 1) return normalizedFallback;
  return Math.max(1, Math.min(6, parsed));
};

export const mapProductReplaceWithConcurrency = async (items = [], concurrency, worker) => {
  if (typeof worker !== 'function') throw new TypeError('product replacement worker is required');
  if (items.length === 0) return [];
  const results = new Array(items.length);
  const workerCount = Math.min(items.length, resolveProductReplaceSubmissionConcurrency(concurrency));
  let nextIndex = 0;

  const runLane = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => runLane()));
  return results;
};
