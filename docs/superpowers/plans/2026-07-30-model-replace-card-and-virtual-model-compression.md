# 模特替换重复任务卡与虚拟模特图片体积治理实施计划

> **执行说明：** 在既有干净发布 worktree 中由当前代理逐项执行；线程策略禁止子代理调度。每个行为改动先写失败测试，再写最小实现。

**目标：** 修复模特替换预分析任务生成幽灵卡的问题，并为所有新进入虚拟模特库的图片增加不改变像素尺寸与 DPI 的保守压缩。

**架构：** 重复卡通过共享控制任务语义修复，不修改生产数据。压缩通过独立服务端策略模块统一接入虚拟模特上传与生成结果持久化入口，其他业务域不受影响。

**技术栈：** TypeScript、Node.js ESM、Sharp、node:test、MySQL/COS/本地 asset store。

---

## 任务 1：锁住重复任务卡生产回归

**文件：**

- 修改：`src/adapters/shellJobVisibility.test.mjs`
- 修改：`src/adapters/shellDataAdapter.test.mjs`
- 修改：`src/adapters/shellJobVisibility.ts`

1. 添加 `model_replace_preflight` 控制任务识别测试。
2. 添加“真实项目 + 持久化幽灵卡 + 分析 job + 生图 job”的快照回归。
3. 运行两个测试并确认新断言先失败。
4. 仅把 `model_replace_preflight` 加入共享控制 purpose 集合。
5. 重跑测试并确认通过。

## 任务 2：定义虚拟模特压缩合同

**文件：**

- 新增：`server/virtualModelImageCompression.test.mjs`
- 新增：`server/virtualModelImageCompression.mjs`

1. 测试环境阈值的默认值、上下界。
2. 测试小图原样返回。
3. 测试大 JPEG 压缩后宽高、DPI 不变且字节下降。
4. 测试透明图压缩后宽高、DPI、alpha 不变且字节下降。
5. 测试无法在保守质量内命中目标时不缩放图片。
6. 先运行确认模块缺失或断言失败。
7. 实现最小保守压缩器并逐项转绿。

## 任务 3：接入所有虚拟模特入库入口

**文件：**

- 修改：`server/index.mjs`
- 修改：`server/managedImageUpload.test.mjs`
- 修改：`server/virtualModelGenerationHttpApi.test.mjs`

1. 添加源代码合同测试，要求 `virtual_model`、`virtual_model_generation` 上传和 AI 结果持久化均调用统一压缩器。
2. 运行确认新合同先失败。
3. 在 `persistUploadedAssetIfEnabled` 中仅为两个虚拟模特 module 优化 buffer/MIME/文件名/宽高。
4. 在 `persistGeneratedAsset` 中优化 AI 生成结果后再落库。
5. 为上传日志补充原始/落盘字节、压缩状态、尺寸、DPI。
6. 重跑合同测试与压缩器测试。

## 任务 4：配置、根因库和发布文档

**文件：**

- 修改：`.env.server.example`
- 修改：`docs/project-overview.md`
- 修改：`docs/tencent-cloud-deploy.md`
- 修改：`docs/agents/repeated-issues.md`
- 修改：`server/envDocumentationSource.test.mjs`

1. 文档化 `MEIAO_VIRTUAL_MODEL_IMAGE_TARGET_BYTES=3145728`。
2. 在根因库记录预分析 purpose 漏登记导致幽灵卡，以及虚拟模特图片必须在服务端入库边界治理。
3. 更新 env 文档合同测试并运行。

## 任务 5：验证、提交与云上发布

1. 运行所有新增/受影响的定向测试。
2. 运行 `npm run verify` 和 `npm run doctor`。
3. 审查完整 diff，确认未混入主工作区改动和密钥。
4. 按 bug 看板要求执行 `npm run record-fix`。
5. 提交并推送当前 hotfix 分支。
6. 确认云上活动计费任务为 0 后，使用标准发布脚本部署。
7. 验证公网/本机 health、Temporal worker、前端 chunk、运行文件哈希和受保护素材链。
8. 只读验证多桑账号现有幽灵卡不再由快照生成；不创建新的计费任务。

