# Settings Center Model Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable, stable Settings Center with first-level setting categories and a true Unified Model Center consumed by Smart Factory.

**Architecture:** Settings Center owns all global model provider CRUD and presents categories as the first interaction layer. Smart Factory keeps its own agent/knowledge/tool UX but only reads model providers from the unified registry. Admin users can configure providers and global runtime settings; staff users can view providers and save only personal allowed preferences.

**Tech Stack:** React + TypeScript frontend, Node internal API, source-level architecture tests, backend Node tests, Vite build, Playwright browser verification.

---

### Task 1: Lock The Product Boundary With Tests

**Files:**
- Modify: `src/components/uiArchitecture.test.mjs`
- Read: `src/shell/modules/Settings/GlobalApiSettings.tsx`
- Read: `src/modules/AgentCenter/SmartFactoryPanel.tsx`

- [ ] **Step 1: Add a failing architecture test for Settings Center IA**

Add a test that requires these exact behaviors:

```js
test('settings center uses first-level categories and keeps model center as a compact managed page', () => {
  const settings = read('../shell/modules/Settings/GlobalApiSettings.tsx');

  assert.match(settings, /type SettingsSection =/);
  assert.match(settings, /settingsCategories/);
  assert.match(settings, /模型中心/);
  assert.match(settings, /服务接入/);
  assert.match(settings, /智能体运行/);
  assert.match(settings, /账号与权限/);
  assert.match(settings, /通知公告/);
  assert.match(settings, /系统偏好/);
  assert.match(settings, /activeSettingsSection === 'models'/);
  assert.match(settings, /模型类型/);
  assert.match(settings, /模型渠道矩阵/);
  assert.match(settings, /渠道详情/);
  assert.match(settings, /只读视图/);
  assert.match(settings, /当前账号只能查看模型中心/);
});
```

- [ ] **Step 2: Add a failing architecture test for Smart Factory dependency direction**

Add or update the Smart Factory test so it requires Settings Center wording and forbids provider CRUD inside Smart Factory:

```js
test('smart factory model page is a consumer of settings model center, not a provider configurator', () => {
  const smartFactory = read('../modules/AgentCenter/SmartFactoryPanel.tsx');

  assert.match(smartFactory, /模型中心统一管理/);
  assert.match(smartFactory, /这里只做绑定和运行选择/);
  assert.doesNotMatch(smartFactory, /saveSmartFactoryModelProvider/);
  assert.doesNotMatch(smartFactory, /deleteSmartFactoryModelProvider/);
  assert.doesNotMatch(smartFactory, /fetchSmartFactoryModelProviderPresets/);
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs
```

Expected: fail because the category shell and compact model center strings are not all present yet.

### Task 2: Refactor Settings Center Into First-Level Categories

**Files:**
- Modify: `src/shell/modules/Settings/GlobalApiSettings.tsx`

- [ ] **Step 1: Add SettingsSection state and category metadata**

Insert these near the existing model helper types:

```tsx
type SettingsSection = 'models' | 'services' | 'agentRuntime' | 'access' | 'notifications' | 'preferences';
```

Inside `GlobalApiSettings`, add:

```tsx
const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>('models');
```

Create `settingsCategories` with six entries: 模型中心, 服务接入, 智能体运行, 账号与权限, 通知公告, 系统偏好.

- [ ] **Step 2: Replace the stacked settings body with category navigation**

The returned layout should show:
- Title: `系统设置`
- Subtitle: `按类型管理工作台能力、模型渠道、服务接入和权限边界。`
- A horizontal first-level category bar.
- One selected content area rendered by `activeSettingsSection`.

- [ ] **Step 3: Preserve existing behaviors in category pages**

Move the existing blocks into category pages without changing the handlers:
- 模型中心: system model provider registry and provider CRUD.
- 服务接入: 内部服务托管 and 即梦视频服务.
- 智能体运行: 策划分析模型 and 视频分析模型.
- 账号与权限: 并发任务数 and role permission explanation.
- 通知公告: 公告管理.
- 系统偏好: 偏好设置, 系统状态, 保存设置.

### Task 3: Rebuild Model Center As A Compact Matrix

**Files:**
- Modify: `src/shell/modules/Settings/GlobalApiSettings.tsx`

- [ ] **Step 1: Add model type selection**

Add state:

```tsx
const [selectedModelMode, setSelectedModelMode] = useState('chat');
```

Use model type labels for: 对话, 图片, 视频, Embedding, Rerank.

- [ ] **Step 2: Render compact hierarchy**

The model page must use three columns:
- `模型类型`: choose model type first.
- `模型渠道矩阵`: list provider rows filtered by selected type, showing provider logo badge, provider name, channel/baseUrl, model count, default model, abilities, status.
- `渠道详情`: selected provider detail and admin-only edit form.

- [ ] **Step 3: Keep admin/staff access correct**

Admin:
- can create, save, test, delete provider.
- can edit Provider ID, display name, Base URL, API Key, credential ref, model list, default model, fallback model.

Staff:
- sees `只读视图`.
- sees `当前账号只能查看模型中心，模型供应商由管理员统一配置。`
- cannot click save/test/delete model provider controls.

### Task 4: Keep Smart Factory Connected To Model Center

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`

- [ ] **Step 1: Update model tab wording**

Change Smart Factory model page text so it says:
- `模型中心统一管理`
- `这里只做绑定和运行选择`

- [ ] **Step 2: Keep provider CRUD absent**

Do not add provider save/delete/preset fetching to Smart Factory. Smart Factory should display available providers and agent model choices sourced from the unified registry only.

### Task 5: Verification

**Files:**
- No production file edits after this task unless verification fails.

- [ ] **Step 1: Run frontend/source tests**

Run:

```bash
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs src/services/internalApi.test.mjs
```

Expected: pass.

- [ ] **Step 2: Run backend model registry tests**

Run:

```bash
node --test server/modelProviderRegistry.test.mjs server/smartFactoryConfigStore.test.mjs server/smartFactoryPreviewRoute.test.mjs
```

Expected: pass.

- [ ] **Step 3: Run type/build checks**

Run:

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run build
git diff --check
```

Expected: all exit 0.

- [ ] **Step 4: Browser verification**

Use Playwright with real browser state injection:
- Admin: open Settings Center, verify category navigation, model center matrix, admin provider controls, service category, runtime category.
- Staff: open Settings Center, verify model center read-only state and no admin provider mutations.
- Smart Factory: open model tab, verify it points to Settings Center and does not expose provider CRUD.

Save screenshots:
- `/tmp/settings-center-admin-verified.png`
- `/tmp/settings-center-staff-verified.png`
- `/tmp/smart-factory-model-center-linked.png`

### Self-Review

- Spec coverage: covers Settings Center first-level category IA, model center hierarchy, admin/staff permissions, Smart Factory consumption, and verification.
- Placeholder scan: no TBD/TODO/later placeholders.
- Type consistency: `SettingsSection`, `activeSettingsSection`, `selectedModelMode`, and existing model provider APIs are consistently named.
