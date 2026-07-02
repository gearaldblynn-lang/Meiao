# Dify 源码迁移映射草案

> 日期：2026-06-25
> 状态：Batch 1 已选择并落地核心契约层；UI/运行时/数据库仍待后续批次。
> Dify upstream：`https://github.com/langgenius/dify.git`
> 审计 commit：`599d92ef6b59adcaffc82f5231391749fa1ef94c`
> 本地审计目录：`/tmp/meiao-dify-audit`，不进入梅奥项目源码。

---

## 1. 迁移原则

智能工厂不是按 Dify 思路仿写，而是优先迁移 Dify 已有代码和运行契约，再适配到梅奥自己的 AI Engine。

梅奥不使用 Dify Web 前端。原因是 Dify license 对 `web/` 前端的 logo/copyright 有额外限制，而且我们要做梅奥自己的 Codex/Claude 客户端式对话体验。

旧梅奥智能体模块不作为产品模板。它只作为可选资产池，后续如果某个底层能力已经稳定且有测试，可以按接口复用；旧智能体 UI、旧工作室流程、旧配置结构不进入智能工厂设计。

## 2. 许可证处理

Dify 当前 license 是 Apache 2.0 加额外条件：

- 商业使用允许，但满足 Dify 定义的多租户服务条件时需要商业授权。
- 使用 Dify 前端时不能移除或修改 Dify console/application 的 logo 和版权信息。
- Dify 产品交互设计有外观专利声明。

梅奥本阶段的处理：

- 不迁移 `web/` 前端。
- 不完整运行 Dify 多租户 workspace 体系。
- 迁移后端代码片段或契约时，在目标文件头部或相邻 `NOTICE` 文档记录 Dify 来源路径、commit 和 license。
- 如果某段 Python 代码不能直接进入 Node 运行时，则迁移它的数据结构、校验规则、错误语义和测试样例，用 Node 适配实现承载。

## 3. 总体迁移形态

推荐方式：选择性代码迁移，不 vendor 整个 Dify 仓库。

```text
Dify upstream 源码
  -> 源码映射表
  -> 选择 A/B/C 首批模块
  -> 迁移到 server/ai-engine/*
  -> 梅奥前端 src/modules/SmartFactory/*
  -> 测试锁定 Dify 行为契约
```

不推荐把 Dify 全仓库放进项目直接运行。那会把 Python 后端、plugin daemon、sandbox、Docker 服务栈、Dify 数据库迁移一起带进来，升级和发布都会变重。

## 4. A：模型中转 + 智能体配置

### 4.1 可迁移来源

| 能力 | Dify source path | 迁移方式 | 梅奥目标模块 | 验收 |
| --- | --- | --- | --- | --- |
| 模型 provider 响应结构 | `api/services/entities/model_provider_entities.py` | 裁剪迁移字段结构 | `server/ai-engine/modelProviderSchema.mjs` | provider/model/capability 不含 secret，可序列化 |
| 模型运行实例契约 | `api/core/model_manager.py` | 行为适配 | `server/ai-engine/modelRuntime.mjs` | 能统一调用 LLM、embedding、tool-capable model |
| App model config 校验 | `api/core/app/app_config/easy_ui_based_app/model_config/manager.py` | 直接迁移校验规则到 JS | `server/ai-engine/modelConfigValidator.mjs` | 缺 provider/model/params 时明确报错 |
| Agent Soul 主配置结构 | `api/models/agent_config_entities.py` | 裁剪迁移 | `server/ai-engine/agentConfigSchema.mjs` | prompt/model/knowledge/tools/env 分区稳定 |
| Dify Agent LLM layer | `dify-agent/src/dify_agent/layers/dify_plugin/llm_layer.py` | 行为适配 | `server/ai-engine/layers/modelLayer.mjs` | 一轮 run 只通过配置模型调用，不读前端密钥 |
| Agenton compositor | `dify-agent/src/agenton/compositor/*.py` | 概念和 DTO 迁移 | `server/ai-engine/compositor/*` | layer graph 可序列化，可恢复 session snapshot |

### 4.2 梅奥目标设计

新增智能工厂自己的 agent 配置，不沿用旧智能体版本作为主数据结构：

```text
smart_factory_agents
smart_factory_agent_versions
smart_factory_model_providers
smart_factory_model_credentials
smart_factory_conversations
smart_factory_messages
smart_factory_runs
```

