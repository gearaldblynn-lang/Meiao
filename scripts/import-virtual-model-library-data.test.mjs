import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  atomicWriteJson,
  buildImportPlan,
  importLocalLibrary,
  importMysqlLibrary,
  loadAndValidatePackage,
  parseCliArgs,
  rewriteLibraryPublicUrls,
} from './import-virtual-model-library-data.mjs';

const SLOTS = [
  'front_close',
  'left_45_close',
  'right_45_close',
  'profile_close',
  'front_half',
  'three_quarter_half',
  'front_full',
  'three_quarter_full',
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const stableId = (label) => sha256(label).slice(0, 24);

const makePackageFixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-model-library-package-'));
  const packageRoot = path.join(directory, 'package');
  const dataRoot = path.join(packageRoot, '02-当前模特数据');
  const exportDir = path.join(dataRoot, 'export');
  const manifestDir = path.join(dataRoot, 'manifest');
  const assetsDir = path.join(dataRoot, 'assets');
  await Promise.all([
    mkdir(exportDir, { recursive: true }),
    mkdir(manifestDir, { recursive: true }),
    mkdir(assetsDir, { recursive: true }),
  ]);

  const virtualModels = [];
  const virtualModelVersions = [];
  const virtualModelAssets = [];
  const assetRegistryRecords = [];
  const manifest = [];
  const catalogRows = [];

  for (let modelIndex = 1; modelIndex <= 5; modelIndex += 1) {
    const code = String(modelIndex).padStart(3, '0');
    const modelId = stableId(`model-${code}`);
    const versionId = stableId(`version-${code}`);
    virtualModels.push({
      id: modelId,
      code,
      name: `模特 ${code}`,
      tags: [`tag-${code}`],
      status: 'published',
      currentVersionId: versionId,
      createdAt: 1_780_000_000_000 + modelIndex,
      updatedAt: 1_780_000_100_000 + modelIndex,
    });
    virtualModelVersions.push({
      id: versionId,
      virtualModelId: modelId,
      versionNumber: 1,
      identityProfile: { description: `identity-${code}` },
      status: 'published',
      publishedAt: 1_780_000_200_000 + modelIndex,
      createdBy: stableId('library-owner'),
      createdAt: 1_780_000_000_000 + modelIndex,
    });

    for (const [slotIndex, slot] of SLOTS.entries()) {
      const sourceId = stableId(`source-${code}-${slot}`);
      const previewId = stableId(`preview-${code}-${slot}`);
      const relationId = stableId(`relation-${code}-${slot}`);
      const sourceName = `模特 ${code} ${slot}.png`;
      const previewName = `preview ${code} ${slot}.jpg`;
      const sourceStorageKey = `${stableId('library-owner')}/source/${modelIndex}${slotIndex}/${sourceId}.png`;
      const previewStorageKey = `${stableId('library-owner')}/preview/${modelIndex}${slotIndex}/${previewId}.jpg`;
      virtualModelAssets.push({
        id: relationId,
        virtualModelVersionId: versionId,
        slot,
        assetId: sourceId,
        publicUrl: `http://127.0.0.1:3100/api/assets/file/${sourceId}/${encodeURIComponent(sourceName)}`,
        previewAssetId: previewId,
        previewUrl: `http://127.0.0.1:3100/api/assets/file/${previewId}/${encodeURIComponent(previewName)}`,
        position: slotIndex + 1,
        isPrimary: slot === 'front_close',
        validationStatus: 'passed',
        createdAt: 1_780_000_300_000 + modelIndex * 10 + slotIndex,
      });

      for (const record of [
        {
          id: sourceId,
          assetType: 'source',
          storageKey: sourceStorageKey,
          originalName: sourceName,
          mimeType: 'image/png',
          width: 1200,
          height: 1600,
        },
        {
          id: previewId,
          assetType: 'preview',
          storageKey: previewStorageKey,
          originalName: previewName,
          mimeType: 'image/jpeg',
          width: 480,
          height: 640,
        },
      ]) {
        const bytes = Buffer.from(`fixture:${record.id}:${record.storageKey}`);
        const filePath = path.join(assetsDir, record.storageKey);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, bytes);
        const digest = sha256(bytes);
        const registryRecord = {
          id: record.id,
          userId: stableId('library-owner'),
          module: 'virtual_model',
          assetType: record.assetType,
          storageKey: record.storageKey,
          originalName: record.originalName,
          mimeType: record.mimeType,
          fileSize: bytes.length,
          width: record.width,
          height: record.height,
          provider: 'internal',
          providerSourceUrl: '',
          jobId: '',
          publicUrl: `http://127.0.0.1:3100/api/assets/file/${record.id}/${encodeURIComponent(record.originalName)}`,
          createdAt: 1_780_000_400_000 + modelIndex * 10 + slotIndex,
          updatedAt: 1_780_000_500_000 + modelIndex * 10 + slotIndex,
          lastAccessedAt: 1_780_000_500_000 + modelIndex * 10 + slotIndex,
          expiresAt: 0,
          deletedAt: null,
        };
        assetRegistryRecords.push(registryRecord);
        manifest.push({ storageKey: record.storageKey, size: bytes.length, sha256: digest });
        catalogRows.push([
          record.id,
          record.assetType,
          record.originalName,
          record.storageKey,
          String(bytes.length),
          digest,
        ]);
      }
    }
  }

  const libraryData = {
    schemaVersion: 1,
    exportedAt: '2026-07-28T08:58:16.251Z',
    stats: {
      models: 5,
      publishedModels: 5,
      versions: 5,
      slots: 40,
      registryAssets: 80,
      sourceAssets: 40,
      previewAssets: 40,
      files: 80,
    },
    virtualModels,
    virtualModelVersions,
    virtualModelAssets,
    assetRegistryRecords,
  };
  await writeFile(
    path.join(exportDir, 'library-data.json'),
    JSON.stringify(libraryData, null, 2),
  );
  await writeFile(
    path.join(manifestDir, 'assets.sha256.json'),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    path.join(manifestDir, 'checksums.sha256'),
    `${manifest.map((item) => `${item.sha256}  assets/${item.storageKey}`).join('\n')}\n`,
  );
  const quoteCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
  await writeFile(
    path.join(manifestDir, 'catalog.csv'),
    [
      ['id', 'assetType', 'originalName', 'storageKey', 'fileSize', 'sha256'],
      ...catalogRows,
    ].map((row) => row.map(quoteCsv).join(',')).join('\n'),
  );
  return { packageRoot, dataRoot, libraryData, manifest };
};

