# Repeated Issues Log

> 🔗 **架构级根因库以 `CLAUDE.md` 第3节「已诊断根因库」为单一真相（那是 Claude 维护的同一套根因库的主源）。**
> 调试复发问题前,先读 `CLAUDE.md` 第3节 + 上两层 `../../CLAUDE.md`、`../../../CLAUDE.md`;那里记录了状态对账漂移、正则猜业务状态、占位当真值持久化等会复发的线上 bug 根因。
> 本文件与 `CLAUDE.md` 第3节是**同一套记忆的两个入口**:沉淀新经验时,架构级根因写进 `CLAUDE.md`(Claude 与 Codex 都从那读),本文件可保留指针或记录纯操作型/工具型复发问题,**两边不重复抄全文以免漂移**。

Use this file to stop the same problems from being rediscovered and re-fixed in slightly different ways.

Before debugging a recurring issue, search this file, related tests, and recent handoff/release docs. After fixing a repeated issue, append a concise entry.

## Entry Format

```markdown
## YYYY-MM-DD - Short issue name

- Symptom:
- Environment: cloud production / local development / local backup / GitHub comparison
- Root cause:
- Fix:
## Standing Lessons

## 2026-06-24 - Reference-image local replacement is single-output, and V2 planning needs configured fallback

- Symptom: 林一账号提交“把原图1中湿巾上的字母全部换成图2湿巾上面的字母，图1其他部分不发生任何改变，图片格式为800*800”后，智能体生图失败；同类云上记录出现 `图片规划未完整覆盖本轮多图需求...`，另一路失败为 `Our servers are currently overloaded. Please try again later.`。
- Environment: Tencent Cloud production / agent_center V2 tool calling / configured relay models.
- Root cause: “全部”在该句中修饰湿巾字母，不是所有图片；旧审查把它误当多图独立批处理信号。V2 tool-calling 的 `/v1/responses` provider payload 又缺 `fallbackModels`，规划阶段 overload 时不能在智能体配置模型内切换。
- Fix: 单输出拓扑识别增加“图 A 换成/替换成图 B”和“其它部分不变/保持不变”；MySQL 与本地 JSON 双 handler 的 `openai_responses` payload 都传 `resolveChatFallbackModels(version, selectedModel)`。架构级根因见 `CLAUDE.md` #29。
- Regression check: `node --test server/agentToolConversation.test.mjs --test-name-pattern "参考图替换主图局部|用户明确要求都处理多张新图|用户要求合成到同一张图|多张新图但用户只指定其中一张"`; combined provider/source tests; `npm run build`; `npm run lint`.
- Avoid next time: 多图判断看输出拓扑而不是单个词；`imagePlan:null/providerTaskId:''` 是规划阶段，先查 V2 fallback payload 和配置模型，不要把它当 KIE 出图失败。

## 2026-06-24 - Seedance video asset upload failures need pre-submit media throttling

- Symptom: 董丹丹账号 `6月24日项目2` 前端显示视频生成失败。对账后端 job `041e6f368539bc79d85b13f8` 为 `failed`,没有 `provider_task_id`,没有 `videoUrl`。
- Environment: Tencent Cloud production / short video direct generation / `kie_seedance_video` / managed assets.
- Root cause: 8 张视频参考素材提交前同时转存到 KIE 图床,多张 3-4MB 素材下载/上传压力过高;事件停在 `asset_upload` 的 `provider_network_error: fetch failed`,说明没进入 KIE 视频生成。`kie_seedance_video` 路径原来对图片/视频/音频素材 `Promise.all` 全量并发,不像 `kie_image` 有单任务限流。
- Fix: `kie_seedance_video` 素材解析/转存改为图片、视频、音频合计限流,默认 `MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY=2`;已清理董丹丹失败卡旧的“生成中/任务已提交云端”占位。架构级根因见 `CLAUDE.md` #30。
- Regression check: `server/providerGateway.test.mjs` 覆盖 Seedance managed asset transfer 最大并发不超过 2;`npm run build` 作为前端/类型门禁。
- Avoid next time: 看到 `provider_task_id=null + provider_submitted=0 + asset_upload` 时,先查提交前素材转存,不要归因成上游视频生成失败或成功未显示。

## 2026-06-24 - Direct video success must update shell project and video memory

- Symptom: 董丹丹账号直接视频生成任务后端已成功、MP4 资产返回 200,但页面没有真实显示视频。
- Environment: Tencent Cloud production / short video direct generation / Temporal task engine / shell project card migration.
- Root cause: 直接视频生成的成功结果只稳定写入 `shellProjects`,旧视频工作区仍依赖 `videoMemory.veoProjects`;远端 patch 没有携带 `videoMemory`,完成 result 也缺少 `backendJobId`,刷新/切换后旧读取路径拿不到成功视频。
- Fix: `shellPersistence` 对 completed 直接视频项目镜像 upsert 到 `videoMemory.veoProjects`;`buildProjectRemotePatch` 对 `video/generation` 同步 `videoMemory`;`mergeAppStateForStorage` 服务端合并层兜底从 completed 直接视频项目补 `videoMemory`;成功视频 result 补 `backendJobId`;已修复董丹丹项目现场状态。架构级根因见 `CLAUDE.md` #28。
- Regression check: `shellPersistence` 覆盖 direct video mirror;`uiArchitecture` 覆盖 videoMemory remote patch 和 completed result `backendJobId`;`appStateMerge` 覆盖服务端状态合并镜像和 stale failure 清理;`shellDataAdapter` 覆盖视频结果恢复。
- Avoid next time: 后端任务成功不等于 UI 已恢复。视频迁移期必须同时查 `shellProjects`、`videoMemory.veoProjects`、资产 200 和刷新恢复,不要只用 `internal_jobs.status=succeeded` 判断用户可见。

## 2026-06-24 - Multi-image planning repair must validate final coverage, and provider uploads need unique filenames

- Symptom: 将离账号 2026-06-24 10:48:00 又提交 3 张图并说“都做成白底图，1:1 的比例，正面摆放”，云上最终只落库 1 张结果；用户消息确有 3 个 image attachments，助手 `imagePlan.inputImageUrls` 只有第 3 张。
- Environment: Tencent Cloud production / agent_center V2 tool calling / `gpt-5.5` planning + `gpt-image-2`.
- Root cause: #20 的单轮欠规划审查仍把模型审查当可靠终态；如果审查也误回 `PLAN_OK` 或仍少规划，后端会继续执行单张并标记完成。同一 dry-run 复跑有时首轮又能返回 3 个 tool calls，说明规划非确定。另一个放大因素是托管资产上传到 KIE 时沿用原文件名，多个 `gpt-image-2.png` 会得到同一个中转 URL，历史图/本轮图在模型目录中可能撞 URL。
- Fix: `runAgentConversationV2` 在执行工具前校验独立多图计划覆盖率；强多图语义下不接受未补全的 `PLAN_OK`，最多按 `AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS` 继续修复，仍未补全则快速失败而不是单张完成。`providerAssetTransfer` 上传托管资产时给文件名加稳定 URL hash，避免同名中转图床 URL 碰撞。架构级根因见 `CLAUDE.md` #22。
- Regression check: `server/agentToolConversation.test.mjs` 覆盖“首轮单图 + 审查 PLAN_OK + 二次修复成三图”；`server/providerAssetTransfer.test.mjs` 覆盖同名托管资产上传成不同 provider 文件名；相关 163 个测试通过。
- Avoid next time: 模型审查不是最终保证，执行前必须用结构化覆盖率校验计划；第三方图床上传不能使用裸原文件名作为唯一身份。

## 2026-06-24 - Responses streaming function calls must merge by call_id

- Symptom: 将离账号同一个 3 图白底任务，真实探针里 `gpt-5.5` 看起来返回 6 个重复 `generate_image` tool calls；执行层去重后才执行 3 张，历史坏消息一度落库 6 张并错漏一张产品。
- Environment: Tencent Cloud production / agent_center V2 tool calling / streaming `/v1/responses`.
- Root cause: 不是模型真的语义规划 6 张，而是 Responses SSE 解析器把同一 function call 记录了两次：`response.output_item.added/done` 带 `id=fc_*`，`response.completed` 有时只带 `call_id=call_*` 且缺原始 `id`，旧代码按不同 key 追加，导致每个真实调用翻倍。
- Fix: `readResponsesStream` 合并 function_call 时用 `call_id` 回查已有 `fc_*` item key，保证 `output_item.*` 与 `response.completed` 的同一调用合并为一条；补 completed 缺 id 的 SSE 回归测试。架构级根因见 `CLAUDE.md` #21。
- Regression check: `node --test server/openaiResponsesProvider.test.mjs`; `node --test server/openaiResponsesProvider.test.mjs server/agentToolConversation.test.mjs server/providerGateway.test.mjs server/agentCenterSource.test.mjs`; real relay probe with the same 3 KIE HTTPS inputs returns exactly 3 parsed tool calls.
- Files/tests: `server/openaiResponsesProvider.mjs`, `server/openaiResponsesProvider.test.mjs`, `CLAUDE.md`.
- Avoid next time: tool call 数量异常翻倍时先查 provider 原始 SSE 与解析合并逻辑，不要先改 prompt 或业务语义；Responses 流式事件必须按 `call_id` 做跨事件合并。

## 2026-06-23 - Multi-image independent edit requests need model-reviewed under-planning repair

- Symptom: 将离账号 17:54:08 上传 3 张图并说“都做成白底图，1:1 的比例，正面摆放”，最终只生成 1 张。
- Environment: Tencent Cloud production / agent_center V2 tool calling / `gpt-5.5` planning + `gpt-image-2` generation.
- Root cause: #19 图床修复已生效，HTTP 图床已转成 KIE HTTPS 并进入 Responses 多模态分析；但首轮模型只返回了 1 个 `generate_image` tool call，`imagePlan.inputImageUrls` 只有一张图、`providerTaskId` 也只有一个。后端没有丢 tool calls，是模型对“都处理”欠规划。
- Fix: `runAgentConversationV2` 增加语义审查而不是业务硬编码：只要出现“多张新上传图 + 首轮只规划 1 个单图 generate_image”的结构性风险，就让同一模型复核用户语义。模型判断是每张/全部/都/分别/各自处理时，重新返回多次 `generate_image`；模型判断只指定某一张或合成/融合/同一张输出时，回复 `PLAN_OK` 并保持单张计划。
- Regression check: `server/agentToolConversation.test.mjs` 覆盖“都处理三张首轮只返回一个 tool call 会二次审查并重规划成三张”、“只处理图1审查后保持单张”、“合成一张海报不会被拆”。
- Avoid next time: 不要为白底图、加字、换背景写具体需求特判；也不要只跑单元测试就提交。模型语义类修复必须用真实中转模型跑同类探针，确认审查后 tool call 数量符合预期，再提交/部署。

## 2026-06-23 - Agent Responses image-url planning failures must retry with the image catalog, not expose 502

- Symptom: 将离账号智能体上传 3 张图并要求“都做成白底图，1:1 的比例，正面摆放”时，前端直接显示 `responses 请求失败 (502)`。
- Environment: Tencent Cloud production / agent_center V2 tool calling / `gpt-5.5` via `/v1/responses`.
- Root cause: 失败消息 metadata 为 `requestMode:'chat'`、`imagePlan:null`、`providerTaskId:''`，说明还没提交 KIE；附件 URL 均为 `http://111.229.66.247/api/assets/file/...` 公网图床 URL，外网 curl 200。真实中转探针显示同一图片用 HTTP 图床 URL 连续 3 次 502，先上传到 KIE 得到 `https://tempfile.redpandaai.co/...` 后连续 3 次可被 `gpt-5.5` 正确识别；三张 HTTP 图床一起发 502，同三张 KIE HTTPS 图床一起发可被逐张描述。根因是 Responses 首轮多模态视觉输入拉取/解析本服务 HTTP 图床 URL 不稳定，不是没有发公网 URL。
- Fix: `runAgentConversationV2` 首轮模型分析前通过 `prepareModelImageUrl` 把本服务 HTTP `/api/assets/file/...` 图片下载并上传到 KIE 图床，拿到上游稳定可读的 HTTPS URL；随后仍以多模态 `image_url` 发给同一中转模型分析，让模型真正看图并按语义决定单图/多图工具调用。HTTPS 图片仍先尝试多模态，遇到 `provider_bad_response`/502 再降级到文本目录。架构级根因见 `CLAUDE.md` #19。
- Regression check: `node --test server/agentToolConversation.test.mjs server/agentCenterSource.test.mjs server/openaiResponsesProvider.test.mjs server/providerGateway.test.mjs`; `npm run build`; `npm run lint`; real relay probe: HTTP 图床单图连续 3 次 502，同图 KIE HTTPS 连续 3 次可识别；HTTP 三图 502，同三图 KIE HTTPS 可逐张描述。
- Files/tests: `server/agentToolConversation.mjs`, `server/index.mjs`, `server/agentToolConversation.test.mjs`, `server/agentCenterSource.test.mjs`, `CLAUDE.md`.
- Avoid next time: 带图 502 先按 `imagePlan/providerTaskId` 分阶段；为空是 Responses 规划阶段，不要套用 KIE 恢复逻辑。云上 HTTP 图床要先转成稳定 HTTPS 图床再 inline 给 Responses，不能只给文本目录冒充看图，也不要引入 base64 fallback 或 Gemini fallback。

## 2026-06-23 - Agent chat assets live with the chat session, not the temporary asset TTL

- Symptom: 用户要求智能体对话生成的内容和图在云上长期保留，不能 3 天或 7 天后自动删除；只有删除会话时才删除会话内所有内容。
- Environment: Tencent Cloud production / local development agent_center managed assets and chat sessions.
- Root cause: 智能体对话生成图和附件复用了通用 `stored_assets` 3 天 TTL，删除会话/清空历史只删 `chat_messages` 和 `chat_sessions`，没有收集消息正文、附件和 metadata 中的 `/api/assets/file/:id` 去删除图床资产。
- Fix: `agent_center` 写入的 managed asset 使用永久 `expiresAt=0`，资产清理器把非正数过期时间视为永久；删除单个会话、清空某智能体历史时，MySQL 和本地 JSON 两套 handler 都先级联删除会话内 managed assets，再删除消息和会话。架构级根因见 `CLAUDE.md` #18。
- Regression check: `node --test server/agentCenterSource.test.mjs server/assetStore.test.mjs server/assetCleanup.test.mjs server/assetReferenceCleanup.test.mjs server/accountDataRetention.test.mjs`; `npm run build`; `npm run lint`.
- Files/tests: `server/assetStore.mjs`, `server/index.mjs`, `server/assetStore.test.mjs`, `server/agentCenterSource.test.mjs`, `CLAUDE.md`.
- Avoid next time: 会话内资源不能默认套临时素材 TTL；新增会话资产必须同时覆盖“清理任务不会误删”和“删除会话会释放图床文件”两条回归。

