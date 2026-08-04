import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as utils from './translationRegionEditUtils.mjs';

const componentUrl = new URL('./TranslationRegionEditDialog.tsx', import.meta.url);
const projectCardUrl = new URL('../../shell/components/ProjectCard.tsx', import.meta.url);
const projectListViewUrl = new URL('../../shell/components/ProjectListView.tsx', import.meta.url);
const translationModuleUrl = new URL('../../shell/modules/Translation/TranslationModule.tsx', import.meta.url);
const sharedDialogUrl = new URL('../../shell/components/ui/dialog.tsx', import.meta.url);
const shellUrl = new URL('../../ShellMigratedApp.tsx', import.meta.url);

const region = (id, overrides = {}) => ({
  id,
  index: Number(id.replace(/\D/g, '')) || 1,
  xRatio: 0.1,
  yRatio: 0.1,
  widthRatio: 0.2,
  heightRatio: 0.2,
  instruction: `instruction-${id}`,
  ...overrides,
});

test('translation edit geometry helpers are exported', () => {
  for (const name of [
    'getContainedImageRect',
    'clientPointToImageRatio',
    'createTranslationEditRegion',
    'moveTranslationEditRegion',
    'resizeTranslationEditRegion',
    'removeTranslationEditRegion',
    'tryAddTranslationEditRegion',
    'cancelTranslationRegionInteraction',
    'runTranslationRegionSubmit',
  ]) {
    assert.equal(typeof utils[name], 'function', `${name} should be exported`);
  }
});

test('object-contain geometry returns the displayed bitmap rectangle without letterbox space', () => {
  assert.deepEqual(
    utils.getContainedImageRect(
      { left: 10, top: 20, width: 800, height: 600 },
      { width: 1600, height: 900 },
    ),
    { left: 10, top: 95, width: 800, height: 450 },
  );

  assert.deepEqual(
    utils.getContainedImageRect(
      { left: 10, top: 20, width: 800, height: 600 },
      { width: 900, height: 1600 },
    ),
    { left: 241.25, top: 20, width: 337.5, height: 600 },
  );
});

test('client coordinates normalize against only the displayed image rectangle', () => {
  const imageRect = { left: 100, top: 50, width: 400, height: 200 };

  assert.deepEqual(utils.clientPointToImageRatio({ x: 300, y: 100 }, imageRect), {
    xRatio: 0.5,
    yRatio: 0.25,
  });
  assert.equal(utils.clientPointToImageRatio({ x: 99, y: 100 }, imageRect), null);
  assert.equal(utils.clientPointToImageRatio({ x: 300, y: 251 }, imageRect), null);
});

test('client coordinates can snap near-edge starts onto the image boundary', () => {
  const imageRect = { left: 100, top: 50, width: 400, height: 200 };

  assert.deepEqual(
    utils.clientPointToImageRatio(
      { x: 94, y: 44 },
      imageRect,
      { clamp: true, tolerancePx: 12 },
    ),
    { xRatio: 0, yRatio: 0 },
  );
  assert.deepEqual(
    utils.clientPointToImageRatio(
      { x: 508, y: 258 },
      imageRect,
      { clamp: true, tolerancePx: 12 },
    ),
    { xRatio: 1, yRatio: 1 },
  );
  assert.equal(
    utils.clientPointToImageRatio(
      { x: 80, y: 44 },
      imageRect,
      { clamp: true, tolerancePx: 12 },
    ),
    null,
  );
});

test('client coordinates can opt into free overflow without edge snapping', () => {
  const imageRect = { left: 100, top: 50, width: 400, height: 200 };

  assert.deepEqual(
    utils.clientPointToImageRatio(
      { x: 80, y: 40 },
      imageRect,
      { allowOverflow: true },
    ),
    { xRatio: -0.05, yRatio: -0.05 },
  );
  assert.deepEqual(
    utils.clientPointToImageRatio(
      { x: 530, y: 260 },
      imageRect,
      { allowOverflow: true },
    ),
    { xRatio: 1.075, yRatio: 1.05 },
  );
  assert.deepEqual(
    utils.clientPointToImageRatio(
      { x: 118, y: 62 },
      imageRect,
      { allowOverflow: true },
    ),
    { xRatio: 0.045, yRatio: 0.06 },
  );
});

