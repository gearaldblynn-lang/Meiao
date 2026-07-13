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
MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS=10
MEIAO_TASK_ENGINE=mysql
MEIAO_TEMPORAL_ADDRESS=127.0.0.1:7233
MEIAO_TEMPORAL_NAMESPACE=default
MEIAO_TEMPORAL_TASK_QUEUE=meiao-cloud
MEIAO_PROVIDERLESS_RUNNING_STALE_MS=300000
MEIAO_SUBMITTED_RUNNING_STALE_MS=21600000
MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES=2
MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS=30000
APP_STATE_MAX_BYTES=16777216
MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS=120000
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
MEIAO_CHAT_SSE_HEARTBEAT_MS=15000
AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES=1
AGENT_IMAGE_TOOL_CONCURRENCY=2
AGENT_MODEL_TRANSIENT_MAX_RETRIES=1
MEIAO_ALLOWED_ORIGINS=https://meiaoyuntai.com,https://www.meiaoyuntai.com,http://111.229.66.247,http://111.229.66.247:3100
MEIAO_ASSET_X_ACCEL=0
VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS=3
VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS=5000
MEIAO_ADMIN_USERNAME=admin
MEIAO_ADMIN_PASSWORD=请替换成你的管理员密码
MEIAO_SUPER_ADMIN_USERS=admin
MEIAO_SPIDER_GATEWAY_URL=请替换成你的 Spider 网关地址
MEIAO_SPIDER_API_KEY=请替换成你的 Spider Key
KIE_API_KEY=请替换成你的真实 KIE Key
APIPORTS_API_KEY=请替换成你的真实 APIports Key
ARK_API_KEY=请替换成你的真实 ARK Key
OPENAI_COMPATIBLE_API_KEY=请替换成你的 OpenAI Compatible 中转站 Key
OPENAI_COMPATIBLE_BASE_URL=https://maxforai.top
OPENAI_COMPATIBLE_MODELS=gpt-5.4,gpt-5.5
OPENAI_COMPATIBLE_RESPONSES_PATH=/v1/responses
AGENT_TOOL_MAX_ROUNDS=5
AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS=2
EOF
```

第4期智能体多工具复用 `OPENAI_COMPATIBLE_*`，V2 对话经 `OPENAI_COMPATIBLE_RESPONSES_PATH` 调 responses 端点以支持 `web_search`；`AGENT_TOOL_MAX_ROUNDS` 是单轮工具循环上限，默认 5。`AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS` 是多图独立输出规划欠覆盖时的修复审查轮数，默认 2；仍不完整会快速失败，不执行单张伪完成。

`MEIAO_PROVIDERLESS_RUNNING_STALE_MS` 控制已标记 `running` 但还没有上游 `providerTaskId` 的异常检测窗口。云上建议 `300000`：内部幂等任务可安全回到 `retry_waiting`；外部付费任务改为 `provider_submission_unknown`，释放并发但不自动重提、不自动退积分预留，需要管理员核实上游后处置。`MEIAO_SUBMITTED_RUNNING_STALE_MS` 控制已记录上游 ID 但未回写终态的检查窗口；只有具备真实查询接口的 task type 才回到 `retry_waiting` 继续查旧任务，不可查询的 chat response ID 不会自动重提。`MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES` 默认 `2`，只是旧任务查询/结果下载的恢复次数。`MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS` 建议 `30000`。

`MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS` 默认 `10`，控制同用户、同语义付费任务的 MySQL 命名锁等待。去重查询、积分预留和 job 创建在同一事务内完成；锁超时返回 409，不创建第二个任务。

`APP_STATE_MAX_BYTES` 是 app_states 单行 state_json 写入大小闸(超闸按 updatedAt 倒序裁老项目,active 永留)。云上 2026-07-04 起为 `16777216`(16 MiB):当时妙木山 8.76 MiB 已超旧 8 MiB 闸、正在丢老项目;线上 MySQL `max_allowed_packet` 实测 128 MiB,16 MiB 仍有 8 倍余量。调整该值必须 `source .env.server` 后 `pm2 restart --update-env` 并从进程环境(`/proc/<pid>/environ`)复核生效。

`MEIAO_KIE_HTTP_TRANSIENT_RETRIES` / `MEIAO_KIE_HTTP_RETRY_BASE_MS` 控制 KIE HTTP 请求级瞬时重试（默认 2 次、退避 1s/3s）：连接层错误（`fetch failed` 等，未收到响应）对所有请求重试，`502/503/504` 只对只读 GET 重试；createTask/chat 等可能扣费的提交 POST 收到响应一律不重试。文件上传 POST 是显式例外，由独立上传预算控制。任务失败落库时 `error_message` 为用户可读人话、`error_detail` 保留技术原文。

`MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS` 控制 KIE 素材上传单次 HTTP 超时，云上建议 `120000`。分镜参考视频等较大素材需要更长上传预算；如果上传出现瞬时网络或上游 5xx 错误，任务允许有限重试后释放并发，不走 base64 上传接口。

`MEIAO_KIE_MANAGED_ASSET_MODE=direct-first` 让我方 `/api/assets/file/` 托管素材优先使用 `MEIAO_PUBLIC_BASE_URL` 的 HTTPS 地址。只有上游明确返回文件读取/下载/MIME 不可用错误，且没有 `providerTaskId` 时，才转存 KIE 并重试同一模型；普通 HTTP 500/502、网络中断、鉴权、余额、限额和已有 task id 都不触发回退。紧急回滚时把该值改为 `kie-only` 并执行 `pm2 restart meiao-internal --update-env`。

`MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY` 是所有任务共享的 file-stream-upload 总并发，默认 `3`。`MEIAO_KIE_ASSET_UPLOAD_RETRIES` / `MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS` 默认 `2` / `1000`，只重试文件上传的连接错误与 `429/500/502/503/504`。`MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS` / `MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES` 默认 `1800000` / `2000`，复用成功转存 URL；失败不缓存，PM2 重启后缓存自然清空。

`MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS` / `MEIAO_RESULT_ASSET_DOWNLOAD_RETRIES` / `MEIAO_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS` 默认 `60000` / `2` / `500`。它们只控制 provider 已完成后抓取结果文件的幂等 GET 和响应体读取；连接错误、超时、`429/5xx` 可重试，`4xx` 不重试，也不会重新提交生成任务或产生重复计费。

`MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY` 控制单个 `kie_image` 任务在提交 KIE 前解析/转存素材的并发，默认 `2`。详情页批量生图会同时创建多张图，每张又带多张商品/参考素材；该值不要盲目调高，避免把 KIE 图床上传并发打满。

`MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY` 控制单个 `kie_seedance_video` 任务在提交 KIE 前解析/转存图片、视频、音频素材的总并发，默认 `2`。分镜视频常带多张 3-5MB 商品图和分镜图，保持保守默认可降低 `asset_upload fetch failed`。

`MEIAO_KIE_CHAT_MEDIA_RESOLUTION_CONCURRENCY` 控制单个 `kie_chat` 策划/分镜任务解析图片和视频的并发，默认 `2`。它与 `MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY` 进程级总闸门叠加，前者控制单 job 扇出，后者控制全账号总上传压力。

对 `provider_submission_unknown` 任务，管理员使用 `POST /api/admin/task-platform/jobs/:id/submission-resolution`：`{"action":"bind","providerTaskId":"..."}` 仅允许绑定具备旧任务查询路径且已人工核实的 ID；`{"action":"release"}` 只能在确认上游没有创建任务后释放积分预留。两种操作都记录管理日志和任务事件。

`MEIAO_CHAT_SSE_HEARTBEAT_MS` 默认 `15000`，控制智能体聊天 SSE 心跳间隔。长耗时多图生图可能数分钟没有业务事件，心跳用于避免代理或浏览器把连接判定为空闲后断开。

`AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES` 默认 `1`，控制智能体单次 `generate_image` 提交/读取遇到 `fetch failed`、502、超时等瞬时上游错误时的内部快速重试次数。该重试发生在执行器内部，不把瞬时失败交给模型总结成“部分完成”。

`AGENT_IMAGE_TOOL_CONCURRENCY` 默认 `2`，控制智能体同一轮多张独立 `generate_image` 工具调用的受控并发，代码上限为 `5`。只有本轮工具调用全是生图时才并发；混合 `search_knowledge` / `generate_image` 仍串行，避免检索上下文与生图状态交叉。

`AGENT_MODEL_TRANSIENT_MAX_RETRIES` 默认 `1`，控制智能体规划/总结模型请求在尚未输出内容前遇到 `fetch failed`、超时等瞬时网络错误时的内部快速重试次数。已开始流式输出的请求不会自动重试，避免用户看到重复文本。

`MEIAO_ASSET_X_ACCEL` 默认保持 `0`。只有在 Nginx 已配置内部资源映射后才可设为 `1`，让 `/api/assets/file/:id` 由 Node 校验权限和缓存头，再通过 `X-Accel-Redirect` 交给 Nginx 直出文件，降低大视频经过 Node 流式转发的抖动。示例：

`VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS` 和 `VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS` 是前端构建期变量，控制项目卡片视频播放前的预缓冲。默认值分别为 `3` 秒和 `5000` 毫秒；线上网络较慢时可小幅上调，调整后需要重新构建前端。

```nginx
location /__meiao_stored_assets/ {
  internal;
  alias /www/wwwroot/meiao-internal/server/data/assets/;
}
```

开启后重启服务：

```bash
MEIAO_ASSET_X_ACCEL=1
pm2 restart meiao-internal --update-env
```

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
```

