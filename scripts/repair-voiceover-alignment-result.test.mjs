import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALIGNMENT_REPAIR_CONFIRM_ENV,
  assertExistingRepairDependencies,
  assertMatchingVideoStreamHashes,
  assertRepairConfirmation,
  buildRepairedVoiceoverResult,
  hydrateRepairEvidenceIdentities,
  runWithRepairPool,
} from './repair-voiceover-alignment-result.mjs';

const parentJobId = 'a481ee4548872173fff21be1';
const sourceAssetId = '9e6df569c268f14f93ae1f83';
const previousAlignedAssetId = '1d84d0270059305b94e8daa9';
const previousFinalAssetId = '3f2a5285e43b710bd1873932';
const newAlignedAssetId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const newFinalAssetId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const userId = 'voiceoverrepairfixture';
const videoStreamSha256 = '4'.repeat(64);
const ttsAssetIds = ['7', '8', '9', 'c', 'd', 'e'].map((value) => value.repeat(24));

const sourceTexts = [
  '还在为洗澡换下来的衣服没地方放而苦恼吗？',
  '那不妨试试这款脏衣篮。',
  '吸盘式安装方便快捷，只需按压扣紧即可牢牢吸住。',
  '使用时只需像这样一拉一扣就固定住了。',
  '然后将网套上拉紧卡扣就可以开始使用了。',
  '大小不同的脏衣篮分类收纳，浴室瞬间整洁多了，不用时就放下来也不占空间，非常方便。',
];
const targetTexts = [
  'Still worried about having no place for dirty bath clothes?',
  'Try this laundry basket instead.',
  'The suction cup installation is fast; just press to lock it tightly.',
  'To use it, just pull and snap it to secure it.',
  'Then add the mesh and tighten the buckle.',
  'Sort by size for a neat bathroom. Fold to save space, very convenient.',
];
const windows = [
  [100, 3208, 4880, 1.57014157],
  [3345, 5000, 2760, 1.667673716],
  [5000, 9000, 5760, 1.44],
  [9000, 11973, 4840, 1.6279852],
  [12116, 15151, 3600, 1.18616145],
  [15299, 21872, 7680, 1.168416248],
];

const currentResult = {
  videoUrl: `/api/assets/file/${previousFinalAssetId}/voiceover-translated.mp4`,
  finalAssetId: previousFinalAssetId,
  sourceLanguage: 'cmn',
  targetLanguage: 'en',
  voiceName: 'Fenrir',
  voiceoverCheckpoint: {
    version: 1,
    stage: 'result_persisted',
    baseVideoAssetId: sourceAssetId,
    analysisAttempt: 0,
    analysisEvidenceVersion: 2,
    alignmentVersion: 1,
    originalAudioAssetId: '6349e6349c89c80800cd9489',
    vocalAssetId: 'e731309cc1ec5f98ed064a06',
    backgroundAssetId: '77950a1fd5586696f3af9c90',
    alignedAudioAssetId: previousAlignedAssetId,
    finalAssetId: previousFinalAssetId,
    analysis: {
      sourceLanguage: 'cmn',
      speakerCount: 1,
      voiceProfile: {
        pace: 'natural',
        pitch: 'high',
        energy: 'energetic',
        brightness: 'bright',
        accentDescription: 'clear Mainland Chinese female voice',
      },
      segments: sourceTexts.map((sourceText, index) => ({
        id: String(index + 1),
        startMs: index === 0 ? 100 : 4300 + ((index - 1) * 3900),
        endMs: index === 5 ? 22221 : 4300 + (index * 3900),
        sourceText,
        targetText: targetTexts[index],
      })),
    },
    translation: {
      mode: 'natural',
      targetLanguage: 'en',
      selectedVoiceName: 'Fenrir',
      segments: sourceTexts.map((sourceText, index) => ({
        id: String(index + 1),
        startMs: index === 0 ? 100 : 4300 + ((index - 1) * 3900),
        endMs: index === 5 ? 22221 : 4300 + (index * 3900),
        sourceText,
        targetText: targetTexts[index],
      })),
    },
    ttsGroups: windows.map(([, , actualDurationMs], index) => ({
      index,
      attempt: 0,
      childJobId: `${String(index + 1).repeat(24)}`,
      providerTaskId: `${String(index + 1).repeat(32)}`,
      assetId: ttsAssetIds[index],
      status: 'succeeded',
      startMs: index === 0 ? 100 : 4300 + ((index - 1) * 3900),
      endMs: index === 5 ? 22221 : 4300 + (index * 3900),
      actualDurationMs,
      atempo: 1,
    })),
  },
};

