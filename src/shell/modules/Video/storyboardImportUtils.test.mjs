import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildStoryboardBoardGenerationImport,
  buildStoryboardGenerationImport,
  detectStoryboardEndSeconds,
  detectStoryboardSegmentSeconds,
  extractStoryboardDynamicScriptText,
} from './storyboardImportUtils.mjs';

const sampleProject = {
  id: 'storyboard-1',
  name: 'demo',
  config: {
    aspectRatio: '16:9',
    uploadedProductUrls: [
      'http://111.229.66.247/api/assets/file/product-a/IMG_8536.JPG',
      'http://111.229.66.247/api/assets/file/product-b/angle.png',
    ],
  },
  script: '分段一 0-4秒\n分段二 4-9秒',
  boards: [
    {
      id: 'board-1',
      title: '分段一',
      dynamicScriptPrompt: '分段一\n{0-4秒，产品从左侧入画，镜头推近。}',
      imageUrl: 'http://111.229.66.247/api/assets/file/board-1/storyboard.png',
    },
    {
      id: 'board-2',
      title: '分段二',
      dynamicScriptPrompt: '分段二\n{4-9秒，手部展示使用动作，背景保持干净。}',
      imageUrl: 'http://111.229.66.247/api/assets/file/board-2/storyboard.png',
    },
  ],
};

test('extractStoryboardDynamicScriptText only keeps content inside braces', () => {
  assert.equal(
    extractStoryboardDynamicScriptText('分段一\n{镜头A}\n分段二：{镜头B}'),
    '镜头A\n镜头B',
  );
});

test('buildStoryboardGenerationImport prepares prompt, defaults, duration, ratio, and materials', () => {
  const payload = buildStoryboardGenerationImport(sampleProject);

  assert.equal(payload.prompt, [
    '图片上传为商品素材多角度图以及视频分镜图，分镜脚本为：',
    '0-4秒，产品从左侧入画，镜头推近。',
    '',
    '4-9秒，手部展示使用动作，背景保持干净。',
  ].join('\n'));
  assert.deepEqual(payload.params, {
    dreaminaMode: 'multimodal2video',
    videoMode: 'multimodal2video',
    duration: '9秒',
    modelVersion: 'bytedance/seedance-2-fast',
    videoResolution: '720p',
    ratio: '16:9',
    aspectRatio: '16:9',
  });
  assert.deepEqual(
    payload.materials.map((item) => [item.type, item.fileName]),
    [
      ['product', 'IMG_8536.JPG'],
      ['product', 'angle.png'],
      ['scene', '分段一.png'],
      ['scene', '分段二.png'],
    ],
  );
});

test('buildStoryboardGenerationImport handles service-style storyboard data without blocking on missing optional fields', () => {
  const payload = buildStoryboardGenerationImport({
    id: 'storyboard-2',
    config: {
      aspectRatio: '4:5',
      duration: '15s',
      uploadedProductUrls: [
        'http://111.229.66.247/api/assets/file/p/商品主图 1.png?token=abc',
        '',
        'http://111.229.66.247/api/assets/file/p/商品主图 1.png?token=abc',
      ],
    },
    script: '',
    boards: [
      {
        id: 'board-a',
        title: '15s 分镜板',
        scriptText: '分段一：{0秒-5秒，镜头俯拍产品开场。}',
      },
      {
        id: 'board-b',
        title: '最终板',
        dynamicScriptPrompt: '分镜1（3.5秒）\n{产品转身展示}\n分镜2（4秒）\n{卖点细节特写}',
        imageUrl: 'http://111.229.66.247/api/assets/file/storyboard/final-board.webp',
      },
    ],
  });

  assert.equal(payload.params.duration, '8秒');
  assert.equal(payload.params.ratio, '3:4');
  assert.equal(payload.params.aspectRatio, '3:4');
  assert.equal(payload.materials.length, 2);
  assert.deepEqual(payload.materials.map((item) => item.type), ['product', 'scene']);
  assert.ok(!payload.prompt.includes('分段一'));
  assert.match(payload.prompt, /0秒-5秒，镜头俯拍产品开场。/);
  assert.match(payload.prompt, /产品转身展示/);
  assert.match(payload.prompt, /卖点细节特写/);
});

