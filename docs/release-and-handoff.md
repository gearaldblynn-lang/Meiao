# 发布与接手说明

> 本文后半部分包含历史发布记录，不再代表当前版本。当前真实分支、提交、版本标签和质量基线先看 `docs/CURRENT.md`；运行 `npm run status:write` 可刷新。

## 1. 项目真实位置
- 当前主工作目录：
  `/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本`

## 2. 标准版本流程
- 这个项目当前不是 GitHub 自动部署。
- 当前标准流程是：
  1. 本地修改并验证。
  2. 发布时只保留两个本地目录：`梅奥MEIAO-当前版本` 和 `梅奥MEIAO-备份版本-版本号`。
  3. 用当前工作目录生成或覆盖当次发布对应的备份目录，不额外堆历史版本文件夹。
  4. 在当前工作目录对应仓库里提交 Git。
  5. 推送到 GitHub 作为备份。
  6. 再手动部署到腾讯云用于内部使用。

## 3. GitHub 信息
- Git 远端仓库：
  `https://github.com/gearaldblynn-lang/Meiao.git`
- 默认分支：
  `main`
- 说明：
  - GitHub 当前主要用途是代码备份和历史留档。
  - 推送到 GitHub 不会自动更新线上服务。

## 4. 腾讯云发布信息
- 服务器地址：
  `111.229.66.247`
- 服务器项目目录：
  `/www/wwwroot/meiao-internal`
- 服务端环境变量文件：
  `/www/wwwroot/meiao-internal/.env.server`
- PM2 进程名：
  `meiao-internal`
- Node 服务端口：
  `3100`

## 5. 发布命令
- 本地发布脚本：
  `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`
- 如需显式指定密钥或服务器：
  `MEIAO_SSH_KEY=~/.ssh/MEIAO.pem MEIAO_SERVER_HOST=111.229.66.247 MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`
- 说明：
  - 该脚本会把本地代码同步到腾讯云目录。
  - 服务器上会执行 `npm install`、`npm run security:audit`、`npm run build`。
  - 若依赖树仍有 high/critical 级别漏洞，发布会在构建和 PM2 reload 前停止。
  - 运行中任务、写请求、部署 marker、互斥锁、COS 就绪和精确 release health 均通过后，才用 PM2 `cluster + wait_ready` 合同执行 ready-gated reload；旧进程在新进程 ready 前继续服务。

## 6. 发布后验证
- 健康检查：
  - `http://111.229.66.247/api/health`
  - `http://111.229.66.247:3100/api/health`
- 如果要确认系统配置接口是否正常：
  - 先登录后再访问 `/api/system/config`
- 若健康检查返回 `{"ok":true,"mode":"internal-mysql-v1"}`，说明服务基本在线。
- 若生产环境开启 `MEIAO_ASSET_X_ACCEL=1`，还必须抽取一个当前账号真实托管结果素材做双层验收：Node 直连和正式域名都返回 `200`、正确媒体类型且字节数/哈希一致。仅 health 正常、任务成功或 Node 直连成功，不能证明 Nginx 已能交付图片。
- 应用根目录 `/www/wwwroot/meiao-internal` 必须允许 Nginx 用户穿越（标准脚本固定为 `0755`），但 `.env.server` 继续保持 `0600`；禁止用递归 chmod 修复资源权限。

## 7. 当前接手判断规则
- 不要默认以 GitHub 为线上真实版本。
- 当前应优先按下面顺序判断版本事实：
  1. 本地当前工作目录
  2. 当前 Git 提交与未提交改动
  3. 腾讯云服务器目录实际代码
  4. GitHub 远端备份是否已追平
- 如果发现“云端比 GitHub 新”，优先补齐 GitHub 备份，而不是假设线上出了问题。

## 8. 新会话接手时必读文件
- `AGENTS.md`
- `项目交接上下文.md`
- `docs/project-overview.md`
- `docs/tencent-cloud-deploy.md`
- `docs/cloud-update-data-cleanup.md`
- `docs/release-and-handoff.md`
- `src/services/loggingService.ts`
- `src/modules/Account/AccountManagement.tsx`

## 8.1 接手时必须先继承的交互原则
- 所有新需求、改版、Bug 修复、管理后台、CLI、对话式交互、系统反馈，都先遵守 `项目交接上下文.md` 里的“全项目交互设计原则”。
- 如果技术实现、代码结构、开发习惯与用户体验冲突，优先保证用户体验。