第一批不一定马上建完整表，但服务层和类型要按这个边界设计。

### 4.3 首批实现建议

先迁移 `AgentSoulConfig` 的核心结构：

```text
prompt
model
knowledge
tools
env
app_features
```

CLI、sandbox、memory、human、output check 先保留 schema 插槽，不做完整能力。

## 5. B：知识库 RAG

### 5.1 可迁移来源

| 能力 | Dify source path | 迁移方式 | 梅奥目标模块 | 验收 |
| --- | --- | --- | --- | --- |
| Retrieval setting 实体 | `api/core/rag/entities/retrieval_settings.py` | 直接迁移字段 | `server/ai-engine/rag/retrievalSettings.mjs` | vector/keyword/rerank 配置可校验 |
| Dataset retrieval 编排 | `api/core/rag/retrieval/dataset_retrieval.py` | 行为适配 | `server/ai-engine/rag/datasetRetrieval.mjs` | 单库/多库检索、无结果、限流错误语义稳定 |
| Retrieval service | `api/core/rag/datasource/retrieval_service.py` | 裁剪迁移 | `server/ai-engine/rag/retrievalService.mjs` | topK、score threshold、去重、rerank 契约 |
| 文档抽取器 | `api/core/rag/extractor/*.py` | 分阶段迁移 | `server/ai-engine/rag/extractors/*` | PDF/Word/Markdown/TXT 至少各有一个样例 |
| 文本分块 | `api/core/rag/splitter/*.py` | 直接迁移算法思想和测试 | `server/ai-engine/rag/splitter.mjs` | chunk overlap、句子边界、最大长度稳定 |
| 数据后处理 | `api/core/rag/data_post_processor/data_post_processor.py` | 裁剪迁移 | `server/ai-engine/rag/postProcessor.mjs` | rerank/score threshold 后输出稳定 |
| 知识层工具 | `dify-agent/src/dify_agent/layers/knowledge/layer.py` | 直接迁移工具契约 | `server/ai-engine/layers/knowledgeLayer.mjs` | 模型只看到 `knowledge_base_search(query)` |

### 5.2 梅奥目标设计

知识库 UI 和对话 UI 分离：

```text
智能工厂 / 知识库
  - 上传文档
  - 解析状态
  - 分块数量
  - embedding 状态
  - 召回测试

智能工厂 / 对话
  - 只显示本轮是否检索
  - 普通用户看摘要
  - 管理员可展开命中 chunk
```

### 5.3 首批实现建议

优先迁移 Dify Agent knowledge layer 的“单一模型可见工具”：

```text
knowledge_base_search({ query })
```

原因：它把 RAG 从“系统偷偷塞上下文”变成“模型可按需调用知识库”，更接近 Dify 和 Claude/Codex 的工具体验。

## 6. C：工具 / 插件 / CLI

### 6.1 可迁移来源

| 能力 | Dify source path | 迁移方式 | 梅奥目标模块 | 验收 |
| --- | --- | --- | --- | --- |
| Tool 类型体系 | `api/core/tools/entities/tool_entities.py` | 裁剪迁移 | `server/ai-engine/tools/toolSchema.mjs` | provider type、参数、输出消息类型稳定 |
| Tool engine | `api/core/tools/tool_engine.py` | 行为适配 | `server/ai-engine/tools/toolEngine.mjs` | 参数解析、错误转 observation、输出转文本 |
| Tool manager | `api/core/tools/tool_manager.py` | 裁剪迁移 | `server/ai-engine/tools/toolRegistry.mjs` | builtin/api/mcp/cli provider 可注册 |
| Plugin tools layer | `dify-agent/src/dify_agent/layers/dify_plugin/tools_layer.py` | 直接迁移运行契约 | `server/ai-engine/layers/toolLayer.mjs` | schema -> model tool -> executor -> observation |
| CLI tool config | `api/models/agent_config_entities.py` 的 `AgentCliToolConfig` | 直接迁移配置字段 | `server/ai-engine/tools/cliToolSchema.mjs` | install command/env/secret/risk 可校验 |
| Shell layer | `dify-agent/src/dify_agent/layers/shell/layer.py` | 行为适配，不能直接全搬 | `server/ai-engine/tools/cliExecutor.mjs` | shell_run/wait/input/interrupt 的安全子集 |
| Shell config | `dify-agent/src/dify_agent/layers/shell/configs.py` | 直接迁移 DTO | `server/ai-engine/tools/cliLayerConfig.mjs` | env name 校验、secret ref、install commands |

