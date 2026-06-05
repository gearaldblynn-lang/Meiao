import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('./MainImageSubModule.tsx', import.meta.url), 'utf8');
const firstImageSource = readFileSync(new URL('./FirstImageSubModule.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./DetailPageSubModule.tsx', import.meta.url), 'utf8');
const buyerShowSource = readFileSync(new URL('../BuyerShow/BuyerShowModule.tsx', import.meta.url), 'utf8');
const skuSource = readFileSync(new URL('./SkuSubModule.tsx', import.meta.url), 'utf8');
const oneClickModuleSource = readFileSync(new URL('./OneClickModule.tsx', import.meta.url), 'utf8');
const promptUtilsSource = readFileSync(new URL('./generationPromptUtils.ts', import.meta.url), 'utf8');
const configSidebarSource = readFileSync(new URL('./ConfigSidebar.tsx', import.meta.url), 'utf8');
const skuSidebarSource = readFileSync(new URL('./SkuSidebar.tsx', import.meta.url), 'utf8');
const shellWorkflowSource = readFileSync(new URL('../../adapters/shellWorkflow.ts', import.meta.url), 'utf8');
const shellOneClickMaterialsSource = readFileSync(new URL('../../adapters/shellOneClickMaterials.mjs', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../../types.ts', import.meta.url), 'utf8');
const referencePresetUtilsSource = readFileSync(new URL('./referencePresetUtils.mjs', import.meta.url), 'utf8');
const referencePresetManagerSource = readFileSync(new URL('./ReferencePresetManager.tsx', import.meta.url), 'utf8');
const referencePresetEditorSource = readFileSync(new URL('./ReferencePresetEditorModal.tsx', import.meta.url), 'utf8');

test('one click generation prompt keeps unified Chinese hard constraints', () => {
  assert.match(mainSource, /buildOneClickImagePrompt/);
  assert.match(detailSource, /buildOneClickImagePrompt/);
  assert.match(promptUtilsSource, /【硬约束】/);
  assert.match(promptUtilsSource, /上传产品素材是产品外观、结构、比例、包装、文字、logo 和标签信息的唯一依据/);
  assert.match(promptUtilsSource, /publicBaseUrl\?: string/);
});

test('one click analysis overlay is scoped inside module workspace instead of full-screen fixed layer', () => {
  assert.doesNotMatch(mainSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
  assert.doesNotMatch(detailSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
});

test('buyer show analysis overlay is scoped inside module workspace instead of full-screen fixed layer', () => {
  assert.doesNotMatch(buyerShowSource, /\{isAnalyzing && \(\s*<div className="fixed inset-0/);
});

test('buyer show workspace keeps download capability via single-image and batch download actions', () => {
  assert.match(buyerShowSource, /handleBatchDownload/);
  assert.match(buyerShowSource, /打包下载/);
  assert.match(buyerShowSource, /onDownload=\{handleDownloadSingle\}/);
  assert.match(buyerShowSource, /下载买家秀单图/);
});

test('one click redo flow clears stale task id before starting a brand new generation task', () => {
  assert.match(mainSource, /handleRedoSingle[\s\S]*updateSingleScheme\(schemeId, \{ status: 'generating', error: '正在准备素材\.\.\.', taskId: undefined, resultUrl: undefined \}\)/);
  assert.match(detailSource, /updateSingleScreen\(id, \{ status: 'generating', error: '正在准备素材\.\.\.', taskId: undefined, resultUrl: undefined \}\)/);
});

test('one click generation prompts keep copy rendering guardrails concise', () => {
  assert.match(mainSource, /buildOneClickImagePrompt/);
  assert.match(detailSource, /buildOneClickImagePrompt/);
  assert.match(skuSource, /appendOneClickCopyGuardrails/);
  assert.match(promptUtilsSource, /严格按照当前方案中已经写明的文案内容与排版指令进行渲染/);
  assert.match(promptUtilsSource, /投放平台：\$\{targetPlatform\}/);
  assert.doesNotMatch(promptUtilsSource, /圆括号内的字体、字号字重、位置、颜色等内容仅作为排版指令理解/);
  assert.doesNotMatch(promptUtilsSource, /只有中文引号“”内的文字才是最终需要渲染到画面中的正文文案/);
  assert.doesNotMatch(promptUtilsSource, /字段名、冒号、说明文字都不得出现在最终画面中/);
  assert.doesNotMatch(promptUtilsSource, /输出规范：/);
  assert.doesNotMatch(promptUtilsSource, /主标题（字体，字号字重，位置，颜色色值）：“xxx”/);
  assert.doesNotMatch(promptUtilsSource, /love potion/);
});

test('one click generation keeps reference analysis in planning only instead of re-appending it during image generation', () => {
  assert.doesNotMatch(mainSource, /【设计参考分析结论】/);
  assert.doesNotMatch(detailSource, /【设计参考分析结论】/);
  assert.doesNotMatch(skuSource, /【设计参考分析结论】/);
  assert.match(mainSource, /generateMarketingSchemes\(/);
  assert.match(detailSource, /generateMarketingSchemes\(/);
  assert.match(skuSource, /generateSkuSchemes\(/);
});

test('one click preview modals expose a direct download action', () => {
  assert.match(firstImageSource, /absolute top-4 right-16/);
  assert.match(mainSource, /absolute top-4 right-16/);
  assert.match(detailSource, /absolute -top-16 right-14/);
  assert.match(skuSource, /downloadRemoteFile\(previewScheme\.resultUrl!/);
  assert.match(firstImageSource, /downloadRemoteFile\(currentPreviewScheme\.resultUrl!/);
  assert.match(mainSource, /downloadRemoteFile\(currentPreviewScheme\.resultUrl!/);
  assert.match(detailSource, /downloadRemoteFile\(schemes\.find\(s => s\.id === previewId\)!\.resultUrl!/);
  assert.match(skuSource, /downloadRemoteFile\(previewScheme\.resultUrl!/);
});

test('first image single generation action label immediately reflects generating state', () => {
  assert.match(firstImageSource, /scheme\.status === 'generating' \? '生成中\.\.\.' : isPlanningFailure \? '重新策划' : \(scheme\.resultUrl \? '重新生成' : '生成该图'\)/);
});

test('one click generating task controls keep a direct interrupt action', () => {
  for (const source of [mainSource, firstImageSource, detailSource, skuSource]) {
    assert.match(source, /handleInterrupt/);
    assert.match(source, />\s*中断\s*</);
    assert.doesNotMatch(source, /中断并稍后同步/);
  }
});

test('sku batch generation waits for the first benchmark image then runs remaining selected schemes concurrently', () => {
  assert.match(skuSource, /const \[firstScheme, \.\.\.remainingSchemes\] = selected/);
  assert.match(skuSource, /const firstOk = await generateSingleSku\(firstScheme\.id, true, currentImages, 'full', null\)/);
  assert.match(skuSource, /const workerCount = Math\.max\(1, Math\.min\(Number\(apiConfig\.concurrency \|\| 1\) \|\| 1, remainingSchemes\.length\)\)/);
  assert.match(skuSource, /await Promise\.all\(Array\.from\(\{ length: workerCount \}, \(\) => runRemainingWorker\(\)\)\)/);
  assert.match(skuSource, /await generateSingleSku\(scheme\.id, false, currentImages, 'full', localFirstSkuResultUrl\)/);
  assert.doesNotMatch(skuSource, /for \(let i = 0; i < selected\.length; i\+\+\)/);
});

test('one click and buyer show never expose internal job ids as KIE task ids', () => {
  for (const source of [mainSource, firstImageSource, detailSource, skuSource, buyerShowSource]) {
    assert.match(source, /onJobCreated|任务正在提交云端|任务已提交云端，正在生成/);
    assert.doesNotMatch(source, /taskId:\s*providerTaskId\s*\|\|\s*jobId/);
    assert.doesNotMatch(source, /providerTaskId\s*\|\|\s*jobId/);
  }
  assert.match(mainSource, /backendJobId: jobId \|\| undefined/);
  assert.match(firstImageSource, /backendJobId: jobId \|\| undefined/);
  assert.match(detailSource, /backendJobId: jobId \|\| undefined/);
  assert.match(skuSource, /backendJobId: jobId \|\| undefined/);
  assert.match(buyerShowSource, /backendJobId: jobId \|\| undefined/);
});

test('one click planning and generation paths normalize legacy copy layout rows before rendering', () => {
  assert.match(mainSource, /normalizeCopyLayoutText/);
  assert.match(detailSource, /normalizeCopyLayoutText/);
  assert.match(skuSource, /normalizeCopyLayoutText/);
  assert.match(mainSource, /resolvePublicAssetUrl\(value, publicBaseUrl\) \|\| ''/);
  assert.match(detailSource, /resolvePublicAssetUrl\(value, publicBaseUrl\) \|\| ''/);
  assert.match(firstImageSource, /resolvePublicAssetUrl\(value, publicBaseUrl\) \|\| ''/);
});

test('detail generation keeps editable design-intent text instead of stripping it before image prompting', () => {
  assert.doesNotMatch(
    detailSource,
    /设计意图\/\.test\(l\)\) return false;/,
    'detail generation should not drop the visible design-intent line after the user edits it'
  );
});

test('one click editing synchronously refreshes the in-memory scheme ref before regeneration can read it', () => {
  assert.match(
    mainSource,
    /editedContent: e\.target\.value/,
    'main image editing should synchronously refresh schemesRef.current with the latest edited content'
  );
  assert.match(
    detailSource,
    /schemesRef\.current = schemesRef\.current\.map\(s => s\.id === scheme\.id \? \{ \.\.\.s, editedContent: e\.target\.value \} : s\)/,
    'detail editing should synchronously refresh schemesRef.current with the latest edited content'
  );
  assert.match(
    firstImageSource,
    /editedContent: e\.target\.value/,
    'first image editing should synchronously refresh schemesRef.current with the latest edited content'
  );
  assert.match(
    skuSource,
    /editedContent: e\.target\.value/,
    'sku editing should synchronously refresh schemesRef.current with the latest edited content'
  );
});

test('main image planning flow exposes a real cancel path that aborts the active analysis job', () => {
  assert.match(mainSource, /const handleCancelAnalysis = async \(\) =>/);
  assert.match(mainSource, /globalAbortRef\.current\?\.abort\(\)/);
  assert.match(mainSource, /analysisJobIdRef\.current/);
  assert.match(mainSource, /await cancelInternalJob\(analysisJobIdRef\.current\)/);
  assert.match(mainSource, /取消策划/);
});

test('main image planning keeps task-not-found sync gaps recoverable instead of logging plan failure', () => {
  const planningBlock = mainSource.match(/const handleStartAnalysis = async \(\) => \{[\s\S]*?const handleCancelAnalysis = async/)?.[0] || '';

  assert.match(
    planningBlock,
    /if \(res\.status === 'task_not_found'\) \{[\s\S]*AI 分析任务已提交云端，结果待同步/,
    'main-image planning should show a recoverable sync message when KIE says task_not_found',
  );
  assert.match(
    planningBlock,
    /return;[\s\S]*\} else \{[\s\S]*message: '主图策划失败'/,
    'recoverable planning sync gaps should exit before the ordinary failed-plan log path',
  );
});

test('one click workspace only mounts the active submodule to avoid hidden-module side effects', () => {
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.MAIN_IMAGE \? \(/);
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.DETAIL_PAGE \? \(/);
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.SKU \? \(/);
  assert.doesNotMatch(oneClickModuleSource, /className=\{`h-full w-full flex overflow-hidden \$\{subMode === OneClickSubMode\.MAIN_IMAGE \? '' : 'hidden'\}`\}/);
});

test('one click exposes first image as an independent submodule tab', () => {
  assert.match(typesSource, /FIRST_IMAGE = 'first_image'/);
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.FIRST_IMAGE \? \(/);
  assert.match(oneClickModuleSource, /state=\{persistentState\.firstImage\}/);
  assert.match(configSidebarSource, /value: OneClickSubMode\.FIRST_IMAGE, label: '首图'/);
  assert.match(skuSidebarSource, /value: OneClickSubMode\.FIRST_IMAGE, label: '首图'/);
});

test('one click workspace persists multiple projects instead of overwriting the current one', () => {
  assert.match(typesSource, /projects: OneClickWorkspaceProject\[\];/);
  assert.match(typesSource, /projects: SkuWorkspaceProject\[\];/);
  assert.match(typesSource, /activeProjectId: string \| null;/);
  assert.match(typesSource, /isDraft\?: boolean;/);
  assert.match(oneClickModuleSource, /onPrepareFreshProject=\{\(\) => prepareFreshMainLikeProject\('firstImage', '首图'\)\}/);
  assert.match(oneClickModuleSource, /onPrepareFreshProject=\{\(\) => prepareFreshMainLikeProject\('mainImage', '主图'\)\}/);
  assert.match(oneClickModuleSource, /onPrepareFreshProject=\{\(\) => prepareFreshMainLikeProject\('detailPage', '详情'\)\}/);
  assert.match(oneClickModuleSource, /onPrepareFreshProject=\{\(\) => prepareFreshSkuProject\('SKU'\)\}/);
  assert.match(oneClickModuleSource, /const requestDeleteMainLikeProject = \(/);
  assert.match(oneClickModuleSource, /const requestDeleteSkuProject = \(projectId\?: string \| null\) =>/);
  assert.match(oneClickModuleSource, /onDeleteProject=\{\(projectId\) => requestDeleteMainLikeProject\('firstImage', '首图', projectId\)\}/);
  assert.match(oneClickModuleSource, /onDeleteProject=\{\(projectId\) => requestDeleteMainLikeProject\('mainImage', '主图', projectId\)\}/);
  assert.match(oneClickModuleSource, /onDeleteProject=\{\(projectId\) => requestDeleteMainLikeProject\('detailPage', '详情', projectId\)\}/);
  assert.match(oneClickModuleSource, /onDeleteProject=\{\(projectId\) => requestDeleteSkuProject\(projectId\)\}/);
  assert.match(oneClickModuleSource, /isDraft: true/);
  assert.match(oneClickModuleSource, /if \(!current\.activeProjectId && hasMainLikeContent\(current\) && nextProjects\.length === 0\)/);
  assert.match(oneClickModuleSource, /if \(!current\.activeProjectId && hasSkuContent\(current\) && nextProjects\.length === 0\)/);
  assert.match(skuSource, /onPrepareFreshProject/);
  assert.match(skuSource, /if \(activeProjectId\) \{\s*onDeleteActiveProject\?\.\(\);/);
  assert.match(skuSource, /projects\.map\(\(project\) =>/);
  assert.match(mainSource, /const shouldPrepareFreshProject = !activeProjectId \|\| schemesRef\.current\.length > 0;/);
  assert.match(detailSource, /const shouldPrepareFreshProject = !activeProjectId \|\| schemesRef\.current\.length > 0;/);
  assert.match(firstImageSource, /const shouldPrepareFreshProject = !activeProjectId \|\| schemesRef\.current\.length > 0;/);
  assert.match(skuSource, /const shouldPrepareFreshProject = !activeProjectId \|\| schemesRef\.current\.length > 0;/);
  assert.match(mainSource, /if \(shouldPrepareFreshProject\) onPrepareFreshProject\?\.\(\);[\s\S]*setIsAnalyzing\(true\);/);
  assert.match(detailSource, /if \(shouldPrepareFreshProject\) onPrepareFreshProject\?\.\(\);[\s\S]*setIsAnalyzing\(true\);/);
  assert.match(firstImageSource, /if \(shouldPrepareFreshProject\) onPrepareFreshProject\?\.\(\);[\s\S]*setIsAnalyzing\(true\);/);
  assert.match(skuSource, /if \(shouldPrepareFreshProject\) onPrepareFreshProject\?\.\(\);[\s\S]*setIsAnalyzing\(true\);/);
});

test('one click workspace shows stacked project cards with direct delete actions instead of chip switching', () => {
  assert.match(firstImageSource, /方案 \$\{project\.schemes\.length\} 个/);
  assert.match(mainSource, /方案 \$\{project\.schemes\.length\} 个/);
  assert.match(detailSource, /方案 \$\{project\.schemes\.length\} 个/);
  assert.match(skuSource, /方案 \$\{project\.schemes\.length\} 个/);
  assert.match(firstImageSource, /onDeleteProject\?\.\(project\.id\)/);
  assert.match(mainSource, /onDeleteProject\?\.\(project\.id\)/);
  assert.match(detailSource, /onDeleteProject\?\.\(project\.id\)/);
  assert.match(skuSource, /onDeleteProject\?\.\(project\.id\)/);
  assert.match(firstImageSource, /当前项目/);
  assert.doesNotMatch(firstImageSource, /flex-wrap gap-2/);
});

test('first image module keeps main image behavior while using first image labels', () => {
  assert.match(firstImageSource, /subMode: 'first_image'/);
  assert.match(firstImageSource, /OneClickSubMode\.FIRST_IMAGE/);
  assert.match(firstImageSource, /generateFirstImageReplicationSchemes\(/);
  assert.match(firstImageSource, /handleBatchDownload/);
  assert.match(firstImageSource, /handleRedoSingle/);
  assert.match(firstImageSource, /handleCancelAnalysis/);
  assert.match(firstImageSource, /首图/);
  assert.match(firstImageSource, /first_image_\$\{i \+ 1\}\.png/);
});

test('first image sidebar now behaves as replication-driven hero-image workflow', () => {
  assert.match(configSidebarSource, /上传主图参考/);
  assert.match(configSidebarSource, /支持多张上传/);
  assert.match(configSidebarSource, /系统会按主图参考数量逐张策划复刻裂变方案/);
  assert.match(configSidebarSource, /产品信息及卖点/);
  assert.match(configSidebarSource, /裂变数量由主图参考图数量自动决定/);
  assert.match(configSidebarSource, /首图配色/);
  assert.match(configSidebarSource, /商品自适应/);
  assert.match(configSidebarSource, /参考图基准/);
  assert.doesNotMatch(configSidebarSource, /const selectedFiles = isFirstImage \? files\.slice\(0, 1\)/);
  assert.match(configSidebarSource, /const selectedFiles = files\.slice\(0, 8 - designReferences\.length\)/);
  assert.match(configSidebarSource, /onDesignReferencesChange\(\[\.\.\.designReferences, \.\.\.next\]\)/);
  assert.doesNotMatch(configSidebarSource, /仅 1 张，直接作为首图风格参考/);
  assert.doesNotMatch(configSidebarSource, /copy_content/);
});

test('first image generation prompt explicitly identifies the replication main-image reference url', () => {
  assert.match(firstImageSource, /buildOneClickImagePrompt/);
  assert.match(firstImageSource, /replicationReferenceUrl: isContinueVariation \? null : scheme\.sourceReferenceUrl/);
  assert.match(promptUtilsSource, /【图片角色】/);
  assert.match(promptUtilsSource, /【执行优先级】/);
  assert.match(promptUtilsSource, /【替换规则】/);
  assert.match(promptUtilsSource, /复刻主图参考图（图片URL）：\$\{safeReferenceUrl\}/);
  assert.match(promptUtilsSource, /必须直接复刻该参考图的整体风格、版式结构、信息层级、视觉节奏、设计细节，不得改成另一种风格/);
  assert.match(promptUtilsSource, /若执行内容中对参考图版式、颜色、结构或视觉元素的描述与复刻主图参考图真实画面不一致，必须以复刻主图参考图真实画面为准/);
  assert.match(promptUtilsSource, /商品区的位置、角度、大小关系、层级、道具关系和背景以复刻主图参考原商品区为准/);
  assert.match(promptUtilsSource, /产品素材只决定替换进去的商品本体/);
  assert.match(promptUtilsSource, /产品包装上的文字、logo、品牌名和标签信息不得去除或改写/);
  assert.match(promptUtilsSource, /品牌logo图（图片URL）：\$\{safeLogoUrl\}/);
  assert.match(promptUtilsSource, /复刻主图参考图是最高版式基准/);
  assert.doesNotMatch(promptUtilsSource, /色调关系/);
  assert.match(promptUtilsSource, /未上传品牌 logo 时，品牌\/店铺\/logo\/官方背书位统一写通用信息/);
  assert.match(promptUtilsSource, /不写官方自营\/旗舰店或具体品牌名/);
  assert.match(promptUtilsSource, /若执行内容写了具体品牌\/店铺\/logo文字，改用通用信息/);
  assert.match(promptUtilsSource, /不得把产品素材图上的logo或参考图logo提取成我方独立品牌元素使用/);
  assert.match(firstImageSource, /publicBaseUrl,/);
  assert.match(firstImageSource, /\.\.\.\(scheme\.sourceReferenceUrl \? \[scheme\.sourceReferenceUrl\] : \[\]\)/);
  assert.match(firstImageSource, /platform: config\.platform/);
  assert.doesNotMatch(firstImageSource, /includeCopyGuardrails: false/);
  assert.match(firstImageSource, /handleCreateVariant/);
  assert.match(firstImageSource, /换场景/);
  assert.match(firstImageSource, /换配色/);
  assert.match(firstImageSource, /自定义/);
});

test('first image generation appends target-language rendering guardrails', () => {
  assert.match(promptUtilsSource, /includeCopyGuardrails = true/);
  assert.match(firstImageSource, /platform: config\.platform/);
  assert.doesNotMatch(firstImageSource, /includeCopyGuardrails: false/);
});

test('first image continuation variants use the generated result as primary base and product assets only for consistency', () => {
  assert.match(promptUtilsSource, /const buildOneClickVariationPrompt =/);
  assert.match(promptUtilsSource, /【裂变基准图】/);
  assert.match(promptUtilsSource, /【原素材参考图】/);
  assert.match(promptUtilsSource, /【任务需求】/);
  assert.match(promptUtilsSource, /【约束规范】/);
  assert.match(promptUtilsSource, /随 input_urls 一起上传的原商品素材图，用于保持产品外观/);
  assert.match(promptUtilsSource, /以裂变基准图为直接修改基础，保持其画面结构、构图、排版骨架、卖点信息、信息层级和文案位置不变/);
  assert.match(promptUtilsSource, /若自定义任务明确要求修改某个卖点、文案或局部信息，只修改对应内容/);
  assert.doesNotMatch(promptUtilsSource, /基础裂变图（最高优先级）/);
  assert.doesNotMatch(promptUtilsSource, /【文案规则】/);
  assert.match(promptUtilsSource, /if \(previousResultUrl && variationInstruction\?\.trim\(\)\)/);
  assert.match(firstImageSource, /const isContinueVariation = Boolean\(scheme\.sourceResultUrl && scheme\.variationInstruction\?\.trim\(\)\)/);
  assert.match(firstImageSource, /const inputImages = isContinueVariation[\s\S]*scheme\.sourceResultUrl![\s\S]*\.\.\.productUrls/);
  assert.match(firstImageSource, /replicationReferenceUrl: isContinueVariation \? null : scheme\.sourceReferenceUrl/);
  assert.match(firstImageSource, /hasProductReferences: productUrls\.length > 0/);
  assert.match(shellWorkflowSource, /buildShellImageInputUrls/);
  assert.match(shellOneClickMaterialsSource, /const hasVariationInstruction = Boolean\(String\(taskMetadata\?\.variationInstruction/);
  assert.match(shellOneClickMaterialsSource, /if \(sourceResultUrl && hasVariationInstruction\) \{\s*return dedupeUrls\(\[sourceResultUrl, \.\.\.productImageUrls/);
  assert.match(shellWorkflowSource, /hasProductReferences: \(input\.materials\.product \|\| \[\]\)\.length > 0/);
});

test('one click result edit uses generated image as baseline, product assets for consistency, and optional supplement images by semantic need', () => {
  assert.match(promptUtilsSource, /export const buildOneClickResultEditPrompt =/);
  assert.match(promptUtilsSource, /【修改基准图】/);
  assert.match(promptUtilsSource, /【原素材商品图】/);
  assert.match(promptUtilsSource, /【补充参考图】/);
  assert.match(promptUtilsSource, /【任务需求】/);
  assert.match(promptUtilsSource, /【约束规范】/);
  assert.match(promptUtilsSource, /产品一致性默认以原素材商品图为准/);
  assert.match(promptUtilsSource, /若任务需求明确说明补充参考图是新的产品、包装、局部替换或新增元素参考/);
  assert.match(promptUtilsSource, /生成新结果，保留原图/);
  assert.match(promptUtilsSource, /if \(previousResultUrl && editInstruction\?\.trim\(\)\)/);
  assert.match(shellWorkflowSource, /buildShellImageInputUrls/);
  assert.match(shellOneClickMaterialsSource, /const hasEditInstruction = Boolean\(String\(taskMetadata\?\.editInstruction/);
  assert.match(shellWorkflowSource, /const productImageUrls = \(input\.materials\.product \|\| \[\]\)\.map/);
  assert.match(shellWorkflowSource, /const supplementalImageUrls = \(input\.materials\.reference \|\| \[\]\)\.map/);
  assert.match(shellOneClickMaterialsSource, /if \(sourceResultUrl && hasEditInstruction\) \{\s*return dedupeUrls\(\[\.\.\.productImageUrls, \.\.\.giftImageUrls, sourceResultUrl, \.\.\.logoImageUrls\]\)/);
  assert.match(shellWorkflowSource, /editInstruction: typeof input\.taskMetadata\?\.editInstruction === 'string'/);
});

test('first image divergence actions stay visible, avoid window.prompt, and require explicit confirmation', () => {
  assert.match(firstImageSource, /继续裂变/);
  assert.match(firstImageSource, /确认生成裂变图/);
  assert.match(firstImageSource, /variantConfirmState/);
  assert.match(firstImageSource, /继续裂变说明/);
  const variantBlock = firstImageSource.match(/const handleCreateVariant = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(variantBlock, /onPrepareFreshProject\?\.\(\);[\s\S]*schemesRef\.current = \[nextScheme\]/);
  assert.match(variantBlock, /schemesRef\.current = \[nextScheme\]/);
  assert.doesNotMatch(firstImageSource, /window\.prompt\(/);
});

test('reference preset content is split by submode: first image and sku save images only while main and detail keep analysis results', () => {
  assert.match(typesSource, /contentType: 'images_only' \| 'images_with_analysis';/);
  assert.match(referencePresetUtilsSource, /const buildPresetContentType = \(subMode\) =>/);
  assert.match(referencePresetUtilsSource, /subMode === OneClickSubMode\.FIRST_IMAGE \|\| subMode === OneClickSubMode\.SKU/);
  assert.match(referencePresetUtilsSource, /const contentType = buildPresetContentType\(subMode\)/);
  assert.match(referencePresetUtilsSource, /summary: ''/);
  assert.match(referencePresetUtilsSource, /detail: ''/);
  assert.match(referencePresetUtilsSource, /const shouldRestoreAnalysis = preset\.contentType === 'images_with_analysis'/);
  assert.match(referencePresetUtilsSource, /summary: shouldRestoreAnalysis \? preset\.summary : ''/);
  assert.match(referencePresetManagerSource, /preset\.contentType === 'images_only'/);
  assert.match(referencePresetManagerSource, /仅保存参考图/);
  assert.match(referencePresetManagerSource, /图片 \+ 分析结果/);
  assert.match(referencePresetEditorSource, /draft\.contentType === 'images_with_analysis'/);
  assert.match(referencePresetEditorSource, /分析摘要/);
  assert.match(referencePresetEditorSource, /分析结果/);
});

test('first image planning keeps partial success when one reference task fails', () => {
  assert.match(firstImageSource, /res\.perReferenceResults/);
  assert.match(firstImageSource, /status: 'error'/);
  assert.match(firstImageSource, /error: item\.message \|\| '当前参考图策划失败'/);
  assert.match(firstImageSource, /const successCount = initialSchemes\.filter\(item => item\.status !== 'error'\)\.length/);
  assert.match(firstImageSource, /const failureCount = initialSchemes\.length - successCount/);
  assert.match(firstImageSource, /failureCount > 0/);
  assert.doesNotMatch(firstImageSource, /onUpdate\(\{\s*schemes: prev\.schemes\.map\(s => targetIds\.includes\(s\.id\) \? \{ \.\.\.s, status: 'error'/);
});

test('first image failed planning cards can retry planning for their own reference image', () => {
  assert.match(firstImageSource, /const handleRetryPlanning = async \(schemeId: string\) =>/);
  assert.match(firstImageSource, /generateFirstImageReplicationSchemes\(\s*productUrls,\s*\[targetScheme\.sourceReferenceUrl\]/);
  assert.match(firstImageSource, /当前参考图正在重新策划\.\.\./);
  assert.match(firstImageSource, /重新策划/);
  assert.match(firstImageSource, /planningFailed: true/);
  assert.match(firstImageSource, /scheme\.planningFailed/);
});
