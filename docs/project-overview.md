# 项目概览与接手速查

更新日期：2026-07-10

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
- 产品精修：分析、生成、恢复、重试和中断。
- 短视频生成：长视频、Veo、分镜、视频诊断。
- 小红书封面：18 种风格封面生成。
- 系统设置：系统状态、队列和配置可见性。
- 账号管理：内部账号、运行日志、统计和日志导出。

`AppModule.PHOTOGRAPHY` 目前是预留入口，侧边栏会显示为即将开放，`src/ShellMigratedApp.tsx` 尚未接入对应业务页面。

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
- `MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS`：默认 `10`；同用户、同语义付费任务的跨进程提交锁等待上限。去重、积分预留与 job 创建在同一 MySQL 事务内完成。
- `MEIAO_PROVIDERLESS_RUNNING_STALE_MS`：默认代码兜底为 15 分钟；云上建议 `300000`。外部付费任务到期会进入 `provider_submission_unknown`，释放并发但不自动重提或退积分预留；内部幂等任务可安全回到 `retry_waiting`。
- `MEIAO_SUBMITTED_RUNNING_STALE_MS`：默认 `21600000`（6 小时）；只有存在真实上游 ID 查询路径的任务才回到 `retry_waiting` 复查旧结果，不可查询的 chat response ID 停止自动恢复。
- `MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES`：默认 `2`；只用于已记录 providerTaskId 的旧任务查询/结果下载，不用于重提 create/chat POST。
- `MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS`：默认 `60000`；云上建议 `30000`，控制 stale running 任务回收检查间隔。
- `MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS`：云上建议 `120000`；KIE 素材上传单次 HTTP 超时。分镜参考视频等较大素材需要更长上传预算；瞬时网络或上游 5xx 错误允许有限重试后释放并发。
- `MAXFORAI_API_KEY` / `MAXFORAI_BASE_URL`：`image-2中转` 的独立服务端凭证和接口根地址；站内 ID 为 `maxforai-image-2-relay`，上游模型固定为 `gpt-image-2`。密钥不得下发前端，也不复用 OpenAI Compatible 凭证；该模型当前不进入旧积分系统。文生图 `/images/generations` 使用 JSON；图生图 `/images/edits` 按当前 New API 运行时契约使用 multipart 二进制 `image` 文件，不能把公网 URL 对象 JSON 直接交给编辑端点。请求显式携带 `response_format: "url"`，但响应解析仍同时兼容 `data[0].url` 和 `data[0].b64_json`：后者会在任务成功落库前转换为站内托管素材，持久化结果只保留托管 URL、素材 ID 和非敏感的响应格式标记，不保存原始 base64。
- `image-2中转` 分辨率契约：上游仅支持 1K 和 2K，不支持 4K。固定比例必须由请求体 `size` 约束，不只把比例写进 prompt：1K 映射为 1:1 `1024x1024`、16:9 `1536x864`、9:16 `864x1536`、4:3 `1344x1008`、3:4 `1008x1344`、3:2 `1536x1024`、2:3 `1024x1536`；2K 映射为 1:1 `2048x2048`、16:9 `2048x1152`、9:16 `1152x2048`、4:3 `2048x1536`、3:4 `1536x2048`、3:2 `2016x1344`、2:3 `1344x2016`。智能比例不做尺寸推导，始终发送 `size: "auto"`。前端在该模型下只展示 1K/2K，历史 4K 选择在切模或 provider 边界统一降级为 2K。
- `MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS`：默认 `600000`；只控制 Image-2 单次付费生成/编辑 POST 的等待时间。付费 POST 不自动重试，结果不明时进入 `provider_submission_unknown`。
- `MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS` / `MAXFORAI_ASSET_UPLOAD_CONCURRENCY`：默认 `120000` / `3`；保留既有环境变量名，只控制付费编辑提交前下载参考素材并封装 multipart 文件的准备阶段。
- `MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS`：默认 `10000`，允许 `1000-15000`；长耗时 provider 请求期间持续给 Temporal 保活，避免 30 秒 heartbeat timeout 把仍在执行的付费请求判死。MaxForAI workflow 的 activity 额外强制单次尝试，执行器失联也不会自动重提付费 POST。
- `MEIAO_KIE_CHAT_COMPLETION_TIMEOUT_MS`：默认 `360000`（6 分钟）；KIE 对话/Gemini 同步推理的本地等待上限。该值需高于 KIE 上游常见的 300 秒超时，避免梅奥提前中断而丢失上游真实终态；调大只改善结果回收，不会修复 KIE/Gemini 自身的 504。
- `MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS`：默认 `1000`，限制 `250-5000` 毫秒；Node 在 IPv4/IPv6 候选地址之间切换时，单地址 TCP 建连尝试窗口。用于避免跨境 provider 首次 IPv4 建连超过 Node 20 默认 250ms 后被误判 `ETIMEDOUT`；不改变 provider 总超时或付费提交重试预算。
- `MEIAO_COS_SECRET_ID` / `MEIAO_COS_SECRET_KEY`：Gemini 视频专用腾讯 COS 服务端凭证；必须来自只允许目标桶 `gemini-video/*` 执行 `PutObject`、`GetObject` 的 CAM 子用户，不得下发前端或使用主账号密钥。
- `MEIAO_COS_BUCKET` / `MEIAO_COS_REGION`：Gemini 视频私有桶与地域。内部托管视频会先写入该桶，再把签名 GET URL 直接交给 Gemini；无需 CDN，建议给 `gemini-video/` 设置 3 天自动删除生命周期。
- `MEIAO_COS_SIGNED_URL_TTL_SECONDS`：默认 `10800`（3 小时），限制 `300-86400` 秒；控制 Gemini 可读取 COS 对象的时间窗口。
- `MEIAO_MANAGED_IMAGE_UPLOAD_MODE`：用户新上传图片的生产开关，只允许 `disabled|cos`；兼容发布和回滚用 `disabled`，COS 探针通过后才用 `cos`。图片 COS 失败时 fail closed，不回退到本地或 KIE。
- `MEIAO_IMAGE_COS_SECRET_ID` / `MEIAO_IMAGE_COS_SECRET_KEY` / `MEIAO_IMAGE_COS_BUCKET` / `MEIAO_IMAGE_COS_REGION`：新 source/reference/chat 图片的独立私有 COS 配置，与 Gemini 视频桶及凭证完全分开。云上目标为 `meiao-managed-images-1406860462` / `ap-guangzhou`，CAM 仅授予 `managed-images/*` 的对象读写删权限。
- `MEIAO_IMAGE_COS_BROWSER_URL_TTL_SECONDS` / `MEIAO_IMAGE_COS_PROVIDER_URL_TTL_SECONDS`：默认 `300` / `10800`，分别控制浏览器和外部分析/生成模型的临时签名读取窗口；签名 URL 不落库、不写日志。
- `MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS` / `MEIAO_IMAGE_COS_UPLOAD_TIMEOUT_MS` / `MEIAO_IMAGE_COS_UPLOAD_RETRY_BASE_MS`：默认 `3` / `30000` / `500`；重试幂等上传并复用同一对象键。
- `MEIAO_ASSET_CLEANUP_INTERVAL_MS` / `MEIAO_ASSET_CLEANUP_BATCH_SIZE` / `MEIAO_ASSET_CLEANUP_RETRY_BASE_MS`：持久精确删除队列默认每 `1800000`ms 处理 `20` 条，重试基数 `60000`ms。账号、项目/任务、聊天/会话、显式素材和过期删除都收敛到该队列。
- `MEIAO_ASSET_CLEANUP_MANUAL_REVIEW_ATTEMPTS` / `MEIAO_ASSET_CLEANUP_MANUAL_RETRY_MS` / `MEIAO_ASSET_CLEANUP_LEASE_MS`：默认 `8` / `86400000` / `600000`；失败任务不丢弃，进程重启后续跑，超阈值进入 manual review。
- `MEIAO_ASSET_CLEANUP_ALERT_BACKLOG` / `MEIAO_ASSET_CLEANUP_ALERT_OLDEST_MS` / `MEIAO_ASSET_UPLOAD_STALE_MS`：默认 `100` / `86400000` / `900000`；`/api/health.managedAssetCleanup` 会报 backlog、最老等待、重试、manual review 和卡住上传。
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
- `MEIAO_CHAT_SSE_HEARTBEAT_MS`：默认 `15000`；智能体聊天 SSE 心跳间隔，避免长耗时多图生图期间代理或浏览器因连接空闲断流。
- `AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES`：默认 `1`；智能体单次 `generate_image` 提交/读取遇到 `fetch failed`、502、超时等瞬时上游错误时的内部快速重试次数，避免把瞬时失败总结成“部分完成”。
- `AGENT_IMAGE_TOOL_CONCURRENCY`：默认 `2`，代码上限 `5`；智能体同一轮返回多条独立 `generate_image` 工具调用时受控并发执行。只在本轮全是生图工具时启用，混合检索/生图仍串行，避免状态交叉。
- `AGENT_MODEL_TRANSIENT_MAX_RETRIES`：默认 `1`；智能体规划/总结模型请求在尚未输出内容前遇到 `fetch failed`、超时等瞬时网络错误时的内部快速重试次数；已开始流式输出的请求不自动重试，避免重复文本。
- `MEIAO_ASSET_X_ACCEL`：默认 `0`；生产 Nginx 配好 `/__meiao_stored_assets/` internal alias 后可设为 `1`，让托管素材通过 `X-Accel-Redirect` 直出。
- `VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS`：默认 `3`；项目卡片视频点击播放前等待的最小预缓冲秒数。
- `VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS`：默认 `5000`；项目卡片视频预缓冲最长等待毫秒数，超时后继续播放。

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
- 发布切换：首先用临时 `iptables`/`ip6tables` 规则排空 IPv4/IPv6 旧请求，再由 `internal_jobs` 持锁连接停止旧 PM2；新进程以 drain marker 暂停 API 写入和 worker，health 通过后解除。`manual` marker 代表必须人工恢复且不会过期。

GitHub 主要是备份和历史留档，不会自动更新线上服务。线上事实以腾讯云服务器目录和 PM2 进程为准。
