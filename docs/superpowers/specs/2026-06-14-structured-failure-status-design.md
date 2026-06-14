# 设计:业务状态结构化判定(根因库 #2,三段一轮删正则)

> 日期:2026-06-14 · 分支 `fix/chunk-error-boundary` · 关联根因库 #2
> 状态:设计已与业主对齐,待写实现计划
> 同构参考:本轮复刻 2026-06-13 createdAt 那轮的"文本识别塌缩到单一读边界"模式(`coerceCreatedAtMs`)

## 1. 背景与根因

根因库 #2:业务状态(方案是否策划失败、错误是否可恢复)由**正则匹配报错文字**决定,而非读结构化字段。实测分布(已 grep 复核,非转述):

- **消费端(汇)**:`isInvalidOneClickPlanText` 的 13 条正则有 **2 份拷贝**——`src/utils/oneClickPlanValidation.ts` 与 `server/appStateMerge.mjs`,嗅探被烤进 plan 内容字段的错误文字反推"方案失败"。
- **重试分类(同族)**:`src/services/kieAiService.ts:44 KIE_RECOVERABLE_MESSAGE_PATTERN`、`src/adapters/shellDataAdapter.ts:1111/2271` 的可恢复/瞬时正则、`src/services/arkService.ts` 的 `isRecoverableAnalysisJobFailure/SyncError`。
- **生产端(源)**:`src/adapters/shellWorkflow.ts` 多处 `throw new Error('...策划失败')`;`arkService.ts` 大量 `策划失败`/`共N张其中M张策划失败` 文案;`kieAiService.ts:157` `throw Error('任务状态同步失败')`。这些文字就是后面正则要嗅的东西——典型"经文本有损往返"。

**关键事实(已存在的结构化基建)**:
- `plan.planningFailed: true` 结构化标志已在 7 处写;消费端已 `!plan?.planningFailed && isInvalidOneClickPlanLike(plan)` 并列检查——正则其实是"没设标志时的兜底"。
- `src/adapters/shellPlanningFailure.ts` 已有结构化失败构造器 `FailedOneClickPlanningPlan`(`planningFailed:true` + `status:'error'` + 读 `job.errorCode`)。
- `server/providerGateway.mjs` 已有完整错误码枚举(`provider_auth_invalid/rate_limited/credit_insufficient/internal_error/bad_request/timeout/network_error/request_cancelled`)+ `providerStatus: failed | recoverable_pending_result`。
- `kieAiService.isRecoverableKieTaskResult(taskId, msg, errorCode)` 已优先吃 `errorCode`,只在没码时退到 message 正则。
- `src/types.ts` 有 `retryable: boolean`;DB `taskPlatform` 有 `error_code`/`retryable`/`error_fingerprint` 列。
- `planningFailed` 由 commit `0484472 "preserve failed one-click planning cards"` 引入,是**有意 sentinel**(修"失败方案卡片丢失"真 bug 时加的),不可当脏代码清。

结论:#2 不是"从零建结构化错误系统",而是"让消费端优先读已有结构化字段,把文本识别塌缩到单一读边界,删掉热路径正则与重复拷贝"。

## 2. 目标(业主已定:全范围 + 彻底删正则 + 三段一轮)

- 成败/可恢复判定**只读结构化字段**(`planningFailed`/`status`/`errorCode`/`providerStatus`/`retryable`),热路径不嗅文本。
- 文本识别仅保留在**唯一一处读边界 normalizer**,用于迁移历史持久化数据。
- 2 份 plan 失败正则 + 散落重试分类正则**合并成共享单一判据**。
- 安全顺序:消费端收敛 → 生产端结构化 → 迁移旧库后删正则。

非目标:不改 providerGateway 已有的错误码枚举本身(直接复用);不动根因库 #4(数据模型)。

## 3. 架构:三段(按安全顺序,同一计划内分段验证)

### 3.1 单元 2a — 消费端收敛成共享单一判据

**新建 `src/utils/planFailure.mjs`**(前后端共享,`.mjs` 同 `taskResultReconcile.mjs`):
```
isPlanFailed(plan): boolean
  → 结构化优先:plan.planningFailed === true || plan.status === 'error' || Boolean(plan.errorCode)
  → 过渡期:|| LEGACY_FAILURE_TEXT_PATTERNS.some(p => p.test(getPlanContent(plan)))  // 2c 删除此行
getPlanContent(plan): string   // 搬来现有 getOneClickPlanContent 逻辑,前后端统一
LEGACY_FAILURE_TEXT_PATTERNS: RegExp[]   // 13 条,2c 后只被读边界 normalizer 引用
```
- `src/utils/oneClickPlanValidation.ts` 的 `isInvalidOneClickPlanText`/`isInvalidOneClickPlanLike`/`getOneClickPlanContent` 改为委托 `planFailure.mjs`(保留导出名,避免改 6 个前端调用点)。
- `server/appStateMerge.mjs` 的同名 3 函数改为 import 自 `planFailure.mjs`,删除本地 13 条正则拷贝。

