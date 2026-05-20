import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');

test('agent center only resets chat page state when workspace mode actually changes', () => {
  assert.match(source, /const previousWorkspaceModeRef = useRef\(workspaceMode\);/);
  assert.match(source, /if \(previousWorkspaceModeRef\.current === workspaceMode\) return;/);
  assert.match(source, /previousWorkspaceModeRef\.current = workspaceMode;/);
});
