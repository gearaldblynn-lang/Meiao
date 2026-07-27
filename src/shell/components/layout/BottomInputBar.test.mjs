import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = () => readFileSync(new URL('./BottomInputBar.tsx', import.meta.url), 'utf8');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('bottom input uses shared composer visual primitives', () => {
  const bottomInputBar = source();
  const primitivesUrl = new URL('./ComposerPrimitives.tsx', import.meta.url);

  assert.equal(existsSync(primitivesUrl), true, 'shared composer primitives should exist');
  const primitives = read('./ComposerPrimitives.tsx');
  assert.match(bottomInputBar, /from '.\/ComposerPrimitives'/);
  assert.match(bottomInputBar, /<ComposerSurface/);
  assert.match(bottomInputBar, /<ComposerToolbar/);
  assert.match(bottomInputBar, /<ComposerSelect/);
  assert.match(bottomInputBar, /<ComposerSubmitButton/);
  assert.doesNotMatch(bottomInputBar, /const CompactSelect:/);
  assert.match(primitives, /max-w-\[896px\]/);
  assert.match(primitives, /rounded-3xl border/);
});

test('logo replacement exposes one AI generation plus deterministic region and alpha protection', () => {
  const bottomInputBar = source();
  const workflow = read('../../../adapters/shellWorkflow.ts');
  const activeLogoWorkflow = workflow.match(/const runLogoReplaceWorkflow = async[\s\S]*?const runProductReplaceWorkflow = async/)?.[0] || '';
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const logoQuickParams = bottomInputBar.match(/const getLogoReplaceQuickParams = [\s\S]*?const getQuickParamsForModule/)?.[0] || '';
  const placeholderBlock = bottomInputBar.match(/const getPlaceholderForContext = [\s\S]*?const getGenerateLabelForContext/)?.[0] || '';

  assert.match(logoQuickParams, /key: 'replacementLogic'/);
  assert.match(logoQuickParams, /单Logo替换/);
  assert.match(logoQuickParams, /多Logo替换/);
  assert.doesNotMatch(logoQuickParams, /单Logo框选|多Logo框选/);
  assert.doesNotMatch(logoQuickParams, /key: 'logoReplaceRenderMode'|program_guarded|程序兜底|KIE直出/);

  assert.match(bottomInputBar, /const LOGO_REGION_REPLACE_PLACEHOLDER = '框选用于告诉 AI 要替换哪个 Logo，覆盖大致位置即可；系统会识别实际标识边界，并根据物体表面或画面角标选择融合方式。';/);
  assert.doesNotMatch(bottomInputBar, /选框必须完整包住|最终允许占用的范围/);
  assert.doesNotMatch(bottomInputBar, /为新Logo的完整图形、主标和副标预留空间/);
  assert.match(placeholderBlock, /single_logo_region_replace/);
  assert.match(placeholderBlock, /multi_logo_replace/);
  assert.match(placeholderBlock, /return LOGO_REGION_REPLACE_PLACEHOLDER/);

  assert.doesNotMatch(shellApp, /logoReplaceRenderMode: params\.logoReplaceRenderMode \|\| 'program_guarded'/);
  assert.match(bottomInputBar, /replacementRequirement: String\(region\?\.replacementRequirement \|\| ''\)\.trim\(\)/);
  assert.match(bottomInputBar, /当前区域替换要求/);
  assert.match(bottomInputBar, /value=\{String\(activeRegion\.replacementRequirement \|\| ''\)\}/);
  assert.match(bottomInputBar, /replacementRequirement: event\.target\.value/);
  assert.match(activeLogoWorkflow, /ai_native_analysis_generation_v7_semantic_blend_guard/);
  assert.match(activeLogoWorkflow, /completeLogoReplaceResultLifecycle/);
  assert.doesNotMatch(activeLogoWorkflow, /validateLogoReplacementResult|logo_replace_quality_check/);
  assert.doesNotMatch(activeLogoWorkflow, /program_guarded|createGuardedMultiLogoReplaceResultBlob/);
});

test('logo replacement selection frame keeps the coordinate layer aligned to the contained image', () => {
  const bottomInputBar = source();

  assert.match(
    bottomInputBar,
    /width: `min\(100%, calc\(\(min\(60vh, 680px\) - 24px\) \* \$\{referenceRatio\}\)\)`/,
  );
  assert.doesNotMatch(
    bottomInputBar,
    /width: referenceRatio >= 1 \? '100%' : `calc\(min\(60vh, 680px\) \* \$\{referenceRatio\}\)`/,
  );
});

test('one click shell params are subfeature-aware and do not expose fake style preset entry', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /getQuickParamsForModule/);
  assert.match(bottomInputBar, /getExtendedSectionsForModule/);
  assert.doesNotMatch(bottomInputBar, /title: '风格预设'/);
  assert.doesNotMatch(bottomInputBar, /key: 'preset'/);
  assert.match(bottomInputBar, /mode === '首图'/);
  assert.match(bottomInputBar, /首图配色/);
  assert.match(bottomInputBar, /module !== AppModuleObj\.VIDEO \|\| activeSubFeature !== 'storyboard'/);
  assert.match(bottomInputBar, /key: 'planningLogic'/);
  assert.match(bottomInputBar, /options: \['AI直出', '套图复刻'\]/);
});

test('shell image quality options follow the selected model and downgrade legacy 4K on model switch', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /getQualityOptionsForModel/);
  assert.match(bottomInputBar, /getQualityForModelSwitch/);
  assert.match(bottomInputBar, /withImageModelQualityOptions/);
  assert.match(bottomInputBar, /currentParams\.model/);
  assert.match(bottomInputBar, /onParamChange\('quality',\s*nextQuality\)/);
});

test('model replacement exposes both supported replacement scopes', () => {
  const bottomInputBar = source();
  const params = bottomInputBar.match(/const getModelReplaceQuickParams[\s\S]*?const getLogoReplaceModeLabel/)?.[0] || '';

  assert.match(params, /key: 'replacementScope'/);
  assert.match(params, /value: 'identity_only', label: '身份替换'/);
  assert.match(params, /value: 'full_person', label: '整体人物'/);
  assert.match(params, /defaultValue: 'identity_only'/);
});

