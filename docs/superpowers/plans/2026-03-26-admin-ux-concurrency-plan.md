# Admin UX And Concurrency Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify concurrency presentation to a single usable value, default new accounts to concurrency 5, and make account/log management compact and practical.

**Architecture:** Keep the queue execution logic unchanged while simplifying the admin UI and adding one targeted server capability for log deletion. Use small pure helpers for log filtering/export formatting so the new behavior can be tested without mounting the full UI.

**Tech Stack:** React, TypeScript, Node HTTP server, local JSON mode, MySQL mode, node:test

---

### Task 1: Add failing tests for log export/filter helpers and concurrency defaults

**Files:**
- Create: `modules/Account/accountManagementUtils.ts`
- Create: `modules/Account/accountManagementUtils.test.mjs`
- Modify: `server/jobManager.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLogCsv,
  filterLogs,
  getEffectiveConcurrency,
} from './accountManagementUtils.ts';

test('getEffectiveConcurrency returns the lower positive concurrency limit', () => {
  assert.equal(getEffectiveConcurrency(8, 5), 5);
  assert.equal(getEffectiveConcurrency(3, 0), 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/Account/accountManagementUtils.test.mjs server/jobManager.test.mjs`
Expected: FAIL because helper file does not exist yet or exports are missing.

- [ ] **Step 3: Write minimal implementation**

```ts
export const getEffectiveConcurrency = (systemMax: number, userMax: number) => {
  const safeSystem = Number.isFinite(systemMax) && systemMax > 0 ? systemMax : 5;
  const safeUser = Number.isFinite(userMax) && userMax > 0 ? userMax : safeSystem;
  return Math.max(1, Math.min(safeSystem, safeUser));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/Account/accountManagementUtils.test.mjs server/jobManager.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/Account/accountManagementUtils.ts modules/Account/accountManagementUtils.test.mjs server/jobManager.test.mjs
git commit -m "test: cover admin concurrency helpers"
```

### Task 2: Update server defaults and add log deletion API

**Files:**
- Modify: `server/index.mjs`
- Modify: `services/internalApi.ts`

- [ ] **Step 1: Write the failing test**

```js
test('default user concurrency falls back to 5', () => {
  assert.equal(selectJobsWithinConcurrencyLimits({
    jobs: [createJob('job-1', 'user-a', 1)],
    availableSlots: 1,
    activeJobUserIds: [],
    getUserConcurrency: () => undefined,
  }).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/jobManager.test.mjs`
Expected: FAIL because fallback is still 3.

- [ ] **Step 3: Write minimal implementation**

```js
const DEFAULT_JOB_CONCURRENCY = 5;
```

- [ ] **Step 4: Add log deletion endpoint**

```js
if (url.pathname === '/api/logs' && req.method === 'DELETE') {
  // delete filtered logs by module/user/status
}
```

- [ ] **Step 5: Run tests**

Run: `node --test server/jobManager.test.mjs server/envLoader.test.mjs server/localJobStore.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs services/internalApi.ts server/jobManager.test.mjs
git commit -m "feat: add admin log cleanup and concurrency defaults"
```

### Task 3: Simplify settings page concurrency display

**Files:**
- Modify: `App.tsx`
- Modify: `modules/Settings/GlobalApiSettings.tsx`
- Modify: `utils/appState.ts`

- [ ] **Step 1: Write the failing helper assertions**

```js
assert.equal(getEffectiveConcurrency(6, 5), 5);
assert.equal(getEffectiveConcurrency(3, 8), 3);
```

- [ ] **Step 2: Run test to verify it fails if helper is wrong**

Run: `node --test modules/Account/accountManagementUtils.test.mjs`
Expected: FAIL if helper behavior is incorrect.

- [ ] **Step 3: Update the UI**

```tsx
<div className="rounded-3xl border border-slate-200 bg-white px-6 py-5">
  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">可用并发</p>
  <p className="mt-2 text-2xl font-black text-slate-900">{effectiveConcurrency}</p>
</div>
```

- [ ] **Step 4: Run type-check**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add App.tsx modules/Settings/GlobalApiSettings.tsx utils/appState.ts modules/Account/accountManagementUtils.ts
git commit -m "feat: simplify concurrency display"
```

### Task 4: Rework account management layout into tabs and expandable cards

**Files:**
- Modify: `components/Internal/UserAdminPanel.tsx`
- Modify: `modules/Account/AccountManagement.tsx`

- [ ] **Step 1: Add compact state handling**

```tsx
const [activeTab, setActiveTab] = useState<'users' | 'logs'>('users');
const [expandedUserId, setExpandedUserId] = useState('');
```

- [ ] **Step 2: Replace long inline layout with compact cards**

```tsx
<button onClick={() => setExpandedUserId(expandedUserId === user.id ? '' : user.id)}>
  {expandedUserId === user.id ? '收起' : '展开'}
</button>
```

- [ ] **Step 3: Keep only one expanded row at a time**

```tsx
setExpandedUserId((current) => current === user.id ? '' : user.id);
```

- [ ] **Step 4: Run type-check**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/Internal/UserAdminPanel.tsx modules/Account/AccountManagement.tsx
git commit -m "feat: compact account management layout"
```

### Task 5: Add log export and delete actions to the log tab

**Files:**
- Modify: `modules/Account/AccountManagement.tsx`
- Modify: `modules/Account/accountManagementUtils.ts`
- Test: `modules/Account/accountManagementUtils.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('buildLogCsv exports visible log rows', () => {
  const csv = buildLogCsv([{ id: '1', module: 'translation', message: 'ok', status: 'success', createdAt: 1, username: 'u', displayName: 'U', action: 'process_single', level: 'info', userId: 'u1' }]);
  assert.match(csv, /translation/);
  assert.match(csv, /ok/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/Account/accountManagementUtils.test.mjs`
Expected: FAIL if CSV helper is missing.

- [ ] **Step 3: Implement export and delete actions**

```tsx
<button onClick={handleExportLogs}>导出当前结果</button>
<button onClick={() => void handleDeleteLogs()}>清理当前结果</button>
```

- [ ] **Step 4: Run verification**

Run: `node --test modules/Account/accountManagementUtils.test.mjs && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/Account/AccountManagement.tsx modules/Account/accountManagementUtils.ts modules/Account/accountManagementUtils.test.mjs
git commit -m "feat: add practical log export and cleanup"
```
