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
  - Commit: 待提交。

### Batch A Facts

- Problems found: shell 真实入口与旧模块入口 pending run 恢复逻辑漂移。
- Verification evidence: shell 入口新增测试红灯后转绿；相关 AgentCenter 行为测试全绿；localhost 浏览器观察到智能体会话主路径和能力栏正常。
- Fixes: shell 入口补齐 pending run 结构化识别、后台轮询、重复发送锁定、运行态传递；补 `docs/agents/repeated-issues.md` 操作型经验。
- Avoid next time: 前端同时存在 `src/modules/AgentCenter/AgentCenterModule.tsx` 与 `src/shell/modules/AgentCenter/AgentCenterModule.tsx` 时，涉及用户真实入口的对话生命周期逻辑必须在 shell 测试中单独设门禁，不能只测旧模块。
- Commits: 待提交。

## 每批事实沉淀

后续 Batch B-D 继续在本文件追加事实、验证、反馈补丁和最终 commit。
