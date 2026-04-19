import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('translation module keeps submode switching in the sidebar instead of the workspace header', () => {
  const translationModule = read('../modules/Translation/TranslationModule.tsx');
  const settingsSidebar = read('../components/SettingsSidebar.tsx');

  assert.match(settingsSidebar, /headerContent=/);
  assert.match(settingsSidebar, /主图出海/);
  assert.doesNotMatch(translationModule, /<SegmentedTabs/);
});

test('translation file processor no longer renders the main start button in the workbench toolbar', () => {
  const fileProcessor = read('./FileProcessor.tsx');

  assert.doesNotMatch(fileProcessor, /启动出海翻译/);
  assert.match(fileProcessor, /主图出海/);
});

test('one click module keeps submode switching out of the workspace header', () => {
  const oneClickModule = read('../modules/OneClick/OneClickModule.tsx');
  const oneClickSidebar = read('../modules/OneClick/ConfigSidebar.tsx');

  assert.match(oneClickSidebar, /headerContent=/);
  assert.match(oneClickSidebar, /主图/);
  assert.match(oneClickSidebar, /详情/);
  assert.doesNotMatch(oneClickModule, /<SegmentedTabs/);
});

test('one click visuals avoid decorative english labels in the main work surfaces', () => {
  const oneClickSidebar = read('../modules/OneClick/ConfigSidebar.tsx');
  const workspacePrimitives = read('./ui/workspacePrimitives.tsx');
  const mainImage = read('../modules/OneClick/MainImageSubModule.tsx');
  const detailPage = read('../modules/OneClick/DetailPageSubModule.tsx');
  const header = read('./layout/Header.tsx');

  assert.doesNotMatch(oneClickSidebar, /Systematic Design Engine/);
  assert.doesNotMatch(mainImage, /Sync Multi-Screen Strategy/);
  assert.doesNotMatch(mainImage, /Ready for Production/);
  assert.doesNotMatch(detailPage, /Sequence Editor Console/);
  assert.doesNotMatch(detailPage, /Typography Logic Editor/);
  assert.doesNotMatch(detailPage, /Standby for Visual Logic/);
  assert.doesNotMatch(header, /Meiao Workspace/);
  assert.doesNotMatch(header, /Version/);
  assert.match(oneClickSidebar, /<PopoverSelect/);
  assert.match(workspacePrimitives, /bg-white\/72/);
  assert.doesNotMatch(oneClickSidebar, /ChoiceGrid/);
});

test('one click sidebars split design references from product assets and support grouped reference analysis', () => {
  const configSidebar = read('../modules/OneClick/ConfigSidebar.tsx');
  const skuSidebar = read('../modules/OneClick/SkuSidebar.tsx');
  const mainModule = read('../modules/OneClick/MainImageSubModule.tsx');
  const detailModule = read('../modules/OneClick/DetailPageSubModule.tsx');
  const skuModule = read('../modules/OneClick/SkuSubModule.tsx');

  assert.match(configSidebar, /设计参考/);
  assert.match(configSidebar, /产品素材/);
  assert.match(configSidebar, /品牌Logo/);
  assert.match(configSidebar, /logoImage/);
  assert.match(configSidebar, /产品素材与品牌Logo共用最多 8 张上限/);
  assert.match(configSidebar, /这组图需要参考的维度/);
  assert.match(configSidebar, /referenceDimensions/);
  assert.match(configSidebar, /referenceAnalysis/);
  assert.match(skuSidebar, /设计参考/);
  assert.match(skuSidebar, /文案内容/);
  assert.match(mainModule, /analyzeOneClickReferenceSet/);
  assert.match(detailModule, /analyzeOneClickReferenceSet/);
  assert.match(skuModule, /analyzeOneClickReferenceSet/);
  assert.match(mainModule, /OneClickSubMode\.MAIN_IMAGE/);
  assert.match(detailModule, /OneClickSubMode\.DETAIL_PAGE/);
  assert.match(skuModule, /OneClickSubMode\.SKU/);
  assert.match(mainModule, /referenceAnalysis\.summary/);
  assert.match(detailModule, /referenceAnalysis\.summary/);
  assert.match(skuModule, /referenceAnalysis\.summary/);
  assert.match(mainModule, /if \(!referenceSummary && designReferences\.length > 0 && referenceDimensions\.length > 0\)/);
  assert.match(detailModule, /if \(!referenceSummary && designReferences\.length > 0 && referenceDimensions\.length > 0\)/);
  assert.match(skuModule, /if \(!referenceSummary && designReferences\.length > 0 && referenceDimensions\.length > 0\)/);
  assert.match(configSidebar, /useState<'product' \| 'reference'>\('product'\)/);
  assert.match(configSidebar, /button onClick=\{\(\) => setAssetTab\('product'\)\}/);
  assert.match(configSidebar, /button onClick=\{\(\) => setAssetTab\('reference'\)\}/);
  assert.match(configSidebar, /const invalidateReferenceAnalysis =/);
  assert.match(skuSidebar, /type AssetTab = 'product' \| 'gift' \| 'reference'/);
  assert.match(skuSidebar, /useState<AssetTab>\('product'\)/);
  assert.match(skuSidebar, /button onClick=\{\(\) => setAssetTab\('product'\)\}/);
  assert.match(skuSidebar, /button onClick=\{\(\) => setAssetTab\('gift'\)\}/);
  assert.match(skuSidebar, /button onClick=\{\(\) => setAssetTab\('reference'\)\}/);
  assert.match(skuSidebar, /const invalidateReferenceAnalysis =/);
});

test('single image downloads use the shared remote download helper so filenames keep image extensions', () => {
  const mainModule = read('../modules/OneClick/MainImageSubModule.tsx');
  const detailModule = read('../modules/OneClick/DetailPageSubModule.tsx');
  const chatPane = read('../modules/AgentCenter/ChatConversationPane.tsx');
  const imageUtils = read('../utils/imageUtils.ts');

  assert.match(mainModule, /downloadRemoteFile/);
  assert.match(detailModule, /downloadRemoteFile/);
  assert.match(chatPane, /downloadRemoteFile/);
  assert.match(imageUtils, /ensureDownloadFileName/);
});

test('sidebar navigation separates business and system groups with readable labels', () => {
  const sidebar = read('./layout/SidebarNavigation.tsx');

  assert.doesNotMatch(sidebar, /业务模块/);
  assert.doesNotMatch(sidebar, /系统管理/);
  assert.doesNotMatch(sidebar, /rounded-\[24px\] border border-white\/8 bg-white\/5/);
  assert.match(sidebar, /iconOnly/);
  assert.match(sidebar, /AppModule\.AGENT_CENTER/);
});

