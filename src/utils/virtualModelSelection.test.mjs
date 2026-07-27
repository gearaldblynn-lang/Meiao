import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVirtualModelIdentityAssets } from './virtualModelSelection.mjs';

const assets = [
  'front_close',
  'left_45_close',
  'right_45_close',
  'profile_close',
  'front_half',
  'three_quarter_half',
  'front_full',
  'three_quarter_full',
].map((slot, index) => ({
  assetId: `asset-${index + 1}`,
  slot,
  isPrimary: slot === 'front_close',
}));

test('front half-body uses the primary anchor and both close 45-degree views', () => {
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'half_body',
      faceDirection: 'front',
    }).map((item) => item.slot),
    ['front_close', 'left_45_close', 'right_45_close'],
  );
});

test('front full-body uses close, half-body, and full-body front anchors', () => {
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'full_body',
      faceDirection: 'front',
    }).map((item) => item.slot),
    ['front_close', 'front_half', 'front_full'],
  );
});

test('full-person selection always promotes a complete body asset to A1', () => {
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'full_body',
      faceDirection: 'right',
    }, 'full_person').map((item) => item.slot),
    ['three_quarter_full', 'right_45_close', 'front_close'],
  );
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, null, 'full_person').map((item) => item.slot),
    ['front_full', 'front_close', 'left_45_close'],
  );
});

test('left and right references use matching close and body assets', () => {
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'half_body',
      faceDirection: 'left',
    }).map((item) => item.slot),
    ['front_close', 'left_45_close', 'profile_close'],
  );
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'half_body',
      faceDirection: 'right',
    }).map((item) => item.slot),
    ['front_close', 'right_45_close', 'three_quarter_half'],
  );
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'full_body',
      faceDirection: 'right',
    }).map((item) => item.slot),
    ['front_close', 'right_45_close', 'three_quarter_full'],
  );
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'full_body',
      faceDirection: 'left',
    }).map((item) => item.slot),
    ['front_close', 'left_45_close', 'three_quarter_full'],
  );
});

test('generic profile reference uses close and three-quarter side assets', () => {
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'half_body',
      faceDirection: 'profile',
    }).map((item) => item.slot),
    ['front_close', 'profile_close', 'three_quarter_half'],
  );
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, {
      framing: 'full_body',
      faceDirection: 'profile',
    }).map((item) => item.slot),
    ['front_close', 'three_quarter_half', 'three_quarter_full'],
  );
});

test('unknown classification uses a stable fallback', () => {
  assert.deepEqual(
    selectVirtualModelIdentityAssets(assets, null).map((item) => item.slot),
    ['front_close', 'left_45_close', 'right_45_close'],
  );
});

test('throws MODEL_ASSET_INCOMPLETE when a required selected asset is absent', () => {
  const incompleteAssets = assets.filter((asset) => asset.slot !== 'three_quarter_full');

  assert.throws(
    () => selectVirtualModelIdentityAssets(incompleteAssets, {
      framing: 'full_body',
      faceDirection: 'profile',
    }),
    (error) => error.code === 'MODEL_ASSET_INCOMPLETE',
  );
});

test('throws MODEL_ASSET_INCOMPLETE when selected slots share an asset ID', () => {
  const duplicateAssets = assets.map((asset) => (
    asset.slot === 'right_45_close' ? { ...asset, assetId: 'asset-2' } : asset
  ));

  assert.throws(
    () => selectVirtualModelIdentityAssets(duplicateAssets, {
      framing: 'half_body',
      faceDirection: 'front',
    }),
    (error) => error.code === 'MODEL_ASSET_INCOMPLETE',
  );
});
