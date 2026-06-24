import { GENERATE_IMAGE_TOOL, normalizeGenerateImageArgs } from './imageToolDefinition.mjs';
import { SEARCH_KNOWLEDGE_TOOL, normalizeSearchKnowledgeArgs } from './knowledgeToolDefinition.mjs';
import { buildSessionImageCatalog, formatCatalogForPrompt, isUrlInCatalog } from './conversationImageCatalog.mjs';

const IMAGE_MODE_GUIDANCE = [
  '你正处于生图模式。用户希望你帮助生成或修改图片。',
  '- 如果用户需求清晰（有明确的主体、风格或修改要求），直接调用 generate_image 工具',
  '- 根据用户语义决定工具调用次数：如果用户要求每张图、逐张、分别处理、每个产品/每个素材都处理，应为每个目标输出分别调用一次 generate_image，并返回多张结果',
  '- 如果用户要求融合、合成、组合到同一张图、做成一张海报或用多图共同构成一个画面，应只调用一次 generate_image，并把相关图片一起作为输入',
  '- 如果用户要求参考某张图来修改另一张图，应只调用一次 generate_image，并把主编辑图和参考图都放进 input_image_urls，同时在 prompt 中说明各自角色',
  '- 如果需求不够明确（缺少关键信息），先追问用户，不要猜测生图',
  '- 你可以结合对话上下文理解"继续调整""按上一版改"等指代',
].join('\n');

// 把当前消息的文字 + 上传图片附件拼成多模态 content，让模型真正"看到"图片。
// 没有图片附件时退化为纯文本字符串（兼容不支持多模态 content 数组的场景）。
const buildUserMessageContent = (text, attachments = [], { includeImages = true } = {}) => {
  const imageAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item?.kind === 'image' && item?.url);
  if (!includeImages || imageAttachments.length === 0) return String(text || '');
  return [
    { type: 'text', text: String(text || '') },
    ...imageAttachments.map((item) => ({
      type: 'image_url',
      image_url: { url: String(item.url) },
    })),
  ];
};

const hasImageAttachments = (attachments = []) => (
  (Array.isArray(attachments) ? attachments : []).some((item) => item?.kind === 'image' && item?.url)
);

const prepareImageUrlForModel = async (url, prepareModelImageUrl, cache) => {
  const normalized = String(url || '').trim();
  if (!normalized) return '';
  if (typeof prepareModelImageUrl !== 'function') return normalized;
  if (cache.has(normalized)) return cache.get(normalized);
  const prepared = String(await prepareModelImageUrl(normalized) || '').trim() || normalized;
  cache.set(normalized, prepared);
  return prepared;
};

const prepareAttachmentsForModel = async (attachments = [], prepareModelImageUrl, cache) => {
  const items = Array.isArray(attachments) ? attachments : [];
  return Promise.all(items.map(async (item) => {
    if (item?.kind !== 'image' || !item?.url) return item;
    return {
      ...item,
      originalUrl: item.originalUrl || item.url,
      url: await prepareImageUrlForModel(item.url, prepareModelImageUrl, cache),
    };
  }));
};

const preparePriorMessagesForModel = async (priorMessages = [], prepareModelImageUrl, cache) => {
  const messages = Array.isArray(priorMessages) ? priorMessages : [];
  return Promise.all(messages.map(async (message) => {
    const preparedAttachments = Array.isArray(message?.attachments)
      ? await prepareAttachmentsForModel(message.attachments, prepareModelImageUrl, cache)
      : message?.attachments;
    const metadata = message?.metadata && typeof message.metadata === 'object'
      ? { ...message.metadata }
      : message?.metadata;
    if (metadata?.imageUrl) {
      metadata.imageUrl = await prepareImageUrlForModel(metadata.imageUrl, prepareModelImageUrl, cache);
    }
    if (Array.isArray(metadata?.imagePlan?.inputImageUrls)) {
      metadata.imagePlan = {
        ...metadata.imagePlan,
        inputImageUrls: await Promise.all(metadata.imagePlan.inputImageUrls.map((url) => (
          prepareImageUrlForModel(url, prepareModelImageUrl, cache)
        ))),
      };
    }
    return {
      ...message,
      ...(preparedAttachments ? { attachments: preparedAttachments } : {}),
      ...(metadata ? { metadata } : {}),
    };
  }));
};

