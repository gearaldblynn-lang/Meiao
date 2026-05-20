# 腾讯云内部版部署

## 服务器目录
- 项目目录：`/www/wwwroot/meiao-internal`
- 服务端环境文件：`/www/wwwroot/meiao-internal/.env.server`

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
MEIAO_ALLOWED_ORIGINS=http://111.229.66.247,http://111.229.66.247:3100
MEIAO_ADMIN_USERNAME=admin
MEIAO_ADMIN_PASSWORD=请替换成你的管理员密码
MEIAO_SUPER_ADMIN_USERS=admin
MEIAO_SPIDER_GATEWAY_URL=请替换成你的 Spider 网关地址
MEIAO_SPIDER_API_KEY=请替换成你的 Spider Key
KIE_API_KEY=请替换成你的真实 KIE Key
ARK_API_KEY=请替换成你的真实 ARK Key
EOF
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

## 本地一键部署
在本地项目目录执行：
```bash
chmod +x ./scripts/deploy_tencent.sh
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

## 云上发布硬性门禁
- 每次同步新内容到云上前，必须先完成代码审查；至少检查本次 diff、数据隔离、公网资源 URL、日志/统计保留、权限边界和核心任务链路。
- 部署脚本默认会拦截未审查发布；只有确认审查完成后，才允许带 `MEIAO_CODE_REVIEW_CONFIRMED=1` 执行。
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
- `MEIAO_ALLOWED_ORIGINS` 用于限制允许访问内部 API 的前端来源。
- `MEIAO_ADMIN_USERNAME`、`MEIAO_ADMIN_PASSWORD`、`MEIAO_SUPER_ADMIN_USERS` 用于首次管理员账号和超级管理员识别，生产环境必须替换默认值。
- 视频诊断依赖 Spider 网关时，需要配置 `MEIAO_SPIDER_GATEWAY_URL` 和 `MEIAO_SPIDER_API_KEY`。
- 资源默认保留 3 天，服务启动后会自动执行定时清理。
