import { GENERATE_IMAGE_TOOL, normalizeGenerateImageArgs } from './imageToolDefinition.mjs';
import { SEARCH_KNOWLEDGE_TOOL, normalizeSearchKnowledgeArgs } from './knowledgeToolDefinition.mjs';
import { buildSessionImageCatalog, formatCatalogForPrompt, isUrlInCatalog } from './conversationImageCatalog.mjs';

const IMAGE_MODE_GUIDANCE = [
  '你正处于生图模式。用户希望你帮助生成或修改图片。',
  '- 如果用户需求清晰（有明确的主体、风格或修改要求），直接调用 generate_image 工具',
  '- 先判断本轮生图的输入输出拓扑，再决定工具调用方式：text_to_single_image、text_to_multi_image、single_input_single_output、multi_input_single_output、multi_input_multi_output',
  '- multi_input_single_output：多张输入共同生成一张结果，例如融合、合成、参考、迁移局部信息、同一画面等，只调用一次 generate_image，并把相关输入图一起传入',
  '- multi_input_multi_output：多张输入分别生成多张结果，每个目标输出分别调用一次 generate_image，并让每次 input_image_urls 只包含该输出需要的输入图',
  '- single_input_single_output：一张输入编辑成一张结果，只调用一次 generate_image',
  '- text_to_single_image / text_to_multi_image：无输入图时按用户语义决定生成一张还是多张',
  '- 如果需求不够明确（缺少关键信息），先追问用户，不要猜测生图',
  '- 你可以结合对话上下文理解"继续调整""按上一版改"等指代',
].join('\n');

const hasExplicitHistoryCarryoverIntent = (text = '') => (
  /继续|再改|上一版|上一张|刚才|前面|上面|上文|历史|沿用|基于之前|基于上次|参考上(?:一)?轮|按(?:照)?(?:刚才|上次|上一版|之前)/i.test(String(text || ''))
);

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

const isTransientImageGenerationError = (error) => {
  const code = String(error?.code || error?.cause?.code || '').trim();
  const message = String(error?.message || error?.cause?.message || '');
  if (code === 'account_credit_insufficient') return false;
  return /fetch failed|network|timeout|timed out|ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|bad_response_status_code|502|503|504/i.test(`${code} ${message}`);
};

const isTransientModelCallError = (error) => {
  const code = String(error?.code || error?.cause?.code || '').trim();
  const message = String(error?.message || error?.cause?.message || '');
  if (code === 'provider_bad_response') return false;
  return /fetch failed|network|timeout|timed out|ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|503|504/i.test(`${code} ${message}`);
};

const getImageGenerateTransientMaxRetries = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES || ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
};

const getAgentModelTransientMaxRetries = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.AGENT_MODEL_TRANSIENT_MAX_RETRIES || ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
};

const getAgentImageToolConcurrency = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.AGENT_IMAGE_TOOL_CONCURRENCY || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 5) : 2;
};

const runWithConcurrency = async (items = [], concurrency = 1, worker) => {
  const safeItems = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, safeItems.length || 1));
  const results = new Array(safeItems.length);
  let nextIndex = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < safeItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(safeItems[currentIndex], currentIndex);
    }
  });
  await Promise.all(runners);
  return results;
};

const callModelWithTransientRetry = async ({
  callModel,
  params,
  maxRetries,
  emit,
}) => {
  let transientRetry = 0;
  while (true) {
    let hadDelta = false;
    try {
      return await callModel({
        ...params,
        onDelta: (delta) => {
          hadDelta = true;
          params?.onDelta?.(delta);
        },
      });
    } catch (error) {
      if (hadDelta || !isTransientModelCallError(error) || transientRetry >= maxRetries) throw error;
      transientRetry += 1;
      emit('thinking', {
        retry: 'transient_model_error',
        transientRetry,
      });
    }
  }
};

const generateImageWithTransientRetry = async ({
  generateImage,
  payload,
  maxRetries,
  emit,
  imageAttempt,
}) => {
  let transientRetry = 0;
  while (true) {
    try {
      return await generateImage(payload);
    } catch (error) {
      if (!isTransientImageGenerationError(error) || transientRetry >= maxRetries) throw error;
      transientRetry += 1;
      emit('image_regenerating', {
        attempt: imageAttempt,
        retry: 'transient_generate_error',
        transientRetry,
      });
    }
  }
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
  if (generateCalls.length === 1) {
    const inputUrls = normalizeToolCallImageUrls(generateCalls[0]).map((url) => String(url || '').trim()).filter(Boolean);
    const freshSet = new Set(freshUrls);
    const inputFreshCount = inputUrls.filter((url) => freshSet.has(url)).length;
    if (inputFreshCount === freshUrls.length) return false;
  }
  if (generateCalls.length === 1 && coveredUrls.size === 1) return true;
  return hasIndependentBatchIntent(currentMessage, freshUrls.length) && coveredUrls.size < freshUrls.length;
};

