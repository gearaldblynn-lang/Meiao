import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDoctorReport,
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
