# 视频去字幕子功能设计

**日期：** 2026-07-15  
**状态：** 已完成交互讨论，待用户审阅书面规格  
**目标环境：** 本地开发验证后发布至腾讯云 `/www/wwwroot/meiao-internal`

## 1. 目标

在「短视频生成」中增加独立的「去字幕」子功能。用户可以从已完成的视频结果卡一键带入原视频，也可以直接上传本地视频；框选需要去除字幕的矩形区域后提交后台任务。处理完成后创建独立任务卡，永久保存原片与处理结果，并提供播放优化后的对比观看。

## 2. 已确认的产品决策

- 采用独立子功能与后台耐久任务，不使用临时弹窗直接调用第三方接口。
- 「去字幕」同时支持：
  - 从已完成的短视频结果卡点击「去字幕」并自动带入视频。
  - 在去字幕页面直接上传本地视频。
- 默认选中画面底部约 30% 的字幕区域，用户可以拖动和缩放矩形。
- 去字幕结果创建独立任务卡，不覆盖或追加到原短视频任务卡。
- 结果卡保留原视频与处理后视频，并支持对比观看。
- 允许上线前消耗一次约 2–3 秒视频额度做真实接口冒烟。

## 3. 范围

### 3.1 本次包含

- 新增 `subtitle_removal` 视频子功能。
- 已完成视频结果卡的「去字幕」入口。
- 本地视频上传、媒体分析和必要时的 H.264 MP4 转码。
- 可拖动、缩放的去字幕矩形区域。
- 服务端调用第三方提交与进度查询接口。
- 第三方任务 ID 的即时 checkpoint、进程重启后的只查询恢复。
- 第三方临时结果视频转存至梅奥托管素材。
- 原片/处理结果同步对比播放器。
- 独立任务卡的刷新恢复、下载和删除。
- 功能开关、环境变量、健康状态、文档、自动化测试和云上发布验证。

### 3.2 本次不包含

- 自动识别多块不连续字幕区域。
- 同一个任务同时提交多个去字幕矩形。
- 修改或覆盖原视频文件。
- 第三方任务取消。接口文档没有取消端点；提交成功后不向用户提供会造成“梅奥已取消但第三方仍计费”的假取消。
- 把去字幕费用接入梅奥现有积分台账。第三方返回的 `leftSeconds` 和 `costRemove` 只作为 provider 信息保存，不修改站内积分。
- 对任意公网 URL 开放去字幕。输入必须是当前登录用户拥有的梅奥托管视频，避免 SSRF、越权读取和不稳定外链。

## 4. 用户流程

### 4.1 从视频结果卡进入

1. 用户打开已完成的视频生成项目卡。
2. 视频结果操作区显示「去字幕」。
3. 点击后切换到「短视频生成 → 去字幕」。
4. 原视频自动进入工作区，播放器加载元数据和首帧。
5. 默认矩形覆盖画面底部约 30%，用户可调整。
6. 用户点击「开始去字幕」。
7. 页面立即创建独立任务卡并显示排队、处理中、完成或失败状态。

### 4.2 本地上传进入

1. 用户进入「短视频生成 → 去字幕」。
2. 选择本地视频。
3. 系统自动分析容器、编码、时长和分辨率。
4. 视频已是可用的 H.264 MP4 时直接上传；否则提示并执行保留原画幅的 H.264 MP4 转码。
5. 视频时长必须大于 0 且不超过第三方开放上限 600 秒。
6. 上传完成后进入与任务卡带入相同的区域选择和提交流程。

### 4.3 结果查看

1. 成功任务在去字幕子功能中显示独立任务卡。
2. 卡片保存原视频、处理后视频、字幕区域、来源项目和后台任务身份。
3. 用户可打开对比播放器、下载处理结果或删除任务卡。
4. 删除继续使用项目墓碑与托管素材生命周期，不允许刷新后复活。

## 5. 前端设计

### 5.1 子功能与入口

- `MODULE_SUB_FEATURES[AppModuleObj.VIDEO]` 增加 `{ id: 'subtitle_removal', label: '去字幕' }`。
- `VideoModule` 在该子功能下渲染专用 `SubtitleRemovalWorkspace`，不复用短视频生成 prompt 输入框。
- `ProjectCard → ProjectListView → VideoModule → ShellMigratedApp` 增加明确的 `onRemoveVideoSubtitles(projectId, resultId)` 回调链。
- 入口只对 `status=completed` 且存在 `videoUrl` 的视频结果显示。
- 点击入口时只写入去字幕草稿，不修改原项目和原结果。

### 5.2 区域选择

