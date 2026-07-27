import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createVirtualModelDraft,
  createVirtualModelVersion,
  listAdminVirtualModels,
  listPublishedVirtualModels,
  publishVirtualModelVersion,
  replaceDraftVersionAssets,
  createVirtualModelGenerationJobSnapshot,
  resolveHistoricalVirtualModelSelectedAssets,
  toVirtualModelPublicSummary,
  updateVirtualModelDraft,
} from './virtualModelStore.mjs';

const slots = ['front_close', 'left_45_close', 'right_45_close', 'profile_close', 'front_half', 'three_quarter_half', 'front_full', 'three_quarter_full'];

const createPublishedModel = async () => {
  const store = {};
  const model = await createVirtualModelDraft({ store, code: 'VM-01', name: 'Published model', tags: ['catalog'] });
  const version = await createVirtualModelVersion({ store, virtualModelId: model.id, identityProfile: { description: 'Oval face, defined jawline, long straight black hair.' }, createdBy: 'admin-1' });
  await replaceDraftVersionAssets({
    store,
    virtualModelVersionId: version.id,
    assets: slots.map((slot, index) => ({
      slot,
      assetId: `asset-${index}`,
      publicUrl: `https://managed/${index}.png`,
      previewAssetId: `preview-${index}`,
      previewUrl: `https://managed/preview-${index}.jpg`,
      position: index + 1,
      isPrimary: index === 0,
      validationStatus: 'passed',
    })),
  });
  assert.equal((await publishVirtualModelVersion({ store, virtualModelId: model.id, virtualModelVersionId: version.id })).ok, true);
  return { store, model, version };
};

test('public list exposes published summaries only', async () => {
  const { store } = await createPublishedModel();
  const models = (await listPublishedVirtualModels({ store })).map(toVirtualModelPublicSummary);

  assert.equal(models.every((model) => model.status === 'published'), true);
  assert.equal('identityProfile' in models[0].version, false);
  assert.equal('createdBy' in models[0], false);
  assert.equal('assets' in models[0].version, false);
  assert.equal(JSON.stringify(models[0]).includes('https://managed/1.png'), false);
  assert.equal(JSON.stringify(models[0]).includes('asset-0'), false);
});

test('server intake creates a URL-free library snapshot with three selected asset IDs', async () => {
  const { store, model, version } = await createPublishedModel();
  const snapshot = await createVirtualModelGenerationJobSnapshot({
    store,
    virtualModelId: model.id,
    virtualModelVersionId: version.id,
    referenceAnalysis: { framing: 'half_body', faceDirection: 'front' },
  });

  assert.deepEqual(snapshot.selectedAssetIds, ['asset-0', 'asset-1', 'asset-2']);
  assert.deepEqual(snapshot.selectedIdentitySlots, ['front_close', 'left_45_close', 'right_45_close']);
  assert.equal(snapshot.identityImageCount, 3);
  assert.equal(snapshot.identitySelectionStrategy, 'reference_analysis');
  assert.equal(JSON.stringify(snapshot).includes('https://managed/1.png'), false);
  assert.equal(JSON.stringify(snapshot).includes('https://managed/0.png'), false);
  assert.equal('virtualModelCoverSnapshot' in snapshot, false);
  assert.equal(snapshot.virtualModelCoverAssetId, 'asset-0');
  assert.equal('identityProfile' in snapshot, false);
  assert.equal(snapshot.identityDescription, 'Oval face, defined jawline, long straight black hair.');
});

test('each lightweight reference analysis selects its own matching three-asset set without body direction', async () => {
  const { store, model, version } = await createPublishedModel();
  const rightFull = await createVirtualModelGenerationJobSnapshot({
    store,
    virtualModelId: model.id,
    virtualModelVersionId: version.id,
    referenceAnalysis: {
      framing: 'full_body',
      faceDirection: 'right',
      headPitch: 'level',
      occlusion: 'medium',
      exposedSkinRegions: ['face', 'hands'],
    },
  });
  const leftHalf = await createVirtualModelGenerationJobSnapshot({
    store,
    virtualModelId: model.id,
    virtualModelVersionId: version.id,
    referenceAnalysis: {
      framing: 'half_body',
      faceDirection: 'left',
      headPitch: 'down',
      occlusion: 'low',
      exposedSkinRegions: ['face', 'neck'],
    },
  });

  assert.deepEqual(rightFull.selectedIdentitySlots, [
    'front_close', 'right_45_close', 'three_quarter_full',
  ]);
  assert.deepEqual(leftHalf.selectedIdentitySlots, [
    'front_close', 'left_45_close', 'profile_close',
  ]);
  assert.notDeepEqual(rightFull.selectedAssetIds, leftHalf.selectedAssetIds);
  for (const snapshot of [rightFull, leftHalf]) {
    assert.equal(snapshot.selectedAssetIds.length, 3);
    assert.equal(new Set(snapshot.selectedAssetIds).size, 3);
    assert.equal(snapshot.selectedIdentitySlots[0], 'front_close');
    assert.equal(snapshot.identitySelectionStrategy, 'reference_analysis');
  }
});

