import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const helperUrl = new URL('./videoStoryboardPlanning.ts', import.meta.url);

test('storyboard planning parser returns stable scripts shots and boards for one project identity', async () => {
  assert.equal(existsSync(helperUrl), true, 'shared storyboard planning parser must exist');
  const { parseStoryboardPlanningResult } = await import(helperUrl.href);
  const config = {
    duration: '15s',
    shotCount: 2,
    aspectRatio: '9:16',
    actorType: 'no_real_face',
    countryLanguage: '中国/中文',
    productInfo: '保湿喷雾',
    scenes: ['明亮桌面'],
    videoGenerationMode: 'original',
  };
  const content = JSON.stringify([{
    title: '分段一',
    panelCount: 2,
    storyboardPrompt: '人物细节：仅手部出镜\n环境/场景：明亮桌面\n分镜一：拿起商品\n分镜二：展示喷雾',
    dynamicScriptPrompt: '分镜一：00:00 - 00:07\n画面描述(视觉)：拿起商品\n口播（自然）："先看保湿效果"\n音效：轻快音乐\n分镜二：00:07 - 00:15\n画面描述(视觉)：展示喷雾\n口播（自然）："随时补水"\n音效：喷雾声',
  }]);

  const first = parseStoryboardPlanningResult({ content, config, identitySeed: 'project-stable-1' });
  const second = parseStoryboardPlanningResult({ content, config, identitySeed: 'project-stable-1' });
  const other = parseStoryboardPlanningResult({ content, config, identitySeed: 'project-stable-2' });

  assert.deepEqual(first, second);
  assert.notEqual(first.boards[0].id, other.boards[0].id);
  assert.equal(first.boards[0].status, 'pending');
  assert.equal(first.shots.length, 2);
  assert.match(first.script, /分段一/);
});
