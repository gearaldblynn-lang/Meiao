import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const stateGetRoutes = () => [
  ...source.matchAll(/if \(url\.pathname === '\/api\/state' && req\.method === 'GET'\) \{[\s\S]*?json\(res, 200, \{ state: prepareStateForClient\([^}]+?\}\);\n    return;\n  \}/g),
].map((match) => match[0]);

const statePutRoutes = () => [
  ...source.matchAll(/if \(url\.pathname === '\/api\/state' && req\.method === 'PUT'\) \{[\s\S]*?json\(res, 200,[\s\S]*?\n    return;\n  \}/g),
].map((match) => match[0]);

test('api state GET stays read-only for cloud app_states', () => {
  const routes = stateGetRoutes();
  assert.equal(routes.length, 2);
  const dbRoute = routes[0];

  assert.match(dbRoute, /scrubDbStateForUnavailableManagedAssets\(await getDbAppState\(user\.id\), user\.id\)/);
  assert.doesNotMatch(dbRoute, /saveDbAppState/);
  assert.doesNotMatch(dbRoute, /runAppStateWriteWithoutBinlog/);
});

test('api state GET stays read-only for local app state fixture', () => {
  const routes = stateGetRoutes();
  assert.equal(routes.length, 2);
  const localRoute = routes[1];

  assert.match(localRoute, /scrubLocalStateForUnavailableManagedAssets\(store\.appStates\[user\.id\] \|\| createDefaultState\(\), user\.id\)/);
  assert.doesNotMatch(localRoute, /store\.appStates\[user\.id\]\s*=/);
  assert.doesNotMatch(localRoute, /writeLocalStore/);
});

test('api state PUT returns canonical merged state only when explicitly requested', () => {
  const routes = statePutRoutes();
  assert.equal(routes.length, 2);
  for (const route of routes) {
    assert.match(route, /body\.includeCanonicalState/);
    assert.match(route, /state: prepareStateForClient\(nextState\)/);
  }
});