## 2026-06-23 - Providerless detail jobs must not hold user concurrency for 15 minutes

- Symptom: 天琪账号首图任务创建后长时间不开始，前端约 10 分钟后显示首图生成失败；后台实际首图 `kie_image` 在稍后才开始并成功出图。
- Environment: Tencent Cloud production one_click first_image blocked by earlier detail_page jobs / Temporal task engine.
- Root cause: 前一个详情页项目的 5 个 `kie_image` 任务占满该账号并发，但这些任务并不是在正常等上游出图；它们停在 provider 提交前的素材上传/提交阶段，`providerTaskId:null`、`providerSubmitted:false`，至少一个出现 `asset_upload fetch failed`。Temporal 为避免重复向上游创建任务，遇到 `running` 且没有 `providerTaskId` 的 MySQL job 不会自动重提，最终只能等 providerless stale reconciler 释放。云上原释放窗口为 15 分钟，导致后续首图任务被排队拖住。
- Fix: 云上 `.env.server` 调整 `MEIAO_PROVIDERLESS_RUNNING_STALE_MS=300000`、`MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS=30000` 并重启 PM2；已确认健康检查通过。真正已拿到 `providerTaskId` 的任务不受该规则影响，仍继续等待上游结果。
- Regression check: 云上 `.env.server` 已包含两个配置；`curl http://127.0.0.1:3100/api/health` 返回 `{"ok":true,"mode":"internal-mysql-v1","taskEngine":"temporal"}`；PM2 `meiao-internal` online。
- Files/tests: `.env.server.example`, `docs/tencent-cloud-deploy.md`, `docs/project-overview.md`, `server/jobManager.mjs`, `server/index.mjs`.
- Avoid next time: 看到后续任务排队超时，先区分“已提交上游正在出图”和“providerless 提交阶段异常”。`provider_submit_stale`、`providerTaskId:null`、`providerSubmitted:false` 代表没有进入正常出图等待；不要把并发占用误判为 image2/nano 出图慢。

## 2026-06-23 - Agent Responses streaming must be real at the provider boundary

- Symptom: 中转站后台显示智能体请求 `/v1/responses` 为“非流”，复杂需求对话出现 `status_code=502/openai_error`；前端虽然走 SSE，但正文不是 token 级流式。
- Environment: Tencent Cloud production / local development agent_center V2 tool calling with `OPENAI_COMPATIBLE_*`.
- Root cause: 浏览器到 Node 的 SSE 已存在，但 `openai_responses` provider 边界没有 `stream:true`，`providerGateway` 也没有转发 `onDelta`；本地 JSON chat handler 还没有 SSE 包装，导致排查时容易误判。
- Fix: `openaiResponsesProvider` 支持 Responses SSE，解析 `output_text.delta` 和流式 `function_call_arguments`；`providerGateway` 转发 `onDelta`；MySQL 与本地 JSON chat handler 都透传 delta，并避免最终整段正文重复推送。架构级根因见 `CLAUDE.md` #16。
- Regression check: `node --test server/openaiResponsesProvider.test.mjs server/providerGateway.test.mjs server/agentToolConversation.test.mjs server/agentCenterSource.test.mjs`; `node --experimental-strip-types --test src/services/internalApi.test.mjs src/services/chatStreamParse.test.mjs src/shell/modules/AgentCenter/AgentCenterModule.test.mjs src/shell/modules/AgentCenter/ChatConversationPane.test.mjs`; `npm run build`.
- Files/tests: `server/openaiResponsesProvider.mjs`, `server/providerGateway.mjs`, `server/index.mjs`, `server/openaiResponsesProvider.test.mjs`, `server/providerGateway.test.mjs`, `server/agentCenterSource.test.mjs`, `CLAUDE.md`.
- Avoid next time: 不要用“前端请求 SSE”证明上游已流式；必须查 provider 请求体、上游 content-type、delta 解析和双 handler 透传。中转站 502 先用最小真实探针比较 stream/non-stream，再改代码。

## 2026-06-23 - Agent V2 image tool calls must execute all semantic outputs

- Symptom: 智能体多图生图不能像 GPT 原生对话那样按语义决定生成几张图；用户表达“每张/逐张/分别处理”时，后端仍可能只执行一次生图或把多图当成一张合成输入。
- Environment: Tencent Cloud production / local development agent_center V2 tool calling.
- Root cause: `runAgentConversationV2` 只取第一条 `generate_image` tool call，并用 `imageGenerated=true` 阻止后续生图，把模型返回的多次工具调用压成单次。问题不是缺少某个“抠白底”关键词特判，而是执行器没有忠实执行模型的工具调用计划。
- Fix: V2 工具循环改为按模型返回顺序执行所有 `generate_image` / `search_knowledge` tool calls；每个 `function_call` 后紧跟对应 `function_call_output`；多张生图结果聚合到 `imageResultUrls`，并在 `imagePlan.outputCount/plans/providerTaskIds/imageResultUrls` 中保留明细。生图模式提示词补充通用语义：逐张/分别/每个素材处理时多次调用，融合/合成/同一张图时单次调用，参考编辑时单次调用并说明角色。
- Regression check: `node --test server/agentToolConversation.test.mjs`; `node --test server/agentCenterSource.test.mjs server/agentChatCheckpointMetadata.test.mjs server/agentConversationReliability.test.mjs server/agentToolConversation.test.mjs`; `node --experimental-strip-types --test src/modules/AgentCenter/chatConversationRendering.test.mjs src/modules/AgentCenter/chatMessageDisplay.test.mjs src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`; `npm run lint`; `npm run build`.
- Files/tests: `server/agentToolConversation.mjs`, `server/agentToolConversation.test.mjs`, `CLAUDE.md`.
- Avoid next time: 不要在后端把图片语义写成具体需求关键词分支。模型负责判断需要几次工具调用；后端负责执行所有合法 tool calls、校验输入 URL 来自目录、聚合多结果，并保证最终文案失败不会丢主产物。

## 2026-06-18 - Agent tool-calling image tasks need task-id checkpoints and message-list recovery

- Symptom: 云上智能体上游任务已经提交/出图，但前端仍停在“思考中/调用模型中”，刷新和轮询也不显示结果。
- Environment: Tencent Cloud production agent_center / V2 tool calling `requestMode:'chat'`.
- Root cause: V2 `generate_image` 在 HTTP chat handler 内直接调用 KIE，不创建 `internal_jobs`。原逻辑等图片完整返回并持久化后才写 `image_result_ready`；如果在 KIE createTask 成功后、图片结果落库前中断，DB 没有 providerTaskId，消息只能永久 pending。
- Fix: MySQL/本地 JSON 两套 chat handler 在 `onProviderTaskId` 立即写 `image_task_submitted` checkpoint；最终落库不再擦掉 taskId。`providerGateway` 增加 `kie_probe` 单次查询；消息列表 GET 自动探测带 providerTaskId 的 pending 消息，完成后写回 `image_task_recovered`。
- Regression check: `node --test server/providerGateway.test.mjs`; `node --test server/agentCenterSource.test.mjs`; `node --test server/agentToolConversation.test.mjs server/agent-image-retrieval.test.mjs src/modules/AgentCenter/agentConversationReliability.test.mjs`; `npm run build`.
- Files/tests: `server/index.mjs`, `server/providerGateway.mjs`, `server/agentCenterSource.test.mjs`, `server/providerGateway.test.mjs`, `CLAUDE.md`.
- Avoid next time: 智能体生图要把“上游 task 已提交”和“图片结果已落库”作为两个独立 checkpoint；任何等待上游的工具调用一拿到 provider task id 就必须持久化，并给消息列表/刷新路径一条自动恢复通道。

## 2026-06-18 - Agent image analysis 502 must degrade to a deterministic plan

- Symptom: 云上智能体对话里 assistant 直接显示 `responses 请求失败 (502): openai_error/bad_response_status_code`，且没有生成图片结果。
- Environment: Tencent Cloud production agent_center / old direct `image_generation` path.
- Root cause: 失败发生在生图前的 `kie_chat` 分析/规划阶段，样本中 `imagePlan:null`、`imageResultUrls:null`、`providerTaskId:''`，说明 KIE 出图未提交。所有分析 provider 都失败时直接抛错给用户；分析 fallback 还必须尊重智能体配置，不能擅自跳到用户未配置的供应商模型。
- Fix: 分析 fallback 只在版本策略、白名单和当前中转配置内选择备用模型；守住 `gpt-5.4`、`gpt-5-4-openai-resp`、`claude-sonnet-4-6`，并加测试禁止无配置 Gemini fallback。分析阶段全失败时，用用户原话和已选图片引用构造 deterministic image plan，继续提交 KIE 生图。
- Regression check: `node --test server/agent-image-retrieval.test.mjs server/agentCenterSource.test.mjs server/agentConversationReliability.test.mjs server/agentToolConversation.test.mjs`; `node --test server/providerGateway.test.mjs --test-name-pattern "fallback|responses|gemini 3 flash"`; `npm run build`; `npm run lint`.
- Files/tests: `server/index.mjs`, `server/agent-image-retrieval.test.mjs`, `CLAUDE.md`.
- Avoid next time: 智能体 502 先按 `imagePlan/providerTaskId/imageResultUrls` 判定失败边界；`imagePlan:null + providerTaskId:''` 是分析阶段，不是“出图后丢结果”。分析 fallback 必须尊重用户配置；分析阶段是辅助步骤，不能让 provider 502 直接成为用户可见终态。

## 2026-06-18 - Agent image asset checkpoints must survive deploy restarts

- Symptom: 多桑账号智能体功能里,上游已出图并保存到 `stored_assets`,但前端一直显示思考/需求分析中。
- Environment: Tencent Cloud production agent_center / PM2 deploy restart window.
- Root cause: 智能体生图只在整条回复结束时一次性更新 `chat_messages`;部署重启卡在图片资产落库之后、assistant 消息 completed 更新之前,导致消息永久停在 `pending/analyzing`。
- Fix: MySQL 和本地 JSON 两套 chat handler 增加 `image_result_ready` checkpoint；图片一旦持久化且 `imageResultUrls` 非空,立即把对应消息更新为 completed 并写入图片附件、image plan、provider task id。后续最终回复仍可覆盖。
- Regression check: `node --test server/agentCenterSource.test.mjs server/agentConversationReliability.test.mjs server/agentToolConversation.test.mjs`; `npm run build`.
- Files/tests: `server/index.mjs`, `server/agentCenterSource.test.mjs`, `CLAUDE.md`.
- Avoid next time: 多阶段链路的用户可见主产物不能等最后一步才落库；任何 `await` 后都要假设进程可能被重启。

## 2026-06-18 - Agent image success must survive final text failure

- Symptom: 云上智能体存在"上游已经出图,但对话里显示失败"的情况。
- Environment: Tencent Cloud production agent_center / V2 tool calling image generation.
- Root cause: V2 生图工具链路在 KIE 返回图片后还会再请求 Responses 生成最终文字说明；原实现没有局部降级,第二轮 Responses 502 会把整条 assistant 消息标记为 failed,并丢掉已生成的 `imageResultUrls/imagePlan/providerTaskId`。
- Fix: `runAgentConversationV2` 在图片结果已存在时捕获最终文案模型失败,返回降级成功回复并保留图片附件、image plan、provider task id；技术错误写入消息 metadata,不直接裸露在用户正文里。
- Regression check: `node --test server/agentToolConversation.test.mjs`.
- Files/tests: `server/agentToolConversation.mjs`, `server/index.mjs`, `server/agentToolConversation.test.mjs`, `CLAUDE.md`.
- Avoid next time: 多阶段 provider 编排要把"主产物成功"和"尾部说明失败"分开处理；新增链路必须测"主产物成功 + 最后一步失败"。

## 2026-06-18 - Cloud video playback must not preload every visible result

- Symptom: 云上视频播放再次出现卡顿/不流畅；本地网络快时不明显，但公网入口下载 1MB range 约 0.4-0.9s，多个视频同时预取会抢带宽和解码。后续用户进一步确认不是转圈缓冲，而是播放观看时卡帧。
- Environment: Tencent Cloud production video playback / project cards.
- Root cause: 资产路由已有 Range 支持，但项目卡片为了预览帧对可见视频直接 `preload=metadata` 并 seek；视频工作区的 `<video>` 也存在未显式 preload 的入口，浏览器可按默认策略提前加载。后端资产响应缺少 ETag/Last-Modified，Nginx 也只显式转发 `Range/If-Range`，公网条件请求不能 304 命中。卡帧场景还叠加了 UI 合成压力：视频播放路径被项目卡 hover scale、整屏 `backdrop-filter`、圆角裁剪和大阴影包裹，真实浏览器容易掉帧。
- Fix: 缩略视频默认 `preload=none`；可播放视频在 hover/focus/pointerdown 时切到 `preload=auto` 预缓冲，点击覆盖播放按钮时等待 `canplay/loadeddata` 或短超时后再 `play()`，并在真实播放时跳过预览 seek，避免抢首帧。视频工作区显式 `preload="metadata"`/`playsInline`。托管资产响应增加 `Cache-Control: private, max-age=604800, immutable`、ETag、Last-Modified、`X-Accel-Buffering: no`；云上 Nginx 补 `If-None-Match` 和 `If-Modified-Since` 代理头。视频播放 UI 禁用 hover scale、整屏背景模糊、放大预览视频阴影和圆角裁剪，降低 GPU 合成压力。
- Regression check: `node --test --test-name-pattern "shell project detail uses responsive side-by-side image comparison and stack preview|stored asset route supports byte range streaming for video playback|video workspaces avoid implicit eager video downloads on cloud playback views" src/components/uiArchitecture.test.mjs`; `npm run lint`; `npm run build`；云上 `curl -H Range` 必须 206，`curl -H If-None-Match` 必须 304。
- Files/tests: `src/shell/components/ProjectCard.tsx`, `src/shell/components/ImageLightbox.tsx`, `src/modules/Video/LongVideoSubModule.tsx`, `src/modules/Video/VeoWorkspace.tsx`, `server/index.mjs`, `src/components/uiArchitecture.test.mjs`, `/www/server/panel/vhost/nginx/meiao-internal.conf`.
- Avoid next time: 修视频卡顿不能只看播放器 UI；必须同时查 `<video preload>`、可见视频数量、托管资产 Range/缓存头、Nginx 是否转发条件请求，以及播放时祖先元素是否有 `backdrop-filter`、transform/scale、overflow rounded clipping、大阴影。缩略视频默认 `preload=none`，但用户明确要播放的单个视频必须提前切 `auto` 做短预缓冲，否则公网波动会把“点击即播”变成边播边等。

