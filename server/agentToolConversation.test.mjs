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
      return { imageUrl: 'https://img/cat.png', providerTaskId: 't1', creditsConsumed: 2.5 };
    },
    onProgress: (event) => progress.push(event.stage),
  });
  assert.equal(out.content, '已为你生成橘猫图片');
  assert.equal(out.imagePlan.taskType, 'new_image');
  assert.deepEqual(out.imageResultUrls, ['https://img/cat.png']);
  assert.equal(out.creditsConsumed, 2.5);
  assert.ok(progress.includes('tool_calling'));
  assert.ok(progress.includes('image_generating'));
  assert.ok(progress.includes('image_ready'));
});

test('生图已成功但最终文案模型失败时：保留图片结果并降级回复', async () => {
  const progress = [];
  let round = 0;
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '画只白猫',
    callModel: async () => {
      round += 1;
      if (round === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'c1', name: 'generate_image', args: { prompt: '白猫', task_type: 'new_image' } }],
          finishReason: 'tool_calls',
          modelUsed: 'gpt-5.5',
        };
      }
      const error = new Error('responses 请求失败 (502): bad_response_status_code');
      error.code = 'provider_bad_response';
      throw error;
    },
    generateImage: async ({ prompt, taskType }) => {
      assert.equal(prompt, '白猫');
      assert.equal(taskType, 'new_image');
      return { imageUrl: 'https://img/white-cat.png', providerTaskId: 'kie-task-1', creditsConsumed: 3.75 };
    },
    onProgress: (event) => progress.push(event),
  });
  assert.match(out.content, /图片已生成完成/);
  assert.deepEqual(out.imageResultUrls, ['https://img/white-cat.png']);
  assert.equal(out.imagePlan.providerTaskId, 'kie-task-1');
  assert.equal(out.selectedModel, 'gpt-5.5');
  assert.equal(out.finishReason, 'image_ready_final_reply_failed');
  assert.equal(out.creditsConsumed, 3.75);
  assert.match(out.finalReplyErrorMessage, /502/);
  assert.ok(progress.some((event) => event.stage === 'image_ready'));
  assert.ok(progress.some((event) => event.stage === 'done' && event.recovered));
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

