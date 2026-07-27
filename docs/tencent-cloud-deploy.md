# 腾讯云内部版部署

## 服务器目录
- 项目目录：`/www/wwwroot/meiao-internal`
- 服务端环境文件：`/www/wwwroot/meiao-internal/.env.server`

## 备案域名
- 备案域名：`http://meiaoyuntai.com`
- 备案备用域名：`http://www.meiaoyuntai.com`
- 备案网站名称：`杭州梅奥`
- ICP 备案号：`浙ICP备2026015528号-1`
- 备案号只在首页底部展示，并链接到工信部备案官网首页：`https://beian.miit.gov.cn/`
- 前端入口标题固定为 `杭州梅奥AI工作台`，当前由 `index.html` 维护。

## 首次部署
```bash
mkdir -p /www/wwwroot/meiao-internal
```

## 环境变量
```bash
cat > /www/wwwroot/meiao-internal/.env.server <<'EOF'
NODE_ENV=production
PORT=3100
MEIAO_DB_HOST=127.0.0.1
MEIAO_DB_PORT=3307
MEIAO_DB_USER=root
MEIAO_DB_PASSWORD=请替换成你的真实密码
MEIAO_DB_NAME=meiao_internal
MEIAO_PUBLIC_BASE_URL=https://meiaoyuntai.com
MEIAO_JOB_MAX_CONCURRENCY=3
MEIAO_PRODUCT_RESTORE_ROLLOUT=off
MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS=10
MEIAO_TASK_ENGINE=mysql
MEIAO_TEMPORAL_ADDRESS=127.0.0.1:7233
MEIAO_TEMPORAL_NAMESPACE=default
MEIAO_TEMPORAL_TASK_QUEUE=meiao-cloud
MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS=10000
MEIAO_PROVIDERLESS_RUNNING_STALE_MS=300000
MEIAO_SUBMITTED_RUNNING_STALE_MS=21600000
MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES=2
MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS=30000
APP_STATE_MAX_BYTES=16777216
MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS=120000
MEIAO_KIE_CHAT_COMPLETION_TIMEOUT_MS=360000
MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS=1000
MEIAO_COS_SECRET_ID=请替换成仅限目标桶的 CAM 子用户 SecretId
MEIAO_COS_SECRET_KEY=请替换成仅限目标桶的 CAM 子用户 SecretKey
MEIAO_COS_BUCKET=meiao-gemini-video-test-20260714-1406860462
MEIAO_COS_REGION=ap-guangzhou
MEIAO_COS_SIGNED_URL_TTL_SECONDS=10800
MEIAO_MANAGED_IMAGE_UPLOAD_MODE=disabled
MEIAO_MANAGED_IMAGE_MAX_BYTES=20971520
MEIAO_MANAGED_ASSET_ACCESS_SECRET=请生成并妥善保存至少 32 字节的随机值
MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET=
MEIAO_IMAGE_COS_SECRET_ID=请替换成图片桶专用最小权限 CAM SecretId
MEIAO_IMAGE_COS_SECRET_KEY=请替换成图片桶专用最小权限 CAM SecretKey
MEIAO_IMAGE_COS_BUCKET=meiao-managed-images-1406860462
MEIAO_IMAGE_COS_REGION=ap-guangzhou
MEIAO_IMAGE_COS_BROWSER_URL_TTL_SECONDS=300
MEIAO_IMAGE_COS_PROVIDER_URL_TTL_SECONDS=10800
MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS=3
MEIAO_IMAGE_COS_UPLOAD_TIMEOUT_MS=30000
MEIAO_IMAGE_COS_UPLOAD_RETRY_BASE_MS=500
MEIAO_IMAGE_COS_OPERATION_TIMEOUT_MS=15000
MEIAO_ASSET_DELETE_GRACE_MS=120000
MEIAO_ASSET_USER_LOCK_TIMEOUT_SECONDS=30
MEIAO_ASSET_LOCK_CONNECTION_LIMIT=20
MEIAO_ASSET_AGENT_BUSY_LEASE_MS=7200000
MEIAO_ASSET_CLEANUP_INTERVAL_MS=1800000
MEIAO_TOMBSTONED_JOB_RECONCILE_INTERVAL_MS=15000
MEIAO_TOMBSTONED_JOB_PENDING_ALERT_MS=900000
MEIAO_ASSET_CLEANUP_BATCH_SIZE=20
MEIAO_ASSET_CLEANUP_RETRY_BASE_MS=60000
MEIAO_ASSET_CLEANUP_MANUAL_REVIEW_ATTEMPTS=8
MEIAO_ASSET_CLEANUP_MANUAL_RETRY_MS=86400000
MEIAO_ASSET_CLEANUP_LEASE_MS=600000
MEIAO_ASSET_CLEANUP_ALERT_BACKLOG=100
MEIAO_ASSET_CLEANUP_ALERT_OLDEST_MS=86400000
MEIAO_ASSET_UPLOAD_STALE_MS=900000
MEIAO_ASSET_COS_RECONCILE_INTERVAL_MS=86400000
MEIAO_ASSET_CLEANUP_AUDIT_RETENTION_MS=2592000000
MEIAO_KIE_MANAGED_ASSET_MODE=direct-first
MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY=3
MEIAO_KIE_ASSET_UPLOAD_RETRIES=2
MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS=1000
MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS=1800000
MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES=2000
MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS=60000
MEIAO_RESULT_ASSET_DOWNLOAD_RETRIES=2
MEIAO_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS=500
MEIAO_KIE_HTTP_TRANSIENT_RETRIES=2
MEIAO_KIE_HTTP_RETRY_BASE_MS=1000
MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY=2
MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY=2
MEIAO_KIE_CHAT_MEDIA_RESOLUTION_CONCURRENCY=2
MEIAO_MEDIA_TRANSCODE_ENABLED=0
MEIAO_FFMPEG_PATH=
MEIAO_FFPROBE_PATH=
MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES=209715200
MEIAO_MEDIA_TRANSCODE_CONCURRENCY=1
MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS=600000
MEIAO_MEDIA_PROBE_TIMEOUT_MS=30000
MEIAO_MEDIA_TRANSCODE_SESSION_TTL_MS=1800000
MEIAO_MEDIA_TRANSCODE_MAX_SESSIONS=20
GOLDEN_SUBTITLE_API_TOKEN=
MEIAO_SUBTITLE_REMOVAL_ENABLED=0
MEIAO_SUBTITLE_REMOVAL_BASE_URL=https://goodline.simplemokey.com/api/openAi
MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS=5000
MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS=1800000
MEIAO_SUBTITLE_REMOVAL_BATCH_MAX_ITEMS=10
MEIAO_SUBTITLE_REMOVAL_BATCH_PREP_CONCURRENCY=2
MEIAO_SUBTITLE_REMOVAL_BATCH_SUBMIT_CONCURRENCY=2
MEIAO_SUBTITLE_REMOVAL_PROBE_INSPECTION_MS=0
# 口播翻译首发必须保持 disabled；完成独立 sizing、模型安装、readiness 和用户发布确认后才可改 1。
MEIAO_VOICEOVER_TRANSLATION_ENABLED=0
MEIAO_VOICEOVER_SEPARATION_PYTHON=/opt/meiao/voiceover/venv/bin/python
MEIAO_VOICEOVER_DEMUCS_MODEL=mdx
MEIAO_VOICEOVER_DEMUCS_MODEL_DIR=/opt/meiao/voiceover/models
MEIAO_VOICEOVER_SEPARATION_CONCURRENCY=1
MEIAO_VOICEOVER_SEPARATION_TIMEOUT_MS=3600000
MEIAO_VOICEOVER_MIN_ATEMPO=0.75
MEIAO_VOICEOVER_MAX_ATEMPO=1.35
MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS=8192
MEIAO_VOICEOVER_GROUP_GAP_MS=800
MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS=150
MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND=96
MEIAO_VOICEOVER_DUCKING_DB=4
MEIAO_VOICEOVER_FADE_MS=40
MEIAO_VOICEOVER_DURATION_TOLERANCE_MS=100
MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS=259200000
MEIAO_KIE_TTS_BASE_URL=https://api.kie.ai
MEIAO_KIE_TTS_MODEL=google/gemini-3-1-flash-tts
MEIAO_KIE_TTS_REQUEST_TIMEOUT_MS=60000
MEIAO_KIE_TTS_POLL_INTERVAL_MS=4000
MEIAO_KIE_TTS_POLL_MAX_ATTEMPTS=180
MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS=45000
# 只持久化非敏感探针配置；会话 token 和单次付费确认禁止写入服务器 env 文件。
MEIAO_VOICEOVER_PROBE_BASE_URL=https://meiaoyuntai.com
MEIAO_VOICEOVER_PROBE_POLL_INTERVAL_MS=4000
MEIAO_VOICEOVER_PROBE_TIMEOUT_MS=2400000
MEIAO_CHAT_SSE_HEARTBEAT_MS=15000
AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES=1
AGENT_IMAGE_TOOL_CONCURRENCY=2
AGENT_MODEL_TRANSIENT_MAX_RETRIES=1
MEIAO_ALLOWED_ORIGINS=https://meiaoyuntai.com,https://www.meiaoyuntai.com,http://111.229.66.247,http://111.229.66.247:3100
MEIAO_ASSET_X_ACCEL=0
VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS=3
VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS=5000
VITE_MEIAO_SHELL_JOB_SYNC_INTERVAL_MS=10000
MEIAO_ADMIN_USERNAME=admin
MEIAO_ADMIN_PASSWORD=请替换成你的管理员密码
MEIAO_SUPER_ADMIN_USERS=admin
MEIAO_SPIDER_GATEWAY_URL=请替换成你的 Spider 网关地址
MEIAO_SPIDER_API_KEY=请替换成你的 Spider Key
KIE_API_KEY=请替换成你的真实 KIE Key
APIPORTS_API_KEY=请替换成你的真实 APIports Key
MAXFORAI_API_KEY=
MAXFORAI_BASE_URL=https://maxforai.top/v1
MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS=600000
MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS=120000
MAXFORAI_ASSET_UPLOAD_CONCURRENCY=3
MAXFORAI_VIDEO_API_KEY=
MAXFORAI_VIDEO_BASE_URL=https://maxforai.top/v1
MAXFORAI_VIDEO_CREATE_TIMEOUT_MS=60000
MAXFORAI_VIDEO_ASSET_TIMEOUT_MS=120000
MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY=2
MAXFORAI_VIDEO_POLL_INTERVAL_MS=5000
MAXFORAI_VIDEO_POLL_TIMEOUT_MS=1500000
ARK_API_KEY=请替换成你的真实 ARK Key
OPENAI_COMPATIBLE_API_KEY=请替换成你的 OpenAI Compatible 中转站 Key
OPENAI_COMPATIBLE_BASE_URL=https://maxforai.top
OPENAI_COMPATIBLE_MODELS=gpt-5.4,gpt-5.5
OPENAI_COMPATIBLE_RESPONSES_PATH=/v1/responses
AGENT_TOOL_MAX_ROUNDS=5
AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS=2
EOF
```

