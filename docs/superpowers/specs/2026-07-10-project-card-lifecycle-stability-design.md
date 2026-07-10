# Project Card Lifecycle Stability Design

## Goal

修复洛克买家秀链路里的“直接失败 / 三张只出一张 / 任务永久生成中”的程序性部分，并把项目卡恢复、排序、删除收敛为可验证的成熟生命周期。本设计不重复修改已于 2026-07-10 16:16 发布的 KIE 直连、全局上传限流和重试治理。

## Evidence

- 洛克 2026-07-10 10:39 的买家秀任务确实是 1 个成功结果 + 2 个 `provider_network_error/asset_upload` 终态失败，不是前端漏展示。
- 同账号 14:10 的 3 张全部成功；上述故障发生在 16:16 新 KIE 治理版本发布前。
- 洛克 `app_state` 仍有 `job-e94b4337f3f741e58de58273`：后端策划 job 已成功，但项目卡永久是 `generating` 且 0 结果。
- 该 job 的 payload 有 `shellPlanningPurpose=buyer_show_planning`，但缺 `shellProjectId/shellProjectName`，恢复器无法把它绑回提交时已创建的真实买家秀卡。
- 前一版“缺卡回写”把所有带 backend job 身份的活跃卡都落库，使这类孤立策划控制 job 也被持久化。
- 将离分镜删除的墓碑调用已在云端源码中，但通用项目删除只删项目顶层的一个 backend job，未清理所有结果和任务引用的 job。

## Design

### 1. Planning job correlation is explicit

`runShellBuyerShowWorkflow` 必须把提交时已创建的 `shellProjectId` 、`shellProjectName` 和 `subFeature` 传入每个买家秀策划 job。恢复时策划 job 只能绑定这张真实卡，不能以 `job-<id>` 新建第二张卡。

### 2. Orphan control jobs are not user projects

对历史上没有 `shellProjectId` 的 `buyer_show_planning` job，适配器不生成项目、结果或可被 fallback 再造卡的 task。已持久的同类 `job-<id>` 幽灵卡在读边界过滤，但不自动删除用户云数据。

### 3. Project deletion removes every internal job identity

项目删除收集：

- 项目的 `backendJobId`；
- 项目所有 result 的 `backendJobId`；
- 当前 projectId 下 task 的 `backendJobId`；
- `job-<id>` 形式的真实 job id。

删除顺序为：尝试删除全部 internal jobs → 立即移除内存卡和 task → 写入 `deletedProjectIds/deletedJobIds` 墓碑 并持久化。即使某个历史 job 已不存在，墓碑仍必须成功，不能因远端 404 把卡复活。

### 4. Sorting keeps one source of truth

不新增“活跃卡置顶”或另一套排序。继续使用 `sortProjectsNewestFirst`的数字毫秒时间戳规则，增加洛克真实时间数据回归。孤立策划卡不再参与排序后，最新真实项目应稳定位于第一位。

### 5. Storyboard deletion remains tombstone based

保留现有 `VideoModule -> onDeleteProject -> prunePersistedAppStateForDeletion -> server applyDeletionTombstones` 链路，补充真实行为测试，确保分镜项目在本地剪枝后不会被服务端并集合并复活。

## Error Handling

- KIE 生图提交不新增重复重试，避免重复扣费。
- 项目删除中，单个 internal job 删除失败只影响“远端 job 是否已物理删除”的提示，不阻断 app_state 墓碑持久化。
- 历史幽灵卡只根据结构化 `shellPlanningPurpose/taskType/project binding` 判断，不用卡名或报错文字正则猜状态。

## Verification

- TDD 红绿灯：孤立策划 job、已持久幽灵卡、项目多 job 删除、分镜墓碑、真实时间排序。
- 相关前端测试、Hermes Harness、TypeScript/lint/build。
- 当前 provider 稳定性回归：`providerGateway/providerKieImage/jobRuntime` 相关测试。

## Scope Boundary

- 本次修改本地当前版本，不自动发布。
- 不删除将离云上现有三张分镜卡；哪两张应删属于不可恢复数据选择，需要另行明确。
