# 智能体对话 GPT 化 Loop 升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于已发现的“梅奥智能体对话 vs GPT Web 对话”差距，把剩余产品优化拆成可自动化执行的闭环批次，每批都有验证、反馈、迭代修复和事实经验沉淀。

**Architecture:** 本计划不新增独立 loop runtime。loop 是执行方式：每个 GPT Web 差距优化批次都遵循 Define → Test → Build → Verify → Observe → Feedback → Record → Gate；功能改动仍落在现有 AgentCenter 前端、chat handler、provider/tool conversation 模块和文档记录中。

**Tech Stack:** React/TypeScript 前端、Node ESM `.mjs` 后端、`node --test`、`node --experimental-strip-types --test`、`npm run lint`、`npm run build`、Browser localhost 验收、Hermes Harness。

**Spec:** `docs/superpowers/specs/2026-06-17-agent-chat-gpt-loop-design.md`

---

## 红线

- 禁碰 `server/appStateMerge.mjs`、`src/adapters/shellPersistence.ts`。
- 禁新增“正则猜业务意图/状态”。展示层过滤 provider 图片 URL 只能用于协议噪音清洗。
- 改 `server/index.mjs` chat 逻辑时，MySQL handler 与本地 JSON handler 必须同步，并补两种 mode 测试。
- 改后端后先重启本地服务，再做浏览器验证。
- 任何 bug fix 都要同步外部诊断日志看板；真实遇到的问题要进入本批事实沉淀。
- 每个 Batch 独立提交；反馈补丁独立提交。

## GPT Web 差距 → 优化批次

| 已发现差距 | 产品优化目标 | 批次 |
| --- | --- | --- |
| 用户无法稳定判断长耗时 run 在刷新/中断/失败后处于什么状态 | 对话生命周期可靠：每轮 run 有明确状态、恢复动作和重新生成语义 | Batch A |
| 能力栏已经可见，但模型能力、联网、生图、思考强度、附件限制仍不够联动 | 输入能力状态智能化：本轮会使用什么能力一眼可见，且不可选择无效能力 | Batch B |
| 主聊天仍可能混入任务系统感或 debug 信息 | assistant run 分层：主路径简洁，运行视图负责诊断 | Batch C |
| 是否真的更像 GPT Web 依赖人工记忆，问题修复经验可能散落 | 验收矩阵与事实沉淀：每轮验证、反馈、修复、沉淀可复查 | Batch D |

## 通用 Loop 模板（每批必跑）

- [ ] **Step 1: Define**

记录本批目标、涉及文件、用户可感知验收点、红线。

写入或更新本批验收记录：

```markdown
## Batch X - <name>

- Goal: copy the exact Goal sentence from the Batch section before implementation starts.
- Files: list the exact files touched in the Batch; remove files that were not touched before commit.
- Red lines: copy the global red lines plus any Batch-specific red line.
- Browser acceptance: list the exact localhost checks executed in Observe.
- Verification commands: paste the exact commands and pass/fail result.
- Fact log: record actual problems found; write "未发现新问题" only after browser and command verification both pass.
```

- [ ] **Step 2: Test**

先写失败测试。前端测试使用：

```bash
node --experimental-strip-types --test src/modules/AgentCenter/<test>.test.mjs
```

后端测试使用：

```bash
node --test server/<test>.test.mjs
```

Expected: 新增断言必须先 FAIL，失败原因必须指向缺失行为，不是语法错误或路径错误。

- [ ] **Step 3: Build**

只实现本批最小代码，不做跨批重构。

- [ ] **Step 4: Verify**

至少运行本批测试、相关回归、`npm run lint`。涉及生产构建或视觉主路径时运行 `npm run build`。

- [ ] **Step 5: Observe**

刷新 `http://localhost:3000/`。涉及后端时先重启 `npm run local` 或确认服务进程已重启。浏览器只做本批验收动作，不把本地验证描述成线上已生效。

- [ ] **Step 6: Feedback**

如果测试、浏览器或用户反馈发现问题，记录事实：

```markdown
- Fact:
- Reproduce:
- Evidence:
- Root cause:
- Fix:
- Regression test:
- Commit:
```

然后先写失败测试，再做反馈补丁。

- [ ] **Step 7: Record**

本批收尾必须写事实沉淀：

```markdown
### Batch X Facts

- Problems found:
- Verification evidence:
- Fixes:
- Avoid next time:
- Commits:
```

满足复发条件时更新 `docs/agents/repeated-issues.md`；架构级根因更新 `CLAUDE.md`；bug fix 运行外部诊断看板记录命令。