const makeTarget = async (fixture, { baseline = true } = {}) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meiao-model-library-target-'));
  const storePath = path.join(directory, 'data', 'internal-store.json');
  const registryPath = path.join(directory, 'data', 'asset-registry.json');
  const assetsDir = path.join(directory, 'data', 'assets');
  const baselineModelIds = new Set(
    fixture.libraryData.virtualModels
      .filter((model) => ['001', '002', '003'].includes(model.code))
      .map((model) => model.id),
  );
  const baselineVersionIds = new Set(
    fixture.libraryData.virtualModelVersions
      .filter((version) => baselineModelIds.has(version.virtualModelId))
      .map((version) => version.id),
  );
  const baselineAssetIds = new Set(
    fixture.libraryData.virtualModelAssets
      .filter((relation) => baselineVersionIds.has(relation.virtualModelVersionId))
      .flatMap((relation) => [relation.assetId, relation.previewAssetId]),
  );
  const store = {
    users: [{ id: 'preserved-user' }],
    virtualModels: baseline
      ? fixture.libraryData.virtualModels.filter((model) => baselineModelIds.has(model.id))
      : [],
    virtualModelVersions: baseline
      ? fixture.libraryData.virtualModelVersions.filter((version) => baselineVersionIds.has(version.id))
      : [],
    virtualModelAssets: baseline
      ? fixture.libraryData.virtualModelAssets.filter((relation) => baselineVersionIds.has(relation.virtualModelVersionId))
      : [],
  };
  const registry = {
    assets: baseline
      ? fixture.libraryData.assetRegistryRecords.filter((record) => baselineAssetIds.has(record.id))
      : [],
  };
  await Promise.all([
    mkdir(path.dirname(storePath), { recursive: true }),
    mkdir(assetsDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(storePath, JSON.stringify(store, null, 2)),
    writeFile(registryPath, JSON.stringify(registry, null, 2)),
  ]);
  return { directory, storePath, registryPath, assetsDir };
};

