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

test('original storyboard chain keeps scene references separate from product references', () => {
  assert.match(source, /const getSceneReferenceUrls = \(config: VideoStoryboardConfig\)/);
  assert.match(source, /场景\/风格参考图/);
  assert.match(source, /这些图片只作为拍摄环境、光线、道具、景深、机位和风格参考/);
  assert.match(source, /不得把场景参考图中的非商品物体误当成商品/);
  assert.match(source, /safeSceneReferenceUrls\.forEach/);
  assert.match(source, /const inputImages = \[\s*\.\.\.safeImageUrls,\s*\.\.\.safeSceneReferenceUrls,/s);
});

test('original storyboard script generation explicitly uses the video analysis model', () => {
  assert.match(source, /const videoAnalysisModel = await resolveVideoAnalysisModel\(\);/);
  assert.doesNotMatch(source, /const videoAnalysisModel = safeReferenceVideoUrl \? await resolveVideoAnalysisModel\(\) : '';/);
  assert.match(source, /model: videoAnalysisModel,\s*reasoningLevel: 'high'/);
  assert.match(source, /const taskId = String\(finalJob\.providerTaskId \|\| finalJob\.result\?\.providerTaskId \|\| ''\)\.trim\(\) \|\| undefined;/);
  assert.doesNotMatch(source, /const taskId = String\(finalJob\.providerTaskId \|\| finalJob\.result\?\.providerTaskId \|\| job\.id/);
});

test('storyboard board edit uses a focused edit prompt instead of replaying the full generation prompt', () => {
  const editPromptBlock = source.match(/const buildStoryboardBoardEditPrompt = \(\{[\s\S]*?export const generateStoryboardBoardImage =/)?.[0] || '';
  const generationBlock = source.match(/export const generateStoryboardBoardImage = async \([\s\S]*?export const generateStoryboardWhiteBgImage =/)?.[0] || '';

  assert.match(editPromptBlock, /【修改基准图】/);
  assert.match(editPromptBlock, /【任务需求】/);
  assert.match(editPromptBlock, /不重新策划分镜，不扩写原始分镜脚本，不把完整初始生图提示词重新执行一遍/);
  assert.doesNotMatch(editPromptBlock, /分镜内容：\s*\\n\$\{panelLines\}/);
  assert.match(generationBlock, /revisionInstruction\?\.trim\(\) && safeCurrentBoardImageUrl\s*\?\s*buildStoryboardBoardEditPrompt/);
  assert.match(generationBlock, /:\s*buildBoardPrompt\(/);
});
