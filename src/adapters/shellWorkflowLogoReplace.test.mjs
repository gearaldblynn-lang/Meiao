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

test('all logo modes use semantic target planning plus adaptive local protection', () => {
  const workflow = functionBlock('runLogoReplaceWorkflow');
  const guideBuilder = functionBlock('buildLogoReplaceRegionGuideInputs');
  const lifecycle = functionBlock('completeLogoReplaceResultLifecycle');
  const finalizer = functionBlock('finalizeLogoReplaceResultAsset');

  assert.match(shellWorkflowSource, /analyzeLogoReplacement/);
  assert.match(shellWorkflowSource, /buildLogoReplaceGenerationPrompt/);
  assert.match(workflow, /resolveUnifiedLogoReplaceRegions/);
  assert.match(guideBuilder, /createLogoReplaceRegionGuideBlob/);
  assert.match(workflow, /taskPurpose: 'logo_replace_analysis'/);
  assert.match(workflow, /taskPurpose: 'logo_replace_generation'/);
  assert.match(workflow, /logoReplaceProcessingMode: 'ai_native_analysis_generation_v7_semantic_blend_guard'/);
  assert.doesNotMatch(lifecycle, /logo_replace_quality_check|validateLogoReplacementResult|createLogoReplaceQualityEvidenceBlobs|qualityEvidenceUrls/);
  assert.match(finalizer, /createAiNativeLogoReplaceGuardedResultBlob/);
  assert.doesNotMatch(workflow, /program_guarded|toMultiLogoReplaceResultItem|cleanupScrubPaddingRatio/);
});