- [ ] **Step 8: Gate**

只有测试、浏览器验收、事实沉淀和提交都完成，才能进入下一批。

---

## Batch A: 对话生命周期可靠性

**GPT Web gap:** 当前智能体对话在长耗时 run、刷新、中断、失败恢复时，用户仍可能不确定“这一轮是否还在跑、是否失败、能不能继续”。GPT Web 的成熟体验是：每一轮都有稳定运行状态，失败和中断都有可理解的后续动作。

**Goal:** 发送、刷新、中断、失败、重新生成在普通聊天、生图、知识库、联网 run 上语义一致，让用户明确知道“这一轮正在跑、已中断、失败、可重试或已完成”。

**Product optimizations:**
- Pending run 刷新后仍可见，输入区锁定逻辑不靠纯 React 临时状态。
- 中断后显示“已中断/可重新生成”，不误导为完成。
- 失败后保留上下文和可恢复动作。
- 重新生成保留原 run 的 requestMode、模型、联网、思考强度、附件。

**Files:**
- Modify: `src/shell/modules/AgentCenter/AgentCenterModule.tsx`
- Modify: `src/modules/AgentCenter/AgentCenterChatWorkspace.tsx`
- Modify: `src/modules/AgentCenter/ChatConversationPane.tsx`
- Modify: `src/modules/AgentCenter/chatMessageDisplay.mjs`
- Modify when backend run-state fields are changed: `server/index.mjs`
- Test: `src/modules/AgentCenter/agentConversationReliability.test.mjs`
- Test: `src/modules/AgentCenter/chatMessageDisplay.test.mjs`
- Test: `src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`
- Test if backend changes: `server/agentConversationReliability.test.mjs`

- [ ] **Step 1: Write failing tests**

Add source/behavior tests that lock these behaviors:

```js
test('regenerate preserves the original assistant run mode and options', () => {
  const assistant = {
    role: 'assistant',
    content: '已生成图片',
    metadata: {
      requestMode: 'image_generation',
      selectedModel: 'gpt-5.5',
      reasoningLevel: 'high',
      webSearchEnabled: true,
    },
  };
  const user = {
    role: 'user',
    content: '把图1改写实',
    attachments: [{ id: 'a1', name: '图1', kind: 'image', url: '/api/assets/file/a.png' }],
  };
  assert.deepEqual(resolveRegenerateRequest({ assistantMessage: assistant, previousUserMessage: user }), {
    content: '把图1改写实',
    sourceAttachments: [{ id: 'a1', name: '图1', kind: 'image', url: '/api/assets/file/a.png' }],
    requestMode: 'image_generation',
    selectedModel: 'gpt-5.5',
    reasoningLevel: 'high',
    webSearchEnabled: true,
  });
});
```

Add shell source assertions:

```js
test('chat workspace disables duplicate sends while a persisted pending assistant run exists', () => {
  assert.match(source, /hasPendingAssistantRun/);
  assert.match(source, /pending assistant/i);
  assert.match(source, /disabled=.*hasPendingAssistantRun/s);
});

test('chat workspace keeps interrupt and failed recovery visible for assistant runs', () => {
  assert.match(source, /onInterruptSend/);
  assert.match(source, /failed|error/);
  assert.match(source, /重新生成/);
});
```

- [ ] **Step 2: Run red tests**

Run:

```bash
node --experimental-strip-types --test src/modules/AgentCenter/chatMessageDisplay.test.mjs
node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs
```

Expected: FAIL on the new missing pending/interrupt/recovery assertions.

- [ ] **Step 3: Implement minimal reliability fixes**

Implementation rules:

- Use existing `AgentChatMessage.metadata` as source of run semantics.
- Do not invent new DB fields.
- If backend routing changes are needed, update both chat handlers.
- Keep draft restore behavior.
- Do not change provider behavior.

- [ ] **Step 4: Run green tests**

Run:

```bash
node --experimental-strip-types --test src/modules/AgentCenter/chatMessageDisplay.test.mjs
node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs
node --experimental-strip-types --test src/modules/AgentCenter/agentConversationReliability.test.mjs
```

If backend changed, also run:

```bash
node --test server/agentConversationReliability.test.mjs server/agentToolConversation.test.mjs
```

- [ ] **Step 5: Browser Observe**

Restart backend if changed. In `http://localhost:3000/` verify:

- Send button locks during pending run.
- Interrupt keeps visible failed/interrupted state.
- Regenerate preserves original mode and options.
- Refresh does not erase visible pending run.

