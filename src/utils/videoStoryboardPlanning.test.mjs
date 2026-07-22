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

test('original storyboard parser prefers the schema-complete final array over reasoning scratch arrays', async () => {
  const { parseStoryboardPlanningResult } = await import(helperUrl.href);
  const config = {
    duration: '30s',
    shotCount: 12,
    aspectRatio: '9:16',
    actorType: 'no_real_face',
    countryLanguage: '中国/中文',
    productInfo: '车前子冲饮',
    scriptLogic: `文案为：\n${Array.from({ length: 12 }, (_, index) => `用户第${index + 1}句`).join('\n')}`,
    scenes: ['明亮桌面'],
    videoGenerationMode: 'original',
  };
  const scratch = JSON.stringify(Array.from({ length: 6 }, (_, index) => ({
    panelNumber: index + 1,
    durationSeconds: 2.5,
    visualDescription: `这是推理过程里的草稿画面${index + 1}`,
    dynamicScriptPrompt: `这是推理草稿${index + 1}，不是最终分镜合同`,
    soundEffect: '草稿音效',
  })));
  const finalResult = JSON.stringify(Array.from({ length: 2 }, (_, segmentIndex) => ({
    title: `最终分段${segmentIndex + 1}`,
    durationSeconds: 15,
    panelCount: 6,
    storyboardPrompt: [
      '人物细节：仅手部出镜',
      '环境/场景：明亮桌面',
      ...Array.from({ length: 6 }, (_, shotIndex) => `分镜${shotIndex + 1}：最终画面${segmentIndex * 6 + shotIndex + 1}`),
    ].join('\n'),
    dynamicScriptPrompt: Array.from({ length: 6 }, (_, shotIndex) => {
      const start = (shotIndex * 2.5).toFixed(1).padStart(4, '0');
      const end = ((shotIndex + 1) * 2.5).toFixed(1).padStart(4, '0');
      const voiceIndex = segmentIndex * 6 + shotIndex + 1;
      return `分镜${shotIndex + 1}：00:${start} - 00:${end}\n画面描述(视觉)：最终画面${voiceIndex}\n动作/运镜：缓慢推进\n口播（自然）：“用户最终口播${voiceIndex}”\n音效：轻快音乐`;
    }).join('\n'),
  })));

  const result = parseStoryboardPlanningResult({
    content: `分析草稿：${scratch}\n最终输出：${finalResult}`,
    config,
    identitySeed: 'project-schema-selection',
  });

  assert.equal(result.boards.length, 2);
  assert.equal(result.boards[0].title, '最终分段1');
  assert.equal(result.shots.length, 12);
  assert.equal(result.script.split('\n').filter((line) => line.trim().startsWith('口播')).length, 12);
  assert.match(result.script, /用户最终口播1/);
  assert.match(result.script, /用户最终口播12/);
  assert.match(result.script, /00:02\.5 - 00:05\.0/);
  assert.doesNotMatch(result.script, /参考视频|推理草稿/);
});

test('original storyboard fallback assigns voiceover from the user text script without reference-video wording', async () => {
  const { parseStoryboardPlanningResult } = await import(helperUrl.href);
  const config = {
    duration: '15s',
    shotCount: 2,
    aspectRatio: '9:16',
    actorType: 'no_real_face',
    countryLanguage: '中国/中文',
    productInfo: '车前子冲饮',
    scriptLogic: '营销结构：先卖点后行动\n文案为：\n第一句原创口播\n第二句原创口播',
    scenes: ['明亮桌面'],
    videoGenerationMode: 'original',
  };
  const content = JSON.stringify([{
    title: '分段一',
    durationSeconds: 15,
    panelCount: 2,
    storyboardPrompt: '人物细节：参考视频中人物未识别\n环境/场景：参考视频场景未识别\n分镜一：参考视频第1个镜头未识别\n分镜二：参考视频第2个镜头未识别',
    dynamicScriptPrompt: '分镜一：00:00 - 00:07\n画面描述(视觉)：参考视频第1个镜头的画面内容\n动作/运镜：延续参考视频第1个镜头的动作和运镜节奏\n口播（自然）：“参考视频该分镜口播信息未清晰识别”\n音效：参考视频该分镜声音类型未清晰识别\n分镜二：00:07 - 00:15\n画面描述(视觉)：参考视频第2个镜头的画面内容\n动作/运镜：延续参考视频第2个镜头的动作和运镜节奏\n口播（自然）：“参考视频该分镜口播信息未清晰识别”\n音效：参考视频该分镜声音类型未清晰识别',
  }]);

  const result = parseStoryboardPlanningResult({
    content,
    config,
    identitySeed: 'project-original-fallback',
  });

  assert.match(result.script, /第一句原创口播/);
  assert.match(result.script, /第二句原创口播/);
  assert.match(result.script, /原创画面/);
  assert.doesNotMatch(result.script, /参考视频/);
  assert.doesNotMatch(result.boards[0].prompt, /参考视频/);
});

test('viral storyboard fallback remains explicitly tied to the uploaded reference video', async () => {
  const { parseStoryboardPlanningResult } = await import(helperUrl.href);
  const config = {
    duration: '15s',
    shotCount: 1,
    aspectRatio: '9:16',
    actorType: 'no_real_face',
    countryLanguage: '中国/中文',
    productInfo: '车前子冲饮',
    scriptLogic: '不应覆盖参考视频识别兜底',
    scenes: ['明亮桌面'],
    videoGenerationMode: 'viral_split',
  };
  const content = JSON.stringify([{
    title: '分段一',
    durationSeconds: 15,
    panelCount: 1,
    storyboardPrompt: '',
    dynamicScriptPrompt: '分镜一：00:00 - 00:15\n画面描述(视觉)：\n动作/运镜：\n音效：',
  }]);

  const result = parseStoryboardPlanningResult({
    content,
    config,
    identitySeed: 'project-viral-fallback',
  });

  assert.match(result.script, /参考视频该分镜口播信息未清晰识别/);
  assert.match(result.script, /参考视频该分镜声音类型未清晰识别/);
  assert.match(result.boards[0].prompt, /参考视频/);
});
