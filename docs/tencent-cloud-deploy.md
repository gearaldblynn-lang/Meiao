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
MEIAO_PUBLIC_BASE_URL=http://111.229.66.247:3100
MEIAO_JOB_MAX_CONCURRENCY=3
MEIAO_TASK_ENGINE=mysql
MEIAO_TEMPORAL_ADDRESS=127.0.0.1:7233
MEIAO_TEMPORAL_NAMESPACE=default
MEIAO_TEMPORAL_TASK_QUEUE=meiao-cloud
MEIAO_PROVIDERLESS_RUNNING_STALE_MS=300000
MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS=30000
MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS=45000
MEIAO_ALLOWED_ORIGINS=http://111.229.66.247,http://111.229.66.247:3100
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
EOF
```

第4期智能体多工具复用 `OPENAI_COMPATIBLE_*`，V2 对话经 `OPENAI_COMPATIBLE_RESPONSES_PATH` 调 responses 端点以支持 `web_search`；`AGENT_TOOL_MAX_ROUNDS` 是单轮工具循环上限，默认 5。

`MEIAO_PROVIDERLESS_RUNNING_STALE_MS` 控制已标记 `running` 但还没有上游 `providerTaskId` 的任务兜底释放窗口。云上建议 `300000`，避免素材上传/提交阶段异常卡住后长期占满同账号并发；真正已拿到 `providerTaskId` 的任务不走这个释放规则，会继续等待上游结果。`MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS` 建议 `30000`，让回收检查更及时。

`MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS` 控制 KIE 素材上传单次 HTTP 超时，云上建议 `45000`。素材上传内部会先尝试 stream 上传，失败后立即 fallback 到 base64 上传；如果仍失败，任务应快速终态失败并释放并发，不再进入 job 级重试。

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

## 云上发布硬性门禁
- 每次同步新内容到云上前，必须先完成代码审查；至少检查本次 diff、数据隔离、公网资源 URL、日志/统计保留、权限边界和核心任务链路。
- 部署脚本默认会拦截未审查发布；只有确认审查完成后，才允许带 `MEIAO_CODE_REVIEW_CONFIRMED=1` 执行。
- 服务器 `npm install` 后会执行 `npm run security:audit`；只要依赖树仍有 high/critical 级别漏洞，发布会在构建和 PM2 重启前停止。
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
