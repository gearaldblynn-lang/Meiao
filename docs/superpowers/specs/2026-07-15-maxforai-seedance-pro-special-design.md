# MaxForAI Seedance 2.0 Pro 特价接入设计

日期：2026-07-15  
状态：用户已批准设计方向，待规格复核后实施

## 1. 目标

在梅奥 AI 的“短视频 → 视频生成”中新增一个独立的 MaxForAI 视频通道：

- 前台名称固定为 `Seedance 2.0 Pro 特价`。
- 在支持的生成模式中默认选中，并显示“推荐”。
- 模型选项直接显示 `0.5元/秒`；提交区同时按所选秒数显示预计金额。
- 上游真实模型固定为 `sora-v9-pro`，通过 `POST /v1/videos` 创建、`GET /v1/videos/{task_id}` 查询。
- 支持文生视频和图片、视频、音频混合参考。
- 实现完成后发布腾讯云，并做一次 4 秒真实付费验收。

本次“0.5元/秒”只是产品展示价格，不进入站内积分或人民币账本，不扣除、预留或结算站内积分。

## 2. 已确认的产品决策

1. 新通道作为独立模型保留，现有 `Seedance 2.0 Fast · API` 与 `Seedance 2.0 Fast VIP · CLI` 不删除、不改路由。
2. 在“全能参考”模式里，新通道是新任务的默认模型和推荐模型。
3. 已经保存的历史项目、运行中任务和用户明确选择的旧模型不做强制迁移。
4. `Seedance 2.0 Pro 特价` 只支持“全能参考”。“首尾帧”继续使用现有 KIE Seedance，“智能多帧”继续使用现有即梦 CLI，不能把普通多图参考伪装成首尾帧能力。
5. 页面直接显示 `0.5元/秒`，并以 `秒数 × 0.5` 显示预计金额，例如 4 秒显示 `预计 2.00 元`。
6. 用户已批准腾讯云发布，以及一次最小 4 秒真实任务。按渠道文档，上游预计成本为 `$1.20`；这不是页面展示价格。

## 3. 范围

### 3.1 本次包含

- 短视频底部输入栏的模型、时长、比例、价格提示与默认值。
- 直接视频生成工作流的任务创建、素材准备、任务 ID 持久化、轮询、恢复、错误映射和结果托管。
- 新任务类型的权限、去重、日志、取消、重试和站内积分边界。
- 服务端独立密钥、Base URL、超时、轮询和素材并发配置。
- 本地测试、构建、doctor、浏览器验收、云上发布和单次付费 canary。

### 3.2 本次不包含

- 不接入分镜策划、长视频工作区、智能工厂或 Agent Center 的视频工具。
- 不新增人民币余额、订单、预授权、结算、退款或财务对账。
- 不改现有 KIE/即梦视频价格、积分或恢复策略。
- 不宣称上游具备首尾帧、智能多帧或 1080p 能力。
- 不新增上游取消接口；接入文档没有提供取消端点。

## 4. 模型与任务合同

新增一个共享的站内模型定义，前后端不得各维护一份：

| 字段 | 值 |
|---|---|
| 站内模型 ID | `maxforai-sora-v9-pro` |
| 前台名称 | `Seedance 2.0 Pro 特价` |
| 上游模型 | `sora-v9-pro` |
| provider | `maxforai` |
| taskType | `maxforai_video` |
| 展示单价 | `0.5` 元/秒 |
| 输出 | 720p 视频 |
| 时长 | 4–15 秒整数，默认 4 秒 |
| 比例 | `16:9`、`9:16`、`1:1` |
| 图片参考 | 最多 9 张 |
| 视频参考 | 最多 3 个，合计不超过 15 秒 |
| 音频参考 | 最多 3 个，合计不超过 15 秒 |

共享合同至少导出模型 ID、前台名称、上游模型、显示价格、支持模式、时长、比例和素材上限。前端选择器、工作流归一化、价格提示和服务端 adapter 都消费该合同。

## 5. 前端交互

### 5.1 模型与模式

- “全能参考”的模型顺序为：`Seedance 2.0 Pro 特价`、现有 Fast API、现有 Fast VIP CLI。
- 新模型的选项同时展示“推荐”和 `0.5元/秒`。
- 新鲜表单或没有明确历史选择时默认选中新模型。
- 用户手动选择其他兼容模型后保持用户选择，不在每次渲染时抢回默认值。
- 切换到“首尾帧”时，新模型不在可选列表中；若当前选中它，归一为现有 Fast API。
- 切换到“智能多帧”时继续强制现有 Fast VIP CLI。
- 返回“全能参考”时保留当前兼容模型；下一次新鲜表单仍以新模型为默认。

### 5.2 参数

选中新模型时：

- 时长展示 4–15 秒整数选项，默认 4 秒。
- 比例只展示 `16:9 / 9:16 / 1:1`；历史非法值在提交前归一为 `16:9`。
- 分辨率固定 720p，不展示 480p/720p 二选一。
- 支持零素材文生视频；上传素材时可使用图片、视频、音频任意组合。
- 仍沿用现有任务提交锁、素材预览、媒体裁剪转码和任务卡生命周期。

