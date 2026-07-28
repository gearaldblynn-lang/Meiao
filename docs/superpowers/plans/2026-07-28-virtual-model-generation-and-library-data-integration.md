# 虚拟模特八视角生成与 004/005 数据集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 2026-07-28 完整迁移包中的八视角生成能力和 004/005 两套已发布模特安全集成到 MEIAO 当前版本，同时保留当前权限、身份契约、全身替换和“左侧新建、无新建版本”的既有修复。

**Architecture:** 不执行迁移包的整树覆盖导入器。以当前发布分支为唯一代码基线，新增独立的 generation store/service/http API 和前端生成向导，并仅在现有 `server/index.mjs`、`src/services/internalApi.ts`、`VirtualModelLibraryModule.tsx` 做窄接线。数据通过幂等、可审计的导入脚本把包内同 ID 的 001–003 视为已存在，只新增 004/005、对应版本、40 个素材关系中缺少的 16 个关系及 32 个资源记录/文件；本地和 MySQL 分别验证。

**Tech Stack:** Node.js ESM、node:test、React 18、TypeScript、MySQL/JSON 双存储、现有内部素材服务、现有 KIE provider job 管线。

## Global Constraints

- 禁止直接执行包内 `03-一键导入工具/import-virtual-model-library.mjs` 覆盖当前源码。
- 禁止恢复右侧“新建版本”；已发布版本继续不可修改，新增模特只从左侧“新建”进入。
- 禁止测试阶段创建真实 provider 任务或产生积分消耗；所有生成任务使用依赖注入的内存桩验证。
- 禁止自动重试付费生成；用户点击重试才允许创建新任务。
- 001–003 必须按稳定 ID 幂等核对，不能覆盖当前已发布版本或权限修复。
- 004/005 必须以公开模特方式供所有有功能权限的用户读取；管理 API 仍仅管理员可用。
- 本地、Git、云上状态分别验收；云上发布前必须完成 `npm run verify`。

---

### Task 1: 生成批次领域层与持久化

**Files:**
- Create: `server/virtualModelPoseDefinitions.mjs`
- Create: `server/virtualModelGenerationStore.mjs`
- Create: `server/virtualModelGenerationService.mjs`
- Test: `server/virtualModelGenerationStore.test.mjs`
- Test: `server/virtualModelGenerationService.test.mjs`

**Interfaces:**
- Consumes: 现有 `internal_jobs` 提交/查询、内部素材永久化、`replaceDraftVersionAssets()`。
- Produces: `createVirtualModelGenerationBatch()`、`reconcileVirtualModelGenerationBatch()`、`retryVirtualModelGenerationPose()`、`regenerateVirtualModelDerivedPoses()`、`cancelVirtualModelGenerationBatch()`、`finalizeVirtualModelGenerationBatch()`；JSON/MySQL 统一 batch record CRUD。

- [ ] **Step 1: 先加入批次 store/service 测试**

测试必须覆盖：本地与 MySQL 归一化；用户隔离；C01/P01 两张基准先生成；基准图稳定化后才提交其余六张；失败不会自动创建新的付费任务；显式重试只创建一个新任务；完成时八槽位一次性写入草稿。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --test server/virtualModelGenerationStore.test.mjs server/virtualModelGenerationService.test.mjs
```

Expected: FAIL，原因是三个 production module 尚不存在。

- [ ] **Step 3: 实现最小领域层**

实现固定 pose：

```js
export const VIRTUAL_MODEL_BASELINE_POSE_IDS = Object.freeze(['C01', 'P01']);
export const VIRTUAL_MODEL_DERIVED_POSE_IDS = Object.freeze(['C02', 'C03', 'C04', 'C05', 'P05', 'P03']);
```

批次只允许 draft target；引用图必须属于当前用户且 module 为 `virtual_model_generation`；基准输出必须完成下载、解码校验、永久化并得到稳定 URL 后才能用于派生任务；`retry` 和 `regenerate-derived` 必须是显式 API 动作。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```bash
node --test server/virtualModelGenerationStore.test.mjs server/virtualModelGenerationService.test.mjs
```

Expected: 全部 PASS，且测试桩的 `createJob` 调用次数与断言一致。

- [ ] **Step 5: 提交领域层**

```bash
git add server/virtualModelPoseDefinitions.mjs server/virtualModelGenerationStore.mjs server/virtualModelGenerationService.mjs server/virtualModelGenerationStore.test.mjs server/virtualModelGenerationService.test.mjs
git commit -m "feat(virtual-model): add resumable pose generation domain"
```

### Task 2: 管理 API 与当前服务接线

**Files:**
- Create: `server/virtualModelGenerationHttpApi.mjs`
- Test: `server/virtualModelGenerationHttpApi.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/internalAssetStore.mjs`
- Modify: `server/internalAssetStore.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 generation service，现有管理员认证、素材上传和 provider job service。
- Produces: `POST/GET /api/admin/virtual-model-generation-batches`、detail、pose retry、derived regenerate、cancel、finalize。

