# KIE 托管素材直连优先与回退设计

## 背景

2026-07-09 生产日志中，目标报错集中在 `providerTaskId=null`、`providerStage=asset_upload` 和 `provider_network_error/fetch failed`。失败发生在 KIE 创建生成任务之前，不是模型生成阶段。现有代码虽然具备把托管素材转换成公网 URL 的能力，但 `kie_image` 与 `kie_chat` 两条主链路仍强制把所有托管素材上传到 KIE 图床；单任务并发限制无法约束多个任务同时上传，进程级也没有成功 URL 缓存。

生产域名 `https://meiaoyuntai.com` 已配置有效 HTTPS 证书，托管素材路径可以通过该域名返回正确内容类型和文件内容，因此可以作为直连主路径。

## 已选择方案

采用“HTTPS 直连优先，明确读图失败后转存 KIE”的混合路由。

未选择的方案：

- 所有素材继续强制上传 KIE：改动最小，但保留当前转存单点故障和批量上传压力。
- 所有素材只走我方 HTTPS：速度最快，但无法覆盖部分 KIE 模型偶发无法读取外部 URL 的历史兼容问题。

用户已在本次任务中明确授权：再次校验链路正确后直接实施混合路由。

## 路由规则

只对我方 `/api/assets/file/` 托管素材改变路由，外部 URL、data URL、视频专用稳定 MIME 转存规则保持不变。

1. `MEIAO_KIE_MANAGED_ASSET_MODE=auto` 为默认模式。
2. `auto` 仅在 `MEIAO_PUBLIC_BASE_URL` 是外网可访问的 HTTPS 地址时启用直连；否则退回现有 `kie-only` 行为。
3. `direct-first` 显式启用直连，但仍要求有效 HTTPS 公网基址；配置不满足时安全回退为 `kie-only`。
4. `kie-only` 保留现有强制转存行为，作为紧急回滚开关。
5. 旧的 HTTP IP 或 HTTP 域名素材 URL 必须规范化为 `MEIAO_PUBLIC_BASE_URL + managed asset path`，不能继续把旧 HTTP 地址交给上游。

## 失败回退

直连失败只有同时满足以下条件才转存 KIE 并重试同一模型：

- 本次 payload 确实包含托管素材；
- 首次请求使用了直连路由；
- 错误明确指向文件读取、下载或 MIME 解析，或同步 KIE chat/Responses 返回无任务 ID 的 HTTP 502；
- 错误中没有 `providerTaskId`；
- 本次调用尚未执行过 KIE 媒体回退。

一旦 KIE 已返回任务 ID，后续 polling 失败不得重新创建任务。鉴权、余额、限额、取消、普通模型拒答和普通生成失败也不得触发媒体回退。

`kie_chat` 必须先尝试同模型的 KIE 素材回退，再考虑既有模型 fallback。`asset_upload` 和 `asset_download` 错误继续禁止模型 fallback，避免换模型后重复转存。

## 上传保护

实际进入 KIE 转存时应用进程级总闸门：

- `MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY`：跨任务上传并发，默认 3；
- `MEIAO_KIE_ASSET_UPLOAD_RETRIES`：连接错误及 429/500/502/503/504 的上传重试次数，默认 2；
- `MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS`：指数退避基数，默认 1000 毫秒；
- 任务取消时，正在队列中等待上传的操作立即退出。

生成任务创建 POST 仍保持“收到任何 HTTP 响应后不重试”的防重复扣费规则。只有文件上传 POST 被显式标记为可重试传输操作。

## 成功缓存

托管素材成功上传 KIE 后，以稳定的 managed asset path 为键缓存 KIE URL，并复用进行中的同一上传 Promise，避免并发任务重复上传同一文件。

- `MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS`：默认 30 分钟；
- `MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES`：默认 2000 条；
- 失败或空 URL 不进入缓存；
- 超时条目和超量最旧条目会被清理；
- 缓存只在当前 Node 进程内有效，PM2 重启后自然清空。

## 代码边界

- `server/providerAssetTransfer.mjs`：托管素材模式、HTTPS 规范化、成功上传缓存。
- `server/providerAssetUploadLimiter.mjs`：独立的可取消进程级并发闸门。
- `server/providerGateway.mjs`：上传重试参数、直连读图失败分类、同模型 KIE 回退及任务 ID 安全边界。
- `server/providerKieImage.mjs`：继续负责单任务素材解析并发和任务 ID 附着，不承担跨任务全局状态。

## 验证标准

- HTTPS 托管素材在正常情况下直接进入 `kie_image` 与 `kie_chat` 请求，不调用 KIE file-stream-upload。
- 明确的文件读取失败会在无任务 ID 时上传一次 KIE，并以 KIE URL 重试同一模型。
- 已拿到任务 ID 的失败不会创建第二个任务。
- 两个并发任务转存同一素材只发生一次实际上传。
- 跨任务上传并发不超过配置值；上传 503 可按预算恢复；生成任务 POST 503 仍不重试。
- 现有 provider、job runtime、Temporal、构建和 lint 门禁通过。
- 云上配置启用 `direct-first` 后，健康检查正常，公网 HTTPS 素材返回 200，并完成一条正式托管素材生成烟测。

## 回滚

无需回滚代码。把云上 `MEIAO_KIE_MANAGED_ASSET_MODE` 改为 `kie-only` 并重启 PM2，即可恢复所有托管素材强制转存 KIE 的旧行为。
