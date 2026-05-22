import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = () => readFileSync(new URL('./BottomInputBar.tsx', import.meta.url), 'utf8');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('one click shell params are subfeature-aware and do not expose fake style preset entry', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /getQuickParamsForModule/);
  assert.match(bottomInputBar, /getExtendedSectionsForModule/);
  assert.doesNotMatch(bottomInputBar, /title: '风格预设'/);
  assert.doesNotMatch(bottomInputBar, /key: 'preset'/);
  assert.match(bottomInputBar, /mode === '首图'/);
  assert.match(bottomInputBar, /首图配色/);
  assert.match(bottomInputBar, /module !== AppModuleObj\.VIDEO \|\| activeSubFeature !== 'storyboard'/);
  assert.doesNotMatch(bottomInputBar, /planningLogic/);
});

test('shell select params support old frontend custom platform and language input flow', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /allowCustom\?: boolean/);
  assert.match(bottomInputBar, /customInputs/);
  assert.match(bottomInputBar, /\+ 自定义/);
  assert.match(bottomInputBar, /请输入自定义/);
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

  assert.match(translationQuickParams, /\.\.\.\(isRemoveText \? \[\] : \[\{/);
  assert.match(translationQuickParams, /title: '目标语言'/);
  assert.match(translationQuickParams, /recommendedValue: isDetail \|\| isRemoveText \? 'auto' : '1:1'/);
  assert.doesNotMatch(translationQuickParams, /secondaryRecommendedValue:/);
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

test('buyer show multi-set scene requirements expand into per-set inputs instead of one mixed textarea', () => {
  const bottomInputBar = source();
  const workflow = read('../../../adapters/shellWorkflow.ts');

  assert.match(bottomInputBar, /getBuyerShowSetCount/);
  assert.match(bottomInputBar, /Math\.min\(parsed, 4\)/);
  assert.match(workflow, /Math\.min\(parsed, 4\)/);
  assert.match(bottomInputBar, /key: 'setCount', label: '生成套数', type: 'select', options: \['1套', '2套', '3套', '4套'\], defaultValue: '1套' \}/);
  assert.doesNotMatch(bottomInputBar, /key: 'setCount', label: '生成套数'[^\n]*allowCustom/);
  assert.match(bottomInputBar, /buyerShowSetDirection_\$\{index\}/);
  assert.match(bottomInputBar, /md:grid-cols-2/);
  assert.match(bottomInputBar, /第 \{index \+ 1\} 套场景要求/);
  assert.match(bottomInputBar, /选择多套后，每套分别填写不同场景、人物状态、拍摄氛围或内容方向/);
  assert.match(bottomInputBar, /产品名称、核心卖点、目标人群和基础适用场景/);
  assert.doesNotMatch(bottomInputBar, /key: 'setDirections'/);
  assert.match(workflow, /buildBuyerShowSetDirectionLines/);
  assert.match(workflow, /buyerShowSetDirection_\$\{index\}/);
  assert.match(workflow, /第\$\{index \+ 1\}套场景要求：/);
  assert.match(workflow, /多套场景要求：/);
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
  const generateButtonBlock = bottomInputBar.match(/\{billingEstimate\.billable[\s\S]*?<button[\s\S]*?<span>\{submitLabel\}<\/span>/)?.[0] || '';

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
  const generateButtonBlock = bottomInputBar.match(/<button\s*\n\s*onClick=\{onGenerate\}[\s\S]*?<span>\{submitLabel\}<\/span>/)?.[0] || '';

  assert.match(bottomInputBar, /const isGenerateDisabled = isSubmitLocked \|\| Boolean\(disabledReason\) \|\| \(!promptText\.trim\(\) && !canGenerateWithoutPrompt\)/);
  assert.match(bottomInputBar, /const isSubmitBusy = isSubmitLocked/);
  assert.match(bottomInputBar, /submitLabel = isSubmitBusy \? '任务处理中\.\.\.' : generateLabel/);
  assert.match(generateButtonBlock, /disabled=\{isGenerateDisabled\}/);
  assert.match(bottomInputBar, /if \(!isGenerateDisabled\) onGenerate\(\)/);
  assert.match(generateButtonBlock, /Loader2/);
  assert.doesNotMatch(generateButtonBlock, /disabled=\{[^}]*isGenerating/);
});

test('resolution dropdown shows per-image credit cost for image models', () => {
  const bottomInputBar = source();

  assert.match(bottomInputBar, /getImageModelCreditCost/);
  assert.match(bottomInputBar, /getOptionMeta/);
  assert.match(bottomInputBar, /积分\/张/);
  assert.match(bottomInputBar, /isResolutionSelect/);
  assert.match(bottomInputBar, /currentParams\.model/);
  assert.match(bottomInputBar, /optionMeta/);
});

test('video generation exposes api and cli seedance fast paths with api credit estimate', () => {
  const bottomInputBar = source();

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
