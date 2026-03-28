import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTrackedObjectUrl,
  revokeTrackedObjectUrl,
  revokeTrackedObjectUrls,
  revokeAllTrackedObjectUrls,
} from './objectUrlRegistry.mjs';

test('createTrackedObjectUrl reuses the same url for the same blob instance', () => {
  const calls = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  URL.createObjectURL = (blob) => {
    calls.push(blob);
    return `blob:test-${calls.length}`;
  };
  URL.revokeObjectURL = () => {};

  try {
    const blob = new Blob(['demo'], { type: 'text/plain' });
    const first = createTrackedObjectUrl(blob);
    const second = createTrackedObjectUrl(blob);

    assert.equal(first, 'blob:test-1');
    assert.equal(second, 'blob:test-1');
    assert.equal(calls.length, 1);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    revokeAllTrackedObjectUrls();
  }
});

test('revokeTrackedObjectUrls and revokeAllTrackedObjectUrls release tracked urls', () => {
  const revoked = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let counter = 0;

  URL.createObjectURL = () => {
    counter += 1;
    return `blob:tracked-${counter}`;
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
  };

  try {
    const first = new Blob(['a']);
    const second = new Blob(['b']);
    const third = new Blob(['c']);

    createTrackedObjectUrl(first);
    createTrackedObjectUrl(second);
    createTrackedObjectUrl(third);

    revokeTrackedObjectUrl(first);
    revokeTrackedObjectUrls([second]);
    revokeAllTrackedObjectUrls();

    assert.deepEqual(revoked, [
      'blob:tracked-1',
      'blob:tracked-2',
      'blob:tracked-3',
    ]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    revokeAllTrackedObjectUrls();
  }
});
