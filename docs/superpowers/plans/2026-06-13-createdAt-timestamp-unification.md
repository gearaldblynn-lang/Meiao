# createdAt / completedAt 时间戳彻底统一 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把壳层 `createdAt`/`completedAt` 从展示字符串改为单一规范数字毫秒戳,启发式恢复逻辑收敛到读边界一处,消除已用探针复现的"年缺失日期被贴当前年顶到最前"排序乱序。

**Architecture:** 数字是数据、字符串是渲染产物。新增 `createdAtMs.ts`(读边界单一恢复判据,返回 `{ms, precise}`)与 `timeFormat.ts`(合并 3 份重复 `formatTime` + 紧凑 `formatMonthDay`)。`createdAt`/`completedAt` 类型 `string→number`,靠 tsc 揪出全部消费点。排序塌成 `precise tier desc → createdAt desc → sequence desc → 原序`。后端零改动。

**Tech Stack:** TypeScript + React(Vite),Node `--test` + `--experimental-strip-types`,`npm run lint`(= `tsc -b && eslint .`)。

> **提交约定**:本项目业主要求"本地先做稳、不急提交",且第0层纪律"只在用户要求时提交"。下方各 commit 步骤为**本地提交、不 push**;若业主当下不想提交,可整批做完最后一次性提交。分支 `fix/chunk-error-boundary`。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/utils/createdAtMs.ts` | 读边界唯一恢复判据:任意历史形态 → `{ms, precise}` | 创建 |
| `src/utils/createdAtMs.test.mjs` | 上者单测 | 创建 |
| `src/utils/timeFormat.ts` | `formatTime`(完整)+ `formatMonthDay`(紧凑 MM-DD) | 创建 |
| `src/utils/timeFormat.test.mjs` | 上者单测 | 创建 |
| `src/adapters/shellScopeFilters.ts` | 删启发式块,`projectSortKey` 塌成数字+tier | 改 |
| `src/adapters/shellScopeFilters.test.mjs` | 固化探针为回归测试 | 改 |
| `src/adapters/shellDataAdapter.ts` | 类型 string→number;读边界用 coerceCreatedAtMs;ID fallback 用 formatMonthDay | 改 |
| `src/adapters/shellPersistence.ts` | 类型 string→number;读取处过 normalizer | 改 |
| `src/ShellMigratedApp.tsx` | 类型 string→number;4 处产生点改 Date.now() | 改 |
| `src/shell/components/ProjectCard.tsx` | 3 处展示包 formatMonthDay | 改 |
| `src/shell/components/ResultCard.tsx` | 1 处展示包 formatMonthDay | 改 |
| `src/shell/modules/Account/AccountManagement.tsx` 等 3 处 | 删本地 formatTime,import 共享 | 改 |

---

## Task 1: `coerceCreatedAtMs` 单一恢复判据(纯函数 + TDD)

**Files:**
- Create: `src/utils/createdAtMs.ts`
- Test: `src/utils/createdAtMs.test.mjs`

设计:返回 `{ ms: number; precise: boolean }`。`precise=true` 表示来自真实完整毫秒戳(数字直采 / 从 id 抠 12-13 位戳);`precise=false` 表示只能靠年缺失字符串(MM-DD / X月Y日)或 updatedAt 恢复。排序据此分层,**年缺失值永不排在 precise 值之前**。

- [ ] **Step 1: 写失败测试**

```js
// src/utils/createdAtMs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceCreatedAtMs } from './createdAtMs.ts';

const LOWER = new Date('2020-01-01T00:00:00Z').getTime();

test('数字毫秒戳直采,precise', () => {
  const ms = LOWER + 1000;
  assert.deepEqual(coerceCreatedAtMs(ms), { ms, precise: true });
});

test('数字字符串戳直采,precise', () => {
  const ms = LOWER + 5000;
  assert.deepEqual(coerceCreatedAtMs(String(ms)), { ms, precise: true });
});