test('模型同一轮返回多个 generate_image 时：逐个执行并返回多张结果', async () => {
  let genCount = 0;
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '每张图都按同一个明确要求分别处理',
    attachments: [
      { kind: 'image', url: 'https://upload/1.jpg', name: '1.jpg' },
      { kind: 'image', url: 'https://upload/2.jpg', name: '2.jpg' },
    ],
    callModel: async ({ messages }) => {
      if (genCount === 0) {
        return { content: '', toolCalls: [
          { id: 'c1', name: 'generate_image', args: { prompt: '对第一张图执行用户指定编辑', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
          { id: 'c2', name: 'generate_image', args: { prompt: '对第二张图执行用户指定编辑', task_type: 'edit_image', input_image_urls: ['https://upload/2.jpg'] } },
        ], finishReason: 'tool_calls' };
      }
      const outputs = messages.filter((message) => message.type === 'function_call_output');
      assert.equal(outputs.length, 2);
      assert.deepEqual(outputs.map((item) => item.call_id), ['c1', 'c2']);
      return { content: '两张图都已按要求分别处理', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async ({ prompt, inputImageUrls }) => {
      genCount += 1;
      assert.match(prompt, genCount === 1 ? /第一张/ : /第二张/);
      assert.deepEqual(inputImageUrls, [`https://upload/${genCount}.jpg`]);
      return { imageUrl: `https://img/${genCount}.png`, creditsConsumed: genCount === 1 ? 1.25 : 1.75 };
    },
    onProgress: () => {},
  });
  assert.equal(genCount, 2);
  assert.deepEqual(out.imageResultUrls, ['https://img/1.png', 'https://img/2.png']);
  assert.equal(out.creditsConsumed, 3);
  assert.equal(out.imagePlan.requestMode, 'tool_calling');
  assert.equal(out.imagePlan.outputCount, 2);
  assert.equal(out.imagePlan.plans.length, 2);
});

test('生图结果质检不通过时按反馈重试，不把错误图标记为完成', async () => {
  let generateCount = 0;
  const validations = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '都做成白底图，1:1的比例，正面摆放',
    attachments: [{ kind: 'image', url: 'https://upload/humidifier.jpg', name: '图2.jpg' }],
    callModel: async ({ messages }) => {
      const outputs = messages.filter((message) => message.type === 'function_call_output');
      if (outputs.length > 0) {
        assert.match(String(outputs[0].output || ''), /图片已生成成功/);
        return { content: '已完成', toolCalls: [], finishReason: 'stop' };
      }
      return {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'generate_image', args: { prompt: '把黑色加湿器做成白底主图', task_type: 'edit_image', input_image_urls: ['https://upload/humidifier.jpg'] } },
        ],
        finishReason: 'tool_calls',
      };
    },
    generateImage: async ({ prompt, inputImageUrls }) => {
      generateCount += 1;
      assert.deepEqual(inputImageUrls, ['https://upload/humidifier.jpg']);
      if (generateCount === 2) assert.match(prompt, /质检反馈|不是同一个产品/);
      return { imageUrl: `https://img/result-${generateCount}.png`, providerTaskId: `task-${generateCount}` };
    },
    validateImageResult: async ({ sourceImageUrls, resultImageUrl, prompt, attempt }) => {
      validations.push({ sourceImageUrls, resultImageUrl, prompt, attempt });
      if (attempt === 1) {
        return {
          ok: false,
          issues: ['生成结果不是同一个产品，把黑色加湿器错误做成了瓶装产品'],
          revisedPrompt: '必须严格基于输入图中的黑色加湿器重新生成白底图',
        };
      }
      return { ok: true, issues: [] };
    },
    onProgress: () => {},
  });
  assert.equal(generateCount, 2);
  assert.equal(validations.length, 2);
  assert.deepEqual(out.imageResultUrls, ['https://img/result-2.png']);
  assert.equal(out.imagePlan.providerTaskId, 'task-2');
  assert.match(out.imagePlan.prompt, /质检反馈|黑色加湿器/);
});