test('shell select params support old frontend custom platform and language input flow', () => {
  const bottomInputBar = source();
  const composerPrimitives = read('./ComposerPrimitives.tsx');
  const selectSources = `${bottomInputBar}\n${composerPrimitives}`;

  assert.match(selectSources, /allowCustom\?: boolean/);
  assert.match(selectSources, /customInputs/);
  assert.match(selectSources, /\+ 自定义/);
  assert.match(selectSources, /请输入自定义/);
  assert.match(bottomInputBar, /platform/);
  assert.match(bottomInputBar, /key: 'lang'/);
  assert.match(bottomInputBar, /label: '目标文案语言'/);
  assert.match(bottomInputBar, /英语（English）/);
  assert.match(bottomInputBar, /中文（Chinese）/);
});

test('one click exposes sku naming as a dedicated bottom action instead of burying it under more params', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /skuNamingOpen/);
  assert.match(bottomInputBar, /SKU 命名/);
  assert.match(bottomInputBar, /skuCopyText_/);
  assert.match(bottomInputBar, /isSkuMode/);
  assert.match(bottomInputBar, /p\.key === 'mode' && renderSkuNamingAction/);
  assert.match(bottomInputBar, /生成张数/);
  assert.match(bottomInputBar, /产品名称和卖点沿用主输入框/);
  assert.match(bottomInputBar, /mode === 'SKU'\) return getOneClickBaseParams\(mode\)/);
});

test('sku placeholder explains product info fallback and allows empty main prompt', () => {
  const bottomInputBar = source();
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const workflow = read('../../../adapters/shellWorkflow.ts');

  assert.match(
    bottomInputBar,
    /1\.填写产品信息后会根据产品信息书写主标题，无产品信息则SKU文案为主标题\\n2\.尽量填写产品规格，如：净含量：100g（10g\*10条）/,
  );
  assert.match(shellApp, /allowEmptySkuPrompt/);
  assert.match(shellApp, /targetModule === AppModuleObj\.ONE_CLICK && targetSubFeature === 'sku'/);
  assert.match(shellApp, /skuCopyText_0/);
  assert.doesNotMatch(workflow, /firstParam\(input\.params, \['skuProductInfo', 'productInfo'\], input\.prompt\.trim\(\)\)/);
});

test('one click shell ratio defaults follow live shell mode rules for 3001', () => {
  const bottomInputBar = source();
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const workflow = read('../../../adapters/shellWorkflow.ts');

  assert.match(bottomInputBar, /const getOneClickBaseParams = \(mode: string\): ParamItem\[\] =>/);
  assert.match(bottomInputBar, /mode === '详情页'[\s\S]*defaultValue: 'auto'/);
  assert.match(bottomInputBar, /mode === '详情页'[\s\S]*recommendedValue: 'auto'/);
  assert.match(bottomInputBar, /mode === '详情页'[\s\S]*secondaryRecommendedValue: '3:4'/);
  assert.match(bottomInputBar, /defaultValue: '1:1'[\s\S]*recommendedValue: '1:1'/);
  assert.match(shellApp, /detail_page: \{ label: '详情页', ratio: 'auto' \}/);
  assert.match(workflow, /input\.subFeature === 'detail_page' \? AspectRatio\.AUTO : AspectRatio\.SQUARE/);
});

