# Image-2 中转 1K/2K 尺寸映射实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `image-2中转` 只支持 1K/2K，固定比例发送对应宽高，智能比例发送 `auto`，历史 4K 安全降为 2K。

**Architecture:** 以 `src/utils/maxforaiImageModels.mjs` 为比例和分辨率单一真相；界面通过共享模型能力生成分辨率选项，模型切换通过共享 helper 归一化历史 4K；Provider 边界再次归一化，防止旧页面或直接 API 绕过。其他图片模型不改变。

**Tech Stack:** Node.js ESM、TypeScript/React、Node test runner、标准 Images API、Temporal、腾讯云受保护发布脚本。

## Global Constraints

- 站内模型 ID 为 `maxforai-image-2-relay`，展示名为 `image-2中转`，上游模型为 `gpt-image-2`。
- 仅支持 `1K`、`2K`；不向上游发送该渠道的 4K 尺寸。
- 固定比例映射严格使用已确认规格表；智能比例始终发送 `size: "auto"`。
- 旧 4K 参数自动降为 2K；1K/2K 保持不变。
- 文生图 JSON、编辑 multipart、双响应格式、零自动重试和提交状态不确定保护保持不变。
- 其他图片模型的分辨率选择、比例映射和默认值保持不变。
- 真实付费验证若出现 `provider_submission_unknown`，立即停止剩余请求。

---

### Task 1: 收敛共享尺寸与能力契约

**Files:**
- Modify: `src/utils/maxforaiImageModels.test.mjs`
- Modify: `src/utils/maxforaiImageModels.mjs`
- Modify: `src/utils/modelCapabilities.test.mjs`
- Modify: `src/utils/modelCapabilities.mjs`
- Modify: `src/utils/modelQuality.ts`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `MAXFORAI_SUPPORTED_RESOLUTIONS = ['1K', '2K']`。
- Produces: `normalizeMaxForAiImageResolution(value, fallback?) -> '1K' | '2K'`，其中 4K 返回 2K，非法值抛错。
- Produces: `resolveMaxForAiImageSize(aspectRatio, resolution) -> 'auto' | 'WIDTHxHEIGHT'`。
- Produces: `getQualityForModelSwitch(model, currentQuality) -> GenerationQuality`，MaxForAI 下 4K→2K、1K/2K 保持，其他模型维持既有默认行为。

- [ ] **Step 1: 写共享契约失败测试**

更新 `maxforaiImageModels.test.mjs`，断言：

```js
assert.deepEqual(MAXFORAI_SUPPORTED_RESOLUTIONS, ['1K', '2K']);
assert.equal(normalizeMaxForAiImageResolution('1K'), '1K');
assert.equal(normalizeMaxForAiImageResolution('2k'), '2K');
assert.equal(normalizeMaxForAiImageResolution('4K'), '2K');
assert.equal(resolveMaxForAiImageSize('16:9', '1K'), '1536x864');
assert.equal(resolveMaxForAiImageSize('16:9', '2K'), '2048x1152');
assert.equal(resolveMaxForAiImageSize('16:9', '4K'), '2048x1152');
assert.equal(resolveMaxForAiImageSize('auto', '4K'), 'auto');
```

更新能力和运行时测试，要求 MaxForAI 只暴露 1K/2K、运行时默认仍为 1K；在 `modelCapabilities.test.mjs` 中读取 `modelQuality.ts`，锁定共享选项过滤和 `getQualityForModelSwitch` 导出。

- [ ] **Step 2: 运行失败测试确认 RED**

Run:

```bash
node --test src/utils/maxforaiImageModels.test.mjs src/utils/modelCapabilities.test.mjs server/jobRuntime.test.mjs
```

Expected: FAIL，因为当前仍公开 4K、能力目录没有 `supportedResolutions`、切换 helper 不存在。

- [ ] **Step 3: 最小实现共享契约**

