# 梅奥生产稳定性修复与架构保护设计

日期：2026-07-13  
状态：方案 A 已获确认，规格待业主复核  
目标环境：本地当前版本完成合并、实现和验证，经代码审查后发布到腾讯云

## 1. 目标与证据

本次目标是修复 2026-07-13 云上日志暴露的真实任务处置缺口，并处理周度架构体检中最容易复发且能在本次安全收敛的风险，不进行无关重构。

生产证据如下：

- 任务 `32b3f0fe6f867a4cee5dddc7` 在 KIE `kie_chat` 提交阶段约 1 秒内以 `provider_submission_unknown` 失败，`providerTaskId` 为空，底层错误是 `fetch failed`。
- 同一任务被诊断看板按 provider、job 和内部失败日志计为三个 fingerprint；这是一个故障的三层观测，不是三次独立失败。
- 当前云上代码等同于本地 `fix/video-storyboard-stability` 分支的 `0794826`，而待发布分支 `feat/stability-phase2` 与其双向分叉。直接发布当前分支会覆盖云上已有的分镜稳定性和付费任务防重复保护。
- KIE 创建请求没有可依赖的幂等键；连接中断时无法证明上游没有接单。因此未知提交不能自动重试，也不能在未核对 KIE Logs 的情况下自动释放预留额度。

## 2. 已选择方案

采用“生产基线先对齐 + 管理员显式处置 + 契约和活跃链路回归保护”的最小完整方案。

未选择的方案：

- 全面拆分 `providerGateway.mjs`：长期有价值，但与当前事故根因无直接关系，合并分叉分支时扩大风险。
- 仅把云上稳定分支合回当前分支：可避免回退，却不能补上未知提交的管理员处置入口、运行时验形和回归错位。
- 自动重试或自动释放 `provider_submission_unknown`：可能重复扣费或错误返还额度，不符合付费任务安全边界。

## 3. 生产基线合并

实现前先把 `fix/video-storyboard-stability` 合入 `feat/stability-phase2`。九个预计冲突文件逐个按行为对账解决，不用任一分支整文件覆盖另一分支。

合并必须同时保留：

- 云上分支的分镜稳定性、KIE 提交不确定保护、任务恢复和项目卡生命周期修复；
- 当前分支的稳定性第二阶段、依赖安全升级、Agent Center 文档和其他后续提交；
- 当前真实入口 `src/main.tsx -> src/ShellMigratedApp.tsx -> src/adapters/shellWorkflow.ts`；
- 删除墓碑、任务身份和错误恢复相关测试的双边行为。

合并后以测试和关键源码 hash/行为断言证明云上保护未被回退，并更新 `docs/CURRENT.md` 到实际提交事实。合并本身不触发部署。

## 4. 未知提交管理员处置

### 4.1 服务端边界

合并后沿用服务端现有 `resolveSubmissionUnknownJob` 和管理员接口：

`POST /api/admin/task-platform/jobs/:id/submission-resolution`

只允许两种显式动作：

- `bind`：管理员已在上游找到任务，且任务类型支持按 provider task id 恢复时，绑定真实 `providerTaskId` 并恢复轮询。
- `release`：管理员已在 KIE Logs 确认上游没有任务和扣费后，释放本地预留额度并把任务转为可解释终态。

接口继续执行管理员鉴权、状态校验、动作适用性校验和审计日志。`kie_chat` 当前没有安全的 provider task id 查询能力，前端不得对它显示不可用的 `bind` 操作。

### 4.2 前端任务平台

在现有账号管理的任务平台中，仅对 `errorCode === 'provider_submission_unknown'` 的任务显示“核对并处置”入口。处置面板展示：任务 ID、用户、模块、任务类型、provider、创建时间、错误信息和预留额度状态，并明确提示先去 KIE Logs 核对。

交互规则：

- `release` 必须二次确认“已确认 KIE 无任务且未扣费”，确认前按钮不可提交；
- 只有服务端声明可恢复的任务才显示 `bind`，并要求非空 provider task id；
- 提交成功后刷新任务列表和时间线；失败保留面板输入并展示服务端返回的可读错误；
- 不提供自动重试按钮，不为当前真实故障自动执行任何处置。

### 4.3 API 运行时验形

