import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./videoStoryboardService.ts', import.meta.url), 'utf8');
const planningSource = readFileSync(new URL('../utils/videoStoryboardPlanning.ts', import.meta.url), 'utf8');

test('original storyboard segment labels come from an explicit shared runtime import', async () => {
  const planning = await import(new URL('../utils/videoStoryboardPlanning.ts', import.meta.url).href);
  const planningImport = source.match(
    /import\s*\{[\s\S]*?\}\s*from '\.\.\/utils\/videoStoryboardPlanning\.ts';/,
  )?.[0] || '';

  assert.equal(typeof planning.getSegmentLabel, 'function');
  assert.equal(planning.getSegmentLabel(0), '分段一');
  assert.match(planningImport, /\bgetSegmentLabel\b/);
});

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

test('viral storyboard prompt asks for policy-safe structural reference and original adaptation', () => {
  const viralPromptBlock = source.match(
    /if \(config\.videoGenerationMode === 'viral_split'\) \{[\s\S]*?\n`\.trim\(\);\n  \}/,
  )?.[0] || '';

  assert.match(viralPromptBlock, /参考视频结构分析与原创改编导演/);
  assert.match(viralPromptBlock, /不得逐字转录或复现原视频口播/);
  assert.match(viralPromptBlock, /不得复制原视频中的人物身份、品牌文案、字幕、歌词或可识别声音特征/);
  assert.doesNotMatch(viralPromptBlock, /爆款拆解复刻导演/);
  assert.doesNotMatch(viralPromptBlock, /口播内容必须来自爆款视频中真实可识别的原始口播/);
  assert.match(source, /import \{ normalizeViralProductInfo \} from '\.\.\/utils\/videoStoryboardPromptPolicy\.mjs'/);
  assert.match(viralPromptBlock, /const productFacts = normalizeViralProductInfo\(config\.productInfo\)/);
  assert.match(source, /userContent\.push\(\{ type: 'text', text: '\[参考视频附件已附加\]' \}\)/);
  assert.doesNotMatch(source, /\[爆款复刻视频URL\]/);
  for (const heading of ['R Role 角色', 'T Task 任务', 'C Constraint 约束', 'F Format 格式', 'E Example 示例']) {
    assert.ok(viralPromptBlock.includes(heading), `missing RTCFE heading: ${heading}`);
  }
});

test('viral storyboard parser preserves multiline voiceover and audio content from structured scripts', () => {
  assert.ok(planningSource.includes("const voiceLine = lines.find((line) => line.startsWith('口播')) || '';"));
  assert.ok(planningSource.includes("const audioLine = lines.find((line) => line.startsWith('音效')) || '';"));
  assert.ok(planningSource.includes("audio: normalizeModeSpecificText(audioMatch?.[1], config, getFallbackAudio(config)),"));
});

test('storyboard JSON parser scans for a valid array instead of using a greedy bracket match', () => {
  const parserBody = planningSource.match(/const extractJsonArray = \(content: string\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(parserBody, /for \(let start = cleaned\.indexOf\('\['\)/);
  assert.match(parserBody, /JSON\.parse\(candidate\)/);
  assert.doesNotMatch(parserBody, /content\.match\(\/\\\[\\\[\\s\\S\]\*\\\]\/\)/);
});

test('viral storyboard generation requires a reference video before submitting the task', () => {
  assert.ok(source.includes("if (config.videoGenerationMode === 'viral_split' && !config.uploadedReferenceVideoUrl && !config.referenceVideoFile)"));
  assert.ok(source.includes("throw new Error('请先上传爆款复刻视频');"));
});

test('normalized viral storyboard prompt emits descriptive placeholders instead of instruction-only content', () => {
  const normalizerBody = planningSource.match(/const normalizeViralStoryboardPrompt = \([\s\S]*?\n\};/)?.[0] || '';
  const dynamicNormalizerBody = planningSource.match(/const normalizeViralDynamicScriptPrompt = \([\s\S]*?\n\};/)?.[0] || '';

  assert.ok(normalizerBody.includes("'参考视频中客观可见的人物出镜范围、手部/身体动作和服装气质，所有分段保持一致；不得识别或复制人物身份。'"));
  assert.ok(normalizerBody.includes("'参考视频中客观可见的拍摄场景、道具、光线方向、景深和机位，所有分段保持连续。'"));
  assert.match(normalizerBody, /人物细节：\$\{personDetail\}/);
  assert.match(normalizerBody, /环境\/场景：\$\{environmentDetail\}/);
  assert.doesNotMatch(normalizerBody, /人物细节：从爆款视频拆解人物类型/);
  assert.doesNotMatch(normalizerBody, /商品：保持与商品参考图完全一致，不展开描述包装细节/);
  assert.doesNotMatch(normalizerBody, /环境\/场景：从爆款视频拆解具体场景/);
  assert.doesNotMatch(normalizerBody, /参考爆款视频|爆款视频拆解/);
  assert.match(dynamicNormalizerBody, /参考视频中可观察的通用结构以及对应宫格分镜/);
  assert.doesNotMatch(dynamicNormalizerBody, /参考爆款视频|爆款视频拆解/);
  assert.match(planningSource, /getFallbackVoiceover[\s\S]*?'参考视频该分镜口播信息未清晰识别'/);
  assert.match(planningSource, /getFallbackAudio[\s\S]*?'参考视频该分镜声音类型未清晰识别'/);
  assert.doesNotMatch(planningSource, /延续参考爆款视频/);
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
  assert.match(source, /const videoAnalysisFallbackModels = await resolveVideoAnalysisFallbackModels\(videoAnalysisModel\);/);
  assert.doesNotMatch(source, /const videoAnalysisModel = safeReferenceVideoUrl \? await resolveVideoAnalysisModel\(\) : '';/);
  assert.match(source, /model: videoAnalysisModel,\s*fallbackModels: videoAnalysisFallbackModels,\s*reasoningLevel: 'high'/);
  assert.match(source, /const taskId = String\(finalJob\.providerTaskId \|\| finalJob\.result\?\.providerTaskId \|\| ''\)\.trim\(\) \|\| undefined;/);
  assert.doesNotMatch(source, /const taskId = String\(finalJob\.providerTaskId \|\| finalJob\.result\?\.providerTaskId \|\| job\.id/);
});

test('storyboard analysis fallback stays inside configured Gemini models in priority order', () => {
  const selectorBlock = source.match(/const VIDEO_ANALYSIS_FALLBACK_PRIORITY[\s\S]*?const resolveRuntimePublicBaseUrl/)?.[0] || '';

  assert.match(source, /const VIDEO_ANALYSIS_FALLBACK_PRIORITY = \['gemini-3-5-flash', 'gemini-3-flash-openai'\]/);
  assert.match(selectorBlock, /filter\(\(item\) => getModelFamily\(item\.id\) === 'gemini'\)/);
  assert.match(selectorBlock, /VIDEO_ANALYSIS_FALLBACK_PRIORITY\.indexOf\(normalizeModelId\(a\.id\)\)/);
  assert.match(selectorBlock, /const fallback = candidates\[0\]/);
  assert.doesNotMatch(selectorBlock, /getModelFamily\(item\.id\) !== currentFamily/);
  assert.match(source, /result\.config\.videoAnalysisModels \|\| result\.config\.agentModels\.chat \|\| \[\]/);
});

test('original storyboard planning outputs segmented storyboard and dynamic script prompts like viral mode', () => {
  const requestPromptBlock = source.match(/const buildScriptRequestPrompt = \([\s\S]*?export const generateStoryboardScript =/)?.[0] || '';
  const originalBuilderBlock = planningSource.match(/const buildOriginalSplitShotsAndBoards = \([\s\S]*?const buildViralSplitShotsAndBoards =/)?.[0] || '';
  const parseBlock = planningSource.match(/export const parseStoryboardPlanningResult = \([\s\S]*?const limited = parsed\.slice/)?.[0] || '';

  assert.match(requestPromptBlock, /storyboardPrompt/);
  assert.match(requestPromptBlock, /dynamicScriptPrompt/);
  assert.match(requestPromptBlock, /宫格分镜图 prompt 必须严格使用以下格式/);
  assert.match(requestPromptBlock, /动态视频脚本提示词必须严格使用以下格式/);
  assert.match(requestPromptBlock, /不得描述、复述或猜测商品包装的品牌、标签、文字和内容物细节/);
  assert.match(requestPromptBlock, /当前是原创生成模式，没有参考视频/);
  assert.match(requestPromptBlock, /口播必须优先按“脚本逻辑”中的用户文案逐镜头分配/);
  assert.match(requestPromptBlock, /不得输出任何“参考视频.*未识别”文案/);
  assert.match(originalBuilderBlock, /normalizeOriginalStoryboardPrompt/);
  assert.match(originalBuilderBlock, /normalizeOriginalDynamicScriptPrompt/);
  assert.match(originalBuilderBlock, /buildOriginalSplitShotsAndBoards/);
  assert.match(parseBlock, /if \(parsed\.some\(\(item\) => item\?\.storyboardPrompt \|\| item\?\.dynamicScriptPrompt\)\) \{/);
  assert.match(parseBlock, /return buildOriginalSplitShotsAndBoards\(parsed, config, identitySeed\);/);
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

test('storyboard planning and board jobs expose durable identity before polling', () => {
  const planningBlock = source.match(/export const generateStoryboardScript = async \([\s\S]*?const createImageModuleConfig =/)?.[0] || '';
  const boardBlock = source.match(/export const generateStoryboardBoardImage = async \([\s\S]*?export const generateStoryboardWhiteBgImage =/)?.[0] || '';

  assert.match(source, /parseStoryboardPlanningResult/);
  assert.match(planningBlock, /shellProjectId/);
  assert.match(planningBlock, /planningPurpose/);
  assert.match(planningBlock, /phase/);
  assert.match(planningBlock, /onJobCreated\?\.\(job\.id/);
  assert.match(planningBlock, /waitForInternalJob\([\s\S]*onJobUpdate/);
  assert.match(planningBlock, /identitySeed: shellProjectId \|\| job\.id/);
  assert.match(boardBlock, /shellProjectId/);
  assert.match(boardBlock, /planningPurpose/);
  assert.match(boardBlock, /phase/);
  assert.match(boardBlock, /boardId: board\.id/);
  assert.match(boardBlock, /onJobCreated/);
});

test('storyboard planning and board polling share the caller cancellation signal', () => {
  const planningBlock = source.match(/export const generateStoryboardScript = async \([\s\S]*?const createImageModuleConfig =/)?.[0] || '';
  const boardBlock = source.match(/export const generateStoryboardBoardImage = async \([\s\S]*?export const generateStoryboardWhiteBgImage =/)?.[0] || '';

  assert.match(source, /signal\?: AbortSignal/);
  assert.match(planningBlock, /const \{ onJobCreated, signal \} = jobContext/);
  assert.match(planningBlock, /waitForInternalJob\(job\.id, signal,/);
  assert.match(boardBlock, /jobContext\.signal \|\| new AbortController\(\)\.signal/);
});

test('storyboard jobs forward the stable client submission key to backend dedupe', () => {
  const planningBlock = source.match(/export const generateStoryboardScript = async \([\s\S]*?const createImageModuleConfig =/)?.[0] || '';
  const boardBlock = source.match(/export const generateStoryboardBoardImage = async \([\s\S]*?export const generateStoryboardWhiteBgImage =/)?.[0] || '';

  assert.match(source, /clientSubmissionKey\?: string/);
  assert.match(planningBlock, /clientSubmissionKey: String\(jobContext\.clientSubmissionKey/);
  assert.match(boardBlock, /clientSubmissionKey: String\(jobContext\.clientSubmissionKey/);
});
