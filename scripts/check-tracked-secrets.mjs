import { constants } from 'node:fs';
import { lstat, open, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const exactSyntheticAllowlist = new Map([
  ['fixtures/allowed-secrets.txt', new Set([
    'sk-test',
    'sk-xxxx',
    'unit-test-provider-credential',
  ])],
]);

const rules = [
  ['pem_private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['tencent_secret_id', /\bAKID[A-Za-z0-9]{32}\b/g],
  ['google_api_key', /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['provider_token', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['credential_url', /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/g],
];

const assignment = /^\s*(?:-\s+)?(?:export\s+)?["']?(?:[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*|api[_-]?key|secret|token|password)["']?\s*[:=]\s*(?:["']([^"'\r\n]{20,})["']|([A-Za-z0-9_+./:@-]{20,}))(?:\s+#.*)?\s*$/gi;

function scanFailure() {
  return new Error('secret_scan_failed');
}

function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function isDirectCredentialValue(value) {
  return rules.some(([, pattern]) => {
    pattern.lastIndex = 0;
    return [...value.matchAll(pattern)].some((match) => match[0] === value);
  });
}

function isTrackedPathInsideRoot(root, file) {
  if (!file || path.isAbsolute(file)) return false;
  const relative = path.relative(root, path.resolve(root, file));
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function sameSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

async function readTrackedBytes(absolute) {
  const pathBefore = await lstat(absolute, { bigint: true });
  if (pathBefore.isSymbolicLink()) {
    return Buffer.from(await readlink(absolute), 'utf8');
  }
  if (!pathBefore.isFile()) throw scanFailure();

  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameSnapshot(pathBefore, before)) throw scanFailure();
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolute, { bigint: true });
    if (
      !pathAfter.isFile()
      || !sameSnapshot(before, after)
      || !sameSnapshot(after, pathAfter)
      || BigInt(bytes.byteLength) !== after.size
    ) {
      throw scanFailure();
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseRoot(rawArgs) {
  if (rawArgs.length === 0) return process.cwd();
  if (rawArgs.length === 2 && rawArgs[0] === '--root' && path.isAbsolute(rawArgs[1])) {
    return rawArgs[1];
  }
  throw scanFailure();
}

async function main() {
  const root = await realpath(parseRoot(process.argv.slice(2)));
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root });
  if (tracked.error || tracked.status !== 0) throw scanFailure();

  const findings = [];
  for (const file of tracked.stdout.toString('utf8').split('\0').filter(Boolean)) {
    if (!isTrackedPathInsideRoot(root, file)) throw scanFailure();
    const bytes = await readTrackedBytes(path.resolve(root, file));
    if (bytes.includes(0)) continue;

    for (const [lineIndex, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
      for (const [rule, pattern] of rules) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          if (exactSyntheticAllowlist.get(file)?.has(match[0])) continue;
          findings.push({ file, line: lineIndex + 1, rule, length: match[0].length });
        }
      }
      assignment.lastIndex = 0;
      for (const match of line.matchAll(assignment)) {
        const value = match[1] || match[2];
        if (exactSyntheticAllowlist.get(file)?.has(value)) continue;
        if (!isDirectCredentialValue(value) && new Set(value).size >= 10 && entropy(value) >= 3.5) {
          findings.push({ file, line: lineIndex + 1, rule: 'high_entropy_assignment', length: value.length });
        }
      }
    }
  }

  findings.sort((left, right) => left.file.localeCompare(right.file)
    || left.line - right.line
    || left.rule.localeCompare(right.rule));
  console.log(JSON.stringify({ findings }));
  if (findings.length) process.exitCode = 1;
}

try {
  await main();
} catch {
  process.stderr.write('secret_scan_failed\n');
  process.exitCode = 1;
}
