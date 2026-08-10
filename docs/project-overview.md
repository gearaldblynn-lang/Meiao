# 项目概览与接手速查

更新日期：2026-07-14

当前分支、提交、标签和测试规模以 `docs/CURRENT.md` 为准，可运行 `npm run status:write` 刷新。

## 1. 项目定位

梅奥 AI 是公司内部多人使用的电商视觉工具。当前版本以本地开发和腾讯云内部部署为主，不按公网 SaaS 方式运维。

技术结构：
- 前端：React 19 + Vite 6 + TypeScript。
- 后端：Node.js 原生 HTTP 服务，入口为 `server/index.mjs`。
- 数据：本地模式使用 JSON 存储；内部版可连接 MySQL。
- 模型与素材：前端不直连第三方模型，统一走内部 API、任务队列和 provider gateway。

## 2. 当前模块

- 智能体中心：内部专家、知识库、会话、工作室测试和用量统计。
- 一键主详：首图、主图、详情页、SKU 子模块。
- 出海翻译：主图翻译、详情翻译、去文字。
- 买家秀：策划生成、图片生成、历史素材恢复。
- 图片升级：原图精修、白底精修，以及分析优先的产品还原；支持生成、恢复、重试和中断。
- 短视频生成：长视频、Veo、分镜、视频诊断、去字幕和口播翻译。
- 小红书封面：18 种风格封面生成。
- 系统设置：系统状态、队列和配置可见性。
- 账号管理：内部账号、运行日志、统计和日志导出。

`AppModule.PHOTOGRAPHY` 目前是预留入口，侧边栏会显示为即将开放，`src/ShellMigratedApp.tsx` 尚未接入对应业务页面。

### 图片升级 / 产品还原（仅本地）

- 产品还原当前只在本地当前版本完成接线，尚未发布到腾讯云，不得对外宣称云上可用。
- 素材分为两个有序角色：`待还原套图` 至少 1 张、最多 10 张，每张单独产出 1 张结果；`产品参考图` 至少 1 张、最多 5 张，应按结构、细节、材质、颜色的参考价值从左到右排序。单个任务只放同一个 SKU，任一批次超限会整次拒绝，不会截断上传。
- 生命周期为“先分析、后逐张生成”：先从全部目标图和参考图提取一份共享产品身份，再为每张待还原图独立生成。参考图和分析步骤不增加前端展示的出图张数。
- 重点还原可多选六项，默认选择“形态与结构、材质与纹理”；分辨率默认 2K，只有模型声明支持时才显示 4K，不提供 1K 或比例控制。
- 新建任务由 `MEIAO_PRODUCT_RESTORE_ROLLOUT=off|admin|all` 控制，缺失或非法值按 `off` 处理；开关只控制新建，历史项目仍可查看。

### 短视频 / 口播翻译（仅本地、未发布）

- 输入必须是当前登录账号拥有的梅奥托管视频。流程为本地 FFmpeg 提取音轨、本地非量化 Demucs `mdx` 分离人声/背景、Gemini 单次分析与翻译、KIE Gemini 3.1 Flash TTS 分组合成、本地对齐/ducking/混音，再把 H.264/AAC MP4 作为托管结果写回原任务卡。
- “同时去文案”是可选 Golden 阶段，默认区域为底部 30%。它会增加一次 Golden 计费边界；关闭该选项不会调用 Golden。
- 当前只完成本地实现和非付费验证，没有推送、部署或真实 provider canary。腾讯云开通、CPU/内存/磁盘/并发 sizing 和任何真实计费任务都需要用户另行明确确认。
- 回滚只把 `MEIAO_VOICEOVER_TRANSLATION_ENABLED=0` 并正常 reload，停止新提交；历史任务、原视频和已经托管的翻译结果继续可查看和下载。

## 3. 本地运行

推荐：

```bash
npm run local
```

常用入口：
- 前端开发页：`http://localhost:3000`
- 后端健康检查：`http://127.0.0.1:3100/api/health`
- 本地诊断：`npm run doctor`

手动分开启动：

```bash
npm run server
npm run dev
```

智能体多工具：
- 第4期 V2 对话复用 `OPENAI_COMPATIBLE_*` 中转站配置，responses 端点默认 `OPENAI_COMPATIBLE_RESPONSES_PATH=/v1/responses`。
- `AGENT_TOOL_MAX_ROUNDS` 控制单轮对话工具循环上限，默认 5，防止模型反复调用 `search_knowledge` / `generate_image`。
- `AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS` 控制多图独立输出规划欠覆盖时的修复审查轮数，默认 2；仍不完整则快速失败，避免只执行一张却显示完成。

## 4. 关键 API 速查

