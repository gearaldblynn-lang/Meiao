const normalizeProviderTaskId = (value) => String(value || '').trim();

const normalizeImageResultUrls = (value) => (
  Array.isArray(value)
    ? value.map((url) => String(url || '').trim()).filter(Boolean)
    : []
);

const buildCheckpointContextTrace = ({
  contextTraceBase = {},
  requestMode = 'chat',
  imageKnowledgeChunkCount = 0,
  retrievalSummary = [],
  useRetrievalCount = false,
}) => ({
  ...contextTraceBase,
  knowledgeChunkCount: requestMode === 'image_generation'
    ? Number(imageKnowledgeChunkCount || 0)
    : useRetrievalCount && Array.isArray(retrievalSummary)
      ? retrievalSummary.length
      : 0,
});

const buildFallbackImagePlan = (checkpointResult, providerTaskId) => ({
  requestMode: 'tool_calling',
  taskType: checkpointResult.taskType || 'image_generate',
  selectedImageModel: checkpointResult.selectedModel || '',
  inputImageUrls: Array.isArray(checkpointResult.inputImageUrls) ? checkpointResult.inputImageUrls : [],
  prompt: checkpointResult.prompt || '',
  size: checkpointResult.size || 'auto',
  providerTaskId,
});

export const buildSubmittedImageTaskCheckpoint = ({
  checkpointResult = {},
  pendingUserMetadata = {},
  pendingAssistantMetadata = {},
  contextTraceBase = {},
  requestMode = 'chat',
  imageKnowledgeChunkCount = 0,
} = {}) => {
  const providerTaskId = normalizeProviderTaskId(checkpointResult.providerTaskId);
  if (!providerTaskId) return null;

  const imagePlan = checkpointResult.imagePlan || buildFallbackImagePlan(checkpointResult, providerTaskId);
  const contextTrace = buildCheckpointContextTrace({
    contextTraceBase,
    requestMode,
    imageKnowledgeChunkCount,
  });

  const userMetadata = {
    ...pendingUserMetadata,
    status: 'pending',
    pending: true,
    phase: 'submitted',
    contextTrace,
  };
  const assistantMetadata = {
    ...pendingAssistantMetadata,
    selectedModel: checkpointResult.selectedModel || pendingAssistantMetadata.selectedModel,
    status: 'pending',
    pending: true,
    progress: true,
    phase: 'image_generating',
    progressStage: 'image_generating',
    contextTrace,
    imagePlan,
    imageResultUrls: null,
    retrievalSummary: [],
    providerTaskId,
    checkpoint: 'image_task_submitted',
  };

  return {
    providerTaskId,
    imagePlan,
    latestCheckpoint: { providerTaskId, imagePlan },
    userMetadata,
    assistantMetadata,
    assistantContent: checkpointResult.content || '图片任务已提交，正在生成中。',
  };
};

export const buildReadyImageCheckpoint = ({
  checkpointResult = {},
  pendingUserMetadata = {},
  pendingAssistantMetadata = {},
  contextTraceBase = {},
  requestMode = 'chat',
  imageKnowledgeChunkCount = 0,
} = {}) => {
  const imageResultUrls = normalizeImageResultUrls(checkpointResult.imageResultUrls);
  if (imageResultUrls.length === 0) return null;

  const retrievalSummary = Array.isArray(checkpointResult.retrievalSummary)
    ? checkpointResult.retrievalSummary
    : [];
  const contextTrace = buildCheckpointContextTrace({
    contextTraceBase,
    requestMode,
    imageKnowledgeChunkCount,
    retrievalSummary,
    useRetrievalCount: true,
  });
  const imagePlan = checkpointResult.imagePlan || null;
  const providerTaskId = checkpointResult.providerTaskId || imagePlan?.providerTaskId || '';

  const userMetadata = {
    ...pendingUserMetadata,
    status: 'completed',
    pending: false,
    phase: 'submitted',
    contextTrace,
  };
  const assistantMetadata = {
    ...pendingAssistantMetadata,
    selectedModel: checkpointResult.selectedModel || pendingAssistantMetadata.selectedModel,
    fallbackFrom: checkpointResult.fallbackFrom || null,
    usedRetrieval: Boolean(checkpointResult.usedRetrieval),
    status: 'completed',
    pending: false,
    progress: false,
    phase: 'completed',
    progressStage: 'image_ready',
    contextTrace,
    imagePlan,
    imageResultUrls,
    retrievalSummary,
    providerTaskId,
    checkpoint: 'image_result_ready',
  };

  return {
    imageResultUrls,
    userMetadata,
    assistantMetadata,
    assistantContent: checkpointResult.content || '图片已生成完成。',
  };
};