- 工作区以视频实际显示区域为坐标基准，矩形内部使用归一化坐标保存：`x`、`y`、`width`、`height` 范围均为 `0..1`。
- 默认值为 `{ x: 0, y: 0.70, width: 1, height: 0.30 }`。
- 四边和四角均可缩放，矩形整体可拖动。
- 最小区域为视频宽、高各自的 2%，区域不能越过视频画面。
- UI 实时显示按视频原始分辨率换算后的 `x1, y1, x2, y2` 像素值。
- 响应式尺寸变化只重算显示比例，不改变归一化区域。
- 提交时服务端使用权威分辨率再次换算和夹紧坐标；前端像素值不是安全边界。

### 5.3 上传与转码

- 上传只接受视频文件，最大输入字节数继续受 `MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES` 保护。
- 复用现有媒体 session、FFprobe、FFmpeg 与托管素材上传能力，但新增 `subtitle_removal` 转码 profile，不能复用 Seedance 的 2–15 秒和画幅填充规则。
- `subtitle_removal` profile：
  - 最大时长 600 秒。
  - 输出 H.264、`yuv420p`、AAC、MP4、`faststart`。
  - 保留原始画幅，不添加黑边。
  - 宽高为奇数时只缩放到最近的偶数尺寸。
  - 已兼容的 H.264 MP4 不做无意义转码。
- 转码和上传都显示真实进度；用户关闭草稿时清理未完成临时 session。

### 5.4 独立任务卡

- 新项目使用 `module='video'`、`subFeature='subtitle_removal'`。
- 新结果至少保存：
  - `backendJobId`
  - `sourceUrl`
  - `videoUrl`
  - `mediaType='video'`
  - `subtitleRegionNormalized`
  - `subtitleRegionPixels`
  - `sourceProjectId` / `sourceResultId`（任务卡跳转时）
  - `providerTaskId`
  - `status` / `error` / `errorDetail`
- 任务恢复以 durable job 为单一真相；`shellProjects` 与视频历史状态桶的读取边界必须有回归测试，不能再次出现“后台成功但视频页读不到”。

## 6. 播放优化与对比观看

### 6.1 统一控制

- 原片和结果片不显示两套相互竞争的原生控制条。
- 使用一套统一控制：播放/暂停、进度、当前时间、总时长、倍速、音量、全屏。
- 播放、暂停、seek 和倍速变化同步作用于两条视频。
- 结果视频为主时钟；原片在时间差超过 120ms 时校准，避免每帧强制 seek 造成抖动。
- 原片默认静音，结果视频负责音频输出，避免双重回声。

### 6.2 响应式对比

- 桌面端并排展示原片和去字幕结果，两个画面保持各自完整比例。
- 窄屏使用「原片 / 去字幕后」切换视图，但共享同一播放时间和控制状态。
- 切换视图不从头播放，不重建任务状态。

### 6.3 网络与资源策略

- 初始 `preload='metadata'`，加载元数据和首帧，不自动下载两条完整视频。
- 用户点击播放后才把当前需要播放的视频提升为主动缓冲。
- 复用现有视频 Range、最小缓冲秒数和缓冲超时配置。
- 显示明确的加载和缓冲状态，不把网络等待表现成播放器卡死。
- 页面隐藏、工作区卸载、对比弹层关闭时立即暂停两条视频并释放事件监听器。
- 同一页面同一时刻只允许一个对比播放器处于播放状态。
- 某一侧暂时缓冲不足时暂停统一时钟，待两侧可播放后继续，避免越播越不同步。

## 7. 服务端架构

### 7.1 配置

- `GOLDEN_SUBTITLE_API_TOKEN`：第三方服务端令牌，只存在于 `.env.server`。
- `MEIAO_SUBTITLE_REMOVAL_ENABLED`：新提交功能开关，生产默认关闭；关闭时历史任务和结果仍可读。
- `MEIAO_SUBTITLE_REMOVAL_BASE_URL`：默认 `https://goodline.simplemokey.com/api/openAi`。
- `MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS`：默认 5000ms，限制 2000–30000ms。
- `MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS`：默认 1800000ms，限制 300000–7200000ms。
- 所有新增配置同步写入 `.env.server.example`、`docs/tencent-cloud-deploy.md` 与 `docs/project-overview.md`。
- 健康接口只返回 enabled/configured 状态，不返回令牌或实际敏感配置。

### 7.2 Provider 边界

- 新建独立 `server/providerSubtitleRemoval.mjs`，只负责：
  - 输入校验和字段归一化。
  - 提交 `aiRemoveSubtitleSubmitTask`。
  - 查询 `aiRemoveSubtitleProgress`。
  - 状态归一化和 provider 错误转换。
