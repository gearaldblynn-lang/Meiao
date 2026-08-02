import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowSource = readFileSync(new URL('./shellWorkflow.ts', import.meta.url), 'utf8');

test('shell image workflow promotes resized translation output back to the backend job result', () => {
  const finalImageBlock = workflowSource.match(
    /const finalImageUrl = result\.status === 'success' && result\.imageUrl[\s\S]*?return \{ \.\.\.result, imageUrl: finalImageUrl,/,
  )?.[0] || '';

  assert.ok(finalImageBlock, 'missing shell image final image settlement block');
  assert.match(finalImageBlock, /updateInternalJobResult\(/);
  assert.match(finalImageBlock, /finalImageUrl !== result\.imageUrl/);
  assert.match(finalImageBlock, /originalProviderImageUrl:\s*result\.imageUrl/);
});
