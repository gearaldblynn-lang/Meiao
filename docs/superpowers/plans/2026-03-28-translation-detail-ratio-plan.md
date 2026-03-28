# Translation Detail Ratio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix detail translation and remove-text ratio semantics so generation uses model-supported auto ratio without prompt ratio constraints, while export sizing remains user-controlled.

**Architecture:** Keep main translation unchanged, narrow changes to prompt assembly and export sizing for `detail` and `remove_text`, and prove behavior with focused regression tests.

**Tech Stack:** TypeScript frontend services, translation utility module, Node test runner

---

### Task 1: Add failing tests for detail/remove-text prompt behavior

**Files:**
- Modify: `modules/Translation/translationProcessingUtils.test.mjs`
- Modify: `services/kieAiService.ts`

- [ ] **Step 1: Write the failing test**

```js
test('detail mode prompt does not append source ratio constraint text', () => {
  // assert prompt excludes ratio sentence
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/Translation/translationProcessingUtils.test.mjs`
Expected: FAIL because detail/remove_text still include ratio constraint wording

- [ ] **Step 3: Write minimal implementation**

```ts
// only main mode can include source ratio prompt hints
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/Translation/translationProcessingUtils.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/Translation/translationProcessingUtils.test.mjs services/kieAiService.ts
git commit -m "fix: remove detail translation ratio prompt constraints"
```

### Task 2: Lock export sizing semantics for detail and remove-text

**Files:**
- Modify: `modules/Translation/translationProcessingUtils.mjs`
- Modify: `modules/Translation/translationProcessingUtils.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('remove text custom export uses configured width and proportional height', () => {
  // assert height follows source ratio
});

test('remove text original export matches source dimensions', () => {
  // assert width/height equal source
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/Translation/translationProcessingUtils.test.mjs`
Expected: FAIL until semantics are explicit

- [ ] **Step 3: Write minimal implementation**

```js
// detail and remove_text:
// custom => width fixed, height proportional
// original => source width/height
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/Translation/translationProcessingUtils.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/Translation/translationProcessingUtils.mjs modules/Translation/translationProcessingUtils.test.mjs
git commit -m "fix: align detail translation export sizing"
```

### Task 3: Verify no regression for main mode and build

**Files:**
- Modify: none required unless verification finds issues

- [ ] **Step 1: Run targeted tests**

Run: `node --test modules/Translation/translationProcessingUtils.test.mjs`
Expected: PASS

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit if needed**

```bash
git add <only if changed>
git commit -m "test: cover translation ratio semantics"
```