然后重启 PM2：
```bash
cd /www/wwwroot/meiao-internal
pm2 restart meiao-internal --update-env
pm2 save
```

## 本地一键部署
在本地项目目录执行：
```bash
chmod +x ./scripts/deploy_tencent.sh
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

部署脚本为零断档设计(2026-07-07 起):`npm install`/`build` 期间旧 `dist` 一直原样服务,新产物先构建到 `dist-next`,旧的 hash chunk 按修改时间保留(供部署前已打开的旧标签页懒加载),最后原子换名切换,前端静态文件没有中断窗口。

部署脚本会在上传代码前、远端构建后检查 `internal_jobs.status='running'`，并在最终切换时进入首发兼容 drain：预检 `iptables`/`ip6tables`/`ss`，用带唯一 comment 的临时 `iptables` 规则拒绝新的 IPv4 Nginx 回源和公网直连 3100，同时用 `ip6tables INPUT` 拒绝 IPv6 直连 3100，等已有连接连续为零；再创建 marker，对 `internal_jobs` 取得 `WRITE` 表锁，持锁连接复查零运行任务、停止旧 PM2、验证停机与 MySQL 会话仍存活后才回写 stopped ack。这会同时排空旧版本的 job 和不落 job 的同步 provider 请求，不修改 Nginx 配置。

新进程启动后才幂等删除精确网络规则供 health/静态流量使用；每条规则先用对应命令执行 `-C`，只有退出码 0 才 `-D`、退出码 1 视为已不存在，其他错误保留剩余状态并失败。marker 仍拒绝 API 写请求并暂停 worker，直到 `/api/health` 同时确认 HTTP 与 worker 健康。health 失败时只在 `pm2 pid` 命令成功且输出全为 0 时认定新进程已停；旧进程已停但新进程未启动、停机无法证明或网络清理失败时，保留规则状态并把 marker 写为永不过期的 `manual`。紧急情况下只能显式设置 `MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS=1` 覆盖；该开关不应作为日常发布参数。

### manual 门禁恢复

部署输出 `manual` 时，**不得直接删除 marker**。记下脚本输出的 `DRAIN_NETWORK_STATE_FILE`，然后在云上按以下顺序恢复：

1. 保留 `/tmp/meiao-deploy-drain` 中的 `manual`，执行 `pm2 stop meiao-internal`；只有 `pm2 pid meiao-internal` 命令成功且输出全为 `0` 才继续。
2. 服务已确认停止后，执行 `node scripts/backend-network-drain.mjs exit --state-file <脚本输出的状态文件>`；命令失败时保留文件并重试，不手工宽泛删规则。
3. 执行 `pm2 restart meiao-internal --update-env`（进程不存在时用 `pm2 start ecosystem.config.cjs`）；marker 保持 `manual`，因此新代码只允许 health/GET，不会接受付费写请求。
4. 执行 `curl -fsS http://127.0.0.1:3100/api/health | node scripts/assert-deploy-health.mjs`。只有 HTTP 和 worker 都健康后，才执行 `pm2 save` 并删除 marker：`rm -f /tmp/meiao-deploy-drain`。

`MEIAO_OLD_ASSET_RETENTION_DAYS`(部署时本地环境变量,默认 `30`)控制旧 hash chunk 的保留天数,超期文件在合并前清掉,防止 `dist/assets` 无限膨胀。前端每 5 分钟和回到前台时会比对 `version.json` 的构建号,发现新版本且无进行中任务时自动软刷新;有任务时只提示不打断。

## 云上发布硬性门禁
- 每次同步新内容到云上前，必须先完成代码审查；至少检查本次 diff、数据隔离、公网资源 URL、日志/统计保留、权限边界和核心任务链路。
- 部署脚本默认会拦截未审查发布；只有确认审查完成后，才允许带 `MEIAO_CODE_REVIEW_CONFIRMED=1` 执行。
- 服务器 `npm install` 后会执行 `npm run security:audit`；只要依赖树仍有 high/critical 级别漏洞，发布会在构建和 PM2 重启前停止。
- 发布前与重启前必须通过运行中任务检查和 drain 交接；有活跃 job 时等待结束后重新执行，不得默认使用覆盖开关。
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