test('server selection covers every approved framing and face-direction combination', async () => {
  const { store, model, version } = await createPublishedModel();
  const cases = [
    [{ framing: 'half_body', faceDirection: 'front' }, ['front_close', 'left_45_close', 'right_45_close']],
    [{ framing: 'full_body', faceDirection: 'front' }, ['front_close', 'front_half', 'front_full']],
    [{ framing: 'half_body', faceDirection: 'left' }, ['front_close', 'left_45_close', 'profile_close']],
    [{ framing: 'half_body', faceDirection: 'right' }, ['front_close', 'right_45_close', 'three_quarter_half']],
    [{ framing: 'full_body', faceDirection: 'left' }, ['front_close', 'left_45_close', 'three_quarter_full']],
    [{ framing: 'full_body', faceDirection: 'right' }, ['front_close', 'right_45_close', 'three_quarter_full']],
    [{ framing: 'half_body', faceDirection: 'profile' }, ['front_close', 'profile_close', 'three_quarter_half']],
    [{ framing: 'full_body', faceDirection: 'profile' }, ['front_close', 'three_quarter_half', 'three_quarter_full']],
    [null, ['front_close', 'left_45_close', 'right_45_close']],
  ];

  for (const [referenceAnalysis, expectedSlots] of cases) {
    const snapshot = await createVirtualModelGenerationJobSnapshot({
      store,
      virtualModelId: model.id,
      virtualModelVersionId: version.id,
      referenceAnalysis,
    });
    assert.deepEqual(snapshot.selectedIdentitySlots, expectedSlots);
  }
});

test('server rejects a three-slot selection whose slots share an asset ID', async () => {
  const { store, model, version } = await createPublishedModel();
  const left = store.virtualModelAssets.find((asset) => asset.slot === 'left_45_close');
  const right = store.virtualModelAssets.find((asset) => asset.slot === 'right_45_close');
  right.assetId = left.assetId;

  await assert.rejects(
    () => createVirtualModelGenerationJobSnapshot({
      store,
      virtualModelId: model.id,
      virtualModelVersionId: version.id,
      referenceAnalysis: { framing: 'half_body', faceDirection: 'front' },
    }),
    (error) => error.code === 'MODEL_ASSET_INCOMPLETE',
  );
});

test('historical selected asset resolution remains available after unpublishing', async () => {
  const { store, model, version } = await createPublishedModel();
  const snapshot = await createVirtualModelGenerationJobSnapshot({ store, virtualModelId: model.id, virtualModelVersionId: version.id });
  store.virtualModels[0].status = 'unpublished';
  store.virtualModels[0].currentVersionId = null;

  const assets = await resolveHistoricalVirtualModelSelectedAssets({ store, virtualModelId: model.id, virtualModelVersionId: version.id, selectedAssetIds: snapshot.selectedAssetIds });
  assert.deepEqual(assets.map((asset) => asset.url), [
    'https://managed/0.png', 'https://managed/1.png', 'https://managed/2.png',
  ]);
});

