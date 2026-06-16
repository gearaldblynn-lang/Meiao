import { GENERATE_IMAGE_TOOL, normalizeGenerateImageArgs } from './imageToolDefinition.mjs';
import { buildSessionImageCatalog, formatCatalogForPrompt, isUrlInCatalog } from './conversationImageCatalog.mjs';

const IMAGE_MODE_GUIDANCE = [
  '你正处于生图模式。用户希望你帮助生成或修改图片。',
  '- 如果用户需求清晰（有明确的主体、风格或修改要求），直接调用 generate_image 工具',
  '- 如果需求不够明确（缺少关键信息），先追问用户，不要猜测生图',
  '- 你可以结合对话上下文理解"继续调整""按上一版改"等指代',
].join('\n');

export const runAgentConversationV2 = async ({
  systemPrompt = '',
  summary = '',
  recentMessages = [],
  currentMessage = '',
  attachments = [],
  priorMessages = [],
  imageGenerationEnabled = false,
  imageMode = false,
  selectedImageModel = '',
  maxInputImages = 1,
  contextLimits = {},
  callModel,
  generateImage,
  onProgress = null,
} = {}) => {
  void maxInputImages;
  const emit = (stage, extra = {}) => {
    if (onProgress) onProgress({ stage, ...extra });
  };

  const catalog = buildSessionImageCatalog({ attachments, priorMessages });
  const catalogText = formatCatalogForPrompt(catalog);

  const systemParts = [systemPrompt];
  if (imageMode && imageGenerationEnabled) systemParts.push(IMAGE_MODE_GUIDANCE);
  if (imageGenerationEnabled && catalog.length > 0) systemParts.push(catalogText);
  const fullSystem = systemParts.filter(Boolean).join('\n\n');

  const messages = [
    { role: 'system', content: fullSystem },
    ...(summary ? [{ role: 'system', content: `会话摘要：\n${summary}` }] : []),
    ...(Array.isArray(recentMessages) ? recentMessages : []),
    { role: 'user', content: currentMessage },
  ];
  const tools = imageGenerationEnabled ? [GENERATE_IMAGE_TOOL] : [];

  emit('thinking', { round: 1 });
  const first = await callModel({
    messages,
    tools,
    toolChoice: tools.length > 0 ? 'auto' : undefined,
    maxTokens: contextLimits.maxOutputTokens,
    onDelta: (delta) => emit('streaming', { delta }),
  });

  if (first.finishReason !== 'tool_calls' || !first.toolCalls?.length) {
    emit('done', {});
    return {
      content: first.content,
      imagePlan: null,
      imageResultUrls: null,
      selectedModel: first.modelUsed || '',
      finishReason: first.finishReason,
    };
  }

  const firstCall = first.toolCalls.find((call) => call.name === 'generate_image') || first.toolCalls[0];
  emit('tool_calling', { tool: firstCall.name, args: firstCall.args });

  let normalized;
  try {
    normalized = normalizeGenerateImageArgs(firstCall.args);
  } catch {
    emit('done', {});
    return {
      content: first.content || '抱歉，我没能理解生图需求，请再具体描述一下。',
      imagePlan: null,
      imageResultUrls: null,
      selectedModel: first.modelUsed || '',
      finishReason: 'stop',
    };
  }

  const validInputUrls = normalized.inputImageUrls.filter((url) => isUrlInCatalog(catalog, url));

  messages.push({
    role: 'assistant',
    content: first.content || null,
    tool_calls: [{
      id: firstCall.id || 'call_1',
      type: 'function',
      function: { name: 'generate_image', arguments: JSON.stringify(firstCall.args) },
    }],
  });

  emit('image_generating', { model: selectedImageModel });
  let imageUrl = '';
  let providerTaskId = '';
  let toolResultContent = '';
  try {
    const result = await generateImage({
      prompt: normalized.prompt,
      taskType: normalized.taskType,
      inputImageUrls: validInputUrls,
      aspectRatio: normalized.aspectRatio,
      model: selectedImageModel,
    });
    imageUrl = String(result?.imageUrl || '').trim();
    providerTaskId = String(result?.providerTaskId || '').trim();
    toolResultContent = imageUrl
      ? `图片已生成成功，URL: ${imageUrl}。请用一句话向用户说明生成结果。`
      : '图片生成返回为空。请向用户说明生成失败。';
    if (imageUrl) emit('image_ready', { imageUrl });
  } catch (error) {
    toolResultContent = `图片生成失败：${error?.message || '未知错误'}。请向用户说明失败原因，不要假装已生成。`;
  }

  messages.push({ role: 'tool', tool_call_id: firstCall.id || 'call_1', content: toolResultContent });
  const second = await callModel({
    messages,
    tools,
    toolChoice: 'none',
    maxTokens: contextLimits.maxOutputTokens,
    onDelta: (delta) => emit('streaming', { delta }),
  });

  emit('done', {});
  return {
    content: second.content || (imageUrl ? '已为你生成图片。' : '抱歉，图片生成失败了。'),
    imagePlan: imageUrl ? {
      requestMode: 'tool_calling',
      taskType: normalized.taskType,
      selectedImageModel,
      inputImageUrls: validInputUrls,
      prompt: normalized.prompt,
      size: normalized.aspectRatio,
      providerTaskId,
    } : null,
    imageResultUrls: imageUrl ? [imageUrl] : null,
    selectedModel: first.modelUsed || '',
    finishReason: 'stop',
  };
};