test('dragging in either direction creates a normalized region', () => {
  assert.deepEqual(
    utils.createTranslationEditRegion(
      { xRatio: 0.7, yRatio: 0.8 },
      { xRatio: 0.2, yRatio: 0.3 },
      'new-id',
    ),
    {
      id: 'new-id',
      index: 1,
      xRatio: 0.2,
      yRatio: 0.3,
      widthRatio: 0.5,
      heightRatio: 0.5,
      instruction: '',
    },
  );
});

test('moving a region preserves its size and clamps it inside the image', () => {
  assert.deepEqual(
    utils.moveTranslationEditRegion(region('region-1'), { xRatio: 0.9, yRatio: -0.3 }),
    region('region-1', { xRatio: 0.8, yRatio: 0 }),
  );
});

test('resizing supports corner and edge handles while staying in bounds', () => {
  assert.deepEqual(
    utils.resizeTranslationEditRegion(
      region('region-1'),
      'se',
      { xRatio: 0.8, yRatio: 0.9 },
    ),
    region('region-1', { widthRatio: 0.9, heightRatio: 0.9 }),
  );
  assert.deepEqual(
    utils.resizeTranslationEditRegion(
      region('region-1'),
      'nw',
      { xRatio: 0.15, yRatio: 0.05 },
    ),
    region('region-1', {
      xRatio: 0.25,
      yRatio: 0.15,
      widthRatio: 0.05,
      heightRatio: 0.15,
    }),
  );
  assert.deepEqual(
    utils.resizeTranslationEditRegion(
      region('region-1'),
      'e',
      { xRatio: -0.05, yRatio: 0.9 },
    ),
    region('region-1', { widthRatio: 0.15 }),
  );
});

test('all eight resize handles preserve the minimum region size when over-dragged', () => {
  const source = region('region-1', {
    xRatio: 0.3,
    yRatio: 0.3,
    widthRatio: 0.4,
    heightRatio: 0.4,
  });
  const cases = {
    n: { delta: { xRatio: 0, yRatio: 1 }, expected: { yRatio: 0.68, heightRatio: 0.02 } },
    s: { delta: { xRatio: 0, yRatio: -1 }, expected: { heightRatio: 0.02 } },
    e: { delta: { xRatio: -1, yRatio: 0 }, expected: { widthRatio: 0.02 } },
    w: { delta: { xRatio: 1, yRatio: 0 }, expected: { xRatio: 0.68, widthRatio: 0.02 } },
    ne: { delta: { xRatio: -1, yRatio: 1 }, expected: { yRatio: 0.68, widthRatio: 0.02, heightRatio: 0.02 } },
    nw: { delta: { xRatio: 1, yRatio: 1 }, expected: { xRatio: 0.68, yRatio: 0.68, widthRatio: 0.02, heightRatio: 0.02 } },
    se: { delta: { xRatio: -1, yRatio: -1 }, expected: { widthRatio: 0.02, heightRatio: 0.02 } },
    sw: { delta: { xRatio: 1, yRatio: -1 }, expected: { xRatio: 0.68, widthRatio: 0.02, heightRatio: 0.02 } },
  };

  for (const [handle, { delta, expected }] of Object.entries(cases)) {
    const resized = utils.resizeTranslationEditRegion(source, handle, delta);
    for (const [field, value] of Object.entries(expected)) {
      assert.equal(resized[field], value, `${handle} should clamp ${field}`);
    }
  }
});

