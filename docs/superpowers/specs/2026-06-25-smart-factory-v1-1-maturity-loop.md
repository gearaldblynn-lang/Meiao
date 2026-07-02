# Smart Factory V1.1 Maturity Loop

## Goal

Smart Factory must stop being a form collection and become a usable agent workbench. The product is acceptable only when an admin can configure a model relay, train usable knowledge, bind tools, publish an agent, chat with it, and inspect why a reply happened.

## Benchmark

The benchmark is Dify-style agent building plus commercial chat-client ergonomics:

- Chat is the primary surface. Configuration supports the chat, it does not replace it.
- Agent publishing has an explicit readiness check.
- Knowledge has document status, chunk counts, retrieval testing, preview, and citations.
- Tools have schema, authorization state, test invocation, and run evidence.
- Runtime logs are readable summaries first, raw traces second.

Full Dify parity is not claimed for V1.1. These are out of scope for this loop: visual workflow canvas, plugin daemon, sandbox isolation, full multi-tenant permission matrix, and binary PDF/DOCX parser fidelity.

## Loop

1. Benchmark current Dify and commercial agent workbench behavior.
2. Score the current Smart Factory against the maturity rubric below.
3. Implement the highest-impact missing product affordances.
4. Run automated tests, build, and browser checks.
5. Re-score. Repeat until no P0/P1 issue remains and the V1.1 score is at least 85/100.

## Maturity Rubric

| Area | Weight | V1.1 acceptance |
| --- | ---: | --- |
| Agent lifecycle | 20 | Create, edit, save draft, publish, select in chat, and show publish readiness. |
| Model relay | 15 | Multiple provider/model IDs, base URL, credential reference, default/fallback, connection test, no secret leakage. |
| Knowledge RAG | 20 | Create knowledge base, upload text-like files, train chunks, preview documents, retrieval test, citations in chat. |
| Tools and CLI | 15 | Register CLI tool, schema, auth/risk state, test tool, bind to agent, show tool result in chat trace. |
| Chat UX | 15 | Chat-first layout, session list, clear empty states, sample prompts, visible citations and tool evidence. |
| Observability | 10 | Latest runs summarized by agent, model, citations, tools, and raw trace. |
| Product polish | 5 | Setup completion, disabled/guarded actions, concise labels, no overflowing primary text. |

## Current Score Before V1.1

- Agent lifecycle: 12/20. Draft/publish exists, but no readiness reasoning.
- Model relay: 12/15. Config/test exists, but setup completion is hidden.
- Knowledge RAG: 12/20. Upload/retrieval exists, but no document preview and citations are not readable in the chat UI.
- Tools and CLI: 10/15. Tool registration/test exists, but runtime tool evidence is raw JSON.
- Chat UX: 9/15. Chat works, but the side panel reads like debug output.
- Observability: 5/10. Logs exist, but are raw traces.
- Product polish: 1/5. No maturity loop or setup checklist.

Total: 61/100.

## V1.1 Target

This loop must raise Smart Factory to at least 85/100 by adding:

- A setup completion and commercial-readiness panel.
- Agent publish readiness checks for model, prompt, knowledge, tools, and successful run history.
- Document preview in the knowledge table.
- Citation and tool-result cards in the chat side panel.
- Readable run-log summaries with raw trace still available.
- Tests proving the workbench exposes these product affordances.

## Verification

Run these before claiming this loop is complete:

```bash
node --test server/smartFactoryConfigStore.test.mjs server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs server/ai-engine/*.test.mjs
node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs src/shell/components/layout/SidebarNavigation.test.mjs src/shell/modules/AgentCenter/AgentCenterModule.test.mjs src/components/uiArchitecture.test.mjs
npm run build
```

Browser acceptance at `http://localhost:3000/`:

- Smart Factory appears under the main Agent section.
- Setup completion is visible.
- Published-agent chat shows citations and tool results after a run.
- Knowledge documents show preview text, status, and chunk count.
- Run Logs show readable summaries before raw JSON.
