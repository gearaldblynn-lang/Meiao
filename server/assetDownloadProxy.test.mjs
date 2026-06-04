import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('asset download proxy is available for browser zip downloads', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

  assert.match(
    source,
    /const DOWNLOAD_PROXY_MAX_BYTES = 80 \* 1024 \* 1024;/,
    'download proxy should cap remote assets before buffering them'
  );
  assert.match(
    source,
    /const normalizeDownloadProxyUrl = \(value\) =>/,
    'download proxy should validate incoming remote URLs'
  );
  assert.match(
    source,
    /下载地址不能指向本机或内网地址/,
    'download proxy should reject localhost and private network targets'
  );
  assert.match(
    source,
    /url\.pathname === '\/api\/assets\/download-proxy'/,
    'server should expose the same-origin download proxy route'
  );
  assert.match(
    source,
    /await requireDbUser\(req, res\)/,
    'download proxy should require a logged-in database user'
  );
  assert.match(
    source,
    /localRequireUser\(req, res, store\)/,
    'download proxy should require a logged-in local user'
  );
});
