import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXhsCoverPrompt,
  createXhsCoverBatchRunner,
  normalizeRestoredXhsCoverTasks,
} from './xhsCoverUtils.mjs';

const withTimeout = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

test('normalizeRestoredXhsCoverTasks preserves completed tasks and recovery fields', () => {
  const restored = normalizeRestoredXhsCoverTasks([
    { id: 'done', status: 'completed', resultUrl: 'https://asset.example/done.png', taskId: 'job_done' },
    { id: 'run', status: 'generating', taskId: 'job_running' },
    { id: 'err', status: 'error', taskId: 'job_retry', error: 'network timeout' },
    { id: 'pending', status: 'pending' },
  ]);

  assert.equal(restored[0].status, 'completed');
  assert.equal(restored[0].resultUrl, 'https://asset.example/done.png');
  assert.equal(restored[0].taskId, 'job_done');

  assert.equal(restored[1].status, 'generating');
  assert.equal(restored[1].taskId, 'job_running');

  assert.equal(restored[2].status, 'error');
  assert.equal(restored[2].taskId, 'job_retry');
  assert.equal(restored[2].error, 'network timeout');

  assert.equal(restored[3].status, 'pending');
});

test('normalizeRestoredXhsCoverTasks ignores invalid entries and normalizes fallback fields', () => {
  const restored = normalizeRestoredXhsCoverTasks([
    null,
    1,
    { id: 1, status: 'completed' },
    {
      id: 'bad',
      status: 'unknown',
      resultUrl: 1,
      taskId: 2,
      error: {},
    },
  ]);

  assert.equal(normalizeRestoredXhsCoverTasks(undefined).length, 0);
  assert.equal(normalizeRestoredXhsCoverTasks('not-array').length, 0);

  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, 'bad');
  assert.equal(restored[0].status, 'pending');
  assert.equal(restored[0].resultUrl, undefined);
  assert.equal(restored[0].taskId, undefined);
  assert.equal(restored[0].error, undefined);
});

test('buildXhsCoverPrompt keeps user copy as only main text and downgrades issue tags', () => {
  const prompt = buildXhsCoverPrompt({
    stylePrompt: [
      '顶部大字英文标题',
      '副标题包含拼音注释',
      '右上角添加期数标签如"#01"',
      '保持原始人像完全不变，只添加文字和装饰，不要修改人脸',
    ].join('\n'),
    title: '真正主标题',
    subtitle: '辅助副标题',
    fontLabel: '综艺体/粗黑体',
    decoration: '星星',
    extraRequirement: '更像小红书爆款',
  });

  assert.match(prompt, /真正主标题/);
  assert.match(prompt, /辅助副标题/);
  assert.doesNotMatch(prompt, /顶部大字英文标题/);
  assert.doesNotMatch(prompt, /拼音注释/);
  assert.match(prompt, /期数标签可作为小型装饰/);
});

test('buildXhsCoverPrompt keeps negative english/pinyin constraints while removing conflicting positive rules', () => {
  const prompt = buildXhsCoverPrompt({
    stylePrompt: [
      '顶部大字英文标题',
      '不要英文标题',
      '副标题包含拼音注释',
      '禁止拼音注释',
    ].join('\n'),
    title: '主标题',
    subtitle: '',
    fontLabel: '黑体',
    decoration: '',
    extraRequirement: '',
  });

  assert.doesNotMatch(prompt, /顶部大字英文标题/);
  assert.doesNotMatch(prompt, /副标题包含拼音注释/);
  assert.match(prompt, /不要英文标题/);
  assert.match(prompt, /禁止拼音注释/);
});

test('buildXhsCoverPrompt trims optional text fields and handles unusual input safely', () => {
  const prompt = buildXhsCoverPrompt({
    stylePrompt: [
      '右上角添加期数标签如"#01"',
      '右上角添加期数标签如"#02"',
      '保留原文案里的#2024增长目标',
    ].join('\n'),
    title: '主标题',
    subtitle: '',
    fontLabel: Symbol('font'),
    decoration: '   星星贴纸   ',
    extraRequirement: '   ',
  });

  const downgradeMatches = prompt.match(/期数标签可作为小型装饰，不能替代主标题。/g) || [];
  assert.equal(downgradeMatches.length, 1);
  assert.match(prompt, /#2024增长目标/);
  assert.match(prompt, /【装饰元素】星星贴纸/);
  assert.doesNotMatch(prompt, /Symbol\(font\)/);
  assert.doesNotMatch(prompt, /【字体风格】/);
  assert.doesNotMatch(prompt, /【额外要求】/);
});

test('createXhsCoverBatchRunner never exceeds configured concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const order = [];
  const runner = createXhsCoverBatchRunner(2);
  const releaseByItem = new Map();
  const startedItems = [];
  let resolveFirstTwo;
  let resolveAllStarted;
  const firstTwoStarted = new Promise((resolve) => {
    resolveFirstTwo = resolve;
  });
  const allStarted = new Promise((resolve) => {
    resolveAllStarted = resolve;
  });
  const releaseItem = (item) => {
    const release = releaseByItem.get(item);
    if (!release) return;
    releaseByItem.delete(item);
    release();
  };

  const runPromise = runner(['a', 'b', 'c', 'd'], async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    startedItems.push(item);
    if (startedItems.length === 2) resolveFirstTwo();
    if (startedItems.length === 4) resolveAllStarted();
    order.push(`start:${item}`);
    await new Promise((resolve) => {
      releaseByItem.set(item, resolve);
    });
    order.push(`end:${item}`);
    active -= 1;
  });

  await withTimeout(firstTwoStarted, 200, 'first two workers');
  releaseItem(startedItems[0]);
  releaseItem(startedItems[1]);
  await withTimeout(allStarted, 200, 'all workers start');
  releaseItem(startedItems[2]);
  releaseItem(startedItems[3]);
  await withTimeout(runPromise, 200, 'batch run');

  assert.equal(maxActive, 2);
  assert.equal(order.filter((step) => step.startsWith('start:')).length, 4);
  assert.equal(order.filter((step) => step.startsWith('end:')).length, 4);
});

test('createXhsCoverBatchRunner handles invalid limits and empty inputs without worker calls', async () => {
  assert.doesNotThrow(() => createXhsCoverBatchRunner(Symbol('limit')));

  const runner = createXhsCoverBatchRunner(Symbol('limit'));
  let calls = 0;
  const worker = async () => {
    calls += 1;
  };

  await runner([], worker);
  await runner(null, worker);
  assert.equal(calls, 0);
});

test('createXhsCoverBatchRunner propagates worker rejection', async () => {
  const runner = createXhsCoverBatchRunner(2);

  await assert.rejects(
    runner(['ok', 'boom'], async (item) => {
      if (item === 'boom') throw new Error('worker failed');
    }),
    /worker failed/
  );
});
