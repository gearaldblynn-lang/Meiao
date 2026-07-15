#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

SERVER_HOST="${MEIAO_SERVER_HOST:-111.229.66.247}"
SERVER_USER="${MEIAO_SERVER_USER:-root}"
SERVER_PORT="${MEIAO_SERVER_PORT:-22}"
SSH_KEY_PATH="${MEIAO_SSH_KEY:-$HOME/.ssh/MEIAO.pem}"
REMOTE_APP_DIR="${MEIAO_REMOTE_APP_DIR:-/www/wwwroot/meiao-internal}"
REMOTE_FFMPEG_BIN="${MEIAO_REMOTE_FFMPEG_BIN:-/opt/meiao/bin/ffmpeg}"
REMOTE_TMP_DIR="/tmp/meiao-deploy-$$"
REMOTE_DEPLOY_MUTEX_DIR="/tmp/meiao-deploy-mutex"
DEPLOY_OWNER_TOKEN="meiao-deploy-$(date +%s)-$$-${RANDOM}"
REMOTE_DEPLOY_MUTEX_HELD=0
REMOTE_MUTATION_STARTED=0
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

acquire_remote_deploy_mutex() {
  echo "获取远端部署互斥锁..."
  ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" \
    "${SERVER_USER}@${SERVER_HOST}" \
    "MEIAO_DEPLOY_OWNERSHIP_RUN=1 node --input-type=module - acquire-mutex --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN'" \
    < "$ROOT_DIR/scripts/deploy-ownership.mjs"
  REMOTE_DEPLOY_MUTEX_HELD=1
  ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" "
    set -e
    HELPER_TEMP='$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs.tmp'
    trap 'rm -f "\$HELPER_TEMP"' EXIT
    umask 077
    cat > "\$HELPER_TEMP"
    mv "\$HELPER_TEMP" '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs'
  " < "$ROOT_DIR/scripts/deploy-ownership.mjs"
}

verify_remote_deploy_mutex() {
  ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" "
    set -e
    node '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs' verify-mutex \
      --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN'
  "
}

release_remote_deploy_mutex() {
  if [[ "$REMOTE_DEPLOY_MUTEX_HELD" != "1" ]]; then return 0; fi
  if ! ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" \
    "${SERVER_USER}@${SERVER_HOST}" \
    "MEIAO_DEPLOY_OWNERSHIP_RUN=1 node --input-type=module - release-mutex --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN' --mutation-started '$REMOTE_MUTATION_STARTED'" \
    < "$ROOT_DIR/scripts/deploy-ownership.mjs"; then
    echo "远端部署互斥锁未自动释放：$REMOTE_DEPLOY_MUTEX_DIR。请人工核验 owner 后处理。" >&2
    return 1
  fi
  REMOTE_DEPLOY_MUTEX_HELD=0
}

cleanup_remote_deploy_mutex() {
  local exit_status=$?
  trap - EXIT
  if ! release_remote_deploy_mutex && [[ "$exit_status" == "0" ]]; then
    exit_status=2
  fi
  exit "$exit_status"
}

