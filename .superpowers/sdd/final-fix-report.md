# Final Fix Report

Date: 2026-07-13
Scope: final independent-review follow-up for the production-stability release

## Resolved

1. Every API write route now checks the deploy marker before MySQL/local dispatch. This covers job submissions and direct synchronous provider paths while leaving GET/HEAD/OPTIONS health and static traffic available.
2. First-release cutover blocks NEW IPv4 local proxy/direct connections with `iptables` and IPv6 direct-3100 connections with `ip6tables`, preflights both commands plus `ss`, waits for stable zero established connections, then acquires the `internal_jobs` WRITE lock.
3. The lock-owning MySQL session stops and verifies the old PM2 process, re-verifies its own session, and only then emits the stopped acknowledgement. Lock loss and false PM2 stop cannot produce an acknowledgement.
4. Network cleanup is command-specific and idempotent: `-C` exit 0 deletes, exit 1 confirms absence, and any other result retains the remaining persisted rule set. Partial install cleanup failures preserve the exact retry state.
5. Failed new-process health accepts stopped proof only from a successful `pm2 pid` command whose output contains only zero PIDs. Command errors, empty output, or nonzero PIDs retain the gates.
6. A stopped-old/not-started-new failure is tracked as service-down and retains all gates. Every intentional retain writes durable marker content `manual`, which never expires and blocks subsequent deploys until the documented recovery procedure completes.
7. MySQL and local recovery routes use one authorization orchestration service. Cross-user and missing provider ids produce the same 404 and cannot invoke job creation; same-user compatible sources proceed.
8. Single-result physical deletion uses only explicit `backendJobId`; `result.id`, `resultId`, `taskId`, and `providerTaskId` are never inferred, including `job-*` provider ids.
9. Result and project deletion share one independently-started tombstone/physical-delete operation and a tested outcome matrix. Tombstone-only success now reports hidden rather than physically deleted.
10. The lock holder now reuses the strict PM2 stopped predicate. A successful command must return at least one PID token and every token must be zero; empty output and command errors cannot prove stop.
11. A separate stop-attempted acknowledgement is persisted after old-app existence is established but before invoking `pm2 stop`. Stop-command failure therefore retains truthful evidence that the old process may have changed, keeps all gates when no new process started, and never promotes the state to verified stopped.
12. The initial remote readiness pass sources `.env.server`, resolves a custom `MEIAO_DEPLOY_DRAIN_FILE`, and rejects marker existence including empty files before any source upload or replacement. The final race check remains in place.
13. Network drain state updates now write a same-directory temporary file and atomically rename it over the state file.
14. A deployment-wide remote mutex is acquired with atomic `mkdir` before readiness or upload. After remote mutation starts, its shell writes an owner-matched completion proof only after cleanup and drain-child exit; local abnormal exit or missing proof retains the mutex. Release atomically claims the directory before inspection, so a replacement mutex is never deleted.
15. Active drain markers use exclusive creation. Cleanup atomically claims the marker by owner-specific rename, deletes only matching claimed content, restores/retains foreign or manual content, and leaves any replacement marker untouched. Manual, empty, and orphaned markers are all blocked before upload.

## Verification

- Focused deployment-drain/readiness regression: 50 passed, 0 failed.
- `node --check scripts/deploy-ownership.mjs`: passed.
- `bash -n scripts/deploy_tencent.sh`: passed.
- `npm run lint`: TypeScript passed; ESLint 0 errors and 660 warnings, exactly within the existing 660 warning budget.
- Hermes changed-file report: bridge OK. Its env-knob reminder was reviewed: this patch adds no environment variable, and the existing `MEIAO_DEPLOY_DRAIN_FILE` remains documented in `.env.server.example` and the deployment runbook. The commit-hook prompt reminder matched deployment/report prose only; no runtime prompt or parser anchor changed.
- Full `npm run verify` and build were intentionally left to the parent worker per instruction.

No real provider job was queried or modified. No push, deployment, dashboard update, or production action was performed.
