import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBackendNetworkDrainRules,
  enterBackendNetworkDrain,
  exitBackendNetworkDrain,
} from './backend-network-drain.mjs';

test('network drain blocks exact NEW proxy and direct backend connections', () => {
  const rules = buildBackendNetworkDrainRules('meiao-deploy-test');
  assert.deepEqual(rules, [
    {
      chain: 'OUTPUT',
      args: ['-p', 'tcp', '-d', '127.0.0.1', '--dport', '3100', '-m', 'conntrack', '--ctstate', 'NEW', '-m', 'comment', '--comment', 'meiao-deploy-test', '-j', 'REJECT', '--reject-with', 'tcp-reset'],
    },
    {
      chain: 'INPUT',
      args: ['-p', 'tcp', '--dport', '3100', '-m', 'conntrack', '--ctstate', 'NEW', '-m', 'comment', '--comment', 'meiao-deploy-test', '-j', 'REJECT', '--reject-with', 'tcp-reset'],
    },
  ]);
});

test('network drain validates commands, installs rules, and waits for stable zero established connections', async () => {
  const calls = [];
  const establishedCounts = [1, 0, 0, 0];
  const state = await enterBackendNetworkDrain({
    comment: 'meiao-deploy-test',
    stableZeroSamples: 3,
    timeoutMs: 1000,
    pollIntervalMs: 1,
    runCommand: async (command, args) => {
      calls.push([command, args]);
      if (command === 'ss' && args[0] !== '--version') {
        const count = establishedCounts.shift() ?? 0;
        return Array.from({ length: count }, () => 'ESTAB connection').join('\n');
      }
      return '';
    },
    sleep: async () => {},
    now: (() => { let value = 0; return () => value += 10; })(),
  });

  assert.equal(state.rules.length, 2);
  assert.deepEqual(calls.slice(0, 2), [
    ['iptables', ['--version']],
    ['ss', ['--version']],
  ]);
  assert.deepEqual(calls.filter(([command, args]) => command === 'iptables' && args[0] === '-I').map(([, args]) => args), [
    ['-I', 'OUTPUT', '1', ...state.rules[0].args],
    ['-I', 'INPUT', '1', ...state.rules[1].args],
  ]);
  assert.equal(calls.filter(([command]) => command === 'ss').length, 5);
});

test('partial network drain install removes only exact rules that were added and rejects', async () => {
  const calls = [];
  await assert.rejects(
    () => enterBackendNetworkDrain({
      comment: 'meiao-deploy-test',
      runCommand: async (command, args) => {
        calls.push([command, args]);
        if (command === 'iptables' && args[0] === '-I' && args[1] === 'INPUT') {
          throw new Error('iptables insert failed');
        }
        return '';
      },
      sleep: async () => {},
    }),
    /iptables insert failed/,
  );

  const outputRule = buildBackendNetworkDrainRules('meiao-deploy-test')[0];
  assert.deepEqual(calls.at(-1), ['iptables', ['-D', outputRule.chain, ...outputRule.args]]);
});

test('network drain cleanup deletes the exact installed rules in reverse order', async () => {
  const calls = [];
  const rules = buildBackendNetworkDrainRules('meiao-deploy-test');
  await exitBackendNetworkDrain({
    state: { comment: 'meiao-deploy-test', rules },
    runCommand: async (command, args) => { calls.push([command, args]); return ''; },
  });
  assert.deepEqual(calls, [
    ['iptables', ['-D', 'INPUT', ...rules[1].args]],
    ['iptables', ['-D', 'OUTPUT', ...rules[0].args]],
  ]);
});
