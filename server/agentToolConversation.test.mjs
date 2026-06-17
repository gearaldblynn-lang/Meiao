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

const findToolOutputMessage = (messages = []) => (
  messages.find((message) => message.role === 'tool' || message.type === 'function_call_output')
);

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

test('生图工具结果不把图片 URL 暴露给模型正文', async () => {
  let round = 0;
  await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '画只橘猫',
    callModel: async ({ messages }) => {
      round += 1;
      if (round === 1) {
        return { content: '', toolCalls: [{ id: 'c1', name: 'generate_image', args: { prompt: '橘猫', task_type: 'new_image' } }], finishReason: 'tool_calls' };
      }
      const toolMsg = findToolOutputMessage(messages);
      const toolText = String(toolMsg?.content || toolMsg?.output || '');
      assert.doesNotMatch(toolText, /https?:\/\//);
      assert.match(toolText, /不要输出图片 URL/);
      return { content: '已生成图片', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'https://tempfile.aiquickdraw.com/images/cat.png', providerTaskId: 't1' }),
    onProgress: () => {},
  });
});

test('Responses HTTP 二次请求在 function_call_output 前保留原 function_call item', async () => {
  let round = 0;
  await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '画一个拉布拉多',
    callModel: async ({ messages }) => {
      round += 1;
      if (round === 1) {
        return {
          content: '',
          toolCalls: [{
            id: 'call_img_1',
            name: 'generate_image',
            args: { prompt: '拉布拉多', task_type: 'new_image' },
            responseItem: {
              type: 'function_call',
              id: 'fc_img_1',
              call_id: 'call_img_1',
              name: 'generate_image',
              arguments: '{"prompt":"拉布拉多","task_type":"new_image"}',
              status: 'completed',
            },
          }],
          finishReason: 'tool_calls',
        };
      }
      const functionCallIndex = messages.findIndex((message) => message.type === 'function_call');
      const outputIndex = messages.findIndex((message) => message.type === 'function_call_output');
      assert.ok(functionCallIndex >= 0, '二次请求必须带回原始 function_call item');
      assert.equal(outputIndex, functionCallIndex + 1, 'function_call_output 必须紧跟对应 function_call');
      assert.equal(messages[functionCallIndex].id, 'fc_img_1');
      assert.equal(messages[functionCallIndex].call_id, 'call_img_1');
      assert.equal(messages[outputIndex].call_id, 'call_img_1');
      return { content: '已为你生成拉布拉多图片', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'https://img/dog.png', providerTaskId: 't1' }),
    onProgress: () => {},
  });
});

test('Responses HTTP 二次请求缺原始 item 时用 tool call 参数构造 function_call item', async () => {
  let round = 0;
  await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '画一个拉布拉多',
    callModel: async ({ messages }) => {
      round += 1;
      if (round === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'call_img_2', name: 'generate_image', args: { prompt: '拉布拉多', task_type: 'new_image' } }],
          finishReason: 'tool_calls',
        };
      }
      const functionCall = messages.find((message) => message.type === 'function_call');
      const output = messages.find((message) => message.type === 'function_call_output');
      assert.equal(functionCall?.call_id, 'call_img_2');
      assert.equal(functionCall?.name, 'generate_image');
      assert.equal(functionCall?.arguments, '{"prompt":"拉布拉多","task_type":"new_image"}');
      assert.equal(output?.call_id, 'call_img_2');
      return { content: '已为你生成拉布拉多图片', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'https://img/dog.png', providerTaskId: 't1' }),
    onProgress: () => {},
  });
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
      const toolMsg = findToolOutputMessage(messages);
      assert.match(String(toolMsg?.content || toolMsg?.output || ''), /失败|error/i);
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

