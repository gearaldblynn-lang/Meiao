# Hermes 记忆框架 · 第2层(梅奥 MEIAO 主程序 / 当前版本)

> 继承第0层(`程序开发/`)+ 第1层(`电商视觉一键化/`)的全部纪律与铁律。
> 本项目是**线上生产系统**(Vite+TS 前端 `src/` + Node `server/`,部署到"妙木山"云、服务真实商家账号)。
> 已有 git(`main`,有 GitHub 远端)、server 端 101 个测试、build/lint/security:audit/doctor/acceptance 脚本。

## 1. 架构速览

- 前端 `src/`:Shell 架构(`ShellMigratedApp.tsx` 是主壳),按模块分(OneClick 一键主详、Translation 翻译、Video、BuyerShow 买家秀、XhsCover 小红书封面等)。
- 后端 `server/`:`index.mjs` 主入口,`providerGateway.mjs` 对接上游(KIE 图像 / 翻译 / agent),`jobRuntime.mjs` 任务运行时,`appStateMerge.mjs` 状态对账。
- 任务状态**同时存在前端持久化(`src/adapters/shellPersistence.ts`)和后端 `app_states`**,靠 `/api/state` 双向 merge 同步。

## 2. 本项目特有约定

- 改任何"任务卡片状态/对账"相关代码前,**先读本文件第 3 节根因库**——这一块是历史复发重灾区(165 次提交里 114 次是 fix:,churn 最高的全是状态文件)。
- 改高风险区域前先跑 Hermes Harness,让 Claude Code / Codex 共用同一套门禁提示:
  `cd /Users/feiyanglin/程序开发/hermes-harness && npm run check`
  已知改动文件时用:
  `node scripts/hermes-harness.mjs --changed server/index.mjs --changed src/adapters/shellDataAdapter.ts`
- 动手重构前确认 git 工作树干净、可回滚;改完跑 `npm run lint` + 相关 `node --test server/*.test.mjs`。
- **跑测试的命令**(本项目没装 tsx):
  - 后端 `.mjs` 测试 → `node --test server/xxx.test.mjs`
  - 前端 `.test.mjs`(会 `import './xxx.ts'`)→ 必须加 `node --experimental-strip-types --test src/.../xxx.test.mjs`,否则 Node 报 `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`(文档里写的 `node --test` 漏了这个 flag)。
  - 全量:`find src -name "*.test.mjs" | xargs node --experimental-strip-types --test` / `find server -name "*.test.mjs" | xargs node --test`。

## 3. 已诊断根因库 ★(2026-06-12 全栈只读诊断,均已读码确认,**暂未修复**)

> 🔗 本节是 Claude 与 Codex **共享的架构根因库主源**(单一真相)。Codex 通过 `AGENTS.md` 顶部指针 + `docs/agents/repeated-issues.md` 顶部指针读到这里。沉淀架构级根因写本节;`repeated-issues.md` 只留指针或记纯操作型问题,两边不抄全文以免漂移。

> 这些是"天天修不完 bug、同样问题反复出现"的架构根因。重构顺序已定:**先 #5 止血 → 再 #1/#2/#3 治本 → #4 中期**。当前进度:#5 ✅ / #1 ✅ / #3 ✅,**剩 #2(正则猜状态)和 #4(数据模型重构)**。
> 修完任意一条后,把该条改成"已修",补上`修复:(文件:行)`+ 把"如何避免"固化成测试。

- **#1 🔴 主病灶 · 任务状态靠"现算",前后端两套算法已漂移**
  根因:`status`(completed/generating/error/planning)从不被记录后直接读,而是每次 merge 时**用启发式现算**(数 media/plan/result 数量 + 正则匹配报错文字),前端 `shellPersistence.ts` 与后端 `appStateMerge.mjs` 各一套且已漂移。4 处实证不一致:
    ① 认"同一项"的 key 集不同——后端递归进 results(`appStateMerge.mjs:157-160`),前端不递归但多了 planId(`shellPersistence.ts:159-163`);
    ② 重复项覆盖规则不同——后端"已完成必胜"级联(`appStateMerge.mjs:397-405`),前端只是浅合并 `{...a,...b}`(`shellPersistence.ts:181-183`);
    ③ stale 占位定义不同——后端通用判断(`appStateMerge.mjs:351-355`),前端硬编码 `content !== '一键主详'`(`shellPersistence.ts:215`);
    ④ taskCount 公式不同(`appStateMerge.mjs:689-695` vs `shellPersistence.ts:269-276`),而两边都用 `completedCount >= taskCount ? 'completed'`。
  现象:卡片一直"处理中"、已完成结果被旧状态覆盖、每次同步翻烧饼。
  进度(2026-06-13):**结果对账 + 项目级 status/taskCount + stale 占位检测均已统一**——
    ① 结果数组对账:抽出 `src/utils/taskResultReconcile.mjs`,前后端共用,漂移①②(稳定身份去重 + 已完成必胜)消除;
    ④ 项目级状态:后端 `normalizeProjectLikeItem` 在"已完成+在跑"分支 taskCount 改为相加(原 max 会吞活跃任务、谎报完成),前后端对同一输入产出一致结论;
    ③ stale 占位:`shellPersistence` 的 sentinel 不再硬编码 `'一键主详'`,改为读 `SHELL_MODULE_LABELS[item.module]`,且从 `isOneClick` 守卫里拉出来,所有模块同款保护(retouch/translation/video/buyer_show/xhs_cover)。
   3 条前端验收 + 1 条后端验收一致性测试(`stateReconciliationConsistency.test.mjs` + `appStateMerge.test.mjs`)锁定契约,924 全过。
  如何避免:**任何"任务卡片状态/对账/stale 检测"判断只能有一份实现,前后端共用;新增模块不得再复制 merge/normalize/sentinel 逻辑。**

- **#2 ✅ 已收敛(2026-06-14)· 业务状态由"正则匹配报错文字"决定**
  根因:`isInvalidOneClickPlanText` 硬编码正则(混中文「策划失败/任务状态同步失败」与上游英文「fetch failed / I cannot fulfill this request / Unauthorized – Authentication failed」)判定方案是否失败;这套正则在 后端 `appStateMerge.mjs` / 前端 `utils/oneClickPlanValidation.ts` **两份拷贝且已漂移**(前端 15 条 / 后端 13 条,前端多 `Internal Error` 与 `server is currently being maintained` 两条)。
  现象:上游每换一种报错措辞就漏判一次,且改一份漏两份。
  修复(2a,提交 `7b65061`):两份正则合并成共享单一判据 `src/utils/planFailure.mjs` `isPlanFailed`——**结构化字段优先**(`planningFailed` / `status:'error'` / `errorCode`),正则降为同一处的最后兜底;正则取两份**并集**消除漂移。重试分类同样收敛到 `src/utils/errorClassification.mjs` `isRecoverableError`(结构化优先)。生产端经探针确认失败路径本就已结构化(失败-plan 设 `planningFailed:true`,失败-result 设 `status:'error'`+`errorCode`)。
  **刻意保留正则兜底(业主决定 2026-06-14)**:原计划 2c"彻底删正则+迁移旧库"是整件事唯一会**静默把历史失败方案翻成成功**的不可逆操作,其安全性依赖无法 100% 静态证明的"消费者必在迁移下游"前提。#2 的实际危害(两份漂移正则替程序判成败)已被 2a 根除,故**不为'看起来更干净'去赌线上数据正确性**——正则作为单一处、结构化之后的安全网长期保留。**这条正则兜底是有意 sentinel,后人勿当脏代码清理。** (未做的 2c 方案见 `docs/superpowers/specs/2026-06-14-structured-failure-status-2c-design.md`,标注为"决定不执行")
  如何避免:**业务状态判定一律结构化字段优先(`planningFailed`/`status`/`errorCode`);新增失败路径必须在源头设结构化字段,不得新增"靠正则文本决定状态"的代码;现存正则仅作单一处安全网,不再扩散、也不轻易删除。**


- **#3 ✅ 已修(2026-06-13)· `retry_waiting` 是后端真值,前端词汇表里没有**
  根因:后端 `jobRuntime.mjs:174-187` 有三态(可重试→`retry_waiting`、耗尽/不可重试→`failed`);前端 result status 联合类型只有 `completed|generating|error`(`shellPersistence.ts:26`),不认识 `retry_waiting`。
  现象:后端"重试中"被前端降级成"失败/生成中"展示→用户重复点重试→后端无响应。
  修复(`src/adapters/shellDataAdapter.ts`):`ShellTaskStatus` + `ShellGeneratedResult.status` 联合类型加上 `retry_waiting`;`taskStatusToTask` 显式返回 `retry_waiting` 不再 default 落到 generating;`resultFromItem`(L698)和"活跃任务 pending result 构造器"(L2100)按 `job.status === 'retry_waiting'` 分流;`normalizeOneClickProjectCard` / `mergeProjectSnapshot` 的 `hasGenerating` 把 retry_waiting 视为"还在跑",项目级状态保持 generating。验证:80 个 adapter 测试 + 635 frontend + 290 backend 全过 + tsc 干净。提交 6a4935b。
  如何避免:**前后端状态枚举必须同源对齐,后端新增状态时前端不得静默降级;新增 status 联合类型成员后,grep 所有 `=== 'generating'` 类硬比对站点,确认每处都正确分流。**

- **#4 🟢 已止血 + 用数据决策暂缓治本(2026-06-14)· 数据模型把"整个项目快照"塞进 app_state 一行 JSON**
  根因:`appStateMerge.mjs` 的 `compactGenerationContextForStorage/compactOneClickProjectForStorage` 在拼命剥 `projects/tasks/generationContext`——原始设计把整棵项目树嵌进单行 JSON 的化石证据。剥不净→单条 INSERT 超 MySQL 16MB / `/tmp` errno 28→`Pool is closed`→temporal stale job→PM2 重启。
  现象:数据库连接池关闭、磁盘写满、后台任务堆积。
  止血现状(已挡住急性崩溃,2026-06-13~14):① 写入大小闸 `APP_STATE_MAX_BYTES`(超闸按 updatedAt 倒序裁老项目,active 永留)；② `Pool is closed` 瞬时错重试退避(`jobRuntime.runWithTransientRetry`)；③ 压缩存储剥嵌套快照。
  **用真实数据决策(2026-06-14)**:写了只读统计脚本 `scripts/cloud-stat-state-sizes.mjs`(纯 SELECT,拒 `--apply`),在腾讯云线上跑——**41 用户,最大 3.824 MiB,平均 0.42 MiB,0 人超 4 MiB 闸(无人在丢老项目)**,仅 1 人逼近。结论:数据模型大改(分表/按需加载)**会改商家可见数据 + 迁移线上库,风险最高,而当前 0 人受影响 → 暂缓,不拿没人受影响的问题赌线上大改**。即时止血改为把闸 4→8 MiB(线上 `.env.server` 加 `APP_STATE_MAX_BYTES=8388608` + `source` 后 `pm2 restart --update-env`,已验进程环境生效),那个 3.8 MiB 用户脱离风险。`.env.server.example` 已注释该旋钮。
  如何避免:**单行状态记录里不得嵌套整棵项目树;阈值类参数 env+保守默认,先用只读统计量真实分布再决定动不动数据模型——容量问题先放宽闸缓冲,治本等数据真触发(有人在丢)再做。`pm2 restart --update-env` 不一定重读 `.env.server`,改 env 后需 `source .env.server` 再重启并从进程环境复核生效。**

