# MaxForAI Image-2 响应格式修复设计

## 背景与根因

`image-2中转` 的首次真实任务收到 HTTP 200，但梅奥最终记录为 `provider_bad_response`，错误详情是“MaxForAI 返回成功但没有图片 URL”。现有实现存在两个相互叠加的合同缺口：请求没有传 `response_format: "url"`，响应解析又只读取 `data[0].url`。当上游按默认格式返回 `data[0].b64_json` 时，图片实际已生成，梅奥却会误判失败。

该次响应正文没有被现有日志或任务记录保存，因此无法事后还原完整 JSON，也不能声称已经从旧响应确认了 `b64_json`。修复必须基于渠道方已确认的双格式合同，并在下一次真实任务中用非敏感格式元数据验证实际返回类型。

## 目标

- 文生图和图片编辑请求都明确发送 `response_format: "url"`。
- 成功响应同时接受 `data[0].url` 与 `data[0].b64_json`。
- `b64_json` 不进入任务表、Temporal 历史或前端状态；服务端在任务完成前将其写入梅奥托管素材，并只保存托管 URL。
- 任务结果记录 `providerResponseFormat: "url" | "b64_json"`，用于验证真实返回格式，不保存完整 base64。
- 保持现有零积分、HTTP 零重试、Agent 零重试、Temporal activity 单次尝试和 `provider_submission_unknown` 语义不变。

## 方案选择

采用“请求 URL + 响应双解析 + base64 立即托管”的双保险方案。

只增加 `response_format` 无法防御中转或上游忽略参数；直接把 data URL 返回前端又会把大体积 base64 写进任务记录。双保险方案在 provider 层识别格式，在 job 输出资产层完成持久化，边界清晰且不扩大敏感数据面。

## 数据流

1. `buildMaxForAiImageRequestBody` 为 `/images/generations` 和 `/images/edits` 构造包含 `response_format: "url"` 的 JSON。
2. `runMaxForAiImageJob` 解析 `data[0]`：
   - 有 `url`：直接返回远程 URL，并标记 `providerResponseFormat: "url"`。
   - 无 `url` 但有合法 `b64_json`：构造内部 `data:image/png;base64,...`，标记 `providerResponseFormat: "b64_json"`。
   - 两者都没有：继续报 `provider_bad_response`，错误只记录顶层字段名和 `data[0]` 字段名，不记录正文值。
3. `persistJobOutputAssetsIfEnabled` 在任务结果落库前识别内部 data URL，通过 `persistAssetBuffer` 写入托管素材目录，并用托管 URL/asset ID 替换 data URL。
4. 远程 URL 继续走现有下载持久化链；其他 provider 不改变行为。

## 错误与安全边界

- base64 为空、不是合法图片 data URL、解码后为空，均以 `provider_bad_response` 失败，不把原始字符串写日志。
- 如果运行环境无法提供托管素材根地址，base64 结果明确失败，不降级为把 data URL 写进任务记录。
- 完整响应 JSON 不写日志；图片内容可能包含用户素材，且 base64 体积很大。只保留响应字段形状和 `providerResponseFormat`。
- 付费生成 POST 仍只提交一次；连接中断仍进入状态不确定，解析失败也不自动重新生成。

## 测试与验收

- 单元测试先验证旧实现缺少 `response_format`、不能解析 `b64_json`，形成 RED。
- provider 测试覆盖 URL 优先、base64 回退、缺字段失败、生成与编辑请求体。
- 输出资产测试覆盖 base64 解码、托管 URL 替换、不把 data URL 留在结果中，以及 HTTP URL 原行为不变。
- 集成合同测试确认 `server/index.mjs` 在所有 MySQL/本地、Temporal/普通 worker 路径调用同一持久化函数。
- 全量 `npm run verify`、Hermes changed-file gate 和密钥扫描通过后，只提交一次新的真实付费任务。
- 真实任务必须满足：`succeeded`、Temporal attempt 1、retry 0、积分不变、`providerResponseFormat` 可见、托管图片 HTTP 200 且 MIME/字节/尺寸有效。失败或状态不确定时停止发布，不重试。