### 6.2 梅奥目标设计

工具配置和对话分离：

```text
智能工厂 / 插件
  - HTTP 工具
  - MCP 工具
  - CLI 工具
  - 飞书工具
  - 内部函数工具

智能工厂 / 对话
  - 模型按 schema 调用工具
  - 用户看到工具运行状态
  - 管理员看到参数、耗时、错误码
```

CLI 工具必须做安全边界：

- 白名单命令或工具包，不允许任意 shell。
- 每个工具有固定 schema。
- 超时、输出大小、工作目录、环境变量受控。
- secret 只在服务端解析，不进入前端。
- 高风险工具需要管理员确认后才能启用。

### 6.3 首批实现建议

先做工具注册表和一个飞书工具适配器，不马上做完整 shell session：

```text
feishu.create_sheet
feishu.add_records
cli.run_registered_tool
```

理由：用户价值更直接，也能先验证 Dify tool schema -> model tool call -> executor -> observation 的主链路。

## 7. 前端产品形态

前端不用 Dify Web。目标是梅奥自己的 Codex/Claude 客户端式体验：

```text
智能工厂
  ├─ 对话
  │   ├─ 左侧：会话 / 智能体
  │   ├─ 中间：大对话窗口
  │   └─ 右侧可折叠：本轮模型、知识库、插件状态
  │
  ├─ 模型
  │   ├─ 中转供应商
  │   ├─ 模型能力
  │   └─ 凭证状态
  │
  ├─ 知识库
  │   ├─ 文档上传
  │   ├─ 训练 / embedding 状态
  │   └─ 召回测试
  │
  ├─ 插件
  │   ├─ 飞书
  │   ├─ CLI
  │   ├─ HTTP
  │   └─ MCP
  │
  └─ 智能体配置
      ├─ prompt
      ├─ model
      ├─ knowledge
      └─ tools
```

对话窗口和配置页面分开。用户日常只在对话窗口使用智能体；管理员才进入模型、知识库、插件和智能体配置。

## 8. 不做事项

- 不搬 Dify Web 前端。
- 不做完整 Dify workspace/tenant。
- 不部署 Dify Docker Compose。
- 不接完整 plugin daemon。
- 不做工作流画布第一期。
- 不修改旧智能体模块作为智能工厂主线。

## 9. 已决策项与待确认项

这些点会影响实现。能由工程判断决定的先固定，避免每一步都停下来。

已决策：

- Dify 代码迁移后允许在文件头或相邻 NOTICE 文档保留英文 license/source 注释，这是维护和合规需要。
- 第一批以 `dify-agent` 的 Agenton/layers 架构为主，不走 Dify 传统 app runner。理由是它更接近 Codex/Claude 客户端式对话、layer 化模型/知识库/工具/CLI。
- CLI 工具第一期只允许管理员注册白名单工具，不允许普通用户自定义命令。

待确认：

- 飞书优先接官方 HTTP API，还是先接你已有/准备使用的飞书 CLI。

## 10. 推荐第一批交付

第一批不要做 UI 大面铺开，先做一条能验收的垂直链路：

```text
智能工厂新模块
  -> 新智能体配置 schema，迁移自 Dify AgentSoulConfig
  -> 模型中转配置，迁移自 Dify model config 契约
  -> knowledge_base_search 工具，迁移自 Dify knowledge layer
  -> tool schema / observation，迁移自 Dify plugin tools layer
  -> 一个飞书工具或 CLI 白名单工具
  -> Codex/Claude 式对话窗口调用这些能力
```

验收方式：

- 能新建一个智能工厂智能体。
- 能选择一个中转模型。
- 能绑定一个知识库并通过 `knowledge_base_search` 命中。
- 能绑定一个工具并在对话中被模型调用。
- 旧智能体页面不被改动。
- Dify 来源、commit、license note 可追溯。

## 11. Batch 1 落地记录

已落地到 `server/ai-engine/`：