test('buildStoryboardBoardGenerationImport imports only the clicked storyboard board', () => {
  const payload = buildStoryboardBoardGenerationImport(sampleProject, { boardId: 'board-2', boardIndex: 1 });

  assert.equal(payload.prompt, [
    '图片上传为商品素材多角度图以及视频分镜图，分镜脚本为：',
    '4-9秒，手部展示使用动作，背景保持干净。',
  ].join('\n'));
  assert.equal(payload.params.duration, '5秒');
  assert.equal(payload.params.ratio, '16:9');
  assert.deepEqual(
    payload.materials.map((item) => [item.type, item.fileName, item.url]),
    [
      ['product', 'IMG_8536.JPG', 'http://111.229.66.247/api/assets/file/product-a/IMG_8536.JPG'],
      ['product', 'angle.png', 'http://111.229.66.247/api/assets/file/product-b/angle.png'],
      ['scene', '分段二.png', 'http://111.229.66.247/api/assets/file/board-2/storyboard.png'],
    ],
  );
  assert.ok(!payload.prompt.includes('产品从左侧入画'));
  assert.ok(!payload.materials.some((item) => item.url.includes('/board-1/')));
});

test('buildStoryboardBoardGenerationImport uses the currently viewed storyboard version when provided', () => {
  const currentVersionUrl = 'http://111.229.66.247/api/assets/file/board-2/version-2.png';
  const payload = buildStoryboardBoardGenerationImport(sampleProject, {
    boardId: 'board-2',
    boardIndex: 1,
    imageUrl: currentVersionUrl,
  });

  assert.equal(payload.materials.find((item) => item.type === 'scene')?.url, currentVersionUrl);
  assert.ok(!payload.materials.some((item) => item.url.includes('/board-2/storyboard.png')));
});

test('buildStoryboardBoardGenerationImport derives duration from the clicked board timeline span', () => {
  const payload = buildStoryboardBoardGenerationImport({
    ...sampleProject,
    config: {
      ...sampleProject.config,
      aspectRatio: '4:5',
      duration: '15秒',
    },
    boards: [
      {
        id: 'board-a',
        title: '分段一',
        dynamicScriptPrompt: [
          '分段一',
          '{镜头一： 00:00 – 00:04，产品开场}',
          '{镜头二： 00:04 – 00:09，加入粉末}',
          '{镜头三： 00:09 – 00:12，成品展示}',
        ].join('\n'),
        imageUrl: 'http://111.229.66.247/api/assets/file/board-a/storyboard.webp',
      },
      {
        id: 'board-b',
        title: '分段二',
        dynamicScriptPrompt: '{镜头四： 00:12 – 00:15，收尾}',
        imageUrl: 'http://111.229.66.247/api/assets/file/board-b/storyboard.webp',
      },
    ],
  }, { boardId: 'board-a' });

  assert.equal(detectStoryboardSegmentSeconds('镜头一： 00:00 – 00:04\n镜头二： 00:04 – 00:09\n镜头三： 00:09 – 00:12'), 12);
  assert.equal(payload.params.duration, '12秒');
  assert.equal(payload.params.ratio, '3:4');
  assert.equal(payload.materials.filter((item) => item.type === 'scene').length, 1);
  assert.match(payload.prompt, /00:09 – 00:12/);
  assert.ok(!payload.prompt.includes('00:12 – 00:15'));
});

test('buildStoryboardBoardGenerationImport keeps Seedance duration parameters within supported range', () => {
  const payload = buildStoryboardBoardGenerationImport({
    ...sampleProject,
    boards: [
      {
        id: 'board-short',
        title: '分段短',
        dynamicScriptPrompt: '{镜头六： 00:09 – 00:12，短段动作}',
        imageUrl: 'http://111.229.66.247/api/assets/file/board-short/storyboard.webp',
      },
    ],
  }, { boardId: 'board-short' });

  assert.equal(detectStoryboardSegmentSeconds('镜头六： 00:09 – 00:12'), 3);
  assert.equal(payload.params.duration, '4秒');
});