Record exact observations in the Batch A fact log.

- [ ] **Step 6: Feedback patch if needed**

If browser reveals a bug, add a failing test named after the symptom, fix, rerun Batch A tests, and commit separately.

- [ ] **Step 7: Commit**

```bash
git add src/modules/AgentCenter src/shell/modules/AgentCenter server docs
git commit -m "fix(智能体): 加固对话运行可靠性"
```

---

## Batch B: 输入能力状态智能化

**GPT Web gap:** 输入框已经从纯图标升级成能力 pill，但还没有完全做到 GPT Web 那种“本轮能力确定性”：模型支持什么思考强度、联网是否可用、生图是否启用、附件是否超限，都应该在输入区即时表达。

**Goal:** 输入框能力栏按模型、智能体配置和会话状态动态约束；用户不用猜当前能力是否可用，也不会选到无效能力。

**Product optimizations:**
- 思考强度菜单只展示当前模型支持的档位。
- 联网 pill 显示开/关/不可用原因。
- 生图 pill 显示开/关/当前输入图容量。
- `+` 入口统一附件、文件夹、图片复用，不挤压输入内容和发送按钮。
- Enter、Shift+Enter、IME 组合输入保持 GPT 式稳定行为。

**Files:**
- Modify: `src/modules/AgentCenter/ChatComposer.tsx`
- Modify: `src/modules/AgentCenter/chatReasoningDefaults.mjs`
- Modify: `src/modules/AgentCenter/chatModelAllowlist.ts`
- Modify: `src/modules/AgentCenter/AgentCenterModule.tsx`
- Test: `src/modules/AgentCenter/chatComposerReasoningUi.test.mjs`
- Test: `src/modules/AgentCenter/chatReasoningModelSwitch.test.mjs`
- Test: `src/components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests:

```js
test('chat composer only exposes reasoning levels supported by the selected model', () => {
  assert.match(source, /supportedReasoningLevels/);
  assert.match(source, /resolveReasoningLevelForModel/);
  assert.doesNotMatch(source, /\\['low', 'medium', 'high'\\]/);
});

test('chat composer capability pills expose current availability and reason text', () => {
  assert.match(source, /模型 ·/);
  assert.match(source, /联网/);
  assert.match(source, /思考/);
  assert.match(source, /生图/);
  assert.match(source, /不可用|未启用|已开启|已关闭/);
});

test('chat composer keeps Enter send and Shift Enter newline with IME guard', () => {
  assert.match(source, /event\\.key === 'Enter'/);
  assert.match(source, /event\\.shiftKey/);
  assert.match(source, /isComposing/);
});
```

- [ ] **Step 2: Run red tests**

Run:

```bash
node --experimental-strip-types --test src/modules/AgentCenter/chatComposerReasoningUi.test.mjs
node --experimental-strip-types --test src/modules/AgentCenter/chatReasoningModelSwitch.test.mjs
```

Expected: FAIL on missing support-level or availability assertions.

- [ ] **Step 3: Implement capability state**

Implementation rules:

- Derive reasoning options from model capability table or existing model policy helper.
- Do not display unsupported reasoning levels.
- Keep `+` attachment entry as primary entry.
- Keep visible text on every capability pill.
- Keep send/interrupt button at bottom-right.

- [ ] **Step 4: Run green tests**

Run:

```bash
node --experimental-strip-types --test src/modules/AgentCenter/chatComposerReasoningUi.test.mjs
node --experimental-strip-types --test src/modules/AgentCenter/chatReasoningModelSwitch.test.mjs
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs --test-name-pattern "agent"
```

- [ ] **Step 5: Browser Observe**

Verify in localhost:

- Switching model updates supported reasoning options.
- 联网 pill shows enabled/disabled/unavailable reason.
- 生图 pill shows current mode and input-image capacity when available.
- Text does not overflow at default viewport.
- Enter sends; Shift+Enter creates newline.

Record facts and screenshots/DOM observations in Batch B fact log.

- [ ] **Step 6: Feedback patch if needed**

If clipping or unsupported option appears, write a failing test in `chatComposerReasoningUi.test.mjs`, fix, rerun Batch B tests.

- [ ] **Step 7: Commit**

```bash
git add src/modules/AgentCenter src/components/uiArchitecture.test.mjs docs
git commit -m "feat(智能体): 对齐输入能力栏与模型能力"
```

---

## Batch C: assistant run 主路径与调试视图分层

**GPT Web gap:** 当前 run trace 已进入 assistant 消息，但主聊天与运行视图还需要进一步分层。GPT Web 的主路径是阅读流；调试/工具细节不应该抢普通用户注意力，但管理员又必须能定位失败边界。

**Goal:** 普通用户看到简洁运行步骤和结果；管理员可在运行视图定位 tool、RAG、联网、provider 失败。

**Product optimizations:**
- 主聊天只显示“思考/检索/联网/工具/生图/完成/失败”等摘要阶段。
- 运行视图展示 model、provider、tool、耗时、错误码、知识库命中摘要。
- provider URL、内部 job id、function payload 不进入 assistant 正文和复制内容。
- debug 信息以结构化字段记录，不靠自然语言堆在聊天里。

**Files:**
- Modify: `src/modules/AgentCenter/ChatConversationPane.tsx`
- Modify: `src/modules/AgentCenter/AgentCenterChatWorkspace.tsx`
- Modify: `src/shell/modules/AgentCenter/AgentCenterModule.tsx`
- Modify when new structured frontend diagnostic fields are added: `src/services/loggingService.ts`
- Test: `src/modules/AgentCenter/chatConversationRendering.test.mjs`
- Test: `src/shell/modules/AgentCenter/ChatConversationPane.test.mjs`
- Test: `src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests:

