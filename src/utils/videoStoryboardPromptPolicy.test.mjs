import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeViralProductInfo } from './videoStoryboardPromptPolicy.mjs';

test('viral mode labels are not passed to Gemini as verified product facts', () => {
  const placeholders = [
    '',
    '参考视频',
    '爆款视频',
    '视频复刻',
    '参考视频复刻',
    '爆款视频复刻',
    '爆款复刻',
    '视频裂变',
    '参考视频裂变',
    '爆款视频裂变',
    '爆款裂变',
  ];

  for (const placeholder of placeholders) {
    const normalized = normalizeViralProductInfo(` ${placeholder} `);
    assert.match(normalized, /未补充可核验的商品事实/, placeholder || '(empty)');
    assert.doesNotMatch(normalized, /复刻|裂变/, placeholder || '(empty)');
  }
});

test('real product facts remain unchanged', () => {
  assert.equal(
    normalizeViralProductInfo('配料只有车前子壳，每份 5g'),
    '配料只有车前子壳，每份 5g',
  );
});
