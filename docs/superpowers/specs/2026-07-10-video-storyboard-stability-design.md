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
- provider、job runtime、Temporal、前端状态恢复、lint、build 和安全门禁全部通过。
- 云上发布必须先通过活跃任务排空检查；发布后验证 health、worker、公网素材和一次不创建付费视频的分镜烟测。

## 回滚

把 `MEIAO_KIE_MANAGED_ASSET_MODE` 设为 `kie-only` 并重启 worker，可恢复强制 KIE 转存的旧路由。回滚不改变“视频任务不自动重提”和“已有 provider task id 只恢复轮询”的计费安全规则。

## 本次不扩展的范围

- 不在无证据情况下上线视频自动转码。
- 不重写 KIE callback/polling 架构。
- 不改变视频模型、时长、积分和计费逻辑。
- 不用真实 Seedance 生成作为自动化验证，避免产生额外费用。