test('detectStoryboardEndSeconds recognizes common storyboard timing formats', () => {
  assert.equal(detectStoryboardEndSeconds({ config: { duration: '15s' }, script: '镜头从 0秒-15秒 结束' }), 15);
  assert.equal(detectStoryboardEndSeconds({ config: { duration: '5s' }, boards: [{ dynamicScriptPrompt: '0-6s\n6-12s' }] }), 12);
  assert.equal(detectStoryboardEndSeconds({ config: { duration: '5s' }, boards: [{ dynamicScriptPrompt: '分镜1（2.5秒）\n分镜2（3.5秒）' }] }), 6);
  assert.equal(detectStoryboardEndSeconds({ config: { duration: '30s' }, boards: [] }), 30);
});

test('storyboard cards expose script copy and import-to-generation wiring', () => {
  const projectCardSource = fs.readFileSync(new URL('../../components/ProjectCard.tsx', import.meta.url), 'utf8');
  const projectListSource = fs.readFileSync(new URL('../../components/ProjectListView.tsx', import.meta.url), 'utf8');
  const videoModuleSource = fs.readFileSync(new URL('./VideoModule.tsx', import.meta.url), 'utf8');
  const shellSource = fs.readFileSync(new URL('../../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
  const typesSource = fs.readFileSync(new URL('../../../types.ts', import.meta.url), 'utf8');
  const bottomInputSource = fs.readFileSync(new URL('../../components/layout/BottomInputBar.tsx', import.meta.url), 'utf8');

  assert.match(projectCardSource, /renderPromptCopyButton\(dynamicScriptPrompt, '复制脚本'\)/);
  assert.match(projectCardSource, /label="导入至生成"/);
  assert.doesNotMatch(projectCardSource, /label="复制脚本"/);
  assert.match(projectCardSource, /onImportStoryboardToGeneration\(project\.storyboardSourceProject, result\.id, boardIndex, displayResult\.imageUrl\)/);
  assert.match(projectListSource, /onImportStoryboardToGeneration=\{onImportStoryboardToGeneration\}/);
  assert.match(videoModuleSource, /storyboardSourceProject: project/);
  assert.match(shellSource, /buildStoryboardBoardGenerationImport\(project, \{ boardId, boardIndex, imageUrl \}\)/);
  assert.match(shellSource, /const generationMaterialTypesToReplace = new Set\(\['product', 'scene', 'referenceVideo', 'audio'/);
  assert.match(shellSource, /material\.subFeature && material\.subFeature !== 'generation'/);
  assert.match(shellSource, /setActiveSubFeatureByModule\(\(prev\) => \(\{ \.\.\.prev, \[AppModuleObj\.VIDEO\]: 'generation' \}\)\)/);
  assert.match(
    bottomInputSource,
    /title: '画面比例'[\s\S]*options: \['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'\]/,
  );
  assert.match(
    bottomInputSource,
    /title: '画幅'[\s\S]*options: \['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'\]/,
  );
  assert.doesNotMatch(bottomInputSource, /title: '画幅'[\s\S]{0,180}'4:5'/);
  assert.doesNotMatch(bottomInputSource, /title: '画面比例'[\s\S]{0,180}'4:5'/);
  assert.match(shellSource, /if \(value === '21:9'\) return AspectRatio\.L_21_9/);
  assert.match(shellSource, /if \(value === '4:5'\) return AspectRatio\.P_3_4/);
  assert.match(typesSource, /aspectRatio: AspectRatio\.SQUARE \| AspectRatio\.P_3_4 \| AspectRatio\.L_4_3 \| AspectRatio\.P_9_16 \| AspectRatio\.L_16_9 \| AspectRatio\.L_21_9/);
  assert.doesNotMatch(typesSource, /VideoStoryboardConfig[\s\S]*aspectRatio:[^\n]*AspectRatio\.P_4_5/);
});
