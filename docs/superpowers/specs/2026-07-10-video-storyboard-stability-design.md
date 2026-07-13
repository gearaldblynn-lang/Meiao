# 短视频与分镜生成稳定性设计

## 背景与事故证据

2026-07-10 云上两条董丹丹分镜任务都在 Gemini 接单前失败：

- `providerStage=asset_upload`；
- `providerTaskId=null`；
- 每条任务的两次尝试都是 `Kie 素材上传超时`；
- 用户原始图片和约 48.3 MiB 的 MP4 已经成功保存到我方图床，通过 `https://meiaoyuntai.com/api/assets/file/...` 能够返回 200、正确 MIME、长度、ETag 和 Range 支持；
- 同时段两条真正进入 `kie_seedance_video` 的任务都获得了 `providerTaskId` 并成功完成。

因此本次不是我方素材上传失败，也不是 Seedance 视频生成失败。直接原因是 Gemini 分镜分析链路对所有视频强制执行 KIE `openrouter-chat` 转存，上传约 48.3 MiB 文件时超时。这条视频特例绕过了已经上线的 `direct-first` 管理素材路由和进程内转存缓存。

## 目标

1. 分镜分析正常情况直接使用我方 HTTPS 素材 URL，取消必经 KIE 图床的单点。
2. 只在上游明确说无法读取素材、且尚未创建计费任务时，允许一次 KIE 转存回退。
3. 对视频生成链路守住不重复提交、不重复扣费、已接单任务只恢复轮询的约束。
4. 保留可回滚开关、转存限流、瞬时故障重试和成功 URL 缓存，但这些保护不应拖慢正常任务。
5. 收集并回归短视频/分镜模块已知错误，优先修复有生产证据或可确定触发的缺口。

## 并行审计后的扩展边界

云上、后端付费任务和前端恢复三路审计确认，除本次素材转存事故外，还有以下可复现稳定性/付费安全缺口，需与核心修复同批收口：

- 分镜规划失败时仍可跨到 GPT，与历史 Gemini-only 规则不一致；
- KIE chat 媒体解析没有分镜专用并发上限；
- 前端提交锁在拿到 backend/provider 任务标识后提前释放，可导致重复卡片、重复上传和重复提交；
- 分镜生图的 `generating` 会在部分入口被误标为 `failed/completed`；
- 分镜规划 job 没有稳定项目身份，刷新后无法可靠重建脚本/分镜；
- 已完成 Seedance 结果同时写入 `imageUrl` 和 `videoUrl`，造成结果数和存储统计重复；
- 付费 provider task 可伪造 `provider=internal` 绕过权限/积分；
- 非幂等 create/chat POST 遇到连接层模糊故障仍会自动重发；
- 任务提交去重的“先查再建”在并发请求下不是原子操作；
- 已提交 provider task 取消后释放了积分，随后恢复同一 task id 可以得到未结算结果；
- 视频 job 的零重试同时禁止了已有 task id 时安全的轮询/结果恢复；
- 即梦在拿到 `submitId` 后没有立即 checkpoint。

这些改动使用同一条付费安全原则：“提交”、“轮询”和“结果下载”必须是独立阶段。提交阶段宁可进入未知态也不自动重发；一旦有 task id，只允许对原任务做有界轮询/下载恢复。

## 路由设计

### Gemini 分镜视频

对我方 `/api/assets/file/` 视频执行以下路由：

1. `direct-first` 且已配置外网 HTTPS 基址：规范化为 `MEIAO_PUBLIC_BASE_URL + managed asset path`，直接交给 Gemini/KIE Chat。
2. `forceUpload=true` 或 `kie-only`：下载我方文件，上传到 KIE `openrouter-chat`，再交给 Gemini。
3. 非我方管理素材保留现有兼容规则，不扩大本次改动面。

转存缓存键必须包含上传目的地，例如 `openrouter-chat:<managed-path>`。不同 KIE 存储路由不得因共用同一素材 path 而错用 URL。进行中 Promise 和成功 URL 都可复用；失败、空 URL 和超时条目不复用。

### Seedance 参考图/视频

Seedance 已经使用管理素材 `direct-first`，正常路径不改。补齐一个安全回退：如果创建任务同步返回明确素材读取错误，且错误不含 `providerTaskId`，将我方参考素材转存 KIE 后仅再提交一次。

## 回退与重试安全性

必须同时满足以下条件才可转存回退：

- payload 含我方管理素材；
- 首次请求确实使用了直连 URL；
- 上游错误明确指向文件读取、下载、解析或 MIME 识别；
- 错误不含 `providerTaskId`；
- 本次调用尚未执行过媒体回退。

下列情况禁止转存后重新提交：