test('模型重复返回完全相同的 generate_image 时只执行一次，但保留不同 prompt 变体', async () => {
  const generated = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '图1做两个不同版本',
    attachments: [{ kind: 'image', url: 'https://upload/1.jpg', name: '1.jpg' }],
    callModel: async ({ messages }) => {
      const outputs = messages.filter((message) => message.type === 'function_call_output');
      if (outputs.length > 0) return { content: '已处理', toolCalls: [], finishReason: 'stop' };
      return {
        content: '',
        toolCalls: [
          { id: 'a1', name: 'generate_image', args: { prompt: '白底图 A', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
          { id: 'a2', name: 'generate_image', args: { prompt: '白底图 A', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
          { id: 'b1', name: 'generate_image', args: { prompt: '白底图 B', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
        ],
        finishReason: 'tool_calls',
      };
    },
    generateImage: async ({ inputImageUrls, prompt }) => {
      generated.push({ inputImageUrls, prompt });
      return { imageUrl: `https://img/${generated.length}.png` };
    },
    onProgress: () => {},
  });
  assert.deepEqual(generated.map((item) => item.prompt), ['白底图 A', '白底图 B']);
  assert.deepEqual(out.imageResultUrls, ['https://img/1.png', 'https://img/2.png']);
});

test('用户明确要求都处理多张新图时，首轮模型只返回一个单图工具调用会触发二次规划', async () => {
  let modelRound = 0;
  const progress = [];
  const generated = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '都做成白底图，1:1的比例，正面摆放',
    attachments: [
      { kind: 'image', url: 'https://upload/1.jpg', name: '1.jpg' },
      { kind: 'image', url: 'https://upload/2.jpg', name: '2.jpg' },
      { kind: 'image', url: 'https://upload/3.jpg', name: '3.jpg' },
    ],
    callModel: async ({ messages }) => {
      modelRound += 1;
      if (modelRound === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'generate_image', args: { prompt: '只处理了第一张的白底图提示词', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
          ],
          finishReason: 'tool_calls',
        };
      }
      if (modelRound === 2) {
        const repairText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
        assert.match(repairText, /审查/);
        assert.match(repairText, /语义/);
        assert.match(repairText, /3 张/);
        assert.match(repairText, /multi_input_multi_output/);
        assert.match(repairText, /multi_input_single_output/);
        assert.match(repairText, /只按输入输出拓扑判断/);
        return {
          content: '',
          toolCalls: [
            { id: 'r1', name: 'generate_image', args: { prompt: '图1白底图', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
            { id: 'r2', name: 'generate_image', args: { prompt: '图2白底图', task_type: 'edit_image', input_image_urls: ['https://upload/2.jpg'] } },
            { id: 'r3', name: 'generate_image', args: { prompt: '图3白底图', task_type: 'edit_image', input_image_urls: ['https://upload/3.jpg'] } },
          ],
          finishReason: 'tool_calls',
        };
      }
      const outputs = messages.filter((message) => message.type === 'function_call_output');
      assert.equal(outputs.length, 3);
      return { content: '三张图都已处理', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async ({ inputImageUrls, prompt }) => {
      generated.push({ inputImageUrls, prompt });
      return { imageUrl: `https://img/${generated.length}.png` };
    },
    onProgress: (event) => progress.push(event),
  });
  assert.equal(modelRound, 3);
  assert.deepEqual(generated.map((item) => item.inputImageUrls[0]), [
    'https://upload/1.jpg',
    'https://upload/2.jpg',
    'https://upload/3.jpg',
  ]);
  assert.deepEqual(out.imageResultUrls, ['https://img/1.png', 'https://img/2.png', 'https://img/3.png']);
  assert.equal(out.imagePlan.outputCount, 3);
  assert.ok(progress.some((event) => event.repair === 'under_planned_image_batch_audit'));
});

test('用户明确要求都处理多张新图时，审查轮仍未补全会继续修复而不是执行单张', async () => {
  let modelRound = 0;
  const progress = [];
  const generated = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '都做成白底图，1:1的比例，正面摆放',
    attachments: [
      { kind: 'image', url: 'https://upload/1.jpg', name: '1.jpg' },
      { kind: 'image', url: 'https://upload/2.jpg', name: '2.jpg' },
      { kind: 'image', url: 'https://upload/3.jpg', name: '3.jpg' },
    ],
    callModel: async ({ messages }) => {
      modelRound += 1;
      if (modelRound === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'generate_image', args: { prompt: '只处理了第三张的白底图提示词', task_type: 'edit_image', input_image_urls: ['https://upload/3.jpg'] } },
          ],
          finishReason: 'tool_calls',
        };
      }
      if (modelRound === 2) {
        const repairText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
        assert.match(repairText, /审查/);
        return { content: 'PLAN_OK', toolCalls: [], finishReason: 'stop' };
      }
      if (modelRound === 3) {
        const repairText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
        assert.match(repairText, /仍未完整覆盖/);
        return {
          content: '',
          toolCalls: [
            { id: 'r1', name: 'generate_image', args: { prompt: '图1白底图', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
            { id: 'r2', name: 'generate_image', args: { prompt: '图2白底图', task_type: 'edit_image', input_image_urls: ['https://upload/2.jpg'] } },
            { id: 'r3', name: 'generate_image', args: { prompt: '图3白底图', task_type: 'edit_image', input_image_urls: ['https://upload/3.jpg'] } },
          ],
          finishReason: 'tool_calls',
        };
      }
      const outputs = messages.filter((message) => message.type === 'function_call_output');
      assert.equal(outputs.length, 3);
      return { content: '三张图都已处理', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async ({ inputImageUrls, prompt }) => {
      generated.push({ inputImageUrls, prompt });
      return { imageUrl: `https://img/${generated.length}.png` };
    },
    onProgress: (event) => progress.push(event),
  });
  assert.equal(modelRound, 4);
  assert.deepEqual(generated.map((item) => item.inputImageUrls[0]), [
    'https://upload/1.jpg',
    'https://upload/2.jpg',
    'https://upload/3.jpg',
  ]);
  assert.deepEqual(out.imageResultUrls, ['https://img/1.png', 'https://img/2.png', 'https://img/3.png']);
  assert.equal(out.imagePlan.outputCount, 3);
  assert.equal(progress.filter((event) => event.repair === 'under_planned_image_batch_audit').length, 2);
});

test('多张新图但用户只指定其中一张时，审查后保持单张计划', async () => {
  let modelRound = 0;
  let generated = 0;
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '只把图1做成白底图，其他先不要处理',
    attachments: [
      { kind: 'image', url: 'https://upload/1.jpg', name: '1.jpg' },
      { kind: 'image', url: 'https://upload/2.jpg', name: '2.jpg' },
      { kind: 'image', url: 'https://upload/3.jpg', name: '3.jpg' },
    ],
    callModel: async ({ messages }) => {
      modelRound += 1;
      if (modelRound === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'generate_image', args: { prompt: '图1白底图', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg'] } },
          ],
          finishReason: 'tool_calls',
        };
      }
      if (modelRound === 2) {
        const auditText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
        assert.match(auditText, /PLAN_OK/);
        return { content: 'PLAN_OK', toolCalls: [], finishReason: 'stop' };
      }
      return { content: '图1已处理', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async ({ inputImageUrls }) => {
      generated += 1;
      assert.deepEqual(inputImageUrls, ['https://upload/1.jpg']);
      return { imageUrl: 'https://img/only-1.png' };
    },
    onProgress: () => {},
  });
  assert.equal(modelRound, 3);
  assert.equal(generated, 1);
  assert.deepEqual(out.imageResultUrls, ['https://img/only-1.png']);
});

test('参考图替换主图局部时，两张输入图生成一张结果不应被判为多图欠规划', async () => {
  let modelRound = 0;
  let generated = 0;
  const progress = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '把原图1中湿巾上的字母全部换成图2湿巾上面的字母，图1其他部分不发生任何改变，图片格式为800*800',
    attachments: [
      { kind: 'image', url: 'https://upload/main.jpg', name: '图1.jpg' },
      { kind: 'image', url: 'https://upload/ref.jpg', name: '图2.jpg' },
    ],
    callModel: async ({ messages }) => {
      modelRound += 1;
      if (modelRound === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'generate_image',
              args: {
                prompt: '以图1为主图，只把湿巾上的字母替换成图2湿巾上的字母，图1其它部分保持不变，输出800*800',
                task_type: 'edit_image',
                input_image_urls: ['https://upload/main.jpg', 'https://upload/ref.jpg'],
                aspect_ratio: '1:1',
              },
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      const outputs = messages.filter((message) => message.type === 'function_call_output');
      assert.equal(outputs.length, 1);
      return { content: '已按图2字母替换图1湿巾文字', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async ({ inputImageUrls }) => {
      generated += 1;
      assert.deepEqual(inputImageUrls, ['https://upload/main.jpg', 'https://upload/ref.jpg']);
      return { imageUrl: 'https://img/replaced.png' };
    },
    onProgress: (event) => progress.push(event),
  });
  assert.equal(modelRound, 2);
  assert.equal(generated, 1);
  assert.deepEqual(out.imageResultUrls, ['https://img/replaced.png']);
  assert.equal(progress.some((event) => event.repair === 'under_planned_image_batch_audit'), false);
});

test('用户要求合成到同一张图时，单个多图工具调用不会被拆成多张', async () => {
  let generated = 0;
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '把这三张图合成一张海报',
    attachments: [
      { kind: 'image', url: 'https://upload/1.jpg', name: '1.jpg' },
      { kind: 'image', url: 'https://upload/2.jpg', name: '2.jpg' },
      { kind: 'image', url: 'https://upload/3.jpg', name: '3.jpg' },
    ],
    callModel: async ({ messages }) => {
      const outputs = messages.filter((message) => message.type === 'function_call_output');
      if (outputs.length > 0) return { content: '已合成', toolCalls: [], finishReason: 'stop' };
      return {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'generate_image', args: { prompt: '三图合成一张海报', task_type: 'edit_image', input_image_urls: ['https://upload/1.jpg', 'https://upload/2.jpg', 'https://upload/3.jpg'] } },
        ],
        finishReason: 'tool_calls',
      };
    },
    generateImage: async ({ inputImageUrls }) => {
      generated += 1;
      assert.deepEqual(inputImageUrls, ['https://upload/1.jpg', 'https://upload/2.jpg', 'https://upload/3.jpg']);
      return { imageUrl: 'https://img/poster.png' };
    },
    onProgress: () => {},
  });
  assert.equal(generated, 1);
  assert.deepEqual(out.imageResultUrls, ['https://img/poster.png']);
});