### 5.3 价格

价格来自共享模型合同，避免模型选项和提交提示漂移：

- 模型项：`Seedance 2.0 Pro 特价` + `0.5元/秒` + `推荐`。
- 提交提示：`Seedance 2.0 Pro 特价 · 0.5元/秒 · 4秒 · 预计2.00元`。
- 预计金额保留两位小数。
- 不显示“预计消耗 X 积分”，也不把人民币金额写进 `creditsConsumed`。

## 6. 服务端架构

采用独立 adapter `providerMaxForAiVideo`，不把 MaxForAI 视频分支塞进 `runKieSeedanceVideoJob`。

```text
短视频输入栏
  -> runShellVideoGeneration
  -> internal job(taskType=maxforai_video, provider=maxforai)
  -> providerMaxForAiVideo
       -> 校验参数与素材上限
       -> /assets 或 /assets/url 转链
       -> POST /videos 创建任务
       -> 立即持久化 task_id
       -> GET /videos/{task_id} 轮询/恢复
  -> 结果视频下载并保存为梅奥托管素材
  -> 任务卡完成并可播放/下载
```

独立任务类型的理由：

- 恢复时能确定查询 MaxForAI，而不是误走 KIE recordInfo。
- 运行日志能准确区分供应商、模型和阶段。
- provider task ID 已存在时只查询旧任务，不再次创建付费任务。
- 未来如果再接其他 OpenAI Videos API 模型，不必污染 Seedance 专用语义。

## 7. 密钥与运行参数

真实令牌只写入未跟踪的本地 `.env.server` 和腾讯云 `/www/wwwroot/meiao-internal/.env.server`，不得进入源码、设计文档、测试、Git diff、日志或公开系统配置。

新增配置：

```dotenv
MAXFORAI_VIDEO_API_KEY=
MAXFORAI_VIDEO_BASE_URL=https://maxforai.top/v1
MAXFORAI_VIDEO_CREATE_TIMEOUT_MS=60000
MAXFORAI_VIDEO_ASSET_TIMEOUT_MS=120000
MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY=2
MAXFORAI_VIDEO_POLL_INTERVAL_MS=5000
MAXFORAI_VIDEO_POLL_TIMEOUT_MS=1500000
```

- 视频令牌不回退读取 `MAXFORAI_API_KEY`，避免更换视频渠道令牌时破坏现有 Image-2 通道。
- 所有超时和并发都使用 env + 保守默认；非法值回到默认值。
- 公开配置最多返回 `configured: true/false`，不返回令牌或 Base URL。

## 8. 素材准备

生成接口只接收公网 HTTPS URL，服务端负责在付费创建任务前完成转链：

1. 收集并按类型去重图片、视频和音频。
2. 在上传前校验数量、已知时长、协议和媒体类型；失败时不调用 `POST /videos`。
3. 梅奥托管素材、data URL 或需要服务端读取的素材，下载后通过 `POST /assets` multipart 的 `file` 字段上传。
4. 已有外部 HTTPS 素材通过 `POST /assets/url` 转存，避免防盗链、短签名或外部读取抖动影响正式任务。
5. 素材上传使用总并发 2；网络错误、429 和 5xx 可做有限重试，因为尚未创建付费生成任务。
6. 读取返回的临时 `url` 后立即创建生成任务，不持久化为长期业务素材。
7. 不经过 KIE 图床，不把 MaxForAI 临时地址写入 app state 或用户日志。

## 9. 创建、轮询与恢复

### 9.1 创建请求

发送：

```json
{
  "model": "sora-v9-pro",
  "prompt": "用户提示词",
  "seconds": 4,
  "aspect_ratio": "16:9",
  "images": ["https://..."],
  "videos": ["https://..."],
  "audios": ["https://..."]
}
```

没有对应素材时省略该数组。创建成功后兼容读取根级或 `data` 下的 `id/task_id`，但只接受非空字符串任务 ID。

任务 ID 一旦返回，必须先通过现有 `onProviderTaskId` checkpoint 写入 job，再开始轮询。checkpoint 失败时抛出带内存任务 ID 的 `provider_submission_unknown`，不重提。

### 9.2 轮询

- 状态 `queued`、`processing`：按配置间隔继续查询。
- 状态 `succeeded`：读取非空 `result_url`。
- 状态 `failed`：保留上游错误摘要并映射为结构化 provider 错误。
- 未知状态或成功无 URL：`provider_bad_response`。
- 轮询网络错误携带已有 task ID，进入有界查询恢复，不创建新任务。
- job 已有 `providerTaskId` 时，adapter 直接从 GET 查询开始。

成功后的 `result_url` 无需 Authorization。现有 `persistJobOutputAssetsIfEnabled` 下载视频并改写为梅奥托管 `videoUrl`；长期状态不依赖上游临时地址。

## 10. 重试、取消与错误

### 10.1 付费创建边界

`POST /videos` 不自动重提：

