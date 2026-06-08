import { resolvePublicAssetUrl } from '../../utils/modelAssetUrl.mjs';

export const appendOneClickCopyGuardrails = (prompt: string, language: string | null | undefined, platform?: string | null) => {
  const targetLanguage = String(language || 'English').trim() || 'English';
  const targetPlatform = String(platform || '').trim();
  let nextPrompt = prompt;

  nextPrompt += `\n\n【文案渲染规则】画面文案语言：${targetLanguage}，逐字渲染当前方案中的文案内容，禁止翻译或替换语言。`;
  if (targetPlatform) {
    nextPrompt += `\n投放平台：${targetPlatform}，画面文字表达、信息密度和移动端可读性必须符合该平台的电商主图展示习惯。`;
  }
  nextPrompt += '\n严格按照当前方案中已经写明的文案内容与排版指令进行渲染，不要把方案模板、字段名或说明文字再次输出到画面中。';

  return nextPrompt;
};

interface BuildOneClickImagePromptOptions {
  schemeContent: string;
  language: string | null | undefined;
  logoUrl?: string | null;
  replicationReferenceUrl?: string | null;
  replicationReferenceLabel?: string | null;
  previousResultUrl?: string | null;
  variationInstruction?: string | null;
  editInstruction?: string | null;
  supplementalReferenceUrls?: string[];
  suiteReferenceUrls?: string[];
  hasProductReferences?: boolean;
  platform?: string | null;
  includeCopyGuardrails?: boolean;
  publicBaseUrl?: string;
}

