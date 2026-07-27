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
- Regression check:
- Avoid next time:
```

## 2026-07-23 - Single-upstream stop/start deployment makes public 502 inevitable

- Symptom: 官网今天多次在发布期间返回 502，恢复后过一会又出现；日志中可对应到 PM2 `STOPPED -> RUNNING` 空窗。
- Environment: Tencent Cloud production / Nginx single upstream `127.0.0.1:3100` / PM2 one process / release path.
- Root cause: 旧发布脚本在新进程 ready 前先 `pm2 stop` 唯一后端，Nginx 必然暂时无上游；这不是 provider、内存或磁盘故障。架构级根因见 `CLAUDE.md` #79，诊断指纹为 `deploy:single_upstream_stop_start:public_502`。
- Fix: 正式进程改为单实例 `cluster + wait_ready`，服务只在完成 bootstrap 与 HTTP listen 后发 ready，退出时优雅关闭 worker/Temporal/HTTP/连接池。发布先 drain 写请求与任务，所有 MySQL worker claim 与部署最终屏障共用同一命名锁并在获锁后重查 marker，再 `pm2 startOrReload`，并用精确 release health 收敛；正常路径不再 stop/restart 唯一进程或操作 iptables。新 release 未通过时即使旧进程仍健康，也保留 `manual` marker 与 mutex，不让未验证的盘上代码在重启后接受写入。
- Regression check: `server/processLifecycle.test.mjs`、`server/pm2Contract.test.mjs`、`server/deployClaimLock.test.mjs`、`scripts/deploy_tencent.test.mjs`、`scripts/assert-deploy-health.test.mjs`、`server/deployDrain.test.mjs` 锁定 ready/优雅退出/cluster/release 身份/写请求排空、claim 竞态与禁止 stop-start；`npm run test:pm2-reload` 用真实 PM2 跨 A→B 连续探测 0 失败。云上先用 3101 候选完成旧 fork 首迁，再用标准脚本真实发布到 `meiao-zero502-standard-844605f95229`；绕过本机代理连续直连首页与 health 共 2000 次，HTTP 502、网络错误及其他状态码均为 0，且云上正式进程为单实例 `cluster_mode`、marker/mutex/3101 候选均已清理。
- Avoid next time: 发布时序是公网可用性合同。单上游不得在候选实例 ready 前停止；验收必须连续探测公网状态码并核对 release ID，不能只在发布结束后看一次 health。

## 2026-07-23 - X-Accel asset delivery requires nginx traversal on the application root

- Symptom: 多桑一键主详任务已成功、积分已结算且卡片显示“已出图”，但图片区域破图；同一结果 URL 公网返回 403。
- Environment: Tencent Cloud production / local generated result asset / `MEIAO_ASSET_X_ACCEL=1` / Nginx worker `www`.
- Root cause: 首次零停机迁移的 `rsync -a` 把开发机仓库根目录的 `0700` 和数值 owner 复制到生产应用根。PM2 root 直连读取返回 200，但 Nginx `www` 无法穿过应用根目录执行 X-Accel 内部文件映射，因此公网交付返回 403；provider、任务结果、资产记录和物理 JPEG 均正常。
- Fix: 云上应用根目录恢复 `root:root 0755`，不重提任务；标准部署脚本在源码复制后、安装构建前只对应用根目录执行 `chmod 0755`，不递归放宽源码、`.env.server` 或资产权限。多桑原图恢复 `200 image/jpeg`，最近 30 个 active 本地资产经 Nginx 抽样均为 200。
- Regression check: `node --test scripts/deploy_tencent.test.mjs` 锁定 copy→chmod→install 顺序并拒绝 `-R/--recursive`；`bash -n scripts/deploy_tencent.sh`；部署后核对应用根目录 0755、`.env.server` 原权限、真实 X-Accel 结果 URL 200 及文件长度一致。
- Avoid next time: X-Accel 验收必须覆盖 Nginx worker 的完整目录穿透权限，不能用 PM2/root 直读 200 代替；保留元数据的 tar/rsync 不得覆盖生产应用根权限。

## 2026-07-22 - Managed image validation must trust bytes, not browser MIME labels

- Symptom: 多个账号上传 `.jpg` 素材时集中出现“图片类型与文件内容不一致”，项目在策划/生图前失败；同一素材会让连续新项目重复报错。
- Environment: Tencent Cloud production / one-click first image and all managed source-image uploads / multipart upload before provider submission.
- Root cause: 服务端已经从文件魔数识别出受支持的 WEBP/PNG，却又要求浏览器声明的 `image/jpeg` 与检测结果完全一致。合法但扩展名或客户端 MIME 不准确的图片因此在 `asset_upload` 阶段被拒绝；架构级根因见 `CLAUDE.md` #78。
- Fix: 受支持图片以真实字节类型为准并规范化 MIME、素材文件名、COS 对象键和 `Content-Type`；明确非图片声明、未知签名和不受支持格式继续拒绝。
- Regression check: `server/managedImageValidation.test.mjs` 覆盖 WEBP 字节 + JPEG 声明；`server/assetStore.test.mjs` 覆盖 PNG 字节 + `.jpg` 到完整资产/COS `.png`；`server/tencentCosImageStore.test.mjs` 锁定对象键采用可信 MIME 扩展名，并保留非图片伪装负例。
- Avoid next time: 浏览器 MIME 与扩展名不能充当图片真实性证据。所有上传入口必须复用同一字节嗅探合同，且持久化 MIME、扩展名与存储对象必须一次性归一化，不能只放宽校验而留下错误元数据。

## Standing Lessons

## 2026-07-17 - 项目卡子功能归属必须使用统一结构化契约

- Symptom: 产品还原结果出现在原图精修页签，同一次项目的两次任务恢复成两张重复卡。
- Environment: local development / Tencent Cloud production / shell project hydration and persistence / product restoration.
- Root cause: 旧 retouch job normalizer 不认识 `product_restore` 并默认返回 `original`；通用恢复忽略 payload 中已有的 `shellProjectId`。架构级根因见 `CLAUDE.md` #75。
- Fix: 统一所有当前 module/subFeature 的结构化归属契约，在读取、筛选、前端持久化和服务端合并边界自愈产品还原历史记录；恢复任务统一沿用 `shellProjectId`，同目标只保留较新结果。
- Regression check: 产品还原真实本地 state + jobs 回放只得到一个 canonical 项目，原图精修泄漏为 0，较新结果保留；全量 `lint/test/build`、云上 health、关键文件哈希、COS 真探针与前端资源链通过。云上当前活跃 state 无产品还原历史样本，浏览器 DOM 控制超时，发布后 UI 截图仍属观察项。
- Avoid next time: 新增页签功能必须在同一提交中补齐 scope contract 和 hydrate/persist/merge 回归；未知子功能不得静默落入默认页签，历史归并必须同时有确定性正例和跨功能负例。

## 2026-07-15 - 外部去字幕服务不能读取梅奥本机托管地址

- Symptom: 本地去字幕任务拿到 Golden `providerTaskId` 后失败，供应商返回 `dwf:获取文件大小失败`，错误中出现 `HTTPConnectionPool(host='127.0.0.1')`。
- Environment: local development / internal transcoded video / Golden subtitle removal.
- Root cause: 媒体转码结果持久化为 `http://127.0.0.1:3100/api/assets/file/...`；去字幕适配器只尝试 COS provider URL，解析为空后把原本机 URL 直接提交给 Golden。Golden 随后在自己的运行环境访问 `127.0.0.1`，实际指向供应商服务器而不是梅奥。
- Fix: 去字幕提交统一复用 provider generation media resolver。COS 素材继续签发短期直读 URL；本地/内网托管视频先通过既有 KIE stream upload 转为外部可访问 URL，随后同一 URL 用于服务端探测和 Golden 提交。已存在 `providerTaskId` 的失败任务不自动重提，避免重复扣费。
- Regression check: `node --test server/providerSubtitleRemoval.test.mjs server/managedAssetReadRoute.test.mjs server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs scripts/probe-subtitle-removal.test.mjs`；本地 2.5 秒付费 canary `58468d5d4c32af497b65412b` 成功，存在 provider task ID，源视频和结果视频均为站内托管地址且通过 Range 播放检查，只提交 1 个付费任务。
- Avoid next time: 任何外部 provider 收到媒体 URL 前必须断言它不是 localhost、回环地址或私网地址；本地验收不能只验证浏览器能播放，还必须跑一次 provider 真实读取 canary，并用上游 task ID 区分提交前失败与提交后失败。

## 2026-07-15 - Local product restoration must have a durable image upload mode

- Symptom: 本地已开放“产品还原”且素材/提示词均能恢复，点击开始后项目卡却立即显示“服务暂时不可用”，没有分析 job 或生图 job。
- Environment: local development / product restoration analysis-first workflow / managed image uploads disabled.
- Root cause: 功能门禁与素材存储 readiness 是两条独立配置。本地只持久化了 `MEIAO_PRODUCT_RESTORE_ROLLOUT=all`，但新 source/reference/chat 图片入口默认 `disabled`，且本机没有图片 COS 资源；四张素材因此全部停在 `asset_upload` 前置阶段。前端又把后端 `managed_image_upload_disabled` 503 压成通用 `server_error`，掩盖了可操作的原因。
- Fix: 新增显式 `local` 托管图片模式，复用现有持久化素材库与 provider 服务端中转；只在 `NODE_ENV=development/test` 且素材 origin 为本机/内网时允许，其他情况 fail closed。生产 COS 契约不变，不引入 COS 失败后的本地/KIE fallback。同时对 `managed_image_*` 5xx 保留后端 message/code。
- Regression check: `node --test server/assetStore.test.mjs server/managedImageUploadHealth.test.mjs src/services/internalApi.test.mjs`；本地 health 必须显示 `managedImageUpload.mode=local/status=local_ready/ready=true`；用当前登录态上传一张探针图并立即读回，然后删除，不自动重提付费产品还原任务。
- Avoid next time: 开放任何需要上传素材的新工作流时，门禁验收必须同时检查上传存储 readiness，并用真实上传—读回探针证明已越过 `asset_upload`。线上存储安全合同与本地联调例外必须是显式模式，不得静默 fallback。

## 2026-07-15 - Local rollout must survive the managed server restart

- Symptom: 产品还原在本地验收时可用，后续打开却再次显示“产品还原暂未开放，历史项目仍可查看”，新建按钮灰掉。
- Environment: local development / `com.meiao.current.server` launchd service / product restoration rollout.
- Root cause: 首次验收只通过 launchd 全局环境临时注入 `MEIAO_PRODUCT_RESTORE_ROLLOUT=all`，并在验收后清掉；常驻服务下次重启时从持久配置中读不到该 key，因而按保守默认回落为 `off`。项目/草稿持久化正常，与这条开放门禁是两条独立链路。
- Fix: 把本地测试环境的 `MEIAO_PRODUCT_RESTORE_ROLLOUT=all` 写入 Git 忽略的 `.env.server`，确认无活跃任务后只重启本地后端；新页面重新拉取公开配置后按钮恢复可用。
- Regression check: 验证 `.env.server` 值为 `all`；`launchctl kickstart -k gui/$(id -u)/com.meiao.current.server`；`npm run doctor`；真实浏览器刷新后不再显示门禁文案，“开始产品还原”按钮可用。
- Avoid next time: 需要跨重启保留的本地 feature rollout 必须落在 `.env.server` 或 LaunchAgent 持久环境；`launchctl setenv` 只能用于一次性假设验证。验收结束清理临时环境后，必须再重启一次并验证最终持久状态。

## 2026-07-14 - Image-2 relay exposes only verified 1K and 2K sizes

- Symptom: `image-2中转` 前端暴露 4K，但真实任务输出被上游归一化；固定比例也不能只靠 prompt 稳定约束。
- Environment: Tencent Cloud production / MaxForAI `gpt-image-2` / text generation and image edit / fixed and auto aspect ratios.
- Root cause: 接入时照抄了渠道页的 1K/2K/4K 表，没有以真实输出宽高验证能力；当前真实契约只有 1K/2K，固定比例必须映射为明确 `size`，只有智能比例使用 `auto`。
- Fix: 共享尺寸契约只暴露 1K/2K 和 7 组固定比例尺寸；所有前端模型入口动态收紧选项，历史 4K 在切模和 provider 边界都降级为对应 2K 尺寸。架构级根因见 `CLAUDE.md` #61，诊断指纹为 `maxforai:image_size:unsupported_4k_mapping`。
- Regression check: `node --test src/utils/maxforaiImageModels.test.mjs src/utils/modelCapabilities.test.mjs src/utils/imageModelAvailability.test.mjs server/providerMaxForAiImage.test.mjs server/maxforaiIntegration.test.mjs server/maxforaiEnvDocs.test.mjs`; `node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs`; `npm run build`; 云上依次跑 `auto/1K`、`16:9/1K`、`3:4/2K` 三个单次付费任务并读取返回文件宽高。
- Avoid next time: provider 能力以真实任务和输出文件为准，不以渠道页、请求体或 HTTP 200 为准；新档位必须先跑分辨率×比例矩阵再对用户暴露。

## 2026-07-14 - KIE paid submits may retry only proven pre-connect failures