test('resize normalizes zero and sub-minimum edge regions before applying every handle', () => {
  const cases = [
    {
      source: region('zero-top-left', {
        xRatio: 0,
        yRatio: 0,
        widthRatio: 0,
        heightRatio: 0,
      }),
      handles: ['w', 'n', 'nw'],
      delta: { xRatio: 1, yRatio: 1 },
    },
    {
      source: region('zero-bottom-right', {
        xRatio: 1,
        yRatio: 1,
        widthRatio: 0,
        heightRatio: 0,
      }),
      handles: ['e', 's', 'se'],
      delta: { xRatio: -1, yRatio: -1 },
    },
    {
      source: region('small-top-left', {
        xRatio: 0,
        yRatio: 0,
        widthRatio: 0.005,
        heightRatio: 0.01,
      }),
      handles: ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'],
      delta: { xRatio: 1, yRatio: 1 },
    },
    {
      source: region('small-bottom-right', {
        xRatio: 0.995,
        yRatio: 0.99,
        widthRatio: 0.005,
        heightRatio: 0.01,
      }),
      handles: ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'],
      delta: { xRatio: -1, yRatio: -1 },
    },
  ];

  for (const { source, handles, delta } of cases) {
    for (const handle of handles) {
      const resized = utils.resizeTranslationEditRegion(source, handle, delta);
      assert.ok(resized.xRatio >= 0, `${source.id}/${handle} x must stay non-negative`);
      assert.ok(resized.yRatio >= 0, `${source.id}/${handle} y must stay non-negative`);
      assert.ok(resized.widthRatio >= 0.02, `${source.id}/${handle} width must meet MIN`);
      assert.ok(resized.heightRatio >= 0.02, `${source.id}/${handle} height must meet MIN`);
      assert.ok(
        resized.xRatio + resized.widthRatio <= 1,
        `${source.id}/${handle} right edge must stay in bounds`,
      );
      assert.ok(
        resized.yRatio + resized.heightRatio <= 1,
        `${source.id}/${handle} bottom edge must stay in bounds`,
      );
    }
  }
});

test('pointer cancellation deletes draw drafts and restores moved or resized originals', () => {
  const first = region('region-1');
  const second = region('region-2', { xRatio: 0.4 });
  const draft = region('region-3', { xRatio: 0.7, widthRatio: 0.1, instruction: '' });
  const drawing = [first, second, draft];

  const afterDrawCancel = utils.cancelTranslationRegionInteraction(drawing, {
    mode: 'draw',
    regionId: draft.id,
    original: draft,
  });
  assert.deepEqual(afterDrawCancel, [first, second]);

  const moved = { ...second, xRatio: 0.65, instruction: second.instruction };
  const afterMoveCancel = utils.cancelTranslationRegionInteraction([first, moved], {
    mode: 'move',
    regionId: second.id,
    original: second,
  });
  assert.deepEqual(afterMoveCancel, [first, second]);
  assert.equal(afterMoveCancel[1].instruction, 'instruction-region-2');

  const resized = { ...first, widthRatio: 0.6 };
  assert.deepEqual(utils.cancelTranslationRegionInteraction([resized, second], {
    mode: 'resize',
    regionId: first.id,
    original: first,
  }), [first, second]);
});

test('async submit helper absorbs rejection and returns an executable retry message', async () => {
  let calls = 0;
  const failed = await utils.runTranslationRegionSubmit(async () => {
    calls += 1;
    throw new Error('provider unavailable');
  });

  assert.equal(calls, 1);
  assert.deepEqual(failed, { ok: false, error: 'provider unavailable' });
  assert.deepEqual(
    await utils.runTranslationRegionSubmit(async () => { throw 'bad'; }),
    { ok: false, error: '提交失败，请重试' },
  );
  assert.deepEqual(
    await utils.runTranslationRegionSubmit(async () => undefined),
    { ok: true },
  );
});

test('deleting a region renumbers survivors without detaching instructions from ids', () => {
  const regions = [region('region-1'), region('region-2'), region('region-3')];
  const next = utils.removeTranslationEditRegion(regions, 'region-2');

  assert.deepEqual(next.map(({ id, index, instruction }) => ({ id, index, instruction })), [
    { id: 'region-1', index: 1, instruction: 'instruction-region-1' },
    { id: 'region-3', index: 2, instruction: 'instruction-region-3' },
  ]);
});

test('a sixth region is rejected without replacing the existing state array', () => {
  const regions = Array.from({ length: 5 }, (_, index) => region(`region-${index + 1}`));
  const result = utils.tryAddTranslationEditRegion(regions, region('region-6'));

  assert.equal(result.added, false);
  assert.equal(result.limitReached, true);
  assert.equal(result.regions, regions);
});