`MEIAO_PRODUCT_RESTORE_ROLLOUT` 只控制是否允许新建产品还原任务：`off` 禁止所有人新建，`admin` 仅允许管理员新建，`all` 允许所有已登录用户新建。未配置、空值或非法值都保守降级为 `off`。该开关不控制项目可见性；即使切回 `off`，历史产品还原项目仍可查看和下载结果。

第4期智能体多工具复用 `OPENAI_COMPATIBLE_*`，V2 对话经 `OPENAI_COMPATIBLE_RESPONSES_PATH` 调 responses 端点以支持 `web_search`；`AGENT_TOOL_MAX_ROUNDS` 是单轮工具循环上限，默认 5。`AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS` 是多图独立输出规划欠覆盖时的修复审查轮数，默认 2；仍不完整会快速失败，不执行单张伪完成。

`MAXFORAI_API_KEY` 是 `image-2中转` 的独立服务端凭证，不得复用或暴露 `OPENAI_COMPATIBLE_API_KEY`。站内 ID 为 `maxforai-image-2-relay`，上游固定提交 `gpt-image-2`；当前不进入旧积分系统，也不保存渠道价格。文生图 `/images/generations` 使用 JSON；图生图 `/images/edits` 必须把参考图下载为文件并用 multipart 的 `image` 字段提交，不能照旧版渠道文档把 `images[].image_url` JSON 直接发给编辑端点。生成请求显式发送 `response_format: "url"`，但中转或上游仍可能返回 `data[0].url` 或 `data[0].b64_json`；服务端必须兼容两种格式，并在成功落库前把 base64 结果写成站内托管素材，持久化层不得保存原始 base64。`MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS` 只控制单次付费 POST 的等待时间，该 POST 永不自动重试；若连接中断且无法确认上游是否接单，任务进入 `provider_submission_unknown`。`MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS` 和 `MAXFORAI_ASSET_UPLOAD_CONCURRENCY` 保留既有环境变量名，只作用于付费编辑提交前的素材下载与 multipart 封装准备。

`MAXFORAI_VIDEO_API_KEY` 是 `Seedance 2.0 Pro 特价` 的独立服务端凭证，不复用 `MAXFORAI_API_KEY`，也不向前端下发。站内模型 ID 为 `maxforai-sora-v9-pro`，上游固定使用 `sora-v9-pro`；界面只显示 `0.5元/秒`，不使用站内积分扣费。创建走 `POST /videos`，获得 `providerTaskId` 并先持久化后，再通过 `GET /videos/{task_id}` 查询原任务；付费创建 POST 零自动重试，恢复时只做 GET，不会创建第二个付费任务。公网 HTTPS 素材先走 `/assets/url`，本地托管、data URL 或非 HTTPS 素材走 multipart `/assets`，所有素材必须在付费创建前准备完成。模型固定输出 720p，支持 4-15 秒、`16:9` / `9:16` / `1:1`，最多 9 张图片、3 个视频和 3 个音频，参考视频与参考音频的已知合计时长各不超过 15 秒。`MAXFORAI_VIDEO_CREATE_TIMEOUT_MS` / `MAXFORAI_VIDEO_ASSET_TIMEOUT_MS` / `MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY` / `MAXFORAI_VIDEO_POLL_INTERVAL_MS` / `MAXFORAI_VIDEO_POLL_TIMEOUT_MS` 默认分别为 `60000` / `120000` / `2` / `5000` / `1500000`。

