# Agent Center OpenAI 风格智能体循环升级 - 设计规格

日期：2026-07-11
状态：方案 1 已获业主确认，规格待业主复核
目标环境：先在本地当前版本实现和验证，通过代码审查与发布门禁后再灰度发布到腾讯云

## 1. 决策摘要

采用“兼容式升级”，参考 OpenAI Responses API 与 Agents SDK 的核心模式，而不是一次性重写现有运行时：

- Agent Center 保留一个面向用户的主智能体，由模型理解自然语言、图片和对话上下文，自主决定直接回答、追问或调用工具。
- 后端提供严格、可校验的工具合同，负责权限、积分、并发、素材身份、幂等、任务恢复和结果持久化。
- 生图、知识库、联网及后续插件都进入同一个工具循环；模型负责选择工具，程序负责可靠执行。
- 现有 `jobRuntime`、`jobManager`、`providerGateway`、托管素材、积分和 checkpoint 继续作为执行底座。
- 首期不直接迁移到 OpenAI Agents SDK，也不把生图供应商锁定为 OpenAI。先让现有运行时具备同样的架构边界，后续再评估 SDK 替换收益。

官方参考：

- [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
- [Agent orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)
- [Tracing](https://openai.github.io/openai-agents-js/guides/tracing/)

## 2. 范围与非目标

### 2.1 本期范围

- Agent Center 对话运行时的主智能体循环。
- 模型可见工具注册、严格 schema、调用校验和执行结果回填。
- 多图语义合同：合成一张、分别多张、目标图与参考图角色、预期输出数。
- 会话图片由稳定 `imageId` 引用，模型不再回传业务 URL。
- 现有生图工具的兼容适配、灰度开关、日志、回滚和测试。
- 为后续知识库、联网、翻译、商品分析、MCP 插件接入定义统一扩展边界。

### 2.2 明确不做

- 不修改 `modules/OneClick` 等业务模块的策划或生图行为。
- 不重做底层生图 provider，不强制改用 OpenAI 图像模型。
- 不合并本地 JSON 与 MySQL 存储，但两种 handler 的行为必须一致。
- 不暴露模型私有推理过程。系统只记录用户可理解的计划摘要、工具调用和执行 trace。
- 不允许智能体自行选择 API key、任意 provider 地址或未授权 MCP 服务。
- 设计文档阶段不修改业务代码、不部署云上。

## 3. 总体架构

采用 OpenAI 推荐的 Manager 模式：一个主智能体持续拥有用户对话，专业能力以工具或后续子智能体工具的形式提供。

```text
用户消息、附件、历史对话
        |
        v
Conversation Context Builder
  - 多模态消息
  - 稳定图片目录
  - 知识库与工具权限
        |
        v
Manager Agent
  - 直接回答
  - 询问必要澄清
  - 输出严格工具调用
        |
        v
Tool Guardrail / Plan Validator
  - schema、权限、积分、数量、图片身份、幂等
        |
        v
Tool Registry -> Tool Executor
  - generate_images
  - search_knowledge
  - web_search
  - future plugins / MCP adapters
        |
        v
现有 Job Runtime / Provider Gateway / Asset Store
        |
        v
结构化工具结果回填 Manager Agent，直到产生最终回复
```

主智能体最多运行环境变量控制的工具轮数。每轮模型可以返回零个、一个或多个合法工具调用；执行器不得只取第一条，也不得用业务关键词覆盖模型计划。

## 4. 组件边界

### 4.1 Conversation Context Builder

职责：把当前消息、历史、附件和图片目录转换成 Responses 风格的多模态输入。

- 本轮上传图必须作为真实图片 content part 传给模型，不能只在 prompt 中写 URL。
- 图片目录为每张图提供会话内稳定 `imageId`、显示标签、来源、当前焦点和生成来源。
- 优先使用托管素材 `assetId`；没有 `assetId` 的历史图生成并持久化 session-scoped `imageId`。
- UI 可以继续显示“图1、图2”，但模型工具参数只使用 `imageId`；序号变化不能改变图片身份。
- 后端维护 `imageId -> authorized asset/url` 映射，模型不能提交任意 URL。

### 4.2 Manager Agent

职责：理解用户目标、判断信息是否足够、选择工具并汇总最终结果。

系统 prompt 必须按项目 RTCFE 规范组织：

- R：电商视觉与工具编排智能体。
- T：理解用户目标，选择最少且充分的工具步骤完成任务。
- C：不编造素材、产品事实和输出数量；含糊且会产生费用时先追问；不得输出未授权 URL 或工具。
- F：工具调用严格遵守 schema；最终回复只报告已执行事实和可见结果。
- E：覆盖单图编辑、多图合成、多图分别处理、共享参考图和无需工具的最小示例。

不新增“分别、每张、白底”等业务关键词分支。模型语义理解是唯一业务意图来源；后端只验证结构与可执行性。

### 4.3 Tool Registry

每个工具以统一注册项暴露：

```ts
type AgentToolRegistration = {
  name: string;
  description: string;
  strictSchema: object;
  capability: string;
  riskLevel: 'read' | 'cost' | 'write' | 'destructive';
  isEnabled(context): boolean;
  validate(args, context): ValidationResult;
  execute(args, context): Promise<ToolResult>;
};
```

工具是否可见由智能体版本配置、账号权限和运行环境共同决定。模型看不到未启用工具。

首期注册：

- `generate_images`：新的权威批量生图合同。
- `search_knowledge`：复用现有知识库检索，仅在绑定知识库时暴露。
- `web_search`：复用现有 Responses 内置工具，仅在管理员启用时暴露。

后续插件通过同一注册边界接入；MCP 只允许管理员配置的 server allowlist，不接受模型或普通用户提供的任意服务地址。

## 5. 多图语义合同

### 5.1 模型可见工具

`generate_images` 使用严格 JSON Schema：所有字段显式 required，`additionalProperties: false`，可选语义用空数组或允许的 nullable 字段表达。

```json
{
  "plan_version": 2,
  "topology": "multi_input_multi_output",
  "expected_output_count": 3,
  "outputs": [
    {
      "output_id": "output_1",
      "target_image_ids": ["img_current_1"],
      "reference_image_ids": ["img_current_4"],
      "instruction": "保持商品主体不变，参考图4的布光制作白底商品图",
      "aspect_ratio": "1:1"
    },
    {
      "output_id": "output_2",
      "target_image_ids": ["img_current_2"],
      "reference_image_ids": ["img_current_4"],
      "instruction": "保持商品主体不变，参考图4的布光制作白底商品图",
      "aspect_ratio": "1:1"
    },
    {
      "output_id": "output_3",
      "target_image_ids": ["img_current_3"],
      "reference_image_ids": ["img_current_4"],
      "instruction": "保持商品主体不变，参考图4的布光制作白底商品图",
      "aspect_ratio": "1:1"
    }
  ]
}
```

`topology` 允许：

- `text_to_single_image`：无目标图，输出 1 张；可有风格参考图。
- `text_to_multi_image`：无目标图，输出多张独立方案。
- `single_input_single_output`：一个目标图对应一个输出。
- `multi_input_single_output`：多张输入参与同一输出，例如合成海报。
- `multi_input_multi_output`：多个目标分别产生输出，可共享参考图。

每个 `outputs[]` 项对应一个预期 provider 任务和一个最终图片结果。`expected_output_count` 必须等于 `outputs.length`。

### 5.2 图片角色

- `target_image_ids`：最终图片要保留、修改、摆放或合成的主体素材。
- `reference_image_ids`：只提供风格、构图、光线、姿态或品牌规则的参考素材。
- 同一输出中同一个 `imageId` 不得同时作为 target 和 reference；如果是对原图自身修改，只放在 target。
- references 可以被多个 outputs 共享，但不会被计算为“分别处理的目标覆盖数”。

### 5.3 确定性校验

任何 provider 提交和积分扣除前，后端必须验证：

- schema 严格合法，版本和 topology 在允许范围内。
- `outputs.length === expected_output_count`，且不超过环境变量配置的账号/单轮上限。
- 所有 `imageId` 存在于当前会话目录，并属于当前用户可访问资产。
- `output_id` 唯一；目标与参考角色不冲突；编辑/合成 topology 的每个输出至少有一个 target，纯创建 topology 可以没有 target 并只带可选 reference。
- topology 与目标数、输出数相容。
- 分别处理时，每个目标都被覆盖且不会意外重复；合成时只有一个 output。
- aspect ratio、模型能力、积分余额和并发限制允许执行。

校验器不判断“白底、换背景、节日海报”等业务词，也不做生成后主观审图。

## 6. 执行与兼容

### 6.1 V2 到现有执行底座

`generate_images` 校验通过后，由适配器把每个 `outputs[]` 项转换为现有单图执行计划：

- target URLs 在前，reference URLs 在后，均由后端通过 `imageId` 解析。
- provider prompt 明确写入目标和参考角色，但不把业务 URL 当作身份。
- 每个 output 生成稳定 idempotency key：`sessionId + userMessageId + toolCallId + outputId`。
- 继续复用现有并发控制、provider task id checkpoint、托管素材转存、结果落库和恢复机制。
- 成功结果继续聚合到 `imageResultUrls`；`metadata.imagePlan` 增加 `planVersion: 2` 和完整 output 明细，同时保留旧 UI 所需兼容字段。

### 6.2 旧合同兼容

- 旧 `generate_image` 在迁移期继续被运行时接受，但不再作为 V2 主智能体的首选模型可见工具。
- Legacy adapter 把一次旧调用规范化为一个 V2 output；同一模型轮次的多个旧生图调用规范化为一个 V2 batch plan。
- 旧会话、旧消息 metadata 和未迁移智能体继续可读、可恢复。
- `requestMode` 只表示用户入口，不用于判断结果形态；是否有图片结果以 `imageResultUrls`、attachments 和 `imagePlan` 为准。
- V2 默认稳定后至少保留一个发布周期的 V1 回滚开关，再单独决定是否删除旧模型可见合同。

## 7. 错误处理和费用安全

### 7.1 计划错误

- schema、图片身份或覆盖校验失败时，不执行 provider、不扣生成积分。
- 将结构化 `tool_error` 回填模型，包含错误码、具体 output 和允许的修正方式。
- 最多修复 2 轮，轮数由环境变量控制；仍不合法则主智能体向用户说明需要补充的信息。
- V2 不能把非法 `imageId` 静默删除后继续执行；legacy adapter 也不能静默丢弃旧调用中的非法 URL，否则会改变用户计划。两种情况都必须返回结构化错误并修正计划。

### 7.2 需要询问用户的情况

- “处理这些图”但无法判断合成还是分别输出。
- 用户期望数量与图片角色存在冲突。
- 输出数量超过账户配置的自动执行阈值。
- 涉及未来 destructive/write 插件且策略要求人工确认。

普通、清晰且在阈值内的生图请求无需重复确认，保持智能体自主执行体验。

### 7.3 执行错误

- 每个 output 独立 checkpoint。部分成功时保留成功图片，不把整轮覆盖成失败。
- provider 已接单后必须持久化 provider task id；超时走恢复查询，禁止无条件重复提交。
- 最终总结文案失败不能覆盖已经完成的图片结果。
- 工具结果回填必须保留原始 function call item，并保证 `call_id` 成对。
- 用户取消后停止尚未提交的 outputs；已提交任务按现有取消/恢复能力处理并明确展示状态。

## 8. 可观测性

每轮运行使用统一 `agentRunId`，记录：

- conversation/session/user message、agent version、model 和工具策略版本。
- 模型轮次、工具名、tool call id、plan version、topology、预期与实际输出数。
- 每个 output 的 target/reference `imageId`、job id、provider task id、耗时和终态。
- guardrail 拒绝、修复轮次、积分预检、部分失败和恢复事件。

普通用户只看到“分析需求、调用工具、生成中、部分完成、完成”等可理解状态。管理员 trace 可查看结构化计划和错误，但不得展示密钥、provider 鉴权、无关用户素材或模型私有推理。

## 9. 灰度与回滚

### 阶段 A：无行为变化的地基

- 新增稳定 `imageId`、Tool Registry、V2 schema、validator 和 legacy adapter。
- 用既有 tool call fixture 验证适配结果，不改变线上模型可见工具。

### 阶段 B：本地 V2

- 通过 feature flag 只给本地/管理员测试智能体暴露 `generate_images`。
- V2 计划仍通过适配器进入现有任务执行器。
- 完成本地 JSON 与 MySQL 双 handler、断点恢复和真实生图验证。

### 阶段 C：云上小流量

- 完成代码审查、queue drain 和部署门禁后，对指定测试账号启用。
- 验收多图合成、多图分别处理、共享参考图、部分失败和刷新恢复。
- 对比 plan、provider 输入、任务结果、积分和 trace，不只看最终图片数量。

### 阶段 D：默认启用

- 指标和回归稳定后默认启用 V2；保留 V1 feature flag 快速回滚。
- 回滚只切换模型可见合同与编排入口，不删除 V2 metadata，不回滚已完成任务或用户资产。

## 10. 测试与验收

### 10.1 单元测试

- 严格 schema：required、additionalProperties、枚举和空数组边界。
- 图片目录：稳定 identity、授权映射、重复 URL、当前图与历史图、托管素材和 provider 临时 URL。
- validator：五种 topology、输出数、目标覆盖、共享 reference、重复 output、越权图片和上限。
- legacy adapter：单次、多次旧调用到 V2 plan 的无损归一化。
- tool registry：按智能体配置、账号权限动态暴露工具。

### 10.2 编排测试

- 清晰请求直接调用；含糊请求先追问且不执行工具。
- 三张图分别处理输出三张；三图合成输出一张。
- 三个 targets 共享一个 reference，不把 reference 当成第四个输出。
- 非法计划回填结构化错误后模型修正；超过修复上限安全停止。
- 同一轮多个不同工具按顺序或受控并发执行，结果完整回填。
- 部分成功、最终文案失败、刷新恢复、重复请求幂等。
- Responses `function_call` 与 `function_call_output` 成对且 `call_id` 一致。

### 10.3 双模式与回归

- MySQL `createDbChatReply` 和本地 JSON handler 的 V2 路由与权限一致。
- 旧 agent、旧会话、旧 `generate_image` 和未开启 feature flag 的行为不变。
- 现有知识库、联网、生图 SSE、积分、消息附件和运行视图不回归。
- 相关后端测试、全量测试、lint、typecheck、build、Hermes changed-file 门禁通过。

### 10.4 语义评测集

建立不依赖具体业务关键词实现的中文对话样例集，至少覆盖：

- 明确单图编辑、上一张继续修改。
- 多图合成一张。
- 多图分别输出。
- 多 targets 共享风格参考图。
- 用户改口改变输出数。
- 图片指代含糊，需要追问。
- 一轮先查知识库再生成图片。

日常单测使用固定模型输出 fixture 保证确定性；发布前使用当前生产模型跑受控 live eval，只按结构化计划和工具执行边界评分，不用另一模型主观审判成图质量。

## 11. 实施红线

- 禁止新增正则或具体业务关键词判断智能体意图。
- 禁止模型回传任意业务 URL 作为图片身份。
- 禁止只改 MySQL 或只改本地 JSON handler。
- 禁止绕过现有 job checkpoint、积分、用户隔离和 provider 素材治理。
- 禁止用“最终生成了 N 张”代替目标/参考映射与任务身份验收。
- Prompt 改动必须遵守 RTCFE 并补防回归测试。
- 涉及高风险文件前先运行 Hermes changed-file 门禁。
- 云上同步前必须完成 diff、数据隔离、公网素材 URL、日志统计、权限和核心任务链路审查，并通过项目部署门禁。

## 12. 成功标准

- 用户可以用自然语言要求生图、改图、合成或分别处理，不需要学习固定命令或手动选择拓扑。
- 主智能体可以在同一对话中选择生图、知识库、联网及后续插件，并在工具结果返回后继续完成任务。
- 清晰需求自动执行；含糊或超阈值需求在产生费用前询问。
- 多图计划的目标、参考、输出数、provider 任务和最终结果可以逐项追溯。
- 现有稳定执行底座和历史会话保持兼容，V2 可以按账号灰度并快速回滚。
