# ProjectCard React.memo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `ProjectCard` 包 `React.memo` 并消除唯一调用点的 5 个内联闭包,让大列表在父组件无关重渲时不再整列重渲。

**Architecture:** 把卡片 5 个回调的契约从 `(resultId, ...)` 改成 `(projectId, resultId, ...)`,卡片内部用自己的 `project.id` 调用;`ProjectListView` 改为透传父级**已 useCallback 稳定**的 handler、删掉内联闭包;`ProjectCard` 默认导出包 `React.memo`(默认浅比较)。行为完全等价,只是 projectId 从调用点闭包绑定改为卡片内部传参。

**Tech Stack:** TypeScript + React(Vite),Node `--test` + `--experimental-strip-types`,`npm run lint`(= `tsc -b && eslint .`)。

> **提交约定**:本项目业主"本地先做稳、不急 push"。下方 commit 步骤为**本地提交、不 push**。分支 `fix/chunk-error-boundary`,基线 `afa6471`。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/shell/components/ProjectCard.tsx` | 卡片组件:5 回调契约加 projectId、内部调用补 project.id、默认导出包 memo | 改 |
| `src/shell/components/ProjectListView.tsx` | 唯一调用点:删 5 个内联闭包,透传稳定 handler | 改 |
| `src/components/uiArchitecture.test.mjs` | grep 风格源码测试:锁定 memo + 透传写法 | 改(加断言)|

> 仅 1 个真调用点用共享 ProjectCard(`ProjectListView:348`)。`StoryboardWorkspace.tsx` 是同名本地组件,不动。

---

## Task 1: ProjectCard 改契约(5 回调加 projectId)+ 内部调用补 project.id

**Files:**
- Modify: `src/shell/components/ProjectCard.tsx`(Props 接口 L41-47;内部调用点多处)

- [ ] **Step 1: 改 Props 接口签名(L41-47)**

把
```ts
  onDeleteResult?: (resultId: string) => void;
```
（L41）以及
```ts
  onRegenerate?: (resultId: string, instruction?: string) => void;
```
（L43）
```ts
  onFission?: (resultId: string, mode: 'scene' | 'palette' | 'custom', instruction: string) => void;
  onEdit?: (resultId: string, instruction: string, files: File[]) => void;
  onRecover?: (resultId: string) => void;
```
（L45-47)

全部前置 `projectId: string`,改为:
```ts
  onDeleteResult?: (projectId: string, resultId: string) => void;
  onRegenerate?: (projectId: string, resultId: string, instruction?: string) => void;
  onFission?: (projectId: string, resultId: string, mode: 'scene' | 'palette' | 'custom', instruction: string) => void;
  onEdit?: (projectId: string, resultId: string, instruction: string, files: File[]) => void;
  onRecover?: (projectId: string, resultId: string) => void;
```

- [ ] **Step 2: 跑 tsc 让它列出所有卡片内旧调用点**

Run: `npx tsc -b 2>&1 | grep "ProjectCard.tsx" | head -40`
Expected: 报出卡片内所有仍按旧签名调用的点(`onFission`/`onEdit`/`onRegenerate`/`onRecover`/`onDeleteResult`),约 10+ 处(L530/543/556/701/1277/1289/1413/1565/1575/1803/1816/1925/2027 及 L1053 内层)。这就是要改的清单。

- [ ] **Step 3: 卡片内每个调用点补 `project.id` 作首参**

逐个把旧调用改成带 `project.id`。卡片内 `project`(props 解构)始终可得。完整对照:

```ts
// L530
onFission(project.id, fissionDialog.resultId, fissionDialog.mode, finalInstruction);
// L543
onEdit(project.id, editDialog.resultId, finalInstruction, usesMinimalRoleEditPrompt ? [] : editDialog.files);
// L556
onRegenerate(project.id, storyboardRevisionDialog.resultId, finalInstruction);
// L701
retryableResults.forEach((result) => onRegenerate(project.id, result.id));
// L1053 内层闭包(传给嵌套子组件的 onRecoverResult,绑 resultId)
onRecoverResult={(resultId) => onRecover?.(project.id, resultId)}
// L1277
onRecover?.(project.id, result.id);
// L1289 / L1413 / L1575 / L1816 / L1925
onRegenerate(project.id, result.id);
// L1565
onClick={() => onRecover?.(project.id, result.id)}
// L1803
onClick={() => onRecover(project.id, result.id)}
// L2027
onConfirm={() => { if (confirmDeleteResult) onDeleteResult?.(project.id, confirmDeleteResult); setConfirmDeleteResult(null); }}
```
注:`onRegenerate(project.id, result.id)` 出现在 L1289/1413/1575/1816/1925 多处,全部同款改。以 Step 2 的 tsc 报错清单为准,逐个改到 0 报错(不要凭记忆漏改)。

- [ ] **Step 4: 跑 tsc 确认卡片内 0 报错**

Run: `npx tsc -b 2>&1 | grep "ProjectCard.tsx"`
Expected: 空(卡片内全部调用点已对齐新签名)。
注:此时 `ProjectListView.tsx` 会因旧闭包签名不匹配而报错——Task 2 修。

---

## Task 2: ProjectListView 删内联闭包 + 透传稳定 handler

**Files:**
- Modify: `src/shell/components/ProjectListView.tsx:348-366`(调用点)

- [ ] **Step 1: 替换 5 个内联闭包为直接透传**

把调用点(`<ProjectCard ...>`)里这 5 行:
```tsx
                    onDeleteResult={(rid) => onDeleteResult(project.id, rid)}
