import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateImageBilling } from '../../../utils/imageBilling.mjs';

const ui = await import('./productRestoreUi.mjs').catch(() => null);

const requireUi = () => {
  assert.ok(ui, 'Product Restoration UI policy module must exist');
  return ui;
};

test('product restoration exposes only the two ordered upload roles with complete guidance', () => {
  const policy = requireUi();
  assert.deepEqual(policy.PRODUCT_RESTORE_MATERIAL_TYPES, ['restoreTarget', 'productReference']);
  assert.deepEqual(policy.PRODUCT_RESTORE_MATERIAL_META.restoreTarget, {
    label: '待还原套图',
    description: '最多 10 张；每张都会单独生成；同一任务只放一个 SKU；超限整次拒绝。',
    limit: 10,
  });
  assert.deepEqual(policy.PRODUCT_RESTORE_MATERIAL_META.productReference, {
    label: '产品参考图',
    description: '最多 5 张；按结构、细节、材质、颜色的参考价值从左到右排序；超限整次拒绝。',
    limit: 5,
  });
});

test('product restoration rejects an over-limit selection as one whole upload with remaining capacity', () => {
  const policy = requireUi();
  assert.equal(policy.getProductRestoreUploadRejection({
    type: 'restoreTarget',
    existingCount: 9,
    selectedCount: 2,
  }), '本次选择未上传：待还原套图最多 10 张，当前已有 9 张，还可上传 1 张。');
  assert.equal(policy.getProductRestoreUploadRejection({
    type: 'productReference',
    existingCount: 4,
    selectedCount: 2,
  }), '本次选择未上传：产品参考图最多 5 张，当前已有 4 张，还可上传 1 张。');
  assert.equal(policy.getProductRestoreUploadRejection({
    type: 'restoreTarget',
    existingCount: 8,
    selectedCount: 2,
  }), '');
});

test('product restoration reserves rapid selections synchronously and rolls pending capacity back', async () => {
  const policy = requireUi();
  assert.equal(typeof policy.createProductRestoreUploadReservationQueue, 'function');
  const queue = policy.createProductRestoreUploadReservationQueue();
  const scopeKey = 'retouch:product_restore';

  const first = queue.reserve({
    scopeKey,
    type: 'restoreTarget',
    existingCount: 9,
    selectedCount: 1,
  });
  assert.equal(first.ok, true);
  assert.equal(queue.getPendingCount(scopeKey, 'restoreTarget'), 1);

  const rapidSecond = queue.reserve({
    scopeKey,
    type: 'restoreTarget',
    existingCount: 9,
    selectedCount: 1,
  });
  assert.deepEqual(rapidSecond, {
    ok: false,
    message: '本次选择未上传：待还原套图最多 10 张，当前已有 10 张，还可上传 0 张。',
  });

  await first.waitForTurn;
  first.release();
  assert.equal(queue.getPendingCount(scopeKey, 'restoreTarget'), 0);

  const retryAfterRollback = queue.reserve({
    scopeKey,
    type: 'restoreTarget',
    existingCount: 9,
    selectedCount: 1,
  });
  assert.equal(retryAfterRollback.ok, true);
  retryAfterRollback.release();
});

test('product restoration preserves FileList order when preprocessing settles out of order', async () => {
  const policy = requireUi();
  assert.equal(typeof policy.prepareProductRestoreUploadBatch, 'function');
  const deferred = new Map();
  const createDeferred = (name) => {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    deferred.set(name, { resolve, reject, promise });
    return promise;
  };

  const prepared = policy.prepareProductRestoreUploadBatch(
    ['first', 'second', 'third', 'broken'],
    async (name) => createDeferred(name),
  );
  await Promise.resolve();
  deferred.get('third').resolve('prepared-third');
  deferred.get('broken').reject(new Error('decode failed'));
  deferred.get('second').resolve('prepared-second');
  deferred.get('first').resolve('prepared-first');

  assert.deepEqual(await prepared, [
    'prepared-first',
    'prepared-second',
    'prepared-third',
  ]);
});

test('product restoration reorders only the current scoped material slots and preserves objects', () => {
  const policy = requireUi();
  const otherA = { id: 'other-a', subFeature: 'original' };
  const targetA = { id: 'target-a', subFeature: 'product_restore' };
  const targetB = { id: 'target-b', subFeature: 'product_restore' };
  const otherB = { id: 'other-b', subFeature: 'white_bg' };
  const targetC = { id: 'target-c', subFeature: 'product_restore' };
  const items = [otherA, targetA, targetB, otherB, targetC];

  const moved = policy.moveProductRestoreScopedMaterial(items, 'target-b', 'left', 'product_restore');
  assert.deepEqual(moved.map((item) => item.id), ['other-a', 'target-b', 'target-a', 'other-b', 'target-c']);
  assert.equal(moved[1], targetB);
  assert.equal(moved[2], targetA);
  assert.deepEqual(
    policy.moveProductRestoreScopedMaterial(moved, 'target-c', 'right', 'product_restore'),
    moved,
  );
});

