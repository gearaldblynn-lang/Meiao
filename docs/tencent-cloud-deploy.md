# 腾讯云内部版部署

## 服务器目录
- 项目目录：`/www/wwwroot/meiao-internal`
- 服务端环境文件：`/www/wwwroot/meiao-internal/.env.server`

## 首次部署
```bash
cd /www/wwwroot
git clone https://github.com/gearaldblynn-lang/Meiao.git meiao-internal
cd /www/wwwroot/meiao-internal
npm install
npm run build
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

## 更新版本
```bash
cd /www/wwwroot/meiao-internal
git pull origin main
npm install
npm run build
set -a
source .env.server
set +a
pm2 restart meiao-internal --update-env
```

## 访问
- Node 服务端口：`3100`
- 可先直接测试：`http://111.229.66.247:3100`

## 说明
- 生产模式下，`server/index.mjs` 会直接托管 `dist` 前端页面。
- API 和前端页面都走同一个服务，不需要再单独跑 `vite dev`。