test('logo analysis receives the guide while generation receives only the clean original and ordered logos', () => {
  const workflow = functionBlock('runLogoReplaceWorkflow');

  assert.match(shellWorkflowSource, /type LogoReplaceRegion =[\s\S]*xRatio: number;[\s\S]*yRatio: number;[\s\S]*widthRatio: number;[\s\S]*heightRatio: number;/);
  assert.match(workflow, /buildLogoReplacementLogoInput/);
  assert.match(shellWorkflowSource, /preserveBackingPlate: true/);
  assert.match(workflow, /const orderedLogoUrls = identityReferences\.map\(\(reference\) => reference\.url\)/);
  assert.match(workflow, /identityReferenceAspectRatio/);
  assert.match(workflow, /identityBackgroundPolicy/);
  assert.match(workflow, /transparentPixelRatio/);
  assert.match(workflow, /identityReferences\[index\]\?\.visibleContentRect\?\.width/);
  assert.match(workflow, /identityReferences\[index\]\?\.visibleContentRect\?\.height/);
  assert.doesNotMatch(workflow, /const cropWidth = Number\(identityReferences\[index\]\?\.cropRect\?\.width/);
  assert.match(workflow, /originalLogoUrl:/);
  assert.match(workflow, /identityReferenceUrl:/);
  assert.match(workflow, /identityReferenceVisibleContentRect:/);
  assert.match(workflow, /originalUrl: referenceUrl/);
  assert.match(workflow, /regionGuideUrl:/);
  assert.match(workflow, /logoUrls: orderedLogoUrls/);
  assert.match(workflow, /const imageInputUrls = \[referenceUrl, \.\.\.orderedLogoUrls\]/);
  assert.doesNotMatch(workflow, /const imageInputUrls = \[referenceUrl, regionGuideInputs\.regionGuideUrl/);
  assert.match(workflow, /preserveInputImageOrder: true/);
  assert.match(workflow, /1 \+ regionBindings\.length/);
});

test('single and corner presets select one region while multi preserves every numbered region', () => {
  const modeNormalizer = functionBlock('normalizeLogoReplaceMode');
  const regionResolver = functionBlock('resolveUnifiedLogoReplaceRegions');

  assert.match(modeNormalizer, /single_logo_region_replace/);
  assert.match(regionResolver, /mode === 'corner_badge_replace'/);
  assert.match(regionResolver, /mode === 'single_logo_region_replace'/);
  assert.match(regionResolver, /regions\.slice\(0, 1\)/);
  assert.match(regionResolver, /: regions/);
});

test('logo workflow preserves requirements and adapts finalization to surface or graphic placement', () => {
  const workflow = functionBlock('runLogoReplaceWorkflow');
  const resultFinalizer = functionBlock('finalizeLogoReplaceResultAsset');
  const lifecycle = functionBlock('completeLogoReplaceResultLifecycle');

  assert.match(shellWorkflowSource, /recoverLogoReplacementAnalysis/);
  assert.match(workflow, /logoReplaceAnalysisJobIds/);
  assert.match(workflow, /logoReplaceAnalysisJobId/);
  assert.match(workflow, /recoveryAnalysisJobId[\s\S]*recoverLogoReplacementAnalysis/);
  assert.match(workflow, /replacementRequirement: String\(region\.replacementRequirement \|\| ''\)\.trim\(\)/);
  assert.match(workflow, /globalRequirement: input\.prompt\.trim\(\)/);
  assert.match(workflow, /regionRects: generationRegionRects/);
  assert.match(workflow, /placementMode:/);
  assert.match(workflow, /targetBounds:/);
  assert.match(workflow, /editEnvelope:/);
  assert.match(workflow, /subFeature: 'logo_replace'/);
  assert.match(workflow, /skipPromptCleanupSuffix: true/);
  assert.match(workflow, /toProductReplaceResultItem/);
  assert.match(workflow, /completeLogoReplaceResultLifecycle/);
  assert.match(lifecycle, /finalizeLogoReplaceResultAsset/);
  assert.match(lifecycle, /analysisJobId: analysis\.jobId/);
  assert.match(lifecycle, /Number\(analysis\.creditsConsumed\)[\s\S]*Number\(finalizedItem\.creditsConsumed\)/);
  assert.doesNotMatch(lifecycle, /quality|status: 'error'/);
  assert.match(resultFinalizer, /referenceMaterial\.originalWidth/);
  assert.match(resultFinalizer, /referenceMaterial\.originalHeight/);
  assert.match(resultFinalizer, /fetchRemoteFileBlob\(providerImageUrl\)/);
  assert.match(resultFinalizer, /getImageDimensions\(providerBlob\)/);
  assert.match(resultFinalizer, /assertTranslationOutputAspectRatio/);
  assert.match(resultFinalizer, /persistGeneratedAsset/);
  assert.match(resultFinalizer, /createAiNativeLogoReplaceGuardedResultBlob/);
  assert.doesNotMatch(resultFinalizer, /overlayBlendMode: 'exact'/);
  assert.match(resultFinalizer, /logoReplaceRegionGuarded: true/);
  assert.match(resultFinalizer, /logoReplaceSemanticBlendGuarded: true/);
  assert.match(resultFinalizer, /logoReplacePlacementModes/);
  assert.match(resultFinalizer, /updateInternalJobResult/);
  assert.match(resultFinalizer, /originalProviderImageUrl: providerImageUrl/);
  assert.doesNotMatch(resultFinalizer, /drawImage/);
  assert.doesNotMatch(workflow, /persistGeneratedAsset|logoReplaceGuarded|createGuardedMultiLogoReplaceResultBlob|drawImage/);
});

test('logo recovery resumes post-processing from the existing generation job without resubmitting', () => {
  const recovery = functionBlock('resumeLogoReplaceGenerationResult');
  const lifecycle = functionBlock('completeLogoReplaceResultLifecycle');

  assert.match(recovery, /taskPurpose[\s\S]*logo_replace_generation/);
  assert.match(recovery, /generationResult\.imageUrl/);
  assert.match(recovery, /recoverLogoReplacementAnalysis/);
  assert.match(recovery, /completeLogoReplaceResultLifecycle/);
  assert.doesNotMatch(lifecycle, /Quality|quality|logo_replace_quality/);
  assert.match(lifecycle, /analysisJobId: analysis\.jobId/);
  assert.doesNotMatch(recovery, /processWithKieAi|analyzeLogoReplacement/);
});
