# 智能体聊天工作台重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把智能体中心使用端重构为独立聊天工作台，并补齐会话管理、用户头像、模型能力控制和多模态附件链路。

**Architecture:** 采用服务端能力驱动方案：后端扩展用户资料、模型能力、会话配置和消息附件数据结构，前端重写聊天工作台 UI 并仅消费服务端返回的能力配置。管理端负责限制智能体可用模型集合，使用端负责在允许范围内提供成熟聊天体验。

**Tech Stack:** React、TypeScript、Node.js、现有 `internalApi` 服务层、`server/index.mjs`、Vite、Node test、TS `tsc --noEmit`

---

## File Map

- Modify: `types.ts`
  - 扩展 `AuthUser`、`AgentSummary`、`AgentVersion`、`AgentChatSession`、`AgentChatMessage`、系统配置类型
- Modify: `services/internalApi.ts`
  - 扩展聊天、用户资料、模型能力接口
- Modify: `server/index.mjs`
  - 扩展 MySQL schema、本地 store、聊天接口、用户资料接口、能力校验、附件元数据
- Modify: `server/agentCenterSource.test.mjs`
  - 覆盖 schema 与聊天能力接口源码约束
- Modify: `components/uiArchitecture.test.mjs`
  - 覆盖聊天工作台结构和账号头像入口约束
- Modify: `modules/AgentCenter/AgentCenterModule.tsx`
  - 切换为使用端聊天工作台容器
- Replace: `modules/AgentCenter/AgentCenterChatWorkspace.tsx`
  - 重写三栏聊天工作台
- Create: `modules/AgentCenter/ChatSessionSidebar.tsx`
  - 智能体与分组会话侧栏
- Create: `modules/AgentCenter/ChatConversationPane.tsx`
  - 聊天消息区域
- Create: `modules/AgentCenter/ChatComposer.tsx`
  - 输入区、附件区和发送动作
- Create: `modules/AgentCenter/UserAvatar.tsx`
  - 用户头像组件
- Modify: `modules/Account/AccountManagement.tsx`
  - 增加当前用户头像设置入口
- Create: `modules/Account/ProfileSettingsCard.tsx`
  - 个人资料设置卡片
- Test: `modules/AgentCenter/agentCenterUtils.test.mjs`
  - 如需补能力规范化辅助函数时扩展

### Task 1: Add failing tests for chat workspace architecture and profile avatar support

**Files:**
- Modify: `components/uiArchitecture.test.mjs`
- Modify: `server/agentCenterSource.test.mjs`

- [ ] **Step 1: Write the failing UI/source tests**

```js
test('agent center chat workspace is structured as agent rail, grouped sessions, and conversation pane', () => {
  const chat = read('../modules/AgentCenter/AgentCenterChatWorkspace.tsx');

  assert.match(chat, /ChatSessionSidebar/);
  assert.match(chat, /ChatConversationPane/);
  assert.match(chat, /ChatComposer/);
  assert.match(chat, /按智能体分组/);
  assert.match(chat, /删除会话/);
});

test('account management exposes a profile avatar settings entry for the current user', () => {
  const account = read('../modules/Account/AccountManagement.tsx');

  assert.match(account, /ProfileSettingsCard/);
  assert.match(account, /默认头像/);
  assert.match(account, /上传头像/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test 'components/uiArchitecture.test.mjs' 'server/agentCenterSource.test.mjs'`

Expected: FAIL with missing chat workspace structure assertions and missing profile avatar settings assertions.

- [ ] **Step 3: Write the failing server source tests**

