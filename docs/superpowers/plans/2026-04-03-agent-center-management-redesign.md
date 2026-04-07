# Agent Center Management Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the agent-center management UI into a Flybook-style list/detail/wizard experience with clearer flow, safer actions, and readable validation output.

**Architecture:** Keep the existing backend API and top-level `AgentCenterModule` entry, but split management UI into focused presentational/state components. Replace the current stacked single-page admin panel with explicit page-state navigation for list, detail, and wizard flows.

**Tech Stack:** React 19, TypeScript, existing internal API client, node:test static architecture tests, Vite build

---

### Task 1: Lock the new management IA with tests

**Files:**
- Modify: `components/uiArchitecture.test.mjs`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add expectations for list/detail/wizard management structure**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Split agent center management UI into focused components

**Files:**
- Create: `modules/AgentCenter/AgentCenterManager.tsx`
- Create: `modules/AgentCenter/AgentListView.tsx`
- Create: `modules/AgentCenter/AgentDetailView.tsx`
- Create: `modules/AgentCenter/AgentWizardView.tsx`
- Create: `modules/AgentCenter/KnowledgeBaseListView.tsx`
- Create: `modules/AgentCenter/KnowledgeBaseEditorView.tsx`
- Modify: `modules/AgentCenter/AgentCenterModule.tsx`

- [ ] **Step 1: Create minimal component shells and route state**
- [ ] **Step 2: Render manager mode through explicit page states**
- [ ] **Step 3: Keep staff chat mode isolated from manager flow**
- [ ] **Step 4: Verify architecture test passes**

### Task 3: Implement the Flybook-style agent list and detail flow

**Files:**
- Modify: `modules/AgentCenter/AgentCenterManager.tsx`
- Modify: `modules/AgentCenter/AgentListView.tsx`
- Modify: `modules/AgentCenter/AgentDetailView.tsx`

- [ ] **Step 1: Add list filters, row layout, and entry into detail**
- [ ] **Step 2: Add detail header and nested tabs for config/knowledge/test/version/stats**
- [ ] **Step 3: Preserve selected agent context through page switches**
- [ ] **Step 4: Run tests and smoke-check TypeScript**

### Task 4: Implement agent creation/edit wizard

**Files:**
- Modify: `modules/AgentCenter/AgentWizardView.tsx`
- Modify: `modules/AgentCenter/AgentCenterManager.tsx`

- [ ] **Step 1: Add 5-step wizard state and validation**
- [ ] **Step 2: Wire create flow to `createAgent`**
- [ ] **Step 3: Wire edit-draft flow to `updateAgent` and `updateAgentVersion`**
- [ ] **Step 4: Ensure cancel/back/finish return to expected page**

### Task 5: Separate knowledge-base maintenance from binding flow

**Files:**
- Modify: `modules/AgentCenter/KnowledgeBaseListView.tsx`
- Modify: `modules/AgentCenter/KnowledgeBaseEditorView.tsx`
- Modify: `modules/AgentCenter/AgentDetailView.tsx`

- [ ] **Step 1: Build standalone knowledge-base list/editor flow**
- [ ] **Step 2: Keep agent detail knowledge tab for binding-only UX**
- [ ] **Step 3: Verify create/edit/document delete actions still work**

### Task 6: Replace raw validation JSON with readable result cards

**Files:**
- Modify: `modules/AgentCenter/AgentDetailView.tsx`

- [ ] **Step 1: Add readable validation summary mapping**
- [ ] **Step 2: Render validation cards for pass/model/retrieval/docs/tokens/cost/latency**
- [ ] **Step 3: Keep raw output hidden from normal management view**

### Task 7: Harden action rules and button states

**Files:**
- Modify: `modules/AgentCenter/AgentDetailView.tsx`
- Modify: `modules/AgentCenter/AgentCenterManager.tsx`

- [ ] **Step 1: Disable invalid publish/rollback/archive/edit paths**
- [ ] **Step 2: Add clear status badges and empty states**
- [ ] **Step 3: Ensure published versions are read-only and draft flow is explicit**

### Task 8: Verification

**Files:**
- Test: `components/uiArchitecture.test.mjs`
- Test: `modules/AgentCenter/agentCenterUtils.test.mjs`
- Test: `server/agentCenterSource.test.mjs`

- [ ] **Step 1: Run `node --test components/uiArchitecture.test.mjs modules/AgentCenter/agentCenterUtils.test.mjs server/agentCenterSource.test.mjs`**
- [ ] **Step 2: Run `npm run lint`**
- [ ] **Step 3: Run `npm run build`**
