import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arkServiceSource = readFileSync(new URL('./arkService.ts', import.meta.url), 'utf8');

test('buyer show planning prompt makes target market model traits override any person in the reference image', () => {
  assert.match(
    arkServiceSource,
    /Model appearance must be determined by the target market first/,
    'buyer show planning prompt should explicitly prioritize target market model identity'
  );
  assert.match(
    arkServiceSource,
    /Do NOT copy or inherit the reference person's ethnicity, nationality, or skin tone/,
    'buyer show planning prompt should forbid inheriting reference person identity traits'
  );
  assert.match(
    arkServiceSource,
    /Reference people may only inform clothing direction, pose energy, and camera language/,
    'buyer show planning prompt should narrow reference-person reuse to soft styling cues'
  );
});