`image-2中转` 上游仅支持 1K 和 2K，4K 不是可用档位。固定比例依靠 `size` 约束：1K 的 1:1/16:9/9:16/4:3/3:4/3:2/2:3 依次是 `1024x1024`、`1536x864`、`864x1536`、`1344x1008`、`1008x1344`、`1536x1024`、`1024x1536`；2K 依次是 `2048x2048`、`2048x1152`、`1152x2048`、`2048x1536`、`1536x2048`、`2016x1344`、`1344x2016`。智能比例必须保留 `size: "auto"`。应用层只显示 1K/2K；旧任务或历史页面残留的 4K 参数到 provider 边界时必须降级为对应比例的 2K `size`，不得将 4K 请求继续交给上游。

`MEIAO_PROVIDERLESS_RUNNING_STALE_MS` 控制已标记 `running` 但还没有上游 `providerTaskId` 的异常检测窗口。云上建议 `300000`：内部幂等任务可安全回到 `retry_waiting`；外部付费任务改为 `provider_submission_unknown`，释放并发但不自动重提、不自动退积分预留，需要管理员核实上游后处置。`MEIAO_SUBMITTED_RUNNING_STALE_MS` 控制已记录上游 ID 但未回写终态的检查窗口；只有具备真实查询接口的 task type 才回到 `retry_waiting` 继续查旧任务，不可查询的 chat response ID 不会自动重提。`MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES` 默认 `2`，只是旧任务查询/结果下载的恢复次数。`MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS` 建议 `30000`。

`MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS` 默认 `10`，控制同用户、同语义付费任务的 MySQL 命名锁等待。去重查询、积分预留和 job 创建在同一事务内完成；锁超时返回 409，不创建第二个任务。

`APP_STATE_MAX_BYTES` 是 app_states 单行 state_json 写入大小闸(超闸按 updatedAt 倒序裁老项目,active 永留)。云上 2026-07-04 起为 `16777216`(16 MiB):当时妙木山 8.76 MiB 已超旧 8 MiB 闸、正在丢老项目;线上 MySQL `max_allowed_packet` 实测 128 MiB,16 MiB 仍有 8 倍余量。调整该值必须 `source .env.server` 后 `pm2 startOrReload ecosystem.config.cjs --update-env` 并从进程环境(`/proc/<pid>/environ`)复核生效。

`MEIAO_KIE_HTTP_TRANSIENT_RETRIES` / `MEIAO_KIE_HTTP_RETRY_BASE_MS` 控制 KIE HTTP 请求级瞬时重试（默认 2 次、退避 1s/3s）：createTask/chat 付费 POST 只有在全部底层原因都明确停在 TCP `connect` 阶段（如 `ETIMEDOUT/ENETUNREACH`）时才安全重试；连接建立后的 `ECONNRESET/UND_ERR_SOCKET`、主动超时、混合未知异常或任何 HTTP 响应都不得重提。`502/503/504` 默认只对只读 GET 重试；文件上传 POST 是显式例外，由独立上传预算控制。任务失败落库时 `error_message` 为用户可读人话、`error_detail` 保留技术原文。

`MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS` 控制 KIE 素材上传单次 HTTP 超时，云上建议 `120000`。分镜参考视频等较大素材需要更长上传预算；如果上传出现瞬时网络或上游 5xx 错误，任务允许有限重试后释放并发，不走 base64 上传接口。

`MEIAO_KIE_CHAT_COMPLETION_TIMEOUT_MS` 控制 KIE 对话/Gemini 同步推理的本地等待上限，默认 `360000`（6 分钟）。该值应高于 KIE 上游常见的 300 秒超时，让梅奥能收到真实成功或 504 终态；调大它只避免本地提前中断，不会改变 KIE/Gemini 自身的处理上限。

`MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS` 控制 Node 在 IPv4/IPv6 候选地址之间切换时，单个地址的 TCP 建连尝试窗口，默认 `1000`，限制 `250-5000` 毫秒。腾讯云到 Cloudflare/KIE 的首次 IPv4 建连可能超过 Node 20 默认的 250ms；该值只修复底层地址族建连误超时，不放宽 provider 总请求时限，也不增加付费 POST 的重提次数。

Gemini 视频读取是独立的强约束链路：我方 `/api/assets/file/` 视频先由服务端完整读取，再写入私有腾讯 COS，最后只把短期签名 GET URL 交给 Gemini。`MEIAO_COS_SECRET_ID` / `MEIAO_COS_SECRET_KEY` 必须来自只允许目标桶 `gemini-video/*` 执行 `PutObject`、`GetObject` 的 CAM 子用户；不得使用主账号密钥。`MEIAO_COS_BUCKET` 必须包含 APPID 后缀，`MEIAO_COS_REGION` 与桶地域一致。`MEIAO_COS_SIGNED_URL_TTL_SECONDS` 默认 `10800`（3 小时），只影响 Gemini 的读取窗口。桶保持私有读写，无需 CDN；建议给 `gemini-video/` 配置 3 天生命周期自动删除。

### 用户上传图片专用 COS

- 新桶固定为广州 `ap-guangzhou` 的私有桶 `meiao-managed-images-1406860462`，版本控制关闭，不配 CDN，不允许公共读写。仅存储新上传的 source/reference/chat 图片；历史图片不迁移，生成结果仍保持本地存储。
- CAM 密钥必须与视频 COS 分开，只对该桶的 `managed-images/*` 授予 `PutObject`、`GetObject`/`HeadObject` 和 `DeleteObject`；禁止 `DeleteBucket`、修改桶策略、修改 ACL 及访问其他桶。Secret 只写服务端 `.env.server`，不进 Git、页面、日志或诊断看板。`MEIAO_MANAGED_ASSET_ACCESS_SECRET` 用于生成绑定素材与用户的访问 capability；轮换时先把旧值放入 `MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET`，等旧 URL 完成更新后再清空。
- 生命周期只配置“终止 1 天前未完成的分块上传”，不配置定时删除正常对象；正常图片由用户/项目/任务/会话删除触发的持久清理队列精确删除。删除前 worker 会再次检查存活引用，防止并发误删。
- CORS 不开放上传；如页面确需 canvas 跨域读图，只允许 `https://meiaoyuntai.com` 和 `https://www.meiaoyuntai.com` 的 `GET/HEAD`。强制 HTTPS。
- 云资源和成对密钥必须先配好，且 `MEIAO_MANAGED_IMAGE_UPLOAD_MODE=cos`。标准部署在写请求 drain/PM2 平滑 reload 之前自动执行 `npm run probe:managed-image-cos`；只有 `put -> head -> signed HTTPS GET -> byte equality -> delete -> head/not-found` 全部通过才继续。任何一步失败都原地中止，旧进程和旧 `dist` 继续服务。
- 紧急回滚仍可把上传模式设为 `disabled`以防错写，并保留 COS-aware 代码读删既有素材；这是明确的降级状态，`managedImageUpload.ready=false`，不得报告为发布完成。
- `/api/health` 的 `managedImageUpload` 暴露模式、配置完整性、最近一次真探针、时效和告警；`managedAssetCleanup` 另行暴露 backlog、最老等待时间、retry attempts、manual review、upload failed 和 alerting。密钥、SecretId、bucket 和签名 URL 都不进入 health。

