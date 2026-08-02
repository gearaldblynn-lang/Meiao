import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTranslationRegionEraseInstruction,
  isTranslationRegionPureEraseTask,
  parseTranslationRegionEditIntent,
  resolveTranslationRegionTextRenderPlan,
  validateTranslationRegionEditIntents,
} from './translationRegionEditIntent.mjs';

test('parses quoted and unquoted replacement copy without truncating punctuation', () => {
  assert.deepEqual(
    parseTranslationRegionEditIntent('此区域内文案改成“产品亮点”'),
    { ok: true, operation: 'replace_text', targetText: '产品亮点' },
  );
  assert.deepEqual(
    parseTranslationRegionEditIntent('文案替换为自动沥水，积水直接导入水槽'),
    { ok: true, operation: 'replace_text', targetText: '自动沥水，积水直接导入水槽' },
  );
});

test('splits only an explicit style suffix from unquoted replacement copy', () => {
  assert.deepEqual(
    parseTranslationRegionEditIntent('文案改成产品亮点，字体改成红色并居中'),
    {
      ok: true,
      operation: 'replace_text',
      targetText: '产品亮点',
      styleInstruction: '字体改成红色并居中',
    },
  );
  assert.deepEqual(
    parseTranslationRegionEditIntent('文案改成自动沥水，积水直接导入水槽'),
    { ok: true, operation: 'replace_text', targetText: '自动沥水，积水直接导入水槽' },
  );
});

test('replacement wins over deletion and pure deletion remains available', () => {
  assert.deepEqual(
    parseTranslationRegionEditIntent('删除原文并改成产品亮点'),
    { ok: true, operation: 'replace_text', targetText: '产品亮点' },
  );
  assert.deepEqual(
    parseTranslationRegionEditIntent('删除此区域内的文案'),
    { ok: true, operation: 'delete_text' },
  );
});

test('rejects empty replacements, unknown instructions, and negated deletion', () => {
  assert.deepEqual(
    parseTranslationRegionEditIntent('文案改成'),
    { ok: false, code: 'missing_replacement_text' },
  );
  assert.deepEqual(
    parseTranslationRegionEditIntent('把这里处理好看一点'),
    { ok: false, code: 'unrecognized_instruction' },
  );
  assert.deepEqual(
    parseTranslationRegionEditIntent('不要删除此区域内的文案'),
    { ok: false, code: 'unrecognized_instruction' },
  );
});

test('validates new submission intents without changing geometry validation', () => {
  const valid = validateTranslationRegionEditIntents([
    { id: 'replace', instruction: '文案改成产品亮点' },
    { id: 'delete', instruction: '删除此区域内的文案' },
  ]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.intents.map((intent) => intent.operation), ['replace_text', 'delete_text']);

  assert.deepEqual(
    validateTranslationRegionEditIntents([{ id: 'missing', instruction: '文案改成' }]),
    { ok: false, code: 'missing_replacement_text', regionId: 'missing', intents: [] },
  );
  assert.deepEqual(
    validateTranslationRegionEditIntents([{ id: 'unknown', instruction: '处理得更好看' }]),
    { ok: false, code: 'unrecognized_instruction', regionId: 'unknown', intents: [] },
  );
});

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
