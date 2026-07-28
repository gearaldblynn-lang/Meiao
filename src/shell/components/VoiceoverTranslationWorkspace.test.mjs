import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./VoiceoverTranslationWorkspace.tsx', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('./VoiceoverTranslationComposer.tsx', import.meta.url), 'utf8');
const renderSource = `${source}\n${composerSource}`;
const videoModuleSource = readFileSync(new URL('../modules/Video/VideoModule.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('voiceover creation reuses the shared composer and removes page-level configuration cards', () => {
  assert.match(composerSource, /from '.\/layout\/ComposerPrimitives'/);
  assert.match(composerSource, /<ComposerSurface/);
  assert.match(composerSource, /<ComposerToolbar/);
  assert.match(composerSource, /<ComposerSelect/);
  assert.match(composerSource, /<ComposerSubmitButton/);
  assert.doesNotMatch(renderSource, /max-w-\[1180px\]/);
  assert.doesNotMatch(renderSource, /grid gap-5 lg:grid-cols-2/);
  assert.doesNotMatch(renderSource, /<textarea/);
});

test('voiceover composer owns upload progress preview drag-drop and four ordered controls', () => {
  assert.match(composerSource, /onDragOver=/);
  assert.match(composerSource, /onDrop=/);
  assert.match(composerSource, /正在准备视频/);
  assert.match(composerSource, /<video/);
  assert.match(composerSource, /替换视频/);
  assert.match(composerSource, /清除视频/);

  const language = composerSource.indexOf('title="目标语言"');
  const mode = composerSource.indexOf('title="翻译方式"');
  const voice = composerSource.indexOf('title="口播音色"');
  const removeText = composerSource.indexOf('aria-label="去文案设置"');
  assert.ok(language >= 0 && language < mode && mode < voice && voice < removeText);
});

test('remove-text editor opens from the composer capsule and keeps the normalized default', () => {
  assert.match(composerSource, /ComposerCapsuleButton/);
  assert.match(composerSource, /aria-label="去文案设置"/);
  assert.match(composerSource, /<SubtitleRegionEditor/);
  assert.match(renderSource, /DEFAULT_SUBTITLE_REGION/);
  assert.match(source, /setSubtitleRegion\(\{ \.\.\.DEFAULT_SUBTITLE_REGION \}\)/);
});