`MEIAO_MANAGED_IMAGE_PROBE_INTERVAL_MS` / `MEIAO_MANAGED_IMAGE_PROBE_MAX_AGE_MS` 默认为 `900000` / `3600000`；后台每 15 分钟重新验证，超过 1 小时没有当前配置的成功结果即报不就绪。`MEIAO_MANAGED_IMAGE_PROBE_STATUS_FILE` 默认为 `server/data/managed-image-cos-readiness.json`，部署保留该文件；文件只存不可逆配置指纹、时间、结果和脱敏错误码。轮换任一密钥、bucket 或 region 后，旧探针指纹立即失效。

`MEIAO_IMAGE_COS_BROWSER_URL_TTL_SECONDS` / `MEIAO_IMAGE_COS_PROVIDER_URL_TTL_SECONDS` 默认为 `300` / `10800`。上传默认 3 次、单次 30 秒、退避基数 500ms；超时或请求取消会先取消 SDK 底层上传任务，签名、HEAD 和删除请求默认 15 秒超时。同一次重试始终复用同一对象键，失败时不回退到本地磁盘或 KIE 图床。素材删除默认先等待 2 分钟，worker 每条删除前重新核对持久引用；同账号 COS 上传和账号删除用最长 30 秒的 MySQL advisory lock 互斥。清理默认每 30 分钟、每批 20 条，重试基数 60 秒，8 次后进入 manual review 并每 24 小时再试，in-progress lease 10 分钟，上传卡住 15 分钟视为失败并对账。默认 backlog 达 100 条或最老等待达 24 小时告警；已完成/受保护的审计任务保留 30 天后裁剪，health 只读聚合计数。

Gemini 视频不受 `MEIAO_KIE_MANAGED_ASSET_MODE` 回滚开关影响：无论 `auto`、`direct-first` 还是 `kie-only`，都禁止把视频转存到 KIE `openrouter-chat`，也禁止 Gemini 明确读文件失败后再走 KIE/换模型兜底。图片、PDF 等非视频托管素材仍按 `MEIAO_KIE_MANAGED_ASSET_MODE=direct-first` 优先使用 `MEIAO_PUBLIC_BASE_URL` 的 HTTPS 地址；只有上游明确返回文件读取/下载/MIME 不可用错误且没有 `providerTaskId` 时，才允许转存 KIE 并重试同一模型。普通 HTTP 500/502、网络中断、鉴权、余额、限额和已有 task id 都不触发回退。

`MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY` 是所有任务共享的 file-stream-upload 总并发，默认 `3`。`MEIAO_KIE_ASSET_UPLOAD_RETRIES` / `MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS` 默认 `2` / `1000`，只重试文件上传的连接错误与 `429/500/502/503/504`。`MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS` / `MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES` 默认 `1800000` / `2000`，复用成功转存 URL；失败不缓存，PM2 重启后缓存自然清空。

`MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS` / `MEIAO_RESULT_ASSET_DOWNLOAD_RETRIES` / `MEIAO_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS` 默认 `60000` / `2` / `500`。它们只控制 provider 已完成后抓取结果文件的幂等 GET 和响应体读取；连接错误、超时、`429/5xx` 可重试，`4xx` 不重试，也不会重新提交生成任务或产生重复计费。

`MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS` 默认 `10000`，允许 `1000-15000`。该心跳保持长耗时 provider activity 在 Temporal 的 30 秒 heartbeat timeout 内存活。MaxForAI 付费生成的 activity 固定只尝试一次；心跳丢失、worker 中断或 workflow 层异常都不得自动再次提交上游 POST。

`MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY` 控制单个 `kie_image` 任务在提交 KIE 前解析/转存素材的并发，默认 `2`。详情页批量生图会同时创建多张图，每张又带多张商品/参考素材；该值不要盲目调高，避免把 KIE 图床上传并发打满。

`MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY` 控制单个 `kie_seedance_video` 任务在提交 KIE 前解析/转存图片、视频、音频素材的总并发，默认 `2`。分镜视频常带多张 3-5MB 商品图和分镜图，保持保守默认可降低 `asset_upload fetch failed`。

短视频参考音视频先经过站内临时格式检查和按需裁剪/转码，再进入托管素材和 Seedance 任务。完整保留且已符合输出合同的 H.264 MP4 / MP3 直接持久化原文件，不重复调 FFmpeg；超时长、用户改动裁剪区间、HEVC/MOV 或其他不兼容编码才转换。首发保持 `MEIAO_MEDIA_TRANSCODE_ENABLED=0`，部署完成后先确认 `/api/health` 的 `mediaTranscode.ffmpegReady=true`、`mediaTranscode.ffprobeReady=true`，再改为 `1` 并重启。`MEIAO_FFMPEG_PATH` / `MEIAO_FFPROBE_PATH` 留空时使用 npm 随包二进制；只有运维确认版本时才覆盖。`MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES`、`MEIAO_MEDIA_TRANSCODE_CONCURRENCY`、`MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS`、`MEIAO_MEDIA_PROBE_TIMEOUT_MS`、`MEIAO_MEDIA_TRANSCODE_SESSION_TTL_MS`、`MEIAO_MEDIA_TRANSCODE_MAX_SESSIONS` 默认分别为 `209715200`、`1`、`600000`、`30000`、`1800000`、`20`。原文件仅进入用户隔离的临时目录，失败、取消或过期都会删除；只有通过格式、时长、尺寸、帧率和大小复检的文件才写入托管素材，不创建付费任务。

Nginx 必须为该大文件接口单独配置并在 HTTP/HTTPS 两个 `server` 块都生效；`203m` 覆盖 200 MiB 文件加 multipart 开销，`610s` 覆盖应用 600 秒处理窗口。不得只依赖全局 50m/300s，也不得保留默认 request buffering：

```nginx
location ^~ /api/media-transcodes/ {
    client_max_body_size 203m;
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 610s;
    proxy_send_timeout 610s;
    proxy_buffering off;
}
```

