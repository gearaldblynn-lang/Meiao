import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDoctorReport,
  evaluateBackendReuse,
  evaluatePortOwnerReuse,
  formatDoctorReport,
  formatStartPlan,
} from './local-dev-utils.mjs';

test('doctor report warns when backend is up but vite is missing', () => {
  const report = buildDoctorReport({
    devServer: { listening: false, port: 3000, owner: '' },
    apiServer: { listening: true, port: 3100, owner: 'node(63465)' },
    proxyHealthy: false,
  });

  assert.equal(report.status, 'warning');
  assert.equal(report.checks.devServer.ok, false);
  assert.match(report.summary, /3000/);
  assert.match(report.summary, /Vite/);
});

test('doctor report is healthy when dev server, api server, and proxy are all ready', () => {
  const report = buildDoctorReport({
    devServer: { listening: true, port: 3000, owner: 'node(79045)' },
    apiServer: { listening: true, port: 3100, owner: 'node(63465)' },
    proxyHealthy: true,
  });

  assert.equal(report.status, 'ok');
  assert.equal(report.checks.proxy.ok, true);
  assert.match(formatDoctorReport(report), /localhost:3000/);
});

test('doctor report rejects healthy-looking ports owned by another worktree', () => {
  const report = buildDoctorReport({
    devServer: { listening: true, port: 3000, owner: 'node(26864)', workspaceOk: false },
    apiServer: { listening: true, port: 3100, owner: 'node(79976)', workspaceOk: false },
    proxyHealthy: true,
  });

  assert.equal(report.status, 'warning');
  assert.equal(report.checks.devServer.ok, false);
  assert.equal(report.checks.apiServer.ok, false);
  assert.match(report.summary, /其他版本或工作树/);
});

test('start plan flags occupied ports with actionable guidance', () => {
  const output = formatStartPlan({
    devServer: { listening: true, port: 3000, owner: 'python(1234)' },
    apiServer: { listening: false, port: 3100, owner: '' },
  });

  assert.match(output, /3000/);
  assert.match(output, /python/);
  assert.match(output, /已被占用/);
  assert.match(output, /3100/);
});

test('backend reuse is rejected when worker is reported dead', () => {
  const result = evaluateBackendReuse({
    ok: true,
    taskEngine: 'temporal',
    worker: { healthy: false, workflowPollers: 0, activityPollers: 0 },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /worker/i);
  assert.match(result.reason, /永远排队/);
  assert.match(result.reason, /kill/);
  assert.match(result.reason, /launchctl kickstart/);
});

test('backend reuse rejection surfaces worker probe error text', () => {
  const result = evaluateBackendReuse({
    ok: true,
    worker: { healthy: false, error: '14 UNAVAILABLE: No connection established' },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /14 UNAVAILABLE/);
});

test('backend reuse is allowed when worker is healthy', () => {
  const result = evaluateBackendReuse({
    ok: true,
    taskEngine: 'temporal',
    worker: { healthy: true, workflowPollers: 1, activityPollers: 1 },
  });

  assert.deepEqual(result, { ok: true });
});

test('backend reuse tolerates legacy health payload without worker field', () => {
  const result = evaluateBackendReuse({ ok: true, mode: 'internal-v1', taskEngine: 'internal' });

  assert.deepEqual(result, { ok: true });
});

test('backend reuse is rejected when health payload is not an object', () => {
  assert.equal(evaluateBackendReuse(null).ok, false);
  assert.equal(evaluateBackendReuse('nonsense').ok, false);
  assert.match(evaluateBackendReuse(null).reason, /kill/);
});

test('port reuse rejects a Node process started from another worktree', () => {
  const result = evaluatePortOwnerReuse({
    port: 3000,
    owner: 'node(26864)',
    processCwd: '/repo/.worktrees/old-release',
    expectedCwd: '/repo/current',
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /旧版本或其他工作树/);
  assert.match(result.reason, /old-release/);
  assert.match(result.reason, /current/);
});

test('port reuse allows a Node process started from the current project root', () => {
  const result = evaluatePortOwnerReuse({
    port: 3100,
    owner: 'node(88520)',
    processCwd: '/repo/current/',
    expectedCwd: '/repo/current',
  });

  assert.deepEqual(result, { ok: true });
});
