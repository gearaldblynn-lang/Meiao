# KIE Error Governance Design

## Goal

为所有依赖 KIE 的功能建立统一、可恢复、可观测的错误治理层，重点解决两类问题：

1. KIE 余额不足时，前端与日志给出明确提醒，不再误显示为普通失败。
2. 任务在前端等待超时或轮询失败时，如果供应商后台仍可能继续处理，系统应优先保留可恢复语义，而不是直接把任务判死。

## Scope

本次设计覆盖所有通过内部任务系统提交到 KIE 的任务，包括但不限于：

- 一键主图
- 一键详情
- SKU 生图
- 买家秀相关 KIE 图像任务
- 视频相关 KIE 图像/视频任务
- 未来复用 `kieAiService.ts` 与内部任务系统的 KIE 功能

不在本次范围内：

- 新增单独的 KIE 余额查询页面
- 自动轮询账户余额并常驻展示
- 对非 KIE 供应商增加同等级错误治理

## Current Problems

### 1. 余额不足被当成普通坏请求

当前 `server/providerGateway.mjs` 在 `createTask` 阶段把 KIE 的 `402 Credits insufficient` 归类为 `provider_bad_request`。这会带来两个问题：

- 前端只能看到笼统失败文案，用户不知道应先充值。
- 运营日志中该错误会被误判为“参数不合法”，影响排障。

### 2. 可恢复失败语义过于依赖字符串

当前前端 `services/kieAiService.ts` 的自动恢复主要依赖：

- `provider_internal_error`
- `provider_network_error`
- `provider_timeout`
- 正则匹配 `fetch failed|network|timeout|超时|服务异常|网络异常`

这能覆盖一部分情况，但仍然有两个风险：

- 上游错误语句一变，恢复判断就会失效。
- “创建阶段失败”和“已拿到 providerTaskId 但轮询阶段异常”没有被清晰区分。

## Design Principles

### 1. 服务端先归一化，前端只消费语义

错误类型必须在服务端统一收敛，前端不应在每个模块里靠字符串硬猜。

### 2. 保留原始供应商信息

在归一化错误码之外，保留 `providerMessage`、`providerStage`、`providerStatus` 供日志与排障使用。

### 3. 可恢复能力只建立在“有 providerTaskId 且上游可能仍在跑”的基础上

如果 KIE 在创建阶段就拒绝请求，则直接判定为不可恢复错误；如果已经拿到 `providerTaskId`，则应优先保留 recover 入口。

### 4. 复用现有内部任务系统，不新增并行状态机

继续沿用：

- `server/providerGateway.mjs`
- `server/jobManager.mjs`
- `services/kieAiService.ts`
- `services/internalApi.ts`

不单独引入新的任务层或前端状态机。

## Proposed Changes

### A. 服务端新增规范化 KIE 错误码

在 `server/providerGateway.mjs` 中增加 KIE 错误归一化逻辑，至少覆盖：

- `provider_credit_insufficient`
  适用：KIE 返回 `402` 或消息包含 `Credits insufficient`
- `provider_request_limit`
  适用：KIE 返回 `433` 或消息表明 sub-key 限额/配额超过限制
- `provider_rate_limited`
  适用：HTTP `429`
- `provider_auth_invalid`
  适用：HTTP `401/403`
- `provider_recoverable_pending_result`
  适用：轮询阶段出现暂时性网络/服务异常，但已持有 `providerTaskId`，且不应立即把任务判成不可找回

说明：

- `provider_recoverable_pending_result` 不要求成为最终落库状态码的唯一形式，但应至少作为前端与日志可识别的语义存在。
- 对于真正的供应商超时，仍允许维持 `provider_timeout`，但需要和 recover 逻辑明确挂钩。

### B. 统一创建阶段与轮询阶段错误边界

在 `server/providerGateway.mjs` 中明确两类失败：

- 创建阶段失败
  特征：没有 `providerTaskId`
  处理：直接返回明确错误码，不进入 recover 逻辑
