import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const panelPath = new URL('./ProductRestoreAnalysisPanel.tsx', import.meta.url);
let moduleSequence = 0;

const focusOptions = [
  { id: 'shape_structure', label: '形态与结构' },
  { id: 'proportion_contour', label: '比例与轮廓' },
  { id: 'material_texture', label: '材质与纹理' },
  { id: 'color_gloss', label: '颜色与光泽' },
  { id: 'logo_label_text', label: 'Logo/标签/包装文字' },
  { id: 'component_craft', label: '关键部件与工艺细节' },
];

const stripRuntimeImports = (source) => source.replace(/^import[\s\S]*?;\n/gm, '');

const loadPanelModule = async () => {
  const source = readFileSync(panelPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const runtimeSource = `
const React = globalThis.__productRestoreAnalysisPanelTestDeps.React;
const PRODUCT_RESTORE_FOCUS_OPTIONS = globalThis.__productRestoreAnalysisPanelTestDeps.focusOptions;
${stripRuntimeImports(transpiled)}
`;
  globalThis.__productRestoreAnalysisPanelTestDeps = { React, focusOptions };
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(runtimeSource).toString('base64')}#panel-${++moduleSequence}`);
  } finally {
    delete globalThis.__productRestoreAnalysisPanelTestDeps;
  }
};

const context = {
  version: 1,
  analysisJobId: 'analysis-job-1',
  analysisProviderTaskId: 'analysis-provider-1',
  analysisModel: 'gpt-5.4-vision',
  analysisCreditsConsumed: 4,
  normalizedAnalysis: {
    productIdentitySummary: '琥珀色磨砂玻璃瓶，窄瓶颈与半透明瓶盖为核心身份。',
    invariantFeatures: [
      '保持高而窄的圆柱瓶身',
      '保持居中白色标签',
      '保持半透明瓶盖',
      '保持磨砂材质',
      '保持琥珀色',
      '保持瓶肩轮廓',
      '第七条应收起',
    ],
    shapeAndStructure: [],
    proportionAndContour: [],
    materialAndTexture: [],
    colorAndGloss: [],
    logoLabelAndText: [],
    componentsAndCraft: [],
    targetSetIssues: [
      '瓶身轮廓漂移',
      '标签比例不一致',
      '瓶盖透明度错误',
      '材质过于光滑',
      '颜色偏红',
      '瓶颈过宽',
      '第七个问题应收起',
    ],
    nonProductPreservationRules: [],
  },
  sharedRestorationPrompt: 'Restore only the verified product body.\nPreserve every non-product pixel.',
  focusIds: ['shape_structure', 'material_texture'],
  targetMaterialIds: ['target-a'],
  productReferenceMaterialIds: ['reference-a'],
  selectedImageModel: 'gpt-image-2',
  resolution: '2K',
  userRequirement: '',
  createdAt: 1_780_000_000_000,
};

const nodeText = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  return nodeText(node.props?.children);
};

const findNode = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  const children = React.Children.toArray(node.props?.children);
  for (const child of children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
};

test('renders Product Restoration analysis, bounded lists, shared prompt, and real credit ledger', async () => {
  const { default: ProductRestoreAnalysisPanel } = await loadPanelModule();
  const markup = renderToStaticMarkup(React.createElement(ProductRestoreAnalysisPanel, {
    context,
    imageCreditsConsumed: 6,
    totalCreditsConsumed: 10,
    onCopyPrompt: () => {},
  }));

  assert.match(markup, /分析模型/);
  assert.match(markup, /gpt-5\.4-vision/);
  assert.match(markup, /形态与结构/);
  assert.match(markup, /材质与纹理/);
  assert.match(markup, /琥珀色磨砂玻璃瓶/);
  assert.match(markup, /共享还原 Prompt/);
  assert.match(markup, /Restore only the verified product body/);
  assert.match(markup, /分析积分/);
  assert.match(markup, /出图积分/);
  assert.match(markup, /总积分/);
  assert.match(markup, />4</);
  assert.match(markup, />6</);
  assert.match(markup, />10</);
  assert.match(markup, /其余 1 条/);
  assert.doesNotMatch(markup, /第七条应收起/);
  assert.doesNotMatch(markup, /第七个问题应收起/);
  assert.match(markup, /<details/);
});

test('copy action forwards the persisted shared prompt and absent credits are not invented', async () => {
  const { default: ProductRestoreAnalysisPanel } = await loadPanelModule();
  let copied = '';
  const element = ProductRestoreAnalysisPanel({
    context: { ...context, analysisCreditsConsumed: 0 },
    onCopyPrompt: (prompt) => {
      copied = prompt;
    },
  });
  const copyButton = findNode(element, (node) => (
    node.type === 'button' && nodeText(node).includes('复制共享 Prompt')
  ));

  assert.ok(copyButton, 'copy button should be rendered');
  copyButton.props.onClick();
  assert.equal(copied, context.sharedRestorationPrompt);
  const markup = renderToStaticMarkup(element);
  assert.doesNotMatch(markup, /分析积分/);
  assert.doesNotMatch(markup, /出图积分/);
  assert.doesNotMatch(markup, /总积分/);
});

test('ProjectCard scopes the panel to Product Restoration with persisted context', () => {
  const projectCardSource = readFileSync(
    fileURLToPath(new URL('../../components/ProjectCard.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(projectCardSource, /isProductRestoreProject && productRestoreContext[\s\S]*ProductRestoreAnalysisPanel/);
});

test('ProjectCard keeps persisted sourceUrl beside restored output and wires manual reanalysis deliberately', () => {
  const projectCardSource = readFileSync(
    fileURLToPath(new URL('../../components/ProjectCard.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(projectCardSource, /isProductRestoreProject[\s\S]*sourcePreviewUrl \|\| displayResult\.sourceUrl/);
  assert.match(projectCardSource, /ProductRestoreAnalysisPanel/);
  assert.match(projectCardSource, /后端状态/);
  assert.match(projectCardSource, /后端任务 ID/);
  assert.match(projectCardSource, /isProductRestoreProject && displayResult\.error/);
  assert.match(projectCardSource, /重新分析并继续/);
  assert.match(projectCardSource, /PRODUCT_RESTORE_MANUAL_REANALYSIS_RESULT_ID/);
});

test('Shell regeneration routes Product Restoration through persisted-context retry before generic regeneration', () => {
  const shellSource = readFileSync(
    fileURLToPath(new URL('../../../ShellMigratedApp.tsx', import.meta.url)),
    'utf8',
  );
  const specialRetryIndex = shellSource.indexOf('runShellProductRestoreSingleRetry');
  const genericRetryIndex = shellSource.indexOf("if (project.sourceType === 'job')", specialRetryIndex);

  assert.ok(specialRetryIndex > 0, 'special Product Restoration retry must be wired');
  assert.ok(genericRetryIndex > specialRetryIndex, 'special retry must run before generic regeneration');
  assert.match(shellSource, /PRODUCT_RESTORE_MANUAL_REANALYSIS_RESULT_ID/);
  assert.match(shellSource, /productRestoreManualRetry:\s*true/);
  assert.match(shellSource, /productRestoreAnalysisSubmissionKey/);
  assert.match(shellSource, /onProductRestoreAnalysisCompleted:\s*async[\s\S]*await persistProjectToSharedState/);
});
