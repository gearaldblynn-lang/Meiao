# Smart Factory Main Module And Config Batch 4 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each behavioral slice. Keep the existing Agent Center intact; Smart Factory is a separate top-level module.

**Goal:** Correct Smart Factory placement from the Agent Center factory sub-view to the left sidebar main module list, then expose runtime configuration for model, knowledge base, and tool capabilities.

**Architecture:** `smart_factory` is a shell module beside `agent_center`, `one_click`, and other main features. It reuses the Smart Factory panel, but the old Agent Center factory no longer nests Smart Factory. Backend exposes both run preview and configuration endpoints.

---

## Result Slices And Acceptance

| Slice | Concrete Goal | Acceptance Command | Expected Effect |
| --- | --- | --- | --- |
| 1. Main navigation module | Add `smart_factory` to shared module types and sidebar after Agent Center. | `node --experimental-strip-types --test src/shell/components/layout/SidebarNavigation.test.mjs` | Left sidebar shows `智能工厂` under `智能体` and above `一键主详`. |
| 2. Shell routing | Lazy-load `SmartFactoryModule` from `ShellMigratedApp`. | Same focused sidebar test plus `npm run build` | Clicking the main sidebar entry opens a dedicated Smart Factory workspace. |
| 3. Remove nested misplacement | Remove Smart Factory from the old Agent Center factory overview. | `node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs` | Old Agent Center keeps plaza/factory/studio; Smart Factory is not duplicated inside it. |
| 4. Runtime config API | Add `GET /api/smart-factory/config` in MySQL and local handlers. | `node --test server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs` | Admins can read available model, knowledge base, and tool configuration without secrets. |
| 5. Frontend config display | `SmartFactoryPanel` reads and displays config cards. | `node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs` | Main Smart Factory shows model, knowledge base, tool, run output, and trace in one workbench. |
| 6. Help metadata | Add help content for `AppModule.SMART_FACTORY`. | `node --experimental-strip-types --test --test-name-pattern "help guide config covers" src/components/uiArchitecture.test.mjs` | Top-level help config covers the new module. |

## Files

- Create: `src/shell/modules/SmartFactory/SmartFactoryModule.tsx`
- Create: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`
- Modify: `src/types.ts`
- Modify: `src/shell/types.ts`
- Modify: `src/shell/components/layout/SidebarNavigation.tsx`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/config/helpGuide.ts`
- Modify: `src/shell/modules/AgentCenter/AgentCenterModule.tsx`
- Modify: `server/smartFactoryPreview.mjs`
- Modify: `server/index.mjs`
- Modify: `src/services/internalApi.ts`

## Status

- [x] Main navigation module implemented and tested.
- [x] Shell route implemented.
- [x] Nested Smart Factory entry removed from old Agent Center.
- [x] Runtime config API implemented and tested.
- [x] Frontend config display implemented and tested.
- [x] Help metadata updated and targeted-tested.
