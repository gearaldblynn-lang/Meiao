import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const envExample = readFileSync(new URL('../.env.server.example', import.meta.url), 'utf8');
const projectOverview = readFileSync(new URL('../docs/project-overview.md', import.meta.url), 'utf8');
const deployDoc = readFileSync(new URL('../docs/tencent-cloud-deploy.md', import.meta.url), 'utf8');

test('第4期多工具 env 旋钮同步到模板、项目总览和部署文档', () => {
  assert.match(envExample, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(envExample, /OPENAI_COMPATIBLE_RESPONSES_PATH/);
  assert.match(envExample, /\/v1\/responses/);
  assert.match(envExample, /MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS/);
  assert.match(envExample, /AGENT_IMAGE_TOOL_CONCURRENCY/);

  assert.match(projectOverview, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(projectOverview, /OPENAI_COMPATIBLE_RESPONSES_PATH/);
  assert.match(projectOverview, /MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS/);
  assert.match(projectOverview, /AGENT_IMAGE_TOOL_CONCURRENCY/);

  assert.match(deployDoc, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(deployDoc, /OPENAI_COMPATIBLE_RESPONSES_PATH/);
  assert.match(deployDoc, /MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS/);
  assert.match(deployDoc, /AGENT_IMAGE_TOOL_CONCURRENCY/);
});

test('托管素材直连与 KIE 回退旋钮同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'MEIAO_KIE_MANAGED_ASSET_MODE',
    'MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY',
    'MEIAO_KIE_ASSET_UPLOAD_RETRIES',
    'MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS',
    'MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS',
    'MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
  assert.match(deployDoc, /MEIAO_PUBLIC_BASE_URL=https:\/\/meiaoyuntai\.com/);
  assert.match(deployDoc, /kie-only/);
});

test('结果素材下载重试旋钮同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS',
    'MEIAO_RESULT_ASSET_DOWNLOAD_RETRIES',
    'MEIAO_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
});
