export const appendOneClickCopyGuardrails = (prompt: string, language: string | null | undefined) => {
  const targetLanguage = String(language || 'English').trim() || 'English';
  let nextPrompt = prompt;

  nextPrompt += `\n\n【文案渲染规则】画面文案语言：${targetLanguage}，逐字渲染当前方案中的文案内容，禁止翻译或替换语言。`;
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
  includeCopyGuardrails?: boolean;
}

export const buildOneClickImagePrompt = ({
  schemeContent,
  language,
  logoUrl,
  replicationReferenceUrl,
  previousResultUrl,
  variationInstruction,
  includeCopyGuardrails = true,
}: BuildOneClickImagePromptOptions) => {
  const lines = ['【硬约束】'];
  lines.push('1. 严格保持上传产品素材中的产品与包装一致性，不得改变产品外观、结构、比例、包装、标签信息及其他可识别细节；产品包装上原本属于我方产品的 logo、品牌名和标签信息不得去除或改写。');

  if (replicationReferenceUrl) {
    lines.push('2. 已上传的复刻主图参考图是本次生成的唯一参考基准，必须直接复刻该参考图的整体风格、版式结构、信息层级、视觉节奏与设计细节，不得改成另一种风格。');
    lines.push('3. 参考图中的所有 logo、品牌名、店铺名、平台标识和原文案都必须去除，不得沿用任何原有品牌识别信息；去除后原位置不得留空，必须优先替换为我方品牌 logo、店铺名或与版式匹配的通用信息。未单独上传品牌 logo 图时，禁止把产品素材图上出现的logo或参考图logo直接当作我方画面品牌识别信息使用。');
    if (previousResultUrl) {
      lines.push('4. 已上传的上一张生成结果图是本次继续裂变的直接基础，必须继承该结果图中的产品主体、结构关系、卖点层级与版式骨架，只按当前裂变要求调整。');
    } else {
      lines.push('4. 所有替换后的内容只能基于上传产品的真实信息与卖点，不得脱离产品事实自由编造。');
    }
  } else {
    lines.push('2. 严格按照当前方案执行画面内容、主体摆放、卖点层级与文案排版，不得擅自改成另一种风格或结构。');
    lines.push('3. 所有延展信息都只能基于上传产品的真实信息与卖点，不得脱离产品事实自由编造。');
  }

  if (variationInstruction?.trim()) {
    lines.push(`${replicationReferenceUrl ? '5' : '4'}. 本次继续裂变要求：${variationInstruction.trim()}`);
  }

  const logoRuleIndex = lines.length + 1;
  if (logoUrl) {
    lines.push(`${logoRuleIndex}. 已上传品牌 logo 图，仅用于识别和还原我方品牌标识；在参考图原品牌位、店铺名位或其他合适信息位应优先补入我方品牌 logo 或店铺识别信息；最终画面不得带入产品素材图或参考图中的竞品 logo、他牌标识或无关品牌元素。`);
  } else {
    lines.push(`${logoRuleIndex}. 若未上传品牌 logo，则参考图原品牌位、店铺名位或其他相关信息位必须改为通用文字信息；不得把产品素材图上的logo或参考图logo提取成我方独立品牌元素使用；若产品素材或参考图中出现竞品 logo、他牌标识或无关品牌信息，最终画面必须去除，不得保留。`);
  }

  let prompt = `${lines.join('\n')}\n\n【执行内容】\n${schemeContent.trim()}\n\n【画面质量】\n高端商业摄影棚拍质感。`;
  if (includeCopyGuardrails) {
    prompt = appendOneClickCopyGuardrails(prompt, language);
  }
  return prompt;
};
