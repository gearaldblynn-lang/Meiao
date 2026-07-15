import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('MaxForAI secret and runtime limits are documented without a real key', () => {
  const envExample = read('../.env.server.example');
  const deployDoc = read('../docs/tencent-cloud-deploy.md');
  const overview = read('../docs/project-overview.md');
  const repeatedIssues = read('../docs/agents/repeated-issues.md');
  const expectedLines = [
    'MAXFORAI_API_KEY=',
    'MAXFORAI_BASE_URL=https://maxforai.top/v1',
    'MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS=600000',
    'MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS=120000',
    'MAXFORAI_ASSET_UPLOAD_CONCURRENCY=3',
  ];
  const videoExpectedLines = [
    'MAXFORAI_VIDEO_API_KEY=',
    'MAXFORAI_VIDEO_BASE_URL=https://maxforai.top/v1',
    'MAXFORAI_VIDEO_CREATE_TIMEOUT_MS=60000',
    'MAXFORAI_VIDEO_ASSET_TIMEOUT_MS=120000',
    'MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY=2',
    'MAXFORAI_VIDEO_POLL_INTERVAL_MS=5000',
    'MAXFORAI_VIDEO_POLL_TIMEOUT_MS=1500000',
  ];

  for (const line of expectedLines) {
    assert.match(envExample, new RegExp(`^${line}$`, 'm'));
    assert.match(deployDoc, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const line of videoExpectedLines) {
    assert.match(envExample, new RegExp(`^${line}$`, 'm'));
    assert.match(deployDoc, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const source of [deployDoc, overview]) {
    assert.match(source, /Seedance 2\.0 Pro 特价/);
    assert.match(source, /sora-v9-pro/);
    assert.match(source, /0\.5元\/秒/);
    assert.match(source, /4-15 秒/);
    assert.match(source, /\/assets\/url/);
    assert.match(source, /providerTaskId/);
  }
  assert.match(overview, /MAXFORAI_API_KEY/);
  for (const source of [envExample, deployDoc, overview]) {
    assert.match(source, /image-2中转/);
    assert.doesNotMatch(source, /maxforai-image-2-(?:standard|pro|max)/);
    assert.doesNotMatch(source, /Image-2(?:标准|高|超高)/);
  }
  assert.doesNotMatch(envExample, /MAXFORAI_API_KEY=sk-/);
  assert.doesNotMatch(deployDoc, /MAXFORAI_API_KEY=sk-/);
  assert.doesNotMatch(envExample, /MAXFORAI_VIDEO_API_KEY=sk-/);
  assert.doesNotMatch(deployDoc, /MAXFORAI_VIDEO_API_KEY=sk-/);
  for (const source of [deployDoc, overview]) {
    assert.match(source, /response_format/);
    assert.match(source, /b64_json/);
    assert.match(source, /托管素材/);
    assert.match(source, /仅支持 1K 和 2K/);
    assert.match(source, /4K/);
    assert.match(source, /固定比例/);
    assert.match(source, /size.*auto/);
    assert.match(source, /1536x864/);
    assert.match(source, /1536x2048/);
  }
  assert.match(repeatedIssues, /49f7bf14f1f55d45e42d4d9f/);
  assert.match(repeatedIssues, /HTTP 200/);
  assert.match(repeatedIssues, /b64_json/);
  assert.match(repeatedIssues, /maxforai:image_size:unsupported_4k_mapping/);
});
