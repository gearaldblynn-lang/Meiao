# Smart Factory Agent Center Entry Batch 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Smart Factory under the existing Agent Center factory area and connect it to the new Dify-derived runtime preview API without replacing old agent workflows.

**Architecture:** Keep the old Agent Center plaza, old factory manager, and studio intact. Add a Smart Factory panel as a new factory sub-view. Backend exposes a preview endpoint backed by `server/ai-engine/smartFactoryRuntime.mjs`.

**Tech Stack:** React/TypeScript, Node `.mjs`, existing internal API client, Node test runner.

---

## Result Slices and Acceptance

| Slice | Concrete Goal | Acceptance Command | Expected Effect |
| --- | --- | --- | --- |
| 1. Backend preview module | Provide a testable Smart Factory preview turn backed by `runSmartFactoryTurn`. | `node --test server/smartFactoryPreview.test.mjs` | Knowledge and Feishu-style tool paths run through the new runtime and return trace. |
| 2. Backend API route | Mount `POST /api/smart-factory/preview-turn` in MySQL and local handlers. | `node --test server/smartFactoryPreviewRoute.test.mjs` | Local and cloud modes expose the same preview API with admin permission. |
| 3. Internal API client | Add `runSmartFactoryPreviewTurn`. | `node --experimental-strip-types --test src/services/internalApi.test.mjs` | Frontend calls the new API without exposing runtime internals. |
| 4. Agent Center entry | Add Smart Factory under the old Agent Factory overview. | `node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs` | Old manager stays available; Smart Factory opens as a separate sub-view. |
| 5. Static gates | Verify project does not regress. | `node --test server/ai-engine/*.test.mjs`, focused tests, `npm run lint`, `npm run build`, `git diff --check` | Safe handoff for browser verification. |

## Files

- Create: `server/smartFactoryPreview.mjs`
- Create: `server/smartFactoryPreview.test.mjs`
- Create: `server/smartFactoryPreviewRoute.test.mjs`
- Create: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Modify: `server/index.mjs`
- Modify: `src/services/internalApi.ts`
- Modify: `src/services/internalApi.test.mjs`
- Modify: `src/shell/modules/AgentCenter/AgentCenterModule.tsx`
- Modify: `src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`

## Status

- [x] Backend preview module implemented and tested.
- [x] Backend API route mounted and source-tested.
- [x] Internal API client implemented and tested.
- [x] Smart Factory panel added under old Agent Factory and source-tested.
- [x] Final verification gates.