## 9. 已知事实
- 当前项目面向公司内部多人使用，不是公网 SaaS。
- 已存在内部账号、用户隔离、日志系统。
- 当前部署模式是“手动确认后发布”，不是持续自动交付。
- 3001 壳前端同步到云上前，必须按 `docs/cloud-update-data-cleanup.md` 巡检并清理历史垃圾卡，尤其是默认 `idle` 视频诊断被误显示为项目卡、测试账号残留项目、切账号后的前端内存态残留。

### 9.1 图片升级 / 产品还原发布边界

- 截至 2026-07-14，`图片升级 / 产品还原` 仅完成本地实现和本地验证，未推送、未部署，腾讯云当前不具备该功能。
- 产品还原采用分析优先生命周期：全部待还原套图与有序产品参考图先形成一份共享产品身份，再按每张待还原图生成一个结果。待还原套图限制 1-10 张，产品参考图限制 1-5 张；同一任务只处理一个 SKU，超限选择整批拒绝。
- 六项重点还原默认选中“形态与结构、材质与纹理”；默认分辨率为 2K，4K 只对支持模型出现，不提供 1K 和比例/宽高控制。
- 发布时必须显式决定 `MEIAO_PRODUCT_RESTORE_ROLLOUT=off|admin|all`：`off` 禁止新建，`admin` 仅管理员，`all` 允许所有已登录用户；缺失或非法值按 `off`。门禁只影响新建，不能隐藏或破坏历史项目。
- 未经单独发布确认，不得运行部署脚本，也不得把本节的“本地完成”改写为“云上可用”。

### 9.2 口播翻译发布边界

- 截至 2026-07-27，本地分支已具备“短视频 → 口播翻译”的输入、翻译/TTS、本地分离混音、耐久任务和结果回放代码；尚未 push、deploy 或调用任何真实 Gemini、KIE、Golden，腾讯云仍未开放该功能。
- 发布采用 disabled-first：先把 venv 和非量化 `mdx` 权重装在 release 目录外，保持 `MEIAO_VOICEOVER_TRANSLATION_ENABLED=0` 跑只读 readiness；只有 Python/model/FFmpeg、KIE 凭证和资源 sizing 全部通过且用户再次批准，才在候选环境改为 `1`。
- `npm run probe:voiceover-translation -- --readiness`、`--fixture-path` 和两个 `--resume-*` 模式均不得创建 provider 任务。live 只接受用户明确确认的 managed asset ID，并要求一次性 `MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1`；`--remove-text` 需第二次确认额外 Golden 成本。
- 远程探针的非敏感 `MEIAO_VOICEOVER_PROBE_BASE_URL` 可按候选环境配置；`MEIAO_VOICEOVER_PROBE_POLL_INTERVAL_MS` 默认 `4000ms`、范围 `500-30000ms`，`MEIAO_VOICEOVER_PROBE_TIMEOUT_MS` 默认 `2400000ms`、范围 `60000-7200000ms`。敏感 `MEIAO_VOICEOVER_PROBE_SESSION_TOKEN` 只允许当前 shell 临时输入，单次 `MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1` 只允许命令前缀；二者不得持久化，env 文件中的确认会被忽略。
- live 证据只公开内部 `parentJobId` / `childJobId` 和有界检查点摘要。`--resume-child-task-id` 必须使用该内部 `childJobId` 直接只读查询，不能用 `providerTaskId`，也不能扫描父任务列表或重新 create。
- 发布验收拆分：自动化/技术证据不能替代真人试听和浏览器验收。技术栏记录检查点、托管素材、编码、Range、刷新/服务重启恢复；感知栏记录原口播抑制、背景保留、语言、节奏与画面一致性。
- 回滚只禁用新提交，历史卡片和结果继续可读。生产 CPU、内存、磁盘、分离并发、模型目录、部署和真实付费 canary 均属于新的授权边界。

## 10. 维护要求
- 只记录长期有效的项目事实。
- 如果发布流程、GitHub 仓库、服务器地址、PM2 名称有变化，要直接更新本文件。
- 如果某次版本已经推 GitHub 但还没上云，或已经上云但还没推 GitHub，建议在提交说明或交接说明里明确写出。

## 11. 当前发布状态
- 当前待发布版本：
  `V260516-frontend-shell-upgrade`
- 当前本地版本目录：
  - `梅奥MEIAO-当前版本`
  - `梅奥MEIAO-前端壳迁移版`
  - `梅奥MEIAO-备份版本-前端升级前-20260516`