视频去字幕采用 disabled-first 发布：`GOLDEN_SUBTITLE_API_TOKEN` 仅写入服务端 `.env.server`，不得放入前端 env、Git、日志或运行命令参数；首次部署保持 `MEIAO_SUBTITLE_REMOVAL_ENABLED=0`（默认关闭）。`MEIAO_SUBTITLE_REMOVAL_BASE_URL`、`MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS`、`MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS` 的默认值为内置 Golden 地址、`5000`、`1800000`，后两者边界为 `2000-30000` 与 `300000-7200000`毫秒。批量参数 `MEIAO_SUBTITLE_REMOVAL_BATCH_MAX_ITEMS`、`MEIAO_SUBTITLE_REMOVAL_BATCH_PREP_CONCURRENCY`、`MEIAO_SUBTITLE_REMOVAL_BATCH_SUBMIT_CONCURRENCY` 默认分别为 `10`、`2`、`2`，边界分别为 `1-20`、`1-4`、`1-4`；提交并发只控制耐久 job 创建节奏，不改变 provider 零自动重试、账号并发或付费安全策略。先验证 `/api/health.subtitleRemoval={enabled:false,configured:true}` 和非付费 readiness，再在明确 `MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM=1` 时执行一次 2-3 秒的单次付费探针。需要在云上页面对比播放时，临时设置 `MEIAO_SUBTITLE_REMOVAL_PROBE_INSPECTION_MS=300000`（允许 `0-600000`毫秒），探针在输出脱敏成功摘要后保留任务卡，窗口结束自动清理。上游提交状态未知时不得自动重跑。回滚只将 `MEIAO_SUBTITLE_REMOVAL_ENABLED=0` 并正常重启，历史任务卡和结果仍可读。批量增强必须先通过本地测试、`doctor`、`build` 和真实浏览器验收，再进入发布门禁。

`MEIAO_KIE_CHAT_MEDIA_RESOLUTION_CONCURRENCY` 控制单个 `kie_chat` 策划/分镜任务解析图片和视频的并发，默认 `2`。它与 `MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY` 进程级总闸门叠加，前者控制单 job 扇出，后者控制全账号总上传压力。

对 `provider_submission_unknown` 任务，管理员使用 `POST /api/admin/task-platform/jobs/:id/submission-resolution`：`{"action":"bind","providerTaskId":"..."}` 仅允许绑定具备旧任务查询路径且已人工核实的 ID；`{"action":"release"}` 只能在确认上游没有创建任务后释放积分预留。两种操作都记录管理日志和任务事件。

`MEIAO_CHAT_SSE_HEARTBEAT_MS` 默认 `15000`，控制智能体聊天 SSE 心跳间隔。长耗时多图生图可能数分钟没有业务事件，心跳用于避免代理或浏览器把连接判定为空闲后断开。

`AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES` 默认 `1`，控制智能体单次 `generate_image` 提交/读取遇到 `fetch failed`、502、超时等瞬时上游错误时的内部快速重试次数。该重试发生在执行器内部，不把瞬时失败交给模型总结成“部分完成”。

`AGENT_IMAGE_TOOL_CONCURRENCY` 默认 `2`，控制智能体同一轮多张独立 `generate_image` 工具调用的受控并发，代码上限为 `5`。只有本轮工具调用全是生图时才并发；混合 `search_knowledge` / `generate_image` 仍串行，避免检索上下文与生图状态交叉。

`AGENT_MODEL_TRANSIENT_MAX_RETRIES` 默认 `1`，控制智能体规划/总结模型请求在尚未输出内容前遇到 `fetch failed`、超时等瞬时网络错误时的内部快速重试次数。已开始流式输出的请求不会自动重试，避免用户看到重复文本。

`MEIAO_ASSET_X_ACCEL` 默认保持 `0`。只有在 Nginx 已配置内部资源映射后才可设为 `1`，让 `/api/assets/file/:id` 由 Node 校验权限和缓存头，再通过 `X-Accel-Redirect` 交给 Nginx 直出文件，降低大视频经过 Node 流式转发的抖动。示例：

开启 X-Accel 后，应用根目录 `/www/wwwroot/meiao-internal` 是资源交付合同的一部分：Nginx 的 `www` 用户必须能够穿越该目录。标准部署脚本会在源码同步后只执行 `chmod 0755 /www/wwwroot/meiao-internal`；不得递归放宽权限，`.env.server` 必须继续保持 `0600`。`rsync -a`、tar 解包等操作会携带本地目录权限，如果把开发机根目录的 `0700` 元数据复制到线上，会出现“任务成功、文件存在、Node 直连 200，但公网图片 403/不显示”。

`VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS` 和 `VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS` 是前端构建期变量，控制项目卡片视频播放前的预缓冲。默认值分别为 `3` 秒和 `5000` 毫秒；线上网络较慢时可小幅上调，调整后需要重新构建前端。

`VITE_MEIAO_SHELL_JOB_SYNC_INTERVAL_MS` 也是前端构建期变量，控制模块工作台从耐久任务队列同步项目卡的周期，默认 `10000` 毫秒，低于 `1000` 毫秒会回退默认值。前台恢复、窗口聚焦和网络恢复会额外立即同步；调整该值后必须重新构建前端。不要用极短轮询掩盖 provider 或任务队列故障。

```nginx
location /__meiao_stored_assets/ {
  internal;
  alias /www/wwwroot/meiao-internal/server/data/assets/;
}
```

开启后重启服务：

```bash
MEIAO_ASSET_X_ACCEL=1
pm2 startOrReload ecosystem.config.cjs --update-env
```

开启后必须同时验证 Node 授权层和 Nginx 交付层，不能只看 `/api/health` 或 `127.0.0.1:3100`：

```bash
stat -c '%U:%G %a %n' /www/wwwroot/meiao-internal
stat -c '%U:%G %a %n' /www/wwwroot/meiao-internal/.env.server
namei -l /www/wwwroot/meiao-internal/server/data/assets
```

预期应用根目录为可穿越的 `0755`，`.env.server` 仍为 `0600`。再从一个当前账号真实、有效的本地托管结果素材取得授权 URL，分别请求 Node 直连地址和正式域名；两端都必须返回 `200`、正确 `Content-Type` 和相同字节数/哈希。公网任一 `403` 都视为发布失败，即使任务状态、文件落盘和 Node 直连已经成功。

### 口播翻译 disabled-first 部署

本节不构成发布授权。生产 CPU、内存、磁盘容量、模型存放、分离并发、真实 Gemini/KIE/Golden 费用和部署窗口必须由用户另行确认。首次启用保持 `MEIAO_VOICEOVER_SEPARATION_CONCURRENCY=1`；Demucs 是腾讯云本地算力，不收第三方按次费用，但 Gemini 分析/翻译、KIE TTS 和可选 Golden 都可能计费。

venv 和非量化 `mdx` 权重必须安装在 Git 仓库与 `/www/wwwroot/meiao-internal` release 目录之外。安装是显式运维步骤，readiness 不会自动下载或修改服务器：

