import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const policySource = readFileSync(new URL('./jobSubmissionPolicy.mjs', import.meta.url), 'utf8');

const countMatches = (pattern) => source.match(pattern)?.length || 0;

test('user api persists short-video generation permission per account', () => {
  assert.match(source, /normalizeFeaturePermissions/);
  assert.match(source, /feature_permissions_json/);
  assert.match(source, /featurePermissions:\s*normalizeFeaturePermissions/);
  assert.match(source, /body\.featurePermissions/);
  // 锁"featurePermissions 必须传进 createDbUser 持久化",不锁参数全集——
  // 旧断言把参数列表写死,19d5c4b 加 creditLimitMode/creditBalance 后误报失败(功能本身完好)。
  assert.match(source, /createDbUser\(\{ username, password, role, displayName, jobConcurrency, featurePermissions\b[^)]*\}\)/);
  assert.match(source, /targetUser\.featurePermissions = normalizeFeaturePermissions/);
  assert.match(source, /canUseVideoGenerationFeature/);
  assert.match(source, /resolveJobSubmissionPolicy/);
  assert.equal(countMatches(/resolveAuthorizedJobSubmissionPolicy\(user, body, \{/g), 2);
  assert.equal(countMatches(
    /resolveAuthorizedJobSubmissionPolicy\(user, prepared\.body, \{\s*submissionOperation:\s*'retry'/g,
  ), 2);
  assert.equal(countMatches(/submissionOperation:\s*'recover'/g), 2);
  assert.doesNotMatch(source, /\['dreamina_video', 'kie_seedance_video'\]\.includes\(body\.taskType\)/);
  assert.match(policySource, /短视频生成暂未对当前账号开放/);
});

test('paid MySQL job creation is serialized across dedupe reserve and create', () => {
  assert.match(source, /createSerializedJobSubmission/);
  assert.match(source, /findReusableJob:\s*findReusableJobRecord/);
  assert.match(source, /reserveCredits:\s*reserveDbJobCreditsForSubmission/);
  assert.match(source, /createJob:\s*createDbJobRecordWithReservation/);
  assert.match(source, /createSerializedJobSubmission[\s\S]*withMysqlTransaction/);
  assert.doesNotMatch(source, /releaseCredits:\s*releaseDbAccountCredits/);
  assert.match(source, /lockTimeoutSeconds:\s*getJobSubmissionLockTimeoutSeconds\(process\.env\)/);
  assert.match(source, /error\?\.statusCode && error\?\.code[\s\S]{0,240}json\(res, error\.statusCode/);
});

test('user api persists planning analysis model and supports admin broadcast override', () => {
  assert.match(source, /analysis_model/);
  assert.match(source, /analysisModel:\s*normalizeUserAnalysisModel/);
  assert.match(source, /body\.analysisModel/);
  assert.match(source, /updateDbAllUsersAnalysisModel/);
  assert.match(source, /updateLocalAllUsersAnalysisModel/);
  assert.match(source, /\/api\/system\/analysis-model\/broadcast/);
  assert.match(source, /requireDbAdmin\(req, res\)/);
  assert.match(source, /localRequireAdmin\(req, res, store\)/);
});