const shouldInlineImageAttachments = (attachments = []) => {
  const imageAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item?.kind === 'image' && item?.url);
  if (imageAttachments.length === 0) return false;
  return imageAttachments.every((item) => /^https:\/\//i.test(String(item.url || '').trim()));
};

const shouldRetryModelWithoutInlineImages = (error, attachments = []) => {
  if (!hasImageAttachments(attachments)) return false;
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '');
  return code === 'provider_bad_response' || /responses 请求失败|bad_response_status_code|502/.test(message);
};

const getGenerateImageToolCalls = (response = {}) => (
  (Array.isArray(response?.toolCalls) ? response.toolCalls : [])
    .filter((call) => call?.name === 'generate_image')
);

const normalizeToolCallImageUrls = (call = {}) => {
  try {
    return normalizeGenerateImageArgs(call.args).inputImageUrls;
  } catch {
    return [];
  }
};

const hasSingleImageOutputIntent = (text = '') => (
  /合成|融合|拼成|合并|组合到|同一张|一张海报|一张图|单张|同一个画面|参考.*修改|参考.*改|按.*参考/i.test(String(text || ''))
);

const hasExplicitSingleTargetIntent = (text = '') => (
  /只\s*(?:把|处理|修改|改|做)?\s*(?:图\s*[一二三四五六七八九十\d]+|第\s*[一二三四五六七八九十\d]+\s*张|这张|这一张)|(?:图\s*[一二三四五六七八九十\d]+|第\s*[一二三四五六七八九十\d]+\s*张|这张|这一张).*?(?:其他|其它).*?(?:不要|先不|不用|不处理)/i.test(String(text || ''))
);

const countMentionedImageTargets = (text = '') => {
  const normalized = String(text || '');
  const matches = normalized.match(/图\s*[一二三四五六七八九十\d]+|第\s*[一二三四五六七八九十\d]+\s*张/g);
  return new Set(matches || []).size;
};

const hasIndependentBatchIntent = (text = '', freshUploadCount = 0) => {
  const value = String(text || '').trim();
  if (freshUploadCount < 2 || !value) return false;
  if (hasExplicitSingleTargetIntent(value)) return false;
  if (/每张|分别|各自|逐张|每个|一张张|each|every/i.test(value)) return true;
  if (hasSingleImageOutputIntent(value)) return false;
  if (/全部|全都|都|所有|all|both/i.test(value)) return true;
  return countMentionedImageTargets(value) >= 2;
};

const getIndependentFreshImageCoverage = ({ response, freshUploadUrls = [] } = {}) => {
  const freshUrls = (Array.isArray(freshUploadUrls) ? freshUploadUrls : [])
    .map((url) => String(url || '').trim())
    .filter(Boolean);
  const freshSet = new Set(freshUrls);
  const coveredUrls = new Set();
  const generateCalls = getGenerateImageToolCalls(response);
  for (const call of generateCalls) {
    const inputUrls = normalizeToolCallImageUrls(call);
    if (inputUrls.length === 1 && freshSet.has(inputUrls[0])) coveredUrls.add(inputUrls[0]);
  }
  return { freshUrls, generateCalls, coveredUrls };
};

const shouldAuditUnderPlannedImageBatch = ({ response, freshUploadUrls = [], currentMessage = '' } = {}) => {
  const { freshUrls, generateCalls, coveredUrls } = getIndependentFreshImageCoverage({ response, freshUploadUrls });
  if (freshUrls.length < 2) return false;
  if (generateCalls.length === 0) return false;
  if (coveredUrls.size >= freshUrls.length) return false;
  if (generateCalls.length === 1 && coveredUrls.size === 1) return true;
  return hasIndependentBatchIntent(currentMessage, freshUrls.length) && coveredUrls.size < freshUrls.length;
};

