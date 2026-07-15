import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getComparisonDriftCorrection,
  shouldPauseForComparisonBuffer,
} from './subtitleComparisonSync.mjs';

test('does not seek for drift at or below 120 milliseconds', () => {
  assert.equal(getComparisonDriftCorrection({
    masterTime: 10,
    followerTime: 9.88,
    thresholdSeconds: 0.12,
  }), null);
  assert.equal(getComparisonDriftCorrection({
    masterTime: 10,
    followerTime: 10.12,
    thresholdSeconds: 0.12,
  }), null);
});

test('returns master time when drift exceeds threshold', () => {
  assert.equal(getComparisonDriftCorrection({
    masterTime: 10,
    followerTime: 9.7,
    thresholdSeconds: 0.12,
  }), 10);
});

test('comparison pauses until both visible streams have future buffered data', () => {
  const ready = { visible: true, readyState: 4, bufferedAheadSeconds: 4, ended: false, failed: false };
  assert.equal(shouldPauseForComparisonBuffer({
    playIntent: true,
    minBufferSeconds: 3,
    source: ready,
    result: { ...ready, readyState: 2, bufferedAheadSeconds: 0 },
  }), true);
  assert.equal(shouldPauseForComparisonBuffer({
    playIntent: true,
    minBufferSeconds: 3,
    source: { ...ready, bufferedAheadSeconds: 2.9 },
    result: ready,
  }), true);
  assert.equal(shouldPauseForComparisonBuffer({
    playIntent: true,
    minBufferSeconds: 3,
    source: ready,
    result: ready,
  }), false);
});

test('buffer gating ignores hidden or ended streams and inactive play intent', () => {
  const empty = { visible: true, readyState: 0, bufferedAheadSeconds: 0, ended: false, failed: false };
  assert.equal(shouldPauseForComparisonBuffer({ playIntent: false, source: empty, result: empty }), false);
  assert.equal(shouldPauseForComparisonBuffer({
    playIntent: true,
    source: { ...empty, visible: false },
    result: { ...empty, ended: true },
  }), false);
});