test('historical retry accepts its durable published version after a newer version is published', async () => {
  const { store, model, version } = await createPublishedModel();
  const first = await createVirtualModelGenerationJobSnapshot({
    store, virtualModelId: model.id, virtualModelVersionId: version.id,
    referenceAnalysis: { framing: 'half_body', faceDirection: 'front' },
  });
  const newerVersion = await createVirtualModelVersion({ store, virtualModelId: model.id, identityProfile: { gender: 'female' }, createdBy: 'admin-1' });
  await replaceDraftVersionAssets({
    store,
    virtualModelVersionId: newerVersion.id,
    assets: slots.map((slot, index) => ({
      slot,
      assetId: `newer-asset-${index}`,
      publicUrl: `https://managed/newer-${index}.png`,
      previewAssetId: `newer-preview-${index}`,
      previewUrl: `https://managed/newer-preview-${index}.jpg`,
      position: index + 1,
      isPrimary: index === 0,
      validationStatus: 'passed',
    })),
  });
  assert.equal((await publishVirtualModelVersion({ store, virtualModelId: model.id, virtualModelVersionId: newerVersion.id })).ok, true);

  await assert.rejects(
    () => createVirtualModelGenerationJobSnapshot({
      store, virtualModelId: model.id, virtualModelVersionId: version.id,
      referenceAnalysis: { framing: 'half_body', faceDirection: 'front' },
    }),
    (error) => error?.code === 'MODEL_NOT_PUBLISHED',
  );

  const replay = await createVirtualModelGenerationJobSnapshot({
    store, virtualModelId: model.id, virtualModelVersionId: version.id,
    referenceAnalysis: { framing: 'half_body', faceDirection: 'front' },
    allowHistoricalPublishedVersion: true,
    publishedAt: first.publishedAt,
    selectedAssetIds: first.selectedAssetIds,
  });
  assert.deepEqual(replay.selectedAssetIds, first.selectedAssetIds);
  await assert.rejects(
    () => createVirtualModelGenerationJobSnapshot({
      store, virtualModelId: model.id, virtualModelVersionId: version.id,
      referenceAnalysis: { framing: 'half_body', faceDirection: 'front' },
      allowHistoricalPublishedVersion: true,
      publishedAt: first.publishedAt,
      selectedAssetIds: [...first.selectedAssetIds].reverse(),
    }),
    (error) => error.code === 'MODEL_SNAPSHOT_UNAVAILABLE',
  );
});

test('historical four-image library jobs remain replayable after new jobs adopt three images', async () => {
  const { store, model, version } = await createPublishedModel();
  const legacySelections = [
    ['asset-0', 'asset-1', 'asset-2', 'asset-6'],
    ['asset-0', 'asset-1', 'asset-2', 'asset-4', 'asset-6'],
  ];

  for (const legacySelectedAssetIds of legacySelections) {
    const replay = await createVirtualModelGenerationJobSnapshot({
      store,
      virtualModelId: model.id,
      virtualModelVersionId: version.id,
      allowHistoricalPublishedVersion: true,
      publishedAt: store.virtualModelVersions[0].publishedAt,
      selectedAssetIds: legacySelectedAssetIds,
    });

    assert.deepEqual(replay.selectedAssetIds, legacySelectedAssetIds);
    assert.equal(replay.identityImageCount, legacySelectedAssetIds.length);
  }
});

test('historical retry rejects a never-published draft version', async () => {
  const store = {};
  const model = await createVirtualModelDraft({ store, code: 'VM-DRAFT', name: 'Draft model', tags: [] });
  const version = await createVirtualModelVersion({ store, virtualModelId: model.id, identityProfile: { gender: 'female' }, createdBy: 'admin-1' });
  await replaceDraftVersionAssets({
    store,
    virtualModelVersionId: version.id,
    assets: slots.map((slot, index) => ({
      slot, assetId: `draft-asset-${index}`, publicUrl: `https://managed/draft-${index}.png`,
      position: index + 1, isPrimary: index === 0, validationStatus: 'passed',
    })),
  });

  await assert.rejects(
    () => createVirtualModelGenerationJobSnapshot({
      store, virtualModelId: model.id, virtualModelVersionId: version.id,
      allowHistoricalPublishedVersion: true,
      publishedAt: 0,
      selectedAssetIds: ['draft-asset-0', 'draft-asset-1', 'draft-asset-2', 'draft-asset-6'],
    }),
    (error) => error?.code === 'MODEL_NOT_PUBLISHED',
  );
});

