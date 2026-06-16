# 智能体对话 GPT 化 Loop 验收记录

## 验收矩阵

| 场景 | 操作 | 预期 | 自动测试 | 浏览器验收 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 普通问答 | 发送普通问题 | assistant 流式回答，Markdown 正常 | chatConversationRendering | localhost 对话 | 待执行 |
| 生图 | 要求生成图片 | run trace 显示生成图片，结果不泄漏 provider URL | agentToolConversation | localhost 对话 | 待执行 |
| 改图 | 上传/复用图片并要求修改 | 附件进入同轮上下文，结果图可查看 | agentToolConversation | localhost 对话 | 待执行 |
| 知识库 | 问绑定知识内容 | search_knowledge 被触发，引用内容用于回答 | agentToolConversation | localhost 对话 | 待执行 |
| 联网 | 问实时信息 | web_search 可用时触发联网 | providerGateway/openaiResponsesProvider | localhost 对话 | 待执行 |
| 失败恢复 | 模拟 provider 失败 | 显示失败阶段，可重新生成 | agentConversationReliability | localhost 对话 | 待执行 |
| 重新生成 | 点 assistant 重新生成 | 保留原模型、联网、思考强度、附件、requestMode | chatMessageDisplay | localhost 对话 | 待执行 |

## Batch A - 对话生命周期可靠性

- Goal: 发送、刷新、中断、失败、重新生成在普通聊天、生图、知识库、联网 run 上语义一致，让用户明确知道“这一轮正在跑、已中断、失败、可重试或已完成”。
- Files: `src/shell/modules/AgentCenter/AgentCenterModule.tsx`, `src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`, `docs/agent-chat-gpt-loop-acceptance.md`
- Red lines: 未触碰 `server/appStateMerge.mjs`、`src/adapters/shellPersistence.ts`；未新增业务意图/状态正则；未改后端 chat handler。
- Browser acceptance: 2026-06-17 刷新 `http://localhost:3000/`，页面进入智能体会话；历史运行步骤可见；Composer 能力栏显示 `模型 · GPT-5.5`、`+ 附件`、`文件夹`、`生图关`、`联网关`、`思考 medium`；历史生图回复可见总结与图片入口，正文未出现 `aiquickdraw.com/images` provider URL；空输入时发送按钮禁用。
- Verification commands:
  - PASS `node --experimental-strip-types --test src/modules/AgentCenter/chatMessageDisplay.test.mjs`
  - PASS `node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`
  - PASS `node --experimental-strip-types --test src/modules/AgentCenter/agentConversationReliability.test.mjs`
  - PASS `npm run lint`（0 errors，既有 warnings）
- Fact log:
  - Fact: 真实入口 `src/shell/modules/AgentCenter/AgentCenterModule.tsx` 与旧模块 `src/modules/AgentCenter/AgentCenterModule.tsx` 在 pending assistant run 恢复逻辑上发生漂移。
  - Reproduce: shell 入口测试新增 pending run 断言后失败，缺少 `isPendingAgentRunMessage`、`hasActivePendingRun`、轮询同步和输入区 running 状态传递。
  - Evidence: `node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs` 在新增测试 `shell chat workspace keeps restored pending runs visible and locked` 上红灯。
  - Root cause: 旧模块已有持久 pending run 保护，但当前应用入口挂载 shell 模块；前端双入口逻辑未同步。
  - Fix: shell 入口补齐结构化 pending/running 判定、后台消息轮询回填、重复发送锁定、Composer running 状态传递；仅本地正在发送时显示真正中断按钮。
  - Regression test: `src/shell/modules/AgentCenter/AgentCenterModule.test.mjs` 新增 shell 入口断言。
  - Commit: `a0c23f7`

### Batch A Facts

- Problems found: shell 真实入口与旧模块入口 pending run 恢复逻辑漂移。
- Verification evidence: shell 入口新增测试红灯后转绿；相关 AgentCenter 行为测试全绿；localhost 浏览器观察到智能体会话主路径和能力栏正常。
- Fixes: shell 入口补齐 pending run 结构化识别、后台轮询、重复发送锁定、运行态传递；补 `docs/agents/repeated-issues.md` 操作型经验。
- Avoid next time: 前端同时存在 `src/modules/AgentCenter/AgentCenterModule.tsx` 与 `src/shell/modules/AgentCenter/AgentCenterModule.tsx` 时，涉及用户真实入口的对话生命周期逻辑必须在 shell 测试中单独设门禁，不能只测旧模块。
- Commits: `a0c23f7`

## 每批事实沉淀

后续 Batch B-D 继续在本文件追加事实、验证、反馈补丁和最终 commit。

## Batch B - 输入能力状态智能化

- Goal: 输入框能力栏按模型、智能体配置和会话状态动态约束；用户不用猜当前能力是否可用，也不会选到无效能力。
- Files: `src/modules/AgentCenter/ChatComposer.tsx`, `src/modules/AgentCenter/chatComposerReasoningUi.test.mjs`, `docs/agent-chat-gpt-loop-acceptance.md`
- Red lines: 未触碰 `server/appStateMerge.mjs`、`src/adapters/shellPersistence.ts`；未改后端 chat handler；未新增业务意图/状态正则。
- Browser acceptance: 2026-06-17 刷新 `http://localhost:3000/`，Composer 默认显示 `模型 · GPT-5.5`、`+ 附件`、`文件夹`、`生图关`、`联网关`、`思考 medium`；点击生图 pill 后短标签显示 `生图开 · 0/16`，随后已切回 `生图关`；空输入时发送按钮保持禁用。
- Verification commands:
  - PASS `node --experimental-strip-types --test src/modules/AgentCenter/chatComposerReasoningUi.test.mjs`
  - PASS `node --experimental-strip-types --test src/modules/AgentCenter/chatReasoningModelSwitch.test.mjs`
  - PASS `node --experimental-strip-types --test src/components/uiArchitecture.test.mjs --test-name-pattern "agent"`
  - PASS `npm run lint`（0 errors，既有 warnings）
