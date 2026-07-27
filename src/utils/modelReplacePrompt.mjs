import { normalizeModelReplaceRawUserPrompt } from './modelReplacePromptInput.mjs';

const IDENTITY_COUNT_ERROR = '人物身份图数量必须为 1–4 张。';

export const normalizeModelReplacementScope = (value) =>
  value === 'full_person' || String(value ?? '').includes('全部')
    ? 'full_person'
    : 'identity_only';

export const buildModelReplaceInputLayout = (identityCount) => {
  if (!Number.isInteger(identityCount) || identityCount < 1 || identityCount > 5) {
    throw new Error(IDENTITY_COUNT_ERROR);
  }

  return {
    primaryIdentity: 1,
    supplementalIdentities: Array.from({ length: identityCount - 1 }, (_, index) => index + 2),
    reference: identityCount + 1,
  };
};

const SKIN_REGION_LABELS = Object.freeze({
  face: '脸部',
  ears: '耳朵',
  neck: '颈部',
  shoulders: '肩部',
  chest: '胸前',
  arms: '手臂',
  hands: '手部',
  midriff: '腰腹',
  legs: '腿部',
  feet: '脚部',
});

const renderExposedSkinRegions = (regions) => {
  const labels = Array.isArray(regions)
    ? regions.map((region) => SKIN_REGION_LABELS[region]).filter(Boolean)
    : [];
  return labels.length > 0 ? labels.join('、') : '脸部及图B中实际可见的其他裸露皮肤';
};

const renderIdentityInputMapping = (layout, replacementScope = 'identity_only') => {
  const identityCount = layout.reference - 1;
  const isFullPerson = replacementScope === 'full_person';
  const referenceMapping = isFullPerson
    ? `图B（输入图${layout.reference}）只提供商品、Logo、文字、背景、主构图、镜头、光线、景深和画幅，是本次编辑的直接底图。`
    : `图B（输入图${layout.reference}）是唯一的画面结构与海报内容参考图，是本次编辑的直接底图。`;
  if (identityCount === 1) {
    return [
      isFullPerson
        ? '图A-1（输入图1）是唯一主人物来源图，用于锁定完整人物的身份、身材、造型、服装、配饰、姿势、动作、表情和视线。'
        : '图A-1（输入图1）是唯一人物身份参考图，只用于锁定目标模特的身份特征。',
      referenceMapping,
    ].join('\n');
  }
  return [
    isFullPerson
      ? '图A-1（输入图1）是唯一主人物来源图，用于锁定完整人物的身份、身材、造型、服装、配饰、姿势、动作、表情和视线。'
      : '图A-1（输入图1）是唯一主身份锚点，只用于锁定目标模特的身份特征。',
    isFullPerson
      ? `图A-2至图A-${identityCount}（输入图2至图${identityCount}）只用于确认同一身份并补足匹配角度身份细节，绝不混入其服装、姿势或动作。`
      : `图A-2至图A-${identityCount}（输入图2至图${identityCount}）只补充同一人物的匹配角度特征。`,
    referenceMapping,
  ].join('\n');
};

