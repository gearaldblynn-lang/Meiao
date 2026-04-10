#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storePath = path.join(__dirname, '..', 'server', 'data', 'internal-store.json');
const baseUrl = 'http://127.0.0.1:3100';

const readStore = () => JSON.parse(fs.readFileSync(storePath, 'utf8'));

const getAdminToken = () => {
  const store = readStore();
  const admin = (store.users || []).find((user) => user.role === 'admin');
  if (!admin) {
    throw new Error('本地 store 中没有管理员账号，无法执行工作室冒烟测试。');
  }
  const session = (store.sessions || [])
    .filter((item) => item.userId === admin.id)
    .sort((a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0))[0];
  if (!session?.token) {
    throw new Error(`管理员 ${admin.username} 没有可用 session token，无法执行工作室冒烟测试。`);
  }
  return { admin, token: session.token };
};

const requestJson = async (pathname, { method = 'GET', token = '', body, expectedStatus } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (expectedStatus && response.status !== expectedStatus) {
    throw new Error(`${method} ${pathname} 期望 ${expectedStatus}，实际 ${response.status}：${JSON.stringify(data)}`);
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} 失败 ${response.status}：${JSON.stringify(data)}`);
  }
  return data;
};

const assertReplyMatches = (label, content, expectedSnippet) => {
  const normalized = String(content || '').trim();
  if (!normalized.includes(expectedSnippet)) {
    throw new Error(`${label} 回复异常，期望包含“${expectedSnippet}”，实际收到：${normalized.slice(0, 240) || '空回复'}`);
  }
};

const cleanupDanglingStudioSession = async () => {
  const { token } = getAdminToken();
  const store = readStore();
  const danglingSession = [...(store.chatSessions || [])]
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .find((item) => item.title === '工作室测试');
  if (!danglingSession?.id) return;
  await requestJson(`/api/chat/sessions/${encodeURIComponent(danglingSession.id)}`, {
    method: 'DELETE',
    token,
    expectedStatus: 200,
  }).catch(() => null);
};

const main = async () => {
  const { admin, token } = getAdminToken();
  console.log(`使用管理员会话: ${admin.username}`);

  const health = await requestJson('/api/health', { expectedStatus: 200 });
  console.log(`1. 健康检查通过: ${health.mode}`);

  const agentsPayload = await requestJson('/api/agents', { token, expectedStatus: 200 });
  const agents = Array.isArray(agentsPayload.agents) ? agentsPayload.agents : [];
  const agent = agents.find((item) => item.ownerUserId === admin.id) || agents[0];
  if (!agent) {
    throw new Error('没有可用于工作室测试的智能体。');
  }
  console.log(`2. 读取智能体成功: ${agent.name} (${agent.id})`);

  const versionsPayload = await requestJson(`/api/agents/${encodeURIComponent(agent.id)}/versions`, { token, expectedStatus: 200 });
  const versions = Array.isArray(versionsPayload.versions) ? versionsPayload.versions : [];
  const draftVersion = versions.find((item) => !item.isPublished);
  if (!draftVersion) {
    throw new Error(`智能体 ${agent.name} 没有草稿版本，无法验证工作室链路。`);
  }
  console.log(`3. 读取草稿版本成功: ${draftVersion.versionName || `v${draftVersion.versionNo}`}`);

  const trainingPayload = await requestJson(`/api/studio/training/${encodeURIComponent(draftVersion.id)}/message`, {
    method: 'POST',
    token,
    expectedStatus: 200,
    body: {
      content: '请只回答“工作室训练链路正常”，不要修改配置。',
      history: [],
    },
  });
  console.log(`4. 训练通道成功: ${String(trainingPayload.reply || '').slice(0, 60) || '已返回空文本'}`);
  assertReplyMatches('训练通道', trainingPayload.reply, '工作室训练链路正常');
  if (Array.isArray(trainingPayload.configDiffs) && trainingPayload.configDiffs.length > 0) {
    console.log(`   训练通道返回了 ${trainingPayload.configDiffs.length} 条配置变更。`);
  }

  const sessionPayload = await requestJson('/api/studio/test/sessions', {
    method: 'POST',
    token,
    expectedStatus: 201,
    body: { agentId: agent.id, versionId: draftVersion.id },
  });
  const session = sessionPayload.session;
  if (!session?.id) {
    throw new Error('测试会话创建响应缺少 session.id。');
  }
  console.log(`5. 创建测试会话成功: ${session.id}`);

  const messagePayload = await requestJson(`/api/chat/sessions/${encodeURIComponent(session.id)}/messages`, {
    method: 'POST',
    token,
    expectedStatus: 201,
    body: {
      content: '请直接回复“工作室测试链路正常”。',
      requestMode: 'chat',
      selectedModel: session.selectedModel || '',
      clientRequestId: `studio-smoke-${Date.now()}`,
    },
  });
  console.log(`6. 测试消息成功: ${String(messagePayload.assistantMessage?.content || '').slice(0, 60) || '空回复'}`);
  assertReplyMatches('测试通道', messagePayload.assistantMessage?.content, '工作室测试链路正常');

  await requestJson(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
    method: 'DELETE',
    token,
    expectedStatus: 200,
  });
  console.log('7. 临时测试会话已删除');

  console.log('工作室本地冒烟测试通过。');
};

const run = async () => {
  try {
    await main();
  } catch (error) {
    try {
      await cleanupDanglingStudioSession();
    } catch {
      // ignore cleanup failure in smoke script
    }
    console.error('工作室本地冒烟测试失败:', error.message);
    process.exit(1);
  }
};

run();
