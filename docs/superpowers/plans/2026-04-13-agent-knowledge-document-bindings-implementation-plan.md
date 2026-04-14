# Agent Knowledge Document Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each agent version independently choose which documents inside its bound knowledge bases are enabled for retrieval.

**Architecture:** Store version-level document bindings on `AgentVersion`, expose them through existing agent version read/write APIs, render per-knowledge-base document checklists inside the agent config UI, and filter retrieval queries by enabled `documentId` sets in both MySQL and Local JSON modes. Default behavior remains unchanged for old versions until a binding is explicitly saved.

**Tech Stack:** React, TypeScript, Node.js, Local JSON mode, MySQL-backed server routes, node:test source tests

---

### Task 1: Add version-level document binding types and normalization

**Files:**
- Modify: `types.ts`
- Modify: `modules/AgentCenter/agentCenterUtils.mjs`
- Test: `modules/AgentCenter/agentCenterUtils.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
test('normalizeAgentConfig keeps version-level knowledge document bindings grouped by knowledge base', () => {
  const config = normalizeAgentConfig({
    knowledgeDocumentBindings: [
      { knowledgeBaseId: 'kb_1', enabledDocumentIds: ['doc_1', 'doc_2', '', 'doc_1'] },
      { knowledgeBaseId: ' ', enabledDocumentIds: ['doc_3'] },
    ],
  });

  assert.deepEqual(config.knowledgeDocumentBindings, [
    { knowledgeBaseId: 'kb_1', enabledDocumentIds: ['doc_1', 'doc_2'] },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='knowledge document bindings grouped by knowledge base' modules/AgentCenter/agentCenterUtils.test.mjs`
Expected: FAIL because `knowledgeDocumentBindings` is not normalized or exposed yet.

- [ ] **Step 3: Write minimal implementation**

```javascript
const normalizeKnowledgeDocumentBindings = (input) => (
  Array.isArray(input)
    ? input
        .map((item) => ({
          knowledgeBaseId: typeof item?.knowledgeBaseId === 'string' ? item.knowledgeBaseId.trim() : '',
          enabledDocumentIds: Array.from(new Set(
            (Array.isArray(item?.enabledDocumentIds) ? item.enabledDocumentIds : [])
              .map((value) => String(value || '').trim())
              .filter(Boolean)
          )),
        }))
        .filter((item) => item.knowledgeBaseId)
    : []
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='knowledge document bindings grouped by knowledge base' modules/AgentCenter/agentCenterUtils.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add types.ts modules/AgentCenter/agentCenterUtils.mjs modules/AgentCenter/agentCenterUtils.test.mjs
git commit -m "feat: normalize agent knowledge document bindings"
```

### Task 2: Persist bindings through agent version read/write flows

**Files:**
- Modify: `server/index.mjs`
- Modify: `services/internalApi.ts`
- Modify: `types.ts`
- Test: `server/agentCenterSource.test.mjs`

- [ ] **Step 1: Write the failing source test**

```javascript
test('agent version source persists knowledge document bindings in mysql and local modes', () => {
  assert.match(source, /knowledge_document_bindings_json LONGTEXT NULL/);
  assert.match(source, /ensureMysqlColumn\(pool, 'agent_versions', 'knowledge_document_bindings_json', 'LONGTEXT NULL'\)/);
  assert.match(source, /knowledgeDocumentBindings:/);
  assert.match(source, /payload\.knowledgeDocumentBindings/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='knowledge document bindings in mysql and local modes' server/agentCenterSource.test.mjs`
Expected: FAIL because the field is not stored yet.

- [ ] **Step 3: Write minimal implementation**

```javascript
await ensureMysqlColumn(pool, 'agent_versions', 'knowledge_document_bindings_json', 'LONGTEXT NULL');

knowledgeDocumentBindings: normalizeKnowledgeDocumentBindings(parseJsonField(row.knowledge_document_bindings_json, [])),

knowledgeDocumentBindingsJson: stringifyJsonField(config.knowledgeDocumentBindings, []),

knowledgeDocumentBindings: payload.knowledgeDocumentBindings ?? current.knowledgeDocumentBindings,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='knowledge document bindings in mysql and local modes' server/agentCenterSource.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs services/internalApi.ts types.ts server/agentCenterSource.test.mjs
git commit -m "feat: persist agent knowledge document bindings"
```

### Task 3: Add document checklist UI to agent version config

**Files:**
- Modify: `modules/AgentCenter/AgentCenterManager.tsx`
- Modify: `modules/AgentCenter/AgentWizardView.tsx`
- Modify: `types.ts`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing UI source test**

```javascript
test('agent manager source exposes per-knowledge-base document checklists for agent versions', () => {
  assert.match(manager, /knowledgeDocumentBindings/);
  assert.match(manager, /enabledDocumentIds/);
  assert.match(manager, /全选/);
  assert.match(manager, /全不选/);
  assert.match(manager, /该知识库当前不会提供检索内容/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='per-knowledge-base document checklists' components/uiArchitecture.test.mjs`