- **#5 ✅ 已修(2026-06-12)· 部署后旧 chunk 404 被错当成"业务失败"**
  根因:云上发新版后,用户浏览器旧入口请求旧 hash 的 chunk(如 `shellWorkflow-CYJkx3HQ.js`)→404;前端错误边界把"前端资源加载失败"**写进了项目的"生成失败"业务状态**,污染真实数据(看板 18 指纹)。
  现象:好端端的项目被标记"生成失败"。
  修复:抽出纯函数判据 `src/utils/frontendResourceError.mjs` `isFrontendResourceError`(配行为测试 `frontendResourceError.test.mjs`);`ShellMigratedApp.tsx` 加 `bailIfFrontendResourceError`——命中即刷新页面并 `return`,在 **7 个 workflow catch 顶部 + 加载器**统一拦截,资源错永远到不了那 21 处 `status:'error'` 写入。验证:920 测试全过 + tsc + build。分支 `fix/chunk-error-boundary`。
  如何避免:**资源加载错误不得污染业务状态;两类错误必须分流处理。**(已固化为 `isFrontendResourceError` 单一判据 + 行为测试)

- **#6 ✅ 已修(2026-06-13)· `createdAt` 把展示标签当数据存,导致排序乱序**
  根因:壳层 `Project/GeneratedResult/Task.createdAt` 是 `string`,既当数据又当展示;产生侧多处 `new Date().toLocaleDateString(...).replace('/','-')` 产年缺失的 `"06-13"`,`shellDataAdapter.toDateLabel` 把后端 job 本来就有的毫秒戳主动降精度成字符串。消费侧 `shellScopeFilters.projectSortKey` 为容忍脏数据堆了 6 层启发式,其中 `parseMonthDay("06-13")` 用 `new Date()` 当前年拼戳 → 任何"id 不含 12-13 位毫秒戳 + createdAt 是年缺失字符串"的历史/导入项目被算成"今年某月某日"浮到最顶,无视真实新旧。**最小输入对比探针(`/tmp/sortprobe.mjs` 喂进真 `sortProjectsNewestFirst`)复现了乱序**——光读代码会误判为"新项目也乱",实际只影响历史项目。
  现象:项目列表里老项目被顶到最前、顺序翻烧饼。
  修复:`createdAt`/`completedAt` 全链路 `string → number`(规范毫秒戳),靠 tsc 揪出全部消费点;恢复启发式收敛到读边界单一判据 `src/utils/createdAtMs.ts` `coerceCreatedAtMs(raw,{id,updatedAt}) → {ms,precise}`;`projectSortKey` 塌成 `precise tier desc → createdAt desc → sequence desc → 原序`(年缺失值 tier=0 永不排在真实戳之前);展示抽共享 `src/utils/timeFormat.ts`(`formatMonthDay` 等价旧 `toDateLabel`,卡片仍显示 `"06-13"`;`formatTime` 合并原 3 份重复实现)。后端零改动(`appStateMerge.mjs:145` 本就 `Number()` coerce)。探针固化为 `shellScopeFilters.test.mjs` 回归测试 + `createdAtMs`/`timeFormat` 单测。验证:前端 650 + 后端 303 全过 + tsc 干净 + eslint 0 error。spec/plan 见 `docs/superpowers/{specs,plans}/2026-06-13-createdAt-*`。
  如何避免:**时间一律存数字毫秒戳,展示字符串只在渲染处由 `formatMonthDay`/`formatTime` 产出;展示标签绝不当排序/逻辑数据存。"现算/合并/排序"类改动前,先写最小输入对比探针复现,别只靠读代码推断根因。**

- **#7 ✅ 已修(2026-06-16)· `server/index.mjs` chat 请求有「MySQL 模式」「本地 JSON 模式」两套平行 handler,改一份漏一份**
  根因:`server/index.mjs` 里 `chat messages POST` 有**两个独立 handler**——`createDbChatReply`(约 4932,MySQL 模式,用 `getDbAgentVersionById`/`getMysqlPool`)和本地 JSON 模式 handler(约 9529,用 `localRequireUser`/`getLocalAgentVersionById`,自带去重和 reply 逻辑)。第2期生图工具调用(V2 tool calling)接入时,只在 `createDbChatReply` 接了 V2,**漏了本地 handler**——那里还是旧的 `requestMode==='image_generation' ? buildImageConversationResult : runAgentConversation` 二选一。本地是 `internal-v1`(JSON 模式,`/api/health` 的 `mode` 字段可查;`MEIAO_DB_HOST` 空 → `shouldUseMysql=false`),所有 chat 请求走 9529,**永远碰不到 V2**。
  现象:本地配了 `toolCallingProvider='openai_compatible'` 的智能体,生图"出图成功"是假象——走的是旧路径(`imagePlan.requestMode='image_generation'` 而非 V2 的 `'tool_calling'`;对话决策模型是 `gpt-5-2`/`gemini-3-flash` 这些 KIE 旧分析模型,而非新中转 `gpt-5.5`)。**写文件探针日志(`/tmp/meiao-v2-probe.log`)在发请求后不生成**,是"请求根本没经过 `createDbChatReply`"的铁证,直接定位到走了另一个 handler。另:第一次排查时服务进程是 14:11 启动、代码 14:59 才改完,**改完没重启,跑的还是旧代码**,误以为修了没生效——重启后才验证到 `shouldUseV2:true`。
  修复(commit 见 git log):本地 handler(`server/index.mjs` 约 9700)接上 `shouldUseToolCallingConversation(version)` 分流 → `runAgentConversationV2`,旧路径降级到 else 分支保留;`agentCenterSource.test.mjs` 快照断言从 `const result =` 改为 `result =`。**连带修了第二个 V2 自身 bug**:`runAgentConversationV2` 原来只把纯文字 `currentMessage` 发给模型,**上传图附件没作为多模态 `image_url` 附进用户消息**,模型看不到上传的图、只能靠目录 URL 文字猜,改图时被历史生成图带偏(上传真人照说"改文字成韩文"却返回历史橘猫)。修复:`agentToolConversation.mjs` 加 `buildUserMessageContent` 把上传图附进用户消息多模态 content + system 提示显式列出"本轮新上传图 URL,改图优先用它,别用历史生成图"。补回归测试 `agentToolConversation.test.mjs`(上传图进多模态 + 引导 + 无图退化纯文本)。
  如何避免:**(1) 改 `server/index.mjs` 任何 chat/agent 请求逻辑前,先 grep 确认 MySQL 模式(`createDbChatReply`/`getDbAgentVersionById`)和本地 JSON 模式(9529 handler/`getLocalAgentVersionById`)两套平行实现都要同步改;plan 验收必须显式要求"两种 mode 都有路由测试"。测试全过≠功能真通——没覆盖到的平行路径不会报错,只会静默走旧逻辑。(2) 改完后端代码先重启服务再验证,本地长跑进程跑的是改前的旧代码;"修了没生效"先查进程启动时间 vs 文件 mtime。(3) tool calling 生图链路里,用户上传/要编辑的图必须作为多模态 `image_url` 附进发给模型的消息,不能只在 system prompt 里塞 URL 文字——否则模型看不到图,改图会选错对象。**

- **#8 ✅ 已修(2026-06-17)· Portal 弹层不吃父级 shell scope 样式,二级选择不能撑高或另起重弹窗**
  根因:智能体对话 composer 的配置/上传 Popover 通过 portal 渲染,DOM 不在 `.agent-center-shell-scope` 下面;只写 `.agent-center-shell-scope .agent-composer-*` 的毛玻璃 override 看源码会"像是生效",但浏览器计算样式仍走组件自身/全局样式。另一个交互根因是模型/思考强度二级选项以内嵌 `mt-2` 列表渲染在主配置弹窗里,选项一多就把主弹窗突然拉高,视觉上像一个沉重表单而不是轻量配置层。
  现象:用户看到的配置弹窗不是系统其他页面那种半透毛玻璃;点击模型/思考时弹窗高度突变,交互显得上上下下、不稳定。
  修复:`ChatComposer.tsx` 把模型/思考二级选项改成主配置弹窗内部的 `absolute inset-0` 轻量文字 overlay,展开时主配置层 `pointer-events-none` + 降透明 + blur,主弹窗高度保持稳定;选项层去掉图标、勾选图标、滚动和重阴影,5 个思考档位用 11px 文本一次性完整显示。`AgentCenterModule.tsx` 给 portal 根弹层(`.agent-composer-config-menu/.agent-composer-upload-menu`)和 shell scope 内弹层写精确 glass override,同时把 `.agent-composer-config-popout` 拆成更轻的半透明覆盖层。浏览器实测配置/上传弹层均为 `rgba(255,255,255,0.78)` + `blur(28px) saturate(1.22)`,上传向上弹出;思考层 `scrollHeight == clientHeight`,无滚动条且完整显示「极低/低/中等/高/极高」。
  如何避免:**Radix/Popover/Dialog 这类 portal 组件,样式不能只依赖父级 scope;修弹层视觉必须用浏览器查 computed style 和 bounding box。二级菜单/选择器应在原弹窗内部轻量 overlay,不要内嵌撑高主控制面板,也不要另起一张重弹窗。**

- **#9 ✅ 已修(2026-06-17)· V2 responses 带图请求沿用 Chat Completions 多模态格式,上游反复 502**
  根因:`runAgentConversationV2` 内部为了让模型看见上传图,正确构造了 Chat Completions 风格的多模态 content(`{type:'text'}` + `{type:'image_url', image_url:{url}}`);但第4期多工具把 V2 provider 切到 `/v1/responses` 后,`server/openaiResponsesProvider.mjs` 只把 `messages` 原样改名为 `input`,没有在 provider 边界转换 content part。号池 responses 端点探针/既有 `providerGateway` 契约要求图片走 `{type:'input_image', image_url:'...'}`,文本走 `{type:'input_text'}`。所以"普通聊天模式 + 上传图 + 模型可 tool calling"会在第一轮模型请求处返回 `responses 请求失败 (502): openai_error/bad_response_status_code`,还没走到 KIE 出图。
  现象:智能体对话里上传图片后发改图需求,前端显示 `responses 请求失败 (502)`;本地 `server/data/internal-store.json` 同一 session 记录显示 `requestMode:'chat'`, `imageMode:false`, `attachmentRefs` 有图片,但 `imagePlan:null`/`imageResultCount:0`,说明失败发生在 responses 规划层而非 KIE 生图层。用户反馈"不是第一次出现"后,从 `logs/chatMessages` 里复现到同类记录。
  修复:`server/openaiResponsesProvider.mjs` 增加 responses input 归一化:只在 provider 边界把 content 数组里的 `text/input_text` 统一为 `input_text`,把 `image_url/input_image` 统一为 `input_image` + 字符串 `image_url`;`function_call` 和 `function_call_output` 原样保留,不破坏 HTTP 二次工具回传。`server/openaiResponsesProvider.test.mjs` 增加带图请求体测试,断言不会再把 `"type":"image_url"` 送进 responses。
  如何避免:**内部编排可以继续使用 Chat Completions 风格多模态 content,但任何发往 responses 端点的 provider 必须在边界显式转换为 responses input schema;看到 `openai_error/bad_response_status_code` 且请求含图片时,先查 provider 请求体 schema,不要先归因成"上游偶发 502"。修 responses/provider 改动必须覆盖 `openaiResponsesProvider.test.mjs` + `agentToolConversation.test.mjs` 的 function_call_output 回归。**

