# MEIAO 零 502 平滑发布设计

## 目标

消除腾讯云发布期间因唯一 PM2 进程先停后启而产生的 Nginx 502。发布期间页面、GET/HEAD/OPTIONS 和健康接口必须持续可用；写请求允许在任务安全门禁开启时返回明确、可重试的 503。

## 已确认根因

当前 `scripts/deploy_tencent.sh` 在切换时先用 iptables 阻断 3100 的新连接，再由 `scripts/hold-deploy-drain.mjs` 停止唯一 `meiao-internal` PM2 fork 进程，然后才启动新进程。Nginx 在这个 STOPPED 到 RUNNING 窗口没有可连接的上游，因此 502 是发布算法的必然结果，与 provider、磁盘、OOM 或业务请求无关。

## 方案选择

采用单实例 PM2 cluster 平滑 reload，不本次拆分 API 与 Temporal worker，也不把 3100/3101 双端口作为日常发布状态。这是能保留现有部署锁、任务门禁和单端口运维合同的最小完整修复。

## 进程生命周期

`ecosystem.config.cjs` 将 `meiao-internal` 改为单实例 `cluster` 模式，开启 `wait_ready`，并用可配置且保守的启动/退出超时。超时参数由环境变量读取，默认启动 120 秒、退出 30 秒。

新进程完成现有 bootstrap、HTTP 端口真正进入 listening 状态后，才通过 `process.send('ready')` 通知 PM2。不能在 `server.listen()` 回调前报 ready。

旧进程收到 `SIGINT`/`SIGTERM` 后只执行一次优雅退出：停止定时器与 job worker，停止 Temporal worker，调用 `server.close()` 等待已接收 HTTP 请求结束，关闭数据库连接池，然后退出。超出退出时限由 PM2 强制收敛，不得无限等待。

## 发布数据流

1. 保留现有远端 owner mutex、发布前后 readiness、COS 真探针和静态 `dist-next` 原子切换。
2. 创建带 owner 的 deploy marker。已在运行的旧进程会对新的写请求返回 `job_submissions_paused` 503，worker 不再 claim 新任务，GET 继续服务。
3. 每个进程跟踪已通过入口检查的在途写请求，并在 health 暴露 `deployment.activeWriteRequests`。发布脚本必须等它连续为 0，确认 marker 前进入的请求已经收敛。
4. 短暂锁定 `internal_jobs` 表并再次确认 `runningCount=0`，随后在 reload 之前释放表锁。marker 已禁止新写请求和 worker claim，所以释锁后不会出现新任务。不能把表锁持有到新进程 ready，否则新进程 bootstrap 访问 `internal_jobs` 时会死锁。
5. 执行 `pm2 startOrReload ecosystem.config.cjs --update-env`。PM2 在新进程报 ready 前保留旧进程承载读流量。
6. reload 成功后用 `127.0.0.1:3100/api/health` 检查指定 release ID 的 app、worker、COS 和 tombstone 当前周期错误。
7. 仅由 owner 移除 marker，恢复写请求和 worker claim。

当前的 network drain 不再参与正常切换，因为它会在 Nginx 到上游之间制造不可用窗口。相关工具可保留作为显式人工故障隔离工具，但发布主路径不得调用。

## 失败与回滚

- 发布前检查失败：不写 marker、不 reload，旧服务不变。
- 在途写请求不能收敛，或表锁内发现运行任务：释放锁并按 owner 移除 marker，不 reload，不允许 override 作为默认路径。
- 新进程未在超时内 ready：依赖 PM2 reload 保留/恢复旧实例；发布脚本必须确认至少一个 online 且健康实例，不得再执行 `pm2 stop meiao-internal`。
- reload 命令返回不确定结果：保留 marker，先核对 PM2 PID、online 状态与 health；只有已确认健康时才释放 marker。
- 发布结果必须写明是新代码健康、旧代码仍在服务，还是无法确定；不能仅以 PM2 命令退出码下结论。

## 兼容性与首次迁移

首次上线前的旧进程具备 marker 门禁，但尚未暴露在途写请求数，不得假装它已具备日常平滑 reload 合同。首次迁移使用一次性本机候选端口：新代码在 3101 完成 bootstrap/health，Nginx 原子切到候选进程保持 GET，再把正式 `meiao-internal` 迁移到 3100 cluster，健康后将 Nginx 切回 3100 并移除候选进程。全程 marker 保护写请求，每次 Nginx 切换前都必须真实 health 通过，且必须备份并可原子恢复原 Nginx 配置。若任何一步不满足，停止迁移，不退化回先停后启。

## 测试和验收

- 单元测试覆盖 ready 仅在 HTTP listening 后发送、优雅退出幂等、资源关闭顺序和错误收敛。
- 部署脚本回归测试必须证明正常路径不再执行 network drain、`pm2 stop` 或 `pm2 restart`，必须先等在途写请求清零、再用 startOrReload，并在指定 release 健康成功后才释放 marker。
- 本地端到端演练在持续 GET 探测下执行 PM2 reload，期望 0 次 502/连接失败；marker 存在时写请求期望为可重试 503。
- 云上发布前必须确认 active jobs 为 0。发布期间并行持续探测公网主页、`/api/health` 和服务器本机 health，验收标准是 GET 的 502 与连接失败均为 0。
- 发布后核对 PM2 模式/状态/启动时间、worker healthy、marker/mutex 清理、关键文件 SHA-256、本地 HEAD、云上运行文件、GitHub 发布分支与 `main` 四层事实。

## 非目标

本次不拆分 API/worker 进程，不更换 Temporal 队列，不修改任务幂等、积分结算或 provider 语义，不为了零 502 降低 active-job 发布门禁。
