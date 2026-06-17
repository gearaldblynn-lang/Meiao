import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellAppSource = readFileSync(new URL('../../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const shellModuleSource = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');
const managerSource = readFileSync(new URL('../../../modules/AgentCenter/AgentCenterManager.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../../../modules/AgentCenter/AgentDetailView.tsx', import.meta.url), 'utf8');
const chatWorkspaceSource = readFileSync(new URL('../../../modules/AgentCenter/AgentCenterChatWorkspace.tsx', import.meta.url), 'utf8');

test('shell app mounts the upgraded shell agent center instead of directly copying the old module', () => {
  assert.match(shellAppSource, /lazy\(\(\) => import\('\.\/shell\/modules\/AgentCenter\/AgentCenterModule'\)\)/);
  assert.doesNotMatch(shellModuleSource, /export \{ default \} from/);
  assert.match(shellModuleSource, /var\(--bg-surface\)/);
  assert.match(shellModuleSource, /moduleCopy/);
});

test('agent center keeps plaza, factory, and real studio workflows available', () => {
  assert.match(shellModuleSource, /workspaceMode/);
  assert.match(shellModuleSource, /智能体广场/);
  assert.match(shellModuleSource, /智能体工厂/);
  assert.match(shellModuleSource, /AgentCenterManager/);
  assert.match(shellModuleSource, /AgentCenterChatWorkspace/);
  assert.match(managerSource, /page === 'agent_studio'/);
  assert.match(detailSource, /智能体工作室/);
});

test('shell agent center keeps async chat results scoped to the active session', () => {
  assert.match(shellModuleSource, /const selectedSessionIdRef = useRef\(selectedSessionId\);/);
  assert.match(shellModuleSource, /const loadChatRequestSeqRef = useRef\(0\);/);
  assert.match(shellModuleSource, /const messageLoadSeqRef = useRef\(0\);/);
  assert.match(shellModuleSource, /const applyMessagesForSession = \(sessionId: string, nextMessages: AgentChatMessage\[\]\) =>/);
  assert.match(shellModuleSource, /const sendSessionId = selectedSessionId;/);
  assert.match(shellModuleSource, /sendChatMessage\(sendSessionId,/);
  assert.match(shellModuleSource, /await syncCompletedMessageAfterTimeout\(sendSessionId, clientRequestId\)/);
});

test('shell chat workspace exposes assistant message actions for copy and regenerate', () => {
  assert.match(chatWorkspaceSource, /renderMessageActions\?: \(message: AgentChatMessage\) => React\.ReactNode;/);
  assert.match(chatWorkspaceSource, /renderMessageActions,/);
  assert.match(chatWorkspaceSource, /renderMessageActions=\{renderMessageActions\}/);

  assert.match(shellModuleSource, /const handleCopyMessage = useCallback/);
  assert.match(shellModuleSource, /copyTextToClipboard\(getVisibleMessageText\(message\)\)/);
  assert.match(shellModuleSource, /const handleRegenerateMessage = useCallback/);
  assert.match(shellModuleSource, /message\.role !== 'assistant'/);
  assert.match(shellModuleSource, /resolveRegenerateRequest\(\{/);
  assert.match(shellModuleSource, /selectedModelOverride: regenerateRequest\.selectedModel/);
  assert.match(shellModuleSource, /reasoningLevelOverride: regenerateRequest\.reasoningLevel/);
  assert.match(shellModuleSource, /webSearchEnabledOverride: regenerateRequest\.webSearchEnabled/);
  assert.match(shellModuleSource, /renderShellMessageActions/);
  assert.match(shellModuleSource, /handleCopyMessage\(message\)/);
  assert.match(shellModuleSource, /handleRegenerateMessage\(message\)/);
  assert.match(shellModuleSource, /renderMessageActions=\{renderShellMessageActions\}/);
});

test('shell assistant message actions are compact icon buttons with Chinese tooltips', () => {
  assert.match(shellModuleSource, /agent-message-action-icon/);
  assert.match(shellModuleSource, /title="复制消息"/);
  assert.match(shellModuleSource, /aria-label="复制消息"/);
  assert.match(shellModuleSource, /title="重新生成"/);
  assert.match(shellModuleSource, /aria-label="重新生成"/);
  assert.doesNotMatch(shellModuleSource, />\s*复制\s*</);
  assert.doesNotMatch(shellModuleSource, />\s*重新生成\s*</);
});

test('shell chat workspace keeps restored pending runs visible and locked', () => {
  assert.match(shellModuleSource, /const isPendingAgentRunMessage = \(message\?: AgentChatMessage \| null\) =>/);
  assert.match(shellModuleSource, /const activePendingRunMessage = useMemo\(/);
  assert.match(shellModuleSource, /const activePendingClientRequestId = String\(activePendingRunMessage\?\.metadata\?\.clientRequestId \|\| ''\)\.trim\(\);/);
  assert.match(shellModuleSource, /const hasActivePendingRun = Boolean\(activePendingRunMessage\);/);
  assert.match(shellModuleSource, /void pollPendingRun\(\);/);
  assert.match(shellModuleSource, /window\.setInterval\(\(\) => \{\s*void pollPendingRun\(\);\s*\}, 3000\);/);
  assert.match(shellModuleSource, /if \(sendingMessage \|\| hasActivePendingRun \|\| !selectedSessionId/);
  assert.match(shellModuleSource, /sendingMessage=\{sendingMessage \|\| hasActivePendingRun\}/);
  assert.match(shellModuleSource, /onInterruptSend=\{sendingMessage \? handleInterruptSend : undefined\}/);
});

test('shell chat progress handles image tool calling SSE events', () => {
  assert.match(shellModuleSource, /eventType === 'tool_calling'/);
  assert.match(shellModuleSource, /分析需求中/);
  assert.match(shellModuleSource, /eventType === 'image_generating'/);
  assert.match(shellModuleSource, /生成图片中/);
  assert.match(shellModuleSource, /eventType === 'image_ready'/);
  assert.match(shellModuleSource, /imageResultUrls/);
  assert.match(shellModuleSource, /imagePlan/);
});
