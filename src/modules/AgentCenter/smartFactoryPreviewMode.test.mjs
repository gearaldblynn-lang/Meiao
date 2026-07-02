import test from 'node:test';
import assert from 'node:assert/strict';

const previewMode = await import('./smartFactoryPreviewMode.ts');

test('smart factory preview message is only used before authentication', () => {
  assert.equal(
    previewMode.resolveSmartFactoryConfigLoadErrorMessage(new Error('登录已过期，请重新登录'), {
      search: '?meiaoLocalPreview',
      authenticated: false,
    }),
    previewMode.SMART_FACTORY_PREVIEW_MODE_MESSAGE,
  );
});

test('smart factory keeps real API errors when preview URL is opened after login', () => {
  assert.equal(
    previewMode.resolveSmartFactoryConfigLoadErrorMessage(new Error('登录已过期，请重新登录'), {
      search: '?meiaoLocalPreview',
      authenticated: true,
    }),
    '登录已过期，请重新登录',
  );
  assert.equal(
    previewMode.shouldShowSmartFactoryPreviewFallback({
      search: '?meiaoLocalPreview',
      authenticated: true,
    }),
    false,
  );
});