test('worker resolves library assets only immediately before provider execution', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const worker = source.slice(source.indexOf('const injectLibraryModelAssetsForProvider'), source.indexOf('const executeProviderJobWithManagedAssetScrub'));
  assert.match(worker, /resolveHistoricalVirtualModelSelectedAssets/);
  assert.match(worker, /imageUrls: \[\.\.\.assets\.map\(\(asset\) => asset\.url\)/);
  assert.match(worker, /图A实际素材角度/);
  assert.match(worker, /图A-\$\{index \+ 1\}（输入图\$\{index \+ 1\}）/);
  assert.doesNotMatch(worker, /图B（输入图\$\{assets\.length \+ 1\}）/);
  assert.doesNotMatch(worker, /唯一主身份锚点|不得继承该图中的穿搭/);
  assert.match(worker, /front_close/);
  assert.match(worker, /左侧45度近景/);
  assert.match(worker, /identityDescription/);
  assert.match(worker, /身份档案补充（次于图A-1）/);
  assert.match(worker, /与图A-1冲突时一律以图A-1为准/);
  assert.doesNotMatch(worker, /高优先级/);
  assert.match(worker, /insertModelReplaceLibraryMetadata/);
  const intake = source.slice(source.indexOf("if (url.pathname === '/api/jobs' && req.method === 'POST')"), source.indexOf("if (url.pathname === '/api/jobs' && req.method === 'GET')"));
  assert.match(intake, /createLibraryModelJobPayload/);
  assert.doesNotMatch(intake, /selectedIdentityAssetIds/);
});

test('worker grants provider reads only to the server-validated virtual-model asset ids', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const worker = source.slice(
    source.indexOf('const executeProviderJobWithManagedAssetScrub'),
    source.indexOf('const prepareAgentModelImageUrl'),
  );
  const injectionIndex = worker.indexOf('await injectLibraryModelAssetsForProvider');
  const allowlistIndex = worker.indexOf('authorizedSharedAssetIds: authorizedLibraryManagedAssetIds');
  assert.ok(injectionIndex >= 0, 'library assets must be resolved from the trusted server snapshot');
  assert.ok(allowlistIndex > injectionIndex, 'the trusted library ids must be passed only after server resolution');
  assert.match(worker, /new Set\([\s\S]*providerPayload\.selectedAssetIds/);
});

test('library prompt metadata is inserted before format and example sections', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const helperBlock = source.match(/const insertModelReplaceLibraryMetadata = \(prompt, metadataBlock\) => \{[\s\S]*?^};/m)?.[0] || '';
  assert.ok(helperBlock, 'missing library prompt metadata insertion helper');
  const insertModelReplaceLibraryMetadata = Function(`${helperBlock}\nreturn insertModelReplaceLibraryMetadata;`)();
  const result = insertModelReplaceLibraryMetadata(
    'R Role 角色\n\nC Constraint 约束\n\nF Format 格式\noutput\n\nE Example 示例\nexample',
    '【图A实际素材角度】\n图A-1：正面近景。',
  );

  assert.ok(result.indexOf('【图A实际素材角度】') < result.indexOf('F Format 格式'));
  assert.ok(result.indexOf('F Format 格式') < result.indexOf('E Example 示例'));
  assert.equal(result.split('【图A实际素材角度】').length - 1, 1);
});

test('admin metadata updates are limited to draft model fields', async () => {
  const store = {};
  const model = await createVirtualModelDraft({ store, code: 'VM-UPDATE', name: 'Before', tags: [] });
  const updated = await updateVirtualModelDraft({ store, virtualModelId: model.id, name: 'After', tags: ['new'] });

  assert.equal(updated.name, 'After');
  assert.deepEqual(updated.tags, ['new']);
  assert.equal(updated.status, 'draft');
});

test('admin list returns draft management details and can filter by status', async () => {
  const store = {};
  const draft = await createVirtualModelDraft({ store, code: 'VM-DRAFT-LIST', name: 'Draft list model', tags: [] });
  const version = await createVirtualModelVersion({ store, virtualModelId: draft.id, identityProfile: { gender: 'female' }, createdBy: 'admin-1' });
  await replaceDraftVersionAssets({ store, virtualModelId: draft.id, virtualModelVersionId: version.id, assets: [] });

  const models = await listAdminVirtualModels({ store, status: 'draft' });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, draft.id);
  assert.equal(models[0].version.identityProfile.gender, 'female');
  assert.deepEqual(models[0].version.assets, []);
});

