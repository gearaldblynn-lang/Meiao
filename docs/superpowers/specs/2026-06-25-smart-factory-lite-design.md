# 智能工厂 Lite — 设计规格

> 日期：2026-06-25
> 目标：把 Dify 中成熟的模型接入、智能体配置、对话、知识库 RAG、工具/插件代码与能力裁剪迁移进梅奥工作台，形成自己的“智能工厂”。前端按梅奥视觉重做；不完整部署 Dify，也不直接搬 Dify Web 控制台。

---

## 1. 产品目标

智能工厂不是独立平台，也不替换原有智能体功能。它是智能体中心下面新增的能力入口，和“智能体列表 / 智能体对话 / 智能体工作室 / 知识库管理”并列存在。用户主体验仍然是“和智能体对话”，模型、知识库、工具、CLI、工作流都作为智能体背后的能力。

旧智能体版本不作为产品体验样板。它做得不完善，很多内容不需要直接参考；智能工厂的前端、配置方式、能力编排和验收标准按新功能重新设计。旧模块只作为可验证的资产池：后端 provider、RAG、工具调用、附件、会话持久化等能力通过测试确认稳定后可以复用，旧 UI 和旧配置流程不照搬。

核心原则：智能工厂不是“按 Dify 思路仿写”。模型、RAG、工具、工作流等关键能力必须优先从 Dify 源码中选模块迁移、裁剪或适配。每个迁移模块都要记录来源文件、许可证处理、保留逻辑、梅奥侧改动和验收测试。确实无法直接迁移的部分，必须写明原因，并以 Dify 代码行为为契约重新实现。

第一期目标不是一次性做完 Dify 全量能力，而是建立可验收的主链路：

```text
多模型中转
  -> 智能体配置
  -> 成熟对话系统
  -> 可绑定知识库
  -> 可调用工具/CLI
  -> 运行状态可观察
```

## 2. Dify 复用边界

### 2.1 必须优先迁移或裁剪复用

- 模型供应商抽象：provider、model、capability、credential、timeout、fallback。
- Chat App 的参数结构：system prompt、opening remarks、retrieval policy、tool policy、conversation variables。
- RAG 流程：文档解析、chunk、embedding、检索、上下文注入、降级。
- Tool schema：name、description、parameters、required、执行结果回传。
- Plugin/Tool 协议思路：工具元数据和执行器分离。

迁移要求：

- 先建立 `docs/superpowers/specs/2026-06-25-dify-source-map.md`，列出 Dify 源码目录、目标梅奥模块、迁移方式。
- 能直接裁剪的代码保留来源说明和 license notice。
- Python 后端模块若不能直接跑在 Node 中，先迁移数据结构、算法和测试样例，再用 Node 适配层承载。
- 前端不搬 Dify Web 控制台。工作流相关 schema/editor 暂不进入第一批。

### 2.2 不直接搬

- 整个 Dify Web 前端。
- 完整租户/权限体系。
- 完整 plugin daemon。
- 完整 sandbox。
- 完整 Docker Compose 服务栈。
- 完整数据库迁移体系。

原因：这些是 Dify 作为独立平台运行的基础设施。梅奥已经有自己的账号、权限、前端风格、Node 后端、任务系统和智能体中心，完整搬入会形成双系统。

## 3. 当前项目可复用基础

项目已经有以下能力，可以逐项验证后复用，不作为无条件依赖：

- 多模型目录：`server/jobRuntime.mjs` 的 `agentModels.chat` 和 `agentModels.image`。
- OpenAI-compatible 中转：`OPENAI_COMPATIBLE_BASE_URL`、`OPENAI_COMPATIBLE_API_KEY`、`OPENAI_COMPATIBLE_MODELS`。
- Responses 工具调用：`server/openaiResponsesProvider.mjs`。
- 智能体多工具编排：`server/agentToolConversation.mjs`。
- 知识库 RAG：`server/ragRetrieval.mjs`、`server/embeddingProvider.mjs`、`server/vectorSearch.mjs`。
- 知识库工具定义：`server/knowledgeToolDefinition.mjs`。
- 生图工具定义：`server/imageToolDefinition.mjs`。
- 旧智能体工作室：`src/modules/AgentCenter/AgentStudioWorkspace.tsx`。只参考接口和局部组件，不参考整体产品流程。
- 旧聊天主界面：`src/modules/AgentCenter/AgentCenterModule.tsx`、`AgentCenterChatWorkspace.tsx`。只复用稳定的消息发送、附件、运行态能力，不把旧体验当最终形态。

## 4. 目标架构

```text
梅奥智能体前端
  ├─ 智能体对话
  ├─ 智能体配置/工作室
  ├─ 知识库管理
  ├─ 工具/插件管理
  └─ 智能工厂能力总览

Node AI Engine
  ├─ model gateway
  ├─ conversation runner
  ├─ RAG retrieval
  ├─ tool registry
  ├─ CLI executor
  └─ run trace / audit

外部依赖
  ├─ OpenAI-compatible 中转
  ├─ KIE / 图像 provider
  ├─ embedding provider
  ├─ 飞书 API / CLI
  └─ 可选 Dify 实验入口
```

