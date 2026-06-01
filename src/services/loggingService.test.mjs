import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const source = readFileSync(new URL('./loggingService.ts', import.meta.url), 'utf8');

const collectSourceFiles = (directoryUrl, files = []) => {
  for (const entry of readdirSync(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
    if (entry.isDirectory()) {
      collectSourceFiles(entryUrl, files);
      continue;
    }
    if (/\.(tsx?|mjs)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name)) {
      files.push(entryUrl);
    }
  }
  return files;
};

test('logging service labels one-click first image and sku actions used by modules', () => {
  [
    'select_all_first_image',
    'deselect_all_first_image',
    'select_single_first_image',
    'deselect_single_first_image',
    'plan_first_image_start',
    'generate_first_image_batch',
    'generate_first_image_scheme',
    'recover_first_image_click',
    'recover_first_image_scheme',
    'redo_first_image_scheme',
    'interrupt_first_image_scheme',
    'retry_first_image_planning',
    'download_first_image_batch',
    'clear_first_image_config',
    'plan_sku_start',
    'generate_sku',
    'generate_sku_batch',
    'recover_sku',
    'clear_sku_config',
  ].forEach((action) => {
    assert.match(source, new RegExp(`${action}:\\s*'\\S`), `${action} should have a readable log label`);
  });
});

test('logging service labels every one-click module action emitted in source files', () => {
  const oneClickFiles = [
    '../modules/OneClick/OneClickModule.tsx',
    '../modules/OneClick/FirstImageSubModule.tsx',
    '../modules/OneClick/MainImageSubModule.tsx',
    '../modules/OneClick/DetailPageSubModule.tsx',
    '../modules/OneClick/SkuSubModule.tsx',
  ];
  const actions = new Set();
  for (const file of oneClickFiles) {
    const moduleSource = readFileSync(new URL(file, import.meta.url), 'utf8');
    const matches = moduleSource.matchAll(/action:\s*'([^']+)'/g);
    for (const match of matches) actions.add(match[1]);
  }

  for (const action of actions) {
    assert.match(source, new RegExp(`${action}:\\s*'\\S`), `${action} should have a readable log label`);
  }
});

test('logging service labels every literal frontend log action emitted in app source', () => {
  const sourceRoots = [
    new URL('../modules/', import.meta.url),
    new URL('../shell/', import.meta.url),
    new URL('../services/', import.meta.url),
    new URL('../adapters/', import.meta.url),
  ];
  const actions = new Set();
  for (const fileUrl of sourceRoots.flatMap((root) => collectSourceFiles(root))) {
    const moduleSource = readFileSync(fileUrl, 'utf8');
    const matches = moduleSource.matchAll(/action:\s*'([^']+)'/g);
    for (const match of matches) actions.add(match[1]);
  }

  for (const action of actions) {
    assert.match(source, new RegExp(`${action}:\\s*'\\S`), `${action} should have a readable log label`);
  }
});

test('logging service labels task helper log actions that pass action as function arguments', () => {
  [
    'recover_task',
    'create_video_task',
  ].forEach((action) => {
    assert.match(source, new RegExp(`${action}:\\s*'\\S`), `${action} should have a readable log label`);
  });
});

test('logging service enriches frontend logs with diagnostic correlation fields', () => {
  assert.match(source, /const DIAGNOSTIC_SCHEMA_VERSION = '2026-05-26\.1'/);
  assert.match(source, /const buildDiagnosticMeta = \(meta: Record<string, unknown> \| undefined, action: string, module: string\)/);
  assert.match(source, /diagnosticSchemaVersion: DIAGNOSTIC_SCHEMA_VERSION/);
  assert.match(source, /eventKind: String\(base\.eventKind \|\| 'frontend_action'\)/);
  assert.match(source, /traceId/);
  assert.match(source, /correlationId/);
  assert.match(source, /meta: buildDiagnosticMeta\(meta, action, finalModule\)/);
});