`src/services/internalApi.ts` 为任务平台列表、时间线和 submission resolution 响应增加窄范围运行时验形。目标是阻止错误 JSON、缺失 `job` 或错误数组形状静默穿过 TypeScript 断言进入管理员界面，不在本次把全部约 132 个请求一次性迁移。

## 5. 类型化任务上下文

在 `src/types.ts` 定义共享 `JobContext`，包含本次诊断和项目卡恢复依赖的结构化字段：

- `taskPurpose`；
- `shellProjectId`、`shellProjectName`；
- `shellPlanId`；
- `shellBoardId`；
- `shellPurpose`；
- `subFeature`；
- `traceId`。

`createInternalJob` 的 payload 类型通过交叉类型接入 `JobContext`，现有额外 provider payload 字段继续允许，不做破坏性强制必填。活跃工作流的关键创建点使用 `satisfies JobContext` 或等价的类型检查，先覆盖一键策划/生成、买家秀策划和分镜策划/宫格图，防止新增调用再次漏传项目身份。

服务端仍以结构化 payload 字段为诊断来源，不新增按标题、错误文本或 prompt 正则猜测身份的逻辑。

## 6. 活跃 OneClick 与 Provider 回归保护

OneClick 测试以真实入口为准：新增或迁移行为测试，直接覆盖 `ShellMigratedApp` 调用的 `runShellOneClickPlanning`、`runShellImageGeneration` 及其任务 metadata。遗留 `src/modules/OneClick` 大组件的源码正则测试不作为本次删除目标，但不得再把它们当成活跃运行时的主要保护。

Provider 本次只补契约特征测试，锁定以下安全边界，不移动生产逻辑：

- 非幂等创建 POST 在响应不确定时不自动重试；
- 一旦拿到 `providerTaskId`，后续失败不得创建第二个任务；
- `provider_submission_unknown` 保留结构化 error code；
- KIE 媒体 direct-first/fallback 和素材上传重试边界不被分支合并破坏。

## 7. 并行实施边界

生产分支合并和冲突解决必须先串行完成。基线稳定后采用两波执行，避免多个 worker 同时修改 `src/types.ts` 和 `src/services/internalApi.ts`：

1. 第一波并行：`JobContext` 类型与活跃工作流 metadata 类型保护；活跃 OneClick 和 Provider 安全契约特征测试。
2. 第二波：在已稳定的共享类型上接入管理员处置 UI、`internalApi` 验形及对应测试。
3. 验证阶段并行运行互不共享进程状态的测试组和代码审查，最终由主代理串行整合结论。

每个行为修改任务遵循 TDD，并在合入前分别做规格符合性和代码质量评审。共享文件出现交叉时由主代理串行整合，不允许多个 worker 同时修改同一文件。

## 8. 验证、发布与回滚

本地验收至少包括：

- 合并冲突相关定向测试；
- `jobRuntime`、`jobManager`、`providerGateway`、任务平台和 submission resolution 测试；
- `internalApi`、账号管理、活跃 OneClick、项目卡生命周期测试；
- Hermes changed-file gate、lint、build、全量 `npm run verify`；
- 最终 diff 的权限、用户隔离、公网素材 URL、日志统计、付费任务防重复和核心任务链代码审查。

代码审查通过后才允许：

1. 记录本次真实 bug fix 到外部云上日志诊断看板；
2. 提交并推送当前分支；
3. 使用 `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh` 发布；
4. 检查两个备案域名的 `/api/health`、PM2 restart、Temporal workflow/activity poller；
5. 重新拉取当天云上日志并确认没有新增同类错误或异常重启。

不创建真实付费生成任务作为自动烟测。未得到人工 KIE Logs 证据前，不对任务 `32b3f0fe6f867a4cee5dddc7` 执行 `bind`、`release` 或重试。

回滚以部署前云上目录备份和上一可用构建为准。若 health、worker、静态资源或核心任务接口异常，立即恢复部署前版本；数据处置接口产生的审计事件不回滚、不删除。

## 9. 完成标准

- 当前分支包含云上 `0794826` 的关键稳定性行为且无回退；
- 管理员能在任务平台安全识别并人工处置 submission unknown，非法动作被前后端共同拒绝；
- 任务平台关键响应有运行时验形；
- 活跃 OneClick 主链和 JobContext metadata 有行为级回归保护；
- Provider 防重复扣费契约有测试锁定；
- 全量验证、代码审查、诊断看板记录、Git 推送、云上部署与部署后健康/日志复查均有可核对证据。
