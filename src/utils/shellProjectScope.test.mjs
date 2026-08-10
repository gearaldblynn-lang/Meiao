import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHELL_SUBFEATURE_IDS,
  hasDurableProductRestoreScope,
  normalizeShellProjectScope,
  normalizeStructuredShellSubFeature,
} from './shellProjectScope.mjs';

test('structured shell subfeature contract recognizes every durable module scope', () => {
  assert.deepEqual(SHELL_SUBFEATURE_IDS, {
    one_click: ['first_image', 'main_image', 'detail_page', 'sku'],
    translation: ['main', 'detail', 'remove_text'],
    retouch: ['original', 'white_bg', 'product_restore', 'background_replace', 'enhance'],
    everything_replace: ['product_replace', 'background_replace', 'logo_replace'],
    image_crop: ['long_slice', 'resize'],
    buyer_show: ['image', 'copy'],
    video: ['generation', 'storyboard', 'voiceover_translation', 'subtitle_removal', 'diagnosis'],
    xhs_cover: ['cover'],
    agent_center: ['chat', 'management', 'knowledge', 'versions'],
    smart_factory: ['factory'],
  });
  Object.entries(SHELL_SUBFEATURE_IDS).forEach(([module, subFeatures]) => {
    subFeatures.forEach((subFeature) => {
      assert.equal(
        normalizeStructuredShellSubFeature(module, subFeature),
        subFeature,
        `${module}:${subFeature}`,
      );
    });
  });
});

test('video scope recognizes the durable voiceover translation alias', () => {
  assert.equal(
    normalizeStructuredShellSubFeature('video', '口播翻译'),
    'voiceover_translation',
  );
});

test('product restoration durable evidence repairs scope and canonical project id together', () => {
  const project = {
    id: 'job-image-a',
    module: 'retouch',
    subFeature: 'original',
    results: [{
      id: 'image-a-result',
      module: 'retouch',
      subFeature: 'original',
      projectId: 'proj-restore-a',
      clientSubmissionKey: 'proj-restore-a:product_restore:analysis-a:target-a:v2',
    }],
  };

  assert.equal(hasDurableProductRestoreScope(project), true);
  assert.deepEqual(normalizeShellProjectScope(project), {
    ...project,
    id: 'proj-restore-a',
    subFeature: 'product_restore',
    results: [{
      ...project.results[0],
      subFeature: 'product_restore',
    }],
  });
});

test('generic mixed derivative results keep their explicit cross-feature scope', () => {
  const project = {
    id: 'legacy-mixed',
    module: 'retouch',
    subFeature: 'original',
    results: [
      { id: 'retouch-result', module: 'retouch', subFeature: 'original' },
      { id: 'replace-result', module: 'retouch', subFeature: 'product_replace' },
    ],
  };

  assert.equal(normalizeShellProjectScope(project), project);
  assert.equal(project.results[1].subFeature, 'product_replace');
});

test('a mixed retouch project repairs only the product restoration result', () => {
  const project = {
    id: 'mixed-retouch-project',
    module: 'retouch',
    subFeature: 'original',
    results: [
      { id: 'original-result', module: 'retouch', subFeature: 'original' },
      {
        id: 'restore-result',
        module: 'retouch',
        subFeature: 'original',
        projectId: 'proj-restore-result',
        clientSubmissionKey: 'proj-restore-result:product_restore:analysis-a:target-a:v2',
      },
    ],
  };

  const normalized = normalizeShellProjectScope(project);
  assert.equal(normalized.id, 'mixed-retouch-project');
  assert.equal(normalized.subFeature, 'original');
  assert.equal(normalized.results[0].subFeature, 'original');
  assert.equal(normalized.results[1].subFeature, 'product_restore');
});

test('an existing canonical project id wins over a conflicting result project id', () => {
  const project = {
    id: 'proj-current',
    module: 'retouch',
    subFeature: 'product_restore',
    results: [{
      id: 'restore-result',
      module: 'retouch',
      subFeature: 'product_restore',
      projectId: 'proj-other',
    }],
  };

  assert.equal(normalizeShellProjectScope(project).id, 'proj-current');
});

test('a product restoration project preserves explicit cross-feature derivative results', () => {
  const project = {
    id: 'proj-product-restore',
    module: 'retouch',
    subFeature: 'product_restore',
    results: [
      { id: 'restore-result', module: 'retouch', subFeature: 'original' },
      { id: 'replace-result', module: 'everything_replace', subFeature: 'product_replace' },
      { id: 'future-result', module: 'retouch', subFeature: 'future_retouch_mode' },
    ],
  };

  const normalized = normalizeShellProjectScope(project);
  assert.equal(normalized.results[0].subFeature, 'product_restore');
  assert.equal(normalized.results[1].subFeature, 'product_replace');
  assert.equal(normalized.results[2].subFeature, 'future_retouch_mode');
});

test('unknown structured scope is rejected instead of silently becoming another known tab', () => {
  assert.equal(normalizeStructuredShellSubFeature('retouch', 'new_future_mode'), '');
  assert.equal(normalizeStructuredShellSubFeature('video', 'new_future_mode'), '');
});

test('an explicit unknown persisted project scope is not replaced by a result scope', () => {
  const project = {
    id: 'future-project',
    module: 'retouch',
    subFeature: 'future_retouch_mode',
    results: [{ id: 'legacy-result', module: 'retouch', subFeature: 'original' }],
  };

  assert.equal(normalizeShellProjectScope(project).subFeature, 'future_retouch_mode');
});
