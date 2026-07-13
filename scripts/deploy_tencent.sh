#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

SERVER_HOST="${MEIAO_SERVER_HOST:-111.229.66.247}"
SERVER_USER="${MEIAO_SERVER_USER:-root}"
SERVER_PORT="${MEIAO_SERVER_PORT:-22}"
SSH_KEY_PATH="${MEIAO_SSH_KEY:-$HOME/.ssh/MEIAO.pem}"
REMOTE_APP_DIR="${MEIAO_REMOTE_APP_DIR:-/www/wwwroot/meiao-internal}"
REMOTE_TMP_DIR="/tmp/meiao-deploy-$$"
DEPLOY_ALLOW_ACTIVE_JOBS="${MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS:-0}"

if [[ "$DEPLOY_ALLOW_ACTIVE_JOBS" != "1" ]]; then
  DEPLOY_ALLOW_ACTIVE_JOBS="0"
fi

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

run_remote_deploy_readiness() {
  echo "检查云上是否有运行中任务..."
  ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" "
    set -e
    cd '$REMOTE_APP_DIR'
    if [ ! -f '.env.server' ]; then
      echo '服务器缺少 .env.server，无法执行部署就绪检查。'
      exit 2
    fi
    set -a
    source .env.server
    set +a
    MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' MEIAO_DEPLOY_READINESS_RUN=1 node --input-type=module
  " < "$ROOT_DIR/scripts/check-deploy-readiness.mjs"
}

run_remote_deploy_readiness

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

    # 旧 hash chunk 保留(供部署前打开的旧标签页懒加载),按 mtime 保留 ${MEIAO_OLD_ASSET_RETENTION_DAYS:-30} 天防无限膨胀。
    # 注意:不能用 cp -n——coreutils 9.2+ 对被跳过的文件报错并退出 1,set -e 会把部署掐死在原子切换前;
    # 改为显式'不存在才拷',cp 的真实失败仍会炸出来,不吞错。
    if [ -d dist/assets ]; then
      find dist/assets -maxdepth 1 -type f -mtime +${MEIAO_OLD_ASSET_RETENTION_DAYS:-30} -delete
      mkdir -p dist-next/assets
      find dist/assets -maxdepth 1 -type f | while IFS= read -r asset; do
        base=\$(basename \"\$asset\")
        if [ ! -e \"dist-next/assets/\$base\" ]; then
          cp -p \"\$asset\" \"dist-next/assets/\$base\"
        fi
      done
    fi

    # install/build 期间仍可能有新任务进入；切换前再次检查，避免 PM2 重启中断 provider 提交阶段。
    if [ ! -f '.env.server' ]; then
      echo '服务器缺少 .env.server，请先创建后再重试。'
      exit 1
    fi
    set -a
    source .env.server
    set +a
    MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' node scripts/check-deploy-readiness.mjs

    # 首次发布时旧进程尚不认识 drain marker。先落 marker，再用 internal_jobs WRITE lock
    # 冻结旧进程的提交/认领，并在持锁连接上复查 running=0。旧进程停止后释放表锁，
    # 新进程继续靠 marker 拒绝提交和暂停 worker，直到 health 验证完成。
    DRAIN_MARKER_FILE="\${MEIAO_DEPLOY_DRAIN_FILE:-/tmp/meiao-deploy-drain}"
    DRAIN_READY_FILE="/tmp/meiao-deploy-drain-ready-\$\$"
    DRAIN_RELEASE_FILE="/tmp/meiao-deploy-drain-release-\$\$"
    DRAIN_PID=''
    cleanup_deploy_drain() {
      if [ -n "\$DRAIN_PID" ] && kill -0 "\$DRAIN_PID" >/dev/null 2>&1; then
        touch "\$DRAIN_RELEASE_FILE" || true
        wait "\$DRAIN_PID" || true
      fi
      rm -f "\$DRAIN_READY_FILE" "\$DRAIN_RELEASE_FILE" "\$DRAIN_MARKER_FILE"
    }
    trap cleanup_deploy_drain EXIT INT TERM
    touch "\$DRAIN_MARKER_FILE"
    MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' \
      node scripts/hold-deploy-drain.mjs \
        --ready-file "\$DRAIN_READY_FILE" \
        --release-file "\$DRAIN_RELEASE_FILE" &
    DRAIN_PID=\$!
    for attempt in \$(seq 1 300); do
      if [ -f "\$DRAIN_READY_FILE" ]; then break; fi
      if ! kill -0 "\$DRAIN_PID" >/dev/null 2>&1; then
        wait "\$DRAIN_PID"
        exit 2
      fi
      sleep 0.2
    done
    if [ ! -f "\$DRAIN_READY_FILE" ]; then
      echo '部署 drain 获取超时，已停止发布。'
      exit 2
    fi
    cat "\$DRAIN_READY_FILE"

    # 原子切换:两次 rename,静态服务零断档
    rm -rf dist-prev
    if [ -d dist ]; then mv dist dist-prev; fi
    mv dist-next dist
    rm -rf dist-prev '$REMOTE_TMP_DIR'

    PM2_APP_EXISTS=0
    if pm2 describe meiao-internal >/dev/null 2>&1; then
      PM2_APP_EXISTS=1
      pm2 stop meiao-internal
    fi

    # 旧进程已停止，释放 bootstrap 表锁；marker 仍由新代码识别并保持 drain。
    touch "\$DRAIN_RELEASE_FILE"
    wait "\$DRAIN_PID"
    DRAIN_PID=''
    rm -f "\$DRAIN_READY_FILE" "\$DRAIN_RELEASE_FILE"

    if [ "\$PM2_APP_EXISTS" = '1' ]; then
      pm2 restart meiao-internal --update-env
    else
      pm2 start ecosystem.config.cjs
    fi

    HEALTH_READY=0
    for attempt in \$(seq 1 30); do
      if curl -fsS http://127.0.0.1:3100/api/health | node scripts/assert-deploy-health.mjs; then
        HEALTH_READY=1
        break
      fi
      sleep 2
    done
    if [ "\$HEALTH_READY" != '1' ]; then
      echo '部署后 health/worker 未恢复，发布失败。'
      exit 2
    fi

    pm2 save
    rm -f "\$DRAIN_MARKER_FILE"
    trap - EXIT INT TERM
  "

echo "部署完成。"
echo "访问地址：http://${SERVER_HOST}"
echo "备用地址：http://${SERVER_HOST}:3100"