const buildUnderPlannedImageAuditPrompt = ({ currentMessage = '', freshUploadUrls = [], plannedCall = null, attempt = 1 } = {}) => {
  const urls = (Array.isArray(freshUploadUrls) ? freshUploadUrls : [])
    .map((url) => String(url || '').trim())
    .filter(Boolean);
  const plannedInputUrls = normalizeToolCallImageUrls(plannedCall);
  return [
    '请审查上一轮 generate_image 工具调用是否完整覆盖用户语义，不要机械拆分。',
    attempt > 1 ? '上一轮审查仍未完整覆盖用户语义；这次必须重新核对所有本轮新上传图片和用户的数量要求。' : '',
    `用户本轮要求是：${String(currentMessage || '').trim()}`,
    `本轮共有 ${urls.length} 张新上传图片。上一轮规划的单图输入图片为：${plannedInputUrls.join(', ') || '空'}`,
    '',
    '请按语义判断：',
    '- 如果用户表达的是“每张/全部/都/分别/各自/每个产品都处理”等独立批处理需求，请重新返回多个 generate_image 工具调用；每张新上传图片一次，每次 input_image_urls 只放对应那一张，并按该图实际内容写 prompt。',
    '- 如果用户表达的是“合成/融合/拼成/同一张/一张海报/参考某图修改另一图”等单张输出需求，请不要拆分。',
    attempt > 1 ? '- 注意：上一轮审查仍未完整覆盖。若用户语义是多张独立输出，这次不能回复 PLAN_OK，必须返回覆盖所有目标图的多个 generate_image。' : '',
    '- 如果用户只指定了某一张图（例如图1、第一张、这张）或上一轮单图计划已经符合用户语义，请不要调用任何工具，直接回复 PLAN_OK。',
    '- 不要为了凑数量而复制同一个 prompt；只有语义确实要求多张独立输出时才返回多个工具调用。',
    '',
    '本轮新上传图片 URL：',
    ...urls.map((url, index) => `图${index + 1}: ${url}`),
  ].join('\n');
};

const getGenerateImageDedupKey = (call = {}) => {
  if (call?.name !== 'generate_image') return '';
  try {
    const normalized = normalizeGenerateImageArgs(call.args);
    return JSON.stringify({
      name: 'generate_image',
      prompt: String(normalized.prompt || '').trim(),
      taskType: normalized.taskType,
      aspectRatio: normalized.aspectRatio,
      inputImageUrls: normalized.inputImageUrls.map((url) => String(url || '').trim()),
    });
  } catch {
    return '';
  }
};

const dedupeExactDuplicateToolCalls = (toolCalls = []) => {
  const seenGenerateImage = new Set();
  const deduped = [];
  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    const key = getGenerateImageDedupKey(call);
    if (key) {
      if (seenGenerateImage.has(key)) continue;
      seenGenerateImage.add(key);
    }
    deduped.push(call);
  }
  return deduped;
};

const formatKnowledgeToolOutput = (chunks = []) => {
  const items = Array.isArray(chunks) ? chunks : [];
  if (items.length === 0) return '未在知识库中找到相关内容。';
  return `检索结果:\n${items.map((chunk, index) => (
    `资料${index + 1}(${chunk?.documentTitle || chunk?.sourceType || '知识'}): ${chunk?.content || ''}`
  )).join('\n\n')}`;
};

const buildFunctionCallOutput = (callId, output) => ({
  type: 'function_call_output',
  call_id: callId,
  output,
});

