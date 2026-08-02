import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTranslationTargetMarket } from './translationTargetMarket.mjs';

test('built-in target languages resolve to their default commerce markets', () => {
  assert.equal(resolveTranslationTargetMarket('English'), '美国');
  assert.equal(resolveTranslationTargetMarket('Japanese'), '日本');
  assert.equal(resolveTranslationTargetMarket('German'), '德国');
  assert.equal(resolveTranslationTargetMarket('French'), '法国');
  assert.equal(resolveTranslationTargetMarket('Spanish'), '西班牙');
  assert.equal(resolveTranslationTargetMarket('Korean'), '韩国');
  assert.equal(resolveTranslationTargetMarket('Russian'), '俄罗斯');
  assert.equal(resolveTranslationTargetMarket('Vietnamese'), '越南');
  assert.equal(resolveTranslationTargetMarket('Thai'), '泰国');
  assert.equal(resolveTranslationTargetMarket('Italian'), '意大利');
});

test('display labels resolve by their trailing language annotation', () => {
  assert.equal(resolveTranslationTargetMarket('日语 (Japanese)'), '日本');
  assert.equal(resolveTranslationTargetMarket('西班牙语 (Spanish)'), '西班牙');
});

test('custom target descriptions are preserved instead of assigned a country', () => {
  assert.equal(resolveTranslationTargetMarket('Portuguese (Brazil)'), 'Portuguese (Brazil)');
  assert.equal(resolveTranslationTargetMarket(''), '目标语言对应地区');
});
