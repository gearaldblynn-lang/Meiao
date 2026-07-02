# Smart Factory RAG Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐智能工厂知识库训练链路，让知识库从“能展示/能简单搜索”升级到“能上传、能分段、能看训练状态、能调召回参数、能给智能体返回引用”的可验收能力。

**Architecture:** 复用现有 AgentCenter 的 chunk strategy 和检索策略思想，收口到 `server/ai-engine/knowledgeIngestion.mjs`、`server/ai-engine/knowledgeRetrieval.mjs`、`server/smartFactoryConfigStore.mjs`。前端 `SmartFactoryKnowledgeManager` 只负责 Dify 风格管理体验，不在智能体编辑页内承担上传训练。

**Tech Stack:** Node `.mjs` tests, Vite/React/TypeScript frontend, existing Smart Factory config store and preview runtime.

---

## Scope

- 做：文件/文本训练、分段策略、训练失败状态、召回 topK/阈值、引用元数据、前端设置和召回测试交互。
- 不做：完整 Dify Docker 栈、完整租户权限、完整 plugin daemon、完整 workflow 编辑器、线上 embedding 计费接入。

## Acceptance

- 文档训练支持 `general/rule/sop/faq/case` 策略和 `maxChunkChars`。
- 空文档不会被静默丢弃，要保留 `failed` 状态和错误原因。
- 知识库有 retrievalPolicy，召回测试可调 topK 和 similarityThreshold。
- 检索结果包含 knowledgeBaseId、documentId、chunkId、title、content、score、chunkIndex。
- 智能体预览返回 citations/runLog.knowledgeRefs，能看到引用来源。
- 前端知识库详情页显示训练状态、分段数、错误原因、策略设置、召回参数。
- `node --test server/ai-engine/knowledgeIngestion.test.mjs server/ai-engine/knowledgeRetrieval.test.mjs server/smartFactoryConfigStore.test.mjs server/smartFactoryPreview.test.mjs` 通过。
- `node --experimental-strip-types --test src/modules/AgentCenter/SmartFactoryKnowledgeManager.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs` 通过。
- `npm run build` 通过。
- 浏览器截图覆盖知识库设置、召回测试、文档训练状态。
