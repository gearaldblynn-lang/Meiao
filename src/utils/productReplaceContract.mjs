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

const buildCombinationMapping = (productGroups, regionBindings = []) => {
  if (Array.isArray(regionBindings) && regionBindings.length > 0) {
    return [
      'Image 1 是当前唯一替换参考图和最终构图基底。',
      '当前生图输入不包含产品位置标记图；手工位置真值仅通过下方数值区域合同传递。',
      ...regionBindings.map((binding) => (
        `目标区域 ${binding.productNumber} → 产品${binding.productNumber} → ${binding.targetInputImageIndexes.map((index) => `Image ${index}`).join('、')}`
      )),
      '用户手工标记形成的数值区域是位置真值。映射不得交换、遗漏、融合或新增产品；同组多角度图只能共同约束对应的同一个产品区域。',
    ].join('\n');
  }
  return [
    '组合映射规则：每个产品组必须由用户在当前参考图上完成位置标记。',
    ...productGroups.map((group) => `产品${group.productNumber} → 目标区域 ${group.productNumber}`),
  ].join('\n');
};

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

const buildGenerationRegionContracts = (regionBindings = []) => regionBindings.map((binding) => ({
  targetRegionNumber: Number(binding.productNumber),
  productNumber: Number(binding.productNumber),
  targetInputImageIndexes: Array.isArray(binding.targetInputImageIndexes)
    ? binding.targetInputImageIndexes.map(Number)
    : [],
  xRatio: Number(binding.xRatio),
  yRatio: Number(binding.yRatio),
  widthRatio: Number(binding.widthRatio),
  heightRatio: Number(binding.heightRatio),
}));

const buildGenerationPlanningData = (planningAnalysis, regionBindings) => {
  if (!planningAnalysis || typeof planningAnalysis !== 'object') return null;
  const targetRegionNumberByGroup = new Map(
    regionBindings.map((binding) => [String(binding.productGroupId || ''), Number(binding.productNumber)]),
  );
  const regions = Array.isArray(planningAnalysis.regions)
    ? planningAnalysis.regions.map((region) => ({
        targetRegionNumber: targetRegionNumberByGroup.get(String(region.productGroupId || ''))
          || Number(region.productNumber),
        productNumber: Number(region.productNumber),
        oldProduct: region.oldProduct,
        placement: region.placement,
        scale: region.scale,
        perspective: region.perspective,
        lighting: region.lighting,
        materialInteraction: region.materialInteraction,
        occlusion: region.occlusion,
        contactShadow: region.contactShadow,
      }))
    : [];
  return scrubProductMarkerLabels({
    version: Number(planningAnalysis.version) || 1,
    referenceSummary: planningAnalysis.referenceSummary,
    regions,
    globalConstraints: planningAnalysis.globalConstraints,
  });
};

const joinIdentityDetails = (...values) => values
  .flatMap((value) => (Array.isArray(value) ? value : [value]))
  .map(clean)
  .filter(Boolean)
  .join('；');

const normalizeIdentityStringArray = (value) => (Array.isArray(value)
  ? value.map(clean).filter(Boolean)
  : []);

const resolveGenerationColorPreservation = (explicit, colors) => {
  const source = explicit && typeof explicit === 'object' && !Array.isArray(explicit)
    ? explicit
    : {};
  const componentColorMap = normalizeIdentityStringArray(source.componentColorMap);
  const relativeColorRelationships = normalizeIdentityStringArray(source.relativeColorRelationships);
  const forbiddenColorShifts = normalizeIdentityStringArray(source.forbiddenColorShifts);
  return {
    componentColorMap: componentColorMap.length > 0
      ? componentColorMap
      : [`逐组件直接对照产品输入图保持固有颜色与边界：${colors}`],
    relativeColorRelationships: relativeColorRelationships.length > 0
      ? relativeColorRelationships
      : ['保持产品输入图中各组件之间的相对明暗、饱和度和中性色关系，禁止颜色层级塌缩。'],
    midtoneAndWhiteBalanceRule: clean(source.midtoneAndWhiteBalanceRule)
      || '以排除高光、阴影、反射和拍摄色偏后的产品中间调为颜色真值；场景白平衡不得覆盖产品固有色。',
    forbiddenColorShifts: forbiddenColorShifts.length > 0
      ? forbiddenColorShifts
      : ['禁止色相家族偏移', '禁止饱和度漂移', '禁止中间调明度压缩', '禁止中性色被染成场景色'],
  };
};

