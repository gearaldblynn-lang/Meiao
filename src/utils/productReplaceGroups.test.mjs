import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProductGroupAssignmentPatches,
  getEffectiveProductGroupId,
  resolveProductGroupIdForSelection,
} from './productReplaceGroups.mjs';

test('automatic combination groups stay unique when a surviving legacy group id collides with a new material slot', () => {
  const materials = [
    { id: 'survivor', productGroupId: 'product-group-2' },
    { id: 'new-upload', productGroupId: 'product-group-2' },
  ];

  const patches = buildProductGroupAssignmentPatches(materials);
  assert.deepEqual(patches, [{
    id: 'new-upload',
    productGroupId: 'product-group:auto:new-upload',
    productGroupAssignment: 'auto',
  }]);
  assert.notEqual(getEffectiveProductGroupId(materials[0]), patches[0].productGroupId);
});

test('manual grouping is preserved while missing automatic groups receive stable material-based ids', () => {
  const patches = buildProductGroupAssignmentPatches([
    { id: 'front', productGroupId: 'group-a' },
    { id: 'detail', productGroupId: 'group-a', productGroupAssignment: 'manual' },
    { id: 'second-product' },
  ]);

  assert.deepEqual(patches, [{
    id: 'second-product',
    productGroupId: 'product-group:auto:second-product',
    productGroupAssignment: 'auto',
  }]);
});

test('selecting a missing P2 slot creates a genuinely new group instead of reusing the colliding P1 id', () => {
  const nextGroupId = resolveProductGroupIdForSelection({
    groupIds: ['product-group-2'],
    targetNumber: 2,
    materialId: 'new-upload',
    currentGroupId: 'product-group-2',
  });

  assert.notEqual(nextGroupId, 'product-group-2');
  assert.match(nextGroupId, /^product-group:manual:new-upload:2/);
  assert.equal(resolveProductGroupIdForSelection({
    groupIds: ['group-a', 'group-b'],
    targetNumber: 2,
    materialId: 'new-upload',
    currentGroupId: 'group-a',
  }), 'group-b');
});
