import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./videoStoryboardService.ts', import.meta.url), 'utf8');

test('viral storyboard prompt forbids expanded product packaging details', () => {
  assert.match(
    source,
    /所有输出里的“商品：”字段必须固定写为“商品：保持与商品参考图完全一致，不展开描述包装细节”/,
  );
  assert.match(
    source,
    /禁止描述、复述或猜测商品包装的颜色、品牌、标签、文字、形状、材质和内容物细节/,
  );
  assert.match(
    source,
    /商品：保持与商品参考图完全一致，不展开描述包装细节/,
  );
  assert.doesNotMatch(
    source,
    /商品：保持与商品参考图完全一致（外观，内容物，细节等），不展开描述包装细节/,
  );
});

test('viral storyboard parser preserves multiline voiceover and audio content from structured scripts', () => {
  assert.ok(source.includes("const voiceLine = lines.find((line) => line.startsWith('口播')) || '';"));
  assert.ok(source.includes("const audioLine = lines.find((line) => line.startsWith('音效')) || '';"));
  assert.ok(source.includes("audio: audioMatch?.[1]?.trim() || getFallbackAudio(),"));
});

test('viral storyboard generation requires a reference video before submitting the task', () => {
  assert.ok(source.includes("if (config.videoGenerationMode === 'viral_split' && !config.uploadedReferenceVideoUrl && !config.referenceVideoFile)"));
  assert.ok(source.includes("throw new Error('请先上传爆款复刻视频');"));
});

test('normalized viral storyboard prompt emits descriptive placeholders instead of instruction-only content', () => {
  const normalizerBody = source.match(/const normalizeViralStoryboardPrompt = \([\s\S]*?\n\};/)?.[0] || '';

  assert.ok(normalizerBody.includes("'参考爆款视频中可见的人物出镜范围、手部/身体动作和服装气质，所有分段保持一致。'"));
  assert.ok(normalizerBody.includes("'参考爆款视频中可见的真实拍摄场景、道具、光线方向、景深和机位，所有分段保持连续。'"));
  assert.match(normalizerBody, /人物细节：\$\{personDetail\}/);
  assert.match(normalizerBody, /环境\/场景：\$\{environmentDetail\}/);
  assert.doesNotMatch(normalizerBody, /人物细节：从爆款视频拆解人物类型/);
  assert.doesNotMatch(normalizerBody, /商品：保持与商品参考图完全一致，不展开描述包装细节/);
  assert.doesNotMatch(normalizerBody, /环境\/场景：从爆款视频拆解具体场景/);
});
