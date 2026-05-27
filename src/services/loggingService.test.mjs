import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./loggingService.ts', import.meta.url), 'utf8');

test('logging service labels one-click first image and sku actions used by modules', () => {
  [
    'select_all_first_image',
    'deselect_all_first_image',
    'select_single_first_image',
    'deselect_single_first_image',
    'plan_sku_start',
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