- [ ] **Step 1: 加入 HTTP 路由和素材保留测试**

测试 401/403、用户隔离、七条 route 到 service method 的一一映射、错误码转换，以及活跃生成批次引用的 source asset 不被清理器删除。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --test server/virtualModelGenerationHttpApi.test.mjs server/internalAssetStore.test.mjs
```

Expected: generation API module 缺失或活跃资源保护断言失败。

- [ ] **Step 3: 接入当前 `server/index.mjs`**

MySQL 和 local handler 都先做现有用户认证，再构造同一 service adapter。`ensureMysqlSchema()` 调用 generation schema；`readLocalStore()` 调用 generation store normalize。适配器复用当前 job 创建和素材永久化函数，不复制 provider 逻辑。

- [ ] **Step 4: 运行服务端门禁**

Run:

```bash
node --test server/virtualModelGenerationHttpApi.test.mjs server/internalAssetStore.test.mjs
npm run test:server
```

Expected: 两个定向套件和完整 server suite 全部 PASS。

- [ ] **Step 5: 提交 API 接线**

```bash
git add server/virtualModelGenerationHttpApi.mjs server/virtualModelGenerationHttpApi.test.mjs server/index.mjs server/internalAssetStore.mjs server/internalAssetStore.test.mjs
git commit -m "feat(virtual-model): expose admin pose generation API"
```

### Task 3: 前端生成向导与当前模型库交互

**Files:**
- Create: `src/modules/VirtualModelLibrary/VirtualModelCreateDialog.tsx`
- Create: `src/modules/VirtualModelLibrary/VirtualModelReferenceUploadStep.tsx`
- Create: `src/modules/VirtualModelLibrary/VirtualModelPoseGenerationStep.tsx`
- Create: `src/modules/VirtualModelLibrary/virtualModelCodeSuggestion.mjs`
- Create: `src/modules/VirtualModelLibrary/virtualModelGenerationState.mjs`
- Test: corresponding `*.test.mjs`
- Modify: `src/services/internalApi.ts`
- Modify: `src/modules/VirtualModelLibrary/VirtualModelLibraryModule.tsx`
- Test: `src/modules/VirtualModelLibrary/VirtualModelLibraryModule.test.mjs`

**Interfaces:**
- Consumes: Task 2 API。
- Produces: 左侧“新建”打开资料填写，选择“自动生成素材”或“手动上传八张”；自动生成可关闭后恢复、轮询、逐图下载、显式重试和最终保存。

- [ ] **Step 1: 加入状态机、API 合同和 UI 回归测试**

测试必须锁定：建议编码从最大三位数字递增；不可 finalize 未完成批次；旧轮询响应不覆盖新状态；没有“新建版本”文本；已发布素材不可上传；新建入口只有左侧一个；手动上传和自动生成共用新建资料。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --test src/modules/VirtualModelLibrary/virtualModelCodeSuggestion.test.mjs src/modules/VirtualModelLibrary/virtualModelGenerationState.test.mjs src/modules/VirtualModelLibrary/VirtualModelCreateDialog.test.mjs src/modules/VirtualModelLibrary/VirtualModelLibraryModule.test.mjs
```

Expected: 新模块缺失或当前 UI 缺少生成向导。

- [ ] **Step 3: 实现生成向导并保留当前修复**

`VirtualModelLibraryModule` 继续使用 `managementStatus(model)` 和当前版本优先逻辑；发布模特的编辑和上传继续被阻止；不调用 `createVirtualModelVersion` 为已发布模型创建新版本。新建资料校验后只创建全新 model 和 v1 draft。

- [ ] **Step 4: 运行前端门禁**

Run:

```bash
node --test src/modules/VirtualModelLibrary/virtualModelCodeSuggestion.test.mjs src/modules/VirtualModelLibrary/virtualModelGenerationState.test.mjs src/modules/VirtualModelLibrary/VirtualModelCreateDialog.test.mjs src/modules/VirtualModelLibrary/VirtualModelLibraryModule.test.mjs
npm run test:frontend
npm run build
```