- 超时、连接中断、`fetch failed`、500/502 等无法证明未接单的模糊故障；
- 已存在 `providerTaskId`；
- 鉴权、余额、限额、内容审核、取消或普通模型失败；
- 同一任务已做过一次媒体回退。

视频生成 job 继续保持 `maxRetries=0`。拿到 provider task id 后只轮询或恢复该任务，不再执行创建 POST。部署、worker 重启或网络短断不得改变这个约束。

create/chat 类非幂等 POST 如果在未收到 HTTP 响应时发生连接中断，应记录为 `provider_submission_unknown`，不得请求级或 job 级自动重试。只读 GET/HEAD 和明确标记可重试的素材上传仍使用有界退避。

## 权限、积分与去重约束

- 服务端以 `taskType` 策略派生允许的 provider、视频权限、去重窗口和最大提交重试，不信任客户端的 `provider`。
- `kie_*` 付费任务不得使用 `provider=internal`；所有视频 task type 都执行视频功能权限和提交阶段零重试。
- MySQL 下相同语义付费任务的查重、积分预留和 job 创建必须由跨进程锁串行化；创建失败必须补偿释放预留。
- 排队中取消立即释放预留；已有 provider task id 的取消不释放，原 task id 恢复成功后按实际用量结算。
- 已释放或已结算的 reservation 在重新创建上游任务前必须重新预留；只轮询原 task id 时复用未处理 reservation。

## H.265 策略

本次生产 MP4 中可见 `hvc1`，说明视频是 H.265/HEVC。现有前端已显示编码警告，仓库中也存在一条未合入的自动转码实验分支，但当前生产证据只能证明 KIE 转存超时，不能证明 Gemini 无法直读 H.265。

因此：

1. 先上线直连修复；
2. 使用已有 H.265 素材执行一次可控的分镜分析烟测，不创建 Seedance 付费视频任务；
3. 只有当上游明确返回 codec/container 不支持，再单独评审 H.264 转码方案；
4. 不在本次修复中推测性合入 ffmpeg 及大文件转码，避免增加 CPU、内存、磁盘和等待时间风险。

## 可观测性与错误归类

为便于区分“我方上传”、“KIE 转存”、“provider 接单”和“provider 轮询”，保留并回归以下诊断字段：

- `providerStage`；
- `providerTaskId`；
- `providerSubmitted`；
- `providerMediaRoute` (`direct` / `kie-fallback`)；
- 原始 provider message 与对用户的可操作错误文案。

“素材上传到生成服务失败”只用于真正的 KIE 转存阶段。上游已接单、轮询超时、生成失败和编码不支持必须保持不同分类，避免误导用户反复压缩或重提。

## 验证标准

- Gemini 分镜对我方视频默认不调用 KIE file upload。
- 明确读媒体失败时，无任务号才会发生一次同模型 KIE 回退。
- 同一素材并发回退只执行一次相同目的地上传；不同上传目的地不共用错误 URL。
- Seedance 的明确读媒体失败可安全回退；任何带 task id 或模糊网络错误都不重提。
- 视频 job 无 job-level 自动重试，provider task id 恢复路径保持有效。
- 没有 provider task id 的模糊提交失败不自动重提；有 task id 时可按独立恢复预算轮询原任务。
- 伪造 provider 被服务端拒绝；并发相同付费提交只创建一条 job 和一笔预留。
- 排队取消会释放积分；已提交取消后恢复原 task id 仍能正确结算。
- 分镜 fallback 只在 Gemini 家族内进行，媒体解析不超过配置的并发上限。
- 前端重复点击和已有 backend/provider 身份的进行中任务不能再提交；`generating` 不得误标为终态。
- 分镜规划和 board job 能通过稳定项目身份在刷新后恢复或继续找回。
- provider、job runtime、Temporal、前端状态恢复、lint、build 和安全门禁全部通过。
- 云上发布必须先通过活跃任务排空检查；发布后验证 health、worker、公网素材和一次不创建付费视频的分镜烟测。

## 回滚

把 `MEIAO_KIE_MANAGED_ASSET_MODE` 设为 `kie-only` 并重启 worker，可恢复强制 KIE 转存的旧路由。回滚不改变“视频任务不自动重提”和“已有 provider task id 只恢复轮询”的计费安全规则。

## 本次不扩展的范围

- 不在无证据情况下上线视频自动转码。
- 不重写 KIE callback/polling 架构。
- 不改变视频模型、时长、积分和计费逻辑。
- 不用真实 Seedance 生成作为自动化验证，避免产生额外费用。

视频预留额度是产品计费策略，不在没有明确价格表/账户政策的情况下自动从 5 调高。本次只修复绕过、重复预留和取消/恢复结算错误。