```bash
export MEIAO_VOICEOVER_SERVICE_USER=CHANGE_ME_TO_PM2_OS_USER
test "$MEIAO_VOICEOVER_SERVICE_USER" != CHANGE_ME_TO_PM2_OS_USER
id "$MEIAO_VOICEOVER_SERVICE_USER"
export MEIAO_VOICEOVER_SERVICE_GROUP="$(id -gn "$MEIAO_VOICEOVER_SERVICE_USER")"
sudo install -d \
  -o "$MEIAO_VOICEOVER_SERVICE_USER" \
  -g "$MEIAO_VOICEOVER_SERVICE_GROUP" \
  -m 0750 \
  /opt/meiao/voiceover
sudo -u "$MEIAO_VOICEOVER_SERVICE_USER" test -w /opt/meiao/voiceover
export MEIAO_VOICEOVER_VENV_DIR=/opt/meiao/voiceover/venv
export MEIAO_VOICEOVER_DEMUCS_MODEL_DIR=/opt/meiao/voiceover/models
# 跨境链路较慢时可调；脚本默认 600 秒、8 次，合法范围分别为 30-3600 秒、0-20 次。
export MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS=600
export MEIAO_VOICEOVER_PIP_RETRIES=8
sudo -u "$MEIAO_VOICEOVER_SERVICE_USER" env \
  "PATH=$PATH" \
  "MEIAO_VOICEOVER_VENV_DIR=$MEIAO_VOICEOVER_VENV_DIR" \
  "MEIAO_VOICEOVER_DEMUCS_MODEL_DIR=$MEIAO_VOICEOVER_DEMUCS_MODEL_DIR" \
  "MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS=$MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS" \
  "MEIAO_VOICEOVER_PIP_RETRIES=$MEIAO_VOICEOVER_PIP_RETRIES" \
  node scripts/install-voiceover-demucs.mjs --install
sudo -u "$MEIAO_VOICEOVER_SERVICE_USER" env \
  "PATH=$PATH" \
  "MEIAO_VOICEOVER_VENV_DIR=$MEIAO_VOICEOVER_VENV_DIR" \
  "MEIAO_VOICEOVER_DEMUCS_MODEL_DIR=$MEIAO_VOICEOVER_DEMUCS_MODEL_DIR" \
  node scripts/install-voiceover-demucs.mjs --download-models
sudo -u "$MEIAO_VOICEOVER_SERVICE_USER" env \
  "PATH=$PATH" \
  "MEIAO_VOICEOVER_VENV_DIR=$MEIAO_VOICEOVER_VENV_DIR" \
  "MEIAO_VOICEOVER_DEMUCS_MODEL_DIR=$MEIAO_VOICEOVER_DEMUCS_MODEL_DIR" \
  node scripts/install-voiceover-demucs.mjs --check
```

`MEIAO_VOICEOVER_SERVICE_USER` 必须替换为实际启动 PM2/Node 口播服务的系统用户；不要照抄一个假定用户名。若 PM2 由 root 运行，也要显式填 `root` 并记录本次确认。安装前后分别用 `id`、`stat -c '%U:%G %a %n' /opt/meiao/voiceover` 和以上 `sudo -u ... test -w` 验证归属、`0750` 权限与服务用户可写性；任一步失败都停止启用。

`MEIAO_VOICEOVER_PIP_TIMEOUT_SECONDS` 是单次 socket 读取超时，`MEIAO_VOICEOVER_PIP_RETRIES` 是单连接重试次数，都不是整次安装的总时限；非法值会在创建 venv 前 fail-closed。两者只用于一次性安装命令，不需要写入 `.env.server`。维护窗口若需要总时限，应由运维在命令外层另加受控 timeout。

`deploy/voiceover/requirements.lock`、`build-requirements.lock`、`demucs-models.json` 和 `mdx.yaml` 是受版本控制的安装合同；venv、`.th` 权重和运行时临时媒体不得进入 Git、release 包或 `git status`。安装后仍先保持功能关闭，写好候选环境路径和 KIE 凭证，再执行：

```bash
npm run probe:voiceover-translation -- --readiness
```

当 `enabled=false` 时总 `ready` 可以是 `false`，但 `pythonReady/modelReady/ffmpegReady` 必须分别为 `true`；经用户批准后在候选环境临时把开关设为 `1`，重新启动并确认 `/api/health.voiceoverTranslation` 的全部布尔值以及 `ready=true`。readiness 输出只能包含布尔值和 `separationConcurrency`，不得出现 Python/模型目录、KIE 根地址、token 或签名 URL。

本地非付费 fixture 仅在用户显式提供安全绝对路径时运行：

```bash
test -n "$MEIAO_VOICEOVER_FIXTURE_PATH"
npm run probe:voiceover-translation -- --fixture-path "$MEIAO_VOICEOVER_FIXTURE_PATH"
```

它只验证本机 H.264/AAC、Demucs 输出、人声分析媒体、对齐、ducking、最终 MP4、时长、`ftyp` 与本地字节区间读取，不调用 Gemini、KIE 或 Golden。远程模式用 `MEIAO_VOICEOVER_PROBE_BASE_URL` 指向梅奥 HTTP(S) 根地址；`MEIAO_VOICEOVER_PROBE_POLL_INTERVAL_MS` 默认 `4000ms`、范围 `500-30000ms`，`MEIAO_VOICEOVER_PROBE_TIMEOUT_MS` 默认 `2400000ms`、范围 `60000-7200000ms`。`MEIAO_VOICEOVER_PROBE_SESSION_TOKEN` 必须通过当前 shell 隐式输入并在执行后清除，不得写入 `.env.server` / `.env.local`、命令历史、日志或交接文档。`MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1` 只接受启动脚本前的单次命令环境；即使误写入 env 文件也会被探针忽略。

真实 canary 只允许用户明确确认的当前账号 managed asset ID，并要求一次性确认：

```bash
test -n "$MEIAO_VOICEOVER_CANARY_ASSET_ID"
export MEIAO_VOICEOVER_PROBE_BASE_URL=https://meiaoyuntai.com
read -r -s -p '当前账号临时会话 token: ' MEIAO_VOICEOVER_PROBE_SESSION_TOKEN
echo
export MEIAO_VOICEOVER_PROBE_SESSION_TOKEN
MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1 \
npm run probe:voiceover-translation -- \
  --live \
  --source-asset-id "$MEIAO_VOICEOVER_CANARY_ASSET_ID" \
  --target-language en
unset MEIAO_VOICEOVER_PROBE_SESSION_TOKEN
```

`--remove-text` 还会触发 Golden，必须再次取得费用确认。成功或 post-create 失败证据会输出安全的内部 `parentJobId`、`childJobId` 与检查点状态，不输出 provider task ID、转录或 URL。`--resume-parent-job-id` 使用内部父 ID；`--resume-child-task-id` 只接受 live 证据中的内部 `childJobId`，直接只读 GET `/api/jobs/:id` 并核对父持有 child 合同，不支持 `providerTaskId`、不扫描父任务列表，也不重新 create。回滚把 `MEIAO_VOICEOVER_TRANSLATION_ENABLED=0` 并走正常 PM2 ready-gated reload；这只阻止新提交，历史卡片和托管结果继续可读。

