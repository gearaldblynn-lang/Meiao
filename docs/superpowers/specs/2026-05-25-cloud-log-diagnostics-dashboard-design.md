# External Cloud Log Diagnostics Dashboard Design

## Goal

Build an external local diagnostics workspace for 梅奥 AI cloud operations. The dashboard is not part of the Tencent Cloud app and does not add pages to the running business program. It lives in a separate local folder, pulls logs from Tencent Cloud every day, analyzes the previous complete operating day, writes summaries and statistics locally, and accumulates a long-term issue memory so the product becomes easier to stabilize over time.

The source of truth for problems is still the Tencent Cloud runtime environment. The source of truth for repair work remains the local `梅奥MEIAO-当前版本` project, where fixes are developed, tested, reviewed, and then deployed to cloud only after approval.

## Correct Environment Boundary

- Tencent Cloud app: real user environment; produces runtime logs and job data.
- External local diagnostics folder: stores pulled logs, daily summaries, statistics, issue fingerprints, fix records, and a local static dashboard.
- Local current version project: used to reproduce, fix, test, review, and deploy approved changes.
- Cloud business app code: should not receive a built-in diagnostics dashboard in this design.

This boundary avoids confusing "local fix exists" with "cloud problem is resolved."

## Operating Window

The daily diagnostics job runs at 09:00 Asia/Shanghai.

Each run analyzes the previous complete 24-hour window:

```text
yesterday 09:00 <= log time < today 09:00
```

For example, a run at `2026-05-26 09:00` analyzes `2026-05-25 09:00` through `2026-05-26 08:59:59.999`.

## Workspace Location

Create a separate folder outside the business app, for example:

```text
/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板
```

Recommended structure:

```text
云上日志诊断看板/
  README.md
  config/
    cloud.json
    rules.json
    categories.json
  scripts/
    pull-cloud-logs.mjs
    analyze-daily.mjs
    generate-dashboard.mjs
    run-daily.mjs
  raw/
    YYYY-MM-DD/
      internal_logs.json
      internal_jobs.json
      pm2.log
      metadata.json
  data/
    runs/
      YYYY-MM-DD.json
    fingerprints.json
    fix-records.json
    recurring-issues.json
  reports/
    YYYY-MM-DD-daily-report.md
  dashboard/
    index.html
    dashboard-data.json
    assets/
```

## Scope

### Included

- Pulling cloud data from Tencent Cloud over SSH.
- Reading cloud MySQL data for `internal_logs`.
- Reading cloud MySQL data for `internal_jobs`.
- Reading PM2 logs for the `meiao-internal` process.
- Saving original pulled data under `raw/YYYY-MM-DD/`.
- Generating structured daily run data under `data/runs/`.
- Maintaining long-term local issue fingerprints and fix records.
- Generating a Markdown daily report.
- Generating a local static HTML dashboard from local data.
- Detecting new, recurring, and fixed-before-but-reappeared issues.

### Excluded

- Adding a dashboard page inside the cloud app.
- Changing the cloud app schema for diagnostics-only data.
- Automatic code modification.
- Automatic deployment.
- Treating local test success as proof that cloud is fixed.
- Heavy monitoring infrastructure such as ELK, Grafana, Prometheus, or SaaS observability tools.

## Data Sources

### 1. Cloud Business Logs: `internal_logs`

Purpose:

- Identify user-facing failures.
- Know module, action, user, status, message, detail, and metadata.
- Track frontend runtime errors already written into business logs.

Fields to pull:

- `id`
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

### 2. Cloud Job Logs: `internal_jobs`

Purpose:

- Identify backend task failures, stuck jobs, retry loops, provider issues, and restart recovery behavior.
- Connect business failures to job ids and provider task ids.