test('本轮上传图：附进用户消息(多模态) + system 引导优先编辑新上传图', async () => {
  let capturedMessages = null;
  await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '把这张图上的文字改成韩文',
    attachments: [{ kind: 'image', url: 'https://upload/photo.jpg', name: '照片.jpg' }],
    // 历史里有一张之前生成的图（容易被模型误选）
    priorMessages: [
      { role: 'assistant', content: '已生成', metadata: { imageUrl: 'https://gen/old-cat.png', imagePlan: { inputImageUrls: [] } } },
    ],
    callModel: async ({ messages }) => {
      capturedMessages = messages;
      return { content: '', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    onProgress: () => {},
  });
  // 用户消息必须是多模态数组，且含上传图的 image_url（模型能"看到"）
  const userMsg = capturedMessages.find((m) => m.role === 'user');
  assert.ok(Array.isArray(userMsg.content), '用户消息应为多模态数组');
  const imgPart = userMsg.content.find((p) => p.type === 'image_url');
  assert.equal(imgPart?.image_url?.url, 'https://upload/photo.jpg');
  // system 提示必须出现"优先用新上传图做 edit"的引导 + 该 URL
  const sysText = capturedMessages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.match(sysText, /新上传/);
  assert.match(sysText, /https:\/\/upload\/photo\.jpg/);
});

test('无上传图时：用户消息退化为纯文本字符串', async () => {
  let capturedMessages = null;
  await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '你好',
    attachments: [],
    callModel: async ({ messages }) => {
      capturedMessages = messages;
      return { content: 'hi', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    onProgress: () => {},
  });
  const userMsg = capturedMessages.find((m) => m.role === 'user');
  assert.equal(userMsg.content, '你好');
});

test('动态注入: 绑知识库才有 search_knowledge, 启用才有 web_search', async () => {
  let toolsSeen = null;
  await runAgentConversationV2({
    ...baseArgs,
    hasKnowledgeBase: true,
    webSearchEnabled: true,
    callModel: async ({ tools }) => {
      toolsSeen = tools;
      return { content: 'ok', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    searchKnowledge: async () => [],
    onProgress: () => {},
  });
  const names = toolsSeen.map((tool) => tool.function?.name || tool.type);
  assert.ok(names.includes('generate_image'));
  assert.ok(names.includes('search_knowledge'));
  assert.ok(names.includes('web_search'));
});

test('没绑知识库: 不注入 search_knowledge', async () => {
  let toolsSeen = null;
  await runAgentConversationV2({
    ...baseArgs,
    hasKnowledgeBase: false,
    webSearchEnabled: false,
    callModel: async ({ tools }) => {
      toolsSeen = tools;
      return { content: 'ok', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    searchKnowledge: async () => [],
    onProgress: () => {},
  });
  const names = toolsSeen.map((tool) => tool.function?.name || tool.type);
  assert.ok(!names.includes('search_knowledge'));
  assert.ok(!names.includes('web_search'));
});

test('search_knowledge 调用: 执行检索 -> 结果回传 -> 模型作答', async () => {
  let round = 0;
  const progress = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    hasKnowledgeBase: true,
    currentMessage: '退货政策是什么',
    callModel: async ({ messages }) => {
      round += 1;
      if (round === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_knowledge', args: { query: '退货政策' } }],
          finishReason: 'tool_calls',
        };
      }
      const toolMsg = findToolOutputMessage(messages);
      assert.ok(JSON.stringify(toolMsg).includes('7天无理由'));
      return { content: '退货政策: 7天无理由', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    searchKnowledge: async (query) => {
      assert.equal(query, '退货政策');
      return [{ content: '7天无理由退货', documentTitle: '售后' }];
    },
    onProgress: (event) => progress.push(event.stage),
  });
  assert.match(out.content, /7天无理由/);
  assert.ok(progress.includes('searching_knowledge'));
});

test('search_knowledge 失败: 回传错误, 模型仍能回复', async () => {
  let round = 0;
  const out = await runAgentConversationV2({
    ...baseArgs,
    hasKnowledgeBase: true,
    currentMessage: 'x',
    callModel: async () => {
      round += 1;
      if (round === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_knowledge', args: { query: 'x' } }],
          finishReason: 'tool_calls',
        };
      }
      return { content: '抱歉暂时查不到', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    searchKnowledge: async () => {
      throw new Error('检索服务挂了');
    },
    onProgress: () => {},
  });
  assert.match(out.content, /查不到|抱歉/);
});
