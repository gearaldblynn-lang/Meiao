import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOneClickPlanContent,
  isInvalidOneClickPlanLike,
  isInvalidOneClickPlanText,
} from './oneClickPlanValidation.ts';

test('one-click plan validation rejects failed planning placeholders', () => {
  assert.equal(isInvalidOneClickPlanText('fetch failed'), true);
  assert.equal(isInvalidOneClickPlanText('共 1 张参考图，其中 1 张策划失败。'), true);
  assert.equal(isInvalidOneClickPlanText('Failed to get the file information'), true);
  assert.equal(isInvalidOneClickPlanText('I cannot fulfill this request.'), true);
  assert.equal(isInvalidOneClickPlanText('Internal Error, Please try again later.'), true);
  assert.equal(isInvalidOneClickPlanText('The server is currently being maintained, please try again later~'), true);
});

test('one-click plan validation keeps real scheme content valid', () => {
  const plan = {
    id: 'plan-ok',
    title: '首图裂变1-复刻主图参考1',
    schemeContent: '- 设计意图：保持参考图版式\n- 画面描述：替换为我方商品\n- 画面比例：1:1',
  };

  assert.equal(getOneClickPlanContent(plan).includes('画面描述'), true);
  assert.equal(isInvalidOneClickPlanLike(plan), false);
});