test('both authenticated route handlers provide public and admin virtual-model routes without a resolve endpoint', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const handleVirtualModelApiRequest'), source.indexOf('const handleMysqlRequest'));
  const deleteHandlerSource = await readFile(new URL('./virtualModelHttpApi.mjs', import.meta.url), 'utf8');
  for (const routeName of ['publicDetailMatch', 'adminDetailMatch', 'adminDeleteMatch', 'adminVersionMatch', 'adminAssetsMatch', 'adminPublishMatch', 'adminUnpublishMatch']) {
    assert.match(handler, new RegExp(`const ${routeName} = url\\.pathname\\.match`));
  }
  assert.match(handler, /url\.pathname === '\/api\/virtual-models'/);
  assert.match(handler, /url\.pathname === '\/api\/admin\/virtual-models'/);
  assert.match(handler, /url\.pathname === '\/api\/admin\/virtual-models' && req\.method === 'GET'/);
  assert.match(handler, /listAdminVirtualModels/);
  const isAdminWriteBlock = handler.slice(handler.indexOf('const isAdminWrite'), handler.indexOf('if (!('));
  assert.match(isAdminWriteBlock, /adminDeleteMatch && req\.method === 'DELETE'/);
  const adminWriteBlock = handler.slice(handler.indexOf('if (isAdminWrite'), handler.indexOf('if (isCreate)'));
  assert.match(adminWriteBlock, /user\.role !== 'admin'/);
  assert.equal(adminWriteBlock.includes('readBody(req)'), false);
  const deleteHandlerStart = handler.indexOf("if (adminDeleteMatch && req.method === 'DELETE')");
  assert.ok(deleteHandlerStart > handler.indexOf('if (isAdminWrite'), 'admin authorization must precede the delete handler');
  const deleteHandlerBlock = handler.slice(deleteHandlerStart, handler.indexOf('\n    }', deleteHandlerStart) + '\n    }'.length);
  assert.match(deleteHandlerBlock, /handleVirtualModelDeleteApiRequest\(/);
  assert.equal(deleteHandlerBlock.includes('readBody(req)'), false);
  assert.match(deleteHandlerSource, /deleteVirtualModel\(/);
  assert.match(deleteHandlerSource, /virtualModelId = decodeURIComponent\(adminDeleteMatch\[1\]\)/);
  assert.match(deleteHandlerSource, /deleteVirtualModel\(\{ pool, store, virtualModelId \}\)/);
  assert.match(deleteHandlerSource, /await persist\(\)/);
  assert.match(deleteHandlerSource, /writeJson\(res, 200, \{ result \}\)/);
  assert.equal(deleteHandlerSource.includes('readBody(req)'), false);
  assert.match(handler, /MODEL_PERMISSION_DENIED/);
  assert.doesNotMatch(handler, /resolveVirtualModelGenerationSnapshot|resolveMatch/);
  assert.match(handler, /validateSelectionMatch/);
  assert.match(handler, /\/api\/virtual-models\/validate-selection/);
  assert.match(handler, /createVirtualModelGenerationJobSnapshot/);
  assert.match(handler, /json\(res, 200, \{ ok: false \}\)/);
  assert.equal((source.match(/handleVirtualModelApiRequest\(\{/g) || []).length, 2);
});

test('admin asset binding creates a separate preview asset before storing model assets', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const handleVirtualModelApiRequest'), source.indexOf('const handleMysqlRequest'));

  assert.match(handler, /createVirtualModelPreviewAsset/);
  assert.match(handler, /previewAssetId/);
  assert.match(handler, /previewUrl/);
});

test('job intake derives historical library authorization from owned persisted jobs instead of a client flag', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const intake = source.slice(source.indexOf("if (url.pathname === '/api/jobs' && req.method === 'POST')"), source.indexOf("if (url.pathname === '/api/jobs' && req.method === 'GET')"));
  assert.match(intake, /createLibraryModelJobPayload\(\{ payload: body\.payload, pool, user \}\)/);
  const libraryPayload = source.slice(source.indexOf('const createLibraryModelJobPayload'), source.indexOf('const injectLibraryModelAssetsForProvider'));
  assert.match(libraryPayload, /findOwnedHistoricalVirtualModelSnapshot/);
  assert.doesNotMatch(libraryPayload, /payload\.allowHistoricalPublishedVersion === true/);
});

test('library selection is validated before the shell creates an optimistic project or task', async () => {
  const source = await readFile(new URL('../src/ShellMigratedApp.tsx', import.meta.url), 'utf8');
  const validation = source.indexOf('await validateVirtualModelLibrarySelection(');
  const projectCreation = source.indexOf('const immediateProject =');
  const taskCreation = source.indexOf('const immediateTask =');
  assert.ok(validation >= 0 && validation < projectCreation);
  assert.ok(validation < taskCreation);
});