发布后分别记录两类验收：

- 技术：parent/child 检查点、每组一次 TTS create、托管最终素材、H.264/AAC、HTTP Range、刷新与本地服务重启恢复。
- 感知：原口播不再可辨、背景音乐/环境声保留、目标语言正确、语速时序可接受、画面未改变。技术通过不能代替真人试听/观看。

## 启动
```bash
cd /www/wwwroot/meiao-internal
set -a
source .env.server
set +a
pm2 start ecosystem.config.cjs
pm2 save
```

## 自托管 Temporal
任务平台切到 Temporal 前，先在云端启动自托管 Temporal。Compose 文件在 `deploy/temporal/docker-compose.yml`，使用 PostgreSQL 持久化，Temporal gRPC 和 UI 都只绑定 `127.0.0.1`，不直接暴露公网。

```bash
cd /www/wwwroot/meiao-internal/deploy/temporal
docker compose up -d
docker compose ps
```

确认健康后再把 `.env.server` 切到：
```bash
MEIAO_TASK_ENGINE=temporal
MEIAO_TEMPORAL_ADDRESS=127.0.0.1:7233
MEIAO_TEMPORAL_NAMESPACE=default
MEIAO_TEMPORAL_TASK_QUEUE=meiao-cloud
MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS=10000
```

然后平滑 reload PM2：
```bash
cd /www/wwwroot/meiao-internal
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

## 本地一键部署
在本地项目目录执行：
```bash
chmod +x ./scripts/deploy_tencent.sh
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

部署脚本为零断档设计(2026-07-07 起):`npm install`/`build` 期间旧 `dist` 一直原样服务,新产物先构建到 `dist-next`,旧的 hash chunk 按修改时间保留(供部署前已打开的旧标签页懒加载),最后原子换名切换,前端静态文件没有中断窗口。

部署脚本先用原子 `mkdir /tmp/meiao-deploy-mutex` 获取整次发布的远端互斥锁，并以排他创建写入本次唯一 owner token；锁存在、owner 缺失或不匹配都 fail-closed。锁在首次 readiness/marker 检查和任何源码上传前取得，并在上传前、远端源码替换前和 dist 切换前复核 owner。随后读取远端 `.env.server`，按 `MEIAO_DEPLOY_DRAIN_FILE` 解析 marker；只要 marker 路径存在（包括空文件）就在任何源码替换前拒绝发布。远端构建后再次检查 `internal_jobs.status='running'`，以排他创建写入带本次 owner token 的 marker，等 `/api/health.deployment.activeWriteRequests=0`，再获取任务 claim 与部署共用的 MySQL 命名锁，并复查零运行任务。经典 MySQL worker 和 Temporal MySQL activity 都必须获取该锁、再次检查 marker，才能更新 job 为 `running`；因此 marker 生效前已通过首次检查但排队等锁的 worker，在部署释锁后也会放弃 claim。锁名固定在代码中以防 worker/部署配置漂移；`MEIAO_DEPLOY_JOB_CLAIM_LOCK_TIMEOUT_SECONDS` 只配置有界等待时间，默认 10 秒。

dist 原子切换后执行 `pm2 startOrReload ecosystem.config.cjs --update-env`。正式 PM2 合同为单实例 `cluster + wait_ready`：新进程完成 bootstrap、开始监听并发出 `ready` 前，旧进程继续承接流量；新进程 ready 后 PM2 才向旧进程发信号，旧进程先停 worker/定时器/Temporal，再关闭 HTTP 与连接池。脚本不再调用 `pm2 stop`/`pm2 restart`，也不操作 `iptables`。只有 `/api/health` 同时证明 HTTP、worker 和本次精确 `release.id` 后才清理 marker；命令返回异常但新 release 已健康时按成功收敛。若精确新 release 未通过，脚本可恢复旧 dist，但不能把仅存于内存的旧进程健康当作完整回滚；它必须把 owner marker 转为永不失效的 `manual`、保留 mutex 并禁止写入，避免日后 autorestart/宿主机重启从未验证的新源码与依赖启动。任何自动清理都不会停止最后一个健康进程。marker 与 mutex 仍使用不可预测私有 claim 目录原子清理；带 owner 或 `manual` 内容的 marker 永不自动失效，只有历史空 marker 保留有界过期兼容。紧急情况下只能显式设置 `MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS=1` 覆盖；该开关不应作为日常发布参数。

### 旧 fork 进程首次迁移

2026-07-23 以前的旧进程无 `deployment.activeWriteRequests` 指标，也尚未参与新的 MySQL 命名锁 claim 协议；标准脚本会安全拒绝，不允许猜测存量写请求已归零。仅首次迁移使用一次性候选切换：先创建不过期 marker，新版候选必须以 `MEIAO_BIND_HOST=127.0.0.1 PORT=3101` 启动，通过精确 release health 后才备份 Nginx vhost、把所有正式回源从 3100 改到 3101，经 `nginx -t` 后 reload。公网连续探测无 502，且 3100 旧进程已有连接排空后，用一条独占 MySQL 连接执行 `LOCK TABLES internal_jobs WRITE`、复查 `running=0`，并在该表锁仍持有时停止旧 fork，严格确认旧 PID 已退出后才 `UNLOCK TABLES`。这个特殊步骤只用来销毁“旧 worker 已通过 marker 检查、正在表锁后排队”的最后竞态；公网此时已由 3101 候选服务，不会形成无上游。然后把正式 `meiao-internal` 迁移为 ecosystem 的 cluster/wait_ready 合同，确认 3100 新 release 健康；最后将 Nginx 切回 3100、再次连续探测，才删除 3101 候选与 marker。任一候选/health/Nginx 校验失败都保留当前健康上游并恢复 vhost 备份；候选端口非回环绑定会被服务端直接拒绝启动。此流程只用一次，迁移完成后所有后续发布均走标准脚本。

### 部署互斥锁残留恢复

`deploy_tencent.sh` 的本地 `EXIT` trap 在上传前失败时可释放 owner 匹配的 mutex；远端 mutation 开始后，还必须有匹配的 `remote-complete`。释放 claim 位于类似 `/tmp/.meiao-deploy-mutex.release-XXXXXX/claimed` 的随机私有目录；核验后只删除该 claim，此时新建的 live mutex 或外部预建的可预测同名路径都不会被误删。`kill -9`、本机断电、SSH 中断或远端 shell 尚未完成时可能留下 mutex 或私有 claim；**残锁没有自动过期机制，不得按 mtime 直接删除**。

