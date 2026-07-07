#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

SERVER_HOST="${MEIAO_SERVER_HOST:-111.229.66.247}"
SERVER_USER="${MEIAO_SERVER_USER:-root}"
SERVER_PORT="${MEIAO_SERVER_PORT:-22}"
SSH_KEY_PATH="${MEIAO_SSH_KEY:-$HOME/.ssh/MEIAO.pem}"
REMOTE_APP_DIR="${MEIAO_REMOTE_APP_DIR:-/www/wwwroot/meiao-internal}"
REMOTE_TMP_DIR="/tmp/meiao-deploy-$$"

if [[ "${MEIAO_CODE_REVIEW_CONFIRMED:-}" != "1" ]]; then
  echo "部署已拦截：同步云上前必须完成代码审查。"
  echo "完成审查并确认风险后，使用：MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh"
  exit 1
fi

if [[ ! -f "$SSH_KEY_PATH" ]]; then
  echo "找不到 SSH 密钥文件：$SSH_KEY_PATH"
  echo "你可以先设置环境变量，例如："
  echo "MEIAO_SSH_KEY=~/.ssh/MEIAO.pem ./scripts/deploy_tencent.sh"
  exit 1
fi

echo "开始部署到 ${SERVER_USER}@${SERVER_HOST}:${REMOTE_APP_DIR}"

export COPYFILE_DISABLE=1

tar \
  --no-mac-metadata \
  --no-xattrs \
  --no-acls \
  --no-fflags \
  --exclude='./.git' \
  --exclude='./.worktrees' \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./server/data' \
  --exclude='./.env.server' \
  --exclude='./._*' \
  --exclude='*/._*' \
  -czf - \
  -C "$ROOT_DIR" . | ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" "
    set -e
    mkdir -p '$REMOTE_TMP_DIR'
    tar -xzf - -C '$REMOTE_TMP_DIR'
    mkdir -p '$REMOTE_APP_DIR'

    if [ -f '$REMOTE_APP_DIR/.env.server' ]; then
      cp '$REMOTE_APP_DIR/.env.server' '$REMOTE_TMP_DIR/.env.server'
    fi

    # S4 治本:整个 install/build 期间旧 dist 一直原样服务(不删),新前端产物先落 dist-next,
    # 最后原子换名切换。旧脚本在 install 前就删 dist,导致每次部署有数分钟前端 404 窗口。
    find '$REMOTE_APP_DIR' -mindepth 1 -maxdepth 1 ! -name '.env.server' ! -name 'server' ! -name 'dist' -exec rm -rf {} +
    if [ -d '$REMOTE_APP_DIR/server' ]; then
      find '$REMOTE_APP_DIR/server' -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} +
    fi
    cp -R \"$REMOTE_TMP_DIR\"/. \"$REMOTE_APP_DIR\"/

    cd '$REMOTE_APP_DIR'
    npm config delete disturl >/dev/null 2>&1 || true
    npm config delete sass_binary_site >/dev/null 2>&1 || true
    npm config set registry https://registry.npmjs.org/ >/dev/null 2>&1
    npm install
    npm run security:audit
    rm -rf dist-next
    npm run build -- --outDir dist-next

    # 旧 hash chunk 保留(供部署前打开的旧标签页懒加载),按 mtime 保留 ${MEIAO_OLD_ASSET_RETENTION_DAYS:-30} 天防无限膨胀;
    # cp -p 保留 mtime,retention 才有依据;合并失败必须报错退出,不许静默丢 generation。
    if [ -d dist/assets ]; then
      find dist/assets -maxdepth 1 -type f -mtime +${MEIAO_OLD_ASSET_RETENTION_DAYS:-30} -delete
      mkdir -p dist-next/assets
      cp -Rpn dist/assets/. dist-next/assets/
    fi

    # 原子切换:两次 rename,静态服务零断档
    rm -rf dist-prev
    if [ -d dist ]; then mv dist dist-prev; fi
    mv dist-next dist
    rm -rf dist-prev '$REMOTE_TMP_DIR'

    if [ ! -f '.env.server' ]; then
      echo '服务器缺少 .env.server，请先创建后再重试。'
      exit 1
    fi

    set -a
    source .env.server
    set +a

    if pm2 describe meiao-internal >/dev/null 2>&1; then
      pm2 restart meiao-internal --update-env
    else
      pm2 start ecosystem.config.cjs
    fi

    pm2 save
  "

echo "部署完成。"
echo "访问地址：http://${SERVER_HOST}"
echo "备用地址：http://${SERVER_HOST}:3100"
