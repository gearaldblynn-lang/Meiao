import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertManagedAssetSubmissionUserContext,
  assertManagedImageInputsPreserved,
} from './managedAssetSubmissionGuard.mjs';

const managedUrl = (id) => `https://meiaoyuntai.com/api/assets/file/${id}`;

test('managed provider payload requires an explicit owner context', () => {
  assert.throws(
    () => assertManagedAssetSubmissionUserContext({
      payload: { imageUrls: [managedUrl('asset-a')] },
      userId: '',
    }),
    (error) => {
      assert.equal(error.code, 'managed_asset_user_context_missing');
      assert.equal(error.providerStage, 'input_prepare');
      assert.equal(error.providerStatus, 'failed');
      assert.deepEqual(error.inputImageUrls, [managedUrl('asset-a')]);
      return true;
    },
  );
});

test('external-only payload and owned managed payload pass the owner-context guard', () => {
  assert.doesNotThrow(() => assertManagedAssetSubmissionUserContext({
    payload: { imageUrls: ['https://example.com/source.png'] },
    userId: '',
  }));
  assert.doesNotThrow(() => assertManagedAssetSubmissionUserContext({
    payload: { imageUrls: [managedUrl('asset-a')] },
    userId: 'user-a',
  }));
});

test('kie image submission rejects complete managed input loss after scrubbing', () => {
  assert.throws(
    () => assertManagedImageInputsPreserved({
      taskType: 'kie_image',
      originalPayload: { imageUrls: [managedUrl('asset-a')] },
      scrubbedPayload: { imageUrls: [] },
    }),
    (error) => {
      assert.equal(error.code, 'managed_image_input_removed');
      assert.equal(error.providerStage, 'input_prepare');
      assert.equal(error.providerStatus, 'failed');
      assert.equal(error.inputImageCount, 1);
      assert.deepEqual(error.inputImageUrls, [managedUrl('asset-a')]);
      return true;
    },
  );
});

test('kie image submission rejects partial image input loss after scrubbing', () => {
  assert.throws(
    () => assertManagedImageInputsPreserved({
      taskType: 'kie_image',
      originalPayload: {
        imageUrls: [managedUrl('asset-a'), 'https://example.com/reference.png'],
      },
      scrubbedPayload: { imageUrls: ['https://example.com/reference.png'] },
    }),
    (error) => {
      assert.equal(error.code, 'managed_image_input_removed');
      assert.equal(error.inputImageCount, 2);
      assert.deepEqual(error.inputImageUrls, [managedUrl('asset-a')]);
      return true;
    },
  );
});

test('kie text-to-image and fully preserved edit inputs remain valid', () => {
  assert.doesNotThrow(() => assertManagedImageInputsPreserved({
    taskType: 'kie_image',
    originalPayload: { imageUrls: [] },
    scrubbedPayload: { imageUrls: [] },
  }));
  assert.doesNotThrow(() => assertManagedImageInputsPreserved({
    taskType: 'kie_image',
    originalPayload: { imageUrls: [managedUrl('asset-a')] },
    scrubbedPayload: { imageUrls: [managedUrl('asset-a')] },
  }));
});