run_remote_deploy_readiness() {
  echo "检查云上是否有运行中任务..."
  ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" "
    set -e
    node '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs' verify-mutex \
      --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN'
    cd '$REMOTE_APP_DIR'
    if [ ! -f '.env.server' ]; then
      echo '服务器缺少 .env.server，无法执行部署就绪检查。'
      exit 2
    fi
    set -a
    source .env.server
    set +a
    DRAIN_MARKER_FILE="\${MEIAO_DEPLOY_DRAIN_FILE:-/tmp/meiao-deploy-drain}"
    if [ -e \"\$DRAIN_MARKER_FILE\" ]; then
      echo '检测到残留部署 marker（包括空文件），必须人工核验后处理。'
      exit 2
    fi
    MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' MEIAO_DEPLOY_READINESS_RUN=1 node --input-type=module
  " < "$ROOT_DIR/scripts/check-deploy-readiness.mjs"
}

trap cleanup_remote_deploy_mutex EXIT
acquire_remote_deploy_mutex
run_remote_deploy_readiness
verify_remote_deploy_mutex

echo "开始部署到 ${SERVER_USER}@${SERVER_HOST}:${REMOTE_APP_DIR}"

export COPYFILE_DISABLE=1

REMOTE_MUTATION_STARTED=1
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
    DRAIN_PID=''
    DRAIN_CHILD_PID=''
    DRAIN_CLEANUP_ARMED=0
    finish_remote_mutation() {
      REMOTE_EXIT_STATUS=\$?
      REMOTE_CLEANUP_FAILED=0
      trap - EXIT INT TERM
      set +e
      if [ \"\$DRAIN_CLEANUP_ARMED\" = '1' ] && type cleanup_deploy_drain >/dev/null 2>&1; then
        if ! cleanup_deploy_drain; then
          REMOTE_CLEANUP_FAILED=1
          REMOTE_EXIT_STATUS=2
        fi
      fi
      if [ -n \"\$DRAIN_CHILD_PID\" ] && kill -0 \"\$DRAIN_CHILD_PID\" >/dev/null 2>&1; then
        echo '部署 drain 子进程仍在运行，拒绝写入远端完成证明。' >&2
        REMOTE_EXIT_STATUS=2
      elif [ \"\$REMOTE_CLEANUP_FAILED\" = '1' ]; then
        echo '部署 drain 清理失败，拒绝写入远端完成证明。' >&2
      else
        node '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs' complete-mutation \
          --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN'
        if [ \$? -ne 0 ]; then REMOTE_EXIT_STATUS=2; fi
      fi
      exit \"\$REMOTE_EXIT_STATUS\"
    }
    trap finish_remote_mutation EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM

    assert_remote_deploy_mutex_owner() {
      node '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs' verify-mutex \
        --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN'
    }

    assert_remote_deploy_mutex_owner
    mkdir -p '$REMOTE_TMP_DIR'
    tar -xzf - -C '$REMOTE_TMP_DIR'
    assert_remote_deploy_mutex_owner
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
    if [ -x '$REMOTE_FFMPEG_BIN' ]; then
      '$REMOTE_FFMPEG_BIN' -version >/dev/null
      FFMPEG_BIN='$REMOTE_FFMPEG_BIN' npm install
    else
      npm install
    fi
    run_security_audit_with_retry() {
      if npm run security:audit; then
        return 0
      fi
      echo '依赖安全审计未通过，验证安装树后复验一次...'
      npm ls --omit=dev --depth=0 >/dev/null
      npm run security:audit
    }
    run_security_audit_with_retry
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
    # 图片上传是所有业务入口的基础能力。真探针在停旧服务前完成；失败时 set -e
    # 直接终止发布，旧进程和旧 dist 继续服务，不再留下 disabled 半发布状态。
    npm run probe:managed-image-cos
    MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' node scripts/check-deploy-readiness.mjs

    # 首发时旧进程不认识 marker。先用 iptables 拒绝新的 Nginx/直连 3100 连接，
    # 等已有连接连续为零，再由 MySQL 持锁助手复查 running=0 并停止旧 PM2。
    # 新进程启动后才开放网络做 health，此时 marker 仍会拒绝所有写请求并暂停 worker。
    DRAIN_MARKER_FILE=\"\${MEIAO_DEPLOY_DRAIN_FILE:-/tmp/meiao-deploy-drain}\"
    DRAIN_READY_FILE=\"/tmp/meiao-deploy-drain-ready-\$\$\"
    DRAIN_STOP_ATTEMPTED_FILE=\"/tmp/meiao-deploy-drain-stop-attempted-\$\$\"
    DRAIN_STOPPED_FILE=\"/tmp/meiao-deploy-drain-stopped-\$\$\"
    DRAIN_RELEASE_FILE=\"/tmp/meiao-deploy-drain-release-\$\$\"
    DRAIN_NETWORK_STATE_FILE=\"/tmp/meiao-deploy-network-drain-\$\$.json\"
    DRAIN_NETWORK_COMMENT=\"meiao-deploy-\$\$\"
    DRAIN_PID=''
    NETWORK_DRAIN_ACTIVE=0
    OLD_PROCESS_STOP_ATTEMPTED=0
    OLD_PROCESS_STOPPED=0
    NEW_PROCESS_STARTED=0
    NEW_PROCESS_STOPPED=0
    HEALTH_READY=0
    CLEANUP_RUNNING=0

    enable_network_drain() {
      if [ \"\$NETWORK_DRAIN_ACTIVE\" = '1' ]; then return 0; fi
      node scripts/backend-network-drain.mjs enter \
        --state-file \"\$DRAIN_NETWORK_STATE_FILE\" \
        --comment \"\$DRAIN_NETWORK_COMMENT\"
      NETWORK_DRAIN_ACTIVE=1
    }

    disable_network_drain() {
      if [ ! -f \"\$DRAIN_NETWORK_STATE_FILE\" ]; then
        NETWORK_DRAIN_ACTIVE=0
        return 0
      fi
      node scripts/backend-network-drain.mjs exit --state-file \"\$DRAIN_NETWORK_STATE_FILE\"
      NETWORK_DRAIN_ACTIVE=0
    }

    write_owned_deploy_marker() {
      node '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs' create-marker \
        --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN' \
        --marker-file \"\$DRAIN_MARKER_FILE\"
    }

    remove_owned_deploy_marker() {
      node '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs' remove-marker \
        --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN' \
        --marker-file \"\$DRAIN_MARKER_FILE\"
    }

    retain_deploy_drain() {
      node '$REMOTE_DEPLOY_MUTEX_DIR/ownership-helper.mjs' retain-manual \
        --mutex-dir '$REMOTE_DEPLOY_MUTEX_DIR' --owner '$DEPLOY_OWNER_TOKEN' \
        --marker-file \"\$DRAIN_MARKER_FILE\" || return 1
      echo '部署门禁已进入 manual 状态；不得直接删除 marker。'
      echo \"网络规则状态：\$DRAIN_NETWORK_STATE_FILE\"
      echo '安全恢复：先确认/启动 PM2，保留 marker 时精确清理网络规则，通过 health+worker 检查后才删除 marker。'
    }

    cleanup_deploy_drain() {
      if [ \"\$CLEANUP_RUNNING\" = '1' ]; then return; fi
      CLEANUP_RUNNING=1
      set +e
      if [ -n \"\$DRAIN_CHILD_PID\" ]; then
        if kill -0 \"\$DRAIN_CHILD_PID\" >/dev/null 2>&1; then
          touch \"\$DRAIN_RELEASE_FILE\" || true
        fi
        wait \"\$DRAIN_CHILD_PID\" || true
        if kill -0 \"\$DRAIN_CHILD_PID\" >/dev/null 2>&1; then
          echo '部署 drain 子进程未退出，保留所有门禁和 mutex。' >&2
          return 2
        fi
      fi
      DRAIN_PID=''
      DRAIN_CHILD_PID=''
      if [ -f \"\$DRAIN_STOP_ATTEMPTED_FILE\" ]; then OLD_PROCESS_STOP_ATTEMPTED=1; fi
      if [ -f \"\$DRAIN_STOPPED_FILE\" ]; then OLD_PROCESS_STOPPED=1; fi

      if [ \"\$NEW_PROCESS_STARTED\" = '1' ] && [ \"\$HEALTH_READY\" != '1' ]; then
        enable_network_drain || true
        pm2 stop meiao-internal || true
        if PM2_PID_OUTPUT=\$(pm2 pid meiao-internal 2>/dev/null); then
          if node scripts/deploy-lifecycle.mjs pm2-stopped \"\$PM2_PID_OUTPUT\"; then
            NEW_PROCESS_STOPPED=1
          fi
        else
          echo '无法读取 PM2 停机状态，不释放部署门禁。'
        fi
      fi

      RELEASE_DRAIN=0
      CLEANUP_DECISION=\$(node scripts/deploy-lifecycle.mjs cleanup \
        \"\$OLD_PROCESS_STOPPED\" \"\$OLD_PROCESS_STOP_ATTEMPTED\" \
        \"\$NEW_PROCESS_STARTED\" \"\$HEALTH_READY\" \"\$NEW_PROCESS_STOPPED\" \
        2>/dev/null || echo retain)
      if [ \"\$CLEANUP_DECISION\" = 'release' ]; then RELEASE_DRAIN=1; fi
      if [ \"\$RELEASE_DRAIN\" = '1' ]; then
        if disable_network_drain && remove_owned_deploy_marker; then
          rm -f \"\$DRAIN_READY_FILE\" \"\$DRAIN_STOP_ATTEMPTED_FILE\" \"\$DRAIN_STOPPED_FILE\" \
            \"\$DRAIN_RELEASE_FILE\" \
            \"\$DRAIN_NETWORK_STATE_FILE\"
        else
          if ! retain_deploy_drain; then
            echo '维护门禁持久化失败，拒绝确认远端清理完成。' >&2
            return 2
          fi
          echo '网络门禁清理失败，保留维护门禁等待人工处理。'
        fi
      else
        if ! retain_deploy_drain; then
          echo '维护门禁持久化失败，拒绝确认远端清理完成。' >&2
          return 2
        fi
        if [ \"\$OLD_PROCESS_STOPPED\" = '1' ] && [ \"\$NEW_PROCESS_STARTED\" != '1' ]; then
          echo '严重：旧服务已停止且新服务未启动，当前服务已停止；必须按恢复流程人工处理。'
        elif [ \"\$OLD_PROCESS_STOP_ATTEMPTED\" = '1' ] && [ \"\$NEW_PROCESS_STARTED\" != '1' ]; then
          echo '严重：旧服务停机尝试已登记但状态未核实，且新服务未启动；服务可能已停止，必须人工恢复。'
        else
          echo '新进程未确认停止，保留维护门禁和 marker 等待人工处理。'
        fi
      fi
    }
    if [ -e \"\$DRAIN_MARKER_FILE\" ]; then
      echo '检测到残留部署 marker（包括空文件），禁止开始新发布。'
      exit 2
    fi
    DRAIN_CLEANUP_ARMED=1

    enable_network_drain
    write_owned_deploy_marker
    MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' \
      node scripts/hold-deploy-drain.mjs \
        --ready-file \"\$DRAIN_READY_FILE\" \
        --stop-attempted-file \"\$DRAIN_STOP_ATTEMPTED_FILE\" \
        --stopped-file \"\$DRAIN_STOPPED_FILE\" \
        --release-file \"\$DRAIN_RELEASE_FILE\" &
    DRAIN_PID=\$!
    DRAIN_CHILD_PID=\$DRAIN_PID
    for attempt in \$(seq 1 300); do
      if [ -f \"\$DRAIN_STOPPED_FILE\" ]; then break; fi
      if ! kill -0 \"\$DRAIN_PID\" >/dev/null 2>&1; then
        wait \"\$DRAIN_PID\"
        exit 2
      fi
      sleep 0.2
    done
    if [ ! -f \"\$DRAIN_READY_FILE\" ] || [ ! -f \"\$DRAIN_STOPPED_FILE\" ]; then
      echo '部署 drain 停机握手超时，已停止发布。'
      exit 2
    fi
    cat \"\$DRAIN_READY_FILE\"
    PM2_APP_EXISTS=\$(cat \"\$DRAIN_STOPPED_FILE\")
    OLD_PROCESS_STOP_ATTEMPTED=1
    OLD_PROCESS_STOPPED=1

    assert_remote_deploy_mutex_owner
    # 原子切换:两次 rename,静态服务零断档
    rm -rf dist-prev
    if [ -d dist ]; then mv dist dist-prev; fi
    mv dist-next dist
    rm -rf dist-prev '$REMOTE_TMP_DIR'

    # stopped ack 只会在同一 MySQL 持锁会话验证 PM2 已停后产生。
    touch \"\$DRAIN_RELEASE_FILE\"
    wait \"\$DRAIN_PID\"
    DRAIN_PID=''
    DRAIN_CHILD_PID=''
    rm -f \"\$DRAIN_READY_FILE\" \"\$DRAIN_STOP_ATTEMPTED_FILE\" \
      \"\$DRAIN_STOPPED_FILE\" \"\$DRAIN_RELEASE_FILE\"

    # start/restart 即使返回失败也可能已经拉起子进程，先进入必须验证停机的清理状态。
    NEW_PROCESS_STARTED=1
    if [ \"\$PM2_APP_EXISTS\" = '1' ]; then
      pm2 restart meiao-internal --update-env
    else
      pm2 start ecosystem.config.cjs
    fi

    # 新代码已识别 marker，可恢复 GET/health 流量；写请求与 worker 仍保持 drain。
    disable_network_drain

    for attempt in \$(seq 1 30); do
      if curl -fsS http://127.0.0.1:3100/api/health | node scripts/assert-deploy-health.mjs; then
        HEALTH_READY=1
        break
      fi
      sleep 2
    done
    if [ \"\$HEALTH_READY\" != '1' ]; then
      echo '部署后 health/worker 未恢复，发布失败。'
      exit 2
    fi

    pm2 save
    rm -f \"\$DRAIN_NETWORK_STATE_FILE\"
    remove_owned_deploy_marker
    DRAIN_CLEANUP_ARMED=0
  "

echo "部署完成。"
echo "访问地址：http://${SERVER_HOST}"
echo "备用地址：http://${SERVER_HOST}:3100"
