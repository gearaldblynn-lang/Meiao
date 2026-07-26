import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

import {
  getProductRestoreAnalysisCreditSummary,
  getProductRestoreTotalKnownCredits,
  normalizeKnownProductRestoreCredits,
} from '../../utils/productRestoreAnalysisCredits.ts';
import {
  getStoryboardCardSegmentCount,
  isStoryboardAwaitingImageConfirmation,
} from '../modules/Video/storyboardGenerationState.mjs';
import { resolveProjectCardActivity } from './projectCardActivity.mjs';

const projectCardPath = new URL('./ProjectCard.tsx', import.meta.url);
let moduleSequence = 0;

const stripRuntimeImports = (source) => source.replace(/^import[\s\S]*?;\n/gm, '');

const loadProjectCardModule = async () => {
  const source = readFileSync(projectCardPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const runtimeSource = `
const {
  React,
  getProductRestoreAnalysisCreditSummary,
  getProductRestoreTotalKnownCredits,
  normalizeKnownProductRestoreCredits,
  getStoryboardCardSegmentCount,
  isStoryboardAwaitingImageConfirmation,
  resolveProjectCardActivity,
} = globalThis.__projectCardCreditTestDeps;
const useEffect = React.useEffect;
const useRef = React.useRef;
let projectCardStateCall = 0;
const useState = (initialValue) => {
  projectCardStateCall += 1;
  return React.useState(projectCardStateCall === 1 ? true : initialValue);
};
const Icon = () => null;
const CheckSquare2 = Icon;
const ChevronLeft = Icon;
const ChevronRight = Icon;
const Copy = Icon;
const Download = Icon;
const FileText = Icon;
const Film = Icon;
const ImagePlus = Icon;
const Maximize2 = Icon;
const Package = Icon;
const Palette = Icon;
const Play = Icon;
const RefreshCw = Icon;
const RotateCcw = Icon;
const Scissors = Icon;
const Sparkles = Icon;
const Square = Icon;
const Trash2 = Icon;
const X = Icon;
const copyTextToClipboard = async () => true;
const isInvalidOneClickPlanLike = () => false;
const getProjectResultRegenerationUnavailableReason = () => null;
const isProjectResultRegenerationEligible = () => true;
const formatMonthDay = () => '07-14';
const canManuallyReanalyzeProductRestore = () => false;
const PRODUCT_RESTORE_MANUAL_REANALYSIS_RESULT_ID = 'product-restore-manual-analysis';
const EmptyComponent = () => null;
const ConfirmDialog = EmptyComponent;
const ImageLightbox = EmptyComponent;
const RetouchComparisonViewer = EmptyComponent;
const buildRetouchComparisonItems = () => [];
const isRetouchComparisonScope = (module, subFeature) => (
  module === 'retouch' && ['original', 'white_bg', 'product_restore'].includes(subFeature)
);
const PlanEditor = EmptyComponent;
const useToast = () => ({ addToast: () => undefined });
const ProductRestoreResultCreditBadge = EmptyComponent;
const ProductRestoreAnalysisPanel = (props) => React.createElement('output', {
  'data-testid': 'project-card-product-restore-credits',
  'data-image-credits': props.imageCreditsConsumed === undefined
    ? 'unknown'
    : String(props.imageCreditsConsumed),
  'data-total-credits': props.totalCreditsConsumed === undefined
    ? 'unknown'
    : String(props.totalCreditsConsumed),
});
${stripRuntimeImports(transpiled)}
export const resetProjectCardTestState = () => { projectCardStateCall = 0; };
`;
  globalThis.__projectCardCreditTestDeps = {
    React,
    getProductRestoreAnalysisCreditSummary,
    getProductRestoreTotalKnownCredits,
    normalizeKnownProductRestoreCredits,
    getStoryboardCardSegmentCount,
    isStoryboardAwaitingImageConfirmation,
    resolveProjectCardActivity,
  };
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(runtimeSource).toString('base64')}#project-card-credit-${++moduleSequence}`
    );
  } finally {
    delete globalThis.__projectCardCreditTestDeps;
  }
};

const productRestoreContext = {
  version: 1,
  analysisJobId: 'analysis-job-1',
  analysisModel: 'vision-model',
  normalizedAnalysis: {
    productIdentitySummary: 'product identity',
    invariantFeatures: [],
    shapeAndStructure: [],
    proportionAndContour: [],
    materialAndTexture: [],
    colorAndGloss: [],
    logoLabelAndText: [],
    componentsAndCraft: [],
    targetSetIssues: [],
    nonProductPreservationRules: [],
  },
  sharedRestorationPrompt: 'restore verified product only',
  focusIds: ['shape_structure'],
  targetMaterialIds: ['target-1'],
  productReferenceMaterialIds: ['reference-1'],
  selectedImageModel: 'gpt-image-2',
  resolution: '2K',
  userRequirement: '',
  createdAt: 123,
};

const makeProject = (creditsConsumed) => ({
  id: 'product-restore-project',
  name: 'Product Restoration',
  module: 'retouch',
  subFeature: 'product_restore',
  status: 'completed',
  createdAt: 123,
  completedAt: 123,
  taskCount: 1,
  completedCount: 1,
  generationContext: {
    prompt: '',
    params: {},
    materials: {},
    productRestore: productRestoreContext,
  },
  results: [{
    id: 'result-1',
    imageUrl: '/result.png',
    mediaType: 'image',
    prompt: 'restore',
    model: 'gpt-image-2',
    aspectRatio: '1:1',
    status: 'completed',
    createdAt: 123,
    module: 'retouch',
    subFeature: 'product_restore',
    creditsConsumed,
  }],
});

const getRenderedCreditAttributes = (markup) => {
  const match = markup.match(
    /<output[^>]*data-testid="project-card-product-restore-credits"[^>]*>/,
  );
  assert.ok(match, 'ProjectCard detail must render the Product Restoration analysis panel');
  return {
    image: match[0].match(/data-image-credits="([^"]+)"/)?.[1],
    total: match[0].match(/data-total-credits="([^"]+)"/)?.[1],
  };
};

test('ProjectCard passes only strict known Product Restoration image credits into the analysis panel', async () => {
  const { default: ProjectCard, resetProjectCardTestState } = await loadProjectCardModule();

  for (const creditsConsumed of [false, [], {}, '   ', '01', '1e2', '.5']) {
    resetProjectCardTestState();
    const markup = renderToStaticMarkup(React.createElement(ProjectCard, {
      project: makeProject(creditsConsumed),
    }));
    assert.deepEqual(getRenderedCreditAttributes(markup), {
      image: 'unknown',
      total: 'unknown',
    });
  }

  for (const [creditsConsumed, expected] of [[0, '0'], ['0', '0'], [1.25, '1.25'], ['0.5', '0.5']]) {
    resetProjectCardTestState();
    const markup = renderToStaticMarkup(React.createElement(ProjectCard, {
      project: makeProject(creditsConsumed),
    }));
    assert.deepEqual(getRenderedCreditAttributes(markup), {
      image: expected,
      total: expected,
    });
  }
});