- Symptom: 多桑账号在 01:03 连续提交 KIE 图片和策划任务，两个 job 都在约 0.63 秒内显示“提交结果暂时无法确认”，KIE 后台没有请求；同一云机的 MaxForAI 图片任务仍成功。
- Environment: Tencent Cloud production / PM2 cold start / KIE `createTask` and chat POST / Cloudflare edge connectivity.
- Root cause: Node `fetch` 的完整错误是 AggregateError，全部子错误均停在 `syscall=connect`：IPv4 `ETIMEDOUT`、IPv6 `ENETUNREACH`，证明 TCP 未建立、上游未接单。旧安全策略把所有非幂等 POST 网络错误一律转成 `provider_submission_unknown` 且不重试，没有区分明确的 pre-connect 与连接建立后的模糊断连。
- Fix: 统一 KIE HTTP 边界只对所有底层原因都属于确定性 connect 失败的请求使用现有 2 次、1 秒/3 秒预算；`UND_ERR_SOCKET/read`、主动超时、混合未知异常和任何 HTTP 响应继续零重提。架构级根因见 `CLAUDE.md` #60。
- Regression check: `node --test --test-name-pattern='TCP 连接明确未建立|提交类 POST 连接层错误标记未知|paid chat submission connection loss|组合路径:模糊提交错误' server/providerGateway.test.mjs`; `node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs server/providerErrorHumanize.test.mjs`.
- Avoid next time: 付费 POST 的安全边界按连接阶段判断：只有能证明连接从未建立才能重试；连接已建立后的异常宁可停下人工核对，也不能因为 provider 后台暂时没记录就重提。

## 2026-07-14 - Optional retouch analysis must not be a single point of failure

- Symptom: 将离账号使用新接入的 Image-2 做商品精修，连续两次在约 1 秒内失败；KIE 后台没有正式任务记录，Image-2 后台也没有出图请求。
- Environment: Tencent Cloud production / product retouch / `retouch_analysis` KIE chat followed by MaxForAI Image-2 generation.
- Root cause: 精修独有的 KIE 视觉分析被当成硬前置。两次控制 job 都以 `provider_submission_unknown/fetch failed` 在拿到 provider task id 前终止，workflow 随即抛错，因此真正 Image-2 job 根本没有创建。同 payload 单次真实探针随后 HTTP 200，排除了模型、key、图片和请求结构错误。客户端连接失败不能证明上游没接单，所以也不能靠自动重发修复。
- Fix: KIE 分析仍优先；仅当分析 job 已进入明确的 provider 终态失败时，按精修模式生成 deterministic 高保真 fallback 并继续提交生图。取消、同步 pending、输入错误和未知程序异常继续失败。保留分析 `errorCode/providerTaskId/jobId`，并把 socket code/syscall/address/port 以脱敏字段带入运行日志；付费 POST 仍为单次提交。
- Regression check: `node --test src/services/arkService.test.mjs src/services/retouchAnalysisFallback.test.mjs src/adapters/shellControlJobLifecycle.test.mjs`; `node --test --test-name-pattern='(提交类 POST 连接层错误|sanitized transport cause)' server/providerGateway.test.mjs server/jobRuntime.test.mjs`; `npm run lint`; `npm run build`; full server/frontend/scripts Node test suites.
- Avoid next time: 新增多阶段生图功能时，逐步标注哪些是主产物必要步骤、哪些只是质量增强。辅助分析必须覆盖“终态 provider 故障仍继续主任务”和“取消/pending/程序错误不降级”；排查时按 analysis job 与 generation job 两段核对，不能只看最终图片供应商后台。

## 2026-07-02 - Buyer-show batch references inherit unscoped input references as set 1

- Symptom: 买家秀输入框已经上传产品图、氛围参考和模特参考，但切到 2/3/4 套后，套数弹窗里的第 1 套不显示这些已有参考图；生成链路也可能把未分套参考图从多套里丢掉。
- Environment: local development / buyer_show shell input / `BottomInputBar` batch popover / `runShellBuyerShowWorkflow`.
- Root cause: 旧多套逻辑把 `buyerShowSetIndex` 当成“只要存在任意分套素材，未标 setIndex 的素材就不属于任何套”。但产品实际语义是：输入框主上传的产品图全套共享，输入框主上传的氛围/模特参考就是第 1 套参考；后续套只补自己的差异参考。
- Fix: UI 预览和 workflow 都改为 `setIndex === 0` 时包含未分套的氛围/模特素材；素材清单只输出分套清单，避免同一参考图同时以全局和分套身份重复进入 prompt。
- Regression check: `node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs --test-name-pattern "buyer show"`; `node --experimental-strip-types --test src/shell/components/destructiveActions.test.mjs --test-name-pattern "buyer show"`; `npm run build`; `npm run lint`.
- Avoid next time: 买家秀多套不是“每套一个产品”。产品图共享，参考图按套区分；未标 `buyerShowSetIndex` 的氛围/模特图必须被视为第 1 套，不得因为其它套有 scoped 素材就被丢弃。

## 2026-07-01 - Stale running jobs must not count as active account concurrency

- Symptom: 买家秀、详情页、视频等多个功能都出现过“任务一直排队/生成中不出图”，同账号旧任务长期占满并发，后续新任务无法开始。
- Environment: Tencent Cloud production / MySQL `internal_jobs` / Temporal task engine / account-level `jobConcurrency`.
- Root cause: `status='running'` 同时表示正在执行、已提交上游等待结果、以及 worker/Temporal 丢失后的孤儿状态。旧并发判断直接按 `running` 计数，导致已达到 stale 回收条件的孤儿任务在 reconciler 漏跑或间隔未到时继续占用账号并发。架构级根因见 `CLAUDE.md` #33。
- Fix: 增加 `isRunningJobConcurrencyBlocking` 单一判据；MySQL worker 和 Temporal activity 的并发检查都改为只统计仍在有效窗口内的 running。providerless、submitted、cancelled stale running 到期后不再占账号并发，并由 reconciler 继续负责失败/恢复/取消落库。
- Regression check: `node --test server/jobManager.test.mjs server/temporalWorker.test.mjs server/jobRuntime.test.mjs server/providerGateway.test.mjs`; `npm run build`.
- Avoid next time: 排队/并发满问题先查 `provider_task_id`、`started_at/updated_at`、`cancel_requested_at` 和 stale 窗口。新增并发判断禁止裸 `COUNT(status='running')`；必须复用同一判据并覆盖 providerless、submitted、cancelled 三种 stale running。

## 2026-06-30 - Seedance reference videos must be duration-checked before submit, and uploaded video previews must load real video frames

- Symptom: 广白账号视频生成失败；用户上传的视频素材在素材条不显示，点开后也不能正常视频播放，只像音频播放。
- Environment: Tencent Cloud production / video generation / `kie_seedance_video` / managed uploaded MP4 assets.
- Root cause: 云上任务 `50723f2bfddcbef7b52cf095` 在 KIE createTask 阶段被拒，`provider_task_id=null`、`provider_submitted=0`，错误为 `The total duration of the video cannot exceed 15 seconds`。上传参考视频约 53 秒，超过 Seedance API 对 `reference_video_urls` 的参考视频合计时长上限 15 秒；生成视频自身的 `duration` 是另一条 4-15 秒范围约束，不与参考视频相加。资产本身是 `video/mp4`，有 `avc1` 视频轨和 `mp4a` 音频轨，HTTP Range 正常；前端缩略图 `preload="none"` 不主动取首帧，灯箱播放器只拿 metadata 且缺少固定视频显示区/错误提示，导致用户看到空白或类似音频控件。
- Fix: `kie_seedance_video` 提交前读取受管 MP4 `mvhd` 时长，参考视频合计超过 15 秒时直接返回中文 `provider_bad_request`，不再调用 KIE `createTask`；KIE 原始英文总时长错误也统一归一成人能处理的中文提示。上传素材缩略图改为主动加载首帧；灯箱视频改为 `<source type=...>`、固定 16:9 可见区域、`preload="auto"`、首帧 seek、播放互斥和错误提示。架构级根因见 `CLAUDE.md` #31。
- Regression check: `node --test server/providerGateway.test.mjs`; `node --experimental-strip-types --test src/components/uiArchitecture.test.mjs src/shell/components/layout/BottomInputBar.test.mjs`.
- Avoid next time: 看到 `provider_task_id=null/provider_submitted=0/provider_bad_request` 要先读 provider 原始限制，不要归因为图床或生成失败。视频播放问题按“资产响应头/Range -> MP4 track/codec/duration -> 前端 video 元素加载策略”逐层排查；有 `vide` track 时优先修播放器显示链路。

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

### Uploaded MP4 preview must distinguish container support from codec support

- Symptom: 将离账号上传 `6_30_15.mp4` 后，灯箱播放器能走进度并播放声音，但画面持续黑屏，看起来像“上传视频不显示”。
- Root cause: 该资产 HTTP、Range 和文件大小都正常；MP4 容器里视频轨道是 `hvc1`，即 HEVC/H.265，音频轨道是 `mp4a`。浏览器能解 MP4 容器和音频，不代表能解 HEVC 视频轨道，所以会只播音频不出画面。
- Fix: 新增 MP4 `hdlr/stsd` 轨道编码解析器；上传时保存 `videoCodec`，旧视频预览时从远程 MP4 头部探测编码；素材条和灯箱对 `hvc1/hev1` 等 HEVC 编码给出明确中文转码提示，不再无解释黑屏。
- Regression check: `node --experimental-strip-types --test src/utils/videoCodec.test.mjs src/components/uiArchitecture.test.mjs`；`npm run build`；真实将离视频 `/tmp/meiao-jiangli-6_30_15.mp4` 解析为 `videoCodecs:["hvc1"]`、`audioCodecs:["mp4a"]`。
- Avoid next time: “MP4 上传成功”不等于“浏览器能显示画面”。有声音无画面时先解析视频轨道 sample entry；`hvc1/hev1` 应提示 H.265/HEVC 转 H.264/AVC，或规划服务端转码，不能继续归因成图床上传或播放器 preload。

### KIE detail image batches must throttle and retry asset staging

- Symptom: 天琪账号 `6月24日项目4` 详情策划成功后，详情页批量生图失败；单张烟测 `gpt-image-2` 可成功，但 UI 实测 7 张详情图同时失败。
- Root cause: UI 一次性创建 7 个 `kie_image` 详情图任务，每个任务带 7 张素材，瞬间形成约 49 次 KIE 图床素材上传。失败事件集中在 `asset_upload` 的 `provider_network_error/fetch failed` 和 `provider_internal_error`；另有任务因 5 分钟内无 providerTaskId 被 `provider_submit_stale` 回收。问题发生在提交 KIE 生图前的素材转存阶段，不是 KIE 已接单后出图失败。
- Fix: `providerKieImage` 对单任务内素材解析/上传限流，默认 2 并发并支持 `MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY` 配置；`jobRuntime` 允许 `asset_upload` 瞬时错误进行一次任务级重试；`jobManager` 对 `kie_image` providerless running job 使用不少于默认 15 分钟的 stale 窗口。
- Regression check: `node --test server/jobManager.test.mjs server/jobRuntime.test.mjs server/providerKieImage.test.mjs`；`node --test --test-name-pattern "kie image|asset upload|managed asset|file-stream-upload" server/providerGateway.test.mjs`。
- Avoid next time: 详情/批量生图必须用“任务数 × 每任务素材数”评估第三方图床压力。单张真实出图成功不等于批量链路成功；排障先看 `provider_task_id`、`provider_submitted` 和 event stage，`asset_upload` 是提交前传输问题，不能归因成已提交的 KIE 生图失败。

### Managed assets must not make KIE file staging a mandatory single point of failure

- Symptom: 2026-07-09 按 job 去重后,多桑、董丹丹、洛克等 7 个账号在一键主详、万物替换、买家秀、产品精修共有 108 个 `asset_upload` 终态失败,全部停在 `providerTaskId=null + asset_upload + provider_network_error/fetch failed`；当天 275 个目标 job 中 154 个成功、117 个以 provider 网络错误终止,属于间歇性退化而非整体中断。
- Root cause: `resolveProviderGenerationMediaUrl` 和 `resolveProviderChatMediaUrl` 对所有我方托管素材强制转存 KIE。已有的图片单任务并发 2 只能限制一个 job，无法限制多个模块、多个账号同时上传；KIE file-stream-upload 一抖，任务在上游接单前直接失败。进程内也没有跨 job 成功 URL 缓存。
- Fix: 我方托管素材在公网 HTTPS 基址可用时直连优先；只有明确文件读取/下载/MIME 失败且无 task id 时才转存 KIE 并重试同一模型，普通 HTTP 500/502 或网络错误不触发回退。拿到任何 providerTaskId 后禁止重提。实际转存使用跨任务进程级并发总闸门、上传专属重试预算和成功 URL TTL 缓存；`kie-only` 保留为环境变量回滚开关。
- Regression check: `node --test server/providerAssetUploadLimiter.test.mjs server/providerAssetTransfer.test.mjs server/providerKieImage.test.mjs server/providerGateway.test.mjs server/providerKieTask.test.mjs`；`npm run lint`；`npm run build`；云上 HTTPS asset、正式托管素材 job 与当天日志聚合验收。
- Avoid next time: 第三方图床只能是兼容性回退，不能是我方托管素材的必经单点。任何媒体回退必须同时证明“原请求确实用了直连”“错误发生在 provider 接单前”“异常里没有 task id”；上传重试可接受重复文件，但生成/聊天提交收到 HTTP 响应后仍不得盲目重试。

### Critical config APIs must validate successful response shapes

- Symptom: 云上首图策划偶发 `Cannot read properties of undefined (reading 'publicBaseUrl')`，同一时段系统配置接口没有业务 4xx/5xx。
- Root cause: 通用 `request` 为兼容空响应体会把 JSON 解析失败降为 `{}`；`fetchSystemConfig` 仅做 TypeScript 类型断言，2xx 空体/非 JSON 因而穿透到 `arkService` 后才以 TypeError 失败。
- Fix: 只在 `fetchSystemConfig` 边界验证 `config` 对象和 `publicBaseUrl` 字符串，异常抛 `invalid_response`；调用侧保留可选链防御，不全局收紧所有内部 API。
- Regression check: `node --experimental-strip-types --test src/services/internalApi.test.mjs`；`node --test src/services/arkService.test.mjs src/services/kieAiService.test.mjs`。
- Avoid next time: 关键配置和身份接口必须做运行时验形；通用 API 客户端仍需兼容明确允许空体的端点，严格性应放在具体契约边界。