Fields to pull:

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
- `max_retries`
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`
- `cancel_requested_at`

### 3. Cloud PM2 Logs

Purpose:

- Identify process crashes, restarts, unhandled exceptions, boot errors, memory symptoms, and system-level issues that do not reach `internal_logs`.

V1 should capture relevant excerpts from:

- `pm2 logs meiao-internal --nostream --lines N`
- PM2 process status and restart count if available

The raw PM2 excerpt should be saved, but the dashboard should show only grouped relevant errors.

## Daily Flow

`scripts/run-daily.mjs` should orchestrate the full local workflow:

1. Compute the previous 09:00-to-09:00 window in Asia/Shanghai.
2. Create `raw/YYYY-MM-DD/`.
3. SSH to Tencent Cloud.
4. Export matching `internal_logs` rows from cloud MySQL to local JSON.
5. Export matching `internal_jobs` rows from cloud MySQL to local JSON.
6. Pull PM2 log excerpts and cloud process metadata.
7. Save all raw evidence locally.
8. Normalize errors and create issue fingerprints.
9. Group related events into issue groups.
10. Compare groups with local historical fingerprint and fix records.
11. Mark issues as new, recurring, fixed recurrence, or known.
12. Generate daily statistics and summary.
13. Write `data/runs/YYYY-MM-DD.json`.
14. Update `data/fingerprints.json`, `data/recurring-issues.json`, and fix-record references.
15. Write `reports/YYYY-MM-DD-daily-report.md`.
16. Regenerate `dashboard/dashboard-data.json` and `dashboard/index.html`.

## Scheduling

Recommended V1 scheduling is local macOS automation, because the dashboard is local:

- `launchd` or app automation runs daily at 09:00.
- The script connects to Tencent Cloud remotely.
- If the local machine is asleep, the next manual run can backfill the missed date.

The runner should support manual backfill:

```bash
node scripts/run-daily.mjs --date 2026-05-25
```

This command means: analyze the cloud window from `2026-05-25 09:00` to `2026-05-26 09:00`.

## Issue Fingerprints

The system should group errors by normalized fingerprint, not raw text equality.

Stable inputs:

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

Unstable values to remove:

- Timestamps
- User ids
- Job ids
- Provider task ids
- Random ids
- URL signatures or tokens
- Temporary filenames
- Numeric retry counters when they do not change the cause

This lets the local dashboard detect that "the same bug happened again" even if the specific job ids differ each day.

## Error Categories

V1 uses a small fixed category list:

- `provider`: KIE, Veo, OpenAI, Spider, or other upstream service failures.
- `job_queue`: stuck jobs, retries, restart recovery, task lifecycle inconsistencies.
- `database`: MySQL connection, query, schema, or state persistence failures.
- `asset`: upload failure, expired file, unreadable public URL, missing material.
- `permission`: login, token, role, account isolation, or forbidden actions.
- `frontend`: runtime error, unhandled rejection, browser crash recovery signals.
- `system`: PM2 restart, Node process crash, memory pressure, health failure.
- `business_rule`: invalid state, missing required parameter, duplicate submit, bad workflow transition.

## Local Dashboard Layout

The dashboard is a local static file:

```text
dashboard/index.html
```

It should read:

```text
dashboard/dashboard-data.json
```

The dashboard should be compact and daily-review oriented.

### 1. Daily Health Overview

Top metrics for the selected day:

- Error events
- Failed jobs
- Affected users
- New issue groups
- Recurring issue groups
- Fixed issues that reappeared
- Most affected module
- PM2 restart count
- Long-running or stuck job count

Default date: latest generated run.

### 2. Daily Summary

A concise Chinese summary generated from the structured data:

- 昨日整体稳定性
- 错误主要集中在哪些模块
- 最优先处理的问题
- 是否有老问题复发
- 疑似原因是 provider、数据库、任务队列、素材、前端还是系统
- 今天建议优先排查什么

The summary should be consistent in format so daily reports are easy to compare.

### 3. Issue Groups

Each row is one grouped problem, not one raw log line.

Columns:

- Severity
- Title
- Category
- Module
- Count
- Affected users
- First seen in window
- Last seen in window
- New / known / recurring
- Fixed recurrence flag
- Current status

Statuses:

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

Clicking an issue should show:

- Issue title and severity
- Daily count and recent trend
- Affected modules and users
- Representative error message
- Representative raw logs
- Surrounding context logs from the same user/job/provider/module
- Related `internal_jobs` rows
- Normalized fingerprint
- Suspected cause
- Suggested next investigation steps
- Similar historical issues
- Last fix record if this fingerprint was fixed before

### 5. Fix And Recurrence Record

The local data should allow a fix record for each fingerprint:

- Root cause
- Fix summary
- Local version or commit reference
- Files changed
- Regression test command
- Review result
- Cloud deployment time
- Observation start and end
- Closure note

If the same fingerprint appears after it was marked deployed or closed, the next run must mark it as `recurred`.

## Local Data Files

### `data/runs/YYYY-MM-DD.json`

Stores one daily diagnostic result:

- Date
- Window start and end
- Pull metadata
- Counts
- Summary
- Issue groups
- Representative events
- Links to raw files

### `data/fingerprints.json`

Long-term issue identity memory:

- Fingerprint
- Title
- Category
- First seen date
- Last seen date
- Times seen
- Last status
- Last fix record id
- Recent daily counts

### `data/fix-records.json`

Repair loop memory:

- Fingerprint
- Root cause
- Fix summary
- Local version or commit
- Test command
- Review note
- Cloud deployment time
- Observation status

### `data/recurring-issues.json`

Convenience index for issues that deserve extra attention:

- Repeated many days
- Reappeared after a fix
- Increasing frequency
- Affecting multiple users
- Blocking important modules

## Severity Rules

Initial severity should be deterministic:

- High:
  - Affects more than one user and blocks task completion.
  - Previously fixed issue reappears.
  - PM2 restart or process crash.
  - Database persistence failure.
  - User isolation or permission risk.
- Medium:
  - Repeated provider failures.
  - Repeated failed jobs in one module.
  - Stuck or retrying jobs that degrade experience.
- Low:
  - Single-user failure with clear user input cause.
  - Interrupted or cancelled user action.
  - Known provider transient issue with successful retry.

## Cloud Review Focus

The daily local dashboard should help answer:

- Did the cloud service restart yesterday?
- Did one error suddenly increase?
- Did any issue affect multiple users?
- Did a previously fixed issue reappear?
- Did jobs stay `running`, `retry_waiting`, or `failed` abnormally?
- Did provider errors concentrate around one upstream?
- Did database or state persistence fail?
- Did any user isolation or permission risk appear?
- Did a cloud-only issue appear that local testing did not cover?

## Repair Loop

The intended operating loop:

1. Local dashboard pulls and analyzes cloud logs.
2. Developer reviews daily report and issue groups.
3. Developer investigates and reproduces in local current version when possible.
4. Developer fixes locally and adds focused regression tests.
5. Developer records root cause, fix summary, tests, and review notes in the local diagnostics workspace.
6. Code review checks diff, data isolation, public URLs, logs/statistics, permissions, and task chain.
7. Approved fix deploys to Tencent Cloud.
8. The local dashboard observes later cloud runs.
9. If the fingerprint disappears through the observation window, close it.
10. If the fingerprint appears again after deployment or closure, mark it as recurred.

## Implementation Phases

### Phase 1: External Workspace MVP

- Create the external diagnostics folder.
- Add config files.
- Add scripts to pull cloud `internal_logs`, `internal_jobs`, and PM2 excerpts.
- Save raw data by date.
- Generate one daily Markdown report.
- Generate one local static dashboard from local JSON.

### Phase 2: Fingerprints And Recurrence

- Add normalization and fingerprint matching.
- Maintain `fingerprints.json`.
- Maintain `recurring-issues.json`.
- Mark new, known, recurring, and fixed recurrence issues.

### Phase 3: Fix Records And Evolution

- Add `fix-records.json`.
- Add a simple way to mark issue status and write root cause/fix/test notes.
- Highlight deployed fixes under observation.
- Detect reappearance after fix.

### Phase 4: Quality Loop

- Suggest regression tests per issue category.
- Link important fixes back into `docs/agents/repeated-issues.md` when they are broadly useful to the main project.
- Add weekly trend summaries.
- Add release observation summaries after each cloud deployment.

## Acceptance Criteria

- The diagnostics workspace is outside the business app.
- No dashboard page is added to the Tencent Cloud app.
- A daily run can pull Tencent Cloud logs remotely.
- Raw pulled data is saved under `raw/YYYY-MM-DD/`.
- A structured daily result is saved under `data/runs/YYYY-MM-DD.json`.
- A Markdown daily report is generated under `reports/`.
- A local static dashboard is generated under `dashboard/index.html`.
- Errors are grouped by normalized fingerprint rather than raw text equality.
- The system identifies new, known, recurring, and fixed-before-reappeared issues.
- Fix records can store root cause, local fix reference, tests, review note, and cloud deployment time.
- Local fixes are not considered resolved until later cloud diagnostics confirm the fingerprint no longer appears.