**新建 `src/utils/errorClassification.mjs`**(前后端共享):
```
isRecoverableError({ errorCode, providerStatus, message }): boolean
  → 结构化优先:providerStatus === 'recoverable_pending_result' → true
              errorCode ∈ NON_RECOVERABLE_CODES → false
              errorCode ∈ RECOVERABLE_CODES(provider_timeout/network_error/internal_error/rate_limited) → true
  → 过渡期:|| RECOVERABLE_MESSAGE_PATTERN.test(message)  // 2c 删除此行
```
- `kieAiService.ts:isRecoverableKieTaskResult`、`arkService.ts:isRecoverableAnalysisJobFailure/SyncError`、`shellDataAdapter.ts:1111/2271` 改为委托 `errorClassification.mjs`(各自保留薄包装,签名不变)。

**2a 完成判据**:全部测试绿、tsc/eslint 0 error;正则只剩在两个共享判据的"过渡期兜底行"里;行为与现状逐位等价(用现有测试 + 新增等价性测试锁定)。

### 3.2 单元 2b — 生产端在源头结构化

- `src/adapters/shellWorkflow.ts` 所有 `throw new Error('...策划失败')`(L449/480/501/528/552/964/1664 等)改为 `throw Object.assign(new Error(msg), { code: '<结构化码>' })`(码取自上游 generation.errorCode,无则用语义码如 `planning_failed`)。
- 捕获这些 throw 构造失败 plan 的地方(`shellPlanningFailure.ts` 及 catch 块)把 `error.code` 落进 `errorCode`,并确保 `planningFailed:true`/`status:'error'` 一并设。
- `arkService.ts`/`kieAiService.ts` 失败产出路径在源头附 `errorCode`(复用 providerGateway 码或语义码)。
- **2b 完成判据**:新增测试断言"失败产出对象带结构化 `errorCode`+`planningFailed`/`status`",不依赖文本;此时热路径正则已无人触发(可加临时计数/日志确认,非必须)。

### 3.3 单元 2c — 迁移旧库 + 删正则

- **读边界 normalizer**:在 `shellDataAdapter.ts`/`shellPersistence.ts` 加载持久化 plan 处,新增 `migrateLegacyPlanFailure(plan)`——若 plan 无结构化失败标志但 `LEGACY_FAILURE_TEXT_PATTERNS` 命中其内容,则回填 `planningFailed:true`/`status:'error'`/`errorCode:'legacy_text'`。这是文本识别的**唯一**残留处。
- 删掉 `planFailure.mjs`/`errorClassification.mjs` 里的"过渡期兜底行",`LEGACY_FAILURE_TEXT_PATTERNS`/`RECOVERABLE_MESSAGE_PATTERN` 改为仅被读边界 normalizer 引用(import)。
- **2c 完成判据**:
  - 迁移单测:对每条 legacy pattern 各造一个"只有失败文字、无结构化标志"的历史 plan,断言经 normalizer 后变结构化失败。
  - grep 回归:热路径文件(planFailure 的 isPlanFailed、errorClassification 的 isRecoverableError、appStateMerge、shellDataAdapter 判定处)不再出现文本正则调用,只读结构化字段。

## 4. 数据流(目标态)

```
上游 providerGateway(结构化 errorCode/providerStatus)
  → 生产端 shellWorkflow/arkService/kieAi 在源头打 errorCode + planningFailed/status:'error'
  → 持久化(结构化字段随 plan 存)
  → 读边界 migrateLegacyPlanFailure(仅对历史纯文本数据回填,唯一文本识别处)
  → 消费端 isPlanFailed / isRecoverableError 只读结构化字段
  → UI 展示成败/可恢复
```

## 5. 测试策略

- **2a**:等价性——对一组代表性 plan(结构化失败 / 结构化成功 / 仅文本失败 / 干净成功),新共享判据与旧两份正则输出逐位一致;前端 + 后端现有测试全绿。
- **2b**:生产端失败路径产出对象带 `errorCode`+`planningFailed`/`status`(不含文本依赖)。
- **2c**:legacy 迁移单测(每条 pattern)+ 热路径无正则 grep 回归。
- 全量:`npm run lint`(tsc+eslint)exit 0、前后端 `--test` 全绿、`npm run build` 成功。

## 6. 风险与回滚

- 本地已提交基线(`3db968f`),分支 `fix/chunk-error-boundary`,逐段可回滚。
- **唯一不可逆风险点 = 2c**:若先删正则再迁移,历史"纯文本失败"plan 会静默翻成"成功"(商家看到错的成败)。**铁律:读边界迁移 normalizer 必须先落且测试覆盖每条 legacy pattern,删正则在其后。**
- 前后端共享判据用 `.mjs`(与现有 `taskResultReconcile.mjs` 同款),后端 `import` 自 `../src/utils/...`(沿用 appStateMerge 现有跨目录 import 方式)。
- 结构化码取值优先复用 providerGateway 既有枚举,避免新造平行枚举造成又一次漂移。
