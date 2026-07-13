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
      command: 'iptables',
      chain: 'OUTPUT',
      args: ['-p', 'tcp', '-d', '127.0.0.1', '--dport', '3100', '-m', 'conntrack', '--ctstate', 'NEW', '-m', 'comment', '--comment', 'meiao-deploy-test', '-j', 'REJECT', '--reject-with', 'tcp-reset'],
    },
    {
      command: 'iptables',
      chain: 'INPUT',
      args: ['-p', 'tcp', '--dport', '3100', '-m', 'conntrack', '--ctstate', 'NEW', '-m', 'comment', '--comment', 'meiao-deploy-test', '-j', 'REJECT', '--reject-with', 'tcp-reset'],
    },
    {
      command: 'ip6tables',
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

  assert.equal(state.rules.length, 3);
  assert.deepEqual(calls.slice(0, 3), [
    ['iptables', ['--version']],
    ['ip6tables', ['--version']],
    ['ss', ['--version']],
  ]);
  assert.deepEqual(calls.filter(([, args]) => args[0] === '-I'), [
    ['iptables', ['-I', 'OUTPUT', '1', ...state.rules[0].args]],
    ['iptables', ['-I', 'INPUT', '1', ...state.rules[1].args]],
    ['ip6tables', ['-I', 'INPUT', '1', ...state.rules[2].args]],
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
  assert.deepEqual(calls.slice(-2), [
    ['iptables', ['-C', outputRule.chain, ...outputRule.args]],
    ['iptables', ['-D', outputRule.chain, ...outputRule.args]],
  ]);
});

test('network drain cleanup checks and deletes exact command-specific rules in reverse order', async () => {
  const calls = [];
  const rules = buildBackendNetworkDrainRules('meiao-deploy-test');
  await exitBackendNetworkDrain({
    state: { comment: 'meiao-deploy-test', rules },
    runCommand: async (command, args) => { calls.push([command, args]); return ''; },
  });
  assert.deepEqual(calls, [
    ['ip6tables', ['-C', 'INPUT', ...rules[2].args]],
    ['ip6tables', ['-D', 'INPUT', ...rules[2].args]],
    ['iptables', ['-C', 'INPUT', ...rules[1].args]],
    ['iptables', ['-D', 'INPUT', ...rules[1].args]],
    ['iptables', ['-C', 'OUTPUT', ...rules[0].args]],
    ['iptables', ['-D', 'OUTPUT', ...rules[0].args]],
  ]);
});

test('network drain cleanup persists remaining rules after partial delete and retries safely', async () => {
  const rules = buildBackendNetworkDrainRules('meiao-deploy-test');
  const persisted = [];
  await assert.rejects(
    () => exitBackendNetworkDrain({
      state: { comment: 'meiao-deploy-test', rules },
      persistState: (state) => persisted.push(structuredClone(state)),
      runCommand: async (command, args) => {
        if (command === 'iptables' && args[0] === '-C' && args[1] === 'INPUT') {
          throw Object.assign(new Error('iptables check failed'), { code: 2 });
        }
        return '';
      },
    }),
    /iptables check failed/,
  );
  assert.deepEqual(persisted.at(-1).rules, rules.slice(0, 2));

  const retryCalls = [];
  const retryPersisted = [];
  await exitBackendNetworkDrain({
    state: persisted.at(-1),
    persistState: (state) => retryPersisted.push(structuredClone(state)),
    runCommand: async (command, args) => {
      retryCalls.push([command, args]);
      if (command === 'iptables' && args[0] === '-C' && args[1] === 'INPUT') {
        throw Object.assign(new Error('rule already absent'), { code: 1 });
      }
      return '';
    },
  });
  assert.equal(retryCalls.some(([, args]) => args[0] === '-D' && args[1] === 'INPUT'), false);
  assert.deepEqual(retryPersisted.at(-1).rules, []);
});

test('partial install cleanup failure preserves recoverable state and surfaces cleanup error', async () => {
  const persisted = [];
  await assert.rejects(
    () => enterBackendNetworkDrain({
      comment: 'meiao-deploy-test',
      persistState: (state) => persisted.push(structuredClone(state)),
      runCommand: async (command, args) => {
        if (command === 'iptables' && args[0] === '-I' && args[1] === 'INPUT') {
          throw new Error('install failed');
        }
        if (command === 'iptables' && args[0] === '-C' && args[1] === 'OUTPUT') {
          throw Object.assign(new Error('cleanup check failed'), { code: 2 });
        }
        return '';
      },
      sleep: async () => {},
    }),
    (error) => error?.code === 'network_drain_cleanup_failed'
      && error?.preserveNetworkDrainState === true
      && /install failed/.test(error.message)
      && /cleanup check failed/.test(error.message),
  );
  assert.deepEqual(persisted.at(-1).rules, [buildBackendNetworkDrainRules('meiao-deploy-test')[0]]);
});
