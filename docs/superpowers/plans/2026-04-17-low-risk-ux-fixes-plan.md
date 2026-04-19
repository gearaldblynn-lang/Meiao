# Low-Risk UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce high-friction interaction issues without changing the overall shell architecture.

**Architecture:** Keep the current module structure intact and make the smallest viable changes in three places: top-level workspace scroll constraints, one-click detail failure feedback, and translation workbench feedback. Verification relies on existing source-based architecture tests plus targeted behavior checks.

**Tech Stack:** React, TypeScript, Node test runner, source-based UI architecture tests

---

### Task 1: Add failing regression tests for low-risk UX rules

**Files:**
- Modify: `components/uiArchitecture.test.mjs`

- [ ] Add source assertions for:
  - `App.tsx` must not include `select-none` on the workspace shell
  - `DetailPageSubModule.tsx` must not include `alert(`
  - `DetailPageSubModule.tsx` must surface `addToast(`
  - `FileProcessor.tsx` must use action-guiding export failure copy

- [ ] Run:

```bash
node --test components/uiArchitecture.test.mjs
```

Expected: failing assertions for current shell class names / detail alerts / export copy.

### Task 2: Remove top-level selection lock and relax shell scroll ownership

**Files:**
- Modify: `App.tsx`

- [ ] Remove the global `select-none` class from the main workspace container.
- [ ] Relax the top-level main container from hard `overflow-hidden` so modules can own scrolling more safely.

### Task 3: Replace one-click detail alerts with in-context toasts

**Files:**
- Modify: `modules/OneClick/DetailPageSubModule.tsx`

- [ ] Convert alert-based failures to `addToast(...)`.
- [ ] Rewrite messages to include next-step guidance instead of raw failure only.
- [ ] Keep existing task status updates and logging behavior intact.

### Task 4: Improve translation export failure guidance

**Files:**
- Modify: `components/FileProcessor.tsx`

- [ ] Rewrite export/download failure strings so they explain what happened and what the user can do next.

### Task 5: Verify targeted regressions

**Files:**
- Modify: none

- [ ] Run:

```bash
node --test components/uiArchitecture.test.mjs
```

Expected: PASS
