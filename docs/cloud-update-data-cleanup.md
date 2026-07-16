# 云上更新数据清理记录

## 2026-05-16 账号隔离与垃圾卡记录

本地 3001 测试时发现两个容易误判为账号串号的问题：

1. `测试` 账号能看到一条出海翻译记录。核查后该记录的 `job.user_id`、素材 URL 路径都属于 `测试` 账号，不是 `将离` 账号外泄；只是源文件名与 `将离` 的测试素材同名。
2. 视频诊断默认空状态会被前端误渲染成“视频诊断结果”卡。该状态为 `probe.status=idle`、`report.status=idle`、`aiAnalysis.status=idle`，没有 URL、摘要、证据或 AI 分析内容，属于垃圾卡。

3001 前端壳已补两道保护：

- 切换登录账号时，按新的 `userId` 清空当前内存项目、任务、素材、输入框草稿和视频状态，再重新读取该账号自己的状态。
- 视频诊断只有真实内容、错误信息或正在运行状态时才生成项目卡；默认 `idle` 空对象不生成卡。

## 云上更新前清理要求

每次把 3001 壳前端能力同步到云上前，先做一次数据巡检：

1. 备份云上 MySQL 数据库，至少覆盖 `users`、`app_states`、`internal_jobs`。
2. 抽查 `app_states.state_json` 中是否存在历史垃圾卡：
   - `shellProjects` 中 `module=video` 且 `subFeature=diagnosis`，但结果 prompt 为空或仅为“暂无诊断结果”。
   - `videoMemory.diagnosis` 是默认 `idle` 状态但前端仍展示项目卡。
   - 测试账号残留的历史项目、历史素材、旧 runtime 快照。
3. 抽查 `internal_jobs` 是否仍按 `user_id` 隔离查询。员工账号只应看到自己 `user_id` 的任务。
4. 部署后用两个不同账号交叉验证：
   - 出海翻译、视频诊断、分镜生成各切一次。
   - 退出/登录另一个账号后，项目卡、输入框草稿、素材条都必须切到新账号自己的状态。
   - 默认空视频诊断状态必须显示空态，不允许显示“视频诊断结果”卡。

## 2026-05-17 日志与统计保留规则

本次更新确认并固化以下数据规则：

- `internal_logs` 只按 7 天保留策略自动清理，禁止在前端或 API 里手动清空日志。
- `usage_daily` 是永久统计表，不允许因为日志只保留 7 天而被整表重算或整表删除。
- `/api/stats/backfill` 只能重算当前日志覆盖到的日期，并保留更早日期的永久统计。
- 管理员删除账号时应硬删除该账号、会话、工作台状态、任务、运行日志、上传资产、智能体/知识库/聊天等账号业务数据，但必须保留 `usage_daily` 永久统计。
- 账号列表必须支持搜索和分页，避免账号数量增加后无限下拉。

云上发布前后的安全核对口径：

```sql
SELECT 'users' AS metric, COUNT(*) AS value FROM users
UNION ALL SELECT 'active_users', COUNT(*) FROM users WHERE status='active'
UNION ALL SELECT 'disabled_users', COUNT(*) FROM users WHERE status='disabled'
UNION ALL SELECT 'app_states', COUNT(*) FROM app_states
UNION ALL SELECT 'internal_logs', COUNT(*) FROM internal_logs
UNION ALL SELECT 'usage_daily', COUNT(*) FROM usage_daily
UNION ALL SELECT 'logs_7d', COUNT(*) FROM internal_logs
  WHERE created_at >= (UNIX_TIMESTAMP() * 1000 - 7*24*60*60*1000)
UNION ALL SELECT 'logs_old', COUNT(*) FROM internal_logs
  WHERE created_at < (UNIX_TIMESTAMP() * 1000 - 7*24*60*60*1000);
```

如果发布后 `users`、`app_states`、`usage_daily` 或 7 天内日志数量出现异常下降，先停止继续清理，立即回看发布前备份与 PM2 日志。

## 建议巡检 SQL