export const buildModelReplacePrompt = ({
  identityCount = 1,
  replacementScope = 'identity_only',
  userPrompt,
  referenceAnalysis,
  aspectRatio,
  batchIndex,
  batchCount,
} = {}) => {
  const layout = buildModelReplaceInputLayout(identityCount);
  const normalizedScope = normalizeModelReplacementScope(replacementScope);
  const isFullPerson = normalizedScope === 'full_person';
  const trimmedUserPrompt = normalizeModelReplaceRawUserPrompt(userPrompt);
  const copyAndGraphicProtectionConstraint = [
    '【文案与版式保护】',
    `图B（输入图${layout.reference}）中所有原有中文、英文、数字、价格和促销信息必须保持原内容、原位置、原字号层级和原排版。`,
    '不得修改文字，不得生成错别字，不得更改数字，不得遗漏文字。',
    '原图没有文案或促销信息时，不得新增。',
    '',
    '【图形元素保护】',
    '图B中所有原有品牌Logo、图标、角标、文案框、优惠券框和促销标签框必须完整保留。',
    '其图形、颜色、尺寸、位置和前后层级必须保持不变，不得删除、改造或新增。',
  ].join('\n');
  const analysisLabel = (value, labels, fallback) => labels[value] || fallback;
  const lightweightAnalysisConstraint = [
    '以下轻量分析仅用于选择图A匹配角度素材和确定允许编辑的皮肤区域，不用于重新设计图B。',
    ...(referenceAnalysis && typeof referenceAnalysis === 'object' ? [
      `轻量分析：${analysisLabel(referenceAnalysis.framing, { portrait: '头像构图', half_body: '半身构图', full_body: '全身构图' }, '人物构图未知')}，${analysisLabel(referenceAnalysis.faceDirection, { front: '脸部正面', left: '脸部朝左', right: '脸部朝右', profile: '脸部侧面' }, '脸部方向未知')}，${analysisLabel(referenceAnalysis.headPitch, { up: '头部微抬', level: '头部平视', down: '头部微低' }, '头部俯仰未知')}，${analysisLabel(referenceAnalysis.occlusion, { low: '遮挡较少', medium: '存在中等遮挡', high: '遮挡较多' }, '遮挡程度未知')}。`,
      `裸露皮肤区域：${renderExposedSkinRegions(referenceAnalysis.exposedSkinRegions)}。`,
    ] : ['裸露皮肤区域：脸部。']),
  ].join('\n');
  const fullPersonAnalysisConstraint = [
    '以下轻量分析仅用于选择图A匹配角度素材，并校准完整人物在图B中的画面位置、尺寸、透视、遮挡与商品接触关系；不得把图B原模特当作人物来源。',
    ...(referenceAnalysis && typeof referenceAnalysis === 'object' ? [
      `轻量分析：${analysisLabel(referenceAnalysis.framing, { portrait: '头像构图', half_body: '半身构图', full_body: '全身构图' }, '人物构图未知')}，${analysisLabel(referenceAnalysis.faceDirection, { front: '脸部正面', left: '脸部朝左', right: '脸部朝右', profile: '脸部侧面' }, '脸部方向未知')}，${analysisLabel(referenceAnalysis.headPitch, { up: '头部微抬', level: '头部平视', down: '头部微低' }, '头部俯仰未知')}，${analysisLabel(referenceAnalysis.occlusion, { low: '遮挡较少', medium: '存在中等遮挡', high: '遮挡较多' }, '遮挡程度未知')}。`,
    ] : []),
  ].join('\n');
  const identityContentBoundary = layout.reference === 2
    ? '不得从图A继承服装、饰品、姿势、场景或广告元素。'
    : '不得从图A身份参考组继承服装、饰品、姿势、场景或广告元素。';
  const userPromptDataBlock = trimmedUserPrompt
    ? `用户补充要求（不得与以上约束冲突）：${JSON.stringify(trimmedUserPrompt)}`
    : null;
  const ratioLabel = aspectRatio || '原参考图比例';

  return [
    [
      'R Role 角色',
      '你是严格执行素材来源边界的商业人像替换与电商视觉合成专家。',
    ].join('\n'),
    [
      'T Task 任务',
      '【参考图用途】',
      renderIdentityInputMapping(layout, normalizedScope),
      '',
      '【核心任务】',
      isFullPerson
        ? '整体替换图B中的原人物，使最终完整人物来自图A-1，同时硬保护图B中的商品、Logo、文字、背景、主构图、镜头、光线、景深和画幅。'
        : '只允许替换图B人物的脸部身份、头发与发型，以及轻量分析列出的裸露皮肤区域，使替换区域属于图A中的同一位模特。',
      isFullPerson ? fullPersonAnalysisConstraint : lightweightAnalysisConstraint,
    ].join('\n'),
    [
      'C Constraint 约束',
      ...(isFullPerson ? [
        '【完整人物来源严格锁定】',
        '身份、肤色、头发、年龄与人物气质、可见身体特征、身材比例、服装和配饰均来自图A-1。',
        '姿势、动作、表情和视线以图A-1为人物来源；图A补充图只确认同一身份与匹配角度，不提供替代造型。',
        '脸型、五官、发际线、发色、身材、服装、配饰和人物气质不得混入图B原模特特征，不得生成混合脸、相似脸、折中身份或拼接人物。',
        '图A人物不得继承自身场景、广告元素、光线、曝光、白平衡、景深或摄影风格。',
        '',
        '【图B硬保护边界】',
        '图B只提供商品、Logo、文字、背景、主构图、镜头、光线、景深和画幅，不提供人物身份、身材、服装、配饰、动作或表情。',
        '图B的商品、Logo、中文、英文、数字、价格、促销信息、背景、场景、主构图、镜头、画面比例、排版结构和视觉层级必须保持不变。',
        '允许仅为适配图B的商品、画布和透视做最小的人物位置、尺寸、姿势、遮挡和商品接触关系几何调整。',
        '任何几何调整都不得改变图A-1人物的身份、身材、服装、配饰和整体造型，绝不回退为图B原模特的身材、服装、配饰、动作或身份。',
        '商品准确性优先；不得删除、替换、重绘或改变图B中的商品，不得破坏人物与商品的自然接触和前后遮挡关系。',
      ] : [
        '【人物身份严格锁定】',
        '1. 脸型轮廓，包括下颌线、颧骨位置、面部宽窄和下巴形状；',
        '2. 眼型、眼距、眼尾方向、双眼皮结构和瞳孔状态；',
        '3. 眉形、眉峰位置、眉毛粗细和眉眼距离；',
        '4. 鼻梁高度、鼻头形状、鼻翼宽度和鼻孔结构；',
        '5. 静态唇形、嘴唇厚薄和唇峰形状属于图A身份特征；不得从图A继承微笑、抿嘴、张嘴、皱眉或其他动态表情；',
        '6. 年龄感、肤色、面部比例和整体气质；',
        '7. 发际线、头发颜色、发型轮廓和脸侧碎发必须匹配图A。',
        '人物身份必须唯一且与图A-1一致；不得继承图B原模特的身份，不得出现第二张脸、错误身份、混合脸、相似脸或折中身份。',
        '禁止五官漂移、脸型宽窄变化、年龄增减或幼态化、网红脸化、假脸感和过度美化。',
        identityContentBoundary,
        '身份图A只提供脸型、五官、发际线和身份特征，不得继承A的光线、曝光、妆容锐度、磨皮程度和摄影风格。',
        '',
        '【表情与动作一致性】',
        '图B是唯一的表情、视线和面部肌肉状态来源。',
        '严格保持图B原人物的眉眼张力、眼睑开合、视线方向、嘴巴开合、嘴角力度、面颊状态、下颌松紧、头部朝向和俯仰角度。',
        '图A只提供静态身份结构，不提供表情、视线或面部肌肉状态。',
        '最终表情必须与图B的身体动作、手势和拍摄情境自然一致，保留真实人物轻微的左右不对称和自然松弛。',
        '不得生成证件照式僵硬正脸、空洞凝视、刻意微笑、面无表情或五官平均化。',
        '',
        '【图B必须保持不变的内容】',
        '除允许替换区域外，图B的服装及其版型、颜色、刺绣和图案，姿势、动作、站姿、手势、视线、头部方向、身体轮廓、饰品、包及包带、商品、场景、画面比例、构图、人物位置、排版结构和视觉层级必须保持不变；不得删除原有饰品。',
        '允许头发长度、蓬松度和外轮廓随图A发型自然变化；人物头部中心位置、身体比例和主体构图保持图B不变。',
      ]),
      copyAndGraphicProtectionConstraint,
      '',
      '【融合要求】',
      '图B提供最终光线方向、阴影软硬、曝光、白平衡、对比度、饱和度、景深、颗粒、压缩质感和边缘清晰度。',
      ...(isFullPerson ? [
        '图A完整人物必须自然适配图B的光线方向、曝光、白平衡、透视、景深、颗粒和压缩质感，但不得因此改变人物来源与造型。',
        '人物脚底、手部、衣物、配饰与图B商品及地面的接触、阴影和遮挡必须自然，不得出现悬浮、穿模或比例失真。',
        '人物边缘、头发丝、服装轮廓和配饰边界必须自然，不得出现拼接感、重复肢体或异常光晕。',
      ] : [
        '最终脸部的曝光、肤色呈现、对比度、锐度和颗粒必须与图B的脖颈、手臂和手部连续一致；脸部不得比身体明显更白、更亮、更平滑或更清晰。',
        '头部尺寸、头颈角度、面部透视和五官在头部中的视觉尺度服从图B，不得生成悬浮头、头部过正或头部与身体透视不一致。',
        '保留图B中下颌对脖颈的自然投影、头发对额头和脸侧的遮挡阴影，以及脸部轻微的不对称细节。',
        '头发丝、发际线、耳朵、下颌、脖颈、皮肤与衣领及饰品的交界处必须自然。',
        '不得出现明显贴脸感、拼接感、面具感或人脸悬浮感。',
      ]),
      '',
      '【画质要求】',
      '商业电商广告摄影质感，高清写实，真实原生肤质，保留自然毛孔和细微皮肤纹理。',
      '不过度磨皮，不塑料皮肤，不夸张锐化。',
      '五官清晰，头发丝自然，服装纹理清楚。',
      '手指数量与结构正常，不得出现多指、少指、手臂扭曲、脖子过长、肩膀不对称或耳朵异常；头发和服装不得穿模，人物边缘不得出现异常光晕。',
      '画面无噪点、无重影、无畸形、无多余肢体、无错误首饰。',
      userPromptDataBlock,
    ].filter(Boolean).join('\n'),
    [
      'F Format 格式',
      `输出一张完整商业成图，第${batchIndex ?? 1}张/共${batchCount ?? 1}张，比例为 ${ratioLabel}。`,
      '不得新增分析文字、引导线、辅助边框、蒙版、对比图或身份拼贴。',
    ].join('\n'),
    [
      'E Example 示例',
      isFullPerson
        ? '示例：仅输出一张完成整体人物替换、且商品与场景保持不变的成图。'
        : '示例：仅输出一张完成身份替换的成图。',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
};