const evidence = {
  parentJobId,
  sourceAssetId,
  previousAlignedAssetId,
  previousFinalAssetId,
  analysisEvidenceVersion: 3,
  providerCallsCreated: 0,
  sourceAudioIncludedInFinalMix: false,
  backgroundAudioIncludedInFinalMix: false,
  timing: windows.map(([startMs, endMs, rawTtsDurationMs, atempo], index) => ({
    index: index + 1,
    sourceText: sourceTexts[index],
    translatedText: targetTexts[index],
    ttsText: targetTexts[index],
    rawTtsDurationMs,
    targetStartMs: startMs,
    targetEndMs: endMs,
    atempo,
    actualStartMs: startMs,
    actualEndMs: endMs,
    childJobId: currentResult.voiceoverCheckpoint.ttsGroups[index].childJobId,
    providerTaskId: currentResult.voiceoverCheckpoint.ttsGroups[index].providerTaskId,
    ttsAssetId: currentResult.voiceoverCheckpoint.ttsGroups[index].assetId,
    ttsContentHash: String(index + 1).repeat(64),
    actionEvidence: `segment ${index + 1}`,
  })),
};

const dependencyJob = {
  id: parentJobId,
  user_id: userId,
  module: 'video',
  task_type: 'voiceover_translate_video',
  provider: 'internal',
  status: 'succeeded',
  provider_task_id: null,
};
const dependencyChildren = currentResult.voiceoverCheckpoint.ttsGroups.map((group, index) => {
  const childKey = `tts:${index}:attempt:${group.attempt}`;
  return {
    id: group.childJobId,
    user_id: userId,
    module: 'video',
    task_type: 'kie_tts',
    provider: 'kie',
    status: 'succeeded',
    provider_task_id: group.providerTaskId,
    payload_json: JSON.stringify({
      groupIndex: index,
      targetLanguage: 'en',
      voiceName: 'Fenrir',
      dialogueTurns: [{ speaker: 'Speaker 1', text: targetTexts[index] }],
      temperature: 1,
      scene: 'Translated product voiceover with natural, controlled pacing.',
      sampleContext: 'Use one consistent narrator and preserve punctuation and pauses.',
      executionOwner: 'parent',
      parentJobId,
      childKey,
      clientSubmissionKey: `voiceover-child:${parentJobId}:${childKey}`,
    }),
    result_json: JSON.stringify({
      assetId: group.assetId,
      audioUrl: `managed://${group.assetId}`,
    }),
  };
});
const checkpointAssetIds = [
  sourceAssetId,
  currentResult.voiceoverCheckpoint.originalAudioAssetId,
  currentResult.voiceoverCheckpoint.vocalAssetId,
  currentResult.voiceoverCheckpoint.backgroundAssetId,
  previousAlignedAssetId,
  previousFinalAssetId,
];
const dependencyAssets = [
  ...checkpointAssetIds.map((id) => ({
    id,
    user_id: userId,
    storage_key: `${userId}/intermediate/${id}`,
    public_url: `/api/assets/file/${id}/asset`,
    content_hash: 'f'.repeat(64),
    mime_type: id === sourceAssetId || id === previousFinalAssetId ? 'video/mp4' : 'audio/wav',
    storage_status: 'active',
    deleted_at: null,
    job_id: id === sourceAssetId ? null : parentJobId,
  })),
  ...currentResult.voiceoverCheckpoint.ttsGroups.map((group, index) => ({
    id: group.assetId,
    user_id: userId,
    storage_key: `${userId}/intermediate/${group.assetId}.wav`,
    public_url: `/api/assets/file/${group.assetId}/kie_tts.wav`,
    content_hash: evidence.timing[index].ttsContentHash,
    mime_type: 'audio/x-wav',
    provider: 'kie',
    storage_status: 'active',
    deleted_at: null,
    job_id: parentJobId,
  })),
];

