export const DIFY_APP_STUDIO_SOURCE_PATHS = {
  upstreamRepository: 'https://github.com/langgenius/dify.git',
  upstreamCommit: '599d92ef6b59adcaffc82f5231391749fa1ef94c',
  appSidebar: 'web/app/components/app-sidebar/app-detail-section.tsx',
  appInfo: 'web/app/components/app-sidebar/app-info/index.tsx',
  agentPanel: 'web/app/components/workflow/nodes/agent-v2/panel.tsx',
  agentTaskField: 'web/app/components/workflow/nodes/agent-v2/components/agent-task-field.tsx',
  agentOrchestrateDrawer: 'web/app/components/workflow/nodes/agent-v2/components/agent-orchestrate-drawer-panel.tsx',
  promptEditor: 'web/app/components/base/prompt-editor/index.tsx',
  debugPreview: 'web/app/components/workflow/panel/debug-and-preview/index.tsx',
  knowledgeRetrieval: 'web/app/components/workflow/nodes/knowledge-retrieval/panel.tsx',
  datasetsPage: 'web/app/(commonLayout)/datasets/page.tsx',
  datasetList: 'web/app/components/datasets/list',
  datasetDetailLayout: 'web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/layout-main.tsx',
  datasetDocuments: 'web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/documents/page.tsx',
  datasetHitTesting: 'web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/hitTesting/page.tsx',
  datasetSettings: 'web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/settings/page.tsx',
  datasetApi: 'web/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/api/page.tsx',
  toolMarketplace: 'web/app/components/tools/marketplace/index.tsx',
} as const;

export const DIFY_APP_STUDIO_MIGRATION_MODE = 'adapted-source-port';