```sql
SELECT
  u.username,
  a.user_id,
  JSON_UNQUOTE(JSON_EXTRACT(a.state_json, '$.videoMemory.diagnosis.url')) AS diagnosis_url,
  JSON_UNQUOTE(JSON_EXTRACT(a.state_json, '$.videoMemory.diagnosis.probe.status')) AS probe_status,
  JSON_UNQUOTE(JSON_EXTRACT(a.state_json, '$.videoMemory.diagnosis.report.status')) AS report_status,
  JSON_UNQUOTE(JSON_EXTRACT(a.state_json, '$.videoMemory.diagnosis.aiAnalysis.status')) AS ai_status
FROM app_states a
JOIN users u ON u.id = a.user_id
ORDER BY u.created_at ASC;
```

看到 `idle / idle / idle` 且 URL 为空是正常默认状态，但前端不允许为它生成项目卡。若看到历史 `shellProjects` 中已有空诊断卡，先备份，再做定向清理。

## 发布后验收口径

- 后端隔离口径：`/api/state`、`/api/jobs`、素材路径、任务记录均以当前登录用户 `user.id` 为边界。
- 前端隔离口径：同一浏览器切换账号后，不能复用上一账号的内存项目、任务、素材和草稿。
- 垃圾数据口径：没有真实内容的默认状态不展示为项目卡；旧垃圾卡如果已经落库，云上更新时要纳入清理。

## 2026-07-15 状态写入停滞与首图结果断链排查口径

当出现“上游 job 已成功并有图片，前端仍不显示 / 刷新后项目丢失 / 新卡排在最后”时，先做下面的时间线对照，不要直接删 job 或重启服务：

1. 对照 `internal_jobs.created_at/finished_at` 与同账号 `app_states.updated_at`。如果 job 持续产生而 state 长时间不前进，优先查 `/api/state` 写入边界，而不是先判定 provider 没出图。
2. 搜索 PM2 错误日志的 `managed_asset_forbidden` 和 `providerStage=asset_reference`。发现后对真实 `state_json` 做只读素材身份审计，区分：
   - 浏览器本地草稿身份：`localAssetId=draft-*`，不是 `stored_assets.id`。
   - 真实托管素材身份：`assetId`、`imageUrlAssetId`、`sourceAssetId` 等，必须属于当前账号且为 active。
3. 状态检查点丢失时，只能用结构化绑定恢复：成功策划 job 必须同时带 `shellPlanningPurpose=one_click_planning` 和 `shellProjectId`，图片 job 必须带同一 `shellProjectId`。无绑定旧 job、已删除墓碑 job 和普通对话不得变成项目卡。
4. 排序验收同时覆盖两种对象：已水合项目的 `createdAtPrecise=true`，以及刚创建、尚未水合但已有真实毫秒 `createdAt` 的项目。显式 `createdAtPrecise=false` 的年缺失历史数据仍应下沉。
5. 发布后不仅看 health；至少确认目标账号 `app_states.updated_at` 继续前进、成功图片落入 `shellProjects.results`、真实失败保持 error，并用同一排序边界重放最新项目。

如果 state 与 job 都已是最新、把同一份数据交给 `buildShellDataSnapshot` 也能恢复完成卡，但用户当前页面仍停在生成中，故障已经越过 provider、job、adapter 和持久层，进入浏览器同步触发层。此时检查 `src/utils/shellJobSync.ts` 与 `ShellMigratedApp` 的统一生命周期同步：模块页应不依赖本地“活跃任务”判定而持续同步，`focus/pageshow/online/visibilitychange` 应立即触发，并发请求必须由 coalesced runner 串行。账号 scope 必须贯穿延迟 UI 与持久化写，终态历史 identity 不得因超出最近 jobs 窗口而周期单条补查。不要用手动刷新作为恢复方案。

状态检查点/排序修复见 `CLAUDE.md` 根因 #67 和看板指纹 `oneclick-state-local-asset-id-checkpoint-sort`；“刷新才显示”的统一同步修复见根因 #68 与 `docs/agents/repeated-issues.md`，当前仍是 `not_deployed`。
