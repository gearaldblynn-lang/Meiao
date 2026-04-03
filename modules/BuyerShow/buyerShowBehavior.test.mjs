import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./BuyerShowModule.tsx', import.meta.url), 'utf8');

test('buyer show validates stale uploaded asset urls before sending them to ark', () => {
  assert.match(source, /verifyManagedAssetUrl/);
  assert.match(source, /旧素材记录已失效，请重新导入产品图后再试/);
});

test('buyer show generation prompt forbids copying identity traits from the atmosphere reference person', () => {
  assert.match(
    source,
    /must fit the local market identity of \$\{persistentState\.targetCountry\}/,
    'buyer show generation prompt should require target-market-fitting model identity'
  );
  assert.match(
    source,
    /Do NOT copy the reference person's ethnicity, nationality, or skin tone/,
    'buyer show generation prompt should forbid copying reference person identity traits'
  );
  assert.match(
    source,
    /same generated person, not the original reference person/,
    'follow-up buyer show generations should stay consistent with the first generated model rather than the uploaded reference person'
  );
});