test('生图模式引导模型按语义决定单次合成或多次独立调用', async () => {
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
  assert.match(sysContent, /输入输出拓扑/);
  assert.match(sysContent, /multi_input_single_output/);
  assert.match(sysContent, /multi_input_multi_output/);
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

test('首轮 Responses 带图 502 时：用图片目录 URL 文本重试并继续生图', async () => {
  let round = 0;
  const userContents = [];
  let retrySystemText = '';
  const progress = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '都做成白底图，1:1的比例，正面摆放',
    attachments: [
      { kind: 'image', url: 'https://cdn.example.com/api/assets/file/a/1.png', name: '1.png' },
      { kind: 'image', url: 'https://cdn.example.com/api/assets/file/b/2.png', name: '2.png' },
    ],
    callModel: async ({ messages }) => {
      round += 1;
      userContents.push(messages.find((message) => message.role === 'user')?.content);
      if (round === 2) retrySystemText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
      if (round === 1) {
        const error = new Error('responses 请求失败 (502): bad_response_status_code');
        error.code = 'provider_bad_response';
        throw error;
      }
      if (round === 2) {
        return {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'generate_image', args: { prompt: '把图1做成白底图，1:1，正面摆放', task_type: 'edit_image', input_image_urls: ['https://cdn.example.com/api/assets/file/a/1.png'] } },
            { id: 'c2', name: 'generate_image', args: { prompt: '把图2做成白底图，1:1，正面摆放', task_type: 'edit_image', input_image_urls: ['https://cdn.example.com/api/assets/file/b/2.png'] } },
          ],
          finishReason: 'tool_calls',
        };
      }
      return { content: '两张图都已处理', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async ({ inputImageUrls }) => ({
      imageUrl: `https://img/${inputImageUrls[0].endsWith('/1.png') ? '1' : '2'}.png`,
    }),
    onProgress: (event) => progress.push(event),
  });
  assert.ok(Array.isArray(userContents[0]), '第一次仍应尝试多模态图片输入');
  assert.equal(typeof userContents[1], 'string', '重试时应去掉 inline image_url，改用图片目录文本');
  assert.match(userContents[1], /都做成白底图/);
  assert.match(retrySystemText, /不要要求用户重新上传/);
  assert.match(retrySystemText, /当前会话图片目录/);
  assert.deepEqual(out.imageResultUrls, ['https://img/1.png', 'https://img/2.png']);
  assert.ok(progress.some((event) => event.retry === 'text_image_catalog'));
});