const listFiles = async (directory) => {
  const found = [];
  const visit = async (current) => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) found.push(fullPath);
    }
  };
  await visit(directory);
  return found.sort();
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const importerUrl = new URL('./import-virtual-model-library-data.mjs', import.meta.url).href;

const runImporterChild = (method, options) => {
  const source = `
    import { ${method} } from ${JSON.stringify(importerUrl)};
    const options = JSON.parse(process.argv[1]);
    if (${JSON.stringify(method)} === 'importMysqlLibrary') {
      class Connection {
        async beginTransaction() {}
        async commit() {}
        async rollback() {}
        async query(sql) {
          if (/^\\s*SELECT\\b/i.test(sql)) return [[]];
          if (/^\\s*INSERT\\b/i.test(sql)) return [{ affectedRows: 1 }];
          throw new Error('unexpected SQL');
        }
      }
      options.connection = new Connection();
    }
    await ${method}(options);
  `;
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', source, JSON.stringify(options)],
    { encoding: 'utf8' },
  );
};

const snapshotTree = async (directory) => {
  const files = await listFiles(directory);
  return Promise.all(files.map(async (filePath) => ({
    relativePath: path.relative(directory, filePath),
    sha256: sha256(await readFile(filePath)),
    mode: (await stat(filePath)).mode & 0o777,
  })));
};

test('CLI defaults to dry-run when no mode flag is supplied', () => {
  const args = parseCliArgs(['--package', '/tmp/library']);
  assert.equal(args.mode, 'dry-run');
  assert.equal(args.dryRun, true);
});

test('CLI local write refuses to run without explicit offline confirmation', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./import-virtual-model-library-data.mjs', import.meta.url)),
    '--package', fixture.packageRoot,
    '--local',
    '--store-path', target.storePath,
    '--registry-path', target.registryPath,
    '--assets-dir', target.assetsDir,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local_offline_confirmation_required/);
  assert.deepEqual(await listFiles(target.assetsDir), []);
});

test('local crash followed by dry-run requires recovery and writes zero bytes', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const child = runImporterChild('importLocalLibrary', {
    packagePath: fixture.packageRoot,
    ...target,
    faultInjection: 'after_local_store_rename',
  });
  assert.equal(child.status, 86, child.stderr);
  const before = await snapshotTree(target.directory);

  await assert.rejects(
    importLocalLibrary({
      packagePath: fixture.packageRoot,
      ...target,
      dryRun: true,
    }),
    (error) => error.code === 'import_recovery_required',
  );
  assert.deepEqual(await snapshotTree(target.directory), before);
});

test('local dry-run does not create a missing assets or control directory', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  await rm(target.assetsDir, { recursive: true, force: true });
  const before = await snapshotTree(target.directory);
  await importLocalLibrary({
    packagePath: fixture.packageRoot,
    ...target,
    dryRun: true,
  });
  assert.deepEqual(await snapshotTree(target.directory), before);
  await assert.rejects(stat(target.assetsDir), (error) => error.code === 'ENOENT');
});

test('package validation checks all 80 files against both checksum manifests', async () => {
  const fixture = await makePackageFixture();
  const loaded = await loadAndValidatePackage(fixture.packageRoot);
  assert.equal(loaded.manifest.length, 80);
  assert.equal(loaded.libraryData.assetRegistryRecords.length, 80);

  const damaged = loaded.manifest[0];
  await writeFile(path.join(loaded.dataRoot, 'assets', damaged.storageKey), 'damaged');
  await assert.rejects(
    loadAndValidatePackage(fixture.packageRoot),
    (error) => error.code === 'package_checksum_mismatch',
  );
});

