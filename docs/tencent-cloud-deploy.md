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
./scripts/deploy_tencent.sh
```

如果密钥路径或服务器地址变化，可以临时指定：
```bash
MEIAO_SSH_KEY=~/.ssh/MEIAO.pem \
MEIAO_SERVER_HOST=111.229.66.247 \
./scripts/deploy_tencent.sh
```

## 更新版本
```bash
./scripts/deploy_tencent.sh
```

## 访问
- Node 服务端口：`3100`
- 可先直接测试：`http://111.229.66.247:3100`

## 说明
- 生产模式下，`server/index.mjs` 会直接托管 `dist` 前端页面。
- API 和前端页面都走同一个服务，不需要再单独跑 `vite dev`。
- `MEIAO_PUBLIC_BASE_URL` 配置后，上传素材和生成结果会优先保存到云服务器本地持久化资源目录，并通过内部稳定 URL 恢复与下载。
- 资源默认保留 3 天，服务启动后会自动执行定时清理。
