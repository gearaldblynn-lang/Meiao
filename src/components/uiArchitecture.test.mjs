import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { hasRuntimeStaticImport } from './uiArchitectureImportGuard.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('shared job payload metadata remains open to existing provider fields', () => {
  const types = read('../types.ts');

  assert.match(types, /export type InternalJobPayload = Record<string, unknown> & JobContext;/);
  assert.match(types, /export interface InternalJob \{[\s\S]*?payload: Record<string, unknown>;/);
});

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

test('help guide config covers all top-level modules from shared content', () => {
  const guideConfig = read('../config/helpGuide.ts');

  assert.match(guideConfig, /AppModule\.AGENT_CENTER/);
  assert.doesNotMatch(guideConfig, /GUIDE_MODULES:[\s\S]*AppModule\.AI_CUSTOMER_SERVICE/);
  assert.doesNotMatch(guideConfig, /GUIDE_MODULES:[\s\S]*AppModule\.SMART_FACTORY/);
  assert.match(guideConfig, /AppModule\.ONE_CLICK/);
  assert.match(guideConfig, /AppModule\.TRANSLATION/);
  assert.match(guideConfig, /AppModule\.BUYER_SHOW/);
  assert.match(guideConfig, /AppModule\.RETOUCH/);
  assert.match(guideConfig, /AppModule\.EVERYTHING_REPLACE/);
  assert.match(guideConfig, /AppModule\.PHOTOGRAPHY/);
  assert.match(guideConfig, /AppModule\.VIDEO/);
  assert.match(guideConfig, /AppModule\.XHS_COVER/);
  assert.match(guideConfig, /AppModule\.SETTINGS/);
  assert.match(guideConfig, /AppModule\.ACCOUNT/);
});

test('image crop is registered as a first-class shell module', () => {
  const types = read('../types.ts');
  const shellTypes = read('../shell/types.ts');
  const shellApp = read('../ShellMigratedApp.tsx');
  const sidebar = read('../shell/components/layout/SidebarNavigation.tsx');
  const helpGuide = read('../config/helpGuide.ts');

  assert.match(types, /IMAGE_CROP = 'image_crop'/);
  assert.match(types, /IMAGE_CROP: AppModule\.IMAGE_CROP/);
  assert.match(shellTypes, /'image_crop'/);
  assert.match(shellTypes, /IMAGE_CROP: 'image_crop' as AppModule/);
  assert.match(sidebar, /AppModuleObj\.IMAGE_CROP/);
  assert.match(sidebar, /label: '图片裁切'/);
  assert.match(helpGuide, /AppModule\.IMAGE_CROP/);
  assert.match(shellApp, /const ImageCropModule = lazy\(\(\) => import\('\.\/shell\/modules\/ImageCrop\/ImageCropModule'\)\);/);
  assert.match(shellApp, /\[AppModuleObj\.IMAGE_CROP\]: \[\s*\{ id: 'long_slice', label: '长图切片' \},\s*\{ id: 'resize', label: '修改尺寸' \},\s*\]/);
  assert.match(shellApp, /case AppModuleObj\.IMAGE_CROP:/);
  assert.match(shellApp, /onUploadSliceAsset=\{uploadImageCropSliceAsset\}/);
  assert.match(shellApp, /onPersistProject=\{persistImageCropProject\}/);
});

test('image crop project cards use compact image-only result rendering', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(projectCard, /const isImageCropProject = project\.module === 'image_crop';/);
  assert.match(projectCard, /image_crop: '图片裁切'/);
  assert.match(projectCard, /long_slice: '长图切片'/);
  assert.match(projectCard, /resize: '修改尺寸'/);
  assert.match(projectCard, /const renderImageCropSliceCard = \(result: GeneratedResult, index: number\) => \(/);
  assert.match(projectCard, /if \(isImageCropProject\) \{\s*return renderImageCropSliceCard\(result, index\);\s*\}/);
  assert.match(projectCard, /isImageCropProject\s*\? 'grid gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5'/);

  const sliceCardBlock = projectCard.match(
    /const renderImageCropSliceCard = \(result: GeneratedResult, index: number\) => \([\s\S]*?\n  \);\n\n  const handleDownloadAll/,
  )?.[0] || '';

  assert.notEqual(sliceCardBlock, '');
  assert.match(sliceCardBlock, /renderMedia\(result, 'h-full w-full object-contain'\)/);
  assert.match(sliceCardBlock, /handleDownloadSingle\(result, index\)/);
  assert.doesNotMatch(sliceCardBlock, /renderPromptCopyButton|displayedPrompt|renderResultUsageMeta/);
  assert.doesNotMatch(sliceCardBlock, /onRecover|onRegenerate|openEditDialog|setConfirmDeleteResult/);
});

test('AI customer service module is a multi-store customer service workbench', () => {
  const module = read('../shell/modules/AiCustomerService/AiCustomerServiceModule.tsx');

  assert.match(module, /AI客服/);
  assert.match(module, /Chatwoot/);
  assert.match(module, /店铺接入/);
  assert.match(module, /绑定店铺/);
  assert.match(module, /进入客服台/);
  assert.match(module, /返回店铺列表/);
  assert.match(module, /店铺切换/);
  assert.match(module, /客服工作台/);
  assert.match(module, /会话管理/);
  assert.match(module, /客户信息/);
  assert.match(module, /客户资料/);
  assert.match(module, /话术库/);
  assert.match(module, /自动化/);
  assert.match(module, /坐席/);
  assert.match(module, /报表/);
  assert.match(module, /店铺设置/);
  assert.match(module, /功能对照/);
  assert.match(module, /发送回复/);
  assert.match(module, /fetchChatwootConversationMessages/);
  assert.match(module, /sendChatwootConversationMessage/);
  assert.match(module, /拉取会话/);
  assert.match(module, /AI建议回复/);
  assert.match(module, /人工接管/);
  assert.match(module, /打开 Chatwoot 控制台/);
  assert.doesNotMatch(module, />API Token</);
  assert.doesNotMatch(module, /iframe/);
});

test('video generation project persistence patches video memory for refresh recovery', () => {
  const app = read('../ShellMigratedApp.tsx');
  const patchHelper = app.match(/const buildProjectRemotePatch = \([\s\S]*?\n\};/)?.[0] || '';

  assert.match(patchHelper, /project\.module === AppModuleObj\.VIDEO/);
  assert.match(patchHelper, /project\.subFeature === 'generation'/);
  assert.match(patchHelper, /patch\.videoMemory = state\.videoMemory/);
});

