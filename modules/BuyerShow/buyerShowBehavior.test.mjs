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
    /VISUAL REFERENCE PRIORITY: High\. Visual atmosphere reference image \(URL=\$\{refUrl\}\) determines the environment style and lighting vibe\./,
    'buyer show generation prompt should preserve the original first-image reference wording'
  );
  assert.match(
    source,
    /SCENE & CHARACTER CONSISTENCY: Reference benchmark image \(URL=\$\{refUrl\}\) establishes the reality of this set\./,
    'buyer show generation prompt should preserve the original follow-up consistency wording'
  );
  assert.match(
    source,
    /Reference benchmark image \(URL=\$\{refUrl\}\) is the first generated image from this same buyer-show set\./,
    'follow-up buyer show prompt should explicitly mark the benchmark image url'
  );
  assert.match(
    source,
    /Treat that benchmark image as the single source of truth for person identity, room layout, props, lighting, and camera reality\./,
    'follow-up buyer show prompt should force benchmark-image continuity'
  );
  assert.match(
    source,
    /This new shot MUST stay in the same session continuity but clearly differ in composition, framing, action focus, and product storytelling purpose\./,
    'follow-up buyer show prompt should force visible shot differentiation instead of near-duplicates'
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

test('buyer show logs retain final prompt and input image urls for task debugging', () => {
  assert.match(source, /inputImageUrls: inputs/);
  assert.match(source, /finalPrompt,/);
  assert.match(source, /referenceUrl: refUrl \|\| ''/);
  assert.match(source, /isFirstImage,/);
});

test('buyer show prompt hard-locks packaging identity instead of allowing redesigned packs', () => {
  assert.match(
    source,
    /Strictly do not change the product's appearance details, size, structure, label information, packaging information, packaging layout, brand marks, color blocking, or any visible product elements\./,
    'buyer show prompt should explicitly lock packaging identity fields'
  );
  assert.match(
    source,
    /Do not redesign, rewrite, simplify, replace, or newly invent the package artwork or brand presentation\./,
    'buyer show prompt should forbid newly invented packaging artwork'
  );
  assert.match(
    source,
    /PACKAGING CONSISTENCY FIRST: Keep the packaging identity exactly consistent with the uploaded product images\./,
    'buyer show prompt should prioritize packaging consistency with a short explicit rule'
  );
  assert.match(
    source,
    /REAL SCENE INTEGRATION: The product must feel naturally photographed inside the scene with correct contact, perspective, scale, shadows, and occlusion\./,
    'buyer show prompt should explicitly require natural scene integration'
  );
});

test('buyer show auto-recovers refresh-persisted recoverable kie errors with existing task ids', () => {
  assert.match(source, /isRecoverableKieTaskResult/);
  assert.match(
    source,
    /\(task\.status === 'generating' \|\| \(task\.status === 'error' && isRecoverableKieTaskResult\(task\.taskId, task\.error\)\)\)/,
    'buyer show should resume recoverable error tasks on refresh'
  );
});
