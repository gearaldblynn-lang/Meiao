# 小红书封面补强设计

**范围**

本次只补强未提交的 `XhsCover` 模块，不处理现有“小红书视频诊断”的测试失败。

**目标**

让“小红书封面”从演示版升级为可在现有梅奥云上工作流中稳定运行的模块，行为对齐现有生成模块，尤其是 `Retouch`、`OneClick/MainImage` 的任务恢复和资产持久化语义。

## 现状问题

1. 刷新后 `tasks` 被清空，已生成结果和可恢复任务全部丢失。
2. 已保存 `taskId`，但没有找回结果的自动恢复或手动恢复链路。
3. 批量风格生成直接 `Promise.all`，无视全局并发配置。
4. 文件预览在 render 中直接创建 object URL，存在资源泄漏。
5. Prompt 全局规则与部分风格要求冲突，降低出图稳定性。
6. 结果下载依赖远端直链，但没有先保证资产已持久化到现有云端资产体系。

## 设计方案

### 1. 状态与持久化

保留 `xhsCoverMemory.tasks`，不再在 `normalizeLoadedPersistedAppState` 中无条件清空。

刷新后的状态处理规则：

- `completed` 且有可复用远端结果 URL 的任务：直接保留。
- `generating` 且有 `taskId` 的任务：组件挂载后自动调用恢复逻辑。
- `error` 且满足 `isRecoverableKieTaskResult(taskId, error)` 的任务：组件挂载后自动调用恢复逻辑。
- `pending` 任务：保留但不自动执行，避免刷新后重复创建任务。
- `isGenerating` 在加载时重置为 `false`，由运行时根据实际恢复中的任务重新计算。

### 2. 云上任务逻辑

`XhsCover` 必须复用当前项目已有的云上 KIE 任务语义，不新增旁路流程。

具体要求：

- 新任务继续通过 `processWithKieAi` 创建，底层仍走现有 internal job / provider gateway。
- 已有 `taskId` 的任务通过 `recoverKieAiTask` 恢复，不自行轮询第三方。
- 最终结果如果是临时 blob URL 或非可持久复用资产，必须参考 `Retouch` 的做法，将图片抓取为 blob 后通过 `persistGeneratedAsset` 落到现有资产体系，再写回 `resultUrl`。
- 下载、刷新恢复、远端状态回填都以持久化后的 `resultUrl` 为准。

这保证本地和云上行为一致：创建任务、恢复任务、结果回填、日志记录都沿用现有系统逻辑。

### 3. 并发控制

新增小的执行器工具，按 `apiConfig.concurrency` 限制并发执行风格任务。

执行语义：

- 默认并发上限取 `Math.max(1, apiConfig.concurrency || 1)`。
- 用户选中 18 个风格时，不一次性并发 18 个请求。
- 单个任务成功或失败后再拉起下一个。
- 中断时统一 abort 所有在途任务，并停止继续调度后续任务。

### 4. 恢复与中断

模块挂载时扫描任务：

- `generating + taskId`
- `error + 可恢复 + taskId`

对以上任务自动恢复。

同时补一个手动“找回结果”按钮给 `error` 且 `taskId` 存在的任务，避免自动恢复失败后用户无路可走。

中断语义：

- 手动中断只取消当前在途任务和后续调度。
- 已成功完成的任务保留。
- 被中断任务状态标记为 `interrupted` 或 `error + 已手动中断`，但不能覆盖已完成结果。

### 5. Prompt 规则收敛

保留统一的主规则：

- 用户输入的标题/副标题是唯一主文案。
- 不允许模型擅自改写、翻译、扩写主标题。
- 不允许修改人物面部。

风格模板里和该规则冲突的内容要收敛为以下两类之一：

- 直接删除：例如强制英文主标题、强制拼音注释。
- 降级为可选装饰：例如期数标签、小型符号装饰，但不能替代主标题。

目标不是重写 18 套风格，而是消除硬冲突，让模型接收到一致指令。

### 6. 资源 URL 管理

上传预览改为使用项目现有 URL 管理工具，不在 render 中直接 `URL.createObjectURL(file)`。

要求：

- 生成预览 URL 时使用已有安全工具。
- 替换图片或组件卸载时释放旧 URL。

### 7. 测试

新增最小行为测试，优先测纯逻辑：

- `xhsCoverUtils.test.mjs`
  - 持久化状态恢复规则。
  - 并发执行器不会超过并发上限。
  - Prompt 构建会去除和主规则冲突的英文/拼音要求。

保留模块级手工验证：

- 上传图片、选择多种风格、生成。
- 刷新页面后已完成结果仍在。
- 生成中刷新后可自动恢复。
- 人工打断后不会继续调度。
- 下载的图片来自可复用远端资产 URL。

## 影响文件

- `modules/XhsCover/XhsCoverModule.tsx`
- `modules/XhsCover/XhsCoverSidebar.tsx`
- `modules/XhsCover/xhsCoverStyles.ts`
- `utils/appState.ts`
- `types.ts`
- 新增 `modules/XhsCover/xhsCoverUtils.mjs`
- 新增 `modules/XhsCover/xhsCoverUtils.test.mjs`

## 非目标

- 不新增“小红书”父级模块或多子功能导航。
- 不处理视频诊断测试失败。
- 不引入新的图片供应商或新的任务系统。
