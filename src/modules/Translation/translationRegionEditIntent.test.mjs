import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTranslationRegionEraseInstruction,
  isTranslationRegionPureEraseTask,
  resolveTranslationRegionTextRenderPlan,
} from './translationRegionEditIntent.mjs';

test('resolves explicit text replacement into a model text generation plan', () => {
  const plan = resolveTranslationRegionTextRenderPlan({
    instruction: '文案改为“순수한 블랙페퍼”，变成两行，颜色改为红色',
  });

  assert.equal(plan?.operation, 'model_text_generation');
  assert.equal(plan.text, '순수한 블랙페퍼');
  assert.equal(plan.lineCount, 2);
  assert.equal(plan.color, '#dc2626');
});

test('does not create a text render plan for erase-only instructions', () => {
  assert.equal(
    resolveTranslationRegionTextRenderPlan({ instruction: '删除区域内的内容' }),
    null,
  );
});

test('recognizes one or more erase-only regions as a pure erase task', () => {
  assert.equal(isTranslationRegionPureEraseTask([
    { instruction: '删除区域内的文字' },
    { instruction: '清除框内图标' },
  ]), true);
});

test('does not treat replacement or mixed region lists as pure erase tasks', () => {
  assert.equal(isTranslationRegionPureEraseTask([
    { instruction: '删除旧文案并替换为“NEW”' },
  ]), false);
  assert.equal(isTranslationRegionPureEraseTask([
    { instruction: '删除区域内的文字' },
    { instruction: '调整区域内的排版' },
  ]), false);
  assert.equal(isTranslationRegionPureEraseTask([]), false);
});

test('does not route negated erase wording into destructive erase mode', () => {
  for (const instruction of [
    '不要删除区域内的内容，只调整颜色',
    '保留文字，不要清除',
    '禁止移除当前图标',
    'do not remove the text',
    'keep the copy, never erase it',
  ]) {
    assert.equal(isTranslationRegionEraseInstruction(instruction), false, instruction);
    assert.equal(isTranslationRegionPureEraseTask([{ instruction }]), false, instruction);
  }
});

test('recognizes a later explicit erase after a separately negated erase clause', () => {
  assert.equal(
    isTranslationRegionEraseInstruction('不要删除左侧图标；删除右侧文字'),
    true,
  );
});