账号与用户：
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/users`
- `POST /api/users`

智能体与知识库：
- `GET /api/agents`
- `POST /api/agents`
- `GET /api/knowledge-bases`
- `POST /api/knowledge-bases`
- `GET /api/chat/agents`
- `GET /api/chat/sessions`
- `POST /api/chat/sessions`
- `POST /api/studio/test/sessions`
- `GET /api/agent-usage`
- `GET /api/agent-usage/summary`

日志与统计：
- `GET /api/logs`
- `GET /api/logs/meta`
- `POST /api/logs`
- `DELETE /api/logs`
- `GET /api/stats/usage`
- `POST /api/stats/backfill`

状态、系统配置与素材：
- `GET /api/state`
- `PUT /api/state`
- `GET /api/system/config`
- `PATCH /api/system/config`
- `POST /api/assets/upload`
- `POST /api/assets/upload-stream`
- `DELETE /api/assets/by-url`

任务队列与诊断：
- `POST /api/jobs`
- `GET /api/jobs`
- `POST /api/jobs/recover`
- `POST /api/admin/task-platform/jobs/:id/submission-resolution`：管理员对 `provider_submission_unknown` 任务绑定已核实的可查询上游 ID，或在确认未创建上游任务后释放积分预留。
- `POST /api/video-diagnosis/probe`
- `POST /api/video-diagnosis/analyze`
- `GET /api/health`

## 5. 环境变量

核心服务：
- `NODE_ENV`
- `PORT`
- `MEIAO_ALLOWED_ORIGINS`
- `MEIAO_PUBLIC_BASE_URL`
- `MEIAO_JOB_MAX_CONCURRENCY`
- `MEIAO_PRODUCT_RESTORE_ROLLOUT`：`off` 禁止新建产品还原任务，`admin` 仅允许管理员新建，`all` 允许所有已登录用户新建；默认和非法值均为 `off`，不影响历史项目可见性。当前功能仍是仅本地状态。
- `MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS`：默认 `10`；同用户、同语义付费任务的跨进程提交锁等待上限。去重、积分预留与 job 创建在同一 MySQL 事务内完成。
- `MEIAO_DEPLOY_JOB_CLAIM_LOCK_TIMEOUT_SECONDS`：默认 `10`，限制 worker 领取任务与部署最终屏障共用 MySQL 命名锁的等待时间；锁名为代码常量，不允许用环境变量分裂 worker/部署协议。
- `MEIAO_PROVIDERLESS_RUNNING_STALE_MS`：默认代码兜底为 15 分钟；云上建议 `300000`。外部付费任务到期会进入 `provider_submission_unknown`，释放并发但不自动重提或退积分预留；内部幂等任务可安全回到 `retry_waiting`。
- `MEIAO_SUBMITTED_RUNNING_STALE_MS`：默认 `21600000`（6 小时）；只有存在真实上游 ID 查询路径的任务才回到 `retry_waiting` 复查旧结果，不可查询的 chat response ID 停止自动恢复。
- `MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES`：默认 `2`；只用于已记录 providerTaskId 的旧任务查询/结果下载，不用于重提 create/chat POST。
- `MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS`：默认 `60000`；云上建议 `30000`，控制 stale running 任务回收检查间隔。
- `MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS`：云上建议 `120000`；KIE 素材上传单次 HTTP 超时。分镜参考视频等较大素材需要更长上传预算；瞬时网络或上游 5xx 错误允许有限重试后释放并发。
- `MAXFORAI_API_KEY` / `MAXFORAI_BASE_URL`：`image-2中转` 的独立服务端凭证和接口根地址；站内 ID 为 `maxforai-image-2-relay`，上游模型固定为 `gpt-image-2`。密钥不得下发前端，也不复用 OpenAI Compatible 凭证；该模型当前不进入旧积分系统。文生图 `/images/generations` 使用 JSON；图生图 `/images/edits` 按当前 New API 运行时契约使用 multipart 二进制 `image` 文件，不能把公网 URL 对象 JSON 直接交给编辑端点。请求显式携带 `response_format: "url"`，但响应解析仍同时兼容 `data[0].url` 和 `data[0].b64_json`：后者会在任务成功落库前转换为站内托管素材，持久化结果只保留托管 URL、素材 ID 和非敏感的响应格式标记，不保存原始 base64。
- `image-2中转` 分辨率契约：上游仅支持 1K 和 2K，不支持 4K。固定比例必须由请求体 `size` 约束，不只把比例写进 prompt：1K 映射为 1:1 `1024x1024`、16:9 `1536x864`、9:16 `864x1536`、4:3 `1344x1008`、3:4 `1008x1344`、3:2 `1536x1024`、2:3 `1024x1536`；2K 映射为 1:1 `2048x2048`、16:9 `2048x1152`、9:16 `1152x2048`、4:3 `2048x1536`、3:4 `1536x2048`、3:2 `2016x1344`、2:3 `1344x2016`。智能比例不做尺寸推导，始终发送 `size: "auto"`。前端在该模型下只展示 1K/2K，历史 4K 选择在切模或 provider 边界统一降级为 2K。
- `MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS`：默认 `600000`；只控制 Image-2 单次付费生成/编辑 POST 的等待时间。付费 POST 不自动重试，结果不明时进入 `provider_submission_unknown`。
- `MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS` / `MAXFORAI_ASSET_UPLOAD_CONCURRENCY`：默认 `120000` / `3`；保留既有环境变量名，只控制付费编辑提交前下载参考素材并封装 multipart 文件的准备阶段。
- `MAXFORAI_VIDEO_API_KEY` / `MAXFORAI_VIDEO_BASE_URL`：短视频 `Seedance 2.0 Pro 特价` 的独立服务端凭证和根地址，不回退或复用 Image-2 的 `MAXFORAI_API_KEY`。站内 ID 为 `maxforai-sora-v9-pro`，上游模型固定为 `sora-v9-pro`；界面标价 `0.5元/秒` 只用于人民币展示，该渠道站内积分预留和结算均为 0。
- MaxForAI 视频契约：固定 720p，支持 4-15 秒和 `16:9` / `9:16` / `1:1`；可文生视频，也可混合最多 9 张图片、3 个视频、3 个音频，参考视频和参考音频的已知总时长各不超过 15 秒。公网 HTTPS 素材先调 `/assets/url`，站内托管、data URL 和非 HTTPS 素材先用 multipart `/assets` 上传；素材准备失败时不得调付费创建。`POST /videos` 只提交一次，获得 `providerTaskId` 后先检查点落库，再用 `GET /videos/{task_id}` 轮询；断线恢复只查旧 ID，不重提付费 POST。
- `MAXFORAI_VIDEO_CREATE_TIMEOUT_MS` / `MAXFORAI_VIDEO_ASSET_TIMEOUT_MS` / `MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY` / `MAXFORAI_VIDEO_POLL_INTERVAL_MS` / `MAXFORAI_VIDEO_POLL_TIMEOUT_MS`：默认依次为 `60000` / `120000` / `2` / `5000` / `1500000`；只有素材准备和幂等 GET 可做有限幂等重试，付费创建请求不自动重试。
- `MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS`：默认 `10000`，允许 `1000-15000`；长耗时 provider 请求期间持续给 Temporal 保活，避免 30 秒 heartbeat timeout 把仍在执行的付费请求判死。MaxForAI workflow 的 activity 额外强制单次尝试，执行器失联也不会自动重提付费 POST。
- `MEIAO_KIE_CHAT_COMPLETION_TIMEOUT_MS`：默认 `360000`（6 分钟）；KIE 对话/Gemini 同步推理的本地等待上限。该值需高于 KIE 上游常见的 300 秒超时，避免梅奥提前中断而丢失上游真实终态；调大只改善结果回收，不会修复 KIE/Gemini 自身的 504。
- `MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS`：默认 `1000`，限制 `250-5000` 毫秒；Node 在 IPv4/IPv6 候选地址之间切换时，单地址 TCP 建连尝试窗口。用于避免跨境 provider 首次 IPv4 建连超过 Node 20 默认 250ms 后被误判 `ETIMEDOUT`；不改变 provider 总超时或付费提交重试预算。
- `MEIAO_COS_SECRET_ID` / `MEIAO_COS_SECRET_KEY`：Gemini 视频专用腾讯 COS 服务端凭证；必须来自只允许目标桶 `gemini-video/*` 执行 `PutObject`、`GetObject` 的 CAM 子用户，不得下发前端或使用主账号密钥。
- `MEIAO_COS_BUCKET` / `MEIAO_COS_REGION`：Gemini 视频私有桶与地域。内部托管视频会先写入该桶，再把签名 GET URL 直接交给 Gemini；无需 CDN，建议给 `gemini-video/` 设置 3 天自动删除生命周期。
- `MEIAO_COS_SIGNED_URL_TTL_SECONDS`：默认 `10800`（3 小时），限制 `300-86400` 秒；控制 Gemini 可读取 COS 对象的时间窗口。
- `MEIAO_MANAGED_IMAGE_UPLOAD_MODE`：用户新上传图片的存储模式，支持 `disabled|cos|local`。空配置用 `disabled` fail closed；生产标准部署只接受 `cos` 且必须在 PM2 平滑 reload 前通过真探针。`local` 仅允许 `NODE_ENV=development/test` 且公网基址为本机或内网的本地联调环境，生产与公网配置会拒绝启动本地写入。图片 COS 失败时不回退到本地或 KIE。
- `MEIAO_MANAGED_ASSET_ACCESS_SECRET` / `MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET`：绑定素材 ID 与用户的访问 capability 密钥及轮换兼容值；至少 24 字符，只存服务端。
- `MEIAO_IMAGE_COS_SECRET_ID` / `MEIAO_IMAGE_COS_SECRET_KEY` / `MEIAO_IMAGE_COS_BUCKET` / `MEIAO_IMAGE_COS_REGION`：新 source/reference/chat 图片的独立私有 COS 配置，与 Gemini 视频桶及凭证完全分开。云上目标为 `meiao-managed-images-1406860462` / `ap-guangzhou`，CAM 仅授予 `managed-images/*` 的对象读写删权限。
- `MEIAO_IMAGE_COS_BROWSER_URL_TTL_SECONDS` / `MEIAO_IMAGE_COS_PROVIDER_URL_TTL_SECONDS`：默认 `300` / `10800`，分别控制浏览器和外部分析/生成模型的临时签名读取窗口；签名 URL 不落库、不写日志。
- `MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS` / `MEIAO_IMAGE_COS_UPLOAD_TIMEOUT_MS` / `MEIAO_IMAGE_COS_UPLOAD_RETRY_BASE_MS`：默认 `3` / `30000` / `500`；重试幂等上传并复用同一对象键。
- `MEIAO_MANAGED_IMAGE_PROBE_INTERVAL_MS` / `MEIAO_MANAGED_IMAGE_PROBE_MAX_AGE_MS` / `MEIAO_MANAGED_IMAGE_PROBE_STATUS_FILE`：默认 `900000` / `3600000` / `server/data/managed-image-cos-readiness.json`。服务定期执行 put/head/签名读取字节校验/delete/not-found；状态文件只存不可逆配置指纹，密钥不进入 health 或文件。
- `MEIAO_MANAGED_IMAGE_MAX_BYTES`：新上传图片的服务端字节上限，默认 `20971520` (20MB)；同时校验 MIME 与文件头，拒绝伪装图片。
- `MEIAO_ASSET_COS_RECONCILE_INTERVAL_MS`：活跃 COS 记录与对象存在性的 HEAD 对账间隔，默认 `86400000` (24 小时)；缺失对象会进入一致性清理并触发 health 告警。
- `MEIAO_IMAGE_COS_OPERATION_TIMEOUT_MS`：默认 `15000`；限制 COS 签名、HEAD 与删除操作，避免 SDK 回调不返回时卡死 worker。
- `MEIAO_ASSET_DELETE_GRACE_MS` / `MEIAO_ASSET_USER_LOCK_TIMEOUT_SECONDS` / `MEIAO_ASSET_LOCK_CONNECTION_LIMIT`：默认 `120000` / `30` / `20`；素材进入 `delete_pending` 后先留出并发收敛窗口，worker 每条删除前重新核对引用。同账号 COS 上传与账号删除用 MySQL advisory lock 互斥，锁使用独立连接池，不占用业务查询连接。
- `MEIAO_ASSET_AGENT_BUSY_LEASE_MS`：默认 `7200000`（2 小时）；智能体、会话或账号删除仅被新鲜的进行中对话阻挡，超过 lease 的崩溃残留 pending 记录不会导致永久无法删除。
- `MEIAO_ASSET_CLEANUP_INTERVAL_MS` / `MEIAO_ASSET_CLEANUP_BATCH_SIZE` / `MEIAO_ASSET_CLEANUP_RETRY_BASE_MS`：持久精确删除队列默认每 `1800000`ms 处理 `20` 条，重试基数 `60000`ms。账号、项目/任务、聊天/会话、显式素材和过期删除都收敛到该队列。
- `MEIAO_TOMBSTONED_JOB_RECONCILE_INTERVAL_MS` / `MEIAO_TOMBSTONED_JOB_PENDING_ALERT_MS`：默认 `15000` / `900000`ms。MySQL 通过 `app_states.updated_at` 索引增量读取用户 `shellDraft.deletedJobIds`，并持续复查尚未收敛的任务；对仍存在的内部任务复用取消、积分保护、上游 ID 恢复、事务删除与素材引用清理合同。只有上游明确 failed 终态才自动释放预留；成功无结果、查询鉴权/配置失败、无法安全查询或恢复耗尽进入人工核验态。管理员核验未扣费后可 release，核验成功则填实际扣费与依据执行事务化 settle；无内部预留又无任务 ID 的历史提交未知可按用户删除意图收敛。状态摘要位于 `/api/health.tombstonedJobCleanup`，错误、人工恢复和超龄未结算预留会告警。
- `MEIAO_ASSET_CLEANUP_MANUAL_REVIEW_ATTEMPTS` / `MEIAO_ASSET_CLEANUP_MANUAL_RETRY_MS` / `MEIAO_ASSET_CLEANUP_LEASE_MS`：默认 `8` / `86400000` / `600000`；失败任务不丢弃，进程重启后续跑，超阈值进入 manual review。
- `MEIAO_ASSET_CLEANUP_ALERT_BACKLOG` / `MEIAO_ASSET_CLEANUP_ALERT_OLDEST_MS` / `MEIAO_ASSET_UPLOAD_STALE_MS`：默认 `100` / `86400000` / `900000`；`/api/health.managedAssetCleanup` 会报 backlog、最老等待、重试、manual review 和卡住上传。
- `/api/health.managedImageUpload` 暴露 `mode/configured/ready/status/lastProbeAt/lastProbeAgeMs/alerting`，探针失败时只附脱敏 `failureCode`。部署门禁要求 `ready=true`，不再只看 HTTP 和 worker。
- `MEIAO_ASSET_CLEANUP_AUDIT_RETENTION_MS`：默认 `2592000000`（30 天）；只裁剪 complete/protected 审计记录，不删待处理或人工复核任务。
- `MEIAO_KIE_MANAGED_ASSET_MODE`：默认 `auto`；图片、PDF 等非视频素材仅在 `MEIAO_PUBLIC_BASE_URL` 是公网 HTTPS 时直连优先，明确读取失败且无 `providerTaskId` 时才允许转存 KIE。Gemini 视频不受该开关影响，始终使用 COS 或已有外部稳定 URL，禁止 KIE 暂存、KIE 失败回退和模型回退。
- `MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY`：默认 `3`；真正进入 KIE file-stream-upload 时的进程级跨任务并发总上限，补足单任务素材解析限流无法约束多任务同时上传的问题。
- `MEIAO_KIE_ASSET_UPLOAD_RETRIES` / `MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS`：默认 `2` / `1000`；只用于文件上传 POST 的连接错误与 `429/500/502/503/504` 响应重试，不放宽 createTask/chat 等可能扣费的提交 POST。
- `MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS` / `MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES`：默认 `1800000` / `2000`；成功转存 URL 的进程内缓存与容量上限，并发上传同一素材会共享一个 Promise，失败不缓存。
- `MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS` / `MEIAO_RESULT_ASSET_DOWNLOAD_RETRIES` / `MEIAO_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS`：默认 `60000` / `2` / `500`；provider 已完成后抓取结果文件的幂等 GET/响应体读取预算，只重试连接错误、超时、`429/5xx`，不会重新提交生成任务。
- `MEIAO_KIE_HTTP_TRANSIENT_RETRIES`：默认 `2`；KIE HTTP 请求级瞬时重试次数（S2 G1）。只有能证明 TCP 尚未建立的 `connect ETIMEDOUT/ENETUNREACH` 等错误才允许 createTask/chat 付费 POST 安全重试；连接建立后的 `ECONNRESET/UND_ERR_SOCKET`、主动超时和未知异常仍进入 `provider_submission_unknown`。`502/503/504` 响应默认只对只读 GET（recordInfo 查询、素材/结果下载）重试，付费 POST 收到响应不重试。文件上传 POST 使用独立上传预算。
- `MEIAO_KIE_HTTP_RETRY_BASE_MS`：默认 `1000`；请求级重试指数退避基数（毫秒），第 n 次重试等待 `base*(2^n-1)`，默认即 1s、3s。
- `MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY`：默认 `2`；单个 `kie_image` 任务提交 KIE 前解析/转存素材的并发。详情页批量生图建议保持保守默认，避免“任务数 × 素材数”打满 KIE 图床。
- `MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY`：默认 `2`；单个 `kie_seedance_video` 任务提交 KIE 前解析/转存图片、视频、音频素材的总并发。分镜视频多素材建议保持保守默认，避免多张大图同时转存导致 `asset_upload fetch failed`。
- `MEIAO_KIE_CHAT_MEDIA_RESOLUTION_CONCURRENCY`：默认 `2`；单个 `kie_chat` 策划/分镜任务解析多媒体素材的并发，与进程级 KIE 上传总闸门叠加。
- `MEIAO_MEDIA_TRANSCODE_ENABLED`：短视频参考音视频裁剪转码开关。生产首发建议先设 `0`，确认 `/api/health.mediaTranscode` 的 `ffmpegReady` 与 `ffprobeReady` 都为 `true` 后改为 `1`；本地未显式配置时启用，设 `0` 可立即停用入口。
- `MEIAO_FFMPEG_PATH` / `MEIAO_FFPROBE_PATH`：可选运维覆盖路径；留空时使用 npm 随应用分发的静态二进制，健康接口不会暴露实际路径。
- `MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES` / `MEIAO_MEDIA_TRANSCODE_CONCURRENCY`：默认 `209715200`（200 MiB）/ `1`，分别限制进入临时会话的单次请求和全进程并发转码数。
- `MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS` / `MEIAO_MEDIA_PROBE_TIMEOUT_MS`：默认 `600000` / `30000`；FFmpeg 与 FFprobe 的单次执行上限，超时会强杀子进程、释放并发并清理临时会话。
- `MEIAO_MEDIA_TRANSCODE_SESSION_TTL_MS` / `MEIAO_MEDIA_TRANSCODE_MAX_SESSIONS`：默认 `1800000`（30 分钟）/ `20`；控制未完成临时素材寿命和全进程会话容量。原始上传不会进入素材库、COS、KIE 或任务记录，只有 H.264 MP4 / MP3 转码并复检通过的结果才持久化。
- `GOLDEN_SUBTITLE_API_TOKEN`：Golden 视频去字幕令牌，仅写入服务端 `.env.server`，不进入前端、任务 payload、公开配置或健康响应。
- `MEIAO_SUBTITLE_REMOVAL_ENABLED`：去字幕新任务开关，生产默认关闭；关闭只阻止新提交，不隐藏历史 `subtitle_removal` 任务卡和托管结果。
- `MEIAO_SUBTITLE_REMOVAL_BASE_URL`：可选上游地址覆盖，默认使用内置 Golden API 地址；不向公开端点暴露。
- `MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS` / `MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS`：默认 `5000` / `1800000`，边界分别为 `2000-30000` / `300000-7200000`毫秒。去字幕 provider 使用独立 `subtitle_remove_video` job，provider task ID 先 checkpoint，成功视频再转存为梅奥托管结果。
- `MEIAO_SUBTITLE_REMOVAL_BATCH_MAX_ITEMS`：单批视频上限，默认 `10`，边界 `1-20`；服务端在每条 job 创建边界再次校验批次身份和上限。
- `MEIAO_SUBTITLE_REMOVAL_BATCH_PREP_CONCURRENCY` / `MEIAO_SUBTITLE_REMOVAL_BATCH_SUBMIT_CONCURRENCY`：默认 `2` / `2`，边界均为 `1-4`；前者控制浏览器素材准备队列，后者只控制耐久 job 创建节奏，不放宽 Golden 重试和付费安全策略。
- `MEIAO_SUBTITLE_REMOVAL_PROBE_INSPECTION_MS`：付费 canary 成功后的浏览器验收保留窗口，默认 `0`，边界 `0-600000`毫秒；窗口期内任务卡和结果可用于对比播放，窗口结束后探针自动精准清理。
- `MEIAO_CHAT_SSE_HEARTBEAT_MS`：默认 `15000`；智能体聊天 SSE 心跳间隔，避免长耗时多图生图期间代理或浏览器因连接空闲断流。
- `AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES`：默认 `1`；智能体单次 `generate_image` 提交/读取遇到 `fetch failed`、502、超时等瞬时上游错误时的内部快速重试次数，避免把瞬时失败总结成“部分完成”。
- `AGENT_IMAGE_TOOL_CONCURRENCY`：默认 `2`，代码上限 `5`；智能体同一轮返回多条独立 `generate_image` 工具调用时受控并发执行。只在本轮全是生图工具时启用，混合检索/生图仍串行，避免状态交叉。
- `AGENT_MODEL_TRANSIENT_MAX_RETRIES`：默认 `1`；智能体规划/总结模型请求在尚未输出内容前遇到 `fetch failed`、超时等瞬时网络错误时的内部快速重试次数；已开始流式输出的请求不自动重试，避免重复文本。
- `MEIAO_ASSET_X_ACCEL`：默认 `0`；生产 Nginx 配好 `/__meiao_stored_assets/` internal alias 后可设为 `1`，让托管素材通过 `X-Accel-Redirect` 直出。
- `VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS`：默认 `3`；项目卡片视频点击播放前等待的最小预缓冲秒数。
- `VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS`：默认 `5000`；项目卡片视频预缓冲最长等待毫秒数，超时后继续播放。
- `VITE_MEIAO_SHELL_JOB_SYNC_INTERVAL_MS`：默认 `10000`，下限 `1000` 毫秒；模块工作台周期读取耐久 job 并更新项目卡。页面重新可见、获得焦点、浏览器恢复网络时会立即同步，不等待下一次周期。该变量是前端构建期配置，修改后必须重新构建。
- `VITE_MEIAO_PRODUCT_REPLACE_SUBMISSION_CONCURRENCY`：默认 `3`，允许 `1-6`；限制产品替换批量任务在浏览器端同时提交的数量。该变量是前端构建期配置，修改后必须重新构建。
- `VITE_MEIAO_PRODUCT_REPLACE_ANALYSIS_PROMPT_MAX_CHARS`：默认 `12000`；限制组合产品 v7 策划输出的结构化产品身份与场景融合指令总长。`VITE_MEIAO_PRODUCT_REPLACE_GENERATION_PROMPT_MAX_CHARS`：默认 `18000`；限制最终产品替换执行提示词。产品素材图始终是身份最高真值，策划只提供有图片证据的结构注意力锚点并只投影一次；任一阶段超限都在下一次付费提交前停止。这两个变量是前端构建期配置，修改后必须重新构建。
- `VITE_LOGO_REPLACE_GENERATION_PROMPT_MAX_CHARS`：默认 `18000`；限制 Logo 替换执行提示词的最大字符数。策划 v5 只投影语义选框、真实目标边界、放置模式和局部融合决策，Logo 素材图是原子图稿真值；超限时在付费生图提交前拒绝。该变量必须低于当前 provider 真实文本上限，是前端构建期配置，修改后必须重新构建。
- `VITE_LOGO_REPLACE_EDIT_PADDING_RATIO` / `VITE_LOGO_REPLACE_EDIT_FEATHER_RATIO`：默认 `0.18` / `0.12`，允许 `0.02-0.5`；控制真实 Logo 目标边界之外的局部编辑包络和合成羽化。用户框选只负责语义定位，未绑定 Logo 与编辑包络外像素恢复为原图。属于前端构建期配置，修改后必须重新构建。

数据库：
- `MEIAO_DB_HOST`
- `MEIAO_DB_PORT`
- `MEIAO_DB_USER`
- `MEIAO_DB_PASSWORD`
- `MEIAO_DB_NAME`

管理员：
- `MEIAO_ADMIN_USERNAME`
- `MEIAO_ADMIN_PASSWORD`
- `MEIAO_SUPER_ADMIN_USERS`

模型与网关：
- `KIE_API_KEY` 或 `MEIAO_KIE_API_KEY`
- `APIPORTS_API_KEY` 或 `MEIAO_APIPORTS_API_KEY`
- `APIPORTS_BASE_URL` 或 `MEIAO_APIPORTS_BASE_URL`，默认使用奇点图像生成入口 `https://apiports.com/v1/api/generate`
- `ARK_API_KEY`
- `KIE_CHAT_MODEL`
- `MEIAO_DEFAULT_CHAT_MODEL`
- `MEIAO_DEFAULT_ANALYSIS_MODEL`
- `MEIAO_PLANNING_ANALYSIS_MODEL`
- `MEIAO_AGENT_ANALYSIS_MODEL`
- `MEIAO_SPIDER_GATEWAY_URL` 或 `SPIDER_GATEWAY_URL`
- `MEIAO_SPIDER_API_KEY` 或 `SPIDER_API_KEY`

环境模板维护在 `.env.server.example`，腾讯云部署说明维护在 `docs/tencent-cloud-deploy.md`。

### 5.1 口播翻译环境合同

所有数值越界或非法值都回落到保守默认值；路径和密钥只存在服务端，不进入公开配置、health 或探针输出。

| 变量 | 默认值 | 合法范围 / 合同 |
|---|---:|---|
| `MEIAO_VOICEOVER_TRANSLATION_ENABLED` | `0` | `1/true/on/yes` 才开启新提交 |
| `MEIAO_VOICEOVER_SEPARATION_PYTHON` | 空 | 运维提供的 venv Python 绝对路径 |
| `MEIAO_VOICEOVER_DEMUCS_MODEL` | `mdx` | 仅 `mdx` |
| `MEIAO_VOICEOVER_DEMUCS_MODEL_DIR` | 空 | Git 和 release 目录外的模型绝对路径 |
| `MEIAO_VOICEOVER_SEPARATION_CONCURRENCY` | `1` | 整数 `1-2`；生产首发保持 `1` |
| `MEIAO_VOICEOVER_SEPARATION_TIMEOUT_MS` | `3600000` | 整数 `300000-7200000` |
| `MEIAO_VOICEOVER_MIN_ATEMPO` | `0.75` | `0.5-1` |
| `MEIAO_VOICEOVER_MAX_ATEMPO` | `1.35` | `1-2` |
| `MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS` | `8192` | 整数 `1-8192`，不得超过语音模型上限 |
| `MEIAO_VOICEOVER_GROUP_GAP_MS` | `800` | 整数 `0-3000` |
| `MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS` | `150` | 整数 `0-1000` |
| `MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND` | `96` | 整数 `16-512` |
| `MEIAO_VOICEOVER_DUCKING_DB` | `4` | `0-12` |
| `MEIAO_VOICEOVER_FADE_MS` | `40` | 整数 `0-200` |
| `MEIAO_VOICEOVER_DURATION_TOLERANCE_MS` | `100` | 整数 `20-500` |
| `MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS` | `259200000` | 整数 `3600000-2592000000` |
| `MEIAO_KIE_TTS_BASE_URL` | `https://api.kie.ai` | 服务端 HTTP(S) 根地址 |
| `MEIAO_KIE_TTS_MODEL` | `google/gemini-3-1-flash-tts` | 固定模型名 |
| `MEIAO_KIE_TTS_REQUEST_TIMEOUT_MS` | `60000` | 整数 `5000-300000` |
| `MEIAO_KIE_TTS_POLL_INTERVAL_MS` | `4000` | 整数 `500-30000` |
| `MEIAO_KIE_TTS_POLL_MAX_ATTEMPTS` | `180` | 整数 `1-720` |
| `MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS` | `45000` | 整数 `0-300000` |

本地只读 readiness：

```bash
npm run probe:voiceover-translation -- --readiness
```

`ready:false` 是合法结果，只说明显式 venv/模型安装或服务端开关/凭证尚未齐备；探针不会安装包、下载模型或创建 provider 任务。只有用户明确提供绝对路径时才运行本地 fixture：

```bash
test -n "$MEIAO_VOICEOVER_FIXTURE_PATH"
npm run probe:voiceover-translation -- --fixture-path "$MEIAO_VOICEOVER_FIXTURE_PATH"
```

fixture 只运行本机 FFmpeg/Demucs，验证 H.264/AAC 输入、人声/背景输出、人声分析媒体、对齐、ducking、H.264/AAC 最终视频、时长容差、`ftyp` 和本地字节区间读取；不会调用 Gemini、KIE 或 Golden。`--resume-parent-job-id` / `--resume-child-task-id` 只查询已有任务。只有 `--live --source-asset-id <明确托管ID> --target-language <code>` 可以创建任务，且还必须配置受认证 base URL、会话和一次性 `MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1`；`--remove-text` 会先提示额外 Golden 费用。

远程探针使用 `MEIAO_VOICEOVER_PROBE_BASE_URL` 作为梅奥 HTTP(S) 根地址；`MEIAO_VOICEOVER_PROBE_POLL_INTERVAL_MS` 默认 `4000ms`、范围 `500-30000ms`，`MEIAO_VOICEOVER_PROBE_TIMEOUT_MS` 默认 `2400000ms`、范围 `60000-7200000ms`。`MEIAO_VOICEOVER_PROBE_SESSION_TOKEN` 只能在当前 shell/命令临时注入并在执行后清除，不能写入任何 env 文件；`MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1` 也只接受探针启动前的单次命令环境，持久化在 `.env.server` / `.env.local` 中会被忽略。live 和失败证据会输出安全的内部 `parentJobId` / `childJobId`；`--resume-child-task-id` 只接受该内部 `childJobId` 并直查 `/api/jobs/:id`，不会按 `providerTaskId` 搜索或扫描父任务列表。

计费边界：本机 Demucs 只消耗腾讯云计算资源，没有第三方按次费用；Gemini 分析/翻译、KIE TTS，以及可选 Golden 都可能计费。技术验收（任务/检查点/托管素材、H.264/AAC、Range、重启恢复）与感知验收（原口播不可辨、背景保留、目标语言和节奏正确、画面不变）必须分别记录，自动化通过不能代替真人试听/观看。

## 6. 验证入口

基础验证：

```bash
npm run acceptance
npm run lint
npm test
npm run build
npm run verify
```

重点回归：

```bash
node --test server/jobRuntime.test.mjs
node --test server/providerGateway.test.mjs
node --test server/assetStore.test.mjs
node --test src/services/kieAiService.test.mjs
node --test src/services/arkService.test.mjs
node --test src/modules/Account/accountManagementUtils.test.mjs
node --test src/modules/OneClick/oneClickBehavior.test.mjs
node --test src/modules/XhsCover/xhsCoverUtils.test.mjs
```

正式发布前还需要人工验证浏览器 Network：
- 前端不出现第三方模型域名直连。
- 请求头不暴露第三方 Bearer Key。
- 任务刷新后能恢复状态和结果。
- 管理员日志能看到内部任务 ID、外部任务 ID、provider、重试次数和错误摘要。

## 7. 发布事实

- GitHub 仓库：`https://github.com/gearaldblynn-lang/Meiao.git`
- 默认分支：`main`
- 腾讯云目录：`/www/wwwroot/meiao-internal`
- PM2 进程：`meiao-internal`
- 发布脚本：`./scripts/deploy_tencent.sh`
- 发布切换：PM2 固定使用单实例 `cluster + wait_ready`，脚本先写 drain marker 暂停 API 写入和 worker，等待存量写请求与运行任务归零。所有 MySQL worker claim 与部署最终检查共用同一命名锁：worker 获锁后必须重查 marker，从而关闭“先检查、后等锁、释锁后抢跑 claim”竞态。释放屏障后执行 `pm2 startOrReload`，新进程发出 ready 且精确 release health 通过后才移除 marker；正常路径不再停止唯一进程，也不操作 `iptables`。带 owner 或 `manual` 的 marker 不会过期，只能由精确 release health 后的 owner 清理或人工恢复。

GitHub 主要是备份和历史留档，不会自动更新线上服务。线上事实以腾讯云服务器目录和 PM2 进程为准。
