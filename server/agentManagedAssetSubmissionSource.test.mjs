import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const getFunctionSource = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

test('shared agent image conversation submits analysis and generation with current owner context', () => {
  const functionSource = getFunctionSource(
    'const buildImageConversationResult = async',
    'const findLocalUserById =',
  );
  assert.match(
    functionSource,
    /executeProviderJobWithManagedAssetScrub\(\{\s*userId: user\.id,\s*taskType: 'kie_chat',/,
  );
  assert.match(
    functionSource,
    /executeProviderJobWithManagedAssetScrub\(\{\s*userId: user\.id,\s*taskType: 'kie_image',/,
  );
});

test('every agent kie image submission carries current owner context', () => {
  const ownedImageCalls = Array.from(source.matchAll(
    /executeProviderJobWithManagedAssetScrub\(\{\s*userId: user\.id,\s*taskType: 'kie_image',/g,
  ));
  assert.equal(ownedImageCalls.length, 3, 'shared, mysql tool-calling, and local tool-calling image submissions must stay covered');
});

test('agent model calls that can carry managed image references keep owner context', () => {
  const ownedResponsesCalls = Array.from(source.matchAll(
    /executeProviderJobWithManagedAssetScrub\(\{\s*userId: user\.id,\s*taskType: 'openai_responses',/g,
  ));
  assert.equal(ownedResponsesCalls.length, 2, 'mysql and local tool planners must carry user.id');
  assert.match(source, /const runAgenticRetrievalLoop = async \(\{[\s\S]*?userId,[\s\S]*?executeProviderJobWithManagedAssetScrub\(\{\s*userId,\s*taskType: 'kie_chat',/);
  const retrievalCallers = Array.from(source.matchAll(
    /runAgenticRetrievalLoop\(\{[\s\S]{0,500}?userId: user\.id,/g,
  ));
  assert.equal(retrievalCallers.length, 2, 'mysql and local retrieval callers must pass user.id');
  const ownedDirectChatCalls = Array.from(source.matchAll(
    /executeProviderJobWithManagedAssetScrub\(\{\s*userId: user\.id,\s*taskType: 'kie_chat',/g,
  ));
  assert.ok(ownedDirectChatCalls.length >= 3, 'mysql, local, and shared image-analysis chat calls must carry user.id');
});

test('managed asset submission guard is wired before and after payload scrubbing', () => {
  assert.match(source, /assertManagedAssetSubmissionUserContext\(\{\s*payload: job\?\.payload,\s*userId: job\?\.userId,/);
  assert.match(source, /assertManagedImageInputsPreserved\(\{\s*taskType,\s*originalPayload: job\?\.payload,\s*scrubbedPayload,/);
});