- 本次发布重点：
  - `梅奥MEIAO-当前版本` 已由原全栈当前版本复制而来，并同步 `梅奥MEIAO-前端壳迁移版` 的 3001 前端壳代码。
  - `server/`、`scripts/deploy_tencent.sh`、`.env.server`、腾讯云部署文档和数据清理记录继续保留在当前版本内。
  - `梅奥MEIAO-备份版本-前端升级前-20260516` 是本次前端升级前的完整回滚点。
  - `梅奥MEIAO-前端壳迁移版` 继续保留，作为 3001 前端壳源备份。
  - 旧 `梅奥MEIAO-备份版本-260430A` 已清理，不再作为有效备份。
- 状态说明：
  - 本地验证已完成：`npm run build`、`npm run lint`、`node --test src/utils/appState.test.mjs src/modules/Video/videoDiagnosisUtils.test.mjs src/components/uiArchitecture.test.mjs` 均通过。
  - 本地新依赖树已执行 `npm audit fix`，`npm audit --json` 返回 0 个漏洞。
  - 云上现行 `260430A` 版本只读执行 `npm audit --json` 返回 0 个漏洞；云上仍是旧 3000 构建，尚未同步本次 3001 前端壳升级。
  - 本地当前版本服务已重新启动：前端 `http://127.0.0.1:3000/`，后端 `http://127.0.0.1:3100/api/health` 返回 `{"ok":true,"mode":"internal-v1"}`。
  - 腾讯云尚未执行本次前端升级发布；发布前必须先按 `docs/cloud-update-data-cleanup.md` 做数据巡检和垃圾卡清理。

## 12. 2026-06-08 首图策划失败可见性热修

- 触发问题：云上账号“天琪”的一键主详首图项目“6月8日项目3”提交 5 个参考图策划后，5 个 `kie_chat` 策划任务均以 `provider_submit_stale` 失败，但界面最终只显示 2 张失败策划卡，且失败文案可能继续作为正常方案提交出图。
- 修复范围：
  - `src/adapters/shellDataAdapter.ts`：按每个失败参考图生成 `planningFailed` 失败方案卡，保留 `shellReferenceIndex`，真实失败替换旧占位，不重复抬高 `taskCount`。
  - `src/ShellMigratedApp.tsx`：出图入口拦截失败策划卡，全失败时提示重新策划，混选时跳过失败项。
  - `src/adapters/shellDataAdapter.test.mjs`、`src/components/uiArchitecture.test.mjs`：增加 5 个首图策划全部失败和失败文案不得进入出图链路的回归覆盖。
- 本地验证：
  - `node --test src/adapters/shellDataAdapter.test.mjs`
  - `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "one click generation refuses to turn planning error text"`
  - `npm run build`
- 云上发布：已通过 `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh` 发布到腾讯云 `/www/wwwroot/meiao-internal`，服务器端 `npm audit --audit-level=high`、`npm run build` 通过，PM2 `meiao-internal` 已重启并保存。
- 后续观察：诊断看板继续观察同类 `provider_submit_stale` / provider task id 缺失场景；这类上游提交超时仍可能发生，但前端必须完整显示失败数量并阻止错误文案进入出图。

## 13. 2026-06-08 首图策划失败可见性二次热修

- 触发问题：天琪账号继续出现策划失败；进一步检查发现同日后续项目 `taskCount=5` 但 `plans.length` 仍可能只有 2、3 或 4，说明第一次热修没有覆盖提交后的即时持久化路径。
- 诊断结论：
  - 直接失败边界在上游/网络提交阶段：日志出现 `provider_network_error` / `asset_download`、Temporal activity heartbeat timeout，随后被 stale reconciler 标记为 `provider_submit_stale`。
  - 素材 URL 本身可读，最新项目的 1 张参考图和 4 张产品图均返回 `206 image/jpeg`。
  - 程序问题是双路径缺口：首图策划部分成功时 `runShellOneClickPlanning` 只返回成功 plans；全失败进入 catch 时 `ShellMigratedApp` 只按最新 backend job 写单条错误结果。
- 修复范围：
  - `src/adapters/shellWorkflow.ts`：首图复刻每个 `perReferenceResult` 都返回对应 plan，失败参考图生成 `planningFailed/status:error/selected:false` 卡片。
  - `src/ShellMigratedApp.tsx`：部分失败 toast 显示成功/总数；全失败时拉取同项目 jobs 聚合完整失败 plans 和 error results 后持久化。
  - `src/adapters/shellPlanningFailure.ts`：抽出失败策划 job 聚合与失败 plan 构造 helper。
- 本地验证：
  - `node --test src/adapters/shellPlanningFailure.test.mjs`
  - `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "one click planning keeps failed reference plans visible|one click generation refuses"`
  - `node --test src/adapters/shellDataAdapter.test.mjs`
  - `npm run build`
  - `npm test` 不存在，npm 返回 `Missing script: "test"`。