- **#10 ✅ 已修(2026-06-18)· V2 tool calling 出图成功后,最终文案请求失败会把整条消息标失败**
  根因:`runAgentConversationV2` 的生图工具链路是两阶段:第一轮 Responses 决策调用 `generate_image`,KIE 出图成功后,再把 `function_call_output` 回传给 Responses 生成最终文字说明。原实现对第二轮 `callModel` 没有局部降级;只要第二轮 Responses 返回 502/空返,异常会一路抛到 `createDbChatReply` 的 catch,把 assistant 消息写成 `failed`,同时丢掉已拿到的 `imageResultUrls/imagePlan/providerTaskId`。
  现象:云上用户看到"上游已经出图,但对话里显示失败";`stored_assets/internal_jobs` 能看到 KIE 图片结果,但对应聊天消息 metadata 可能没有图片附件,只剩 provider_bad_response 或 Responses 502 文案。
  修复:`runAgentConversationV2` 在图片已经生成且 `imageResultUrls` 非空时,捕获最终文案模型失败并返回降级成功结果:保留 `imagePlan`、`imageResultUrls`、`providerTaskId` 和 `selectedModel`,正文提示"图片已生成完成,但最终文字说明生成失败",技术错误写入 `finalReplyErrorMessage` metadata 供排障。补 `agentToolConversation.test.mjs` 回归:第一轮 tool_calls、KIE 成功、第二轮 Responses 502 时仍返回图片结果。
  如何避免:**tool calling 里"业务产物已完成"与"后续总结文案失败"必须分开处理。任何多阶段 provider 编排都不能让后置非关键步骤覆盖前面已经成功的用户可见产物;回归测试要模拟"主产物成功 + 尾部请求失败",不只测全成功/全失败。**

- **#11 ✅ 已修(2026-06-18)· 智能体图片已落库但进程重启发生在最终 chat message 更新前,前端一直思考**
  根因:智能体生图原来只在整条回复结束时一次性更新 `chat_messages`。云上部署/PM2 重启如果恰好发生在 `stored_assets` 已保存图片之后、assistant 消息最终 `completed` 更新之前,就会留下 `pending/analyzing` 的 assistant 消息;图片资产存在,但对话 UI 只能继续显示"需求分析中/思考中"。
  现象:多桑账号 2026-06-18 07:42:59 的智能体生图请求一直 pending;同账号 07:44:15 已有 `agent_center/result/kie` 资产 `e4f4ae21f17496494983659b`,07:44:16 左右 PM2 因部署重启,精准卡在资产落库和消息落库之间。
  修复:MySQL 和本地 JSON 两套 chat handler 增加 `image_result_ready` checkpoint:只要图片持久化成功且 `imageResultUrls` 非空,立即把对应 user/assistant 消息更新为 completed、写入图片附件、`imagePlan`、`providerTaskId` 和 `imageResultUrls`;后续完整总结成功时仍会覆盖为最终回复。V2 tool calling 与旧 `image_generation` 直连路径都接入 checkpoint。
  如何避免:**长耗时多阶段链路不能只在最后一次性落对话状态。任何用户可见主产物一旦持久化,必须立刻给前端可恢复 checkpoint;部署/重启窗口要按"任意 await 后都可能中断"设计。改 `server/index.mjs` 智能体 chat 路径时继续同步 MySQL 和本地 JSON handler。**

- **#12 ✅ 已修(2026-06-18)· 智能体直连生图在分析阶段 Responses 502,还没提交 KIE 就把错误发给用户**
  根因:旧 `image_generation` 直连路径先用 `kie_chat` 把用户需求和图片引用整理成结构化生图计划,再提交 KIE 图片任务。云上用户李松的失败样本里 `imagePlan:null`、`imageResultUrls:null`、`providerTaskId:''`,说明还没进入 KIE 出图,而是在分析阶段 `gpt-5.5`/Responses 兼容接口返回 502。原逻辑所有分析 provider 都失败时直接抛错,没有用用户原始需求和已选图片引用构造保守计划;分析 fallback 也必须尊重智能体已配置模型,不能擅自跳到用户未配置的供应商模型。
  现象:前端 assistant 消息直接显示 `responses 请求失败 (502): {"error":{"message":"openai_error","type":"bad_response_status_code","code":"bad_response_status_code"}}`;后台没有对应 agent_center 结果资产,因为 KIE 生图根本未开始。
  修复:`resolveImageAnalysisFallbackModels` 只在版本策略/白名单/当前中转配置内选择备用模型,并显式守住中转主备 `gpt-5.4`、Responses 兼容 `gpt-5-4-openai-resp`、Claude 备用;不再无条件 fallback 到用户未配置的 Gemini。`buildImageConversationResult` 捕获分析阶段失败后不再直接抛给用户,而是用 `buildFallbackImageAnalysisPlan` 从用户原话和 `relevantImageReferences` 构造 deterministic image plan,继续提交 KIE 生图。补 `agent-image-retrieval.test.mjs` 守卫 fallback 模型、禁止无配置 Gemini fallback、以及分析失败降级路径。
  如何避免:**智能体生图要分清三个失败边界:分析/规划阶段、KIE 出图阶段、最终文案阶段。看到 `imagePlan:null` + `providerTaskId:''` 的 502,先查分析模型和 fallback,不要套用"出图后保留结果"的修复。分析 fallback 必须尊重用户配置;分析阶段是辅助步骤,失败时应尽量用用户原话+已上传图片生成保守计划继续执行,不能把原始 provider 502 裸露给用户。**

- **#13 ✅ 已修(2026-06-18)· V2 工具调用已提交 KIE task 但 taskId 未落库,HTTP 中断后前端一直思考**
  根因:V2 tool calling 的 `generate_image` 是在 HTTP chat handler 内直接调用 `kie_image`,不是 `internal_jobs` 后台任务。原实现只在 KIE 完整返回图片并持久化资产后才写 `image_result_ready` checkpoint;如果请求在 KIE createTask 成功之后、图片结果落库之前中断或服务重启,`chat_messages` 里仍只有 `pending/thinking` 和 `imagePlan:null/providerTaskId:''`,前端轮询也只能继续显示"调用模型中"。这比 #11 更早:不是"图片资产已落库后丢最终消息",而是"上游任务已提交但 taskId 没有任何 durable 记录"。
  现象:将离 2026-06-18 16:24:35 的会话记录为 `requestMode:'chat'`,assistant 停在 `pending/thinking`,无 `agent_center/result` 资产、无 internal_jobs、无 providerTaskId;用户侧上游面板可能已看到任务/出图,但应用无法自动关联回来。李松同窗口的 502 则是 #12 的分析阶段旧请求,两类症状不能混为一谈。
  修复:MySQL 和本地 JSON 两套 V2 chat handler 给 `kie_image` 传入 `onProviderTaskId`;KIE createTask 一返回 taskId,立即写 `image_task_submitted` checkpoint,包含 `providerTaskId`、`imagePlan`、输入图和 prompt,并保留 pending 状态。最终成功/失败落库不会再擦掉这个 taskId。`providerGateway` 增加 `kie_probe` 单次 recordInfo 查询;chat messages GET 遇到 `image_task_submitted` pending 消息会节流探测 provider,若上游已完成则持久化图片资产并把消息恢复成 completed `image_task_recovered`。
  如何避免:**长耗时工具调用不能只在"拿到最终结果"后落库;上游一旦返回 provider task id,必须立刻 durable checkpoint。前端轮询只同步 completed 消息不够,服务端消息列表也要能用 providerTaskId 做轻量恢复。改智能体 chat 路径必须同步 MySQL/本地两套 handler,并覆盖 `providerTaskId 提交即落库`、`消息列表自动恢复`、`provider 单次探测` 三类测试。**

- **#14 ✅ 已修(2026-06-23)· V2 生图工具调用被后端压成单次,无法按语义生成多张结果**
  根因:V2 `runAgentConversationV2` 虽然让模型返回 `generate_image` 工具调用,但执行器只取第一条 tool call,并用 `imageGenerated=true` 阻止同一轮或后续轮次继续出图。这把 GPT 原生"模型按语义决定调用几次工具"压回了旧的单任务生图模式:用户说"每张图都处理"时,模型即使返回多次 `generate_image`,后端也只执行一次。
  现象:多图智能体需求会被错误当作"多图输入生成一张图"或只处理第一张图;这不是某个白底图需求的特判问题,而是工具执行器丢弃模型计划的问题。
  修复:`runAgentConversationV2` 改为按模型返回的 tool calls 顺序逐个执行 `generate_image`/`search_knowledge`,每个 `function_call` 都紧跟对应 `function_call_output` 回传;多张生图结果聚合到 `imageResultUrls`,并在 `imagePlan` 中保留 `outputCount/plans/providerTaskIds/imageResultUrls`。生图模式 prompt 增加语义规则:逐张/分别/每个素材处理时多次调用;融合/合成/同一张图时单次调用;参考图编辑时单次调用并说明主图/参考图角色。
  如何避免:**不要在后端用业务关键词硬判"抠白底/加字/换背景";语义判断交给模型和工具说明。后端职责是忠实执行模型返回的多个 tool calls,并保持多结果可落库、可展示、可在最终文案失败时保留。回归测试必须覆盖"同一轮多个 generate_image 全部执行"和"系统引导语表达逐张 vs 合成的工具调用语义"。**

- **#15 ✅ 已修(2026-06-23)· 后台出图成功被前端超时失败占位挡住**
  根因:一键主详/首图出图走 `internal_jobs` 后台任务。云上排队较慢时,前端 `waitForInternalJob` 先超时并写入无图 `status:'error'` 占位;后台 KIE job 随后成功并带回 `imageUrl`。但 `shellDataAdapter` 在恢复 terminal image job 前先调用 `hasPersistedTerminalJobResult`,该函数把同 job/provider 身份的无图 error 也当成"已有终态结果",直接 `return`,导致成功媒体结果没有机会覆盖旧占位。
  现象:天琪账号 2026-06-23 14:28:22 的首图项目 5 个 `kie_image` job 后台全部 `succeeded`,但前端 14:38:25 先显示"生成失败 / 任务等待超时,请稍后在任务列表中查看结果";用户刷新后仍可能看到旧失败卡片,因为水合被旧无图 error 拦截。
  修复:`hasPersistedTerminalJobResult` 增加 `incomingHasMedia` 语义:当 incoming backend job 已有图片/视频 URL 时,只有已持久化的媒体结果才算"已处理";同 job/provider 的无图 error/generating 占位必须允许被成功结果替换。`shellDataAdapter` 对 completed image jobs 传入该标记,并补首图超时占位恢复测试。
  如何避免:**状态恢复里"已有终态"不能只看 `status:'error'`;必须区分"有媒体的用户结果"和"无媒体的运行时占位"。任何 backend job 后来拿到 image/video URL,都必须能覆盖同 job/provider/plan 的旧无图失败或等待占位。**

