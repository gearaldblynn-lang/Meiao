import { constants } from 'node:fs';
import { lstat, open, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const modelProviderSyntheticFixture = ['sk', 'raw', 'should', 'never', 'return'].join('-');
const managedAssetSyntheticFixture = ['new', 'managed', 'asset', 'secret', '32', 'bytes'].join('-');
const strippedProviderSyntheticFixture = ['sk', 'should', 'never', 'leak'].join('-');
const documentedRuntimeReference = ['contextLimits', 'maxOutputTokens'].join('.');

const exactSyntheticAllowlist = new Map([
  ['fixtures/allowed-secrets.txt', new Set([
    'sk-test',
    'sk-xxxx',
    'unit-test-provider-credential',
  ])],
  ['server/modelProviderRegistry.test.mjs', new Set([
    modelProviderSyntheticFixture,
  ])],
  ['server/managedAssetAccessKey.test.mjs', new Set([
    managedAssetSyntheticFixture,
  ])],
  ['server/smartFactoryConfigStore.test.mjs', new Set([
    strippedProviderSyntheticFixture,
  ])],
  ['docs/superpowers/plans/2026-06-16-生图工具调用.md', new Set([
    documentedRuntimeReference,
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

const assignment = /^\s*(?:-\s+)?(?:export\s+)?(["']?)(?:[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*|api[_-]?key|secret|token|password)\1\s*[:=]\s*(?:["']([A-Za-z0-9_+./:@=-]{20,})["']|([A-Za-z0-9_+./:@=?-]{20,}))(?:\s*[,;])?(?:\s+#.*)?\s*$/gi;
const javascriptExtensions = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);
const javascriptIdentifierReference = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const javascriptMemberReference = /^[A-Za-z_$][A-Za-z0-9_$]*(?:(?:\?\.|\.)[A-Za-z_$][A-Za-z0-9_$]*|\[(?:\d+|[A-Za-z_$][A-Za-z0-9_$]*|["'][^"'\r\n]+["'])\])+$/;
const defaultReadOperations = { lstat, open, readlink };

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

function isUnquotedJavaScriptDynamicReference(file, value, isUnquoted) {
  return isUnquoted
    && javascriptExtensions.has(path.extname(file).toLowerCase())
    && (javascriptMemberReference.test(value) || javascriptIdentifierReference.test(value));
}

function sanitizeFindingPath(file, matchedValues) {
  return [...new Set(matchedValues)].reduce(
    (current, matchedValue) => current.split(matchedValue).join('[redacted]'),
    file,
  );
}

function isTrackedPathInsideRoot(root, file) {
  if (!file || path.isAbsolute(file)) return false;
  const relative = path.relative(root, path.resolve(root, file));
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function sameSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

export async function readTrackedBytes(absolute, operations = defaultReadOperations) {
  const pathBefore = await operations.lstat(absolute, { bigint: true });
  if (pathBefore.isSymbolicLink()) {
    const bytes = await operations.readlink(absolute, { encoding: 'buffer' });
    const pathAfter = await operations.lstat(absolute, { bigint: true });
    if (
      !pathAfter.isSymbolicLink()
      || !sameSnapshot(pathBefore, pathAfter)
      || BigInt(bytes.byteLength) !== pathAfter.size
    ) {
      throw scanFailure();
    }
    return bytes;
  }
  if (!pathBefore.isFile()) throw scanFailure();

  const handle = await operations.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameSnapshot(pathBefore, before)) throw scanFailure();
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await operations.lstat(absolute, { bigint: true });
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
  const topLevelResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (topLevelResult.error || topLevelResult.status !== 0) throw scanFailure();
  const topLevel = await realpath(topLevelResult.stdout.trim());
  if (topLevel !== root) throw scanFailure();

  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root });
  if (tracked.error || tracked.status !== 0) throw scanFailure();

  const findings = [];
  for (const file of tracked.stdout.toString('utf8').split('\0').filter(Boolean)) {
    if (!isTrackedPathInsideRoot(root, file)) throw scanFailure();
    const bytes = await readTrackedBytes(path.resolve(root, file));
    if (bytes.includes(0)) continue;

    const fileFindings = [];
    for (const [lineIndex, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
      for (const [rule, pattern] of rules) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          if (exactSyntheticAllowlist.get(file)?.has(match[0])) continue;
          fileFindings.push({
            line: lineIndex + 1,
            rule,
            length: match[0].length,
            matchedValue: match[0],
          });
        }
      }
      assignment.lastIndex = 0;
      for (const match of line.matchAll(assignment)) {
        const value = match[2] || match[3];
        if (exactSyntheticAllowlist.get(file)?.has(value)) continue;
        if (isUnquotedJavaScriptDynamicReference(file, value, Boolean(match[3]))) continue;
        if (!isDirectCredentialValue(value) && new Set(value).size >= 10 && entropy(value) >= 3.5) {
          fileFindings.push({
            line: lineIndex + 1,
            rule: 'high_entropy_assignment',
            length: value.length,
            matchedValue: value,
          });
        }
      }
    }
    const safeFile = sanitizeFindingPath(file, fileFindings.map(({ matchedValue }) => matchedValue));
    findings.push(...fileFindings.map(({ matchedValue, ...finding }) => ({ ...finding, file: safeFile })));
  }

  findings.sort((left, right) => left.file.localeCompare(right.file)
    || left.line - right.line
    || left.rule.localeCompare(right.rule));
  console.log(JSON.stringify({ findings }));
  if (findings.length) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.stderr.write('secret_scan_failed\n');
    process.exitCode = 1;
  }
}
