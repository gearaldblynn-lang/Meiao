import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCopyLayoutLine, normalizeCopyLayoutText } from './copyLayoutUtils.mjs';

test('normalizeCopyLayoutLine rewrites legacy bullet copy rows into the strict template and strips font names', () => {
  const line = '•主文案：「冷冻后更好吃」— 钉钉进步体，大，上方居中，深棕色';

  assert.equal(
    normalizeCopyLayoutLine(line),
    '主文案(大, 上方居中, 深棕色):“冷冻后更好吃”'
  );
});

test('normalizeCopyLayoutLine preserves standard rows while normalizing quotes and removing font tokens', () => {
  const line = '卖点文案(阿里巴巴普惠体, 中, 底部, 浅金色):"纯脂黑巧，微苦醇香不甜腻"';

  assert.equal(
    normalizeCopyLayoutLine(line),
    '卖点文案(中, 底部, 浅金色):“纯脂黑巧，微苦醇香不甜腻”'
  );
});

test('normalizeCopyLayoutText only rewrites copy rows and leaves other planning fields untouched', () => {
  const input = `画面描述：左右对比，冰感+温暖感并存
文案内容排版：
•主文案：「冷冻后更好吃」— 钉钉进步体，大，上方居中，深棕色
•副文案：「常温像慕斯，冷冻像冰淇淋」— 阿里巴巴普惠体，中，浅蓝色`;

  assert.equal(
    normalizeCopyLayoutText(input),
    `画面描述：左右对比，冰感+温暖感并存
文案内容排版：
主文案(大, 上方居中, 深棕色):“冷冻后更好吃”
副文案(中, 浅蓝色):“常温像慕斯，冷冻像冰淇淋”`
  );
});
