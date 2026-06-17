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

test('chat composer reasoning menu opens upward to avoid clipping near the bottom composer area', () => {
  assert.match(source, /absolute left-0 bottom-11 z-20/);
});

test('chat composer toolbar icons expose visible hover and focus tooltips', () => {
  assert.match(source, /const IconTooltip = \(\{ label \}: \{ label: string \}\) =>/);
  assert.match(source, /group-hover:opacity-100 group-focus-visible:opacity-100/);
  assert.match(source, /<IconTooltip label=\{modelHint\} \/>/);
  assert.match(source, /<IconTooltip label=\{attachmentHint\} \/>/);
  assert.match(source, /<IconTooltip label=\{folderHint\} \/>/);
  assert.match(source, /<IconTooltip label=\{imageModeHint\} \/>/);
  assert.match(source, /<IconTooltip label=\{webHint\} \/>/);
  assert.match(source, /<IconTooltip label=\{reasoningHint\} \/>/);
});

test('chat composer toggle icons expose a high-contrast pressed state', () => {
  assert.match(source, /bg-\[color:var\(--accent-soft\)\]/);
  assert.match(source, /text-\[color:var\(--accent\)\]/);
  assert.match(source, /shadow-\[0_0_0_3px_var\(--accent-soft\)\]/);
  assert.match(source, /aria-pressed=\{imageModeEnabled\}/);
  assert.match(source, /aria-pressed=\{webSearchEnabled\}/);
  assert.match(source, /aria-pressed=\{Boolean\(reasoningLevel\)\}/);
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
  assert.match(source, /const capabilityPillClassName = \(active: boolean, available: boolean\) =>/);
  assert.match(source, /const webStatusLabel = selectedModelOption\?\.supportsWebSearch/);
  assert.match(source, /const reasoningStatusLabel = selectedModelOption\?\.supportsReasoningLevel/);
  assert.match(source, /const imageModeStatusLabel = !imageModeAvailable/);
  assert.match(source, /<span>模型 · \{selectedModelLabel\}<\/span>/);
  assert.match(source, /<span>\{webStatusLabel\}<\/span>/);
  assert.match(source, /<span>\{reasoningStatusLabel\}<\/span>/);
  assert.match(source, /<span>\{imageModeStatusLabel\}<\/span>/);
  assert.match(source, /<span>\+ 附件<\/span>/);
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
  assert.match(source, /<span>\{formatReasoningLevelLabel\(level\)\}<\/span>/);
});