```
```tsx
                    onRegenerate={(rid, instruction) => onRegenerateResult?.(project.id, rid, instruction)}
                    onFission={(rid, mode, instruction) => onFissionResult?.(project.id, rid, mode, instruction)}
                    onEdit={(rid, instruction, files) => onEditResult?.(project.id, rid, instruction, files)}
                    onRecover={(rid) => onRecoverResult?.(project.id, rid)}
```
改为直接透传父级稳定 handler:
```tsx
                    onDeleteResult={onDeleteResult}
                    onRegenerate={onRegenerateResult}
                    onFission={onFissionResult}
                    onEdit={onEditResult}
                    onRecover={onRecoverResult}
```

- [ ] **Step 2: 跑 tsc 确认全绿**

Run: `npx tsc -b 2>&1 | head -20`
Expected: 空(签名已对齐:卡片 `onDeleteResult?: (projectId, resultId)=>void` ⟷ 父级 `onDeleteResult: (projectId, resultId)=>void`;其余 4 个可选 ⟷ 可选,相容)。

---

## Task 3: ProjectCard 默认导出包 React.memo

**Files:**
- Modify: `src/shell/components/ProjectCard.tsx:2289`

- [ ] **Step 1: 包 memo**

把文件末尾
```ts
export default ProjectCard;
```
改为
```ts
export default React.memo(ProjectCard);
```
（`React` 已在文件顶部 import,无需新增。)

- [ ] **Step 2: 跑 tsc + eslint**

Run: `npm run lint 2>&1 | tail -3; echo "exit=$?"`
Expected: tsc 0 error;eslint 0 error(可有既有 warning);exit 0。

---

## Task 4: grep 风格回归测试(锁定 memo + 透传,防退回内联闭包)

**Files:**
- Modify: `src/components/uiArchitecture.test.mjs`

- [ ] **Step 1: 追加测试**

在 `src/components/uiArchitecture.test.mjs` 末尾追加(`read` 辅助函数文件内已有,沿用其相对路径风格):

```js
test('ProjectCard is memoized and ProjectListView passes stable handlers (no inline closures)', () => {
  const card = read('../shell/components/ProjectCard.tsx');
  const listView = read('../shell/components/ProjectListView.tsx');

  // 卡片已包 memo
  assert.match(card, /export default React\.memo\(ProjectCard\)/);
  // 调用点透传稳定 handler,不再有绑 project.id 的内联闭包
  assert.match(listView, /onDeleteResult=\{onDeleteResult\}/);
  assert.match(listView, /onRegenerate=\{onRegenerateResult\}/);
  assert.match(listView, /onFission=\{onFissionResult\}/);
  assert.match(listView, /onEdit=\{onEditResult\}/);
  assert.match(listView, /onRecover=\{onRecoverResult\}/);
  assert.doesNotMatch(listView, /onDeleteResult=\{\(rid\) =>/);
});
```

- [ ] **Step 2: 跑该测试文件确认通过**

Run: `node --experimental-strip-types --test src/components/uiArchitecture.test.mjs 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: pass = tests, fail 0。

---

## Task 5: 全量验证

**Files:** 无(只跑验证)

- [ ] **Step 1: 前端测试**

Run: `find src -name "*.test.mjs" | xargs node --experimental-strip-types --test 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: pass = tests(≥ 650 + 1 新增 = 651),fail 0。
若有旧测试断言旧闭包写法(`onDeleteResult={(rid)`)而失败 → 同步更新为新透传写法。

- [ ] **Step 2: 后端测试(应无影响)**

Run: `find server -name "*.test.mjs" | xargs node --test 2>&1 | grep -iE "ℹ (tests|pass|fail)"`
Expected: 303 全绿。

- [ ] **Step 3: lint + build**

Run: `npm run lint >/tmp/memo_lint.log 2>&1; echo "lint=$?"; npm run build >/tmp/memo_build.log 2>&1; echo "build=$?"; tail -2 /tmp/memo_build.log`
Expected: `lint=0`、`build=0`、build 末尾 `✓ built`。

- [ ] **Step 4: 本地提交**

```bash
git add src/shell/components/ProjectCard.tsx src/shell/components/ProjectListView.tsx src/components/uiArchitecture.test.mjs
git commit -m "perf: memoize ProjectCard, pass stable handlers (projectId in callback contract)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 收尾——交接记录 + 实机验证清单

**Files:**
- Modify: `docs/交接记录-2026-06-13.md`
- Create: 追加到现有验证清单或新增条目

- [ ] **Step 1: 更新交接记录**

把"下一步 #3 ProjectCard 加 memo"标记 ✅,记录:契约改 `(projectId, resultId,...)`、删 5 内联闭包、默认浅比较 memo;StoryboardWorkspace 是本地同名组件未动;新测试基线数。

- [ ] **Step 2: 追加实机验证条目**

在验证清单(`docs/验证清单-2026-06-13-createdAt统一.md` 或新建)加 ProjectCard 动作验证:删除结果 / 重新生成 / 裂变 / 编辑 / 恢复 五个动作各点一次,确认**作用到正确的项目**(projectId 传对);打字时卡片不再整列重渲(可选 React DevTools Profiler)。

- [ ] **Step 3: 本地提交**

```bash
git add docs/
git commit -m "docs: mark ProjectCard memo done in handover + add manual verify checklist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