- **#16 ✅ 已修(2026-06-23)· 智能体前端 SSE 看似流式,但中转站 `/v1/responses` 实际走非流并暴露 502**
  根因:前端 `sendChatMessage(...,{stream:true})` 和 MySQL chat route 都有 SSE,但 V2 tool calling 的 provider 边界走 `openai_responses` 时,`providerGateway` 没把 `options.onDelta` 传给 `runResponsesJob`;`runResponsesJob` 也只发非流请求并 `await response.json()`。所以 UI 只能收到 thinking/progress/done 或最终整段正文,中转站日志显示"非流";复杂需求在非流 `/v1/responses` 下出现 `status_code=502/openai_error` 时,用户看到整条对话失败。另一个漂移点是本地 JSON chat handler 完全没有 SSE 包装,本地排查会误判"流式不可用"。
  修复:`server/openaiResponsesProvider.mjs` 增加 Responses SSE 解析,支持 `response.output_text.delta` 透传正文、`response.function_call_arguments.*` 组装 tool calls、`response.completed` 提取 usage;`server/providerGateway.mjs` 把 `onDelta` 传入 responses provider;MySQL route 记录已发送过正文 delta,避免最终再重复推整段;本地 JSON handler 也补齐 `text/event-stream`、delta 透传和 done/error。真实探针确认 `gpt-5.5` `/v1/responses stream:true` 带 reasoning 与带 `generate_image` tool 均返回 200。
  如何避免:**判断智能体"是否流式"必须看 provider 请求体是否 `stream:true` 且是否解析上游 SSE,不能只看浏览器到 Node 的 SSE。改 `openai_responses` 时必须同时覆盖 provider 解析、`providerGateway` option 转发、MySQL/本地双 chat handler 和重复 final delta。遇到中转站非流 502,先做最小真实探针比较 simple/tool/reasoning 的 stream vs non-stream 路径,再下结论。**

- **#17 ✅ 已止血(2026-06-23)· providerless 详情页任务卡在提交阶段,占满同账号并发拖垮后续首图**
  根因:天琪账号前置详情页项目创建了 5 个 `kie_image` 任务,它们不是在正常等待上游出图,而是停在素材上传/提交阶段:无 `providerTaskId`, `providerSubmitted:false`,且至少一个 `asset_upload fetch failed`。这些 `running` job 会计入用户并发;Temporal 为避免重复扣费/重复出图,对 `running` 且无 `providerTaskId` 的 MySQL job 不会重新提交,只能等 providerless stale reconciler 兜底失败并释放并发。云上原窗口 15 分钟,导致后续首图任务足足排队十几分钟。
  修复:云上 `.env.server` 调整 `MEIAO_PROVIDERLESS_RUNNING_STALE_MS=300000`、`MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS=30000` 并重启 PM2;环境样例和部署文档同步记录。这个规则只处理"尚未拿到上游 task id"的异常提交阶段,不会误杀已提交上游、正在正常等出图的任务。
  如何避免:**排查排队/超时时先按 providerTaskId 分流:有 `providerTaskId` 才是正常等待上游出图;无 `providerTaskId` 且 `running` 是提交阶段异常,不能长期占用户并发。阈值类兜底必须走 env,云上默认按实际素材上传超时预算保守设置,不要写死在代码里。**

- **#18 ✅ 已修(2026-06-23)· 智能体对话图片按临时素材 3 天清理,删除会话却不释放图床资产**
  根因:智能体对话生成图和附件复用了通用 `stored_assets` 生命周期,默认 `expires_at = created_at + 3d`;清理任务只按过期和引用扫描判断,没有把 `agent_center` 会话资产视为会话内容的一部分。同时删除单个会话或清空某智能体历史时只删 `chat_messages/chat_sessions`,没有从消息正文、附件和 metadata 里收集 `/api/assets/file/:id` 并删除对应图床文件。
  修复:`agent_center` 模块写入的 managed asset 改为 `expiresAt=0` 永久保留,清理器把非正数过期时间视为永久;删除单个 chat session、清空某智能体历史时,MySQL 和本地 JSON 两套 handler 都先收集会话消息里的 managed asset id,删除图床文件并标记资产 deleted,再删除消息和会话。
  如何避免:**智能体对话内容和图的生命周期必须绑定会话,不能走临时素材 TTL。新增任何会话内持久化资源时,必须同时回答两个问题:清理任务是否会误删它、删除会话/清空历史是否会级联释放它;MySQL 和本地 JSON handler 必须同步覆盖。**

- **#19 ✅ 已修(2026-06-23)· Responses 首轮多模态读取 HTTP 图床 URL 返回 502,智能体未进入 KIE 生图**
  根因:将离 2026-06-23 16:46:15 的失败请求是 `requestMode:'chat'` 的 V2 tool calling 首轮 Responses 规划失败,`imagePlan:null/providerTaskId:''`,说明尚未提交 KIE。数据库里的 3 张附件确实是公网图床 URL(`http://111.229.66.247/api/assets/file/...`),外网 curl 200;但真实中转探针显示同一 `/v1/responses` 模型读取 HTTP 图床不稳定:单张 HTTP 图床连续 3 次 502,同一图片先上传到 KIE 得到 `https://tempfile.redpandaai.co/...` 后连续 3 次可被 `gpt-5.5` 正确识别;三张 HTTP 图床一起发 502,同三张 KIE HTTPS 图床一起发可被逐张描述。即问题不在多图语义/是否公网,而在中转 Responses 视觉输入拉取/解析本服务 HTTP 图床 URL 不稳定。
  修复:`runAgentConversationV2` 首轮模型分析前通过 `prepareModelImageUrl` 把本服务 HTTP `/api/assets/file/...` 图片下载并上传到 KIE 图床,拿到上游稳定可读的 HTTPS URL;随后仍以多模态 `image_url` 发给同一中转模型分析,让模型真正看图并按语义决定单图/多图工具调用。真正生图也使用这些 HTTPS 图床 URL。HTTPS 图片仍先尝试多模态,若遇到 `provider_bad_response`/502 再降级到文本目录。禁止 base64 fallback 和未配置模型 fallback。
  如何避免:**智能体 V2 不能把首轮 Responses 多模态失败直接暴露给用户。带图 502 先按 `imagePlan/providerTaskId` 分阶段;为空代表 Responses 规划阶段。云上 HTTP 图床要先转成稳定 HTTPS 图床再 inline 给 Responses,不能只给文本目录冒充看图,也不能引入 base64 或 Gemini fallback。有 taskId/结果才按 KIE 阶段恢复。**

- **#20 ✅ 已修(2026-06-23)· 多图独立处理语义下模型只规划 1 次 generate_image**
  根因:将离 2026-06-23 17:54:08 重新提交 3 张图并说“都做成白底图，1:1 的比例，正面摆放”后，#19 已生效，HTTP 图床已转成 KIE HTTPS 并成功进入 Responses 多模态分析；但首轮模型只返回了 1 个 `generate_image` tool call，`imagePlan.inputImageUrls` 只包含一张图，`providerTaskId` 也只有一个。后端执行器已经支持多 tool calls，但它忠实执行了模型的欠规划结果，所以用户只看到 1 张输出。这不是前端漏展示、不是 KIE 少返回、也不是 502，而是模型在“都/全部/每张/分别处理”语义下少规划。
  修复:`runAgentConversationV2` 增加通用欠规划审查:当本轮有多张新上传图、首轮模型却只返回 1 个单图 `generate_image` 时，不由后端词表直接决定拆分，而是追加系统审查提示让同一模型复核语义。模型若判断用户是“每张/全部/都/分别/各自/每个产品都处理”等独立批处理需求，就重新返回每张图一次的多个 `generate_image`;若判断用户只指定某一张、或是“合成/融合/同一张/一张海报/参考某图修改另一图”等单张输出需求，则回复 `PLAN_OK`，后端继续执行原单图计划。
  如何避免:**模型 tool calling 不是绝对可靠计划源。后端不要写具体业务关键词特判白底/加字/换背景，也不要用词表替模型决定业务语义；后端只识别结构性风险(多张新图 + 单图 tool call)，再让模型审查是否欠规划。回归测试要同时覆盖“都处理三张时审查后重规划”、“只处理图1时保持单张”和“合成一张不会被拆”。**

- **#21 ✅ 已修(2026-06-24)· Responses 流式 function_call 被 completed 事件重复合并,3 个 tool call 误变 6 个**
  根因:将离同一 3 图白底任务真实探针里,`gpt-5.5` 流式 Responses 首轮看起来返回 6 个重复 `generate_image` tool calls,执行层去重后才执行 3 张。进一步用最小 SSE 复现发现,不是模型语义重复规划,而是 `openaiResponsesProvider` 流式解析把同一个 function call 的 `response.output_item.added/done` 阶段按 `id=fc_*` 存了一条,`response.completed` 阶段如果只带 `call_id=call_*`、缺少原始 `id`,又按 `call_id` 新增了一条。于是每个真实 tool call 被解析成两条,3 个真实调用显示为 6 个重复调用,还会污染 `function_call_output` 回传和 `imagePlan.outputCount`。
  修复:`readResponsesStream` 合并 function_call 时按 `call_id` 回查已有 `fc_*` item key,让 `output_item.*` 与 `response.completed` 的同一调用合并到一条记录;补回归测试模拟 completed 缺 `id` 但同 `call_id` 的流式响应,修前 `toolCalls.length=2`,修后为 1。真实探针用同 3 张 KIE HTTPS 图验证,首轮解析后为 3 个 tool calls,第二张正确识别为黑色 H2O 加湿器。
  如何避免:**看到 tool calls 成倍重复时,不要先改 prompt 或业务语义;先保存/复现 provider 原始 SSE 事件,核对 `id`、`call_id`、`output_index` 的合并逻辑。Responses 流式解析必须把 `response.output_item.*`、`function_call_arguments.*`、`response.completed` 当同一事件流合并,不能按不同事件里的局部 id 直接追加。**

- **#22 ✅ 已修(2026-06-24)· 多图独立输出审查仍可能 PLAN_OK,同名中转图床 URL 又放大模型错图**
  根因:将离 2026-06-24 10:48:00 再次提交 3 张图并说“都做成白底图,1:1 的比例,正面摆放”,云上落库显示用户消息确有 3 个 image attachments,但助手最终只有 1 个附件、`imagePlan.inputImageUrls` 只有第 3 张、`providerTaskId` 只有 1 个。复跑同一会话 dry-run 有时首轮能返回 3 个 tool calls,说明模型规划本身非确定;#20 只做了一轮模型审查,如果审查也误回 `PLAN_OK` 或仍少规划,后端仍会执行单张并标记完成。另外 `prepareModelImageUrl` 上传托管资产到 KIE 时沿用原文件名,多个历史/结果图都叫 `gpt-image-2.png` 会得到同一个 `https://tempfile.../gpt-image-2.png`,造成目录 URL 碰撞,放大模型把历史图/本轮图混淆的概率。
  修复:`runAgentConversationV2` 增加计划完整性防线:对“本轮多张新图 + 独立批处理语义 + 覆盖图片数少于目标数”的计划,最多进行 `AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS` 轮修复审查;强多图语义下不接受未补全的 `PLAN_OK`,仍未补全则抛 `image_plan_under_planned` 快速失败,不允许执行单张并显示完成。语义判断只做输出拓扑分类(每张/分别/都/全部 vs 合成/同一张/只处理某张),不写白底/加字/换背景业务特判。`providerAssetTransfer` 给托管资产上传文件名加 URL hash 后缀,避免同名文件覆盖同一个中转图床 URL。
  如何避免:**模型审查也不是可靠终态。任何多图独立输出链路必须在执行工具前校验计划覆盖率,不能只要模型返回 tool_calls 就执行;对强多图语义,少规划宁可快速失败也不能单张完成。同名素材上传到第三方图床必须使用稳定唯一文件名,不能依赖原文件名。回归测试要覆盖“首轮单图 + 审查 PLAN_OK + 再次修复成多图”、只处理单图不误拆、合成一张不误拆、同名托管资产上传 URL 不碰撞。**