const normalizeSuiteReplicationSchemeForGenerationPrompt = (schemeContent: string) => {
  const copyLayouts: string[] = [];
  const normalizeCopyReplacementLine = (line: string) => {
    const normalized = String(line || '').trim().replace(/^[-\s]+/, '');
    if (!normalized) return '';
    const textMatch = normalized.match(/[“"]([^”"]+)[”"]/);
    const source = normalized.split(/[（(:：]/)[0]?.trim();
    if (textMatch?.[1] && source) return `“${source}”改为“${textMatch[1]}”`;
    return normalized;
  };
  const withoutCopyLayout = String(schemeContent || '').replace(
    /-?\s*文案内容排版[：:]\s*([\s\S]*?)(?=\n-\s*(?:画面比例|设计意图|画面风格|画面描述|屏序\/类型|参考图标识)|\n\[SCHEME_END\]|$)/g,
    (_match, content) => {
      const normalizedLines = String(content || '')
        .split('\n')
        .map(normalizeCopyReplacementLine)
        .filter(Boolean);
      copyLayouts.push(...normalizedLines);
      return '';
    }
  ).replace(/\n{3,}/g, '\n\n');

  const withoutVisualStyle = withoutCopyLayout.replace(
    /-?\s*画面风格[：:]\s*([\s\S]*?)(?=\n-\s*(?:画面描述|画面比例|设计意图|屏序\/类型|参考图标识)|\n\[SCHEME_END\]|$)/g,
    ''
  ).replace(/\n{3,}/g, '\n\n');

  if (copyLayouts.length === 0) return withoutVisualStyle.trim();
  const copySummary = `文案替换：${copyLayouts.join('；')}`;
  const sceneDescriptionRegex = /(-\s*画面描述[：:]\s*)([\s\S]*?)(?=\n-\s*(?:画面比例|设计意图|屏序\/类型|参考图标识)|\n\[SCHEME_END\]|$)/;
  if (sceneDescriptionRegex.test(withoutVisualStyle)) {
    return withoutVisualStyle.replace(sceneDescriptionRegex, (_match, prefix, content) => {
      const trimmed = String(content || '').trim();
      return `${prefix}${trimmed}${trimmed ? '；' : ''}${copySummary}`;
    }).trim();
  }
  if (/\n-\s*画面比例/.test(withoutVisualStyle)) {
    return withoutVisualStyle.replace(/\n-\s*画面比例/, `\n- 画面描述：${copySummary}\n- 画面比例`).trim();
  }
  return `${withoutVisualStyle.trim()}\n- 画面描述：${copySummary}`.trim();
};

const buildOneClickVariationPrompt = ({
  previousResultUrl,
  variationInstruction,
  hasProductReferences,
  publicBaseUrl,
}: Pick<BuildOneClickImagePromptOptions, 'previousResultUrl' | 'variationInstruction' | 'hasProductReferences' | 'publicBaseUrl'>) => {
  const safePreviousResultUrl = resolvePublicAssetUrl(previousResultUrl || '', publicBaseUrl || '');
  const instruction = String(variationInstruction || '').trim();
  const productReferenceLine = hasProductReferences
    ? '随 input_urls 一起上传的原商品素材图，用于保持产品外观、包装结构、标签文字、logo、材质、颜色和比例一致。'
    : '如 input_urls 中存在原商品素材图，仅用于保持产品外观、包装结构、标签文字、logo、材质、颜色和比例一致。';

  return [
    '【裂变基准图】',
    safePreviousResultUrl || '上一张生成结果图',
    '',
    '【原素材参考图】',
    productReferenceLine,
    '',
    '【任务需求】',
    instruction || '按当前选择的裂变方向修改画面。',
    '',
    '【约束规范】',
    '- 以裂变基准图为直接修改基础，保持其画面结构、构图、排版骨架、卖点信息、信息层级和文案位置不变。',
    '- 保持产品与原素材参考图一致，不修改产品主体、包装、标签、logo、材质、真实颜色、比例和细节。',
    '- 换场景、换配色或氛围调整只作用于背景、边框、装饰、光影和非产品视觉元素，不作用于产品本身。',
    '- 若自定义任务明确要求修改某个卖点、文案或局部信息，只修改对应内容，其他结构和信息保持不变。',
  ].filter(Boolean).join('\n');
};

export const buildOneClickResultEditPrompt = ({
  previousResultUrl,
  editInstruction,
  supplementalReferenceUrls = [],
  hasProductReferences,
  publicBaseUrl,
}: Pick<BuildOneClickImagePromptOptions, 'previousResultUrl' | 'editInstruction' | 'supplementalReferenceUrls' | 'hasProductReferences' | 'publicBaseUrl'>) => {
  const safePreviousResultUrl = resolvePublicAssetUrl(previousResultUrl || '', publicBaseUrl || '');
  const instruction = String(editInstruction || '').trim();
  const safeSupplementUrls = supplementalReferenceUrls
    .map((url) => resolvePublicAssetUrl(url || '', publicBaseUrl || ''))
    .filter(Boolean);
  const productReferenceLine = hasProductReferences
    ? '随 input_urls 一起上传的原素材商品图，用于保持产品外观、包装结构、标签文字、logo、材质、真实颜色、比例和细节一致。'
    : '如 input_urls 中存在原素材商品图，用于保持产品外观、包装结构、标签文字、logo、材质、真实颜色、比例和细节一致。';
  const supplementalReferenceLine = safeSupplementUrls.length > 0
    ? safeSupplementUrls.map((url, index) => `补充参考图${index + 1}：${url}`).join('\n')
    : '未上传补充参考图时，仅根据修改基准图、原素材商品图和任务需求生成新结果。';

  return [
    '【修改基准图】',
    safePreviousResultUrl || '需修改的生成图',
    '',
    '【原素材商品图】',
    productReferenceLine,
    '',
    '【补充参考图】',
    supplementalReferenceLine,
    '',
    '【任务需求】',
    instruction || '按用户输入要求修改当前生成图。',
    '',
    '【约束规范】',
    '- 生成新结果，保留原图；不要覆盖、替换或删除原来的生成结果。',
    '- 以修改基准图为直接编辑基础，保持其画面结构、构图、排版骨架、卖点信息、信息层级和文案位置不变。',
    '- 产品一致性默认以原素材商品图为准，保持产品主体、包装、标签、logo、材质、真实颜色、比例和细节不变。',
    '- 若任务需求明确说明补充参考图是新的产品、包装、局部替换或新增元素参考，则对应部分以补充参考图为准；未被任务点名的产品部分仍以原素材商品图为准。',
    '- 修改只作用于任务需求点名的局部、场景、配色、装饰、光影、道具或信息；没有点名的产品主体、卖点层级和版式关系保持不变。',
  ].filter(Boolean).join('\n');
};

export const buildOneClickImagePrompt = ({
  schemeContent,
  language,
  logoUrl,
  replicationReferenceUrl,
  replicationReferenceLabel,
  previousResultUrl,
  variationInstruction,
  editInstruction,
  supplementalReferenceUrls,
  suiteReferenceUrls = [],
  hasProductReferences = false,
  platform,
  includeCopyGuardrails = true,
  publicBaseUrl = '',
}: BuildOneClickImagePromptOptions) => {
  if (previousResultUrl && editInstruction?.trim()) {
    return buildOneClickResultEditPrompt({
      previousResultUrl,
      editInstruction,
      supplementalReferenceUrls,
      hasProductReferences,
      publicBaseUrl,
    });
  }

  if (previousResultUrl && variationInstruction?.trim()) {
    return buildOneClickVariationPrompt({
      previousResultUrl,
      variationInstruction,
      hasProductReferences,
      publicBaseUrl,
    });
  }

  const imageRoleLines: string[] = [];
  const priorityLines: string[] = [];
  const replacementLines: string[] = [];
  const isResultOnlyVariation = Boolean(previousResultUrl && !replicationReferenceUrl);
  if (!isResultOnlyVariation) {
    priorityLines.push('上传产品素材是产品外观、结构、比例、包装、文字、logo 和标签信息的唯一依据；产品包装上的文字、logo、品牌名和标签信息不得去除或改写。');
    priorityLines.push('必须精准还原上传产品的真实细节，不得修改产品外观、形状、比例、颜色、包装文字、logo、标签、材质、纹理、配件和结构；参考图只决定版式和风格，不得覆盖产品素材中的产品信息。');
  }

  if (previousResultUrl) {
    const safePreviousResultUrl = resolvePublicAssetUrl(previousResultUrl, publicBaseUrl);
    imageRoleLines.push(safePreviousResultUrl ? `上一张生成结果图（图片URL）：${safePreviousResultUrl}` : '上一张生成结果图（图片URL）');
    priorityLines.push('上一张生成结果图是继续裂变的直接基础，继承其产品主体、结构关系、卖点层级与版式骨架，只按当前裂变要求调整。');
  }

  if (suiteReferenceUrls.length > 0) {
    const safeSuiteReferenceUrls = suiteReferenceUrls
      .map((url) => resolvePublicAssetUrl(url || '', publicBaseUrl))
      .filter(Boolean);
    if (safeSuiteReferenceUrls.length > 0) {
      imageRoleLines.push(...safeSuiteReferenceUrls.map((url, index) => `参考套图${index + 1}（图片URL）：${url}`));
    }
    priorityLines.push('参考套图是整套主图的版式、屏序、视觉节奏、信息层级和风格连续性基准；必须按当前方案中写明的整套参考结构进行复刻与延展，不得把参考套图拆成互不相关的单张图任务。');
    priorityLines.push('产品素材只决定替换进去的商品本体；参考套图中的原商品、品牌、店铺、价格和原文案不得带入最终画面。');
    priorityLines.push('若参考套图中出现人物，在保持场景风格、景别、光影、动作节奏和商业拍摄质感一致的情况下，人物必须与参考图人物做出明显差异；不得复制同一张脸、发型、服装、体态、身份特征或可识别人物形象。');
    replacementLines.push(logoUrl
      ? '去除参考套图中的所有 logo、品牌名、店铺名、平台标识、价格和原文案；品牌位只能使用品牌logo图或通用信息补足。'
      : '去除参考套图中的所有 logo、品牌名、店铺名、平台标识、价格和原文案；未上传品牌 logo 时，品牌/店铺/logo/官方背书位统一写通用信息。');
    replacementLines.push('所有文案与卖点只能基于上传产品的真实信息，不得照搬参考套图原文案或编造促销信息。');
  } else if (replicationReferenceUrl) {
    const safeReferenceUrl = resolvePublicAssetUrl(replicationReferenceUrl, publicBaseUrl);
    const referenceLabel = String(replicationReferenceLabel || '复刻主图参考图');
    imageRoleLines.push(safeReferenceUrl ? `${referenceLabel}（图片URL）：${safeReferenceUrl}` : `${referenceLabel}（图片URL）`);
    priorityLines.push(`${referenceLabel}是最高版式基准，必须直接复刻该参考图的整体风格、版式结构、信息层级、视觉节奏、设计细节，不得改成另一种风格。`);
    priorityLines.push(`若执行内容中对参考图版式、颜色、结构或视觉元素的描述与${referenceLabel}真实画面不一致，必须以${referenceLabel}真实画面为准；执行内容只用于指导商品、文案和品牌信息替换，不得覆盖参考图真实布局。`);
    priorityLines.push(`商品区的位置、角度、大小关系、层级、道具关系和背景以${referenceLabel}原商品区为准；产品素材只决定替换进去的商品本体。`);
    priorityLines.push(`若${referenceLabel}中出现人物，在确保场景风格、景别、光影、动作节奏和商业拍摄质感一致的情况下，人物必须与参考图人物做出明显差异；不得复制同一张脸、发型、服装、体态、身份特征或可识别人物形象。`);
    replacementLines.push(logoUrl
      ? '去除参考图中的所有 logo、品牌名、店铺名、平台标识和原文案；原位置用品牌logo图或通用信息补足。'
      : '去除参考图中的所有 logo、品牌名、店铺名、平台标识和原文案；未上传品牌 logo 时，品牌/店铺/logo/官方背书位统一写通用信息，不写官方自营/旗舰店或具体品牌名。');
    if (!previousResultUrl) {
      replacementLines.push('所有替换内容只能基于上传产品的真实信息与卖点，不得脱离产品事实自由编造。');
    }
  } else if (previousResultUrl) {
    priorityLines.push('没有原始主图参考时，以上一张生成结果图作为唯一裂变参考，不要求额外上传参考图。');
    replacementLines.push('只根据上一张生成结果图和本次裂变修改要求进行局部或整体调整，不重新引入原始生图提示词、产品素材或参考素材。');
  } else {
    priorityLines.push('严格按照当前方案执行画面内容、主体摆放、卖点层级与文案排版，不得擅自改成另一种风格或结构。');
    replacementLines.push('所有延展信息都只能基于上传产品的真实信息与卖点，不得脱离产品事实自由编造。');
  }

  if (variationInstruction?.trim()) {
    priorityLines.push(`本次继续裂变要求：${variationInstruction.trim()}`);
  }

  if (logoUrl) {
    const safeLogoUrl = resolvePublicAssetUrl(logoUrl, publicBaseUrl);
    imageRoleLines.push(safeLogoUrl ? `品牌logo图（图片URL）：${safeLogoUrl}` : '品牌logo图（图片URL）');
    replacementLines.push('品牌logo图仅用于识别和还原我方品牌标识；最终画面不得带入产品素材图或参考图中的竞品 logo、他牌标识或具体品牌/店铺名。');
  } else if (!isResultOnlyVariation) {
    replacementLines.push('不得把产品素材图上的logo或参考图logo提取成我方独立品牌元素使用；若执行内容写了具体品牌/店铺/logo文字，改用通用信息。');
  }

  const executableSchemeContent = suiteReferenceUrls.length > 0
    ? normalizeSuiteReplicationSchemeForGenerationPrompt(schemeContent)
    : schemeContent;

  if (/文案映射|->|→/.test(executableSchemeContent)) {
    priorityLines.push('执行内容若包含“文案映射”或箭头映射，箭头右侧文字就是最终上屏文案，必须逐字生成，保留原有文字、数字、单位、符号、标点和大小写；不得润色、缩写、扩写、同义替换或改成更自然的表达。');
    priorityLines.push('不得使用映射之外的自编标题、标签、卖点或促销语。');
  }

  const sections = [
    imageRoleLines.length > 0 ? ['【图片角色】', ...imageRoleLines.map(line => `- ${line}`)].join('\n') : '',
    ['【执行优先级】', ...priorityLines.map(line => `- ${line}`)].join('\n'),
    ['【替换规则】', ...replacementLines.map(line => `- ${line}`)].join('\n'),
  ].filter(Boolean);
  let prompt = `【硬约束】\n${sections.join('\n\n')}\n\n【执行内容】\n${executableSchemeContent.trim()}\n\n【画面质量】\n高端商业摄影棚拍质感。`;
  if (includeCopyGuardrails) {
    prompt = appendOneClickCopyGuardrails(prompt, language, platform);
  }
  return prompt;
};