test('app workspace mounts the agent center as a top-level module', () => {
  const app = read('../App.tsx');
  const moduleMeta = read('./layout/moduleMeta.ts');

  assert.match(app, /AgentCenterModule/);
  assert.match(app, /AppModule\.AGENT_CENTER/);
  assert.match(moduleMeta, /智能体中心/);
});

test('app workspace lazy loads major modules to avoid one giant startup bundle', () => {
  const app = read('../App.tsx');
  const viteConfig = read('../vite.config.ts');

  assert.match(app, /React,\s*\{\s*Suspense,/);
  assert.match(app, /lazy\(\(\) => import\('\.\/modules\/AgentCenter\/AgentCenterModule'\)\)/);
  assert.match(app, /lazy\(\(\) => import\('\.\/modules\/Video\/VideoModule'\)\)/);
  assert.match(app, /<Suspense fallback=/);
  assert.match(viteConfig, /manualChunks/);
});

test('release notes are surfaced from the sidebar user hub and notification center with first-open tracking', () => {
  const app = read('../App.tsx');
  const header = read('./layout/Header.tsx');
  const sidebar = read('./layout/SidebarNavigation.tsx');
  const toastSystem = read('./ToastSystem.tsx');
  const packageJson = read('../package.json');
  const releaseNotes = read('../config/releaseNotes.ts');

  assert.match(packageJson, /"version": "260407A"/);
  assert.match(releaseNotes, /export const APP_RELEASE_VERSION = 'V260407A'/);
  assert.match(releaseNotes, /首次打开/);
  assert.match(app, /RELEASE_NOTES_STORAGE_KEY/);
  assert.match(app, /localStorage\.getItem\(RELEASE_NOTES_STORAGE_KEY\)/);
  assert.match(app, /localStorage\.setItem\(RELEASE_NOTES_STORAGE_KEY, APP_RELEASE_VERSION\)/);
  assert.match(app, /showReleaseNotes/);
  assert.match(app, /openReleaseNotes/);
  assert.match(app, /ReleaseNotesModal/);
  assert.doesNotMatch(header, /releaseTag/);
  assert.doesNotMatch(header, /onOpenReleaseNotes/);
  assert.match(sidebar, /releaseTag: string/);
  assert.match(sidebar, /onOpenReleaseNotes\?: \(\) => void/);
  assert.match(sidebar, /serviceStatusLabel: string/);
  assert.match(sidebar, /toggleCenter/);
  assert.match(sidebar, /查看本次更新/);
  assert.match(toastSystem, /appVersion: string/);
  assert.match(toastSystem, /onOpenReleaseNotes: \(\) => void/);
  assert.match(toastSystem, /本次更新/);
  assert.match(toastSystem, /查看更新/);
});

test('login screen only prefills local default credentials for localhost testing', () => {
  const app = read('../App.tsx');
  const loginScreen = read('../components/Internal/LoginScreen.tsx');

  assert.match(app, /isLocalPreviewHost/);
  assert.match(app, /defaultUsername=\{isLocalPreviewHost \? '将离' : ''\}/);
  assert.match(app, /defaultPassword=\{isLocalPreviewHost \? '411422' : ''\}/);
  assert.match(loginScreen, /defaultUsername\?: string/);
  assert.match(loginScreen, /defaultPassword\?: string/);
});

test('agent center keeps chat available to staff while reserving management tabs for admins', () => {
  const agentCenter = read('../modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(agentCenter, /const canManage = Boolean\(internalMode && currentUser\?\.role === 'admin'\)/);
  assert.match(agentCenter, /const canAccessAgentCenter = Boolean\(internalMode && currentUser\)/);
  assert.match(agentCenter, /workspaceMode/);
  assert.match(agentCenter, /智能体工厂/);
  assert.match(agentCenter, /智能体广场/);
  assert.match(agentCenter, /AgentCenterManager/);
  assert.match(agentCenter, /AgentCenterChatWorkspace/);
});

test('agent center creates a session when entering an unused agent and keeps plaza selection independent from old sessions', () => {
  const agentCenter = read('../modules/AgentCenter/AgentCenterModule.tsx');
  const workspace = read('../modules/AgentCenter/AgentCenterChatWorkspace.tsx');
  const utils = read('../modules/AgentCenter/agentCenterUtils.mjs');

  assert.match(agentCenter, /const handleEnterAgent = \(agentId: string\) => runAction\(async \(\) =>/);
  assert.match(agentCenter, /const result = await createChatSession\(agentId\);/);
  assert.match(agentCenter, /await loadChat\(agentId, result\.session\.id\);/);
  assert.match(agentCenter, /onEnterAgent=\{handleEnterAgent\}/);
  assert.match(utils, /export const resolveActiveAgentId = \(\{/);
  assert.match(utils, /if \(workspacePage === 'chat'\)/);
  assert.match(utils, /return selectedAgentId;/);
  assert.match(workspace, /resolveActiveAgentId\(/);
});

test('agent center management is split into flybook-style list detail and wizard views', () => {
  const managerPath = new URL('../modules/AgentCenter/AgentCenterManager.tsx', import.meta.url);
  const listPath = new URL('../modules/AgentCenter/AgentListView.tsx', import.meta.url);
  const detailPath = new URL('../modules/AgentCenter/AgentDetailView.tsx', import.meta.url);
  const wizardPath = new URL('../modules/AgentCenter/AgentWizardView.tsx', import.meta.url);
  const knowledgeListPath = new URL('../modules/AgentCenter/KnowledgeBaseListView.tsx', import.meta.url);
  const knowledgeEditorPath = new URL('../modules/AgentCenter/KnowledgeBaseEditorView.tsx', import.meta.url);

  assert.equal(existsSync(managerPath), true);
  assert.equal(existsSync(listPath), true);
  assert.equal(existsSync(detailPath), true);
  assert.equal(existsSync(wizardPath), true);
  assert.equal(existsSync(knowledgeListPath), true);
  assert.equal(existsSync(knowledgeEditorPath), true);

  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');
  assert.match(manager, /'agent_list'/);
  assert.match(manager, /'agent_detail'/);
  assert.match(manager, /'agent_wizard'/);
  assert.match(manager, /'knowledge_list'/);
  assert.match(manager, /'knowledge_editor'/);
  assert.match(manager, /managerSection/);
  assert.match(manager, /setManagerSection\('knowledge'\)/);
  assert.match(manager, /knowledgeReturnPage/);
  assert.match(manager, /setPage\('agent_list'\)/);
  assert.match(manager, /openKnowledgeList\('knowledge_list'\)/);
  assert.match(manager, /onClick=\{\(\) => \{\s*setManagerSection\('agents'\);\s*setPage\('agent_list'\);/);
  const knowledgeEditor = read('../modules/AgentCenter/KnowledgeBaseEditorView.tsx');
  assert.match(knowledgeEditor, /知识库使用说明/);
  assert.match(knowledgeEditor, /什么是切片/);
  assert.match(knowledgeEditor, /支持格式/);
  assert.match(knowledgeEditor, /showGuide/);
  assert.match(knowledgeEditor, /fixed inset-0/);
  assert.match(knowledgeEditor, /aria-label="返回知识库列表"/);
  assert.match(knowledgeEditor, /fa-circle-question/);
  assert.match(knowledgeEditor, /onDeleteKnowledgeBase/);
  assert.match(knowledgeEditor, /editingDocumentId/);
  assert.match(knowledgeEditor, /showDeleteDocumentConfirm/);
  assert.match(knowledgeEditor, /isDocumentSubmitting/);
  assert.match(knowledgeEditor, /onEditDocument/);
  assert.match(knowledgeEditor, /onCancelDocumentEdit/);
  assert.match(knowledgeEditor, /保存并重新切片/);
  assert.match(knowledgeEditor, /正在保存并重新切片/);
  assert.match(knowledgeEditor, /正在入库并切片/);
  assert.match(knowledgeEditor, /disabled=\{!knowledgeBase \|\| isDocumentSubmitting\}/);
  assert.match(knowledgeEditor, /入库前先做 AI 规范整理/);
  assert.match(knowledgeEditor, /适合规则、SOP、提示词规范类文档/);
  assert.match(knowledgeEditor, /切片策略/);
  assert.match(knowledgeEditor, /查看切片策略说明/);
  assert.match(knowledgeEditor, /切片策略说明/);
  assert.match(knowledgeEditor, /AI 规范整理说明/);
  assert.match(knowledgeEditor, /查看 AI 规范整理说明/);
  assert.match(knowledgeEditor, /AI整理切片/);
  assert.match(knowledgeEditor, /原文切片/);
  assert.match(knowledgeEditor, /失败原因：/);
  assert.match(knowledgeEditor, /确认删除后不可恢复/);
  assert.match(knowledgeEditor, /确认删除文档/);
  assert.match(knowledgeEditor, /文档删除后不可恢复/);
  assert.doesNotMatch(knowledgeEditor, />\s*使用说明\s*</);
  assert.match(manager, /updateKnowledgeDocument/);
  assert.match(manager, /editingDocumentId/);
  assert.match(manager, /isDocumentSubmitting/);
  assert.match(manager, /setIsDocumentSubmitting\(true\)/);
  assert.match(manager, /setIsDocumentSubmitting\(false\)/);
  assert.match(manager, /normalizationEnabled/);
  assert.match(manager, /chunkStrategy/);
  const agentUtils = read('../modules/AgentCenter/agentCenterUtils.mjs');
  assert.match(agentUtils, /KNOWLEDGE_CHUNK_STRATEGY_META/);
  assert.match(agentUtils, /normalizeKnowledgeChunkStrategy/);
  assert.match(agentUtils, /buildRuleBlocks/);
  assert.match(agentUtils, /buildFaqBlocks/);
});

test('agent management landing uses a flybook-style workbench instead of a dense table', () => {
  const list = read('../modules/AgentCenter/AgentListView.tsx');
  const knowledgeList = read('../modules/AgentCenter/KnowledgeBaseListView.tsx');

  assert.match(list, /管理中的智能体/);
  assert.match(list, /已选智能体/);
  assert.match(list, /进入编辑/);
  assert.match(list, /overflow-y-auto/);
  assert.match(list, /auto-rows-max/);
  assert.match(list, /继续处理/);
  assert.doesNotMatch(list, /工作台总览/);
  assert.doesNotMatch(list, /按资源查看/);
  assert.doesNotMatch(list, /最近更新/);
  assert.doesNotMatch(list, /h-full max-h-full overflow-y-auto/);
  assert.doesNotMatch(list, /flex min-h-0 flex-1 flex-col/);
  assert.doesNotMatch(list, /grid-cols-\[88px_minmax\(0,1\.6fr\)_140px_140px_140px_180px_100px\]/);

  assert.match(knowledgeList, /管理中的知识库/);
  assert.match(knowledgeList, /已选知识库/);
  assert.match(knowledgeList, /绑定中/);
  assert.match(knowledgeList, /进入编辑/);
  assert.match(knowledgeList, /overflow-y-auto/);
  assert.match(knowledgeList, /auto-rows-max/);
  assert.doesNotMatch(knowledgeList, /独立维护/);
  assert.doesNotMatch(knowledgeList, /按资源查看/);
  assert.doesNotMatch(knowledgeList, /最近更新/);
  assert.doesNotMatch(knowledgeList, /维护提示/);
  assert.doesNotMatch(knowledgeList, /xl:grid-cols-\[minmax\(0,1\.45fr\)_360px\]/);
  assert.doesNotMatch(knowledgeList, /grid-cols-\[minmax\(0,1\.6fr\)_140px_140px_160px_100px\]/);
});

test('agent wizard uses selectable model catalogs instead of free-text model inputs', () => {
  const wizard = read('../modules/AgentCenter/AgentWizardView.tsx');
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');

  assert.match(wizard, /availableChatModels/);
  assert.match(wizard, /availableImageModels/);
  assert.match(wizard, /enableImageGeneration/);
  assert.match(wizard, /启用生图模型/);
  assert.match(wizard, /DEPARTMENT_PRESETS/);
  assert.match(wizard, /自定义部门/);
  assert.match(wizard, /添加部门/);
  assert.match(wizard, /<select/);
  assert.match(wizard, /canJumpToStep/);
  assert.match(wizard, /mode === 'edit'/);
  assert.match(wizard, /allowedChatModels/);
  assert.match(wizard, /defaultChatModel/);
  assert.match(wizard, /cheapModel/);
  assert.match(wizard, /imageModel/);
  assert.match(wizard, /defaultChatOptions/);
  assert.match(wizard, /检索参考数量说明/);
  assert.match(wizard, /fa-circle-question/);
  assert.match(manager, /gpt-5-4-openai-resp/);
  assert.match(manager, /gemini-3\.1-pro-openai/);
  assert.match(manager, /gemini-3-flash-openai/);
  assert.match(manager, /supportsWebSearch: true/);
  assert.match(manager, /supportsReasoningLevel: true/);
  assert.doesNotMatch(wizard, /placeholder="默认模型"/);
  assert.doesNotMatch(wizard, /placeholder="简单问题模型"/);
});

test('agent wizard exposes per-knowledge-base document checklists for version retrieval bindings', () => {
  const wizard = read('../modules/AgentCenter/AgentWizardView.tsx');
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');

  assert.match(wizard, /knowledgeDocumentBindings/);
  assert.match(wizard, /enabledDocumentIds/);
  assert.match(wizard, /全选/);
  assert.match(wizard, /全不选/);
  assert.match(wizard, /该知识库当前不会提供检索内容/);
  assert.match(manager, /fetchKnowledgeDocuments/);
  assert.match(manager, /knowledgeDocumentsByBase/);
});

test('system settings expose a global analysis model selector for server-side planning tasks', () => {
  const settings = read('../modules/Settings/GlobalApiSettings.tsx');
  const api = read('../services/internalApi.ts');

  assert.match(settings, /策划分析模型/);
  assert.match(settings, /当前生效：/);
  assert.match(settings, /自动选择默认分析模型/);
  assert.match(settings, /systemConfig\?\.agentModels\.chat/);
  assert.match(settings, /updateSystemConfig/);
  assert.match(api, /export const updateSystemConfig = async/);
  assert.match(api, /\/api\/system\/config/);
});

test('agent chat client keeps image generation requests alive longer and can sync completed results after timeout', () => {
  const api = read('../services/internalApi.ts');
  const agentCenter = read('../modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(api, /timeoutMs: payload\.requestMode === 'image_generation' \? 240_000 : 60_000/);
  assert.match(agentCenter, /clientRequestId/);
  assert.match(agentCenter, /syncCompletedMessageAfterTimeout/);
  assert.match(agentCenter, /const deadline = Date\.now\(\) \+ 210_000/);
  assert.match(agentCenter, /metadata\?\.clientRequestId/);
  assert.match(agentCenter, /fallbackAssistantMessage/);
  assert.match(agentCenter, /!item\.metadata\?\.pending/);
  assert.match(agentCenter, /后台仍在处理中，正在同步最新结果/);
});

test('account logs surface direct readable failure tags for agent and provider issues', () => {
  const account = read('../modules/Account/AccountManagement.tsx');
  const utils = read('../modules/Account/accountManagementUtils.mjs');

  assert.match(account, /deriveLogFailureReason/);
  assert.match(account, /failureReason/);
  assert.match(utils, /return '分析失败'/);
  assert.match(utils, /return '创建任务失败'/);
  assert.match(utils, /return '轮询超时'/);
  assert.match(utils, /return '上游服务异常'/);
});

test('agent chat image replies keep result summaries and reference rules collapsed by default', () => {
  const chatPane = read('../modules/AgentCenter/ChatConversationPane.tsx');

  assert.match(chatPane, /const \[expandedReferenceRules, setExpandedReferenceRules\] = useState<Record<string, boolean>>\(\{\}\);/);
  assert.match(chatPane, /aria-expanded=\{referenceRulesExpanded\}/);
  assert.match(chatPane, /referenceRulesExpanded \? '收起' : '展开'/);
  assert.match(chatPane, /本次参考规则/);
});

test('agent center supports preset avatars and uploaded icon images in management views', () => {
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');
  const wizard = read('../modules/AgentCenter/AgentWizardView.tsx');
  const list = read('../modules/AgentCenter/AgentListView.tsx');
  const detail = read('../modules/AgentCenter/AgentDetailView.tsx');

  assert.match(manager, /uploadInternalAssetStream/);
  assert.match(manager, /avatarPreset/);
  assert.match(wizard, /默认头像/);
  assert.match(wizard, /上传图标/);
  assert.match(list, /iconUrl/);
  assert.match(detail, /iconUrl/);
});

test('agent center uses an in-app danger confirmation dialog before permanent deletions', () => {
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');

  assert.match(manager, /dangerConfirm/);
  assert.match(manager, /永久删除确认/);
  assert.match(manager, /确认删除后将不可恢复/);
  assert.doesNotMatch(manager, /window\.confirm/);
});

test('agent detail view supports version naming and publish reminder with glass-style controls', () => {
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');
  const detail = read('../modules/AgentCenter/AgentDetailView.tsx');
  const wizard = read('../modules/AgentCenter/AgentWizardView.tsx');

  assert.match(manager, /请先完成测试验证/);
  assert.match(manager, /openEditWizardAtStep/);
  assert.match(manager, /onEditConfig/);
  assert.match(manager, /onEditKnowledge/);
  assert.match(manager, /onEditConfig=\{\(\) => void openEditWizardAtStep\(3\)\}/);
  assert.match(manager, /onEditKnowledge=\{\(\) => void openEditWizardAtStep\(2\)\}/);
  assert.match(detail, /versionName/);
  assert.match(detail, /onEditConfig/);
  assert.match(detail, /onEditKnowledge/);
  assert.match(detail, /编辑配置/);
  assert.match(detail, /编辑知识库/);
  assert.match(wizard, /grid gap-3 sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(wizard, /item\.description \|\| '暂无说明'/);
  assert.match(detail, /backdrop-blur/);
  assert.match(detail, /返回列表/);
  assert.doesNotMatch(detail, /disabled=\{!draftVersion \|\| draftVersion\.validationStatus !== 'success'\}/);
});

test('agent center manager exposes the studio workspace from agent detail', () => {
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');
  const detail = read('../modules/AgentCenter/AgentDetailView.tsx');
  const studio = read('../modules/AgentCenter/AgentStudioWorkspace.tsx');
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(manager, /AgentStudioWorkspace/);
  assert.match(manager, /page === 'agent_studio'/);
  assert.match(manager, /onOpenStudio=\{openStudio\}/);
  assert.match(detail, /智能体工作室/);
  assert.match(studio, /channel === 'training'/);
  assert.match(studio, /channel === 'testing'/);
  assert.match(studio, /sessionStorage/);
  assert.match(module, /MEIAO_AGENT_CENTER_UI_STATE/);
  assert.match(manager, /MEIAO_AGENT_CENTER_MANAGER_STATE/);
});

test('agent studio testing cleans up temporary sessions instead of accumulating leftovers', () => {
  const testingPane = read('../modules/AgentCenter/AgentStudioTestingPane.tsx');

  assert.match(testingPane, /useEffect\(\(\) => \{/);
  assert.match(testingPane, /return \(\) => \{/);
  assert.match(testingPane, /deleteChatSession\(sessionId\)/);
});

test('agent studio training persists draft conversation state across workspace reopen', () => {
  const trainingPane = read('../modules/AgentCenter/AgentStudioTrainingPane.tsx');

  assert.match(trainingPane, /MEIAO_AGENT_STUDIO_TRAINING_STATE/);
  assert.match(trainingPane, /sessionStorage/);
  assert.match(trainingPane, /messages/);
  assert.match(trainingPane, /attachments/);
  assert.match(trainingPane, /selectedModel/);
  assert.match(trainingPane, /reasoningLevel/);
  assert.match(trainingPane, /webSearchEnabled/);
});

test('agent studio testing reuses the unified chat conversation stack and model capability controls', () => {
  const workspace = read('../modules/AgentCenter/AgentStudioWorkspace.tsx');
  const testingPane = read('../modules/AgentCenter/AgentStudioTestingPane.tsx');
  const conversationPane = read('../modules/AgentCenter/ChatConversationPane.tsx');

  assert.match(workspace, /availableChatModels=/);
  assert.match(testingPane, /import ChatConversationPane from '.\/ChatConversationPane';/);
  assert.match(testingPane, /updateChatSession/);
  assert.match(testingPane, /const selectableChatModels = useMemo/);
  assert.match(testingPane, /chatModels=\{selectableChatModels\}/);
  assert.match(testingPane, /selectedModel=/);
  assert.match(testingPane, /reasoningLevel=/);
  assert.match(testingPane, /webSearchEnabled=/);
  assert.match(testingPane, /attachments=/);
  assert.match(testingPane, /onImageModeToggle=/);
  assert.match(testingPane, /hideSessionHeader=\{true\}/);
  assert.match(testingPane, /renderMessageActions=\{\(message\) =>/);
  assert.match(testingPane, /onCorrection\(findUserQuestion\(message\.id\), message\.content\)/);
  assert.match(conversationPane, /hideSessionHeader\?: boolean/);
  assert.match(conversationPane, /renderMessageActions\?: \(message: AgentChatMessage\) => ReactNode;/);
  assert.match(conversationPane, /renderMessageActions \? renderMessageActions\(message\) : null/);
  assert.match(conversationPane, /!hideSessionHeader/);
  assert.doesNotMatch(testingPane, /messages\.filter\(\(msg\) => msg\.role === 'assistant' && !msg\.metadata\?\.pending\)\.map/);
});

test('agent studio training also reuses the unified chat composer capability controls', () => {
  const workspace = read('../modules/AgentCenter/AgentStudioWorkspace.tsx');
  const trainingPane = read('../modules/AgentCenter/AgentStudioTrainingPane.tsx');

  assert.match(workspace, /availableChatModels=\{availableChatModels\}/);
  assert.match(trainingPane, /import ChatComposer, \{ ComposerAttachment \} from '.\/ChatComposer';/);
  assert.match(trainingPane, /availableChatModels: SystemPublicConfig\['agentModels'\]\['chat'\];/);
  assert.match(trainingPane, /const selectableChatModels = useMemo/);
  assert.match(trainingPane, /selectedModel/);
  assert.match(trainingPane, /reasoningLevel/);
  assert.match(trainingPane, /webSearchEnabled/);
  assert.match(trainingPane, /attachments/);
  assert.match(trainingPane, /chatModels=\{selectableChatModels\}/);
  assert.match(trainingPane, /清空对话/);
  assert.match(trainingPane, /text-rose-600/);
  assert.match(trainingPane, /border-rose-200/);
});

test('secondary modules use the unified sidebar shell and shared popover selects', () => {
  const settingsSidebar = read('./SettingsSidebar.tsx');
  const retouchSidebar = read('../modules/Retouch/RetouchSidebar.tsx');
  const buyerShowSidebar = read('../modules/BuyerShow/BuyerShowSidebar.tsx');
  const videoSidebar = read('../modules/Video/VideoSidebar.tsx');
  const storyboardSidebar = read('../modules/Video/StoryboardSidebar.tsx');
  const veoSidebar = read('../modules/Video/VeoSidebar.tsx');

  assert.match(settingsSidebar, /<PopoverSelect/);
  assert.match(retouchSidebar, /<PopoverSelect/);
  assert.match(buyerShowSidebar, /<PopoverSelect/);
  assert.match(videoSidebar, /<PopoverSelect/);
  assert.match(storyboardSidebar, /<SidebarShell/);
  assert.match(storyboardSidebar, /<PopoverSelect/);
  assert.match(veoSidebar, /<SidebarShell/);
  assert.match(veoSidebar, /<PopoverSelect/);
});

test('agent chat workspace uses plaza and chat pages instead of stacking all sections together', () => {
  const workspace = read('../modules/AgentCenter/AgentCenterChatWorkspace.tsx');
  const composer = read('../modules/AgentCenter/ChatComposer.tsx');
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(workspace, /workspacePage/);
  assert.match(workspace, /plaza/);
  assert.match(workspace, /chat/);
  assert.match(workspace, /智能体广场/);
  assert.match(workspace, /departmentFilter/);
  assert.match(workspace, /通用/);
  assert.match(workspace, /fa-trash-can/);
  assert.match(workspace, /recentDeleteMode/);
  assert.match(workspace, /返回智能体广场/);
  assert.match(workspace, /最近使用/);
  assert.match(workspace, /开始对话/);
  assert.match(workspace, /ChatConversationPane/);
  assert.match(workspace, /onToggleSessionsCollapsed/);
  assert.match(workspace, /recentAgents/);
  assert.match(workspace, /agentDetailOpen/);
  assert.match(workspace, /onDeleteAgentHistory/);
  assert.match(workspace, /resolveActiveAgentId/);
  assert.match(workspace, /imageGenerationEnabled/);
  assert.match(workspace, /imageModel/);
  assert.match(composer, /imageModeEnabled/);
  assert.match(composer, /fa-image/);
  assert.match(composer, /图1/);
  assert.match(module, /requestMode/);
  assert.match(module, /image_generation/);
  assert.doesNotMatch(workspace, /ChatSessionSidebar/);
});

test('chat composer uses a unified attachment entry and compact capability icons', () => {
  const composer = read('../modules/AgentCenter/ChatComposer.tsx');

  assert.match(composer, /fa-paperclip/);
  assert.match(composer, /fa-globe/);
  assert.match(composer, /fa-brain/);
  assert.match(composer, /attachmentHint/);
  assert.match(composer, /reasoningPopoverOpen/);
  assert.match(composer, /上传图片或文件附件/);
  assert.match(composer, /attachmentAccept/);
  assert.match(composer, /if \(imageModeEnabled\) return 'image\/\*';/);
  assert.match(composer, /image\/\*/);
  assert.match(composer, /\.pdf/);
  assert.match(composer, /\.docx/);
  assert.match(composer, /selectedModelOption\?\.supportsFileInput/);
  assert.match(composer, /selectedModelOption\?\.supportsImageInput/);
  assert.match(composer, /if \(imageModeEnabled && !isImage\) \{/);
  assert.match(composer, /const selectableModels = chatModels\.filter/);
  assert.match(composer, /useEffect\(\(\) => \{/);
  assert.match(composer, /selectedModel && !selectableModels\.some/);
  assert.match(composer, /key=\{`\$\{selectedModel\}-\$\{attachmentAccept\}`\}/);
  assert.match(composer, /attachment\.kind === 'image'/);
  assert.match(composer, /attachment\.url/);
  assert.match(composer, /<img/);
  assert.match(composer, /absolute bottom-3 left-3/);
  assert.match(composer, /application\/x-meiao-chat-image/);
  assert.match(composer, /onDrop=\{handleDrop\}/);
  assert.match(composer, /handlePaste/);
  assert.match(composer, /clipboardData\.items/);
  assert.match(composer, /item\.type\.startsWith\('image\/'\)/);
  assert.match(composer, /onPaste=\{handlePaste\}/);
  assert.match(composer, /松开即可放入当前输入框/);
  assert.match(composer, /sending/);
  assert.match(composer, /onInterruptSend/);
  assert.match(composer, /中断/);
  assert.match(composer, /发送/);
});

test('chat conversation pane uses compact header tags and refined message layout', () => {
  const conversationPane = read('../modules/AgentCenter/ChatConversationPane.tsx');
  const agentCenterModule = read('../modules/AgentCenter/AgentCenterModule.tsx');
  assert.match(conversationPane, /AgentAvatar/);
  assert.match(conversationPane, /UserAvatar/);
  assert.match(conversationPane, /rounded-\[30px\]/);
  assert.match(conversationPane, /max-w-\[62%\]/);
  assert.match(conversationPane, /letterSpacing: '0.08em'/);
  assert.match(conversationPane, /当前会话/);
  assert.match(conversationPane, /附件\s+\{attachments\.length\}\s+个/);
  assert.match(conversationPane, /currentUser\?\.username/);
  assert.match(conversationPane, /avatarPreset=\{currentUser\?\.avatarPreset/);
  assert.match(conversationPane, /text-\[11px\] font-medium text-slate-500/);
  assert.match(conversationPane, /flex-none bg-transparent/);
  assert.match(conversationPane, /scrollTo/);
  assert.match(conversationPane, /isImageGenerationMessage/);
  assert.match(conversationPane, /renderImageGenerationMessage/);
  assert.match(conversationPane, /galleryImages/);
  assert.match(conversationPane, /showGallery/);
  assert.match(conversationPane, /previewState/);
  assert.match(conversationPane, /openPreview/);
  assert.match(conversationPane, /stepPreviewImage/);
  assert.match(conversationPane, /draggable/);
  assert.match(conversationPane, /onDragStart/);
  assert.match(conversationPane, /application\/x-meiao-chat-image/);
  assert.match(conversationPane, /下载图片/);
  assert.match(conversationPane, /本次会话图库/);
  assert.match(conversationPane, /放入输入框/);
  assert.match(conversationPane, /group-hover:opacity-100/);
  assert.match(conversationPane, /isImageGenerationMessage\(message\) && Array\.isArray\(message\.attachments\)/);
  assert.match(conversationPane, /downloadRemoteFile/);
  assert.match(conversationPane, /select-text/);
  assert.doesNotMatch(conversationPane, /select-none/);
  assert.match(conversationPane, /结果总结/);
  assert.match(conversationPane, /expandedSummaries/);
  assert.match(conversationPane, /toggleSummary/);
  assert.match(conversationPane, /aria-expanded/);
  assert.match(conversationPane, /收起/);
  assert.match(conversationPane, /展开/);
  assert.match(conversationPane, /正在整理生图参数与提示词/);
  assert.match(conversationPane, /需求分析中/);
  assert.match(conversationPane, /参数整理中/);
  assert.match(conversationPane, /图像生成中/);
  assert.match(conversationPane, /参考图/);
  assert.match(conversationPane, /本次参考规则/);
  assert.match(conversationPane, /retrievalSummary/);
  assert.match(conversationPane, /可继续直接描述你要修改的地方/);
  assert.match(conversationPane, /rounded-\[22px\] border border-slate-200\/80 bg-slate-50\/80 p-2/);
  assert.match(conversationPane, /fixed inset-0 z-40 px-4 py-5 sm:px-6 sm:py-6/);
  assert.match(conversationPane, /backgroundColor: 'rgba\(2, 6, 23, 0.84\)'/);
  assert.match(conversationPane, /backgroundColor: 'rgba\(2, 6, 23, 0.18\)'/);
  assert.match(conversationPane, /backgroundColor: 'rgba\(2, 6, 23, 0.16\)'/);
  assert.match(conversationPane, /backgroundColor: 'rgba\(2, 6, 23, 0.14\)'/);
  assert.match(conversationPane, /backgroundColor: 'rgba\(2, 6, 23, 0.12\)'/);
  assert.match(conversationPane, /backgroundColor: 'rgba\(2, 6, 23, 0.1\)'/);
  assert.match(conversationPane, /backgroundColor: 'rgba\(2, 6, 23, 0.08\)'/);
  assert.match(conversationPane, /backdropFilter: 'blur\(24px\)'/);
  assert.match(conversationPane, /mx-auto flex h-full w-full max-w-5xl min-h-0 flex-col/);
  assert.match(conversationPane, /relative min-h-0 flex-1 overflow-hidden p-4/);
  assert.match(conversationPane, /className="block h-full w-full rounded-\[20px\] object-contain"/);
  assert.doesNotMatch(conversationPane, /h-\[min\(64vh,620px\)\]/);
  assert.doesNotMatch(conversationPane, /max-h-\[54vh\]/);
  assert.doesNotMatch(conversationPane, /max-h-\[48vh\]/);
  assert.doesNotMatch(conversationPane, /'用户'/);
  assert.doesNotMatch(conversationPane, /text-\[12px\] font-medium text-slate-400/);
  assert.doesNotMatch(conversationPane, /Prompt：/);
  assert.doesNotMatch(conversationPane, /参数摘要：/);
  assert.match(agentCenterModule, /需求分析中/);
  assert.match(agentCenterModule, /图像生成中/);
  assert.doesNotMatch(agentCenterModule, /处理中\.\.\./);
});

test('studio panes forward uploaded attachments into training and testing payloads', () => {
  const trainingPane = read('../modules/AgentCenter/AgentStudioTrainingPane.tsx');
  const testingPane = read('../modules/AgentCenter/AgentStudioTestingPane.tsx');

  assert.match(trainingPane, /const attachmentPayload = attachments\.map/);
  assert.match(trainingPane, /attachments: attachmentPayload/);
  assert.match(testingPane, /const attachmentPayload = attachments\.map/);
  assert.match(testingPane, /attachments: attachmentPayload/);
});

test('agent center module wires chat capability controls and session deletion into the workspace', () => {
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(module, /deleteChatSession/);
  assert.match(module, /sendingMessage/);
  assert.match(module, /sendAbortControllerRef/);
  assert.match(module, /pendingRestoreRef/);
  assert.match(module, /pendingAssistantMessageId/);
  assert.match(module, /handleInterruptSend/);
  assert.match(module, /AbortController/);
  assert.match(module, /已中断本次发送/);
  assert.match(module, /optimisticUserMessage/);
  assert.match(module, /optimisticAssistantMessage/);
  assert.match(module, /lockChatPageScroll/);
  assert.match(module, /overflow-hidden/);
  assert.match(module, /deleteUserAgentHistory/);
  assert.match(module, /updateChatSession/);
  assert.match(module, /fetchSystemConfig/);
  assert.match(module, /allowedChatModels/);
  assert.match(module, /selectedModel/);
  assert.match(module, /reasoningLevel/);
  assert.match(module, /webSearchEnabled/);
  assert.match(module, /sessionsCollapsed/);
  assert.match(module, /availableChatModels\.find/);
  assert.match(module, /recentAgents/);
  assert.match(module, /workspacePage/);
  assert.match(module, /resolveActiveAgentId/);
  assert.match(module, /const refreshChatCatalog = async/);
  assert.match(module, /if \(workspaceMode !== 'plaza'\) return;/);
  assert.match(module, /setWorkspacePage\('plaza'\);/);
  assert.match(module, /setSelectedSessionId\(''\);/);
  assert.match(module, /onAgentCatalogChanged=\{\(\) => \{\s*void refreshChatCatalog\(\);\s*\}\}/);
  assert.match(module, /void syncSessionOptions\(\{ lastImageMode: next \}\);/);
  assert.match(module, /需求分析中/);
  assert.match(module, /生图参数整理中/);
  assert.match(module, /图像生成中/);
  assert.match(module, /结果整理中/);
  assert.match(module, /组织回复中/);
  assert.match(module, /progressStage/);
  assert.doesNotMatch(module, /lockWorkspaceScroll = lockChatPageScroll \|\| \(canManage && workspaceMode === 'factory'\)/);
  assert.match(module, /lockWorkspaceScroll = lockChatPageScroll/);
});

test('agent center keeps current composer draft and attachments when toggling session chat modes', () => {
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(module, /setMessageDraft\(''\);/);
  assert.match(module, /setAttachments\(\[\]\);/);
  assert.match(module, /selectedSession\.lastImageMode/);
  assert.doesNotMatch(
    module,
    /if \(!selectedSession\) \{[\s\S]*setAttachments\(\[\]\);[\s\S]*return;[\s\S]*\}[\s\S]*setSelectedModel\(nextModel\);[\s\S]*setReasoningLevel\(selectedSession\.reasoningLevel \|\| null\);[\s\S]*setWebSearchEnabled\(Boolean\(selectedSession\.webSearchEnabled\)\);[\s\S]*setAttachments\(\[\]\);[\s\S]*setImageModeEnabled\(Boolean\(selectedSession\.lastImageMode\)\);/,
    'switching image mode through session sync should not clear current draft attachments'
  );
});

test('account management exposes current user profile avatar settings', () => {
  const app = read('../App.tsx');
  const account = read('../modules/Account/AccountManagement.tsx');
  const profile = read('../modules/Account/ProfileSettingsCard.tsx');
  const usage = read('../modules/Account/UsageStatsPanel.tsx');
  const header = read('./layout/Header.tsx');
  const sidebar = read('./layout/SidebarNavigation.tsx');
  const userAvatar = read('../modules/AgentCenter/UserAvatar.tsx');

  assert.match(account, /ProfileSettingsCard/);
  assert.match(account, /const \[profilePanelOpen, setProfilePanelOpen\] = useState\(false\)/);
  assert.match(account, /LOGS_PAGE_SIZE = 10/);
  assert.match(account, /编辑资料/);
  assert.match(account, /profilePanelOpen \? \(/);
  assert.match(profile, /默认头像/);
  assert.match(profile, /上传头像/);
  assert.match(profile, /updateCurrentUserProfile/);
  assert.match(usage, /用量概览/);
  assert.doesNotMatch(usage, /每日趋势/);
  assert.match(header, /onBack/);
  assert.match(header, /返回上一页/);
  assert.match(app, /systemPageSourceModule/);
  assert.match(app, /isSystemModule/);
  assert.match(app, /getSafePrimaryModule/);
  assert.match(app, /setSystemPageSourceModule\(getSafePrimaryModule\(activeModule\)\)/);
  assert.match(app, /setActiveModule\(getSafePrimaryModule\(systemPageSourceModule\)\)/);
  assert.match(sidebar, /showSystemEntries/);
  assert.match(sidebar, /UserAvatar/);
  assert.match(sidebar, /个人资料/);
  assert.match(sidebar, /系统设置/);
  assert.match(sidebar, /退出登录/);
  assert.match(sidebar, /账号管理/);
  assert.match(sidebar, /onLogout/);
  assert.match(userAvatar, /findAgentAvatarPreset/);
  assert.match(userAvatar, /avatarPreset/);
});

test('global shell moves release status and account tools into the sidebar user hub while shrinking the header', () => {
  const header = read('./layout/Header.tsx');
  const sidebar = read('./layout/SidebarNavigation.tsx');
  const app = read('../App.tsx');

  assert.doesNotMatch(header, /meta\.title/);
  assert.doesNotMatch(header, /toggleCenter/);
  assert.doesNotMatch(header, /onOpenReleaseNotes/);
  assert.doesNotMatch(header, /UserAvatar/);
  assert.match(header, /showBack/);
  assert.match(sidebar, /releaseTag: string/);
  assert.match(sidebar, /serviceStatusLabel: string/);
  assert.match(sidebar, /toggleCenter/);
  assert.match(sidebar, /onOpenReleaseNotes/);
  assert.match(sidebar, /onLogout/);
  assert.match(app, /releaseTag=\{APP_RELEASE_VERSION\}/);
  assert.match(app, /serviceStatusLabel=\{internalMode \? '服务正常' : '单机本地模式'\}/);
});

test('compact shell removes leftover top placeholder height and keeps the sidebar user hub centered and unclipped', () => {
  const header = read('./layout/Header.tsx');
  const sidebar = read('./layout/SidebarNavigation.tsx');
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');

  assert.doesNotMatch(header, /当前登录：/);
  assert.doesNotMatch(header, /min-h-10/);
  assert.doesNotMatch(header, /<div className="h-10" \/>/);
  assert.match(sidebar, /overflow-visible/);
  assert.match(sidebar, /items-center justify-center rounded-\[18px\]/);
  assert.match(sidebar, /left-\[calc\(100%\+12px\)\]/);
  assert.match(sidebar, /bg-white\/95/);
  assert.match(sidebar, /text-slate-900/);
  assert.doesNotMatch(sidebar, /<p className="truncate text-\[11px\] font-black">\{currentUser\.username\}<\/p>/);
  assert.match(manager, /const renderSectionTabs = \(\) => \(/);
  assert.match(manager, /absolute right-0 top-0 z-10/);
  assert.doesNotMatch(manager, /mb-6 flex flex-wrap gap-3/);
});

test('agent center removes the oversized landing header and keeps compact workspace switches', () => {
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');
  const studio = read('../modules/AgentCenter/AgentStudioWorkspace.tsx');

  assert.doesNotMatch(module, /<h2 className="text-3xl font-black text-slate-900">智能体中心<\/h2>/);
  assert.doesNotMatch(module, /当前登录：/);
  assert.match(module, /智能体工厂/);
  assert.match(module, /智能体广场/);
  assert.match(module, /智能体/);
  assert.match(module, /知识库/);
  assert.doesNotMatch(studio, /px-5 py-4/);
});

test('studio correction handoff keeps the full failed question and answer context instead of truncating it', () => {
  const studio = read('../modules/AgentCenter/AgentStudioWorkspace.tsx');

  assert.match(studio, /const buildCorrectionContext = \(question: string, answer: string\) =>/);
  assert.match(studio, /用户原问题：/);
  assert.match(studio, /智能体当时回答：/);
  assert.doesNotMatch(studio, /question\.slice\(0,\s*80\)/);
  assert.doesNotMatch(studio, /answer\.slice\(0,\s*120\)/);
});

test('workspace shell avoids global text selection lock and lets modules own scrolling', () => {
  const app = read('../App.tsx');

  assert.doesNotMatch(app, /select-none/);
  assert.doesNotMatch(app, /<main className="relative flex-1 overflow-hidden h-full">/);
});

test('detail page replaces blocking browser alerts with guided toast feedback', () => {
  const detailModule = read('../modules/OneClick/DetailPageSubModule.tsx');

  assert.doesNotMatch(detailModule, /alert\(/);
  assert.match(detailModule, /addToast\(/);
});

test('translation export failures tell the user what to do next', () => {
  const fileProcessor = read('./FileProcessor.tsx');

  assert.match(fileProcessor, /导出失败，当前结果已保留/);
  assert.match(fileProcessor, /请稍后重试，或检查浏览器下载权限/);
});

test('translation workbench avoids extra outer scroll locks around the file processor', () => {
  const translationModule = read('../modules/Translation/TranslationModule.tsx');
  const fileProcessor = read('./FileProcessor.tsx');

  assert.doesNotMatch(translationModule, /className="h-full flex flex-col overflow-hidden px-6 pb-6 pt-5"/);
  assert.doesNotMatch(fileProcessor, /className="relative flex min-h-0 flex-1 flex-col overflow-hidden/);
});

test('one click module and account tools replace browser confirm dialogs with in-app confirmations', () => {
  const oneClickModule = read('../modules/OneClick/OneClickModule.tsx');
  const userAdminPanel = read('../components/Internal/UserAdminPanel.tsx');
  const usageStats = read('../modules/Account/UsageStatsPanel.tsx');
  const accountManagement = read('../modules/Account/AccountManagement.tsx');

  assert.doesNotMatch(oneClickModule, /window\.confirm/);
  assert.doesNotMatch(userAdminPanel, /window\.confirm/);
  assert.doesNotMatch(usageStats, /window\.confirm/);
  assert.doesNotMatch(accountManagement, /window\.confirm/);
});

test('one click main-image feedback keeps failures actionable instead of raw error prompts', () => {
  const mainModule = read('../modules/OneClick/MainImageSubModule.tsx');

  assert.match(mainModule, /当前参考图已保留/);
  assert.match(mainModule, /请检查参考图和商品图后重试/);
  assert.match(mainModule, /请先在左侧上传产品图片，再启动主图生成/);
  assert.match(mainModule, /当前方案仍然保留/);
  assert.match(mainModule, /可稍后点击同步获取结果/);
});

test('account filters use the shared popover select for long user lists', () => {
  const usageStats = read('../modules/Account/UsageStatsPanel.tsx');
  const accountManagement = read('../modules/Account/AccountManagement.tsx');

  assert.match(usageStats, /<PopoverSelect/);
  assert.match(accountManagement, /<PopoverSelect/);
  assert.doesNotMatch(usageStats, /<select[\s\S]*value=\{userFilter\}/);
  assert.doesNotMatch(usageStats, /<select[\s\S]*value=\{moduleFilter\}/);
  assert.match(usageStats, /value=\{moduleFilter\}/);
  assert.doesNotMatch(accountManagement, /<select value=\{userFilter\}/);
  assert.doesNotMatch(accountManagement, /<select value=\{moduleFilter\}/);
  assert.doesNotMatch(accountManagement, /<select value=\{statusFilter\}/);
  assert.match(accountManagement, /value=\{moduleFilter\}/);
  assert.match(accountManagement, /value=\{statusFilter\}/);
});

test('account management keeps long result lists usable with local scrolling and progressive disclosure', () => {
  const usageStats = read('../modules/Account/UsageStatsPanel.tsx');
  const accountManagement = read('../modules/Account/AccountManagement.tsx');
  const userAdminPanel = read('../components/Internal/UserAdminPanel.tsx');

  assert.match(userAdminPanel, /max-h-\[min\(560px,calc\(100vh-260px\)\)\] overflow-y-auto/);
  assert.match(usageStats, /USAGE_LIST_PREVIEW_LIMIT/);
  assert.match(usageStats, /visibleUserRows/);
  assert.match(usageStats, /visibleModuleRows/);
  assert.match(usageStats, /展开全部/);
  assert.match(usageStats, /收起/);
  assert.doesNotMatch(accountManagement, /overflow-hidden rounded-\[28px\] border border-slate-200 bg-white/);
});