- 云上发布：已通过 `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh` 发布到腾讯云 `/www/wwwroot/meiao-internal`；云端 `npm audit --audit-level=high`、`npm run build` 通过，PM2 `meiao-internal` 已重启并保存。发布后 `http://111.229.66.247/api/health` 和 `http://111.229.66.247:3100/api/health` 均返回 `{"ok":true,"mode":"internal-mysql-v1","taskEngine":"temporal"}`。

## 14. 2026-07-15 首图状态检查点、结果恢复与新卡排序修复

- 现象：生产账号的新首图项目排到列表最后；上游 `kie_image` 已成功且有图片结果，前端仍不显示，刷新后项目占位也可能丢失。
- 生产证据：目标账号的 `app_states.updated_at` 停在新任务之前，PM2 连续记录 `managed_asset_forbidden / asset_reference`；真实 3.29 MiB 状态快照中被拒绝的 150 个唯一候选全是浏览器草稿字段 `localAssetId=draft-*`，不存在真实跨账号或已删除托管素材。
- 根因：托管素材所有权校验按 `AssetId` 后缀收集字段，误把本地草稿身份当成 `stored_assets.id`，使整份状态写入持续 403。项目检查点未落库后，旧恢复逻辑又要求先命中 persisted project，导致已完成的图片 job 无法接回。同时，刚创建的项目虽有真实毫秒 `createdAt`，却还没有 `createdAtPrecise`，被排序精度层级压到旧卡后。
- 修复：`localAssetId` 不再进入托管素材所有权校验，真实 `assetId/*AssetId` 字段仍对当前账号 active ownership fail closed；前端仅从带 `shellPlanningPurpose=one_click_planning` 与 `shellProjectId` 的成功策划 job 重建恢复种子，并接回同项目的进行中、成功和失败图片 job；排序在标记缺失时从真实毫秒戳推断 precise，显式 `false` 的年缺失历史数据仍下沉。
- 边界保护：删除墓碑 job 和非策划普通对话不得作为恢复种子；无 `shellProjectId` 的旧图片 job 继续不生成幽灵项目卡。
- 发布：业务提交 `33e13bd`，从干净隔离 worktree 通过标准门禁发布。发布前运行中任务为 0，COS `put -> head -> signed GET -> byte equality -> delete -> not-found` 真探针通过，本机与公网 health 均为 `ok`，worker 和托管图片上传就绪。
- 云上验收：目标账号状态在部署后由 15:51 推进到 17:28；16:27 项目持久化为 `completed` 且包含 2 张图，16:29 项目持久化为真实 `error`；最新首图项目按真实时间倒序。本地/云上三个关键源文件 SHA-256 一致。
- 观察入口：云上日志诊断看板指纹 `oneclick-state-local-asset-id-checkpoint-sort`，状态 `deployed_to_cloud`；连续 3 个完整诊断窗口不再出现同根因后才可关闭。

## 15. 2026-07-15 项目卡统一实时同步修复

- 现象：前一轮检查点/恢复修复发布后，仍有新任务出现“上游成功、页面继续生成中，手动刷新才显示”；首图和万物替换均取得生产证据，因此不是单模块解析问题。
- 根因：功能内轮询中断后，公共 jobs hydration 仍依赖浏览器内存里的 active identity；本地状态越旧，越不会主动拉取服务端真相。页面恢复可见、窗口聚焦和网络恢复也没有立即对账。
- 本地修复：公共项目卡同步改为模块级持续轮询，并在 `focus/pageshow/online/visibilitychange` 立即刷新；所有触发经 coalesced runner 串行，首轮失败不丢尾随。切账号、退出和离开模块使 async scope 失效，延迟 UI/持久化写重新校验；单条 job 补查只处理活跃 identity。同步周期由 `VITE_MEIAO_SHELL_JOB_SYNC_INTERVAL_MS` 控制，默认 10 秒。
- 覆盖范围：一键主详、翻译、买家秀、图片升级/产品还原、万物替换、视频生成/分镜/去字幕和小红书封面。Agent Center 使用独立消息同步，不在本条覆盖范围内。
- 本地证据：协调器/账号 scope/生命周期/活跃 job 补查/全模块 adapter 与持久化回归已纳入提交前门禁，并要求通过 `npm run build`。
- 发布状态：`not_deployed`。尚未同步腾讯云，也没有创建新的付费线上 canary；发布后必须用真实运行任务验证无需刷新即可在一个同步周期内显示终态，并检查前台恢复立即对账。