- 新任务类型：`subtitle_remove_video`。
- 新 provider：`golden_subtitle`。
- 任务继承现有 `videoGeneration` 账号权限。
- 第三方令牌通过 `authorization` 请求头发送，不写入 payload、结果、错误详情或日志。

### 7.3 权威输入准备

- 任务 payload 只保存当前用户拥有的梅奥托管视频 URL、归一化区域和来源身份。
- Provider 调用前重新校验素材所有权，并解析为短期 provider 可读 URL。
- 服务端使用 FFprobe 获取权威 `duration`、`width`、`height` 和 `sizeBytes`。
- 校验规则：视频轨存在、时长 `0 < duration <= 600`、宽高和字节数均为正数。
- `fileSize` 以 MiB 计算并保留两位小数；`duration` 向上取整为秒，避免低报。
- `resolution` 为 `${width}x${height}`。
- `videoName` 使用安全任务前缀和权威像素区域：`<safeId>_<x1>_<y1>_<x2>_<y2>`。
- `coverUrl` 为空，首版不发送未实现的 `notifyUrl`。

### 7.4 提交与恢复状态机

```text
queued
  -> preparing_input
  -> submitting (只允许一次)
  -> provider_task_checkpointed
  -> waiting | doing
  -> success -> persist_result -> succeeded
                    \-> failed
  -> submission_unknown | failed
```

- 第三方提交属于可能计费的 POST，业务重试和 Temporal activity 尝试次数均为 1。
- 收到 `data.taskId` 后立即通过现有 `onProviderTaskId` checkpoint 写入 durable job，再进入轮询。
- 只要 job 已有 `providerTaskId`，后续执行只能调用进度查询，禁止再次提交。
- `subtitle_remove_video` 注册为“有旧 ID 才可恢复”的任务类型；服务重启或 worker 丢失后，submitted-running reconciler 只允许把带 `providerTaskId` 的任务重新排入查询，providerless 任务不得自动重提。
- 服务重启、worker 重放或手动恢复都只能查询旧 ID。
- 如果提交连接中断且无法确认服务端是否接单，返回 `provider_submission_unknown`，不自动重提。
- 接口没有取消能力：拿到 `providerTaskId` 后不显示“中断”按钮；部署排空或 worker 重启依靠旧 ID 恢复轮询。

### 7.5 第三方状态映射

- 提交响应 `code=0` 且有 `data.taskId`：提交成功。
- `code=-25`：`provider_balance_insufficient`，用户文案为“去字幕服务余额不足，请联系管理员充值”。
- 其他非零 code：`provider_bad_response` 或对应明确错误，保留脱敏 provider message。
- 进度 `waiting`：等待处理。
- 进度 `doing`：正在处理。
- 进度 `success` 且有 `resultUrl`：进入结果转存。
- 进度 `failed`：任务失败，使用 `emsg` 生成可读错误。
- 未知状态不当作成功；在总超时内继续有限查询，超时后标记 `provider_timeout`，保留旧 task ID 供管理员核对。

### 7.6 结果转存

- 第三方 `resultUrl` 约 24 小时有效，收到成功后必须在 job 标记成功前调用现有 `persistRemoteAsset` 转存。
- 最终 `videoUrl` 只能写梅奥托管素材 URL。
- `providerSourceUrl` 仅存在于素材记录的受控字段，不暴露到前端任务卡。
- 转存失败时 job 不得标记 succeeded；保留 `providerTaskId` 和 provider success 状态，后续只重新下载旧结果，不重新提交处理任务。

## 8. 持久化与删除

- 结果项目使用现有 `shellProjects` 持久化与 job hydration。
- Provider job payload 带 `taskPurpose='subtitle_removal'`、`shellProjectId`、`shellProjectName`、`subFeature='subtitle_removal'` 和稳定 `clientSubmissionKey`。
- 稳定提交键至少包含用户、源素材身份、归一化区域和子功能；同一活动任务重复点击复用旧 job。
- 删除项目时收集项目、结果和任务中的全部 backend job ID，并写 `deletedProjectIds` 墓碑。
- 原视频属于其它项目时不随去字幕任务卡删除；本地上传且只被本项目引用的源素材仍由素材清理队列按引用判断处理。
- 删除任务卡不声称取消第三方已提交任务。

## 9. 错误与用户提示