## 2026-06-18 - Expired legacy agent models need a fallback pair

- Symptom: 云上日志出现 `智能体对话失败：对话改图 Kie Responses 返回为空`，用户会话里 assistant 直接显示 `Kie Responses 返回为空`。
- Environment: Tencent Cloud production agent_center / local development.
- Root cause: 历史智能体版本仍保存已下线的豆包模型白名单；服务端读取版本时会丢弃当前模型目录中不存在的模型。原先当配置模型全部失效时只回落到模型目录第一个模型 `gpt-5-4-openai-resp`，导致旧会话被迁到 KIE Responses 单模型运行；上游空返时 `resolveChatFallbackModels` 没有任何备用模型可切。
- Fix: `sanitizeAllowedChatModels` 在配置模型全部失效时先纳入当前中转站 `OPENAI_COMPATIBLE_MODELS` 发布出的模型，再补默认主备组合 `gpt-5-4-openai-resp` + `gemini-3-flash-openai`，保留主模型能力，同时让 `provider_bad_response` 能切到显式 fallback。
- Regression check: `node --test server/agentCenterSource.test.mjs server/providerGateway.test.mjs`; `node --test server/agent-image-retrieval.test.mjs`; `npm run lint`; `npm run build`.
- Files/tests: `server/index.mjs`, `server/agentCenterSource.test.mjs`.
- Avoid next time: 模型目录下线旧模型时，不能只验证新建智能体；还要查历史 `agent_versions.allowed_chat_models_json/default_chat_model/model_policy_json` 里是否有全失效配置，并确保归一化后纳入当前中转站模型和至少一个备用模型。看到 `Kie Responses 返回为空` 先查会话绑定版本、`selected_model`、`allowed_chat_models_json` 与 `OPENAI_COMPATIBLE_MODELS` 是否漂移。

## 2026-06-17 - Providerless submit recovery must not blindly resubmit upstream jobs

- Symptom: 长苏账号批量详情页出图时，5 个 `kie_image` 任务一直没有拿到上游 `providerTaskId`，前端显示“任务等待超时”，后端 15 分钟后以 `provider_submit_stale` 终态失败。
- Environment: Tencent Cloud production one_click detail_page / Temporal task engine.
- Root cause: 任务提交上游期间云上 `meiao-internal` / Temporal worker 连续重启，活动 heartbeat timeout；但“没有拿到 providerTaskId”不等于“上游一定没收到请求”。原实现允许 MySQL Temporal activity 重新认领 `running` 任务，若该任务还没有 `providerTaskId`，activity retry 会再次进入 `executeJob`，存在重复向上游创建任务的风险。
- Fix: MySQL Temporal activity 遇到 `status='running'` 且没有 `providerTaskId` 的任务时，直接返回当前状态，不再 claim、不创建 attempt/event、不执行 `executeJob`。继续保持 providerless stale 兜底终态失败并释放并发；后续若要自动恢复，必须先引入 provider 提交幂等键或把提交阶段拆成可证明未发送/已发送的状态。
- Regression check: `node --test server/temporalWorker.test.mjs --test-name-pattern "does not resubmit"`; `node --test server/jobManager.test.mjs server/temporalWorker.test.mjs server/jobLoggingBehavior.test.mjs server/taskPlatform.test.mjs server/temporalTaskAdapter.test.mjs`.
- Files/tests: `server/temporalWorker.mjs`, `server/temporalWorker.test.mjs`, `server/jobManager.test.mjs`, `server/jobLoggingBehavior.test.mjs`.
- Avoid next time: 看板出现 `provider_submit_stale` 且 PM2 同窗口有 `Activity task timed out` / `Worker state changed STOPPING/RUNNING` 时，先查进程重启；但不要靠盲目提高 Temporal activity retry 或自动 `retry_waiting` 来“稳定”，除非 provider 提交具备幂等性或能证明请求尚未发出。

## 2026-06-17 - Agent chat lifecycle tests must cover the shell entry

- Symptom: 智能体对话旧模块 `src/modules/AgentCenter/AgentCenterModule.tsx` 已有 pending run 恢复和输入锁定保护，但真实应用入口 `src/shell/modules/AgentCenter/AgentCenterModule.tsx` 缺少同款逻辑；刷新后的后台 run 可能锁定/展示语义不一致。
- Environment: local development agent_center shell route.
- Root cause: 前端同时保留旧模块入口和 shell 入口，已有回归测试只覆盖旧模块源文件，真实挂载路径没有同等断言，导致对话生命周期逻辑发生路径漂移。
- Fix: shell 入口补齐结构化 pending/running 判定、后台轮询同步、重复发送锁定、Composer running 状态传递；新增 shell 专属回归测试。
- Regression check: `node --experimental-strip-types --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`; `node --experimental-strip-types --test src/modules/AgentCenter/agentConversationReliability.test.mjs`.
- Files/tests: `src/shell/modules/AgentCenter/AgentCenterModule.tsx`, `src/shell/modules/AgentCenter/AgentCenterModule.test.mjs`, `src/modules/AgentCenter/agentConversationReliability.test.mjs`.
- Avoid next time: 改智能体对话生命周期、复制/重新生成、能力栏、run trace 时，必须确认真实入口 `src/ShellMigratedApp.tsx` 当前挂载的是 shell 版本，并给 `src/shell/modules/AgentCenter/AgentCenterModule.test.mjs` 加同等门禁；不能只测旧 `src/modules/AgentCenter/AgentCenterModule.tsx`。

## 2026-06-12 - One-click result edits must pass the generated baseline as image input

- Symptom: 一键主详/详情页“修改”时，提交 payload 的 prompt 里有 `【修改基准图】` URL，但最终结果没有按该基准图编辑；同时新生图任务没有复用原先的生图 prompt，只按短修改说明重建画面。
- Environment: Tencent Cloud production one_click result edit / local development.
- Root cause: 不是 JSON `\n` 导致 URL 不可读；换行后的 URL 文本仍是有效字符串。程序问题有两层：详情页编辑在 `buildShellImageInputUrls` 中先命中了详情页套图参考图分支，导致 `sourceResultUrl` 只写在 prompt 文本里，没有进入上游真正读图的 `input_urls`；`handleEditResult` 又把 `schemeContent` 覆盖成用户短修改说明，编辑 prompt 无法复用原始生图 prompt。
- Fix: 一键编辑只要存在 `sourceResultUrl + editInstruction`，优先提交 `product/gift/sourceResultUrl` 作为模型图片输入，避免详情页参考图分支吞掉编辑基准图；编辑任务 `schemeContent` 优先复用 `result.prompt`、原方案 `schemeContent` 或方案摘要；编辑 prompt 显式包含“原始生图 Prompt”块和基准图/素材/任务/约束分区。
- Regression check: `node --test src/adapters/shellOneClickMaterials.test.mjs`; `node --test src/modules/OneClick/oneClickBehavior.test.mjs --test-name-pattern "one click result edit|continue fission"`; `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "one click completed result edit"`; `npm run build`.
- Files/tests: `src/adapters/shellOneClickMaterials.mjs`, `src/modules/OneClick/generationPromptUtils.ts`, `src/ShellMigratedApp.tsx`, `src/adapters/shellOneClickMaterials.test.mjs`, `src/modules/OneClick/oneClickBehavior.test.mjs`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: prompt 中写 URL 不等于模型已获得图片输入。凡是“基于生成结果修改/裂变”的链路，都必须同时检查 `taskMetadata.sourceResultUrl`、最终 `input_urls` 和最终 submitted prompt；编辑分支不能把原始方案 prompt 替换成短指令。

## 2026-06-12 - Detail-page retry success must outrank stale same-plan failures

- Symptom: 云上账号“多桑”一键详情套图复刻已出图，但前端详情页仍显示“失败/重试”；用户再次重试后，云上继续成功出图，前端仍显示失败。
- Environment: Tencent Cloud production one_click detail_page set replication / local development.
- Cloud evidence: 项目 `proj-plan-1781230443454` 首次批量 8 张中 7 张成功，`plan-1781230569944-5-j5tdw` 的原 job `032d51d6e6828c4b970cf78c` 在 polling 阶段失败，错误为 `Internal Error, Please try again later.`；随后同一 `planId` 的重试 job `677a83b1448a37c928c03f6e` 成功并返回图片 `d67f11b4b89a7b26bb50e7c7/kie_image.png`，再次重试 job `a8576dd93d6563650c8b10a5` 也成功。云端 app state 同时保留成功结果和旧失败结果，旧失败 job id `032...` 字典序排在成功 job id `677...` 前。
- Root cause: `PlanEditor` 通过 `findResultsForPlanDisplay(...)[0]` 判定详情页单屏状态；同一 `planId` 有多个结果时，排序只按 backend/task/id 的稳定字符串，没有把“已完成且有图”的结果排在“无图失败”前。数据适配层也只清理无任务身份的失败占位，没有清理带 providerTaskId/backendJobId 的旧失败结果，所以重试成功后旧失败仍可参与显示与计数。
- Fix: `planResultMatching` 同一方案结果排序优先展示 `status=completed` 且有媒体 URL 的结果；`shellDataAdapter` 在同一 `planId` 已存在完成媒体时，清理所有无媒体 error 结果，包括带 taskId/backendJobId 的旧 provider 失败。
- Regression check: `node --test src/shell/components/planResultMatching.test.mjs`; `node --test src/adapters/shellDataAdapter.test.mjs`; `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "project details expose|shell project detail|one click batch generation keeps|one click completed result edit"`; `npm run build`.
- Files/tests: `src/shell/components/planResultMatching.ts`, `src/shell/components/planResultMatching.test.mjs`, `src/adapters/shellDataAdapter.ts`, `src/adapters/shellDataAdapter.test.mjs`.
- Avoid next time: 重试链路不能只测“旧失败无身份占位”。必须覆盖“旧失败有 providerTaskId/backendJobId + 新成功同 planId”的真实生产形态；详情页单屏状态判断必须按结果语义排序，不能只按任务 id 字符串排序。

## 2026-06-12 - Agent prompt-only design briefs must not be forced into image-edit mode

- Symptom: 云上智能体“对话改图”里，用户发送纯文字首图设计 brief，没有上传图片，系统返回“改图任务没有可用输入图”，两次记录为 `missing_image_input`。
- Environment: Tencent Cloud production agent_center / local development.
- Root cause: 智能体生图输入判断把“改善浑浊”“保持原包装”“不改包装文字和 logo”这类普通电商设计约束识别成强改图意图，导致 prompt-only 新图需求被要求必须有输入图。
- Fix: 收窄 `hasAgentImageReferenceIntent`，只有明确图片引用、历史图指代、局部编辑或图片/画面附近的编辑动作才强制要求输入图；普通 brief 中的“保持/不改/改善”不再触发 `missing_image_input`。
- Regression check: `node --test server/agentImagePlan.test.mjs server/agent-image-retrieval.test.mjs server/agentConversationReliability.test.mjs server/agentCenterSource.test.mjs`.
- Files/tests: `server/agentImagePlan.mjs`, `server/agentImagePlan.test.mjs`, `server/agentCenterSource.test.mjs`.
- Avoid next time: 生图模式必须区分“文字 brief 里的设计约束”和“基于已有图修改”。看板再次出现 `missing_image_input` 时，先查用户消息是否真的有附件/历史图指代，而不是只看“改、保持、不变”等单字触发词。

## 2026-06-10 - Long-running shell generation must publish pending cards at job creation

- Symptom: 买家秀点击生成后没有及时出现项目任务卡，底部生成按钮一直显示“任务处理中...”，用户无法确认任务是否已经提交。
- Environment: local development buyer_show shell workflow.
- Root cause: 买家秀 shell 工作流调用 KIE 图像任务时没有把 `onJobCreated` 传入 `processWithKieAi`，外层新壳收不到 backend job / provider task 身份，不能像一键主详一样在任务建立后发布 `generating` 卡片并释放提交锁。
- Fix: 在买家秀 KIE job 创建回调中透传 `input.onJobCreated`，立即发布带 `backendJobId`/`taskId` 的 pending result；提交入口给买家秀传项目级 `taskMetadata`。
- Regression check: `node --test src/shell/components/destructiveActions.test.mjs src/shell/components/layout/BottomInputBar.test.mjs src/modules/BuyerShow/buyerShowBehavior.test.mjs`; `npm run lint`.
- Files/tests: `src/adapters/shellWorkflow.ts`, `src/ShellMigratedApp.tsx`, `src/shell/components/destructiveActions.test.mjs`.
- Avoid next time: 任何长耗时生成链路都不能等最终结果才通知外层 UI。provider/internal job 一创建，就必须回传任务身份、写入可见 `generating` 卡片，并释放“提交中”按钮锁。

## 2026-06-10 - Buyer-show active KIE jobs must remain visible before provider task id

- Symptom: 买家秀生成按钮已经释放，但项目任务卡出现一瞬间后消失；直到所有图片生成完成后任务卡才回显，用户看不到任务是否还在生成。
- Environment: Tencent Cloud production buyer_show / local development.
- Root cause: job hydration 的通用 KIE media 分支为了避免 providerless 孤儿任务污染 UI，在没有 `providerTaskId` 时只保留 task 并跳过 project/result。买家秀提交链路已写入 `shellProjectId`，但该分支没有用这个前端项目身份补出可见 `generating` 卡片。
- Fix: 运行中 buyer_show KIE image job 即使暂时没有上游 `providerTaskId`，只要 payload 有 `shellProjectId`，就用 backend job id 建立项目卡和 pending result；其他模块的 providerless KIE media 仍保持原有过滤规则。
- Regression check: `node --test src/adapters/shellDataAdapter.test.mjs`; `node --test src/shell/components/destructiveActions.test.mjs src/shell/components/layout/BottomInputBar.test.mjs src/modules/BuyerShow/buyerShowBehavior.test.mjs`.
- Files/tests: `src/adapters/shellDataAdapter.ts`, `src/adapters/shellDataAdapter.test.mjs`.
- Avoid next time: 修长耗时任务的“提交即显示”时，要同时覆盖前端乐观发布和后续 `/api/jobs` hydration。按钮释放只能证明 job 创建回调到了，不能证明轮询快照会持续保留项目卡。