test('workspace owns exactly one MP4 or MOV source and confirms replacement', () => {
  assert.match(source, /type="file"/);
  assert.match(source, /accept="video\/mp4,video\/quicktime"/);
  assert.doesNotMatch(source, /\bmultiple\b/);
  assert.match(source, /pendingReplacementFile/);
  assert.match(source, /确认替换当前视频/);
  assert.doesNotMatch(source, /BatchItem|items:\s*\[/);
});

test('workspace prepares direct and existing-result sources with the voiceover media profile', () => {
  assert.match(source, /createMediaTranscodeSession\(\{/);
  assert.match(source, /profile: 'voiceover_translation'/);
  assert.match(source, /kind: 'video'/);
  assert.match(source, /convertMediaTranscodeSession\(\{/);
  assert.match(source, /initialSource/);
  assert.match(source, /sourceProjectId/);
  assert.match(source, /sourceResultId/);
});

test('workspace renders server-owned language and voice catalogs without drifting copies', () => {
  assert.match(source, /publicConfig\.languages/);
  assert.match(source, /\.filter\(\(language\) => language\.common\)/);
  assert.ok(
    source.indexOf('...commonLanguages.map') < source.indexOf('...moreLanguages.map'),
    'common languages should stay ahead of the remaining server-owned catalog',
  );
  assert.match(source, /voices\.map/);
  assert.match(source, /voice\.trait/);
  assert.doesNotMatch(source, /const VOICEOVER_(?:LANGUAGES|VOICES)/);
});

test('workspace exposes natural or literal translation and auto or preset voice modes', () => {
  assert.match(source, /useState<VoiceoverTranslationMode>\('natural'\)/);
  assert.match(composerSource, /value: 'natural'/);
  assert.match(composerSource, /value: 'literal'/);
  assert.match(source, /useState<VoiceoverVoiceMode>\('auto'\)/);
  assert.match(source, /value === '__auto__'/);
  assert.match(source, /setVoiceMode\('preset'\)/);
});

test('preset voice rows expose real provider preview without previewing automatically', () => {
  assert.match(source, /requestVoiceoverPreview/);
  assert.match(source, /waitForVoiceoverPreview/);
  assert.match(source, /handleVoicePreview/);
  assert.match(source, /new Audio\(\)/);
  assert.match(composerSource, /optionAction=/);
  assert.match(composerSource, /首次试听可能产生少量 KIE 费用/);
  assert.match(composerSource, /onVoicePreview/);
  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance/);
  assert.doesNotMatch(source, /useEffect\([\s\S]{0,300}requestVoiceoverPreview/);
});

test('remove-text starts off and reuses the existing normalized subtitle editor', () => {
  assert.match(source, /useState\(false\)/);
  assert.match(source, /DEFAULT_SUBTITLE_REGION/);
  assert.match(composerSource, /<SubtitleRegionEditor/);
  assert.match(source, /subtitleRegionNormalized/);
  assert.match(source, /setSubtitleRegion\(\{ \.\.\.DEFAULT_SUBTITLE_REGION \}\)/);
});

test('confirmation discloses possible paid stages without inventing a price', () => {
  assert.match(source, /确认开始口播翻译/);
  assert.match(source, /视频时长/);
  assert.match(source, /Gemini 视频分析/);
  assert.match(source, /KIE Gemini 3\.1 Flash TTS/);
  assert.match(source, /Golden 去文案/);
  assert.doesNotMatch(source, /预计(?:积分|价格|金额)|￥|¥|\d+\s*积分/);
});

test('workspace keeps one synchronous submission lock through async completion', () => {
  assert.match(source, /submitLockRef\.current/);
  assert.match(source, /submitLockRef\.current = true/);
  assert.match(source, /await onSubmit\(draft\)/);
  assert.match(source, /submitLockRef\.current = false/);
  assert.doesNotMatch(source, /userId: 'workspace'|activeSubmissionKeyRef/);
  assert.match(shellSource, /findActiveVoiceoverSubmissionIdentity\(/);
});

test('feature readiness blocks only new submission and keeps the workspace visible', () => {
  assert.match(source, /publicConfig\?\.enabled/);
  assert.match(source, /publicConfig\?\.ready/);
  assert.match(source, /历史项目仍可查看/);
  assert.doesNotMatch(videoModuleSource, /publicConfig\?\.enabled\s*&&\s*<VoiceoverTranslationWorkspace/);
});

test('video-generation permission blocks upload and transcode without hiding the workspace', () => {
  assert.match(source, /creationDisabledReason\?: string/);
  assert.match(source, /creationDisabledReason \|\|/);
  const prepareStart = source.indexOf('const prepareFile = useCallback');
  const prepareEnd = source.indexOf('const chooseFile = useCallback', prepareStart);
  const prepareBlock = source.slice(prepareStart, prepareEnd);
  assert.match(prepareBlock, /if \(!canCreate\)/);
  assert.ok(
    prepareBlock.indexOf('if (!canCreate)') < prepareBlock.indexOf('createMediaTranscodeSession({'),
  );
  assert.match(source, /useEffect\(\(\) => \{\s*if \(!canCreate\) return undefined;\s*const identity = sourceIdentity\(initialSource\)/);
  assert.match(composerSource, /disabled=\{!canCreate \|\| preparing \|\| submitting\}/);
  assert.match(videoModuleSource, /creationDisabledReason=\{voiceoverCreationDisabledReason\}/);
});

test('media sessions are cancelled promptly on convert failure, validation failure, abort, clear, and unmount', () => {
  assert.match(source, /let createdSessionId = ''/);
  assert.match(source, /let conversionCompleted = false/);
  assert.match(source, /createdSessionId = probe\.sessionId/);
  assert.match(source, /conversionCompleted = true/);
  assert.match(source, /createdSessionId\s*&& !conversionCompleted/);
  assert.match(source, /await cancelMediaSessionOnce\(createdSessionId\)/);
  assert.match(source, /const cancelMediaSessionOnce = useCallback[\s\S]*await cancelMediaTranscodeSession/);
  assert.match(source, /const clearSource = useCallback[\s\S]*cancelMediaSessionOnce\(sessionId\)/);
  assert.match(source, /return \(\) => \{[\s\S]*sessionIdRef\.current = ''[\s\S]*cancelMediaSessionOnce\(sessionId\)/);
});

test('each preparation owns its async UI and session mutations, including a late probe and initial-source cleanup', () => {
  const prepareStart = source.indexOf('const prepareFile = useCallback');
  const prepareEnd = source.indexOf('const chooseFile = useCallback', prepareStart);
  const prepareBlock = source.slice(prepareStart, prepareEnd);
  const localSessionIndex = prepareBlock.indexOf('createdSessionId = probe.sessionId');
  const lateProbeGuardIndex = prepareBlock.indexOf('if (!ownsPreparation()) return', localSessionIndex);
  const sharedSessionWriteIndex = prepareBlock.indexOf('sessionIdRef.current = createdSessionId', localSessionIndex);

  assert.match(prepareBlock, /lifecycleSignal\?: AbortSignal/);
  assert.match(prepareBlock, /const ownsPreparation = \(\) => \(\s*mountedRef\.current\s*&& controllerRef\.current === controller\s*&& !controller\.signal\.aborted/);
  assert.match(prepareBlock, /lifecycleSignal\?\.addEventListener\('abort', abortForLifecycle, \{ once: true \}\)/);
  assert.ok(localSessionIndex >= 0);
  assert.ok(localSessionIndex < lateProbeGuardIndex);
  assert.ok(lateProbeGuardIndex < sharedSessionWriteIndex);
  assert.match(prepareBlock, /onUploadProgress:[\s\S]*if \(!ownsPreparation\(\)\) return/);
  assert.match(prepareBlock, /if \(!ownsPreparation\(\)\) return;\s*conversionCompleted = true/);
  assert.match(prepareBlock, /catch \(error\) \{\s*if \(!ownsPreparation\(\)\) return/);
  assert.match(prepareBlock, /const ownsFinalMutation = controllerRef\.current === controller/);
  assert.match(prepareBlock, /if \(mountedRef\.current && ownsFinalMutation\) setPreparing\(false\)/);
  assert.match(prepareBlock, /lifecycleSignal\?\.removeEventListener\('abort', abortForLifecycle\)/);
  assert.match(source, /await prepareFile\(file, initialSource!, controller\.signal\)/);
  assert.match(source, /const cancelledSessionIdsRef = useRef\(new Set<string>\(\)\)/);
});

test('account changes remount only the voiceover workspace so source and media session state cannot cross users', () => {
  const shellSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
  assert.match(videoModuleSource, /voiceoverAccountScopeKey: string/);
  assert.match(videoModuleSource, /<VoiceoverTranslationWorkspace\s+key=\{voiceoverAccountScopeKey\}/);
  assert.match(shellSource, /voiceoverAccountScopeKey=\{shellLocalScopeUserId \|\| 'anonymous'\}/);
});

test('voiceover draft validates a removal region only once', () => {
  const buildDraftStart = source.indexOf('const buildDraft = useCallback');
  const buildDraftEnd = source.indexOf('const handleSubmit = useCallback', buildDraftStart);
  const buildDraftBody = source.slice(buildDraftStart, buildDraftEnd);
  assert.equal(
    buildDraftBody.match(/subtitleRegionToPixels\(subtitleRegion, source\.width, source\.height\)/g)?.length,
    1,
  );
});

test('voiceover composer portals into its dedicated slot while content stays in natural flow', () => {
  assert.match(source, /createPortal/);
  assert.match(source, /document\.getElementById\(composerSlotId\)/);
  assert.match(videoModuleSource, /hidden=\{activeSubFeature !== 'voiceover_translation'\}/);
  assert.match(videoModuleSource, /composerSlotId="voiceover-translation-composer-slot"/);
  assert.match(shellSource, /id="voiceover-translation-composer-slot"/);
  assert.doesNotMatch(source, /h-\[[^\]]+\].*overflow-y-(?:auto|scroll)|max-h-\[[^\]]+\].*overflow-y-(?:auto|scroll)/);
});
