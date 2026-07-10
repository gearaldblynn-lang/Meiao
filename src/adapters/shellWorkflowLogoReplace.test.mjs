import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shellWorkflowSource = readFileSync(new URL('./shellWorkflow.ts', import.meta.url), 'utf8');

const functionBlock = (name) => {
  const start = shellWorkflowSource.indexOf(`const ${name} =`);
  if (start < 0) return '';
  const end = shellWorkflowSource.indexOf('\n};', start);
  return end < 0 ? shellWorkflowSource.slice(start) : shellWorkflowSource.slice(start, end + 3);
};

test('logo region replacement always uses guarded cleanup plus program overlay', () => {
  const workflow = functionBlock('runLogoReplaceWorkflow');
  const guardedResult = functionBlock('toMultiLogoReplaceResultItem');

  assert.match(shellWorkflowSource, /createGuardedMultiLogoReplaceResultBlob/);
  assert.match(workflow, /const requestedLogoReplaceRenderMode = normalizeLogoReplaceRenderMode\(input\.params\.logoReplaceRenderMode\)/);
  assert.match(workflow, /const logoReplaceRenderMode = logoReplaceMode === 'multi_logo_replace' \|\| logoReplaceMode === 'single_logo_region_replace'\s*\? 'program_guarded'\s*: requestedLogoReplaceRenderMode/);
  assert.match(workflow, /const useDirectLogoReplace = logoReplaceMode !== 'multi_logo_replace' && logoReplaceMode !== 'single_logo_region_replace' && logoReplaceRenderMode === 'kie_direct'/);
  assert.match(workflow, /\(logoReplaceMode === 'multi_logo_replace' \|\| logoReplaceMode === 'single_logo_region_replace'\) && useProgramGuardedLogoReplace/);
  assert.match(guardedResult, /createGuardedMultiLogoReplaceResultBlob/);
  assert.match(guardedResult, /logoReplaceGuarded: true/);
});

test('logo region replacement uses selected boxes as cleanup and overlay bounds', () => {
  const workflow = functionBlock('runLogoReplaceWorkflow');
  const previewInputs = functionBlock('buildMultiLogoPreviewInputs');
  const guardedResult = functionBlock('toMultiLogoReplaceResultItem');

  assert.match(previewInputs, /useSelectedRegionAsCleanupBounds = false/);
  assert.match(previewInputs, /useSelectedRegionAsCleanupBounds\?: boolean/);
  assert.match(previewInputs, /useSelectedRegionAsCleanupBounds,/);
  assert.match(workflow, /useSelectedRegionAsLogoBounds: logoReplaceMode === 'multi_logo_replace' \|\| logoReplaceMode === 'single_logo_region_replace'/);
  assert.match(workflow, /useSelectedRegionAsCleanupBounds: logoReplaceMode === 'multi_logo_replace' \|\| logoReplaceMode === 'single_logo_region_replace'/);
  assert.match(workflow, /drawCleanupFill: false/);
  assert.match(workflow, /cleanupMode: 'rect'/);
  assert.doesNotMatch(workflow, /cleanupMode: 'content_mask'/);
  assert.match(guardedResult, /cleanupRect: multiLogoPreviewInputs\.multiLogoCleanupRects\[index\]/);
  assert.match(guardedResult, /logoOverlayRect: multiLogoPreviewInputs\.multiLogoPreviewLogoRects\[index\]/);
});

test('single logo replacement uses guarded one-region workflow and residual scrub padding', () => {
  const modeNormalizer = functionBlock('normalizeLogoReplaceMode');
  const workflow = functionBlock('runLogoReplaceWorkflow');
  const regionResolver = functionBlock('resolveSelectedLogoReplaceRegions');
  const singlePrompt = functionBlock('buildSingleLogoReplacePrompt');
  const guardedResult = functionBlock('toMultiLogoReplaceResultItem');

  assert.match(modeNormalizer, /single_logo_region_replace/);
  assert.match(regionResolver, /mode === 'single_logo_region_replace'/);
  assert.match(regionResolver, /regions\.slice\(0, 1\)/);
  assert.match(singlePrompt, /用户框选区域就是本次替换区域/);
  assert.match(singlePrompt, /必须清理框内全部旧 logo、旧文字、白边、残影和边缘痕迹/);
  assert.match(workflow, /logoReplaceMode === 'single_logo_region_replace'[\s\S]*?buildSingleLogoReplacePrompt/);
  assert.match(workflow, /cleanupScrubPaddingRatio: logoReplaceMode === 'single_logo_region_replace' \? 0\.24 : 0/);
  assert.match(guardedResult, /cleanupScrubPaddingRatio = 0/);
  assert.doesNotMatch(shellWorkflowSource, /logoReplaceMode === 'single_logo_replace'/);
});

test('guarded logo replacement sends uploaded logo assets and skips generic cleanup suffix', () => {
  const workflow = functionBlock('runLogoReplaceWorkflow');
  const multiPrompt = functionBlock('buildMultiLogoReplacePrompt');
  const singlePrompt = functionBlock('buildSingleLogoReplacePrompt');

  assert.match(workflow, /imageInputUrls = \[referenceUrl, \.\.\.multiLogoInputUrls, multiLogoPreviewInputs\.multiLogoPreviewUrl\]\.filter\(Boolean\)/);
  assert.doesNotMatch(workflow, /: \[referenceUrl, multiLogoPreviewInputs\.multiLogoPreviewUrl\]\.filter\(Boolean\)/);
  assert.match(workflow, /subFeature: 'logo_replace'/);
  assert.match(workflow, /skipPromptCleanupSuffix: true/);
  assert.match(multiPrompt, /图2 到图\$\{regionCount \+ 1\}/);
  assert.match(multiPrompt, /新 logo 素材只用于确认最终会由程序贴回的目标标识/);
  assert.match(singlePrompt, /图2：用户上传并裁剪后的新 logo 素材/);
  assert.match(singlePrompt, /不得把未框选 logo、上传新 logo 或其他可见标识当成去水印目标/);
});