## 2026-06-10 - KIE Gemini 3.5 auth text must not become one-click plans

- Symptom: 云上账号一键主详策划/生图出现 `Unauthorized – Authentication failed. Please check that your Authorization and Content-Type headers are correctly set.`；刷新时可短暂看到带该错误文案的脏项目，随后又被 job 同步隐藏。
- Environment: Tencent Cloud production one_click / local development.
- Root cause: 新增 `gemini-3-5-flash` Gemini-native 通道时按旧设计发送 `X-Goog-Api-Key`，但 KIE 实际请求契约使用 `Authorization: Bearer <KIE key>`，导致上游返回鉴权错误文本。此前 provider 网关和一键状态归一化没有完整把该文本当作错误/污染处理，历史持久化 state 中无后端身份的错误文案会在首屏刷新时先被渲染。
- Fix: `gemini-3-5-flash` 改用 `Authorization: Bearer`；provider 网关把成功响应里的鉴权错误文本转为 provider 错误；一键策划校验识别鉴权文本；服务端 state 合并和前端 shell 快照把无后端身份、无媒体的历史错误方案转成不可选的可见失败策划卡，并保留真实 backend job 失败用于排障。
- Regression check: `node --test server/providerGateway.test.mjs`; `node --test src/adapters/shellDataAdapter.test.mjs`; `node --test server/appStateMerge.test.mjs`; `node --test src/utils/oneClickPlanValidation.test.mjs`; `npm run build`.
- Files/tests: `server/providerGateway.mjs`, `server/providerGateway.test.mjs`, `src/adapters/shellDataAdapter.ts`, `src/adapters/shellDataAdapter.test.mjs`, `server/appStateMerge.mjs`, `server/appStateMerge.test.mjs`, `src/utils/oneClickPlanValidation.ts`, `src/utils/oneClickPlanValidation.test.mjs`.
- Avoid next time: 新接 KIE 端点不能只照计划文档写鉴权头，要用当前官方 Request/cURL 契约回归请求头；任何 provider 错误文本都不得作为正常 `schemeContent` 或生图 prompt。刷新脏数据要验证 `buildShellDataSnapshot(state, [])` 首屏路径，而不只是后续 `/api/jobs` hydration；历史失败卡必须可见，不要用过滤制造“藏在 state 里但 UI 不显示”的脏数据。

## 2026-06-08 - First-image planning failures must be preserved in both submit and sync paths

- Symptom: “天琪”账号首图策划失败复现；云上 state 显示部分项目 `taskCount=5`，但 `plans.length` 只有 2、3 或 4，用户仍看不到所有参考图的策划失败状态。
- Environment: Tencent Cloud production one_click first_image / local development.
- Cloud evidence: 2026-06-08 18:05:56 项目 `proj-plan-1780913155904` 创建 5 个 `kie_chat` 策划 job；日志先出现 `provider_network_error` / `asset_download`，Temporal worker 随后出现 `Activity task timed out` / heartbeat timeout，最终全部以 `provider_submit_stale` 失败。对应 app state 仍只有 3 个失败 plans；同日项目 5 只有 2 个，项目 4 只有 4 个。
- Root cause: 这是双层问题。直接策划失败来自上游/网络提交阶段，素材 URL 本身可读；但程序修复不完整：第一次热修只覆盖 `shellDataAdapter` 的同步/恢复路径，提交后的前端成功分支仍过滤掉失败 `perReferenceResults`，catch 分支仍只按最新 backend job 写 1 条泛化错误结果。
- Fix: 首图策划返回层不再 `filter(success)`，而是为每个参考图返回成功 plan 或 `planningFailed/status:error` 失败 plan；部分失败 toast 明确显示完成数和失败数。catch 分支拉取同项目最近 500 个 internal jobs，按 `shellProjectId` 聚合所有终态失败的策划子任务，持久化完整 failed plans 和对应 error results。
- Regression check: `node --test src/adapters/shellPlanningFailure.test.mjs`; `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "one click planning keeps failed reference plans visible|one click generation refuses"`; `node --test src/adapters/shellDataAdapter.test.mjs`; `npm run build`. 仓库没有 `npm test` 脚本。
- Files/tests: `src/adapters/shellPlanningFailure.ts`, `src/adapters/shellPlanningFailure.test.mjs`, `src/adapters/shellWorkflow.ts`, `src/ShellMigratedApp.tsx`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: 多参考图策划必须同时测试“部分成功”和“全失败异常”两条路径；只修 job hydration/sync 不够。验收时查云上 `app_states`，确认 `taskCount`、`plans.length`、失败 toast、失败卡和出图拦截都一致。

## 2026-06-08 - Failed first-image planning references must stay visible and must not become image prompts

- Symptom: 云上账号“天琪”首图项目“6月8日项目3”提交 5 个策划任务后，界面最后只露出 2 张失败策划卡，用户无法判断 5 个参考图是否全部失败；失败卡里的“任务提交上游前长时间未返回上游任务 ID...”还可能被当成正常方案继续提交出图。
- Environment: Tencent Cloud production one_click first_image / local development.
- Cloud evidence: 用户 `823cdda9d1164f59c34d5a6d` 的项目 `proj-plan-1780906352472` 在 2026-06-08 16:12:32 之后创建 5 个 `kie_chat` 首图策划 job，均在 16:28:05 以 `provider_submit_stale` 失败且没有上游 provider task id；日志同时写出“共 5 张参考图，其中 5 张策划失败”。云端 state 最终只保留 2 个 `*-error` plans，并有后续 `kie_image` 任务把失败文案作为 prompt 提交。
- Root cause: `shellDataAdapter` 对失败策划 job 只生成错误 result，没有按 `shellReferenceIndex` 生成稳定可见的 failed plan；归一化阶段又会把错误文案形态的 plan 当无效内容清掉。生成入口只拦截通用 invalid plan 文本，没有把已标记的策划失败卡作为不可出图状态处理。此前修复主要覆盖 provider task id 缺失、任务不存在和成功回填，漏了“策划提交上游前未拿到 providerTaskId 后终态失败”的恢复路径。
- Fix: 失败的一键首图策划 job 现在会按每个参考图构造 `planningFailed/status:error/error` 方案卡并保留 reference index；真实后端失败会替换旧失败占位而不是重复抬高 taskCount；归一化不再清掉 `planningFailed` 卡。`ShellMigratedApp` 生成入口会拦截失败策划卡，全失败时提示重新策划，混选时跳过失败项，避免错误文案进入出图 provider payload。
- Regression check: `node --test src/adapters/shellDataAdapter.test.mjs`; `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "one click generation refuses to turn planning error text"`; `npm run build`.
- Files/tests: `src/adapters/shellDataAdapter.ts`, `src/adapters/shellDataAdapter.test.mjs`, `src/ShellMigratedApp.tsx`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: 多参考图策划的失败恢复必须以“用户提交的参考图数”为可见性基线，不能只按成功 plans 或结果数组推断。错误文案可以显示，但必须带 `planningFailed` 身份并在出图入口硬拦截；任何 provider-submit stale、providerTaskId 缺失、task_not_found 等策划链路终态都要验证“失败卡数量、taskCount、可见提示、后续出图 payload”四件事。

## 2026-06-05 - Main-image failures can be provider balance or stale deleted assets

- Symptom: 云上账号“洛克”主图任务前端显示一堆失败，用户反馈切换多个模型也无法生图/策划。
- Environment: Tencent Cloud production one_click main_image / local development.
- Cloud evidence: 近 24 小时洛克 `internal_jobs` 中 `kie_image` 多次失败为 `provider_bad_request: 通用余额不足，请先充值`；同日后续 `kie_chat` 主图策划失败集中为 `provider_bad_request: 内部素材下载失败：HTTP 404`。失败项目 `proj-plan-1780644568547` 等 payload 仍携带已逻辑删除的 `/api/assets/file/e85227a...`、`1c444a...`、`f6d795...`、`41c600...` 素材 URL。
- Root cause: 这是两类独立问题。生图失败来自 KIE/供应商账户通用余额不足，切换同供应商模型不会解决。策划 404 来自已删除托管素材仍残留在用户 app state / 页面内存，读取状态会清理，但保存状态路径没有写前清理，旧页面可把删除后的 URL 再次落库并提交给 provider。后续复查发现，仅清 app state 仍不够：当前页面内存可以直接提交 `/api/jobs` payload，payload 的 prompt 文本和 `image_url` 消息块里仍会携带 deleted asset URL。
- Fix: `/api/state` 的 MySQL 和本地 PUT 写入路径在 `mergeAppStateForStorage` 后、落库前再次执行失效托管素材清理；`/api/jobs` 普通创建和恢复任务入口也在查重/落库前清理 payload，包含数组、对象、`image_url` 块和 prompt 字符串内嵌的 `/api/assets/file/...` 引用，防止旧前端内存绕过状态保存。后端直接 provider 调用统一改走 `executeProviderJobWithManagedAssetScrub`，在 provider 执行边界前再清一次，覆盖已排队旧任务、智能体聊天/生图、知识库整理、视频诊断等绕过 `/api/jobs` 的路径；`upload_asset` 原样放行，避免破坏文件上传。
- Regression check: `node --test server/assetReferenceCleanup.test.mjs server/appStateMerge.test.mjs server/jobLoggingBehavior.test.mjs server/jobManager.test.mjs`.
- Files/tests: `server/index.mjs`, `server/assetReferenceCleanup.test.mjs`.
- Avoid next time: 看到“换模型也失败”先按失败边界分桶：`kie_image` 的余额/额度类错误归供应商账户；`kie_chat` 的 `内部素材下载失败：HTTP 404` 先查 payload 中 `/api/assets/file/{assetId}` 是否已删除或文件缺失。托管素材清理必须同时覆盖读取、保存、任务创建、provider 执行边界四个边界，不能只做读取或保存时清理；prompt 文本里的 URL 和结构化图片块要一起查。新增任何直接 `executeProviderJob` 路径都必须说明为什么不能走 `executeProviderJobWithManagedAssetScrub`。

## 2026-06-05 - Reappeared sync gaps must not become failed planning/provider logs

- Symptom: 诊断看板 2026-06-04 标出 3 个“修复后复发”指纹：一键主详 `59ab7efe833e424f` 仍出现“主图方案策划失败 任务不存在。”；智能体中心 `fc0db7a357615a50` / `1a51259398fdafe8` 仍出现“内部素材下载失败：HTTP 404”。
- Environment: Tencent Cloud production one_click main_image and agent_center / local development.
- Root cause: 一键主图策划服务已能把 KIE chat `task_not_found/任务不存在/过期` 识别成可恢复同步缺口，但 `generateMarketingSchemes` 的 catch 又统一写 `marketing_plan failed`，前端也把结果按“主图策划失败”打点，导致同一指纹复发。智能体历史图片过滤只校验 asset registry 未删除，没有校验托管文件还在本地存储；过期/清理后的 asset 记录仍可能进入 provider 下载链路，最终变成 HTTP 404。
- Fix: 策划结果类型新增 `task_not_found`，`generateMarketingSchemes` 对可恢复同步缺口写 `marketing_plan_sync_pending` started 日志并返回待同步状态，主图 UI 显示可恢复提示且不写失败打点；智能体托管素材引用进入会话/生图上下文前同时校验 `storageKey` 对应文件存在。
- Regression check: `node --test src/services/arkService.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs server/agent-image-retrieval.test.mjs`; `node --test server/agentConversationReliability.test.mjs server/agentCenterSource.test.mjs server/providerGateway.test.mjs`; `npm run build`.
- Files/tests: `src/services/arkService.ts`, `src/types.ts`, `src/modules/OneClick/MainImageSubModule.tsx`, `server/index.mjs`, `src/services/arkService.test.mjs`, `src/modules/OneClick/oneClickBehavior.test.mjs`, `server/agent-image-retrieval.test.mjs`.
- Avoid next time: “后台任务已经提交但查询短暂不可见”和“业务失败”必须用不同状态、不同日志 action；看板再次看到 `任务不存在` 的 failed planning 指纹，应先查 catch 层是否吞掉可恢复状态。托管素材 URL 不能只凭 registry 判断可用，提交 provider 前必须证明文件仍可读或先从上下文剔除。

## 2026-06-04 - Main-image planning must keep partial scheme counts visible

- Symptom: 云上账号“洛克”主图提交 10 张需求后，项目卡最终只显示 6 个策划任务。
- Environment: Tencent Cloud production one_click main_image / local development.
- Cloud evidence: 洛克账号 job `ca9bc58f30508c981065f4ce` 的 payload 和日志均为 `count:10`，Prompt 写明“策划 10 屏”；上游返回内容只有 7 个 `[SCHEME_START]`、6 个 `[SCHEME_END]`，第 7 屏停在“三档强风·强力降...”中途。项目 `proj-plan-1780556041028` 最终保存 `planCount=6`、`taskCount=6`。
- Root cause: 上游半截返回时，只有完整闭合的 6 个方案可用于后续生图；第 7 个未闭合方案不能安全生成任务卡。把整次策划判失败会浪费已经可用的 6 个方案，也不符合用户预期。
- Fix: `generateMarketingSchemes` 现在保留所有完整方案并生成对应任务卡；若完整方案数少于期望数，额外写入 `marketing_plan_partial_count` 诊断日志，记录期望数、实际数和缺口数。
- Regression check: `node --test src/services/arkService.test.mjs`.
- Files/tests: `src/services/arkService.ts`, `src/services/arkService.test.mjs`.
- Avoid next time: 所有“用户指定数量”的策划链路都要区分“完全无可用方案”和“部分完整方案”。有完整方案时优先让用户可用；数量缺口进入诊断日志和看板统计。排查同类问题先对比：请求 `count`、Prompt 里的屏数、返回文本里的 `[SCHEME_START]`/`[SCHEME_END]` 数、最终 `plans.length/taskCount`。

## 2026-06-03 - SKU new product upload must clear stale sku draft context