test('id 含 13 位毫秒戳可抠出,precise', () => {
  const ms = LOWER + 9999;
  const r = coerceCreatedAtMs('06-13', { id: `proj-${ms}` });
  assert.equal(r.ms, ms);
  assert.equal(r.precise, true);
});

test('"06-13" 无 id 戳,解析为当年月日但 precise=false', () => {
  const r = coerceCreatedAtMs('06-13', { id: 'legacy-abc' });
  assert.equal(r.precise, false);
  assert.equal(new Date(r.ms).getMonth(), 5); // 6月=index5
  assert.equal(new Date(r.ms).getDate(), 13);
});

test('"6月13日" 中文同理,precise=false', () => {
  const r = coerceCreatedAtMs('6月13日', { id: 'cn-y' });
  assert.equal(r.precise, false);
  assert.equal(new Date(r.ms).getMonth(), 5);
});

test('啥都没有退 updatedAt,precise=false', () => {
  const up = LOWER + 7777;
  const r = coerceCreatedAtMs(undefined, { id: 'noinfo', updatedAt: up });
  assert.equal(r.precise, false);
  assert.equal(r.ms, new Date(up).setHours(0, 0, 0, 0));
});

test('全垃圾 → ms 0 precise false', () => {
  assert.deepEqual(coerceCreatedAtMs('garbage', { id: 'x' }), { ms: 0, precise: false });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-strip-types --test src/utils/createdAtMs.test.mjs`
Expected: FAIL(`Cannot find ... coerceCreatedAtMs` 或断言失败)

- [ ] **Step 3: 写最小实现**

```ts
// src/utils/createdAtMs.ts
const timestampLowerBound = new Date('2020-01-01T00:00:00Z').getTime();
const timestampUpperBound = new Date('2100-01-01T00:00:00Z').getTime();

const toFiniteTimestamp = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= timestampLowerBound && parsed <= timestampUpperBound ? parsed : 0;
};

const extractTimestampFromText = (value: unknown): number => {
  const matches = String(value || '').match(/\d{12,13}/g) || [];
  for (const match of matches) {
    const timestamp = toFiniteTimestamp(match);
    if (timestamp) return timestamp;
  }
  return 0;
};

const parseMonthDay = (value: unknown): number => {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2})月(\d{1,2})日/) || text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return 0;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return 0;
  const date = new Date();
  date.setMonth(month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const startOfDay = (timestamp: number): number => {
  if (!timestamp) return 0;
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export interface CoercedCreatedAt {
  ms: number;
  precise: boolean;
}

// 读边界唯一判据:把任意历史形态的 createdAt 恢复成规范毫秒戳。
// precise=true 仅当来自真实完整时间戳(数字/字符串戳 或 id 内嵌戳)。
export const coerceCreatedAtMs = (
  raw: unknown,
  ctx: { id?: unknown; updatedAt?: unknown } = {},
): CoercedCreatedAt => {
  const direct = toFiniteTimestamp(raw) || extractTimestampFromText(ctx.id);
  if (direct) return { ms: direct, precise: true };
  const fuzzy = parseMonthDay(raw) || parseMonthDay(ctx.id) || startOfDay(toFiniteTimestamp(ctx.updatedAt));
  return { ms: fuzzy, precise: false };
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --experimental-strip-types --test src/utils/createdAtMs.test.mjs`
Expected: PASS(7 tests)

- [ ] **Step 5: 本地提交**

```bash
git add src/utils/createdAtMs.ts src/utils/createdAtMs.test.mjs
git commit -m "feat: add coerceCreatedAtMs single-judgment timestamp recovery"
```

---

## Task 2: `timeFormat` 展示模块(合并 3 份重复 formatTime + 紧凑 MM-DD)

**Files:**
- Create: `src/utils/timeFormat.ts`
- Test: `src/utils/timeFormat.test.mjs`

`formatMonthDay` 必须与旧 `toDateLabel` 逐字一致:`new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-')`。

- [ ] **Step 1: 写失败测试**

```js
// src/utils/timeFormat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatMonthDay } from './timeFormat.ts';

test('formatMonthDay 与旧 toDateLabel 同款 MM-DD', () => {
  const ms = new Date('2026-06-13T10:00:00').getTime();
  const expected = new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');
  assert.equal(formatMonthDay(ms), expected);
});

test('formatMonthDay 空值给空串', () => {
  assert.equal(formatMonthDay(0), '');
  assert.equal(formatMonthDay(null), '');
  assert.equal(formatMonthDay(undefined), '');
});

test('formatTime 完整日期时间', () => {
  const ms = new Date('2026-06-13T10:00:00').getTime();
  const expected = new Date(ms).toLocaleString('zh-CN', { hour12: false });
  assert.equal(formatTime(ms), expected);
});

test('formatTime 空值给占位', () => {
  assert.equal(formatTime(0), '-');
  assert.equal(formatTime(null), '-');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-strip-types --test src/utils/timeFormat.test.mjs`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写最小实现**

```ts
// src/utils/timeFormat.ts
// 完整日期时间(合并自 AccountManagement / ReferencePresetManager 三份相同实现)
export const formatTime = (value?: number | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

// 紧凑月-日,等价旧 shellDataAdapter.toDateLabel 的展示部分,给项目/结果卡片用
export const formatMonthDay = (value?: number | null): string => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --experimental-strip-types --test src/utils/timeFormat.test.mjs`
Expected: PASS(4 tests)

- [ ] **Step 5: 本地提交**

```bash
git add src/utils/timeFormat.ts src/utils/timeFormat.test.mjs
git commit -m "feat: add shared timeFormat (formatTime + formatMonthDay)"
```

---

## Task 3: 排序回归测试先行(固化探针,锁定修复契约)

**Files:**
- Modify: `src/adapters/shellScopeFilters.test.mjs`

先加一条**当前会失败**的回归测试,证明乱序存在,再在 Task 4 改 `projectSortKey` 让它转绿(TDD)。

- [ ] **Step 1: 追加失败测试**

在 `src/adapters/shellScopeFilters.test.mjs` 末尾追加(import 顶部若无 `sortProjectsNewestFirst` 则补):

```js
test('sortProjectsNewestFirst: 年缺失项目不得顶到真实时间戳之前', () => {
  const LOWER = new Date('2020-01-01T00:00:00Z').getTime();
  const day = 86400000;
  const base = LOWER + 100 * day;
  const projects = [
    { id: 'legacy-abc', createdAt: '06-13', name: '老项目', results: [], taskCount: 1, completedCount: 0 },               // 年缺失
    { id: `proj-${base + 3 * day}`, createdAt: base + 3 * day, name: '项目3', results: [], taskCount: 1, completedCount: 0 }, // 真实最新
    { id: `proj-${base + 2 * day}`, createdAt: base + 2 * day, name: '项目2', results: [], taskCount: 1, completedCount: 0 }, // 真实较早
  ];
  const sorted = sortProjectsNewestFirst(projects).map((p) => p.id);
  // 两个真实戳项目必须排在年缺失项目之前,且新者在前
  assert.deepEqual(sorted, [`proj-${base + 3 * day}`, `proj-${base + 2 * day}`, 'legacy-abc']);
});
```

- [ ] **Step 2: 跑测试确认失败(复现乱序)**

Run: `node --experimental-strip-types --test src/adapters/shellScopeFilters.test.mjs`
Expected: FAIL —— 实际顺序里 `legacy-abc` 被 `parseMonthDay` 贴当前年顶到最前。

---

## Task 4: 重写 `projectSortKey` 为数字 + precise tier,删启发式

**Files:**
- Modify: `src/adapters/shellScopeFilters.ts:1-119`

读边界(Task 5/6)回填后,`ScopeProject.createdAt` 已是规范数字、并带 `createdAtPrecise`。排序据此分层。删掉 `timestampLowerBound`/`toFiniteTimestamp`/`extractTimestampFromText`/`parseMonthDay`/`startOfDay`(已搬进 `createdAtMs.ts`),保留 `parseProjectSequence`(排序内部 tiebreak 仍需,从 name/id 取"项目N"序号)。

- [ ] **Step 1: 改 `ScopeProject` 接口(`shellScopeFilters.ts:7-21`)**

把
```ts
  createdAt?: string | number;
  sortAt?: number;
  createdAtMs?: number;
  updatedAt?: number;
```
改为
```ts
  createdAt?: number;
  createdAtPrecise?: boolean;
  updatedAt?: number;
```

- [ ] **Step 2: 删启发式块 + 重写 sortKey/sort(`shellScopeFilters.ts:52-119`)**

把 `timestampLowerBound` 到 `sortProjectsNewestFirst` 结尾整段替换为:

```ts
const parseProjectSequence = (value: unknown): number => {
  const match = String(value || '').match(/项目\s*(\d+)/);
  const parsed = Number(match?.[1] || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const projectSortKey = (project: ScopeProject) => ({
  tier: project.createdAtPrecise ? 1 : 0,
  createdAt: Number(project.createdAt) || 0,
  sequence: parseProjectSequence(project.name) || parseProjectSequence(project.id),
});

export const sortProjectsNewestFirst = <TProject extends ScopeProject>(projects: TProject[]): TProject[] => [...projects]
  .map((project, index) => ({ project, index, key: projectSortKey(project) }))
  .sort((left, right) => (
    right.key.tier - left.key.tier
    || right.key.createdAt - left.key.createdAt
    || right.key.sequence - left.key.sequence
    || left.index - right.index
  ))
  .map((item) => item.project);
```

- [ ] **Step 3: 跑 Task 3 回归测试确认转绿**

Run: `node --experimental-strip-types --test src/adapters/shellScopeFilters.test.mjs`
Expected: PASS(含新回归测试 + 原有用例)。
注:测试里 `createdAt` 是真实戳但未设 `createdAtPrecise` 的两项,tier 都为 0,靠 `createdAt` 数字比较仍正确;`legacy-abc` 的 `createdAt:'06-13'` → `Number()` = NaN → 0,排最后。✔ 行为符合断言。

- [ ] **Step 4: 本地提交**

```bash
git add src/adapters/shellScopeFilters.ts src/adapters/shellScopeFilters.test.mjs
git commit -m "fix: collapse projectSortKey to numeric+tier, kill year-less float-to-top bug"
```

---

## Task 5: adapter 类型 string→number + 读边界回填

**Files:**
- Modify: `src/adapters/shellDataAdapter.ts`

- [ ] **Step 1: 改类型声明**

`ShellGeneratedResult.createdAt`(L19)`string → number`;`ShellProjectData.createdAt`(L39)`string → number`、`completedAt?: string → number`,并新增 `createdAtPrecise?: boolean`。

- [ ] **Step 2: 替换 `toDateLabel` 为 coerce(读边界)**

`toDateLabel`(L193)整段删除,顶部 `import { coerceCreatedAtMs } from '../utils/createdAtMs.ts';`、`import { formatMonthDay } from '../utils/timeFormat.ts';`

`projectFromItems`(L741)内 `const createdAt = toDateLabel(createdAtValue);` 改为:
```ts
  const { ms: createdAt, precise: createdAtPrecise } = coerceCreatedAtMs(createdAtValue, { id });
```
`resultFromItem` 第 4 参 `createdAt: string` 改 `createdAt: number`;其 ID fallback(L697)`${module}-${fallbackTitle}-${createdAt}` 保持(数字插值进字符串 ID 无害,且唯一性不变)。

`projectFromItems` 返回对象(L756)补 `createdAtPrecise`;`completedAt: completedCount > 0 ? createdAt : undefined` 保持(现为数字)。

- [ ] **Step 3: 修其余 toDateLabel/字符串戳调用点**

`tsc -b` 报错驱动:L939、L1310、L1326、L1352-1353、L1374、L1464、L1491、L1568 等所有 `toDateLabel(...)` → 改为 `coerceCreatedAtMs(...).ms`;凡 `createdAt: cleanProject?.createdAt || ...` 等透传保持(类型已 number)。L1306/L1389 `Number(a.createdAt||0)` 保持(已是数字比较)。

- [ ] **Step 4: 跑 tsc 揪漏 + adapter 测试**

Run: `npx tsc -b 2>&1 | head -40`
Expected: 把所有遗漏点报出 → 逐个改成数字;直到 0 error。
Run: `node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs`
Expected: 字符串断言失败的用例在 Task 8 统一修;此步先确保类型通。

- [ ] **Step 5: 本地提交**

```bash
git add src/adapters/shellDataAdapter.ts
git commit -m "refactor: shellDataAdapter createdAt/completedAt to numeric via read-boundary coerce"
```

---

## Task 6: persistence 类型 string→number + 读取处过 normalizer

**Files:**
- Modify: `src/adapters/shellPersistence.ts`

- [ ] **Step 1: 改类型**

`ShellResult.createdAt`(L29)、`ShellProject.createdAt`(L50)`string → number`;`ShellProject.completedAt?` 若为 string 同改 number;按需加 `createdAtPrecise?: boolean`。

- [ ] **Step 2: 读取处回填**

顶部 `import { coerceCreatedAtMs } from '../utils/createdAtMs.ts';`。在从持久化/后端读出 project/result 的构造处,把 `createdAt` 经 `coerceCreatedAtMs(raw, { id, updatedAt }).ms` 赋值、`createdAtPrecise` 赋 `.precise`。L422 写入处 `createdAt: now`(`now` 已是 `Date.now()` 数字)保持。

- [ ] **Step 3: tsc 揪漏**

Run: `npx tsc -b 2>&1 | head -40`
Expected: 报出 persistence 内剩余字符串点 → 改数字,直到 0 error。

- [ ] **Step 4: 本地提交**

```bash
git add src/adapters/shellPersistence.ts
git commit -m "refactor: shellPersistence createdAt to numeric via read-boundary coerce"
```

---

## Task 7: ShellMigratedApp 类型 string→number + 产生点改 Date.now() + 展示

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/shell/components/ResultCard.tsx`

- [ ] **Step 1: 改壳层类型**

`GeneratedResult.createdAt`(L109)、`Project.createdAt`(L305)、`Project.completedAt`(L332 若 string)`string → number`,`Project` 加 `createdAtPrecise?: boolean`;其余接口内 `createdAt: string`(L919 options 等)同改。`storyboardImageVersions[].createdAt`(L134)已是 number,不动。

- [ ] **Step 2: 4 处产生点改数字**

L4084 `createdAt: immediateProject?.createdAt || new Date().toLocaleDateString(...).replace('/','-')` → `createdAt: immediateProject?.createdAt ?? Date.now()`;
L3826、L3541(`const createdAt = new Date(...).replace(...)`)→ `const createdAt = createdAtTs;`(L3541 已有 `createdAtTs` 数字)/ `Date.now()`(L3826);
L5936、L6471 `createdAt: new Date(...).replace('/','-')` → `createdAt: Date.now()`。
所有 `completedAt: ... newProject.createdAt`/`project.createdAt` 透传保持(类型已数字)。

- [ ] **Step 3: 展示点包 formatMonthDay**

`ProjectCard.tsx` 顶部 `import { formatMonthDay } from '../../utils/timeFormat.ts';`(按实际相对路径校正):
- L865 `{project.createdAt}` → `{formatMonthDay(project.createdAt)}`
- L897 `{project.createdAt}` → `{formatMonthDay(project.createdAt)}`
- L1028 `{textReportResult?.createdAt || project.completedAt || project.createdAt}` → `{formatMonthDay(textReportResult?.createdAt || project.completedAt || project.createdAt)}`

`ResultCard.tsx` 顶部同样 import:
- L105 `{result.createdAt}` → `{formatMonthDay(result.createdAt)}`

- [ ] **Step 4: tsc 全量揪漏**

Run: `npx tsc -b 2>&1 | head -60`
Expected: 把 ShellMigratedApp 内所有遗漏字符串赋值/比较报出 → 逐个改数字,直到 **0 error**。

- [ ] **Step 5: 本地提交**

```bash
git add src/ShellMigratedApp.tsx src/shell/components/ProjectCard.tsx src/shell/components/ResultCard.tsx
git commit -m "refactor: ShellMigratedApp createdAt numeric + display via formatMonthDay"
```

---

## Task 8: 合并重复 formatTime + 修旧测试 + 全量验证

**Files:**
- Modify: `src/shell/modules/Account/AccountManagement.tsx:66`
- Modify: `src/modules/Account/AccountManagement.tsx:103`
- Modify: `src/modules/OneClick/ReferencePresetManager.tsx:28`
- Modify: 旧测试中断言 createdAt 为字符串格式的用例

- [ ] **Step 1: 删 3 份本地 formatTime,import 共享**

各文件删除本地 `const formatTime = ...`,改顶部 `import { formatTime } from '<相对路径>/utils/timeFormat.ts';`。注意 `modules/Account` 版签名是 `(value: number)`、shell 版是 `(value?: number | null)` —— 共享版用后者(更宽松),调用点不受影响。

- [ ] **Step 2: tsc 确认**

Run: `npx tsc -b 2>&1 | head -20`
Expected: 0 error。

- [ ] **Step 3: 找并修断言 createdAt 字符串格式的旧测试**

Run: `grep -rn "createdAt" src --include="*.test.mjs" | grep -iE "'[0-9]{1,2}-[0-9]{1,2}'|月.*日|toDateLabel|createdAt:\s*'"`
对每个命中:把期望的 `'06-13'` 字符串改为对应数字戳,或把"断言 createdAt 等于某字符串"改为"经 formatMonthDay 后等于"。重点查 `shellDataAdapter.test.mjs`、`shellPersistence.test.mjs`、`stateReconciliationConsistency.test.mjs`、`shellProjectResults.test.mjs`。

- [ ] **Step 4: 全量测试 + lint**

Run: `find src -name "*.test.mjs" | xargs node --experimental-strip-types --test 2>&1 | grep -iE "tests |pass |fail "`
Expected: pass = tests, fail 0(总数 ≥ 638 + 新增约 11)。
Run: `find server -name "*.test.mjs" | xargs node --test 2>&1 | grep -iE "tests |pass |fail "`
Expected: 303 全绿(后端无改动)。
Run: `npm run lint`
Expected: exit 0(tsc 0 error + eslint 0 error)。

- [ ] **Step 5: 本地提交**

```bash
git add -A
git commit -m "refactor: dedupe formatTime + update tests for numeric createdAt"
```

---

## Task 9: 收尾——更新根因库 + 交接记录

**Files:**
- Modify: `CLAUDE.md`(本项目第2层,根因库 #2 旁注/新增条目)
- Modify: `docs/交接记录-2026-06-13.md`

- [ ] **Step 1: 根因库沉淀**

在项目 `CLAUDE.md` 第 3 节加一条:createdAt 展示字符串当数据存 → parseMonthDay 贴当前年顶到最前 → 已统一为数字毫秒戳 + 读边界单一 `coerceCreatedAtMs` + tier 分层;固化为探针回归测试。如何避免:**展示标签不得当排序数据;时间一律存数字毫秒戳,字符串只在渲染处由 formatMonthDay/formatTime 产出。**

- [ ] **Step 2: 更新交接记录**

把"下一步 #2 排序键/时间格式统一"标记为 ✅,记录新测试基线数。

- [ ] **Step 3: 本地提交**

```bash
git add CLAUDE.md docs/交接记录-2026-06-13.md
git commit -m "docs: record createdAt unification in root-cause library and handover"
```