```js
test('assistant run trace keeps user view compact and debug details out of message text', () => {
  assert.match(source, /assistant-run-trace/);
  assert.match(source, /运行步骤/);
  assert.doesNotMatch(source, /providerTaskId.*MarkdownMessage/s);
  assert.doesNotMatch(source, /function_call_output.*MarkdownMessage/s);
});

test('run view exposes diagnostic fields for admin debugging', () => {
  assert.match(shellSource, /运行视图/);
  assert.match(shellSource, /provider|model|tool|duration|errorCode|retrieval/i);
});

test('assistant visible text never renders provider image urls or internal job ids', () => {
  assert.match(displaySource, /stripImageResultUrls/);
  assert.doesNotMatch(source, /providerTaskId\\}<\/p>/);
});
```

- [ ] **Step 2: Run red tests**

Run:

```bash
node --experimental-strip-types --test src/modules/AgentCenter/chatConversationRendering.test.mjs
node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs
```

Expected: FAIL on missing diagnostic separation assertions if not implemented.

- [ ] **Step 3: Implement run/debug separation**

Implementation rules:

- Main assistant message shows compact trace and final visible content only.
- Debug view may show model/provider/tool metadata, but never API keys.
- Keep provider URLs out of rendered text and copy text.
- If new log fields are added, use structured keys and avoid raw prompt dumps.

- [ ] **Step 4: Run green tests**

Run:

```bash
node --experimental-strip-types --test src/modules/AgentCenter/chatConversationRendering.test.mjs
node --experimental-strip-types --test src/shell/modules/AgentCenter/ChatConversationPane.test.mjs
node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs
```

- [ ] **Step 5: Browser Observe**

Verify:

- Main chat does not show raw provider URL, function payload, or internal job id.
- Run trace stages are visible and collapsible.
- Running view shows diagnostic detail only as debug/detail surface.

Record facts in Batch C fact log.

- [ ] **Step 6: Feedback patch if needed**

If raw detail leaks into chat, write failing source test and fix before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/modules/AgentCenter src/shell/modules/AgentCenter src/services docs
git commit -m "feat(智能体): 分离运行摘要与调试详情"
```

---

## Batch D: GPT Web 对标验收矩阵与事实经验沉淀

**GPT Web gap:** “像不像 GPT Web”现在主要靠人工感受；施工中发现的问题如果只停留在对话里，后续容易复发。成熟做法是把对话体验拆成可复验场景，并把真实遇到的问题沉淀成规则。

**Goal:** 把真实对话验收、反馈迭代和事实经验沉淀固定成可复用记录。

**Product optimizations:**
- 建立对标 GPT Web 的验收矩阵：普通问答、生图、改图、知识库、联网、混合工具、失败恢复、重新生成。
- 每次浏览器验收记录实际结果，不只写“通过”。
- 施工中遇到的问题必须记录事实、复现、根因、修复、避免复发规则。
- 有复发风险的问题进入 `docs/agents/repeated-issues.md` 或 `CLAUDE.md`。

**Files:**
- Create: `docs/agent-chat-gpt-loop-acceptance.md`
- Create or modify: `docs/agents/repeated-issues.md` when facts meet recurrence criteria
- Modify: `docs/release-and-handoff.md`
- Test: `src/components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write failing documentation guard test**

Add to `src/components/uiArchitecture.test.mjs`:

