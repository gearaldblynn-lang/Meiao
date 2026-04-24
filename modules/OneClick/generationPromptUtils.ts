export const appendOneClickCopyGuardrails = (prompt: string, language: string | null | undefined) => {
  const targetLanguage = String(language || 'English').trim() || 'English';
  let nextPrompt = prompt;

  nextPrompt += `\n\n生图文案语言：”${targetLanguage}”`;
  nextPrompt += `\n画面文案必须严格按照【SKU 展示方案】中提供的文案内容逐字渲染，禁止将原文案翻译成其他语言或替换为其他语言版本。`;
  nextPrompt += '\n文案内容排版中，圆括号（或半角括号）内的内容全部是排版要求，绝对不能作为画面文字渲染。';
  nextPrompt += '\n只有中文引号””内的文字才是最终需要渲染到画面中的正文文案。';
  nextPrompt += '\n禁止把括号里的排版要求、备注说明、字段标签在视觉上制作成正文文案或额外文案内容。';
  nextPrompt += '\n字段名、角色名、括号内要求、冒号、说明文字都禁止渲染进画面。';
  nextPrompt += '\n若某行格式为 角色名(要求):”正文文案”，你只能渲染中文引号里的”正文文案”，并严格按括号内要求排版。';

  return nextPrompt;
};
