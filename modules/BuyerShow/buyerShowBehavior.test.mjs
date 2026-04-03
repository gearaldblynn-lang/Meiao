import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./BuyerShowModule.tsx', import.meta.url), 'utf8');

test('buyer show validates stale uploaded asset urls before sending them to ark', () => {
  assert.match(source, /verifyManagedAssetUrl/);
  assert.match(source, /旧素材记录已失效，请重新导入产品图后再试/);
});

test('buyer show generation prompt keeps a lightweight target-market model rule', () => {
  assert.match(
    source,
    /VISUAL REFERENCE PRIORITY: High\. The provided reference image \(last input\) determines the environment style and lighting vibe\./,
    'buyer show generation prompt should preserve the original first-image reference wording'
  );
  assert.match(
    source,
    /SCENE & CHARACTER CONSISTENCY: The provided reference image establishes the reality of this set\./,
    'buyer show generation prompt should preserve the original follow-up consistency wording'
  );
  assert.match(
    source,
    /If a person is shown, they should look like a local user from \$\{persistentState\.targetCountry\}/,
    'buyer show generation prompt should require a lightweight target-market model rule'
  );
  assert.doesNotMatch(
    source,
    /use them only for clothing direction, pose energy, and camera language|must fit the local market identity of \$\{persistentState\.targetCountry\}/,
    'buyer show generation prompt should not keep the heavy nationality guidance'
  );
});