test('checksum failure causes zero local writes', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const originalStore = await readFile(target.storePath, 'utf8');
  const originalRegistry = await readFile(target.registryPath, 'utf8');
  await writeFile(
    path.join(fixture.dataRoot, 'assets', fixture.manifest[79].storageKey),
    'tampered',
  );

  await assert.rejects(
    importLocalLibrary({
      packagePath: fixture.packageRoot,
      ...target,
      publicBaseUrl: 'https://meiao.example',
    }),
    (error) => error.code === 'package_checksum_mismatch',
  );
  assert.equal(await readFile(target.storePath, 'utf8'), originalStore);
  assert.equal(await readFile(target.registryPath, 'utf8'), originalRegistry);
  assert.deepEqual(await listFiles(target.assetsDir), []);
});

test('an active model with the same code and a different id fails closed', async () => {
  const fixture = await makePackageFixture();
  const loaded = await loadAndValidatePackage(fixture.packageRoot);
  const conflictingStore = {
    virtualModels: [{
      ...fixture.libraryData.virtualModels.find((model) => model.code === '004'),
      id: stableId('different-model-id'),
    }],
    virtualModelVersions: [],
    virtualModelAssets: [],
  };

  assert.throws(
    () => buildImportPlan({
      libraryData: loaded.libraryData,
      manifest: loaded.manifest,
      existingStore: conflictingStore,
      existingRegistry: { assets: [] },
      publicBaseUrl: 'https://meiao.example',
    }),
    (error) => error.code === 'active_model_code_conflict',
  );
});

test('same stable id with different content is warned and never overwritten', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  await importLocalLibrary({
    packagePath: fixture.packageRoot,
    ...target,
    publicBaseUrl: 'https://meiao.example',
  });
  const store = await readJson(target.storePath);
  const model004 = store.virtualModels.find((model) => model.code === '004');
  model004.name = '目标环境保留名称';
  await atomicWriteJson(target.storePath, store);

  const summary = await importLocalLibrary({
    packagePath: fixture.packageRoot,
    ...target,
    publicBaseUrl: 'https://meiao.example',
  });
  const after = await readJson(target.storePath);
  assert.equal(after.virtualModels.find((model) => model.code === '004').name, '目标环境保留名称');
  assert.equal(summary.added.models, 0);
  assert.ok(summary.warnings.some((warning) => (
    warning.type === 'content_mismatch'
    && warning.entity === 'virtual_model'
    && warning.id === model004.id
  )));
});

test('001-003 content drift is warned but never added or overwritten', async () => {
  const fixture = await makePackageFixture();
  const loaded = await loadAndValidatePackage(fixture.packageRoot);
  const target = await makeTarget(fixture);
  const store = await readJson(target.storePath);
  const registry = await readJson(target.registryPath);
  const model001 = store.virtualModels.find((model) => model.code === '001');
  model001.name = '目标已有 001 名称';

  const plan = buildImportPlan({
    libraryData: loaded.libraryData,
    manifest: loaded.manifest,
    existingStore: store,
    existingRegistry: registry,
    publicBaseUrl: 'http://127.0.0.1:3100',
  });

  assert.deepEqual(plan.additions.models.map((model) => model.code).sort(), ['004', '005']);
  assert.ok(plan.warnings.some((warning) => (
    warning.type === 'content_mismatch'
    && warning.entity === 'virtual_model'
    && warning.id === model001.id
    && warning.action === 'skipped_without_overwrite'
  )));
  assert.equal(model001.name, '目标已有 001 名称');
});