- Fact log:
  - Fact: 能力栏已有 pill，但不可用原因和生图容量主要依赖 tooltip；默认短标签不足以表达“本轮能力确定性”。
  - Reproduce: 新增 `chat composer capability labels expose unavailable and capacity states without relying on tooltips` 后红灯，缺少 `imageAttachmentCount` 和不可用短标签。
  - Evidence: `node --experimental-strip-types --test src/modules/AgentCenter/chatComposerReasoningUi.test.mjs` 在新增断言上红灯；浏览器开启生图前只能看到 `生图关`。
  - Root cause: 能力状态分成可见短标签和 tooltip 两层，之前把容量/不可用原因放在 tooltip，主标签信息密度不够。
  - Fix: web/reasoning/image pill 的短标签直接显示 `联网不可用`、`思考不可用`、`生图不可用`；生图开启时显示 `生图开 · 当前图片数/上限`；Enter 发送测试补 IME composition 断言。
  - Regression test: `src/modules/AgentCenter/chatComposerReasoningUi.test.mjs`。
  - Commit: `feat(智能体): 强化输入能力状态标签`

### Batch B Facts

- Problems found: 能力栏短标签对不可用状态和生图容量表达不足，用户需要 hover 才能知道完整能力状态。
- Verification evidence: 新增测试红灯后转绿；localhost 生图 pill 验收显示 `生图开 · 0/16`。
- Fixes: `feat(智能体): 强化输入能力状态标签`
- Avoid next time: GPT 式能力栏的关键信息必须在短标签里可见；tooltip 只能补解释，不能承载“是否可用/容量/当前模式”的唯一信号。
- Commits: `feat(智能体): 强化输入能力状态标签`

## Batch C - assistant run 主路径与调试视图分层

- Goal: 普通用户看到简洁运行步骤和结果；管理员可在运行视图定位 tool、RAG、联网、provider 失败。
- Files: `src/modules/AgentCenter/AgentCenterChatWorkspace.tsx`, `src/modules/AgentCenter/chatConversationRendering.test.mjs`, `src/shell/modules/AgentCenter/ChatConversationPane.test.mjs`, `docs/agent-chat-gpt-loop-acceptance.md`
- Red lines: 未触碰 `server/appStateMerge.mjs`、`src/adapters/shellPersistence.ts`；未改后端 chat handler；未新增业务意图/状态正则；未把 provider payload 或内部 function 输出渲染进 assistant 正文。
- Browser acceptance: 2026-06-17 打开 `http://localhost:3000/` 的智能体会话，点击“运行视图”；面板显示 `诊断详情`，包含 `模型`、`Provider`、`工具`、`错误码`、`知识库命中`、`耗时`；主消息正文未出现 `providerTaskId` 或 `function_call_output`；验收后已关闭运行视图。
- Verification commands:
  - PASS `node --experimental-strip-types --test src/modules/AgentCenter/chatConversationRendering.test.mjs`
  - PASS `node --experimental-strip-types --test src/shell/modules/AgentCenter/ChatConversationPane.test.mjs`
  - PASS `node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`
  - PASS `npm run lint`（0 errors，既有 warnings）
- Fact log:
  - Fact: 主消息 run trace 已经 compact，但运行视图缺少 model/provider/tool/errorCode/duration 等结构化诊断字段。
  - Reproduce: 新增 `run view exposes diagnostics while keeping debug fields out of assistant text` 后红灯，缺少 `runDiagnostics`。
  - Evidence: `node --experimental-strip-types --test src/modules/AgentCenter/chatConversationRendering.test.mjs` 在新增断言上红灯。
  - Root cause: 调试面板此前偏会话资产和上下文统计，未把 assistant run 的结构化 metadata 汇总成诊断表。
  - Fix: 运行视图新增 `runDiagnostics`，展示模型、Provider、工具、错误码、知识库命中、耗时；主消息正文仍只走 compact run trace 和清洗后的 Markdown。
  - Regression test: `src/modules/AgentCenter/chatConversationRendering.test.mjs`；同步修正 `src/shell/modules/AgentCenter/ChatConversationPane.test.mjs` 到当前 `assistantDisplayContent` 契约。
  - Commit: `feat(智能体): 分离运行诊断与主消息`

### Batch C Facts

- Problems found: 运行视图诊断信息不够结构化；shell ChatConversationPane 测试仍断言旧 `displayContent` 变量，和现有实现漂移。
- Verification evidence: 新增测试红灯后转绿；localhost 运行视图显示诊断详情，主正文无内部字段泄漏。
- Fixes: `feat(智能体): 分离运行诊断与主消息`
- Avoid next time: 主聊天只放用户可读 run 摘要；定位 provider/tool/RAG 失败的字段放运行视图，且回归测试要同时覆盖主消息不泄漏内部字段。
- Commits: `feat(智能体): 分离运行诊断与主消息`
