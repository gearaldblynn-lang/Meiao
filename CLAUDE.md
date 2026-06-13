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
- 动手重构前确认 git 工作树干净、可回滚;改完跑 `npm run lint` + 相关 `node --test server/*.test.mjs`。
- **跑测试的命令**(本项目没装 tsx):
  - 后端 `.mjs` 测试 → `node --test server/xxx.test.mjs`
  - 前端 `.test.mjs`(会 `import './xxx.ts'`)→ 必须加 `node --experimental-strip-types --test src/.../xxx.test.mjs`,否则 Node 报 `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`(文档里写的 `node --test` 漏了这个 flag)。
  - 全量:`find src -name "*.test.mjs" | xargs node --experimental-strip-types --test` / `find server -name "*.test.mjs" | xargs node --test`。

## 3. 已诊断根因库 ★(2026-06-12 全栈只读诊断,均已读码确认,**暂未修复**)

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

- **#2 🔴 · 业务状态由"正则匹配报错文字"决定**
  根因:`appStateMerge.mjs:20-38` `isInvalidOneClickPlanText` 硬编码 13 条正则(混中文「策划失败/任务状态同步失败」与上游英文「fetch failed / I cannot fulfill this request / Unauthorized – Authentication failed」)判定方案是否失败;这套正则在 后端 / 前端 / `utils/oneClickPlanValidation.ts` **至少三份拷贝**。
  现象:上游每换一种报错措辞就漏判一次(provider 错误 21+ 指纹反复出现的放大器),且改一份漏两份。
  重构方向:用上游返回的**结构化错误码/状态字段**判定成败,不靠文本;失败语义集中一处。
  如何避免:**禁止用正则匹配报错文案来决定业务状态;状态判定只读结构化字段。**

- **#3 ✅ 已修(2026-06-13)· `retry_waiting` 是后端真值,前端词汇表里没有**
  根因:后端 `jobRuntime.mjs:174-187` 有三态(可重试→`retry_waiting`、耗尽/不可重试→`failed`);前端 result status 联合类型只有 `completed|generating|error`(`shellPersistence.ts:26`),不认识 `retry_waiting`。
  现象:后端"重试中"被前端降级成"失败/生成中"展示→用户重复点重试→后端无响应。
  修复(`src/adapters/shellDataAdapter.ts`):`ShellTaskStatus` + `ShellGeneratedResult.status` 联合类型加上 `retry_waiting`;`taskStatusToTask` 显式返回 `retry_waiting` 不再 default 落到 generating;`resultFromItem`(L698)和"活跃任务 pending result 构造器"(L2100)按 `job.status === 'retry_waiting'` 分流;`normalizeOneClickProjectCard` / `mergeProjectSnapshot` 的 `hasGenerating` 把 retry_waiting 视为"还在跑",项目级状态保持 generating。验证:80 个 adapter 测试 + 635 frontend + 290 backend 全过 + tsc 干净。提交 6a4935b。
  如何避免:**前后端状态枚举必须同源对齐,后端新增状态时前端不得静默降级;新增 status 联合类型成员后,grep 所有 `=== 'generating'` 类硬比对站点,确认每处都正确分流。**

- **#4 🟠 · 数据模型把"整个项目快照"塞进 app_state 一行 JSON**
  根因:`appStateMerge.mjs:66-93` 的 `compactGenerationContextForStorage/compactOneClickProjectForStorage` 在拼命剥 `projects/tasks/generationContext`——是原始设计把整棵项目树嵌进单行 JSON 的化石证据。剥不净→单条 INSERT 超 MySQL 16MB / `/tmp` errno 28→`Pool is closed`(看板 17 次)→temporal 残留 stale job→PM2 重启 203 次。
  现象:数据库连接池关闭、磁盘写满、后台任务堆积。
  重构方向(中期):把项目/结果数据从 `app_states` 单行 JSON 里搬出去,改成规范化存储或按需加载。
  如何避免:**单行状态记录里不得嵌套整棵项目树;大对象分表/分行存。**

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
