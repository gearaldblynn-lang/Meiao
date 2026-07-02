# Smart Factory Dify IA Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Smart Factory information architecture so Workspace, Knowledge, Tools, and Models are separate Dify-style surfaces, with Knowledge Base creation/editing moved out of the Agent editor.

**Architecture:** `SmartFactoryPanel.tsx` remains the stateful orchestrator, while the independent Knowledge Base product surface moves into `SmartFactoryKnowledgeManager.tsx`. The Agent editor only binds existing knowledge bases and links to the Knowledge manager.

**Tech Stack:** React, TypeScript, existing internal Smart Factory APIs, Dify source-mapped UI patterns.

---

## Acceptance Criteria

- [ ] Smart Factory has a top product navigation: `工作室 / 知识库 / 工具 / 模型`.
- [ ] `工作室` manages applications only.
- [ ] `知识库` is an independent page with list/search/create/import actions.
- [ ] Knowledge Base detail is an independent page with documents, upload/train, hit testing, settings, and API panels.
- [ ] Agent editor Knowledge section only binds existing knowledge bases and links to Knowledge management.
- [ ] UI source tests assert Dify dataset source paths and forbid the old in-agent knowledge creation wording.
- [ ] Browser screenshots cover Knowledge list/detail and Agent editor binding-only state.

## Dify Source References

- `web/app/(commonLayout)/datasets/page.tsx`
- `web/app/components/datasets/list`
- `web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/layout-main.tsx`
- `web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/documents/page.tsx`
- `web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/hitTesting/page.tsx`
- `web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/settings/page.tsx`
- `web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/api/page.tsx`

## Tasks

### Task 1: Add Knowledge Manager Component

**Files:**
- Create: `src/modules/AgentCenter/SmartFactoryKnowledgeManager.tsx`
- Modify: `src/modules/AgentCenter/difyAppStudioSourceMap.ts`

- [ ] Create a Dify-style knowledge manager component with `list` and `detail` modes.
- [ ] Include list cards, create/import actions, document management, upload/train, retrieval test, settings, and API panes.
- [ ] Use existing Smart Factory knowledge APIs passed from `SmartFactoryPanel`.

### Task 2: Rewire Smart Factory IA

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`

- [ ] Add top product nav: `工作室 / 知识库 / 工具 / 模型`.
- [ ] Route `知识库` to `SmartFactoryKnowledgeManager`.
- [ ] Replace Agent editor Knowledge section with binding-only UI plus “管理知识库” jump.
- [ ] Keep Tools and Models as separate product pages using existing form content, not inside Agent Knowledge section.

### Task 3: Tests and Verification

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`
- Create: `src/modules/AgentCenter/SmartFactoryKnowledgeManager.test.mjs`

- [ ] Assert Dify dataset source paths.
- [ ] Assert Knowledge manager has list/detail/documents/hit testing/settings/API.
- [ ] Assert Agent editor no longer contains in-section `创建知识库` or `上传并训练`.
- [ ] Run source tests, smart factory server tests, build, and browser screenshots.