- Symptom: 云上账号“林一”制作 SKU 时，用户上传/进入新 SKU 项目后，策划和后续出图仍像之前的老产品；用户反馈“输入框上传新的内容，之前的数据就要被完全清楚，不要有残留”。
- Environment: Tencent Cloud production one_click SKU / local development.
- Cloud evidence: 林一账号最新 SKU 策划 job `25a482cf9de376e9b1402508` 的 payload 仍包含旧 SKU 文案 `曜石黑/星耀金/甜心粉...`；策划输入图为旧 H2O 加湿器产品图 `主图_6.jpg` 和旧 JISULIFE 风格参考图；最新项目没有对应的 `kie_image` SKU 生图任务，问题已在策划输入阶段复现。账号 `shellDraft.inputStateByScope['one_click:sku']` 仍保留旧 `skuCopyText_*` 和 `count`，`shellDraft.materials` 仍保留旧 SKU-scoped product/styleRef。
- Root cause: 上一次修复只阻止 SKU 继承“未标记 subFeature 的历史素材”，但没有处理“同一个 SKU 作用域里的旧产品、旧风格图、旧赠品和旧 SKU 文案”。`handleMaterialUpload` 一直 append 新上传素材，不会在新产品上传时重置 SKU 草稿输入，所以策划会继续读取旧 `skuCopyText_*` 和旧 SKU-scoped materials。
- Fix: 新增 `shellSkuUploadReset` 上传重置规则：一键 SKU 上传新产品时清理整个 SKU 素材上下文并清空旧 prompt、`skuCopyText_*`、`count` 等业务输入；上传风格参考/赠品时只替换同类型 SKU 素材，避免第二步补参考图时误删刚上传的新产品。`ShellMigratedApp` 的真实上传入口已接入该规则。
- Regression check: `node --test src/adapters/shellSkuUploadReset.test.mjs`; `node --test src/components/uiArchitecture.test.mjs`; `npm run build`.
- Files/tests: `src/adapters/shellSkuUploadReset.mjs`, `src/adapters/shellSkuUploadReset.test.mjs`, `src/ShellMigratedApp.tsx`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: SKU 是“新产品即新上下文”的工作流。排查 SKU 串图不要只看最终出图，要同时核对 shell draft 的 `materials`、`inputStateByScope`、planning job payload 和 image job payload；新产品上传必须切断旧 SKU 文案和同作用域旧素材。

## 2026-06-03 - SKU material scope must not inherit legacy unscoped assets

- Symptom: 用户怀疑云上账号“林一”制作 SKU 时，新作图会带上之前产品图片数据，导致新出图像旧产品。
- Environment: Tencent Cloud production one_click SKU / local development.
- Cloud evidence: 林一账号最新 SKU 项目 `6月3日项目2` 的云端 state 和 `kie_chat` 策划 payload 只包含当前 SKU 的 `主图_6.jpg` 产品图和 `SKU图_4...` 风格参考图；截至排查时没有最新 SKU image generation job，因此没有证据表明最新生成任务已经把首图/主图旧素材 URL 一起提交给上游。
- Root cause: 代码存在可复发风险：`filteredMaterials` 用 `!item.subFeature || item.subFeature === activeSubFeature` 兼容旧素材，导致历史无 `subFeature` 标记的材料会被当成通用材料进入 SKU 策划/生图；SKU 是独立商品组合工作流，不应继承未标作用域的旧产品图。
- Fix: 新增 `isMaterialInActiveScope`，对 `one_click + sku` 启用严格隔离，只允许 `subFeature === 'sku'` 的素材进入 SKU；同样用于 SKU 赠品编号计算，防止旧未标记赠品影响新 SKU。
- Regression check: `node --test src/components/uiArchitecture.test.mjs`; `npm run build`.
- Files/tests: `src/ShellMigratedApp.tsx`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: 多子功能共用材料池时，SKU/首图等独立工作流必须显式定义材料作用域规则。不能用“未标记等于通用”覆盖 SKU，因为旧浏览器、导入、恢复和历史 state 都可能产生无 `subFeature` 素材；排查云上问题时要同时核对 app state、internal job payload 和实际 image generation job。

## 2026-06-02 - First-image replication generation must not submit sibling style references

- Symptom: 首图复刻策划里产品素材和复刻参考图角色看起来正确，但后续生图模型收到的 `imageUrls` 同时包含同项目多张风格/复刻参考图，导致模型把参考图里的包装当成商品素材，出图包装错误。
- Environment: Tencent Cloud production one_click first_image / local development.
- Root cause: Shell 批量生图层对一键主详非 SKU 直接把 `Object.values(input.materials).flat()` 全量提交给 provider；首图复刻每个方案虽然有自己的 `sourceReferenceUrl`，但提交时没有按方案过滤 `styleRef`，所以同项目其他参考图也被上传给生图模型。
- Fix: 新增 `shellOneClickMaterials` 过滤层；首图复刻每个方案只保留产品素材、当前方案对应的复刻参考图、logo/上一张结果（如有）。`runShellImageGeneration` 底层也按 `sourceReferenceUrl` 二次过滤 provider 输入 URL。
- Regression check: `node --test src/adapters/shellOneClickMaterials.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs`; `node --test src/components/uiArchitecture.test.mjs`; `npm run build`.
- Files/tests: `src/adapters/shellOneClickMaterials.mjs`, `src/adapters/shellOneClickMaterials.test.mjs`, `src/ShellMigratedApp.tsx`, `src/adapters/shellWorkflow.ts`, `src/modules/OneClick/oneClickBehavior.test.mjs`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: 多参考图工作流不能把“项目级材料集合”直接当“单个方案的模型输入”。提交 provider 前必须按当前方案 role/filter 生成最终 input image list，并用真实历史 payload 回放验证。

## 2026-06-01 - Agent running chat tasks must be durable pending messages

- Symptom: 智能体中心正在执行的对话/生图任务，刷新页面后“思考中/生成中”消息消失；用户会误以为任务没提交，从而再次点击发送。原任务完成后又可能恢复，造成前端状态混乱和重复提交风险。
- Environment: Tencent Cloud production agent_center / local development.
- Root cause: 智能体对话接口只在 provider 成功返回后一次性插入 user/assistant 消息；执行期间的 pending 消息只存在 React 内存中。刷新会丢掉乐观消息，而且同一会话没有以持久化 pending run 为准的发送锁。
- Fix: 后端在调用模型前先持久化一组 pending user/assistant 消息，完成后原地更新为 completed，失败后原地更新为 failed；同一会话存在 pending assistant run 时拒绝新的发送。前端刷新后从历史消息识别 pending run，保持可见并轮询同步，同时锁住输入框。
- Regression check: `node --test server/agentConversationReliability.test.mjs src/modules/AgentCenter/agentConversationReliability.test.mjs server/agentImagePlan.test.mjs server/agent-image-retrieval.test.mjs server/providerGateway.test.mjs server/agentCenterSource.test.mjs`; `npm run build`; local browser load check at `http://localhost:3100/`.
- Files/tests: `server/index.mjs`, `src/modules/AgentCenter/AgentCenterModule.tsx`, `src/modules/AgentCenter/ChatComposer.tsx`, `server/agentConversationReliability.test.mjs`, `src/modules/AgentCenter/agentConversationReliability.test.mjs`.
- Avoid next time: 长耗时任务不能只靠前端乐观状态表示“正在运行”。任何会跨刷新、超时或断线的任务，都必须先落一个后端可查询的 pending 身份，并用同一个身份控制重复提交。

## 2026-06-01 - Agent image edits must resolve provider temporary analysis URLs back to selected references

- Symptom: 智能体“对话改图”中，分析结果明确是 `image_edit` / `image_to_image` 并要求参考图1、图2，但最终生图请求 `inputImageCount=0`，KIE payload 走 `gpt-image-2-text-to-image`，导致参考图被漏掉。
- Environment: Tencent Cloud production agent_center / local development.
- Root cause: provider gateway 会在分析模型调用前把内部素材 URL 转换成 provider 临时 URL；分析模型有时把这些临时 URL 写回 `inputImageUrls`。后端再用原始选图 URL 精确匹配时匹配失败，把输入图过滤成空。
- Fix: 新增 `agentImagePlan` 输入图解析层，按 `imageReferences.index` 映射回当前选中的原始参考图；当分析结果返回空输入或不可用 provider 临时 URL 时，按明确改图/参考意图恢复选中参考图；改图任务无可用输入时停止提交，不再静默降级为文生图。
- Regression check: `node --test server/agentImagePlan.test.mjs server/agent-image-retrieval.test.mjs server/agentConversationReliability.test.mjs server/providerGateway.test.mjs server/agentCenterSource.test.mjs`; `npm run build`; cloud health check after deploy.
- Files/tests: `server/agentImagePlan.mjs`, `server/agentImagePlan.test.mjs`, `server/index.mjs`, `server/agent-image-retrieval.test.mjs`, `server/agentCenterSource.test.mjs`.
- Avoid next time: provider 临时上传 URL 不能当作业务选图身份。提交生图的最终输入图必须由后端根据当前会话选图目录解析，LLM 返回的 URL 只能作为辅助线索。

## 2026-05-29 - Internal asset API URLs must not be sent directly to providers

- Symptom: KIE planning/image requests fail with `image download failed: HTTP 403: Forbidden` for URLs like `http://111.229.66.247/api/assets/file/...`, while the browser may still open the same image.
- Environment: Tencent Cloud production provider gateway / local development.
- Root cause: `/api/assets/file/...` is an internal managed asset route, not a provider-owned stable media URL. Browser reachability is not enough proof that KIE's downloader can fetch it. A previous optimization incorrectly treated non-local managed asset URLs as safe to pass directly, so provider submission skipped the local download + KIE file conversion step.
- Fix: Provider gateway now converts every managed asset URL before submission, including cloud absolute `/api/assets/file/...` URLs in image generation inputs, chat image/file attachments, and text labels. Only non-managed true public URLs are passed through directly.
- Regression check: `node --test server/providerGateway.test.mjs`
- Files/tests: `server/providerGateway.mjs`, `server/providerGateway.test.mjs`
- Avoid next time: Do not classify an `/api/assets/file/...` URL as model-readable just because it has a public host. Before provider submission, managed asset URLs must be converted to a provider-readable file URL, and tests must cover cloud absolute managed URLs, not only localhost or relative paths.

## 2026-05-26 - Asset persistence failures must log actionable detail

- Symptom: 云上日志只出现 `资产持久化失败`，meta 只有文件名和大小，没有可判断原因的 detail。
- Environment: cloud production frontend shell / local development
- Root cause: `persistGeneratedAsset` 的失败日志只记录 `error.message` 和极少 meta；部分上传失败会被错误归一化成空 detail，导致看板无法区分网络、鉴权、文件名、mime、数据库或存储服务问题。
- Fix: 失败日志统一写入 `errorDetail`，并补充 error name/code/status、原始/上传 mime、上传文件名、上传大小和耗时。
- Regression check: `node --test src/services/persistedAssetClient.test.mjs`
- Files/tests: `src/services/persistedAssetClient.ts`, `src/services/persistedAssetClient.test.mjs`
- Avoid next time: 诊断日志不能只写“失败”；必须带足够定位边界的字段，至少包括错误码、状态、输入文件名/mime/大小和耗时。

## 2026-05-26 - Archive files must be blocked before image generation

- Symptom: 云上日志出现 `File type not supported`，样本里 `.zip` 被带入 `kie_image` 图像生成链路。
- Environment: cloud production provider gateway / local development
- Root cause: 图像生成后端只转发 `imageUrls` 和 prompt 中的媒体 URL，没有前置拦截 zip/rar/7z/tar/gz/tgz 这类压缩包素材；供应商收到后才返回不支持文件类型。
- Fix: `runKieImageJob` 在提交 KIE 前检查 `imageUrls` 和 prompt 中提取出的 URL，发现压缩包扩展名直接返回 `provider_bad_request`，提示先解压并上传图片。
- Regression check: `node --test server/providerGateway.test.mjs`
- Files/tests: `server/providerGateway.mjs`, `server/providerGateway.test.mjs`
- Avoid next time: 供应商明确不支持的素材类型要在本地边界拦截；不要让用户等到 provider 创建任务后才失败。

## 2026-05-25 - Malformed URL paths must not crash static routing

- Symptom: PM2 云上日志出现 `URIError: URI malformed`。
- Environment: cloud production frontend static serving / local development
- Root cause: `tryServeFrontend` 对 `url.pathname` 直接调用 `decodeURIComponent`；畸形 `%` 编码路径会让 Node 抛 `URIError`，进入 PM2 error log。
- Fix: 新增 `safeDecodePathname`，畸形路径返回 `400 Malformed path`，不再抛出未捕获异常。
- Regression check: `node --test src/components/uiArchitecture.test.mjs`
- Files/tests: `server/index.mjs`, `src/components/uiArchitecture.test.mjs`
- Avoid next time: 所有来自 URL path/query 的 decode 都必须包在安全解析函数里；外部请求可能携带畸形编码，不能让它进入应用异常日志。

## 2026-05-25 - Provider task ids must fit local asset job id columns

- Symptom: 云上日志出现 `智能体生图失败：对话改图 Data too long for column 'job_id' at row 1`，错误码 `ER_DATA_TOO_LONG`。
- Environment: cloud production agent center / local development
- Root cause: 智能体生图结果持久化到 `stored_assets` 时，把 provider task id 直接作为 `job_id` 写入；部分供应商返回值可能超过 `stored_assets.job_id VARCHAR(120)`，导致资产持久化失败，并进一步让业务失败日志记录数据库异常而不是原始生成结果。
- Fix: 写入 stored asset 的 job id 先经过 `normalizeStoredAssetJobId`，统一 trim 并限制到 120 字符。
- Regression check: `node --test server/agentCenterSource.test.mjs`
- Files/tests: `server/index.mjs`, `server/agentCenterSource.test.mjs`
- Avoid next time: 外部 provider id、URL、message 等字段写入本地固定长度列前必须按列能力规范化；不要假设供应商 id 会符合本地数据库字段长度。

## 2026-05-25 - Agent retrieval chat must carry fallback models

- Symptom: 云上日志出现 `智能体对话失败：对话改图 Kie Responses 返回为空`，错误码为 `provider_bad_response`，集中在带知识库/检索的智能体对话路径。
- Environment: cloud production agent center / local development
- Root cause: 普通智能体聊天会计算并传入 `fallbackModels`，但 `runAgenticRetrievalLoop` 内部再次调用 `executeProviderJob` 时没有把备用模型传下去；GPT-5.4 Responses 返回空内容时，provider gateway 没有可用的显式 fallback，只能直接失败。
- Fix: `runAgenticRetrievalLoop` 接收 `fallbackModels` 并传给 provider payload；两个智能体入口在进入检索循环时都传入同一份 `resolveChatFallbackModels` 结果。
- Regression check: `node --test server/agentCenterSource.test.mjs`
- Files/tests: `server/index.mjs`, `server/agentCenterSource.test.mjs`
- Avoid next time: 新增“循环式/代理式”模型调用路径时，不能只传主模型；要同步传递 model options、fallback models、reasoning、web search 和附件能力，否则普通聊天修复不会覆盖检索/工具循环路径。

