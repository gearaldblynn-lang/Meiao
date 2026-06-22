import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReadyImageCheckpoint,
  buildSubmittedImageTaskCheckpoint,
} from './agentChatCheckpointMetadata.mjs';

test('buildSubmittedImageTaskCheckpoint normalizes submitted provider task metadata', () => {
  const checkpoint = buildSubmittedImageTaskCheckpoint({
    checkpointResult: {
      providerTaskId: ' task-123 ',
      selectedModel: 'kie-flux',
      inputImageUrls: ['https://example.test/input.png'],
      prompt: 'make image',
      size: '1024x1024',
      content: 'submitted',
    },
    pendingUserMetadata: {
      clientRequestId: 'client-1',
      status: 'pending',
      contextTrace: { old: true },
    },
    pendingAssistantMetadata: {
      selectedModel: 'fallback-model',
      progressStage: 'thinking',
    },
    contextTraceBase: { requestId: 'run-1' },
    requestMode: 'image_generation',
    imageKnowledgeChunkCount: 3,
  });

  assert.equal(checkpoint.providerTaskId, 'task-123');
  assert.equal(checkpoint.assistantContent, 'submitted');
  assert.deepEqual(checkpoint.latestCheckpoint, {
    providerTaskId: 'task-123',
    imagePlan: {
      requestMode: 'tool_calling',
      taskType: 'image_generate',
      selectedImageModel: 'kie-flux',
      inputImageUrls: ['https://example.test/input.png'],
      prompt: 'make image',
      size: '1024x1024',
      providerTaskId: 'task-123',
    },
  });
  assert.deepEqual(checkpoint.userMetadata, {
    clientRequestId: 'client-1',
    status: 'pending',
    contextTrace: { requestId: 'run-1', knowledgeChunkCount: 3 },
    pending: true,
    phase: 'submitted',
  });
  assert.deepEqual(checkpoint.assistantMetadata, {
    selectedModel: 'kie-flux',
    progressStage: 'image_generating',
    status: 'pending',
    pending: true,
    progress: true,
    phase: 'image_generating',
    contextTrace: { requestId: 'run-1', knowledgeChunkCount: 3 },
    imagePlan: checkpoint.latestCheckpoint.imagePlan,
    imageResultUrls: null,
    retrievalSummary: [],
    providerTaskId: 'task-123',
    checkpoint: 'image_task_submitted',
  });
});

test('buildSubmittedImageTaskCheckpoint skips empty provider task ids', () => {
  assert.equal(buildSubmittedImageTaskCheckpoint({
    checkpointResult: { providerTaskId: '   ' },
    pendingUserMetadata: {},
    pendingAssistantMetadata: {},
    contextTraceBase: {},
  }), null);
});

test('buildReadyImageCheckpoint normalizes completed image metadata', () => {
  const checkpoint = buildReadyImageCheckpoint({
    checkpointResult: {
      imageResultUrls: [' https://example.test/a.png ', '', 'https://example.test/b.png'],
      imagePlan: { providerTaskId: 'plan-task', selectedImageModel: 'plan-model' },
      retrievalSummary: [{ id: 'chunk-1' }, { id: 'chunk-2' }],
      selectedModel: 'ready-model',
      fallbackFrom: 'backup-model',
      usedRetrieval: true,
      content: 'ready',
    },
    pendingUserMetadata: {
      clientRequestId: 'client-2',
      status: 'pending',
    },
    pendingAssistantMetadata: {
      selectedModel: 'fallback-model',
      progressStage: 'thinking',
    },
    contextTraceBase: { requestId: 'run-2' },
    requestMode: 'chat',
    imageKnowledgeChunkCount: 10,
  });

  assert.deepEqual(checkpoint.imageResultUrls, [
    'https://example.test/a.png',
    'https://example.test/b.png',
  ]);
  assert.equal(checkpoint.assistantContent, 'ready');
  assert.deepEqual(checkpoint.userMetadata, {
    clientRequestId: 'client-2',
    status: 'completed',
    pending: false,
    phase: 'submitted',
    contextTrace: { requestId: 'run-2', knowledgeChunkCount: 2 },
  });
  assert.deepEqual(checkpoint.assistantMetadata, {
    selectedModel: 'ready-model',
    progressStage: 'image_ready',
    fallbackFrom: 'backup-model',
    usedRetrieval: true,
    status: 'completed',
    pending: false,
    progress: false,
    phase: 'completed',
    contextTrace: { requestId: 'run-2', knowledgeChunkCount: 2 },
    imagePlan: { providerTaskId: 'plan-task', selectedImageModel: 'plan-model' },
    imageResultUrls: [
      'https://example.test/a.png',
      'https://example.test/b.png',
    ],
    retrievalSummary: [{ id: 'chunk-1' }, { id: 'chunk-2' }],
    providerTaskId: 'plan-task',
    checkpoint: 'image_result_ready',
  });
});

test('buildReadyImageCheckpoint skips empty image results', () => {
  assert.equal(buildReadyImageCheckpoint({
    checkpointResult: { imageResultUrls: ['', '   '] },
    pendingUserMetadata: {},
    pendingAssistantMetadata: {},
    contextTraceBase: {},
  }), null);
});