test('HTTP 图床图片先转成模型稳定可读的 HTTPS 图床，再作为 inline image 发送给 Responses', async () => {
  let userContent = null;
  let systemText = '';
  let generatedInputUrls = null;
  let round = 0;
  const progress = [];
  const out = await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '都做成白底图',
    attachments: [{ kind: 'image', url: 'http://111.229.66.247/api/assets/file/a/1.png', name: '1.png' }],
    prepareModelImageUrl: async (url) => {
      assert.equal(url, 'http://111.229.66.247/api/assets/file/a/1.png');
      return 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/1.png';
    },
    callModel: async ({ messages }) => {
      round += 1;
      userContent = messages.find((message) => message.role === 'user')?.content;
      systemText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
      if (round > 1) return { content: '已处理', toolCalls: [], finishReason: 'stop' };
      return {
        content: '',
        toolCalls: [{ id: 'c1', name: 'generate_image', args: { prompt: '白底图', task_type: 'edit_image', input_image_urls: ['https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/1.png'] } }],
        finishReason: 'tool_calls',
      };
    },
    generateImage: async ({ inputImageUrls }) => {
      generatedInputUrls = inputImageUrls;
      return { imageUrl: 'https://img/white.png' };
    },
    onProgress: (event) => progress.push(event),
  });
  assert.ok(Array.isArray(userContent), '转成 HTTPS 图床后应作为多模态图片发给模型分析');
  const imagePart = userContent.find((part) => part.type === 'image_url');
  assert.equal(imagePart?.image_url?.url, 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/1.png');
  assert.match(systemText, /https:\/\/tempfile\.redpandaai\.co\/kieai\/30590\/mayo-storage\/internal\/1\.png/);
  assert.deepEqual(generatedInputUrls, ['https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/1.png']);
  assert.deepEqual(out.imageResultUrls, ['https://img/white.png']);
  assert.equal(progress.some((event) => event.imageInputMode === 'text_image_catalog'), false);
});

