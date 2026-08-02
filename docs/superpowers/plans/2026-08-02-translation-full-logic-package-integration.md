# 出海翻译完整逻辑包本地集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 2026-07-31 出海翻译完整逻辑包新增合同三方合入当前版本，并完成本地自动化与浏览器验证。

**Architecture:** 当前工作树保持为权威运行基线，包内设计和测试作为行为合同。新增逻辑放在独立纯函数模块中，现有 Shell 和策划服务只增加最小接线，不覆盖共享文件。

**Tech Stack:** React 19、TypeScript、Node.js ESM、Vite、`node:test`

## Global Constraints

- 不覆盖用户现有未提交改动。
- 不覆盖包内同名大型共享文件。
- 保留 RTCFE 和现有结构化映射锚点。
- 不修改 AI 直出、区域修改终态、素材鉴权、provider 恢复或计费合同。
- 初始实施阶段不提交、推送或部署；2026-08-02 本地验收完成后，用户已另行批准按标准门禁提交 Git、推送并发布腾讯云。

---

### Task 1: 目标市场、语言守卫和批次一致性

**Files:**
- Create: `src/modules/Translation/translationTargetMarket.mjs`
- Create: `src/modules/Translation/translationPlanningLanguage.mjs`
- Create: `src/modules/Translation/translationTargetMarket.test.mjs`
- Create: `src/modules/Translation/translationPlanningLanguage.test.mjs`

**Interfaces:**
- Produces: `resolveTranslationTargetMarket(targetLanguage)`
- Produces: `normalizeTranslationPlanningContent(content)`
- Produces: `reconcileTranslationPlanningBatchConsistency({ content, registry })`
- Produces: `runTranslationPlanningWithLanguageGuard({ targetLanguage, request })`

- [ ] **Step 1: 移植包内合同测试**

使用包内纯函数测试原样建立目标市场、结构化规范化、文字体系判断、一次纠错、积分累计和同批一致性合同。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --experimental-strip-types --test \
  src/modules/Translation/translationTargetMarket.test.mjs \
  src/modules/Translation/translationPlanningLanguage.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND`，因为两个生产模块尚不存在。

- [ ] **Step 3: 移植最小纯函数实现**

从包内已校验哈希的源码移植两个模块，不增加语言专用业务规则或依赖。

- [ ] **Step 4: 运行测试并确认 GREEN**

Expected: 纯函数测试全部通过，0 failures。

### Task 2: AI 优化策划与生图 Prompt

**Files:**
- Modify: `src/services/arkService.ts`
- Modify: `src/services/arkService.test.mjs`
- Modify: `src/modules/Translation/translationRetryUtils.mjs`
- Modify: `src/modules/Translation/translationRetryUtils.test.mjs`

**Interfaces:**
- Consumes: Task 1 的目标市场与语言守卫。
- Produces: `analyzeTranslationCopyForGeneration(...)` 的结构化、安全策划结果。
- Produces: `buildTranslationGenerationPrompt(...)` 的逐字照抄和视觉还原约束。

- [ ] **Step 1: 增加当前版本缺失的 Prompt 合同测试**

锁定目标市场、必要修改、无固定字符比例、RTCFE、数字事实保护、逐字照抄和视觉保护。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --experimental-strip-types --test \
  src/services/arkService.test.mjs \
  src/modules/Translation/translationRetryUtils.test.mjs
```

Expected: 新 Prompt 断言失败。

- [ ] **Step 3: 最小修改策划服务和 Prompt builder**

仅替换 `analyzeTranslationCopyForGeneration` 的 Prompt/守卫调用，并向 AI 优化生图 Prompt 添加包内视觉保护约束；AI 直出分支不改。

- [ ] **Step 4: 运行定向测试并确认 GREEN**

Expected: 两个测试文件全部通过。

### Task 3: 批次协调与项目命名

**Files:**
- Create: `src/modules/Translation/translationProjectPresentation.ts`
- Create: `src/modules/Translation/translationProjectPresentation.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/components/ProjectListView.tsx`
- Modify: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `reconcileTranslationPlanningBatchConsistency`。
- Produces: `formatTranslationProjectName(...)`
- Produces: `getNextTranslationProjectSequence(...)`
- Produces: `normalizeTranslationProjectNames(projects)`

- [ ] **Step 1: 增加项目命名和源码接线合同测试**

测试日期/子功能独立编号、显示层不变异、任务 fallback 排除、批次注册表位于 worker 外、策划结果在持久化前协调。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
node --experimental-strip-types --test \
  src/modules/Translation/translationProjectPresentation.test.mjs \
  src/components/uiArchitecture.test.mjs
```

Expected: 模块缺失和接线断言失败。

- [ ] **Step 3: 实现最小接线**

在提交时生成稳定项目名；每批创建共享 `Map`；AI 优化策划通过语言守卫后先协调完全相同原文，再写入文件结果；展示层规范化历史翻译项目名。

- [ ] **Step 4: 运行测试并确认 GREEN**

Expected: 项目命名和 UI 架构合同全部通过。

### Task 4: 当前版本回归与本地验收

**Files:**
- Verify only.

- [ ] **Step 1: 运行翻译与状态定向回归**

```bash
node --experimental-strip-types --test \
  src/modules/Translation/*.test.mjs \
  src/services/arkService.test.mjs \
  src/adapters/shellDataAdapter.test.mjs \
  src/adapters/shellPersistence.test.mjs \
  src/components/uiArchitecture.test.mjs
node --test server/appStateMerge.test.mjs server/imagePostProcess.test.mjs
```

- [ ] **Step 2: 运行项目门禁**

```bash
npm run verify
npm run build
npm run doctor
git diff --check
```

- [ ] **Step 3: 本地浏览器验证**

启动或复用 `npm run local`，在 `http://localhost:3000` 验证登录页/翻译工作区可渲染、控制台无新增错误、翻译项目命名和现有区域修改入口存在。

- [ ] **Step 4: 复核差异和交付边界**

确认只包含设计范围内文件；分别报告本地自动化、本地浏览器、真实 provider、Git 和云上状态。

### Task 5: Git 与腾讯云发布

**Files:**
- Verify and release only.

- [ ] **Step 1: 完成发布前审查**

核对功能包 manifest、全部行为合同、最终 diff、账号隔离、素材 URL、权限、日志和任务链路；排除不属于本次翻译集成的文件。

- [ ] **Step 2: 提交并推送**

只暂存本次翻译集成文件，提交到当前发布分支并推送 GitHub，确认本地与远端 commit 一致。

- [ ] **Step 3: 执行标准腾讯云部署**

等待活动任务归零后运行：

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

不得使用 active-job override。

- [ ] **Step 4: 云上验收**

核对公网和宿主机 health、worker、精确 release、COS、活动前端资源、关键源码 SHA-256、应用根目录 `0755`、`.env.server` `0600`、部署 marker/mutex 清理和真实浏览器页面；不触发付费 provider。