### Result persistence must retry idempotent body reads without resubmitting jobs

- Symptom: 万物替换上游任务已有结果 URL，落本地资产时出现 `terminated`，最终项目被标记失败。
- Root cause: `persistRemoteAsset` 和图片变换分支只做一次 `fetch + arrayBuffer`；响应头成功后 body 中断没有重试，provider 的成功结果在本地持久化阶段丢失。
- Fix: 两条结果持久化路径统一使用 `fetchRemoteAssetBufferWithRetry`；连接错误、读取超时、`429/5xx` 有界重试，`4xx` 不重试，错误统一带 `asset_download` 阶段；不会重提任何生成请求。
- Regression check: `node --test server/assetStore.test.mjs server/providerBodyRead.test.mjs server/jobRuntime.test.mjs`。
- Avoid next time: provider 提交和结果下载是不同重试域。结果 GET 可幂等重试且必须覆盖 body read；createTask/chat 等扣费提交不得借此重试。

### First-image planning aggregation must preserve recoverable sync states

- Symptom: 首图多参考任务的 backend planning job 仍在运行或待同步，项目卡却直接出现“策划失败”。
- Root cause: `Promise.allSettled` 把 `job_timeout/task_not_found` 可恢复异常与真实策划错误一起映射成失败 reference；Shell 顶层活跃 job 恢复分支被绕过。
- Fix: 首图聚合器先识别并透传可恢复同步异常；Shell 仅在 backend job 仍为 `queued/running/retry_waiting` 时保留 planning，终态失败不伪装为 pending。
- Regression check: `node --test src/services/arkService.test.mjs`；`node --test --test-name-pattern="one click planning only remains syncable" src/components/uiArchitecture.test.mjs`。
- Avoid next time: 批量聚合必须分别表达 pending、取消和业务失败，不能把所有 rejected 都转成同一种结果卡状态。

### Cloud deploys must drain running jobs before PM2 restart

- Symptom: 少量 `provider_submit_stale` 集中出现在代码发布和 PM2 重启窗口，任务在 providerTaskId 写入前被中断。
- Root cause: 发布脚本完成远端 install/build 后直接 `pm2 restart`，没有查询 `internal_jobs` 活跃执行；代码和前端虽可原子切换，后台 job 仍会被进程重启打断。门禁第一版的第二次检查运行在另一段 SSH shell 中，却没有先加载 `.env.server`，会退化成无凭证数据库连接并在构建后错误中止。
- Fix: `check-deploy-readiness.mjs` 只读汇总 running job；部署在上传前和远端构建后各检查一次，有活跃任务就 fail closed。第二次检查在读取数据库前显式验证并加载 `.env.server`；`MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS=1` 仅供明确承担中断风险的紧急发布。
- Regression check: `node --test scripts/deploy-readiness.test.mjs scripts/deploy_tencent.test.mjs`；`bash -n scripts/deploy_tencent.sh`；正式发布前查看检查输出 `runningCount=0`。
- Avoid next time: 部署门禁必须覆盖业务运行态，不只覆盖代码 diff 和依赖安全；长构建流程要在 restart 紧前再次检查，避免检查与使用之间产生新任务竞态。每段独立 SSH shell 都必须自行加载所需环境，不能依赖上一段 shell 的 `source` 状态。

### Agent vision planning must not pre-upload historical images

- Symptom: 将离账号最新 3 图需求仍只产出 1 张；修复多图覆盖校验后，云上 dry-run 又在进入模型规划前出现 KIE 素材上传超时。
- Root cause: `runAgentConversationV2` 会在首轮 Responses 规划前把 `priorMessages` 中的历史附件、历史生成图和历史 `imagePlan.inputImageUrls` 也走 `prepareModelImageUrl` 批量转存。历史图不是本轮 inline 视觉输入，却会占用本轮规划前的上传链路，并可能污染模型对本轮 3 张新图的覆盖判断。
- Fix: 首轮规划只预转存本轮 `attachments`，并把这些 HTTPS URL inline 给模型；历史消息只进入图片目录文本，不再批量上传。真正引用历史图执行 `generate_image` 时，再由 providerGateway 在提交阶段转存。
- Regression check: `node --test server/agentToolConversation.test.mjs --test-name-pattern "首轮规划只预转存"`；`node --test server/agentToolConversation.test.mjs server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs server/openaiResponsesProvider.test.mjs server/agentCenterSource.test.mjs`。
- Avoid next time: 首轮模型视觉分析的关键路径只允许包含本轮新上传图。历史图可以给模型做文本目录参考，但不能每次请求都先上传到第三方图床；否则会把传输失败伪装成模型/语义失败。

### Agent image results need source/result validation before completion

- Symptom: 将离账号 3 图白底任务返回了 3 张 completed 图片，但黑色加湿器缺失，结果里出现重复瓶类产品；用户看到的是“数量正确但图对不上”。
- Root cause: #22/#24 修复了多图规划覆盖和 KIE 图床 URL 稳定性，但落库前仍只验证输出数量、provider task id 和 URL 列表，不验证每张生成结果是否对应当前源图和语义要求。模型/KIE 可能生成主体错误的图片，原逻辑仍会写 `image_result_ready` 并标记 completed。
- Fix: `runAgentConversationV2` 的正确性边界回到前置确定性链路：本轮新上传图 inline + 图片目录、tool call 计划覆盖率、`input_image_urls` 必须来自目录、强多图语义执行前校验、provider 返回 `imageUrl/providerTaskId` 后立即 checkpoint。移除出图后的模型质检和质检重试，不再用另一层主观模型裁判吞掉用户满意的可见结果。
- Regression check: `node --test server/agentToolConversation.test.mjs --test-name-pattern "不调用后置质检"`；`node --test server/agentToolConversation.test.mjs server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs server/openaiResponsesProvider.test.mjs server/agentCenterSource.test.mjs server/agentImagePlan.test.mjs`；`npm run build`；`npm run lint`。
- Avoid next time: 智能体多图验收不能只数图片数量，但也不要靠“出图后再审图”兜底。正确性应来自输入映射、计划覆盖、工具调用和落库 checkpoint 这些可验证边界；用户对图片是否满意是最终验收。若发现错图，优先修前置图片目录、计划语义、provider 输入或结果映射。

### OpenAI-compatible HTTP 429 must remain a structured rate-limit error

- Symptom: Agent Center 的对话和生图请求多次收到 HTTP 429，但日志长期记录为 `provider_bad_response`；带 inline 图片的请求还会误走“去图后重试”回退。
- Root cause: OpenAI Responses 和 Chat Completions 适配器只区分鉴权失败与通用坏响应，没有把 429 映射到已有的 `provider_rate_limited`。下游带图回退又在已有结构化错误码时继续匹配 `responses 请求失败` 文本，导致限流被误判为图片输入兼容性问题。
- Fix: Responses、Chat Completions 非流式和流式入口统一将 HTTP 429 标记为 `provider_rate_limited`；Agent Center 直连带图回退在存在结构化错误码时只接受 `provider_bad_response`，429 原样返回且不会触发去图重试。显式队列任务仍按既有 `maxRetries` 策略有界处理限流。
- Regression check: `node --test server/openaiResponsesProvider.test.mjs server/openaiToolCalling.test.mjs server/agentToolConversation.test.mjs`。
- Avoid next time: HTTP 状态必须在 provider 边界转成结构化错误码，控制流优先使用错误码；文本正则只允许作为无错误码的兼容兜底。限流不是图片不可读，Agent Center 不能通过删掉用户图片来“恢复”；队列是否重试必须由明确的任务级重试预算决定。

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

## 2026-07-14 - Image edit runtime contracts must be verified separately from text generation

- Symptom: 商品精修先从 GPT-5.4 fallback 到 Sonnet 并成功产出精修指令，但最终项目仍显示失败；Image-2 job 原始错误为 `failed to parse multipart form`。
- Root cause: 控制 job 与主产物 job 是两个阶段，Sonnet 只救回前者。MaxForAI 公开页把 `/images/edits` 写成 JSON URL 合约，实际 New API 运行时编辑路由要求 multipart 二进制 `image` 文件；文生图 JSON 测通不能证明图生图也能用同一 Content-Type。
- Fix: `/images/generations` 保持 JSON；`/images/edits` 先下载和校验最多 16 张参考图，再把 model、prompt、size、n、response_format 与重复 `image` 文件字段组成 multipart。保留付费 POST 单次尝试和提交状态未知保护。
- Regression check: `node --test server/providerMaxForAiImage.test.mjs server/maxforaiIntegration.test.mjs server/providerGateway.test.mjs server/jobRuntime.test.mjs server/temporalWorker.test.mjs server/jobSubmissionPolicy.test.mjs`; `npm run lint`; `npm run build`。
- Avoid next time: 排查 fallback 后失败必须按 job purpose/stage 拆链路；接入第三方 Images API 时 generations 与 edits 分别做真实格式探针，不能从一个端点或公开示例外推另一个端点。

## 2026-07-11 - Paid storyboard recovery must be query-only and state hydration must preserve user work

- Symptom: 多桑、董丹丹等账号的短视频/分镜任务批量出现“素材上传到生成服务失败”，任务重启、stale 回收和页面刷新还可能带来重复付费提交、卡片被旧状态覆盖或多分镜中途停止。
- Root cause: Gemini 分镜视频强制转存 KIE，让 KIE file-stream-upload 成为提交前单点；恢复策略只检查 providerTaskId 非空，没检查该 task type 是否真有旧 ID 查询路径；积分预留和 job 创建不原子，取消/重试/删除读旧快照；fallback 后续模型失败未重复安全判定，checkpoint 写库失败会丢掉已创建的上游任务 ID；前端拿到 job ID 就释放同输入锁，删除/取消不完整，水合又可能用旧 job 覆盖编辑或把 active board 降成可续跑 pending。
- Fix: 我方公网 HTTPS 托管素材 direct-first，仅明确文件读取错误且未接单时回退 KIE，模糊 5xx/提交未知/已有 task ID 不回退；chat 素材解析单 job 并发 2，与进程级上传总闸门/成功 URL 缓存叠加。恢复改成 task type 白名单查旧 ID，不可查询的 chat response/checkpoint 失败进入 `provider_submission_unknown`，MySQL/本地管理员均可 bind/release；fallback 每次失败重新判定。去重+积分预留+job 创建同事务，取消/重试/删除锁行重读；未结算预留、已提交取消任务和提交未知任务禁止删除；分镜 chat/image 创建阶段都零自动重试。前端共享上传 Promise，用稳定 `clientSubmissionKey` 把同输入锁保持到调用终态，后端不按时间/条数截断 active-job 复用；刷新续跑与初次 board 共用 key且避开本地 controller。编辑上传前也注册 controller/语义键；删除/取消汇总 task/result 历史 ID 后取消、更新 `videoMemory` 和墓碑；单 board 删除首个 await 前建 guard/abort,持续收集迟到 job,再从最近 200 条后端历史按 project+board 补齐旧 job,等待活动 job 取消和墓碑落库,失败不开放槽位,成功后以 `autoResumeBlocked` pending 保留槽位,只允许用户主动重生成,不写项目级墓碑、不让旧图复活或自动付费；水合按同 board 最新 job 恢复并保持 active 状态。
- Regression check: `node --test server/jobManager.test.mjs server/jobRuntime.test.mjs server/jobSubmissionPolicy.test.mjs server/providerGateway.test.mjs server/providerAssetTransfer.test.mjs`；`find src -name "*.test.mjs" | xargs node --experimental-strip-types --test`；`npm run build`。
- Avoid next time: 付费任务“恢复”必须只查旧 ID，且 task type 必须有真实幂等查询接口；没有可证明的未提交事实时，不自动重提、退预留或删除记录。模糊 5xx 不得因错误正文命中素材关键词就转存重提；显式同输入键必须覆盖 active 任务完整生命周期，不能在拿到 job ID 时提前释放，也不能受普通时间窗口/候选条数限制。分镜验收不得只跑单 board 快速路径，必须覆盖重启、fallback 中途不确定、checkpoint 失败、重复点击、删除/取消、编辑上传中取消、刷新水合竞争、同 board 多 job 和多 board 续跑。

## 2026-07-13 - Local KIE chat timeout must outlive the provider terminal window

- Symptom: 董丹丹分镜页面显示“Kie 对话请求超时”，KIE 控制台稍后才记录 Gemini 上游 504。
- Root cause: 公网素材直连先被 KIE 明确拒绝为 `Failed to get the file information`；完整 MP4 与 6 张图转存后，KIE/Gemini 第二次推理等待满 300 秒才返回 504。梅奥本地 chat completion 超时硬编码 240 秒，因此永远早于终态中断。
- Fix: 将 KIE chat completion 超时收口为 `MEIAO_KIE_CHAT_COMPLETION_TIMEOUT_MS`，默认 `360000`，覆盖 Responses、Claude、Gemini Flash/3.5 和普通 chat completions；非法配置回到默认。
- Regression check: `node --test --test-name-pattern "KIE chat completion timeout defaults" server/providerGateway.test.mjs`；`node --test server/providerGateway.test.mjs`。
- Avoid next time: 本地同步推理窗口必须高于上游已知最长窗口，且做成 env + 保守默认。延长本地 timeout 只为了收到真实终态，不得宣称它能修复 KIE/Gemini 的 504。

## 2026-07-13 - Paid provider no-retry must include Temporal activity retries

