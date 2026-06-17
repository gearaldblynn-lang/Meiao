import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');

test('chat composer reasoning menu uses shared default selection instead of the first raw level', () => {
  assert.match(source, /import \{ resolveSessionReasoningLevel \} from '\.\/chatReasoningDefaults\.mjs';/);
  assert.match(source, /const effectiveReasoningLevel = selectedModelOption\?\.supportsReasoningLevel/);
  assert.match(source, /resolveSessionReasoningLevel\(\{/);
  assert.doesNotMatch(source, /\(reasoningLevel \|\| reasoningLevels\[0\] \|\| ''\) === level/);
});

test('chat composer reasoning controls live inside a lightweight config sub menu', () => {
  assert.match(source, /agent-composer-config-menu/);
  assert.match(source, /agent-composer-config-main/);
  assert.match(source, /agent-composer-config-detail/);
  assert.match(source, /agent-composer-config-popout/);
  assert.match(source, /agent-composer-config-reasoning/);
  assert.match(source, /setConfigPane\(configPane === 'reasoning' \? 'main' : 'reasoning'\)/);
  assert.match(source, /configPane !== 'main' \? 'pointer-events-none opacity-45 blur-\[1\.5px\]' : ''/);
  assert.match(source, /absolute inset-0 z-10/);
  assert.match(source, /const configOptionClassName =/);
  assert.match(source, /text-\[11px\]/);
  assert.match(source, /py-1/);
  assert.match(source, /text-\[10px\]/);
  assert.match(source, /space-y-0\.5/);
  assert.match(source, /思考强度/);
  assert.doesNotMatch(source, /absolute left-0 bottom-11 z-20/);
  assert.doesNotMatch(source, /bottom-full mb-2/);
  assert.doesNotMatch(source, /agent-composer-config-(models|reasoning)[^"]*overflow-y-auto/);
  assert.doesNotMatch(source, /agent-composer-config-(models|reasoning)[^"]*shadow-\[0_20px_60px/);
  assert.doesNotMatch(source, /<LegacyFaIcon icon="fa-brain" className="text-\[12px\]" \/>/);
  assert.doesNotMatch(source, /<LegacyFaIcon icon="fa-check" className="text-\[11px\]" \/>/);
  assert.doesNotMatch(source, /grid grid-cols-2 gap-2/);
  assert.doesNotMatch(source, /agent-composer-config-detail agent-composer-config-models mt-2/);
  assert.doesNotMatch(source, /agent-composer-config-detail agent-composer-config-reasoning mt-2/);
});

test('chat composer toolbar icons expose visible hover and focus tooltips', () => {
  assert.match(source, /const IconTooltip = \(\{ label \}: \{ label: string \}\) =>/);
  assert.match(source, /group-hover:opacity-100 group-focus-visible:opacity-100/);
  assert.match(source, /<IconTooltip label=\{uploadStatusLabel\} \/>/);
  assert.match(source, /<IconTooltip label=\{configStatusLabel\} \/>/);
});

test('chat composer toggle icons expose a high-contrast pressed state', () => {
  assert.match(source, /bg-\[color:var\(--accent-soft\)\]/);
  assert.match(source, /text-\[color:var\(--accent\)\]/);
  assert.match(source, /shadow-\[0_0_0_3px_var\(--accent-soft\)\]/);
  assert.match(source, /aria-pressed=\{imageModeEnabled\}/);
  assert.match(source, /aria-pressed=\{webSearchEnabled\}/);
  assert.match(source, /aria-pressed=\{active\}/);
});

test('chat composer sends with Enter and keeps Shift+Enter for newline', () => {
  assert.match(source, /const handleComposerKeyDown = \(event: React\.KeyboardEvent<HTMLTextAreaElement>\) =>/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /!event\.shiftKey/);
  assert.match(source, /!event\.nativeEvent\.isComposing/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /onSendMessage\(\)/);
  assert.match(source, /onKeyDown=\{handleComposerKeyDown\}/);
});

test('chat composer capability bar exposes GPT style visible pills', () => {
  assert.match(source, /const capabilityIconClassName = \(active: boolean, available: boolean\) =>/);
  assert.match(source, /const webStatusLabel = selectedModelOption\?\.supportsWebSearch/);
  assert.match(source, /const reasoningStatusLabel = selectedModelOption\?\.supportsReasoningLevel/);
  assert.match(source, /const imageModeStatusLabel = !imageModeAvailable/);
  assert.match(source, /const uploadStatusLabel = attachments\.length > 0 \? `上传 · \$\{attachments\.length\}` : '上传';/);
  assert.match(source, /const configStatusLabel = `配置 · \$\{selectedModelLabel\}`;/);
  assert.match(source, /agent-composer-upload-menu/);
  assert.match(source, /agent-composer-config-menu/);
  assert.match(source, /agent-composer-status-dot/);
  assert.match(source, /<IconTooltip label=\{uploadStatusLabel\} \/>/);
  assert.match(source, /<IconTooltip label=\{configStatusLabel\} \/>/);
  assert.doesNotMatch(source, /<span>\{uploadStatusLabel\}<\/span>/);
  assert.doesNotMatch(source, /<span>\{configStatusLabel\}<\/span>/);
  assert.doesNotMatch(source, /<span>\+ 附件<\/span>/);
  assert.doesNotMatch(source, /<span>模型 · \{selectedModelLabel\}<\/span>/);
});

test('chat composer popovers use the shared translucent glass surface', () => {
  assert.match(source, /const composerPopoverSurfaceClassName =/);
  assert.match(source, /backdrop-blur-2xl/);
  assert.match(source, /bg-white\/\[0\.88\]/);
  assert.match(source, /side="top"/);
  assert.match(source, /avoidCollisions=\{false\}/);
  assert.match(source, /agent-composer-upload-menu \$\{composerPopoverSurfaceClassName\}/);
  assert.match(source, /agent-composer-config-menu \$\{composerPopoverSurfaceClassName\}/);
  assert.doesNotMatch(source, /shadow-\[0_18px_40px_rgba\(15,23,42,0\.12\)\]/);
});

test('chat composer stays writable while an agent run is active and labels send intent by phase', () => {
  assert.match(source, /runSubmissionMode\?: 'idle' \| 'insert' \| 'queue';/);
  assert.match(source, /const sendButtonLabel = runSubmissionMode === 'queue' \? '加入下一轮' : runSubmissionMode === 'insert' \? '插入引导' : '发送';/);
  assert.match(source, /placeholder=\{runSubmissionMode === 'queue'/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| sending\}/);
  assert.doesNotMatch(source, /const canSend = !disabled && !uploading && !sending/);
});

test('chat composer capability labels expose unavailable and capacity states without relying on tooltips', () => {
  assert.match(source, /const imageAttachmentCount = attachments\.filter\(\(attachment\) => attachment\.kind === 'image'\)\.length;/);
  assert.match(source, /const webStatusLabel = selectedModelOption\?\.supportsWebSearch/);
  assert.match(source, /: '联网不可用';/);
  assert.match(source, /const reasoningStatusLabel = selectedModelOption\?\.supportsReasoningLevel/);
  assert.match(source, /: '思考不可用';/);
  assert.match(source, /const imageModeStatusLabel = !imageModeAvailable/);
  assert.match(source, /`生图开 · \$\{imageAttachmentCount\}\/\$\{imageMaxInputCount\}`/);
});

test('chat composer translates provider reasoning levels to Chinese labels', () => {
  assert.match(source, /const REASONING_LEVEL_LABELS: Record<string, string> = \{/);
  assert.match(source, /minimal: '极低'/);
  assert.match(source, /low: '低'/);
  assert.match(source, /medium: '中等'/);
  assert.match(source, /high: '高'/);
  assert.match(source, /xhigh: '极高'/);
  assert.match(source, /const formatReasoningLevelLabel = \(level: string \| null \| undefined\) =>/);
  assert.match(source, /`思考 \$\{formatReasoningLevelLabel\(effectiveReasoningLevel\)\}`/);
  assert.match(source, /\{formatReasoningLevelLabel\(level\)\}/);
});
