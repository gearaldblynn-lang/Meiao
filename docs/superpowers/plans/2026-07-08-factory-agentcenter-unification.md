# 工厂↔智能体中心打通(发布即对齐) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工厂发布 = 对齐管道(upsert+自动验证+自动上线),中心侧对工厂出品 agent 加编辑锁,关联标记从 description 魔法字符串升级为结构化字段。

**Architecture:** 不动两套存储模型;升级 `smartFactoryAgentBridge.mjs` 纯函数层(链接判据+更新计划),`server/index.mjs` 两套 sync 执行器(MySQL/本地 JSON,根因库#7 红线:必须同步改)从"已链接即跳过"改为"已链接即更新",复用中心既有 draft→update→validate→publish 版本机制。前端只做状态展示与锁提示。

**Tech Stack:** Node .mjs(后端,`node --test`),React+TS(前端,`node --experimental-strip-types --test`)。

**对应 spec:** `docs/superpowers/specs/2026-07-08-factory-agentcenter-unification-design.md`

**红线(每个任务都适用):**
- MySQL 模式与本地 JSON 模式两套 handler 必须同批改、同批测(根因库#7);
- 不碰 `appStateMerge.mjs` / `shellPersistence.ts` / `shellDataAdapter.ts`;
- 不新增正则猜状态;默认种子只在字段缺失时播种(#40);
- 工作树有 image-crop 在途改动(`src/ShellMigratedApp.tsx`、`src/shell/types.ts` 等),**每次 commit 只 add 本任务明确触碰的文件,提交前 `git status` 逐一核对**;
- 全程本地,不跑任何部署脚本。

**已核实的既有机制(直接复用,不重造):**
- MySQL:`createDbAgentDraft(user, agentId)`(index.mjs:4799,复制最新版本为新草稿)→ `updateDbAgentVersion(user, versionId, payload)`(4843)→ `validateDbAgentVersion(user, versionId, message)`(5500)→ `publishDbAgentVersion(user, agentId, versionId)`(5528,要求 validationStatus==='success')。
- 本地:`createLocalAgentDraft(store, user, agentId)`(7190)→ `updateLocalAgentVersion(store, user, versionId, payload)`(7226);验证逻辑目前**内联在路由**(12269 起,runLocalAgentConversation + rawVersion.validationStatus='success');上线逻辑内联在 12350 路由(isPublished 翻牌+currentVersionId+status='published')。
- 知识库:`createDb/LocalKnowledgeBase`、`createDb/LocalKnowledgeDocument`(自带 ingestion 切片)、`listDb/LocalKnowledgeDocuments`(4997/7335)、`deleteDb/LocalKnowledgeDocument`(5174/7477,会级联清 chunk——**刷新文档必须走它,不许直接 filter store.knowledgeDocuments,否则 chunk 变孤儿**)。
- schema 迁移:`ensureMysqlColumn(pool, table, column, definition)`(index.mjs:2591,幂等)。
- 工厂发布路由:MySQL 9490 / 本地 11382;工厂 agent DELETE:MySQL 9474 / 本地 11365。
- 中心 agent 编辑类路由:MySQL agent PATCH 9783、draft POST 9808、version PATCH 9871、version DELETE 9884;本地对应 12177、12204、12242、12256。publish 9820/12350、rollback、validate 不锁。

---

### Task 1: bridge 纯函数层 —— 结构化关联判据 + 更新计划

**Files:**
- Modify: `server/smartFactoryAgentBridge.mjs`
- Test: `server/smartFactoryAgentBridge.test.mjs`

- [ ] **Step 1: 写失败测试**(追加到既有测试文件,沿用其 node:test 风格)

```js
// 追加:结构化字段优先 + 旧标记回退 + 计划带结构化链接
test('findLinkedAgentCenterAgent 优先结构化 factoryAgentId,回退旧 description 标记', () => {
  const byField = { id: 'a1', description: '普通描述', factoryAgentId: 'fa-1' };
  const byMarker = { id: 'a2', description: '旧的 [智能工厂同步:fa-2] 描述' };
  const unrelated = { id: 'a3', description: '无关' };
  assert.equal(findLinkedAgentCenterAgent([unrelated, byField], 'fa-1')?.id, 'a1');
  assert.equal(findLinkedAgentCenterAgent([unrelated, byMarker], 'fa-2')?.id, 'a2');
  assert.equal(findLinkedAgentCenterAgent([unrelated], 'fa-9'), null);
});

test('buildAgentCenterSyncPlan 输出结构化链接,新 description 不再内嵌标记', () => {
  const plan = buildAgentCenterSyncPlan({
    factoryAgent: { id: 'fa-1', name: '客服', prompt: 'p', knowledgeBaseIds: ['kb-1'], model: { model: 'gpt-5.5' } },
    factoryConfig: { knowledgeBases: [{ id: 'kb-1', name: '售后', documents: [{ title: 'd', content: '正文' }] }] },
  });
  assert.equal(plan.agentPayload.factoryAgentId, 'fa-1');
  assert.ok(!plan.agentPayload.description.includes('[智能工厂同步:'));
  assert.equal(plan.knowledgeBases[0].factoryKnowledgeBaseId, 'kb-1');
  assert.ok(!plan.knowledgeBases[0].description.includes('[智能工厂同步:'));
});

test('findLinkedKnowledgeBase 结构化优先,回退旧标记', () => {
  const byField = { id: 'k1', factoryAgentId: 'fa-1', factoryKnowledgeBaseId: 'kb-1' };
  const byMarker = { id: 'k2', description: '[智能工厂同步:fa-1] 由智能工厂知识库「售后」同步。' };
  assert.equal(findLinkedKnowledgeBase([byField], 'fa-1', 'kb-1')?.id, 'k1');
  assert.equal(findLinkedKnowledgeBase([byMarker], 'fa-1', 'kb-x')?.id, 'k2');
  assert.equal(findLinkedKnowledgeBase([], 'fa-1', 'kb-1'), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test server/smartFactoryAgentBridge.test.mjs`
Expected: FAIL(`findLinkedKnowledgeBase` 未导出、`factoryAgentId` 为 undefined)

- [ ] **Step 3: 实现**(`server/smartFactoryAgentBridge.mjs`)

```js
// findLinkedAgentCenterAgent 改为:
export const findLinkedAgentCenterAgent = (agents = [], factoryAgentId = '') => {
  const id = clean(factoryAgentId, 120);
  if (!id) return null;
  const list = asArray(agents);
  const byField = list.find((agent) => clean(agent?.factoryAgentId, 120) === id);
  if (byField) return byField;
  const marker = buildSmartFactoryLinkMarker(id);
  return list.find((agent) => String(agent?.description || '').includes(marker)) || null;
};

// 新增(物化知识库的链接判据,同样结构化优先+旧标记回退):
export const findLinkedKnowledgeBase = (knowledgeBases = [], factoryAgentId = '', factoryKnowledgeBaseId = '') => {
  const agentId = clean(factoryAgentId, 120);
  const kbId = clean(factoryKnowledgeBaseId, 120);
  if (!agentId) return null;
  const list = asArray(knowledgeBases);
  const byField = list.find((kb) => clean(kb?.factoryAgentId, 120) === agentId && clean(kb?.factoryKnowledgeBaseId, 120) === kbId);
  if (byField) return byField;
  const marker = buildSmartFactoryLinkMarker(agentId);
  return list.find((kb) => String(kb?.description || '').includes(marker)) || null;
};
```

`buildAgentCenterSyncPlan` 改动:`agentPayload` 增加 `factoryAgentId`,description 改为 `` `${clean(factoryAgent.description, 4000)}\n由智能工厂发布同步。`.trim() ``(去掉 marker);kb 的 description 改为 `` `由智能工厂知识库「${clean(kb.name, 100)}」同步。` ``;kb 条目增加输出 `factoryAgentId`。文件顶部注释同步更新(标记机制已升级为结构化字段,旧 marker 仅作历史数据回退判据保留)。

- [ ] **Step 4: 跑测试确认全过**(含既有用例——若既有用例断言了 description 含 marker,按新行为更新断言)

Run: `node --test server/smartFactoryAgentBridge.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/smartFactoryAgentBridge.mjs server/smartFactoryAgentBridge.test.mjs
git commit -m "feat(factory): 工厂↔中心关联从description标记升级为结构化字段(旧标记回退兼容)"
```

---

### Task 2: 本地模式发布管道 —— upsert + 自动验证 + 自动上线

**Files:**
- Modify: `server/index.mjs`(`syncFactoryAgentToLocalAgentCenter` 约 860;抽取本地验证/上线辅助函数)
- Test: `server/smartFactoryPublishPipeline.local.test.mjs`(新建)

- [ ] **Step 1: 先抽取两个可复用辅助函数(重构,不改行为)**

从 12269 验证路由抽 `validateLocalAgentVersionRecord(store, admin, agent, version, message)`:把 runLocalAgentConversation→写 validationStatus/validationSummary→push agentUsageLogs 的既有内联逻辑原样搬进函数,路由改调函数;conversation 抛错时函数返回 `{ ok: false, errorMessage }` 并把 validationStatus 置 'failed'(与路由现有失败行为一致,若路由现状是直接抛 500 则保持路由层行为不变、函数内 catch)。
从 12365-12371 上线路由抽 `publishLocalAgentVersionRecord(store, agentId, versionId)`:isPublished 翻牌 + currentVersionId + status='published' + updatedAt,路由改调函数。

Run: `node --test server/agentCenterSource.test.mjs` 及 `grep -rl "runLocalAgentConversation" server --include="*.test.mjs" | xargs -I{} node --test {}` 确认无回归。

- [ ] **Step 2: 写失败测试**(新文件,mock 最小 store;参考 `smartFactoryPreviewRoute.test.mjs` 的 store 构造方式)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
// 通过 HTTP 起本地 server 太重;直接 import index.mjs 不可行(副作用)。
// 因此本测试走"真实本地 server + 真实 API"集成风格不适合 node:test 单测;
// 改为:把 syncFactoryAgentToLocalAgentCenter 抽到可测位置太伤——
// 采用项目既有 source 断言风格(agentCenterSource.test.mjs 同款):
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('本地 sync 执行器:已链接分支走更新管道而非跳过', () => {
  const fn = source.slice(source.indexOf('const syncFactoryAgentToLocalAgentCenter'), source.indexOf('const syncFactoryAgentToDbAgentCenter'));
  assert.ok(!fn.includes('alreadyLinkedAgentId: existing.id') || fn.includes('createLocalAgentDraft'), '已链接时必须创建新版本,不许直接返回 alreadyLinkedAgentId 了事');
  assert.ok(fn.includes('createLocalAgentDraft'), '更新分支必须走 createLocalAgentDraft');
  assert.ok(fn.includes('updateLocalAgentVersion'), '更新分支必须写入工厂最新配置');
  assert.ok(fn.includes('validateLocalAgentVersionRecord'), '发布必须自动验证');
  assert.ok(fn.includes('publishLocalAgentVersionRecord'), '验证通过必须自动上线');
  assert.ok(fn.includes('deleteLocalKnowledgeDocument'), '知识库刷新必须走级联删除文档(清chunk),不许直接 filter knowledgeDocuments');
});
```

(行为级验证放 Task 8 的 E2E:source 测试防"漏接",E2E 验"真通"。这是 U2/5-C 批次验证过的组合。)

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test server/smartFactoryPublishPipeline.local.test.mjs`
Expected: FAIL

- [ ] **Step 4: 实现 `syncFactoryAgentToLocalAgentCenter` 改造**

```js
const syncFactoryAgentToLocalAgentCenter = async (store, user, smartFactoryConfig, factoryAgentId) => {
  if (user?.role !== 'admin') return { synced: false, skipped: 'not_admin' };
  const normalized = normalizeSmartFactoryConfig(smartFactoryConfig);
  const factoryAgent = normalized.agents.find((agent) => agent.id === factoryAgentId);
  const plan = buildAgentCenterSyncPlan({ factoryAgent, factoryConfig: normalized });
  if (!plan) return { synced: false, skipped: 'no_plan' };

  // 1) 物化/刷新知识库(全量替换文档;刷新走 deleteLocalKnowledgeDocument 级联清 chunk)
  const knowledgeBaseIds = [];
  for (const kb of plan.knowledgeBases) {
    const linked = findLinkedKnowledgeBase(listLocalKnowledgeBases(store, user), plan.factoryAgentId, kb.factoryKnowledgeBaseId);
    let kbId = linked?.id || '';
    if (kbId) {
      for (const doc of listLocalKnowledgeDocuments(store, user, kbId)) {
        deleteLocalKnowledgeDocument(store, user, doc.id);
      }
      const rawKb = (store.knowledgeBases || []).find((item) => item.id === kbId);
      if (rawKb) { // 惰性迁移旧标记库到结构化字段
        rawKb.factoryAgentId = plan.factoryAgentId;
        rawKb.factoryKnowledgeBaseId = kb.factoryKnowledgeBaseId;
      }
    } else {
      const created = createLocalKnowledgeBase(store, user, { name: kb.name, description: kb.description, department: '智能工厂' });
      if (!created) continue;
      kbId = created.id;
      const rawKb = (store.knowledgeBases || []).find((item) => item.id === kbId);
      if (rawKb) {
        rawKb.factoryAgentId = plan.factoryAgentId;
        rawKb.factoryKnowledgeBaseId = kb.factoryKnowledgeBaseId;
      }
    }
    knowledgeBaseIds.push(kbId);
    for (const doc of kb.documents) {
      await createLocalKnowledgeDocument(store, user, { knowledgeBaseId: kbId, title: doc.title, rawText: doc.rawText, sourceType: doc.sourceType });
    }
  }

  // 2) 物化/更新 agent + 新版本
  const existing = findLinkedAgentCenterAgent(store.agents || [], plan.factoryAgentId);
  let agentId = existing?.id || '';
  let version = null;
  if (agentId) {
    const rawAgent = (store.agents || []).find((item) => item.id === agentId);
    if (rawAgent && !rawAgent.factoryAgentId) rawAgent.factoryAgentId = plan.factoryAgentId; // 惰性迁移
    updateLocalAgent(store, user, agentId, { name: plan.agentPayload.name, description: plan.agentPayload.description });
    const draft = createLocalAgentDraft(store, user, agentId);
    if (!draft) return { synced: false, syncError: 'draft_create_failed' };
    version = updateLocalAgentVersion(store, user, draft.id, {
      systemPrompt: plan.agentPayload.systemPrompt,
      allowedChatModels: plan.agentPayload.allowedChatModels,
      defaultChatModel: plan.agentPayload.defaultChatModel,
      knowledgeBaseIds,
    });
  } else {
    const result = createLocalAgent(store, user, { ...plan.agentPayload, knowledgeBaseIds });
    agentId = result?.agent?.id || '';
    version = result?.version || null;
    const rawAgent = (store.agents || []).find((item) => item.id === agentId);
    if (rawAgent) rawAgent.factoryAgentId = plan.factoryAgentId; // 结构化字段(新发布不再依赖 description 标记)
  }
  if (!agentId || !version) return { synced: false, syncError: 'agent_materialize_failed' };

  // 3) 自动验证;失败 → 不上线(老版本继续在线),原因回报工厂
  const agent = getLocalAgentById(store, agentId);
  const validation = await validateLocalAgentVersionRecord(store, user, agent, version, '请用一句话说明这个智能体能做什么。');
  if (!validation?.ok) {
    return { synced: true, published: false, agentCenterAgentId: agentId, validationFailed: true, errorMessage: validation?.errorMessage || '验证失败' };
  }

  // 4) 自动上线
  publishLocalAgentVersionRecord(store, agentId, version.id);
  return { synced: true, published: true, agentCenterAgentId: agentId };
};
```

注意:`listLocalKnowledgeBases(store, user)` 若实际函数名/签名不同(7270 附近),以真实签名为准;admin 对非本人资源的可管理性由 `canManageOwnedResource`/`isSuperAdminUser` 既有语义决定,勿绕过。

- [ ] **Step 5: 跑测试**

Run: `node --test server/smartFactoryPublishPipeline.local.test.mjs && node --test server/smartFactoryPreviewRoute.test.mjs server/agentCenterSource.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs server/smartFactoryPublishPipeline.local.test.mjs
git commit -m "feat(factory): 本地模式发布管道升级为upsert+自动验证+自动上线"
```

---

### Task 3: MySQL 模式发布管道(与 Task 2 对称)

**Files:**
- Modify: `server/index.mjs`(`syncFactoryAgentToDbAgentCenter` 约 890;`ensureMysqlSchema` 约 2729;`createDbAgent` 4671;`getDbAgentById` 4610)
- Test: `server/smartFactoryPublishPipeline.db.test.mjs`(新建,source 断言风格同 Task 2)

- [ ] **Step 1: schema + 字段透传**

`ensureMysqlSchema` 在 agents 两个 ensureMysqlColumn 后追加:
```js
  await ensureMysqlColumn(pool, 'agents', 'factory_agent_id', 'VARCHAR(120) NULL');
  await ensureMysqlColumn(pool, 'knowledge_bases', 'factory_agent_id', 'VARCHAR(120) NULL');
  await ensureMysqlColumn(pool, 'knowledge_bases', 'factory_kb_id', 'VARCHAR(120) NULL');
```
`getDbAgentById` 返回对象加 `factoryAgentId: rows[0].factory_agent_id || ''`;knowledge base 的行映射函数(4887 listDbKnowledgeBases 用的那个)同样加 `factoryAgentId`/`factoryKnowledgeBaseId`。`createDbAgent` INSERT 加 `factory_agent_id` 列(payload.factoryAgentId || null);`createDbKnowledgeBase` INSERT 加两列(payload 透传)。

- [ ] **Step 2: 写失败 source 测试**(断言 `syncFactoryAgentToDbAgentCenter` 片段含 `createDbAgentDraft`/`updateDbAgentVersion`/`validateDbAgentVersion`/`publishDbAgentVersion`/`deleteDbKnowledgeDocument`,同 Task 2 风格)

Run: `node --test server/smartFactoryPublishPipeline.db.test.mjs` → Expected: FAIL

- [ ] **Step 3: 实现 `syncFactoryAgentToDbAgentCenter`**(结构与 Task 2 Step 4 完全对称,替换为 Db 系函数:`listDbKnowledgeBases(user)`/`listDbKnowledgeDocuments(user, kbId)`/`deleteDbKnowledgeDocument(user, docId)`/`createDbKnowledgeBase`/`createDbKnowledgeDocument`/`findLinkedAgentCenterAgent(await listDbAgents(user), ...)`/`updateDbAgent`/`createDbAgentDraft`/`updateDbAgentVersion`/`validateDbAgentVersion`/`publishDbAgentVersion`。惰性迁移用 `UPDATE agents SET factory_agent_id = ? WHERE id = ?` 与 `UPDATE knowledge_bases SET factory_agent_id = ?, factory_kb_id = ? WHERE id = ?`。`validateDbAgentVersion` 抛错时 catch 住返回 validationFailed 结构,与本地一致。)

- [ ] **Step 4: 跑测试**

Run: `node --test server/smartFactoryPublishPipeline.db.test.mjs server/smartFactoryPublishPipeline.local.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs server/smartFactoryPublishPipeline.db.test.mjs
git commit -m "feat(factory): MySQL模式发布管道对称升级(schema加factory_agent_id结构化关联)"
```

---

### Task 4: 中心侧编辑锁(双模式)

**Files:**
- Modify: `server/index.mjs`(MySQL:9783 agent PATCH、9808 draft POST、9871 version PATCH、9884 version DELETE;本地:12177、12204、12242、12256)
- Test: `server/factoryManagedAgentLock.test.mjs`(新建)

- [ ] **Step 1: 写失败测试**(source 断言:8 个路由点都有守卫 + 守卫是单一辅助函数)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('编辑锁守卫是单一函数且双模式8个编辑点全接入', () => {
  assert.ok(source.includes('const rejectIfFactoryManaged'), '必须有单一守卫函数');
  const count = source.split('rejectIfFactoryManaged(').length - 1;
  assert.ok(count >= 9, `守卫接入点不足:期望 >=9(定义1+8路由),实际 ${count}`);
  assert.ok(source.includes("errorCode: 'factory_managed_agent'"));
});

test('agent PATCH 仅 status 字段放行(上下线/停启用不锁)', () => {
  assert.ok(source.includes('isStatusOnlyAgentPatch'), '需要 status-only 放行判据');
});
```

- [ ] **Step 2: 跑测试确认失败** → Run: `node --test server/factoryManagedAgentLock.test.mjs` → FAIL

- [ ] **Step 3: 实现**

单一守卫(放在 sync 执行器附近,860 之前):
```js
const isStatusOnlyAgentPatch = (payload = {}) => {
  const keys = Object.keys(payload || {});
  return keys.length > 0 && keys.every((key) => key === 'status');
};

// 返回 true 表示已拒绝(调用方应 return)。agent 参数需带 factoryAgentId 与 description(旧标记回退)。
const rejectIfFactoryManaged = (res, agent) => {
  const linked = Boolean(agent?.factoryAgentId)
    || String(agent?.description || '').includes(SMART_FACTORY_LINK_PREFIX);
  if (!linked) return false;
  json(res, 403, {
    errorCode: 'factory_managed_agent',
    message: '该智能体由智能工厂管理,请在智能工厂修改后重新发布。',
  });
  return true;
};
```

8 个路由点接入(取到 agent 之后、执行写入之前):
- agent PATCH(9783/12177):`if (!isStatusOnlyAgentPatch(body) && rejectIfFactoryManaged(res, current)) return;`(current 为该路由既有的 agent 查询结果;若路由现状先调 update 后查,需先 `getDbAgentById`/`getLocalAgentById` 取一次)
- draft POST(9808/12204)、version PATCH(9871/12242)、version DELETE(9884/12256):先由 versionId/agentId 取 agent,`if (rejectIfFactoryManaged(res, agent)) return;`
- publish/rollback/validate/DELETE agent 路由**不加**(上下线、删除、验证不锁)。

注意:`rejectIfFactoryManaged` 只在**路由层**接入;Task 2/3 的发布管道走内部函数(updateLocalAgentVersion 等),天然不经过锁。

- [ ] **Step 4: 跑测试** → PASS;再跑 `node --test server/agentCenterSource.test.mjs` 防守卫计数类既有断言回归(若它断言 requireUser 数量之类,按需更新——参考 W3 批次 b779c86 的先例:守卫数变化要改计数断言)。

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs server/factoryManagedAgentLock.test.mjs
git commit -m "feat(center): 工厂出品智能体编辑锁(单一守卫,双模式8点接入,status-only放行)"
```

---

### Task 5: 工厂删除 → 中心级联下线(双模式)

**Files:**
- Modify: `server/index.mjs`(MySQL 工厂 agent DELETE 9474;本地 11365)
- Test: 追加到 `server/factoryManagedAgentLock.test.mjs`

- [ ] **Step 1: 写失败测试**(source 断言:两个工厂 DELETE 路由都调用级联下线辅助函数;函数做的是"下线+解锁",不物理删)

```js
test('工厂删除级联下线中心agent(不物理删,解除锁定)', () => {
  assert.ok(source.includes('const unpublishLinkedAgentCenterAgentLocal'), '本地级联下线函数');
  assert.ok(source.includes('const unpublishLinkedAgentCenterAgentDb'), 'DB级联下线函数');
  const localDelete = source.slice(source.indexOf("localSmartFactoryAgentMatch && req.method === 'DELETE'"), source.indexOf('localSmartFactoryAgentPublishMatch'));
  assert.ok(localDelete.includes('unpublishLinkedAgentCenterAgentLocal'));
  const dbDelete = source.slice(source.indexOf("dbSmartFactoryAgentMatch && req.method === 'DELETE'"), source.indexOf('dbSmartFactoryAgentPublishMatch'));
  assert.ok(dbDelete.includes('unpublishLinkedAgentCenterAgentDb'));
});
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**

```js
const unpublishLinkedAgentCenterAgentLocal = (store, factoryAgentId) => {
  const linked = findLinkedAgentCenterAgent(store.agents || [], factoryAgentId);
  if (!linked) return null;
  const rawAgent = (store.agents || []).find((item) => item.id === linked.id);
  if (!rawAgent) return null;
  rawAgent.status = 'draft'; // 下线:商家不再可见可聊;版本/会话/知识库全保留
  rawAgent.factoryAgentId = ''; // 解除锁定,变回普通agent
  rawAgent.description = String(rawAgent.description || '').split('\n').filter((line) => !line.includes(SMART_FACTORY_LINK_PREFIX)).join('\n'); // 清理旧标记行,防回退判据再锁
  rawAgent.updatedAt = Date.now();
  return { agentCenterAgentId: linked.id, unpublished: true };
};

const unpublishLinkedAgentCenterAgentDb = async (user, factoryAgentId) => {
  const linked = findLinkedAgentCenterAgent(await listDbAgents(user), factoryAgentId);
  if (!linked) return null;
  const pool = await getMysqlPool();
  const cleanedDescription = String(linked.description || '').split('\n').filter((line) => !line.includes(SMART_FACTORY_LINK_PREFIX)).join('\n');
  await pool.query(
    "UPDATE agents SET status = 'draft', factory_agent_id = NULL, description = ?, updated_at = ? WHERE id = ?",
    [cleanedDescription, Date.now(), linked.id]
  );
  return { agentCenterAgentId: linked.id, unpublished: true };
};
```

两个工厂 DELETE 路由在 `deleteSmartFactoryAgent` 成功、保存 settings 之后调用(**在 delete 前先取 factoryAgentId 对应的链接**——delete 后工厂 config 里已无该 agent,但链接查询靠的是中心侧数据,所以 delete 后调用也可;以"delete 成功才下线"为准),响应 JSON 加 `agentCenterUnlink` 字段透传结果。级联失败 catch 住放进 `agentCenterUnlink: { error }`,不回滚工厂删除。

- [ ] **Step 4: 跑测试** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs server/factoryManagedAgentLock.test.mjs
git commit -m "feat(factory): 工厂删除级联下线中心agent(保留会话历史,解除编辑锁)"
```

---

### Task 6: 前端 —— 工厂发布反馈 + 删除确认文案

**Files:**
- Modify: `src/services/internalApi.ts:1176`(publishSmartFactoryAgent 返回类型)
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`(发布 handler 约 572、发布按钮 1240、删除确认)
- Test: `src/components/uiArchitecture.test.mjs`(⚠️ 该文件在 image-crop 在途改动中已被修改——**只追加用例,不动既有内容,commit 时用 `git add -p` 只暂存本任务的 hunk**;若冲突风险大,改为新建 `src/modules/AgentCenter/smartFactoryPanelSource.test.mjs`,推荐后者)

- [ ] **Step 1: 写失败 source 测试**(新建 `src/modules/AgentCenter/smartFactoryPanelSource.test.mjs`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const panel = readFileSync(new URL('./SmartFactoryPanel.tsx', import.meta.url), 'utf8');

test('发布反馈:区分上线成功/验证失败,展示人话原因', () => {
  assert.ok(panel.includes('agentCenterSync'), '发布 handler 必须消费 agentCenterSync');
  assert.ok(panel.includes('validationFailed'), '验证失败要单独提示');
  assert.ok(panel.includes('已发布并上线到智能体中心'), '成功文案');
});

test('删除确认文案含级联下线提示', () => {
  assert.ok(panel.includes('同时在智能体中心下线'), '删除确认必须告知级联下线');
});
```

- [ ] **Step 2: 确认失败** → Run: `node --experimental-strip-types --test src/modules/AgentCenter/smartFactoryPanelSource.test.mjs` → FAIL

- [ ] **Step 3: 实现**
- `internalApi.ts` publishSmartFactoryAgent 返回类型加 `agentCenterSync?: { synced: boolean; published?: boolean; agentCenterAgentId?: string; validationFailed?: boolean; errorMessage?: string; syncError?: string }`。
- SmartFactoryPanel 发布 handler(572 附近 runAction):读响应 `agentCenterSync`——`published===true` → 成功提示"已发布并上线到智能体中心,商家侧立即可用";`validationFailed` → 错误提示 `发布未上线:验证失败——${errorMessage}`(沿用面板既有 onErrorMessage 通道);`syncError` → 同步失败提示。删除智能体的确认弹层文案追加"将同时在智能体中心下线该智能体(聊天历史保留)"。
- 状态展示:agent 卡片已有 `published/草稿` 标签(926/960),补 `publishedAt` 时间显示(工厂 config agent 已有该字段)。

- [ ] **Step 4: 跑测试** → PASS;`npx tsc --noEmit` 干净。

- [ ] **Step 5: Commit**(只 add 这三个文件,核对 `git status` 不带入 image-crop 文件)

```bash
git add src/services/internalApi.ts src/modules/AgentCenter/SmartFactoryPanel.tsx src/modules/AgentCenter/smartFactoryPanelSource.test.mjs
git commit -m "feat(factory-ui): 发布反馈区分上线/验证失败,删除确认提示级联下线"
```

---

### Task 7: 前端 —— 中心侧"由智能工厂管理"徽标与编辑锁 UI

**Files:**
- Modify: `src/modules/AgentCenter/AgentCenterModule.tsx`(agent 管理/编辑界面;先 grep `编辑`/`AgentStudio`/agent 编辑入口确定精确组件,可能在 `AgentCenterModule.tsx` 内或其子组件)
- Modify: 前端 agent 类型定义(grep `ownerDisplayName` 或 `currentVersionId` 找到 agent type,加 `factoryAgentId?: string`)
- Test: `src/modules/AgentCenter/agentCenterFactoryBadgeSource.test.mjs`(新建)

- [ ] **Step 1: 后端 GET 透传确认**:`getDbAgentById`/`getLocalAgentById` 返回对象需含 `factoryAgentId`(Task 3 已做 DB 侧;本地侧 `getLocalAgentById` 若是浅拷贝映射,确认字段透出,缺则补)。

- [ ] **Step 2: 写失败 source 测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const module_ = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');

test('工厂出品agent显示管理徽标并替换编辑入口', () => {
  assert.ok(module_.includes('factoryAgentId'), '前端必须消费 factoryAgentId');
  assert.ok(module_.includes('由智能工厂管理'), '徽标文案');
  assert.ok(module_.includes('去智能工厂修改'), '编辑入口替换文案');
});
```

- [ ] **Step 3: 确认失败** → FAIL

- [ ] **Step 4: 实现**:agent 列表卡片与详情页,`agent.factoryAgentId` 为真时:挂徽标"由智能工厂管理";管理员的"编辑/新建版本"按钮替换为提示按钮"去智能工厂修改"(点击仅提示,不跳转——工厂是独立模块入口,避免跨模块路由改动);商家视图本就无编辑入口,无需改。同时对 403 `factory_managed_agent` 响应做人话展示兜底(万一旧界面缓存仍发编辑请求)。

- [ ] **Step 5: 跑测试** → PASS;`npx tsc --noEmit` 干净。

- [ ] **Step 6: Commit**

```bash
git add src/modules/AgentCenter/AgentCenterModule.tsx src/modules/AgentCenter/agentCenterFactoryBadgeSource.test.mjs src/types.ts
# ⚠️ src/types.ts 在 image-crop 在途改动中已被修改:用 git add -p src/types.ts 只暂存 factoryAgentId 一个 hunk;
# 若 agent 类型不在 src/types.ts 则以实际文件为准
git commit -m "feat(center-ui): 工厂出品agent徽标+编辑入口替换为去工厂提示"
```

---

### Task 8: 全量回归 + 本地 E2E 验收

**Files:** 无新改动(只验证;发现问题回对应 Task 修)

- [ ] **Step 1: 全量测试**

```bash
find server -name "*.test.mjs" | xargs node --test 2>&1 | tail -5
find src -name "*.test.mjs" | xargs node --experimental-strip-types --test 2>&1 | tail -5
npm run lint && npx tsc --noEmit && npm run build
```
Expected: 全过 / 0 error / build 成功。基线对照:改动前先跑一次记录既有失败(如有),零新增失败才算过。

- [ ] **Step 2: 重启本地后端**(教训:验证前必须确认进程比代码新)

```bash
launchctl kickstart -k gui/$(id -u)/com.meiao.current.server
# 等 health OK 且确认新进程启动时间晚于最后一次 commit
curl -s http://127.0.0.1:3100/api/health
```

- [ ] **Step 3: E2E 验收脚本**(按 spec §8;admin 凭据从 `.env.server` 读,参考 /tmp/kb-delete-verify.mjs 的写法)

依次断言:
1. 工厂创建 agent(带 1 个知识库 2 文档)→ POST publish → 响应 `agentCenterSync.published === true`;
2. GET /api/agents 中出现同名 agent,`status === 'published'`,`factoryAgentId` 非空;对话 POST 能答且检索命中文档;
3. 工厂改 prompt + 加第 3 篇文档 → 再 publish → 中心同一 agentId(**不新建**),版本数+1,当前版本 systemPrompt 为新值,检索命中新文档;
4. 对该 agent 发 PATCH name → 403 `factory_managed_agent`;PATCH `{status:'draft'}` → 200(status-only 放行);恢复 published;
5. 工厂 DELETE 该 agent → 响应含 `agentCenterUnlink.unpublished === true`;中心 agent `status === 'draft'`、`factoryAgentId` 空、chat_sessions 仍在;此时 PATCH name → 200(锁已解除)。
6. durable 层复查:重启服务后以上状态不漂移。

- [ ] **Step 4: 清理 E2E 测试数据**(用中心 DELETE API 删测试 agent/知识库,恢复 store 整洁;操作前备份 `cp server/data/internal-store.json server/data/internal-store.json.bak-<date>-e2e`)

- [ ] **Step 5: 最终 commit(如 E2E 过程中有修复)+ 汇报**

验收标准全绿后,更新 `docs/superpowers/diagnostics/2026-07-03-问题清单.md` 追加本批次记录(修了什么/验了什么/**未上云**),commit。

---

## Self-Review 结果(已按此修正)

- spec §4.1 upsert/自动验证/上线 → Task 2/3;§4.2 编辑锁 → Task 4;§4.3 级联下线 → Task 5;§4.4 会话不断 → 版本机制天然满足+E2E 5 验证;§5 结构化字段+惰性迁移 → Task 1/2/3/5;§6 前端 → Task 6/7;§8 测试 → 各 Task Step + Task 8。
- 类型一致性:`validateLocalAgentVersionRecord`/`publishLocalAgentVersionRecord`(Task 2 定义,Task 2/3 引用一致);`findLinkedKnowledgeBase(list, factoryAgentId, factoryKnowledgeBaseId)`(Task 1 定义,Task 2/3 引用一致);`rejectIfFactoryManaged(res, agent)`(Task 4);响应字段 `agentCenterSync.published/validationFailed/errorMessage`(Task 2/3 产出,Task 6 消费)、`agentCenterUnlink`(Task 5 产出,Task 6 文案对应)。
- 已知留白(施工时按真实代码适配,均已给出定位方式):本地 KB 列表函数确切名(7270 附近)、agent 类型定义所在文件、中心编辑按钮所在子组件。
