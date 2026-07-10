# Project Card Lifecycle Stability Design

## Goal

修复洛克、林一买家秀链路里的“直接失败 / 三张只出一张 / 任务永久生成中 / 多套卡片出现慢”的程序性部分，并把全功能项目卡恢复、排序、删除收敛为可验证的成熟生命周期。本设计不重复修改已于 2026-07-10 16:16 发布的 KIE 直连、全局上传限流和重试治理。

## Evidence

- 洛克 2026-07-10 10:39 的买家秀任务确实是 1 个成功结果 + 2 个 `provider_network_error/asset_upload` 终态失败，不是前端漏展示。
- 同账号 14:10 的 3 张全部成功；上述故障发生在 16:16 新 KIE 治理版本发布前。
- 洛克 `app_state` 仍有 `job-e94b4337f3f741e58de58273`：后端策划 job 已成功，但项目卡永久是 `generating` 且 0 结果。
- 该 job 的 payload 有 `shellPlanningPurpose=buyer_show_planning`，但缺 `shellProjectId/shellProjectName`，恢复器无法把它绑回提交时已创建的真实买家秀卡。
- 前一版“缺卡回写”把所有带 backend job 身份的活跃卡都落库，使这类孤立策划控制 job 也被持久化。
- 将离分镜删除的墓碑调用已在云端源码中，但通用项目删除只删项目顶层的一个 backend job，未清理所有结果和任务引用的 job。
- 林一 18:05 的真实买家秀链路先经历两次策划（约 91 秒和 123 秒），再提交两张生图；第一张约 177 秒成功，第二张约 61 秒后因内容策略终态失败。截图中长期 `0/1 处理中` 的通用“买家秀”卡对应已终态、未绑定的策划 job，不是仍在运行的第三套生图。
- 全局审计发现同类未绑定控制 job 还存在于精修分析和分镜策划，精修/分镜的部分真实生成 job 也缺少项目、批次或宫格绑定。

## Design

### 1. Planning job correlation is explicit

`runShellBuyerShowWorkflow` 必须把提交时已创建的 `shellProjectId` 、`shellProjectName` 和 `subFeature` 传入每个买家秀策划 job；多套生成时，策划和生图都绑定同一个 `root-set-N` 项目。所有套级策划同时创建，由后端账户并发门控排队，避免客户端串行等待让第三套任务身份延迟数分钟。恢复时策划 job 只能绑定这张真实卡，不能以 `job-<id>` 新建第二张卡。

### 2. Orphan control jobs are not user projects

对历史上没有 `shellProjectId` 的买家秀策划、翻译分析、精修分析和分镜策划 job，适配器不生成项目、结果或可被 fallback 再造卡的 task。已持久的同类 `job-<id>` 幽灵卡在读边界过滤，但不自动删除用户云数据。精修和分镜的新控制/生图 job 必须携带项目、批次或宫格身份。

### 3. Project deletion removes every internal job identity

项目删除收集：

- 项目的 `backendJobId`；
- 项目所有 result 的 `backendJobId`；
- 当前 projectId 下 task 的 `backendJobId`；
- `job-<id>` 形式的真实 job id。

删除时立即移除内存卡和 task；全部 internal jobs 的物理删除与 `deletedProjectIds/deletedJobIds` 墓碑持久化并行且互不依赖。即使某个历史 job 已不存在，墓碑仍必须成功，不能因远端 404 把卡复活。

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
