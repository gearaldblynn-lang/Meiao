import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('MaxForAI secret and runtime limits are documented without a real key', () => {
  const envExample = read('../.env.server.example');
  const deployDoc = read('../docs/tencent-cloud-deploy.md');
  const overview = read('../docs/project-overview.md');
  const expectedLines = [
    'MAXFORAI_API_KEY=',
    'MAXFORAI_BASE_URL=https://maxforai.top/v1',
    'MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS=600000',
    'MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS=120000',
    'MAXFORAI_ASSET_UPLOAD_CONCURRENCY=3',
  ];

  for (const line of expectedLines) {
    assert.match(envExample, new RegExp(`^${line}$`, 'm'));
    assert.match(deployDoc, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(overview, /MAXFORAI_API_KEY/);
  for (const source of [envExample, deployDoc, overview]) {
    assert.match(source, /image-2中转/);
    assert.doesNotMatch(source, /maxforai-image-2-(?:standard|pro|max)/);
    assert.doesNotMatch(source, /Image-2(?:标准|高|超高)/);
  }
  assert.doesNotMatch(envExample, /MAXFORAI_API_KEY=sk-/);
  assert.doesNotMatch(deployDoc, /MAXFORAI_API_KEY=sk-/);
});