const buildFunctionCallInputItem = (call = {}, callId = '') => {
  const responseItem = call?.responseItem;
  if (responseItem?.type === 'function_call') {
    return {
      ...responseItem,
      call_id: String(responseItem.call_id || callId),
    };
  }
  return {
    type: 'function_call',
    id: `fc_${String(callId || call?.id || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    call_id: String(callId || call?.id || ''),
    name: String(call?.name || ''),
    arguments: JSON.stringify(call?.args || {}),
    status: 'completed',
  };
};

const buildImageGeneratedFallbackReply = (error) => {
  void error;
  return '图片已生成完成，但最终文字说明生成失败。已为你保留图片结果。';
};

const buildAggregatedImagePlan = ({ plans = [], imageResultUrls = [], providerTaskIds = [] } = {}) => {
  const cleanPlans = (Array.isArray(plans) ? plans : []).filter(Boolean);
  if (cleanPlans.length === 0) return null;
  const first = cleanPlans[0];
  const uniqueInputUrls = Array.from(new Set(cleanPlans.flatMap((plan) => (
    Array.isArray(plan?.inputImageUrls) ? plan.inputImageUrls : []
  )).map((url) => String(url || '').trim()).filter(Boolean)));
  const cleanResultUrls = (Array.isArray(imageResultUrls) ? imageResultUrls : [])
    .map((url) => String(url || '').trim())
    .filter(Boolean);
  const cleanTaskIds = (Array.isArray(providerTaskIds) ? providerTaskIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return {
    ...first,
    taskType: cleanPlans.length > 1 ? 'batch_image_generation' : first.taskType,
    inputImageUrls: cleanPlans.length > 1 ? uniqueInputUrls : first.inputImageUrls,
    prompt: cleanPlans.length > 1
      ? cleanPlans.map((plan, index) => `任务${index + 1}: ${plan.prompt || ''}`).join('\n')
      : first.prompt,
    providerTaskId: cleanTaskIds[0] || first.providerTaskId || '',
    outputCount: cleanPlans.length,
    plans: cleanPlans,
    imageResultUrls: cleanResultUrls,
    providerTaskIds: cleanTaskIds,
  };
};

export const runAgentConversationV2 = async ({
  systemPrompt = '',
  summary = '',
  recentMessages = [],
  currentMessage = '',
  attachments = [],
  priorMessages = [],
  imageGenerationEnabled = false,
  imageMode = false,
  hasKnowledgeBase = false,
  webSearchEnabled = false,
  selectedImageModel = '',
  maxInputImages = 1,
  contextLimits = {},
  callModel,
  generateImage,
  searchKnowledge = null,
  prepareModelImageUrl = null,
  onProgress = null,
} = {}) => {
  void maxInputImages;
  const emit = (stage, extra = {}) => {
    if (onProgress) onProgress({ stage, ...extra });
  };

  const preparedImageUrlCache = new Map();
  const modelAttachments = await prepareAttachmentsForModel(attachments, prepareModelImageUrl, preparedImageUrlCache);
  const modelPriorMessages = await preparePriorMessagesForModel(priorMessages, prepareModelImageUrl, preparedImageUrlCache);

  const catalog = buildSessionImageCatalog({ attachments: modelAttachments, priorMessages: modelPriorMessages });
  const catalogText = formatCatalogForPrompt(catalog);

  // 本轮新上传的图（多模态消息里模型能直接看到的那几张）——改图时应优先作为编辑对象，
  // 不要被历史生成图带偏。把它们的 URL 显式告诉模型。
  const freshUploadUrls = (Array.isArray(modelAttachments) ? modelAttachments : [])
    .filter((item) => item?.kind === 'image' && item?.url)
    .map((item) => String(item.url));
  const freshUploadGuidance = freshUploadUrls.length > 0
    ? [
        '本轮用户新上传了图片（已在本条消息中随附，你可以直接看到）。',
        '如果用户要求"修改/编辑这张图、在图上改文字、换背景"等，必须把本轮新上传图作为 edit_image 的 input_image_urls，URL 如下：',
        ...freshUploadUrls.map((url) => `- ${url}`),
        '不要错用历史生成图（如之前生成的其它图片）当作本次编辑对象，除非用户明确要求基于历史图修改。',
      ].join('\n')
    : '';

  const systemParts = [systemPrompt];
  if (imageMode && imageGenerationEnabled) systemParts.push(IMAGE_MODE_GUIDANCE);
  if (imageGenerationEnabled && catalog.length > 0) systemParts.push(catalogText);
  if (imageGenerationEnabled && freshUploadGuidance) systemParts.push(freshUploadGuidance);
  const fullSystem = systemParts.filter(Boolean).join('\n\n');

  const imageInputFallbackGuidance = [
    '注意：上游模型直接读取本轮 inline 图片时可能失败。',
    '如果当前消息没有附带 inline image_url，但系统消息里的"当前会话图片目录"列出了图片 URL，请继续使用这些 URL 理解用户指代。',
    '用户已经提供了图片；不要要求用户重新上传。若用户需求明确需要生成/编辑图片，请按图片目录 URL 调用 generate_image。',
  ].join('\n');

  const buildInitialMessages = ({ includeImages = true, includeImageInputFallbackGuidance = false } = {}) => [
    { role: 'system', content: fullSystem },
    ...(includeImageInputFallbackGuidance ? [{ role: 'system', content: imageInputFallbackGuidance }] : []),
    ...(summary ? [{ role: 'system', content: `会话摘要：\n${summary}` }] : []),
    ...(Array.isArray(recentMessages) ? recentMessages : []),
    { role: 'user', content: buildUserMessageContent(currentMessage, modelAttachments, { includeImages }) },
  ];
  const inlineInitialImages = shouldInlineImageAttachments(modelAttachments);
  let messages = buildInitialMessages({
    includeImages: inlineInitialImages,
    includeImageInputFallbackGuidance: hasImageAttachments(modelAttachments) && !inlineInitialImages,
  });
  const tools = [];
  if (imageGenerationEnabled) tools.push(GENERATE_IMAGE_TOOL);
  if (hasKnowledgeBase) tools.push(SEARCH_KNOWLEDGE_TOOL);
  if (webSearchEnabled) tools.push({ type: 'web_search' });

  emit('thinking', { round: 1, ...(inlineInitialImages ? {} : hasImageAttachments(attachments) ? { imageInputMode: 'text_image_catalog' } : {}) });
  const callInitialModel = async () => callModel({
    messages,
    tools,
    toolChoice: tools.length > 0 ? 'auto' : undefined,
    maxTokens: contextLimits.maxOutputTokens,
    onDelta: (delta) => emit('streaming', { delta }),
  });
  let response;
  try {
    response = await callInitialModel();
  } catch (error) {
    if (!shouldRetryModelWithoutInlineImages(error, modelAttachments)) throw error;
    emit('thinking', { round: 1, retry: 'text_image_catalog' });
    messages = buildInitialMessages({ includeImages: false, includeImageInputFallbackGuidance: true });
    response = await callInitialModel();
  }

  if (response.finishReason !== 'tool_calls' || !response.toolCalls?.length) {
    emit('done', {});
    return {
      content: response.content,
      imagePlan: null,
      imageResultUrls: null,
      selectedModel: response.modelUsed || '',
      finishReason: response.finishReason,
    };
  }

  const configuredPlanRepairRounds = Number(process.env.AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS || 2);
  const maxPlanRepairRounds = Number.isFinite(configuredPlanRepairRounds)
    ? Math.max(1, configuredPlanRepairRounds)
    : 2;
  let planRepairRound = 0;
  while (
    planRepairRound < maxPlanRepairRounds
    && shouldAuditUnderPlannedImageBatch({ response, freshUploadUrls, currentMessage })
  ) {
    planRepairRound += 1;
    emit('thinking', { round: 1, repair: 'under_planned_image_batch_audit', repairRound: planRepairRound });
    const originalGenerateCall = getGenerateImageToolCalls(response)[0];
    const repairMessages = [
      ...messages,
      { role: 'system', content: buildUnderPlannedImageAuditPrompt({ currentMessage, freshUploadUrls, plannedCall: originalGenerateCall, attempt: planRepairRound }) },
    ];
    const repairedResponse = await callModel({
      messages: repairMessages,
      tools,
      toolChoice: 'auto',
      maxTokens: contextLimits.maxOutputTokens,
      onDelta: (delta) => emit('streaming', { delta }),
    });
    if (repairedResponse?.finishReason === 'tool_calls' && repairedResponse.toolCalls?.length) {
      messages = repairMessages;
      response = repairedResponse;
      continue;
    }
    if (!hasIndependentBatchIntent(currentMessage, freshUploadUrls.length)) break;
  }
  if (
    shouldAuditUnderPlannedImageBatch({ response, freshUploadUrls, currentMessage })
    && hasIndependentBatchIntent(currentMessage, freshUploadUrls.length)
  ) {
    const error = new Error('图片规划未完整覆盖本轮多图需求，请重试或明确每张图的处理方式。');
    error.code = 'image_plan_under_planned';
    throw error;
  }

  const maxToolRounds = Number(process.env.AGENT_TOOL_MAX_ROUNDS || 5);
  let rounds = 0;
  const imagePlans = [];
  const imageResultUrls = [];
  const providerTaskIds = [];
  let imagePlan = null;
  let selectedModel = response.modelUsed || '';
  while (response.finishReason === 'tool_calls' && response.toolCalls?.length && rounds < maxToolRounds) {
    rounds += 1;
    if (response.modelUsed) selectedModel = response.modelUsed;
    const toolCalls = dedupeExactDuplicateToolCalls(
      response.toolCalls.filter((item) => ['generate_image', 'search_knowledge'].includes(item.name))
    );
    const callsToExecute = toolCalls.length > 0 ? toolCalls : [response.toolCalls[0]];
    for (const call of callsToExecute) {
      const callId = call.id || `call_${rounds}_${callsToExecute.indexOf(call) + 1}`;
      emit('tool_calling', { tool: call.name, args: call.args });

      let toolResultContent = '';
      if (call.name === 'search_knowledge') {
        try {
          const { query } = normalizeSearchKnowledgeArgs(call.args);
          emit('searching_knowledge', { query });
          const chunks = typeof searchKnowledge === 'function' ? await searchKnowledge(query) : [];
          toolResultContent = formatKnowledgeToolOutput(chunks);
        } catch (error) {
          toolResultContent = `知识库检索失败: ${error?.message || '未知错误'}。请据此向用户说明,不要编造。`;
        }
      } else if (call.name === 'generate_image') {
        let normalized;
        try {
          normalized = normalizeGenerateImageArgs(call.args);
        } catch {
          toolResultContent = '生图参数无效。请向用户追问更明确的图片需求。';
        }
        if (normalized) {
          const validInputUrls = normalized.inputImageUrls.filter((url) => isUrlInCatalog(catalog, url));
          emit('image_generating', { model: selectedImageModel });
          try {
            const result = await generateImage({
              prompt: normalized.prompt,
              taskType: normalized.taskType,
              inputImageUrls: validInputUrls,
              aspectRatio: normalized.aspectRatio,
              model: selectedImageModel,
            });
            const imageUrl = String(result?.imageUrl || '').trim();
            const providerTaskId = String(result?.providerTaskId || '').trim();
            toolResultContent = imageUrl
              ? '图片已生成成功。图片已作为对话附件返回给用户，请用一句话向用户说明生成结果，不要输出图片 URL。'
              : '图片生成返回为空。请向用户说明生成失败。';
            if (imageUrl) {
              emit('image_ready', { imageUrl });
              const plan = {
                requestMode: 'tool_calling',
                taskType: normalized.taskType,
                selectedImageModel,
                inputImageUrls: validInputUrls,
                prompt: normalized.prompt,
                size: normalized.aspectRatio,
                providerTaskId,
              };
              imagePlans.push(plan);
              imageResultUrls.push(imageUrl);
              if (providerTaskId) providerTaskIds.push(providerTaskId);
              imagePlan = buildAggregatedImagePlan({ plans: imagePlans, imageResultUrls, providerTaskIds });
            }
          } catch (error) {
            toolResultContent = `图片生成失败：${error?.message || '未知错误'}。请向用户说明失败原因，不要假装已生成。`;
          }
        }
      } else {
        toolResultContent = `不支持的工具: ${call.name || 'unknown'}。`;
      }

      messages.push(buildFunctionCallInputItem(call, callId));
      messages.push(buildFunctionCallOutput(callId, toolResultContent));
    }

    try {
      response = await callModel({
        messages,
        tools,
        toolChoice: 'auto',
        maxTokens: contextLimits.maxOutputTokens,
        onDelta: (delta) => emit('streaming', { delta }),
      });
    } catch (error) {
      if (imageResultUrls.length > 0) {
        emit('done', { recovered: true, finalReplyErrorMessage: error?.message || '模型总结失败' });
        return {
          content: buildImageGeneratedFallbackReply(error),
          imagePlan,
          imageResultUrls: imageResultUrls.slice(),
          selectedModel,
          finishReason: 'image_ready_final_reply_failed',
          finalReplyErrorMessage: error?.message || '',
        };
      }
      throw error;
    }
  }
  if (response.modelUsed) selectedModel = response.modelUsed;
  emit('done', {});
  return {
    content: response.content || (imagePlan ? '已为你生成图片。' : '抱歉，我没能完成这次工具调用。'),
    imagePlan,
    imageResultUrls: imageResultUrls.length > 0 ? imageResultUrls.slice() : null,
    selectedModel,
    finishReason: 'stop',
  };
};
