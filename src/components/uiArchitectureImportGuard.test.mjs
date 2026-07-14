import test from 'node:test';
import assert from 'node:assert/strict';

import { hasRuntimeStaticImport } from './uiArchitectureImportGuard.mjs';

const SHELL_WORKFLOW_MODULE = './adapters/shellWorkflow';

test('runtime static import guard covers value syntaxes while allowing import type', async (t) => {
  const cases = [
    {
      label: 'named import',
      source: "import { runShellRetouchWorkflow } from './adapters/shellWorkflow';",
      expected: true,
    },
    {
      label: 'default import',
      source: "import shellWorkflow from './adapters/shellWorkflow';",
      expected: true,
    },
    {
      label: 'namespace import',
      source: "import * as shellWorkflow from './adapters/shellWorkflow';",
      expected: true,
    },
    {
      label: 'side-effect import',
      source: "import './adapters/shellWorkflow';",
      expected: true,
    },
    {
      label: 'type-only import',
      source: "import type { ShellWorkflowImageResult } from './adapters/shellWorkflow';",
      expected: false,
    },
    {
      label: 'dynamic import',
      source: "const shellWorkflow = await import('./adapters/shellWorkflow');",
      expected: false,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.label, () => {
      assert.equal(
        hasRuntimeStaticImport(fixture.source, SHELL_WORKFLOW_MODULE),
        fixture.expected,
      );
    });
  }
});