Expected: 定向测试、frontend suite、TypeScript/Vite build 全部 PASS。

- [ ] **Step 5: 提交前端**

```bash
git add src/services/internalApi.ts src/modules/VirtualModelLibrary
git commit -m "feat(virtual-model): add auto pose creation workflow"
```

### Task 4: 004/005 幂等数据导入

**Files:**
- Create: `scripts/import-virtual-model-library-data.mjs`
- Create: `scripts/import-virtual-model-library-data.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 包内 `library-data.json`、asset checksums 和 80 个文件。
- Produces: `--dry-run` 差异报告；`--local` 备份后幂等合并；`--mysql` transaction 合并；只增加缺失稳定 ID。

- [ ] **Step 1: 写冲突和幂等测试**

覆盖：001–003 同 ID 时跳过；活动 code 同名异 ID 时 fail closed；004/005 新增；第二次执行零变更；文件 checksum 不符时数据不写入；MySQL 在 transaction 中失败回滚。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --test scripts/import-virtual-model-library-data.test.mjs
```

Expected: importer 尚不存在。

- [ ] **Step 3: 实现 dry-run/local/mysql 三种模式**

默认必须是 `--dry-run`；本地写入前创建时间戳备份；MySQL 使用单事务 upsert 且同 ID 内容冲突仅报告、不覆盖；素材文件先校验再复制/上传。不得携带包中的 `127.0.0.1` public URL，必须按目标环境重新生成。

- [ ] **Step 4: 本地导入并验证**

Run:

```bash
node scripts/import-virtual-model-library-data.mjs --package "/Users/feiyanglin/Downloads/虚拟模特库完整迁移包_2026-07-28" --dry-run
node scripts/import-virtual-model-library-data.mjs --package "/Users/feiyanglin/Downloads/虚拟模特库完整迁移包_2026-07-28" --local --offline-confirmed --target-root "/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本" --public-base-url "http://127.0.0.1:3100"
node scripts/import-virtual-model-library-data.mjs --package "/Users/feiyanglin/Downloads/虚拟模特库完整迁移包_2026-07-28" --local --dry-run --target-root "/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本" --public-base-url "http://127.0.0.1:3100"
```

Expected: 停止本地服务并确认无 active jobs 后，第一次报告新增 2 models、2 versions、16 relations、32 registry/files；导入后第二次报告零变更；001–003 hash 保持不变。任何 dry-run 都不得创建 lock、目录、事务或执行 crash recovery。

- [ ] **Step 5: 提交导入工具，不提交运行数据**

```bash
git add scripts/import-virtual-model-library-data.mjs scripts/import-virtual-model-library-data.test.mjs package.json
git commit -m "feat(virtual-model): add safe library data importer"
```

### Task 5: 全量验证、Git 与云上发布

**Files:**
- Modify: `docs/agents/repeated-issues.md`
- Modify: `docs/diagnostics/records.json`

**Interfaces:**
- Consumes: Task 1–4 全部提交。
- Produces: 本地验证证据、Git 提交、云上代码与数据、公开账号 UI/素材链验收。

- [ ] **Step 1: 完成本地验证**

```bash
npm run doctor
npm run verify
git status --short
```

Expected: doctor/verify 全部通过，工作树只保留明确的诊断记录改动。

- [ ] **Step 2: 记录根因和防复发门禁**

记录“整包覆盖会回退 81 个现有文件”“包内 userId 不能直接成为公共读取边界”“导入默认 dry-run、同 ID 不覆盖、checksum 先行、MySQL transaction”。

- [ ] **Step 3: 提交并推送集成分支**

```bash
git add docs/agents/repeated-issues.md docs/diagnostics/records.json docs/superpowers/plans/2026-07-28-virtual-model-generation-and-library-data-integration.md
git commit -m "docs: record virtual model package integration gates"
git push origin hotfix/model-replace-public-current-20260728
```

- [ ] **Step 4: 按发布脚本部署代码后导入云上数据**

先部署代码和 schema，health/worker 通过后执行 MySQL dry-run；仅在 dry-run 显示 004/005 为新增且 001–003 无覆盖时执行 transaction 导入。素材上传后验证 Node 与公网 URL 的 200、媒体类型、字节数和 SHA-256。

- [ ] **Step 5: 云上功能验收**

管理员账号验证模型库显示 001–005、只有左侧“新建”、自动/手动两种路径可进入且不实际提交；普通同事账号验证模特替换可见 5 个已发布模特、详情与 8 张素材均可读取。最后比对云上代码 hash、Git 分支 HEAD 和发布 manifest。