- Symptom: MaxForAI 标准档冒烟 job `3861166dc074925c6d08e590` 显示 `maxRetries=0/retryCount=0`，但同一 job 留下三条 `openai_error` 失败记录。
- Root cause: local Temporal activity 只在开始时 heartbeat，provider 同步请求超过 30 秒就触发 `TIMEOUT_TYPE_HEARTBEAT`；workflow 通用 activity retry 仍有 3 次尝试，重进时对无 providerTaskId 的 `running` job 再次执行 provider。Temporal history 显示最终 `attempt=3`，证明业务层零重试没有约束编排器层重放。
- Fix: local activity 在 provider 执行期间按 `MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS` 周期 heartbeat（默认 10 秒，限制 1-15 秒）并在 `finally` 停止；`provider=maxforai` 使用独立 `singleAttemptActivities`，Temporal activity `maximumAttempts:1`，其他 provider 原策略不变。
- Regression check: `node --test server/temporalWorker.test.mjs server/jobLoggingBehavior.test.mjs`；长请求测试必须观察多次 heartbeat，workflow 测试必须锁定 MaxForAI 单次 activity 尝试。
- Avoid next time: 付费提交的“不重试”要跨 HTTP、job、agent 和 workflow/activity 四层审计；验收必须查 Temporal history 的 `attempt`，不得只看任务表 `retryCount`。

## 2026-07-14 - Image-2 HTTP 200 responses may contain base64 instead of a URL

- Symptom: MaxForAI 冒烟任务 `49f7bf14f1f55d45e42d4d9f` 已收到上游 HTTP 200，本地仍以 `provider_bad_response` 和“返回成功但没有图片 URL”结束，用户看不到已经生成的图片。
- Root cause: 生图请求没有显式传 `response_format: "url"`，响应解析又只读取 `data[0].url`。中转基本透传上游响应，未指定格式时允许返回 `data[0].b64_json`，于是“生成成功”被误判为“响应坏”。旧任务没有保存完整上游响应体，因此不能事后断言它当时一定就是 `b64_json`；可以确认的是请求与解析契约存在这个缺口。
- Fix: MaxForAI 生成请求显式传 `response_format: "url"`；provider 边界同时接受 URL 和经过校验的 `b64_json`。base64 结果在 worker 写入任务终态前立即解码并存入站内托管素材，最终结果只保存托管 URL、素材 ID 和 `providerResponseFormat`，不把原始 base64 写进任务库、Temporal history、日志或前端状态。两种字段都不存在时继续返回脱敏的 `provider_bad_response`，只记录字段名。
- Regression check: `node --test server/providerMaxForAiImage.test.mjs server/assetStore.test.mjs server/maxforaiIntegration.test.mjs server/maxforaiEnvDocs.test.mjs`；真实验收只能新建一次付费任务，并同时核对 `providerResponseFormat`、托管素材可读、Temporal activity `attempt=1`、任务 `retryCount=0` 和积分未变化。
- Acceptance: 本地唯一一次新付费任务 `f8ca4ed58263bf23eb446912` 成功，实际 `providerResponseFormat=url`；结果已转为站内托管 PNG（1254×1254、1,068,708 bytes），Temporal activity `maximumAttempts=1/attempt=1`，任务 `retryCount=0/maxRetries=0`，积分前后均为 0，任务 JSON 和 Temporal history 均无 data URL 或大段 base64。
- Avoid next time: 接入文档不能把一种响应编码写成唯一成功结构。调用方应显式声明偏好格式，同时在 provider 边界兼容合同允许的返回形态；大体积 base64 只能在内存中短暂出现并立即转为托管素材，不得用保存完整响应 JSON 的方式排障。

## 2026-07-14 - Gemini 视频仍被旧 KIE 暂存分支截获，公网托管直连修复并未覆盖视频

- Symptom: 董丹丹短视频与分镜持续出现 `asset_upload` 超时、`Failed to get the file information` 或 Gemini 504；页面看起来像 Gemini 读视频失败，但部分任务实际上在 Gemini 接单前就失败。
- Root cause: 2026-06-22 引入的 `shouldUploadGeminiVideoUrlToOpenRouterChat` 会把除特定 KIE 临时域名外的所有 MP4 强制上传到 KIE `openrouter-chat`。2026-07-10 的 direct-first 修复只覆盖普通托管素材，没有删除这个视频专用分支；因此“已移除 KIE 暂存”的认知与实际代码不一致。COS 签名 URL 也会被当作普通外部视频再次转存 KIE，使 KIE 图床继续成为单点。
- Fix: 删除 Gemini 视频 KIE 暂存判断和转换函数。内部 `/api/assets/file/` 视频由服务端读取后写入私有腾讯 COS，以内容 SHA-256 生成稳定对象键并签发短期 GET URL；已有外部稳定视频 URL 原样交给 Gemini。视频 payload 在 Gemini 明确读文件失败、模糊 5xx 或网络异常时都只失败一次，不进入 KIE media fallback 或模型 fallback。桶保持私有，无需 CDN，CAM 子用户只授予目标前缀 `PutObject/GetObject`。
- Regression check: `node --test server/tencentCosVideoStore.test.mjs server/providerAssetTransfer.test.mjs server/providerMediaRouting.test.mjs server/providerGateway.test.mjs`；必须同时断言内部视频发生一次 COS put + signed GET、外部 URL 不预下载、所有视频路径 `/file-stream-upload` 调用数为 0、显式读文件失败只调用 Gemini 一次。
- Avoid next time: “移除旧链路”必须搜索并删除路由谓词、转换函数、fallback 和锁定旧行为的测试四层，不能只在通用 managed-asset 分支增加 direct-first。视频真实验收要核对 provider 接单前后的 stage、COS 对象、Gemini 请求次数和 KIE file-stream-upload 次数；页面错误文案不能证明请求已经到 Gemini。

## 2026-07-14 - SSH 内嵌发布脚本的引号必须在本地壳层完整转义

- Symptom: 云上文件同步、构建和 PM2 重启均已执行，服务稍后也恢复健康，但发布输出在清理阶段出现 `syntax error near unexpected token 'fi'`；脚本仍错误返回 0，造成“命令成功但发布门禁没有可信完成证明”。
- Root cause: `deploy_tencent.sh` 把整段远端 Bash 放在本地双引号包裹的 SSH 参数里。新增 drain/cleanup 代码从 `DRAIN_MARKER_FILE` 开始使用了未转义的内部双引号，本地 shell 先把这些引号消费并拆分载荷；`bash -n scripts/deploy_tencent.sh` 只能验证本地脚本外壳，现有单元测试又只解码单个函数，均未检查完整 SSH 载荷的编码边界。
- Fix: 将远端载荷内部全部双引号改成 `\"`，继续保留 `\$` 让变量只在远端展开；新增测试定位 SSH 载荷起止行，拒绝任何未转义内部双引号，并把解码后的完整载荷交给 `bash -n` 验证。
- Regression check: `node --test scripts/deploy_tencent.test.mjs`；`bash -n scripts/deploy_tencent.sh`；真实发布必须同时满足命令退出 0、无 shell syntax error、远端完成证明写入、部署 mutex 释放以及公网 `/api/health` 的 worker 健康。
- Avoid next time: 修改内嵌 SSH shell 时不能只跑顶层 `bash -n` 或函数级测试；必须同时验证“本地源码编码没有裸引号”和“解码后的完整远端脚本能通过语法检查”。发布退出码与线上 health 必须交叉验证，任一异常都不能宣称发布成功。

## 2026-07-14 - Node 网络族自动选择窗口不能短于真实跨境建连延迟

- Symptom: Gemini 视频已经成功写入腾讯 COS，但正式 `kie_chat` 在上游接单前约 0.5 秒连续报 `fetch failed / ETIMEDOUT`，没有 `providerTaskId`；同机 `curl` 请求 KIE 却稳定返回 HTTP 200。
- Root cause: 云主机解析 `api.kie.ai` 同时得到 Cloudflare IPv4/IPv6，Node 20 的 `autoSelectFamilyAttemptTimeout` 默认只有 250ms；上海到 KIE IPv4 的实测 TCP 建连需要约 0.31-0.46 秒，IPv6 不可达时 IPv6/IPv4 尝试都可能在过短窗口内超时。业务层 60 秒 HTTP timeout 和提交重试无法修复底层单地址尝试窗口。
- Fix: 服务启动加载 `.env.server/.env.local` 后调用 `net.setDefaultAutoSelectFamilyAttemptTimeout`；参数收口为 `MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS`，默认 1000ms，限制 250-5000ms。该修复只放宽地址族建连尝试窗口，不增加付费请求重提，也不改变 Gemini 视频只走 COS 的素材路由。
- Regression check: `node --test server/networkRuntime.test.mjs`；云上探针在设置 1000ms 后连续 5 次请求 KIE 均收到 HTTP 200，首次约 1.45-1.86 秒、连接复用后约 0.47 秒；正式验收还必须核对 `providerTaskId`、COS 对象和 Gemini 结构化视频内容。
- Avoid next time: 看到 provider `ETIMEDOUT` 不能只调大业务请求总 timeout；要同时对比 Node fetch 与 curl 的 DNS、IPv4/IPv6 和 TCP/TLS 分段耗时。凡容量、阈值、超时类修复必须 env 化并设置保守默认，且付费 POST 仍只允许在能证明未接单的建连错误上有界处理。

## 2026-07-14 - 用户图片在应用内可读，不代表外部分析模型能稳定读取

- Symptom: 洛克买家秀等功能的素材在页面能打开，但分析/生成任务成批报错；典型证据是 `providerTaskId=null + providerStage=asset_upload`，失败发生在模型接单前。
- Root cause: 历史链路把应用本机磁盘 URL 或 KIE 临时图床当作外部模型的稳定素材源。前者受应用域名/反代/跨网读取影响，后者受临时图床上传稳定性影响；任一抖动都会在 provider 前置阶段让整个任务失败。将存储改为 COS 后，如果仍直接删对象，还会在账号/项目/任务/会话删除与物理删除之间留下不可恢复或泄漏窗口。
- Fix: 未来 source/reference/chat 图片只写入独立私有腾讯 COS，应用层只持久化 `/api/assets/file/...` 稳定 URL，浏览器/provider 读取时签发短期 HTTPS URL。上传按 env 限制单图大小，multipart 预读按真实 boundary/part header 定位文件并校验文件头/MIME，媒体转码 chunked 请求在 reader 阶段限容；COS 失败有界重试并 fail closed，不回落本地/KIE。所有业务删除收敛到持久精确键清理队列，worker 按 owner 复查存活引用，失败指数重试并保留 manual review 记录。素材写入、转码结果与账号禁用/删除共用 owner lock 并在锁内重查 owner；本地 JSON 在锁内落盘。无 providerTaskId 的 Agent 结果以 runId/clientRequestId 保护，终态 status 优先于残留 phase。周期对账清理无引用 Agent result，每日 HEAD 检查 active COS 对象；已确认丢失的 COS 对象不得被旧引用恢复 active，应转 deleted 后 scrub 失效引用。历史素材不迁移，生成结果仍存本地。
- Regression check: `node --test server/tencentCosImageStore.test.mjs server/assetStore.test.mjs server/managedImageUpload.test.mjs server/managedImageValidation.test.mjs server/managedAssetReadResolver.test.mjs server/providerAssetTransfer.test.mjs server/managedAssetDeletion.test.mjs server/assetCleanupWorker.test.mjs server/localJobStore.test.mjs server/temporalWorker.test.mjs scripts/probe-managed-image-cos.test.mjs`；云上还必须跑 `npm run probe:managed-image-cos`，并用项目图、Agent Chat 图、洛克买家秀分析各做一次真实 canary，最后删除 canary 并确认 COS 对象不存在。
- Avoid next time: 素材系统要分别验收应用读取、外部模型读取和业务删除后物理清理三个契约。签名 URL 和密钥不得落库/应用日志，反代访问日志必须丢弃 `asset_key` query；不得用静默 fallback 隐藏图床失败；发布必须先 `disabled` 后探针/canary 再开 `cos`。回归必须覆盖文件边界、并发删除、崩溃孤儿、active 对账和本地全库串行写入。

## 2026-07-14 - 产品还原取消与积分台账必须跨快照单调合并

- Symptom: 用户已中断一批部分完成的产品还原任务，旧页签或后台快照再写入后，项目可能回到 `generating` 并自动补创生图任务；同一类旧快照还会丢掉已记录的分析尝试和已知积分。
- Root cause: 客户端已将取消标记和分析台账做成持久字段，但服务端 `mergeAppStateForStorage` 仍整体浅替换 `generationContext`。另外，旧的显式重试依赖 `undefined` 清标记，JSON 序列化会删掉该字段，服务端无法区分“用户明确重试”与“旧写入本来就没有标记”。
- Fix: 增加可 JSON 序列化的 typed `productRestoreCancellationReset`，用单调时间比较 cancellation/reset 最新事件；服务端与客户端共用纯 `.mjs` 持久状态合并契约。有效取消在缺失 target 状态推导之前强制根项目保持 `error`；显式重试先持久 reset，成功后才清内存 guard/创建 controller 或 job。分析台账改为按 `jobId` 稳定顺序的加性合并，空数组和缺失字段都不再清空历史。
- Regression check: `node --test server/appStateMerge.test.mjs src/adapters/shellProductRestoreCancellation.test.mjs src/adapters/shellControlJobLifecycle.test.mjs src/adapters/shellPersistence.test.mjs src/utils/productRestoreAnalysisCredits.test.mjs`；`npx tsc -b --pretty false`。
- Avoid next time: 用户意图、付费任务门禁和计费台账不能用普通对象展开或“字段不存在”表达清除。凡会被多页签/刷新/后台回写竞争的状态，必须用可序列化的 typed event/revision 按时序合并，并用真实服务端 merge 加水合/恢复回归验证不会重复付费或丢账。