const resolveGenerationIdentityLock = (product) => {
  const explicit = product?.identityLock && typeof product.identityLock === 'object'
    ? product.identityLock
    : {};
  const colors = clean(explicit.colors) || clean(product?.colorsAndPatterns);
  const lock = {
    materials: clean(explicit.materials) || clean(product?.materialsAndFinish),
    details: clean(explicit.details) || joinIdentityDetails(
      product?.exactVisualAnchors,
      product?.invariantDetails,
      product?.visiblePackagingText,
    ),
    colors,
    colorPreservation: resolveGenerationColorPreservation(explicit.colorPreservation, colors),
    patterns: clean(explicit.patterns) || joinIdentityDetails(
      product?.colorsAndPatterns,
      product?.logosAndGraphics,
    ),
    structure: clean(explicit.structure) || joinIdentityDetails(
      product?.silhouetteAndProportions,
      product?.structureAndAccessories,
    ),
    forbiddenChanges: Array.isArray(explicit.forbiddenChanges) && explicit.forbiddenChanges.length > 0
      ? explicit.forbiddenChanges.map(clean).filter(Boolean)
      : (Array.isArray(product?.invariantDetails)
          ? product.invariantDetails.map(clean).filter(Boolean)
          : []),
  };
  if (
    !lock.materials
    || !lock.details
    || !lock.colors
    || !lock.patterns
    || !lock.structure
    || lock.forbiddenChanges.length === 0
  ) return null;
  return lock;
};

const buildGenerationProductIdentityLocks = (planningAnalysis, productGroups, regionBindings) => {
  if (!Array.isArray(planningAnalysis?.products) || planningAnalysis.products.length === 0) return [];
  const inputIndexesByGroup = new Map(
    productGroups.map((group) => [String(group.id || ''), group.inputImageIndexes || []]),
  );
  const targetRegionNumberByGroup = new Map(
    regionBindings.map((binding) => [String(binding.productGroupId || ''), Number(binding.productNumber)]),
  );
  return scrubProductMarkerLabels(planningAnalysis.products.map((product) => {
    const identityLock = resolveGenerationIdentityLock(product);
    if (!identityLock) return null;
    const productGroupId = String(product.productGroupId || '');
    return {
      targetRegionNumber: targetRegionNumberByGroup.get(productGroupId) || Number(product.productNumber),
      productNumber: Number(product.productNumber),
      targetInputImageIndexes: inputIndexesByGroup.get(productGroupId)
        || product.targetInputImageIndexes
        || [],
      sourceOfTruth: '对应 targetInputImageIndexes 的产品输入图像素',
      ...(clean(product.subjectBoundary)
        ? { physicalProductBoundary: clean(product.subjectBoundary) }
        : {}),
      ...(clean(product.visiblePackagingText)
        ? { visiblePackagingText: clean(product.visiblePackagingText) }
        : {}),
      ...(clean(product.logosAndGraphics)
        ? { logosAndGraphics: clean(product.logosAndGraphics) }
        : {}),
      ...(Array.isArray(product.exactVisualAnchors) && product.exactVisualAnchors.length > 0
        ? { visualAnchors: product.exactVisualAnchors.map(clean).filter(Boolean) }
        : {}),
      ...(Array.isArray(product.invariantDetails) && product.invariantDetails.length > 0
        ? { invariantDetails: product.invariantDetails.map(clean).filter(Boolean) }
        : {}),
      ...(Array.isArray(product.nonProductReferenceArtifacts) && product.nonProductReferenceArtifacts.length > 0
        ? { excludedReferenceArtifacts: product.nonProductReferenceArtifacts.map(clean).filter(Boolean) }
        : {}),
      ...identityLock,
    };
  }).filter(Boolean));
};

const buildGenerationProductColorFidelityLocks = (productIdentityLocks) => productIdentityLocks.map((lock) => ({
  targetRegionNumber: lock.targetRegionNumber,
  productNumber: lock.productNumber,
  targetInputImageIndexes: lock.targetInputImageIndexes,
  sourceOfTruth: lock.sourceOfTruth,
  intrinsicColors: lock.colors,
  ...lock.colorPreservation,
}));