- `difySourceNotice.mjs`：统一记录 Dify upstream、commit、license 和来源路径。
- `agentConfigSchema.mjs`：迁移 `api/models/agent_config_entities.py` 的 AgentSoul 配置契约，覆盖 prompt/model/knowledge/tools/CLI/env/secret ref。
- `modelConfigValidator.mjs`：迁移 `api/core/app/app_config/easy_ui_based_app/model_config/manager.py` 和 `api/services/entities/model_provider_entities.py` 的模型配置校验契约。
- `toolContract.mjs`：迁移 `dify-agent/src/dify_agent/layers/knowledge/layer.py`、`dify-agent/src/dify_agent/layers/dify_plugin/tools_layer.py`、`api/core/tools/entities/tool_entities.py` 的知识库工具、工具参数和 observation 契约。

本批次刻意不做：

- 不接 Dify Docker/服务栈。
- 不暴露 Dify API key 到梅奥前端。
- 不修改旧智能体入口。
- 不做工作流画布。

## 12. Batch 2 运行内核落地记录

已落地到 `server/ai-engine/smartFactoryRuntime.mjs`：

- `buildSmartFactoryModelRequest`：把 Dify-derived Smart Factory agent config 转成模型请求，包含模型、system prompt、messages、`knowledge_base_search` 和安全 CLI 工具 schema。
- `createSmartFactoryRunContext`：创建一次运行上下文，保留配置、模型请求、知识 chunks、知识检索函数、CLI executor 注册表。
- `executeSmartFactoryToolCall`：执行 `knowledge_base_search` 和白名单 CLI 工具，统一返回 Dify-style observation。
- `runSmartFactoryTurn`：完成一轮模型请求 -> tool call -> tool observation trace 的最小闭环。

本批次验收效果：

- 绑定知识库后，模型请求会出现 `knowledge_base_search`。
- 配置安全 CLI 工具后，模型请求会出现对应工具 schema。
- `dangerous`、需要确认、未授权或未注册 executor 的工具不会执行。
- trace 里有 `model_request_built`、`tool_call_started`、`tool_call_completed`，后续前端可以直接渲染工具运行状态。

## 13. Batch 3 预览运行入口落地记录

本批次先把 Dify-derived runtime 包装成可试运行入口。后续根据用户截图纠偏：智能工厂不是旧智能体工厂内部子入口，而是左侧主功能导航里的独立模块。

已落地：

- `server/smartFactoryPreview.mjs`：把 `server/ai-engine/smartFactoryRuntime.mjs` 包装成可试运行 preview turn。
- `POST /api/smart-factory/preview-turn`：MySQL 和本地 JSON 两套 handler 都挂载。
- `src/services/internalApi.ts`：新增 `runSmartFactoryPreviewTurn`。
- `src/modules/AgentCenter/SmartFactoryPanel.tsx`：新增可复用的智能工厂面板。

本批次边界：

- 这是可点的 runtime preview 入口，不是完整生产版智能工厂。
- 不替换旧智能体广场、旧工厂管理和旧工作室。
- 不接 Dify Docker，不引入 Dify Web 前端。
- 飞书目前是白名单 executor preview，后续再接真实飞书开放平台或指定 CLI。

## 14. Batch 4 主功能入口与配置读取落地记录

用户用截图明确：智能工厂应该出现在左侧主功能导航中，位置在“智能体”下方、“一键主详”上方。

已纠偏并落地：

- `src/types.ts` / `src/shell/types.ts`：新增 `smart_factory` 主模块枚举。
- `src/shell/components/layout/SidebarNavigation.tsx`：左侧主导航新增“智能工厂”入口。
- `src/shell/modules/SmartFactory/SmartFactoryModule.tsx`：新增独立智能工厂主工作台。
- `src/shell/modules/AgentCenter/AgentCenterModule.tsx`：撤掉智能体工厂内部的重复智能工厂入口，旧智能体只保留广场、工厂、工作室。
- `GET /api/smart-factory/config`：MySQL 和本地 JSON 两套 handler 都挂载，返回模型、知识库、工具配置摘要，不返回 secret。
- `src/services/internalApi.ts`：新增 `fetchSmartFactoryConfig`。
- `src/modules/AgentCenter/SmartFactoryPanel.tsx`：读取并展示可用模型、知识库和工具配置卡片。
- `src/config/helpGuide.ts`：新增智能工厂帮助内容。

本批次边界：

- 配置读取还是 preview/runtime config，不是最终数据库化配置中心。
- 飞书工具仍是安全白名单模拟 executor，尚未调用真实飞书 API。
- 知识库仍使用内置 preview chunks，尚未接上传、解析、embedding、训练队列。