Expected: FAIL because the UI does not render document checklists.

- [ ] **Step 3: Write minimal implementation**

```tsx
{form.selectedKnowledgeBaseIds.map((knowledgeBaseId) => {
  const kbDocs = knowledgeDocumentsByBase[knowledgeBaseId] || [];
  const binding = form.knowledgeDocumentBindings.find((item) => item.knowledgeBaseId === knowledgeBaseId);
  const enabledIds = new Set(binding?.enabledDocumentIds || kbDocs.map((item) => item.id));
  return (
    <div key={knowledgeBaseId}>
      <button type="button" onClick={() => onToggleAllDocuments(knowledgeBaseId, true)}>全选</button>
      <button type="button" onClick={() => onToggleAllDocuments(knowledgeBaseId, false)}>全不选</button>
      {kbDocs.map((doc) => (
        <label key={doc.id}>
          <input type="checkbox" checked={enabledIds.has(doc.id)} onChange={() => onToggleDocument(knowledgeBaseId, doc.id)} />
          {doc.title}
        </label>
      ))}
      {enabledIds.size === 0 ? <p>该知识库当前不会提供检索内容</p> : null}
    </div>
  );
})}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='per-knowledge-base document checklists' components/uiArchitecture.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/AgentCenter/AgentCenterManager.tsx modules/AgentCenter/AgentWizardView.tsx types.ts components/uiArchitecture.test.mjs
git commit -m "feat: add agent document binding controls"
```

### Task 4: Filter retrieval by enabled document ids in MySQL and Local JSON modes

**Files:**
- Modify: `server/index.mjs`
- Test: `server/agentCenterSource.test.mjs`

- [ ] **Step 1: Write the failing source test**

```javascript
test('agent retrieval source filters chunks by enabled knowledge document ids', () => {
  assert.match(source, /const resolveEnabledKnowledgeDocumentIds = \(version, knowledgeBaseId, availableDocumentIds = \[\]\) =>/);
  assert.match(source, /AND kc\.document_id IN/);
  assert.match(source, /chunk\.documentId/);
  assert.match(source, /enabledDocumentIds\.has\(chunk\.documentId\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='filters chunks by enabled knowledge document ids' server/agentCenterSource.test.mjs`
Expected: FAIL because retrieval does not filter by version bindings.

- [ ] **Step 3: Write minimal implementation**

```javascript
const resolveEnabledKnowledgeDocumentIds = (version, knowledgeBaseId, availableDocumentIds = []) => {
  const binding = (Array.isArray(version?.knowledgeDocumentBindings) ? version.knowledgeDocumentBindings : [])
    .find((item) => item.knowledgeBaseId === knowledgeBaseId);
  if (!binding) return new Set(availableDocumentIds);
  return new Set(binding.enabledDocumentIds.filter((id) => availableDocumentIds.includes(id)));
};
```

```javascript
const enabledDocumentIds = resolveEnabledKnowledgeDocumentIds(version, knowledgeBaseId, availableDocumentIds);
if (enabledDocumentIds.size === 0) return [];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='filters chunks by enabled knowledge document ids' server/agentCenterSource.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs server/agentCenterSource.test.mjs
git commit -m "feat: filter retrieval by agent document bindings"
```

### Task 5: Verify default compatibility and end-to-end source coverage

**Files:**
- Modify: `server/agentCenterSource.test.mjs`
- Modify: `components/uiArchitecture.test.mjs`
- Test: `server/agentCenterSource.test.mjs`
- Test: `components/uiArchitecture.test.mjs`
- Test: `modules/AgentCenter/agentCenterUtils.test.mjs`

- [ ] **Step 1: Add compatibility coverage**

```javascript
test('agent retrieval source treats missing document bindings as all documents enabled', () => {
  assert.match(source, /if \(!binding\) return new Set\(availableDocumentIds\);/);
});
```

- [ ] **Step 2: Run focused regression suite**

Run: `node --test server/agentCenterSource.test.mjs components/uiArchitecture.test.mjs modules/AgentCenter/agentCenterUtils.test.mjs`
Expected: PASS for the new binding-related assertions; if unrelated pre-existing tests fail, record them separately and rerun with `--test-name-pattern` for the binding cases.

- [ ] **Step 3: Run TypeScript validation**

Run: `npm run lint`
Expected: PASS with no new type errors introduced by the binding fields.

- [ ] **Step 4: Commit**

```bash
git add server/agentCenterSource.test.mjs components/uiArchitecture.test.mjs modules/AgentCenter/agentCenterUtils.test.mjs
git commit -m "test: cover agent knowledge document bindings"
```