## 2026-07-15 - Provider 专用读取解析器返回空值时必须保留内部托管视频回退

- Symptom: 去字幕 canary 在创建 job 后 181-201ms 失败，错误为 `media_process_failed / 媒体处理失败`，且 `providerTaskId` 为空。公网 Range 读源视频实测为 HTTP 206。
- Root cause: 这是两层前置探测缺口。`resolveManagedAssetReadUrl` 只为 COS 素材签发 provider URL，历史/当前内部磁盘素材按合约返回空字符串，由各 provider 保留原 URL 或走自己的转存回退；新去字幕适配器首先把这个空值交给 FFprobe。补上 URL 回退后，云上 `@ffprobe-installer` 打包版读取 HTTPS 素材又会在 GnuTLS 打开阶段段错误，仍未越过付费 POST 边界。
- Fix: 去字幕适配器优先使用 provider 专用签名 URL，解析器返回空值时回退到已通过 owner scrub 和托管素材验证的原公网 URL；对 owner 一致、active 且 provider 为 internal 的视频，FFprobe 改读服务器本地 `storageKey` 对应文件，Golden 提交仍使用公网 URL。
- Regression check: `node --test server/providerSubtitleRemoval.test.mjs server/managedAssetReadRoute.test.mjs`；必须覆盖 resolver 空值回退、internal 视频本地 probe target、COS 签名 URL 优先级和 owner 隔离。
- Avoid next time: 不同 provider 的素材准备依赖不能只看“解析器可调用”，还要覆盖其合法的空值语义。新接入必须用 internal 与 COS 两种托管类型各跑一条前置媒体探测回归，并用 `providerTaskId`/provider stage 证明失败是否已越过付费提交边界。

## 2026-07-15 - Golden 去字幕区域字段不能混入梅奥任务前缀

- Symptom: 去字幕首次正式 canary 已 checkpoint `providerTaskId`，但供应商约 5 秒后返回 `failed / G:list index out of range`；它能识别 720×1280、约 2 秒和 0.51 MB 的源视频，却没有返回结果视频且 `costRemove=0`。
- Root cause: Golden 提交契约把 `videoName` 当作严格的字幕区域协议，格式必须为 `x1_y1_x2_y2`。梅奥此前为了追踪任务把 job ID 前缀拼进该字段，违反了四段坐标结构；移除前缀后使用同一 2.5 秒素材单变量复测成功。供应商的 `position` 字段在成功任务里仍可能为 `w=0/h=0`，不能把它当成区域解析是否成功的权威证据。
- Fix: `buildSubtitleRemovalSubmitBody` 只发送四个像素坐标，不再把内部任务 ID 放进 `videoName`；梅奥仍通过自身 job 与 checkpoint 字段追踪供应商任务。首次失败没有自动重提，得到用户新的明确授权后才执行第二次单次付费 canary。
- Acceptance: 授权后的 2.5 秒 H.264/AAC canary 在 15.4 秒内成功，Golden `costRemove=3`；job 与 Temporal 均为 1 次 attempt、0 次重试，源/结果都为梅奥托管 MP4 且通过 HTTP Range。结果保持 720×1280、约 2.5 秒和音频，抽取同一时刻画面确认底部测试字幕消失、其他图形保留。探针任务和临时会话已清理，生产 `subtitleRemoval.enabled/configured` 已正式开启。
- Regression check: `node --test server/subtitleRemovalContract.test.mjs server/providerSubtitleRemoval.test.mjs server/providerGateway.test.mjs`；测试必须断言即使传入 `safeTaskId`，`videoName` 仍严格等于四段坐标。
- Avoid next time: 第三方把普通字符串字段复用为位置协议时，不得追加自定义前缀或追踪信息。正式 canary 必须同时核对 provider checkpoint、结果 URL、托管与 Range、媒体参数、画面差异和费用字段；供应商 `position` 只能作为辅助信息。失败后只允许查询旧 ID，不得自动再提交。

## 2026-07-15 - Agent edit requests must never reach the provider without resolved image inputs

- Symptom: 洛克在“对话改图”上传 WiFi 扩展器产品图并要求“根据图1设计5张商品首图，产品不变”后，第二批 5 张结果全部变成清洁喷雾瓶。
- Environment: Tencent Cloud production / Agent Center V2 tool calling / `gpt-5.5` planning / `gpt-image-2` generation.
- Cloud evidence: 产品素材 `e9ac6400b5f61ba2c95cf7a7` 已真实落库且仍出现在第二次 user message 附件中。10:08 的第一批 5 个 `edit_image` 计划均为 `inputImageUrls=[该素材]`，结果保持 WiFi 扩展器；11:37 的第二批 5 个计划均为 `edit_image + inputImageUrls=[]`，但都有 providerTaskId 并成功返回清洁喷雾瓶，排除“素材未上传”和 `asset_upload` 失败。
- Root cause: V2 执行器信任模型工具参数；输入 URL 经会话目录过滤后即使为空也继续调用 `generateImage`。KIE 在零输入时选择 text-to-image。V1 已有恢复/阻断安全合同，但 V2 没有复用。
- Fix: V2 provider 边界按有效目录 URL、明确 `图N`、唯一当前上传图、唯一 current-focus 图依次解析；`edit_image` 或明确引用图片但仍无法唯一解析时抛 `missing_image_input`，绝不提交 provider。明确从零生成的 `new_image` 不继承附件。
- Regression check: `node --test server/agentToolConversation.test.mjs server/agentImagePlan.test.mjs server/providerKieImage.test.mjs`; `node --test server/agent-image-retrieval.test.mjs server/agentConversationReliability.test.mjs server/agentCenterSource.test.mjs server/providerGateway.test.mjs`; `npm run verify`.
- Avoid next time: LLM 工具调用不是可信执行合同。改图/引用语义必须在扣费边界拥有非空且可验证的输入图；无法确定时应失败，不得用零输入静默切换为文生图。新旧 Agent 路径必须共享同一输入安全矩阵。

## 2026-07-16 - Agent managed image inputs must retain owner context through provider scrubbing

- Symptom: 林一账号在 Agent Center 要求“让图1中间的卖点更醒目清晰”时，11:40 与 11:48 两次结果分别变成无关护肤品和男性保健品广告；梅奥日志仍显示 `edit_image + inputImageUrls=[上一张托管结果图]`。
- Environment: Tencent Cloud production / Agent Center shared image conversation / managed `/api/assets/file/...` result / `gpt-image-2`.
- Cloud evidence: 初次任务 `95dee015706e8fdd9419007e1ac5a077` 在 KIE recordInfo 中是 `gpt-image-2-image-to-image` 且含两张 `input_urls`；后续任务 `16be772f239eda0c89430ddc0e18af3b` 与 `febec80cd4ef5e00456b5ec4cfeddf60` 都变成 `gpt-image-2-text-to-image`，上游参数完全没有 `input_urls`。本地 imagePlan 在两个时间点均保留一张托管输入，故丢失发生在计划完成后、provider 提交前。
- Root cause: `executeProviderJobWithManagedAssetScrub` 按 `job.userId` 加载当前账号的 active 素材；共享生图、MySQL 工具生图和本地工具生图调用只传了 payload，没有传 `userId`。首次上传已被转换为 COS 签名 URL，不属于 managed route，因而正常；后续结果使用 `/api/assets/file/...`，清洗器以空 owner 查询得到空素材集并删除 `imageUrls`，KIE 随后按零输入自动选择 text-to-image。7 月 15 日的修复只锁住了计划层输入绑定，没有锁住计划之后的 owner-aware scrub 边界。
- Fix: 所有 Agent Center 规划、检索、直接聊天、Responses 工具规划和三条 `kie_image` 提交路径均显式传递 `user.id`。统一 provider wrapper 在清洗前检测 managed reference 缺少 owner context 时抛 `managed_asset_user_context_missing`；`kie_image` 在清洗后逐项比较原始与最终 `imageUrls`，任何完整或部分丢失都抛 `managed_image_input_removed`，不进入 provider，不扣除错误文生图任务。
- Regression check: `node --test server/managedAssetSubmissionGuard.test.mjs server/agentManagedAssetSubmissionSource.test.mjs server/agentToolConversation.test.mjs server/agentImagePlan.test.mjs server/providerKieImage.test.mjs server/agentCenterSource.test.mjs server/providerGateway.test.mjs`; `npm run doctor`; `npm run lint`; `npm run build`.
- Avoid next time: “计划里有输入图”不等于“上游收到输入图”。所有 owner-aware payload 转换必须把 owner identity 当作显式函数参数，禁止依赖闭包或调用者默认值；付费 image provider 的最终安全门必须比较清洗前后的结构化输入合同，任何输入减少都 fail closed。真实验收必须核对 provider recordInfo 的模型类型和 `input_urls`，不能只看应用日志里的 imagePlan。

## 2026-07-15 - Local draft asset ids must not block durable project checkpoints

- Symptom: 多桑账号两个新首图项目排在列表底部；其中一个后台 `kie_image` 已成功并保存图片，前端仍只显示策划态或不显示图片，刷新后也无法恢复。
- Environment: Tencent Cloud production / one_click first_image / COS managed assets / shell project hydration.
- Cloud evidence: 项目 `proj-plan-1784104061813` 的两个图片 job 均为 `succeeded` 且结果含 `imageUrl/imageUrlAssetId`；账号 `app_states.updated_at` 停在 15:51，早于 16:27/16:29 两个新项目。PM2 错误日志连续出现 `managed_asset_forbidden / asset_reference`。只读审计发现该 state 的 150 个非法候选全部来自 `localAssetId=draft-*`，没有真实跨账号或已删除素材引用。
- Root cause: 素材安全策略用 `key.endsWith('AssetId')` 收集显式托管素材身份，误把浏览器本地草稿 ID 纳入所有权校验，令整个状态快照写入持续 403。项目占位未落库后，一键主详图片恢复又要求先命中 persisted project，成功/失败 job 都无法接回兄弟策划结果。实时新卡的真实毫秒 `createdAt` 没有 `createdAtPrecise` 标记，排序 tier 又让它落到旧卡后。
- Fix: `localAssetId` 不再作为托管素材 ID 校验，真实托管字段继续 fail closed；adapter 按结构化 `shellProjectId` 从成功策划 job 重建恢复种子，并接纳同项目 active/succeeded/failed 图片 job；排序在标记缺失时从规范毫秒戳推断 precise，同时尊重显式 false 的历史脏值。
- Regression check: `node --test server/managedAssetReferencePolicy.test.mjs server/appStateMerge.test.mjs server/assetReferenceCleanup.test.mjs server/managedAssetDeletion.test.mjs`；`node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs src/adapters/shellTerminalJobMerge.test.mjs src/adapters/shellScopeFilters.test.mjs src/utils/syncedProjectPersistence.test.mjs`；把云上真实 3.29 MiB state 与最近 100 条 jobs 喂给本地修复代码，成功项目恢复两张图片、失败项目显示 error，最新项目排在 7月14日项目之前。
- Avoid next time: 新增全快照安全校验时必须用包含 `localAssetId` 的真实历史 state 回放，不能只测简化对象。任何付费/耐久 job 恢复都要覆盖“客户端占位从未持久化”的成功、失败和进行中三态；排序测试必须包含刚创建但尚未水合的新卡。

## 2026-07-15 - Queue-backed project cards must not depend on a remembered active job to keep syncing

- Symptom: 上游已经成功出图、`internal_jobs` 也保存了图片 URL，但项目卡继续显示生成中或没有新图片；用户只有手动刷新页面后才能看到结果。该现象在首图重复出现，并在万物替换中抓到同类生产实例。
- Environment: Tencent Cloud production / shared shell project cards / all queue-backed modules.
- Cloud evidence: 多桑项目 `proj-plan-1784108909613` 的两个 `kie_image` job 分别于 17:58、18:04 成功，但账号持久状态仍是 `generating/0 completed`；把同一份 state 与 jobs 交给当前 `buildShellDataSnapshot` 可立即得到 `completed/2 completed`。南烛万物替换项目也有 3 个成功图片 job 未及时进入页面快照。说明 provider、job ledger、adapter 和成功结果持久化谓词都能工作，断点在浏览器没有执行统一 jobs hydration。
- Root cause: 每个功能页用 `waitForInternalJob` 追踪当前提交，公共兜底却只有在 `pageMode=module` 且浏览器内存仍记得 pending/generating backend identity 时才每 10 秒运行。页面挂起、切页、刷新中断或客户端检查点缺失后，功能内轮询可能停止，公共兜底也因“本地看不到活跃任务”不启动；同时没有 focus/pageshow/online/visibility 前台恢复同步，并发 hydration 也没有单飞保护。刷新页面是唯一无条件重新读取 state + jobs 的入口，因此形成“刷新才显示”。
- Fix: 新增共享 `shellJobSync` 协调器。模块工作台不再按本地活跃任务决定是否同步，而是按可配置周期统一读取 jobs；页面重新可见、窗口聚焦、pageshow 和网络恢复时立即同步。所有 hydration 触发共享 coalesced async runner，同一时刻只允许一个快照请求；首轮失败仍消费已请求的尾随同步。账号切换、退出和离开模块会使 async scope 失效，所有延迟 UI updater 和持久化 writer 在执行时重新校验，禁止旧账号写使用新 token。最近 200 条以外的单 job 补查仅保留 planning/generating/retry_waiting 等活跃 identity，终态历史不再形成 N+1 请求。
- Scope: 一键主详（首图/主图/详情/SKU）、翻译、买家秀、图片升级/产品还原、万物替换、视频生成/分镜/去字幕、小红书封面统一继承该修复。图片裁剪、视频诊断和配置 CRUD 不走这条长任务项目卡链。Agent Center 使用独立会话同步机制，不把本修复误写为已覆盖。
- Regression check: `node --experimental-strip-types --test src/utils/shellJobSync.test.mjs src/shell/shellJobLiveSyncBehavior.test.mjs src/adapters/shellDataAdapter.test.mjs src/utils/syncedProjectPersistence.test.mjs src/adapters/shellRuntimeMerge.test.mjs`；`node --experimental-strip-types --test src/components/uiArchitecture.test.mjs`；`npm run build`。必须锁定：没有本地活跃身份仍周期同步、前台/网络恢复立即同步、首轮失败不丢尾随、切账号/退出后旧延迟写失效、终态历史不会触发单条补查、所有队列模块终态恢复不回退。
- Deployment: `deployed_to_cloud` (`f40b2ca`)。云上首图 canary 后台成功后约 42 秒内在同一未刷新页面自动显示完成结果；结果文件 Range 读取返回 `206 image/jpeg`，随后删除项目并刷新未复活。
- Avoid next time: “刷新后能恢复”只证明 adapter 能读，不证明当前页面会持续同步。任何新增耐久 job 模块都必须默认接入共享同步协调器，并验收正常前台、后台挂起后返回、网络断开后恢复、客户端占位未落库和多标签/切账号场景；不能再以本地 React 状态是否还标记 active 作为服务端真相同步的开关。