## 5. 阶段拆分

### Phase 0：Dify 源码迁移审计

目标：拉取 Dify 源码做模块级审计，确定哪些代码直接迁移、哪些裁剪迁移、哪些只能按行为契约适配。没有完成这一步，不进入模型/RAG/工具主实现。

验收：

- 有 Dify 版本号或 commit SHA。
- 有 Dify license 摘要和合规处理说明。
- 有来源映射表：Dify 文件/目录 -> 梅奥目标模块 -> 迁移方式 -> 验收测试。
- 明确第一批迁移模块：模型 provider、智能体配置、RAG、tool schema、CLI tool schema。
- 明确不迁移模块：完整 Web 控制台、完整租户、plugin daemon、sandbox、Docker 服务栈、Dify 数据库迁移。

### Phase 1：智能工厂基础控制台

目标：在智能体中心下新增“智能工厂”功能页，把已迁移/待迁移能力产品化展示，明确当前可用模型、RAG、工具调用、图像工具、Dify 实验入口的配置状态。该页面只新增入口和能力总览，不替换原有智能体列表、对话、工作室或知识库管理。

验收：

- 智能工厂页面不再只展示 Dify。
- 原有智能体列表、对话、工作室、知识库管理入口仍保留。
- 页面文案明确这是新功能，不是旧智能体工作室换皮。
- 页面能显示“Dify 代码迁移进度”，而不是只显示自研能力。
- 页面能显示中转模型是否配置、模型数量、支持工具调用的模型数量。
- 页面能显示 RAG embedding 是否配置。
- 页面能显示 KIE 生图、APIPorts 生图是否配置。
- 页面能给出“创建智能体 / 管理知识库 / 进入工作室 / Dify 实验入口”的明确路径。

### Phase 2：多模型中转和智能体配置升级

目标：让管理员可以在梅奥内管理模型供应商、模型能力、默认模型、fallback 模型，并把这些绑定到智能工厂的新智能体配置。旧智能体版本结构只作为迁移兼容来源，不作为新配置模型的限制。

验收：

- 智能体可选择中转模型。
- 支持模型能力展示：文本、多模态、工具调用、联网、思考强度。
- 未配置 key 或模型不支持时，前端不允许选择无效能力。
- 对话请求只使用智能体配置内允许的模型，不偷偷 fallback 到未配置模型。

### Phase 3：成熟对话系统收敛

目标：把普通聊天、RAG、联网、生图、工具调用收敛到同一 assistant run 语义。

验收：

- 一轮对话能清楚展示 thinking、retrieved、tool_calling、image_generating、done、error。
- 失败能保留上下文并支持重新生成。
- 刷新后会话状态不丢。
- 管理员能看到必要运行诊断，普通用户不看到 provider URL、API key、内部 job id。

### Phase 4：知识库 RAG 产品化

目标：把已有向量 RAG 做成可见、可管、可验收的知识库训练链路。

验收：

- 上传文档后显示解析状态、分块数量、embedding 状态。
- 智能体能绑定多个知识库。
- 对话中能看到是否检索、命中哪些知识块摘要。
- embedding 失败时降级关键词检索，不直接中断对话。

### Phase 5：工具/CLI 插件系统

目标：做梅奥自己的工具注册表，支持 HTTP、内部函数、CLI、飞书 API 等执行方式。

验收：

- 管理员可注册工具：名称、描述、参数 schema、执行方式、超时、权限。
- 智能体可绑定工具。
- 对话中模型能按 schema 调用工具。
- CLI 工具有白名单、超时、参数校验、日志，不允许任意命令执行。
- 首批落地飞书工具：创建表格、写入记录。

### Phase 6：轻量工作流

目标：不先做完整 Dify 画布，先做能服务智能体的步骤编排。

验收：

- 支持 LLM、RAG、tool call、condition、end 节点。
- 能把常用流程保存为智能体工作流。
- 对话中可触发工作流。

## 6. 验收纪律

每个 Phase 必须满足：

- 有 spec 或 plan。
- 先写失败测试，再实现。
- 本地 JSON 和 MySQL chat handler 相关改动都要覆盖。
- 涉及 `server/index.mjs` 的 chat/agent 路径，必须检查双 handler。
- 跑相关测试、`npm run lint`、`npm run build`。
- 浏览器或页面 source 验收 UI 入口。
- 不把“本地通过”说成“云上已发布”。

## 7. 风险

- Dify 代码许可边界：迁移代码必须保留来源说明和 license notice；不要直接改 Dify Web 当自有品牌控制台。
- 双 handler 漏改：本项目历史根因 #7，所有智能体 chat 改动都要显式测本地和 MySQL。
- 工具执行安全：CLI 插件不能直接暴露任意 shell，必须白名单和超时。
- 知识库规模：当前应用层向量检索适合中小规模；知识库大到一定程度后再引入向量数据库。
