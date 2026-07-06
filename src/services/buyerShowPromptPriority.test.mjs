import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arkServiceSource = readFileSync(new URL('./arkService.ts', import.meta.url), 'utf8');

// 2026-07-02 f660945「修复买家秀缺失占位和动物模特规则」有意改写了模特策略措辞
// (增加动物模特分支);本测试锁当前措辞,防止动物规则被误删回退。
test('buyer show planning prompt keeps a lightweight target-market model rule', () => {
  assert.match(
    arkServiceSource,
    /Include Model Strategy.*If the model reference shows an animal or pet, the set MUST include that animal/,
    'buyer show planning prompt should keep the animal-model branch of the include-model strategy (f660945)'
  );
  assert.match(
    arkServiceSource,
    /The FIRST task MUST be a benchmark shot\. Subsequent shots must maintain consistency\./,
    'buyer show planning prompt should preserve the benchmark-shot rule'
  );
  assert.match(
    arkServiceSource,
    /If hasFace=true and the subject is human, the person should look like a local user from \$\{state\.targetCountry\}/,
    'buyer show planning prompt should keep a lightweight target-market model rule'
  );
  assert.match(
    arkServiceSource,
    /If the model reference subject is an animal, keep the animal present/,
    'buyer show planning prompt should keep the animal-subject guidance (f660945)'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /Reference people may only inform clothing direction, pose energy, and camera language|After applying the target-market identity rule above, include ALL of the following appearance details/,
    'buyer show planning prompt should not keep the heavy reference-person guidance'
  );
});
