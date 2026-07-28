import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('create dialog exposes automatic generation and manual upload after shared profile creation', () => {
  const source = read('./VirtualModelCreateDialog.tsx');
  assert.match(source, /自动生成素材/);
  assert.match(source, /手动上传八张/);
  assert.match(source, /createVirtualModel\(/);
  assert.match(source, /createVirtualModelVersion\(/);
  assert.match(source, /createVirtualModelGenerationBatch\(/);
  assert.match(source, /finalizeVirtualModelGenerationBatch\(/);
  assert.match(source, /resumeBatch: VirtualModelGenerationBatch \| null/);
  assert.match(source, /if \(open && resumeBatch\) \{/);
  assert.match(source, /setMode\('auto'\)/);
  assert.match(source, /setBatch\(resumeBatch\)/);
  assert.doesNotMatch(source, /cancelVirtualModelGenerationBatch.*onOpenChange/);
});

test('new model profile is prepared once and reused by either creation method', () => {
  const source = read('./VirtualModelCreateDialog.tsx');
  assert.match(source, /onManualCreated: \(result: \{[\s\S]*?virtualModelId: string;[\s\S]*?virtualModelVersionId: string;[\s\S]*?\}\) => Promise<void> \| void/);
  assert.match(source, /const \[modelCode, setModelCode\] = useState\(''\)/);
  assert.match(source, /const \[modelName, setModelName\] = useState\(''\)/);
  assert.match(source, /const \[identityDescription, setIdentityDescription\] = useState\(''\)/);
  assert.match(source, /const \[preparedModelId, setPreparedModelId\] = useState\(''\)/);
  assert.match(source, /const \[preparedVersionId, setPreparedVersionId\] = useState\(''\)/);
  assert.match(source, /const profileValid = Boolean\(modelCode\.trim\(\) && modelName\.trim\(\)\)/);
  assert.ok(source.indexOf('模特编码') < source.indexOf("mode === 'choose'"));
  assert.match(source, /identityProfile: \{ description: identityDescription\.trim\(\) \}/);
  assert.match(source, /if \(!modelId\) \{[\s\S]*?createVirtualModel\(\{[\s\S]*?code: modelCode\.trim\(\),[\s\S]*?name: modelName\.trim\(\),?[\s\S]*?\}\)/);
  assert.match(source, /if \(!versionId\) \{[\s\S]*?createVirtualModelVersion\(modelId, \{[\s\S]*?identityProfile/);
  assert.match(source, /onManualCreated\(\{[\s\S]*?virtualModelId: modelId,[\s\S]*?virtualModelVersionId: versionId,[\s\S]*?\}\)/);
  assert.match(source, /disabled=\{pending \|\| !profileValid\}/);
});

test('a fresh dialog has an editable suggested model code', () => {
  const source = read('./VirtualModelCreateDialog.tsx');
  assert.match(source, /initialModelCode: string/);
  assert.match(source, /if \(open && !resumeBatch\) \{[\s\S]*?setModelCode\(initialModelCode\)/);
  assert.match(source, /value=\{modelCode\}[\s\S]*?onChange=\{\(event\) => \{[\s\S]*?setModelCode\(event\.target\.value\)/);
  assert.doesNotMatch(source, /value=\{modelCode\}[^>]*readOnly/);
});

test('reference step enforces one to five image uploads and primary selection', () => {
  const source = read('./VirtualModelReferenceUploadStep.tsx');
  assert.match(source, /accept="image\/\*"/);
  assert.match(source, /multiple/);
  assert.match(source, /assets\.length \+ files\.length > 5/);
  assert.match(source, /module: 'virtual_model_generation'/);
  assert.match(source, /onPrimaryChange/);
  assert.match(source, /设为主参考|主参考/);
});

test('pose step polls safely and exposes explicit retry regenerate cancel finalize and download', () => {
  const source = read('./VirtualModelPoseGenerationStep.tsx');
  assert.match(source, /2500/);
  assert.match(source, /AbortController/);
  assert.match(source, /clearTimeout/);
  assert.match(source, /mergeVirtualModelBatchPoll/);
  assert.match(source, /canRetryVirtualModelPose/);
  assert.match(source, /canFinalizeVirtualModelBatch/);
  assert.match(source, /aria-label=\{retryLabel\}/);
  assert.match(source, /aria-label="取消生成"/);
  assert.match(source, /regenerateVirtualModelDerivedPoses/);
  assert.match(source, /onFinalize: \(\) => Promise<void>/);
  assert.match(source, /onClick=\{\(\) => void onFinalize\(\)\}/);
  assert.match(source, /downloadRemoteFile/);
  assert.match(source, /aria-label=\{`下载 \$\{task\.label\}`\}/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /autoRetry|automaticRetry/);
});

test('create batch request reuses one stable client submission key', () => {
  const source = read('./VirtualModelCreateDialog.tsx');
  assert.match(source, /const \[clientSubmissionKey, setClientSubmissionKey\] = useState\(''\)/);
  assert.match(source, /const submissionKey = clientSubmissionKey \|\| createClientSubmissionKey\(\)/);
  assert.match(source, /setClientSubmissionKey\(submissionKey\)/);
  assert.match(source, /clientSubmissionKey: submissionKey/);
  assert.doesNotMatch(source, /clientSubmissionKey: createClientSubmissionKey\(\)/);
});