```js
test('agent chat GPT loop acceptance record documents verification feedback and fact learning', () => {
  const doc = readFileSync(new URL('../../docs/agent-chat-gpt-loop-acceptance.md', import.meta.url), 'utf8');
  assert.match(doc, /普通问答/);
  assert.match(doc, /生图/);
  assert.match(doc, /改图/);
  assert.match(doc, /知识库/);
  assert.match(doc, /联网/);
  assert.match(doc, /失败恢复/);
  assert.match(doc, /重新生成/);
  assert.match(doc, /事实沉淀/);
  assert.match(doc, /反馈补丁/);
});
```

The path is relative to `src/components/uiArchitecture.test.mjs`; the expected red failure is file-not-found before the acceptance record exists.

- [ ] **Step 2: Run red test**

Run:

```bash
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs --test-name-pattern "agent chat GPT loop acceptance"
```

Expected: FAIL because `docs/agent-chat-gpt-loop-acceptance.md` does not exist.

- [ ] **Step 3: Create acceptance matrix**

`docs/agent-chat-gpt-loop-acceptance.md` must include this structure:

```markdown
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
| 重新生成 | 点 assistant 重新生成 | 保留原模型/联网/思考/附件/requestMode | chatMessageDisplay | localhost 对话 | 待执行 |

## 每批事实沉淀

### Batch A
- Problems found:
- Verification:
- Iteration:
- Avoid next time:

### Batch B
- Problems found:
- Verification:
- Iteration:
- Avoid next time:

### Batch C
- Problems found:
- Verification:
- Iteration:
- Avoid next time:

### Batch D
- Problems found:
- Verification:
- Iteration:
- Avoid next time:
```

- [ ] **Step 4: Run green test**

Run:

```bash
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs --test-name-pattern "agent chat GPT loop acceptance"
```

Expected: PASS.

- [ ] **Step 5: Execute final regression**

Run:

```bash
node --test server/agentToolConversation.test.mjs
node --test server/providerGateway.test.mjs
node --test server/modelCapabilities.test.mjs server/jobRuntime.test.mjs
node --experimental-strip-types --test src/modules/AgentCenter/chatConversationRendering.test.mjs
node --experimental-strip-types --test src/modules/AgentCenter/chatComposerReasoningUi.test.mjs
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs --test-name-pattern "agent"
npm run lint
npm run build
```

- [ ] **Step 6: Browser acceptance pass**

At `http://localhost:3000/`, verify the matrix scenarios that are safe to run locally. For scenarios requiring real provider spend, run only one minimal request or mark as “需要人工/额度确认” with reason.

- [ ] **Step 7: Fact learning gate**

For every issue encountered in Batch A-D, ensure one of these outcomes exists:

- Fixed with failing test + commit.
- Added to `docs/agents/repeated-issues.md` with root cause and avoidance rule.
- Added to `CLAUDE.md` if architecture-level.
- Added to external diagnosis dashboard if it was a bug fix.
- Marked as intentionally deferred with reason and owner.

- [ ] **Step 8: Commit**

```bash
git add docs src/components/uiArchitecture.test.mjs
git commit -m "docs(智能体): 建立 GPT 化 loop 验收与事实沉淀"
```

---

## Final Gate

Before declaring the loop upgrade plan complete:

- [ ] Read this plan and the design spec line by line.
- [ ] Confirm every Batch has Test / Build / Verify / Observe / Feedback / Record / Gate.
- [ ] Run:

```bash
node - <<'NODE'
const fs = require('fs');
const files = [
  'docs/superpowers/specs/2026-06-17-agent-chat-gpt-loop-design.md',
  'docs/superpowers/plans/2026-06-17-agent-chat-gpt-loop.md',
];
const terms = ['TB' + 'D', 'TO' + 'DO', '待' + '补', '随' + '便', '后续' + '再说'];
let failed = false;
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (terms.some((term) => line.includes(term))) {
      console.log(`${file}:${index + 1}:${line}`);
      failed = true;
    }
  });
}
process.exit(failed ? 1 : 0);
NODE
git status --short
```

Expected:

- `rg` returns no placeholder matches.
- `git status --short` shows only intentional spec/plan/doc changes before commit, and clean after commit.

- [ ] Commit spec + plan:

```bash
git add docs/superpowers/specs/2026-06-17-agent-chat-gpt-loop-design.md docs/superpowers/plans/2026-06-17-agent-chat-gpt-loop.md
git commit -m "docs(智能体): 制定 GPT 化 loop 升级计划"
```