## 2026-07-16 - Product restoration analysis must be target-addressable and parse only known provider envelopes

- Symptom: 产品还原分析 job 已成功，原始内容也包含完整产品身份与材质结论，但项目卡报“分析模型未返回可用的产品还原结构”；旧流程即使解析成功，也只会把一条整批共享提示词复制给所有待还原图，无法保证每张图按自身偏差修改。
- Environment: local development / product restoration analysis-first workflow / KIE Responses analysis followed by GPT Image 2 edits.
- Root cause: 解析器对模型内容执行整串 `JSON.parse`，因此 provider 在合法 JSON 后追加的已知 `final_answer` 尾标会让整串解析失败。更深一层是分析到 fanout 的持久化合同只有 `sharedRestorationPrompt`，没有目标索引或素材身份；图片任务无法证明自己拿到的是当前目标图对应的提示词。
- Fix: 新增严格 V2 合同：分析结果必须包含恰好 N 条、索引连续唯一的 `targetPrompts`。解析边界只允许单个 JSON 对象、可选单层代码围栏和精确 `final_answer` 尾标，拒绝其他前后文或第二个 JSON。工作流在任何图片提交前把 `targetIndex` 映射为稳定 `targetMaterialId` 并做一对一覆盖校验；每个图片任务只读取自己的提示词，再套确定性的 RTCFE 产品身份/非产品保护层。V1 只保留显式历史读取与重试分支。
- Regression check: `node --test src/modules/Retouch/productRestoreContract.test.mjs`；`node --experimental-strip-types --test src/services/arkService.test.mjs src/adapters/shellProductRestoreWorkflow.test.mjs src/adapters/shellProductRestoreCancellation.test.mjs src/adapters/shellControlJobLifecycle.test.mjs src/adapters/shellDataAdapter.test.mjs src/adapters/shellPersistence.test.mjs src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs src/shell/components/ProjectCard.productRestoreCredits.test.mjs`；`node --test server/appStateMerge.test.mjs`；`npx tsc -b --pretty false`。
- Avoid next time: provider 原始响应必须在解析器边界用真实回放锁定，只兼容明确归属 provider 的外壳，不能用宽松“截第一个 JSON”猜测。所有 analysis-to-fanout 合同都必须在付费提交前证明目标数量、顺序和稳定身份一一对应；整批共性可以共享，但动态执行提示词必须可寻址到单个目标。

## 2026-07-16 - Product restoration must not combine provider auto ratio with an advertised 2K upgrade

- Symptom: 产品还原界面只可选 2K，项目分析与结果上下文也记录 2K，但真实生图 job payload 是 `resolution=1K`；1254×1254 待还原图返回的仍是 1254×1254，没有完成像素升级。
- Environment: local development / product restoration / GPT Image 2 image-to-image / original-ratio mode.
- Root cause: workflow 把产品还原 quality 正确归一为 2K，却同时固定 `aspectRatio=auto`。共享 GPT Image 2 规范化器将 `auto` 比例强制收敛到 1K，所以 UI config 与最终 provider payload 出现语义分裂。原回归测试只检查 `generationConfig.quality=2k`，甚至明确期望 `aspectRatio=auto`，没有检查这两个字段在 provider 边界的组合结果。
- Fix: 产品还原逐图生成时从当前待还原素材的原始尺寸计算精确比例，将它作为结构化 `aspectRatio` 传入 provider，同时保留 prompt 中不剪裁/不拉伸的原比例硬规则。真实 1:1 canary 的 payload 为 `aspectRatio=1:1` + `resolution=2K`，provider 结果为 2048×2048，刷新后恢复同一 2K 结果和原有 1+3 素材。
- Regression check: `node --test src/adapters/shellProductRestoreWorkflow.test.mjs server/providerKieImage.test.mjs src/services/kieAiService.test.mjs src/shell/modules/Retouch/productRestoreUi.test.mjs`；`npx tsc -b --pretty false`；真实 job `d26915ee39a1a0bf1b4fbb75` / provider `c946833f4bb827a68a90b7b36468a9e1`，结果素材 `2045a5546416c6ce99edf9a9` 为 2048×2048。
- Avoid next time: 任何分辨率与比例支持声明都要在 provider 边界用组合矩阵验证，不能只测 UI 默认值或 workflow 中间 config。真实验收至少核对最终 job payload、provider 任务 ID、结果实际像素和刷新持久化。

## 2026-07-16 - Prepared image identity, provider-readable bytes, and deletion intent must remain durable under concurrency

- Symptom: 多账号同时出现“一键素材没有公网地址”、KIE 生图接单后 `Image fetch failed`、删除后提示远端未完全成功，以及并发时项目状态偶发 403。
- Environment: Tencent Cloud production / one-click planning and KIE image generation / Tencent COS managed images / shared shell deletion tombstones.
- Root cause: 一键入口完成 `generationMaterials` 远端准备后，策划仍误传上传前的 `filteredMaterials`。生成素材转换器又无条件返回 COS 私有临时签名 URL，绕过强制转存，KIE 接单后异步读取失败。删除只并行执行一次 DELETE 与墓碑写入，404/运行中 409 被当成最终失败，服务端没有按持久墓碑继续收敛。历史状态中的失效 `imageUrlAssetId` 等显式身份没有在 state 边界清除，整份状态会被所有权校验拒绝；并发只提高了这些缺口的暴露概率。
- Fix: 策划只接收准备后的 `generationMaterials`。生成链路把 resolver-backed COS 图片先下载并转存为 KIE 文件 URL，聊天默认仍可读取新鲜 COS 签名 URL，历史公网托管素材继续 direct-first。DELETE 对已不存在任务幂等成功，运行中删除展示为后台清理；MySQL 定时读取 `shellDraft.deletedJobIds`，只接受 24 位内部 job ID，并复用取消、积分保护、事务删除和素材引用清理合同持续收敛，摘要进入 `/api/health`。app state 保存/读取前移除失效显式 `*AssetId`，job payload 的 owner 校验仍 fail closed。
- Regression check: `node --test src/shell/preparedGenerationMaterials.test.mjs server/providerAssetTransfer.test.mjs server/managedAssetStateScrub.test.mjs server/tombstonedJobReconciler.test.mjs src/utils/deletionOperations.test.mjs src/services/internalApi.test.mjs server/managedAssetDeletion.test.mjs`；`npm run doctor`；`npm run build`。云上还要验证真实 COS 上传、一键策划、至少两个并发生图、重复 DELETE 和 `health.tombstonedJobCleanup` 收敛。
- Avoid next time: 上传门禁后的素材变量必须一路传到 planning/provider，不能重新引用旧快照。异步 provider 不应依赖短时私有签名 URL；接单前必须落实稳定字节读取合同。UI 删除是耐久意图，不是一次 HTTP 调用；后台收敛必须保留积分与提交未知保护。新增素材身份校验时要同时覆盖历史 state scrub、job payload 严格校验和多账号并发回放，不能通过调大并发掩盖 stage 边界错误。

## 2026-07-16 - Shared job synchronization and tombstone recovery must preserve account and provider identity

- Symptom: 上游已成功而项目卡停在生成中，手动刷新才显示；快速切换账号时旧账号延迟写可能使用新账号 token；已提交上游后取消并删除的任务长期留在墓碑，积分预留和物理删除均无法收敛。
- Environment: Tencent Cloud production / all queue-backed shell modules / multi-account app state / paid asynchronous providers.
- Root cause: 公共同步曾依赖客户端仍记得 active job，页面挂起后停止；补上周期同步后，异步 updater 与写队列仍未绑定账号 epoch 和提交时 session token。删除协调器没有对 submitted-cancelled 任务执行原 ID 查询，恢复能力也未精确到 provider/model；恢复耗尽被压成普通失败，没有人工结算态和 health 告警。协调器每轮全表解析 `app_states.state_json`，稳定性成本随所有账号状态体积增长。
- Fix: 所有队列项目卡固定周期及 focus/pageshow/online/visibility 恢复同步，共享 coalesced runner；账号切换使旧 async scope 和写队列失效，网络请求固定使用捕获 token。删除恢复按 `taskType + provider + model` 真实能力只查询旧 `providerTaskId`；只有明确 provider failed 终态才自动释放，成功无结果、鉴权/配置失败、不可查询或耗尽时进入 `provider_recovery_manual`，保留结果与积分证据。人工核验支持未扣费 release 和已成功实际积分 settle，后者强制记录核验依据并与 ledger/job 更新同事务。无内部预留的无 ID 历史 submission-unknown 按持久删除意图收敛，删除事务仍二次检查 ledger。墓碑协调器改为 `updated_at` 索引增量扫描、未收敛缓存和同毫秒指纹边界，health 暴露 pending reason、age 和 alerting。
- Regression check: `npm run verify`；定向回归覆盖周期/前台/联网恢复、账号切换后旧 UI 与远端写失效、捕获 token、精确 provider 恢复矩阵、query-only 不重提、恢复耗尽人工态、同毫秒游标和删除 409 scheduled 映射。云上真实回放：首图任务不刷新自动显示完成；删除后 job 物理消失且项目未复活；历史 tombstone 从 7 收敛至 0，积分 settle 审计存在；从马哥切到多桑后无马哥项目泄漏。发布后 health 为 `ok`、worker healthy、tombstone pending 0、managed asset backlog 0。
- Avoid next time: 客户端轮询、服务端任务 ledger 和 app state 是三套生命周期，任何一套不能靠另一套“通常还在”作为触发条件。跨账号异步必须携带不可变账号与凭证快照。付费恢复必须区分 create 与 query，并为不可判定终态保留人工审计出口；后台扫描必须与待处理量成比例，而不是与所有用户大状态成比例。

## 2026-07-17 - Project sort must use an immutable, schema-bound creation identity

- Symptom: 马哥首图项目列表刷新后顺序为 26、24、25、23，后创建的项目25 被项目24 压到后面。
- Environment: Tencent Cloud production / shared shell project grid / one-click first image.
- Root cause: 排序使用可变 `createdAt`；项目24 的创建 ID 时间是 `1784188578940`，但完成/水合回写将其字段改为 `1784188830099`，大于项目25。从任意 ID 搜索时间戳的初稿又会误命中随机 job ID。
- Fix: 只信任锚定的 `^proj(?:-plan)?-(timestamp)` 创建型 ID；该不可变时间优先于可变字段，所有非该 schema ID 仍使用自身 `createdAt`。
- Regression check: `node --test src/adapters/shellScopeFilters.test.mjs src/shell/shellJobLiveSyncBehavior.test.mjs src/utils/shellJobSync.test.mjs`；`npx tsc -b`；`npm run verify`；独立复审 Critical 0 / Important 0。真实 24/25 数据回归锁定 25 > 24，随机 `job-1784188578940abcdef01234` 负例锁定不得覆盖真实时间。云上源码 SHA-256 与本地一致，公网生产 bundle 包含同一锚定规则；最终页面 DOM 截图因浏览器控制连接超时未取得，不写成已有发布后 UI 截图。
- Avoid next time: 完成时间和创建时间必须分离。如果只能从 ID 恢复创建顺序，必须先限定明确 ID schema，并在真实正例之外添加随机 ID 负例；不得在任意字符串中搜数字并当作身份。

## 2026-07-20 - 浏览器可选 crypto API 不能成为付费任务入口的前置硬依赖

- Symptom: 多桑账号在出海翻译结果上点击重试时前端提示 `crypto.randomUUID is not a function`；区域修改看似没有真实提交，云上没有新增任务或版本记录。
- Environment: Tencent Cloud production / Translation result retry and region edit / browser runtime without callable `crypto.randomUUID`.
- Cloud evidence: 原始翻译策划与 KIE 生图任务均成功，原图结果已持久化；复现时间之后该账号没有任何 translation retry/edit job，项目仍为单个结果、`retryAttempt=0`、`translationEditVersions=[]`。这把断点限定在浏览器提交入口，而不是 provider、队列或服务端拒绝。
- Root cause: 重试和区域修改两个 handler 都在创建本地占位、版本记录和后端 job 之前直接调用 `crypto.randomUUID()`。当前浏览器暴露了 `crypto`，但没有可调用的 `randomUUID`，因此两个入口共享同一个同步异常；此前真实 provider canary 绕过了这两个 UI handler，未覆盖该浏览器兼容合同。
- Fix: 新增统一 `createRuntimeId`，仅在 `randomUUID` 确实可调用且返回非空值时使用；缺失、非函数、抛错或空返回时改用时间戳、进程内序列和随机后缀生成非空且不重复的 ID。会话、翻译重试结果和区域修改版本全部改走该入口。
- Regression check: `node --test src/utils/runtimeId.test.mjs`；`node --experimental-strip-types --test src/components/uiArchitecture.test.mjs src/modules/Translation/*.test.mjs src/adapters/shellDataAdapter.test.mjs src/adapters/shellPersistence.test.mjs src/utils/runtimeId.test.mjs`；`npm run verify`；`npm run doctor`。回归必须覆盖 API 缺失、非函数、调用抛错、空返回以及同毫秒同随机值的连续调用。
- Avoid next time: 浏览器可选 API 必须用 `typeof ... === 'function'` 检查并提供确定性 fallback，不能只检查对象或属性是否存在。付费 provider canary 只能证明 provider 链路，不能替代重试、修改等真实 UI 提交入口的浏览器兼容验收；无法取得浏览器证据时必须明确标为未观察项。

