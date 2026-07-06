import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordCreditAlert,
  getCreditAlertSnapshot,
  maybeRecordCreditAlertLog,
  resetCreditAlertStateForTest,
} from './creditAlert.mjs';

const HOUR = 3600000;

test.beforeEach(() => {
  delete process.env.MEIAO_CREDIT_ALERT_THROTTLE_MS;
  resetCreditAlertStateForTest();
});

test('首次记录返回 shouldLogProminent=true', () => {
  const result = recordCreditAlert({ provider: 'kie', message: 'credits insufficient', now: 1000 });
  assert.equal(result.shouldLogProminent, true);
});

test('节流窗口内(默认1h)重复记录返回 false,但 count 继续累计', () => {
  recordCreditAlert({ provider: 'kie', message: 'first', now: 1000 });
  const second = recordCreditAlert({ provider: 'kie', message: 'second', now: 1000 + HOUR - 1 });
  assert.equal(second.shouldLogProminent, false);

  const snapshot = getCreditAlertSnapshot({ now: 1000 + HOUR - 1 });
  assert.equal(snapshot.kie.count, 2);
  assert.equal(snapshot.kie.lastMessage, 'second');
});

test('超过节流窗口后再次返回 true,并刷新节流钟', () => {
  recordCreditAlert({ provider: 'kie', message: 'first', now: 1000 });
  const afterWindow = recordCreditAlert({ provider: 'kie', message: 'again', now: 1000 + HOUR });
  assert.equal(afterWindow.shouldLogProminent, true);

  // 节流钟已刷新:紧跟着的第三次应被节流
  const third = recordCreditAlert({ provider: 'kie', message: 'third', now: 1000 + HOUR + 1 });
  assert.equal(third.shouldLogProminent, false);
});

test('节流窗口可用 MEIAO_CREDIT_ALERT_THROTTLE_MS 覆盖', () => {
  process.env.MEIAO_CREDIT_ALERT_THROTTLE_MS = '5000';
  recordCreditAlert({ provider: 'kie', message: 'first', now: 1000 });
  assert.equal(recordCreditAlert({ provider: 'kie', message: 'x', now: 5999 }).shouldLogProminent, false);
  assert.equal(recordCreditAlert({ provider: 'kie', message: 'y', now: 6000 }).shouldLogProminent, true);
});

test('多 provider 互相隔离:各自独立节流与计数', () => {
  recordCreditAlert({ provider: 'kie', message: 'kie down', now: 1000 });
  const other = recordCreditAlert({ provider: 'dreamina', message: 'dreamina down', now: 1001 });
  assert.equal(other.shouldLogProminent, true);

  const snapshot = getCreditAlertSnapshot({ now: 2000 });
  assert.equal(snapshot.kie.count, 1);
  assert.equal(snapshot.dreamina.count, 1);
  assert.equal(snapshot.dreamina.lastMessage, 'dreamina down');
});

test('无记录时快照返回空对象', () => {
  assert.deepEqual(getCreditAlertSnapshot({ now: 1000 }), {});
});

test('快照包含 lastAt/count/lastMessage/ageMs,且只读不改状态', () => {
  recordCreditAlert({ provider: 'kie', message: 'boom', now: 1000 });
  const snapshot = getCreditAlertSnapshot({ now: 4000 });
  assert.deepEqual(snapshot.kie, { lastAt: 1000, count: 1, lastMessage: 'boom', ageMs: 3000 });

  // 快照不刷新节流钟:窗口内记录仍被节流
  getCreditAlertSnapshot({ now: 1000 + HOUR + 1 });
  const again = getCreditAlertSnapshot({ now: 5000 });
  assert.deepEqual(again.kie, { lastAt: 1000, count: 1, lastMessage: 'boom', ageMs: 4000 });
});

test('maybeRecordCreditAlertLog:非余额错误不记录不写日志', async () => {
  const calls = [];
  await maybeRecordCreditAlertLog({
    error: { code: 'provider_internal_error', message: 'boom' },
    job: { provider: 'kie' },
    user: { id: 'u1', username: 'admin' },
    createLog: (payload) => calls.push(payload),
    now: 1000,
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(getCreditAlertSnapshot({ now: 1000 }), {});
});

test('maybeRecordCreditAlertLog:余额错误写一条显著日志,节流窗口内不重复写', async () => {
  const calls = [];
  const createLog = (payload) => calls.push(payload);
  const error = { code: 'provider_credit_insufficient', message: 'The current credits are insufficient' };
  const user = { id: 'u1', username: 'admin' };

  await maybeRecordCreditAlertLog({ error, job: { provider: 'kie' }, user, createLog, now: 1000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].level, 'error');
  assert.equal(calls[0].module, 'provider');
  assert.equal(calls[0].action, 'credit_alert');
  assert.match(calls[0].message, /余额不足/);

  await maybeRecordCreditAlertLog({ error, job: { provider: 'kie' }, user, createLog, now: 2000 });
  assert.equal(calls.length, 1, '节流窗口内不应重复写显著日志');
  assert.equal(getCreditAlertSnapshot({ now: 2000 }).kie.count, 2, '但 count 仍要累计');
});

test('maybeRecordCreditAlertLog:createLog 抛错不向外传播,不破坏失败链路', async () => {
  await assert.doesNotReject(() => maybeRecordCreditAlertLog({
    error: { code: 'provider_credit_insufficient', message: 'x' },
    job: { provider: 'kie' },
    user: { id: 'u1', username: 'admin' },
    createLog: () => { throw new Error('db down'); },
    now: 1000,
  }));
});

test('maybeRecordCreditAlertLog:缺 user/createLog 时仍记录状态,只是不写日志', async () => {
  await maybeRecordCreditAlertLog({
    error: { code: 'provider_credit_insufficient', message: 'x' },
    job: { provider: 'kie' },
    user: null,
    createLog: null,
    now: 1000,
  });
  assert.equal(getCreditAlertSnapshot({ now: 1000 }).kie.count, 1);
});