- **#23 ✅ 已修(2026-06-24)· KIE 素材上传超时被模型 fallback 放大成重复转存**
  根因:天琪账号 `6月24日项目1` 详情页策划任务 `314b56717acef4bcf5a6c85e` 失败在 `kie_chat` 的前置素材转存阶段,`provider_task_id=null`,事件表记录 `provider_submitted=0`、`error_fingerprint=kie:kie_chat:asset_upload:provider_timeout`。输入 7 张托管素材,其中 6 张约 3.5-4.5MB;`resolveProviderChatMediaUrl` 对聊天/策划图片强制上传 KIE 图床。主模型 `gpt-5-4-openai-resp` 上传超时后,`runKieChatFallbackModels` 把 `provider_timeout` 当成模型可 fallback 错误,切到 `claude-sonnet-4-6` 后又重新转存同一批素材,把一次传输失败放大成两轮上传等待。现场探针验证单张同素材当前可 5 秒上传成功,所以不是 KIE 图床整体不可用,而是这批多图转存链路在当时超时并被 fallback 重复消耗。
  修复:`providerGateway` 对 `providerStage=asset_upload/asset_download` 的 `kie_chat` 错误不再触发模型 fallback,因为换模型解决不了素材传输失败;同一轮 `kie_chat` 创建共享 `mediaUrlCache`,让主模型请求已经成功转存的托管素材 URL 在 fallback 模型里复用,不再重复上传同一个 `/api/assets/file/...`。补两个回归测试:素材上传超时时只上传一次并直接失败;主模型请求失败但素材上传成功时,fallback 复用同一个 KIE 图床 URL。
  如何避免:**模型 fallback 只能用于模型/上游推理阶段错误,不能用于 asset_upload/asset_download 这类传输阶段错误。任何 provider fallback 链路都必须共享前置素材解析/上传缓存;看到 `provider_task_id=null + provider_submitted=0` 时,优先按提交前传输阶段排查,不要归因成 KIE 生图任务失败。**

- **#25 ✅ 已修(2026-06-24)· KIE chat 同步策划被 providerless stale 保护提前杀死**
  根因:天琪账号同一详情页任务 `cdeaca8888a946f1223da046` 上云重试后,已不再复现 `asset_upload` 失败,但 5 分多钟后被事件 `kie:kie_chat:provider_submit:provider_submit_stale` 标记失败。云上 `MEIAO_PROVIDERLESS_RUNNING_STALE_MS` 约为 5 分钟,用于回收图片/视频类“已提交前无 providerTaskId”的卡死任务;但 `kie_chat` 详情页策划是同步 Responses 文本请求,7 张素材转存加模型返回可能超过 5 分钟,且 providerTaskId 通常在请求成功后才落库。这个通用 stale 保护把仍在执行的同步策划误判为卡死。
  修复:`reconcileStaleProviderlessRunningMysqlJobs` 按 `taskType` 计算 providerless stale 窗口,对 `kie_chat` 强制使用不少于默认 15 分钟的保护窗口,不被云上 5 分钟短窗口提前回收;图片/视频类 `kie_image` 等仍按云上短窗口回收。补回归测试验证 `kie_chat` 运行 10 分钟不会被 5 分钟窗口误杀,16 分钟才会进入 stale。
  如何避免:**providerless stale 不是所有 provider 任务的同一语义。异步生图/视频“创建任务前无 providerTaskId”和同步文本/策划“完成前才有 providerTaskId”必须分开设窗口。真实验收必须跑同一 payload 的正式 job,只做图床探针或直连 providerGateway 不能证明 Temporal/job recovery 链路已通过。**

- **#24 ✅ 已修(2026-06-24)· 智能体首轮规划前批量转存历史图片,拖慢并污染本轮多图规划**
  根因:将离 2026-06-24 10:48:00 的 3 图白底任务修完 #22 后,云上 dry-run 仍在进入模型规划前卡到 KIE 素材上传超时。继续追踪发现 `runAgentConversationV2` 在首轮 Responses 规划前不仅转存本轮 3 张新图,还会把 `priorMessages` 里的历史附件、历史生成图、历史 `imagePlan.inputImageUrls` 全部走 `prepareModelImageUrl` 上传到中转图床。历史图并非本轮 inline 视觉输入,却占用了最关键的规划前链路;历史图多、同名或上传慢时,模型还没开始判断“本轮 3 张都处理”就可能失败或被旧图目录干扰。
  修复:`runAgentConversationV2` 只对本轮 `attachments` 做首轮预转存并 inline 给模型;历史消息继续进入图片目录文本,但不在首轮规划前批量转存。若用户后续明确引用历史图,`generate_image` 阶段仍会按 catalog URL 校验并由 providerGateway 在真正提交生图时转存该历史图。补回归测试断言首轮规划只调用 3 张本轮图片的 `prepareModelImageUrl`,历史附件和历史生成图不触发预转存。
  如何避免:**首轮视觉规划的关键路径只处理本轮新输入。历史上下文可以作为目录文本保留,但不能在每次新请求前批量转存;否则上传失败会被误判成模型/语义失败,并把旧图引入本轮多图覆盖判断。涉及 agent 图片目录的改动要分别验证“本轮 inline 图片”和“历史可引用图片”两条路径。**

- **#26 ✅ 已修(2026-06-24)· 智能体多图结果数量正确但内容错图仍被标记完成**
  根因:将离 2026-06-24 10:53:02 的 3 图白底任务已经返回 3 张并写入 completed,但第二张黑色加湿器被生成成红色营养瓶,且瓶图重复。数据库回溯显示旧消息的 `imagePlan.plans` 第 2 项已经被同名 KIE URL 碰撞带偏为瓶类 prompt;即使 #22/#24 修了 URL 唯一性和首轮历史图预转存,后端验收仍只看“计划覆盖数/输出数/URL 数”,没有检查每个生成结果是否真的对应当前源图和用户语义要求。模型/KIE 可能给出数量正确但主体错误的图片,原逻辑会直接落库为成功。
  修复:`runAgentConversationV2` 的正确性边界收回到前置确定性链路:本轮新上传图 inline + 图片目录、tool call 计划覆盖率、`input_image_urls` 必须来自目录、强多图语义执行前校验、provider 返回 `imageUrl/providerTaskId` 后立即 checkpoint。已移除出图后的模型质检和质检重试,避免用另一层主观模型裁判吞掉用户满意的可见结果。
  如何避免:**智能体生图不要靠“出图后再审图”兜底。正确性应来自输入映射、计划覆盖、工具调用和落库 checkpoint 这些可验证边界;用户对图片是否满意是最终验收。若发现错图,优先修前置的图片目录、计划语义、provider 输入或结果映射,不要再增加后置模型质检层。**

- **#27 ✅ 已修(2026-06-24)· 详情页批量生图把 KIE 素材上传并发打满后失败**
  根因:天琪账号 `6月24日项目4` 详情策划已成功,但后续详情页一次性创建 7 个 `kie_image` 出图任务,每个任务又带 7 张商品/参考图素材,短时间内对 KIE 图床形成约 49 次素材转存。云上事件显示失败发生在出图前的 `asset_upload` 阶段:`kie:kie_image:asset_upload:provider_network_error` / `provider_internal_error`,且部分任务 5 分钟内未拿到 providerTaskId 被 `kie:kie_image:provider_submit:provider_submit_stale` 回收。单张烟测可成功,但真实批量详情图会因并发转存、缺少 asset_upload 重试、`kie_image` providerless 窗口过短而失败。
  修复:`providerKieImage` 对单个出图任务内素材解析/上传做限流,默认最多 2 并发,并通过 `MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY` 可调;`jobRuntime` 允许 `asset_upload` 的瞬时 provider 错误进行一次任务级重试;`jobManager` 对 `kie_image` providerless running job 和 `kie_chat` 一样使用不少于默认 15 分钟的预提交保护窗口,避免素材转存仍在执行时被 5 分钟云上短窗口误杀。补回归测试覆盖限流、asset_upload 重试和 kie_image stale 窗口。
  如何避免:**详情/批量生图要按“任务数 × 每任务素材数”估算第三方图床压力。单张成功不能证明批量成功;任何 providerless `kie_image` 失败都要先看 `provider_task_id` 和事件 stage,`asset_upload` 是提交前传输问题,不是 KIE 已接单生图失败。上传类瞬时错误要可重试,批量素材转存必须限流且阈值可配置。**

- **#29 ✅ 已修(2026-06-24)· 参考图局部替换被“全部”误判成多图欠规划,且 V2 Responses 缺配置内 fallback**
  根因:林一账号湿巾需求“把原图1中字母全部换成图2湿巾上面的字母,图1其他部分不变”本质是两张输入图生成一张结果的参考图编辑,但后端多图审查把“全部”机械当作多图独立批处理信号,导致同类需求被 `image_plan_under_planned` 快速失败。另一条云上失败是 `imagePlan:null/providerTaskId:''` 的规划阶段 provider overload;V2 tool-calling handler 的 `openai_responses` payload 没有传 `resolveChatFallbackModels(version, selectedModel)`,所以没有按智能体配置内模型切换。
  修复:`hasSingleImageOutputIntent` 增加“图/原图 A 换成/替换成图 B”和“其它部分不变/保持不变”这类单输出参考编辑拓扑,让“字母全部换成”不触发多图欠规划;MySQL 与本地 JSON 两套 V2 chat handler 都把 `fallbackModels` 传给 `openai_responses`,只在智能体允许模型内 fallback,不引入未配置 Gemini。补回归测试覆盖参考图替换主图局部保持单张输出,并用 source 测试锁住双 handler fallback payload。
  如何避免:**多图/单图判断看输出拓扑,不要只看“全部/都”字面词。出现 `image_plan_under_planned` 要先判断“全部”修饰的是图片集合还是某个局部对象;出现 `imagePlan:null + providerTaskId:''` 的 overload/502 是 Responses 规划阶段,必须确认 V2 payload 带配置内 fallbackModels,不能裸露 provider 错误或 fallback 到未配置模型。**

- **#28 ✅ 已修(2026-06-24)· 视频生成成功结果只写 shellProjects,旧视频工作区读不到**
  根因:董丹丹账号直接视频生成任务 `f38dff2b17c4ef343856a48a` 后端已 `succeeded`,生成 MP4 `c410a0332deaa167a30ea4a0/kie_seedance_video.mp4` 也返回 200,但前端没有真实显示。原因是短视频直接生成已经迁到 shell 项目卡 `shellProjects`,而历史视频工作区仍读取 `videoMemory.veoProjects`;成功视频只稳定持久化到 `shellProjects`,远端 patch 也只发项目卡状态,没有同步 `videoMemory`,且完成结果缺少 `backendJobId`,导致刷新/切换后旧视频工作区仍停在待恢复状态。
  修复:`shellPersistence` 对 `module=video/subFeature=generation` 的 completed 视频项目构造并 upsert 同名 `videoMemory.veoProjects` 记录;`buildProjectRemotePatch` 对直接视频生成项目同步带上 `videoMemory`;`mergeAppStateForStorage` 服务端合并层也从 completed 直接视频项目兜底镜像 `videoMemory.veoProjects`;视频成功 result 补 `backendJobId`;已手工补齐董丹丹项目 `proj-1782285629355` 的 shell/veo 双状态。
  如何避免:**迁移期同一业务如果存在新旧两个状态桶,写入、远端 patch、刷新恢复测试必须同时覆盖。直接视频生成完成后不能只验 `internal_jobs.succeeded` 或 `shellProjects`;还要查 UI 实际读取的状态桶、`videoUrl` 资产 200、`backendJobId` 身份和刷新恢复。新增视频结果持久化必须跑 direct video mirror 与 videoMemory patch 回归。**

