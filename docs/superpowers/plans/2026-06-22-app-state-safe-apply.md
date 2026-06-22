# app_state Safe Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded, backup-first script for applying app_state repair plans in small production batches.

**Architecture:** Keep repair logic in `server/appStateRepairPlan.mjs`. Add one script that defaults to dry-run, backs up every changed row before writing, and requires explicit confirmation plus a scope limiter before any `UPDATE`.

**Tech Stack:** Node.js ESM, `mysql2/promise`, `node:test`, JSONL filesystem backups.

---

### Task 1: Safety Tests

**Files:**
- Create: `scripts/cloud-apply-app-state-repair.test.mjs`

- [ ] **Step 1: Write failing tests**

Check that the script source contains these gates: `--apply`, `--confirm=APPLY_APP_STATE_REPAIR`, scope limiter, backup JSONL write, optimistic `WHERE user_id = ? AND state_json = ?`, and explicit `UPDATE app_states`.

- [ ] **Step 2: Run red test**

Run: `node --test scripts/cloud-apply-app-state-repair.test.mjs`

Expected: fail because `scripts/cloud-apply-app-state-repair.mjs` does not exist yet.

### Task 2: Apply Script

**Files:**
- Create: `scripts/cloud-apply-app-state-repair.mjs`

- [ ] **Step 1: Implement minimal script**

The script must:

- Load `.env.server` DB settings.
- Select candidate `app_states` rows with optional `--username` and `--limit`.
- Build repair plans with `buildAppStateRepairPlan`.
- Print dry-run summary by default.
- Refuse apply unless `--apply --confirm=APPLY_APP_STATE_REPAIR` and a scope limiter are supplied.
- Write `backups/app-state-repair/app-state-repair-<timestamp>.jsonl` before each row update.
- Update with `UPDATE app_states SET state_json = ?, updated_at = NOW() WHERE user_id = ? AND state_json = ?`.

- [ ] **Step 2: Run targeted tests**

Run: `node --test scripts/cloud-apply-app-state-repair.test.mjs`

Expected: pass.

### Task 3: Verification and Audit

**Files:**
- No new production files beyond Task 2.

- [ ] **Step 1: Run regression tests**

Run app_state tests and script tests together.

- [ ] **Step 2: Run lint/build**

Run `npm run lint` and `npm run build`.

- [ ] **Step 3: Run cloud dry-run/preflight only**

Run the cloud script without `--apply` to get the affected users and action counts. Do not run the confirmed apply command until the user explicitly approves the exact scope.
