# 设计:#2 阶段 2c(收尾)— 迁移历史数据 + 删热路径正则

> ⛔ **决定不执行(2026-06-14,业主授权下由判断决定)**:#2 实际危害已被 2a 根除(两份漂移正则合并成单一结构化优先判据)。本 2c 方案的"删正则+迁移旧库"是整件事唯一**不可逆**操作(会静默把历史失败方案翻成成功),安全性依赖无法 100% 静态证明的前提。为线上数据正确性计,正则作单一处安全网长期保留,不执行本方案。详见根因库 #2 收敛说明。本文件留存为"考虑过但有意未做"的记录。

> 日期:2026-06-14 · 分支 `fix/chunk-error-boundary` · 关联根因库 #2 / spec `2026-06-14-structured-failure-status-design.md`
> 状态:~~设计已与业主对齐,待写实现计划~~ → **决定不执行(见上)**
> 前序:2a(消费端收敛,提交 `7b65061`)已完成;2b(生产端结构化)经探针确认已基本就位。

## 1. 背景(2a/2b 之后的现状)

- 消费端成败/可恢复判定已收敛到共享 `src/utils/planFailure.mjs`(`isPlanFailed`)、`src/utils/errorClassification.mjs`(`isRecoverableError`),均**结构化优先 + 正则兜底**。
- 生产端失败路径已基本结构化:失败-plan 走 `toFailedShellPlan`/`buildFailedOneClickPlanningPlan`(设 `planningFailed:true`+`status:'error'`);失败-result 设 `status:'error'`+`errorCode`。**唯一缺口**:两个失败-plan 构造器未单独设 `errorCode` 字段(把码读成了 message 文字)。
- 正则兜底现在真正服务对象 = **历史持久化数据**(老库里只以文字形式记录失败的 plan)。
- **已存在的"文本→结构化失败卡"读边界迁移点**:后端 `appStateMerge.normalizeInvalidPlanAsFailedPlanningCard`(定义 :11,调用 :533 `visiblePlans.map`)、前端 `shellDataAdapter.ts:2289`——命中失败文本即转 `planningFailed:true`+`status:'error'`。

## 2. 目标(业主已定:热路径结构化-only + 覆盖证明到位)

- 文本识别(`LEGACY_FAILURE_TEXT_PATTERNS` / `RECOVERABLE_MESSAGE_PATTERN`)塌缩到**唯一的读边界迁移点**。
- 热路径消费者(`isPlanFailed`/`isRecoverableError` 及其调用方)只读结构化字段。
- 删 `isPlanFailed`/`isRecoverableError` 的正则兜底行。
- 补齐 2b 小尾巴:两个失败-plan 构造器设 `errorCode`。

## 3. 安全铁律(整轮成败,且含红线)

1. **顺序不可逆**:迁移点先落 + 覆盖证明到位 + 每条 legacy pattern 有迁移单测 —— **之后**才删热路径兜底。任一未达成,不删。
2. **覆盖证明红线**:删某条热路径正则的前提是**静态证明该消费者拿到的 plan 必定已过迁移 normalizer**。**若某条热路径无法确证,则该处保留正则兜底(退回"永久 defense-in-depth"姿态),不为达成"彻底删"而硬删。** 执行中遇此情况停下回报,不赌。
3. 不可逆风险点 = 历史"纯文本失败"plan 被误判成功;上述两条共同拦截。

## 4. 改动单元

### 4.1 补 errorCode(2b 小尾巴)
- `src/adapters/shellWorkflow.ts:396 toFailedShellPlan`:入参或内部取 code,产出对象加 `errorCode`。
- `src/adapters/shellPlanningFailure.ts:65 buildFailedOneClickPlanningPlan` 及 `FailedOneClickPlanningPlan` 类型:加 `errorCode`(取 `job.errorCode`,无则 `'planning_failed'`)。
- `src/adapters/shellDataAdapter.ts:1179` 的同名本地构造器:同样加 `errorCode`。
- 这些 plan 本就 `planningFailed:true`,补 errorCode 是完整性(让 `isPlanFailed` 删兜底后仍稳、且下游可读码)。