- **#30 ✅ 已修(2026-06-24)· Seedance 视频多素材同时转存导致 asset_upload fetch failed**
  根因:董丹丹账号 `6月24日项目2` 直接视频任务 `041e6f368539bc79d85b13f8` 真失败,`provider_task_id=null/provider_submitted=0`,事件停在 `kie:kie_seedance_video:asset_upload:provider_network_error`。输入 8 张素材,多张约 3-4MB;`runKieSeedanceVideoJob` 对图片/视频/音频素材使用 `Promise.all` 全量并发 `resolveProviderGenerationMediaUrl`,不像 `kie_image` 路径有单任务素材转存限流。云上回测同批素材虽返回 200,但部分大图 15 秒内只下载一小段并超时,说明失败发生在提交 KIE 前的素材下载/上传压力阶段,不是上游视频生成失败。
  修复:`kie_seedance_video` 提交前素材解析/转存改为图片、视频、音频合计限流,默认 2 并发,通过 `MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY` 可调;补回归测试证明 4 个受管素材最大并发不超过 2。董丹丹失败卡 `proj-1782285952681` 已清理旧“生成中/任务已提交云端”占位,只保留真实失败结果。
  如何避免:**视频分镜生成也要按“单任务素材数 × 素材大小”估算图床压力。`provider_task_id=null + provider_submitted=0 + asset_upload` 表示没提交上游,不能当成 KIE 视频出片失败或成功未显示。所有新的视频/多模态素材路径都必须有提交前素材转存限流和对应测试。**

- **#31 ✅ 已修(2026-06-30)· Seedance 参考视频超过总时长限制,且上传视频预览播放器未主动加载首帧**
  根因:广白账号 2026-06-30 15:43:54 的 `kie_seedance_video` 任务 `50723f2bfddcbef7b52cf095` 在提交 KIE 时返回 `The total duration of the video cannot exceed 15 seconds`,没有 `provider_task_id`, `provider_submitted=0`。该任务上传的参考视频实际约 53 秒,超过 Seedance API 对 `reference_video_urls` 的参考视频合计时长上限 15 秒;生成视频自身的 `duration` 是另一条 4-15 秒范围约束,不与参考视频相加。另一个用户可见问题是上传视频素材缩略图和灯箱预览仍按图片轻量预览思路处理:素材条视频 `preload="none"` 不主动取首帧,灯箱视频只用 `src` + `preload="metadata"` 且没有固定可见播放区域/错误提示,在部分浏览器里容易表现为黑块或只露出音频控件。
  修复:`runKieSeedanceVideoJob` 在提交前读取受管 MP4 的 `mvhd` 时长,对参考视频合计时长超过 15 秒的请求直接抛结构化 `provider_bad_request`,并把 KIE 英文错误归一成中文可操作提示;补回归测试证明 53 秒参考视频不会调用 KIE `createTask`,也证明 10 秒参考视频 + 10 秒生成可以正常提交。`MaterialPreviewBar` 上传视频缩略图改为主动加载并 seek 到首帧附近;`ImageLightbox` 视频播放改为 `<source type=...>`、固定 16:9 可见区域、`preload="auto"`、首帧 seek、播放互斥和可读错误提示。
  如何避免:**视频参考不是普通附件。Seedance API 路径必须在提交前校验 provider 的硬限制,不要把明显会被拒绝的请求送到上游才失败。排查“视频上传了但不显示/不能播”时先分三层:资产 HTTP 头和 Range、文件容器/编码/时长、前端 video 元素加载策略;确认有 `vide` track 后不要误判成素材上传失败。**

- **#32 ✅ 已修(2026-06-30)· HEVC/H.265 上传视频在浏览器里只能播音频**
  根因:将离账号上传的 `6_30_15.mp4` 资产 HTTP 200、`Accept-Ranges: bytes` 和文件大小都正常,不是图床上传失败;解析 MP4 容器发现视频轨道 sample entry 是 `hvc1`(HEVC/H.265),音频轨道是 `mp4a`。Chrome/多数浏览器对 HEVC 解码支持不稳定或不可用,所以会出现播放器进度条和声音正常、画面黑屏的症状。#31 的 `preload/seek` 只能解决首帧加载策略,不能让浏览器解码 H.265。
  修复:新增 `src/utils/videoCodec.ts` 解析 MP4 `hdlr/stsd` 轨道编码,上传视频时把 `videoCodec` 写入素材状态并持久化;旧视频打开灯箱时按 Range 拉取 MP4 头部解析编码。`ImageLightbox` 和 `MaterialPreviewBar` 对 `hvc1/hev1` 等 HEVC 编码直接展示“当前浏览器可能只能播放音频或黑屏,请转 H.264/AVC MP4”的中文提示,不再让用户面对无解释的黑屏播放器。补 `videoCodec.test.mjs` 和 UI 架构测试。
  如何避免:**排查视频预览必须把“上传成功”和“浏览器可解码”分开。MP4 只是容器,不能等同于 H.264;看到有声音无画面时先解析 `stsd` 视频轨道编码,`hvc1/hev1` 要明确提示转码或走服务端转码方案,不能继续归因成图床/加载策略问题。**

- **#33 ✅ 已修(2026-07-01)· `running` 被同时当执行态、等待态、孤儿态,导致账号并发反复不释放**
  根因:`internal_jobs.status='running'` 同时承载三种语义:① worker/Temporal activity 正在执行;② 已拿到 `providerTaskId`、正在等上游结果;③ worker/Temporal 已丢失但数据库仍遗留 running。旧的账号并发判断直接 `COUNT(status='running')`,不看 `providerTaskId`、`startedAt/updatedAt`、取消状态和 stale 窗口;一旦任何功能在 asset_upload、provider_submit、provider_wait 或 worker 重启后留下孤儿 running,这个账号后续所有功能都会被误判“并发已满”。此前 providerless/submitted/cancelled reconciler 只能事后修状态,但在回收漏跑、间隔未到或新增任务类型时,并发入口仍先被裸 running 卡死。
  修复:`jobManager.mjs` 增加单一判据 `isRunningJobConcurrencyBlocking`:只有仍处在有效窗口内的 `running` 才占账号并发;已经达到 providerless、submitted、cancelled stale 回收条件的 running 不再计入。MySQL worker 和 Temporal activity 的用户并发检查都改为读取 running 行并套同一判据,不再裸 count running。`MEIAO_SUBMITTED_RUNNING_STALE_MS` 补入环境样例和部署文档;回归测试覆盖 stale providerless、submitted、cancelled 不占并发,以及 Temporal 在用户并发为 1 时能绕过旧 submitted running 执行新任务。
  如何避免:**任何并发/排队判断都不得直接 `COUNT status='running'`。必须使用 `isRunningJobConcurrencyBlocking` 这类单一判据,把“真正执行/等待中的有效 running”和“达到 stale 回收条件的孤儿 running”分开;新增任务类型或调整 stale 窗口时,同时验证 providerless、submitted、cancelled 三类 running 的并发占用测试。**

- **#34 ✅ 已修(2026-07-01)· 买家秀多套只生成每套第 1 张,刷新后项目卡出现又消失**
  根因:买家秀多套工作流仍按旧同步出图模型设计。第一轮图片提交后只要返回 `generating`,代码就把该套 `setPlan.blocked=true`,后续第 2/3 张不再创建;失败分支还会把根项目写成单个失败结果,覆盖已提交/已成功的后台 jobs。前端运行时压缩又把 `results: []` 清空,刷新时 `app_state` 的坏根卡优先于 `internal_jobs` 恢复结果,导致卡片先从 jobs 出现、随后被旧快照覆盖消失。旧 jobs 还把 `batchCount=12/batchIndex=1,4,7,10` 当全局批次存储,没有按“每套一个项目卡”恢复,并且分套参考图缺失时会回退到其它套/全局参考图,造成模特/氛围参考串套。
  修复:`runShellBuyerShowWorkflow` 改成先提交 `createInternalJob(kie_image)` 后立即返回 generating 占位,不再等待单张完成后阻塞后续轮次;多套时每套使用独立 `shellProjectId=${root}-set-N`,每套 `batchCount=imageCount/batchIndex=imageIndex`,同时保留 `buyerShowGlobalBatchIndex` 只做全局进度。分套参考图只使用同套上传素材,有分套素材时禁止回退到其它套。`ShellMigratedApp` 保留运行中结果的 `backendJobId/batchIndex/projectId`,多套直接 upsert set 项目卡并移除根卡。`shellDataAdapter` 从 `internal_jobs` 按买家秀 set 项目重建卡片,兼容旧全局批次 payload:用 `setIndex/imageIndex/imageCount` 拆成 `-set-N`,隐藏根错误卡,并让 job 快照覆盖旧 app_state 的错误 taskCount。
  如何避免:**批量/多套功能必须以 durable job 为单一真相恢复 UI,不能让临时 app_state 错误卡覆盖 jobs。任何“每套/每张”语义都要同时验证:提交的 job 数量、每个 job 的项目归属、局部 batchIndex/taskCount、参考图作用域、刷新后的卡片恢复。运行中占位必须保留 backendJobId,且恢复逻辑要允许 backend job 成功/失败覆盖旧无图占位。**

- **#35 ✅ 已修(2026-07-06)· Temporal worker poller 静默死亡,HTTP 存活假象掩盖"任务永远排队"**
  根因:`/api/health` 只报 HTTP 进程活着(`{ok:true}`),不覆盖后台消费者;temporal worker 的 poller 死掉后,任务全部停在 queued,健康检查却一路绿灯。`scripts/local-dev.mjs` 看到 3100 被 node 占用就静默复用,把僵死实例当好实例。实测翻译任务卡 queued 23 分钟,杀进程由 launchd 重生后立即消费——这是"卡处理中/时好时坏"的主成因之一。
  修复(commit b377d91):新增 `server/workerHealth.mjs`,经 gRPC `describeTaskQueue` 查 WORKFLOW/ACTIVITY 两类 poller,任一非空才算 healthy,错误降级不抛,10s 缓存(env `MEIAO_WORKER_HEALTH_CACHE_MS`);`/api/health` 在 temporal 引擎下附带 `worker` 快照;`local-dev` 复用 3100 前先 fetch health,poller 死则拒绝复用并给 kill/kickstart 指引。
  如何避免:**"服务活着"必须按消费链路分维度定义——HTTP 进程存活 ≠ 队列消费者存活;health 端点要覆盖每一类后台消费者(poller/worker/定时器),复用既有进程前必须体检,不许"端口有人听就算好"。**

