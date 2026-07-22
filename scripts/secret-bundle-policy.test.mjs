import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDotenvText,
  serializeDotenv,
  validateFriendSecretEntries,
} from './secret-bundle-policy.mjs';

test('friend bundle accepts provider and COS keys without exposing values', () => {
  const entries = parseDotenvText([
    'KIE_API_KEY=unit-test-kie-credential',
    'MEIAO_COS_SECRET_ID=unit-test-cos-id',
    'MEIAO_COS_SECRET_KEY=unit-test-cos-key',
  ].join('\n'));
  assert.deepEqual(validateFriendSecretEntries(entries), { ok: true, keys: [
    'KIE_API_KEY', 'MEIAO_COS_SECRET_ID', 'MEIAO_COS_SECRET_KEY',
  ] });
  assert.doesNotMatch(serializeDotenv(entries), /undefined|null/);
});

test('friend bundle rejects production infrastructure and unknown keys', () => {
  for (const key of ['MEIAO_DB_PASSWORD', 'MEIAO_ADMIN_PASSWORD', 'SSH_PRIVATE_KEY', 'UNKNOWN_TOKEN']) {
    const result = validateFriendSecretEntries(new Map([[key, 'unit-test-sensitive-value']]));
    assert.equal(result.ok, false);
    assert.deepEqual(result.rejectedKeys, [key, '__bundle__'].sort());
    assert.equal(result.reasons.__bundle__, 'provider_credential_required');
  }
});

test('friend bundle rejects a prototype-named unknown key deterministically', () => {
  const result = validateFriendSecretEntries(new Map([
    ['KIE_API_KEY', 'unit-test-kie-credential'],
    ['__proto__', 'unit-test-sensitive-value'],
  ]));
  assert.equal(result.ok, false);
  assert.deepEqual(result.rejectedKeys, ['__proto__']);
  assert.equal(Object.hasOwn(result.reasons, '__proto__'), true);
  assert.equal(result.reasons.__proto__, 'unknown_key');
});

test('friend bundle requires at least one provider credential', () => {
  const result = validateFriendSecretEntries(new Map([
    ['MEIAO_COS_BUCKET', 'unit-test-bucket'],
    ['MEIAO_COS_REGION', 'ap-guangzhou'],
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.reasons.__bundle__, 'provider_credential_required');
});

test('friend bundle rejects visibly truncated sensitive values', () => {
  const result = validateFriendSecretEntries(new Map([['KIE_API_KEY', 'short']]));
  assert.equal(result.ok, false);
  assert.equal(result.reasons.KIE_API_KEY, 'truncated_sensitive_value');
});

test('dotenv parsing rejects conflicting duplicate keys and multiline values', () => {
  assert.throws(() => parseDotenvText('KIE_API_KEY=unit-test-a\nKIE_API_KEY=unit-test-b'));
  assert.throws(() => parseDotenvText('KIE_API_KEY="line1\nline2"'));
});

test('dotenv parsing rejects NUL decoded from a double-quoted Unicode escape', () => {
  assert.throws(() => parseDotenvText('KIE_API_KEY="unit-test-\\u0000credential"'));
});
