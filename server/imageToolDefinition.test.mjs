import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATE_IMAGE_TOOL, normalizeGenerateImageArgs } from './imageToolDefinition.mjs';

test('tool 定义符合 OpenAI function 格式', () => {
  assert.equal(GENERATE_IMAGE_TOOL.type, 'function');
  assert.equal(GENERATE_IMAGE_TOOL.function.name, 'generate_image');
  const props = GENERATE_IMAGE_TOOL.function.parameters.properties;
  assert.ok(props.prompt && props.task_type && props.input_image_urls && props.aspect_ratio);
  assert.deepEqual(GENERATE_IMAGE_TOOL.function.parameters.required, ['prompt', 'task_type']);
});

test('规范化：缺 task_type 时按有无输入图推断', () => {
  const a = normalizeGenerateImageArgs({ prompt: '画只猫' });
  assert.equal(a.taskType, 'new_image');
  const b = normalizeGenerateImageArgs({ prompt: '换背景', input_image_urls: ['https://x/1.png'] });
  assert.equal(b.taskType, 'edit_image');
});

test('规范化：aspect_ratio 非法值回退 auto', () => {
  const a = normalizeGenerateImageArgs({ prompt: 'x', aspect_ratio: '99:1' });
  assert.equal(a.aspectRatio, 'auto');
  const b = normalizeGenerateImageArgs({ prompt: 'x', aspect_ratio: '16:9' });
  assert.equal(b.aspectRatio, '16:9');
});

test('规范化：input_image_urls 去重+去空', () => {
  const a = normalizeGenerateImageArgs({ prompt: 'x', input_image_urls: ['https://a', 'https://a', '', null] });
  assert.deepEqual(a.inputImageUrls, ['https://a']);
});

test('规范化：缺 prompt 抛错', () => {
  assert.throws(() => normalizeGenerateImageArgs({ task_type: 'new_image' }), /prompt/);
});
