# Smart Factory Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Smart Factory from a dense all-in-one configuration page into a Dify-inspired, Meiao-styled two-level product UI without removing existing model, knowledge, tool, publishing, chat, or log features.

**Architecture:** Keep the current Smart Factory APIs and runtime state. Replace the front-end interaction structure inside `SmartFactoryPanel.tsx` with an application gallery home page and a focused agent studio page. The studio exposes one functional area at a time through navigation, with chat/debug as the primary work surface and configuration moved into scoped tabs.

**Tech Stack:** React/TypeScript, existing shell CSS variables, lucide-react icons, current Smart Factory API wrappers in `src/services/internalApi.ts`, Node source tests, Vite build, in-app browser screenshot verification.

---

## Acceptance Standards

- Smart Factory opens to a workspace home, not directly to a pile of forms.
- Home includes Dify-like category filters, search, create/import actions, and repeated agent cards.
- Clicking an agent enters an agent studio with a left-side studio navigation and one active panel at a time.
- Existing features remain reachable: chat, agent config/publish, model provider config, knowledge upload/retrieval, tool config/test, run logs.
- Visual style follows Meiao shell: restrained neutral surfaces, 8px-ish cards, clear spacing, compact controls, no decorative hero, no nested-card clutter.
- Automated tests and build pass.
- Browser verification captures screenshots of the home and studio pages.

## Task 1: Source Guard Test

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`

- [ ] Add assertions for `工作室首页`, `创建应用`, `应用卡片`, `进入工作室`, `返回应用列表`, `智能体工作室`, `编排配置`, `发布管理`, `全部类型`, and `搜索智能体`.
- [ ] Run `node --experimental-strip-types --test src/modules/AgentCenter/SmartFactoryPanel.test.mjs` and confirm it fails before implementation.

## Task 2: Two-Level Smart Factory UI

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`

- [ ] Add UI state for `home` vs `studio`, search text, type filter, and active studio tab.
- [ ] Build the home page:
  - top action bar
  - type filters
  - create/import action card
  - repeated agent cards
  - empty/no-result states
- [ ] Build the studio shell:
  - back to app list
  - active agent header
  - left studio navigation
  - one active panel at a time
- [ ] Move existing panels into studio tabs without removing handlers or API calls.
- [ ] Keep chat evidence, publish readiness, knowledge preview, tool test, and run summaries.

## Task 3: Verification

**Files:**
- No production changes unless verification exposes a bug.

- [ ] Run `node --experimental-strip-types --test src/modules/AgentCenter/SmartFactoryPanel.test.mjs src/shell/components/layout/SidebarNavigation.test.mjs src/shell/modules/AgentCenter/AgentCenterModule.test.mjs src/components/uiArchitecture.test.mjs`.
- [ ] Run `npm run build`.
- [ ] Browser verify `http://localhost:3000/`:
  - Smart Factory home screenshot shows app gallery and create actions.
  - Agent studio screenshot shows left studio navigation and focused chat/config panel.
  - Existing chat/tool/knowledge evidence still appears after interaction.
