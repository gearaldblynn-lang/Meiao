import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultTranslationConfigs,
  getLegacyTranslationModuleConfig,
  getTranslationConfigForSubMode,
  migrateLegacyTranslationConfigs,
  shouldValidateTranslationAspectRatio,
  updateTranslationConfigForSubMode,
} from './translationConfigUtils.mjs';

const createLegacyConfig = (overrides = {}) => ({
  targetLanguage: 'English',
  customLanguage: '',
  removeWatermark: true,
  aspectRatio: '1:1',
  quality: '1k',
  model: 'nano-banana-2',
  resolutionMode: 'custom',
  targetWidth: 800,
  targetHeight: 800,
  maxFileSize: 2,
  ...overrides,
});

test('createDefaultTranslationConfigs returns independent defaults for main detail and remove_text', () => {
  const configs = createDefaultTranslationConfigs();

  assert.equal(configs.main.aspectRatio, '1:1');
  assert.equal(configs.main.targetWidth, 800);
  assert.equal(configs.main.targetHeight, 800);

  assert.equal(configs.detail.aspectRatio, 'auto');
  assert.equal(configs.detail.targetWidth, 750);
  assert.equal(configs.detail.targetHeight, 0);

  assert.equal(configs.removeText.aspectRatio, 'auto');
  assert.equal(configs.removeText.targetWidth > 0, true);
  assert.equal(configs.removeText.targetHeight, 0);
});

test('migrateLegacyTranslationConfigs keeps old config for main and derives detail/remove_text defaults', () => {
  const migrated = migrateLegacyTranslationConfigs(createLegacyConfig({
    targetLanguage: 'Korean',
    model: 'nano-banana-pro',
    quality: '2k',
    maxFileSize: 3,
  }));

  assert.equal(migrated.main.targetLanguage, 'Korean');
  assert.equal(migrated.main.model, 'nano-banana-pro');
  assert.equal(migrated.main.targetWidth, 800);
  assert.equal(migrated.main.targetHeight, 800);

  assert.equal(migrated.detail.targetLanguage, 'Korean');
  assert.equal(migrated.detail.model, 'nano-banana-pro');
  assert.equal(migrated.detail.targetWidth, 750);
  assert.equal(migrated.detail.targetHeight, 0);
  assert.equal(migrated.detail.aspectRatio, 'auto');

  assert.equal(migrated.removeText.targetLanguage, 'Korean');
  assert.equal(migrated.removeText.targetHeight, 0);
});

test('updateTranslationConfigForSubMode only changes the targeted submode config', () => {
  const initial = createDefaultTranslationConfigs();
  const updated = updateTranslationConfigForSubMode(initial, 'detail', {
    ...initial.detail,
    targetWidth: 900,
  });

  assert.equal(updated.detail.targetWidth, 900);
  assert.equal(updated.main.targetWidth, 800);
  assert.equal(updated.removeText.targetWidth, initial.removeText.targetWidth);
});

test('getTranslationConfigForSubMode returns the matching config branch', () => {
  const configs = createDefaultTranslationConfigs();

  assert.deepEqual(getTranslationConfigForSubMode(configs, 'main'), configs.main);
  assert.deepEqual(getTranslationConfigForSubMode(configs, 'detail'), configs.detail);
  assert.deepEqual(getTranslationConfigForSubMode(configs, 'remove_text'), configs.removeText);
});

test('getLegacyTranslationModuleConfig always mirrors main translation config for backwards compatibility', () => {
  const configs = createDefaultTranslationConfigs();
  const updated = {
    ...configs,
    main: {
      ...configs.main,
      targetLanguage: 'Japanese',
      targetWidth: 1200,
      targetHeight: 1200,
      quality: '2k',
    },
    detail: {
      ...configs.detail,
      targetWidth: 960,
    },
  };

  const legacy = getLegacyTranslationModuleConfig(updated);

  assert.equal(legacy.targetLanguage, 'Japanese');
  assert.equal(legacy.targetWidth, 1200);
  assert.equal(legacy.targetHeight, 1200);
  assert.equal(legacy.quality, '2k');
});

test('shouldValidateTranslationAspectRatio only validates fixed-ratio main mode', () => {
  const configs = createDefaultTranslationConfigs();

  assert.equal(shouldValidateTranslationAspectRatio(configs.main, 'main'), true);
  assert.equal(shouldValidateTranslationAspectRatio(configs.detail, 'detail'), false);
  assert.equal(shouldValidateTranslationAspectRatio(configs.removeText, 'remove_text'), false);
  assert.equal(
    shouldValidateTranslationAspectRatio({ ...configs.main, aspectRatio: 'auto' }, 'main'),
    false
  );
});