test('first local import adds only 004/005 and second import makes zero changes', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const options = {
    packagePath: fixture.packageRoot,
    ...target,
    publicBaseUrl: 'https://meiao.example/base/',
    now: () => 1_800_000_000_000,
  };
  const first = await importLocalLibrary(options);
  assert.deepEqual(first.added, {
    models: 2,
    versions: 2,
    relations: 16,
    registry: 32,
    files: 32,
  });
  assert.equal(first.validatedFiles, 80);
  assert.ok(first.backupDirectory);

  const store = await readJson(target.storePath);
  const registry = await readJson(target.registryPath);
  assert.deepEqual(store.virtualModels.map((model) => model.code).sort(), ['001', '002', '003', '004', '005']);
  assert.equal(store.virtualModelVersions.length, 5);
  assert.equal(store.virtualModelAssets.length, 40);
  assert.equal(registry.assets.length, 80);
  assert.equal((await listFiles(target.assetsDir)).length, 32);
  for (const filePath of await listFiles(target.assetsDir)) {
    assert.equal((await stat(filePath)).mode & 0o777, 0o644);
    let parent = path.dirname(filePath);
    while (parent !== target.assetsDir) {
      assert.equal((await stat(parent)).mode & 0o777, 0o755);
      parent = path.dirname(parent);
    }
  }
  const targetModelIds = new Set(
    store.virtualModels
      .filter((model) => ['004', '005'].includes(model.code))
      .map((model) => model.id),
  );
  const targetVersionIds = new Set(
    store.virtualModelVersions
      .filter((version) => targetModelIds.has(version.virtualModelId))
      .map((version) => version.id),
  );
  const importedRelations = store.virtualModelAssets.filter((relation) => (
    targetVersionIds.has(relation.virtualModelVersionId)
  ));
  const importedRegistryIds = new Set(
    importedRelations.flatMap((relation) => [relation.assetId, relation.previewAssetId]),
  );
  assert.ok(importedRelations.every((relation) => !relation.publicUrl.includes('127.0.0.1')));
  assert.ok(
    registry.assets
      .filter((record) => importedRegistryIds.has(record.id))
      .every((record) => !record.publicUrl.includes('127.0.0.1')),
  );
  assert.match(
    registry.assets.find((record) => record.originalName.includes('模特 004')).publicUrl,
    /^https:\/\/meiao\.example\/base\/api\/assets\/file\/[^/]+\/%E6%A8%A1%E7%89%B9%20004/,
  );

  const second = await importLocalLibrary(options);
  assert.deepEqual(second.added, {
    models: 0,
    versions: 0,
    relations: 0,
    registry: 0,
    files: 0,
  });
  assert.equal(second.backupDirectory, '');
});

test('local JSON failure restores both JSON files and removes copied files', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const originalStore = await readFile(target.storePath, 'utf8');
  const originalRegistry = await readFile(target.registryPath, 'utf8');
  let failed = false;

  await assert.rejects(
    importLocalLibrary({
      packagePath: fixture.packageRoot,
      ...target,
      publicBaseUrl: 'https://meiao.example',
      writeJson: async (filePath, value) => {
        if (filePath === target.registryPath && !failed) {
          failed = true;
          throw Object.assign(new Error('injected registry write failure'), { code: 'injected_failure' });
        }
        return atomicWriteJson(filePath, value);
      },
    }),
    (error) => error.code === 'injected_failure',
  );
  assert.deepEqual(await readJson(target.storePath), JSON.parse(originalStore));
  assert.deepEqual(await readJson(target.registryPath), JSON.parse(originalRegistry));
  assert.deepEqual(await listFiles(target.assetsDir), []);
});

test('local commit CAS refuses to overwrite an external store update', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const concurrent = { ...(await readJson(target.storePath)), concurrentWrite: 'preserve-me' };

  await assert.rejects(
    importLocalLibrary({
      packagePath: fixture.packageRoot,
      ...target,
      publicBaseUrl: 'https://meiao.example',
      beforeLocalCommit: async () => atomicWriteJson(target.storePath, concurrent),
    }),
    (error) => error.code === 'local_target_changed',
  );
  assert.deepEqual(await readJson(target.storePath), concurrent);
  assert.deepEqual(await listFiles(target.assetsDir), []);
});

