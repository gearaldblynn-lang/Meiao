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

  assert.match(projectOverview, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(projectOverview, /OPENAI_COMPATIBLE_RESPONSES_PATH/);

  assert.match(deployDoc, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(deployDoc, /OPENAI_COMPATIBLE_RESPONSES_PATH/);
});
