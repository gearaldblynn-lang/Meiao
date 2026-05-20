import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ui/workspacePrimitives.tsx', import.meta.url), 'utf8');

test('PopoverSelect keeps portal menu clicks inside the outside-click guard', () => {
  assert.match(source, /const menuRef = React\.useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /const clickedInsideMenu = menuRef\.current\?\.contains\(target\)/);
  assert.match(source, /if \(!clickedInsideRoot && !clickedInsideMenu\)/);
});