const buildUnderPlannedImageAuditPrompt = ({ currentMessage = '', freshUploadUrls = [], plannedCall = null, attempt = 1 } = {}) => {
  const urls = (Array.isArray(freshUploadUrls) ? freshUploadUrls : [])
    .map((url) => String(url || '').trim())
    .filter(Boolean);
  const plannedInputUrls = normalizeToolCallImageUrls(plannedCall);
  return [
    '请审查上一轮 generate_image 工具调用是否完整覆盖用户语义。只按输入输出拓扑判断，不要按某个具体需求词硬拆。',
    attempt > 1 ? '上一轮审查仍未完整覆盖用户语义；这次必须重新核对所有本轮新上传图片和用户的数量要求。' : '',
    `用户本轮要求是：${String(currentMessage || '').trim()}`,
    `本轮共有 ${urls.length} 张新上传图片。上一轮规划的单图输入图片为：${plannedInputUrls.join(', ') || '空'}`,
    '',
    '可选拓扑只有：',
    '- text_to_single_image：无输入图，输出一张图。',
    '- text_to_multi_image：无输入图，输出多张图。',
    '- single_input_single_output：一张输入图，输出一张图。',
    '- multi_input_single_output：多张输入图共同产出一张图，相关输入图应放在同一次 generate_image 中。',
    '- multi_input_multi_output：多张输入图分别或分组产出多张图，应返回多个 generate_image，并让每个输出覆盖自己的输入图。',
    '',
    '审查规则：',
    '- 如果上一轮工具调用已经符合用户语义拓扑，请不要调用工具，直接回复 PLAN_OK，并简短说明 topology=<上述枚举之一>。',
    '- 如果用户语义是 multi_input_multi_output 且上一轮没有覆盖所有本轮目标图，请重新返回多个 generate_image 工具调用。',
    '- 如果用户语义是 multi_input_single_output，请不要拆成多张；应把相关输入图合在同一次 generate_image。',
    attempt > 1 ? '- 注意：上一轮审查仍未完整覆盖。若拓扑是 multi_input_multi_output，这次不能回复 PLAN_OK，必须返回覆盖所有目标图的多个 generate_image。' : '',
    '- 不要为了凑数量而复制同一个 prompt；只有拓扑确实要求多输出时才返回多个工具调用。',
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

const normalizeCreditsConsumed = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
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

const getRequiredIndependentImageCount = ({ currentMessage = '', freshUploadUrls = [], attemptedIndependentOutputUrls = new Set() } = {}) => (
  attemptedIndependentOutputUrls.size > 1 && hasIndependentBatchIntent(currentMessage, freshUploadUrls.length)
    ? freshUploadUrls.length
    : 0
);

const createImageBatchIncompleteError = ({ requiredImageCount = 0, actualImageCount = 0, imageResultUrls = [] } = {}) => {
  const error = new Error(`图片生成未完整完成：需要 ${requiredImageCount} 张，实际完成 ${actualImageCount} 张。`);
  error.code = 'image_batch_incomplete';
  error.partialImageResultUrls = Array.isArray(imageResultUrls) ? imageResultUrls.slice() : [];
  error.expectedImageCount = requiredImageCount;
  error.actualImageCount = actualImageCount;
  return error;
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
  onImageResultReady = null,
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
  const modelPriorMessages = Array.isArray(priorMessages) ? priorMessages : [];

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
        hasExplicitHistoryCarryoverIntent(currentMessage)
          ? '用户本轮明确提到了继续、参考或沿用上文；可以结合上文理解指代，但仍必须优先核对本轮新上传图。'
          : '新任务边界：本轮有新上传图片且用户没有明确说继续、参考或沿用上文。请把本轮文字和本轮新上传图片视为新的生图任务，不要把上一轮的任务目标、修改要求或失败反馈自动继承到本轮。',
        '如果用户要求"修改/编辑这张图、在图上改文字、换背景"等，必须把本轮新上传图作为 edit_image 的 input_image_urls，URL 如下：',
        ...freshUploadUrls.map((url) => `- ${url}`),
        '不要错用历史生成图（如之前生成的其它图片）当作本次编辑对象，除非用户明确要求基于历史图修改。',
        '除非用户明确说“继续/参考上面/按刚才/沿用上一版”，否则上文只用于理解会话，不得把上一轮的“去字、换背景、加字、失败重试反馈”等目标并入本轮 prompt。',
        '如果本轮只说白底、比例、居中、正面摆放等新目标，不要把上一轮“去文案/去文字”作为本轮任务；抠白底时只处理背景、海报装饰或非产品区域元素，不得删除产品本体标签、包装文字或关键标识，除非本轮明确要求去字。',
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
  const maxAgentModelTransientRetries = getAgentModelTransientMaxRetries(process.env);

  emit('thinking', { round: 1, ...(inlineInitialImages ? {} : hasImageAttachments(attachments) ? { imageInputMode: 'text_image_catalog' } : {}) });
  const callInitialModel = async () => callModelWithTransientRetry({
    callModel,
    maxRetries: maxAgentModelTransientRetries,
    emit,
    params: {
      messages,
      tools,
      toolChoice: tools.length > 0 ? 'auto' : undefined,
      maxTokens: contextLimits.maxOutputTokens,
      onDelta: (delta) => emit('streaming', { delta }),
    },
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
    const repairedResponse = await callModelWithTransientRetry({
      callModel,
      maxRetries: maxAgentModelTransientRetries,
      emit,
      params: {
        messages: repairMessages,
        tools,
        toolChoice: 'auto',
        maxTokens: contextLimits.maxOutputTokens,
        onDelta: (delta) => emit('streaming', { delta }),
      },
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
  const attemptedIndependentOutputUrls = new Set();
  let creditsConsumed = 0;
  let imagePlan = null;
  let selectedModel = response.modelUsed || '';
  const maxImageGenerateTransientRetries = getImageGenerateTransientMaxRetries(process.env);
  while (response.finishReason === 'tool_calls' && response.toolCalls?.length && rounds < maxToolRounds) {
    rounds += 1;
    if (response.modelUsed) selectedModel = response.modelUsed;
    const toolCalls = dedupeExactDuplicateToolCalls(
      response.toolCalls.filter((item) => ['generate_image', 'search_knowledge'].includes(item.name))
    );
    const callsToExecute = toolCalls.length > 0 ? toolCalls : [response.toolCalls[0]];
    const executeToolCall = async (call, callIndex) => {
      const callId = call.id || `call_${rounds}_${callIndex + 1}`;
      emit('tool_calling', { tool: call.name, args: call.args });

      let toolResultContent = '';
      let imageOutput = null;
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
          if (validInputUrls.length === 1 && freshUploadUrls.includes(validInputUrls[0])) {
            attemptedIndependentOutputUrls.add(validInputUrls[0]);
          }
          emit('image_generating', { model: selectedImageModel });
          try {
            let localCreditsConsumed = 0;
            const result = await generateImageWithTransientRetry({
              generateImage,
              payload: {
                prompt: normalized.prompt,
                taskType: normalized.taskType,
                inputImageUrls: validInputUrls,
                aspectRatio: normalized.aspectRatio,
                model: selectedImageModel,
              },
              maxRetries: maxImageGenerateTransientRetries,
              emit,
              imageAttempt: 1,
            });
            localCreditsConsumed += normalizeCreditsConsumed(result?.creditsConsumed);
            const imageUrl = String(result?.imageUrl || '').trim();
            const providerTaskId = String(result?.providerTaskId || '').trim();
            toolResultContent = imageUrl
              ? '图片已生成成功。图片已作为对话附件返回给用户，请用一句话向用户说明生成结果，不要输出图片 URL。'
              : '图片生成返回为空。请向用户说明生成失败。';
            if (imageUrl) {
              imageOutput = {
                imageUrl,
                providerTaskId,
                creditsConsumed: localCreditsConsumed,
                plan: {
                  requestMode: 'tool_calling',
                  taskType: normalized.taskType,
                  selectedImageModel,
                  inputImageUrls: validInputUrls,
                  prompt: normalized.prompt,
                  size: normalized.aspectRatio,
                  providerTaskId,
                  validation: null,
                },
              };
            }
          } catch (error) {
            if (error?.code === 'account_credit_insufficient') throw error;
            toolResultContent = `图片生成失败：${error?.message || '未知错误'}。请向用户说明失败原因，不要假装已生成。`;
          }
        }
      } else {
        toolResultContent = `不支持的工具: ${call.name || 'unknown'}。`;
      }

      return { call, callId, toolResultContent, imageOutput };
    };

    const canRunImageToolsConcurrently = callsToExecute.length > 1
      && callsToExecute.every((call) => call.name === 'generate_image');
    const toolExecutionConcurrency = canRunImageToolsConcurrently
      ? getAgentImageToolConcurrency(process.env)
      : 1;
    const toolResults = new Array(callsToExecute.length);
    let nextToolResultToAppend = 0;
    let appendToolResultChain = Promise.resolve();
    const appendReadyToolResults = async () => {
      while (toolResults[nextToolResultToAppend]) {
        const execution = toolResults[nextToolResultToAppend];
        nextToolResultToAppend += 1;
        messages.push(buildFunctionCallInputItem(execution.call, execution.callId));
        messages.push(buildFunctionCallOutput(execution.callId, execution.toolResultContent));
        if (execution.imageOutput?.imageUrl) {
          const { imageUrl, providerTaskId, plan, creditsConsumed: imageCreditsConsumed } = execution.imageOutput;
          creditsConsumed += normalizeCreditsConsumed(imageCreditsConsumed);
          emit('image_ready', { imageUrl });
          imagePlans.push(plan);
          imageResultUrls.push(imageUrl);
          if (providerTaskId) providerTaskIds.push(providerTaskId);
          imagePlan = buildAggregatedImagePlan({ plans: imagePlans, imageResultUrls, providerTaskIds });
          if (typeof onImageResultReady === 'function') {
            await onImageResultReady({
              content: '图片已生成完成，正在整理回复。',
              selectedModel: selectedImageModel,
              usedRetrieval: false,
              retrievalSummary: [],
              providerTaskId,
              imagePlan,
              imageResultUrls: imageResultUrls.slice(),
              creditsConsumed,
            });
          }
        }
      }
    };
    await runWithConcurrency(
      callsToExecute,
      toolExecutionConcurrency,
      async (call, callIndex) => {
        const execution = await executeToolCall(call, callIndex);
        toolResults[callIndex] = execution;
        appendToolResultChain = appendToolResultChain.then(appendReadyToolResults);
        await appendToolResultChain;
        return execution;
      },
    );
    await appendToolResultChain;

    try {
      response = await callModelWithTransientRetry({
        callModel,
        maxRetries: maxAgentModelTransientRetries,
        emit,
        params: {
          messages,
          tools,
          toolChoice: 'auto',
          maxTokens: contextLimits.maxOutputTokens,
          onDelta: (delta) => emit('streaming', { delta }),
        },
      });
    } catch (error) {
      if (imageResultUrls.length > 0) {
        const requiredIndependentImageCount = getRequiredIndependentImageCount({
          currentMessage,
          freshUploadUrls,
          attemptedIndependentOutputUrls,
        });
        if (requiredIndependentImageCount > 0 && imageResultUrls.length < requiredIndependentImageCount) {
          throw createImageBatchIncompleteError({
            requiredImageCount: requiredIndependentImageCount,
            actualImageCount: imageResultUrls.length,
            imageResultUrls,
          });
        }
        emit('done', { recovered: true, finalReplyErrorMessage: error?.message || '模型总结失败' });
        return {
          content: buildImageGeneratedFallbackReply(error),
          imagePlan,
          imageResultUrls: imageResultUrls.slice(),
          selectedModel,
          finishReason: 'image_ready_final_reply_failed',
          creditsConsumed,
          finalReplyErrorMessage: error?.message || '',
        };
      }
      throw error;
    }
  }
  if (response.modelUsed) selectedModel = response.modelUsed;
  const requiredIndependentImageCount = getRequiredIndependentImageCount({
    currentMessage,
    freshUploadUrls,
    attemptedIndependentOutputUrls,
  });
  if (requiredIndependentImageCount > 0 && imageResultUrls.length < requiredIndependentImageCount) {
    throw createImageBatchIncompleteError({
      requiredImageCount: requiredIndependentImageCount,
      actualImageCount: imageResultUrls.length,
      imageResultUrls,
    });
  }
  emit('done', {});
  return {
    content: response.content || (imagePlan ? '已为你生成图片。' : '抱歉，我没能完成这次工具调用。'),
    imagePlan,
    imageResultUrls: imageResultUrls.length > 0 ? imageResultUrls.slice() : null,
    selectedModel,
    finishReason: 'stop',
    creditsConsumed,
  };
};
