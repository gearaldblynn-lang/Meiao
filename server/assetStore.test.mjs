import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_RETENTION_MS,
  buildAssetPublicPath,
  buildAssetPublicUrl,
  ensureAssetSchema,
  extractStoredAssetIdFromPublicUrl,
  getPublicBaseUrl,
  optimizeMp4BufferForStreaming,
  sanitizeAssetName,
  shouldRetainAssetRecord,
} from './assetStore.mjs';

const atom = (type, payload = Buffer.alloc(0)) => {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, 'latin1');
  payload.copy(output, 8);
  return output;
};

const findAtomOffset = (buffer, type) => buffer.indexOf(Buffer.from(type, 'latin1'));

test('sanitizeAssetName keeps extension and removes unsafe chars', () => {
  assert.equal(sanitizeAssetName('海报 图(1).png'), '_____1_.png');
  assert.equal(sanitizeAssetName('abc.jpg'), 'abc.jpg');
});

test('buildAssetPublicUrl returns internal absolute asset route', () => {
  assert.equal(buildAssetPublicPath('asset_123', 'poster.jpg'), '/api/assets/file/asset_123/poster.jpg');
  assert.equal(
    buildAssetPublicUrl('https://meiao.example.com', 'asset_123', 'poster.jpg'),
    'https://meiao.example.com/api/assets/file/asset_123/poster.jpg'
  );
});

test('extractStoredAssetIdFromPublicUrl reads managed asset ids from relative and absolute urls', () => {
  assert.equal(extractStoredAssetIdFromPublicUrl('/api/assets/file/asset_123/poster.jpg'), 'asset_123');
  assert.equal(extractStoredAssetIdFromPublicUrl('https://meiao.example.com/api/assets/file/asset_456/poster.jpg'), 'asset_456');
  assert.equal(extractStoredAssetIdFromPublicUrl('https://example.com/not-managed/poster.jpg'), '');
});

test('getPublicBaseUrl normalizes explicit public base url', () => {
  assert.equal(
    getPublicBaseUrl({ MEIAO_PUBLIC_BASE_URL: 'https://meiao.example.com/' }),
    'https://meiao.example.com'
  );
});

test('shouldRetainAssetRecord keeps referenced or unexpired assets', () => {
  const now = Date.now();
  assert.equal(shouldRetainAssetRecord({ expiresAt: now - 1, isReferenced: false }, now), false);
  assert.equal(shouldRetainAssetRecord({ expiresAt: now + ASSET_RETENTION_MS, isReferenced: false }, now), true);
  assert.equal(shouldRetainAssetRecord({ expiresAt: now - 1, isReferenced: true }, now), true);
});

test('ensureAssetSchema accepts provider task ids longer than local entity ids', async () => {
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(String(sql));
      return [[]];
    },
  };

  await ensureAssetSchema(pool);

  assert.match(queries[0], /job_id VARCHAR\(120\) NULL/);
  assert.ok(
    queries.some((sql) => /ALTER TABLE stored_assets MODIFY COLUMN job_id VARCHAR\(120\) NULL/.test(sql)),
    'existing stored_assets.job_id column should be widened during startup migration'
  );
});

test('optimizeMp4BufferForStreaming moves tail moov before mdat and patches stco offsets', () => {
  const ftyp = atom('ftyp', Buffer.from('isom0000', 'latin1'));
  const mdatPayload = Buffer.alloc(24, 7);
  const mdat = atom('mdat', mdatPayload);
  const originalChunkOffset = ftyp.length + 8;
  const stcoPayload = Buffer.alloc(12);
  stcoPayload.writeUInt32BE(0, 0);
  stcoPayload.writeUInt32BE(1, 4);
  stcoPayload.writeUInt32BE(originalChunkOffset, 8);
  const stco = atom('stco', stcoPayload);
  const stbl = atom('stbl', stco);
  const minf = atom('minf', stbl);
  const mdia = atom('mdia', minf);
  const trak = atom('trak', mdia);
  const moov = atom('moov', trak);
  const input = Buffer.concat([ftyp, mdat, moov]);

  const optimized = optimizeMp4BufferForStreaming(input);

  assert.equal(optimized.length, input.length);
  assert.ok(findAtomOffset(optimized, 'moov') < findAtomOffset(optimized, 'mdat'));
  const patchedStcoOffset = optimized.indexOf(Buffer.from('stco', 'latin1')) + 12;
  assert.equal(optimized.readUInt32BE(patchedStcoOffset), originalChunkOffset + moov.length);
});