test('local crash after first JSON rename is recovered before the next import plan', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const originalRegistry = await readFile(target.registryPath, 'utf8');
  const child = runImporterChild('importLocalLibrary', {
    packagePath: fixture.packageRoot,
    ...target,
    publicBaseUrl: 'https://meiao.example',
    faultInjection: 'after_local_store_rename',
  });
  assert.equal(child.status, 86, child.stderr);
  assert.equal(await readFile(target.registryPath, 'utf8'), originalRegistry);

  const recovered = await importLocalLibrary({
    packagePath: fixture.packageRoot,
    ...target,
    publicBaseUrl: 'https://meiao.example',
  });
  assert.deepEqual(recovered.added, {
    models: 2,
    versions: 2,
    relations: 16,
    registry: 32,
    files: 32,
  });
  assert.equal((await listFiles(target.assetsDir)).length, 32);
  const controlDir = path.join(path.dirname(target.storePath), '.virtual-model-library-import');
  assert.deepEqual(await listFiles(controlDir), []);
});

test('package source symlink is rejected before target writes', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const storageKey = fixture.manifest[0].storageKey;
  const sourcePath = path.join(fixture.dataRoot, 'assets', storageKey);
  const outside = path.join(path.dirname(fixture.packageRoot), 'outside-source');
  await writeFile(outside, await readFile(sourcePath));
  await unlink(sourcePath);
  await symlink(outside, sourcePath);

  await assert.rejects(
    importLocalLibrary({ packagePath: fixture.packageRoot, ...target }),
    (error) => error.code === 'symlink_not_allowed',
  );
  assert.deepEqual(await listFiles(target.assetsDir), []);
});

test('target parent symlink is rejected and creates zero files outside assetsDir', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  const outside = path.join(target.directory, 'outside-assets');
  await mkdir(outside);
  const firstSegment = fixture.manifest[0].storageKey.split('/')[0];
  await symlink(outside, path.join(target.assetsDir, firstSegment));

  await assert.rejects(
    importLocalLibrary({ packagePath: fixture.packageRoot, ...target }),
    (error) => error.code === 'symlink_not_allowed',
  );
  assert.deepEqual(await listFiles(outside), []);
});

test('local lock, journal, backup directory and backup files use private permissions', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture);
  await chmod(target.storePath, 0o600);
  await chmod(target.registryPath, 0o600);
  const child = runImporterChild('importLocalLibrary', {
    packagePath: fixture.packageRoot,
    ...target,
    faultInjection: 'after_local_store_rename',
  });
  assert.equal(child.status, 86, child.stderr);
  const controlDir = path.join(path.dirname(target.storePath), '.virtual-model-library-import');
  const journalPath = path.join(controlDir, 'local-journal.json');
  const journal = await readJson(journalPath);
  assert.equal((await stat(controlDir)).mode & 0o777, 0o700);
  assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
  assert.equal((await stat(journal.backupDirectory)).mode & 0o777, 0o700);
  for (const backupPath of [journal.store.backupPath, journal.registry.backupPath]) {
    assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
  }
});

test('URL rewriting replaces package loopback URLs for relations and registry records', () => {
  const libraryData = {
    virtualModelAssets: [{
      assetId: 'source id',
      publicUrl: 'http://127.0.0.1:3100/old',
      previewAssetId: 'preview/id',
      previewUrl: 'http://127.0.0.1:3100/old-preview',
    }],
    assetRegistryRecords: [
      { id: 'source id', originalName: '人 像.png', publicUrl: 'http://127.0.0.1:3100/old' },
      { id: 'preview/id', originalName: '预览.jpg', publicUrl: 'http://127.0.0.1:3100/old' },
    ],
  };
  const rewritten = rewriteLibraryPublicUrls(libraryData, {
    publicBaseUrl: 'https://meiao.example/',
  });
  assert.equal(
    rewritten.assetRegistryRecords[0].publicUrl,
    'https://meiao.example/api/assets/file/source%20id/%E4%BA%BA%20%E5%83%8F.png',
  );
  assert.equal(
    rewritten.virtualModelAssets[0].previewUrl,
    'https://meiao.example/api/assets/file/preview%2Fid/%E9%A2%84%E8%A7%88.jpg',
  );
});

