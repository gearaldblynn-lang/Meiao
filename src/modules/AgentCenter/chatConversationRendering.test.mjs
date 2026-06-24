import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatConversationPane.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('./AgentCenterChatWorkspace.tsx', import.meta.url), 'utf8');
const displaySource = readFileSync(new URL('./chatMessageDisplay.mjs', import.meta.url), 'utf8');

test('chat conversation rendering hides provider protocol markers from old replies', () => {
  assert.match(source, /stripConversationProtocolMarkersBase/);
  assert.match(source, /const stripConversationProtocolMarkers = \(content: string\): string =>/);
  assert.match(displaySource, /final_answer/);
  assert.match(source, /const protocolDisplayContent = stripConversationProtocolMarkers\(handoff \? stripHandoffBlock\(message\.content\) : message\.content\);/);
});

test('image generation result summaries do not render raw provider image urls', () => {
  assert.match(source, /stripImageResultUrlsBase/);
  assert.match(displaySource, /aiquickdraw/);
  assert.match(source, /const stripImageResultUrls = \(content: string\): string =>/);
  assert.match(source, /const summaryContent = stripImageResultUrls\(message\.content\);/);
  assert.match(source, /const showImageSummary = !isPending && Boolean\(summaryContent\);/);
  assert.doesNotMatch(source, /\{message\.content\}<\/p>/);
});

test('tool-called image results render as image result cards even when request mode is chat', () => {
  assert.match(source, /const hasAssistantImageResults = \(message: AgentChatMessage\) =>/);
  assert.match(source, /Array\.isArray\(message\.metadata\?\.imageResultUrls\)/);
  assert.match(source, /Boolean\(message\.metadata\?\.imagePlan\)/);
  assert.match(source, /message\.attachments\.some\(\(item\) => item\.kind === 'image' && item\.url\)/);
  assert.match(source, /message\.role === 'assistant' && \(message\.metadata\?\.requestMode === 'image_generation' \|\| hasAssistantImageResults\(message\)\)/);
  assert.match(source, /isImageGenerationMessage\(message\) && Array\.isArray\(message\.attachments\)/);
});

test('image result card keeps final summary in the result layer instead of a separate summary button', () => {
  assert.match(source, /const showImageSummary = !isPending && Boolean\(summaryContent\);/);
  assert.match(source, /<MarkdownMessage content=\{summaryContent\} \/>/);
  assert.doesNotMatch(source, /<span>结果总结<\/span>/);
  assert.doesNotMatch(source, /展开结果总结/);
});

test('image result card uses a selected primary image with vertical thumbnails for multiple outputs', () => {
  assert.match(source, /selectedImageIndexes/);
  assert.match(source, /const selectedImageIndex = Math\.min\(/);
  assert.match(source, /const primaryImage = previewImages\[selectedImageIndex\] \|\| null;/);
  assert.match(source, /agent-image-result-primary/);
  assert.match(source, /agent-image-result-thumbnails/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)_72px\]/);
  assert.match(source, /max-w-\[min\(760px,100%\)\]/);
  assert.match(source, /max-h-\[58vh\]/);
  assert.match(source, /overflow-y-auto overflow-x-hidden/);
  assert.match(source, /setSelectedImageIndexes/);
  assert.match(source, /aria-current=\{index === selectedImageIndex \? 'true' : undefined\}/);
  assert.doesNotMatch(source, /overflow-x-auto/);
  assert.doesNotMatch(source, /secondaryPreviewImages/);
  assert.doesNotMatch(source, /max-w-\[min\(480px,100%\)\]/);
  assert.doesNotMatch(source, /max-w-\[min\(560px,100%\)\]/);
  assert.doesNotMatch(source, /max-h-\[70vh\] w-full rounded-\[18px\] object-contain/);
});

test('image result card uses a bottom image action layer instead of top-right utility icons', () => {
  assert.match(source, /agent-image-result-actions/);
  assert.match(source, /agent-image-result-edit/);
  assert.match(source, /aria-label="编辑图片"/);
  assert.match(source, /aria-label="下载图片"/);
  assert.match(source, /inline-flex h-10 w-10 items-center justify-center/);
  assert.match(source, /icon="fa-wand-magic-sparkles" className="text-\[15px\]"/);
  assert.match(source, /icon="fa-wand-magic-sparkles"/);
  assert.doesNotMatch(source, /<span>编辑<\/span>/);
  assert.doesNotMatch(source, /<IconTooltip label="编辑图片" \/>/);
  assert.doesNotMatch(source, /<IconTooltip label="下载图片" \/>/);
  assert.doesNotMatch(source, /absolute right-3 top-3/);
  assert.doesNotMatch(source, /agent-image-result-primary[\s\S]*aria-label="放入当前输入框"[\s\S]*agent-image-result-thumbnails/);
});

