import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('user api persists short-video generation permission per account', () => {
  assert.match(source, /normalizeFeaturePermissions/);
  assert.match(source, /feature_permissions_json/);
  assert.match(source, /featurePermissions:\s*normalizeFeaturePermissions/);
  assert.match(source, /body\.featurePermissions/);
  assert.match(source, /createDbUser\(\{ username, password, role, displayName, jobConcurrency, featurePermissions \}\)/);
  assert.match(source, /targetUser\.featurePermissions = normalizeFeaturePermissions/);
  assert.match(source, /canUseVideoGenerationFeature/);
  assert.match(source, /\['dreamina_video', 'kie_seedance_video'\]\.includes\(body\.taskType\)/);
  assert.match(source, /短视频生成暂未对当前账号开放/);
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