class FakeMysqlConnection {
  constructor({ failOn = '', failCommit = false } = {}) {
    this.failOn = failOn;
    this.failCommit = failCommit;
    this.begun = 0;
    this.committed = 0;
    this.rolledBack = 0;
    this.inserts = [];
  }

  async beginTransaction() {
    this.begun += 1;
  }

  async commit() {
    if (this.failCommit) {
      throw Object.assign(new Error('injected commit failure'), { code: 'ER_COMMIT_INJECTED' });
    }
    this.committed += 1;
  }

  async rollback() {
    this.rolledBack += 1;
  }

  async query(sql, params = []) {
    if (/^\s*SELECT\b/i.test(sql)) return [[]];
    if (/^\s*INSERT\b/i.test(sql)) {
      this.inserts.push({ sql, params });
      if (this.failOn && sql.includes(this.failOn)) {
        throw Object.assign(new Error('injected mysql failure'), { code: 'ER_INJECTED' });
      }
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

test('MySQL crash followed by dry-run requires recovery without a transaction or writes', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture, { baseline: false });
  const child = runImporterChild('importMysqlLibrary', {
    packagePath: fixture.packageRoot,
    assetsDir: target.assetsDir,
    faultInjection: 'after_mysql_materialize',
  });
  assert.equal(child.status, 87, child.stderr);
  const before = await snapshotTree(target.assetsDir);
  const connection = new FakeMysqlConnection();
  await assert.rejects(
    importMysqlLibrary({
      packagePath: fixture.packageRoot,
      connection,
      assetsDir: target.assetsDir,
      dryRun: true,
    }),
    (error) => error.code === 'import_recovery_required',
  );
  assert.equal(connection.begun, 0);
  assert.deepEqual(await snapshotTree(target.assetsDir), before);
});

test('MySQL import commits all missing rows in one transaction', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture, { baseline: false });
  const connection = new FakeMysqlConnection();
  const summary = await importMysqlLibrary({
    packagePath: fixture.packageRoot,
    connection,
    assetsDir: target.assetsDir,
    publicBaseUrl: 'https://meiao.example',
  });

  assert.equal(connection.begun, 1);
  assert.equal(connection.committed, 1);
  assert.equal(connection.rolledBack, 0);
  assert.deepEqual(summary.added, {
    models: 2,
    versions: 2,
    relations: 16,
    registry: 32,
    files: 32,
  });
  assert.equal(connection.inserts.filter(({ sql }) => sql.includes('INSERT INTO virtual_models ')).length, 2);
  assert.equal(connection.inserts.filter(({ sql }) => sql.includes('INSERT INTO virtual_model_versions ')).length, 2);
  assert.equal(connection.inserts.filter(({ sql }) => sql.includes('INSERT INTO virtual_model_assets ')).length, 16);
  assert.equal(connection.inserts.filter(({ sql }) => sql.includes('INSERT INTO stored_assets ')).length, 32);
});

test('MySQL failure rolls back and leaves no readable asset files', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture, { baseline: false });
  const connection = new FakeMysqlConnection({ failOn: 'virtual_model_assets' });

  await assert.rejects(
    importMysqlLibrary({
      packagePath: fixture.packageRoot,
      connection,
      assetsDir: target.assetsDir,
      publicBaseUrl: 'https://meiao.example',
    }),
    (error) => error.code === 'ER_INJECTED',
  );
  assert.equal(connection.begun, 1);
  assert.equal(connection.committed, 0);
  assert.equal(connection.rolledBack, 1);
  assert.deepEqual(await listFiles(target.assetsDir), []);
});