test('dialog source locks the dedicated translation-region contract and interactions', async () => {
  const source = await readFile(componentUrl, 'utf8');

  for (const prop of [
    'open',
    'imageUrl',
    'sourceVersionId',
    'title',
    'pending',
    'onClose',
    'onSubmit',
  ]) {
    assert.match(source, new RegExp(`\\b${prop}\\b`), `missing ${prop} prop`);
  }
  assert.match(source, /onSubmit\s*:\s*\(input\s*:\s*\{[\s\S]*?\}\)\s*=>\s*Promise<void>/);
  assert.match(source, /onSubmit\s*\(\s*\{\s*sourceVersionId\s*,\s*regions\s*:/s);
  assert.match(source, /validateTranslationEditRegions\s*\(/);
  assert.match(source, /MAX_TRANSLATION_EDIT_REGIONS/);
  assert.match(source, /onPointerDown=/);
  assert.match(source, /onPointerMove=/);
  assert.match(source, /onPointerUp=/);
  assert.match(source, /\.map\s*\([\s\S]*?<textarea/);
  assert.match(source, /from\s+['"]lucide-react['"]/);
  for (const icon of ['X', 'Trash2', 'RotateCcw']) {
    assert.match(source, new RegExp(`\\b${icon}\\b`), `missing ${icon} icon`);
  }
});

test('dialog validates replacement and deletion semantics only when submitting a new edit', async () => {
  const source = await readFile(componentUrl, 'utf8');

  assert.match(source, /validateTranslationRegionEditIntents/);
  assert.match(source, /unrecognized_instruction:\s*'请输入“文案改成xxx”或“删除此区域内的文案”'/);
  assert.match(source, /missing_replacement_text:\s*'请填写修改后的文案'/);
  assert.match(source, /INSTRUCTION_ERROR_CODES[\s\S]*?'unrecognized_instruction'[\s\S]*?'missing_replacement_text'/);
  assert.match(source, /const intentValidation = validateTranslationRegionEditIntents\(validation\.regions\)/);
});

test('dialog synchronously locks async submission and always releases it for retry', async () => {
  const source = await readFile(componentUrl, 'utf8');

  assert.match(source, /const\s+submitLockRef\s*=\s*useRef\(false\)/);
  assert.match(source, /const\s+\[submitting\s*,\s*setSubmitting\]\s*=\s*useState\(false\)/);
  assert.match(source, /const\s+submitRegions\s*=\s*async\s*\(\)\s*=>/);
  assert.match(source, /if\s*\(pending\s*\|\|\s*submitLockRef\.current\)\s*return/);
  assert.match(
    source,
    /submitLockRef\.current\s*=\s*true[\s\S]*?try\s*\{[\s\S]*?await\s+runTranslationRegionSubmit\s*\([\s\S]*?onSubmit\s*\([\s\S]*?finally\s*\{[\s\S]*?submitLockRef\.current\s*=\s*false/,
  );
  assert.match(source, /onEscapeKeyDown=\{\(event\)\s*=>\s*\{[\s\S]*?pending\s*\|\|\s*submitting[\s\S]*?event\.preventDefault\(\)/);
  assert.match(source, /disabled=\{pending\s*\|\|\s*submitting\}/);
  assert.match(source, /submitting\s*\?\s*['"]提交中\.\.\.['"]/);
  assert.match(source, /runTranslationRegionSubmit\s*\(/);
  assert.match(source, /catch\s*\(error\)\s*\{[\s\S]*?setSubmitError\s*\(/);
  assert.match(source, /setSubmitError\s*\(/);
  assert.match(source, /role=['"]alert['"][\s\S]*?submitError/);
});

test('dialog guards image readiness, pointer cancellation, keyboard access, and short screens', async () => {
  const source = await readFile(componentUrl, 'utf8');

  assert.match(source, /useState\(true\)/);
  assert.match(source, /const\s+\[imageError\s*,\s*setImageError\]/);
  assert.match(source, /onLoad=/);
  assert.match(source, /onError=/);
  assert.match(source, /role=['"]alert['"][\s\S]*?imageError/);
  assert.match(source, /aria-disabled=\{imageLoading\s*\|\|\s*Boolean\(imageError\)\}/);
  assert.match(source, /disabled=\{[\s\S]*?imageLoading[\s\S]*?imageError[\s\S]*?\}/);
  assert.match(source, /if\s*\(pointerRef\.current\)\s*return/);
  assert.match(source, /onPointerCancel=\{cancelPointerInteraction\}/);
  assert.match(source, /onLostPointerCapture=\{cancelPointerInteraction\}/);
  assert.match(source, /cancelTranslationRegionInteraction\s*\(/);
  assert.match(source, /validateCurrentRegions\s*\(/);
  assert.match(source, /from\s+['"]\.\.\/\.\.\/shell\/components\/ui\/dialog['"]/);
  assert.match(source, /<Dialog\b/);
  assert.match(source, /<DialogContent\b/);
  assert.match(source, /<DialogTitle\b/);
  assert.match(source, /HANDLES\.map\s*\([\s\S]*?<button/);
  assert.match(source, /onKeyDown=/);
  assert.match(source, /event\.key\s*===\s*['"]Delete['"]/);
  assert.match(source, /overflow-y:\s*auto/);
  assert.match(source, /@media\s*\(max-height:/);
  assert.match(source, /\.translation-region-dialog-body[\s\S]*?overflow-y:\s*auto/);
});

test('dialog keeps the interaction canvas full-frame and supports free overflow selection', async () => {
  const source = await readFile(componentUrl, 'utf8');

  assert.doesNotMatch(source, /TRANSLATION_EDIT_EDGE_HIT_SLOP_PX/);
  assert.doesNotMatch(source, /TRANSLATION_EDIT_EDGE_SNAP_PX/);
  assert.match(source, /clientPointToImageRatio\([\s\S]*?allowOverflow:\s*true/);
  assert.match(source, /clipTranslationEditRegionsToImageBounds\(/);
  assert.match(source, /className="translation-region-layer"/);
  assert.match(source, /\.translation-region-canvas\s*\{[\s\S]*?inset:\s*0/);
  assert.match(source, /\.translation-region-layer\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.doesNotMatch(source, /className="translation-region-canvas"[\s\S]{0,180}\.\.\.imageRect/);
});

test('dialog source excludes uploads and unrelated first-generation controls', async () => {
  const source = await readFile(componentUrl, 'utf8');

  assert.doesNotMatch(source, /type\s*=\s*['"]file['"]/i);
  assert.doesNotMatch(source, /accept\s*=/i);
  assert.doesNotMatch(source, /<input\b|<select\b/i);
  for (const identifier of [
    'targetLanguage',
    'customLanguage',
    'translationConfigSnapshot',
    'aspectRatio',
    'ratio',
    'model',
    'reference',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\b${identifier}\\b`, 'i'),
      `legacy identifier ${identifier} must stay out of dialog props, state, and controls`,
    );
  }
  assert.doesNotMatch(
    source,
    /\b(?:targetLanguage|customLanguage|translationConfigSnapshot|aspectRatio|modelSelector|firstGeneration|referenceImage|referenceUpload)\b/i,
  );
});

test('translation dialog raises only its portal overlay and content above project modals', async () => {
  const [translationDialog, sharedDialog] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(sharedDialogUrl, 'utf8'),
  ]);

  assert.match(sharedDialog, /overlayClassName\?: string/);
  assert.match(sharedDialog, /<DialogOverlay className=\{overlayClassName\} \/>/);
  assert.match(sharedDialog, /fixed inset-0 z-50 bg-black\/50/);
  assert.match(sharedDialog, /fixed top-\[50%\] left-\[50%\] z-50/);
  assert.doesNotMatch(sharedDialog, /z-\[(?:540|550)\]/);

  const overlayZ = Number(translationDialog.match(/overlayClassName="z-\[(\d+)\]"/)?.[1]);
  const contentZ = Number(translationDialog.match(/className="translation-region-dialog z-\[(\d+)\]"/)?.[1]);
  assert.ok(overlayZ > 520, 'translation overlay must be above the comparison modal');
  assert.ok(contentZ > overlayZ, 'translation content must be above its overlay');
});

test('translation result version indexes advance only when that result gains a completed version', () => {
  assert.equal(typeof utils.reconcileTranslationVersionIndexes, 'function');

  const initial = utils.reconcileTranslationVersionIndexes(
    {},
    {},
    { first: 1, second: 2 },
  );
  assert.deepEqual(initial, { first: 0, second: 1 });

  const preserved = utils.reconcileTranslationVersionIndexes(
    { first: 0, second: 0 },
    { first: 1, second: 2 },
    { first: 1, second: 2 },
  );
  assert.deepEqual(preserved, { first: 0, second: 0 });

  const advanced = utils.reconcileTranslationVersionIndexes(
    preserved,
    { first: 1, second: 2 },
    { first: 1, second: 3 },
  );
  assert.deepEqual(advanced, { first: 0, second: 2 });
});

test('translation project card exposes scoped region editing with stable action order', async () => {
  const source = await readFile(projectCardUrl, 'utf8');
  const translationStart = source.indexOf(') : isTranslationProject ? (');
  const translationEnd = source.indexOf('<div className="space-y-3">', translationStart);
  const table = source.slice(translationStart, translationEnd);
  const operationStart = table.indexOf('data-translation-operation-cell');
  const operation = table.slice(operationStart);

  assert.match(source, /\bPencil\b/);
  assert.match(source, /\bLoader2\b/);
  assert.match(source, /TranslationRegionEditDialog/);
  assert.match(source, /getCompletedTranslationEditVersions/);
  assert.match(source, /const \[translationVersionIndexes, setTranslationVersionIndexes\] = useState<Record<string, number>>\(\{\}\)/);
  assert.match(
    source,
    /onTranslationRegionEdit\?: \(projectId: string, resultId: string, input: \{ sourceVersionId: string; regions: TranslationEditRegion\[\] \}\) => Promise<void>/,
  );
  assert.match(
    source,
    /onCancelTranslationRegionEdit\?: \(projectId: string, resultId: string, versionId: string, backendJobId\?: string\) => Promise<void>/,
  );
  assert.match(source, /project\.module === 'translation'[\s\S]*?\(project\.subFeature === 'main' \|\| project\.subFeature === 'detail'\)/);
  assert.match(source, /result\.status === 'completed'[\s\S]*?Boolean\(result\.imageUrl\)[\s\S]*?!result\.videoUrl/);
  assert.doesNotMatch(operation, /subFeature === 'remove_text'[\s\S]*?<Pencil/);

  const viewIndex = operation.indexOf('label="\u67e5\u770b"');
  const editIndex = operation.indexOf('label={translationEditPending ? \'\u4fee\u6539\u4e2d\' : \'\u4fee\u6539\'}');
  const downloadIndex = operation.indexOf('label="\u4e0b\u8f7d"');
  assert.ok(viewIndex >= 0 && editIndex > viewIndex && downloadIndex > editIndex);
  assert.match(operation, /lg:w-\[216px\]/);
  assert.match(operation, /icon=\{translationEditPending \? <Loader2[\s\S]*?: <Pencil/);
  assert.match(operation, /handleCancelTranslationRegionEdit\(result, pendingTranslationEditVersion\)/);
  assert.match(source, /onCancelTranslationRegionEdit\(project\.id, result\.id, version\.id, backendJobId \|\| undefined\)/);
  assert.doesNotMatch(source, /!backendJobId \|\| cancellingTranslationEditVersionIds/);
  assert.doesNotMatch(source, /pendingTranslationEditVersion\?\.backendJobId && onCancelTranslationRegionEdit/);
});

test('translation compare exposes pending edit versions while downloads use completed selections', async () => {
  const source = await readFile(projectCardUrl, 'utf8');
  const batchStart = source.indexOf('const handleDownloadAll = async () =>');
  const batchEnd = source.indexOf('const handleExportRetouchToBgSub', batchStart);
  const batch = source.slice(batchStart, batchEnd);
  const compareStart = source.indexOf('{translationCompareOpen && translationResults.length > 0');
  const compareEnd = source.indexOf('{confirmDeleteProject &&', compareStart);
  const compare = source.slice(compareStart, compareEnd);

  assert.match(source, /const getSelectedTranslationVersion = \(result: GeneratedResult\)/);
  assert.match(source, /const getSelectedTranslationResult = \(result: GeneratedResult\): GeneratedResult/);
  assert.match(source, /getVisibleTranslationEditVersions/);
  assert.match(source, /selectedVersion\?\.status === 'completed' && selectedVersion\?\.imageUrl/);
  assert.match(source, /taskId: selectedVersion\.taskId/);
  assert.match(source, /backendJobId: selectedVersion\.backendJobId/);
  assert.match(source, /creditsConsumed: selectedVersion\.creditsConsumed/);
  assert.match(source, /createdAt: selectedVersion\.createdAt/);
  assert.match(source, /getTranslationEditCreditsConsumed/);
  assert.match(source, /handleDownloadSingle\([\s\S]*?getSelectedTranslationResult\(result\),[\s\S]*?index,[\s\S]*?getSelectedTranslationVersion\(result\)/);
  assert.match(batch, /url: result\.videoUrl \|\| result\.imageUrl/);
  assert.doesNotMatch(batch, /getSelectedTranslation/);
  assert.match(source, /const downloaded = await downloadRemoteFile\(/);
  assert.match(source, /onTranslationResultDownloaded\([\s\S]*?downloaded\.blob,[\s\S]*?downloaded\.fileName/);
  assert.match(batch, /const downloadedFiles = await downloadRemoteFilesAsZip\(/);
  assert.match(batch, /Promise\.allSettled\([\s\S]*?onTranslationResultDownloaded\([\s\S]*?downloaded\.file\.blob/);
  assert.match(compare, /const visibleVersions = getVisibleTranslationVersions\(result\)/);
  assert.match(compare, /const selectedVersion = getSelectedTranslationVersion\(result\)/);
  assert.match(compare, /selectedVersion\?\.status === 'generating'[\s\S]*?'处理中'/);
  assert.match(compare, /selectedVersion\?\.status === 'error'[\s\S]*?'保存失败'/);
  assert.match(compare, /selectedVersion\?\.status === 'completed' && selectedVersion\?\.imageUrl/);
  assert.match(compare, /<img src=\{selectedVersion\.imageUrl\}/);
  assert.match(compare, /handleDownloadSingle\(selectedResult, translationCompareIndex, selectedVersion\)/);
  assert.match(compare, /openTranslationRegionEdit\(result, pathLabel\)/);
  assert.match(compare, /\u4e0a\u4e00\u7248/);
  assert.match(compare, /V\{selectedVersionIndex \+ 1\} \/ \u5171\{visibleVersions\.length\}\u7248/);
  assert.match(compare, /\u4e0b\u4e00\u7248/);
  assert.match(compare, /disabled=\{selectedVersionIndex <= 0\}/);
  assert.match(compare, /disabled=\{selectedVersionIndex >= visibleVersions\.length - 1\}/);
});

test('translation result mirroring is wired from downloads into the guarded shell transaction', async () => {
  const shell = await readFile(shellUrl, 'utf8');
  const module = await readFile(translationModuleUrl, 'utf8');
  const list = await readFile(projectListViewUrl, 'utf8');

  assert.match(shell, /const handleTranslationResultDownloaded = useCallback\(async \(/);
  assert.match(shell, /replaceTranslationResultAssetUrl\(projectsRef\.current, replacementInput\)/);
  assert.match(shell, /persistTranslationFilesToSharedState\([\s\S]*?isReplacementCurrent,[\s\S]*?mirrorSignal/);
  assert.match(shell, /persistProjectToSharedState\(replacementProject, \{[\s\S]*?guard: isReplacementCurrent,[\s\S]*?signal: mirrorSignal/);
  assert.match(shell, /onTranslationResultDownloaded=\{handleTranslationResultDownloaded\}/);
  assert.match(module, /onTranslationResultDownloaded=\{onTranslationResultDownloaded\}/);
  assert.match(list, /onTranslationResultDownloaded=\{onTranslationResultDownloaded\}/);
});

test('translation compare shows a failed edit reason without falling back to an image', async () => {
  const source = await readFile(projectCardUrl, 'utf8');
  const compareStart = source.indexOf('{translationCompareOpen && translationResults.length > 0');
  const compareEnd = source.indexOf('{confirmDeleteProject &&', compareStart);
  const compare = source.slice(compareStart, compareEnd);
  const failedBranchStart = compare.indexOf("selectedVersion?.status === 'error' ? (");
  const completedBranchStart = compare.indexOf("selectedVersion?.status === 'completed' && selectedVersion?.imageUrl ? (");
  const failedBranch = compare.slice(failedBranchStart, completedBranchStart);

  assert.ok(failedBranchStart >= 0, 'failed versions need a dedicated media branch');
  assert.ok(completedBranchStart > failedBranchStart, 'failure must be handled before any image branch');
  assert.match(failedBranch, /selectedVersion\.error \|\| '修改失败，请重新提交'/);
  assert.match(failedBranch, /修改失败/);
  assert.doesNotMatch(failedBranch, /<img\b/);
});

test('translation compare shows a generating placeholder instead of the previous result image', async () => {
  const source = await readFile(projectCardUrl, 'utf8');
  const compareStart = source.indexOf('{translationCompareOpen && translationResults.length > 0');
  const compareEnd = source.indexOf('{confirmDeleteProject &&', compareStart);
  const compare = source.slice(compareStart, compareEnd);
  const generatingBranchStart = compare.indexOf("selectedVersion?.status === 'generating' ? (");
  const completedBranchStart = compare.indexOf("selectedVersion?.status === 'completed' && selectedVersion?.imageUrl ? (");
  const generatingBranch = compare.slice(generatingBranchStart, completedBranchStart);

  assert.ok(generatingBranchStart >= 0, 'generating versions need a dedicated media branch');
  assert.ok(completedBranchStart > generatingBranchStart, 'generating must be handled before completed or fallback media');
  assert.match(generatingBranch, /role="status"/);
  assert.match(generatingBranch, /修改结果生成中/);
  assert.doesNotMatch(generatingBranch, /<img\b/);
  assert.doesNotMatch(generatingBranch, /result\.imageUrl/);
});

test('translation region dialog is driven by the selected version and closes immediately after submit', async () => {
  const source = await readFile(projectCardUrl, 'utf8');
  const submitStart = source.indexOf('onSubmit={async (input) => {');
  const submitEnd = source.indexOf('\n          }}', submitStart);
  const submitBlock = source.slice(submitStart, submitEnd);

  assert.match(source, /const \[translationRegionEditDialog, setTranslationRegionEditDialog\] = useState</);
  assert.match(source, /const \[translationRegionEditSubmittingResultIds, setTranslationRegionEditSubmittingResultIds\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(source, /const isTranslationRegionEditSubmitting = \(resultId: string\) => Boolean\(translationRegionEditSubmittingResultIds\[resultId\]\)/);
  assert.match(source, /imageUrl=\{translationRegionEditDialog\.imageUrl\}/);
  assert.match(source, /sourceVersionId=\{translationRegionEditDialog\.sourceVersionId\}/);
  assert.match(source, /title=\{translationRegionEditDialog\.title\}/);
  assert.match(submitBlock, /const resultId = translationRegionEditDialog\.resultId/);
  assert.match(submitBlock, /setTranslationRegionEditSubmittingResultIds\(\(current\) => \(\{ \.\.\.current, \[resultId\]: true \}\)\)/);
  assert.match(submitBlock, /setTranslationRegionEditDialog\(null\)[\s\S]*?await onTranslationRegionEdit\(project\.id, resultId, input\)/);
  assert.doesNotMatch(submitBlock, /await onTranslationRegionEdit[\s\S]*?setTranslationRegionEditDialog\(null\)/);
  assert.match(submitBlock, /finally\s*\{[\s\S]*?delete next\[resultId\]/);
  assert.match(source, /const translationEditPending = Boolean\(pendingTranslationEditVersion\) \|\| isTranslationRegionEditSubmitting\(result\.id\)/);
});

test('translation region edit props pass through only the translation module chain', async () => {
  const [projectList, translationModule] = await Promise.all([
    readFile(projectListViewUrl, 'utf8'),
    readFile(translationModuleUrl, 'utf8'),
  ]);

  for (const prop of ['onTranslationRegionEdit', 'onCancelTranslationRegionEdit']) {
    assert.match(projectList, new RegExp(`${prop}\\?:`));
    assert.match(projectList, new RegExp(`${prop}=\\{${prop}\\}`));
    assert.match(translationModule, new RegExp(`${prop}\\?:`));
    assert.match(translationModule, new RegExp(`${prop}=\\{${prop}\\}`));
  }
});
