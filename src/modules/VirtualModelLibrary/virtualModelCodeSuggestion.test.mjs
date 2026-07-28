import assert from 'node:assert/strict';
import test from 'node:test';

import { suggestNextVirtualModelCode } from './virtualModelCodeSuggestion.mjs';

test('numeric virtual model codes start at 001 and advance from the historical maximum', () => {
  assert.equal(suggestNextVirtualModelCode([]), '001');
  assert.equal(suggestNextVirtualModelCode([
    { code: '001' },
    { code: '003' },
    { code: 'VM-MS42OA6U' },
    { code: '42' },
  ]), '004');
});

test('numeric virtual model codes continue beyond three digits without repeating 1000', () => {
  assert.equal(suggestNextVirtualModelCode([{ code: '999' }]), '1000');
  assert.equal(suggestNextVirtualModelCode([{ code: '999' }, { code: '1000' }]), '1001');
});