- 轮询阶段失败
  特征：已有 `providerTaskId`
  处理：保留 `providerTaskId`，并在合适场景下标记为可恢复

### C. 前端建立通用 KIE 错误解释层

在 `services/kieAiService.ts` 增加通用的 KIE 任务结果解释函数，例如：

- 判断是否余额不足
- 判断是否请求额度受限
- 判断是否应提示“可稍后同步/找回结果”

所有主图、详情、SKU、视频、买家秀等模块继续使用既有 `KieAiResult`，但错误展示统一由该解释层提供。

### D. 前端提示策略

统一提示策略如下：

- `provider_credit_insufficient`
  提示：当前 KIE 账户余额不足，相关生图功能暂不可用，请充值后重试。
- `provider_request_limit`
  提示：当前 KIE 子额度或请求额度已达上限，请稍后重试或调整账号配置。
- 可恢复错误
  提示：任务可能仍在云端继续处理，可稍后点击同步/找回结果。
- 其他错误
  保留现有模块上下文提示。

本次不做常驻横幅；先做任务失败时的强提醒与日志可辨识化。

### E. 管理日志失败原因归类修正

在 `modules/Account/accountManagementUtils.mjs` 中补充失败原因映射：

- `provider_credit_insufficient` => `余额不足`
- `provider_request_limit` => `额度受限`
- `provider_recoverable_pending_result` / `provider_timeout` => `结果待同步`

避免把余额不足继续显示为“参数不合法”。

## Data Flow

### 正常失败链路

1. 前端创建内部任务
2. 服务端调用 KIE
3. `providerGateway` 规范化错误
4. 内部任务写入统一 `errorCode` / `errorMessage` / `providerStage` / `providerStatus`
5. 前端通过 `kieAiService` 解释错误并提示
6. 管理日志通过 `accountManagementUtils` 归类失败原因

### 可恢复链路

1. 服务端已成功创建 KIE 任务并拿到 `providerTaskId`
2. 轮询阶段短暂失败或前端等待超时
3. 内部任务保留可恢复语义与 `providerTaskId`
4. 前端返回“可稍后同步/找回结果”
5. 用户或系统再次走 recover 接口

## Testing Strategy

### 服务端测试

在 `server/providerGateway.test.mjs` 增加：

- KIE `402` 映射为 `provider_credit_insufficient`
- KIE `433` 映射为 `provider_request_limit`
- 拿到 `providerTaskId` 后的暂时性轮询异常仍保留可恢复信息

### 前端测试

新增或扩展测试覆盖：

- `kieAiService` 能把余额不足解释为明确用户提示
- `accountManagementUtils` 将余额不足归类为 `余额不足`
- recover 判断不会把创建阶段失败误当成可恢复

### 云上验证

- 充值后真实 KIE 生图成功
- 任务列表能正确看到失败/成功/可恢复状态
- 线上健康接口与 MySQL 容器保持稳定

## Risks

### 1. 过度依赖供应商文本

缓解：

- 优先按 HTTP 状态码与 `code` 字段识别
- 文本匹配只作为兜底

### 2. 前端仍有旧模块直接拼错误文案

缓解：

- 不一次性重构所有模块
- 只在通用 `kieAiService` 结果解释层收口，模块继续复用既有调用面

### 3. 可恢复判断过宽导致误导用户

缓解：

- 必须要求存在 `providerTaskId`
- 创建阶段失败一律不可恢复

## Acceptance Criteria

- KIE 余额不足时，所有依赖 KIE 的功能都会给出明确充值提醒。
- 管理日志中余额不足显示为 `余额不足`，不再显示为 `参数不合法`。
- 已拿到 `providerTaskId` 的超时或暂时性上游异常任务，前端会提示可同步/找回结果。
- 创建阶段失败的任务不会被错误标记为可恢复。
- 一键主图、详情、SKU 与其他 KIE 功能不需要分别写一套补丁逻辑。