- **#36 ✅ 已修(2026-07-06)· 无身份活跃占位写入后无人回收,中断即成永久"生成中"脏数据**
  根因:前端提交任务时先落 `status:'generating'` 占位(此刻还没有 backendJobId),再等后端回身份。链路一旦中断(刷新/崩溃/限流),这条无身份占位没有任何机制回收——stale reconciler 只管有 job 的,repair 脚本只在人工跑时清。云上累计 57 条,是"永远转圈的卡"直接来源(D1)。
  修复(commit b41641c):存储合并出口 `mergeAppStateForStorage` 新增 `failExpiredIdentitylessPlaceholders`:无任务身份(backendJobId/providerTaskId/taskId/planningTaskId/kieTaskId 全空)+活跃状态+超龄(env `MEIAO_IDENTITYLESS_ACTIVE_TTL_MS` 默认 6h)→ 标结构化失败(`status:'error'`+`errorCode:'identityless_placeholder_expired'`);判据从 `appStateHealth.mjs` 导出单一实现,顺手把 `appStateRepairPlan.mjs` 的平行拷贝收敛掉;判不了龄宁放行不误杀;文案刻意避开全部既有 sentinel 正则。
  如何避免:**任何"先占位后补身份"的写入,必须同时设计占位的回收路径(TTL 守卫/身份回填两条腿);无身份数据不许无限期滞留在活跃状态。守卫判据只能有一份(从 health 导出),修复脚本与写入守卫共用,不许各养一套。**

- **#37 ✅ 已修(2026-07-07)· "脏数据"清理前必须先探真相:同一审计口径下混着误报、断链、真脏三种形态,动作完全不同**
  根因:审计判据 `completed_project_without_output` 把三种本质不同的东西报成同一类"脏数据":① 分镜"策划完成"项目(completed 表达的是策划完成,boards 出没出图由展示层现算)——**判据误报**,该豁免;② 翻译/一键的"无输出完成卡"——探针逐条查 backendJobId,发现 18 张卡对应的 internal_jobs 全部 `succeeded` 且 result_json 里有 imageUrl,是**回填断链**(job 成功了,URL 没写回 app_state),该回填找回,删除=删用户已付费的成果;③ 真正空壳(无 script/shots/boards/任何结果)——才是**真脏**,该标失败。若当初按"清理脏数据"一刀切删除,②的 18 张用户成果图就没了。
  修复:① `appStateHealth.mjs` 加 `isStoryboardPlanningProject` 单一判据(storyboard 桶+有 script/shots/boards 即有效,审计/修复器共用,真空壳仍上报,commit b6b5daa);② 新脚本 `scripts/cloud-backfill-completed-without-output.mjs`(dry-run 默认/--apply 带备份/幂等),从 internal_jobs.result_json 回填 imageUrl+归一计数+镜像卡同步,云上 3 用户 32 动作完成(commit 8f68774);③ 真脏走既有 repair 脚本。云上 44 用户审计异常首次全清零。
  如何避免:**审计判据报出来的"脏数据"只是线索不是结论;清理动作(豁免/回填/删除/标失败)必须先按子形态探真相——逐条把卡上的任务身份(backendJobId 等)拿去查 durable 源(internal_jobs/资产表),"上游有成功结果"的一律回填不删除。"完成"这类状态词的语义因模块而异(分镜 completed=策划完成≠有图),全局判据要给业务语义留豁免口,且豁免判据只能有一份。**

- **#38 ✅ 已修(2026-07-07)· 部署脚本在 install 前删 dist,每次发布都有数分钟前端断档窗口(S4 真根因)**
  根因:deploy_tencent.sh 把"删旧目录"放在 `npm install`(数分钟)+ `npm run build` 之前,期间 Node 旧进程还在跑、API 正常,但 dist/index.html 和全部 chunk 不存在——此窗口内旧标签页懒加载 chunk 必 404("Failed to fetch dynamically imported module");7/1 四次报错的 chunk hash 在服务器上已不存在即为铁证。旧的"保留旧 assets"机制(拷到 /tmp 再拷回)带 `2>/dev/null || true` 静默吞错,generation 可能悄悄丢失;chunk 错自动刷新只延迟 80ms,恰好刷回同一断档窗口。
  修复(commit f4546f5):①部署零断档——旧 dist 全程不删,新产物 build 到 dist-next,旧 assets 按 mtime 保留 `MEIAO_OLD_ASSET_RETENTION_DAYS`(默认30天)后 `cp -Rpn` 合并,最后两次 rename 原子切换,合并失败直接报错退出;②版本探测——vite 注入 `__BUILD_ID__` + closeBundle 写 version.json,前端每 5min+回前台比对(`src/utils/frontendVersionWatch.ts`),无活跃任务自动软刷新、有任务只提示;③刷新加固——stale-asset reload 延迟 3s 躲过重启窗口 + sessionStorage 计数 5min 内最多 3 次防死循环。uiArchitecture 测试锁部署脚本不变量。
  如何避免:**部署流程里"删旧产物"必须发生在"新产物就绪"之后,切换用原子 rename,不许存在服务中的文件缺失窗口;保留/合并类操作不许 `2>/dev/null || true` 静默吞错;"出错后自动重试/刷新"要错开故障窗口并带循环上限。长驻页面对"服务端已发新版"要有主动探测,不能等踩到 404 才被动发现。**

- **#39 ✅ 已修(2026-07-07)· coreutils 9.2+ 的 `cp -n` 跳过文件即退出 1,`set -e` 部署脚本被掐死在原子切换前**
  根因:S4 零断档部署脚本用 `cp -Rpn` 合并旧 hash chunk 进 dist-next;服务器 coreutils 9.4 对每个被 `-n` 跳过的文件打印 "not replacing" 并以退出码 1 结束,`set -e` 当场终止——构建产物齐了但没切换、PM2 没重启。首次实跑即中招;零断档设计兜住了(旧 dist 全程在服务,线上无感知)。
  修复(commit 66a4425):合并改为显式"目标不存在才 `cp -p`"的循环,cp 真实失败仍会炸出不吞错;uiArchitecture 测试断言禁止 `cp -n` 回潮。
  如何避免:**shell 脚本里 `cp -n`/`mv -n` 的退出码语义随 coreutils 版本漂移(9.2+ 跳过=失败),`set -e` 下禁用;"跳过已存在"必须写成显式存在性判断。部署脚本的每一步都要问:这步失败时线上处于什么状态——本次是"旧版完好"才安全,靠的是切换前不动旧产物的设计,不是运气。**

