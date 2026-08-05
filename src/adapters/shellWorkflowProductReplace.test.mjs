import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowSource = readFileSync(new URL('./shellWorkflow.ts', import.meta.url), 'utf8');

const productWorkflow = workflowSource.match(
  /const runProductReplaceWorkflow = async \([\s\S]*?(?=\n\nconst runBackgroundReplaceWorkflow)/,
)?.[0] || '';
const productGuideBuilder = workflowSource.match(
  /const buildProductReplaceRegionGuideInputs = async \([\s\S]*?(?=\n\nconst resolveLogoReplaceRegionLogo)/,
)?.[0] || '';

test('combination product replacement validates every reference before starting concurrent submissions', () => {
  assert.ok(productWorkflow, 'missing product replacement workflow');
  const validationIndex = productWorkflow.indexOf('const combinationBindingsByReference');
  const submissionIndex = productWorkflow.indexOf('mapProductReplaceWithConcurrency');

  assert.ok(validationIndex >= 0, 'missing per-reference region validation');
  assert.ok(submissionIndex > validationIndex, 'region validation must finish before any per-reference submission');
  assert.match(productWorkflow, /referenceEntries\.map\(\(\{ material \}\) => assertProductReplaceRegionCoverage/);
  assert.match(productWorkflow, /regions: material\.productReplaceRegions/);
  assert.match(productWorkflow, /hasLocationGuide: false/);
});

test('each combination reference sends the numbered guide only to planning and sends a clean generation input set', () => {
  assert.match(productGuideBuilder, /labelPrefix: 'P'/);
  assert.match(productWorkflow, /await analyzeProductReplacement\(/);
  assert.match(productWorkflow, /referenceUrl,\s*regionGuideUrl: regionGuideInputs\.regionGuideUrl,\s*productUrls,\s*bindings: regionBindings/);
  assert.match(productWorkflow, /planningAnalysis: analysis\.normalizedAnalysis/);
  assert.match(
    productWorkflow,
    /\[referenceUrl, \.\.\.productUrls, \.\.\.logoInputs\.imageUrls\]/,
  );
  assert.doesNotMatch(
    productWorkflow,
    /\[referenceUrl, regionGuideInputs\.regionGuideUrl, \.\.\.productUrls/,
  );
  assert.match(productWorkflow, /productReplaceProcessingMode: 'per_reference_manual_region_analysis_generation_v7_product_specific_prompt'/);
  assert.match(productWorkflow, /productReplaceAnalysisJobId: analysis\.jobId/);
  assert.match(productWorkflow, /analysisJobId: analysis\.jobId/);
  assert.match(productWorkflow, /productReplaceAnalysisCreditsConsumed: analysis\.creditsConsumed/);
  assert.match(productWorkflow, /productReplaceGenerationCreditsConsumed: generatedItem\.creditsConsumed/);
});

test('combination retry recovers each reference analysis by its matching batch index', () => {
  assert.match(workflowSource, /recoverProductReplacementAnalysis/);
  assert.match(productWorkflow, /const productReplaceAnalysisJobIds = Array\.isArray\(input\.taskMetadata\?\.productReplaceAnalysisJobIds\)/);
  assert.match(productWorkflow, /const recoveryAnalysisJobId = productReplaceAnalysisJobIds\[referenceIndex\]/);
  assert.match(
    productWorkflow,
    /recoveryAnalysisJobId\s*\?\s*await recoverProductReplacementAnalysis\(\{\s*jobId: recoveryAnalysisJobId,\s*bindings: regionBindings,\s*signal: input\.signal,\s*\}\)\s*:\s*await analyzeProductReplacement\(/,
  );
});

test('combination retry preserves original batch identity when only failed references are resubmitted', () => {
  assert.match(productWorkflow, /const productReplaceReferenceBatchIndexes = Array\.isArray\(input\.taskMetadata\?\.productReplaceReferenceBatchIndexes\)/);
  assert.match(productWorkflow, /const originalReferenceCount = Math\.max\(\s*total,/);
  assert.match(productWorkflow, /const currentBatchIndex = productReplaceReferenceBatchIndexes\[referenceIndex\] \|\| referenceIndex \+ 1/);
  assert.match(productWorkflow, /batchCount: originalReferenceCount/);
  assert.match(productWorkflow, /referenceCount: originalReferenceCount/);
  assert.match(productWorkflow, /onItemCompleted\?\.\(item, currentBatchIndex, originalReferenceCount\)/);
});

test('single-product replacement remains direct and product replacement has no post-generation judge', () => {
  assert.match(productWorkflow, /if \(!isCombination\)/);
  assert.match(productWorkflow, /\[\.\.\.productUrls, referenceUrl, \.\.\.logoInputs\.imageUrls\]/);
  assert.doesNotMatch(productWorkflow, /qualityAcceptance|qualityJudge|postGenerationReview|analyzeGeneratedProduct/);
});
