import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isModelReadableAssetUrl,
  resolveModelReadableAssetUrl,
  resolvePublicAssetUrl,
} from './modelAssetUrl.mjs';

test('model asset url helper rejects local preview urls', () => {
  assert.equal(isModelReadableAssetUrl('http://127.0.0.1:3100/api/assets/file/a.png'), false);
  assert.equal(isModelReadableAssetUrl('http://localhost:3100/api/assets/file/a.png'), false);
  assert.equal(resolveModelReadableAssetUrl('http://127.0.0.1:3100/api/assets/file/a.png'), '');
});

test('model asset url helper keeps public cloud urls', () => {
  const url = 'https://tempfile.redpandaai.co/kieai/30590/a.png';
  assert.equal(isModelReadableAssetUrl(url), true);
  assert.equal(resolveModelReadableAssetUrl(url), url);
});

test('model asset url helper rewrites managed local asset urls onto the configured public base', () => {
  const url = 'http://127.0.0.1:3100/api/assets/file/abc/demo.png';
  assert.equal(
    resolvePublicAssetUrl(url, 'https://assets.meiao.example'),
    'https://assets.meiao.example/api/assets/file/abc/demo.png',
  );
});

test('model asset url helper keeps managed asset paths for server-side model upload when no public base is usable', () => {
  assert.equal(resolvePublicAssetUrl('/api/assets/file/abc/demo.png', ''), '/api/assets/file/abc/demo.png');
  assert.equal(resolvePublicAssetUrl('/api/assets/file/abc/demo.png', 'http://127.0.0.1:3100'), '/api/assets/file/abc/demo.png');
  assert.equal(resolvePublicAssetUrl('/api/assets/file/abc/demo.png', 'http://localhost:3100'), '/api/assets/file/abc/demo.png');
  assert.equal(
    resolvePublicAssetUrl('http://127.0.0.1:3100/api/assets/file/abc/demo.png', 'http://localhost:3100'),
    '/api/assets/file/abc/demo.png',
  );
});

test('model asset url helper avoids leaking private managed hosts while preserving server-downloadable paths', () => {
  assert.equal(resolvePublicAssetUrl('/api/assets/file/abc/demo.png', 'http://10.0.0.8:3100'), '/api/assets/file/abc/demo.png');
  assert.equal(resolvePublicAssetUrl('/api/assets/file/abc/demo.png', 'http://172.16.2.8:3100'), '/api/assets/file/abc/demo.png');
  assert.equal(resolvePublicAssetUrl('/api/assets/file/abc/demo.png', 'http://192.168.1.8:3100'), '/api/assets/file/abc/demo.png');
  assert.equal(resolvePublicAssetUrl('/api/assets/file/abc/demo.png', 'http://169.254.1.8:3100'), '/api/assets/file/abc/demo.png');
  assert.equal(
    resolvePublicAssetUrl('http://127.0.0.1:3100/api/assets/file/abc/demo.png', 'http://192.168.1.8:3100'),
    '/api/assets/file/abc/demo.png',
  );
  assert.equal(resolvePublicAssetUrl('http://192.168.1.8:3100/not-managed.png', 'http://192.168.1.8:3100'), '');
});
