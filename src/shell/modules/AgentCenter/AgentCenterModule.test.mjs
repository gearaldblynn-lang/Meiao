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

test('agent factory stays focused on old agent management without nesting Smart Factory', () => {
  assert.doesNotMatch(shellModuleSource, /import SmartFactoryPanel/);
  assert.match(shellModuleSource, /useState<'overview' \| 'manager'>\('overview'\)/);
  assert.doesNotMatch(shellModuleSource, /setFactoryView\('smart_factory'\)/);
  assert.doesNotMatch(shellModuleSource, /<SmartFactoryPanel/);
  assert.match(shellModuleSource, /<AgentCenterManager/);
});

test('agent edit wizard submits the draft version being edited instead of the selected published version', () => {
  assert.match(managerSource, /editingVersionId/);
  assert.match(managerSource, /setEditingVersionId\(editableVersion\.id\)/);
  assert.match(managerSource, /const editingVersion = versions\.find\(\(item\) => item\.id === editingVersionId\) \|\| selectedVersion;/);
  assert.match(managerSource, /await updateAgentVersion\(editingVersion\.id,/);
  assert.doesNotMatch(managerSource, /await updateAgentVersion\(selectedVersion\.id,/);
});

test('agent factory validation targets the editable draft and keeps its validation result selected', () => {
  assert.match(managerSource, /const loadAgents = async \(preferredAgentId = selectedAgentId, preferredVersionId = selectedVersionId\) =>/);
  assert.match(managerSource, /const nextVersion = detail\.versions\.find\(\(item\) => item\.id === preferredVersionId\) \|\| detail\.versions\[0\] \|\| null;/);
  assert.match(managerSource, /setValidationResult\(nextVersion\?\.validationSummary \|\| null\)/);
  assert.match(managerSource, /const targetVersion = draftVersion \|\| selectedVersion;/);
  assert.match(managerSource, /validateAgentVersion\(targetVersion\.id, validationMessage\)/);
  assert.match(managerSource, /await loadAgents\(selectedAgentId, targetVersion\.id\)/);
  assert.doesNotMatch(managerSource, /validateAgentVersion\(selectedVersion\.id, validationMessage\)/);
});

test('shell chat message refresh preserves local pending messages while a send is in flight', () => {
  assert.match(shellModuleSource, /const mergePendingLocalMessages = \(\s*currentMessages: AgentChatMessage\[\],\s*incomingMessages: AgentChatMessage\[\],\s*sessionId: string,\s*\) =>/);
  assert.match(shellModuleSource, /incomingClientRequestIds\.has\(clientRequestId\)/);
  assert.match(shellModuleSource, /updateMessagesForSession\(targetSessionId, \(current\) => mergePendingLocalMessages\(current, result\.messages, targetSessionId\)\)/);
  assert.doesNotMatch(shellModuleSource, /applyMessagesForSession\(targetSessionId, result\.messages\);/);
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
  assert.match(shellModuleSource, /const MessageActionTooltip = \(\{ label \}: \{ label: string \}\) =>/);
  assert.match(shellModuleSource, /agent-message-action-icon/);
  assert.match(shellModuleSource, /h-9 w-9/);
  assert.match(shellModuleSource, /text-\[15px\]/);
  assert.match(shellModuleSource, /title="复制消息"/);
  assert.match(shellModuleSource, /aria-label="复制消息"/);
  assert.match(shellModuleSource, /<MessageActionTooltip label="复制消息" \/>/);
  assert.match(shellModuleSource, /title="重新生成"/);
  assert.match(shellModuleSource, /aria-label="重新生成"/);
  assert.match(shellModuleSource, /<MessageActionTooltip label="重新生成" \/>/);
  assert.doesNotMatch(shellModuleSource, />\s*复制\s*</);
  assert.doesNotMatch(shellModuleSource, />\s*重新生成\s*</);
});

test('shell agent center preserves glass styling for chat composer popovers', () => {
  assert.match(shellModuleSource, /\.agent-composer-config-menu,\n\s+\.agent-composer-upload-menu,/);
  assert.match(shellModuleSource, /\.agent-center-shell-scope \.agent-composer-config-menu/);
  assert.match(shellModuleSource, /\.agent-center-shell-scope \.agent-composer-upload-menu/);
  assert.match(shellModuleSource, /background: rgba\(255, 255, 255, 0\.78\) !important;/);
  assert.match(shellModuleSource, /backdrop-filter: blur\(28px\) saturate\(1\.22\) !important;/);
  assert.match(shellModuleSource, /\.agent-composer-config-popout/);
  assert.match(shellModuleSource, /background: rgba\(255, 255, 255, 0\.46\) !important;/);
  assert.match(shellModuleSource, /box-shadow: none !important;/);
});

test('shell chat workspace keeps restored pending runs visible and locked', () => {
  assert.match(shellModuleSource, /const isPendingAgentRunMessage = \(message\?: AgentChatMessage \| null\) =>/);
  assert.match(shellModuleSource, /const activePendingRunMessage = useMemo\(/);
  assert.match(shellModuleSource, /const activePendingClientRequestId = String\(activePendingRunMessage\?\.metadata\?\.clientRequestId \|\| ''\)\.trim\(\);/);
  assert.match(shellModuleSource, /const hasActivePendingRun = Boolean\(activePendingRunMessage\);/);
  assert.match(shellModuleSource, /void pollPendingRun\(\);/);
  assert.match(shellModuleSource, /window\.setInterval\(\(\) => \{\s*void pollPendingRun\(\);\s*\}, 3000\);/);
  assert.match(shellModuleSource, /const runSubmissionMode(: RunSubmissionMode)? =/);
  assert.match(shellModuleSource, /FINAL_EXECUTION_PROGRESS_STAGES/);
  assert.match(shellModuleSource, /'image_validating'/);
  assert.match(shellModuleSource, /'image_validation_failed'/);
  assert.match(shellModuleSource, /'image_regenerating'/);
  assert.match(shellModuleSource, /imageExecutionStageActive/);
  assert.match(shellModuleSource, /pendingAutoSubmission/);
  assert.match(shellModuleSource, /queueChatSubmission/);
  assert.match(shellModuleSource, /interruptingChatSubmissionRef/);
  assert.match(shellModuleSource, /if \(runSubmissionMode === 'queue'\)/);
  assert.match(shellModuleSource, /if \(runSubmissionMode === 'insert'\)/);
  assert.doesNotMatch(shellModuleSource, /if \(sendingMessage \|\| hasActivePendingRun \|\| !selectedSessionId/);
  assert.match(shellModuleSource, /sendingMessage=\{sendingMessage \|\| hasActivePendingRun\}/);
  assert.match(shellModuleSource, /runSubmissionMode=\{runSubmissionMode\}/);
  assert.match(shellModuleSource, /queuedMessageCount=\{queuedMessageCount\}/);
  assert.doesNotMatch(shellModuleSource, /const handleInterruptSend =/);
  assert.doesNotMatch(shellModuleSource, /onInterruptSend=\{sendingMessage \? handleInterruptSend : undefined\}/);
});

test('shell chat progress handles image tool calling SSE events', () => {
  assert.match(shellModuleSource, /eventType === 'tool_calling'/);
  assert.match(shellModuleSource, /分析需求中/);
  assert.match(shellModuleSource, /eventType === 'image_generating'/);
  assert.match(shellModuleSource, /生成图片中/);
  assert.match(shellModuleSource, /eventType === 'searching_knowledge'/);
  assert.match(shellModuleSource, /检索知识库中/);
  assert.match(shellModuleSource, /eventType === 'image_validating'/);
  assert.match(shellModuleSource, /eventType === 'image_validation_failed'/);
  assert.match(shellModuleSource, /eventType === 'image_regenerating'/);
  assert.match(shellModuleSource, /content: '生成图片中\.\.\.'/);
  assert.doesNotMatch(shellModuleSource, /检查生成结果中/);
  assert.doesNotMatch(shellModuleSource, /生成结果未通过检查/);
  assert.doesNotMatch(shellModuleSource, /根据检查结果重新生成/);
  assert.match(shellModuleSource, /eventType === 'image_ready'/);
  assert.match(shellModuleSource, /imageResultUrls/);
  assert.match(shellModuleSource, /imagePlan/);
});