1. 读取 owner：`cat /tmp/meiao-deploy-mutex/owner`。owner 缺失也视为异常残锁。
2. 确认没有仍在执行的远端发布步骤：检查 `hold-deploy-job-lock.mjs`、`pm2 startOrReload`、`npm install`、`npm run build`、`tar -xzf` 等进程；无法确认时保持锁不动。
3. `source /www/wwwroot/meiao-internal/.env.server`，解析 `DRAIN_MARKER_FILE="${MEIAO_DEPLOY_DRAIN_FILE:-/tmp/meiao-deploy-drain}"` 并读取其完整内容。若为 `manual` 或与 mutex owner 相同的活动 token，先按下方 manual 流程确认 PM2 与 health/worker；不要先删 marker 或 mutex。
4. 同时检查 `/tmp/.meiao-deploy-mutex.release-*` 和 marker 对应的 `.<marker名>.quarantine-*`/`.<marker名>.manual-*` 私有目录。每个 claim 的业务对象都在其 `claimed` 子路径；若 live 路径已被新 owner 占用，两者都保留，禁止覆盖、合并或递归删除。
5. 确认服务健康、没有残留 job-lock/reload 子进程，且 owner 从步骤 1 起未变化后，再处理残锁。若有匹配的 `remote-complete`，使用当前版本 `scripts/deploy-ownership.mjs release-mutex --mutex-dir /tmp/meiao-deploy-mutex --owner '<owner>' --mutation-started 1`。若没有完成证明，先把它视为 mutation 状态未知并完成上述全部人工核验；人工 claim 也必须先用 `CLAIM_PARENT=$(mktemp -d /tmp/.meiao-deploy-mutex.manual-release-XXXXXX)`，再执行 `mv /tmp/meiao-deploy-mutex "$CLAIM_PARENT/claimed"`。复核 claimed owner 和允许文件后，只删除 claimed 内的允许文件并依次 `rmdir "$CLAIM_PARENT/claimed" "$CLAIM_PARENT"`。owner 不匹配或 live mutex 已重新出现时保留 claim 并停止，不得把 claim rename 回 live、直接删除 live mutex或递归删除。

### manual 门禁恢复

部署输出 `manual` 时，**不得直接删除 marker，也不得为恢复而停止当前唯一健康进程**。若同时存在部署 mutex，先保留 mutex，然后在云上按以下顺序恢复：

1. 保留 marker，检查 `pm2 jlist`、`/api/health`、`release.id` 和 3100 监听进程；先确定是新 release 已健康但脚本超时，还是新 release 未就绪。
2. 若本次精确 release health 已通过，不停进程，直接进入步骤 4。若当前仍是旧健康 release，先恢复旧 dist 并保持 marker。
3. 只在 3100 没有任何健康进程时，才从项目目录执行 `pm2 startOrReload ecosystem.config.cjs --update-env`；marker 保持 `manual`，新代码只允许 health/GET，不接受付费写请求。
4. 执行 `curl -fsS http://127.0.0.1:3100/api/health | node scripts/assert-deploy-health.mjs`。只有 HTTP 和 worker 都健康后，才执行 `pm2 save`。marker 删除也必须使用私有 claim：`MARKER="${MEIAO_DEPLOY_DRAIN_FILE:-/tmp/meiao-deploy-drain}"; CLAIM_PARENT=$(mktemp -d "$(dirname "$MARKER")/.$(basename "$MARKER").manual-recovery-XXXXXX"); mv "$MARKER" "$CLAIM_PARENT/claimed"`。确认 claimed 完整内容恰为 `manual` 后只删除 `claimed` 并 `rmdir "$CLAIM_PARENT"`。内容不符或 rename 后出现新 live marker 时保留 claim，绝不能删除、覆盖或 rename 回 live。

`MEIAO_OLD_ASSET_RETENTION_DAYS`(部署时本地环境变量,默认 `30`)控制旧 hash chunk 的保留天数,超期文件在合并前清掉,防止 `dist/assets` 无限膨胀。前端每 5 分钟和回到前台时会比对 `version.json` 的构建号,发现新版本且无进行中任务时自动软刷新;有任务时只提示不打断。

## 云上发布硬性门禁
- 每次同步新内容到云上前，必须先完成代码审查；至少检查本次 diff、数据隔离、公网资源 URL、日志/统计保留、权限边界和核心任务链路。
- 部署脚本默认会拦截未审查发布；只有确认审查完成后，才允许带 `MEIAO_CODE_REVIEW_CONFIRMED=1` 执行。
- 服务器 `npm install` 后会执行 `npm run security:audit`；只要依赖树仍有 high/critical 级别漏洞，发布会在构建和 PM2 reload 前停止。
- 发布前与 PM2 reload 前必须通过运行中任务检查和 drain 交接；有活跃 job 时等待结束后重新执行，不得默认使用覆盖开关。
- 不允许为了省时间绕过该门禁；紧急修复也必须先做最小范围代码审查并记录验证结果。

如果密钥路径或服务器地址变化，可以临时指定：
```bash
MEIAO_SSH_KEY=~/.ssh/MEIAO.pem \
MEIAO_SERVER_HOST=111.229.66.247 \
MEIAO_CODE_REVIEW_CONFIRMED=1 \
./scripts/deploy_tencent.sh
```

## 更新版本
```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

## 更新前数据巡检
- 每次把 3001 壳前端能力同步到云上前，先按 `docs/cloud-update-data-cleanup.md` 做数据巡检和必要清理。
- 重点检查 `app_states.state_json` 里的历史垃圾卡：默认 `idle` 视频诊断、空诊断项目卡、测试账号残留项目。
- 记录发布前后的 `users`、`app_states`、`internal_logs`、`usage_daily` 数量；日志只保留 7 天，统计数据永久保留。
- 不允许手动清空运行日志；账号删除会清理该账号业务数据，但必须保留 `usage_daily` 永久统计数据。
- 部署后必须用两个不同账号交叉验证账号隔离，确认项目卡、素材条和输入框草稿不会复用上一账号状态。

## 访问
- Node 服务端口：`3100`
- 可先直接测试：`http://111.229.66.247:3100`

## 说明
- 生产模式下，`server/index.mjs` 会直接托管 `dist` 前端页面。
- API 和前端页面都走同一个服务，不需要再单独跑 `vite dev`。
- `MEIAO_PUBLIC_BASE_URL` 配置后，上传素材和生成结果会优先保存到云服务器本地持久化资源目录，并通过内部稳定 URL 恢复与下载。
- `MEIAO_ASSET_X_ACCEL=1` 仅用于已配置 Nginx internal alias 的生产环境；未配置时必须保持默认 `0`。
- `MEIAO_ALLOWED_ORIGINS` 用于限制允许访问内部 API 的前端来源。
- `MEIAO_ADMIN_USERNAME`、`MEIAO_ADMIN_PASSWORD`、`MEIAO_SUPER_ADMIN_USERS` 用于首次管理员账号和超级管理员识别，生产环境必须替换默认值。
- 视频诊断依赖 Spider 网关时，需要配置 `MEIAO_SPIDER_GATEWAY_URL` 和 `MEIAO_SPIDER_API_KEY`。
- 资源默认保留 3 天，服务启动后会自动执行定时清理。
