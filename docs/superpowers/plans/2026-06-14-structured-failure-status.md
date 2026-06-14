# 业务状态结构化判定 实现计划(根因库 #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"正则匹配报错文字判业务状态"改成"读结构化字段",分三段安全推进(消费端收敛 → 生产端结构化 → 迁移旧库后删正则),最终文本识别只剩唯一读边界。

**Architecture:** 同构复刻 createdAt 那轮的"文本识别塌缩到单一读边界"模式。本文件**详尽规定 2a(消费端收敛)**——它本身可独立交付、全绿、行为等价;**2b/2c 在 2a 落稳后各出独立计划**(同一轮内顺序推进),因为它们的精确改动依赖 2a 落地的共享 API 与 2b 揭示的生产路径,提前写步骤会变成臆测占位。

**Tech Stack:** TypeScript + React(Vite),前后端共享 `.mjs`(同 `taskResultReconcile.mjs`,后端 `import` 自 `../src/utils/`),Node `--test` + `--experimental-strip-types`,`npm run lint`(= `tsc -b && eslint .`)。

> **提交约定**:本地提交、不 push。分支 `fix/chunk-error-boundary`,基线 `3db968f`。

---

## 阶段总览(三段一轮)

| 段 | 目标 | 风险 | 本文件 |
|---|---|---|---|
| **2a** | 2 份 `isInvalidOneClickPlanText` 正则 + kie 重试分类正则,合并成前后端共享单一判据;结构化优先、正则退为兜底 | 低(纯收敛,行为等价) | ✅ 详尽规定 |
| 2b | 生产端(shellWorkflow/arkService/kieAi)失败路径在源头打 `errorCode`+`planningFailed`/`status:'error'` | 中 | 2a 落稳后出独立计划 |
| 2c | 读边界 normalizer 迁移历史纯文本数据 → 回填结构化;然后删共享判据里的正则兜底,文本识别只剩读边界 | 高(不可逆) | 2b 落稳后出独立计划 |

> 安全铁律(写进每段验收):2c 的读边界迁移 normalizer 必须先落且单测覆盖每条 legacy pattern,删正则在其后。

---

# 阶段 2a:消费端收敛成共享单一判据

## 文件结构(2a)

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/utils/planFailure.mjs` | 共享:`isPlanFailed`(结构化优先+正则兜底)、`getPlanContent`、`LEGACY_FAILURE_TEXT_PATTERNS` | 创建 |
| `src/utils/planFailure.test.mjs` | 上者单测 | 创建 |
| `src/utils/oneClickPlanValidation.ts` | 改为委托 planFailure.mjs,保留导出名 | 改 |
| `server/appStateMerge.mjs` | 改为 import planFailure.mjs,删本地 13 条正则拷贝 | 改 |
| `src/utils/errorClassification.mjs` | 共享:`isRecoverableError`(结构化优先+message 兜底) | 创建 |
| `src/utils/errorClassification.test.mjs` | 上者单测 | 创建 |
| `src/services/kieAiService.ts` | `KIE_RECOVERABLE_MESSAGE_PATTERN` 委托 errorClassification | 改 |

---

## Task 1: 共享 `planFailure.mjs`(结构化优先 + 正则兜底)

**Files:**
- Create: `src/utils/planFailure.mjs`
- Test: `src/utils/planFailure.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// src/utils/planFailure.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlanFailed, getPlanContent } from './planFailure.mjs';

test('结构化标志优先:planningFailed=true 即失败', () => {
  assert.equal(isPlanFailed({ planningFailed: true, schemeContent: '一切正常' }), true);
});

test('结构化:status=error 即失败', () => {
  assert.equal(isPlanFailed({ status: 'error' }), true);
});

test('结构化:有 errorCode 即失败', () => {
  assert.equal(isPlanFailed({ errorCode: 'planning_failed' }), true);
});

test('干净成功方案:不失败', () => {
  assert.equal(isPlanFailed({ schemeContent: '黑色丝绒礼盒,突出质感' }), false);
});

test('过渡期兜底:仅文本含"策划失败"也判失败', () => {
  assert.equal(isPlanFailed({ schemeContent: 'SKU方案策划失败' }), true);
});

test('过渡期兜底:fetch failed 文本', () => {
  assert.equal(isPlanFailed({ error: 'fetch failed' }), true);
});

