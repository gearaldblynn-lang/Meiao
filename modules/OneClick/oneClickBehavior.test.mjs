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
const typesSource = readFileSync(new URL('../../types.ts', import.meta.url), 'utf8');
const referencePresetUtilsSource = readFileSync(new URL('./referencePresetUtils.mjs', import.meta.url), 'utf8');
const referencePresetManagerSource = readFileSync(new URL('./ReferencePresetManager.tsx', import.meta.url), 'utf8');
const referencePresetEditorSource = readFileSync(new URL('./ReferencePresetEditorModal.tsx', import.meta.url), 'utf8');

test('one click generation prompt keeps unified Chinese hard constraints', () => {
  assert.match(mainSource, /buildOneClickImagePrompt/);
  assert.match(detailSource, /buildOneClickImagePrompt/);
  assert.match(promptUtilsSource, /【硬约束】/);
  assert.match(promptUtilsSource, /上传产品素材是产品外观、结构、比例、包装、标签信息的唯一依据/);
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

test('one click generation prompts explain that parentheses are requirements and quoted text is the only renderable copy', () => {
  assert.match(mainSource, /buildOneClickImagePrompt/);
  assert.match(detailSource, /buildOneClickImagePrompt/);
  assert.match(skuSource, /appendOneClickCopyGuardrails/);
  assert.match(promptUtilsSource, /严格按照当前方案中已经写明的文案内容与排版指令进行渲染/);
  assert.match(promptUtilsSource, /圆括号内的字体、字号字重、位置、颜色等内容仅作为排版指令理解/);
  assert.match(promptUtilsSource, /只有中文引号“”内的文字才是最终需要渲染到画面中的正文文案/);
  assert.match(promptUtilsSource, /字段名、冒号、说明文字都不得出现在最终画面中/);
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

test('one click planning and generation paths normalize legacy copy layout rows before rendering', () => {
  assert.match(mainSource, /normalizeCopyLayoutText/);
  assert.match(detailSource, /normalizeCopyLayoutText/);
  assert.match(skuSource, /normalizeCopyLayoutText/);
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
    /schemesRef\.current = schemesRef\.current\.map\(s => s\.id === scheme\.id \? \{ \.\.\.s, editedContent: e\.target\.value \} : s\)/,
    'main image editing should synchronously refresh schemesRef.current with the latest edited content'
  );
  assert.match(
    detailSource,
    /schemesRef\.current = schemesRef\.current\.map\(s => s\.id === scheme\.id \? \{ \.\.\.s, editedContent: e\.target\.value \} : s\)/,
    'detail editing should synchronously refresh schemesRef.current with the latest edited content'
  );
  assert.match(
    firstImageSource,
    /schemesRef\.current = schemesRef\.current\.map\(s => s\.id === scheme\.id \? \{ \.\.\.s, editedContent: e\.target\.value \} : s\)/,
    'first image editing should synchronously refresh schemesRef.current with the latest edited content'
  );
  assert.match(
    skuSource,
    /schemesRef\.current = schemesRef\.current\.map\(s => s\.id === scheme\.id \? \{ \.\.\.s, editedContent: e\.target\.value \} : s\)/,
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
  assert.match(skuSource, /if \(schemesRef\.current\.length > 0\) \{\s*onPrepareFreshProject\?\.\(\);\s*\}/);
  assert.match(skuSource, /if \(activeProjectId\) \{\s*onDeleteActiveProject\?\.\(\);/);
  assert.match(skuSource, /projects\.map\(\(project\) =>/);
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
  assert.match(firstImageSource, /replicationReferenceUrl: scheme\.sourceReferenceUrl/);
  assert.match(promptUtilsSource, /【图片角色】/);
  assert.match(promptUtilsSource, /【执行优先级】/);
  assert.match(promptUtilsSource, /【替换规则】/);
  assert.match(promptUtilsSource, /复刻主图参考图（图片URL）/);
  assert.match(promptUtilsSource, /必须直接复刻该参考图的整体风格、版式结构、信息层级、视觉节奏、设计细节，不得改成另一种风格/);
  assert.match(promptUtilsSource, /若执行内容中对参考图版式、颜色、结构或视觉元素的描述与复刻主图参考图真实画面不一致，必须以复刻主图参考图真实画面为准/);
  assert.match(promptUtilsSource, /品牌logo图（图片URL）/);
  assert.match(promptUtilsSource, /复刻主图参考图是最高版式基准/);
  assert.doesNotMatch(promptUtilsSource, /色调关系/);
  assert.match(promptUtilsSource, /原位置不得留空，替换为我方品牌 logo、店铺名或与版式匹配的通用信息/);
  assert.match(promptUtilsSource, /不得把产品素材图上的logo或参考图logo提取成我方独立品牌元素使用/);
  assert.match(firstImageSource, /\.\.\.\(scheme\.sourceReferenceUrl \? \[scheme\.sourceReferenceUrl\] : \[\]\)/);
  assert.match(firstImageSource, /includeCopyGuardrails: false/);
  assert.match(firstImageSource, /handleCreateVariant/);
  assert.match(firstImageSource, /换场景/);
  assert.match(firstImageSource, /换配色/);
  assert.match(firstImageSource, /自定义/);
});

test('first image generation no longer appends copy-layout rendering guardrails', () => {
  assert.match(promptUtilsSource, /includeCopyGuardrails = true/);
  assert.match(firstImageSource, /includeCopyGuardrails: false/);
});

test('first image divergence actions stay visible, avoid window.prompt, and require explicit confirmation', () => {
  assert.match(firstImageSource, /继续裂变/);
  assert.match(firstImageSource, /确认生成裂变图/);
  assert.match(firstImageSource, /variantConfirmState/);
  assert.match(firstImageSource, /继续裂变说明/);
  assert.match(firstImageSource, /onPrepareFreshProject\?\.\(\);[\s\S]*schemesRef\.current = \[nextScheme\]/);
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
  assert.match(firstImageSource, /isPlanningFailure/);
});
