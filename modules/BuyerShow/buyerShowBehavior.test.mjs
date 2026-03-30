import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./BuyerShowModule.tsx', import.meta.url), 'utf8');

test('buyer show validates stale uploaded asset urls before sending them to ark', () => {
  assert.match(source, /verifyManagedAssetUrl/);
  assert.match(source, /旧素材记录已失效，请重新导入产品图后再试/);
});
