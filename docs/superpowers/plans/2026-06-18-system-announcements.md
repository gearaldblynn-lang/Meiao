# System Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a managed announcement feature with admin editing/deletion, a sidebar entry, and a first-open center modal with "today no reminder" support.

**Architecture:** Store the active announcement inside existing global system settings so MySQL and local JSON modes remain aligned with the current `/api/system/config` flow. Render a lightweight sidebar announcement entry and a global glass announcement modal after login. Remove the temporary static release-toast wiring so there is only one announcement surface.

**Tech Stack:** Node server `server/index.mjs`, Vite/React shell, `src/services/internalApi.ts`, source-level behavior tests with `node --test` / `node --experimental-strip-types --test`.

---

### Task 1: Announcement Data Contract

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `src/types.ts`
- Modify: `src/shell/types.ts`
- Test: `server/jobRuntime.test.mjs`
- Test: `server/agentCenterSource.test.mjs`

- [ ] Write failing tests proving `SystemPublicConfig.systemSettings.announcement` exists, is sanitized, does not leak deleted content, and both MySQL/local PATCH paths accept `announcement`.
- [ ] Run:
  `node --test server/jobRuntime.test.mjs server/agentCenterSource.test.mjs`
- [ ] Implement `normalizeSystemAnnouncement`, default disabled announcement, PATCH merge, and public config exposure.
- [ ] Re-run the same tests.

### Task 2: Frontend API And Shell Entry

**Files:**
- Modify: `src/services/internalApi.ts`
- Modify: `src/shell/components/layout/SidebarNavigation.tsx`
- Modify: `src/ShellMigratedApp.tsx`
- Test: `src/components/uiArchitecture.test.mjs`
- Test: `src/shell/components/layout/SidebarNavigation.test.mjs`

- [ ] Write failing tests proving the API update payload includes `announcement`, the static release-toast import is gone, and the sidebar exposes a `公告` entry.
- [ ] Run:
  `node --experimental-strip-types --test src/components/uiArchitecture.test.mjs src/shell/components/layout/SidebarNavigation.test.mjs`
- [ ] Implement a sidebar announcement button that opens a modal/management route without changing business module routing.
- [ ] Re-run the same tests.

### Task 3: Admin Management And First-Open Modal

**Files:**
- Create: `src/shell/components/SystemAnnouncementModal.tsx`
- Modify: `src/shell/modules/Settings/GlobalApiSettings.tsx`
- Modify: `src/ShellMigratedApp.tsx`
- Test: `src/components/uiArchitecture.test.mjs`

- [ ] Write failing tests proving admins can save/delete announcement text, non-admins see read-only state, and the first-open modal stores a per-user daily dismissal key.
- [ ] Run:
  `node --experimental-strip-types --test src/components/uiArchitecture.test.mjs`
- [ ] Implement management UI in Settings and the centered glass modal with Close and Today no reminder actions.
- [ ] Re-run the same tests.

### Task 4: Verification And Commit

**Files:**
- All touched files.

- [ ] Run targeted backend/frontend tests.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Commit only this task's files, excluding pre-existing unrelated dirty files.