### 4.2 迁移点显式调文本判据(成为唯一文本调用者)
- `appStateMerge.normalizeInvalidPlanAsFailedPlanningCard`:`if (plan?.planningFailed || !isInvalidOneClickPlanLike(plan)) return plan;` 改为 `if (plan?.planningFailed || plan?.status === 'error' || plan?.errorCode || !isLegacyFailureText(getPlanContent(plan))) return plan;`(已结构化的直接放行,只对"纯文本"迁移)。
- `shellDataAdapter.ts:2289` 同款改造。
- 迁移产出:`{...plan, planningFailed:true, status:'error', errorCode:'legacy_text', ...}`。

### 4.3 覆盖证明 + 必要的上游补迁移
逐个静态追这 4 个热路径消费者的 plan 来源链,产出"是否已过迁移"结论表:
- `src/ShellMigratedApp.tsx:908`(`isInvalidOneClickPlanLike(plan)`)
- `src/shell/components/ProjectCard.tsx:715`(`isInvalidOneClickPlanLike(plan)`)
- `src/adapters/shellPersistence.ts:207`(`isInvalidOneClickPlanLike(item)`)
- `src/adapters/shellDataAdapter.ts:513`(`!isInvalidOneClickPlanLike(plan)`)
对"已证下游"的:可安全依赖结构化-only。对"证不全"的:在其上游最近的读边界补一次迁移 normalizer;仍证不了的 → 按红线保留该处兜底并回报。

### 4.4 删热路径正则(覆盖证明全绿后)
- `planFailure.mjs:isPlanFailed`:删 `return isLegacyFailureText(getPlanContent(plan));`,改 `return false;`(只读 `planningFailed/status/errorCode`)。
- `errorClassification.mjs:isRecoverableError`:删 `return RECOVERABLE_MESSAGE_PATTERN.test(...)`,改 `return false;`(分类器均已先吃 errorCode/providerStatus)。
- `LEGACY_FAILURE_TEXT_PATTERNS`/`isLegacyFailureText`/`RECOVERABLE_MESSAGE_PATTERN` 保留导出,但**仅被迁移点 import**。

## 5. 数据流(目标态)

```
持久化历史数据(可能仅文本失败)
  → 读边界迁移 normalizer(唯一文本识别处)→ 回填 planningFailed/status/errorCode
  → 热路径 isPlanFailed/isRecoverableError 只读结构化字段
  → UI 成败/可恢复展示
新数据:生产端源头已打结构化字段,迁移点直接放行
```

## 6. 测试

- **迁移单测**(2c 核心):每条 `LEGACY_FAILURE_TEXT_PATTERNS` 各造一个"仅文本失败、无结构化标志"的 plan,断言经 `normalizeInvalidPlanAsFailedPlanningCard`(后端)与 shellDataAdapter 迁移点(前端)后变 `planningFailed:true`/`status:'error'`。
- **errorCode 单测**:`toFailedShellPlan`/`buildFailedOneClickPlanningPlan` 产出带 `errorCode`。
- **热路径无正则 grep 回归**:`isPlanFailed`/`isRecoverableError` 函数体不含 `LEGACY_FAILURE_TEXT_PATTERNS`/`RECOVERABLE_MESSAGE_PATTERN` 调用。
- **结构化-only 行为**:仅文本、无结构化标志的 plan 直接喂 `isPlanFailed` → `false`(证明已不靠文本);同一 plan 过迁移点后 → 被识别失败。
- 全量:前后端 `--test` 全绿、`npm run lint` exit 0、`npm run build` 成功。

## 7. 风险与回滚

- 本地基线 `7b65061`,分支 `fix/chunk-error-boundary`,可回滚。
- 覆盖证明是唯一硬骨头;红线保证"证不全就不删",最坏退化为"正则永久兜底但已收敛单一处",仍优于现状(两份拷贝 + 散落)。
- 删兜底后,新写代码若忘设结构化字段会"漏判失败"——由生产端已结构化(2b)+ 迁移点 + 单测共同防;后续新增失败路径必须设结构化字段(写入根因库"如何避免")。