```js
test('agent center chat source persists user avatars, chat session options, and session deletion', () => {
  assert.match(source, /avatar_url VARCHAR\(1024\) NULL/);
  assert.match(source, /avatar_preset VARCHAR\(40\) NULL/);
  assert.match(source, /selected_model VARCHAR\(80\) NOT NULL/);
  assert.match(source, /reasoning_level VARCHAR\(40\) NULL/);
  assert.match(source, /web_search_enabled TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(source, /if \(chatSessionDetailMatch && req\.method === 'DELETE'\)/);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: FAIL with missing avatar/session option schema assertions.

- [ ] **Step 5: Commit**

```bash
git add components/uiArchitecture.test.mjs server/agentCenterSource.test.mjs
git commit -m "test: define chat workspace and profile avatar expectations"
```

### Task 2: Extend shared types and client API surface

**Files:**
- Modify: `types.ts`
- Modify: `services/internalApi.ts`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing type/API test**

```js
test('chat client API exposes session deletion, session option updates, and profile avatar payloads', () => {
  const api = read('../services/internalApi.ts');
  const types = read('../types.ts');

  assert.match(api, /deleteChatSession/);
  assert.match(api, /updateChatSession/);
  assert.match(api, /updateCurrentUserProfile/);
  assert.match(types, /avatarUrl\?: string \| null/);
  assert.match(types, /avatarPreset\?: string \| null/);
  assert.match(types, /reasoningLevel\?: string \| null/);
  assert.match(types, /webSearchEnabled: boolean/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: FAIL because the new API/type members do not exist yet.

- [ ] **Step 3: Write minimal type changes**

```ts
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'staff';
  avatarUrl?: string | null;
  avatarPreset?: string | null;
}

export interface AgentChatSession {
  id: string;
  agentId: string;
  title: string;
  selectedModel: string;
  reasoningLevel?: string | null;
  webSearchEnabled: boolean;
  updatedAt: number;
}
```

- [ ] **Step 4: Write minimal API functions**

```ts
export const deleteChatSession = async (sessionId: string) => {
  return request<{ ok: true }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
};

export const updateChatSession = async (sessionId: string, payload: {
  selectedModel?: string;
  reasoningLevel?: string | null;
  webSearchEnabled?: boolean;
}) => {
  return request<{ session: AgentChatSession }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: PASS for the new API/type surface assertions.

- [ ] **Step 6: Commit**

```bash
git add types.ts services/internalApi.ts components/uiArchitecture.test.mjs
git commit -m "feat: add chat workspace types and client api surface"
```

### Task 3: Add failing server tests for schema and local store compatibility

**Files:**
- Modify: `server/agentCenterSource.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Extend the server source test with explicit compatibility expectations**

```js
test('chat source keeps mysql and local store avatar and session option fields aligned', () => {
  assert.match(source, /ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR\(1024\) NULL/);
  assert.match(source, /ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_preset VARCHAR\(40\) NULL/);
  assert.match(source, /selected_model VARCHAR\(80\) NOT NULL/);
  assert.match(source, /reasoning_level VARCHAR\(40\) NULL/);
  assert.match(source, /web_search_enabled TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(source, /selectedModel:/);
  assert.match(source, /reasoningLevel:/);
  assert.match(source, /webSearchEnabled:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: FAIL because MySQL and local store do not yet contain all fields.

- [ ] **Step 3: Implement minimal schema and local store fields**

```js
await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(1024) NULL');
await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_preset VARCHAR(40) NULL');
await pool.query('ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS selected_model VARCHAR(80) NOT NULL DEFAULT ""');
await pool.query('ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS reasoning_level VARCHAR(40) NULL');
await pool.query('ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS web_search_enabled TINYINT(1) NOT NULL DEFAULT 0');
```

- [ ] **Step 4: Mirror the same fields in local store normalization**

```js
store.users = Array.isArray(store.users) ? store.users.map(normalizeStoredUser) : [];
store.chatSessions = Array.isArray(store.chatSessions) ? store.chatSessions.map((item) => ({
  ...item,
  selectedModel: String(item.selectedModel || ''),
  reasoningLevel: item.reasoningLevel ? String(item.reasoningLevel) : null,
  webSearchEnabled: Boolean(item.webSearchEnabled),
})) : [];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: PASS with the new schema compatibility assertions.

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs server/agentCenterSource.test.mjs
git commit -m "feat: persist profile avatars and chat session options"
```

### Task 4: Implement current-user profile update flow

**Files:**
- Modify: `server/index.mjs`
- Modify: `services/internalApi.ts`
- Modify: `types.ts`

- [ ] **Step 1: Write the failing server source expectation**

```js
test('server exposes current user profile update endpoints with avatar support', () => {
  assert.match(source, /\/api\/auth\/me/);
  assert.match(source, /avatar_url/);
  assert.match(source, /avatar_preset/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: FAIL if the endpoint does not update current-user avatars.

- [ ] **Step 3: Implement the endpoint**

```js
if (url.pathname === '/api/auth/me' && req.method === 'PATCH') {
  const session = getSessionFromRequest(req);
  const user = shouldUseMysql ? await getDbUserById(session.userId) : getLocalUserById(store, session.userId);
  const nextUser = shouldUseMysql
    ? await updateDbUser(user.id, { displayName: body.displayName, avatarUrl: body.avatarUrl, avatarPreset: body.avatarPreset })
    : updateLocalUser(store, user.id, { displayName: body.displayName, avatarUrl: body.avatarUrl, avatarPreset: body.avatarPreset });
  json(res, 200, { user: buildAuthUserResponse(nextUser) });
  return;
}
```

- [ ] **Step 4: Add the client wrapper**

```ts
export const updateCurrentUserProfile = async (payload: {
  displayName?: string;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
}) => {
  return request<{ user: AuthUser }>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: PASS with current-user profile update support present in source.

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs services/internalApi.ts types.ts server/agentCenterSource.test.mjs
git commit -m "feat: allow current users to update profile avatars"
```

### Task 5: Implement chat session mutation APIs

**Files:**
- Modify: `server/index.mjs`
- Modify: `services/internalApi.ts`
- Test: `server/agentCenterSource.test.mjs`

- [ ] **Step 1: Write the failing source expectations for session delete/update**

```js
test('server exposes chat session patch and delete routes scoped to the current user', () => {
  assert.match(source, /if \(chatSessionDetailMatch && req\.method === 'PATCH'\)/);
  assert.match(source, /if \(chatSessionDetailMatch && req\.method === 'DELETE'\)/);
  assert.match(source, /user_id = \?/);
  assert.match(source, /item\.id === sessionId && item\.userId === user\.id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: FAIL because chat session mutation routes are incomplete.

- [ ] **Step 3: Implement session patch/delete in MySQL mode**

```js
if (chatSessionDetailMatch && req.method === 'PATCH') {
  const session = await updateDbChatSession(currentUser, sessionId, body || {});
  json(res, 200, { session });
  return;
}

if (chatSessionDetailMatch && req.method === 'DELETE') {
  const result = await deleteDbChatSession(currentUser, sessionId);
  json(res, 200, result);
  return;
}
```

- [ ] **Step 4: Implement session patch/delete in local mode**

```js
if (chatSessionDetailMatch && req.method === 'PATCH') {
  const session = updateLocalChatSession(store, currentUser, sessionId, body || {});
  persistLocalStore(store);
  json(res, 200, { session });
  return;
}

if (chatSessionDetailMatch && req.method === 'DELETE') {
  const result = deleteLocalChatSession(store, currentUser, sessionId);
  persistLocalStore(store);
  json(res, 200, result);
  return;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: PASS with chat session mutation routes visible in source.

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs services/internalApi.ts server/agentCenterSource.test.mjs
git commit -m "feat: add session update and delete routes"
```

### Task 6: Add model capability normalization for chat workspace

**Files:**
- Modify: `server/index.mjs`
- Modify: `types.ts`
- Modify: `services/internalApi.ts`

- [ ] **Step 1: Write the failing UI test for capability-driven controls**

```js
test('chat workspace uses capability-driven controls instead of always-on toggles', () => {
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');
  assert.match(module, /supportsImageInput/);
  assert.match(module, /supportsFileInput/);
  assert.match(module, /supportsWebSearch/);
  assert.match(module, /supportsReasoningLevel/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: FAIL because the module does not yet consume capability metadata.

- [ ] **Step 3: Add a normalized chat model capability shape**

```ts
export interface AgentChatModelCapability {
  id: string;
  label: string;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  supportsWebSearch: boolean;
  supportsReasoningLevel: boolean;
  reasoningLevels: string[];
}
```

- [ ] **Step 4: Populate capabilities in public system config**

```js
agentModels: {
  chat: [
    {
      id: 'doubao-seed-1-6-thinking-250715',
      label: '豆包 Seed 1.6 Thinking',
      supportsImageInput: false,
      supportsFileInput: true,
      supportsWebSearch: false,
      supportsReasoningLevel: true,
      reasoningLevels: ['low', 'medium', 'high'],
    },
  ],
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'components/uiArchitecture.test.mjs' 'server/jobRuntime.test.mjs'`

Expected: PASS with capability properties visible in source and public config.

- [ ] **Step 6: Commit**

```bash
git add types.ts services/internalApi.ts server/index.mjs components/uiArchitecture.test.mjs server/jobRuntime.test.mjs
git commit -m "feat: expose capability-driven chat model metadata"
```

### Task 7: Restrict user model selection to the agent-allowed model set

**Files:**
- Modify: `server/index.mjs`
- Modify: `types.ts`
- Modify: `modules/AgentCenter/AgentCenterManager.tsx`

- [ ] **Step 1: Write the failing source test for agent model restrictions**

```js
test('agent versions persist allowed chat models and default chat model', () => {
  assert.match(source, /allowed_chat_models_json/);
  assert.match(source, /default_chat_model/);
  assert.match(source, /allowedChatModels/);
  assert.match(source, /defaultChatModel/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: FAIL because agent versions do not yet persist allowed model configuration.

- [ ] **Step 3: Extend agent version persistence**

```js
await pool.query('ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS allowed_chat_models_json LONGTEXT NULL');
await pool.query('ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS default_chat_model VARCHAR(80) NULL');
```

- [ ] **Step 4: Add management-side fields**

```ts
export interface AgentVersion {
  allowedChatModels: string[];
  defaultChatModel?: string | null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: PASS with allowed/default chat model fields in source.

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs types.ts modules/AgentCenter/AgentCenterManager.tsx server/agentCenterSource.test.mjs
git commit -m "feat: persist agent-level model restrictions"
```

### Task 8: Extend message send flow with option and attachment validation

**Files:**
- Modify: `server/index.mjs`
- Modify: `services/internalApi.ts`
- Modify: `types.ts`

- [ ] **Step 1: Write the failing source test for attachment and option validation**

```js
test('send message source validates model options and attachment support before execution', () => {
  assert.match(source, /supportsImageInput/);
  assert.match(source, /supportsFileInput/);
  assert.match(source, /supportsWebSearch/);
  assert.match(source, /reasoningLevel/);
  assert.match(source, /attachments_json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: FAIL because send-message flow still assumes plain text only.

- [ ] **Step 3: Expand client payload shape**

```ts
export const sendChatMessage = async (sessionId: string, payload: {
  content: string;
  attachments?: Array<{ name: string; assetId?: string; url?: string; mimeType?: string }>;
  selectedModel?: string;
  reasoningLevel?: string | null;
  webSearchEnabled?: boolean;
}) => {
  return request<{ userMessage: AgentChatMessage; assistantMessage: AgentChatMessage }>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
};
```

- [ ] **Step 4: Validate options server-side before provider execution**

```js
if (attachments.length > 0 && !modelCapability.supportsFileInput) {
  throw new Error('当前模型不支持文件输入');
}
if (webSearchEnabled && !modelCapability.supportsWebSearch) {
  throw new Error('当前模型不支持联网');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'server/agentCenterSource.test.mjs'`

Expected: PASS with option and attachment validation visible in source.

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs services/internalApi.ts types.ts server/agentCenterSource.test.mjs
git commit -m "feat: validate chat attachments and session options"
```

### Task 9: Build reusable avatar and chat workspace UI components

**Files:**
- Create: `modules/AgentCenter/UserAvatar.tsx`
- Create: `modules/AgentCenter/ChatSessionSidebar.tsx`
- Create: `modules/AgentCenter/ChatConversationPane.tsx`
- Create: `modules/AgentCenter/ChatComposer.tsx`
- Replace: `modules/AgentCenter/AgentCenterChatWorkspace.tsx`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing UI test for the new component structure**

```js
test('chat workspace is assembled from focused chat ui components', () => {
  const chat = read('../modules/AgentCenter/AgentCenterChatWorkspace.tsx');
  assert.match(chat, /ChatSessionSidebar/);
  assert.match(chat, /ChatConversationPane/);
  assert.match(chat, /ChatComposer/);
  assert.match(chat, /UserAvatar/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: FAIL because the current workspace is still a monolith.

- [ ] **Step 3: Create focused component shells**

```tsx
const UserAvatar: React.FC<Props> = ({ user }) => { /* avatarUrl/avatarPreset fallback */ };
const ChatSessionSidebar: React.FC<Props> = ({ groupedSessions }) => { /* agent groups + delete */ };
const ChatConversationPane: React.FC<Props> = ({ messages }) => { /* left/right bubbles */ };
const ChatComposer: React.FC<Props> = ({ capability, attachments }) => { /* input + uploads */ };
```

- [ ] **Step 4: Compose them in the main workspace**

```tsx
<div className="grid gap-6 xl:grid-cols-[280px_340px_minmax(0,1fr)]">
  <ChatSessionSidebar ... />
  <ChatConversationPane ... />
  <ChatComposer ... />
</div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: PASS with the new componentized chat workspace structure.

- [ ] **Step 6: Commit**

```bash
git add modules/AgentCenter/UserAvatar.tsx modules/AgentCenter/ChatSessionSidebar.tsx modules/AgentCenter/ChatConversationPane.tsx modules/AgentCenter/ChatComposer.tsx modules/AgentCenter/AgentCenterChatWorkspace.tsx components/uiArchitecture.test.mjs
git commit -m "feat: rebuild chat workspace with focused ui components"
```

### Task 10: Rewire AgentCenterModule state and handlers for the new workspace

**Files:**
- Modify: `modules/AgentCenter/AgentCenterModule.tsx`
- Modify: `services/internalApi.ts`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing UI test for capability-driven top controls and grouped sessions**

```js
test('agent center module wires grouped sessions and capability-driven chat controls', () => {
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');
  assert.match(module, /groupedSessions/);
  assert.match(module, /selectedModel/);
  assert.match(module, /reasoningLevel/);
  assert.match(module, /webSearchEnabled/);
  assert.match(module, /deleteChatSession/);
  assert.match(module, /updateChatSession/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: FAIL because the current module does not manage these states.

- [ ] **Step 3: Add the new state shape**

```tsx
const [selectedAgentId, setSelectedAgentId] = useState('');
const [selectedModel, setSelectedModel] = useState('');
const [reasoningLevel, setReasoningLevel] = useState<string | null>(null);
const [webSearchEnabled, setWebSearchEnabled] = useState(false);
const groupedSessions = useMemo(() => groupSessionsByAgent(chatAgents, sessions), [chatAgents, sessions]);
```

- [ ] **Step 4: Wire handlers**

```tsx
const handleDeleteSession = (sessionId: string) => runAction(async () => {
  await deleteChatSession(sessionId);
  await loadChat(selectedAgentId, '');
});

const handleSessionOptionsChange = (payload) => runAction(async () => {
  if (!selectedSessionId) return;
  await updateChatSession(selectedSessionId, payload);
  await loadChat(selectedAgentId, selectedSessionId);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: PASS with grouped session and top-control wiring visible in source.

- [ ] **Step 6: Commit**

```bash
git add modules/AgentCenter/AgentCenterModule.tsx services/internalApi.ts components/uiArchitecture.test.mjs
git commit -m "feat: wire chat workspace state and controls"
```

### Task 11: Add profile avatar editing UI for the current user

**Files:**
- Create: `modules/Account/ProfileSettingsCard.tsx`
- Modify: `modules/Account/AccountManagement.tsx`
- Modify: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing UI test**

```js
test('account management renders a profile settings card for current user avatar changes', () => {
  const account = read('../modules/Account/AccountManagement.tsx');
  const profile = read('../modules/Account/ProfileSettingsCard.tsx');
  assert.match(account, /ProfileSettingsCard/);
  assert.match(profile, /默认头像/);
  assert.match(profile, /上传头像/);
  assert.match(profile, /updateCurrentUserProfile/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: FAIL because the profile settings card does not exist.

- [ ] **Step 3: Create the profile settings card**

```tsx
const ProfileSettingsCard: React.FC<Props> = ({ currentUser, onUserChange }) => {
  return (
    <WorkspaceShellCard>
      <h3>个人资料</h3>
      <p>默认头像</p>
      <label>上传头像<input type="file" /></label>
    </WorkspaceShellCard>
  );
};
```

- [ ] **Step 4: Mount it in account management**

```tsx
{currentUser ? (
  <ProfileSettingsCard
    currentUser={currentUser}
    onUserChange={onCurrentUserChange}
  />
) : null}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test 'components/uiArchitecture.test.mjs'`

Expected: PASS with current-user profile settings visible in source.

- [ ] **Step 6: Commit**

```bash
git add modules/Account/ProfileSettingsCard.tsx modules/Account/AccountManagement.tsx components/uiArchitecture.test.mjs
git commit -m "feat: add current user profile avatar settings"
```

### Task 12: Verification and regression pass

**Files:**
- Modify: any touched files from previous tasks
- Test: `server/agentCenterSource.test.mjs`
- Test: `components/uiArchitecture.test.mjs`
- Test: `server/jobRuntime.test.mjs`
- Test: `modules/AgentCenter/agentCenterUtils.test.mjs`

- [ ] **Step 1: Run focused tests**

Run: `node --test 'server/agentCenterSource.test.mjs' 'components/uiArchitecture.test.mjs' 'server/jobRuntime.test.mjs' 'modules/AgentCenter/agentCenterUtils.test.mjs'`

Expected: PASS for all focused chat workspace and capability tests.

- [ ] **Step 2: Run type checking**

Run: `npm run lint`

Expected: PASS with `tsc --noEmit`.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS with Vite production build completing successfully.

- [ ] **Step 4: Spot-check local runtime**

Run: `npm run local`

Expected: local front-end and back-end both serve successfully, with no missing chat routes.

- [ ] **Step 5: Commit final integrated changes**

```bash
git add types.ts services/internalApi.ts server/index.mjs server/agentCenterSource.test.mjs components/uiArchitecture.test.mjs modules/AgentCenter modules/Account
git commit -m "feat: deliver agent chat workspace redesign"
```
