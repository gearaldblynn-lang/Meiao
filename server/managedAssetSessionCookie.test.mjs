import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildManagedAssetSessionCookie,
  getManagedAssetSessionToken,
} from './managedAssetSessionCookie.mjs';

test('asset session cookie is http-only, same-site, asset-scoped, and shared by apex and www', () => {
  const cookie = buildManagedAssetSessionCookie('session-token', {
    publicBaseUrl: 'https://meiaoyuntai.com',
    maxAgeSeconds: 3600,
  });

  assert.match(cookie, /^MEIAO_ASSET_SESSION=session-token;/);
  assert.match(cookie, /Path=\/api\/assets\/file\//);
  assert.match(cookie, /Domain=meiaoyuntai\.com/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
});

test('asset session token is read only from the dedicated cookie', () => {
  assert.equal(getManagedAssetSessionToken({
    headers: {
      cookie: 'sidebar=open; MEIAO_ASSET_SESSION=asset-token%2Bsafe; other=value',
    },
  }), 'asset-token+safe');
  assert.equal(getManagedAssetSessionToken({ headers: { cookie: 'session=wrong-cookie' } }), '');
});

test('clearing the asset session cookie preserves the same scope', () => {
  const cookie = buildManagedAssetSessionCookie('', {
    publicBaseUrl: 'https://www.meiaoyuntai.com',
    clear: true,
  });

  assert.match(cookie, /^MEIAO_ASSET_SESSION=;/);
  assert.match(cookie, /Domain=meiaoyuntai\.com/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Path=\/api\/assets\/file\//);
});

test('every authenticated API boundary repairs a missing asset media cookie', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

  assert.match(
    source,
    /const refreshManagedAssetSessionCookie = \(req, res\) =>[\s\S]{0,500}getManagedAssetSessionToken\(req\)[\s\S]{0,500}setManagedAssetSessionCookie\(res, token, req\)/,
  );
  assert.match(
    source,
    /const requireDbUser = async \(req, res\) =>[\s\S]{0,700}refreshManagedAssetSessionCookie\(req, res\)[\s\S]{0,100}return user/,
  );
  assert.match(
    source,
    /const localRequireUser = \(req, res, store\) =>[\s\S]{0,500}refreshManagedAssetSessionCookie\(req, res\)[\s\S]{0,100}return user/,
  );
});