在 `maxforaiImageModels.mjs` 中删除 4K 尺寸列，增加两档常量与归一化 helper；`resolveMaxForAiImageSize` 保留签名并对 4K 降到 2K。`modelCapabilities.mjs` 为 MaxForAI 返回 `supportedResolutions`。`modelQuality.ts` 按能力过滤 `QUALITY_OPTIONS` 并增加模型切换 helper。`jobRuntime.mjs` 和 `src/types.ts` 暴露 `supportedResolutions`。

- [ ] **Step 4: 运行测试确认 GREEN**

Run Step 2 command. Expected: PASS。

- [ ] **Step 5: 提交共享契约**

```bash
git add src/utils/maxforaiImageModels.mjs src/utils/maxforaiImageModels.test.mjs src/utils/modelCapabilities.mjs src/utils/modelCapabilities.test.mjs src/utils/modelQuality.ts server/jobRuntime.mjs server/jobRuntime.test.mjs src/types.ts
git commit -m "fix: constrain Image-2 relay resolutions"
```

### Task 2: 所有界面入口与 Provider 请求采用新契约

**Files:**
- Modify: `src/utils/imageModelAvailability.test.mjs`
- Modify: `src/shell/components/layout/BottomInputBar.test.mjs`
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: `src/components/SettingsSidebar.tsx`
- Modify: `src/modules/OneClick/ConfigSidebar.tsx`
- Modify: `src/modules/OneClick/SkuSidebar.tsx`
- Modify: `src/modules/Retouch/RetouchSidebar.tsx`
- Modify: `src/modules/BuyerShow/BuyerShowSidebar.tsx`
- Modify: `server/providerMaxForAiImage.test.mjs`

**Interfaces:**
- Consumes: `getQualityOptionsForModel(model)` 和 `getQualityForModelSwitch(model, currentQuality)`。
- Produces: 所有可见 MaxForAI selector 只显示 1K/2K；4K 切换到该模型时变为 2K。
- Produces: 文生图和编辑 Provider 对固定比例使用 1K/2K 映射，对智能比例使用 `auto`。

- [ ] **Step 1: 写界面和 Provider 失败测试**

新增 source assertions，要求五个独立侧栏和底部输入栏都调用共享切换 helper；底部输入栏通过 `getQualityOptionsForModel` 生成 `quality` 选项，不再把三档数组直接作为最终选项。更新 Provider fixtures：

```js
assert.equal(JSON.parse(calls[0][1].body).size, 'auto');
assert.equal(editForm.get('size'), '1536x2048');
assert.equal(buildMaxForAiImageRequestBody({
  payload: { model: 'maxforai-image-2-relay', aspectRatio: '3:4', resolution: '4K' },
  prompt: 'legacy',
}).size, '1536x2048');
```

- [ ] **Step 2: 运行失败测试确认 RED**

```bash
node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs
node --test src/utils/imageModelAvailability.test.mjs server/providerMaxForAiImage.test.mjs
```

Expected: FAIL，因为底部栏仍硬编码 1K/2K/4K，独立侧栏切换仍重置为 1K，Provider 旧测试仍期待 4K。

- [ ] **Step 3: 最小实现全部入口**

底部栏在 `getQuickParamsForModule` 返回前，根据当前模型把 `quality` 参数替换成共享选项；模型切换时同步写入 `getQualityForModelSwitch(value, currentParams.quality)`。五个独立侧栏把 `getDefaultQualityForModel(m)` 替换成共享切换 helper并传当前质量。Provider 不新增分支，只消费 Task 1 的共享映射。

- [ ] **Step 4: 运行定向测试确认 GREEN**

Run Step 2 commands and:

```bash
node --test server/maxforaiIntegration.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交界面与 Provider 契约**

```bash
git add src/shell/components/layout/BottomInputBar.tsx src/shell/components/layout/BottomInputBar.test.mjs src/components/SettingsSidebar.tsx src/modules/OneClick/ConfigSidebar.tsx src/modules/OneClick/SkuSidebar.tsx src/modules/Retouch/RetouchSidebar.tsx src/modules/BuyerShow/BuyerShowSidebar.tsx src/utils/imageModelAvailability.test.mjs server/providerMaxForAiImage.test.mjs
git commit -m "fix: align Image-2 relay selectors with provider"
```

### Task 3: 文档、根因沉淀与本地发布门禁

**Files:**
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `CLAUDE.md`
- Modify: `docs/agents/repeated-issues.md`
- Modify: `server/maxforaiEnvDocs.test.mjs`

**Interfaces:**
- Produces: 运行文档明确 1K/2K、4K 降级、auto 行为和实际像素归一化边界。
- Produces: 根因库 #61 和 repeated-issues 指针，记录“文档支持范围未经真实矩阵验证”的复发经验。

- [ ] **Step 1: 写文档失败断言**

在 `maxforaiEnvDocs.test.mjs` 中要求 overview、deploy doc 和 repeated issues 同时出现 `1K`、`2K`、`4K` 不支持/降级以及 `size: "auto"`。

- [ ] **Step 2: 运行测试确认 RED**

```bash
node --test server/maxforaiEnvDocs.test.mjs
```

Expected: FAIL，因为当前文档仍描述 1K/2K/4K 通用表。

- [ ] **Step 3: 更新文档与根因库**

补充：真实矩阵发现 4K 不受支持；1K/2K 固定比例只通过 size 约束；auto 不承诺实际宽高；验收必须读取实际图片尺寸。新增 #61，并在 repeated issues 写简明指针和回归命令。

- [ ] **Step 4: 运行定向与完整验证**

```bash
node --test src/utils/maxforaiImageModels.test.mjs src/utils/modelCapabilities.test.mjs src/utils/imageModelAvailability.test.mjs server/providerMaxForAiImage.test.mjs server/maxforaiIntegration.test.mjs server/jobRuntime.test.mjs server/maxforaiEnvDocs.test.mjs
node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs
npm run verify
git diff --check
```

Expected: 0 failures，lint 0 errors，build 成功。

- [ ] **Step 5: 代码审查与提交**

运行 Hermes changed-file review、检查完整 diff、secret scan，并提交：

```bash
git add CLAUDE.md docs/project-overview.md docs/tencent-cloud-deploy.md docs/agents/repeated-issues.md server/maxforaiEnvDocs.test.mjs docs/superpowers/plans/2026-07-14-maxforai-1k-2k-size-mapping.md
git commit -m "docs: record Image-2 relay size contract"
```

### Task 4: 推送、受保护发布与三张真实验收

**Files:**
- Verify only: all files changed since `53c363f`。
- Deploy: `/www/wwwroot/meiao-internal`。
- External record: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板`。

**Interfaces:**
- Produces: GitHub 备份分支、腾讯云运行版本、三张真实图片和诊断看板记录。

- [ ] **Step 1: 推送分支**

```bash
git status --short
git push origin feat/stability-phase2
```

- [ ] **Step 2: 受保护发布**

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

Expected: readiness/drain/security/build 门禁通过，PM2 online，worker healthy。

- [ ] **Step 3: 云上真实提交三张**

顺序提交：`auto/1K`、`16:9/1K`、`3:4/2K`。每张使用唯一 requestId，轮询单一 job 到终态；失败或不确定立即停止。

- [ ] **Step 4: 验证真实产物与链路**

对每张记录：job id、provider/model、payload ratio/resolution、attempt/retry、公开 URL、HTTP/MIME/字节数、真实宽高。额外在云上导入生产 helper，断言 outbound size 分别为 `auto`、`1536x864`、`1536x2048`。

- [ ] **Step 5: 更新诊断看板并最终复核**

使用 `npm run record-fix -- ...` 记录 fingerprint `maxforai:image_size:unsupported_4k_mapping`、最终 commit、测试、发布状态和真实 job 证据；运行看板测试与 doctor。最后复核公网 health、PM2、三条 job 和云上关键文件哈希。