const buildGenerationProductNonColorIdentityLocks = (productIdentityLocks) => productIdentityLocks.map((lock) => {
  const { colors: _colors, colorPreservation: _colorPreservation, ...identityLock } = lock;
  return identityLock;
});

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
  const productManifest = buildProductManifest(productGroups, { includeUrls: !isCombination });
  const mapping = isCombination
    ? buildCombinationMapping(productGroups, regionBindings)
    : '单品映射规则：全部产品素材共同描述产品1；只替换参考图中的目标单品，不按素材图数量拆成多个产品或多个结果。';
  const generationRegionContracts = isCombination
    ? buildGenerationRegionContracts(regionBindings)
    : [];
  const generationPlanningData = isCombination
    ? buildGenerationPlanningData(planningAnalysis, regionBindings)
    : planningAnalysis;
  const productIdentitySourceLocks = isCombination
    ? buildGenerationProductIdentityLocks(planningAnalysis, productGroups, regionBindings)
    : [];
  const productColorFidelityLocks = buildGenerationProductColorFidelityLocks(productIdentitySourceLocks);
  const productIdentityLocks = buildGenerationProductNonColorIdentityLocks(productIdentitySourceLocks);
  const logoTask = validLogo
    ? `\nLogo 原图：${validLogo.url}\nLogo 位置示意图：${validLogo.placementGuideUrl}\n按 Logo 位置示意图植入上传 Logo；示意图只提供相对位置、面积、方向和比例（${validLogo.placementRatio}）。`
    : '';
  const logoConstraints = validLogo
    ? [
        '7. Logo 原图是新增品牌标识的唯一形状、颜色和细节依据；若参考图中已有非产品旧 Logo、角标、水印或品牌标识，先移除再植入上传 Logo。',
        '8. Logo 位置示意图不是背景或成图内容，不得生成其中的边框、辅助线、底色、选区框或标记。',
      ]
    : [];

  const prompt = [
    [
      'R Role 角色',
      '你是电商视觉产品替换执行模型。你的职责是准确保留上传产品的身份和可见细节，并把它们自然替换到当前唯一参考图中。',
    ].join('\n'),
    [
      'T Task 任务',
      `产品素材清单：\n${productManifest || '未提供有效产品素材'}`,
      `当前唯一替换参考图：${isCombination ? 'Image 1' : clean(referenceUrl)}`,
      mapping,
      generationRegionContracts.length > 0 ? [
        '以下归一化坐标均相对于 Image 1 左上角，范围为 0 到 1；xRatio/yRatio 是区域左上角，widthRatio/heightRatio 是区域宽高。必须按数值区域放置对应产品，不得自行交换或重新定位：',
        serializePromptData('product_replace_target_regions', generationRegionContracts),
      ].join('\n') : '',
      productColorFidelityLocks.length > 0 ? [
        '以下是逐产品颜色保真硬合同，优先级高于参考图色温、场景氛围、滤镜、统一调色、明暗风格和自然融合；每项必须直接对照绑定产品输入图的可见像素执行：',
        serializePromptData('product_color_fidelity_contract', productColorFidelityLocks),
        '产品中间调必须与产品素材图保持同一明度层级、色相家族和相对饱和度。中灰不得因暗场景变成深灰或黑色，白色不得染成环境色，彩色不得整体偏冷、偏暖、褪色或增艳。',
        '禁止对产品区域应用全局 LUT、滤镜、统一色调或整体压暗；场景调色只能作用于背景和环境。产品只允许出现物理合理的局部高光、局部阴影和局部反射色，不能让这些影响吞掉主体中间调。',
      ].join('\n') : '',
      productIdentityLocks.length > 0 ? [
        '以下是逐产品、逐区域绑定的非颜色身份硬合同，与上方同 productNumber 的颜色合同共同构成五维产品身份；优先级高于构图适配、光影美化和其他描述：',
        serializePromptData('product_identity_lock_contract', productIdentityLocks),
        '材质、可识别细节、产品自身 Logo 与图形拓扑、图案、结构、实体边界、视觉锚点和具体不可变细节均不可改；禁止通用化、重新设计、删细节或带入 excludedReferenceArtifacts。',
      ].join('\n') : '',
      generationPlanningData ? [
        '以下策划数据只描述当前参考图的尺度、透视、光线、材质互动、遮挡、接触面和阴影；不包含、也不能覆盖产品身份与颜色合同：',
        serializePromptData('product_replace_planning_data', generationPlanningData),
      ].join('\n') : '',
      '移除参考图中被替换区域内的原产品、原品牌、原包装信息和原产品轮廓，再把对应目标产品自然放入同一空间关系。',
      validLogo ? logoTask.trim() : '',
      `当前生成第 ${Number(batchIndex) || 1}/${Number(batchCount) || 1} 张。`,
    ].filter(Boolean).join('\n'),
    [
      'C Constraint 约束',
      '1. 产品输入图是产品身份的最高优先级依据。必须直接观察对应输入图像素；策划文字只能帮助定位和理解，不能替代、概括或覆盖图像中的真实产品。',
      '2. 五维产品身份硬锁定由 product_identity_lock_contract 中的材质、细节、图案、结构，与 product_color_fidelity_contract 中的固有颜色共同构成；不得把具体产品概括成同类通用产品或重新设计。',
      '3. 环境光只能形成物理合理的局部高光、局部阴影和局部反射，不能改变产品主体中间调的色相、明度层级、饱和度、灰阶关系、颜色分区、材质种类或表面工艺。暗场景中也必须保留产品原有颜色的可辨识度，不能把中灰压成深灰或黑色；透视只能改变二维投影，不能改变真实轮廓比例、组件几何、装配关系和相对位置。',
      '4. 产品实体边界、纹理、配件、产品自身 Logo、标签边界、包装文字、图案、接口、接缝和所有可见细节必须与对应产品输入图一致，禁止模糊、省略、增添、融合或互换。',
      '5. excludedReferenceArtifacts 中列出的背景、卡片、说明标题、技术编号、定位徽标、箭头或色块都属于非产品参考元素；非产品参考元素不得进入最终图，只有物理附着在产品本体或包装上的内容才属于产品身份。',
      '6. 不得把参考图中原产品的品牌、结构、包装、标签、文字或图案迁移到目标产品。',
      '7. 产品必须真实融入画面；透视、遮挡、接触阴影、材质反光、边缘融合和景深关系要自然，不能像简单贴图，但自然融合不能覆盖产品身份锁定。禁止对产品蒙版应用参考图的全局 LUT、滤镜、统一色温、统一饱和度或统一曝光；需要暗场氛围时，应通过背景曝光和产品周围光影建立氛围，同时保护产品主体中间调。',
      `8. 参考强度：${buildReferenceStrengthConstraint(referenceStrength, Boolean(validLogo))}`,
      `9. 文案处理：${buildTextPolicyConstraint(textPolicy)}`,
      '10. 当前任务只使用这一张替换参考图，不得混入批次中其他参考图的构图、产品、人物或场景。若产品准确性与参考效果冲突，优先保证产品准确。',
      '11. 用户补充要求不能重新定义产品颜色、材质、结构、组件、数量或产品组映射；与产品输入图或颜色保真合同冲突的旧描述必须忽略，只执行其中不冲突的场景、构图、文案处理和禁区要求。',
      regionBindings.length > 0 ? '12. 当前生图输入没有位置标记图。只能读取数值区域合同定位，最终图不得生成任何技术编号、区域框、虚线、色块或定位标记。' : '',
      ...logoConstraints,
      clean(userPrompt) ? `用户补充要求：${replaceProductMarkerLabels(userPrompt)}` : '',
    ].filter(Boolean).join('\n'),
    [
      'F Format 格式',
      `输出一张干净完整的商业效果图，画面比例为 ${clean(aspectRatio) || 'auto'}。`,
      '只输出最终图像，不输出分析文字、辅助线、边框、选区框、蒙版、技术编号、定位标记或对比图。',
      '画面自然、清晰、材质统一，避免噪点、伪影、畸变、破碎纹理、过度锐化和不自然贴图感。',
    ].join('\n'),
    [
      'E Example 示例',
      isCombination
        ? '示例：目标区域 1 绑定产品1的正面图和侧面图，目标区域 2 绑定产品2的包装图；最终图严格按数值区域完成替换，同组图片只补充同一产品细节。'
        : '示例：同一瓶装产品提供正面图和标签细节图；最终图只生成一个瓶装产品，并同时保持瓶身结构和标签细节准确。',
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
