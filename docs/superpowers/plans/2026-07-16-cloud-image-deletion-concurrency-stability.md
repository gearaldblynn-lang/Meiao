# 云上图片生成、删除与并发稳定性修复计划

## 目标

修复 2026-07-16 云上多账号出现的四个确定性故障：一键生成使用上传前素材、KIE 异步出图读取 COS 私有签名地址失败、删除墓碑与远端任务不收敛、历史失效素材 ID 阻断项目状态保存。保持积分结算、素材所有权和用户数据隔离不变。

## 根因与边界

1. `ShellMigratedApp` 已生成 `generationMaterials`，一键策划却仍传 `filteredMaterials`，导致 `blob:`/空地址在创建任务前被拒绝。
2. `providerAssetTransfer` 无条件返回 COS 临时签名 URL，绕过 `forceUpload`；KIE 可以受理任务，但异步执行时无法稳定拉取该私有地址。只对生成链路的 resolver-backed 托管素材先转存 KIE，历史公网 `/api/assets/file` 和聊天默认直读策略保持不变。
3. 删除操作先持久化 `deletedJobIds` 再调用 DELETE；404、运行中 409 被当成最终失败，服务端也没有按墓碑继续清理。DELETE 改为幂等，前端区分“已不存在/后台清理中”，MySQL 周期性按墓碑取消并删除可安全删除的任务。
4. 历史状态中的 `imageUrlAssetId` 等显式 ID 在对应素材已删除后仍被所有权校验拒绝。仅在 app state 保存/读取前清洗失效显式 ID；任务提交 payload 继续严格拒绝非法 ID。

## 实施任务

### 1. 先补失败回归测试

- 新增源码行为测试，断言一键策划接收 `generationMaterials`。
- 修改 `server/providerAssetTransfer.test.mjs`，断言生成链路会下载 COS 签名地址并上传 KIE，聊天默认仍可使用新鲜签名地址。
- 新增状态清洗单元测试，断言失效 `*AssetId` 被移除、有效 ID 与 `localAssetId` 保留。
- 扩展删除单元测试：404 视为幂等成功、运行中 409 显示后台清理中、墓碑只提取合法 24 位内部任务 ID。

### 2. 最小实现

- `src/ShellMigratedApp.tsx`：一键策划传准备完成的素材数组。
- `server/providerAssetTransfer.mjs`：让 `forceUpload` 生效，并给生成链路增加 `stageResolvedManagedAsset`。
- `server/managedAssetStateScrub.mjs` + `server/index.mjs`：只在状态边界清除失效显式素材 ID。
- `src/utils/deletionOperations.ts`、`src/services/internalApi.ts`：保留服务端错误码，规范化幂等/延迟删除结果。
- `server/tombstonedJobReconciler.mjs`、`server/jobManager.mjs`、`server/index.mjs`：提取墓碑任务、周期性取消/删除、暴露健康摘要；不越过积分预留和上游提交未知保护。

### 3. 本地验证

- 运行上述定向测试与相关 server/shell 测试。
- 运行 `npm run doctor`、`npm run build`、`git diff --check`。
- 检查本次补丁没有覆盖工作区中原有的字幕去除、COS 上传模式和智能体 owner-context 改动。

### 4. 发布与云上验收

- 先检查云上队列并等待运行任务排空，备份生产配置和发布文件，再执行标准发布脚本。
- 验收 `/api/health`、PM2、worker、受管图片 readiness。
- 用测试账号完成真实 COS 上传、一键策划、至少两个并发出图；确认 KIE 收到的是已转存地址，结果可读取。
- 对测试任务执行重复删除并确认幂等；观察墓碑清理摘要收敛且不影响积分保护任务。
- 对诊断看板运行 doctor/smoke，并按项目规则记录此次 bug fix。

## 回滚

若云上真实任务或健康检查失败，立即恢复发布前版本；COS 中的用户原图与数据库状态不做批量删除。墓碑协调器仅调用现有取消、积分保护和素材引用清理逻辑，可通过环境开关关闭。
