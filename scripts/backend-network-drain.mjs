import { execFile } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const defaultRunCommand = async (command, args) => {
  const result = await execFileAsync(command, args, { encoding: 'utf8' });
  return String(result.stdout || '');
};

export const buildBackendNetworkDrainRules = (comment) => [
  {
    chain: 'OUTPUT',
    args: [
      '-p', 'tcp', '-d', '127.0.0.1', '--dport', '3100',
      '-m', 'conntrack', '--ctstate', 'NEW',
      '-m', 'comment', '--comment', comment,
      '-j', 'REJECT', '--reject-with', 'tcp-reset',
    ],
  },
  {
    chain: 'INPUT',
    args: [
      '-p', 'tcp', '--dport', '3100',
      '-m', 'conntrack', '--ctstate', 'NEW',
      '-m', 'comment', '--comment', comment,
      '-j', 'REJECT', '--reject-with', 'tcp-reset',
    ],
  },
];

export const exitBackendNetworkDrain = async ({ state, runCommand = defaultRunCommand }) => {
  const rules = Array.isArray(state?.rules) ? [...state.rules].reverse() : [];
  const failures = [];
  for (const rule of rules) {
    try {
      await runCommand('iptables', ['-D', rule.chain, ...rule.args]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
};

export const enterBackendNetworkDrain = async ({
  comment,
  stableZeroSamples = 5,
  timeoutMs = 120_000,
  pollIntervalMs = 500,
  runCommand = defaultRunCommand,
  sleep: wait = sleep,
  now = Date.now,
  persistState = () => {},
}) => {
  if (!String(comment || '').trim()) throw new Error('network drain comment is required');
  await runCommand('iptables', ['--version']);
  await runCommand('ss', ['--version']);

  const state = { comment, rules: [] };
  persistState(state);
  try {
    for (const rule of buildBackendNetworkDrainRules(comment)) {
      await runCommand('iptables', ['-I', rule.chain, '1', ...rule.args]);
      state.rules.push(rule);
      persistState(state);
    }

    const startedAt = now();
    let consecutiveZeroSamples = 0;
    while (consecutiveZeroSamples < stableZeroSamples) {
      if (now() - startedAt > timeoutMs) {
        throw new Error('backend connections did not drain before timeout');
      }
      const output = await runCommand('ss', [
        '-Htn', 'state', 'established',
        '( sport = :3100 or dport = :3100 )',
      ]);
      const activeConnections = String(output || '').split('\n').filter(Boolean).length;
      consecutiveZeroSamples = activeConnections === 0 ? consecutiveZeroSamples + 1 : 0;
      if (consecutiveZeroSamples < stableZeroSamples) await wait(pollIntervalMs);
    }
    return state;
  } catch (error) {
    await exitBackendNetworkDrain({ state, runCommand }).catch(() => {});
    throw error;
  }
};

const readOption = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
};

const run = async () => {
  const action = String(process.argv[2] || '').trim();
  const stateFile = readOption('--state-file');
  if (!stateFile) throw new Error('backend-network-drain requires --state-file.');

  if (action === 'enter') {
    const comment = readOption('--comment');
    try {
      const state = await enterBackendNetworkDrain({
        comment,
        persistState: (nextState) => writeFileSync(stateFile, `${JSON.stringify(nextState)}\n`, { mode: 0o600 }),
      });
      writeFileSync(stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      return;
    } catch (error) {
      rmSync(stateFile, { force: true });
      throw error;
    }
  }

  if (action === 'exit') {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    await exitBackendNetworkDrain({ state });
    rmSync(stateFile, { force: true });
    return;
  }

  throw new Error('backend-network-drain action must be enter or exit.');
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution) {
  try {
    await run();
  } catch (error) {
    console.error(error?.message || String(error || ''));
    process.exitCode = 2;
  }
}