## 2026-07-21 - Media upload progress and format compatibility must be proved at separate boundaries

- Symptom: 董丹丹上传 13 秒 MP3 后仍显示转换，长时间不完成；支持列表已写 MP3，用户无法分辨是在上传、探测还是 FFmpeg 转换。
- Environment: Tencent Cloud production / short-video reference audio and video / Nginx -> Node multipart upload -> FFprobe/FFmpeg.
- Root cause: `seedance_reference` 的兼容性函数固定返回 false，所以已合规 MP3/H.264 MP4 也重复转码。前端没有接入 XHR 已提供的上传进度；Nginx 默认缓存整个请求，50 MB/300 秒入口限制与应用 200 MiB/600 秒合同分裂；服务端又在读完 multipart 后才有第一条日志，导致上传阶段在用户、应用和日志三处都不可见。云上同文件的 15 秒 H.264 转码实测仅约 4.3 秒，故不是 FFmpeg 性能瓶颈。
- Fix: 会话返回完整源文件兼容性；已合规且不需要裁剪的 MP3 和 H.264 MP4 直接保存，其他素材仍按需规范化。前端显示真实上传百分比和独立探测文案；已兼容时显示“使用原文件并继续”。应用在读取 request body 前记录 owner/content-length；Nginx 为 `/api/media-transcodes/` 单独配置 `proxy_request_buffering off`、203m 和 610s。
- Regression check: 兼容 13 秒 MP3 和完整 H.264/yuv420p MP4 的 FFmpeg 调用次数必须为 0；长于 15 秒、HEVC、非 yuv420p 或用户改动裁剪区间时必须仍转换。同时锁定 `onUploadProgress`、上传起点日志和三层超时/容量对齐；生产验证不调用付费 provider。
- Avoid next time: 上传支持格式不等于每次都要转码；先用 FFprobe 证明是否需要改字节，再决定快路径或 FFmpeg。排查“长时间转换”必须分别查浏览器上传、反代缓存、multipart 读取、FFprobe、FFmpeg 和持久化，不能用一条模拟进度把全链路统称为转码。

## 2026-07-21 - Gemini HTTP 200 policy refusals must not become storyboard JSON successes

- Symptom: 董丹丹连续两次分镜任务显示“模型返回内容不是有效 JSON，原始错误：爆款复刻拆解解析失败”，页面把问题误导为 JSON 解析错误。
- Environment: Tencent Cloud production / viral storyboard / `kie_chat` + `gemini-3-5-flash` / one managed reference video and eight product images.
- Cloud evidence: jobs `32bf77d0e489c5dce10fdb7b` 与 `18777f732156e1ccf8ca0c8b` 都被记录为 `succeeded`、`providerTaskId=null`，但真实 result 是 Google 的 `The prompt could not be submitted... sensitive words... Generative AI Prohibited Use policy` 拒绝文本；两次使用同一个已持久化视频对象。对完全相同的视频 URL 做一次中性 Gemini 3.5 读视频探针，画面、声音及首中尾内容均读取成功，排除了 COS 稳定 URL、视频编码和素材读取故障。
- Root cause: Gemini 用 HTTP 200 返回策略拒绝文本，provider gateway 的成功边界没有识别该固定拒绝形态，于是把拒绝保存为成功结果；前端随后才按分镜 JSON 解析，产生二次误报。原“爆款拆解复刻”提示词又要求高度复现原口播、声音与镜头，容易触发政策拒绝。
- Fix: provider 统一错误分类新增 Google prohibited-use 拒绝识别，命中后以 `provider_refusal` 失败并保留可诊断信息，禁止进入成功解析。爆款模式改为“参考视频结构分析与原创改编”，按 RTCFE 五段约束只提取可观察通用结构，不要求逐字口播、身份、品牌或受保护表达复刻；通用占位商品信息在提交前中性化，下游缺省文案也不再重新注入“爆款复刻”措辞。视频仍以真实 `input_file` 交给 Gemini，不做抽帧或文本兜底。
- Regression check: `node --test server/providerErrorText.test.mjs server/providerErrorHumanize.test.mjs src/utils/videoStoryboardPromptPolicy.test.mjs src/services/videoStoryboardService.test.mjs`; `node --test --test-name-pattern "Google prohibited-use|managed storyboard video|Gemini 3.5" server/providerGateway.test.mjs`; `node --test --test-name-pattern "viral storyboard prompts preserve" src/components/uiArchitecture.test.mjs`; `npm run verify`。集成回归必须锁定 managed video 经测试 COS 签名 URL 作为 Gemini `file_data.file_uri`、仅一次 Gemini 请求、零 KIE 临时上传，并把真实 Markdown 链接拒绝归类为 `provider_refusal`。
- Avoid next time: HTTP 2xx 只证明传输成功，不代表模型完成业务请求；所有 provider 的策略拒绝、配额、鉴权和安全响应都必须在统一 gateway 先分类，再允许业务解析器消费。真实验收必须分别证明素材可读、模型接受提示词、结果符合结构合同，不能把三层合并成“JSON 失败”。

## 2026-07-21 - 出海翻译失败项重试必须继承原任务尺寸合同

- Symptom: 大善账号详情出海选择“原图”后，`丽水篮 (9).jpg` 的失败项重试结果明显变窄，结果页显示比例 `1:4`；原图实际为 790×2132。
- Cloud evidence: 原失败项重试 job `733ace97a92456cdad7db0c8` 使用了界面当前模型 `nano-banana-2`，payload 只有 `resolutionMode=original` 和 `aspectRatio=1:4`，缺少 `shellPurpose`、历史参数快照与 `finalSize`，结果资产为 512×2064。随后按完整重试链路创建的 job `058014bc6557e37cf5e591a0` 携带 `finalSize=790×2132`，持久化结果也精确为 790×2132。
- Root cause: 已完成图片重试和失败项重试是两套实现。前者从 `translationConfigSnapshot` 恢复原任务并写入 `finalSize`；后者读取当前页面参数和当前模型，且调用 `runShellImageGeneration` 时没有传任务元数据。结果既可能换模型，也绕过服务端原图尺寸后处理。界面又优先显示 `matchedAspectRatio`，把 provider 内部匹配比例误呈现为用户选择的输出比例。
- Fix: 失败项重试统一从结果快照或项目生成上下文恢复语言、模型、分辨率模式和比例；原图尺寸优先读取持久字段，缺失时才探测源图。提交元数据统一包含项目/结果身份、源文件、`finalSize`、翻译快照与范围；原图模式缺少尺寸时在付费任务创建前拒绝提交。结果卡在原图模式显示 `auto`，`matchedAspectRatio` 只保留作内部诊断。AI 优化的策划、待生成、生成、完成和失败阶段持久化，刷新后复用既有策划结果并以稳定提交键续跑，避免重复策划计费或重复生成；去文案只允许 AI 直出，服务层同时拒绝用策划提示词覆盖原生去文案提示词。
- Regression check: `node --test src/modules/Translation/translationRetryUtils.test.mjs src/modules/Translation/translationRetryIntegration.test.mjs src/adapters/shellDataAdapter.test.mjs src/shell/components/layout/BottomInputBar.test.mjs`；验收必须同时核对最终 job payload 的历史模型、`resolutionMode=original`、`finalSize`，托管结果资产宽高等于原图，以及策划完成刷新后只续建一次生成任务。
- Avoid next time: 同一按钮支持成功项和失败项时，不得维护两份不同的参数恢复与任务元数据协议。付费重试必须以不可变历史快照为准，界面当前值只用于新任务；“模型生成比例”和“用户输出尺寸”必须分字段展示和验证。多阶段付费流程必须把阶段与幂等身份写入持久层，不能只保存在 React 内存；模式选项与服务端提示词选择必须双层约束。

## 2026-07-22 - 原创分镜不得消费推理草稿或复用参考视频兜底

- Symptom: 董丹丹选择“原创生成”、只上传商品图并在文字输入中提供完整脚本文案后，分镜结果仍出现“参考视频该分镜口播信息未清晰识别”，还生成了多余分段；实际没有上传参考视频。
- Cloud evidence: planning job `726bdd6398d6aca1bec77da3` 的 `videoGenerationMode=original`、视频 `input_file` 数量为 0，`scriptLogic` 含完整用户文案。Gemini 原始响应前部有多轮 6 项推理草稿数组，末尾才是字段完整的 2 分段、12 镜头正式 JSON；正式 JSON 已包含 12 条真实口播。旧解析器取第一个可解析数组，继而给草稿缺失字段写入参考视频兜底。真实响应还使用 `00:02.5` 等小数秒时间码，旧整数时间码正则每段只能保留首镜头。
- Root cause: `extractJsonArray` 只验证 JSON 语法，不验证业务 schema，错误地把 Gemini 推理草稿当正式输出；原创与爆款复刻又共享一套硬编码“参考视频”缺字段兜底，模式边界失守。时间码解析器只接受整数秒，使结构正确的正式结果仍可能被截断。
- Fix: 扫描全部合法数组并按完整分镜合同评分，优先选择同时包含 `storyboardPrompt` 与 `dynamicScriptPrompt` 的最终分段；所有画面、运镜、口播、音效兜底按 `videoGenerationMode` 隔离，原创口播只从用户 `scriptLogic` 文案逐镜头分配，缺失时留空，不伪造视频识别结果；时间码支持小数秒。原创 RTCFE 提示词同时明确“没有参考视频”并禁止输出参考视频未识别文案。
- Regression check: `node --test src/utils/videoStoryboardPlanning.test.mjs src/services/videoStoryboardService.test.mjs`；`npm run verify`；把上述真实云上原始响应交给本地解析器重放，必须得到 2 个分段、12 个镜头、12 条口播且不含任何参考视频兜底。爆款复刻缺字段回归仍必须保留参考视频专用提示。
- Avoid next time: 长推理模型的 HTTP 成功内容不能按“第一个合法 JSON”消费；解析边界必须同时验证业务 schema，并用真实多候选响应回放。共享 normalizer 的任何兜底都必须显式携带业务模式，禁止把一种输入来源的诊断文案泄漏到另一种模式。时间字段必须覆盖 provider 实际可能返回的小数精度。

## 2026-07-22 - 发布启动门禁不得把历史人工恢复积压误判为新进程不健康

- Symptom: 新版本 PM2 已启动，`/api/health` 连续返回 `ok=true`、worker healthy、COS ready，但发布脚本等待 60 秒后仍报“health/worker 未恢复”，随后按失败清理停止新进程，公网短暂返回 502。
- Cloud evidence: 墓碑清理周期已完成且 `errors=0`、`lastError` 为空，但 24 个历史 `provider_recovery_manual` 项令汇总 `alerting=true`。同一时刻应用 HTTP、Temporal poller、COS 探针和转码工具均健康；人工重启 PM2 后立即恢复。
- Root cause: `assert-deploy-health` 把 `tombstonedJobCleanup.alerting=false` 作为进程启动条件。该 `alerting` 同时表示“存在需人工核验的历史业务项”和“本轮协调器执行错误”，语义比发布就绪更宽；历史人工项因此能永久阻断任何无关版本发布。
- Fix: 发布仍要求应用、worker、COS 全部健康，并要求墓碑协调器至少完成一个周期；墓碑门禁改为检查该周期 `errors=0`。历史人工恢复项继续留在 health 中告警和等待审计，但不再伪装成新进程启动失败。
- Regression check: `node --test scripts/hold-deploy-drain.test.mjs scripts/deploy_tencent.test.mjs`。必须锁定：已完成周期且只有人工积压时允许切换；周期未运行或 `errors>0` 时继续 fail closed；HTTP、worker、COS 任一不健康时继续拒绝发布。
- Avoid next time: 健康门禁只能组合与当前发布就绪直接相关、可由本次启动收敛的信号。业务积压告警和进程就绪必须分层表达；新增聚合 `alerting` 时要分别覆盖“执行错误”和“人工待处理”两类真实数据，不能直接把聚合布尔值接入停机判定。

## 2026-07-22 - 分镜策划待确认不能显示为仍在生图

