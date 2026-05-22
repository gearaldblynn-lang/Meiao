import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveShellSkuCount } from './shellSkuCount.ts';

test('shell sku count uses the explicit requested count instead of stale extra sku names', () => {
  assert.equal(resolveShellSkuCount({
    count: '3',
    skuCopyText_0: '基础套装',
    skuCopyText_1: '进阶套装',
    skuCopyText_2: '豪华套装',
    skuCopyText_3: '上一次残留的第四个命名',
  }), 3);
});

test('shell sku count derives count from filled sku names when count was never set', () => {
  assert.equal(resolveShellSkuCount({
    skuCopyText_0: '基础套装',
    skuCopyText_1: '进阶套装',
    skuCopyText_2: '豪华套装',
  }), 3);
});
