# 模特替换重复任务卡与虚拟模特图片体积治理设计

日期：2026-07-30

## 目标

1. 一次模特替换操作在项目列表中只出现一个真实项目卡。
2. 已经持久化的预分析幽灵卡在恢复项目数据时自动隐藏，不改写生产数据库。
3. 所有新进入虚拟模特库的图片统一经过服务端体积治理，包括管理员手动上传、生成参考图和 AI 生成的八姿态结果。
4. 压缩不得改变像素宽高或已有 DPI；不得为了命中目标体积而缩放图片或采用激进画质。

## 生产证据与根因

多桑账号的每次模特替换都只有一个 `kie_image` 生图任务和一个 provider task id；另一个卡片来自同次操作的 `kie_chat` 预分析任务。该预分析任务携带稳定语义：

- `subFeature: model_replace`
- `taskPurpose: model_replace_preflight`
- `preflightPart: reference`

现有 `isShellControlJob` 没有登记 `model_replace_preflight`，所以恢复逻辑把它映射成 `job-<analysisJobId>` 项目卡。现有的历史幽灵卡过滤器已经以同一个控制任务判定器工作；只要补齐该稳定 purpose，当前和历史幽灵卡都会在读取时消失。

不能按 `taskType=kie_chat` 全局过滤，因为部分聊天任务可能是用户可见结果；也不能仅在某个页面按卡片名称隐藏，因为那会把领域语义继续散落到 UI。

## 设计

### 1. 控制任务可见性

将 `model_replace_preflight` 加入共享的 `SHELL_CONTROL_JOB_PURPOSES`。不改变任务创建和付费链路，不删除数据库记录：

- 新快照映射时跳过该控制任务；
- 已持久化的 `job-<analysisJobId>` 空卡由现有 `filterLegacyShellControlJobGhosts` 自动剔除；
- 真实 `kie_image` 项目卡仍按 `shellProjectId` 正常恢复。

回归测试必须复现生产形状：一张真实项目卡、一张已持久化分析幽灵卡、一个预分析 job、一个生图 job，最终只保留真实项目卡。

### 2. 虚拟模特图片体积治理

新增独立服务端模块 `server/virtualModelImageCompression.mjs`，只作用于虚拟模特域，不影响其他业务图片。

入口覆盖：

- `/api/assets/upload` 与 `/api/assets/upload-stream` 中 module 为 `virtual_model` 或 `virtual_model_generation` 的上传；
- 虚拟模特生成服务把 AI 结果持久化为 `virtual_model/result` 之前。

策略：

- 默认目标体积为 3 MiB，由 `MEIAO_VIRTUAL_MODEL_IMAGE_TARGET_BYTES` 配置，允许 1–20 MiB；
- 小于等于目标的文件原样保存，不重复有损编码；
- 超过目标时只做编码优化，禁止调用 `resize`、`rotate`、`extract`；
- JPEG/WebP 从高画质开始逐档尝试，最低质量 82；PNG 先做无损优化，若为不透明照片且仍过大可转换为高质量 JPEG，有 alpha 时使用高质量 WebP 并保持 alpha；
- 每个候选都校验像素宽高与输入完全相同；输入有 density/DPI 时写回同一 density；
- 若保守质量下仍无法达到目标，保存最小且确实小于原图的候选；不会继续降画质或缩分辨率强行命中目标；
- 不支持或可能包含动画/多页的格式保持原文件，避免静态化或信息丢失。

持久化记录使用优化后的 MIME、扩展名、宽高和字节数。日志附带是否压缩、原始/落盘字节数、宽高及 DPI，便于云上核查。

### 3. 验收边界

自动化验收：

- 预分析任务被识别为控制任务；
- 生产形状的重复卡恢复回归；
- 小图保持字节完全一致；
- 大图输出像素尺寸和 DPI 完全一致；
- JPEG、透明图保守压缩后字节数下降；
- 手动上传和 AI 自动入库两个服务端入口都接入同一压缩器；
- 定向测试、`npm run verify`、`npm run doctor` 通过。

发布验收：

- Git 提交和远端分支一致；
- 云上 health/worker 正常，发布期间无活动计费任务；
- 生产运行文件哈希与本地提交一致；
- 多桑账号现有预分析幽灵卡在 API/项目快照中不再出现；
- 不创建新的真实计费任务做 smoke test。

