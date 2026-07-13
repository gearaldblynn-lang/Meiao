# MaxForAI Image-2 三档模型接入设计

日期：2026-07-13

## 目标

当前生图渠道偶发不稳定。本次在不替换、不删除任何现有模型的前提下，新增 MaxForAI 的 Image-2 三档模型，作为新的可选生图通道：

| 前台名称 | 站内唯一模型 ID | MaxForAI 真实模型 |
| --- | --- | --- |
| Image-2标准 | `maxforai-image-2-standard` | `gpt-image-2` |
| Image-2高 | `maxforai-image-2-pro` | `gpt-image-2-pro` |
| Image-2超高 | `maxforai-image-2-max` | `gpt-image-2-max` |

站内 ID 刻意不直接使用 `gpt-image-2`，避免与已有 KIE `gpt-image-2` 冲突。提交到 MaxForAI 时再转成上表的真实模型名。

## 范围

本次包含：

- 在当前所有可选择生图模型的界面中加入三个新选项，包括通用生图模块和智能体生图配置。
- 服务端新增独立 MaxForAI 图片适配器，密钥、请求构造、素材转链、错误分类和返回解析都留在服务端。
- 复用现有内部 job 队列、用户隔离、日志、结果持久化和项目卡恢复链路。
- 为新三档明确禁用现有积分预估、预留、扣除和结算。
- 在本地环境完成自动化验证，并使用 Image-2标准做一次最小真实生图冒烟。

本次不包含：

- 不改动现有 KIE、APIports 或 Nano Banana 模型的路由、命名、积分或历史数据。
- 不建立金额账户、金额余额、冻结、扣费、对账或账单。金额计费是后续独立改造。
- 不将本次改动发布到云上，除非用户后续明确要求。
- 不顺便重构全部生图 task type 或整套 provider 注册系统。

## 方案选择

采用“独立 MaxForAI 适配器 + 复用现有图片 job 合同”。

没有选择直接替换现有 KIE `gpt-image-2`，因为会改变已保存模型 ID 的历史任务和重试路由。也没有选择前端直连 MaxForAI，因为会暴露密钥并绕过内部任务、日志、用户隔离和结果恢复。

这个方案保持当前业务调用形状，只在模型识别和 provider 执行边界加入新分支。
新 job 继续使用现有 `kie_image` task type 以复用已稳定的图片任务链，但 job 的 provider 明确记为 `maxforai`，不伪装成 KIE 任务。

## 配置与密钥

新增五个服务端环境变量：

- `MAXFORAI_API_KEY`：MaxForAI 图片接口密钥。
- `MAXFORAI_BASE_URL`：默认 `https://maxforai.top/v1`。
- `MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS`：付费生成 POST 的超时上限，默认 `600000`（10 分钟）。
- `MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS`：素材上传的单次超时上限，默认 `120000`（2 分钟）。
- `MAXFORAI_ASSET_UPLOAD_CONCURRENCY`：单任务素材转链并发上限，默认 `3`，防止多参考图同时上传打满上游。

不复用 `OPENAI_COMPATIBLE_API_KEY`。对话模型与生图渠道的密钥生命周期、限额和故障边界应保持独立。

真实密钥只写入本地未跟踪的 `.env.server`。`.env.server.example` 和部署文档只增加空占位与用途说明。公开系统配置只返回 `maxforai.configured: true/false`，不返回密钥、Base URL 或请求头。

## 模型能力与前端行为

新三档共用同一组能力：

- 文生图、图生图和图片编辑。
- 最多 16 张参考图。
- 不支持透明背景。
- 可选比例为 `auto`、`1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`。
- 可选分辨率档为 `1K`、`2K`、`4K`。

前台仍把 `1K / 2K / 4K` 作为尺寸或清晰度选择，不把它解释成价格档。用户切换到新模型时，如当前保存的比例不在支持列表内，按该模块既有的安全默认比例归一，不把不支持值发给上游。

新模型加入通用 `MODEL_OPTIONS`、Shell 快捷参数、各独立模块侧栏以及智能体生图模型目录。模型展示名、站内 ID 和上游 ID 分层保存，不依赖中文字符串包含判断路由。

## 请求构造

### 端点选择

- 无参考图：`POST /images/generations`。
- 有一张或多张参考图：`POST /images/edits`。

两个端点都使用 `Authorization: Bearer $MAXFORAI_API_KEY` 和 `Content-Type: application/json`。图片编辑请求使用：

```json
{
  "model": "gpt-image-2-pro",
  "prompt": "...",
  "size": "2048x1152",
  "n": 1,
  "images": [
    { "image_url": "https://..." }
  ]
}
```

不传 `background`、`input_fidelity` 或额外 `quality`。三个模型本身就是画质档，而 `1K / 2K / 4K` 只用来构造 `size`；不再叠加另一层 quality 语义。单个内部 job 仍只请求 `n: 1`，批量生图由现有多 job 逻辑管理，不改变项目卡数量和恢复方式。

### 尺寸映射

`auto` 直接发送 `size: "auto"`。其余组合使用固定映射：

| 比例 | 1K | 2K | 4K |
| --- | --- | --- | --- |
| 1:1 | 1024x1024 | 2048x2048 | 2880x2880 |
| 16:9 | 1536x864 | 2048x1152 | 3840x2160 |
| 9:16 | 864x1536 | 1152x2048 | 2160x3840 |
| 4:3 | 1344x1008 | 2048x1536 | 3264x2448 |
| 3:4 | 1008x1344 | 1536x2048 | 2448x3264 |
| 3:2 | 1536x1024 | 2016x1344 | 3504x2336 |
| 2:3 | 1024x1536 | 1344x2016 | 2336x3504 |