## 2026-05-25 - Image provider input limits should degrade before job failure

- Symptom: 云上日志出现 `GPT Image 2 最多支持 16 张输入图`，同一次一键主详批量出图可连续产生多条 `provider_bad_request` 和前端失败日志。
- Environment: cloud production backend provider gateway / local development
- Root cause: provider gateway 对 GPT Image 2 输入图数量超过 16 张直接抛错；一键主详在产品图、参考图、历史结果图、Logo 组合后可能超过模型上限，导致任务创建后立刻失败。
- Fix: GPT Image 2 请求在提交 provider 前按模型能力保留前 16 张输入图，继续执行有效请求。
- Regression check: `node --test server/providerGateway.test.mjs`
- Files/tests: `server/providerGateway.mjs`, `server/providerGateway.test.mjs`
- Avoid next time: provider 模型能力限制要尽量在进入 provider 前裁剪、降级或给用户前置提示；不要把可恢复的参数超限变成云上任务失败日志。

## 2026-05-25 - Static frontend routes must not read directories as files

- Symptom: PM2 云上日志出现 `Error: EISDIR: illegal operation on a directory, read`，堆栈指向 `serveStaticFile` -> `tryServeFrontend`。
- Environment: cloud production frontend static serving / local development
- Root cause: `tryServeFrontend` 只判断 `existsSync(targetPath)`，路径存在就调用 `serveStaticFile`；当请求命中 `dist` 下的目录路径时，`readFileSync` 会尝试读取目录并抛出 EISDIR。
- Fix: 静态文件读取前增加 `statSync(targetPath).isFile()` 检查；目录路径不再进入 `serveStaticFile`，非 assets 目录走 SPA fallback，assets 目录按缺失资源 404。
- Regression check: `node --test src/components/uiArchitecture.test.mjs`
- Files/tests: `server/index.mjs`, `src/components/uiArchitecture.test.mjs`
- Avoid next time: 所有静态资源服务逻辑都不能只用 `existsSync` 判断可读文件；必须区分 file/directory，特别是 SPA fallback 和 assets 404 分支。

## 2026-05-25 - MySQL pool closures are transient infrastructure failures

- Symptom: PM2 云上日志出现 `Error: Pool is closed.`、`Connection lost: The server closed the connection.`，并伴随 `Reconciled N stale running jobs after restart.`。
- Environment: cloud production backend worker / local development
- Root cause: 连接池关闭、数据库断连或进程重启会让 worker 的查询抛出无业务含义的 MySQL 瞬时错误；如果只按 error code 判断，`Pool is closed.` 这种 message-only 错误会被漏掉。
- Fix: `isTransientMysqlConnectionError` 同时识别断连错误码和 `Pool is closed` / `Connection lost` / `server closed the connection` 文案；stale running job 继续回收到 `retry_waiting`，避免重启后直接变成最终失败。
- Regression check: `node --test server/jobRuntime.test.mjs`
- Files/tests: `server/jobRuntime.mjs`, `server/jobRuntime.test.mjs`, `server/jobManager.mjs`
- Avoid next time: worker 遇到数据库连接类错误时不要当供应商或任务逻辑失败处理；日志看板里若部署后仍高频出现，应重点查云上重启原因、MySQL idle timeout 和连接池生命周期，而不是只改业务流程。

## 2026-05-31 - Generated one-click media must not depend only on current plan ids

- Symptom: 洛克账号一键主详项目卡显示已生成，积分已消耗且可批量下载；打开详情后部分方案仍显示“待生成图”。
- Environment: cloud production frontend shell / one_click project detail modal
- Root cause: 详情页 `PlanEditor` 只按当前 `plan.id === result.planId` 匹配生成结果。一键主详历史项目和重复生成项目里，结果图片可能已经保存到 `schemes[].resultUrl` 并进入 `project.results`，但它的 `planId` 仍是旧策划批次或 provider 任务 id；此时批量下载按 `results` 可用，详情方案卡却因为 planId 错位显示待生成。
- Fix: 抽出 `findResultsForPlanDisplay`，先按 planId 精确匹配；精确匹配不到时，把未归属到当前任一方案的 orphan media results 按未匹配方案顺序兜底展示，避免已有图片被隐藏。
- Regression check: `node --test src/shell/components/planResultMatching.test.mjs`
- Files/tests: `src/shell/components/PlanEditor.tsx`, `src/shell/components/planResultMatching.ts`, `src/shell/components/planResultMatching.test.mjs`
- Avoid next time: 详情展示不能只以当前策划 id 判断是否“已出图”；只要结果有真实媒体 URL、backendJobId 或 provider task id，就必须有可见路径。排查同类问题先对比 `plans[].id`、`results[].planId`、`schemes[].resultUrl` 和批量下载列表。

## 2026-05-25 - Clipboard API must be treated as optional

- Symptom: 云上前端日志出现 `Cannot read properties of undefined (reading 'writeText')`，集中在复制提示词、复制文案、复制任务/图片链接等点击入口。
- Environment: cloud production frontend shell / local development
- Root cause: 多个业务组件直接调用 `navigator.clipboard.writeText`。部分浏览器、非安全上下文、权限受限环境或内嵌环境里 `navigator.clipboard` 可能不存在，点击后会变成前端异步错误。
- Fix: 新增共享 `copyTextToClipboard`，先尝试 Clipboard API，失败或缺失时降级到 textarea + `execCommand('copy')`；业务源码禁止直接访问 `navigator.clipboard`。
- Regression check: `node --test src/utils/clipboardFallback.test.mjs`
- Files/tests: `src/utils/clipboard.mjs`, `src/utils/clipboardFallback.test.mjs`, `src/shell/components/ProjectCard.tsx`, `src/shell/components/ResultCard.tsx`, `src/modules/Retouch/RetouchModule.tsx`, `src/modules/BuyerShow/BuyerShowModule.tsx`
- Avoid next time: 新增复制按钮时只调用共享 helper，不要在组件里裸调浏览器 Clipboard API；看板里再次出现 `writeText` 应按“已修复后复发”重点关注。

## 2026-05-25 - Backend-completed tasks must replace stale frontend failure placeholders

- Symptom: 前端项目卡显示失败或多个任务被压成单个，但 `/api/jobs` 后台任务已经成功并有真实 provider task id / 图片结果；管理员日志缺少项目、方案、批次等定位字段，排查需要反查多处数据。
- Environment: local development / cloud production frontend shell
- Root cause: 一键主详刷新水合时，非首图结果会按 `planId` 折叠，吞掉同一方案下不同 backend/provider 任务；后台成功结果和旧前端失败占位合并时，没有清掉“无 backend/provider 身份”的同 plan 失败占位，导致 `taskCount` 被抬高、项目继续显示 `error`。任务日志 meta 也只记录少量 job/provider 字段，不足以直接定位 shellProjectId、shellPlanId、subFeature 和批次。
- Fix: `normalizeOneClickProjectCard` 不再按 `planId` 折叠真实结果，`taskCount` 至少覆盖结果数；`mergeProjectResultsByIdentity` 在后台成功结果进入时，只移除同 plan 且无 backend/provider 身份、无媒体 URL 的旧失败/生成占位；新增统一 `buildJobRuntimeLogMeta`，创建/完成/失败日志都带 job、provider、shell 项目/方案、子功能、批次、耗时、积分和结果 URL 数量。
- Regression check: `node --test src/adapters/shellDataAdapter.test.mjs src/utils/shellProjectResults.test.mjs server/jobRuntime.test.mjs server/jobLoggingBehavior.test.mjs server/localJobStore.test.mjs server/jobManager.test.mjs`
- Files/tests: `src/adapters/shellDataAdapter.ts`, `src/adapters/shellDataAdapter.test.mjs`, `server/jobRuntime.mjs`, `server/jobRuntime.test.mjs`, `server/jobManager.mjs`, `server/localJobStore.mjs`, `server/index.mjs`, `server/jobLoggingBehavior.test.mjs`
- Avoid next time: 任务结果合并不能只看 `planId`；真实 backend/provider 身份优先。旧失败占位如果没有 backend/provider 身份，后台同 plan 成功结果应覆盖它而不是并存抬高 taskCount。新增任务日志必须统一走诊断 meta 构造器。

## 2026-05-25 - Pending card deletion must tombstone backend jobs

- Symptom: 用户删除前端“生成中/待同步”的结果卡后，刷新或 `/api/jobs` 轮询又把同一个后端任务完成结果恢复出来；表现为任务卡脏读、前端任务消失/复活、后端 API 仍正常完成但前端状态不稳定。
- Environment: local development / cloud production frontend shell
- Root cause: 删除结果卡时只记录了前端临时 `resultId`，没有把 `backendJobId` / provider task id 一起写入 tombstone；后端任务完成后可能以不同的 provider result id 合并回项目，绕过了只按 result id 的删除过滤。
- Fix: 结果删除时从当前 project/result 收集 backend/provider job ids 并传给 `persistDeletionToSharedState`；持久化 app state、runtime snapshot 和 shell hydration 都按 backend/provider job id 过滤项目/结果/任务。
- Regression check: `node --test src/utils/persistedDeletion.test.mjs src/utils/shellRuntimePrune.test.mjs src/adapters/shellDataAdapter.test.mjs src/shell/components/destructiveActions.test.mjs`
- Files/tests: `src/ShellMigratedApp.tsx`, `src/utils/persistedDeletion.ts`, `src/utils/shellRuntimePrune.mjs`, `src/adapters/shellDataAdapter.test.mjs`, `src/shell/components/destructiveActions.test.mjs`, `src/utils/persistedDeletion.test.mjs`, `src/utils/shellRuntimePrune.test.mjs`
- Avoid next time: 新增任务卡删除/清理入口时，删除键不能只用 UI id；必须同时记录 backend job id、provider task id 和对应 result id，并验证“后端稍后完成”不会重新水合已删除卡片。

## 2026-05-21 - Shell duplicate submit before visible feedback

- Symptom: 用户点击底部提交后短时间没有明显反馈，连续点击会创建多个生成任务卡片；已在白底精修/产品精修入口复现，同类问题会影响所有未纳入提交锁的底部生成入口。
- Environment: local development / cloud production frontend shell
- Root cause: 新版底部提交锁只覆盖 `video:generation`，白底精修等生成入口在素材上传和 job 创建前没有同步 ref 锁；后端 job 去重只能复用已创建的 active job，挡不住前端先创建多个独立项目占位。
- Fix: `shouldGuardGenerationSubmit` 覆盖所有可运行底部生成模块：`one_click`、`translation`、`buyer_show`、`retouch`、`video`、`xhs_cover`；`handleGenerate` 使用同步 ref 短锁保护“点击到任务卡/后端 job 创建确认”这段临界区，收到 `onJobCreated` 或已创建可见任务后立即释放提交按钮，不能用活跃任务状态把整个生成周期串行锁死。
- Regression check: `node --test src/shell/components/destructiveActions.test.mjs src/components/uiArchitecture.test.mjs`
- Files/tests: `src/ShellMigratedApp.tsx`, `src/shell/components/destructiveActions.test.mjs`, `src/components/uiArchitecture.test.mjs`
- Avoid next time: 新增任务入口时先确认“点击到可见项目卡片出现前”的同步锁，不要只依赖 React 状态、按钮 disabled 或后端 job dedupe。

### Cloud, local, and GitHub are different sources of truth

- Symptom: A change appears fixed locally or exists on GitHub, but cloud behavior is unchanged.
- Root cause: GitHub is version storage, not the running application. Local dev is for verification, not proof of cloud deployment.
- Avoid next time: State the target environment at the start of the task. For production issues, check Tencent Cloud state and deployment docs before claiming completion.

### Prompt changes must preserve parsing anchors

- Symptom: A prompt improvement breaks downstream parsing, output fields, or historical constraints.
- Root cause: Prompt text changed without preserving RTCFE structure, required fields, or parser assumptions.
- Avoid next time: Read `docs/prompt-rtcfe-migration-map.md` before prompt edits. Preserve existing output fields and add regression tests around parsing-sensitive behavior.

### One-click modules are related but not interchangeable

- Symptom: Fixing first image behavior changes main image, detail page, or SKU behavior unexpectedly.
- Root cause: Shared utilities or prompts were edited without checking each workflow's separate constraints.
- Avoid next time: Name the target workflow explicitly. Run focused tests for the touched workflow and smoke tests for neighboring one-click workflows.

### Model-readable image URLs must stay plain public URLs

- Symptom: KIE image tasks fail with `File type not supported`, or generated tasks receive strings like `[https://...jpg](https://...jpg)` instead of plain URLs.
- Root cause: Public image URLs can pass through model text, Markdown rendering, history messages, and retry flows; checking only upload/display code misses these second-hop paths.
- Avoid next time: Before provider submission, always normalize media references back to plain model-readable URLs. Tests must cover historical attachments, model-produced `inputImageUrls`, and final `image_input`/`input_urls` payloads.

### Restarted cloud jobs are not final failures

- Symptom: Refresh/crash/restart leaves one-click cards marked failed or disappearing even though KIE may still be processing the provider task.
- Root cause: Cloud MySQL job reconciliation marked `running` jobs as `failed/service_restarted`, and the shell UI treated recoverable KIE timeout/restart responses as final failed history.
- Avoid next time: Reconcile restarted jobs back to `retry_waiting` when a provider task may still be recoverable. In the frontend, any KIE result with a recoverable task id should remain `generating`/pending sync until the backend explicitly returns a terminal failure.

### Long-running planning jobs must persist their project card immediately

