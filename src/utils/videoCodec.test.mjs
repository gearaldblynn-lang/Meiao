import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getBrowserVideoCodecWarning,
  isBrowserUnsupportedVideoCodec,
  parseMp4VideoCodecs,
} from './videoCodec.ts';

const atom = (type, payload = Buffer.alloc(0)) => {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, 'latin1');
  payload.copy(output, 8);
  return output;
};

const fullAtom = (type, payload = Buffer.alloc(0)) => atom(type, Buffer.concat([Buffer.alloc(4), payload]));

const hdlr = (handlerType) => {
  const payload = Buffer.alloc(20);
  payload.writeUInt32BE(0, 0);
  payload.write(handlerType, 4, 4, 'latin1');
  return fullAtom('hdlr', payload);
};

const stsd = (sampleType) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt32BE(entry.length, 0);
  entry.write(sampleType, 4, 4, 'latin1');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(1, 0);
  return fullAtom('stsd', Buffer.concat([header, entry]));
};

const trak = (handlerType, sampleType) =>
  atom('trak', atom('mdia', Buffer.concat([
    hdlr(handlerType),
    atom('minf', atom('stbl', stsd(sampleType))),
  ])));

const mp4WithTracks = (...tracks) => Buffer.concat([
  atom('ftyp', Buffer.from('isom0000', 'latin1')),
  atom('moov', Buffer.concat(tracks)),
  atom('mdat', Buffer.alloc(4)),
]);

test('parseMp4VideoCodecs identifies HEVC video tracks separately from audio tracks', () => {
  const source = mp4WithTracks(
    trak('vide', 'hvc1'),
    trak('soun', 'mp4a'),
  );

  assert.deepEqual(parseMp4VideoCodecs(source), {
    videoCodecs: ['hvc1'],
    audioCodecs: ['mp4a'],
  });
  assert.equal(isBrowserUnsupportedVideoCodec('hvc1'), true);
  assert.match(getBrowserVideoCodecWarning('hvc1'), /HEVC\/H\.265/);
});

test('parseMp4VideoCodecs treats AVC/H.264 MP4 as browser playable', () => {
  const source = mp4WithTracks(trak('vide', 'avc1'));

  assert.deepEqual(parseMp4VideoCodecs(source).videoCodecs, ['avc1']);
  assert.equal(isBrowserUnsupportedVideoCodec('avc1'), false);
  assert.equal(getBrowserVideoCodecWarning('avc1'), '');
});
