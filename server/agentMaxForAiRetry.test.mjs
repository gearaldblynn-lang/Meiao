import test from 'node:test';
import assert from 'node:assert/strict';

import { getImageGenerateTransientMaxRetriesForModel } from './agentToolConversation.mjs';

test('Agent Center never retries a MaxForAI paid image request automatically', () => {
  const env = { AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES: '3' };
  assert.equal(getImageGenerateTransientMaxRetriesForModel('maxforai-image-2-relay', env), 0);
  assert.equal(getImageGenerateTransientMaxRetriesForModel('image-2中转', env), 0);
  assert.equal(getImageGenerateTransientMaxRetriesForModel('Image-2高', env), 3);
  assert.equal(getImageGenerateTransientMaxRetriesForModel('gpt-image-2', env), 3);
});