- Symptom: A one-click planning task is visible as running in `internal_jobs`, but after browser crash/refresh the project card is gone.
- Root cause: The shell created the planning project only in React state and waited until planning success/failure to write `/api/state`; if Chrome crashed while `kie_chat` was running, the backend job survived but the project card had no stable shared-state record. Completed planning jobs are text-only, so they were also dropped by job hydration when no image URL existed.
- Avoid next time: Persist the planning project as soon as it is created, then persist again when the backend `jobId` is known. Running jobs can hydrate as fallback cards from `/api/jobs`; completed one-click `kie_chat` jobs may parse their text result back into selectable plans only when they match an existing persisted project placeholder. Never synthesize unpersisted completed planning jobs from `/api/jobs`, even if they are the newest one, or refresh will resurrect old策划 as ghost "处理中" cards. When a user deletes a job-backed card, persist the deleted backend `jobId` as a tombstone so `/api/jobs` history cannot rehydrate it on the next refresh.
- Every one-click planning `kie_chat` job must carry its shell project binding in the job payload (`shellPlanningPurpose`, `shellProjectId`, `subFeature`). This covers the crash window where the project placeholder has been saved but the later `backendJobId` write has not completed; hydration can reconnect by `shellProjectId` instead of creating an orphan job card.
- Terminal failed one-click jobs with no result URL must not be synthesized from `/api/jobs` unless they match an existing persisted project placeholder. Historical failed image jobs are logs, not project cards; otherwise refreshing can repopulate the workspace with old "图片结果待同步" failure cards.
- Refresh hydration should never open a project detail/plan modal by itself. Planning cards can show "打开确认生图", but `ProjectCard` must not auto-run `setDetailOpen(true)` just because restored data has `plans`; otherwise the latest recovered planning job becomes a random popup on page load.
- Deletion must be a real remote prune, not a draft-only write. `persistDeletionToSharedState` has to save the pruned state with replace semantics and keep `deletedProjectIds` / `deletedResultIds` / `deletedJobIds`; draft autosave must preserve those tombstones. Server-side state merge should apply tombstones before merging arrays, or old `shellProjects` / one-click branch projects will reappear after refresh.

### Shared state must not store recursive project history or inline images

- Symptom: `/api/state` grows into multi-MB or tens-of-MB payloads, making refresh slow and increasing Chrome out-of-memory risk.
- Root cause: One-click branch objects were copied into individual project records, nesting `projects` inside each project; translation history also stored `data:image/...base64` source previews.
- Avoid next time: Compact shared state before storage and client return. One-click saved projects must exclude branch-level `projects`, `activeProjectId`, and runtime flags; translation files must store remote URLs or lightweight metadata, not inline base64 previews.

### Browser-local recovery caches need size guards

- Symptom: A cloud account has a small `/api/state`, but Chrome can still show `Out Of Memory` while loading or running a long task.
- Root cause: The shell reads account-scoped `localStorage` runtime/draft snapshots synchronously before cloud hydration. If an older build left oversized or corrupted browser-local recovery data, the cloud database can look clean while the user's current browser still crashes.
- Avoid next time: Put byte limits in front of every browser-local recovery parse, discard oversized local snapshots, and log startup diagnostics with localStorage key sizes and JS heap figures so the next cloud investigation has evidence instead of guesses. Browser OOM cannot be logged at the exact crash moment; keep a local session heartbeat and report `frontend_previous_session_interrupted` on the next successful load when the previous session was not cleanly closed.

### Model submission must wait for uploaded material URLs

- Symptom: After uploading a material, generation immediately says the material has no model-readable public URL.
- Root cause: The shell optimistically adds a local `blob:` preview first and uploads the public URL in the background. Some generation paths submitted before the background upload had filled `remoteUrl`, or reused stored generation context that still contained only local draft material data.
- Avoid next time: Every generation entry point must run uploaded-material normalization immediately before provider submission. If a material only has `localAssetId`, load the draft blob from IndexedDB and upload it first; only pass remote/public URLs into `shellWorkflow` and model services.

### Managed asset cleanup must not remove valid uploaded materials

- Symptom: 新任务的 `imageUrls` / `input_urls` 为空，模型没有收到用户上传的商品素材，出图与上传产品无关。
- Root cause: Provider boundary cleanup was added to prevent deleted managed assets from reaching models, but the asset file existence check called `resolveStoredAssetPath(asset.storageKey)` while `resolveStoredAssetPath` expects the full asset object. Valid stored files were therefore treated as missing and scrubbed out of job payloads.
- Avoid next time: Any stale-asset scrubber must test both sides: deleted or missing assets are removed, and existing uploaded assets are preserved through the final provider payload. Path helpers should be called with their actual domain object, not a derived key string unless the helper contract says so.

### Draft input persistence must not revive old product materials

- Symptom: 输入框刷新后像是没有持久化，或 SKU/主图重新上传新商品后仍引用旧商品图，导致新任务生成旧产品。
- Root cause: Draft state merge treated `inputStateByScope` and `materials` too coarsely. A newer empty draft could wipe local non-empty input, while material merging could keep an old `product` item beside the new upload.
- Avoid next time: Draft input must merge per scope and an empty prompt must not overwrite an existing non-empty prompt. Draft materials must be authoritative per type: when the incoming draft contains `product`, that list replaces the old `product` list, including explicit empty lists for clearing. Tests must cover prompt persistence and old-product non-revival together.

### Persisted task cards must reconcile completed backend jobs by stable media identity

- Symptom: 出海翻译前端卡片长期显示“任务处理中”，但 `internal_jobs` 中对应 KIE image job 已经 `succeeded`，或旧 error 卡片仍压住成功结果。
- Root cause: Translation file persistence and server app-state merge only keyed records by local file `id`. If a refresh, retry, or historical write produced a new local id for the same source image, the completed backend result could not replace the old `processing` / `error` file.
- Avoid next time: Persisted task cards in every module must merge by stable identities, not only local UI ids. Use backend job id, provider task id, source/result URL, and module-specific source identity such as project+file name. Completed files with media must clear stale error/message fields and win over processing/error placeholders. Empty pending files without source URL and backend task id are not executable and must not keep runtime flags such as `isProcessing=true` / `isGenerating=true`.

### Cloud deployment requires code review every time

- Symptom: A fix reaches cloud without a fresh review of diff, data isolation, URL handling, logs/statistics, permissions, or task-chain impact.
- Root cause: Deployment was treated as a mechanical copy step instead of a guarded production release.
- Avoid next time: Do not deploy unless code review is complete. Use the deploy script only with `MEIAO_CODE_REVIEW_CONFIRMED=1`; the script intentionally blocks unconfirmed cloud releases.

### Responses tool output must carry its matching function_call item

- Symptom: 智能体生图时上游已经收到需求并完成出图，但前端 assistant 消息失败，显示 `responses 请求失败 (400): function_call_output requires item_reference ids matching each call_id...`。
- Root cause: V2 工具循环在第一次模型返回 `function_call` 后只把 `function_call_output` 追加进第二次 Responses HTTP 请求，没有把对应的原始 `function_call` item 一起带回。HTTP 无状态 Responses 调用无法像 WebSocket continuation 那样只靠 previous response 继续，因此 provider 拒绝最终总结请求。KIE 出图链路本身已经成功。
- Fix: `parseResponsesOutput` 保留每个 Responses `function_call` 的原始 item；`runAgentConversationV2` 在追加 `function_call_output` 前先追加匹配的 `function_call` item，缺少原始 item 时用 tool call 参数构造兜底 item。
- Regression check: `node --test server/openaiResponsesProvider.test.mjs server/agentToolConversation.test.mjs server/providerGateway.test.mjs server/agentCenterSource.test.mjs`; `npm run lint`; `npm run build`。
- Avoid next time: 看到“上游已出图但对话失败”时，先按阶段切分：模型 tool call、KIE 出图、工具结果回填、最终总结。Responses HTTP 的工具回填测试必须断言 `function_call` 和 `function_call_output` 成对且 `call_id` 一致，不能只断言工具执行成功。

### Agent image result rendering must use result metadata, not only request mode

- Symptom: 智能体通过普通聊天触发 `generate_image` 后，图片实际生成成功，但 assistant 回复只把结果图渲染成 9x9 小附件缩略图和 `图1` 标签，没有展示“已生成图片 / 点击查看大图 / 下载 / 结果总结”的生图结果卡。
- Root cause: 前端 `ChatConversationPane` 只用 `metadata.requestMode === 'image_generation'` 判断是否渲染生图结果卡；工具调用路径的原始请求仍是 `chat`，但成功后带有 `metadata.imageResultUrls`、`metadata.imagePlan` 和 assistant 图片附件。
- Fix: 增加 `hasAssistantImageResults`，只要 assistant 消息带 `imageResultUrls`、`imagePlan` 或图片结果附件，就按生图结果卡渲染；图库收集也继续复用同一判定。
- Regression check: `node --experimental-strip-types --test src/modules/AgentCenter/chatConversationRendering.test.mjs src/shell/modules/AgentCenter/ChatConversationPane.test.mjs`; `npm run lint`; `npm run build`。
- Avoid next time: 对话模式和结果形态要分开判断。`requestMode` 表示用户发起方式，`imageResultUrls/imagePlan/assistant image attachments` 才是结果展示形态；工具调用能从普通 chat 产出生图结果。

### Agent edit wizard must submit the draft version it opened

- Symptom: 智能体工厂进入“编辑草稿/检查并提交”后保存或发布修改时，前端提示 `版本不存在、已发布或无权限。`。
- Root cause: 详情页可能当前选中已发布版本 V2，同时系统已有未发布草稿 V1。编辑入口会加载草稿 V1 的内容，但提交保存仍使用 `selectedVersion.id`，把 PATCH 发给已发布 V2；后端禁止修改已发布版本，因此返回该错误。
- Fix: `AgentCenterManager` 进入编辑向导时记录 `editingVersionId`，提交时按这个 ID 找到实际正在编辑的草稿版本，并用该版本的策略字段更新草稿；保存后再清理编辑指针。
- Regression check: `node --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs --test-name-pattern "agent edit wizard submits"`。
- Avoid next time: 编辑流不要复用“详情页当前查看版本”作为写入目标。打开编辑器时必须固化本次编辑对象 ID；涉及发布版/草稿版并存的 UI，都要分别维护“查看版本”和“编辑版本”。

### Agent chat must preserve optimistic messages during slow refreshes

- Symptom: 云上智能体聊天点击发送后，对话区没有立即显示用户消息和“思考中/需求分析中”，要等模型结果返回后才出现；本地快时不明显。
- Root cause: 前端已经插入本地 optimistic user/assistant pending 消息，但同时存在 `selectedSessionId` 触发的 `fetchChatMessages`。云上慢请求下，旧的消息加载结果可能在发送后返回，并用不含本地 pending 的远端消息列表覆盖当前对话，直到发送接口最终返回真实消息才恢复显示。
- Fix: 会话消息刷新不再直接覆盖当前列表，而是用 `mergePendingLocalMessages` 保留当前 session 下尚未被远端同 `clientRequestId` 接管的本地 pending 消息；pending 轮询也使用同一合并逻辑。
- Regression check: `node --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs --test-name-pattern "pending messages"`。
- Avoid next time: 任何远端刷新都不能无条件覆盖本地 in-flight UI 状态。带 `clientRequestId` 的 optimistic 消息必须保留到远端返回同 ID 的 pending/final 消息，或请求明确失败。

### Agent factory validation must stay on the draft version

- Symptom: 智能体工厂里选择中转模型并执行验证后，验证结果卡仍显示 `gemini-3-flash-openai` 等旧模型，而不是当前草稿选择的中转模型。
- Root cause: 验证前后有两层版本错位：`handleValidate` 使用详情页 `selectedVersion`，而 `loadAgents` 刷新后总是把 `validationResult` 设为 `detail.versions[0]` 的摘要。即使后端验证了草稿，刷新也可能立刻把展示覆盖成已发布版本或最新版本的旧验证摘要。
- Fix: `loadAgents` 支持传入 `preferredVersionId` 并按该版本设置 `selectedVersionId` 和 `validationResult`；验证时固定使用 `draftVersion || selectedVersion`，并在刷新后保留目标草稿版本。
- Regression check: `node --test src/shell/modules/AgentCenter/AgentCenterModule.test.mjs --test-name-pattern "agent factory validation"`。
- Avoid next time: 发布版和草稿版并存时，验证/保存/发布后的刷新必须显式传递目标版本 ID。不要用 `versions[0]` 推导当前验证摘要。

### KIE asset upload failures must not trigger model fallback

- Symptom: 天琪账号 `6月24日项目1` 详情页策划显示 `Kie 素材上传超时`，用户误以为 KIE 图床整体传不上图片。
- Root cause: 云上 `internal_jobs/internal_job_events` 显示任务 `314b56717acef4bcf5a6c85e` 的 `provider_task_id=null`、`provider_submitted=0`、`stage=asset_upload`，说明还没进入 KIE 详情策划/生成。`kie_chat` 主模型上传 7 张托管素材超时后，fallback 模型又重新上传同一批素材，导致一次传输问题被放大成两轮上传等待。
- Fix: `providerGateway` 对 `asset_upload` / `asset_download` 阶段错误禁止模型 fallback；`kie_chat` fallback 链路共享 `mediaUrlCache`，主模型已上传成功的托管素材 URL 会被 fallback 复用。
- Regression check: `node --test server/providerGateway.test.mjs server/providerAssetTransfer.test.mjs server/jobRuntime.test.mjs server/temporalWorker.test.mjs`。
- Avoid next time: 先按 `provider_task_id` 和 `provider_submitted` 分阶段。`provider_task_id=null + provider_submitted=0` 是提交前传输/准备阶段，不是 KIE 已接单失败；模型 fallback 不能用于素材下载/上传错误，且 fallback 链路必须共享前置素材转存缓存。

### KIE chat providerless stale windows must be longer than image task submit windows

- Symptom: 天琪账号同一详情页 job `cdeaca8888a946f1223da046` 修复素材上传 fallback 后真实重试，5 分多钟后变成 `provider_submit_stale`。
- Root cause: 云上 `MEIAO_PROVIDERLESS_RUNNING_STALE_MS` 约 5 分钟，适合回收图片/视频异步任务在 createTask 前卡死的情况；但 `kie_chat` 是同步 Responses 文本策划，7 张素材转存和模型响应期间通常没有 providerTaskId，只有成功返回后才写 `resp_*`。通用 5 分钟窗口会把仍在执行的同步策划误判为卡死。
- Fix: `jobManager` 对 `kie_chat` providerless running job 使用不少于默认 15 分钟的 stale 窗口；其他任务仍按云上短窗口回收。
- Regression check: `node --test server/jobManager.test.mjs --test-name-pattern "kie chat submit"`；正式云上同 job 重试成功，`providerTaskId=resp_0a056c56c2160b09016a3b711f3fa8819b9d00fd746de4b13a`，返回 7 个 `[SCHEME_START]`。
- Avoid next time: providerless stale 要按任务语义分层。同步 chat/策划类任务不能套用异步生图/视频的 createTask 前短窗口；真实验收必须覆盖正式 job/Temporal 链路，而不只看 providerGateway 直连。

### KIE detail image batches must throttle and retry asset staging