- Symptom: 董丹丹的爆款复刻分镜卡左上角已标“待确认 / 2 个结果”，卡片主体却长期显示“生成中”，用户等待一两个小时后仍认为任务没有完成。
- Cloud evidence: job `c8eff64cd585467dcf721011` 于 09:37:04 创建、09:38:35 成功，实际耗时约 91.6 秒；payload 为 `videoGenerationMode=viral_split`、8 张商品图和 1 个参考视频，结果含 2 个分段。持久项目状态为 `awaiting_image_confirmation`，两块 board 都是 `pending` 且没有 board image job；审计时该账号没有任何 `queued/running/retry_waiting` 分镜任务。
- Root cause: 爆款复刻按产品流程先返回可编辑策划，再等待用户统一确认生图；但 `toStoryboardShellResultStatus` 把所有非成功/失败 board（包括尚未提交的 `pending`）统一映射为 `generating`。VideoModule 又把所有 pending board 放进结果卡，所以卡片主体显示“生成中”，与项目级“待确认”互相矛盾。项目状态判定也没有让 `awaiting_image_confirmation` 对脏的 `generating` 字段取得最高优先级。
- Fix: pending board 映射为 shell `planning`，真实已提交的 generating board 继续保持 generating；卡片首页对 `awaiting_image_confirmation` 直接显示“分镜脚本已完成，点击详情确认生图”。项目 active/展示状态收敛到纯函数，等待确认强制 `active=false/display=planning`，即使历史字段残留 generating 也不会锁定或误显示；真正 imaging 且仅有待后续提交 board 时仍由项目进度保持生成态。
- Regression check: `node --test src/shell/modules/Video/storyboardGenerationState.test.mjs src/shell/components/ProjectCard.productRestoreCredits.test.mjs src/components/uiArchitecture.test.mjs`；必须同时覆盖脏的 `generating + awaiting_image_confirmation` 显示待确认，以及 `imaging + pending-only` 仍显示生成中并保持操作锁定。生产审计必须核对 planning job 的终态、board image job 是否存在和 app state 三层，不能只看卡片文案。
- Prevention hardening (2026-07-22): 项目级状态统一由 `toStoryboardShellProjectStatus` 提供，`VideoModule` 与 `shellDataAdapter` 禁止再各写一套三元表达式；分段 `planning` 纳入 shell result 公共类型，水合必须保留 `planning`，持久化到 one-click scheme 时只能落为 `pending`，不得 default 成 `completed`。任务卡分段数取 durable `storyboardSourceProject.boards` 与展示 results 的较大值，避免冷启动时显示 0 段。回归门禁必须包含可执行的 persist/hydrate 测试，源码断言只用于锁“所有入口调用共享 mapper”，不能替代行为测试。
- Avoid next time: 项目阶段、子结果阶段和 provider job 阶段不得共用一个模糊的“生成中”。任何需要用户确认后才创建付费 job 的流程，都必须把“尚未提交”“已提交运行中”“结果待同步”分成独立状态，并用真实持久状态回放验证卡片徽标、主体文案和按钮是否一致。

## 2026-07-22 - 出海翻译 auto 与原图尺寸不能靠非等比拉伸对齐

- Symptom: 出海翻译选择 `auto` 和“原图”后，原图 312×840 的任务在结果页显示为 1:4；供应商原始结果实际为 899×1750，服务端又把它强制压成 312×840，商品内容出现明显横向压缩和纵向拉伸。
- Cloud evidence: job `9927a33ff091c08d6e725a68` 的翻译快照仍是 `aspectRatio=auto`，最终生图 payload 却变成 `aspectRatio=1:4`；provider task `bc5f831ced5314652b5c78ed22a73a27` 返回 899×1750，旧持久化结果为 312×840。供应商实际 GPT Image 2 合同只支持 `auto/1:1/9:16/16:9/4:3/3:4`，不支持 1:4。
- Root cause: 翻译模块维护了一份与 provider adapter 不一致的重复比例表，把源图匹配为 GPT Image 2 不支持的 1:4；provider 层又静默省略不支持参数，供应商按自身默认比例出图。结果持久化只验证最终像素尺寸，使用 Sharp `fit:fill` 和浏览器 `drawImage` 非等比填充，因而把供应商比例错误伪装成“尺寸正确”。旧回归只检查宽高，没有检查内容几何、供应商原始尺寸和最终比例漂移。
- Fix: 翻译执行计划统一读取共享模型能力；支持 `auto` 的模型原样透传 `auto`，不再预映射为 1:4。原图输出在任何非等比缩放前比较自动旋转后的真实几何，超过 2% 即阻止发布；远程 URL 与 MaxForAI base64 两条结果路径都把原始输出保存为 quarantine 证据，并以 `image_output_aspect_ratio_mismatch` 终止用户可见成功。该类错误明确标记 provider 已完成，MySQL/Temporal/local 四条 worker 路径结算已发生的费用、保存结果证据，重启对账也保持 settle，不能悬挂预留或错误退款。
- Regression check: `node --test server/imagePostProcess.test.mjs server/assetStore.test.mjs server/jobRuntime.test.mjs server/providerErrorHumanize.test.mjs server/temporalWorker.test.mjs server/localJobStore.test.mjs server/maxforaiIntegration.test.mjs src/modules/Translation/translationProcessingUtils.test.mjs src/modules/Translation/translationRetryUtils.test.mjs`；`npm run verify`；`npm run doctor`。回归必须锁定 899×1750 → 312×840 不执行拉伸、匹配比例仍可等比还原、EXIF orientation 6 使用旋转后尺寸、0.98/1.02 边界、KIE 有 task ID 与 MaxForAI 无 task ID 都保存 quarantine 且 settle、base64 不绕过校验。
- Avoid next time: 模型尺寸/比例能力只能有一个权威来源，不得在业务模块复制 provider 支持列表；未知或不支持的参数不能静默丢弃。真实图片验收必须同时核对用户选择、最终 job payload、provider 原始宽高、托管结果宽高和内容几何，不能把“像素尺寸相等”当成“比例正确”。任何发生在 provider 成功之后的本地合同拒绝都必须有独立的失败、证据留存和计费结算语义。

## 2026-07-27 - 独立视频子功能不得另造一套创建页和 Composer 样式

- Symptom: 「口播翻译」虽已接通媒体准备和任务提交，但页面主体堆叠目标语言、翻译方式、音色和去文案大卡片，底部只剩简化上传条；与短视频生成既有的大输入区、底部胶囊参数栏和右侧提交按钮视觉结构明显不一致。
- Environment: local development / video `voiceover_translation` subfeature / dedicated composer slot.
- Root cause: 独立工作区绕过 `BottomInputBar` 的 Composer 视觉合同，在 `VoiceoverTranslationWorkspace` 内复制页面容器、配置卡和简化底栏。原回归只锁定 portal slot、媒体 profile、草稿和提交合同，没有锁“页面主体不得出现配置卡”以及共享 Composer 原语的真实复用。
- Fix: 从 `BottomInputBar` 提取无业务状态的 `ComposerSurface`、`ComposerToolbar`、`ComposerCapsuleButton`、`ComposerSelect` 和 `ComposerSubmitButton`；标准生成和口播翻译共同消费。口播翻译页面主体只保留项目列表，创建入口在 896px 底部 Composer 内完成单视频点击/拖拽上传、进度、预览、四个有序胶囊和提交；去文案编辑器从同一胶囊浮层打开。
- Regression check: `node --test src/shell/components/VoiceoverTranslationWorkspace.test.mjs src/shell/components/layout/BottomInputBar.test.mjs src/components/uiArchitecture.test.mjs`；`npm run lint`；`npm run build`；浏览器默认视口确认 Composer 宽 896px、无 textarea/横向溢出，820px 视口确认胶囊自然换行、页面 `scrollWidth === clientWidth`。
- Avoid next time: 新增独立子功能可以拥有业务状态和专用 slot，但不能因此重新发明创建入口。设计评审与回归必须同时证明共享视觉原语被两端引用、页面级配置卡不存在、关键控件顺序正确，并把默认与窄视口浏览器观察和技术测试分开记录。

## 2026-07-28 - COS 签名 GET 可下载不等于 KIE Gemini 能读取视频元数据

- Symptom: 口播翻译已完成视频规范化、Demucs 分离和分析素材持久化，Gemini 却在约 0.5 秒内返回 `Failed to get the file information`；素材没有 provider task id，后续 TTS 和混音均未启动。
- Evidence: 同一 H.264/AAC MP4 为 15.042 秒、6,877,005 字节；私有 COS 签名 URL 的分段 GET 返回 206、`video/mp4` 且包含 `ftyp`，HEAD 却返回 403。把同一文件只上传到 KIE file-stream-upload 后，临时地址 HEAD 200、GET 200、`video/mp4` 且完整字节一致；该探针没有创建 Gemini 推理任务。
- Root cause: COS V5 签名绑定生成时指定的 HTTP 方法，当前只签 GET；KIE Gemini 网关会在读取前先用 HEAD 获取文件信息，因此“公网 GET 成功”仍无法满足上游媒体读取合同。旧验收只验证了 GET，没有覆盖真实上游的元数据探测方法。
- Fix: 新增 `MEIAO_GEMINI_VIDEO_MEDIA_MODE=cos-direct|kie-stage`，默认保留 `cos-direct`。KIE Gemini 环境显式使用 `kie-stage`，在任何付费模型 POST 前通过现有 file-stream-upload 取得支持 HEAD/GET 的 URL；上传失败即停在素材准备阶段。模型请求一旦提交，仍禁止自动更换素材路由、重复提交或切换模型。分析阶段的 `provider_config_error` / `provider_bad_response` 只有用户确认可能新增费用后才能递增 attempt 并重试。
- Regression check: `node --test server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs server/voiceoverChildJobStore.test.mjs server/envDocumentationSource.test.mjs`；真实验收分别核对上传 URL 的 HEAD/GET、Gemini 仅一次 POST、分析结果、TTS 子任务和最终托管视频，禁止用“上传成功”替代模型读取成功。
- Avoid next time: 外部模型读取 URL 的验收必须覆盖其实际方法组合（至少 HEAD、Range GET、Content-Type、Content-Length/完整字节），不能只用浏览器 GET 或 curl 下载成功下结论。兼容转存必须发生在付费提交之前，并保持失败后不重提的计费安全边界。

## 2026-07-28 - KIE TTS 文档把数组标成 JSON 字符串，任务可创建但必然在下游解析失败

- Symptom: 口播翻译完成 Gemini 分析和翻译后，首个 `kie_tts` 子任务拿到真实 task id，却终止为 `syntax error, expect {, actual string ... fastjson-version 1.2.56`。
- Evidence: 失败任务的 recordInfo `param.input` 显示 `speakers` 与 `dialogue_turns` 都被二次序列化为字符串。按用户提供文档的完整 speaker 字段提交最小句子仍复现相同 Fastjson 失败；保持其余字段不变，只把两项改为结构化 JSON 数组后，同一 KIE createTask/recordInfo 链路成功并返回一个 HTTPS 音频结果。
- Root cause: 文档参数表和示例要求字符串，但当前 KIE 下游实际按对象数组反序列化；createTask 入口没有拒绝错误类型，而是在异步任务中失败，导致“拿到 task id”被误当作请求合同正确。
- Fix: provider body 改为结构化 `speakers` / `dialogue_turns` 数组；speaker 补齐 `audio_profile`、`style=Deadpan`、`pace=Natural`、`accent=Neutral`。输入预算按最终真实 JSON body 的 UTF-8 字节重新计算。已失败且有 task id 的子任务保留审计记录，只能由用户确认后创建递增 attempt，不能覆写旧 ID。
- Regression check: `node --test server/providerKieTts.test.mjs server/voiceoverAnalysis.test.mjs server/providerGateway.test.mjs server/voiceoverTranslationRunner.test.mjs`；真实 canary 必须分别记录字符串形态的确定失败和数组形态的成功 task id，正式父任务还需验证远程音频转站内托管、时长对齐、混音和最终 MP4。
- Avoid next time: 异步 provider 的 create 200/task id 只证明入口接单，不证明 payload 通过真实模型合同。首次接入必须用最小 live canary 跑到终态；若文档与可复现行为冲突，保留证据、锁定终态成功形态，并把旧 task id 当作不可变审计记录。

## 2026-07-28 - 口播 TTS 成功后必须复用任务、容忍瞬时空状态并以资产 ID 水合播放器

- Symptom: 结构化数组修复后，KIE TTS 已成功生成音频，但父任务先被首轮空 `state` 判为 `provider_bad_response`；恢复后 8.92 秒英语音频又因目标窗为 15.07 秒、所需 `atempo=0.592` 低于 0.75 而失败。最终 MP4 已落库时，本地 3000 页面仍把后端返回的绝对 3100 素材 URL 判为不安全并显示“完成但未返回结果视频”。
- Environment: local development / KIE Gemini 3.1 Flash TTS / checkpoint retry / FFmpeg alignment / shell job hydration.
- Root cause: 轮询器把任务创建后的瞬时空状态当终态协议错误；时间适配把“短音频可以安全补静音”和“长音频会被裁词”混为同一越界；Shell 同时校验服务端权威 `finalAssetId` 与开发端口绝对 URL，错误要求 API 端口和页面端口同源。
- Fix: 空 `state` 只在同一 task ID 的有界轮询内按 waiting 处理，未知非空状态继续拒绝；TTS 查询失败且 checkpoint 已有 task ID 时按 stage 复用，不能误路由到新的分析/语音提交；短音频把速度钳制到配置的可理解下限后补静音，长音频超过最大加速仍失败；Shell 有服务端资产 ID 时忽略持久化绝对 URL并重建同源 `/api/assets/file/:id`，只有缺少资产 ID 时才校验 URL。
- Regression check: `node --test server/providerKieTts.test.mjs server/voiceoverChildJobStore.test.mjs server/voiceoverAudio.test.mjs src/adapters/voiceoverTranslationHydration.test.mjs src/shell/components/VoiceoverResultPlayer.test.mjs`；真实父任务必须保持原 TTS task ID、落库 `actualDurationMs/atempo`、输出 H.264/AAC MP4，并在刷新后显示“已完成”、可切换“翻译结果”和下载。
- Avoid next time: 付费异步任务的短暂查询空窗不能制造新 attempt；音频过短和过长的安全语义不同，前者可补静音、后者不能裁词；浏览器播放必须以受账号鉴权的托管资产 ID 重建 URL，不能把开发/反代 origin 差异当成资源不可信。
