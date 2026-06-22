# app_state Safe Apply Design

## Goal

Add a production-safe way to apply the existing app_state repair plan without risking cloud data loss or broad accidental rewrites.

## Scope

This step adds tooling only. It does not deploy the application and does not update cloud `app_states` unless a later command explicitly supplies apply confirmation flags.

## Design

Use the existing pure `buildAppStateRepairPlan(state)` function as the single source of truth for both preview and apply. A new script will load candidate rows from `app_states`, compute repair plans, and default to dry-run output.

The script may write only when all of these gates pass:

- `--apply` is present.
- `--confirm=APPLY_APP_STATE_REPAIR` is present.
- A scope limiter is present: `--username=...` or `--limit=N`.
- Every changed row is backed up before update.
- The row is updated with an optimistic `WHERE user_id = ? AND state_json = ?` check.

## Backup Model

Before each update, write one JSONL backup entry under `backups/app-state-repair/`. Each entry includes user id, username, display name, original bytes, repaired bytes, issue counts, action summary, and original `state_json`.

If any backup write fails, the script must stop before updating that row.

## Failure Handling

The script processes rows one by one. A failed optimistic update or parse error is reported and counted, not hidden. The tool should exit non-zero when an apply run has failed rows.

## Verification

Tests must prove the source contains the safety gates, backup write, optimistic update condition, and no apply path without confirmation. Local verification must include targeted node tests, `git diff --check`, lint, build, and a cloud dry-run/preflight without writing DB rows.
