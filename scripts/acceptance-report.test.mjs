import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAcceptanceReport } from './acceptance-report.mjs';

test('acceptance report includes required verification sections and commands', () => {
  const report = buildAcceptanceReport({
    environment: {
      localDoctorOk: false,
      apiHealthy: true,
      devHealthy: false,
    },
  });

  assert.match(report, /基础环境验收/);
  assert.match(report, /通用任务队列验收/);
  assert.match(report, /逐模块业务验收/);
  assert.match(report, /管理与排障验收/);
  assert.match(report, /npm run doctor/);
  assert.match(report, /localhost:3000/);
  assert.match(report, /127\.0\.0\.1:3100\/api\/health/);
});
