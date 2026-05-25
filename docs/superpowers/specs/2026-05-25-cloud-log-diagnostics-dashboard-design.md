# Cloud Log Diagnostics Dashboard Design

## Goal

Build a compact cloud-first diagnostics dashboard for the Tencent Cloud deployment of 梅奥 AI. The system must help the owner review the previous complete operating day every morning, understand what failed, see counts and affected scope, identify recurring or previously fixed issues, and drive a repair loop that makes the program more stable over time.

The source of truth is always the Tencent Cloud runtime environment. The local `梅奥MEIAO-当前版本` directory remains the place for investigation, fixes, tests, code review, and deployment preparation.

## Operating Window

The daily diagnostics job runs at 09:00 Asia/Shanghai on Tencent Cloud.

Each run analyzes the previous complete 24-hour window:

```text
yesterday 09:00 <= log time < today 09:00
```

For example, a run at `2026-05-26 09:00` analyzes `2026-05-25 09:00` through `2026-05-26 08:59:59.999`.

## Scope

### Included

- Tencent Cloud deployed app under `/www/wwwroot/meiao-internal`
- PM2 process `meiao-internal`
- Cloud MySQL records for `internal_logs`
- Cloud MySQL records for `internal_jobs`
- PM2 stderr/stdout logs for Node runtime errors, unhandled exceptions, restart signals, and system-level service failures
- A new admin-facing stability dashboard inside the existing app
- Daily issue grouping, statistics, summary, status tracking, fix records, and recurrence detection

### Excluded From V1

- Automatic code modification
- Automatic cloud deployment
- Heavy observability stacks such as ELK, Grafana, Prometheus, or external SaaS monitoring
- Full nginx/access-log analytics unless a later incident shows it is needed
- Directly treating local test results as cloud recovery proof

## Design Principles

### 1. Cloud First

The dashboard reviews cloud facts, not local expectations. A problem is considered resolved only after the fix has been deployed to Tencent Cloud and the cloud diagnostics no longer sees the same issue during the observation window.

### 2. Compact But Complete

The first dashboard should be small enough to read daily, but must include the full loop:

- What happened
- How often it happened
- Who or what was affected
- Whether it is new or recurring
- What the likely cause is
- What should be fixed
- Whether a previous fix failed

### 3. Group Issues, Not Lines

Raw logs are too noisy. The dashboard groups errors into issue groups using normalized fingerprints, then links back to representative raw logs and surrounding context.

### 4. Repair Loop Over Reporting

The system should not stop at "yesterday had errors." Every issue group must be able to move through investigation, local fix, review, cloud deployment, observation, closure, or recurrence.

### 5. Preserve Existing Guardrails

Cloud deployment still requires local validation and code review. The diagnostics dashboard must support that process, not bypass it.

## Data Sources

### Business Logs: `internal_logs`

Used to answer:

- Which user saw the problem
- Which module and action failed
- Whether the failure was frontend, workflow, provider, account, or system related
- What user-visible error message was recorded

Relevant fields:

- `created_at`
- `level`
- `module`
- `action`
- `message`
- `detail`
- `status`
- `user_id`
- `username`
- `display_name`
- `meta_json`

### Job Logs: `internal_jobs`

Used to answer:

- Which backend tasks failed or got stuck
- Which provider was involved
- Whether retries happened
- Whether a provider task id exists
- Whether errors are concentrated in queue/runtime/provider paths

Relevant fields:

- `id`
- `user_id`
- `module`
- `task_type`
- `provider`
- `status`
- `payload_json`
- `provider_task_id`
- `result_json`
- `error_code`
- `error_message`
- `retry_count`
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`

### PM2 Logs

Used to answer:

- Whether the Node service restarted
- Whether there were unhandled exceptions or promise rejections
- Whether cloud-only runtime failures happened outside business logs
- Whether memory, process, or boot-time problems appeared

The diagnostics runner should collect recent PM2 logs for the target time window and store only relevant excerpts, not the full rolling log body.

## Issue Fingerprints

Each issue group is identified by a normalized fingerprint. The fingerprint should combine stable fields such as:

- Source: `internal_logs`, `internal_jobs`, or `pm2`
- Module
- Action
- Task type
- Provider
- Status
- Error code
- HTTP/provider status if available
- Stack top frame if available
- Normalized error message

The normalizer must remove unstable values:

- Timestamps
- User ids
- Job ids
- Provider task ids
- Random ids
- URL signatures or tokens
- Temporary filenames
- Numeric retry counters when they do not change the cause

This lets the system identify "same issue again" even when each raw event has different ids.

## Error Categories

V1 should use a small fixed category list:

- `provider`: KIE, Veo, OpenAI, Spider, or other upstream service failures
- `job_queue`: stuck jobs, retries, restart recovery, task lifecycle inconsistencies
- `database`: MySQL connection, query, schema, or state persistence failures
- `asset`: upload failure, expired file, unreadable public URL, missing material
- `permission`: login, token, role, account isolation, or forbidden actions
- `frontend`: runtime error, unhandled rejection, browser crash recovery signals
- `system`: PM2 restart, Node process crash, memory pressure, health failure
- `business_rule`: invalid state, missing required parameter, duplicate submit, bad workflow transition

## Dashboard Layout

The dashboard should be added to the admin area as a new "稳定性看板" or "日志诊断" view. It should reuse the existing shell/admin UI style and avoid a large analytics product feel.

### 1. Daily Health Overview

Top-level metrics for the selected diagnostic day:

- Error events
- Failed jobs
- Affected users
- New issue groups
- Recurring issue groups
- Previously fixed issues that reappeared
- Most affected module
- PM2 restart count
- Long-running or stuck job count

The default selected date is the latest completed diagnostics run.

### 2. Daily Summary

A concise generated Chinese summary:

- Overall cloud stability
- Main failing modules
- Highest priority problem
- Repeated or resurrected problems
- Whether the likely cause is provider, database, task queue, asset, frontend, or system
- Recommended investigation order for today

The summary should be deterministic in structure so it can be compared across days.

### 3. Issue Groups Table

Each row represents one grouped issue, not one log line.

Columns:

- Severity: high, medium, low
- Title
- Category
- Module
- Count
- Affected users
- First seen in window
- Last seen in window
- New or recurring
- Fixed-before recurrence flag
- Current lifecycle status

Supported lifecycle statuses:

- `cloud_detected`
- `local_investigating`
- `local_fixed`
- `pending_review`
- `deployed_to_cloud`
- `observing`
- `closed`
- `recurred`
- `ignored`

### 4. Issue Detail

The detail view should show:

- Issue title and severity
- Daily count and trend across recent runs
- Affected modules and users
- Representative error message
- Representative raw logs
- Surrounding context logs from the same user/job/provider/module
- Related `internal_jobs` records
- Normalized fingerprint
- AI-generated suspected cause
- Suggested next investigation steps
- Similar historical issues
- Last fix record if this fingerprint was fixed before

Context collection should prioritize same `jobId`, `providerTaskId`, `userId`, `module`, and nearby timestamps.

### 5. Fix And Recurrence Record

Each issue group should allow an admin or developer to record:

- Root cause
- Fix summary
- Local version or commit reference
- Files changed
- Regression test command
- Review result
- Cloud deployment time
- Observation start and end
- Closure note

If the same fingerprint appears after a fix has been marked deployed or closed, the system should automatically mark it as `recurred`.

## Data Model

### `diagnostic_runs`

Stores each daily run.

Fields:

- `id`
- `window_start`
- `window_end`
- `created_at`
- `status`
- `summary_text`
- `error_event_count`
- `failed_job_count`
- `affected_user_count`
- `new_issue_count`
- `recurring_issue_count`
- `recurred_fixed_issue_count`
- `pm2_restart_count`
- `meta_json`

### `diagnostic_issue_groups`

Stores grouped issues for a run.

Fields:

- `id`
- `run_id`
- `fingerprint`
- `title`
- `category`
- `severity`
- `module`
- `count`
- `affected_user_count`
- `first_seen_at`
- `last_seen_at`
- `is_new`
- `is_recurring`
- `is_fixed_recurrence`
- `lifecycle_status`
- `suspected_cause`
- `recommended_action`
- `representative_message`
- `context_json`

### `diagnostic_events`

Stores indexed source events used by issue groups.

Fields:

- `id`
- `run_id`
- `issue_group_id`
- `source`
- `source_id`
- `created_at`
- `module`
- `action`
- `user_id`
- `job_id`
- `provider`
- `error_code`
- `message`
- `raw_json`

### `diagnostic_fingerprints`

Stores long-lived issue identity and history.

Fields:

- `fingerprint`
- `first_seen_at`
- `last_seen_at`
- `first_run_id`
- `last_run_id`
- `times_seen`
- `last_lifecycle_status`
- `last_fix_record_id`
- `category`
- `title`

### `diagnostic_fix_records`

Stores repair loop information.

Fields:

- `id`
- `fingerprint`
- `root_cause`
- `fix_summary`
- `local_version`
- `commit_ref`
- `changed_files_json`
- `regression_tests`
- `review_note`
- `deployed_at`
- `observation_started_at`
- `observation_ended_at`
- `status`
- `created_at`
- `updated_at`

## Daily Runner Flow

1. Cron or PM2 scheduled task starts at 09:00 Asia/Shanghai.
2. Compute the previous 09:00-to-09:00 window.
3. Read cloud `internal_logs` in the window where `level = error` or `status = failed`.
4. Read cloud `internal_jobs` in the window where status indicates failure, retry waiting, long running, or suspicious lifecycle.
5. Read PM2 logs for relevant error/restart excerpts in the window.
6. Normalize raw events.
7. Create fingerprints.
8. Group events by fingerprint.
9. Compute counts, affected users, first/last timestamps, severity, and category.
10. Compare fingerprints with historical fingerprint and fix tables.
11. Mark new, recurring, or fixed-after-deployed recurrence.
12. Generate deterministic Chinese summary.
13. Persist `diagnostic_runs`, `diagnostic_issue_groups`, `diagnostic_events`, and fingerprint updates.
14. Make the latest run visible in the admin dashboard.

## Severity Rules

Initial severity can be deterministic:

- High:
  - Affects more than one user and blocks task completion
  - Previously fixed issue reappears
  - PM2 restart or process crash
  - Database persistence failure
  - User isolation or permission risk
- Medium:
  - Repeated provider failures
  - Repeated failed jobs in one module
  - Stuck or retrying jobs that might recover but degrade experience
- Low:
  - Single-user failure with clear user input cause
  - Interrupted or cancelled user action
  - Known provider transient issue with successful retry

## Cloud Review Focus

The daily review should prioritize:

- Did the cloud service restart yesterday?
- Did one issue suddenly increase?
- Did any issue affect multiple users?
- Did a previously fixed issue reappear?
- Did jobs stay `running`, `retry_waiting`, or `failed` abnormally?
- Did provider errors concentrate around one upstream?
- Did database or state persistence fail?
- Did any user isolation or permission risk appear?
- Did a cloud-only issue appear that local testing did not cover?

## Repair Loop

The dashboard supports this operating loop:

1. Cloud diagnostics discovers the issue.
2. Developer investigates and reproduces in local current version when possible.
3. Developer fixes locally and adds focused regression tests.
4. Developer records root cause, fix summary, test commands, and review notes.
5. Code review checks diff, data isolation, public URLs, logs/statistics, permissions, and core task chain.
6. Approved fix deploys to Tencent Cloud.
7. Issue enters observation.
8. Later diagnostic runs either keep it quiet and close it, or mark it as recurred if the fingerprint appears again.

## Implementation Phases

### Phase 1: Daily Diagnostics And Read-Only Dashboard

- Add diagnostic database tables.
- Add cloud diagnostics runner.
- Add daily 09:00 schedule on Tencent Cloud.
- Group `internal_logs`, `internal_jobs`, and PM2 errors.
- Persist daily run, issue groups, and events.
- Add admin dashboard with overview, summary, issue list, and issue detail.

### Phase 2: Fix Records And Lifecycle Status

- Add lifecycle status update APIs.
- Add fix record UI.
- Support local-fixed, pending-review, deployed-to-cloud, observing, closed, and ignored states.
- Detect fixed fingerprints that reappear after deployment.

### Phase 3: Continuous Improvement

- Suggest regression tests per issue group.
- Link or export repeated issues to `docs/agents/repeated-issues.md`.
- Add weekly trend view for error counts, recurring issues, and fragile modules.
- Add release observation view after each cloud deployment.

## Acceptance Criteria

- A cloud diagnostics run is created every day at 09:00 Asia/Shanghai.
- The default dashboard shows the latest completed 09:00-to-09:00 run.
- The dashboard shows daily health metrics, a Chinese summary, issue groups, and issue details.
- Errors are grouped by normalized fingerprint rather than raw line equality.
- Each issue group shows count, affected users, module, category, severity, first seen, and last seen.
- The system can identify new issues, recurring issues, and previously fixed issues that reappeared.
- A fix record can store root cause, fix summary, local version, tests, review note, and cloud deployment time.
- Local fixes are not treated as cloud resolution until deployed and observed through cloud diagnostics.
- Existing cloud deployment review guardrails remain in force.