test('agent chat GPT loop acceptance record documents verification feedback and fact learning', () => {
  const doc = read('../../docs/agent-chat-gpt-loop-acceptance.md');
  assert.match(doc, /普通问答/);
  assert.match(doc, /生图/);
  assert.match(doc, /改图/);
  assert.match(doc, /知识库/);
  assert.match(doc, /联网/);
  assert.match(doc, /失败恢复/);
  assert.match(doc, /重新生成/);
  assert.match(doc, /事实沉淀/);
  assert.match(doc, /反馈补丁/);
  assert.match(doc, /## 最终回归/);
  assert.match(doc, /npm run build/);
});

test('system announcement replaces static release toast with editable first-open modal', () => {
  const shellToast = read('../shell/components/ToastSystem.tsx');
  const api = read('../services/internalApi.ts');
  const app = read('../ShellMigratedApp.tsx');
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const announcementModal = read('../shell/components/SystemAnnouncementModal.tsx');
  const types = read('../types.ts');

  assert.equal(existsSync(new URL('../config/releaseNotes.ts', import.meta.url)), false);
  assert.doesNotMatch(shellToast, /CURRENT_RELEASE_NOTES|RELEASE_NOTES_STORAGE_KEY|APP_RELEASE_VERSION/);
  assert.match(types, /export interface SystemAnnouncement/);
  assert.match(types, /announcement: SystemAnnouncement/);
  assert.match(api, /announcement\?: Partial<SystemAnnouncement>/);
  assert.match(app, /SystemAnnouncementModal/);
  assert.match(app, /announcementOpenSource/);
  assert.match(app, /closedAnnouncementId/);
  assert.match(app, /closedAnnouncementId === activeAnnouncement\.id/);
  assert.match(app, /meiao_announcement_dismissed_today/);
  assert.match(app, /onOpenAnnouncement/);
  assert.match(settings, /公告管理/);
  assert.match(settings, /保存公告/);
  assert.match(settings, /删除公告/);
  assert.match(settings, /当前账号没有公告编辑权限/);
  assert.match(announcementModal, /今日不再提醒/);
  assert.match(announcementModal, /backdropFilter: 'blur\(24px\) saturate\(1\.18\)'/);
  assert.match(announcementModal, /color: '#0f172a'/);
  assert.match(announcementModal, /color: '#334155'/);
  assert.match(announcementModal, /background: 'rgba\(255,255,255,0\.94\)'/);
});

test('settings owns the unified model center and smart factory only consumes it', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const smartFactory = read('../modules/AgentCenter/SmartFactoryPanel.tsx');
  const api = read('../services/internalApi.ts');
  const types = read('../types.ts');

  assert.match(settings, /统一模型中心/);
  assert.match(settings, /渠道详情/);
  assert.match(settings, /能力矩阵/);
  assert.match(settings, /连接测试/);
  assert.match(settings, /默认模型/);
  assert.match(settings, /备用模型/);
  assert.match(settings, /本地模型暂不接入/);
  assert.match(settings, /fetchSystemModelProviders/);
  assert.match(settings, /saveSystemModelProvider/);
  assert.match(settings, /deleteSystemModelProvider/);
  assert.match(settings, /testSystemModelProvider/);
  assert.match(api, /\/api\/system\/model-providers/);
  assert.match(types, /modelProviders: \{/);
  assert.match(smartFactory, /模型中心统一管理/);
  assert.match(smartFactory, /这里只做绑定和运行选择/);
  assert.doesNotMatch(smartFactory, /saveSmartFactoryModelProvider/);
  assert.doesNotMatch(smartFactory, /deleteSmartFactoryModelProvider/);
  assert.doesNotMatch(smartFactory, /fetchSmartFactoryModelProviderPresets/);
});

test('settings center uses first-level categories and keeps model center as a compact managed page', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const jobRuntime = read('../../server/jobRuntime.mjs');

  assert.match(settings, /type SettingsSection =/);
  assert.match(settings, /settingsCategories/);
  assert.match(settings, /模型中心/);
  assert.match(settings, /服务接入/);
  assert.doesNotMatch(settings, /id: 'agentRuntime'/);
  assert.match(settings, /账号与权限/);
  assert.match(settings, /通知公告/);
  assert.match(settings, /系统偏好/);
  assert.match(settings, /activeSettingsSection === 'models'/);
  assert.match(settings, /dedupeModelProviders/);
  assert.match(settings, /buildUnifiedModelAssets/);
  assert.match(settings, /buildModelRuntimeTraits/);
  assert.match(settings, /ProviderLogo/);
  assert.match(settings, /source\.includes\('compatible'\)/);
  assert.match(settings, /模型类型/);
  assert.match(settings, /模型资产目录/);
  assert.match(settings, /模型全局管理/);
  assert.match(settings, /模型类型筛选栏/);
  assert.doesNotMatch(settings, /xl:grid-cols-\[210px_minmax/);
  assert.match(settings, /运行特性/);
  assert.match(settings, /流式对话/);
  assert.match(settings, /缓存命中/);
  assert.match(settings, /异步任务/);
  assert.match(settings, /KIE 托管/);
  assert.match(settings, /APIports/);
  assert.match(settings, /systemConfig\?\.agentModels\.chat/);
  assert.match(settings, /systemConfig\?\.agentModels\.image/);
  assert.match(settings, /systemConfig\?\.agentModels\.video/);
  assert.match(settings, /systemConfig\?\.videoAnalysisModels/);
  assert.match(jobRuntime, /GPT-5\.4/);
  assert.match(jobRuntime, /GPT Image 2/);
  assert.match(jobRuntime, /Nano Banana 2/);
  assert.match(jobRuntime, /Seedance 2 Fast/);
  assert.match(jobRuntime, /Veo 3 Fast/);
  assert.match(jobRuntime, /Sora 2 Pro Storyboard/);
  assert.equal((settings.match(/modelModeStats\.map/g) || []).length, 1);
  assert.match(settings, /模型渠道矩阵/);
  assert.match(settings, /allModelProvidersForManagement/);
  assert.match(settings, /渠道详情/);
  assert.match(settings, /模型中心操作栏/);
  assert.match(settings, /同步模型列表/);
  assert.match(settings, /健康检查/);
  assert.match(settings, /新增渠道/);
  assert.match(settings, /模型状态概览/);
  assert.match(settings, /厂家 \/ 渠道/);
  assert.match(settings, /默认模型/);
  assert.match(settings, /能力/);
  assert.match(settings, /使用方/);
  assert.match(settings, /基础配置/);
  assert.match(settings, /影响范围/);
  assert.match(settings, /modelProviderEditing/);
  assert.match(settings, /编辑渠道/);
  assert.match(settings, /只读视图/);
  assert.match(settings, /当前账号只能查看模型中心/);
  assert.match(settings, /handleSaveUserAnalysisModel/);
  assert.match(settings, /handleSaveAnalysisModel/);
  assert.match(settings, /videoAnalysisModelOptions/);
});

test('smart factory model page is a consumer of settings model center, not a provider configurator', () => {
  const smartFactory = read('../modules/AgentCenter/SmartFactoryPanel.tsx');

  assert.match(smartFactory, /模型中心统一管理/);
  assert.match(smartFactory, /这里只做绑定和运行选择/);
  assert.doesNotMatch(smartFactory, /saveSmartFactoryModelProvider/);
  assert.doesNotMatch(smartFactory, /deleteSmartFactoryModelProvider/);
  assert.doesNotMatch(smartFactory, /fetchSmartFactoryModelProviderPresets/);
});

test('one click module keeps submode switching out of the workspace header', () => {
  const oneClickModule = read('../modules/OneClick/OneClickModule.tsx');
  const oneClickSidebar = read('../modules/OneClick/ConfigSidebar.tsx');

  assert.match(oneClickSidebar, /headerContent=/);
  assert.match(oneClickSidebar, /主图/);
  assert.match(oneClickSidebar, /详情/);
  assert.doesNotMatch(oneClickModule, /<SegmentedTabs/);
});

test('sku material scope rejects legacy unscoped materials before planning or generation', () => {
  const app = read('../ShellMigratedApp.tsx');
  const scopeHelper = app.match(/const isMaterialInActiveScope = \([\s\S]*?\n\};/)?.[0] || '';

  assert.match(scopeHelper, /activeSubFeature === 'sku'/);
  assert.match(scopeHelper, /return material\.subFeature === 'sku';/);
  assert.match(scopeHelper, /return !material\.subFeature \|\| material\.subFeature === activeSubFeature;/);
  assert.match(app, /const filterMaterialsForScope = \(/);
  assert.match(app, /\(items \|\| \[\]\)\.filter\(\(item\) => isMaterialInActiveScope\(item, module, activeSubFeature\)\)/);
  assert.match(app, /const filteredMaterials = useMemo\(\s*\(\) => filterMaterialsForScope\(materials, activeModule, activeSubFeature\)/);
  assert.match(app, /materials\.gift \|\| \[\]\)[\s\S]*isMaterialInActiveScope\(item, activeModule, activeSubFeature\)/);
  assert.doesNotMatch(app, /items\.filter\(\(item\) => !item\.subFeature \|\| item\.subFeature === activeSubFeature\)/);
});

test('sku product uploads reset stale sku materials and copy params before new planning', () => {
  const app = read('../ShellMigratedApp.tsx');
  const resetAdapter = read('../adapters/shellSkuUploadReset.mjs');

  assert.match(app, /shouldResetSkuMaterialsForUpload\(activeModule, activeSubFeature, type\)/);
  assert.match(app, /filterMaterialsForSkuUpload\(prev, type\)/);
  assert.match(app, /shouldResetSkuInputTextForUpload\(activeModule, activeSubFeature, type\)/);
  assert.match(app, /resetSkuInputStateForProductUpload\(prev, activeScopeKey\)/);
  assert.match(resetAdapter, /materialType === 'product'/);
  assert.match(resetAdapter, /\^skuCopyText_\\d\+\$/);
  assert.match(resetAdapter, /key === 'count'/);
});

test('one click visuals avoid decorative english labels in the main work surfaces', () => {
  const oneClickSidebar = read('../modules/OneClick/ConfigSidebar.tsx');
  const workspacePrimitives = read('./ui/workspacePrimitives.tsx');
  const mainImage = read('../modules/OneClick/MainImageSubModule.tsx');
  const detailPage = read('../modules/OneClick/DetailPageSubModule.tsx');

  assert.doesNotMatch(oneClickSidebar, /Systematic Design Engine/);
  assert.doesNotMatch(mainImage, /Sync Multi-Screen Strategy/);
  assert.doesNotMatch(mainImage, /Ready for Production/);
  assert.doesNotMatch(detailPage, /Sequence Editor Console/);
  assert.doesNotMatch(detailPage, /Typography Logic Editor/);
  assert.doesNotMatch(detailPage, /Standby for Visual Logic/);
  assert.match(oneClickSidebar, /<PopoverSelect/);
  assert.match(workspacePrimitives, /var\(--bg-surface\)/);
  assert.match(workspacePrimitives, /var\(--accent-soft\)/);
  assert.doesNotMatch(oneClickSidebar, /ChoiceGrid/);
});

test('legacy icon bridge maps chat action icons instead of falling back to file icons', () => {
  const workspacePrimitives = read('./ui/workspacePrimitives.tsx');

  assert.match(workspacePrimitives, /Copy,/);
  assert.match(workspacePrimitives, /RotateCcw,/);
  assert.match(workspacePrimitives, /lowerIcon\.includes\('copy'\) \? Copy/);
  assert.match(workspacePrimitives, /lowerIcon\.includes\('rotate'\) \|\| lowerIcon\.includes\('redo'\) \|\| lowerIcon\.includes\('refresh'\) \? RotateCcw/);
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
  assert.doesNotMatch(skuSidebar, /文案内容/);
  assert.match(mainModule, /analyzeOneClickReferenceSet/);
  assert.match(detailModule, /analyzeOneClickReferenceSet/);
  assert.match(mainModule, /OneClickSubMode\.MAIN_IMAGE/);
  assert.match(detailModule, /OneClickSubMode\.DETAIL_PAGE/);
  assert.match(skuModule, /OneClickSubMode\.SKU/);
  assert.match(mainModule, /referenceAnalysis\.summary/);
  assert.match(detailModule, /referenceAnalysis\.summary/);
  assert.match(mainModule, /if \(!referenceSummary && designReferences\.length > 0 && referenceDimensions\.length > 0\)/);
  assert.match(detailModule, /if \(!referenceSummary && designReferences\.length > 0 && referenceDimensions\.length > 0\)/);
  assert.match(configSidebar, /useState<'product' \| 'reference'>\('product'\)/);
  assert.match(configSidebar, /button onClick=\{\(\) => setAssetTab\('product'\)\}/);
  assert.match(configSidebar, /button onClick=\{\(\) => setAssetTab\('reference'\)\}/);
  assert.match(configSidebar, /const invalidateReferenceAnalysis =/);
  assert.match(skuSidebar, /type AssetTab = 'product' \| 'gift' \| 'reference'/);
  assert.match(skuSidebar, /useState<AssetTab>\('product'\)/);
  assert.match(skuSidebar, /button onClick=\{\(\) => setAssetTab\('product'\)\}/);
  assert.match(skuSidebar, /button onClick=\{\(\) => setAssetTab\('gift'\)\}/);
  assert.match(skuSidebar, /button onClick=\{\(\) => setAssetTab\('reference'\)\}/);
  assert.match(skuSidebar, /role === 'style_ref'/);
  assert.match(skuModule, /styleUrl/);
  assert.match(skuModule, /generateSkuSchemes\(productUrls, giftUrls, styleUrl/);
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
  const sidebar = read('../shell/components/layout/SidebarNavigation.tsx');

  assert.doesNotMatch(sidebar, /业务模块/);
  assert.doesNotMatch(sidebar, /系统管理/);
  assert.match(sidebar, /AppModuleObj\.AGENT_CENTER/);
  assert.match(sidebar, /const MAIN: NavDef\[] = \[/);
  assert.match(sidebar, /const BOTTOM: NavDef\[] = \[/);
  assert.match(sidebar, /collapsed: boolean/);
  assert.match(sidebar, /onToggleCollapsed: \(\) => void/);
  assert.match(sidebar, /data-sidebar-collapsed=\{collapsed \? 'true' : 'false'\}/);
  assert.match(sidebar, /展开侧栏/);
  assert.match(sidebar, /收起侧栏/);
  assert.match(sidebar, /出海翻译/);
  assert.match(sidebar, /图片升级/);
  assert.match(sidebar, /视频生成/);
  assert.match(sidebar, /设置中心/);
  assert.match(sidebar, /账户管理/);
});

test('account management exposes admin-only task platform diagnostics', () => {
  const account = read('../shell/modules/Account/AccountManagement.tsx');
  const api = read('../services/internalApi.ts');
  const types = read('../types.ts');

  assert.match(types, /export interface TaskPlatformJob/);
  assert.match(api, /fetchTaskPlatformHealth/);
  assert.match(api, /\/api\/admin\/task-platform\/jobs/);
  assert.match(api, /\/api\/admin\/task-platform\/health/);
  assert.match(account, /type TabId = 'users' \| 'logs' \| 'stats' \| 'tasks'/);
  assert.match(account, /fetchTaskPlatformJobs/);
  assert.match(account, /fetchTaskPlatformTimeline/);
  assert.match(account, /\{ id: 'tasks' as const, label: '任务'/);
  assert.match(account, /canManageAccounts && tab === 'tasks'/);
});

test('project cards expose only one current planning provider task id', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const planEditor = read('../shell/components/PlanEditor.tsx');

  assert.doesNotMatch(projectCard, /查看多个策划任务 ID/);
  assert.doesNotMatch(projectCard, /共 \{planningTaskIds\.length\} 个策划任务 ID/);
  assert.doesNotMatch(planEditor, /查看多个策划任务 ID/);
  assert.doesNotMatch(planEditor, /共 \{planningTaskIds\.length\} 个策划任务 ID/);
});

test('app workspace mounts the agent center as a top-level module', () => {
  const app = read('../ShellMigratedApp.tsx');
  const agentCenter = read('../shell/modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(app, /AgentCenterModule/);
  assert.match(app, /AppModuleObj\.AGENT_CENTER/);
  assert.match(agentCenter, /智能体中心/);
});

test('app workspace lazy loads major modules to avoid one giant startup bundle', () => {
  const app = read('../ShellMigratedApp.tsx');
  const viteConfig = read('../../vite.config.ts');

  assert.match(app, /React,\s*\{\s*Suspense,/);
  assert.match(app, /lazy\(\(\) => import\('\.\/shell\/modules\/AgentCenter\/AgentCenterModule'\)\)/);
  assert.match(app, /lazy\(\(\) => import\('\.\/shell\/modules\/Video\/VideoModule'\)\)/);
  assert.match(app, /import\('\.\/adapters\/shellWorkflow'\)/);
  assert.match(app, /const loadShellWorkflowModule = async \(\) =>/);
  assert.match(app, /bailIfFrontendResourceError\(error\)/);
  assert.match(app, /isFrontendResourceError/);
  assert.match(app, /window\.location\.reload\(\)/);
  assert.match(app, /return new Promise<never>\(\(\) => undefined\);/);
  assert.equal(
    hasRuntimeStaticImport(app, './adapters/shellWorkflow'),
    false,
    'shellWorkflow must remain runtime-lazy; only import type is allowed statically',
  );
  assert.match(app, /<Suspense fallback=/);
  assert.match(viteConfig, /manualChunks/);
});

test('one click generation refuses to turn planning error text into image prompts', () => {
  const app = read('../ShellMigratedApp.tsx');
  const validation = read('../utils/oneClickPlanValidation.ts');
  const planFailure = read('../utils/planFailure.mjs');

  assert.match(app, /isInvalidOneClickPlanLike/);
  assert.match(app, /const isFailedPlanningPlan = \(plan: PlanItem\) => Boolean/);
  assert.match(app, /const failedSelectedPlans = selectedPlans\.filter\(isFailedPlanningPlan\)/);
  assert.match(app, /selectedPlans = runnableSelectedPlans/);
  assert.match(app, /选中的方案均为策划失败项，请先重新策划失败项后再出图。/);
  // 正则已收敛到共享 planFailure.mjs;oneClickPlanValidation 委托它
  assert.match(validation, /from '\.\/planFailure\.mjs'/);
  assert.match(planFailure, /LEGACY_FAILURE_TEXT_PATTERNS/);
  assert.match(planFailure, /fetch failed/i);
  assert.match(planFailure, /Cannot read properties of undefined/);
  assert.match(planFailure, /网络连接失败，请检查网络后重试/);
  assert.match(app, /isInvalidPlanContentForGeneration/);
  assert.match(app, /当前策划结果无效，请重新策划后再生图。/);
});

test('one click regenerate does not submit planning failure placeholders as image jobs', () => {
  const app = read('../ShellMigratedApp.tsx');
  const regenerateBody = app.match(/const handleRegenerateResult = useCallback\(async[\s\S]*?\n  \}, \[projects, tasks, addToast/)?.[0] || '';

  assert.match(app, /const isOneClickPlanningFailureResult = \(/);
  assert.match(regenerateBody, /isOneClickPlanningFailureResult\(project, result\)/);
  assert.match(regenerateBody, /策划失败项需要先重新策划，不能直接重生成图片。/);
  assert.match(regenerateBody, /return;[\s\S]*?const subFeature = project\.subFeature \|\| getDefaultSubFeature/);
  assert.doesNotMatch(regenerateBody, /shellPlanId: result\.planId[\s\S]{0,300}isOneClickPlanningFailureResult/);
});

test('one click planning keeps failed reference plans visible', () => {
  const app = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');

  assert.match(workflow, /toFailedShellPlan/);
  assert.match(workflow, /planningFailed: true/);
  assert.match(workflow, /perReferenceResults\.map/);
  assert.doesNotMatch(workflow, /\.filter\(\(item\) => item\.status === 'success'\)\s*\.map/);
  assert.match(app, /const failedPlanningPlans = planResult\.plans\.filter\(isFailedPlanningPlan\)/);
  assert.match(app, /策划完成 \$\{runnablePlanningPlans\.length\}\/\$\{planResult\.plans\.length\}/);
  assert.match(app, /fetchInternalJobs\(500\)/);
  assert.match(app, /collectFailedOneClickPlanningPlans/);
  assert.match(app, /plans: failedPlanningPlans\.length > 0 \? failedPlanningPlans : planningProject\.plans/);
  assert.match(app, /failedPlanningResults\.length > 0 \? failedPlanningResults/);
});

test('one click batch generation keeps every selected plan visible when one item fails', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /const collectPlanResultsForFailure = \(message: string\) => \{/);
  assert.match(app, /return selectedPlans\.map\(\(plan, index\) => publishedByPlanId\.get\(plan\.id\) \|\| buildMissingPlanResult\(plan, index, message\)\)/);
  assert.match(app, /部分任务已提交云端，结果待同步，可稍后点击同步。/);
});

test('one click image fallback requires a visible KIE task id before showing generating', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /const hasProviderTaskId = Boolean\(visibleTaskId\);/);
  assert.doesNotMatch(app, /const isSubmitted = Boolean\(visibleTaskId \|\| backendJobId\);/);
  assert.match(app, /status: hasProviderTaskId \? 'generating' : 'error'/);
  assert.match(app, /result\.status === 'generating' && Boolean\(String\(result\.taskId \|\| ''\)\.trim\(\)\)/);
  assert.match(app, /const hasActiveSibling = currentMergedResults\.some\(\(result\) => \(\s*result\.status === 'generating' && Boolean\(String\(result\.taskId \|\| ''\)\.trim\(\)\)\s*\)\);/);
});

test('shell task cancel cancels backend jobs and persists interrupted cards', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(shellApp, /cancelInternalJob/);
  assert.match(shellApp, /collectShellCancelJobIds/);
  assert.match(shellApp, /collectShellCancelControllerIds/);
  assert.match(shellApp, /void cancelInternalJob\(jobId\)/);
  assert.match(shellApp, /void persistProjectToSharedState\(project\)/);
  assert.match(shellApp, /status: 'error',\s*error: SHELL_MANUAL_CANCEL_ERROR/);
  assert.match(projectCard, /getResultCancelTarget\(result, project\)/);
  assert.doesNotMatch(projectCard, /onCancelTask\(project\.id\)/);
});

test('project cards do not label terminal failed image results as pending sync', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(projectCard, /const getMissingMediaLabel = \(result: GeneratedResult, mediaType: 'image' \| 'video'\) =>/);
  assert.match(projectCard, /if \(result\.status === 'error'\) return mediaType === 'video' \? '视频生成失败' : '生成失败';/);
  assert.match(projectCard, /style=\{\{ color: result\.status === 'error' \? 'var\(--error\)' : 'var\(--text-tertiary\)' \}\}/);
  assert.doesNotMatch(projectCard, /图片结果待同步/);
});

test('project result reruns prefer the current scoped image model over stale failed result models', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /const getCurrentScopedImageModel = useCallback/);
  assert.match(app, /latestSharedStateRef\.current\?\.oneClickMemory\?\.\[branchKey\]\?\.config\?\.model/);
  assert.match(app, /model: currentScopedImageModel \|\| currentParams\.model \|\| storedContext\?\.params\?\.model \|\| result\.model/);
  assert.match(app, /model: currentScopedImageModel \|\| storedContext\?\.params\?\.model \|\| result\.model \|\| currentParams\.model \|\| 'GPT Image 2'/);
});

test('one click planning only remains syncable while the backend job is still active', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /fetchInternalJob\(\s*planningBackendJobId\s*\)/);
  assert.match(app, /const planningJobIsStillActive = \['queued', 'running', 'retry_waiting'\]\.includes\(latestPlanningJobStatus\)/);
  assert.match(app, /const planningSyncGap = \['job_timeout', 'task_not_found'\]\.includes\(planningErrorCode\)/);
  assert.match(app, /const planningRecoverable = planningSyncGap \|\| isRecoverableKieTaskResult\(\s*planningProviderTaskId,/);
  assert.match(app, /if \(planningRecoverable && planningJobIsStillActive\)/);
  assert.doesNotMatch(app, /isRecoverableKieTaskResult\(\s*planningProviderTaskId \|\| activePlanningBackendJobId,/);
  assert.match(app, /status: 'planning'/);
  assert.match(app, /策划任务已提交云端，结果待同步，可稍后点击同步。/);
});

test('cloud deploy keeps old hashed assets and missing chunks do not fall back to html', () => {
  const server = read('../../server/index.mjs');
  const deployScript = read('../../scripts/deploy_tencent.sh');
  const missingAssetBody = server.match(/if \(relativePath\.startsWith\('assets\/'\)\) \{([\s\S]*?)\n  \}/)?.[1] || '';

  assert.match(missingAssetBody, /writeHead\(404/);
  assert.match(missingAssetBody, /Asset not found/);
  assert.doesNotMatch(missingAssetBody, /index\.html/);
  assert.match(server, /const safeDecodePathname = \(value\) => \{/);
  assert.match(server, /decodeURIComponent\(value\)/);
  assert.match(server, /return null;/);
  assert.match(server, /if \(!normalizedPath\) \{/);
  assert.match(server, /Malformed path/);
  assert.match(server, /statSync\(targetPath\)/);
  assert.match(server, /targetStats\.isFile\(\)/);
  assert.doesNotMatch(server, /if \(existsSync\(targetPath\)\) \{\s*serveStaticFile\(req, res, targetPath\);/);
  // 2026-07-07 S4 治本:部署改为"旧 dist 全程服务 + build 到 dist-next + 旧 assets 带保留期合并 + 原子换名"。
  // 锁住关键不变量,防止回退到"install 前删 dist"的断档旧方案。
  assert.match(deployScript, /! -name 'dist' -exec rm -rf/, 'install/build 期间必须保留旧 dist 继续服务');
  assert.match(deployScript, /npm run build -- --outDir dist-next/, '新产物必须先落 dist-next,不许直接覆盖 dist');
  assert.match(deployScript, /find dist\/assets -maxdepth 1 -type f -mtime \+\$\{MEIAO_OLD_ASSET_RETENTION_DAYS:-30\} -delete/, '旧 chunk 必须有保留期治理');
  // coreutils 9.2+ 的 cp -n 对跳过文件退出1会掐死部署,必须用显式'不存在才拷'循环
  assert.match(deployScript, /if \[ ! -e \\"dist-next\/assets\/\\\$base\\" \]; then\n\s*cp -p \\"\\\$asset\\" \\"dist-next\/assets\/\\\$base\\"/, '旧 hash chunk 必须显式跳过已存在文件合并,不许 cp -n');
  assert.doesNotMatch(deployScript, /cp -R?p?n /, '禁止 cp -n(coreutils 9.2+ 跳过即退出1)');
  assert.match(deployScript, /mv dist dist-prev; fi\n\s*mv dist-next dist/, '切换必须是原子换名');
});

test('shell hydration keeps backend jobs out of the refresh critical path', () => {
  const app = read('../ShellMigratedApp.tsx');
  const hydrateBody = app.match(/const hydrateShellData = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*applyShellSnapshot[^\]]*\]\);/)?.[1] || '';
  const jobHydrateBody = app.match(/const hydrateShellJobs = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
  const hydrateHappyPath = hydrateBody.split('\n    } catch {')[0] || hydrateBody;

  assert.match(app, /applyShellSnapshot/);
  assert.doesNotMatch(app, /useState\(\(\) => loadPersistedAppState\(\)\.apiConfig/);
  assert.match(app, /requestIdleCallback/);
  assert.match(app, /scheduleHydration/);
  assert.match(hydrateHappyPath, /fetchRemoteAppState\(\)/);
  assert.match(app, /prepareLoadedSharedState/);
  assert.match(app, /pruneKnownLegacyGarbageFromPersistedState/);
  assert.doesNotMatch(hydrateHappyPath, /fetchInternalJobs/);
  assert.doesNotMatch(hydrateHappyPath, /loadPersistedAppState/);
  assert.doesNotMatch(hydrateHappyPath, /Promise\.allSettled/);
  assert.match(app, /if \(pageMode === 'landing'\) return;/);
  assert.match(hydrateBody, /if \(shouldUseLocalStateFallback\(\)\)/);
  assert.doesNotMatch(hydrateBody, /catch \{\s*const localState = loadPersistedAppState\(\)/);
  assert.match(jobHydrateBody, /fetchInternalJobs\(200\)/);
  assert.match(jobHydrateBody, /fetchInternalJob\(jobId\)/);
  assert.match(jobHydrateBody, /latestSharedStateRef\.current/);
  assert.match(app, /const shouldUseLocalStateFallback = \(\) =>/);
  assert.match(app, /meiaoLocalPreview/);
  assert.match(app, /hydrationScheduledRef/);
  assert.match(app, /if \(hydrationScheduledRef\.current\) return;/);
});

test('shell job hydration only refreshes active tasks and does not overwrite projects', () => {
  const app = read('../ShellMigratedApp.tsx');
  const jobHydrateBody = app.match(/const hydrateShellJobs = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

  assert.match(jobHydrateBody, /fetchInternalJobs\(200\)/);
  assert.match(jobHydrateBody, /setTasks\(\(prev\) => mergeShellTasks/);
  assert.match(jobHydrateBody, /persistSyncedProjectsToSharedState\(syncedProjectsToPersist\)/);
  assert.match(app, /shouldPersistSyncedProjectFromJobs/);
  assert.match(read('../utils/syncedProjectPersistence.ts'), /getProjectErrorResultCount/);
  assert.match(read('../utils/syncedProjectPersistence.ts'), /project\.status === 'error'[\s\S]*persistedProject\.status === 'planning'[\s\S]*persistedProject\.status === 'generating'/);
  assert.match(jobHydrateBody, /const snapshotProjectIds = new Set/);
  assert.match(jobHydrateBody, /const activeSnapshotTaskProjectIds = new Set/);
  assert.match(jobHydrateBody, /!snapshotProjectIds\.has\(project\.id\) && !activeSnapshotTaskProjectIds\.has\(project\.id\)\) return false/);
  assert.match(jobHydrateBody, /if \(!activeSnapshotTaskProjectIds\.has\(String\(task\.projectId \|\| ''\)\.trim\(\)\)\) return false/);
  assert.doesNotMatch(jobHydrateBody, /applyShellSnapshot\(baseState, jobsResult\.jobs \|\| \[\]\)/);
  assert.doesNotMatch(jobHydrateBody, /setProjects\(snapshot\.projects as Project\[\]\)/);
  assert.doesNotMatch(jobHydrateBody, /setMaterials\(snapshot\.materials as Record<string, Material\[\]>\)/);
});

test('shell hydration restores data without auto navigating away from landing', () => {
  const app = read('../ShellMigratedApp.tsx');
  const applyShellSnapshotBody = app.match(/const applyShellSnapshot = useCallback\(async \(loadedState:[\s\S]*?=> \{([\s\S]*?)\n  \}, \[[^\]]*restoreLocalMaterialPreviews[^\]]*shellLocalScopeUserId[^\]]*\]\);/)?.[1] || '';

  assert.doesNotMatch(applyShellSnapshotBody, /setPageMode\('module'\)/);
});

test('video generation permission is gated only on the generation subfeature', () => {
  const app = read('../ShellMigratedApp.tsx');
  const types = read('../types.ts');
  const internalApi = read('../services/internalApi.ts');
  const accountManagement = read('../shell/modules/Account/AccountManagement.tsx');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const subFeatureTabs = read('../shell/components/SubFeatureTabs.tsx');

  assert.match(types, /featurePermissions\?:/);
  assert.match(types, /videoGeneration\?: boolean/);
  assert.match(internalApi, /featurePermissions/);
  assert.match(accountManagement, /短视频生成/);
  assert.match(accountManagement, /videoGeneration/);
  assert.match(app, /canUseVideoGenerationFeature/);
  assert.match(app, /getModuleSubFeatures\(AppModuleObj\.VIDEO, currentUser\)/);
  assert.match(app, /targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'generation'/);
  assert.doesNotMatch(app, /targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'storyboard' && !canUseVideoGenerationFeature/);
  assert.match(bottomInputBar, /generationDisabledReason/);
  assert.match(subFeatureTabs, /item\.description \|\| '待制作'/);
});

test('shell refresh restores current workspace and keeps in-flight project cards', () => {
  const app = read('../ShellMigratedApp.tsx');
  const applyShellSnapshotBody = app.match(/const applyShellSnapshot = useCallback\(async \(loadedState:[\s\S]*?=> \{([\s\S]*?)\n  \}, \[[^\]]*restoreLocalMaterialPreviews[^\]]*shellLocalScopeUserId[^\]]*\]\);/)?.[1] || '';
  const jobHydrateBody = app.match(/const hydrateShellJobs = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

  assert.match(app, /SHELL_UI_STATE_KEY/);
  assert.match(app, /readShellUiState/);
  assert.match(app, /saveShellUiState/);
  assert.match(app, /pageMode[\s\S]*activeModule[\s\S]*activeSubFeatureByModule/);
  assert.match(app, /SHELL_RUNTIME_STATE_KEY/);
  assert.match(app, /loadShellRuntimeSnapshot/);
  assert.match(app, /const shellLocalScopeUserId = currentUser\?\.id \|\| null/);
  assert.match(app, /pruneShellRuntimeSnapshotForDeletion/);
  assert.match(app, /const initialRuntimeSnapshot = pruneShellRuntimeSnapshotForDeletion\(/);
  assert.match(app, /useState<Project\[\]>\(\(\) => initialRuntimeSnapshot\.projects\)/);
  assert.match(app, /useState<Task\[\]>\(\(\) => initialRuntimeSnapshot\.tasks\)/);
  assert.match(app, /restoredRuntimeProjectIdsRef/);
  assert.match(app, /restoredRuntimeTaskIdsRef/);
  assert.match(app, /shellProjectSignature/);
  assert.match(app, /shellTaskSignature/);
  assert.match(app, /liveProjectSignatures/);
  assert.match(app, /completedProjectSignatures/);
  assert.match(app, /saveShellRuntimeSnapshot\(prunedRuntimeSnapshot, shellLocalScopeUserId\)/);
  assert.match(app, /mergeShellProjects\(runtimeSnapshot\.projects, snapshot\.projects as Project\[\]\)/);
  assert.match(app, /mergeShellTasks\(runtimeSnapshot\.tasks, snapshot\.tasks as Task\[\]\)/);
  assert.match(applyShellSnapshotBody, /pruneShellRuntimeSnapshotForDeletion\([\s\S]*loadShellRuntimeSnapshot\(shellLocalScopeUserId\)/);
  // 2026-07-09 多桑「项目卡闪现后消失」修复:applyShellSnapshot 不含 jobs,全量 setProjects
  // 会冲掉 hydrateShellJobs 刚重建的 job 来源卡;必须保留内存中快照缺席的 job 卡(删除墓碑除外)。
  assert.match(applyShellSnapshotBody, /const preservedJobProjects = prev\.filter/);
  assert.match(applyShellSnapshotBody, /project\.sourceType === 'job'/);
  assert.match(applyShellSnapshotBody, /!nextProjectIds\.has\(String\(project\.id \|\| ''\)\.trim\(\)\)/);
  assert.match(applyShellSnapshotBody, /pruneShellRuntimeSnapshotForDeletion\(\s*\{ projects: preservedJobProjects, tasks: \[\] \}/);
  assert.match(jobHydrateBody, /pruneShellRuntimeSnapshotForDeletion\([\s\S]*loadShellRuntimeSnapshot\(shellLocalScopeUserId\)/);
  assert.match(app, /const hasActiveBackendProject = projects\.some/);
  assert.match(app, /\(project\.results \|\| \[\]\)\.some\(\(result\) => Boolean\(result\.backendJobId \|\| result\.taskId\)\)/);
  assert.match(app, /window\.setTimeout\(\(\) => \{\s*void hydrateShellJobs\(\);/);
  assert.doesNotMatch(jobHydrateBody, /setTasks\(snapshot\.tasks as Task\[\]\)/);
});

test('shell resets local workspace memory when the signed-in user scope changes', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /previousShellLocalScopeUserIdRef/);
  assert.match(app, /resetShellWorkspaceForUser/);
  assert.match(app, /hydrationScheduledRef\.current = false/);
  assert.match(app, /jobsHydrationScheduledRef\.current = false/);
  assert.match(app, /const runtimeSnapshot = pruneShellRuntimeSnapshotForDeletion\(loadShellRuntimeSnapshot\(userId\), draftSnapshot\)/);
  assert.match(app, /restoredRuntimeProjectIdsRef\.current = new Set\(runtimeSnapshot\.projects\.map\(\(project\) => project\.id\)\)/);
  assert.match(app, /setProjects\(runtimeSnapshot\.projects\)/);
  assert.match(app, /setTasks\(runtimeSnapshot\.tasks\)/);
  assert.match(app, /saveShellRuntimeSnapshot\(runtimeSnapshot, userId\)/);
  assert.match(app, /setMaterials\(draftSnapshot\.materials as Record<string, Material\[\]> \|\| \{\}\)/);
  assert.match(app, /void hydrateShellData\(\)/);
  assert.match(app, /void hydrateShellJobs\(\)/);
});

test('shell account statistics expose credit usage to staff without account mutation controls', () => {
  const account = read('../shell/modules/Account/AccountManagement.tsx');
  const api = read('../services/internalApi.ts');

  assert.match(api, /creditsConsumed\?: number/);
  assert.match(account, /creditsConsumed/);
  assert.match(account, /总积分/);
  assert.match(account, /const canManageAccounts = isAdmin/);
  assert.match(account, /const canViewStats = Boolean\(currentUser\)/);
  assert.match(account, /!canManageAccounts && tab === 'users'/);
  assert.match(account, /canManageAccounts && tab === 'logs'/);
  assert.match(account, /canViewStats && tab === 'stats'/);
});

test('project details expose actual task credits and provider task ids', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const planEditor = read('../shell/components/PlanEditor.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const shellWorkflow = read('../adapters/shellWorkflow.ts');
  const arkService = read('../services/arkService.ts');
  const videoModule = read('../shell/modules/Video/VideoModule.tsx');
  const videoStoryboardService = read('../services/videoStoryboardService.ts');
  const clipboard = read('../utils/clipboard.mjs');

  assert.match(projectCard, /creditsConsumed\?: number/);
  assert.match(projectCard, /getProjectCreditsConsumed/);
  assert.match(projectCard, /总积分消耗/);
  assert.match(projectCard, /本次消耗/);
  assert.match(projectCard, /任务 ID/);
  assert.match(projectCard, /策划任务 ID/);
  assert.match(projectCard, /copyTextToClipboard/);
  assert.match(clipboard, /execCommand\('copy'\)/);
  assert.doesNotMatch(projectCard, /planningTaskIdFallback/);
  assert.doesNotMatch(projectCard, /isStoryboardProject \? project\.id : ''/);
  assert.match(projectCard, /splitTaskIds\(project\.planningTaskId\)/);
  assert.match(projectCard, /result\.creditsConsumed/);
  assert.match(projectCard, /planningTaskId=\{project\.planningTaskId\}/);
  assert.match(projectCard, /backendJobId\?: string/);
  assert.match(projectCard, /directGeneration\?: boolean/);
  assert.match(projectCard, /const hasPlanningUsage = !project\.directGeneration &&/);
  assert.match(projectCard, /project\.module === 'one_click' && \(/);
  assert.match(projectCard, /Boolean\(project\.backendJobId\)/);
  assert.doesNotMatch(projectCard, /project\.planningTaskId \|\| project\.backendJobId/);
  assert.match(planEditor, /planningTaskId\?: string/);
  assert.match(planEditor, /planningTaskIds = splitTaskIds\(planningTaskId\)/);
  assert.doesNotMatch(planEditor, /setPlanningIdsExpanded/);
  assert.match(planEditor, /策划任务 ID/);
  assert.match(planEditor, /生图任务 ID/);
  assert.match(planEditor, /策划分析/);

  assert.match(shellApp, /creditsConsumed: planResult\.creditsConsumed/);
  assert.match(shellApp, /let planningProviderTaskId = ''/);
  assert.match(shellApp, /let activePlanningBackendJobId = ''/);
  assert.doesNotMatch(shellApp, /providerId \|\| backendJobId/);
  assert.match(shellApp, /planningTaskId: latestIdentityText\(planResult\.taskId, planningProviderTaskId\)/);
  assert.match(shellApp, /const generationTaskIdByPlanId = new Map<string, string>\(\)/);
  assert.match(shellApp, /upsertGeneratingPlanResult/);
  assert.match(shellApp, /createPlanJobCreatedHandler\(plan, index, batchPrompt\)/);
  assert.match(shellApp, /creditsConsumed: generated\.result\.creditsConsumed/);
  assert.match(shellApp, /taskId: result\.taskId/);
  assert.match(shellApp, /taskId: itemResult\.taskId/);
  assert.match(shellApp, /isInitialConfirmation\s*\? item\.boards\.map\(\(board\) => \(\{ \.\.\.board, status: 'pending' as const, error: undefined, creditsConsumed: undefined/);

  assert.match(shellWorkflow, /Promise<\{ plans: ShellPlanItem\[\]; message\?: string; creditsConsumed\?: number; taskId\?: string \}>/);
  assert.match(shellWorkflow, /creditsConsumed: result\.creditsConsumed/);
  assert.match(shellWorkflow, /taskId: result\.taskId/);

  assert.match(arkService, /requestAnalysisResponseDetailed/);
  assert.match(arkService, /creditsConsumed: finalJob\.result\?\.creditsConsumed/);
  assert.match(arkService, /taskId: String\(finalJob\.providerTaskId \|\| finalJob\.result\?\.providerTaskId \|\| ''\)\.trim\(\) \|\| undefined/);
  assert.match(arkService, /creditsConsumed: analysis\.creditsConsumed/);

  assert.match(videoStoryboardService, /Promise<\{ script: string; shots: VideoStoryboardShot\[\]; boards: VideoStoryboardBoard\[\]; taskId\?: string; backendJobId\?: string; creditsConsumed\?: number \}>/);
  assert.match(videoStoryboardService, /const taskId = String\(finalJob\.providerTaskId \|\| finalJob\.result\?\.providerTaskId \|\| ''\)\.trim\(\) \|\| undefined/);
  assert.match(videoStoryboardService, /const creditsConsumed = Number\.isFinite\(Number\(finalJob\.result\?\.creditsConsumed\)\) \? Number\(finalJob\.result\?\.creditsConsumed\) : undefined/);
  assert.match(shellApp, /taskId: planningTaskId,[\s\S]*backendJobId: planningJobId,[\s\S]*creditsConsumed: planningCreditsConsumed/);
  assert.match(shellApp, /planningTaskId,[\s\S]*creditsConsumed: planningCreditsConsumed,[\s\S]*status: 'awaiting_image_confirmation'/);
  assert.match(shellApp, /planningTaskId,[\s\S]*creditsConsumed: planningCreditsConsumed,[\s\S]*status: 'imaging'/);
  assert.match(videoModule, /planningTaskId: project\.planningTaskId/);
  assert.match(videoModule, /creditsConsumed: project\.creditsConsumed/);
  assert.match(videoModule, /creditsConsumed: board\.creditsConsumed/);
});

test('one click planning cards preview multiple plans instead of only the first plan', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(projectCard, /const planPreviewItems = \(project\.plans \|\| \[\]\)\.slice/);
  assert.match(projectCard, /已生成 \{project\.plans\?\.length \|\| 0\} 个策划/);
  assert.match(projectCard, /planPreviewItems\.map/);
  assert.match(projectCard, /打开查看全部/);
  assert.doesNotMatch(projectCard, /project\.plans\?\.\[0\]\?\.title/);
  assert.doesNotMatch(projectCard, /project\.plans\?\.\[0\]\?\.schemeContent/);
});

test('shell runtime snapshot drops stale local-only video generation placeholders', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /const hasRuntimeBackendIdentity =/);
  assert.match(app, /const shouldKeepRuntimeProject = \(project: Project\) =>\s*hasRuntimeBackendIdentity\(project\)/);
  assert.match(app, /const shouldKeepRuntimeTask = \(task: Task\) =>\s*hasRuntimeBackendIdentity\(task\)/);
  assert.match(app, /isStaleLocalOnlyVideoGenerationProject/);
  assert.match(app, /isStaleLocalOnlyVideoGenerationTask/);
  assert.match(app, /project\.module === AppModuleObj\.VIDEO/);
  assert.match(app, /project\.subFeature === 'generation'/);
  assert.match(app, /!project\.backendJobId/);
  assert.match(app, /task\.module === AppModuleObj\.VIDEO/);
  assert.match(app, /task\.subFeature === 'generation'/);
  assert.match(app, /!task\.backendJobId/);
  assert.match(app, /compactRuntimeProject/);
  assert.match(app, /compactRuntimeTask/);
  assert.match(app, /saved\.projects[\s\S]*?filter\(shouldKeepRuntimeProject\)[\s\S]*?isStaleLocalOnlyVideoGenerationProject[\s\S]*?map\(compactRuntimeProject\)/);
  assert.match(app, /saved\.tasks[\s\S]*?filter\(shouldKeepRuntimeTask\)[\s\S]*?isStaleLocalOnlyVideoGenerationTask[\s\S]*?map\(compactRuntimeTask\)/);
  assert.match(app, /snapshot\.projects[\s\S]*?filter\(shouldKeepRuntimeProject\)[\s\S]*?isStaleLocalOnlyVideoGenerationProject[\s\S]*?map\(compactRuntimeProject\)/);
  assert.match(app, /snapshot\.tasks[\s\S]*?filter\(shouldKeepRuntimeTask\)[\s\S]*?isStaleLocalOnlyVideoGenerationTask[\s\S]*?map\(compactRuntimeTask\)/);
});

test('shell startup bounds browser-local state before parsing and logs storage diagnostics', () => {
  const app = read('../ShellMigratedApp.tsx');
  const draftState = read('../utils/shellDraftState.ts');
  const appState = read('../utils/appState.ts');

  assert.match(app, /MAX_SHELL_RUNTIME_STORAGE_BYTES = 1024 \* 1024/);
  assert.match(app, /readBoundedLocalStorageItem/);
  assert.match(app, /window\.localStorage\.removeItem\(key\)/);
  assert.match(app, /getBrowserStorageDiagnostics/);
  assert.match(app, /frontend_startup_diagnostics/);
  assert.match(app, /SHELL_SESSION_STATE_KEY/);
  assert.match(app, /readShellSessionMarker/);
  assert.match(app, /writeShellSessionMarker/);
  assert.match(app, /frontend_previous_session_interrupted/);
  assert.match(app, /secondsSinceLastHeartbeat/);
  assert.match(app, /window\.setInterval\(\(\) => writeHeartbeat\(false\), 10_000\)/);
  assert.match(app, /window\.addEventListener\('pagehide', markClean\)/);
  assert.match(app, /usedJSHeapSize/);
  assert.match(draftState, /MAX_SHELL_DRAFT_STORAGE_BYTES = 2 \* 1024 \* 1024/);
  assert.match(draftState, /readBoundedShellDraftStorage/);
  assert.match(appState, /MAX_LOCAL_PERSISTED_STATE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(appState, /readBoundedPersistedStateStorage/);
});

test('shell image generation keeps recoverable KIE tasks as pending sync instead of failed history', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /import \{ isRecoverableKieTaskResult, recoverKieAiTask \} from '\.\/services\/kieAiService';/);
  assert.match(app, /const isRecoverableShellWorkflowResult = \(result: unknown\) =>/);
  assert.match(app, /isRecoverableKieTaskResult\(record\.taskId, record\.message, record\.errorCode\)/);
  assert.match(app, /let pendingSyncProject: Project \| null = null;/);
  assert.match(app, /let activeProviderTaskId = '';/);
  assert.match(app, /const recoverableItemResult = \{[\s\S]*\.\.\.itemResult,[\s\S]*taskId: itemResult\.taskId \|\| activeProviderTaskId,[\s\S]*\}/);
  assert.match(app, /const recoverablePlanResult = \{[\s\S]*\.\.\.result,[\s\S]*taskId: result\.taskId \|\| generationTaskIdByPlanId\.get\(plan\.id\),[\s\S]*\}/);
  assert.match(app, /if \(isRecoverableShellWorkflowResult\(recoverableItemResult\)\) \{/);
  assert.match(app, /if \(isRecoverableShellWorkflowResult\(recoverablePlanResult\)\) \{/);
  assert.match(app, /status: 'generating'/);
  assert.match(app, /结果待同步/);
  assert.match(app, /pendingSyncProject \? '任务已提交云端，结果待同步，可稍后点击同步。'/);
});

test('plan editor keeps recover enabled for failed cards with KIE task ids', () => {
  const planEditor = read('../shell/components/PlanEditor.tsx');

  assert.match(planEditor, /const canRecoverResult = Boolean\(result\?\.id && onRecoverResult && \(hasResult \|\| result\?\.taskId\)\)/);
  assert.doesNotMatch(planEditor, /label="找回"[\s\S]{0,180}disabled=\{!hasResult\}/);
});

test('shell recover polls a single result by KIE task id instead of only refreshing state', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /const handleRecoverResult = useCallback\(async \(projectId: string, resultId\?: string\)/);
  assert.match(app, /const recoverTaskId = String\(targetResult\?\.taskId \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(app, /targetResult\?\.taskId \|\| targetResult\?\.backendJobId/);
  assert.match(app, /await recoverKieAiTask\(recoverTaskId, apiConfig, controller\.signal, isVideoRecover\)/);
  assert.match(app, /status: 'completed'/);
  assert.match(app, /await persistProjectToSharedState\(recoveredProject\)/);
});

test('retouch workflow keeps submitted KIE items pending instead of throwing frontend failures', () => {
  const workflow = read('../adapters/shellWorkflow.ts');
  const app = read('../ShellMigratedApp.tsx');

  assert.match(workflow, /if \(generation\.status !== 'success' \|\| !generation\.imageUrl\) \{[\s\S]*if \(generation\.taskId\) \{[\s\S]*status: generation\.status === 'generating' \? 'generating' : 'error'[\s\S]*onItemCompleted\?\.\(pendingItem/s);
  assert.match(app, /const itemStatus(?:: GeneratedResult\['status'\])? = item\.status \|\| \(item\.imageUrl \? 'completed' : 'generating'\)/);
  assert.match(app, /const hasSpecialGenerating = productRestoreAnalysisPending\.isPending\s*\|\| specialWorkflowResults\.some\(\(item\) => item\.status === 'generating'\)/);
  assert.match(app, /if \(hasSpecialGenerating\) \{[\s\S]*pendingSyncProject = completedProject;[\s\S]*\}/);
});

test('shell material refresh stores large local files in IndexedDB instead of draft JSON', () => {
  const app = read('../ShellMigratedApp.tsx');
  const draftState = read('../utils/shellDraftState.ts');
  const assetStore = read('../utils/shellDraftAssetStore.ts');

  assert.match(assetStore, /indexedDB\.open\(DB_NAME, DB_VERSION\)/);
  assert.match(assetStore, /blob: Blob/);
  assert.match(assetStore, /restoreShellDraftAssetUrls/);
  assert.match(assetStore, /applyRestoredShellDraftAssetUrls/);
  assert.doesNotMatch(assetStore, /item\.remoteUrl \|\| item\.url \|\| !item\.localAssetId/);
  assert.match(app, /safeCreateObjectURL\(file\)/);
  assert.match(app, /saveShellDraftAsset\(localAssetId, file/);
  assert.match(app, /restoreShellDraftAssetUrls\(sourceMaterials\)/);
  assert.doesNotMatch(app, /if \(item\.remoteUrl \|\| item\.url \|\| !item\.localAssetId\) return item/);
  assert.match(app, /deleteShellDraftAsset\(removedMaterial\.localAssetId\)/);
  assert.match(app, /pruneShellDraftAssets/);
  assert.doesNotMatch(app, /fileToDataUrl\(file\)/);
  assert.doesNotMatch(app, /allowInlineAssets: true/);
  assert.doesNotMatch(draftState, /allowInlineAssets: true/);
});

test('storyboard generation uploads local draft assets before building model-readable URLs', () => {
  const app = read('../ShellMigratedApp.tsx');
  const storyboardGenerateBody = app.match(/if \(targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'storyboard'\) \{([\s\S]*?)\n    \}\n\n    if \(targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'diagnosis'\)/)?.[1] || '';

  assert.match(app, /ensureMaterialRemoteUrls/);
  assert.match(app, /loadShellDraftAsset/);
  assert.match(app, /uploadInternalAssetStream/);
  assert.match(app, /createMaterialUploadCoordinator/);
  assert.match(app, /materialUploadCoordinatorRef\.current\.run\(localAssetId/);
  assert.match(app, /applyUploadedMaterialUrl\(type, item\.id, remoteUrl\)/);
  assert.doesNotMatch(app, /const \{ uploadShellMaterial \} = await loadShellWorkflowModule\(\)/);
  assert.match(app, /resolvePublicAssetUrl\(item\.remoteUrl \|\| item\.url, publicBaseUrl\)/);
  assert.match(app, /shouldRefreshVideoAssetUrl/);
  assert.match(app, /shouldRefreshVideoAssetUrl\(currentSafeUrl, Boolean\(item\.localAssetId\)\)/);
  assert.match(app, /shouldRefreshExpiringMaterialUrl/);
  assert.match(app, /shouldRefreshExpiringMaterialUrl\(currentSafeUrl, Boolean\(item\.localAssetId\)\)/);
  assert.match(app, /tempfileb\.aiquickdraw\.com/);
  assert.match(app, /tempfile\.redpandaai\.co/);
  assert.match(app, /tempfile\.aiquickdraw\.com/);
  assert.match(app, /path\.includes\('\/openrouter-chat\/'\)/);
  assert.match(app, /type === 'referenceVideo'/);
  assert.match(app, /currentSafeUrl && !refreshVideoAssetUrl && !refreshExpiringMaterialUrl/);
  assert.match(storyboardGenerateBody, /const storyboardMaterials = await ensureMaterialRemoteUrls\(filteredMaterials, AppModuleObj\.VIDEO\)/);
  assert.match(storyboardGenerateBody, /buildVideoStoryboardConfig\(baseStoryboard\.config, storyboardPrompt, currentParams, storyboardMaterials\)/);
  assert.doesNotMatch(storyboardGenerateBody, /buildVideoStoryboardConfig\(baseStoryboard\.config, storyboardPrompt, currentParams, filteredMaterials\)/);
  assert.match(storyboardGenerateBody, /script: '素材上传中，正在准备公网参考 URL\.\.\.'/);
  assert.match(storyboardGenerateBody, /projects: \[\.\.\.nextProjects, \.\.\.\(currentStoryboard\.projects \|\| \[\]\)\]/);
  assert.match(storyboardGenerateBody, /素材已上传，正在拆解爆款视频并生成提示词/);
});

test('dead materials fail fast at the upload gate with the file name (D6)', () => {
  const app = read('../ShellMigratedApp.tsx');
  const gateBody = app.match(/const ensureMaterialRemoteUrls = useCallback\(async \(([\s\S]*?)\n  \}, \[/)?.[1] || '';

  // 2026-07-07 D6:URL 非空但解析不出公网地址、又无本地文件可补传的"死素材",
  // 必须在提交闸口带文件名报错,不放行到策划中途抛模糊的"素材 没有公网地址"。
  assert.match(gateBody, /if \(rawUrl && !currentSafeUrl\) \{/);
  assert.match(gateBody, /缺少可用的公网地址（原文件已不在本地），请删除该素材后重新上传。/);
  assert.match(gateBody, /item\.fileName \|\| '素材'/);
});

test('shell generation paths upload local draft assets before provider submission', () => {
  const app = read('../ShellMigratedApp.tsx');
  const handleGenerateBody = app;
  const oneClickImageBody = app.match(/const runOneClickPlanGeneration = useCallback\(async \([\s\S]*?=> \{([\s\S]*?)\n  \}, \[currentParams/)?.[1] || '';

  assert.match(handleGenerateBody, /const materialsRef = useRef<Record<string, Material\[\]>>\(materials\);/);
  assert.match(handleGenerateBody, /const latestFilteredMaterials = filterMaterialsForScope\(materialsRef\.current, targetModule, targetSubFeature\);/);
  assert.match(handleGenerateBody, /let generationMaterials = hasMaterialInputs\(latestFilteredMaterials\) \|\| !hasMaterialInputs\(filteredMaterials\)/);
  assert.match(handleGenerateBody, /generationMaterials = await ensureMaterialRemoteUrls\(generationMaterials, targetModule\);/);
  assert.match(handleGenerateBody, /cloneGenerationContext\(generationPrompt, generationParams, generationMaterials\)/);
  assert.match(handleGenerateBody, /\(generationMaterials\.product \|\| \[\]\)/);
  assert.match(handleGenerateBody, /\.\.\.generationMaterials,\s+product:/);
  assert.match(handleGenerateBody, /materials: generationMaterials/);
  assert.match(oneClickImageBody, /const preparedGenerationMaterials = await ensureMaterialRemoteUrls\(generationMaterials, AppModuleObj\.ONE_CLICK\);/);
  assert.match(oneClickImageBody, /const planMaterials = buildVariantMaterials\(preparedGenerationMaterials, plan, sceneSubFeature\);/);
  assert.match(oneClickImageBody, /materials: planMaterials/);
});

test('everything replace submit creates visible project card before preparing remote materials', () => {
  const app = read('../ShellMigratedApp.tsx');
  // 2026-07-07 创建反馈提速:即时占位卡从"翻译/万物替换/买家秀"扩展到全部模块
  // (买家秀走多套卡数组,其余走 immediateProject;一键主详 proj-plan- id + planning 态)。
  const placeholderIndex = app.indexOf("const immediateProject = targetModule !== AppModuleObj.BUYER_SHOW");
  const uploadIndex = app.indexOf('generationMaterials = await ensureMaterialRemoteUrls(generationMaterials, targetModule);');

  assert.notEqual(placeholderIndex, -1);
  assert.notEqual(uploadIndex, -1);
  assert.ok(placeholderIndex < uploadIndex);
  assert.match(app, /isOneClickSubmit\s*\?\s*`proj-plan-\$\{immediateCreatedAt\}`/, '一键主详即时卡必须用 proj-plan- id,策划分支才能原位接管');
  assert.match(app, /status: isOneClickSubmit \|\| isProductRestoreSubmit \? 'planning' : 'generating'/);
  // 一键主详策划分支必须消费即时卡(存在同 id 就原位替换),不许再无条件 prepend 造重复卡
  const oneClickBranch = app.match(/if \(targetModule === AppModuleObj\.ONE_CLICK\) \{([\s\S]*?)const controller = new AbortController\(\);/)?.[1] || '';
  assert.match(oneClickBranch, /const projectId = immediateProject\?\.id \|\| \('proj-plan-' \+ Date\.now\(\)\)/);
  assert.match(oneClickBranch, /const taskId = immediateTask\?\.id \|\| \('task-plan-' \+ Date\.now\(\)\)/);
  assert.match(app, /prev\.some\(\(project\) => project\.id === projectId\)\s*\? prev\.map\(\(project\) => \(project\.id === projectId \? planningProject : project\)\)\s*: \[planningProject, \.\.\.prev\]/);
  // #34 买家秀多套改造后,即时卡发布与买家秀 set 卡合并为同一条 setProjects(仍在素材上传前,先卡后传的语义不变)
  assert.match(app, /setProjects\(\(prev\) => \[\.\.\.immediateBuyerShowProjects, \.\.\.\(immediateProject \? \[immediateProject\] : \[\]\), \.\.\.prev\]\);/);
  assert.match(app, /setTasks\(\(prev\) => \[immediateTask, \.\.\.prev\]\);/);
  assert.match(app, /immediateProject\?\.id \|\| immediateBuyerShowRootProjectId \|\| 'proj-' \+ Date\.now\(\)/); // #34 后兜底链多了买家秀根卡 id
  assert.match(app, /immediateTask\?\.id \|\| 'task-' \+ Date\.now\(\)/);
  assert.match(app, /shellProjectId: projectId/);
  assert.match(app, /shellProjectName: projectName/);
});

test('translation submit creates visible project card before preparing remote materials', () => {
  const app = read('../ShellMigratedApp.tsx');
  const placeholderIndex = app.indexOf('const immediateProject =');
  const uploadIndex = app.indexOf('generationMaterials = await ensureMaterialRemoteUrls(generationMaterials, targetModule);');

  assert.notEqual(placeholderIndex, -1);
  assert.notEqual(uploadIndex, -1);
  assert.ok(placeholderIndex < uploadIndex);
  assert.match(app, /targetModule === AppModuleObj\.TRANSLATION/);
  assert.match(app, /results: targetModule === AppModuleObj\.TRANSLATION/);
  assert.match(app, /void persistProjectToSharedState\(immediateProject\);/);
});

test('synced translation job projects are persisted after cloud recovery', () => {
  const app = read('../ShellMigratedApp.tsx');
  const persistUtil = read('../utils/syncedProjectPersistence.ts');
  const persistPredicate = persistUtil.match(/export const shouldPersistSyncedProjectFromJobs = \([\s\S]*?\n\};/)?.[0] || '';

  assert.match(app, /from '\.\/utils\/syncedProjectPersistence'/);
  assert.match(persistPredicate, /project\.sourceType === 'job'/);
  assert.match(persistPredicate, /PERSISTABLE_JOB_CARD_MODULES\.has\(String\(project\.module \|\| ''\)\)/);
  assert.match(persistPredicate, /nextCompletedCount > 0/);
  assert.match(persistUtil, /'translation',/);
  assert.match(persistUtil, /'everything_replace',/);
});

test('video generation blocks duplicate submit windows without blocking other active jobs', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const serverIndex = read('../../server/index.mjs');
  const jobSubmissionPolicy = read('../../server/jobSubmissionPolicy.mjs');
  const jobManager = read('../../server/jobManager.mjs');

  assert.match(shellApp, /generationSubmitLocksRef/);
  assert.match(shellApp, /shouldGuardGenerationSubmit\(targetModule\)/);
  assert.match(shellApp, /const shouldGuardGenerationSubmit = [\s\S]*module === AppModuleObj\.ONE_CLICK[\s\S]*module === AppModuleObj\.VIDEO[\s\S]*?\);/);
  assert.doesNotMatch(shellApp, /const hasActiveGuardedGeneration = \(/);
  assert.doesNotMatch(shellApp, /当前已有任务未返回，请等待完成或取消后再提交。/);
  assert.match(shellApp, /const isCurrentGenerationSubmitLocked = shouldGuardGenerationSubmit\(activeModule\)\s*&& Boolean\(generationSubmitLocks\[currentGenerationSubmitLockKey\]\)/);
  assert.match(shellApp, /beginGenerationSubmitLock\(guardedSubmitLockKey\)/);
  assert.match(shellApp, /endGenerationSubmitLock\(guardedSubmitLockKey\)/);
  assert.doesNotMatch(shellApp, /const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{\s*releaseGuardedSubmit\(\)/);
  assert.match(shellApp, /finally \{[\s\S]*releaseGuardedSubmit\(\)/);
  assert.match(shellApp, /taskMetadata:\s*\{ clientSubmissionKey: guardedSubmitLockKey \}/);
  assert.match(shellApp, /persistProjectToSharedState\(pendingVideoProject\)/);
  assert.match(shellApp, /isSubmitLocked=\{isCurrentGenerationSubmitLocked\}/);
  assert.match(bottomInputBar, /isSubmitLocked\?: boolean/);
  assert.match(bottomInputBar, /const isGenerateDisabled = isSubmitLocked \|\| Boolean\(disabledReason\) \|\| \(!promptText\.trim\(\) && !canGenerateWithoutPrompt\)/);
  assert.match(bottomInputBar, /const isSubmitBusy = isSubmitLocked/);
  assert.match(bottomInputBar, /const handleGenerateClick = \(\) => \{\s*if \(!isGenerateDisabled\) onGenerate\(\);\s*\}/);
  assert.match(bottomInputBar, /submitLabel = isSubmitBusy \? '任务处理中\.\.\.' : generateLabel/);
  assert.match(bottomInputBar, /if \(!isGenerateDisabled\) onGenerate\(\)/);
  assert.match(bottomInputBar, /disabled=\{isGenerateDisabled\}/);
  assert.match(workflow, /resolution: normalizeSeedanceApiResolution\(firstParam\(input\.params, \['videoResolution'\], '720p'\)\)/);
  assert.doesNotMatch(workflow, /requestId: `\$\{Date\.now\(\)\}-/);
  assert.match(jobSubmissionPolicy, /VIDEO_DEDUPE_WINDOW_MS = 60 \* 60 \* 1000/);
  assert.match(jobSubmissionPolicy, /CHAT_DEDUPE_WINDOW_MS = 3 \* 60 \* 1000/);
  assert.match(jobSubmissionPolicy, /VIDEO_JOB_TASK_TYPES = new Set\(\[/);
  assert.match(jobSubmissionPolicy, /normalizedTaskType === 'kie_chat'/);
  assert.match(serverIndex, /submissionPolicy\.dedupeWindowMs/);
  assert.match(jobManager, /key !== 'requestId'/);
});

test('material preview bar opens uploaded videos in a playable modal', () => {
  const previewBar = read('../shell/components/MaterialPreviewBar.tsx');

  assert.match(previewBar, /openVideoPreview/);
  assert.match(previewBar, /if \(mediaKind === 'video'\) \{ openVideoPreview\(m\); \}/);
  assert.match(previewBar, /selectedVideo/);
  assert.match(previewBar, /videoCodec: material\.videoCodec/);
  assert.match(previewBar, /isBrowserUnsupportedVideoCodec\(m\.videoCodec\)/);
  assert.match(previewBar, /getBrowserVideoCodecWarning\(m\.videoCodec\)/);
  assert.match(previewBar, /items=\{selectedVideo \? \[\{ url: selectedVideo\.url, type: 'video', title: selectedVideo\.fileName, videoCodec: selectedVideo\.videoCodec \}\] : \[\]\}/);
  assert.match(previewBar, /preload="auto"/);
  assert.match(previewBar, /onLoadedMetadata/);
  assert.match(previewBar, /video\.currentTime/);
  assert.match(previewBar, /onClose=\{\(\) => setSelectedVideo\(null\)\}/);
  assert.match(previewBar, /点击播放/);
  const imageLightbox = read('../shell/components/ImageLightbox.tsx');
  assert.match(imageLightbox, /detectRemoteMp4VideoCodec/);
  assert.match(imageLightbox, /getBrowserVideoCodecWarning\(currentItem\.videoCodec \|\| detectedVideoCodec\)/);
  assert.match(imageLightbox, /<source src=\{currentItem\.url\} type=\{getVideoMimeType\(currentItem\)\}/);
});

test('viral storyboard prompts preserve the required segmented prompt and voiceover format', () => {
  const videoStoryboardService = [
    read('../services/videoStoryboardService.ts'),
    read('../utils/videoStoryboardPlanning.ts'),
  ].join('\n');
  const normalizerBody = videoStoryboardService.match(/const normalizeViralStoryboardPrompt = \([\s\S]*?\n\};/)?.[0] || '';

  assert.match(videoStoryboardService, /商品参考图公网URL/);
  assert.match(videoStoryboardService, /爆款复刻视频公网URL/);
  assert.match(videoStoryboardService, /分镜对应动态视频脚本提示词/);
  assert.match(videoStoryboardService, /分段一\n\{任务：根据输入按照要求制作一张x（当前分段数量）宫格分镜图，保证每个分镜单元格画面都必须是\$\{config\.aspectRatio\}的画面比例。/);
  assert.match(videoStoryboardService, /【全片核心视觉基调】/);
  assert.match(videoStoryboardService, /人物细节：用一句完整中文描述从爆款视频拆解出的人物类型、手部\/身体动作、服装气质和出镜范围，所有分段保持一致/);
  assert.match(videoStoryboardService, /环境\/场景：用一句完整中文描述从爆款视频拆解出的具体场景、桌面\/厨房\/办公\/道具、光线方向、景深和机位，并在全片保持连续/);
  assert.match(videoStoryboardService, /最终输出必须替换成从爆款视频中拆解出的具体描述，不得原样保留“用一句完整中文描述”、不得出现 xxx/);
  assert.match(videoStoryboardService, /extractCoreVisualDescription/);
  assert.match(normalizerBody, /人物细节：\$\{personDetail\}/);
  assert.match(normalizerBody, /环境\/场景：\$\{environmentDetail\}/);
  assert.doesNotMatch(normalizerBody, /人物细节：xxx/);
  assert.doesNotMatch(normalizerBody, /环境\/场景：xxx/);
  assert.match(normalizerBody, /任务：根据输入按照要求制作一张\$\{panelCount\}宫格分镜图，保证每个分镜单元格画面都必须是\$\{config\.aspectRatio\}的画面比例。/);
  assert.doesNotMatch(normalizerBody, /商品：保持与商品参考图完全一致，不展开描述包装细节/);
  assert.match(videoStoryboardService, /全局一致性：商品参考图一致性、人物、场景、道具、光影、镜头语言/);
  assert.match(videoStoryboardService, /分镜内容如下/);
  assert.match(videoStoryboardService, /固定要求:/);
  assert.match(videoStoryboardService, /口播内容必须来自爆款视频中真实可识别的原始口播/);
  assert.match(videoStoryboardService, /音效描述必须来自爆款视频中真实可识别的声音内容/);
  assert.match(videoStoryboardService, /禁止为了让脚本完整而补写、扩写、编造口播或音效/);
  assert.match(videoStoryboardService, /参考视频该分镜口播未清晰识别/);
  assert.match(videoStoryboardService, /参考视频该分镜音效未清晰识别/);
  assert.match(videoStoryboardService, /采用均等的网格排列（例如 2x2, 3x4 根据视频镜头数量而定，严格按\$\{config\.aspectRatio\}比例对单格内容先构图，保证每一个分镜单元格内容都是\$\{config\.aspectRatio\}比例，再组合成整个画面，）/);
  assert.doesNotMatch(videoStoryboardService, /禁止输出“口播无”“无口播”“静音”/);
  assert.doesNotMatch(videoStoryboardService, /3x3, 或 3x4/);
  assert.doesNotMatch(videoStoryboardService, /贴合原视频节奏的背景音乐与环境音/);
  assert.doesNotMatch(videoStoryboardService, /日常使用更轻松/);
  assert.match(videoStoryboardService, /画面描述\(视觉\)：xxx（运镜\+带有动作状态的画面内容描述）/);
  assert.match(videoStoryboardService, /口播（情绪描写）：“xxx（必须是爆款视频中该分镜真实可识别口播；识别不清写参考视频该分镜口播未清晰识别）”/);
  assert.match(videoStoryboardService, /音效：xxx（必须是爆款视频中该分镜真实可识别声音；识别不清写参考视频该分镜音效未清晰识别）/);
  assert.match(videoStoryboardService, /normalizeViralStoryboardPrompt/);
  assert.match(videoStoryboardService, /normalizeViralDynamicScriptPrompt/);
  assert.match(videoStoryboardService, /normalizeVoiceoverText/);
  assert.match(videoStoryboardService, /口播\\s\*\(无\|为空\)/);
  assert.match(videoStoryboardService, /【生成输入素材公网URL】/);
  assert.match(videoStoryboardService, /上一张宫格分镜图公网URL/);
  assert.doesNotMatch(videoStoryboardService, /爆款复刻视频用于锁定镜头节奏/);
  assert.doesNotMatch(videoStoryboardService, /固定补充要求：使用 GPTimage2 以 2k 清晰度生成/);
});

test('one click confirm-plan flow generates the selected scheme once instead of duplicating the config count', () => {
  const app = read('../ShellMigratedApp.tsx');
  const confirmPlanBody = app.match(/const handleConfirmPlan = useCallback\([\s\S]*?\n  \}, \[[\s\S]*?\]\);/)?.[0] || '';
  const generationBody = app.match(/const runOneClickPlanGeneration = useCallback\([\s\S]*?\n  \}, \[currentParams, filteredMaterials, activeSubFeature, addToast, hydrateShellJobs, apiConfig\.workspacePreferences, apiConfig\.concurrency, persistProjectToSharedState, publicBaseUrl, logShellError, ensureMaterialRemoteUrls, buildVariantMaterials\]\);/)?.[0] || '';

  assert.match(confirmPlanBody, /const selectedPlans = Array\.isArray\(planOrPlans\) \? planOrPlans : \[planOrPlans\]/);
  assert.match(confirmPlanBody, /await runOneClickPlanGeneration\(project, selectedPlans\)/);
  assert.match(generationBody, /const sceneSubFeature = project\.subFeature \|\| activeSubFeature/);
  assert.match(generationBody, /const batchCount = selectedPlans\.length/);
  assert.match(generationBody, /const requiresFirstBenchmark = sceneSubFeature === 'sku' && Boolean\(firstBenchmarkPlanId\)/);
  assert.match(generationBody, /const firstBenchmarkSelectedIndex = requiresFirstBenchmark && !firstBenchmarkResultUrl/);
  assert.match(generationBody, /await runPlanAtIndex\(firstBenchmarkSelectedIndex\)/);
  assert.match(generationBody, /const plan = requiresFirstBenchmark && basePlan\.id !== firstBenchmarkPlanId && firstBenchmarkResultUrl && !basePlan\.sourceResultUrl/);
  assert.match(generationBody, /const planMaterials = buildVariantMaterials\(preparedGenerationMaterials, plan, sceneSubFeature\)/);
  assert.match(generationBody, /materials: planMaterials/);
  assert.match(generationBody, /firstBenchmarkResultUrl = resolvePublicAssetUrl\(result\.imageUrl, publicBaseUrl\) \|\| result\.imageUrl/);
  assert.match(generationBody, /const workerCount = Math\.max\(1, Math\.min\(Number\(apiConfig\.concurrency \|\| 1\) \|\| 1, indexes\.length\)\)/);
  assert.match(generationBody, /Promise\.all\(Array\.from\(\{ length: workerCount \}, \(\) => runWorker\(\)\)\)/);
  assert.match(generationBody, /const runPlanAtIndex = async \(index: number\) =>/);
  assert.match(generationBody, /createPlanJobCreatedHandler\(plan, index, batchPrompt\)/);
  assert.match(generationBody, /const generationBackendJobIdByPlanId = new Map<string, string>\(\)/);
  assert.match(generationBody, /shellProjectId: projectId/);
  assert.match(generationBody, /shellPlanId: plan\.id/);
  assert.match(generationBody, /backendJobId: generationBackendJobIdByPlanId\.get\(plan\.id\)/);
  assert.match(generationBody, /const totalTaskCount = Math\.max\(Number\(project\.taskCount \|\| 0\), orderedProjectPlans\.length, batchCount\)/);
  assert.match(generationBody, /taskCount: totalTaskCount/);
  assert.match(generationBody, /mergeGeneratedPlanResults\(baseResults \|\| \[\], nextResults, selectedPlanIds\)/);
  assert.match(generationBody, /projectsRef\.current = next/);
  assert.doesNotMatch(generationBody, /resolveBatchCount\(AppModuleObj\.ONE_CLICK, sceneSubFeature, currentParams\)/);
  assert.doesNotMatch(generationBody, /for \(let index = 0; index < batchCount; index \+= 1\)/);
});

test('one click shell planning dialog exposes old-style selected batch generation and single-scheme generation', () => {
  const workflow = read('../adapters/shellWorkflow.ts');
  const planEditor = read('../shell/components/PlanEditor.tsx');
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(workflow, /selected: true/);
  assert.match(planEditor, /const resultHasVisibleTaskId = \(result\?: GeneratedResult \| null\) => Boolean\(String\(result\?\.taskId \|\| ''\)\.trim\(\)\)/);
  assert.match(planEditor, /const activeGeneratingResult = \(results \|\| \[\]\)\.find\(\(result\) => result\.status === 'generating' && result\.planId && resultHasVisibleTaskId\(result\)\)/);
  assert.match(planEditor, /const activeGeneratingPlanId = projectStatus === 'generating' \? \(activeGeneratingResult\?\.planId \|\| null\) : null/);
  assert.match(planEditor, /const isPlanSubmitPending = Boolean\(isConfirmPlanPending\?\.\(plan\.id\)\)/);
  assert.match(planEditor, /const hasErrorResult = result\?\.status === 'error'/);
  assert.match(planEditor, /hasErrorResult \? '生成失败' : isGenerating \? '生成中'/);
  assert.match(projectCard, /const hasGeneratingResult = project\.results\.some/);
  assert.match(projectCard, /const resultHasVisibleTaskId = \(result: GeneratedResult\) => Boolean\(String\(result\.taskId \|\| result\.backendJobId \|\| ''\)\.trim\(\)\)/);
  assert.match(projectCard, /const isResultActivelyGenerating = \(result: GeneratedResult\) => \([\s\S]*result\.status === 'generating'[\s\S]*!isCompletedMediaResult\(result\)[\s\S]*\(resultHasVisibleTaskId\(result\) \|\| project\.status === 'generating'\)/);
  assert.match(projectCard, /const pendingPlans = project\.plans\.filter\(\(plan\) => \([\s\S]*plan\.selected[\s\S]*!completedPlanIds\.has\(plan\.id\)[\s\S]*!activePlanIds\.has\(plan\.id\)[\s\S]*!isPlanConfirmPending\(plan\.id\)/);
  assert.match(projectCard, /const firstBenchmarkPlanId = project\.module === 'one_click' && project\.subFeature === 'sku'/);
  assert.match(projectCard, /activePlanIds\.has\(firstBenchmarkPlanId\)/);
  assert.match(projectCard, /onConfirmPlan\(project\.id, pendingPlans\)/);
  assert.doesNotMatch(projectCard, /const selectedPlans = project\.plans\.filter\(\(plan\) => plan\.selected\)/);
  assert.match(planEditor, /onConfirm\(plan\)/);
  assert.match(planEditor, /ConfirmDialog/);
  assert.match(planEditor, /pendingDeletePlan/);
});

test('one click shell submissions route through real planning before image generation', () => {
  const app = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const oneClickModule = read('../shell/modules/OneClick/OneClickModule.tsx');
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(workflow, /export const runShellOneClickPlanning = async/);
  assert.match(workflow, /generateFirstImageReplicationSchemes/);
  assert.match(workflow, /generateMarketingSchemes/);
  assert.match(workflow, /generateSkuSchemes/);
  assert.match(app, /if \(targetModule === AppModuleObj\.ONE_CLICK\) \{/);
  assert.match(app, /runShellOneClickPlanning/);
  assert.match(app, /status: 'planning'/);
  assert.match(app, /type: 'plan'/);
  assert.doesNotMatch(oneClickModule, /if \(planningProject && planningProject\.plans\)/);
  assert.match(projectCard, /PlanEditor/);
  assert.match(projectCard, /onConfirmPlan\?\.\(project\.id, plan\)/);
});

test('project result regeneration submits a real per-result image task instead of only refilling the composer', () => {
  const app = read('../ShellMigratedApp.tsx');
  const regenerateBody = app.match(/const handleRegenerateResult = useCallback\(async \(projectId: string, resultId: string, revisionInstruction = ''\) => \{([\s\S]*?)\n  \}, \[projects, addToast/)?.[1] || '';

  assert.match(regenerateBody, /const updateProjectWithRegeneratedResult = \(nextResult: GeneratedResult\) =>/);
  assert.match(regenerateBody, /status: 'generating'/);
  assert.match(regenerateBody, /title: `重生成: \$\{project\.name\}`/);
  assert.match(regenerateBody, /runShellImageGeneration/);
  assert.match(regenerateBody, /module: project\.module/);
  assert.match(regenerateBody, /__retryResultId: result\.id/);
  assert.match(regenerateBody, /await persistProjectToSharedState\(pendingProject\)/);
  assert.match(regenerateBody, /await persistProjectToSharedState\(completedProject\)/);
  assert.match(regenerateBody, /addToast\('已提交重生成任务'/);
  assert.doesNotMatch(regenerateBody, /已把旧 prompt 回填到底部输入区，可调整后重新生成/);
});

test('video workspace keeps the shell UI while migrating storyboard and diagnosis logic', () => {
  const videoModule = read('../shell/modules/Video/VideoModule.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const videoStoryboardService = read('../services/videoStoryboardService.ts');
  const storyboardQuickBlock = bottomInputBar.match(/storyboard: \[[\s\S]*?\n  \],\n  diagnosis:/)?.[0] || '';
  const storyboardExtendedBlock = bottomInputBar.match(/storyboard: \[[\s\S]*?\n  \],\n  diagnosis:/g)?.[1] || '';

  assert.match(videoModule, /ProjectListView/);
  assert.match(videoModule, /hasDiagnosisReportContent\(state\.diagnosis\)/);
  // 2026-07-09 将离分镜卡删不掉:storyboard 删除只清 videoMemory 本地状态没写墓碑,
  // 服务端 mergeVideoMemory 并集把旧卡并回来。删除分支必须同时调用 onDeleteProject 写 deletedProjectIds。
  const storyboardDeleteBranch = videoModule.match(/if \(activeSubFeature === 'storyboard'\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(storyboardDeleteBranch, /onDeleteProject\(projectId\)/);
  assert.match(videoModule, /分镜生成/);
  assert.doesNotMatch(videoModule, /分镜项目/);
  assert.match(videoModule, /视频诊断/);
  assert.doesNotMatch(videoModule, /beforeProjects=\{beforeProjects\}/);
  assert.doesNotMatch(videoModule, /商品信息 \/ 卖点/);
  assert.doesNotMatch(videoModule, /一键勘探深度分析/);
  assert.match(bottomInputBar, /activeSubFeature\?: string/);
  assert.match(bottomInputBar, /getVideoQuickParams/);
  assert.match(bottomInputBar, /分镜生成/);
  assert.match(bottomInputBar, /目标国家\/语言/);
  assert.match(bottomInputBar, /分镜镜头数/);
  assert.match(bottomInputBar, /爆款复刻/);
  assert.match(bottomInputBar, /isStoryboardViralReplicationMode/);
  assert.match(bottomInputBar, /getStoryboardQuickParams/);
  assert.match(bottomInputBar, /return VIDEO_QUICK_PARAMS\.storyboard\.filter\(\(param\) => \['videoMode', 'ratio'\]\.includes\(param\.key\)\)/);
  assert.match(bottomInputBar, /if \(activeSubFeature === 'storyboard' && isStoryboardViralReplicationMode\(currentParams\.videoMode\)\) return \[\]/);
  assert.match(bottomInputBar, /if \(isStoryboardViralReplicationMode\(currentParams\.videoMode\)\) return null/);
  assert.match(bottomInputBar, /return isStoryboardViralReplicationMode\(currentParams\.videoMode\) \? \['product', 'referenceVideo'\] : \['product', 'scene'\]/);
  assert.match(bottomInputBar, /getStoryboardMaterialLabels/);
  assert.match(bottomInputBar, /多角度产品图/);
  assert.match(bottomInputBar, /isStoryboardViralReplicationContext/);
  assert.match(bottomInputBar, /输入产品的参数信息、真实卖点等；不填写则默认复刻参考视频文案/);
  assert.match(bottomInputBar, /canGenerateWithoutPrompt/);
  assert.match(bottomInputBar, /disabled=\{isGenerateDisabled\}/);
  assert.doesNotMatch(bottomInputBar, /disabled=\{Boolean\(disabledReason\) \|\| isGenerating/);
  assert.match(shellApp, /const isViralStoryboard = draftRuntimeConfig\.videoGenerationMode === 'viral_split'/);
  assert.match(shellApp, /if \(!storyboardPrompt && !isViralStoryboard\)/);
  assert.doesNotMatch(shellApp, /if \(!storyboardPrompt\) \{ addToast\('请输入分镜需求'/);
  assert.match(bottomInputBar, /自定义叙事逻辑/);
  assert.match(bottomInputBar, /storyboardNarrativeSelectOpen/);
  assert.match(bottomInputBar, /STORYBOARD_ADD_PRESET_ID/);
  assert.match(bottomInputBar, /selectedPresetId === STORYBOARD_ADD_PRESET_ID/);
  assert.match(bottomInputBar, /storyboardPresetNamingOpen/);
  assert.match(bottomInputBar, /请给预设命名/);
  assert.doesNotMatch(bottomInputBar, /storyboardNarrativeContent/);
  assert.match(bottomInputBar, /getRecommendedStoryboardShotCount/);
  assert.match(bottomInputBar, /onParamChange\('shotCount', recommendedShotCount\)/);
  assert.match(bottomInputBar, /增加预设/);
  assert.match(bottomInputBar, /保存预设/);
  assert.match(bottomInputBar, /customStoryboardNarrativePresets/);
  assert.match(storyboardQuickBlock, /生成模式/);
  assert.doesNotMatch(storyboardExtendedBlock, /分镜板生成方式/);
  assert.doesNotMatch(storyboardExtendedBlock, /生成数量/);
  assert.doesNotMatch(storyboardExtendedBlock, /场景描述/);
  assert.doesNotMatch(storyboardExtendedBlock, /label: '生成模式'/);
  assert.match(bottomInputBar, /视频诊断/);
  assert.match(bottomInputBar, /一键勘探深度分析/);
  assert.match(shellApp, /generateStoryboardScript/);
  assert.match(shellApp, /generateStoryboardBoardImage/);
  assert.match(shellApp, /isVideoStoryboardViralReplicationMode/);
  assert.match(shellApp, /runtimeConfig\.videoGenerationMode === 'viral_split'[\s\S]*?status: 'awaiting_image_confirmation'/);
  assert.match(shellApp, /爆款复刻策划已生成，请确认后开始生图/);
  assert.match(shellApp, /handleConfirmStoryboardImaging/);
  assert.match(videoStoryboardService, /短视频爆款拆解复刻导演/);
  assert.match(videoStoryboardService, /dynamicScriptPrompt/);
  assert.match(videoStoryboardService, /15秒左右为一个分段/);
  assert.match(videoStoryboardService, /revisionInstruction/);
  assert.match(videoModule, /dynamicScriptPrompt: board\.dynamicScriptPrompt \|\| board\.scriptText/);
  assert.match(videoModule, /error: project\.error/);
  assert.match(videoModule, /storyboardProjectStatus: project\.status/);
  assert.match(projectCard, /动态视频脚本提示词/);
  assert.match(projectCard, /error\?: string/);
  assert.match(projectCard, /失败原因/);
  assert.match(projectCard, /project\.status === 'error' && project\.error/);
  assert.match(projectCard, /storyboardProjectStatus\?:/);
  assert.match(projectCard, /storyboardProjectStatus === 'awaiting_image_confirmation'/);
  assert.match(projectCard, /storyboardRevisionDialog/);
  assert.match(shellApp, /handleStoryboardRegenerateResult/);
  assert.match(shellApp, /persistVideoMemoryToSharedState/);
  assert.match(shellApp, /persistShellDraftToSharedState/);
  assert.match(shellApp, /resolveHydratedShellDraftState/);
  assert.match(shellApp, /if \(!hasHydratedSharedData\) return/);
  assert.match(shellApp, /status: 'scripting'/);
  assert.match(shellApp, /formatVideoStoryboardFailureMessage/);
  assert.match(shellApp, /storyboardFailureStep = '分镜脚本生成'/);
  assert.match(shellApp, /status: 'failed'[\s\S]*error: failureMessage/);
  assert.match(videoModule, /project\.status === 'pending' \? 'generating'/);
  assert.match(videoModule, /project\.status === 'awaiting_image_confirmation' \? 'planning'/);
  assert.match(projectCard, /确认生图/);
  assert.match(videoModule, /onConfirmStoryboardImaging/);
  assert.match(projectCard, /等待统一确认生图/);
  assert.doesNotMatch(projectCard, /label=\{isStoryboardAwaitingImageConfirmation \? '待确认'/);
  assert.match(shellApp, /parseStoryboardShotCount/);
  assert.match(shellApp, /countryLanguage: params\.countryLanguage \|\| base\.countryLanguage/);
  assert.match(shellApp, /projectCount: 1/);
  assert.match(shellApp, /quality: '2k'/);
  assert.match(shellApp, /generationMode: 'single_image'/);
  assert.match(videoStoryboardService, /createImageModuleConfig\(AspectRatio\.AUTO, 'gpt-image-2', config\.quality \|\| GPT_IMAGE_2_DEFAULT_QUALITY\)/);
  assert.doesNotMatch(videoStoryboardService, /createImageModuleConfig\(config\.aspectRatio, 'gpt-image-2', config\.quality \|\| GPT_IMAGE_2_DEFAULT_QUALITY\)/);
  assert.match(shellApp, /probeVideoDiagnosis/);
  assert.match(shellApp, /analyzeVideoDiagnosis/);
  assert.doesNotMatch(videoModule, /SidebarShell/);
  assert.doesNotMatch(videoModule, /\.\.\/\.\.\/\.\.\/modules\/Video\/StoryboardSidebar/);
  assert.match(shellApp, /createDefaultVideoState/);
  assert.match(shellApp, /setVideoMemory/);
  assert.match(shellApp, /persistentState=\{videoMemory \|\| createDefaultVideoState\(\)\}/);
  assert.match(shellApp, /onStateChange=\{setVideoMemory\}/);
  assert.doesNotMatch(shellApp, /activeModule === AppModuleObj\.VIDEO && activeSubFeature !== 'generation'/);
  const videoCase = shellApp.match(/case AppModuleObj\.VIDEO:([\s\S]*?)case AppModuleObj\.XHS_COVER:/)?.[1] || '';
  assert.match(videoCase, /persistentState=\{videoMemory \|\| createDefaultVideoState\(\)\}/);
  assert.match(videoCase, /projects=\{filteredProjects\}/);
  assert.match(shellApp, /activeSubFeature=\{activeSubFeature\}/);
  assert.match(projectCard, /isDiagnosisReport/);
  assert.match(projectCard, /诊断报告/);
  assert.doesNotMatch(projectCard, /isDiagnosisReport[\s\S]{0,400}ImageLightbox/);
});

test('shell app uses the migrated sidebar, login screen, and toast system as the only active shell entry chain', () => {
  const main = read('../main.tsx');
  const app = read('../ShellMigratedApp.tsx');

  assert.match(main, /void import\('\.\/ShellMigratedApp\.tsx'\)\.then/);
  assert.doesNotMatch(main, /import App from '\.\/App'/);
  assert.match(app, /\.\/shell\/components\/layout\/SidebarNavigation/);
  assert.match(app, /\.\/shell\/components\/Internal\/LoginScreen/);
  assert.match(app, /\.\/shell\/components\/ToastSystem/);
});

test('shell auth bootstrap reuses cached checks and shows saved users immediately', () => {
  const app = read('../ShellMigratedApp.tsx');
  const authBootstrapChunk = app.match(/const \[authStatus, setAuthStatus\][\s\S]*?const \[loginError, setLoginError\]/)?.[0] || '';
  const localPreviewHelper = app.match(/const hasLocalPreviewFlag = \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
  const authenticatedSessionHelper = app.match(/const hasAuthenticatedLocalSession = \(\) => \([\s\S]*?\n\);/)?.[0] || '';

  assert.match(app, /runAuthBootstrap/);
  assert.match(authBootstrapChunk, /hasLocalPreviewFlag\(\)/);
  assert.match(authBootstrapChunk, /hasAuthenticatedLocalSession\(\)/);
  assert.match(authBootstrapChunk, /logged_in/);
  assert.match(localPreviewHelper, /meiaoLocalPreview/);
  assert.match(authenticatedSessionHelper, /hasStoredSessionToken\(\)/);
  assert.match(authenticatedSessionHelper, /getCurrentUserContext\(\)/);
});

test('shell authenticated user state drives account-scoped local project snapshots', () => {
  const app = read('../ShellMigratedApp.tsx');
  const appState = read('../utils/appState.ts');
  const authEffect = app.match(/void runAuthBootstrap\(\)[\s\S]*?\n  \}, \[\]\);/)?.[0] || '';
  const loginBody = app.match(/const handleLogin = async \(username: string, password: string\) => \{[\s\S]*?\n  \};/)?.[0] || '';

  assert.match(app, /const shellLocalScopeUserId = currentUser\?\.id \|\| null/);
  assert.match(app, /loadShellRuntimeSnapshot\(shellLocalScopeUserId\)/);
  assert.match(app, /loadPersistedAppState\(shellLocalScopeUserId\)/);
  assert.match(app, /savePersistedAppState\(nextState, shellLocalScopeUserId\)/);
  assert.match(appState, /getPersistedAppStateKey/);
  assert.match(appState, /readBoundedPersistedStateStorage\(getPersistedAppStateKey\(userId\)\)/);
  assert.match(authEffect, /if \(result\.user\) storeCurrentUserContext\(result\.user\);[\s\S]*setAuthStatus\(result\.status\)/);
  assert.match(loginBody, /storeCurrentUserContext\(user\);[\s\S]*setAuthStatus\('logged_in'\)/);
});

test('shell shared-state writes never seed an authenticated account from legacy global localStorage', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /const resolveSharedStateBaseForWrite = useCallback/);
  assert.match(app, /await fetchRemoteAppState\(\)/);
  assert.match(app, /shouldUseLocalStateFallback\(\)/);
  assert.doesNotMatch(app, /const persistedBase = latestSharedStateRef\.current \|\| loadPersistedAppState\(\)/);
});

test('shell startup does not synchronously read the full persisted state just to seed video memory', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /useState<VideoPersistentState \| null>\(null\)/);
  assert.match(app, /persistentState=\{videoMemory \|\| createDefaultVideoState\(\)\}/);
  assert.doesNotMatch(app, /useState<VideoPersistentState>\(\(\) => \{\s*const loaded = loadPersistedAppState\(\);/);
});

test('bottom input bar resets transient popovers when switching modules or one-click submodes', () => {
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');

  assert.match(bottomInputBar, /useEffect\(\(\) => \{/);
  assert.match(bottomInputBar, /setTypeSelectorOpen\(false\)/);
  assert.match(bottomInputBar, /setUploadMenuOpen\(false\)/);
  assert.match(bottomInputBar, /setPopoverOpen\(false\)/);
  assert.match(bottomInputBar, /setSkuNamingOpen\(false\)/);
  assert.match(bottomInputBar, /setSkuCountOpen\(false\)/);
  assert.match(bottomInputBar, /\}, \[module, activeSubFeature, currentParams\.mode\]\)/);
});

test('login screen never prefills default credentials', () => {
  const app = read('../ShellMigratedApp.tsx');
  const loginScreen = read('../shell/components/Internal/LoginScreen.tsx');

  assert.match(app, /probeInternalApi/);
  assert.doesNotMatch(app, /defaultUsername=/);
  assert.doesNotMatch(app, /defaultPassword=/);
  assert.doesNotMatch(loginScreen, /defaultUsername\?: string/);
  assert.doesNotMatch(loginScreen, /defaultPassword\?: string/);
  assert.doesNotMatch(loginScreen, /const \[username, setUsername\] = useState\(''\)/);
  assert.doesNotMatch(loginScreen, /const \[password, setPassword\] = useState\(''\)/);
  assert.match(loginScreen, /const usernameRef = useRef\(''\)/);
  assert.match(loginScreen, /const passwordRef = useRef\(''\)/);
});

test('login screen keeps typing lightweight by avoiding per-keystroke page rerenders', () => {
  const loginScreen = read('../shell/components/Internal/LoginScreen.tsx');
  const styles = read('../index.css');

  assert.doesNotMatch(loginScreen, /value=\{username\}/);
  assert.doesNotMatch(loginScreen, /value=\{password\}/);
  assert.doesNotMatch(loginScreen, /onChange=\{\(e\) => setUsername\(e\.target\.value\)\}/);
  assert.doesNotMatch(loginScreen, /onChange=\{\(e\) => setPassword\(e\.target\.value\)\}/);
  assert.match(loginScreen, /onInput=\{handleUsernameInput\}/);
  assert.match(loginScreen, /onInput=\{handlePasswordInput\}/);
  assert.match(loginScreen, /usernameRef\.current\.trim\(\)/);
  assert.match(loginScreen, /passwordRef\.current/);
  assert.doesNotMatch(styles, /animation:\s+login-glow-drift-[abc]/);
  assert.doesNotMatch(styles, /will-change:\s*transform,\s*opacity/);
});

test('project cards do not let stale generating status lock completed detail projects', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const activeGeneratingBody = projectCard.match(/const isProjectActivelyGenerating = project\.status === 'generating' && \(([\s\S]*?)\n  \);/)?.[1] || '';

  assert.match(projectCard, /const isProjectActivelyGenerating = project\.status === 'generating' && \(/);
  assert.match(activeGeneratingBody, /hasGeneratingResult/);
  assert.match(activeGeneratingBody, /!hasPlans && projectProgressIncomplete/);
  assert.doesNotMatch(activeGeneratingBody, /hasMissingSelectedPlanResult/);
  assert.match(projectCard, /const displayProjectStatus: Project\['status'\] = project\.status === 'generating' && !isProjectActivelyGenerating/);
  assert.match(projectCard, /projectStatus=\{displayProjectStatus\}/);
  assert.doesNotMatch(projectCard, /disabled=\{isConfirmPlanPending \|\| project\.status === 'generating'\}/);
  assert.doesNotMatch(projectCard, /if \(isConfirmPlanPending \|\| project\.status === 'generating'\) return;/);
});

test('project cards keep pending result actions independent while sibling results generate', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const planEditor = read('../shell/components/PlanEditor.tsx');

  assert.doesNotMatch(projectCard, /if \(isConfirmPlanPending \|\| isProjectActivelyGenerating\) return;/);
  assert.doesNotMatch(projectCard, /disabled=\{isConfirmPlanPending \|\| isProjectActivelyGenerating\}/);
  assert.doesNotMatch(projectCard, /const isGeneratingResult = !hasResult && \(isProjectActivelyGenerating \|\| result\.status === 'generating'\)/);
  assert.doesNotMatch(projectCard, /const isGeneratingResult = !hasResult && \(result\.status === 'generating' \|\| isProjectActivelyGenerating\)/);
  assert.match(projectCard, /const getConfirmPlanActionKey = \(planId: string\) => `confirm-plan:\$\{project\.id\}:\$\{planId\}`/);
  assert.match(projectCard, /const isPlanConfirmPending = \(planId: string\) => isPendingAction\(getConfirmPlanActionKey\(planId\)\)/);
  assert.match(projectCard, /const isGeneratingResult = isResultActivelyGenerating\(result\)/);
  assert.match(planEditor, /isConfirmPlanPending\?: \(planId: string\) => boolean/);
  assert.match(planEditor, /const resultIsActivelyGenerating = \(result\?: GeneratedResult \| null\) => Boolean\(result && result\.status === 'generating' && resultHasVisibleTaskId\(result\)\)/);
  assert.match(planEditor, /const activeGeneratingPlanId = projectStatus === 'generating' \? \(activeGeneratingResult\?\.planId \|\| null\) : null/);
  assert.doesNotMatch(planEditor, /activeGeneratingResult\?\.planId \|\| selectedPlanId \|\| pendingSelectedPlanIds\[0\]/);
});

test('generated project cards use short date sequence names instead of prompt text', () => {
  const app = read('../ShellMigratedApp.tsx');

  assert.match(app, /const formatShortProjectNamePrefix = \(date = new Date\(\)\) => \{/);
  assert.match(app, /return `\$\{month\}月\$\{day\}日项目`/);
  assert.match(app, /const reserveShortProjectName = useCallback\(\(\) => \{/);
  assert.match(app, /const projectName = reserveShortProjectName\(\)/);
  assert.doesNotMatch(app, /projectNameSource\.slice\(0, 20\)/);
});

test('browser tab title uses the current cloud filing workspace name', () => {
  const html = read('../../index.html');

  assert.match(html, /<title>杭州梅奥AI工作台<\/title>/);
  assert.doesNotMatch(html, /跨境电商/);
  assert.doesNotMatch(html, /内容创作工作台/);
});

test('large screens scale the login composition and workspace rails instead of looking tiny', () => {
  const loginScreen = read('../shell/components/Internal/LoginScreen.tsx');
  const shellStyles = read('../shell/index.css');
  const appStyles = read('../index.css');

  assert.match(loginScreen, /login-layout/);
  assert.match(loginScreen, /login-title/);
  assert.match(loginScreen, /login-auth-panel/);
  assert.match(appStyles, /@media \(min-width: 1800px\) and \(min-height: 950px\)/);
  assert.match(appStyles, /max-width:\s*1780px/);
  assert.match(appStyles, /font-size:\s*72px/);
  assert.match(appStyles, /max-width:\s*500px/);
  assert.match(shellStyles, /@media \(min-width: 1800px\)/);
  assert.match(shellStyles, /--sidebar-width:\s*64px/);
  assert.match(shellStyles, /max-width:\s*1040px/);
  assert.match(shellStyles, /@media \(min-width: 2200px\)/);
  assert.match(shellStyles, /max-width:\s*1160px/);
});

test('login screen avoids ecommerce-cross-border copy and fake metrics while keeping ambient glows cheap', () => {
  const loginScreen = read('../shell/components/Internal/LoginScreen.tsx');
  const styles = read('../index.css');

  assert.match(loginScreen, /梅奥视觉\s*<\/h1>|梅奥视觉[\s\S]*<br \/>[\s\S]*AI智能工作台/);
  assert.match(loginScreen, /MEIAO AI 工作台/);
  assert.doesNotMatch(loginScreen, /<span>梅奥视觉AI智能工作台<\/span>/);
  assert.match(loginScreen, /AI 驱动的产品视觉创作平台/);
  assert.match(loginScreen, /最强生图模型/);
  assert.match(loginScreen, /Seedance 2\.0/);
  assert.match(loginScreen, /全链路工作流/);
  assert.match(loginScreen, /login-capability-grid/);
  assert.match(styles, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.login-capability-chip/);
  assert.match(styles, /rgba\(255,255,255,0\.055\)/);
  assert.doesNotMatch(loginScreen, /跨境电商/);
  assert.doesNotMatch(loginScreen, /8<\/span>/);
  assert.doesNotMatch(loginScreen, /2<\/span>/);
  assert.match(styles, /\.login-glow-a/);
  assert.match(styles, /scale\(1\.24\)/);
  assert.match(styles, /translate3d\(112px, -62px, 0\)/);
  assert.doesNotMatch(styles, /animation:\s+login-glow-drift-a 24s ease-in-out infinite/);
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

test('shell agent center rebuilds backend powered agent workflows with the shell design system', () => {
  const shellAgentCenter = read('../shell/modules/AgentCenter/AgentCenterModule.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');
  const detail = read('../modules/AgentCenter/AgentDetailView.tsx');

  assert.match(shellApp, /lazy\(\(\) => import\('\.\/shell\/modules\/AgentCenter\/AgentCenterModule'\)\)/);
  assert.doesNotMatch(shellAgentCenter, /export \{ default \} from/);
  assert.doesNotMatch(shellAgentCenter, /工作台总览/);
  assert.match(shellAgentCenter, /fetchChatAgents/);
  assert.match(shellAgentCenter, /fetchChatSessions/);
  assert.match(shellAgentCenter, /sendChatMessage/);
  assert.match(shellAgentCenter, /智能体广场/);
  // 制作入口已收口到独立「智能工厂」模块(SMART_FACTORY),中心不再内嵌制作台
  assert.doesNotMatch(shellAgentCenter, /智能体工厂/);
  assert.doesNotMatch(shellAgentCenter, /AgentCenterManager/);
  assert.match(shellAgentCenter, /制作 \/ 调试请前往「智能工厂」模块/);
  assert.match(shellAgentCenter, /AgentCenterChatWorkspace/);
  assert.match(shellAgentCenter, /var\(--bg-surface\)/);
  assert.match(shellAgentCenter, /moduleCopy/);
  assert.match(manager, /fetchAgentSummaries/);
  assert.match(manager, /page === 'agent_studio'/);
  assert.match(detail, /智能体工作室/);
  assert.match(shellApp, /case AppModuleObj\.AGENT_CENTER:/);
  assert.match(shellApp, /currentUser=\{currentUser\}/);
  assert.match(shellApp, /activeModule !== AppModuleObj\.AGENT_CENTER/);
  assert.match(shellApp, /moduleFromAgentInterface/);
});

test('shell account page rebuilds user logs and usage management with the shell design system', () => {
  const shellAccount = read('../shell/modules/Account/AccountManagement.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.doesNotMatch(shellAccount, /LegacyAccountManagement/);
  assert.doesNotMatch(shellAccount, /UserAdminPanel/);
  assert.doesNotMatch(shellAccount, /UsageStatsPanel/);
  assert.match(shellAccount, /fetchInternalUsers/);
  assert.match(shellAccount, /createInternalUser/);
  assert.match(shellAccount, /fetchInternalLogs/);
  assert.match(shellAccount, /fetchInternalLogMeta/);
  assert.match(shellAccount, /fetchUsageStats/);
  assert.match(shellAccount, /backfillUsageStats/);
  assert.match(shellAccount, /var\(--bg-surface\)/);
  assert.match(shellAccount, /var\(--border-subtle\)/);
  assert.match(shellAccount, /rounded-3xl/);
  assert.match(shellAccount, /tab !== 'users'/);
  assert.match(shellAccount, /tab !== 'logs' && tab !== 'stats'/);
  assert.match(shellAccount, /usersFetchRequestedRef/);
  assert.match(shellAccount, /logMetaFetchRequestedRef/);
  assert.match(shellApp, /case 'account': return <AccountManagement/);
  assert.match(shellApp, /if \(value === AppModuleObj\.ACCOUNT\) return 'account'/);
  assert.match(shellApp, /onCurrentUserChange=\{handleCurrentUserChange\}/);
  assert.doesNotMatch(shellAccount, /暂无真实统计数据/);
  assert.doesNotMatch(shellAccount, /const stats/);
});

test('workspace settings are consumed by the remaining generation modules through shared helpers', () => {
  const helper = read('../utils/workspacePreferenceEffects.ts');
  const buyerShow = read('../modules/BuyerShow/BuyerShowModule.tsx');

  assert.match(helper, /playCompletionSound/);
  assert.match(helper, /primeCompletionSound/);
  assert.match(helper, /getWorkspacePreferences/);
  assert.doesNotMatch(helper, /autoScrollWorkspaceResult/);
  assert.doesNotMatch(helper, /scrollIntoView/);
  assert.doesNotMatch(buyerShow, /autoScrollWorkspaceResult/);
  assert.match(buyerShow, /playWorkspaceCompletionSound/);
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
  assert.match(wizard, /PopoverSelect/);
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
  const shellSettings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const api = read('../services/internalApi.ts');
  const types = read('../types.ts');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const videoStoryboardService = read('../services/videoStoryboardService.ts');

  assert.match(settings, /策划分析模型/);
  assert.match(settings, /视频分析模型/);
  assert.match(settings, /当前生效：/);
  assert.match(settings, /默认 Gemini 3 Flash（High）/);
  assert.match(settings, /自动选择默认分析模型/);
  assert.match(shellSettings, /视频分析模型/);
  assert.match(shellSettings, /videoAnalysisModelOptions/);
  assert.match(shellSettings, /保存视频模型/);
  assert.match(settings, /systemConfig\?\.agentModels\.chat/);
  assert.match(settings, /updateSystemConfig/);
  assert.match(api, /export const updateSystemConfig = async/);
  assert.match(api, /videoAnalysisModel\?: string/);
  assert.match(types, /videoAnalysisModel: string/);
  assert.match(types, /effectiveVideoAnalysisModel: string/);
  assert.match(bottomInputBar, /effectiveVideoAnalysisModel/);
  assert.match(shellApp, /systemConfig\?\.systemSettings\?\.effectiveVideoAnalysisModel/);
  assert.match(videoStoryboardService, /resolveVideoAnalysisModel/);
  assert.match(videoStoryboardService, /model: videoAnalysisModel/);
  assert.match(videoStoryboardService, /reasoningLevel: 'high'/);
  assert.match(videoStoryboardService, /type: 'input_file'/);
  assert.match(videoStoryboardService, /filename: 'viral-reference-video'/);
  assert.match(api, /\/api\/system\/config/);
});

test('shell system settings expose an admin-only dreamina login card and provider status api', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const api = read('../services/internalApi.ts');

  assert.match(settings, /即梦视频服务/);
  assert.match(settings, /仅管理员可配置/);
  assert.match(settings, /fetchDreaminaStatus/);
  assert.match(settings, /startDreaminaLogin/);
  assert.match(settings, /checkDreaminaLogin/);
  assert.match(settings, /logoutDreamina/);
  assert.match(api, /export const fetchDreaminaStatus = async/);
  assert.match(api, /export const startDreaminaLogin = async/);
  assert.match(api, /export const checkDreaminaLogin = async/);
  assert.match(api, /export const logoutDreamina = async/);
  assert.match(api, /\/api\/dreamina\/status/);
  assert.match(api, /\/api\/dreamina\/login/);
  assert.match(api, /\/api\/dreamina\/logout/);
});

test('shell video generation uses one dreamina composer with three real cli modes', () => {
  const bottomInput = read('../shell/components/layout/BottomInputBar.tsx');
  const shellWorkflow = read('../adapters/shellWorkflow.ts');
  const uploadSelector = read('../shell/components/UploadTypeSelector.tsx');

  assert.match(bottomInput, /dreaminaMode/);
  assert.match(bottomInput, /全能参考/);
  assert.match(bottomInput, /首尾帧/);
  assert.match(bottomInput, /智能多帧/);
  assert.match(bottomInput, /frames2video/);
  assert.match(bottomInput, /multiframe2video/);
  assert.match(bottomInput, /multimodal2video/);
  assert.match(bottomInput, /modelVersion/);
  assert.match(bottomInput, /seedance2\.0fast_vip/);
  assert.match(bottomInput, /DREAMINA_DURATION_OPTIONS/);
  assert.doesNotMatch(bottomInput, /key:\s*'videoAccessMode'/);
  assert.match(bottomInput, /Seedance 2\.0 Fast · API/);
  assert.match(bottomInput, /Seedance 2\.0 Fast VIP · CLI/);
  assert.match(shellWorkflow, /taskType:\s*isMaxForAiAccess \? 'maxforai_video' : isApiAccess \? 'kie_seedance_video' : 'dreamina_video'/);
  assert.match(shellWorkflow, /resolution:\s*normalizeSeedanceApiResolution/);
  assert.match(bottomInput, /target === 'audio'\) return 'audio\/\*'/);
  assert.match(uploadSelector, /audio/);
  assert.match(shellWorkflow, /provider:\s*isMaxForAiAccess \? 'maxforai' : isApiAccess \? 'kie' : 'dreamina'/);
  assert.doesNotMatch(shellWorkflow, /createSoraVideoTask/);
});

test('shell workflow keeps real image model and size parameters wired into task payloads', () => {
  const shellWorkflow = read('../adapters/shellWorkflow.ts');
  const kieAiService = read('../services/kieAiService.ts');
  const bottomInput = read('../shell/components/layout/BottomInputBar.tsx');

  assert.match(shellWorkflow, /normalized\.includes\('nano'\) \|\| normalized\.includes\('banana'\)/);
  assert.match(shellWorkflow, /resolutionMode = toResolutionMode/);
  assert.match(shellWorkflow, /hasShellSizeControls\(input\) \? 'custom' : 'original'/);
  assert.match(shellWorkflow, /maybeResizeAndPersistImageResult/);
  assert.match(shellWorkflow, /resizeImage\(blob, width, height, config\.maxFileSize\)/);
  assert.match(shellWorkflow, /targetWidth = toPositiveInt/);
  assert.match(shellWorkflow, /targetHeight = toNonNegativeInt/);
  assert.match(shellWorkflow, /maxFileSize = toPositiveFloat/);
  assert.match(shellWorkflow, /model: toModel\(firstParam\(input\.params, \['model'\], 'GPT Image 2'\)\)/);
  assert.match(shellWorkflow, /resolutionMode,/);
  assert.match(shellWorkflow, /targetWidth: resolutionMode === 'custom' \? targetWidth : 0/);
  assert.match(shellWorkflow, /targetHeight: resolutionMode === 'custom' \? targetHeight : 0/);
  assert.match(shellWorkflow, /maxFileSize,/);
  assert.match(kieAiService, /resolutionMode: moduleConfig\.resolutionMode/);
  assert.match(kieAiService, /targetWidth: moduleConfig\.targetWidth \|\| 0/);
  assert.match(kieAiService, /targetHeight: moduleConfig\.targetHeight \|\| 0/);
  assert.match(kieAiService, /maxFileSize: moduleConfig\.maxFileSize \|\| 2/);
  assert.match(bottomInput, /defaultValue: '固定宽度'/);
  assert.match(bottomInput, /defaultValue: '自定义'/);
});

test('shell workflow preserves zero target height for fixed-width proportional resizing', () => {
  const shellWorkflow = read('../adapters/shellWorkflow.ts');

  assert.match(shellWorkflow, /const targetHeight = toNonNegativeInt\(/);
  assert.match(shellWorkflow, /targetHeight: resolutionMode === 'custom' \? targetHeight : 0/);
  assert.match(shellWorkflow, /if \(width > 0 && height === 0\)/);
});

test('shell batch counts come from actual SKU and buyer-show params instead of a fixed floor', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const arkService = read('../services/arkService.ts');

  assert.match(shellApp, /resolveShellSkuCount\(params\)/);
  assert.match(shellApp, /return \{ \.\.\.oneClickParams, count: String\(resolveShellSkuCount\(params\)\) \}/);
  assert.match(shellApp, /subFeature === 'sku'/);
  assert.match(shellApp, /subFeature === 'main_image'/);
  assert.match(shellApp, /subFeature === 'detail_page'/);
  assert.match(shellApp, /parsePositiveInt\(params\.count, 4, 20\)/);
  assert.match(shellApp, /parsePositiveInt\(params\.setCount, 1, 4\)/);
  assert.match(shellApp, /Math\.min\(20, perSetCount \* setCount\)/);
  assert.doesNotMatch(shellApp, /Math\.max\(4, \.\.\.skuIndexes/);
  assert.match(arkService, /移动端优先智能填写具体比例，优先使用竖图3:4或9:16/);
  assert.match(arkService, /Auto比例下优先规划 3:4 或 9:16 竖图/);
  assert.match(arkService, /禁止整套大量横图/);
});

test('shell settings stop exposing a public KIE api key input and only keep internal托管 hints', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const api = read('../services/internalApi.ts');
  const types = read('../types.ts');

  assert.doesNotMatch(settings, /KIE AI API Key/);
  assert.doesNotMatch(settings, /setApiKey/);
  assert.match(settings, /内部服务托管/);
  assert.match(settings, /KIE 密钥由服务端统一接管/);
  assert.match(settings, /真实模型调用和密钥管理都走内部后端/);
  assert.match(settings, /OpenAI Compatible 中转站/);
  assert.match(settings, /setOpenaiCompatibleApiKey/);
  assert.match(settings, /setOpenaiCompatibleBaseUrl/);
  assert.match(settings, /setOpenaiCompatibleModels/);
  assert.match(settings, /openaiCompatible: \{/);
  assert.match(api, /openaiCompatible\?: \{/);
  assert.match(types, /openaiCompatible: \{/);
});

test('agent creation wires openai compatible tool calling defaults into the first version', () => {
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');
  const types = read('../types.ts');

  assert.match(manager, /const usesOpenAICompatibleToolCalling = defaultAllowedChatModels\.some/);
  assert.match(manager, /toolCallingProvider: usesOpenAICompatibleToolCalling \? 'openai_compatible' : ''/);
  assert.match(manager, /imageGenerationEnabled: usesOpenAICompatibleToolCalling \|\| Boolean\(wizardForm\.enableImageGeneration\)/);
  assert.match(manager, /allowedChatModels,/);
  assert.match(manager, /defaultChatModel,/);
  assert.match(types, /provider: 'kie' \| 'openai_compatible'/);
});

test('agent wizard explains chat model channels and provider impact', () => {
  const wizard = read('../modules/AgentCenter/AgentWizardView.tsx');
  const allowlist = read('../modules/AgentCenter/chatModelAllowlist.ts');

  assert.match(wizard, /chatModelChannelFilter/);
  assert.match(wizard, /filterChatModelsByChannel/);
  assert.match(wizard, /getChatModelChannelMeta/);
  assert.match(wizard, /channelMeta\.label/);
  assert.doesNotMatch(wizard, /\{channelMeta\.impact\}/);
  assert.match(allowlist, /label: '中转站'/);
  assert.match(allowlist, /label: 'KIE 托管'/);
  assert.match(allowlist, /tool calling/);
  assert.match(allowlist, /生图工具/);
  assert.match(allowlist, /普通聊天/);
  assert.match(allowlist, /后备/);
});

test('agent creation persists wizard avatar and runtime strategy settings', () => {
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');
  const avatar = read('../modules/AgentCenter/AgentAvatar.tsx');
  const avatarOptions = read('../modules/AgentCenter/agentAvatarOptions.ts');
  const shellAgentCenter = read('../shell/modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(manager, /allowedChatModels,\s*\n\s*defaultChatModel,/);
  assert.match(manager, /const modelPolicy = \{\s*\n\s*cheapModel,/);
  assert.match(manager, /defaultModel: defaultChatModel,/);
  assert.match(manager, /multimodalModel: imageModel,/);
  assert.match(manager, /imageGenerationEnabled: usesOpenAICompatibleToolCalling \|\| Boolean\(wizardForm\.enableImageGeneration\),/);
  assert.match(manager, /modelPolicy,/);
  assert.match(manager, /retrievalPolicy: \{[^}]*topK: wizardForm\.topK[^}]*\},/);
  assert.match(avatar, /preset\.gradient/);
  assert.match(avatar, /preset\.foreground/);
  assert.match(avatarOptions, /mark: /);
  assert.match(avatarOptions, /gradient: /);
  assert.doesNotMatch(avatarOptions, /gradientClassName/);
  assert.doesNotMatch(shellAgentCenter, /\[class\*="bg-gradient-to-br"\]/);
  assert.doesNotMatch(avatar, /background: 'var\(--bg-elevated\)'/);
});

test('agent chat client keeps image generation requests alive longer and can sync completed results after timeout', () => {
  const api = read('../services/internalApi.ts');
  const agentCenter = read('../modules/AgentCenter/AgentCenterModule.tsx');

  assert.match(api, /const CHAT_MESSAGE_TIMEOUT_MS = 240_000/);
  assert.match(api, /const IMAGE_GENERATION_CHAT_TIMEOUT_MS = 900_000/);
  assert.match(api, /payload\.requestMode === 'image_generation'\s*\n\s*\? IMAGE_GENERATION_CHAT_TIMEOUT_MS\s*\n\s*: CHAT_MESSAGE_TIMEOUT_MS/);
  assert.match(agentCenter, /clientRequestId/);
  assert.match(agentCenter, /syncCompletedMessageAfterTimeout/);
  assert.match(agentCenter, /const deadline = Date\.now\(\) \+ 210_000/);
  assert.match(agentCenter, /metadata\?\.clientRequestId/);
  assert.match(agentCenter, /fallbackAssistantMessage/);
  assert.match(agentCenter, /isPendingAgentRunMessage/);
  assert.match(agentCenter, /后台仍在处理中，正在同步最新结果/);
});

test('account logs surface direct readable failure tags for agent and provider issues', () => {
  const account = read('../modules/Account/AccountManagement.tsx');
  const utils = read('../shell/modules/Account/accountManagementUtils.mjs');

  assert.match(account, /deriveLogFailureReason/);
  assert.match(account, /failureReason/);
  assert.match(utils, /return '分析失败'/);
  assert.match(utils, /return '创建任务失败'/);
  assert.match(utils, /return '轮询超时'/);
  assert.match(utils, /return '上游服务异常'/);
});

test('account management keeps logs read-only and paginates searchable account lists', () => {
  const shellAccount = read('../shell/modules/Account/AccountManagement.tsx');
  const legacyAccount = read('../modules/Account/AccountManagement.tsx');
  const userAdminPanel = read('../components/Internal/UserAdminPanel.tsx');

  assert.match(shellAccount, /const \[userSearch, setUserSearch\]/);
  assert.match(shellAccount, /const pagedUsers = filteredUsers\.slice/);
  assert.match(shellAccount, /日志保留最近 7 天，不提供手动清理/);
  assert.doesNotMatch(shellAccount, /deleteInternalLogs/);
  assert.doesNotMatch(shellAccount, /Eraser/);
  assert.match(shellAccount, /deleteInternalUser/);
  assert.match(shellAccount, /Trash2/);
  assert.match(shellAccount, /用量统计会保留/);
  assert.match(shellAccount, /isMissingAccountError/);
  assert.match(shellAccount, /已从当前页面移除/);
  assert.match(legacyAccount, /保留最近 7 天/);
  assert.doesNotMatch(legacyAccount, /deleteInternalLogs/);
  assert.match(userAdminPanel, /const \[userSearch, setUserSearch\]/);
  assert.match(userAdminPanel, /const pagedUsers = filteredUsers\.slice/);
  assert.match(userAdminPanel, /deleteInternalUser/);
  assert.match(userAdminPanel, /删除账号/);
  assert.match(userAdminPanel, /用量统计会保留/);
  assert.match(userAdminPanel, /isMissingAccountError/);
});

test('shell frontend failures are written to internal account logs', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const logging = read('../services/loggingService.ts');

  assert.match(shellApp, /safeCreateInternalLog/);
  assert.match(shellApp, /const logShellError = useCallback/);
  assert.match(shellApp, /window\.addEventListener\('error'/);
  assert.match(shellApp, /window\.addEventListener\('unhandledrejection'/);
  assert.match(shellApp, /translation_generation_failed/);
  assert.match(shellApp, /one_click_planning_failed/);
  assert.match(shellApp, /shell_generation_failed/);
  assert.match(shellApp, /one_click_image_generation_failed/);
  assert.match(shellApp, /storyboard_board_generation_failed/);
  assert.match(logging, /frontend_runtime_error/);
  assert.match(logging, /frontend_unhandled_rejection/);
  assert.match(logging, /frontend_startup_diagnostics/);
  assert.match(logging, /frontend_previous_session_interrupted/);
});

test('one-click planning cards are persisted before long-running backend planning finishes', () => {
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(shellApp, /void persistProjectToSharedState\(planningProject\);/);
  assert.match(shellApp, /const persistedPlanningProject = \{/);
  assert.match(shellApp, /backendJobId: jobId/);
  assert.match(shellApp, /void persistProjectToSharedState\(persistedPlanningProject\);/);
});

test('shell job hydration persists repaired one-click planning snapshots', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const persistUtil = read('../utils/syncedProjectPersistence.ts');

  assert.match(shellApp, /shouldPersistSyncedProjectFromJobs/);
  assert.match(persistUtil, /hasStaleOneClickPlanningPlaceholder/);
  assert.match(persistUtil, /getOneClickPlanningFingerprint/);
  assert.match(persistUtil, /hasPlanningSnapshotChanged/);
});

test('agent chat image replies put final results in the result layer and references in the run trace', () => {
  const chatPane = read('../modules/AgentCenter/ChatConversationPane.tsx');

  assert.match(chatPane, /const showImageSummary = !isPending && Boolean\(summaryContent\);/);
  assert.match(chatPane, /<MarkdownMessage content=\{summaryContent\} \/>/);
  assert.match(chatPane, /agent-image-result-primary/);
  assert.match(chatPane, /agent-image-result-thumbnails/);
  assert.match(chatPane, /思考过程/);
  assert.match(chatPane, /知识库检索/);
  assert.match(chatPane, /模型规划/);
  assert.doesNotMatch(chatPane, /expandedReferenceRules/);
  assert.doesNotMatch(chatPane, /expandedSummaries/);
  assert.doesNotMatch(chatPane, /展开结果总结/);
  assert.doesNotMatch(chatPane, /<span>结果总结<\/span>/);
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

test('confirm dialogs use a compact two-row layout with balanced danger actions', () => {
  const shellConfirmDialog = read('../shell/components/ConfirmDialog.tsx');
  const sharedConfirmDialog = read('./ConfirmDialog.tsx');

  assert.match(shellConfirmDialog, /max-w-\[420px\]/);
  assert.match(shellConfirmDialog, /items-start gap-4 border-b/);
  assert.match(shellConfirmDialog, /justify-end gap-2\.5 pt-5/);
  assert.match(shellConfirmDialog, /min-h-11 min-w-\[88px\]/);

  assert.match(sharedConfirmDialog, /max-w-\[420px\]/);
  assert.match(sharedConfirmDialog, /items-start gap-4 border-b/);
  assert.match(sharedConfirmDialog, /justify-end gap-2\.5 pt-5/);
  assert.match(sharedConfirmDialog, /min-h-11 min-w-\[88px\]/);
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
  assert.match(trainingPane, /import ChatComposer, \{ ComposerAttachment, BatchSendTask \} from '.\/ChatComposer';/);
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
  assert.match(composer, /agent-composer-upload-menu/);
  assert.match(composer, /agent-composer-config-menu/);
  assert.match(composer, /const uploadStatusLabel = attachments\.length > 0 \? `上传 · \$\{attachments\.length\}` : '上传';/);
  assert.match(composer, /const configStatusLabel = `配置 · \$\{selectedModelLabel\}`;/);
  assert.doesNotMatch(composer, /reasoningPopoverOpen/);
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
  assert.match(composer, /runSubmissionMode/);
  assert.match(composer, /插入引导/);
  assert.match(composer, /加入下一轮/);
  assert.match(composer, /发送/);
});

test('chat conversation pane uses compact header tags and refined message layout', () => {
  const conversationPane = read('../modules/AgentCenter/ChatConversationPane.tsx');
  const composer = read('../modules/AgentCenter/ChatComposer.tsx');
  const agentCenterModule = read('../modules/AgentCenter/AgentCenterModule.tsx');
  assert.match(conversationPane, /AgentAvatar/);
  assert.match(conversationPane, /UserAvatar/);
  assert.match(conversationPane, /rounded-\[30px\]/);
  assert.match(conversationPane, /max-w-\[78%\]/);
  assert.match(conversationPane, /当前会话/);
  assert.match(conversationPane, /附件\s+\{attachments\.length\}\s+个/);
  assert.match(conversationPane, /currentUser\?\.username/);
  assert.match(conversationPane, /avatarPreset=\{currentUser\?\.avatarPreset/);
  assert.match(conversationPane, /style=\{\{ color: 'var\(--text-secondary\)' \}\}/);
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
  assert.match(conversationPane, /const showImageSummary = !isPending && Boolean\(summaryContent\);/);
  assert.match(conversationPane, /<MarkdownMessage content=\{summaryContent\} \/>/);
  assert.match(conversationPane, /agent-image-result-primary/);
  assert.match(conversationPane, /agent-image-result-thumbnails/);
  assert.match(conversationPane, /agent-image-result-actions/);
  assert.match(conversationPane, /agent-image-result-edit/);
  assert.match(conversationPane, /aria-label="编辑图片"/);
  assert.doesNotMatch(conversationPane, /expandedSummaries/);
  assert.doesNotMatch(conversationPane, /toggleSummary/);
  assert.doesNotMatch(conversationPane, /展开结果总结/);
  assert.doesNotMatch(conversationPane, /absolute right-3 top-3/);
  assert.match(conversationPane, /正在整理生图参数与提示词/);
  assert.match(conversationPane, /正在理解需求与参考图/);
  assert.match(conversationPane, /正在生成图片/);
  assert.match(conversationPane, /思考过程/);
  assert.match(conversationPane, /知识库检索/);
  assert.match(conversationPane, /模型规划/);
  assert.match(conversationPane, /retrievalSummary/);
  assert.match(conversationPane, /rounded-\[22px\] border border-slate-200\/80 bg-slate-50\/80 p-2/);
  assert.match(conversationPane, /fixed inset-0 z-40 px-4 py-5 sm:px-6 sm:py-6/);
  assert.match(conversationPane, /backgroundColor: 'var\(--bg-surface\)'/);
  assert.match(conversationPane, /backgroundColor: 'var\(--bg-base\)'/);
  assert.match(conversationPane, /borderColor: 'var\(--border-subtle\)'/);
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
  assert.match(composer, /agent-composer-config-menu/);
  assert.match(composer, /PopoverTrigger/);
  assert.match(composer, /rounded-full border transition/);
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
  const workspace = read('../modules/AgentCenter/AgentCenterChatWorkspace.tsx');

  assert.match(module, /deleteChatSession/);
  assert.match(module, /sendingMessage/);
  assert.match(module, /sendAbortControllerRef/);
  assert.match(module, /pendingRestoreRef/);
  assert.match(module, /pendingAssistantMessageId/);
  assert.match(module, /AbortController/);
  assert.match(module, /runSubmissionMode/);
  assert.match(module, /pendingAutoSubmission/);
  assert.match(module, /queueChatSubmission/);
  assert.match(module, /正在按新输入重新回复/);
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
  assert.match(module, /setActiveSessionId\(''\);/);
  assert.match(module, /onAgentCatalogChanged=\{\(\) => \{\s*void refreshChatCatalog\(\);\s*\}\}/);
  assert.match(module, /void syncSessionOptions\(\{ lastImageMode: next \}\);/);
  assert.match(module, /需求分析中/);
  assert.match(module, /生图参数整理中/);
  assert.match(module, /图像生成中/);
  assert.match(module, /结果整理中/);
  assert.match(module, /组织回复中/);
  assert.match(module, /progressStage/);
  assert.match(workspace, /hideSessionHeader=\{true\}/);
  assert.match(workspace, /focusedSessionTitle/);
  assert.match(workspace, /本次会话图库/);
  assert.match(workspace, /附件 \{attachments\.length\} 个/);
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
  const app = read('../ShellMigratedApp.tsx');
  const account = read('../modules/Account/AccountManagement.tsx');
  const profile = read('../modules/Account/ProfileSettingsCard.tsx');
  const usage = read('../modules/Account/UsageStatsPanel.tsx');
  const accountShell = read('../shell/modules/Account/AccountManagement.tsx');
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
  assert.match(app, /\.\/shell\/modules\/Account\/AccountManagement/);
  assert.match(accountShell, /workspace-shell/);
  assert.match(accountShell, /workspace-content/);
  assert.match(userAvatar, /findAgentAvatarPreset/);
  assert.match(userAvatar, /avatarPreset/);
});

test('migrated shell keeps a collapsible sidebar with landing entry and theme toggle', () => {
  const sidebar = read('../shell/components/layout/SidebarNavigation.tsx');
  const app = read('../ShellMigratedApp.tsx');

  assert.match(sidebar, /onModuleChange: \(m: AppModule \| 'landing'\) => void/);
  assert.match(sidebar, /title="首页"/);
  assert.match(sidebar, /Hexagon/);
  assert.match(sidebar, /onToggleTheme/);
  assert.match(sidebar, /theme === 'dark' \? <Sun size=\{18\} \/> : <Moon size=\{18\} \/>/);
  assert.match(sidebar, /collapsed \? 'var\(--sidebar-width\)' : 160/);
  assert.match(sidebar, /after:bg-\[image:var\(--sidebar-divider\)\]/);
  assert.match(sidebar, /--sidebar-divider/);
  assert.match(sidebar, /!collapsed && <span className="min-w-0 truncate text-\[13px\] font-semibold">\{item\.label\}<\/span>/);
  assert.match(sidebar, /collapsed && \(/);
  assert.match(sidebar, /aria-expanded=\{!collapsed\}/);
  assert.match(app, /sidebarCollapsed: boolean/);
  assert.match(app, /sidebarCollapsed: typeof saved\.sidebarCollapsed === 'boolean' \? saved\.sidebarCollapsed : undefined/);
  assert.match(app, /const \[sidebarCollapsed, setSidebarCollapsed\] = useState<boolean>/);
  assert.match(app, /sidebarCollapsed,\s*\n\s*\}, shellLocalScopeUserId\)/);
  assert.match(app, /collapsed=\{sidebarCollapsed\}/);
  assert.match(app, /onToggleCollapsed=\{\(\) => setSidebarCollapsed\(\(prev\) => !prev\)\}/);
});

test('migrated shell exposes logout from the account management header', () => {
  const app = read('../ShellMigratedApp.tsx');
  const sidebar = read('../shell/components/layout/SidebarNavigation.tsx');
  const account = read('../shell/modules/Account/AccountManagement.tsx');

  assert.match(app, /logoutInternalUser/);
  assert.match(app, /const handleLogout = async \(\) =>/);
  assert.match(app, /onLogout=\{onLogout\}/);
  assert.match(app, /onLogout=\{handleLogout\}/);
  assert.doesNotMatch(sidebar, /LogOut/);
  assert.doesNotMatch(sidebar, /title="退出登录"/);
  assert.match(account, /LogOut/);
  assert.match(account, /onLogout\?: \(\) => void/);
  assert.match(account, /title="退出登录"/);
  assert.match(account, />退出登录</);
});

test('landing page brands the hero as Meiao ecommerce AI content workspace', () => {
  const landing = read('../shell/components/LandingPage.tsx');

  assert.match(landing, /梅奥电商/);
  assert.doesNotMatch(landing, /跨境电商/);
});

test('landing page uses credible capability highlights instead of obvious fake metrics', () => {
  const landing = read('../shell/components/LandingPage.tsx');

  assert.match(landing, /最强生图模型/);
  assert.match(landing, /Seedance 2\.0/);
  assert.match(landing, /10x/);
  assert.match(landing, /全链路工作流/);
  assert.doesNotMatch(landing, /50\+/);
  assert.doesNotMatch(landing, /99%/);
  assert.doesNotMatch(landing, /12['"]?, label: ['"]风格预设/);
});

test('compact shell removes leftover top placeholder height and keeps the sidebar user hub centered and unclipped', () => {
  const sidebar = read('../shell/components/layout/SidebarNavigation.tsx');
  const manager = read('../modules/AgentCenter/AgentCenterManager.tsx');

  assert.match(sidebar, /h-full flex flex-col shrink-0 py-3 gap-1 px-2/);
  assert.match(sidebar, /title="首页"/);
  assert.match(sidebar, /h-\[44px\] w-full items-center rounded-2xl/);
  assert.match(sidebar, /collapsed \? 'justify-center px-0' : 'justify-start gap-3 px-3'/);
  assert.match(sidebar, /flex h-6 w-6 shrink-0 items-center justify-center/);
  assert.match(sidebar, /absolute right-\[-16px\] top-\[72px\] z-20 flex h-8 w-4/);
  assert.match(sidebar, /borderTopRightRadius: 6/);
  assert.match(sidebar, /borderBottomRightRadius: 6/);
  assert.match(sidebar, /collapsed \? 'justify-center' : 'justify-start'/);
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
  const app = read('../ShellMigratedApp.tsx');

  assert.doesNotMatch(app, /select-none/);
  assert.doesNotMatch(app, /<main className="relative flex-1 overflow-hidden h-full">/);
  assert.match(app, /<main className="flex-1 overflow-y-auto min-h-0">/);
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

test('shell project detail uses responsive side-by-side image comparison and stack preview', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(projectCard, /max-w-\[1040px\]/);
  assert.match(projectCard, /sticky top-0 z-10 mb-3 border-b px-4 py-3 sm:px-5/);
  assert.doesNotMatch(projectCard, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.doesNotMatch(projectCard, /lg:grid-cols-\[112px_minmax\(0,1fr\)_300px\]/);
  assert.match(projectCard, /多图对照/);
  assert.match(projectCard, /lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3/);
  assert.match(projectCard, /handleDownloadSingle\(result, index\)/);
  assert.match(projectCard, /handleCopyPrompt\(textReportText\)/);
  assert.doesNotMatch(projectCard, /查看信息/);
  assert.match(projectCard, /上下拼合预览/);
  assert.match(projectCard, /长页审阅/);
  assert.match(projectCard, /project\.subFeature === 'detail_page'/);
  assert.match(projectCard, /detailViewMode/);
  assert.match(projectCard, /previewableResults/);
  assert.match(projectCard, /生图 Prompt/);
  assert.match(projectCard, /视频 Prompt/);
  assert.match(projectCard, /hasPlayableVideoResult/);
  assert.match(projectCard, /detailOverlayStyle = hasPlayableVideoResult/);
  assert.match(projectCard, /boxShadow: hasPlayableVideoResult \? '0 18px 44px rgba\(15,23,42,0\.16\)' : 'var\(--shadow-elevated\)'/);
  assert.match(projectCard, /detailHeaderStyle = hasPlayableVideoResult/);
  assert.match(projectCard, /CardVideoPreview/);
  assert.match(projectCard, /data-meiao-card-video="true"/);
  assert.match(projectCard, /shouldLoadVideoPreview/);
  assert.match(projectCard, /VIDEO_PLAYBACK_PRELOAD = 'auto'/);
  assert.match(projectCard, /VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS/);
  assert.match(projectCard, /VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS/);
  assert.match(projectCard, /VIDEO_PLAYBACK_MIN_BUFFER_SECONDS = readPositiveNumberEnv\('VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS', 3\)/);
  assert.match(projectCard, /shouldWarmVideoPlayback/);
  assert.match(projectCard, /waitForPlayableVideo/);
  assert.match(projectCard, /waitForBufferedVideo/);
  assert.match(projectCard, /startVideoPlayback/);
  assert.match(projectCard, /preload=\{shouldLoadVideoPreview \? \(shouldWarmVideoPlayback \? VIDEO_PLAYBACK_PRELOAD : preload\) : 'none'\}/);
  assert.match(projectCard, /onPointerEnter=\{\(\) => \(controls \? armVideoPlaybackLoad\(\) : armVideoPreviewLoad\(\)\)\}/);
  assert.match(projectCard, /onFocusCapture=\{\(\) => \(controls \? armVideoPlaybackLoad\(\) : armVideoPreviewLoad\(\)\)\}/);
  assert.match(projectCard, /onPointerDown=\{controls \? \(\) => armVideoPlaybackLoad\(\) : undefined\}/);
  assert.match(projectCard, /controlsList="nofullscreen nodownload noremoteplayback"/);
  assert.match(projectCard, /disablePictureInPicture/);
  assert.match(projectCard, /meiao-video-no-fullscreen/);
  assert.match(projectCard, /querySelectorAll<HTMLVideoElement>\('video'\)/);
  assert.match(projectCard, /VIDEO_PREVIEW_PRELOAD = 'metadata'/);
  assert.match(projectCard, /VIDEO_PREVIEW_FRAME_TIME_SECONDS = 0\.5/);
  assert.match(projectCard, /onLoadedMetadata=\{handleLoadedMetadata\}/);
  assert.match(projectCard, /event\.currentTarget\.currentTime = previewFrameTime/);
  assert.match(projectCard, /showPlayOverlay/);
  assert.match(projectCard, /showVideoIndicator/);
  assert.match(projectCard, /aria-label=\{isPreparingPlayback \? '正在准备播放' : '播放视频'\}/);
  assert.match(projectCard, /aria-hidden="true"/);
  assert.match(projectCard, /pointer-events-none/);
  assert.match(projectCard, /video\.play\(\)/);
  assert.match(projectCard, /isPreviewVideoResult \? '' : 'transition-transform duration-300 group-hover:scale-\[1\.03\]'/);
  assert.match(projectCard, /renderMedia\(previewResult,[\s\S]*videoPreload: VIDEO_PREVIEW_PRELOAD/);
  assert.match(projectCard, /videoShowIndicator: true/);
  assert.match(projectCard, /videoControls: true, videoPreload: VIDEO_PREVIEW_PRELOAD, videoPreviewFrameTime: VIDEO_PREVIEW_FRAME_TIME_SECONDS, videoShowPlayOverlay: true/);
  assert.match(projectCard, /items=\{lightboxItems\}/);
  assert.match(projectCard, /预览/);
  const imageLightbox = read('../shell/components/ImageLightbox.tsx');
  const lightboxVideoElement = imageLightbox.match(/<video[\s\S]*?\/>/)?.[0] || '';
  assert.match(imageLightbox, /type\?: 'image' \| 'video'/);
  assert.match(imageLightbox, /lightboxOverlayStyle = isVideo/);
  assert.match(imageLightbox, /background: 'rgba\(0,0,0,0\.92\)'/);
  assert.match(imageLightbox, /backdropFilter: 'blur\(8px\)'/);
  assert.match(imageLightbox, /data-meiao-lightbox-video="true"/);
  assert.match(imageLightbox, /<video[\s\S]*preload="auto"/);
  assert.match(imageLightbox, /<source src=\{currentItem\.url\} type=\{getVideoMimeType\(currentItem\)\}/);
  assert.doesNotMatch(imageLightbox, /autoPlay/);
  assert.doesNotMatch(lightboxVideoElement, /boxShadow/);
  assert.doesNotMatch(lightboxVideoElement, /rounded-\[18px\]/);
  assert.match(imageLightbox, /querySelectorAll<HTMLVideoElement>\('video'\)/);
  assert.match(imageLightbox, /controlsList="nofullscreen nodownload noremoteplayback"/);
  assert.match(imageLightbox, /meiao-video-no-fullscreen/);
  const shellCss = read('../shell/index.css');
  assert.match(shellCss, /meiao-video-no-fullscreen::-webkit-media-controls-fullscreen-button/);
  assert.doesNotMatch(projectCard, /isVideoGenerationProject \? 'grid gap-4'/);
  assert.doesNotMatch(projectCard, /min-h-\[430px\]/);
  assert.match(projectCard, /h-\[300px\]/);
  assert.match(projectCard, /sm:h-\[340px\]/);
  assert.match(projectCard, /isLongDetailProject/);
  assert.match(projectCard, /长页审阅/);
  assert.match(projectCard, /单屏对照/);
  assert.match(projectCard, /handleCopyPrompt\(textReportText\)/);
});

test('stored asset route supports byte range streaming for video playback', () => {
  const serverIndex = read('../../server/index.mjs');

  assert.match(serverIndex, /req\.headers\.range/);
  assert.match(serverIndex, /'Accept-Ranges': 'bytes'/);
  assert.match(serverIndex, /'ETag': assetCacheTag/);
  assert.match(serverIndex, /'Last-Modified': assetLastModified/);
  assert.match(serverIndex, /'X-Accel-Buffering': 'no'/);
  assert.match(serverIndex, /MEIAO_ASSET_X_ACCEL/);
  assert.match(serverIndex, /buildStoredAssetXAccelRedirectPath\(asset\.storageKey\)/);
  assert.match(serverIndex, /'X-Accel-Redirect': xAccelRedirectPath/);
  assert.match(serverIndex, /isConditionalAssetCacheHit\(req, assetCacheTag, assetLastModified\)/);
  assert.match(serverIndex, /req\.method === 'GET' \|\| req\.method === 'HEAD'\) && assetRouteMatch/);
  assert.match(serverIndex, /ASSET_ACCESS_TOUCH_THROTTLE_MS/);
  assert.match(serverIndex, /scheduleStoredAssetAccessTouch\(pool, asset\.id, Date\.now\(\)\)/);
  assert.match(serverIndex, /void markStoredAssetAccessed\(pool, assetId, touchedAt\)/);
  assert.doesNotMatch(serverIndex, /await markStoredAssetAccessed\(pool, asset\.id, Date\.now\(\)\)/);
  assert.match(serverIndex, /writeHead\(206/);
  assert.match(serverIndex, /'Content-Range': `bytes \$\{start\}-\$\{end\}\/\$\{fileSize\}`/);
  assert.match(serverIndex, /createReadStream\(fullPath, \{ start, end \}\)/);
  assert.match(serverIndex, /writeHead\(416/);
});

test('shell first-image fission can use the generated result as the variant base without requiring the original reference', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const promptUtils = read('../modules/OneClick/generationPromptUtils.ts');
  const oneClickMaterials = read('../adapters/shellOneClickMaterials.mjs');

  assert.match(shellApp, /handleFissionResult/);
  assert.doesNotMatch(shellApp, /当前结果缺少主图参考/);
  assert.doesNotMatch(shellApp, /当前结果缺少可用于模型读取的主图参考地址/);
  assert.match(shellApp, /sourceReferenceUrl: undefined/);
  assert.match(shellApp, /sourceResultUrl: resolvePublicAssetUrl\(result\.imageUrl, publicBaseUrl\) \|\| ''/);
  assert.match(shellApp, /schemeContent: fissionInstruction \|\| `按\$\{variantLabel\}方向继续裂变这张生成图。`/);
  assert.match(shellApp, /buildVariantMaterials\(baseMaterials, variantPlan, 'first_image'\)/);
  assert.match(shellApp, /buildOneClickPlanGenerationMaterials/);
  assert.match(oneClickMaterials, /const cloneMaterials = \(materials = \{\}\) => Object\.fromEntries/);
  assert.match(oneClickMaterials, /\.\.\.\(next\.reference \|\| \[\]\)/);
  assert.doesNotMatch(shellApp, /const variantBaseMaterials = hasMaterialInputs\(projectMaterials\) \? projectMaterials : filteredMaterials/);
  assert.doesNotMatch(shellApp, /schemeContent: matchedPlan\.schemeContent \|\| result\.prompt/);
  assert.match(promptUtils, /上一张生成结果图是继续裂变的直接基础/);
  assert.match(promptUtils, /没有原始主图参考时，以上一张生成结果图作为唯一裂变参考/);
  assert.match(promptUtils, /const isResultOnlyVariation = Boolean\(previousResultUrl && !replicationReferenceUrl\)/);
  assert.match(promptUtils, /不重新引入原始生图提示词、产品素材或参考素材/);
});

test('shell project cards never auto-open planning detail dialogs during hydration', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.doesNotMatch(projectCard, /autoOpenPlanRef/);
  assert.doesNotMatch(projectCard, /project\.status !== 'planning'[\s\S]*setDetailOpen\(true\)/);
});

test('shell project card renders buyer show copy as text instead of image gallery', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(projectCard, /isCopyTextReport/);
  assert.match(projectCard, /isTextReport/);
  assert.match(projectCard, /纯文案结果/);
  assert.match(projectCard, /复制文案/);
  assert.match(projectCard, /!\s*isTextReport && \(/);
});

test('shell buyer show and image upgrade expose the approved runnable subfeatures', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const subFeatureTabs = read('../shell/components/SubFeatureTabs.tsx');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const retouchSubFeatures = shellApp.match(/\[AppModuleObj\.RETOUCH\]: \[[\s\S]*?\n  \],/)?.[0] || '';
  const retouchQuickParams = bottomInputBar.match(/\[AppModuleObj\.RETOUCH\]: \[[\s\S]*?\n  \],/)?.[0] || '';

  assert.match(shellApp, /\{ id: 'copy', label: '纯文案', description: '待制作', disabled: true \}/);
  assert.doesNotMatch(retouchSubFeatures, /background_replace/);
  assert.doesNotMatch(retouchQuickParams, /背景替换/);
  assert.match(retouchSubFeatures, /\{ id: 'original', label: '原图精修' \}/);
  assert.match(retouchSubFeatures, /\{ id: 'white_bg', label: '白底精修' \}/);
  assert.match(retouchSubFeatures, /\{ id: 'product_restore', label: '产品还原' \}/);
  assert.match(retouchSubFeatures, /\{ id: 'enhance', label: '智能增强', description: '待制作', disabled: true \}/);
  assert.match(subFeatureTabs, /item\.disabled/);
  assert.match(subFeatureTabs, /待制作/);
  assert.match(bottomInputBar, /isPendingShellSubFeature/);
  assert.match(bottomInputBar, /该子功能待制作/);
});

test('image upgrade product restoration workspace wires uploads, choices, rollout gate, and billing count', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const retouchModule = read('../shell/modules/Retouch/RetouchModule.tsx');
  const sidebar = read('../shell/components/layout/SidebarNavigation.tsx');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const uploadTypeSelector = read('../shell/components/UploadTypeSelector.tsx');
  const materialPreviewBar = read('../shell/components/MaterialPreviewBar.tsx');
  const shellWorkflow = read('../adapters/shellWorkflow.ts');
  const loggingService = read('../services/loggingService.ts');

  assert.match(retouchModule, /title="图片升级"/);
  assert.match(retouchModule, /产品还原/);
  assert.match(retouchModule, /开始升级产品图/);
  assert.match(sidebar, /AppModuleObj\.RETOUCH[\s\S]*?label: '图片升级'/);
  assert.match(shellApp, /\[AppModuleObj\.RETOUCH\]: '图片升级'/);
  assert.match(shellWorkflow, /\[AppModule\.RETOUCH\]: '图片升级'/);
  assert.match(loggingService, /retouch: '图片升级'/);

  assert.match(bottomInputBar, /PRODUCT_RESTORE_MATERIAL_TYPES/);
  assert.match(bottomInputBar, /PRODUCT_RESTORE_FOCUS_OPTIONS/);
  assert.match(bottomInputBar, /restoreFocusIds/);
  assert.match(bottomInputBar, /getProductRestoreControlState/);
  assert.match(bottomInputBar, /开始产品还原/);
  assert.match(bottomInputBar, /materialLimits=\{isProductRestore/);
  assert.match(bottomInputBar, /onMoveMaterial=\{isProductRestore/);
  assert.match(uploadTypeSelector, /restoreTarget/);
  assert.match(uploadTypeSelector, /productReference/);
  assert.match(uploadTypeSelector, /title=\{m\.desc\}/);
  assert.match(uploadTypeSelector, /tabIndex=\{0\}/);
  assert.match(materialPreviewBar, /onMoveMaterial/);
  assert.match(materialPreviewBar, /materialLimits/);
  assert.match(materialPreviewBar, /list\.length\}\/\{limit/);

  const productRestoreQuickParams = bottomInputBar.match(/const getProductRestoreQuickParams[\s\S]*?\n\};/)?.[0] || '';
  assert.match(productRestoreQuickParams, /key: 'model'/);
  assert.match(productRestoreQuickParams, /key: 'quality'/);
  assert.doesNotMatch(productRestoreQuickParams, /key: 'ratio'/);
  assert.doesNotMatch(productRestoreQuickParams, /1K/);
  assert.doesNotMatch(productRestoreQuickParams, /sizeMode|width|height/);

  assert.match(shellApp, /getProductRestoreCreationDisabledReason/);
  assert.match(shellApp, /产品还原暂未开放，历史项目仍可查看。/);
  assert.match(shellApp, /产品还原当前仅对管理员开放，历史项目仍可查看。/);
  assert.match(shellApp, /getProductRestoreUploadRejection/);
  assert.match(shellApp, /handleMoveMaterial/);
  assert.match(bottomInputBar, /materialCount: billingMaterialCount/);
});

test('product restoration upload reservations and regeneration share fail-closed creation guards', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const uploadBody = shellApp.match(/const handleMaterialUpload = useCallback\([\s\S]*?\n  \}, \[activeModule,/)?.[0] || '';
  const regenerateBody = shellApp.slice(
    shellApp.indexOf('const handleRegenerateResult = useCallback'),
    shellApp.indexOf('const handleFissionResult = useCallback'),
  );
  const recoverBody = shellApp.slice(
    shellApp.indexOf('const handleRecoverResult = useCallback'),
    shellApp.indexOf('// Filtered projects & tasks for current module'),
  );

  assert.match(shellApp, /createProductRestoreUploadReservationQueue/);
  assert.match(uploadBody, /productRestoreUploadReservationsRef\.current\.reserve/);
  assert.ok(
    uploadBody.indexOf('productRestoreUploadReservationsRef.current.reserve') < uploadBody.indexOf('Array.from(files)'),
    'the complete selection must be reserved before FileList conversion or async preprocessing',
  );
  assert.match(uploadBody, /prepareProductRestoreUploadBatch/);
  assert.match(uploadBody, /await reservation\.waitForTurn/);
  assert.match(uploadBody, /finally[\s\S]*?reservation\.release\(\)/);
  assert.match(uploadBody, /materialsRef\.current = next/);

  assert.match(regenerateBody, /getProductRestoreJobCreationDisabledReason/);
  const guardIndex = regenerateBody.indexOf('getProductRestoreJobCreationDisabledReason');
  assert.ok(guardIndex >= 0 && guardIndex < regenerateBody.indexOf('retryInternalJob'), 'rollout must guard backend retry creation');
  assert.ok(guardIndex < regenerateBody.indexOf('runShellImageGeneration'), 'rollout must guard image regeneration creation');
  assert.doesNotMatch(recoverBody, /getProductRestoreJobCreationDisabledReason/);
  assert.match(recoverBody, /recoverKieAiTask|hydrateShellJobs/);
});

test('shell buyer show and retouch migrate 3000 business logic instead of generic image prompts', () => {
  const shellWorkflow = read('../adapters/shellWorkflow.ts');
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(shellWorkflow, /runShellBuyerShowWorkflow/);
  assert.match(shellWorkflow, /generateBuyerShowPrompts/);
  assert.match(shellWorkflow, /SCENE & CHARACTER CONSISTENCY/);
  assert.match(shellWorkflow, /runShellRetouchWorkflow/);
  assert.match(shellWorkflow, /analyzeRetouchTask/);
  assert.match(shellWorkflow, /原图精修必须严格基于待精修图当前画面做优化/);
  assert.match(shellApp, /runShellBuyerShowWorkflow/);
  assert.match(shellApp, /runShellRetouchWorkflow/);
});

test('shell workspaces align their centered content rail to the landing page width baseline', () => {
  const main = read('../main.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const projectList = read('../shell/components/ProjectListView.tsx');
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const account = read('../shell/modules/Account/AccountManagement.tsx');
  const agentCenter = read('../shell/modules/AgentCenter/AgentCenterModule.tsx');
  const shellStyles = read('../shell/index.css');
  const landing = read('../shell/components/LandingPage.tsx');

  assert.match(projectList, /workspace-shell/);
  assert.match(projectList, /workspace-content workspace-content-tight/);
  assert.doesNotMatch(projectList, /max-w-\[896px\]/);
  assert.doesNotMatch(projectList, /rounded-\[30px\] border px-3 py-3 sm:px-4/);
  assert.doesNotMatch(projectList, /置顶任务与最近项目/);
  assert.match(projectList, /grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4/);
  assert.match(projectList, /orderedProjects/);
  assert.match(settings, /workspace-shell/);
  assert.match(settings, /workspace-content workspace-content-form/);
  assert.match(account, /workspace-shell/);
  assert.match(account, /workspace-content/);
  assert.match(agentCenter, /workspace-shell/);
  assert.match(agentCenter, /workspace-content/);
  assert.match(main, /\.\/index\.css/);
  assert.match(shellApp, /import '\.\/shell\/index\.css'/);
  assert.match(landing, /max-w-4xl/);
  assert.match(shellStyles, /\.workspace-content\s*\{[\s\S]*max-width:\s*860px;/);
  assert.match(shellStyles, /\.workspace-content-tight\s*\{[\s\S]*max-width:\s*860px;/);
  assert.match(shellStyles, /\.workspace-content-form\s*\{[\s\S]*max-width:\s*860px;/);
  assert.match(shellStyles, /@media \(max-width: 1280px\) and \(min-width: 768px\)/);
});

test('shell project downloads use shared download helper for single and batch assets', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(projectCard, /downloadRemoteFile/);
  assert.match(projectCard, /downloadRemoteFilesAsZip/);
  assert.match(projectCard, /getResultDownloadTransform/);
  assert.match(projectCard, /transform: getResultDownloadTransform\(project, result\)/);
  assert.doesNotMatch(projectCard, /fetch\(result\.videoUrl \|\| result\.imageUrl/);
});

test('shell sku uploads use ordered gift assets instead of brand logo materials', () => {
  const uploadSelector = read('../shell/components/UploadTypeSelector.tsx');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const shellWorkflow = read('../adapters/shellWorkflow.ts');
  const materialPreviewBar = read('../shell/components/MaterialPreviewBar.tsx');

  assert.match(uploadSelector, /'gift'/);
  assert.match(uploadSelector, /赠品素材/);
  assert.match(bottomInputBar, /if \(mode === 'SKU'\) return \['product', 'gift', 'styleRef'\]/);
  assert.match(bottomInputBar, /return \['product', 'logo', 'styleRef'\]/);
  assert.match(bottomInputBar, /Logo上传/);
  assert.match(shellApp, /giftIndex = type === 'gift' \? giftStartIndex \+ fileIndex : undefined/);
  assert.match(shellApp, /activeSubFeature === 'sku' && type === 'logo'/);
  assert.match(materialPreviewBar, /赠品\{m\.giftIndex\}/);
  assert.match(materialPreviewBar, /<video[\s\S]*src=\{m\.url\}[\s\S]*preload="auto"/);
  assert.match(materialPreviewBar, /onLoadedMetadata/);
  assert.match(shellWorkflow, /input\.module === AppModule\.ONE_CLICK && input\.subFeature === 'sku'/);
  assert.match(shellWorkflow, /input\.materials\.gift/);
  assert.match(shellWorkflow, /sort\(\(a, b\) => \(a\.giftIndex \|\| 0\) - \(b\.giftIndex \|\| 0\)\)/);
  assert.match(shellWorkflow, /不存在品牌Logo素材/);
});

test('video workspaces avoid implicit eager video downloads on cloud playback views', () => {
  const longVideoSubModule = read('../modules/Video/LongVideoSubModule.tsx');
  const veoWorkspace = read('../modules/Video/VeoWorkspace.tsx');

  assert.match(longVideoSubModule, /<video[\s\S]*src=\{task\.resultUrl\}[\s\S]*preload="metadata"/);
  assert.match(longVideoSubModule, /<video[\s\S]*src=\{task\.resultUrl\}[\s\S]*playsInline/);
  assert.match(veoWorkspace, /<video[\s\S]*src=\{activeSegment\.variants\.find\(v => v\.id === activeSegment\.selectedVariantId\)\?\.blobUrl\}[\s\S]*preload="metadata"/);
  assert.match(veoWorkspace, /<video[\s\S]*src=\{activeSegment\.variants\.find\(v => v\.id === activeSegment\.selectedVariantId\)\?\.blobUrl\}[\s\S]*playsInline/);
});

test('workspace preference toggles are wired into real generation and upload flows', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const appState = read('../utils/appState.ts');
  const shellApp = read('../ShellMigratedApp.tsx');
  const uploadService = read('../services/tencentCosService.ts');
  const fileProcessor = read('../components/FileProcessor.tsx');
  const taskPanel = read('../shell/components/ActiveTasksPanel.tsx');
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const soundUtils = read('../utils/soundUtils.ts');
  const shellWorkflow = read('../adapters/shellWorkflow.ts');

  assert.doesNotMatch(settings, /autoScrollToResult/);
  assert.doesNotMatch(settings, /自动生成后跳转结果/);
  assert.match(settings, /compressImagesBeforeUpload/);
  assert.match(settings, /playSoundAfterGeneration/);
  assert.match(settings, /showGenerationProgress/);
  assert.match(settings, /savePersistedAppState/);

  assert.match(appState, /createDefaultWorkspacePreferences/);
  assert.match(appState, /getWorkspacePreferences/);
  assert.match(appState, /workspacePreferences:/);

  assert.match(uploadService, /compressImagesBeforeUpload !== false/);
  assert.match(fileProcessor, /workspacePreferences\.showGenerationProgress/);
  assert.match(taskPanel, /showGenerationProgress/);
  assert.match(projectCard, /data-project-id/);
  assert.match(projectCard, /showGenerationProgress && isProjectActivelyGenerating/);

  assert.match(soundUtils, /playCompletionSound/);
  assert.match(soundUtils, /primeCompletionSound/);
  assert.match(shellApp, /playSoundAfterGeneration/);
  assert.doesNotMatch(shellApp, /autoScrollToResult/);
  assert.doesNotMatch(shellApp, /scrollIntoView/);
  assert.match(shellApp, /__workspacePreferences/);
  assert.match(shellWorkflow, /__workspacePreferences/);
});

test('shell settings shows account concurrency as read-only and leaves edits to account management', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const accountManagement = read('../shell/modules/Account/AccountManagement.tsx');

  assert.match(settings, /const canManageSystemSettings = currentUser\?\.role === 'admin'/);
  // a1251d8(2026-07-02 设置页大改版)移除了"当前并发"只读展示;核心不变量是
  // "设置页不得编辑并发、编辑只在账号管理",以下断言锁这条。展示是否恢复待业主决定。
  assert.doesNotMatch(settings, /并发任务数/);
  assert.doesNotMatch(settings, /setConcurrency/);
  assert.doesNotMatch(settings, /updateInternalUser\(currentUser\.id, \{ jobConcurrency/);
  assert.match(accountManagement, /const \[concurrencyDrafts, setConcurrencyDrafts\]/);
  // UI 组件从 TextField/「保存并发」按钮演进为原生 input+「保存」;不变量是"并发编辑在账号管理、经 updateUser 落库"
  assert.match(accountManagement, /并发<\/span>[\s\S]{0,600}concurrencyDrafts\[user\.id\]/);
  assert.match(accountManagement, /updateUser\(user, \{ jobConcurrency: Math\.max\(1, Number\(concurrencyDrafts\[user\.id\]/);
});

test('shell settings lets staff choose planning model while admins can broadcast and video model stays gemini-only', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');
  const internalApi = read('../services/internalApi.ts');
  const types = read('../types.ts');

  assert.match(types, /userAnalysisModel: string/);
  assert.match(types, /videoAnalysisModels:/);
  assert.match(types, /analysisModel\?: string/);
  assert.match(internalApi, /updateCurrentUserAnalysisModel/);
  assert.match(internalApi, /broadcastSystemAnalysisModel/);
  assert.match(settings, /setUserAnalysisModel\(config\.systemSettings\.userAnalysisModel \|\| ''\)/);
  assert.match(settings, /handleSaveUserAnalysisModel/);
  assert.match(settings, /handleBroadcastAnalysisModel/);
  assert.match(settings, /员工账号只能选择自己的策划分析模型/);
  assert.match(settings, /管理员可修改全局模型和广播到所有账号/);
  assert.match(settings, /systemConfig\?\.videoAnalysisModels/);
  assert.doesNotMatch(settings, /仅管理员可以修改分析模型/);
});

test('shell project lists do not parse the full persisted state once per rendered card', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const projectListView = read('../shell/components/ProjectListView.tsx');
  const taskPanel = read('../shell/components/ActiveTasksPanel.tsx');
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const oneClickModule = read('../shell/modules/OneClick/OneClickModule.tsx');

  assert.match(shellApp, /const showGenerationProgress = apiConfig\.workspacePreferences\?\.showGenerationProgress !== false/);
  assert.match(shellApp, /showGenerationProgress=\{showGenerationProgress\}/);
  assert.match(projectListView, /showGenerationProgress\?: boolean/);
  assert.match(projectListView, /<ActiveTasksPanel[\s\S]*showGenerationProgress=\{showGenerationProgress\}/);
  assert.match(projectListView, /<ProjectCard[\s\S]*showGenerationProgress=\{showGenerationProgress\}/);
  assert.match(oneClickModule, /showGenerationProgress\?: boolean/);
  assert.doesNotMatch(oneClickModule, /<ActiveTasksPanel[\s\S]*showGenerationProgress=\{showGenerationProgress\}/);
  assert.match(projectCard, /PlanEditor/);
  assert.doesNotMatch(taskPanel, /loadPersistedAppState\(/);
  assert.doesNotMatch(projectCard, /loadPersistedAppState\(/);
});

test('shell project lists render history progressively so refresh stays responsive with many projects', () => {
  const projectListView = read('../shell/components/ProjectListView.tsx');

  assert.match(projectListView, /INITIAL_PROJECT_RENDER_LIMIT/);
  assert.match(projectListView, /PROJECT_RENDER_BATCH_SIZE/);
  assert.match(projectListView, /setVisibleProjectCount\(INITIAL_PROJECT_RENDER_LIMIT\)/);
  assert.match(projectListView, /requestIdleCallback/);
  assert.match(projectListView, /globalThis\.setTimeout/);
  assert.match(projectListView, /orderedProjects\.slice\(0, visibleProjectCount\)/);
  assert.match(projectListView, /visibleProjects\.map/);
});

test('shell project lists sort newest cards first without regrouping active and history cards', () => {
  const projectListView = read('../shell/components/ProjectListView.tsx');

  assert.match(projectListView, /sortProjectsNewestFirst/);
  assert.match(projectListView, /const orderedProjects = useMemo\(\(\) => sortProjectsNewestFirst\(filteredProjects\), \[filteredProjects\]\)/);
  assert.doesNotMatch(projectListView, /const activeProjects = useMemo/);
  assert.doesNotMatch(projectListView, /const historyProjects = useMemo/);
  assert.doesNotMatch(projectListView, /\[\.\.\.activeProjects,\s*\.\.\.historyProjects\]/);
  assert.match(projectListView, /const visibleProjects = useMemo\(\(\) => orderedProjects\.slice\(0, visibleProjectCount\)/);
});

test('shell generation results keep the final submitted prompt instead of only the short input text', () => {
  const shellWorkflow = read('../adapters/shellWorkflow.ts');
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(shellWorkflow, /prompt: useNativeTranslationPrompt \? input\.prompt \|\| customPrompt : customPrompt/);
  assert.match(shellWorkflow, /prompt: input\.prompt\.trim\(\)/);
  assert.match(shellApp, /prompt: result\.prompt \|\| promptForModel/);
  assert.match(shellApp, /prompt: itemResult\.prompt \|\| batchPrompt/);
  assert.match(shellApp, /prompt: result\.prompt \|\| promptSummary \|\| batchPrompt/);
});

test('project card preview prefers completed media over failed or pending placeholders', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(projectCard, /const previewResult = project\.results\.find\(\(result\) => isCompletedMediaResult\(result\)\) \|\| project\.results\[0\];/);
  assert.match(projectCard, /renderMedia\(previewResult,/);
  assert.match(projectCard, /videoPreload: VIDEO_PREVIEW_PRELOAD/);
  assert.match(projectCard, /videoPreviewFrameTime: VIDEO_PREVIEW_FRAME_TIME_SECONDS/);
  assert.match(projectCard, /videoShowIndicator: true/);
});

test('one click completed result edit uses only product assets and generated baseline while keeping original result', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const projectListView = read('../shell/components/ProjectListView.tsx');
  const oneClickShellModule = read('../shell/modules/OneClick/OneClickModule.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(projectCard, /onEdit\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(projectCard, /editDialog/);
  assert.match(projectCard, /const isOneClickProject = project\.module === 'one_click'/);
  assert.match(projectCard, /const usesMinimalRoleEditPrompt = isOneClickProject \|\| isEverythingReplaceProductEditProject/);
  assert.match(projectCard, /onEdit\(project\.id, editDialog\.resultId, finalInstruction, usesMinimalRoleEditPrompt \? \[\] : editDialog\.files\)/);
  assert.doesNotMatch(projectCard, /补充参考图/);
  assert.match(projectListView, /onEditResult\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(oneClickShellModule, /onEditResult\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(shellApp, /const handleEditResult = useCallback/);
  assert.match(shellApp, /id: `project-edit-\$\{Date\.now\(\)\}`/);
  assert.match(shellApp, /directGeneration: true/);
  assert.match(shellApp, /model: currentScopedImageModel \|\| storedContext\?\.params\?\.model \|\| result\.model \|\| currentParams\.model \|\| 'GPT Image 2'/);
  assert.match(shellApp, /const originalGenerationPrompt = \[/);
  assert.match(shellApp, /result\.prompt,\s*matchedPlan\?\.schemeContent,\s*matchedPlanPrompt,\s*storedContext\?\.prompt,/);
  assert.match(shellApp, /editInstruction: finalInstruction/);
  assert.match(shellApp, /schemeContent: usesResultOnlyEditPrompt \? finalInstruction : originalGenerationPrompt \|\| finalInstruction/);
  assert.match(shellApp, /const isOneClickEdit = project\.module === AppModuleObj\.ONE_CLICK/);
  assert.match(shellApp, /const usesMinimalRoleEditPrompt = isOneClickEdit \|\| isEverythingReplaceProductEdit/);
  assert.match(shellApp, /logo: usesMinimalRoleEditPrompt \? \[\] : \[\.\.\.\(contextMaterials\.logo \|\| \[\]\)\]/);
  assert.match(shellApp, /const uploadedSupplementMaterials = usesMinimalRoleEditPrompt\s*\?\s*\[\]\s*:\s*await Promise\.all/);
  assert.match(shellApp, /runOneClickPlanGeneration\(readyEditProject, \[editPlan\], editMaterials\)/);
});

test('everything replace product edit uses its own generation flow', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const projectListView = read('../shell/components/ProjectListView.tsx');
  const everythingReplaceModule = read('../shell/modules/EverythingReplace/EverythingReplaceModule.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const editPromptFunction = workflow.match(/const buildEverythingReplaceResultEditPrompt = \(\{[\s\S]*?\n\};/)?.[0] || '';

  assert.match(projectCard, /onEdit\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(projectListView, /onEditResult\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(everythingReplaceModule, /onEditResult\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(shellApp, /onEditResult=\{handleEditResult\}/);
  assert.match(shellApp, /const runEverythingReplaceEditGeneration = useCallback/);
  assert.match(shellApp, /shellPurpose: resultOnlyEdit \? 'everything_replace_result_only_edit' : 'everything_replace_product_edit'/);
  assert.match(shellApp, /project\?\.module === AppModuleObj\.EVERYTHING_REPLACE && \(project\.subFeature === 'product_replace' \|\| project\.subFeature === 'background_replace'\)/);
  assert.match(shellApp, /const usesResultOnlyEditPrompt = isEverythingReplaceProductEdit \|\| isEverythingReplaceBackgroundEdit/);
  assert.match(shellApp, /runEverythingReplaceEditGeneration\(readyEditProject, editPlan, editMaterials\)/);
  assert.match(workflow, /buildEverythingReplaceResultEditPrompt/);
  assert.match(editPromptFunction, /修改基准图：\$\{safePreviousResultUrl \|\| '当前产出的结果图'\}（唯一参考基准，公网url）/);
  assert.match(editPromptFunction, /原任务的背景替换、产品替换、人物\/产品锁定等约束均不再生效/);
  assert.match(editPromptFunction, /修改要求：\$\{instruction \|\| '按用户输入要求修改当前结果图。'\}/);
  assert.doesNotMatch(editPromptFunction, /【补充参考图】/);
  assert.doesNotMatch(editPromptFunction, /【约束规范】/);
});

test('video storyboard result edit stays in the same card with version history and supplement uploads', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const videoShellModule = read('../shell/modules/Video/VideoModule.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const videoStoryboardService = read('../services/videoStoryboardService.ts');
  const importUtils = read('../shell/modules/Video/storyboardImportUtils.mjs');

  assert.match(projectCard, /project\.module === 'video'[\s\S]*project\.subFeature === 'storyboard'[\s\S]*onEdit/);
  assert.match(projectCard, /openEditDialog\(result\.id, result\.storyboardBoardTitle \|\| `分段 \$\{index \+ 1\}`\)/);
  assert.match(projectCard, /storyboardVersionIndexes/);
  assert.match(projectCard, /result\.storyboardImageVersions/);
  assert.match(projectCard, /setStoryboardVersionIndexes/);
  assert.match(projectCard, /onImportStoryboardToGeneration\(project\.storyboardSourceProject, result\.id, boardIndex, displayResult\.imageUrl\)/);
  assert.match(videoShellModule, /onEditResult\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(videoShellModule, /onEditResult=\{onEditResult\}/);
  assert.match(shellApp, /handleStoryboardEditResult/);
  assert.match(shellApp, /uploadInternalAssetStream\(\{[\s\S]*module: AppModuleObj\.VIDEO/);
  assert.match(shellApp, /imageVersions: nextVersions/);
  assert.match(shellApp, /status: 'generating'/);
  assert.match(shellApp, /generateStoryboardBoardImage\([\s\S]*uploadedSupplementUrls/);
  assert.match(importUtils, /const storyboardUrl = cleanText\(ref\.imageUrl \|\| board\?\.imageUrl\)/);
  assert.match(videoStoryboardService, /supplementReferenceUrls: string\[\] = \[\]/);
  assert.match(videoStoryboardService, /补充参考图公网URL/);
});

test('video storyboard edit keeps recoverable submitted cloud tasks pending instead of failed', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const storyboardEditBlock = shellApp.match(/const handleStoryboardEditResult = useCallback\(async \([\s\S]*?const handleEditResult = useCallback/)?.[0] || '';

  assert.match(storyboardEditBlock, /if \(isRecoverableShellWorkflowResult\(generated\.result\)\) \{/);
  assert.match(storyboardEditBlock, /applyStoryboardBoardResult\(/);
  assert.match(storyboardEditBlock, /deriveStoryboardProjectStatus\(/);
  assert.match(storyboardEditBlock, /recoverable: true/);
  assert.match(storyboardEditBlock, /addToast\('分镜图修改任务已提交云端，结果待同步，可稍后点击找回。', 'info'\)/);
  assert.match(storyboardEditBlock, /return true;/);
  assert.doesNotMatch(storyboardEditBlock, /if \(generated\.result\.status !== 'success' \|\| !generated\.result\.imageUrl\) \{\s*throw new Error\(generated\.result\.message \|\| '分镜图修改失败'\);\s*\}\s*if \(isRecoverableShellWorkflowResult\(generated\.result\)\)/);
});

test('video storyboard recovery polls KIE task id and writes back to the same board', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(projectCard, /const canRecoverStoryboardResult = \(result\?: GeneratedResult \| null\) => Boolean\(/);
  assert.match(projectCard, /project\.module === 'video'[\s\S]*project\.subFeature === 'storyboard'[\s\S]*result\?\.taskId/);
  assert.match(projectCard, /label="找回"[\s\S]*onRecover\?\.\(project\.id, result\.id\)/);
  assert.match(shellApp, /const handleStoryboardRecoverResult = useCallback\(async \(projectId: string, resultId\?: string\)/);
  assert.match(shellApp, /const recoverTaskId = String\(board\?\.taskId \|\| ''\)\.trim\(\)/);
  assert.match(shellApp, /await recoverKieAiTask\(recoverTaskId, apiConfig, controller\.signal, false\)/);
  assert.match(shellApp, /const nextBoards = item\.boards\.map\(\(currentBoard\) => currentBoard\.id === board\.id/);
  assert.match(shellApp, /imageUrl: recovery\.imageUrl \|\| currentBoard\.imageUrl/);
  assert.match(shellApp, /taskId: recovery\.taskId \|\| recoverTaskId/);
  assert.match(shellApp, /if \(await handleStoryboardRecoverResult\(projectId, resultId\)\) return;/);
});

test('shell workflows do not expose internal job ids as provider task ids', () => {
  const workflow = read('../adapters/shellWorkflow.ts');

  assert.doesNotMatch(workflow, /taskId:\s*finalJob\.providerTaskId\s*\|\|\s*finalJob\.id/);
  assert.doesNotMatch(workflow, /taskId:\s*job\.providerTaskId\s*\|\|\s*job\.id/);
  assert.match(workflow, /taskId: String\(finalJob\.providerTaskId \|\| finalJob\.result\?\.providerTaskId \|\| ''\)\.trim\(\) \|\| undefined/);
});

test('one click result edit and fission show immediate feedback before long async work', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const planEditor = read('../shell/components/PlanEditor.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(projectCard, /onFission\(project\.id, fissionDialog\.resultId, fissionDialog\.mode, finalInstruction\);\s*setFissionDialog\(null\);\s*setDetailOpen\(false\);/);
  assert.match(projectCard, /onEdit\(project\.id, editDialog\.resultId, finalInstruction, usesMinimalRoleEditPrompt \? \[\] : editDialog\.files\);\s*setEditDialog\(null\);\s*setDetailOpen\(false\);/);
  assert.match(projectCard, /isEditResultPending=\{isEditPending\}/);
  assert.match(projectCard, /isFissionResultPending=\{isFissionPending\}/);
  assert.match(planEditor, /isEditResultPending\?: \(resultId: string\) => boolean/);
  assert.match(planEditor, /isFissionResultPending\?: \(resultId: string\) => boolean/);
  assert.match(planEditor, /label=\{isEditPending \? '提交中' : '修改'\}/);
  assert.match(planEditor, /label=\{isFissionPending \? '提交中' : '裂变'\}/);
  assert.match(shellApp, /addToast\('裂变任务已提交，正在创建新任务卡', 'info'\)/);
  assert.match(shellApp, /addToast\('修改任务已提交，正在准备素材', 'info'\)/);
  assert.match(shellApp, /setProjects\(\(prev\) => \[editProject, \.\.\.prev\]\);[\s\S]{0,1200}const uploadedSupplementMaterials = usesMinimalRoleEditPrompt/);
});

test('plan prompt editor preserves IME composition and does not normalize while typing', () => {
  const source = read('../shell/components/PlanEditor.tsx');

  assert.match(source, /import \{ isImeComposing \} from '..\/..\/utils\/ime'/);
  assert.match(source, /const stripSchemeMarkers = \(scheme\?: string\) =>/);
  assert.match(source, /const PlanPromptTextarea: React\.FC/);
  assert.match(source, /const composingRef = useRef\(false\)/);
  assert.match(source, /onCompositionStart=\{\(\) => \{/);
  assert.match(source, /onCompositionEnd=\{\(event\) => \{/);
  assert.match(source, /value=\{draft\}/);
  assert.match(source, /if \(!composingRef\.current && !isImeComposing\(event\)\) \{/);
  assert.doesNotMatch(source, /<textarea[\s\S]{0,220}value=\{schemeText\}[\s\S]{0,220}handleSchemeContentChange/);
});

test('text input enter shortcuts ignore active IME composition', () => {
  const ime = read('../utils/ime.ts');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const presetLibrary = read('../shell/components/PresetLibrary.tsx');
  const skuSidebar = read('../modules/OneClick/SkuSidebar.tsx');
  const configSidebar = read('../modules/OneClick/ConfigSidebar.tsx');

  assert.match(ime, /export const isImeComposing =/);
  assert.match(ime, /nativeEvent\.isComposing/);
  assert.match(ime, /nativeEvent\.keyCode === 229/);

  for (const source of [bottomInputBar, presetLibrary, skuSidebar, configSidebar]) {
    assert.match(source, /isImeComposing/);
    assert.doesNotMatch(source, /if \(e\.key === 'Enter'\)/);
    assert.doesNotMatch(source, /if \(event\.key === 'Enter'\)/);
  }
});

test('one click fission and edit are direct image-generation projects without planning credits and keep source model params', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const shellPersistence = read('../adapters/shellPersistence.ts');
  const shellDataAdapter = read('../adapters/shellDataAdapter.ts');

  assert.match(projectCard, /!project\.directGeneration && \(Boolean\(project\.planningTaskId\)/);
  assert.match(projectCard, /project\.module === 'video'[\s\S]*project\.subFeature === 'storyboard'[\s\S]*rawProjectCredits > 0/);
  assert.match(shellApp, /variationInstruction: fissionInstruction \|\| `按\$\{variantLabel\}方向继续裂变这张生成图。`/);
  assert.match(shellApp, /variantProject\.generationContext = cloneGenerationContext\(variantPlan\.schemeContent \|\| fissionInstruction, fissionParams, variantMaterials\)/);
  assert.match(shellApp, /const variantMaterials = buildVariantMaterials\(baseMaterials, variantPlan, 'first_image'\)/);
  assert.match(shellApp, /buildOneClickPlanGenerationMaterials/);
  assert.match(shellApp, /directGeneration: true/);
  assert.match(shellPersistence, /directGeneration\?: boolean/);
  assert.match(shellPersistence, /directGeneration: project\.directGeneration/);
  assert.match(shellDataAdapter, /directGeneration\?: boolean/);
  assert.match(shellDataAdapter, /directGeneration: directGeneration === true/);
});

test('completed one-click planning snapshots are not kept as active runtime jobs', () => {
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(shellApp, /const isOneClickPlanReadyProject = \(project: Project\) =>/);
  assert.match(shellApp, /project\.status === 'planning'[\s\S]*project\.plans\.length > 0/);
  assert.match(shellApp, /project\.status === 'planning' && !isOneClickPlanReadyProject\(project\)/);
  assert.match(shellApp, /if \(isOneClickPlanReadyProject\(project\)\) return false;/);
});

test('planning task id chips do not display internal backend job ids', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const planEditor = read('../shell/components/PlanEditor.tsx');
  const shellDataAdapter = read('../adapters/shellDataAdapter.ts');
  const shellPersistence = read('../adapters/shellPersistence.ts');
  const appStateMerge = read('../../server/appStateMerge.mjs');

  assert.match(projectCard, /\.filter\(\(item\) => !\/\^\[a-f0-9\]\{24\}\$\/i\.test\(item\)\)/);
  assert.match(planEditor, /\.filter\(\(item\) => !\/\^\[a-f0-9\]\{24\}\$\/i\.test\(item\)\)/);
  assert.match(shellDataAdapter, /latestProviderTaskIdentityText/);
  assert.match(shellPersistence, /latestProviderTaskIdentityText/);
  assert.match(appStateMerge, /latestProviderTaskIdentityText/);
});

test('shell video generation submits seedance jobs without automatic retry and keeps audio enabled by default', () => {
  const workflow = read('../adapters/shellWorkflow.ts');
  const shellApp = read('../ShellMigratedApp.tsx');
  const videoBody = workflow.match(/export const runShellVideoGeneration = async \(input: ShellGenerateInput\) => \{([\s\S]*?)\n\};/)?.[1] || '';
  const completedVideoResultBlock = shellApp.match(/const newResult: GeneratedResult = \{[\s\S]*?mediaType: 'video'[\s\S]*?\n\t          \};/)?.[0] || '';

  assert.match(videoBody, /generateAudio: parseSeedanceGenerateAudio\(input\.params\)/);
  assert.match(videoBody, /isMaxForAiVideoModel/);
  assert.match(videoBody, /taskType: isMaxForAiAccess \? 'maxforai_video'/);
  assert.match(videoBody, /provider: isMaxForAiAccess \? 'maxforai'/);
  assert.match(videoBody, /model: MAXFORAI_VIDEO_MODEL_ID/);
  assert.match(videoBody, /upstreamModel: MAXFORAI_VIDEO_MODEL\.upstreamModel/);
  assert.match(videoBody, /maxRetries: 0/);
  assert.doesNotMatch(videoBody, /generateAudio: false/);
  assert.match(completedVideoResultBlock, /backendJobId: activeBackendJobId \|\| undefined/);
  assert.match(shellApp, /model: generationParams\['modelVersion'\] \|\| generationParams\['model'\] \|\| MAXFORAI_VIDEO_MODEL_ID/);
});

test('everything replace is registered as a shell module with product replace entry points', () => {
  const types = read('../types.ts');
  const shellApp = read('../ShellMigratedApp.tsx');
  const sidebar = read('../shell/components/layout/SidebarNavigation.tsx');
  const modulePath = new URL('../shell/modules/EverythingReplace/EverythingReplaceModule.tsx', import.meta.url);

  assert.match(types, /EVERYTHING_REPLACE = 'everything_replace'/);
  assert.match(types, /EVERYTHING_REPLACE: AppModule\.EVERYTHING_REPLACE/);
  assert.match(sidebar, /ReplaceAll/);
  assert.match(sidebar, /AppModuleObj\.EVERYTHING_REPLACE/);
  assert.match(sidebar, /万物替换/);
  assert.match(shellApp, /lazy\(\(\) => import\('\.\/shell\/modules\/EverythingReplace\/EverythingReplaceModule'\)\)/);
  assert.match(shellApp, /\[AppModuleObj\.EVERYTHING_REPLACE\]: '万物替换'/);
  assert.match(shellApp, /id: 'product_replace', label: '产品替换'/);
  assert.match(shellApp, /id: 'background_replace', label: '背景替换'/);
  assert.match(shellApp, /id: 'logo_replace', label: 'logo替换'/);
  assert.doesNotMatch(shellApp, /id: 'logo_replace', label: 'logo替换', disabled: true/);
  assert.match(shellApp, /case AppModuleObj\.EVERYTHING_REPLACE:/);
  assert.equal(existsSync(modulePath), true);

  const everythingReplace = read('../shell/modules/EverythingReplace/EverythingReplaceModule.tsx');
  assert.match(everythingReplace, /ProjectListView/);
  assert.match(everythingReplace, /开始万物替换/);
});

test('everything replace logo replacement is integrated without product-replace defaults or async result drift', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const internalApi = read('../services/internalApi.ts');
  const server = read('../../server/index.mjs');

  assert.match(shellApp, /cornerBadgeRegion\?: Record<string, unknown>/);
  assert.match(shellApp, /logoReplaceRegion\?: Record<string, unknown>/);
  assert.match(shellApp, /logoReplaceRegions\?: Array<Record<string, unknown>>/);
  assert.match(shellApp, /allowEmptyEverythingReplacePrompt[\s\S]*targetSubFeature === 'logo_replace'/);
  assert.match(shellApp, /const isLogoReplace = mode === 'logo_replace'/);
  assert.match(shellApp, /replacementLogic: params\.replacementLogic \|\| 'corner_badge_replace'/);
  assert.doesNotMatch(shellApp, /logoReplaceRenderMode: params\.logoReplaceRenderMode \|\| 'program_guarded'/);
  assert.match(shellApp, /resolveEverythingReplaceBatchCount\(generationMaterials, generationParams, targetSubFeature\)/);

  assert.match(bottomInputBar, /const isLogoReplaceContext = \(module: AppModule, activeSubFeature\?: string\)/);
  assert.match(bottomInputBar, /getLogoReplaceQuickParams/);
  assert.match(bottomInputBar, /return \['logo', 'styleRef'\]/);
  assert.match(bottomInputBar, /新Logo素材/);
  assert.match(bottomInputBar, /待替换原图/);
  assert.match(bottomInputBar, /开始Logo替换/);
  assert.doesNotMatch(bottomInputBar, /key: 'logoReplaceRenderMode'/);
  assert.doesNotMatch(bottomInputBar, /程序兜底/);
  assert.doesNotMatch(bottomInputBar, /KIE直出/);
  assert.doesNotMatch(bottomInputBar, /activeSubFeature === 'background_replace' \|\| activeSubFeature === 'logo_replace'/);

  assert.match(workflow, /type ShellRetouchMode = 'original' \| 'white_bg' \| 'product_restore' \| 'product_replace' \| 'background_replace' \| 'logo_replace'/);
  assert.match(workflow, /normalizeLogoReplaceMode/);
  assert.match(workflow, /runLogoReplaceWorkflow/);
  assert.match(workflow, /subFeature: 'logo_replace'/);
  assert.match(workflow, /requestedLogoReplaceRenderMode/);
  assert.match(workflow, /logoReplaceMode === 'multi_logo_replace' \|\| logoReplaceMode === 'single_logo_region_replace'[\s\S]*\? 'program_guarded'/);
  assert.match(workflow, /imageInputUrls = \[referenceUrl, \.\.\.multiLogoInputUrls, multiLogoPreviewInputs\.multiLogoPreviewUrl\]\.filter\(Boolean\)/);
  assert.match(workflow, /cleanupMode: 'rect'/);
  assert.match(workflow, /createGuardedMultiLogoReplaceResultBlob/);
  assert.match(workflow, /if \(hasPendingGenerationIdentity\(generation\)\) \{[\s\S]*return toProductReplaceResultItem/);
  assert.match(workflow, /updateInternalJobResult/);

  assert.match(internalApi, /export const updateInternalJobResult/);
  assert.match(server, /jobResultMatch/);
  assert.match(server, /withManagedAssetUserLock\(user\.id[\s\S]{0,700}getJobById\(lockedPool, job\.id\)[\s\S]{0,700}updateJobFields\(lockedPool, freshJob\.id/);
  assert.match(server, /updateLocalJobResult/);
});

test('everything replace product workflow keeps batch metadata so many outputs remain visible', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const projectCard = read('../shell/components/ProjectCard.tsx');

  assert.match(shellApp, /targetModule === AppModuleObj\.EVERYTHING_REPLACE/);
  assert.match(shellApp, /resolveEverythingReplaceBatchCount/);
  assert.match(shellApp, /shellProjectId: projectId/);
  assert.match(shellApp, /shellProjectName: projectName/);
  assert.match(shellApp, /sortGeneratedResultsByBatchIndex/);
  assert.match(workflow, /AppModule\.EVERYTHING_REPLACE/);
  assert.match(workflow, /runProductReplaceWorkflow/);
  assert.match(workflow, /replacementLogic/);
  assert.match(workflow, /【角色】/);
  assert.match(workflow, /【输入图片角色】/);
  assert.match(workflow, /【任务】/);
  assert.match(workflow, /【替换逻辑】/);
  assert.match(workflow, /【文案处理】/);
  assert.match(workflow, /【约束】/);
  assert.doesNotMatch(workflow, /【Logo 参考】/);
  assert.doesNotMatch(workflow, /Logo 原图：随 input_urls 上传/);
  assert.match(workflow, /skipPromptCleanupSuffix/);
  assert.match(workflow, /normalizeProductReplaceTextPolicy/);
  assert.match(workflow, /当前任务只使用当前这一张替换参考图/);
  assert.match(workflow, /找到当前替换参考图中应被替换的原产品区域，将产品素材图中的目标产品自然替换进对应位置/);
  assert.match(workflow, /去除参考图中的所有宣传文案内容/);
  assert.match(workflow, /参考图中的所有非产品宣传文案均不做任何变动/);
  assert.doesNotMatch(workflow, /【任务类型】：万物替换 \/ 产品替换 \/ 单品替换/);
  assert.doesNotMatch(workflow, /productDetailUrls/);
  assert.doesNotMatch(workflow, /buildProductDetailReferencePrompt/);
  assert.match(workflow, /const total = referenceUrls\.length/);
  assert.match(workflow, /buildEverythingReplaceLogoInputs/);
  assert.match(workflow, /loadShellDraftAsset/);
  assert.match(workflow, /logoBlob: localLogoRecord\?\.blob/);
  assert.doesNotMatch(workflow, /\.\.\.productDetailUrls/);
  assert.doesNotMatch(workflow, /产品素材硬约束｜最高优先级/);
  assert.doesNotMatch(workflow, /产品细节锁定/);
  assert.doesNotMatch(workflow, /主产品图URL/);
  assert.doesNotMatch(workflow, /产品细节补充图URL/);
  assert.doesNotMatch(workflow, /若主产品图与细节补充图存在差异，以主产品图为准/);
  assert.match(workflow, /不得遗漏任意上传产品/);
  assert.match(workflow, /人物微调/);
  assert.match(workflow, /必须重绘为不同人物/);
  assert.match(workflow, /不得只做几乎不可见的轻微修饰/);
  assert.match(workflow, /全局微调/);
  assert.match(workflow, /人物、场景、动作和局部细节允许轻微变化/);
  assert.match(workflow, /产品素材图是产品外观的最高优先级依据/);
  assert.match(workflow, /输入图片角色/);
  assert.match(workflow, /当前替换参考图/);
  assert.match(workflow, /移除参考图中的原产品、原品牌、原商标、原包装信息和原产品轮廓/);
  assert.match(workflow, /透视、遮挡、接触阴影、材质反光/);
  assert.doesNotMatch(workflow, /人物自适应/);
  assert.match(workflow, /firstImageColorMode/);
  assert.match(workflow, /textPolicy/);
  assert.match(workflow, /Promise\.all/);
  assert.match(workflow, /batchIndex/);
  assert.match(workflow, /referenceIndex/);
  assert.match(workflow, /resolveProductReplaceReferenceAspectRatio/);
  assert.match(projectCard, /hideResultPromptInProjectCard/);
  assert.match(projectCard, /project\.module === 'everything_replace'/);
  assert.match(projectCard, /project\.subFeature === 'product_replace'/);
  assert.match(projectCard, /result\.status !== 'error'/);
});

test('everything replace background workflow is wired with RTCFE prompt and locked subject constraints', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const backgroundWorkflow = workflow.match(/const runBackgroundReplaceWorkflow = async \([\s\S]*?const toProductReplaceResultItem = async /)?.[0] || '';

  assert.match(shellApp, /id: 'background_replace', label: '背景替换' \}/);
  assert.doesNotMatch(shellApp, /id: 'background_replace', label: '背景替换', description: '待制作', disabled: true/);
  assert.match(shellApp, /targetSubFeature === 'product_replace' \|\| targetSubFeature === 'background_replace'/);
  assert.match(shellApp, /targetSubFeature === 'background_replace' \? '背景替换' : '产品替换'/);

  assert.match(bottomInputBar, /getBackgroundReplaceQuickParams/);
  assert.doesNotMatch(bottomInputBar, /label: '画面模式'/);
  assert.match(bottomInputBar, /key: 'resolutionMode'/);
  assert.match(bottomInputBar, /label: '尺寸模式'/);
  assert.match(bottomInputBar, /options: \['AI 自适应尺寸', '固定宽度'\]/);
  assert.match(bottomInputBar, /key: 'targetWidth'/);
  assert.match(bottomInputBar, /label: '输出宽度\(px\)'/);
  assert.match(bottomInputBar, /return \['product', 'styleRef'\]/);
  assert.match(shellApp, /const isBackgroundReplace = mode === 'background_replace'/);
  assert.match(shellApp, /targetHeight: params\.targetHeight \|\| params\.height \|\| '0'/);

  assert.match(workflow, /type ShellRetouchMode = 'original' \| 'white_bg' \| 'product_restore' \| 'product_replace' \| 'background_replace' \| 'logo_replace'/);
  assert.match(workflow, /runBackgroundReplaceWorkflow/);
  assert.match(backgroundWorkflow, /\{ \.\.\.config, aspectRatio, targetLanguage: 'zh', removeWatermark: true \}/);
  assert.match(workflow, /\{ \.\.\.config, aspectRatio \}/);
  assert.doesNotMatch(backgroundWorkflow, /resolutionMode: 'original'/);
  assert.doesNotMatch(backgroundWorkflow, /targetWidth: 0/);
  assert.doesNotMatch(backgroundWorkflow, /targetHeight: 0/);
  assert.match(workflow, /buildBackgroundReplacePrompt/);
  assert.match(workflow, /BACKGROUND_REPLACE_SCENE_RULE/);
  assert.match(workflow, /根据背景参考图的场景\/背景进行复刻/);
  assert.match(workflow, /R Role 角色/);
  assert.match(workflow, /T Task 任务/);
  assert.match(workflow, /C Constraint 约束/);
  assert.match(workflow, /F Format 格式/);
  assert.match(workflow, /E Example 示例/);
  assert.match(workflow, /只更换原产品图中的背景\/场景/);
  assert.match(workflow, /唯一允许变化项：只允许更换背景\/场景/);
  assert.match(workflow, /产品和人物状态动作保持不变/);
  assert.match(workflow, /主体尺度、主体轮廓、主体位置、遮挡关系和产品摆放必须沿用原产品图/);
  assert.match(workflow, /延续参考图的空间类型、环境材质、色调、光线方向、景深和商业拍摄质感/);
  assert.match(workflow, /场景的镜头角度、透视比例、空间尺度、道具大小和远近关系必须主动适配原产品图/);
  assert.match(workflow, /不得让产品或人物去适配参考背景/);
  assert.match(workflow, /空间标定：先以原产品图中的产品\/人物为唯一空间锚点/);
  assert.match(workflow, /脚底\/底部接触点、地面线、相机高度、主体占画面比例、前后景距离和遮挡层级/);
  assert.match(workflow, /背景必须反向适配主体/);
  assert.match(workflow, /不能出现人物悬浮、脚底无接触阴影、台阶过大\/过小、门窗比例失真、地面透视线与主体不一致或主体像贴图的效果/);
  assert.match(workflow, /新背景必须与原产品和人物自然融合/);
  assert.match(workflow, /严格符合原产品的角度、透视、受光方向和接触关系/);
  assert.match(workflow, /人物动态必须以原产品图为唯一依据/);
  assert.match(workflow, /保持原人物状态动作、姿势、肢体动态、手势、视线、表情趋势、服装轮廓/);
  assert.match(workflow, /产品外观、形状、比例、颜色、材质、纹理、结构、配件、包装文字、标签、Logo、品牌名、图案/);
  assert.match(workflow, /不得换脸、换发型、换服装、换动作、换手势、换站姿或改变人与产品的相对位置/);
  assert.match(workflow, /背景参考图只提供场景\/背景依据/);
  assert.match(workflow, /场景角度、比例大小、空间尺度、接触阴影、反射、景深、边缘过渡/);
  assert.match(workflow, /不得把参考图中的人物、产品、品牌、文字、促销、价格、认证、赠品、平台标识或水印带入最终图/);
  assert.match(workflow, /buildBackgroundReplaceTextPolicyBlock/);
  assert.match(workflow, /文案处理：/);
  assert.match(workflow, /去除背景、场景、道具、墙面、海报、水印和非产品区域中的文字\/品牌\/标识/);
  assert.match(workflow, /不得去除或改写产品包装文字、产品标签和产品自身 Logo/);
  assert.match(workflow, /保留原产品图中非产品区域已有的背景文字、场景标识和画面文案/);
  assert.match(workflow, /textPolicy = normalizeProductReplaceTextPolicy\(input\.params\.textPolicy\)/);
  assert.match(workflow, /subFeature: 'background_replace'/);
  assert.match(workflow, /\[sourceUrl, referenceUrl\]/);
});

test('everything replace regeneration appends a new result instead of overwriting the previous output', () => {
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(shellApp, /const \{ runShellImageGeneration, runShellRetouchWorkflow \} = await loadShellWorkflowModule\(\)/);
  assert.match(shellApp, /const shouldAppendRegeneratedResult = project\.module === AppModuleObj\.EVERYTHING_REPLACE/);
  assert.match(shellApp, /const hasExistingRegeneratedResult = latestRegeneratedProject\.results\.some\(\(current\) => current\.id === nextResult\.id\)/);
  assert.match(shellApp, /: \[\.\.\.latestRegeneratedProject\.results, nextResult\]/);
  assert.match(shellApp, /taskCount: shouldAppendRegeneratedResult/);
  assert.match(shellApp, /id: regeneratedResultId/);
  assert.match(shellApp, /const isEverythingReplaceBackgroundRegeneration = project\.module === AppModuleObj\.EVERYTHING_REPLACE && subFeature === 'background_replace'/);
  assert.match(shellApp, /const regenerationMaterials = isEverythingReplaceBackgroundRegeneration && sourceUrl/);
  assert.match(shellApp, /styleRef: \[\{/);
  assert.match(shellApp, /id: `\$\{result\.id\}-retry-background-reference`/);
  assert.match(shellApp, /runShellRetouchWorkflow\(\{/);
  assert.match(shellApp, /shellPurpose: 'background_replace_regeneration'/);
  assert.match(shellApp, /shellResultId: regeneratedResultId/);
  assert.match(shellApp, /shellPurpose: 'result_regeneration'[\s\S]*?shellResultId: regeneratedResultId/);
  assert.match(shellApp, /status: item\?\.status === 'completed' \? 'success' : item\?\.status \|\| 'error'/);
});

test('everything replace product and background edits use only the current result image as baseline', () => {
  const projectCard = read('../shell/components/ProjectCard.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const materials = read('../adapters/shellOneClickMaterials.mjs');

  assert.match(projectCard, /const isEverythingReplaceBackgroundEditProject = project\.module === 'everything_replace' && project\.subFeature === 'background_replace'/);
  assert.match(projectCard, /project\.module === 'everything_replace' && project\.subFeature === 'background_replace'/);
  assert.match(projectCard, /const usesMinimalRoleEditPrompt = isOneClickProject \|\| isEverythingReplaceProductEditProject \|\| isEverythingReplaceBackgroundEditProject/);

  assert.match(shellApp, /const isEverythingReplaceBackgroundEdit = project\.module === AppModuleObj\.EVERYTHING_REPLACE[\s\S]*?project\.subFeature === 'background_replace'/);
  assert.match(shellApp, /const usesResultOnlyEditPrompt = isEverythingReplaceProductEdit \|\| isEverythingReplaceBackgroundEdit/);
  assert.match(shellApp, /product: usesResultOnlyEditPrompt \? \[\] : \[\.\.\.\(contextMaterials\.product \|\| \[\]\)\]/);
  assert.match(shellApp, /gift: usesResultOnlyEditPrompt \? \[\] : \[\.\.\.\(contextMaterials\.gift \|\| \[\]\)\]/);
  assert.match(shellApp, /schemeContent: usesResultOnlyEditPrompt \? finalInstruction : originalGenerationPrompt \|\| finalInstruction/);
  assert.match(shellApp, /shellPurpose: resultOnlyEdit \? 'everything_replace_result_only_edit' : 'everything_replace_product_edit'/);
  assert.match(shellApp, /const resultOnlyEdit = project\.module === AppModuleObj\.EVERYTHING_REPLACE[\s\S]*?\(project\.subFeature === 'product_replace' \|\| project\.subFeature === 'background_replace'\)/);
  assert.match(shellApp, /resultOnlyEdit,/);

  assert.match(materials, /if \(sourceResultUrl && hasEditInstruction && isResultOnlyEdit\) \{[\s\S]*?return dedupeUrls\(\[sourceResultUrl\]\)/);
  assert.match(workflow, /input\.subFeature === 'product_replace' \|\| input\.subFeature === 'background_replace'/);
  assert.match(workflow, /resultOnlyEdit: Boolean\(input\.taskMetadata\?\.resultOnlyEdit\)/);
  assert.match(workflow, /修改基准图：\$\{safePreviousResultUrl \|\| '当前产出的结果图'\}（唯一参考基准，公网url）/);
  assert.match(workflow, /原任务的背景替换、产品替换、人物\/产品锁定等约束均不再生效/);
  assert.match(workflow, /修改要求：\$\{instruction \|\| '按用户输入要求修改当前结果图。'\}/);
});

test('everything replace product workflow sends logo placement guides per reference task', () => {
  const workflow = read('../adapters/shellWorkflow.ts');
  const bottomInputBar = read('../shell/components/layout/BottomInputBar.tsx');
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(bottomInputBar, /return \['product', 'logo', 'styleRef'\]/);
  assert.match(bottomInputBar, /Logo位置区域调整/);
  assert.match(bottomInputBar, /应用到全部比例/);
  assert.match(shellApp, /const cloneMaterialSnapshot = \(material: Material\) => \{[\s\S]*logoPlacement: material\.logoPlacement/);
  assert.match(workflow, /buildEverythingReplaceLogoInputs/);
  assert.match(workflow, /createEverythingReplaceLogoPlacementGuide/);
  assert.match(workflow, /logoPlacementGuideUrl/);
  assert.match(workflow, /Logo位置示意图/);
  assert.match(workflow, /Logo 必须植入最终图/);
  assert.match(workflow, /Logo 位置示意图只作为位置参考/);
  assert.match(workflow, /边框、辅助线、底色、选区框或标记/);
  assert.match(workflow, /相对位置、面积、方向和比例/);
});

test('everything replace product edit is wired to its own generation path', () => {
  const shellApp = read('../ShellMigratedApp.tsx');
  const workflow = read('../adapters/shellWorkflow.ts');
  const everythingReplaceModule = read('../shell/modules/EverythingReplace/EverythingReplaceModule.tsx');
  const editPromptFunction = workflow.match(/const buildEverythingReplaceResultEditPrompt = \(\{[\s\S]*?\n\};/)?.[0] || '';

  assert.match(shellApp, /const runEverythingReplaceEditGeneration = useCallback/);
  assert.match(shellApp, /isEverythingReplaceProductEdit/);
  assert.match(shellApp, /await runEverythingReplaceEditGeneration\(readyEditProject, editPlan, editMaterials\)/);
  assert.match(shellApp, /onEditResult=\{handleEditResult\}/);
  assert.match(everythingReplaceModule, /onEditResult\?: \(projectId: string, resultId: string, instruction: string, files: File\[\]\) => void/);
  assert.match(workflow, /buildEverythingReplaceResultEditPrompt/);
  assert.match(workflow, /everythingReplaceEditPrompt/);
  assert.match(shellApp, /shellPurpose: resultOnlyEdit \? 'everything_replace_result_only_edit' : 'everything_replace_product_edit'/);
  assert.match(shellApp, /const usesResultOnlyEditPrompt = isEverythingReplaceProductEdit \|\| isEverythingReplaceBackgroundEdit/);
  assert.match(editPromptFunction, /修改基准图：\$\{safePreviousResultUrl \|\| '当前产出的结果图'\}（唯一参考基准，公网url）/);
  assert.match(editPromptFunction, /原任务的背景替换、产品替换、人物\/产品锁定等约束均不再生效/);
  assert.match(editPromptFunction, /修改要求：\$\{instruction \|\| '按用户输入要求修改当前结果图。'\}/);
});

test('generation refreshes expiring uploaded material urls from local draft assets', () => {
  const shellApp = read('../ShellMigratedApp.tsx');

  assert.match(shellApp, /shouldRefreshExpiringMaterialUrl/);
  assert.match(shellApp, /host === 'tempfile\.redpandaai\.co'/);
  assert.match(shellApp, /host === 'tempfile\.aiquickdraw\.com'/);
  assert.match(shellApp, /host === 'tempfileb\.aiquickdraw\.com'/);
  assert.match(shellApp, /const refreshExpiringMaterialUrl = type !== 'referenceVideo'/);
  assert.match(shellApp, /&& !refreshExpiringMaterialUrl/);
  assert.match(shellApp, /loadShellDraftAsset\(item\.localAssetId\)/);
  assert.match(shellApp, /uploadInternalAssetStream\(\{/);
});

test('ProjectCard is memoized and ProjectListView passes stable handlers (no inline closures)', () => {
  const card = read('../shell/components/ProjectCard.tsx');
  const listView = read('../shell/components/ProjectListView.tsx');

  // 卡片已包 memo
  assert.match(card, /export default React\.memo\(ProjectCard\)/);
  // 调用点透传稳定 handler,不再有绑 project.id 的内联闭包
  assert.match(listView, /onDeleteResult=\{onDeleteResult\}/);
  assert.match(listView, /onRegenerate=\{onRegenerateResult\}/);
  assert.match(listView, /onFission=\{onFissionResult\}/);
  assert.match(listView, /onEdit=\{onEditResult\}/);
  assert.match(listView, /onRecover=\{onRecoverResult\}/);
  assert.doesNotMatch(listView, /onDeleteResult=\{\(rid\) =>/);
});