- 未配置或功能关闭：`去字幕功能暂未开放，请联系管理员。`
- 视频超过 600 秒：`单个视频最长支持 600 秒，请先裁剪后再提交。`
- 区域无效：`请选择需要去除字幕的画面区域。`
- 余额不足：`去字幕服务余额不足，请联系管理员充值。`
- 提交状态未知：`暂时无法确认服务是否接单，已停止自动重提，避免重复扣费。`
- 处理中：区分“正在准备视频”“已提交，等待处理”“正在去除字幕”“正在保存结果”。
- 结果保存失败：说明第三方已处理完成，但梅奥保存结果失败；允许管理员或安全恢复流程仅重抓旧结果。
- 技术日志记录 job ID、provider task ID、阶段、状态、耗时和脱敏错误；不记录 token、完整授权头、签名 URL query 或请求体。

## 10. 测试策略

### 10.1 纯逻辑与前端行为

- 默认底部 30% 区域。
- 拖动、八向缩放、最小区域和越界夹紧。
- 归一化坐标与横竖屏像素坐标双向换算。
- 任务卡入口只对完成视频显示，并正确带入 source project/result。
- 本地上传兼容视频跳过转码，不兼容视频使用 `subtitle_removal` profile。
- 结果项目独立归属 `subtitle_removal`，刷新后仍可见。
- 对比播放器同步 play/pause/seek/rate，原片静音，漂移超过 120ms 才校准。
- 窄屏切换保持播放时间，卸载后暂停并清理监听器。

### 10.2 Provider 契约

- 提交 body 精确包含 biz、fileSize、duration、resolution、videoName、coverUrl 和 url。
- authorization 头存在，但测试与日志从不输出真实 token。
- `code=0` 保存 task ID；缺 task ID 失败。
- `code=-25` 映射余额不足。
- waiting/doing/success/failed/未知状态映射正确。
- 已有 providerTaskId 时只查询，不提交。
- submit 网络中断不自动重提。
- success 缺 resultUrl 不得标记成功。

### 10.3 Job、素材与恢复

- provider task ID 在轮询前 checkpoint。
- `golden_subtitle` 使用单次 Temporal activity 提交策略。
- submitted-running 恢复只重排带 provider task ID 的任务；providerless 任务保持提交状态未知且不重提。
- 服务重放使用旧 provider task ID 查询。
- 成功结果在 job succeeded 前转存为梅奥托管视频。
- 结果下载失败只重抓旧 URL，不重新提交去字幕。
- durable job 恢复出独立项目卡，旧快照不能覆盖掉成功结果。
- 删除写墓碑且不会删除仍由原项目引用的原视频。
- 功能关闭只禁止新提交，不隐藏历史结果。

### 10.4 验证命令与云上验收

- 定向 Node 测试覆盖 provider、job policy、Temporal、素材转存、adapter、任务卡和播放器。
- `npm run lint`
- `npm run build`
- `npm run verify`
- `npm audit --audit-level=high --omit=dev`
- 云上先以 `MEIAO_SUBTITLE_REMOVAL_ENABLED=0` 发布并验证 health、PM2、worker pollers、前端入口和令牌不泄露。
- 配置服务端令牌后，用 2–3 秒 H.264 MP4 做一次真实 canary：提交一次、确认 task ID checkpoint、轮询成功、结果转存、对比播放和下载。
- canary 完成并清理测试项目后，再将功能开关设为 `1`。
- 发布过程中尊重现有任务排空门禁，不使用 active-job override。

## 11. 发布与回滚

- 发布前完成本次 diff 的代码审查，重点检查权限、任务单次提交、素材所有权、令牌泄露、结果转存和状态恢复。
- 部署使用 `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`。
- 回滚优先将 `MEIAO_SUBTITLE_REMOVAL_ENABLED=0`，立即禁止新提交但保留历史结果。
- 代码回滚不删除已存在的任务、provider task ID 或托管结果。
- 云上验收必须交叉核对公网 health、PM2、worker 1/1、任务 stage、provider task ID、托管视频可读和前端构建资源。

## 12. 成功标准

- 用户可以从视频结果卡一键进入去字幕，也可以直接上传本地视频。
- 默认字幕区合理且能稳定拖动、缩放，横竖屏坐标正确。
- 任一第三方去字幕任务最多提交一次；刷新和重启不会重复计费。
- 第三方成功结果在临时链接失效前转存为梅奥稳定素材。
- 独立任务卡刷新后可恢复，原项目不被覆盖或污染。
- 原片与结果可以流畅、同步、单路音频地对比观看。
- 令牌不出现在前端、Git、任务 payload 或日志。
- 本地完整验证与云上 2–3 秒真实 canary 均通过后才启用入口。