test('translation remove-text quick params hide target language and recommend auto ratio only', () => {
  const bottomInputBar = source();
  const translationQuickParams = bottomInputBar.match(/const getTranslationQuickParams[\s\S]*?const getTranslationSizeDefaults/)?.[0] || '';
  const translationExtendedParams = bottomInputBar.match(/if \(module === AppModuleObj\.TRANSLATION\) \{[\s\S]*?if \(module !== AppModuleObj\.ONE_CLICK\)/)?.[0] || '';

  assert.match(translationQuickParams, /\.\.\.\(isRemoveText \? \[\] : \[\{/);
  assert.match(translationQuickParams, /options: isRemoveText \? \['AI直出'\] : \['AI直出', 'AI优化'\]/);
  assert.match(translationQuickParams, /key: 'translationScope'/);
  assert.ok(
    translationQuickParams.indexOf("key: 'translationGenerationMode'") < translationQuickParams.indexOf("key: 'translationScope'"),
    'translation scope should appear after generation mode',
  );
  assert.ok(
    translationQuickParams.indexOf("key: 'translationScope'") < translationQuickParams.indexOf("key: 'lang'"),
    'translation scope should appear before target language',
  );
  assert.match(translationQuickParams, /title: '翻译范围'/);
  assert.match(translationQuickParams, /options: \['产品隔离', '全局翻译'\]/);
  assert.match(translationQuickParams, /title: '目标语言'/);
  assert.doesNotMatch(translationQuickParams, /key: 'ratio'/);
  assert.doesNotMatch(translationQuickParams, /secondaryRecommendedValue:/);
  assert.match(translationExtendedParams, /key: 'ratio'/);
  assert.match(translationExtendedParams, /defaultValue: isDetail \|\| isRemoveText \? 'auto' : '1:1'/);
});

test('translation integration exposes ai optimize mode and original-size generation contract', () => {
  const bottomInputBar = source();
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const workflow = read('../../../adapters/shellWorkflow.ts');
  const translationRetryUtils = read('../../../modules/Translation/translationRetryUtils.mjs');
  const translationQuickParams = bottomInputBar.match(/const getTranslationQuickParams[\s\S]*?const getTranslationSizeDefaults/)?.[0] || '';
  const translationExtendedParams = bottomInputBar.match(/if \(module === AppModuleObj\.TRANSLATION\) \{[\s\S]*?if \(module !== AppModuleObj\.ONE_CLICK\)/)?.[0] || '';
  const translationNormalizer = shellApp.match(/const normalizeTranslationParamsForGeneration[\s\S]*?^};/m)?.[0] || '';

  assert.match(translationQuickParams, /key: 'translationGenerationMode'/);
  assert.match(translationQuickParams, /options: isRemoveText \? \['AI直出'\] : \['AI直出', 'AI优化'\]/);
  assert.match(translationQuickParams, /defaultValue: 'AI直出'/);
  assert.ok(
    translationQuickParams.indexOf("key: 'translationGenerationMode'") < translationQuickParams.indexOf("key: 'lang'"),
    'translation generation mode should appear before target language',
  );
  assert.doesNotMatch(
    translationQuickParams.match(/\{ key: 'translationGenerationMode'[\s\S]*?\}/)?.[0] || '',
    /recommendedLabel: '默认'|recommendedValue: 'AI直出'/,
  );
  assert.doesNotMatch(translationQuickParams, /key: 'ratio'/);
  assert.match(translationExtendedParams, /key: 'ratio'/);
  assert.match(translationExtendedParams, /disabled: isOriginalSizeMode/);
  assert.match(translationNormalizer, /translationGenerationMode: \['AI优化', '策划分析'\]\.includes\(params\.translationGenerationMode\) \? 'AI优化' : 'AI直出'/);
  assert.match(translationNormalizer, /translationScope: String\(params\.translationScope/);
  assert.match(translationNormalizer, /ratio: isOriginalSizeMode \? 'auto' : \(params\.ratio \|\| params\.aspectRatio \|\| defaults\.ratio\)/);
  assert.match(shellApp, /runShellTranslationPlanningAnalysis/);
  assert.match(shellApp, /useTranslationPlanningAnalysis = targetSubFeature !== 'remove_text'[\s\S]*?\['AI优化', '策划分析'\]\.includes\(generationParams\.translationGenerationMode\)/);
  assert.match(translationRetryUtils, /所有替换文案必须逐字照抄 AI优化结果中右侧引号内的本地化文案/);
  assert.match(shellApp, /throw new Error\('原图尺寸读取失败，请重新上传素材后再生成。'\)/);
  assert.match(shellApp, /finalSize,/);
  assert.match(shellApp, /createTranslationConfigSnapshot/);
  assert.match(shellApp, /translationConfigSnapshot/);
  assert.match(shellApp, /taskMetadata: translationTaskMetadata/);
  assert.match(workflow, /export const runShellTranslationPlanningAnalysis/);
  assert.match(workflow, /const isTranslationAiOptimizeMode = input\.subFeature !== 'remove_text'[\s\S]*?\['AI优化', '策划分析'\]\.includes\(input\.params\.translationGenerationMode\)/);
  assert.match(workflow, /input\.module === AppModule\.TRANSLATION && config\.resolutionMode === 'original'[\s\S]*input\.taskMetadata\?\.finalSize/);
});

test('one click upload menu keeps subfeature-aware reference preset library entries visible', () => {
  const bottomInputBar = source();
  const presetLibrary = read('../PresetLibrary.tsx');

  assert.match(bottomInputBar, /PresetLibrary/);
  assert.match(bottomInputBar, /oneClickPresetLibraryOpen/);
  assert.match(bottomInputBar, /getOneClickPresetKind/);
  assert.match(bottomInputBar, /预设库/);
  assert.match(bottomInputBar, /onApplyOneClickPresets/);
  assert.match(bottomInputBar, /lockedKind=\{getOneClickPresetKind\(\)\}/);
  assert.match(bottomInputBar, /type: preset\.type === 'logo' \? 'logo' : 'styleRef'/);
  assert.match(bottomInputBar, /if \(mode === 'SKU'\) return \['product', 'gift', 'styleRef'\]/);
  assert.match(bottomInputBar, /return \['product', 'logo', 'styleRef'\]/);
  assert.match(bottomInputBar, /grid grid-cols-2/);
  assert.match(bottomInputBar, /素材上传/);
  assert.match(bottomInputBar, /Logo上传/);
  assert.match(bottomInputBar, /风格参考/);
  assert.match(bottomInputBar, /mode === 'SKU'\) return \['product', 'gift', 'styleRef'\]/);
  assert.doesNotMatch(presetLibrary, /AIGC_APP_STATE_V1/);
  assert.doesNotMatch(presetLibrary, /localStorage\.getItem/);
});

test('one click main image set replication hides presets and uses reference suite count', () => {
  const bottomInputBar = source();
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const workflow = read('../../../adapters/shellWorkflow.ts');
  const promptUtils = read('../../../modules/OneClick/generationPromptUtils.ts');

  assert.match(bottomInputBar, /isMainImageSuiteReplication/);
  assert.match(bottomInputBar, /currentParams\.planningLogic === '套图复刻'/);
  assert.match(bottomInputBar, /mode === '主图' && currentParams\.planningLogic === '套图复刻'\) return getOneClickBaseParams\(mode\)/);
  assert.match(bottomInputBar, /mode === '首图' \|\| isMainImageSuiteReplication/);
  assert.match(bottomInputBar, /return '参考套图'/);
  assert.match(bottomInputBar, /return '整套主图参考，最多5张'/);
  assert.match(bottomInputBar, /const activeStyleRefCount = \(materials\.styleRef \|\| \[\]\)[\s\S]*item\.subFeature === activeSubFeature[\s\S]*\.length;/);
  assert.match(bottomInputBar, /billingParams = isDetailPageSuiteReplication[\s\S]*isMainImageSuiteReplication[\s\S]*count: String\(activeStyleRefCount\)/);
  assert.match(bottomInputBar, /count: String\(activeStyleRefCount\), exactCount: 'true'/);
  assert.match(bottomInputBar, /!\s*\(isMainImageSuiteReplication \|\| isDetailPageSuiteReplication\) && \(/);
  assert.match(shellApp, /参考套图最多上传 5 张/);
  assert.match(shellApp, /selectedFiles = selectedFiles\.slice\(0, remaining\)/);
  assert.match(workflow, /generateMainImageSetReplicationSchemes/);
  assert.match(workflow, /firstParam\(input\.params, \['planningLogic'\], ''\) === '套图复刻'/);
  assert.match(workflow, /getOneClickReferenceUrls\(input\)\.slice\(0, 5\)/);
  assert.match(workflow, /\{ \.\.\.buildOneClickConfig\(input\), count: referenceUrls\.length \}/);
  assert.match(workflow, /result\.schemes\.map\(\(scheme, index\) => toShellPlan\(scheme, index, referenceUrls\[index\]\)\)/);
  assert.match(promptUtils, /suiteReferenceUrls/);
  assert.match(promptUtils, /参考套图是整套主图的版式、屏序、视觉节奏、信息层级和风格连续性基准/);
  assert.match(promptUtils, /不得把参考套图拆成互不相关的单张图任务/);
  assert.match(promptUtils, /不得复制同一张脸、发型、服装、体态、身份特征或可识别人物形象/);
  assert.match(promptUtils, /必须精准还原上传产品的真实细节/);
  assert.match(promptUtils, /执行内容若包含“文案映射”或箭头映射/);
  assert.match(promptUtils, /箭头右侧文字就是最终上屏文案，必须逐字生成/);
  assert.match(promptUtils, /normalizeSuiteReplicationSchemeForGenerationPrompt/);
});

test('one click detail page set replication exposes mode and uses reference suite count', () => {
  const bottomInputBar = source();
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const workflow = read('../../../adapters/shellWorkflow.ts');

  assert.match(bottomInputBar, /key: 'detailGenerationMode'/);
  assert.match(bottomInputBar, /title: '详情生成方式'/);
  assert.match(bottomInputBar, /options: \['AI直出', '套图复刻'\]/);
  assert.match(bottomInputBar, /isDetailPageSuiteReplication/);
  assert.match(bottomInputBar, /mode === '详情页' && currentParams\.detailGenerationMode === '套图复刻'\) return getOneClickBaseParams\(mode\)/);
  assert.match(bottomInputBar, /return '详情页套图参考'/);
  assert.match(bottomInputBar, /return '详情页整套参考，最多10张'/);
  assert.match(bottomInputBar, /const activeStyleRefCount = \(materials\.styleRef \|\| \[\]\)[\s\S]*item\.subFeature === activeSubFeature[\s\S]*\.length;/);
  assert.match(bottomInputBar, /billingParams = isDetailPageSuiteReplication[\s\S]*count: String\(activeStyleRefCount\)/);
  assert.match(bottomInputBar, /count: String\(activeStyleRefCount\), exactCount: 'true'/);
  assert.match(bottomInputBar, /!\s*\(isMainImageSuiteReplication \|\| isDetailPageSuiteReplication\) && \(/);
  assert.match(shellApp, /详情页套图复刻最多保留 10 张参考风格图/);
  assert.match(shellApp, /selectedFiles = selectedFiles\.slice\(0, remaining\)/);
  assert.match(workflow, /generateDetailPageReplicationSchemes/);
  assert.match(workflow, /firstParam\(input\.params, \['detailGenerationMode'\], 'AI直出'\) === '套图复刻'/);
  assert.match(workflow, /getOneClickReferenceUrls\(input\)\.slice\(0, 10\)/);
  assert.match(workflow, /getDetailReferenceAspectRatios\(input\)/);
  assert.match(workflow, /result\.schemes\.map\(\(scheme, index\) => toShellPlan\(scheme, index, referenceUrls\[index\]\)\)/);
});

test('buyer show shell removes duplicate scene reference and preserves effective model and atmosphere roles', () => {
  const bottomInputBar = source();
  const uploadSelector = read('../UploadTypeSelector.tsx');
  const workflow = read('../../../adapters/shellWorkflow.ts');

  assert.doesNotMatch(bottomInputBar, /key: 'scene'/);
  assert.doesNotMatch(bottomInputBar, /title: '场景类型'/);
  assert.match(bottomInputBar, /key: 'market'/);
  assert.match(bottomInputBar, /title: '目标市场'[\s\S]*allowCustom: true/);
  assert.doesNotMatch(bottomInputBar, /key: 'perSet'/);
  assert.doesNotMatch(bottomInputBar, /key: 'productInfo'/);
  assert.doesNotMatch(bottomInputBar, /key: 'setDirections'/);
  assert.match(uploadSelector, /buyer_show:\s+\['product', 'atmosphere', 'model'\]/);
  assert.doesNotMatch(uploadSelector, /buyer_show:\s+\['product', 'atmosphere', 'model', 'scene'\]/);
  assert.match(uploadSelector, /模特参考/);
  assert.match(uploadSelector, /面部与姿势参考/);
  assert.match(workflow, /买家秀素材清单/);
  assert.match(workflow, /模特面部与姿势参考图/);
  assert.match(workflow, /视觉氛围参考图/);
});

test('buyer show batch action opens set-count popover with per-set uploads instead of persistent page panels', () => {
  const bottomInputBar = source();
  const workflow = read('../../../adapters/shellWorkflow.ts');
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const previewBar = read('../MaterialPreviewBar.tsx');

  assert.match(bottomInputBar, /getBuyerShowSetCount/);
  assert.match(bottomInputBar, /Math\.min\(parsed, 4\)/);
  assert.match(workflow, /Math\.min\(parsed, 4\)/);
  assert.doesNotMatch(bottomInputBar, /key: 'setCount', label: '1套'/);
  assert.match(bottomInputBar, /renderBuyerShowBatchAction/);
  assert.match(bottomInputBar, /p\.key === 'count' && renderBuyerShowBatchAction\(\)/);
  assert.match(bottomInputBar, /buyerShowBatchOpen/);
  assert.match(bottomInputBar, /renderBuyerShowBatchPopover/);
  assert.match(bottomInputBar, /生成套数/);
  assert.match(bottomInputBar, /setCountOptions/);
  assert.doesNotMatch(bottomInputBar, /section: '批量'/);
  assert.doesNotMatch(bottomInputBar, /key: 'setCount', label: '生成套数', type: 'select'/);
  assert.doesNotMatch(bottomInputBar, /key: 'setCount', label: '生成套数'[^\n]*allowCustom/);
  assert.doesNotMatch(bottomInputBar, /\{renderBuyerShowSetReferenceUploads\(\)\}/);
  assert.match(bottomInputBar, /uploadTargetSetIndex/);
  assert.match(bottomInputBar, /buyerShowSetIndex: uploadTargetSetIndex/);
  assert.match(bottomInputBar, /getBuyerShowSetMaterials/);
  assert.match(bottomInputBar, /item\.buyerShowSetIndex === index \|\| \(index === 0 && typeof item\.buyerShowSetIndex !== 'number'\)/);
  assert.match(bottomInputBar, /第 \{index \+ 1\} 套/);
  assert.match(bottomInputBar, /openBuyerShowSetUpload\(type, index\)/);
  assert.match(bottomInputBar, /renderBuyerShowSetMaterialRow\('atmosphere', index/);
  assert.match(bottomInputBar, /renderBuyerShowSetMaterialRow\('model', index/);
  assert.match(bottomInputBar, /includeModel \? 'grid-cols-2' : 'grid-cols-1'/);
  assert.doesNotMatch(bottomInputBar, /环境、光线、生活感/);
  assert.doesNotMatch(bottomInputBar, /面部、姿势、手部状态/);
  assert.doesNotMatch(bottomInputBar, /buyerShowSetDirection_\$\{index\}/);
  assert.doesNotMatch(bottomInputBar, /第 \{index \+ 1\} 套场景要求/);
  assert.doesNotMatch(bottomInputBar, /选择多套后，每套分别填写不同场景、人物状态、拍摄氛围或内容方向/);
  assert.match(bottomInputBar, /产品名称、核心卖点、目标人群和基础适用场景/);
  assert.doesNotMatch(bottomInputBar, /key: 'setDirections'/);
  assert.match(shellApp, /buyerShowSetIndex\?: number/);
  assert.match(shellApp, /options\?: \{ buyerShowSetIndex\?: number \}/);
  assert.match(shellApp, /buyerShowSetIndex: options\?\.buyerShowSetIndex/);
  assert.match(previewBar, /buyerShowSetIndex/);
  assert.match(workflow, /getBuyerShowSetReferenceUrls/);
  assert.match(workflow, /getBuyerShowSetGenerationInputs/);
  assert.match(workflow, /item\.buyerShowSetIndex === setIndex \|\| \(setIndex === 0 && typeof item\.buyerShowSetIndex !== 'number'\)/);
  assert.doesNotMatch(workflow, /const atmosphereLines = \(input\.materials\.atmosphere \|\| \[\]\)/);
  assert.doesNotMatch(workflow, /const modelLines = \(input\.materials\.model \|\| \[\]\)/);
  assert.match(workflow, /第\$\{setIndex \+ 1\}套氛围参考图/);
  assert.match(workflow, /第\$\{setIndex \+ 1\}套模特参考图/);
  assert.match(workflow, /setReference\.planningReferenceUrl/);
  assert.doesNotMatch(workflow, /buildBuyerShowSetDirectionLines/);
  assert.doesNotMatch(workflow, /buyerShowSetDirection_\$\{index\}/);
});

test('material thumbnails keep remove controls visible and buyer show batch popover stays lightweight', () => {
  const bottomInputBar = source();
  const previewBar = read('../MaterialPreviewBar.tsx');
  const batchPopover = bottomInputBar.match(/const renderBuyerShowBatchPopover = \(\) => \{[\s\S]*?const renderBuyerShowBatchAction/)?.[0] || '';

  assert.doesNotMatch(previewBar, /absolute -top-1 -right-1/);
  assert.match(previewBar, /absolute right-0\.5 top-0\.5 z-10/);
  assert.match(previewBar, /className="relative shrink-0 overflow-visible group"/);

  assert.doesNotMatch(bottomInputBar, /absolute -right-1 -top-1/);
  assert.match(bottomInputBar, /absolute right-0\.5 top-0\.5 z-10/);
  assert.match(bottomInputBar, /className="group relative h-12 w-12 overflow-hidden rounded-2xl border"/);

  assert.doesNotMatch(batchPopover, /w-\[356px\]/);
  assert.doesNotMatch(batchPopover, /rounded-3xl border p-3\.5/);
  assert.doesNotMatch(batchPopover, /boxShadow: 'var\(--shadow-elevated\)'/);
  assert.match(batchPopover, /left-1\/2/);
  assert.match(batchPopover, /-translate-x-1\/2/);
  assert.doesNotMatch(batchPopover, /<Check size=\{12\}/);
  assert.doesNotMatch(batchPopover, /flex h-3 w-3 items-center justify-center/);
  assert.match(batchPopover, /items-center justify-center rounded-2xl text-center/);
  assert.match(batchPopover, /w-\[380px\]/);
  assert.match(batchPopover, /boxShadow: '0 18px 44px rgba\(15, 23, 42, 0\.12\)'/);
});

test('xhs cover shell input keeps title copy in the main prompt and moves decorations into more params', () => {
  const bottomInputBar = source();
  const xhsModule = read('../../modules/XhsCover/XhsCoverModule.tsx');

  assert.doesNotMatch(bottomInputBar, /key: 'styleSource'/);
  assert.doesNotMatch(bottomInputBar, /风格来源/);
  assert.doesNotMatch(bottomInputBar, /上传参考/);
  assert.doesNotMatch(bottomInputBar, /key: 'styleCategory'/);
  assert.match(bottomInputBar, /装饰贴纸/);
  assert.match(bottomInputBar, /额外要求/);
  assert.match(bottomInputBar, /主标题/);
  assert.match(bottomInputBar, /副标题/);
  assert.match(bottomInputBar, /XHS_COVER_STYLES/);
  assert.match(bottomInputBar, /XHS_STYLE_CATEGORIES/);
  assert.match(bottomInputBar, /xhsPresetOpen/);
  assert.match(bottomInputBar, /selectedXhsStyleId/);
  assert.match(bottomInputBar, /onParamChange\('selectedStyleIds', id\)/);
  assert.match(bottomInputBar, /style\.previewImage/);
  assert.match(bottomInputBar, /素材上传/);
  assert.match(bottomInputBar, /封面参考/);
  assert.match(bottomInputBar, /封面预设库/);
  assert.match(bottomInputBar, /xhsPreset/);
  assert.match(bottomInputBar, /onParamChange\('selectedStyleIds', ''\)/);
  assert.doesNotMatch(bottomInputBar, /workplace_big_text'\)\s*\.split/);
  assert.doesNotMatch(bottomInputBar, /当前预设/);
  assert.match(bottomInputBar, /可爱体/);
  assert.match(bottomInputBar, /书法体/);
  assert.match(bottomInputBar, /allowCustom: true/);
  assert.doesNotMatch(bottomInputBar, /key: 'title'/);
  assert.doesNotMatch(bottomInputBar, /key: 'subtitle'/);
  assert.doesNotMatch(xhsModule, /上传风格参考/);
  assert.doesNotMatch(xhsModule, /风格来源/);
  assert.match(xhsModule, /底部输入框/);
  assert.doesNotMatch(xhsModule, /输入标题和副标题/);
});

test('xhs cover default 3:4 ratio is submitted even when the user keeps the visible default', () => {
  const shellApp = read('../../../ShellMigratedApp.tsx');
  const workflow = read('../../../adapters/shellWorkflow.ts');

  assert.match(shellApp, /if \(module === AppModuleObj\.XHS_COVER\) return normalizeXhsCoverParamsForGeneration\(params\);/);
  assert.match(shellApp, /const normalizeXhsCoverParamsForGeneration = \(\s*params: Record<string, string>,\s*\) =>/);
  assert.match(shellApp, /const ratio = params\.ratio \|\| params\.aspectRatio \|\| '3:4';/);
  assert.match(shellApp, /aspectRatio: ratio/);
  assert.match(workflow, /input\.module === AppModule\.XHS_COVER\s*\? AspectRatio\.P_3_4/);
});

test('xhs cover preset preview assets from the old frontend are available in the shell public assets', () => {
  const styles = read('../../../modules/XhsCover/xhsCoverStyles.ts');
  const workflow = read('../../../adapters/shellWorkflow.ts');

  assert.match(styles, /workplace_big_text/);
  assert.match(styles, /professional_clean/);
  assert.match(styles, /XHS_STYLE_CATEGORIES/);
  assert.match(styles, /职场/);
  assert.match(styles, /居家/);
  assert.match(styles, /活力/);
  assert.match(styles, /文艺/);
  assert.match(styles, /创意/);
  assert.match(workflow, /buildXhsPresetPrompt/);
  assert.match(workflow, /XHS_COVER_STYLES/);
  assert.match(workflow, /selectedStyleIds/);
  assert.doesNotMatch(workflow, /params\.selectedStyleIds \|\| 'workplace_big_text'/);
  assert.equal(existsSync(new URL('../../../../public/xhs-cover-previews/workplace_big_text.png', import.meta.url)), true);
  assert.equal(existsSync(new URL('../../../../public/xhs-cover-previews/professional_clean.png', import.meta.url)), true);
  assert.equal(existsSync(new URL('../../../../public/xhs-cover-previews/background_big_text.png', import.meta.url)), true);
});

test('shell generation button displays image credit estimate above submit action', () => {
  const bottomInputBar = source();
  const generateButtonBlock = bottomInputBar.match(/\{billingEstimate\.billable[\s\S]*?<ComposerSubmitButton[\s\S]*?label=\{submitLabel\}/)?.[0] || '';

  assert.match(bottomInputBar, /estimateImageBilling/);
  assert.match(bottomInputBar, /billingEstimate/);
  assert.match(generateButtonBlock, /预计消耗/);
  assert.match(generateButtonBlock, /积分/);
  assert.doesNotMatch(generateButtonBlock, /billingEstimate\.imageCount/);
  assert.doesNotMatch(generateButtonBlock, /张/);
  assert.match(bottomInputBar, /billingMaterialCount/);
  assert.match(bottomInputBar, /flex shrink-0 flex-col items-center gap-1/);
  assert.doesNotMatch(generateButtonBlock, /min-w-\[176px\]/);
  assert.doesNotMatch(generateButtonBlock, /w-full items-center justify-center/);
  assert.match(generateButtonBlock, /text-center/);
});

test('shell generation button uses an explicit submit lock instead of global running tasks', () => {
  const bottomInputBar = source();
  const composerPrimitives = read('./ComposerPrimitives.tsx');
  const generateButtonBlock = bottomInputBar.match(/<ComposerSubmitButton\s*\n\s*onClick=\{handleGenerateClick\}[\s\S]*?label=\{submitLabel\}/)?.[0] || '';

  assert.match(bottomInputBar, /const isGenerateDisabled = isSubmitLocked \|\| Boolean\(disabledReason\) \|\| \(!promptText\.trim\(\) && !canGenerateWithoutPrompt\)/);
  assert.match(bottomInputBar, /const isSubmitBusy = isSubmitLocked/);
  assert.match(bottomInputBar, /submitLabel = isSubmitBusy \? '任务处理中\.\.\.' : generateLabel/);
  assert.match(bottomInputBar, /const handleGenerateClick = \(\) => \{\s*if \(!isGenerateDisabled\) onGenerate\(\);\s*\}/);
  assert.match(generateButtonBlock, /disabled=\{isGenerateDisabled\}/);
  assert.match(bottomInputBar, /onKeyDown=\{\(e\) => \{[\s\S]*?handleGenerateClick\(\)/);
  assert.match(composerPrimitives, /Loader2/);
  assert.doesNotMatch(generateButtonBlock, /disabled=\{[^}]*isGenerating/);
});

test('resolution dropdown shows per-image credit cost for image models', () => {
  const bottomInputBar = source();
  const composerPrimitives = read('./ComposerPrimitives.tsx');
  const selectSources = `${bottomInputBar}\n${composerPrimitives}`;

  assert.match(bottomInputBar, /getImageModelCreditCost/);
  assert.match(bottomInputBar, /getOptionMeta/);
  assert.match(bottomInputBar, /积分\/张/);
  assert.match(selectSources, /isResolutionSelect/);
  assert.match(bottomInputBar, /currentParams\.model/);
  assert.match(selectSources, /optionMeta/);
});

test('video generation exposes api and cli seedance fast paths with api credit estimate', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /MAXFORAI_VIDEO_MODEL_ID/);
  assert.match(bottomInputBar, /0\.5元\/秒/);
  assert.match(bottomInputBar, /formatMaxForAiVideoPrice/);
  assert.match(bottomInputBar, /recommendedValue: mode === 'multimodal2video' \? MAXFORAI_VIDEO_MODEL_ID/);
  assert.match(bottomInputBar, /defaultValue: mode === 'multimodal2video' \? MAXFORAI_VIDEO_MODEL_ID/);
  assert.match(bottomInputBar, /预计\$\{formatMaxForAiVideoPrice\(seconds\)\}元/);
  assert.match(bottomInputBar, /mode === 'multimodal2video'/);
  assert.match(bottomInputBar, /value: MAXFORAI_VIDEO_MODEL_ID, label: MAXFORAI_VIDEO_MODEL\.label/);
  assert.doesNotMatch(bottomInputBar, /key:\s*'videoAccessMode'/);
  assert.match(bottomInputBar, /Seedance 2\.0 Fast · API/);
  assert.match(bottomInputBar, /Seedance 2\.0 Fast VIP · CLI/);
  assert.match(bottomInputBar, /Seedance 2\.0 Fast/);
  assert.match(bottomInputBar, /Seedance 2\.0 Fast VIP/);
  assert.doesNotMatch(bottomInputBar, /value: 'seedance2\.0'/);
  assert.doesNotMatch(bottomInputBar, /value: 'seedance2\.0_vip'/);
  assert.match(bottomInputBar, /videoResolution/);
  assert.match(bottomInputBar, /480p/);
  assert.match(bottomInputBar, /720p/);
  assert.match(bottomInputBar, /defaultValue: '720p'/);
  assert.match(bottomInputBar, /recommendedValue: '720p'/);
  assert.match(bottomInputBar, /estimateSeedanceFastBilling/);
  assert.match(bottomInputBar, /9 \* seconds/);
  assert.match(bottomInputBar, /15\.5 \* seconds/);
  assert.match(bottomInputBar, /20 \* seconds/);
  assert.match(bottomInputBar, /33 \* seconds/);
  assert.match(bottomInputBar, /预计消耗/);
});

test('short video multimodal input exposes accessible current-material mentions', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /VIDEO_MATERIAL_MENTION_PARAM/);
  assert.match(bottomInputBar, /buildVideoMaterialMentionCandidates/);
  assert.match(bottomInputBar, /findVideoMaterialMentionQuery/);
  assert.match(bottomInputBar, /insertVideoMaterialMention/);
  assert.match(bottomInputBar, /upsertVideoMaterialMentionBinding/);
  assert.match(bottomInputBar, /const canUseVideoMaterialMentions = isDreaminaVideoGeneration && dreaminaMode === 'multimodal2video'/);
  assert.match(bottomInputBar, /aria-label="引用当前素材"/);
  assert.match(bottomInputBar, />@\u7d20材</);
  assert.match(bottomInputBar, /role="listbox"/);
  assert.match(bottomInputBar, /role="option"/);
  assert.match(bottomInputBar, /请先上传图片、视频或音频素材/);
  assert.match(bottomInputBar, /isImeComposing/);
});

test('video storyboard original mode passes scene reference uploads into storyboard config', () => {
  const shellSource = readFileSync(new URL('../../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
  const builderBody = shellSource.match(/const buildVideoStoryboardConfig = \([\s\S]*?\n\};/)?.[0] || '';

  assert.match(builderBody, /const sceneReferenceUrls = \(materials\.scene \|\| \[\]\)/);
  assert.match(builderBody, /sceneReferenceUrls,/);
});

test('everything replace product mode exposes replacement controls and material slots', () => {
  const bottomInputBar = source();
  const uploadSelector = read('../UploadTypeSelector.tsx');
  const materialPreview = read('../MaterialPreviewBar.tsx');
  const productRegionEditor = read('../ProductReplaceRegionEditor.tsx');
  const imageLightbox = read('../ImageLightbox.tsx');

  assert.match(bottomInputBar, /isProductReplaceContext/);
  assert.match(bottomInputBar, /AppModuleObj\.EVERYTHING_REPLACE/);
  assert.match(bottomInputBar, /key: 'replacementLogic'/);
  assert.match(bottomInputBar, /title: '替换逻辑'/);
  assert.match(bottomInputBar, /options: \['单品替换', '组合替换'\]/);
  assert.doesNotMatch(bottomInputBar, /recommendedValue: '单品替换'/);
  assert.doesNotMatch(bottomInputBar, /recommendedValue: '单产品替换'/);
  assert.match(bottomInputBar, /getEverythingReplaceMaterialLabels\(activeSubFeature, currentParams\)/);
  assert.match(bottomInputBar, /替换产品图/);
  assert.match(bottomInputBar, /仅同一产品，可多角度\/细节图/);
  assert.match(bottomInputBar, /同一组产品，整体替换/);
  assert.match(bottomInputBar, /一图一结果/);
  assert.doesNotMatch(bottomInputBar, /上传的几张都必须是同一个产品/);
  assert.doesNotMatch(bottomInputBar, /同一组产品，整体对应替换到参考图/);
  assert.doesNotMatch(bottomInputBar, /同一单品的多角度或一组组合产品/);
  assert.match(bottomInputBar, /getEverythingReplaceRatioLabel/);
  assert.match(bottomInputBar, /ratio === 'auto' \? 'auto'/);
  assert.match(bottomInputBar, /recommendedValue: 'auto'/);
  assert.match(bottomInputBar, /recommendedLabel: '推荐'/);
  assert.match(bottomInputBar, /key: 'firstImageColorMode'/);
  assert.match(bottomInputBar, /label: '参考强度'/);
  assert.match(bottomInputBar, /options: \['完全复刻', '人物微调', '全局微调'\]/);
  assert.match(bottomInputBar, /key: 'textPolicy'/);
  assert.match(bottomInputBar, /label: '文案处理'/);
  assert.match(bottomInputBar, /options: \['维持文案', '去除文案'\]/);
  assert.match(bottomInputBar, /defaultValue: '维持文案'/);
  assert.doesNotMatch(bottomInputBar, /人物自适应/);
  assert.match(bottomInputBar, /return \['product', 'logo', 'styleRef'\]/);
  assert.match(bottomInputBar, /替换参考图/);
  assert.match(bottomInputBar, /Logo上传/);
  assert.match(bottomInputBar, /materialActionLabels/);
  assert.match(bottomInputBar, /logo: '调整位置'/);
  assert.match(bottomInputBar, /onMaterialAction/);
  assert.doesNotMatch(bottomInputBar, /位置可调/);
  assert.match(bottomInputBar, /Logo位置区域调整/);
  assert.match(bottomInputBar, /LOGO_PLACEMENT_RATIOS/);
  assert.match(bottomInputBar, /ProductReplaceRegionEditor/);
  assert.match(bottomInputBar, /productReplaceRegions/);
  assert.match(bottomInputBar, /待标记/);
  assert.match(bottomInputBar, /已标记/);
  assert.match(bottomInputBar, /data-region-mark-status=\{completed \? 'complete' : 'pending'\}/);
  assert.match(bottomInputBar, /data-region-mark-scope=\{scope\}/);
  assert.match(bottomInputBar, /scope: 'product_replace'/);
  assert.match(bottomInputBar, /scope: 'logo_replace'/);
  assert.match(bottomInputBar, /regions\.length > 0 && regions\.every/);
  assert.match(bottomInputBar, /rounded-full border px-1 text-\[8px\] font-semibold text-white shadow-sm backdrop-blur-sm/);
  assert.match(bottomInputBar, /background: 'rgba\(15, 23, 42, 0\.72\)'/);
  assert.match(bottomInputBar, /background: completed \? '#22c55e' : '#f59e0b'/);
  assert.doesNotMatch(bottomInputBar, /flex h-\[18px\] w-\[18px\] items-center justify-center rounded-md text-white/);
  assert.match(bottomInputBar, /renderCombinationMaterialOverlay/);
  assert.match(bottomInputBar, /buildProductGroupAssignmentPatches/);
  assert.match(bottomInputBar, /getEffectiveProductGroupId/);
  assert.match(bottomInputBar, /resolveProductGroupIdForSelection/);
  assert.match(bottomInputBar, /productGroupAssignment: 'manual'/);
  assert.doesNotMatch(bottomInputBar, /productGroupId: `product-group-\$\{index \+ 1\}`/);
  assert.match(bottomInputBar, /renderMaterialOverlay=\{isCombinationProductReplace[\s\S]*?renderCombinationMaterialOverlay[\s\S]*?renderLogoReplaceMaterialOverlay/);
  assert.match(materialPreview, /renderMaterialOverlay\?: \(type: string, material: Material, index: number\) => React\.ReactNode/);
  assert.match(materialPreview, /renderMaterialOverlay\?\.\(type, m, index\)/);
  assert.doesNotMatch(bottomInputBar, /sm:grid-cols-2[\s\S]*?所属产品组[\s\S]*?sm:grid-cols-2[\s\S]*?已标记/);
  assert.match(productRegionEditor, /P\{group\.productNumber\}/);
  assert.match(productRegionEditor, /产品替换区域标记/);
  assert.match(productRegionEditor, /每张替换参考图都必须完成全部产品区域标记/);
  assert.match(productRegionEditor, /标记只用于定位，不会进入最终成图/);
  assert.match(productRegionEditor, /拖动标记框调整位置/);
  assert.match(productRegionEditor, /mode: 'move'/);
  assert.match(productRegionEditor, /moveProductReplaceRegion/);
  assert.match(productRegionEditor, /event\.stopPropagation\(\)/);
  assert.match(productRegionEditor, /onPointerDown=\{\(event\) => handleRegionPointerDown\(event, index\)\}/);
  assert.match(productRegionEditor, /保存区域标记/);
  assert.match(bottomInputBar, /Logo 替换区域标记/);
  assert.match(bottomInputBar, /styleRef: '标记区域'/);
  assert.doesNotMatch(bottomInputBar, /styleRef: '框选区域'/);
  assert.match(productRegionEditor, /const EMPTY_PRODUCT_REPLACE_REGIONS/);
  assert.match(productRegionEditor, /initialRegions = EMPTY_PRODUCT_REPLACE_REGIONS/);
  assert.doesNotMatch(productRegionEditor, /initialRegions = \[\]/);
  assert.match(productRegionEditor, /fetchImageBlobWithProxy/);
  assert.match(productRegionEditor, /resolvePublicAssetUrl/);
  assert.match(productRegionEditor, /URL\.createObjectURL/);
  assert.match(productRegionEditor, /URL\.revokeObjectURL/);
  assert.doesNotMatch(productRegionEditor, /src=\{reference\.url\}/);
  assert.match(bottomInputBar, /logoPlacementReferenceSize/);
  assert.match(bottomInputBar, /activeEverythingReplaceReference\?\.originalWidth \|\| 1000/);
  assert.doesNotMatch(bottomInputBar, /activeEverythingReplaceReference\.originalWidth/);
  assert.match(bottomInputBar, /max-w-\[620px\] items-center justify-center/);
  assert.match(bottomInputBar, /height: 'min\(58vh, 620px\)'/);
  assert.match(bottomInputBar, /width: previewRatio >= 1 \? '100%' : `calc\(min\(58vh, 620px\) \* \$\{previewRatio\}\)`/);
  assert.doesNotMatch(bottomInputBar, /center \/ cover no-repeat url\("\$\{activeEverythingReplaceReference\.url\}"\)/);
  assert.match(bottomInputBar, /应用到全部比例/);
  assert.match(bottomInputBar, /确定位置/);
  assert.match(bottomInputBar, /onUpdateMaterial/);
  assert.doesNotMatch(bottomInputBar, /调整Logo位置/);
  assert.match(bottomInputBar, /开始产品替换/);
  assert.match(bottomInputBar, /填写替换要求、保留重点或禁区说明/);
  assert.match(bottomInputBar, /count: String\(resolveEverythingReplaceBillingCount/);
  assert.match(bottomInputBar, /exactCount: 'true'/);

  assert.doesNotMatch(uploadSelector, /everything_replace:\s+\['product', 'productDetail', 'styleRef'\]/);
  assert.match(uploadSelector, /everything_replace:\s+\['product', 'logo', 'model', 'styleRef'\]/);
  assert.match(uploadSelector, /materialActionLabels/);
  assert.match(uploadSelector, /onMaterialAction/);
  assert.match(materialPreview, /onAdjustMaterial/);
  assert.match(materialPreview, /adjustMaterialLabels/);
  assert.match(imageLightbox, /bottom-8 left-1\/2/);
  assert.match(imageLightbox, /Move size=\{17\}/);
  assert.doesNotMatch(materialPreview, /详情补充/);
});

test('everything replace model mode exposes identity source and reference controls', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /isModelReplaceContext/);
  assert.match(bottomInputBar, /return \['model', 'styleRef'\]/);
  assert.match(bottomInputBar, /人物身份图/);
  assert.match(bottomInputBar, /待替换参考图/);
  assert.match(bottomInputBar, /临时上传/);
  assert.match(bottomInputBar, /公共模特库/);
  assert.match(bottomInputBar, /VirtualModelPicker/);
  assert.match(bottomInputBar, /identityDraft/);
  assert.match(bottomInputBar, /type === 'model'/);
  assert.match(bottomInputBar, /开始模特替换/);
  assert.match(bottomInputBar, /resolveEverythingReplaceBillingCount/);
});

test('everything replace background mode exposes only background replacement controls', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /isBackgroundReplaceContext/);
  assert.match(bottomInputBar, /getBackgroundReplaceQuickParams/);
  assert.match(bottomInputBar, /activeSubFeature === 'background_replace'/);
  assert.doesNotMatch(bottomInputBar, /label: '画面模式'/);
  assert.match(bottomInputBar, /key: 'resolutionMode'/);
  assert.match(bottomInputBar, /label: '尺寸模式'/);
  assert.match(bottomInputBar, /options: \['AI 自适应尺寸', '固定宽度'\]/);
  assert.match(bottomInputBar, /defaultValue: 'AI 自适应尺寸'/);
  assert.match(bottomInputBar, /key: 'targetWidth'/);
  assert.match(bottomInputBar, /label: '输出宽度\(px\)'/);
  assert.match(bottomInputBar, /key: 'textPolicy'/);
  assert.match(bottomInputBar, /label: '文案处理'/);
  assert.match(bottomInputBar, /options: \['维持文案', '去除文案'\]/);
  assert.match(bottomInputBar, /return \['product', 'styleRef'\]/);
  assert.match(bottomInputBar, /原产品图/);
  assert.match(bottomInputBar, /保持产品和人物不变/);
  assert.match(bottomInputBar, /背景参考图/);
  assert.match(bottomInputBar, /只替换场景\/背景/);
  assert.match(bottomInputBar, /开始背景替换/);
  assert.match(bottomInputBar, /补充背景替换要求/);
  assert.match(bottomInputBar, /isEverythingReplaceImageContext/);
  assert.match(bottomInputBar, /isEverythingReplaceImageReplace/);
  assert.match(bottomInputBar, /canGenerateWithoutPrompt = .*isEverythingReplaceImageReplace/);
  assert.doesNotMatch(bottomInputBar, /activeSubFeature === 'background_replace' \|\| activeSubFeature === 'logo_replace'/);
});