test('首轮规划只预转存本轮新上传图，不批量转存历史图片', async () => {
  const preparedUrls = [];
  let systemText = '';
  let userContent = null;
  await runAgentConversationV2({
    ...baseArgs,
    currentMessage: '都做成白底图，1:1的比例，正面摆放',
    attachments: [
      { kind: 'image', url: 'http://111.229.66.247/api/assets/file/current/1.png', name: '1.png' },
      { kind: 'image', url: 'http://111.229.66.247/api/assets/file/current/2.png', name: '2.png' },
      { kind: 'image', url: 'http://111.229.66.247/api/assets/file/current/3.png', name: '3.png' },
    ],
    priorMessages: [
      {
        role: 'user',
        attachments: [
          { kind: 'image', url: 'http://111.229.66.247/api/assets/file/history/a.png', name: '历史A.png' },
        ],
      },
      {
        role: 'assistant',
        metadata: {
          imageUrl: 'http://111.229.66.247/api/assets/file/history/generated.png',
          imagePlan: {
            inputImageUrls: ['http://111.229.66.247/api/assets/file/history/a.png'],
          },
        },
      },
    ],
    prepareModelImageUrl: async (url) => {
      preparedUrls.push(url);
      return `https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/${url.split('/').pop()}`;
    },
    callModel: async ({ messages }) => {
      systemText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
      userContent = messages.find((message) => message.role === 'user')?.content;
      return { content: 'ok', toolCalls: [], finishReason: 'stop' };
    },
    generateImage: async () => ({ imageUrl: 'x' }),
    onProgress: () => {},
  });
  assert.deepEqual(preparedUrls, [
    'http://111.229.66.247/api/assets/file/current/1.png',
    'http://111.229.66.247/api/assets/file/current/2.png',
    'http://111.229.66.247/api/assets/file/current/3.png',
  ]);
  assert.ok(Array.isArray(userContent), '本轮图片转存后仍应 inline 给模型');
  assert.match(systemText, /https:\/\/tempfile\.redpandaai\.co\/kieai\/30590\/mayo-storage\/internal\/1\.png/);
  assert.match(systemText, /http:\/\/111\.229\.66\.247\/api\/assets\/file\/history\/a\.png/);
  assert.doesNotMatch(systemText, /tempfile\.redpandaai\.co\/kieai\/30590\/mayo-storage\/internal\/a\.png/);
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
