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
  nextPrompt += '\n圆括号内的字体、字号字重、位置、颜色等内容仅作为排版指令理解，不是要直接渲染到画面中的正文。';
  nextPrompt += '\n只有中文引号“”内的文字才是最终需要渲染到画面中的正文文案。字段名、冒号、说明文字都不得出现在最终画面中。';

  return nextPrompt;
};

interface BuildOneClickImagePromptOptions {
  schemeContent: string;
  language: string | null | undefined;
  logoUrl?: string | null;
  replicationReferenceUrl?: string | null;
  previousResultUrl?: string | null;
  variationInstruction?: string | null;
  platform?: string | null;
  includeCopyGuardrails?: boolean;
  publicBaseUrl?: string;
}

export const buildOneClickImagePrompt = ({
  schemeContent,
  language,
  logoUrl,
  replicationReferenceUrl,
  previousResultUrl,
  variationInstruction,
  platform,
  includeCopyGuardrails = true,
  publicBaseUrl = '',
}: BuildOneClickImagePromptOptions) => {
  const imageRoleLines: string[] = [];
  const priorityLines: string[] = [];
  const replacementLines: string[] = [];
  const isResultOnlyVariation = Boolean(previousResultUrl && !replicationReferenceUrl);
  if (!isResultOnlyVariation) {
    priorityLines.push('上传产品素材是产品外观、结构、比例、包装、文字、logo 和标签信息的唯一依据；产品包装上的文字、logo、品牌名和标签信息不得去除或改写。');
  }

  if (previousResultUrl) {
    const safePreviousResultUrl = resolvePublicAssetUrl(previousResultUrl, publicBaseUrl);
    imageRoleLines.push(safePreviousResultUrl ? `上一张生成结果图（图片URL）：${safePreviousResultUrl}` : '上一张生成结果图（图片URL）');
    priorityLines.push('上一张生成结果图是继续裂变的直接基础，继承其产品主体、结构关系、卖点层级与版式骨架，只按当前裂变要求调整。');
  }

  if (replicationReferenceUrl) {
    const safeReferenceUrl = resolvePublicAssetUrl(replicationReferenceUrl, publicBaseUrl);
    imageRoleLines.push(safeReferenceUrl ? `复刻主图参考图（图片URL）：${safeReferenceUrl}` : '复刻主图参考图（图片URL）');
    priorityLines.push('复刻主图参考图是最高版式基准，必须直接复刻该参考图的整体风格、版式结构、信息层级、视觉节奏、设计细节，不得改成另一种风格。');
    priorityLines.push('若执行内容中对参考图版式、颜色、结构或视觉元素的描述与复刻主图参考图真实画面不一致，必须以复刻主图参考图真实画面为准；执行内容只用于指导商品、文案和品牌信息替换，不得覆盖参考图真实布局。');
    priorityLines.push('商品区的位置、角度、大小关系、层级、道具关系和背景以复刻主图参考原商品区为准；产品素材只决定替换进去的商品本体。');
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

  const sections = [
    imageRoleLines.length > 0 ? ['【图片角色】', ...imageRoleLines.map(line => `- ${line}`)].join('\n') : '',
    ['【执行优先级】', ...priorityLines.map(line => `- ${line}`)].join('\n'),
    ['【替换规则】', ...replacementLines.map(line => `- ${line}`)].join('\n'),
  ].filter(Boolean);
  let prompt = `【硬约束】\n${sections.join('\n\n')}\n\n【执行内容】\n${schemeContent.trim()}\n\n【画面质量】\n高端商业摄影棚拍质感。`;
  if (includeCopyGuardrails) {
    prompt = appendOneClickCopyGuardrails(prompt, language, platform);
  }
  return prompt;
};
