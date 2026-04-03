import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arkServiceSource = readFileSync(new URL('./arkService.ts', import.meta.url), 'utf8');

test('buyer show planning prompt keeps a lightweight target-market model rule', () => {
  assert.match(
    arkServiceSource,
    /The set must include human presence suitable for \$\{state\.targetCountry\}\. The FIRST task MUST be a benchmark shot\. Subsequent shots must maintain consistency\./,
    'buyer show planning prompt should preserve the original include-model strategy wording'
  );
  assert.match(
    arkServiceSource,
    /If hasFace=true, the person should look like a local user from \$\{state\.targetCountry\}/,
    'buyer show planning prompt should keep a lightweight target-market model rule'
  );
  assert.match(
    arkServiceSource,
    /If the reference contains a person, the model's temperament, style, and age range MUST closely match the reference\./,
    'buyer show planning prompt should preserve the original reference-person guidance'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /Reference people may only inform clothing direction, pose energy, and camera language|After applying the target-market identity rule above, include ALL of the following appearance details/,
    'buyer show planning prompt should not keep the heavy reference-person guidance'
  );
});