test('assistant text replies also strip legacy provider image urls before markdown rendering', () => {
  assert.match(source, /const assistantDisplayContent = !isUser \? stripImageResultUrls\(protocolDisplayContent\) : protocolDisplayContent;/);
  assert.match(source, /<MarkdownMessage content=\{assistantDisplayContent\} \/>/);
});

test('assistant replies render a unified folded run trace across chat and image modes', () => {
  assert.match(source, /const getAssistantRunStages = \(message: AgentChatMessage\) =>/);
  assert.match(source, /const shouldShowAssistantRunTrace = \(message: AgentChatMessage\) =>/);
  assert.match(source, /const getAssistantThoughtTrace = \(message: AgentChatMessage, turnInputMessage\?: AgentChatMessage \| null\) =>/);
  assert.match(source, /思考中/);
  assert.match(source, /检索知识库/);
  assert.match(source, /联网搜索/);
  assert.match(source, /调用工具/);
  assert.match(source, /生成图片/);
  assert.match(source, /完成/);
  assert.match(source, /失败/);
  assert.match(source, /思考过程/);
  assert.match(source, /reasoningSummary/);
  assert.match(source, /toolCall/);
  assert.match(source, /contextTrace/);
  assert.match(source, /const getReadableContextTrace = \(contextTrace: Record<string, unknown>\) =>/);
  assert.match(source, /const getTurnInputTrace = \(message: AgentChatMessage, turnInputMessage\?: AgentChatMessage \| null\) =>/);
  assert.match(source, /const getCapabilityTrace = \(message: AgentChatMessage, contextTrace: Record<string, unknown>\) =>/);
  assert.match(source, /const getResultTrace = \(message: AgentChatMessage\) =>/);
  assert.match(source, /本轮输入/);
  assert.match(source, /包含 \$\{imageCount\} 张图片/);
  assert.match(source, /启用能力/);
  assert.match(source, /生图/);
  assert.match(source, /结果/);
  assert.match(source, /生成 \$\{imageResultCount\} 张图片/);
  assert.match(source, /历史消息/);
  assert.match(source, /会话摘要/);
  assert.match(source, /知识库：命中/);
  assert.match(source, /messages\.slice\(0, index\)\.reverse\(\)\.find\(\(item\) => item\.role === 'user'\)/);
  assert.match(source, /renderAssistantRunTrace\(message, previousUserMessage\)/);
  assert.match(source, /renderImageGenerationMessage\(message, previousUserMessage\)/);
  assert.doesNotMatch(source, /formatTraceContent\(contextTrace\)/);
  assert.doesNotMatch(source, /label: '上下文', content: contextContent/);
  assert.match(source, /retrievalSummary/);
  assert.match(source, /shouldShowAssistantRunTrace\(message\)/);
  assert.match(source, /className="assistant-run-trace/);
  assert.match(source, /renderAssistantRunTrace\(message, previousUserMessage\)/);
  assert.doesNotMatch(source, /getAssistantRunDetails/);
  assert.doesNotMatch(source, /run-detail/);
  assert.doesNotMatch(source, /grid gap-1\.5 sm:grid-cols-2/);
  assert.doesNotMatch(source, /providerTaskId.*thoughtTrace/s);
  assert.doesNotMatch(source, /<summary[^>]*>\s*运行步骤\s*<\/summary>/);
  assert.doesNotMatch(source, /<summary[^>]*>\s*执行详情\s*<\/summary>/);
});

test('chat conversation uses chat-first reading layout instead of assistant cards', () => {
  assert.match(source, /max-w-\[78%\]/);
  assert.match(source, /isUser \? 'rounded-\[18px\] border px-3\.5 py-2\.5' : 'px-1 py-1'/);
  assert.match(source, /background: 'transparent', borderColor: 'transparent'/);
  assert.match(source, /className="mt-1 h-7 w-7 rounded-\[10px\] text-\[10px\] opacity-70"/);
  assert.doesNotMatch(source, /shadow-\[0_8px_22px/);
});

test('run view exposes diagnostics while keeping debug fields out of assistant text', () => {
  assert.match(workspaceSource, /const runDiagnostics = useMemo\(/);
  assert.match(workspaceSource, /模型/);
  assert.match(workspaceSource, /Provider/);
  assert.match(workspaceSource, /工具/);
  assert.match(workspaceSource, /错误码/);
  assert.match(workspaceSource, /知识库命中/);
  assert.match(workspaceSource, /耗时/);
  assert.doesNotMatch(source, /providerTaskId.*MarkdownMessage/s);
  assert.doesNotMatch(source, /function_call_output.*MarkdownMessage/s);
});