- Symptom: 天琪账号 `6月24日项目4` 详情策划成功后，详情页批量生图失败；单张烟测 `gpt-image-2` 可成功，但 UI 实测 7 张详情图同时失败。
- Root cause: UI 一次性创建 7 个 `kie_image` 详情图任务，每个任务带 7 张素材，瞬间形成约 49 次 KIE 图床素材上传。失败事件集中在 `asset_upload` 的 `provider_network_error/fetch failed` 和 `provider_internal_error`；另有任务因 5 分钟内无 providerTaskId 被 `provider_submit_stale` 回收。问题发生在提交 KIE 生图前的素材转存阶段，不是 KIE 已接单后出图失败。
- Fix: `providerKieImage` 对单任务内素材解析/上传限流，默认 2 并发并支持 `MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY` 配置；`jobRuntime` 允许 `asset_upload` 瞬时错误进行一次任务级重试；`jobManager` 对 `kie_image` providerless running job 使用不少于默认 15 分钟的 stale 窗口。
- Regression check: `node --test server/jobManager.test.mjs server/jobRuntime.test.mjs server/providerKieImage.test.mjs`；`node --test --test-name-pattern "kie image|asset upload|managed asset|file-stream-upload" server/providerGateway.test.mjs`。
- Avoid next time: 详情/批量生图必须用“任务数 × 每任务素材数”评估第三方图床压力。单张真实出图成功不等于批量链路成功；排障先看 `provider_task_id`、`provider_submitted` 和 event stage，`asset_upload` 是提交前传输问题，不能归因成已提交的 KIE 生图失败。

### Agent vision planning must not pre-upload historical images

- Symptom: 将离账号最新 3 图需求仍只产出 1 张；修复多图覆盖校验后，云上 dry-run 又在进入模型规划前出现 KIE 素材上传超时。
- Root cause: `runAgentConversationV2` 会在首轮 Responses 规划前把 `priorMessages` 中的历史附件、历史生成图和历史 `imagePlan.inputImageUrls` 也走 `prepareModelImageUrl` 批量转存。历史图不是本轮 inline 视觉输入，却会占用本轮规划前的上传链路，并可能污染模型对本轮 3 张新图的覆盖判断。
- Fix: 首轮规划只预转存本轮 `attachments`，并把这些 HTTPS URL inline 给模型；历史消息只进入图片目录文本，不再批量上传。真正引用历史图执行 `generate_image` 时，再由 providerGateway 在提交阶段转存。
- Regression check: `node --test server/agentToolConversation.test.mjs --test-name-pattern "首轮规划只预转存"`；`node --test server/agentToolConversation.test.mjs server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs server/openaiResponsesProvider.test.mjs server/agentCenterSource.test.mjs`。
- Avoid next time: 首轮模型视觉分析的关键路径只允许包含本轮新上传图。历史图可以给模型做文本目录参考，但不能每次请求都先上传到第三方图床；否则会把传输失败伪装成模型/语义失败。

### Agent image results need source/result validation before completion

- Symptom: 将离账号 3 图白底任务返回了 3 张 completed 图片，但黑色加湿器缺失，结果里出现重复瓶类产品；用户看到的是“数量正确但图对不上”。
- Root cause: #22/#24 修复了多图规划覆盖和 KIE 图床 URL 稳定性，但落库前仍只验证输出数量、provider task id 和 URL 列表，不验证每张生成结果是否对应当前源图和语义要求。模型/KIE 可能生成主体错误的图片，原逻辑仍会写 `image_result_ready` 并标记 completed。
- Fix: `runAgentConversationV2` 在每个 `generate_image` 结果写 checkpoint 前调用 `validateImageResult`；服务端 `validateAgentGeneratedImageResult` 用同一中转 Responses 模型看源图和生成结果，返回 JSON 质检结论。失败时自动带质检反馈重试一次，仍失败则保留最后一次生成图并在 `imagePlan.validation` 标记 `acceptedWithWarning`，提醒人工复核，不再自动吞掉用户满意的可见结果。
- Regression check: `node --test server/agentToolConversation.test.mjs --test-name-pattern "生图结果质检"`；`node --test server/agentToolConversation.test.mjs server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs server/openaiResponsesProvider.test.mjs server/agentCenterSource.test.mjs server/agentImagePlan.test.mjs`；`npm run build`；`npm run lint`。
- Avoid next time: 智能体多图验收不能只数图片数量；自动质检也不能替代用户最终判断。只要是源图编辑/逐张处理，落库前必须逐张验证主体一致性和用户要求满足度；质检失败应优先重试和标风险，已有可见主产物时不要一票否决。质检请求也必须走 managed asset scrubbed provider 边界，不新增 base64 或未配置模型 fallback。

## 2026-06-12 - First-image planning recovery must aggregate sibling reference jobs

- Symptom: 天琪账号首图功能上传 5 张风格参考图后，后台实际创建并完成了 5 个 `kie_chat` 策划 job，但前端项目卡只显示 1 个策划，用户无法发现少了 4 个。
- Environment: Tencent Cloud production, one-click first-image planning, page refresh/reconnect while planning jobs were still finishing.
- Root cause: 在线提交链路已按 5 张参考图发起 5 个策划任务；问题出在刷新后的 `shellDataAdapter` 恢复逻辑。持久化项目里已经有 1 个 recovered plan 时，后续同 `shellProjectId` 的兄弟 planning jobs 被逐条处理并短路，没有先按 `shellReferenceIndex` 聚合，最终只保留单个 plan。
- Fix: `shellDataAdapter` 现在会按 `shellProjectId` 聚合已完成的 one-click planning `kie_chat` jobs，按 `shellReferenceIndex`/创建时间排序，把所有解析出的 plans 一次性恢复到同一项目；最终项目合并时也按恢复模板保留参考图顺序。
- Regression check: `node --test src/adapters/shellDataAdapter.test.mjs --test-name-pattern "first-image planning|planning reference|completed planning jobs by payload project id"`; `npm run build`.
- Avoid next time: 多参考图策划的状态恢复不能以单个 backend job 为单位判断完整性。凡是同一个 `shellProjectId` 下存在多个 planning jobs，都必须按参考图序号聚合后再计算 `taskCount/plans/planningTaskId`，并且回归测试要覆盖“持久化已有 1 个 plan、后台实际有 N 个成功 plan”的刷新形态。

## 2026-06-23 - Completed backend media must replace timeout placeholders

- Symptom: 天琪账号首图生成页面显示“生成失败 / 任务等待超时，请稍后在任务列表中查看结果”，但云上 `internal_jobs` 中同一批 `kie_image` 后台任务稍后全部 `succeeded` 且有 `imageUrl`。
- Environment: Tencent Cloud production, one-click first-image image generation, backend queue slower than frontend polling window.
- Root cause: 前端等待后台任务超时后写入同 `backendJobId/providerTaskId` 的无图 `status:'error'` 占位；刷新水合 terminal image job 时，`hasPersistedTerminalJobResult` 把这个无图 error 当成“已有终态结果”，导致成功的 backend media job 被提前跳过，旧失败卡片无法被后台结果覆盖。
- Fix: `hasPersistedTerminalJobResult` 增加 `incomingHasMedia` 参数；当 incoming job 已有图片/视频 URL 时，只有已持久化的媒体结果才算重复，旧无图 error/generating 占位必须允许被成功结果替换。`shellDataAdapter` 对 completed image job 传入该标记，并补首图超时占位恢复回归测试。
- Regression check: `node --experimental-strip-types --test src/adapters/shellTerminalJobMerge.test.mjs src/adapters/shellDataAdapter.test.mjs`; `node --test server/appStateMerge.test.mjs`; `npm run build`.
- Avoid next time: 任务卡恢复逻辑不能把“前端没等到结果”当成“最终失败”。凡 backend job 后续拿到 image/video URL，必须能用 job/provider/plan 身份覆盖同一范围内的无媒体失败或等待占位；真正要防重复时，以已存在媒体结果为准。

## 2026-05-26 - Completed planning jobs must recover stale planning-failure cards

- Symptom: 多桑账号 2026-05-26 的“项目3/项目4”后台 `kie_chat` 策划 job 均已 `succeeded` 且 `result_json.content` 包含 `[SCHEME_START]... [SCHEME_END]`，但前端项目卡显示“共 1 张参考图，其中 1 张策划失败。”
- Environment: Tencent Cloud production, one-click first-image planning.
- Root cause: `waitForInternalJob` 轮询链路的瞬时查询失败被 `generateFirstImageReplicationSchemes` 包装成单参考图策划失败，丢掉了 backend job 已成功的信息；随后 shell hydration 又因为项目已有 error result 占位，拒绝用成功的 text-only `kie_chat` job 恢复 plans。
- Browser overwrite: 旧浏览器本地 `AIGC_APP_STATE` 可能在刷新后再次 PUT 回 stale error card，直接手工修库会被旧本地状态覆盖。
- Fix: `requestAnalysisResponseDetailed` 在非中断错误后用 `fetchInternalJob(job.id)` 做最终恢复查询；若 backend job 已成功，直接返回 content/credits/taskId，若仍在 running/queued/retry_waiting，则抛 `job_timeout` 让项目保持可同步状态。`shellDataAdapter` 允许成功的 planning job 替换无 backend 身份、无媒体 URL 的 stale 策划失败占位，并清空该占位 results。`mergeAppStateForStorage` 也必须保护“已有 plans 的 planning 项目”不被同 backendJobId 的旧策划失败占位覆盖。
- Regression check: `node --test server/appStateMerge.test.mjs src/services/arkService.test.mjs src/adapters/shellDataAdapter.test.mjs src/adapters/shellPersistence.test.mjs src/adapters/shellRuntimeMerge.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/components/uiArchitecture.test.mjs`
- Data repair: 已备份并修复多桑账号项目3/4，备份文件 `/www/backup/meiao-state-repair/duosang-planning-2026-05-26T03-01-57-986Z.json`。
- Follow-up repair: 旧浏览器覆盖后再次备份并修复，备份文件 `/www/backup/meiao-state-repair/duosang-planning-second-2026-05-26T03-09-26-281Z.json`。
- Avoid next time: 对 text-only planning job，前端轮询失败只能代表“同步失败”，不能代表“策划失败”。任何成功的 backend planning job 都必须能按 `shellProjectId`/`backendJobId` 回填 plans，即使前端此前已写入 stale error placeholder；服务端状态合并层也要防止旧浏览器本地快照反向覆盖云端恢复结果。

## 2026-05-26 - SKU planning backfill must survive replace-mode state writes

- Symptom: 多桑账号“5月26日项目6”SKU 策划后台 `kie_chat` 已输出 2 条 `[SCHEME_START]`，但前端生成后只显示 1 张图，项目计数为 `1/1`。
- Environment: Tencent Cloud production, one-click SKU planning + image generation.
- Root cause: 第一张 SKU 出图成功后，项目已有 completed result，前端 hydration 早退，不再用成功的 text-only planning job 回填缺失的第 2 条 plan；同时 `/api/state` 的 `mode: replace` 写入会绕过服务端深度合并，把云端已修复的 `plans: 2` 又覆盖回旧的 `plans: 0/taskCount: 1`。
- Fix: `shellDataAdapter` 对已存在部分出图结果的 completed `kie_chat` job 继续解析并回填全部 plans，所有解析出的 SKU plans 默认 selected；项目状态根据“是否还有 selected plan 没有 terminal result”回到 planning。`server/index.mjs` 不再让 replace-mode 直接覆盖 `/api/state`，统一走 `mergeAppStateForStorage`；`mergeArrayByStableKeys` 对重复 scheme/result 保留 incoming 的同时补齐 existing 的 `planId` 等身份字段。
- Regression check: `node --test server/appStateMerge.test.mjs src/adapters/shellDataAdapter.test.mjs src/services/arkService.test.mjs src/adapters/shellPersistence.test.mjs src/adapters/shellRuntimeMerge.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/components/uiArchitecture.test.mjs`; `npm run build`.
- Data repair: 已备份并修复多桑项目6，最终备份文件 `/www/backup/meiao-state-repair/duosang-sku-project6-2026-05-26T04-01-25-682Z.json`；恢复后 shell 项目为 `taskCount: 2/completedCount: 1/planCount: 2`，SKU 分支为 2 条 scheme：第 1 条 completed、第 2 条 planning。
- Avoid next time: 不能用“已有一个 completed result”判断 planning job 不需要回填；SKU/批量策划的 text job 是任务总数来源。所有全量保存路径即使叫 replace，也必须保护云端已恢复的 backend-bound plans/results，删除应依赖 tombstone，而不是直接信任旧浏览器快照。

## 2026-06-24 - Storyboard planning must reject provider file-info text and parse fallback output robustly

- Symptom: 董丹丹账号“爆款复刻方案 4”分镜生成先后出现 `provider_submit_stale`、`Kie 素材上传超时`，修复后又被后台标记 `succeeded`，但内容只有 `Failed to get the file information` 或前置英文思考文本，前端项目仍停在 failed。
- Environment: Tencent Cloud production, video storyboard `viral_split`, KIE chat `gemini-3.1-pro-openai` with 7 product images and one 23.9MB reference video.
- Root cause: 这是三层问题叠加：PM2 800M 内存阈值会在大视频转存时杀 worker；45s KIE asset upload timeout 对 23.9MB 视频偏短；KIE/Gemini 把文件读取失败作为 200 文本返回，`providerGateway` 未识别为失败，分镜任务也没有 fallback；fallback 成功后 `extractJsonArray` 的贪婪正则又会从模型思考文本里的第一个 `[` 开始截取，导致 JSON 解析失败。
- Fix: 云端 PM2 `max_memory_restart` 调到 1500M，`MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS` 调到 120000；`providerGateway` 将 `Failed to get the file information` 识别为 `provider_bad_response` 以触发 fallback；分镜脚本任务写入 `fallbackModels`；`extractJsonArray` 改为括号平衡扫描并验证 `JSON.parse(candidate)`；已清洗董丹丹 job `f1b73dd01c10b650133f1d74` 的结果并回填项目 `video_1782278558653_0_g6ra` 为 `awaiting_image_confirmation`，2 个 boards / 11 个 shots。
- Regression check: `node --test server/providerGateway.test.mjs --test-name-pattern "provider file information|fallback models"`；`node --test src/services/videoStoryboardService.test.mjs`；`node --test server/jobManager.test.mjs --test-name-pattern "providerless|kie chat"`；`npm run build`；云端同组测试和 health check 通过。
- Avoid next time: KIE chat 200 文本不能天然视为成功；凡是 provider 文件读取/维护/拒答文本，都必须进入 provider 错误归类和 fallback/失败路径。模型 fallback 输出可能夹带 reasoning 或说明文本，JSON 提取必须找“可解析的数组”，不能用贪婪首尾括号。手工修复后台 job 后，还要检查 `app_states` 是否绑定项目，否则用户页面不会自动显示结果。
