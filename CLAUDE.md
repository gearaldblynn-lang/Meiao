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

## 3. 已诊断根因库 ★(2026-06-12 全栈只读诊断,均已读码确认,**暂未修复**)

> 这些是"天天修不完 bug、同样问题反复出现"的架构根因。重构顺序已定:**先 #5 止血 → 再 #1/#2/#3 治本 → #4 中期**。
> 修完任意一条后,把该条改成"已修",补上`修复:(文件:行)`+ 把"如何避免"固化成测试。

- **#1 🔴 主病灶 · 任务状态靠"现算",前后端两套算法已漂移**
  根因:`status`(completed/generating/error/planning)从不被记录后直接读,而是每次 merge 时**用启发式现算**(数 media/plan/result 数量 + 正则匹配报错文字),前端 `shellPersistence.ts` 与后端 `appStateMerge.mjs` 各一套且已漂移。4 处实证不一致:
    ① 认"同一项"的 key 集不同——后端递归进 results(`appStateMerge.mjs:157-160`),前端不递归但多了 planId(`shellPersistence.ts:159-163`);
    ② 重复项覆盖规则不同——后端"已完成必胜"级联(`appStateMerge.mjs:397-405`),前端只是浅合并 `{...a,...b}`(`shellPersistence.ts:181-183`);
    ③ stale 占位定义不同——后端通用判断(`appStateMerge.mjs:351-355`),前端硬编码 `content !== '一键主详'`(`shellPersistence.ts:215`);
    ④ taskCount 公式不同(`appStateMerge.mjs:689-695` vs `shellPersistence.ts:269-276`),而两边都用 `completedCount >= taskCount ? 'completed'`。
  现象:卡片一直"处理中"、已完成结果被旧状态覆盖、每次同步翻烧饼。
  重构方向:抽出**前后端共用的单一对账逻辑(single source of truth)**,把"看字符串猜状态"改成读结构化字段;状态存下来直接信,不每次现算。
  如何避免:**任何"任务卡片状态"判断只能有一份实现,前后端共用;新增模块不得再复制一份 merge/normalize 逻辑。**

- **#2 🔴 · 业务状态由"正则匹配报错文字"决定**
  根因:`appStateMerge.mjs:20-38` `isInvalidOneClickPlanText` 硬编码 13 条正则(混中文「策划失败/任务状态同步失败」与上游英文「fetch failed / I cannot fulfill this request / Unauthorized – Authentication failed」)判定方案是否失败;这套正则在 后端 / 前端 / `utils/oneClickPlanValidation.ts` **至少三份拷贝**。
  现象:上游每换一种报错措辞就漏判一次(provider 错误 21+ 指纹反复出现的放大器),且改一份漏两份。
  重构方向:用上游返回的**结构化错误码/状态字段**判定成败,不靠文本;失败语义集中一处。
  如何避免:**禁止用正则匹配报错文案来决定业务状态;状态判定只读结构化字段。**

- **#3 🟠 · `retry_waiting` 是后端真值,前端词汇表里没有**
  根因:后端 `jobRuntime.mjs:174-187` 有三态(可重试→`retry_waiting`、耗尽/不可重试→`failed`);前端 result status 联合类型只有 `completed|generating|error`(`shellPersistence.ts:26`),不认识 `retry_waiting`。
  现象:后端"重试中"被前端降级成"失败"展示→用户重复点重试→后端无响应。
  重构方向:前端状态词汇表与后端对齐,显式处理 `retry_waiting`(不可点重试、提示等待中)。
  如何避免:**前后端状态枚举必须同源对齐,后端新增状态时前端不得静默降级。**

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