映射用纯函数集中维护并穷举测试 21 种组合。结果页继续读取返回图片的真实宽高，不把请求 `size` 当成输出图逐像素保证。

## 素材转链

在付费生成 POST 之前完成所有素材解析：

1. 已是模型可读的公网 HTTPS URL，直接写入 `images[].image_url`。
2. 我方托管素材在云上使用 `MEIAO_PUBLIC_BASE_URL` 的 HTTPS 地址。
3. 本地、非 HTTPS 或不能从公网读取的素材，服务端读取实际文件并通过 `POST /assets` 的 multipart `file` 字段上传，再使用返回的临时 URL。
4. 同一请求中相同素材只转链一次，最终去重并限制为 16 张。
5. prompt 内嵌入的我方素材 URL 和显式 `imageUrls` 使用同一解析缓存，避免重复上传。

素材准备失败时不发送付费生成请求。付费请求已发出后，不再通过更换素材 URL 自动重提。

## 积分与未来金额计费边界

新三档在本期的站内计费状态为“未计费”：

- 前端 `estimateImageBilling` 对三个站内 ID 返回 `billable: false`、`estimatedCredits: 0`，不展示“预计消耗 X 积分”。
- 后端 `estimateCreditReservation` 对三个站内 ID 返回 `0`，不生成 `__creditReservation`、不写积分 ledger。
- 智能体生图的独立预留入口也必须携带选中模型并应用同一个零积分判定，不得因为 task type 是 `agent_image` 而回落到默认 3 积分。
- MaxForAI 返回的任何 usage 数据只进入 provider 运行日志，不映射为 `creditsConsumed`。

后续改成金额时，单独设计金额数据精度、账户、预授权、结算、退回、对账和页面展示；本次不在积分字段中暂存美元金额。

## 付费 POST 的失败与重试规则

MaxForAI 图片生成是同步付费 POST，响应成功时直接返回 `data[].url`，不先返回可轮询的任务 ID。

如请求发出后连接中断，上游可能已经接单和计费，但我方没有收到图片或可查询 ID。自动重发会导致“用户只点一次，上游生成两次并计费两次”。

因此：

- MaxForAI 生成 job 的提交重试次数为 0。
- 智能体 `generate_image` 现有的瞬时错误快速重试对这三个模型禁用。
- 明确的鉴权、参数或上游拒绝响应直接标记失败并展示原因。
- 请求发出后、收到完整 HTTP 响应之前的超时或连接断开标记为 `provider_submission_unknown`，不自动重试。已收到完整成功响应但 JSON 或 `data[].url` 无效时标记为 `provider_bad_response`，同样不自动重试。
- 用户可见文案为：“网络中断，无法确认上游是否已接单。为避免重复扣费，系统没有自动重试，请先查看上游记录后再手动生成。”

这条规则只作用于三个新模型，不改动现有可查询 provider task ID 的 KIE 恢复机制。

## 返回、日志与错误映射

成功响应只接受非空 `data[].url`。返回结果转换成现有内部图片结果合同，再由已有持久化链路保存成我方稳定素材。

错误映射：

- 401/403 -> `provider_auth_invalid`
- 429 -> `provider_rate_limited`
- 明确的 4xx 参数错误 -> `provider_bad_request`
- 明确的 5xx 响应 -> `provider_internal_error`
- 成功响应无 `data[].url` -> `provider_bad_response`
- 提交后网络中断或超时 -> `provider_submission_unknown`

运行日志保留 `provider=maxforai`、站内模型 ID、上游模型 ID、端点类型、参考图数量、请求尺寸、耗时、结果 URL 数量和结构化错误码，但不记录密钥、Authorization 请求头或完整敏感请求体。

## 测试与验收

实现按 TDD 进行，至少覆盖：

1. 三个前台名称、站内 ID 和上游 ID 映射正确，不覆盖已有 `gpt-image-2`。
2. 全部 21 个比例/分辨率组合产生精确 `size`，`auto` 保持 `auto`。
3. 无图请求选择 `/images/generations`；一张和多张参考图选择 `/images/edits`。
4. 编辑请求使用 `images: [{ image_url }]`，去重并限制 16 张，不传透明背景或额外 quality。
5. 非公网素材在生成之前完成 `/assets` 上传；上传失败时不发送生成 POST。
6. 正确解析 `data[].url`，并对鉴权、限流、参数、5xx、空结果和不确定提交分类。
7. MaxForAI 生成 POST 在网络错误、超时和 5xx 下都不自动重提；智能体快速重试也不例外。
8. 新三档在通用 job、智能体直接生图和工具调用三条入口都不预留、不扣除、不展示积分。
9. 现有 KIE、APIports 和 Nano Banana 的模型选择、积分、重试和请求构造测试保持通过。
10. 新密钥不出现在前端构建产物、Git diff、日志或公开系统配置中。

定向测试通过后运行完整 `npm run verify`。最后使用 Image-2标准、1K、1:1、`n: 1` 做一次最小真实生图，检查任务创建、provider 日志、结果 URL、结果持久化和积分不变。Pro 和 Max 档不做付费冒烟，使用合同测试验证。

## 验收标准

- 用户能看到并选择 `Image-2标准`、`Image-2高`、`Image-2超高`，现有模型仍在。
- 三档分别发送正确上游模型名，尺寸由比例和 1K/2K/4K 决定。
- 文生图和最多 16 张参考图编辑的请求形状正确。
- 新模型成功或失败都不改变站内积分余额、冻结量和已用量。
- 付费生成 POST 没有任何自动重提路径，不确定提交有可理解的用户提示和结构化日志。
- 真实密钥只存在服务端未跟踪环境文件中。
- 定向测试、完整验证和一次标准档真实冒烟均有本轮新鲜证据。
