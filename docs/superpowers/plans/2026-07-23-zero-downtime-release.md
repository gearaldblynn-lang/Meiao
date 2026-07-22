# MEIAO Zero-Downtime Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stop/start deployment with a PM2 ready-gated graceful reload so public GET traffic sees zero 502 while paid-task writes remain fail-closed.

**Architecture:** Keep the current single combined API/Temporal process, run one PM2 cluster instance, and hold the existing deploy marker plus MySQL job-table lock across reload. A focused process-lifecycle module owns ready signalling and idempotent shutdown; a focused deploy lock helper owns the MySQL lock without stopping PM2.

**Tech Stack:** Node.js ESM, native HTTP, PM2 cluster mode, Bash, MySQL 8, Node test runner.

## Global Constraints

- GET, HEAD and OPTIONS remain available throughout release; guarded API writes may return retryable HTTP 503 while the marker exists.
- The default release path never runs backend network drain, `pm2 stop`, or `pm2 restart`.
- Running paid jobs must be zero before cutover; the active-job override is never enabled by default.
- Startup and shutdown timeouts are environment-configurable with defaults of 120000 ms and 30000 ms.
- Failed reload must not intentionally stop the last healthy process.

---

### Task 1: Ready-gated and graceful server lifecycle

**Files:**
- Create: `server/processLifecycle.mjs`
- Create: `server/processLifecycle.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `listenAndNotifyReady({ server, port, host?, send? }) -> Promise<void>`.
- Produces: `createGracefulShutdown({ server, stopWorkers, clearTimers, shutdownTemporal, closePools, logger }) -> () => Promise<void>`.
- Produces: `registerProcessShutdown({ shutdown, processRef?, logger? }) -> void`.

- [ ] **Step 1: Write failing lifecycle tests**

Create tests with fake EventEmitter servers/resources proving that `ready` is sent only after the listening callback, shutdown order is workers/timers → Temporal → HTTP → pools, and two shutdown calls share one promise.

```js
test('listenAndNotifyReady reports ready only after listening', async () => {
  const events = [];
  const server = { listen(_port, _host, callback) { events.push('listen'); callback(); } };
  await listenAndNotifyReady({ server, port: 3100, host: '127.0.0.1', send: (value) => events.push(value) });
  assert.deepEqual(events, ['listen', 'ready']);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test server/processLifecycle.test.mjs`

Expected: FAIL because `server/processLifecycle.mjs` does not exist.

- [ ] **Step 3: Implement the lifecycle module and wire it into the server**

Implement listening as a Promise around the real listen callback. Implement idempotent shutdown that stops both classic workers, clears the four interval/timeout families, shuts down `temporalWorkerRuntime`, closes the HTTP server, then ends `mysqlPool` and `mysqlManagedAssetLockPool`. Register both `SIGINT` and `SIGTERM`; exit 0 after clean shutdown and exit 1 after logged shutdown failure.

```js
await listenAndNotifyReady({ server, port: PORT, host: '0.0.0.0' });
```

- [ ] **Step 4: Verify GREEN and server regressions**

Run: `node --test server/processLifecycle.test.mjs server/deployDrain.test.mjs server/temporalWorker.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/processLifecycle.mjs server/processLifecycle.test.mjs server/index.mjs
git commit -m "feat(server): support ready-gated graceful reload"
```

### Task 2: PM2 cluster contract and release identity

**Files:**
- Modify: `ecosystem.config.cjs`
- Modify: `server/index.mjs`
- Create: `server/pm2Contract.test.mjs`
- Modify: `scripts/assert-deploy-health.mjs`
- Modify: `scripts/assert-deploy-health.test.mjs`

**Interfaces:**
- Consumes: Task 1 ready message and graceful signal handling.
- Produces: health fields `release.id`, `release.pid`, and `release.startedAt`.

- [ ] **Step 1: Write failing PM2 and health identity tests**

Assert `instances: 1`, `exec_mode: 'cluster'`, `wait_ready: true`, numeric `listen_timeout` and `kill_timeout`, plus health-source coverage for `MEIAO_RELEASE_ID` and deploy-health verification of an expected release ID.

```js
assert.equal(app.exec_mode, 'cluster');
assert.equal(app.wait_ready, true);
assert.equal(app.listen_timeout, 120000);
assert.equal(app.kill_timeout, 30000);
```

- [ ] **Step 2: Verify RED**

Run: `node --test server/pm2Contract.test.mjs scripts/assert-deploy-health.test.mjs`

Expected: FAIL because the ecosystem is still fork mode and health has no release identity.

- [ ] **Step 3: Implement PM2 and health contracts**

Read timeouts from `MEIAO_PM2_LISTEN_TIMEOUT_MS` and `MEIAO_PM2_KILL_TIMEOUT_MS` with conservative defaults. Add immutable process startup metadata to health. Extend the health assertion CLI to accept `--release-id <id>` and reject a healthy response from the old process when an expected ID is supplied.

- [ ] **Step 4: Verify GREEN**

Run: `node --test server/pm2Contract.test.mjs scripts/assert-deploy-health.test.mjs server/processLifecycle.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.cjs server/index.mjs server/pm2Contract.test.mjs scripts/assert-deploy-health.mjs scripts/assert-deploy-health.test.mjs
git commit -m "feat(deploy): define pm2 graceful reload contract"
```

### Task 3: MySQL lock holder without process stop

**Files:**
- Create: `scripts/hold-deploy-job-lock.mjs`
- Create: `scripts/hold-deploy-job-lock.test.mjs`
- Reuse: `scripts/check-deploy-readiness.mjs`

**Interfaces:**
- Produces CLI: `node scripts/hold-deploy-job-lock.mjs --ready-file <path> --release-file <path>`.
- Ready file contains the existing `summarizeRunningJobs` JSON.
- The helper holds `LOCK TABLES internal_jobs WRITE` until the release file exists, then always unlocks and closes its connection. The release file must be written before PM2 reload so bootstrap cannot deadlock on `internal_jobs`.

- [ ] **Step 1: Write failing lock-holder tests**

Cover lock-before-query ordering, fail-closed behavior with a running job, ready acknowledgement before waiting, release-file completion, and `UNLOCK TABLES` in `finally`.

```js
assert.deepEqual(events.slice(0, 2), ['LOCK TABLES internal_jobs WRITE', 'SELECT running jobs']);
assert.equal(result.ready, true);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/hold-deploy-job-lock.test.mjs`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the lock holder**

Reuse `getDeployDbConfig` and `summarizeRunningJobs`; do not import or call a PM2 process manager. Use 250 ms release polling and a connection liveness query while waiting.

- [ ] **Step 4: Verify GREEN**

Run: `node --test scripts/hold-deploy-job-lock.test.mjs scripts/hold-deploy-drain.test.mjs scripts/deploy-readiness.test.mjs`

Expected: all tests PASS, including the preserved legacy emergency helper tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/hold-deploy-job-lock.mjs scripts/hold-deploy-job-lock.test.mjs
git commit -m "feat(deploy): hold job lock across graceful reload"
```

### Task 4: Replace stop/start release path with fail-safe reload

**Files:**
- Modify: `scripts/deploy_tencent.sh`
- Modify: `scripts/deploy_tencent.test.mjs`
- Modify: `scripts/deploy-lifecycle.mjs`
- Modify: `scripts/deploy-lifecycle.test.mjs`
- Modify: `server/deployDrain.mjs`
- Modify: `server/deployDrain.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Consumes: Task 2 expected release health check and Task 3 lock-holder CLI.
- Produces release sequence: marker → active writes zero → DB lock/final running check → lock release → atomic dist swap → `pm2 startOrReload` → expected-release health → marker removal.

- [ ] **Step 1: Rewrite deployment contract tests first**

First add failing request-tracker tests proving guarded writes increment before admission and decrement in `finally`, while GET is not counted. Then make source-level tests require an `activeWriteRequests === 0` health gate, `hold-deploy-job-lock.mjs`, release of the table lock before PM2, `MEIAO_RELEASE_ID`, `pm2 startOrReload ecosystem.config.cjs --update-env`, and expected-release health. Assert the normal remote payload contains no invocation of `backend-network-drain.mjs enter`, `pm2 stop meiao-internal`, `pm2 restart meiao-internal`, or `hold-deploy-drain.mjs`.

```js
assert.match(source, /pm2 startOrReload ecosystem\.config\.cjs --update-env/);
assert.doesNotMatch(normalPath, /pm2 (?:stop|restart) meiao-internal/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/deploy_tencent.test.mjs scripts/deploy-lifecycle.test.mjs`

Expected: FAIL because the current script deliberately drains the network and stops PM2.

- [ ] **Step 3: Implement the reload sequence and cleanup state machine**

Track guarded writes in `server/deployDrain.mjs`, wrap the real dispatcher in `try/finally`, and expose the count in health. Generate a unique release ID locally and pass it into remote PM2 environment. After the marker, wait for the count to remain zero, start the job-lock helper for the final running check, then release and join it before PM2 starts. Retain `dist-prev` until expected-release health passes. On failure, restore `dist-prev` when it exists; if any healthy PM2 instance remains, remove only the owned marker after restoring assets, otherwise retain the marker as `manual`. Never issue a stop command from automated cleanup.

- [ ] **Step 4: Verify GREEN and all deploy safety tests**

Run: `node --test scripts/deploy_tencent.test.mjs scripts/deploy-lifecycle.test.mjs scripts/deploy-ownership.test.mjs scripts/backend-network-drain.test.mjs scripts/hold-deploy-job-lock.test.mjs scripts/hold-deploy-drain.test.mjs`

Expected: all tests PASS; the network-drain utility remains tested but absent from the normal release path.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy_tencent.sh scripts/deploy_tencent.test.mjs scripts/deploy-lifecycle.mjs scripts/deploy-lifecycle.test.mjs server/deployDrain.mjs server/deployDrain.test.mjs server/index.mjs
git commit -m "fix(deploy): eliminate stop-start 502 window"
```

### Task 5: Regression record and complete local verification

**Files:**
- Modify: `docs/agents/repeated-issues.md`
- Modify: `docs/tencent-cloud-deploy.md`

**Interfaces:**
- Documents fingerprint: `deploy:single_upstream_stop_start:public_502`.

- [ ] **Step 1: Record the root cause and permanent invariant**

Document that normal deployment must keep at least one ready upstream, that aggregate health cannot replace expected release identity, and that paid-task drain remains fail-closed.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
node --test server/processLifecycle.test.mjs server/pm2Contract.test.mjs scripts/hold-deploy-job-lock.test.mjs scripts/deploy_tencent.test.mjs scripts/deploy-lifecycle.test.mjs
npm run test:server
npm run doctor
npm run build
```

Expected: all commands exit 0 with no failed tests.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/agents/repeated-issues.md docs/tencent-cloud-deploy.md
git commit -m "docs(deploy): record zero-downtime release invariant"
```

### Task 6: Cloud capability check, release, and zero-502 acceptance

**Files:**
- No new source files; validate the committed release artifacts.

**Interfaces:**
- Public probes: homepage and `/api/health`.
- Host probe: `http://127.0.0.1:3100/api/health`.

- [ ] **Step 1: Check remote capability without changing production state**

Verify PM2 version, cluster/startOrReload support, current marker/mutex absence, active jobs zero, current PM2 PID/mode, local host health, and Nginx upstream. Because the pre-fix process has no active-write metric, prepare the one-time 3101 candidate migration with a timestamped Nginx backup and explicit rollback commands. Stop if any requirement is unmet.

- [ ] **Step 2: Start continuous probes before release**

Run concurrent timestamped probes for public homepage and health at 200 ms intervals, recording HTTP code and curl exit status until after release completion.

- [ ] **Step 3: Publish the committed code through the gated script**

For the first migration only, start the committed server as a candidate on `127.0.0.1:3101`, verify its exact release health, atomically route Nginx to it, migrate the formal 3100 PM2 app to cluster mode, route Nginx back after exact release health, then remove the candidate. Subsequent releases run `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`.

Expected: lock readiness JSON has `runningCount: 0`; PM2 reports online cluster mode; expected release ID health passes; marker and mutex are removed.

- [ ] **Step 4: Prove zero-502 and version alignment**

Summarize probe totals and assert 0 public 502 and 0 connection failures. Verify host/public health, worker health, PM2 process identity, release ID, marker/mutex absence, key SHA-256 values, active bundle 200, and local/cloud/release-branch/main facts separately.

- [ ] **Step 5: Record the production fix**

Use the existing `npm run record-fix` workflow with fingerprint `deploy:single_upstream_stop_start:public_502`, commit IDs, exact verification commands, deployment result, and probe counts.