test('product restoration focus chips use stable order and restore defaults instead of becoming empty', () => {
  const policy = requireUi();
  assert.deepEqual(policy.toggleProductRestoreFocusIds('', 'shape_structure'), ['material_texture']);
  assert.deepEqual(policy.toggleProductRestoreFocusIds('material_texture', 'material_texture'), [
    'shape_structure',
    'material_texture',
  ]);
  assert.deepEqual(policy.toggleProductRestoreFocusIds(
    'material_texture,shape_structure',
    'logo_label_text',
  ), ['shape_structure', 'material_texture', 'logo_label_text']);
});

test('product restoration controls default to 2K and expose 4K only for a supporting model', () => {
  const policy = requireUi();
  const relay = policy.getProductRestoreControlState(
    ['maxforai-image-2-relay', 'gpt-image-2'],
    { model: 'maxforai-image-2-relay', quality: '4K' },
  );
  assert.deepEqual(relay.modelOptions, ['maxforai-image-2-relay', 'gpt-image-2']);
  assert.deepEqual(relay.qualityOptions, ['2K']);
  assert.equal(relay.quality, '2K');
  assert.ok(!relay.qualityOptions.includes('1K'));

  const supporting = policy.getProductRestoreControlState(
    ['maxforai-image-2-relay', 'gpt-image-2'],
    { model: 'gpt-image-2', quality: '' },
  );
  assert.deepEqual(supporting.qualityOptions, ['2K', '4K']);
  assert.equal(supporting.quality, '2K');
});

test('product restoration rollout blocks creation without hiding historical access', () => {
  const policy = requireUi();
  assert.equal(
    policy.getProductRestoreCreationDisabledReason('off', 'admin'),
    '产品还原暂未开放，历史项目仍可查看。',
  );
  assert.equal(
    policy.getProductRestoreCreationDisabledReason('admin', 'user'),
    '产品还原当前仅对管理员开放，历史项目仍可查看。',
  );
  assert.equal(policy.getProductRestoreCreationDisabledReason('admin', 'admin'), '');
  assert.equal(policy.getProductRestoreCreationDisabledReason('all', 'user'), '');
});

test('product restoration uses one rollout guard for new and regenerated job creation only', () => {
  const policy = requireUi();
  assert.equal(typeof policy.getProductRestoreJobCreationDisabledReason, 'function');
  const productRestore = { module: 'retouch', subFeature: 'product_restore' };
  assert.equal(policy.getProductRestoreJobCreationDisabledReason({
    ...productRestore,
    rolloutMode: 'off',
    role: 'admin',
  }), '产品还原暂未开放，历史项目仍可查看。');
  assert.equal(policy.getProductRestoreJobCreationDisabledReason({
    ...productRestore,
    rolloutMode: 'admin',
    role: 'user',
  }), '产品还原当前仅对管理员开放，历史项目仍可查看。');
  assert.equal(policy.getProductRestoreJobCreationDisabledReason({
    ...productRestore,
    rolloutMode: 'admin',
    role: 'admin',
  }), '');
  assert.equal(policy.getProductRestoreJobCreationDisabledReason({
    ...productRestore,
    rolloutMode: 'all',
    role: 'user',
  }), '');
  assert.equal(policy.getProductRestoreJobCreationDisabledReason({
    module: 'retouch',
    subFeature: 'original',
    rolloutMode: 'off',
    role: 'user',
  }), '');
});

test('product restoration billing estimate counts restore targets rather than references or analysis', () => {
  const estimate = estimateImageBilling({
    module: 'retouch',
    subFeature: 'product_restore',
    params: { model: 'GPT Image 2', quality: '2K' },
    materialCount: 3,
  });
  assert.equal(estimate.imageCount, 3);
  assert.equal(estimate.estimatedCredits, 15);

  const emptyEstimate = estimateImageBilling({
    module: 'retouch',
    subFeature: 'product_restore',
    params: { model: 'GPT Image 2', quality: '2K' },
    materialCount: 0,
  });
  assert.equal(emptyEstimate.imageCount, 0);
  assert.equal(emptyEstimate.estimatedCredits, 0);
});