- 收到 401/403：`provider_auth_invalid`。
- 收到 429：`provider_rate_limited`。
- 收到明确 4xx：`provider_bad_request`。
- 收到明确 5xx：`provider_internal_error`，但不自动再发创建请求。
- 发出请求后超时、断连或响应无法确认：`provider_submission_unknown`，提示“为避免重复生成和扣费，系统没有自动重试”。
- HTTP 成功但没有任务 ID：`provider_bad_response`，仍不重提。

素材上传发生在付费创建之前，可以按独立预算安全重试；素材上传重试不得包住 `POST /videos`。

### 10.2 取消

接入文档未提供上游取消端点：

- 付费创建 POST 发出前取消：安全中断素材准备，不创建上游任务。
- 付费创建 POST 已发出但任务 ID 尚未返回时取消：按 `provider_submission_unknown` 保留记录，不能宣称未创建，也不能自动重提。
- 任务 ID 返回后取消：停止本地轮询并保留任务 ID；页面明确提示“已停止本地等待，上游任务可能仍会继续并产生费用”。
- 不伪造“上游已取消”，不删除仍需排查的 provider task ID。

## 11. 权限、去重、积分与日志

- `maxforai_video` 纳入现有短视频权限门禁和视频任务一小时语义去重窗口。
- 任务创建 `maxRetries=0`；已有 task ID 的查询恢复使用现有 submitted-task 有界预算。
- Temporal 对 `provider=maxforai` 保持单 activity attempt，避免编排器重放创建 POST；恢复通过持久化 job 的新一轮执行只走 GET。
- `estimateCreditReservation` 对 `provider=maxforai` 已是 0，新任务继续保持零预留、零扣除、零结算。
- 完成日志记录 provider、taskType、站内模型、上游模型、素材数量、秒数、比例、耗时、task ID 和结构化状态。
- 日志不记录 Authorization、真实令牌、完整素材临时 URL、签名参数或完整请求体。

## 12. 测试策略

实现按 TDD 进行，至少覆盖：

1. 共享模型合同的名称、ID、上游 ID、0.5 元/秒、时长、比例和素材上限。
2. 全能参考默认选中、推荐和价格展示；首尾帧/智能多帧排除新模型。
3. 4–15 秒、三种比例、720p 固定和非法历史参数归一。
4. 文生视频、单类参考和图/视频/音频混合参考请求。
5. 9 图/3 视频/3 音频与 15 秒总时长限制在付费创建前生效。
6. `/assets`、`/assets/url`、上传并发和“素材失败不创建视频任务”。
7. 创建响应任务 ID 解析、checkpoint 先于轮询。
8. queued/processing/succeeded/failed、成功无 URL、未知状态和轮询超时。
9. 已有 provider task ID 只 GET、不 POST；轮询错误后有界恢复仍不重提。
10. 创建 POST 的网络错误、超时、5xx 和坏响应均不自动重提。
11. 新任务受视频权限、去重和取消规则保护，站内积分始终不变。
12. 现有 KIE Seedance、即梦 CLI、Image-2 MaxForAI 和其他 provider 回归保持通过。

定向测试后运行：

- TypeScript 检查与 lint。
- `npm test` 或与影响面等价的完整 Node 测试集。
- `npm run build`。
- `npm run doctor`，必须看到 worker healthy。

## 13. 发布与真实验收

1. 审查完整 diff，重点检查密钥、任务恢复、视频权限、积分、素材 URL 和现有通道回归。
2. 将视频专用 env 安全写入云上 `.env.server`，输出只报告 configured 状态。
3. 等待发布门禁中 `runningCount/providerlessCount/submittedCount` 排空，不使用 override。
4. 使用 `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh` 发布。
5. 验证云上 `/api/health`、PM2、worker、版本文件和前端资源链。
6. 浏览器确认新模型默认选中、显示推荐和 `0.5元/秒`，4 秒显示预计 2.00 元。
7. 只提交一次 4 秒、16:9、无参考素材的真实任务。
8. 核对：只出现一个上游任务 ID；状态完整经过创建/轮询；最终 `videoUrl` 已转为梅奥托管资产；HTTP 200、视频 MIME、非零字节且浏览器可播放；站内积分前后不变。
9. 若创建响应状态不明，不再提交第二个 canary，先查上游记录。

## 14. 验收标准

- “全能参考”新任务默认选择 `Seedance 2.0 Pro 特价`，同时显示“推荐”和 `0.5元/秒`。
- 4 秒展示预计 2.00 元，且站内积分不发生变化。
- 支持文生视频与合同范围内的混合参考；前后端都拦截超限素材和非法参数。
- 创建成功后 task ID 先落库；刷新、worker 重启或轮询瞬时失败不会再次创建付费任务。
- 最终视频保存到梅奥托管资产并可播放、下载。
- 现有 Fast API、Fast VIP CLI、首尾帧和智能多帧保持原行为。
- 真实令牌不进入 Git、前端构建、日志或公开配置。
- 本地验证、代码审查、云上健康检查和一次 4 秒真实 canary 均有证据。