test('MySQL commit failure rolls back and removes journal-planned files', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture, { baseline: false });
  const connection = new FakeMysqlConnection({ failCommit: true });
  await assert.rejects(
    importMysqlLibrary({
      packagePath: fixture.packageRoot,
      connection,
      assetsDir: target.assetsDir,
    }),
    (error) => error.code === 'ER_COMMIT_INJECTED',
  );
  assert.equal(connection.rolledBack, 1);
  assert.deepEqual(await listFiles(target.assetsDir), []);
});

test('MySQL materialize crash journal removes rolled-back files before next import', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture, { baseline: false });
  const child = runImporterChild('importMysqlLibrary', {
    packagePath: fixture.packageRoot,
    assetsDir: target.assetsDir,
    faultInjection: 'after_mysql_materialize',
  });
  assert.equal(child.status, 87, child.stderr);
  assert.equal((await listFiles(target.assetsDir)).length > 0, true);

  const connection = new FakeMysqlConnection();
  const summary = await importMysqlLibrary({
    packagePath: fixture.packageRoot,
    connection,
    assetsDir: target.assetsDir,
  });
  assert.deepEqual(summary.added, {
    models: 2,
    versions: 2,
    relations: 16,
    registry: 32,
    files: 32,
  });
  assert.equal((await listFiles(target.assetsDir)).length, 32);
});

test('MySQL recovery preserves an external same-hash file with a different inode', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture, { baseline: false });
  const child = runImporterChild('importMysqlLibrary', {
    packagePath: fixture.packageRoot,
    assetsDir: target.assetsDir,
    faultInjection: 'after_mysql_materialize',
  });
  assert.equal(child.status, 87, child.stderr);
  const journalPath = path.join(
    target.assetsDir,
    '.virtual-model-library-import',
    'mysql-journal.json',
  );
  const journal = await readJson(journalPath);
  const owned = journal.files[0];
  const destinationPath = path.join(target.assetsDir, owned.storageKey);
  const stagePath = path.join(journal.stageRoot, owned.storageKey);
  const [ownedDestinationStat, ownedStageStat] = await Promise.all([
    stat(destinationPath),
    stat(stagePath),
  ]);
  assert.equal(ownedDestinationStat.ino, ownedStageStat.ino);

  const bytes = await readFile(destinationPath);
  await unlink(destinationPath);
  await writeFile(destinationPath, bytes);
  await chmod(destinationPath, 0o644);
  const externalInode = (await stat(destinationPath)).ino;
  assert.notEqual(externalInode, ownedStageStat.ino);

  await importMysqlLibrary({
    packagePath: fixture.packageRoot,
    connection: new FakeMysqlConnection(),
    assetsDir: target.assetsDir,
  });
  assert.equal((await stat(destinationPath)).ino, externalInode);
});

test('MySQL recovery fails closed when every journal id exists with different content', async () => {
  const fixture = await makePackageFixture();
  const target = await makeTarget(fixture, { baseline: false });
  const child = runImporterChild('importMysqlLibrary', {
    packagePath: fixture.packageRoot,
    assetsDir: target.assetsDir,
    faultInjection: 'after_mysql_materialize',
  });
  assert.equal(child.status, 87, child.stderr);
  const journalPath = path.join(
    target.assetsDir,
    '.virtual-model-library-import',
    'mysql-journal.json',
  );
  const journal = await readJson(journalPath);
  const rowsByTable = new Map([
    ['virtual_models', journal.expected.models],
    ['virtual_model_versions', journal.expected.versions],
    ['virtual_model_assets', journal.expected.relations],
    ['stored_assets', journal.expected.registry],
  ]);
  const connection = new FakeMysqlConnection();
  connection.query = async (sql) => {
    for (const [table, rows] of rowsByTable) {
      if (sql.includes(`FROM ${table}`)) {
        return [[...rows.map((row, index) => (
          index === 0 ? { ...row, id: row.id, status: 'conflicting-content' } : row
        ))]];
      }
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(
    importMysqlLibrary({
      packagePath: fixture.packageRoot,
      connection,
      assetsDir: target.assetsDir,
    }),
    (error) => error.code === 'mysql_recovery_conflict',
  );
});