- **#40 ✅ 已修(2026-07-08)· normalize 层把"空数组"当"字段缺失"重新播种默认配置,用户删除永远不生效**
  根因:`smartFactoryConfigStore.mjs` 的 `normalizeSmartFactoryConfig` 用 `knowledgeBases.length ? knowledgeBases : fallback.knowledgeBases` 兜底——本意是给"从未初始化"播种演示数据,但它无法区分"字段缺失"和"用户删光了"。用户删除最后一个知识库→存储层 normalize→空数组被替换成默认演示库(售后知识库 2 文档)→持久化。前端删除成功横幅、列表刷新全对,下一次读取它又回来了——"删除了,显示已删除,但是还在"。`modelProviders` 同款问题。排查关键:先用 10 行纯函数探针跑 `deleteSmartFactoryKnowledgeBase` 复现复活,再查云库确认库里只剩和默认种子逐字段一致的记录,没有先猜前端状态残留。
  修复(commit 6a15d4d):播种判据改为"字段缺失(非数组)才播种"(`hasSourceKnowledgeBases`/`hasSourceModelProviders`,和 tools 既有的 `hasSourceTools` 同款);空数组原样保留。回归测试锁"删最后一个→持久化回读→仍为空"链路。云上已按业主删除意图清掉复活的售后知识库(备份 /www/backup/system-settings-global-260708-before-kb-cleanup.json)。
  如何避免:**默认种子/演示数据只允许在"字段缺失"时播种,空集合是用户删除的真实结果,normalize/合并层不得复活;新增任何"默认兜底"先问:用户把它删光后这个兜底会不会把删除翻回来。"删除后又出现"类 bug 先探 durable 层(删除后库里是什么),不要先猜前端状态残留。**
  复发记录(2026-07-08):业主报"本地仍删不掉"——**不是修复失效**,是本地后端进程(7/7 15:18 启动)比修复提交(7/8 09:58)老,跑的旧代码(#7 同款坑的隐蔽形态)。`launchctl kickstart -k` 重启后端到端实测:API 删除→durable 层空数组→冷启动回读不复活,本地已闭环。教训已升级到第0层跨项目经验库("修了还是不行"先比对进程启动时间 vs 修复提交时间)。

- **#41 ✅ 已修(2026-07-09)· "打通/统一入口"类需求只改了被点名的模块,同能力的第二入口藏在别的模块里,业主看到"没打通"**
  根因:工厂↔中心打通(8 任务)做的是数据/行为层统一——独立「智能工厂」模块(`SMART_FACTORY` → `SmartFactoryPanel`)发布同步、编辑锁、级联下线,全对。但「智能体中心」模块内部还嵌着**第二个完整制作台**(管理员 tab 就叫"智能体工厂" → `AgentCenterManager` 5 步向导),直接写中心存储、绕开工厂单一真相。方案把"中心"当成"使用+轻管理",没盘点它内部的入口——业主一截图就发现"中心还能新建智能体"。定位关键:先分清截图是哪个组件(截图顶部有"智能体广场|智能体工厂"切换 → 只有中心模块有此切换),再顺 `ShellMigratedApp` 的 lazy import 认清 live 渲染树,而不是想当然认为截图=已打通的那个工厂。
  修复(commit 8c3c9a1):纯前端收口——`src/shell/modules/AgentCenter/AgentCenterModule.tsx` 拆除 广场/工厂 切换、工厂控制台总览、`AgentCenterManager` 挂载及专属状态,中心恒为广场(使用)模式,管理员态加"制作 / 调试请前往「智能工厂」模块"提示;source 断言锁"中心不再内嵌制作台"。不碰后端与数据,现存 3 个非工厂 agent 照常运行(如需修改走工厂重建)。
  如何避免:**"统一/打通/收口入口"类需求,动手前先按能力穷举所有 UI 入口(grep 按钮文案如"新建智能体"、顺 ShellMigratedApp 的模块路由看 live 渲染树),把每个同能力界面列进方案的"改/删/留"清单;验收标准里必须有"业主视角走一遍每个入口",只验数据链路不算打通。同名中文标签(智能体工厂 vs 智能工厂)是入口重复的高危信号。**

- **#42 ✅ 已修(2026-07-09)· 新增 Shell 模块只接了写入,刷新恢复白名单漏注册,持久化内容像消失**
  根因:图片裁切模块会把长图切片/改尺寸结果写入 `shellProjects`,远端 patch 也会保存;但 `src/adapters/shellDataAdapter.ts` 的模块恢复白名单 `MODULE_VALUES` 和展示标签 `MODULE_LABELS` 漏了 `image_crop`。刷新后 `toModule` 把未知模块默认降级为 `agent_center`,图片裁切页再按 `activeModule='image_crop'` 过滤,所以记录实际在 app_state 里,但被恢复成别的模块后不可见,表现为"刷新就没了"。
  修复:`shellDataAdapter` 补齐 `image_crop` 的模块标签和有效枚举,并加回归测试锁住 persisted `image_crop/long_slice` 项目及其结果刷新后仍保持 `module:'image_crop'`。
  如何避免:**新增任何顶层 Shell 模块不能只改路由/侧边栏/写入模块。必须同步检查 `types.ts`、`shellDataAdapter` 的模块白名单和标签、`shellScopeFilters` 过滤、`shellPersistence` 远端 patch,并补一条"写入 shellProjects → buildShellDataSnapshot → 当前模块过滤仍可见"的刷新恢复测试。**

- **#43 ✅ 已修(2026-07-09)· 收口类需求把"存量数据失去编辑路径"当既定取舍,业主实测立刻打回**
  根因:#41 收口方案明知现存 3 个非工厂智能体收口后"中心不再有编辑入口",却写成"既定取舍;如需修改走工厂重建"。实际使用中站不住:业主要给"测试1"加功能时发现工厂里根本没有它——重建=丢会话历史/重配知识库,不是可用路径。收口只做了"关旧门",没给存量数据开"新门"。
  修复(commit 69995c9):智能工厂加"接管"能力——`buildFactoryAdoptionPlan` 反向桥纯函数 + `POST /api/smart-factory/agents/adopt/:centerAgentId` 双管道路由 + 工厂工作台"中心存量智能体"分区。接管建立 factoryAgentId 关联后,工厂编辑发布即原地更新中心同一智能体(会话/生图配置保留)。
  如何避免:**"收口/统一入口"类方案必须给存量数据一条不丢信息的迁移/接管路径,才算完整;"存量走重建"只在重建零成本时才是可接受取舍(有会话历史/关联配置的一律不算)。方案评审时把"业主明天要改存量对象怎么办"当必答题。**

- **#44 ✅ 已修(2026-07-09)· job 恢复卡"只显示不落库"+ 数据水合全量覆盖,任务卡闪现即消失;分镜删除无墓碑被并集合并复活**
  根因(多桑「7月9日项目5」两次提交取证,均有云上真实数据钉死):① 提交后用户立刻刷新(09:48:20 提交→09:48:22 页面重启,PM2 有 `Error: aborted`),占位卡的持久化 PUT 随页面卸载丢失,app_state 永远没有这张卡;② 恢复路径 `hydrateShellJobs` 能从 internal_jobs 正确重建卡片(真实数据探针 FOUND),但 `shouldPersistSyncedProjectFromJobs` 对"持久层缺卡"只回写 translation/error 两类,**everything_replace 等模块的成功缺卡永不落库**,只活在最近 100 条 jobs 窗口里;③ `hydrateShellData`(慢,拉 3MB state,刻意不含 jobs)与 `hydrateShellJobs`(快)并发竞速,慢者的 `applyShellSnapshot` 全量 `setProjects` 把刚重建的 job 卡冲掉——"刷新时显示了一下又消失"。④ 将离分镜卡删不掉:storyboard 删除只清 videoMemory 本地数组不写墓碑,服务端 `mergeVideoMemory` 对 `storyboard.projects` 取并集,删掉的卡每次同步被 existing 侧并回来(#40 同族:并集合并下"缺席"表达不了删除)。
  修复(commit 500ab32):① 缺卡回写谓词收敛到单一来源 `src/utils/syncedProjectPersistence.ts`——job 来源+有 backendJobId+有可见产物(成功媒体/活跃身份/失败结果)的缺卡,所有工作区模块统一回写,12 条行为测试锁契约;② `applyShellSnapshot` 保留内存中快照缺席的 job 来源卡(删除墓碑照常过滤);③ VideoModule 分镜删除分支补 `onDeleteProject` 写 `deletedProjectIds` 墓碑(服务端 `applyDeletionTombstones` 本就过滤 storyboard.projects,只是前端从没写过墓碑)。真实云数据探针验证:多桑两张项目5缺卡+项目30 都会被回填;存量缺卡在用户下次打开页面时自愈(jobs 仍在窗口内)。
  如何避免:**durable job 是任务卡单一真相——从 jobs 重建出来的卡必须能写回 app_state,"只显示不落库"的恢复等于没恢复(下次水合/滚出 jobs 窗口就没了);两条并发水合链不允许"后到者全量覆盖",不含 jobs 的快照应用必须保留 job 来源的内存卡;任何"从数组里移除+merge 同步"的删除在并集合并下都会复活,删除只能走墓碑(deletedProjectIds),新增可删除的卡片类型先确认删除路径写墓碑。**

- **#45 ✅ 已修(2026-07-10)· 我方托管素材强制经过 KIE 图床,跨任务上传抖动成为多模块共同单点**
  根因:2026-07-09 按 job 去重后,108 个 `asset_upload` 终态失败横跨一键主详、万物替换、买家秀、产品精修,影响 7 个用户；这些任务全部最终落在 `providerTaskId=null + asset_upload + provider_network_error/fetch failed`。当天 275 个目标 job 中 154 个成功、117 个以 provider 网络错误终止,说明链路是间歇性退化而非整体中断。素材文件从我方服务器和公网均可正常读取,但 `resolveProviderGenerationMediaUrl` / `resolveProviderChatMediaUrl` 仍无条件强制上传 KIE；已有 `MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY=2` 只限制单 job,挡不住多个账号和模块同时上传,也没有进程级成功 URL 复用。KIE file-stream-upload 一抖,任务在模型接单前成片失败。
  修复:托管 `/api/assets/file/` 在 `MEIAO_PUBLIC_BASE_URL` 为公网 HTTPS 时改为直连优先；仅当上游明确读图/下载/MIME 失败,或同步 chat/Responses 返回无 task id 的 HTTP 502 时,才转存 KIE 并重试同一模型。任何 `providerTaskId` 都禁止再次创建任务。实际 KIE 转存增加跨任务进程级并发总闸门、上传专属 `429/5xx/连接错误` 重试和成功 URL TTL 缓存；直连/KIE 两套路由使用不同 job cache key；`MEIAO_KIE_MANAGED_ASSET_MODE=kie-only` 可无代码回滚。
  如何避免:**我方托管素材的第三方图床只能做兼容性回退,不能做必经单点。媒体回退必须同时验证“确实走过直连+错误在接单前+没有 providerTaskId”;文件上传可按传输语义重试,createTask/chat 等可能扣费的提交 POST 收到任何 HTTP 响应后仍不得盲目重试。单任务限流不等于全局限流,批量链路必须同时有进程级总闸门和跨 job 成功缓存。**

- **#46 ✅ 已修(2026-07-10)· Logo 替换组合图缺少耐久标记,刷新同步后被原始 provider 结果覆盖**
  根因:Logo 替换的最终图不是单纯 provider 输出,而是"KIE 清理底图 + 程序叠加透明 PNG logo"的组合结果。但 `logoReplaceGuarded` 只停留在 workflow 临时结果里,没有贯穿 `ShellMigratedApp` 结果对象、`shellDataAdapter` 持久化映射和合并规则。刷新或 jobs 同步时,后到的原始 provider 结果会按普通完成图覆盖组合图,表现为旧 logo 残留、程序贴回的新 logo 消失或结果图看起来退回 KIE 清理底图。另一个同族问题是 logo 替换仍可能吃到 GPT Image 2 通用清理后缀,把"清理画面"规则污染进 logo 定向替换 prompt;结果卡用 `object-cover` 展示也会把后端完整图裁掉,被误判为生成内容缺失。
  修复:`logoReplaceGuarded` 从 workflow result 一路带到前端 result object、持久化 state 和 job 同步 merge,合并时 guarded 结果优先于非 guarded provider 原始结果。单/多 Logo 框选替换强制走 program guarded 流程,以用户选框作为清理和叠加边界,并把上传 logo 素材传给 KIE 只作识别约束;`subFeature:'logo_replace'` 时抑制 GPT Image 2 通用 cleanup suffix;结果卡改为 `object-contain`。补 `shellWorkflowLogoReplace`、`shellDataAdapter`、`kieAiService`、`ResultCard` 等回归测试锁住刷新覆盖、prompt 后缀和展示裁切。
  如何避免:**凡是"provider 输出 + 本地后处理"形成的最终图,必须有耐久标记贯穿 workflow、UI result、persistence 和 merge 规则,不能让后续 provider/job 同步把组合结果当普通原图覆盖。Logo 替换 prompt 属于定向编辑合同,不得复用通用清理后缀;视觉验收要同时检查后端产物和前端展示方式,避免 `object-cover` 这类展示裁切被误判成生成失败。**

- **#47 ✅ 已修(2026-07-10)· 系统配置接口 2xx 空体被类型断言伪装成有效响应,业务层解引用 `publicBaseUrl` 崩溃**
  根因:`internalApi.request` 为兼容无响应体接口会把 JSON 解析失败降为 `{}`,而 `fetchSystemConfig` 直接用 TypeScript 类型断言返回；反向代理偶发返回 2xx 非 JSON/空体时,`arkService` 读取 `result.config.publicBaseUrl` 触发 TypeError,错误被误记为首图策划失败。
  修复:`fetchSystemConfig` 在专用 API 边界验证 `config` 对象和 `publicBaseUrl` 字符串,异常统一抛 `invalid_response`;策划和生图调用侧保留可选链防御。未把全局 `request` 改成严格 JSON,避免误伤合法无返回体接口。
  如何避免:**TypeScript 类型断言不是运行时契约。关键配置/身份响应必须在具体 API 边界验形,但不要为了一个严格端点全局收紧通用客户端。**

- **#48 ✅ 已修(2026-07-10)· provider 已出结果后单次下载响应体 `terminated`,成功生成被降成任务失败**
  根因:`persistRemoteAsset` 和图片变换分支都只执行一次 `fetch + arrayBuffer`;CDN/网络在响应体读取中途断开时,undici 抛 `terminated`,没有下载级重试,导致已有上游结果的 job 在本地持久化阶段失败。
  修复:结果文件统一经过 `fetchRemoteAssetBufferWithRetry`;只对幂等 GET 的连接错误、读取超时、`429/5xx` 做有限重试,`4xx` 直接失败,并统一标记 `providerStage=asset_download`。超时、次数和退避均可由 env 调整,生成提交路径不参与重试。
  如何避免:**把“上游生成提交”和“结果文件下载”分成两个重试域。前者涉及扣费不能盲重提,后者是幂等 GET,应覆盖 fetch 和 body read 两个阶段。**

- **#49 ✅ 已修(2026-07-10)· 首图多参考策划用 `Promise.allSettled` 吞掉同步中状态,把 pending 子任务写成策划失败卡**
  根因:`requestAnalysisResponseDetailed` 已把仍活跃的 backend job 表达为 `job_timeout` 可恢复同步异常,但 `generateFirstImageReplicationSchemes` 在 `Promise.allSettled` 后把所有 rejected 统一映射成 `status=error`;`shellWorkflow` 随即生成 `planningFailed`,Shell 顶层的活跃 job 恢复分支没有机会执行。
  修复:首图聚合器发现 `job_timeout/task_not_found` 同步缺口时原样抛出,外层记录 `sync_pending` 后继续透传；Shell 仅当后台 job 仍为 `queued/running/retry_waiting` 时保留 planning 卡,终态失败仍落错误卡。
  如何避免:**批量聚合器不能把控制面状态和业务失败压成同一种 rejected。`allSettled` 后必须先识别 pending/取消/失败语义,再决定部分成功或整批等待。**

- **#50 ✅ 已修(2026-07-10)· 发布脚本不检查活跃任务直接 PM2 restart,部署窗口制造 `provider_submit_stale`**
  根因:旧部署流程只检查代码审查和依赖安全,远端 install/build 完成后无条件重启 PM2；正在素材准备或 provider 提交、尚未拿到 task id 的 job 会被进程终止,随后只能依赖 stale 回收,表现为部署时段集中 `provider_submit_stale`。
  修复:新增只读部署就绪检查,按 `internal_jobs.status=running` 汇总 providerless/已提交任务；上传代码前和远端构建后各检查一次,任一时点有活跃任务即 fail closed。仅保留显式 `MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS=1` 紧急覆盖,默认发布不得使用。
  如何避免:**进程重启是任务系统状态迁移,不是纯代码操作。任何部署脚本在 restart 前都必须证明没有活跃执行；构建耗时较长时必须在构建前后双检,不能只做一次开场快照。**
