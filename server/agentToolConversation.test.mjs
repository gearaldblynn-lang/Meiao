import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentConversationV2 } from './agentToolConversation.mjs';

const baseArgs = {
  systemPrompt: '你是助手',
  summary: '',
  recentMessages: [],
  currentMessage: '你好',
  attachments: [],
  priorMessages: [],
  imageGenerationEnabled: true,
  imageMode: false,
  selectedImageModel: 'gpt-image-2',
  maxInputImages: 16,
  contextLimits: { maxOutputTokens: 4096 },
};

test('纯对话：模型 finish=stop，不触发出图', async () => {
  const progress = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    callModel: async () => ({ content: '你好呀', toolCalls: [], finishReason: 'stop' }),
    generateImage: async () => { throw new Error('不该调出图'); },
    onProgress: (event) => progress.push(event.stage),
  });
  assert.equal(out.content, '你好呀');
  assert.equal(out.imagePlan, null);
  assert.ok(progress.includes('done'));
  assert.ok(!progress.includes('image_generating'));
});

test('生图：模型返回 tool_calls → 出图 → 二次回复', async () => {
  const progress = [];
  let round = 0;
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '画只橘猫',
    callModel: async () => {
      round += 1;
      if (round === 1) return { content: '', toolCalls: [{ id: 'c1', name: 'generate_image', args: { prompt: '橘猫', task_type: 'new_image' } }], finishReason: 'tool_calls' };
      return { content: '已为你生成橘猫图片', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async ({ prompt, taskType }) => {
      assert.equal(prompt, '橘猫');
      assert.equal(taskType, 'new_image');
      return { imageUrl: 'https://img/cat.png', providerTaskId: 't1' };
    },
    onProgress: (event) => progress.push(event.stage),
  });
  assert.equal(out.content, '已为你生成橘猫图片');
  assert.equal(out.imagePlan.taskType, 'new_image');
  assert.deepEqual(out.imageResultUrls, ['https://img/cat.png']);
  assert.ok(progress.includes('tool_calling'));
  assert.ok(progress.includes('image_generating'));
  assert.ok(progress.includes('image_ready'));
});

test('imageGenerationEnabled=false：不传 tools，纯对话', async () => {
  let toolsPassed = null;
  await runAgentConversationV2({
    ...baseArgs,
    imageGenerationEnabled: false,
    callModel: async ({ tools }) => {
      toolsPassed = tools;
      return { content: 'ok', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => { throw new Error('no'); },
    onProgress: () => {},
  });
  assert.ok(!toolsPassed || toolsPassed.length === 0);
});

test('生图模式 imageMode=true：system prompt 含引导语', async () => {
  let sysContent = '';
  await runAgentConversationV2({
    ...baseArgs,
    imageMode: true,
    callModel: async ({ messages }) => {
      sysContent = messages.find((message) => message.role === 'system')?.content || '';
      return { content: 'ok', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    onProgress: () => {},
  });
  assert.match(sysContent, /生图模式|需求不够明确|先追问/);
});

test('出图失败：tool result 带 error，模型仍能回复', async () => {
  let round = 0;
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '画猫',
    callModel: async ({ messages }) => {
      round += 1;
      if (round === 1) return { content: '', toolCalls: [{ id: 'c1', name: 'generate_image', args: { prompt: '猫', task_type: 'new_image' } }], finishReason: 'tool_calls' };
      const toolMsg = messages.find((message) => message.role === 'tool');
      assert.match(String(toolMsg?.content || ''), /失败|error/i);
      return { content: '抱歉，图片生成失败了', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => { throw new Error('KIE 余额不足'); },
    onProgress: () => {},
  });
  assert.match(out.content, /失败/);
  assert.equal(out.imageResultUrls, null);
});

test('edit_image：校验 input_image_urls 在目录中，剔除幻觉 URL', async () => {
  const priorMessages = [{ role: 'user', attachments: [{ kind: 'image', url: 'https://real/1.jpg', name: '图' }] }];
  let capturedUrls = null;
  await runAgentConversationV2({
    ...baseArgs,
    priorMessages,
    currentMessage: '把这张图换个背景',
    callModel: async () => ({ content: '', toolCalls: [{ id: 'c1', name: 'generate_image', args: { prompt: '换背景', task_type: 'edit_image', input_image_urls: ['https://real/1.jpg', 'https://幻觉/x.png'] } }], finishReason: 'tool_calls' }),
    generateImage: async ({ inputImageUrls }) => {
      capturedUrls = inputImageUrls;
      return { imageUrl: 'https://img/r.png' };
    },
    onProgress: () => {},
  });
  assert.deepEqual(capturedUrls, ['https://real/1.jpg']);
});

test('一条消息最多触发一次出图（不允许连续多次）', async () => {
  let genCount = 0;
  await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '画猫再画狗',
    callModel: async () => ({ content: '', toolCalls: [
      { id: 'c1', name: 'generate_image', args: { prompt: '猫', task_type: 'new_image' } },
      { id: 'c2', name: 'generate_image', args: { prompt: '狗', task_type: 'new_image' } },
    ], finishReason: 'tool_calls' }),
    generateImage: async () => {
      genCount += 1;
      return { imageUrl: `https://img/${genCount}.png` };
    },
    onProgress: () => {},
  });
  assert.equal(genCount, 1);
});