test('repair confirmation must exactly name the paid parent job', () => {
  assert.throws(
    () => assertRepairConfirmation({}, parentJobId),
    (error) => error.code === 'voiceover_alignment_repair_confirmation_required',
  );
  assert.throws(
    () => assertRepairConfirmation({ [ALIGNMENT_REPAIR_CONFIRM_ENV]: 'other-job' }, parentJobId),
    (error) => error.code === 'voiceover_alignment_repair_confirmation_required',
  );
  assert.doesNotThrow(() => assertRepairConfirmation({
    [ALIGNMENT_REPAIR_CONFIRM_ENV]: parentJobId,
  }, parentJobId));
});

test('repair keeps the database pool open until the operation settles', async () => {
  const events = [];
  let resolveOperation;
  const operationGate = new Promise((resolve) => {
    resolveOperation = resolve;
  });
  const resultPromise = runWithRepairPool({
    end: async () => {
      events.push('pool-ended');
    },
  }, async () => {
    events.push('operation-started');
    await operationGate;
    events.push('operation-finished');
    return 'done';
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['operation-started']);
  resolveOperation();
  assert.equal(await resultPromise, 'done');
  assert.deepEqual(events, [
    'operation-started',
    'operation-finished',
    'pool-ended',
  ]);
});

test('repair result replaces only aligned/final assets and semantic timing', () => {
  const repaired = buildRepairedVoiceoverResult({
    parentJobId,
    currentResult,
    evidence,
    newAlignedAsset: {
      id: newAlignedAssetId,
      publicUrl: `/api/assets/file/${newAlignedAssetId}/voiceover-aligned-v3.wav`,
      contentHash: 'a'.repeat(64),
    },
    newFinalAsset: {
      id: newFinalAssetId,
      publicUrl: `/api/assets/file/${newFinalAssetId}/voiceover-translated-v3.mp4`,
      contentHash: 'b'.repeat(64),
    },
    repairedAt: 1785620000000,
    videoStreamSha256,
    rollbackBackupPath: '/secure/repair-backup.json',
  });

  assert.equal(repaired.finalAssetId, newFinalAssetId);
  assert.equal(repaired.voiceoverCheckpoint.finalAssetId, newFinalAssetId);
  assert.equal(repaired.voiceoverCheckpoint.alignedAudioAssetId, newAlignedAssetId);
  assert.equal(repaired.voiceoverCheckpoint.analysisEvidenceVersion, 3);
  assert.deepEqual(
    repaired.voiceoverCheckpoint.analysis.segments.map(({ startMs, endMs }) => [startMs, endMs]),
    windows.map(([startMs, endMs]) => [startMs, endMs]),
  );
  assert.deepEqual(
    repaired.voiceoverCheckpoint.ttsGroups.map(({ childJobId, providerTaskId, assetId }) => ({
      childJobId, providerTaskId, assetId,
    })),
    currentResult.voiceoverCheckpoint.ttsGroups.map(({
      childJobId, providerTaskId, assetId,
    }) => ({ childJobId, providerTaskId, assetId })),
  );
  assert.deepEqual(
    repaired.voiceoverCheckpoint.ttsGroups.map(({ startMs, endMs, atempo }) => ({
      startMs, endMs, atempo,
    })),
    windows.map(([startMs, endMs, , atempo]) => ({ startMs, endMs, atempo })),
  );
  assert.equal(repaired.voiceoverRepairEvidence.previousFinalAssetId, previousFinalAssetId);
  assert.equal(repaired.voiceoverRepairEvidence.previousAlignedAudioAssetId, previousAlignedAssetId);
  assert.equal(repaired.voiceoverRepairEvidence.providerCallsCreated, 0);
  assert.equal(repaired.voiceoverRepairEvidence.videoStreamSha256, videoStreamSha256);
  assert.equal('rollbackBackupPath' in repaired.voiceoverRepairEvidence, false);
  assert.doesNotMatch(
    JSON.stringify(repaired.voiceoverRepairEvidence),
    /providerTaskId/u,
  );
  assert.doesNotMatch(JSON.stringify(repaired), /\/secure\/repair-backup\.json/u);
});

test('repair hydrates durable identities without requiring provider task ids in evidence', () => {
  const redactedEvidence = {
    ...structuredClone(evidence),
    previousAlignedAssetId: undefined,
    timing: evidence.timing.map((item) => {
      const {
        childJobId: _childJobId,
        providerTaskId: _providerTaskId,
        ttsAssetId: _ttsAssetId,
        ...publicItem
      } = item;
      return publicItem;
    }),
  };
  const hydrated = hydrateRepairEvidenceIdentities({
    currentResult,
    evidence: redactedEvidence,
    assetRows: dependencyAssets,
  });

  assert.equal(
    hydrated.previousAlignedAssetId,
    currentResult.voiceoverCheckpoint.alignedAudioAssetId,
  );
  assert.deepEqual(
    hydrated.timing.map(({ childJobId, providerTaskId, ttsAssetId }) => ({
      childJobId,
      providerTaskId,
      ttsAssetId,
    })),
    currentResult.voiceoverCheckpoint.ttsGroups.map((group) => ({
      childJobId: group.childJobId,
      providerTaskId: group.providerTaskId,
      ttsAssetId: group.assetId,
    })),
  );

  const wrongHash = structuredClone(redactedEvidence);
  wrongHash.timing[0].ttsContentHash = '0'.repeat(64);
  assert.throws(
    () => hydrateRepairEvidenceIdentities({
      currentResult,
      evidence: wrongHash,
      assetRows: dependencyAssets,
    }),
    (error) => error.code === 'voiceover_alignment_repair_invalid',
  );
});

test('repair refuses text drift, provider calls, and mixed source audio', () => {
  for (const invalidEvidence of [
    { ...evidence, providerCallsCreated: 1 },
    { ...evidence, sourceAudioIncludedInFinalMix: true },
    {
      ...evidence,
      timing: evidence.timing.map((item, index) => (
        index === 2 ? { ...item, ttsText: 'different text' } : item
      )),
    },
  ]) {
    assert.throws(
      () => buildRepairedVoiceoverResult({
        parentJobId,
        currentResult,
        evidence: invalidEvidence,
        newAlignedAsset: { id: newAlignedAssetId, publicUrl: '/aligned.wav' },
        newFinalAsset: { id: newFinalAssetId, publicUrl: '/final.mp4' },
        repairedAt: 1785620000000,
        videoStreamSha256,
        rollbackBackupPath: '/secure/repair-backup.json',
      }),
      (error) => error.code === 'voiceover_alignment_repair_invalid',
    );
  }
});

test('repair requires every existing child, provider, TTS asset, and TTS text identity', () => {
  const valid = {
    parentJobId,
    job: dependencyJob,
    ownerRows: [{ id: userId, status: 'active' }],
    currentResult,
    evidence,
    childRows: dependencyChildren,
    assetRows: dependencyAssets,
  };
  assert.doesNotThrow(() => assertExistingRepairDependencies(valid));

  const mutations = [
    (input) => {
      input.childRows[2].provider_task_id = 'different-provider-task';
    },
    (input) => {
      const result = JSON.parse(input.childRows[1].result_json);
      result.assetId = newAlignedAssetId;
      input.childRows[1].result_json = JSON.stringify(result);
    },
    (input) => {
      const payload = JSON.parse(input.childRows[4].payload_json);
      payload.dialogueTurns[0].text = 'different TTS text';
      input.childRows[4].payload_json = JSON.stringify(payload);
    },
    (input) => {
      const asset = input.assetRows.find((item) => item.id === ttsAssetIds[5]);
      asset.storage_status = 'deleted';
      asset.deleted_at = 1;
    },
    (input) => {
      input.evidence.timing[0].ttsContentHash = 'a'.repeat(64);
    },
    (input) => {
      input.ownerRows[0].status = 'disabled';
    },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(
      () => assertExistingRepairDependencies(invalid),
      (error) => error.code === 'voiceover_alignment_repair_invalid',
    );
  }
});

test('repair requires the corrected MP4 to preserve the exact source H.264 stream', () => {
  const hash = '4'.repeat(64);
  assert.equal(assertMatchingVideoStreamHashes(hash, hash), hash);
  for (const [sourceHash, finalHash] of [
    [hash, '5'.repeat(64)],
    ['', hash],
    [hash, 'invalid'],
  ]) {
    assert.throws(
      () => assertMatchingVideoStreamHashes(sourceHash, finalHash),
      (error) => error.code === 'voiceover_alignment_repair_invalid',
    );
  }
});
