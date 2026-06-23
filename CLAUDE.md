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