test('getPlanContent 取首个非空内容字段并 trim', () => {
  assert.equal(getPlanContent({ schemeContent: '  abc  ' }), 'abc');
  assert.equal(getPlanContent({ title: 'fallback' }), 'fallback');
  assert.equal(getPlanContent({}), '');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-strip-types --test src/utils/planFailure.test.mjs`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写实现**

```js
// src/utils/planFailure.mjs
const trim = (value) => String(value || '').trim();

// 方案内容:取首个非空内容字段(前后端统一,等价旧 getOneClickPlanContent)
export const getPlanContent = (plan = {}) => trim(
  plan?.schemeContent
  || plan?.textLayout
  || plan?.sceneDescription
  || plan?.styleDirection
  || plan?.colorPalette
  || plan?.composition
  || plan?.originalContent
  || plan?.editedContent
  || plan?.prompt
  || plan?.error
  || plan?.title,
);

// 过渡期文本兜底(2c 后仅被读边界迁移 normalizer 引用)
export const LEGACY_FAILURE_TEXT_PATTERNS = [
  /fetch failed/i,
  /共\s*\d+\s*张参考图，其中\s*\d+\s*张策划失败/,
  /Failed to get (?:the )?file information/i,
  /I cannot fulfill this request/i,
  /Unauthorized\s*[–-]\s*Authentication failed/i,
  /Authentication failed\.?\s*Please check/i,
  /Cannot read properties of undefined/i,
  /providerTaskId/i,
  /网络连接失败，请检查网络后重试/,
  /AI\s*分析请求失败/,
  /SKU方案策划失败/,
  /策划失败/,
  /任务状态同步失败/,
];

export const isLegacyFailureText = (value) => {
  const content = trim(value).replace(/\s+/g, ' ');
  if (!content) return false;
  return LEGACY_FAILURE_TEXT_PATTERNS.some((pattern) => pattern.test(content));
};

// 单一判据:结构化字段优先,正则仅过渡期兜底(2c 删除最后一行)
export const isPlanFailed = (plan = {}) => {
  if (plan?.planningFailed === true) return true;
  if (plan?.status === 'error') return true;
  if (trim(plan?.errorCode)) return true;
  return isLegacyFailureText(getPlanContent(plan));
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --experimental-strip-types --test src/utils/planFailure.test.mjs`
Expected: PASS(7 tests)

- [ ] **Step 5: 本地提交**

```bash
git add src/utils/planFailure.mjs src/utils/planFailure.test.mjs
git commit -m "feat: shared planFailure judge (structured-first, regex fallback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `oneClickPlanValidation.ts` 委托 planFailure(保留导出名)

**Files:**
- Modify: `src/utils/oneClickPlanValidation.ts`

前端有 6 个调用点用 `isInvalidOneClickPlanLike`/`getOneClickPlanContent`,保留导出名即不必动调用点。

- [ ] **Step 1: 改为委托**

把 `INVALID_ONE_CLICK_PLAN_PATTERNS`、`getOneClickPlanContent`、`isInvalidOneClickPlanText`、`isInvalidOneClickPlanLike` 整体替换为委托(保留 `OneClickPlanLike` 类型与全部导出名):

```ts
import { getPlanContent, isLegacyFailureText, isPlanFailed } from './planFailure.mjs';

type OneClickPlanLike = {
  title?: unknown;
  schemeContent?: unknown;
  textLayout?: unknown;
  sceneDescription?: unknown;
  styleDirection?: unknown;
  colorPalette?: unknown;
  composition?: unknown;
  originalContent?: unknown;
  editedContent?: unknown;
  prompt?: unknown;
  error?: unknown;
  planningFailed?: unknown;
  status?: unknown;
  errorCode?: unknown;
};

export const getOneClickPlanContent = (plan: OneClickPlanLike = {}) => getPlanContent(plan);

export const isInvalidOneClickPlanText = (value: unknown) => isLegacyFailureText(value);

export const isInvalidOneClickPlanLike = (plan: OneClickPlanLike = {}) => isPlanFailed(plan);
```

> 注:`isInvalidOneClickPlanLike` 现在走结构化优先的 `isPlanFailed`(原本就 `isInvalidOneClickPlanText(getOneClickPlanContent(plan))` 纯文本)。行为变化:结构化失败的 plan 现在也会被识别为失败——这是**正向修复**(原本漏判结构化失败),需在 Step 3 测试确认无意外回归。`isInvalidOneClickPlanText(value)` 对裸文本仍是纯文本判定,语义不变。

- [ ] **Step 2: tsc**

Run: `npx tsc -b 2>&1 | grep -E "oneClickPlanValidation|ProjectCard|shellDataAdapter|shellPersistence" | head`
Expected: 空(导出名不变,调用点类型相容)。

- [ ] **Step 3: 跑受影响的前端测试**

Run: `node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs src/adapters/shellPersistence.test.mjs 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: 全绿。若某测试因"结构化失败现在被正确识别"而断言变化 → 确认是正向修复后更新断言。

- [ ] **Step 4: 本地提交**

```bash
git add src/utils/oneClickPlanValidation.ts
git commit -m "refactor: oneClickPlanValidation delegates to shared planFailure

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `appStateMerge.mjs` 委托 planFailure,删本地正则拷贝

**Files:**
- Modify: `server/appStateMerge.mjs:7-39`

- [ ] **Step 1: 顶部加 import**

`appStateMerge.mjs` 第 1 行已有 `import { compactKey, ... } from '../src/utils/taskResultReconcile.mjs';`,其后加:
```js
import { getPlanContent, isPlanFailed } from '../src/utils/planFailure.mjs';
```

- [ ] **Step 2: 删本地 `getOneClickPlanContent`/`isInvalidOneClickPlanText`/`isInvalidOneClickPlanLike`(L7-39),改为复用**

把这三个本地定义(含 13 条正则)整段替换为:
```js
const getOneClickPlanContent = (item = {}) => getPlanContent(item);
const isInvalidOneClickPlanLike = (item = {}) => isPlanFailed(item);
```
（`isInvalidOneClickPlanText` 后端无独立调用点——若 grep 确认无引用则不再保留;若有则加 `const isInvalidOneClickPlanText = (value) => isLegacyFailureText(value);` 并 import 之。)

- [ ] **Step 3: grep 确认后端无遗漏引用**

Run: `grep -n "isInvalidOneClickPlanText" server/appStateMerge.mjs`
Expected: 空,或仅剩委托定义行(据此决定 Step 2 是否保留该函数)。

- [ ] **Step 4: 跑后端测试**

Run: `node --test server/appStateMerge.test.mjs 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: 全绿。`normalizeInvalidPlanAsFailedPlanningCard` 依赖 `isInvalidOneClickPlanLike`,现走结构化优先,行为对"纯文本失败"等价、对"结构化失败"更准。

- [ ] **Step 5: 本地提交**

```bash
git add server/appStateMerge.mjs
git commit -m "refactor: appStateMerge delegates plan-failure to shared judge, drop regex copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 共享 `errorClassification.mjs`(可恢复判定,结构化优先)

**Files:**
- Create: `src/utils/errorClassification.mjs`
- Test: `src/utils/errorClassification.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// src/utils/errorClassification.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecoverableError } from './errorClassification.mjs';

test('providerStatus=recoverable_pending_result → 可恢复', () => {
  assert.equal(isRecoverableError({ providerStatus: 'recoverable_pending_result' }), true);
});

test('不可恢复错误码 → 不可恢复(即使 message 像网络错)', () => {
  assert.equal(isRecoverableError({ errorCode: 'provider_credit_insufficient', message: 'fetch failed' }), false);
});

test('可恢复错误码 → 可恢复', () => {
  assert.equal(isRecoverableError({ errorCode: 'provider_timeout' }), true);
  assert.equal(isRecoverableError({ errorCode: 'provider_network_error' }), true);
});

test('无错误码时退到 message 正则(过渡期)', () => {
  assert.equal(isRecoverableError({ message: '网络连接失败' }), true);
  assert.equal(isRecoverableError({ message: '余额不足' }), false);
});

test('空输入 → 不可恢复', () => {
  assert.equal(isRecoverableError({}), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --experimental-strip-types --test src/utils/errorClassification.test.mjs`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写实现**

```js
// src/utils/errorClassification.mjs
const trim = (value) => String(value || '').trim();

export const NON_RECOVERABLE_ERROR_CODES = new Set([
  'provider_credit_insufficient',
  'provider_request_limit',
  'provider_auth_invalid',
  'provider_bad_request',
  'task_not_found',
]);

export const RECOVERABLE_ERROR_CODES = new Set([
  'provider_timeout',
  'provider_network_error',
  'provider_internal_error',
  'provider_rate_limited',
]);

// 过渡期 message 兜底(2c 后仅被读边界引用)
export const RECOVERABLE_MESSAGE_PATTERN = /fetch failed|network|timeout|超时|服务异常|网络异常|网络连接失败/i;

// 单一判据:结构化(providerStatus / errorCode)优先,message 仅过渡期兜底
export const isRecoverableError = ({ errorCode, providerStatus, message } = {}) => {
  if (trim(providerStatus) === 'recoverable_pending_result') return true;
  const code = trim(errorCode);
  if (code && NON_RECOVERABLE_ERROR_CODES.has(code)) return false;
  if (code && RECOVERABLE_ERROR_CODES.has(code)) return true;
  return RECOVERABLE_MESSAGE_PATTERN.test(trim(message));
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --experimental-strip-types --test src/utils/errorClassification.test.mjs`
Expected: PASS(5 tests)

- [ ] **Step 5: 本地提交**

```bash
git add src/utils/errorClassification.mjs src/utils/errorClassification.test.mjs
git commit -m "feat: shared errorClassification judge (structured-first recoverable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `kieAiService` 委托 errorClassification

**Files:**
- Modify: `src/services/kieAiService.ts:44,50-55`

- [ ] **Step 1: 删本地 `KIE_RECOVERABLE_MESSAGE_PATTERN`,改委托**

顶部加 `import { isRecoverableError } from '../utils/errorClassification.mjs';`。删 L44 的 `const KIE_RECOVERABLE_MESSAGE_PATTERN = ...`。`isRecoverableKieTaskResult` 末行
```ts
  return KIE_RECOVERABLE_MESSAGE_PATTERN.test(String(errorMessage || ''));
```
改为
```ts
  return isRecoverableError({ errorCode, message: errorMessage });
```
> 保留前面 `KIE_NON_RECOVERABLE_ERROR_CODES`/`KIE_AUTO_RECOVER_ERROR_CODES` 的早返回(kie 专属语义),仅把"message 正则兜底"那行委托出去。

- [ ] **Step 2: tsc + 受影响测试**

Run: `npx tsc -b 2>&1 | grep kieAiService | head`
Expected: 空。
Run: `find src/services -name "*.test.mjs" | xargs node --experimental-strip-types --test 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: 全绿(若无 kie 测试文件则跳过)。

- [ ] **Step 3: 本地提交**

```bash
git add src/services/kieAiService.ts
git commit -m "refactor: kieAiService recoverable check delegates to shared judge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 2a 全量验证 + 收尾

**Files:** 无(验证)+ `docs/交接记录-2026-06-13.md`

- [ ] **Step 1: 全量测试**

Run: `find src -name "*.test.mjs" | xargs node --experimental-strip-types --test 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: pass = tests(≥ 651 + 12 新增),fail 0。
Run: `find server -name "*.test.mjs" | xargs node --test 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: 303 全绿。

- [ ] **Step 2: lint + build**

Run: `npm run lint >/tmp/2a_lint.log 2>&1; echo "lint=$?"; npm run build >/tmp/2a_build.log 2>&1; echo "build=$?"; tail -2 /tmp/2a_build.log`
Expected: `lint=0`、`build=0`、`✓ built`。

- [ ] **Step 3: grep 确认正则拷贝已收敛**

Run: `grep -rn "I cannot fulfill this request" src server --include="*.ts" --include="*.mjs" | grep -v test`
Expected: 只剩 `src/utils/planFailure.mjs` 一处(原 oneClickPlanValidation + appStateMerge 两份已消除)。

- [ ] **Step 4: 更新交接记录 + 提交**

在交接记录"根因库 #2"进度处记:2a 完成——`isInvalidOneClickPlanText` 两份合并成共享 `planFailure.mjs`(结构化优先);kie 重试分类合并 `errorClassification.mjs`;正则退为过渡期兜底;待 2b 生产端结构化、2c 迁移删正则。基线测试数更新。
```bash
git add docs/交接记录-2026-06-13.md
git commit -m "docs: record #2 stage 2a (consumer consolidation) done

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# 阶段 2b / 2c(2a 落稳后各出独立计划,同一轮内推进)

**2b 生产端结构化** — 完成判据:`shellWorkflow.ts` 的 `throw new Error('...策划失败')`(L449/480/501/528/552/964/1664)带结构化 `code`;catch→失败 plan 构造器(`shellPlanningFailure.ts`)落 `errorCode`/`planningFailed`/`status:'error'`;arkService/kieAi 失败产出附 `errorCode`。新增测试:失败产出对象带结构化字段、不依赖文本。届时按当时 `planFailure.mjs` 的实际 API + grep 出的全部 throw 站点出详尽计划。

**2c 迁移 + 删正则** — 完成判据:`shellDataAdapter`/`shellPersistence` 读边界加唯一 `migrateLegacyPlanFailure`(命中 `LEGACY_FAILURE_TEXT_PATTERNS` → 回填 `planningFailed`/`status:'error'`/`errorCode:'legacy_text'`);删 `planFailure.mjs`/`errorClassification.mjs` 的过渡期兜底行;`LEGACY_FAILURE_TEXT_PATTERNS`/`RECOVERABLE_MESSAGE_PATTERN` 仅被读边界引用。新增:每条 legacy pattern 的迁移单测 + 热路径无正则 grep 回归。**安全铁律:迁移 normalizer 先落且测试覆盖每条 pattern,删兜底在其后。**
