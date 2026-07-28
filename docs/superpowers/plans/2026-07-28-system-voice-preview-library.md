# System Voice Preview Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 一次生成 Gemini 3.1 Flash TTS 的全部 30 个系统音色试听，作为可部署静态资源随代码同步到本地与腾讯云，用户点击音色时直接播放且不再重复付费生成。

**Architecture:** 新增单一的系统试听库模块负责清单、文件格式、完整性校验和公共 URL 映射；一次性生成脚本复用现有 KIE TTS provider，并把 provider task id 只写入被忽略的本地台账以支持查询恢复。服务端把有效静态 URL加入公共配置，前端优先直接播放，只有资源缺失或播放失败才走现有账号试听 API。

**Tech Stack:** Node.js ESM、React 19、TypeScript、Vite public assets、Node test runner、KIE Gemini 3.1 Flash TTS。

**Design:** `docs/superpowers/specs/2026-07-28-system-voice-preview-library-design.md`

---

### Task 1: 建立系统试听库清单与完整性合同

**Files:**
- Create: `server/voiceoverPreviewLibrary.mjs`
- Test: `server/voiceoverPreviewLibrary.test.mjs`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：

- 清单版本、模型、语言与 `VOICEOVER_TTS_MODEL` / `cmn` 匹配。
- 清单音色必须和 `VOICEOVER_VOICES` 一一对应，拒绝缺失、重复和额外音色。
- `file` 只允许安全单层文件名，拒绝绝对路径和 `../`。
- 依据文件魔数和响应 Content-Type 识别 `audio/mpeg`、`audio/wav`、`audio/ogg`、`audio/webm`、`audio/mp4`，拒绝 HTML、JSON 和空响应。
- 文件存在且 `bytes`、`sha256`、`contentType` 匹配时生成 `/voiceover-previews/<file>`；任一校验失败时只丢弃该条并返回脱敏诊断。
- 写入清单和台账时使用同目录临时文件加 `rename` 原子替换。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
node --test server/voiceoverPreviewLibrary.test.mjs
```

Expected: 因模块不存在或导出缺失失败。

- [ ] **Step 3: 实现最小完整模块**

导出：

```js
export const VOICEOVER_PREVIEW_LIBRARY_VERSION = 1;
export const VOICEOVER_PREVIEW_LANGUAGE = 'cmn';
export const VOICEOVER_PREVIEW_SAMPLE_TEXT = '你好，这是一段口播音色试听。';
export function detectVoiceoverPreviewAudio(bytes, contentType) {}
export function validateVoiceoverPreviewManifest({ manifest, libraryDir }) {}
export function loadVoiceoverPreviewLibrary({ publicDir }) {}
export async function writeVoiceoverPreviewJsonAtomic(filePath, value) {}
export function createEmptyVoiceoverPreviewManifest() {}
```

验证函数不得把本机绝对路径、provider task id 或密钥放入公共结果；返回 `previewUrlsByVoice` 和可供日志使用的短错误码。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```bash
node --test server/voiceoverPreviewLibrary.test.mjs
```

- [ ] **Step 5: 提交**

```bash
git add server/voiceoverPreviewLibrary.mjs server/voiceoverPreviewLibrary.test.mjs
git commit -m "feat(voiceover): add deployable preview library contract"
```

### Task 2: 实现幂等、可恢复的全量生成器

**Files:**
- Create: `scripts/generate-voiceover-preview-library.mjs`
- Create: `scripts/generate-voiceover-preview-library.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/project-overview.md`

- [ ] **Step 1: 写失败测试**

使用依赖注入的假 provider、下载器和临时目录覆盖：

- 默认目标是全部 30 个音色，顺序来自 `VOICEOVER_VOICES`。
- 有效清单和文件直接跳过，不创建 provider 任务。
- 台账有 `providerTaskId` 时以原 task id 查询恢复，不再次创建。
- 没有 `MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM=1` 时，遇到待生成音色立即失败且 provider create 次数为 0。
- `onProviderTaskId` 必须先原子写入 `server/data/voiceover-preview-library-ledger.json`，再继续轮询。
- `provider_submission_unknown`、task id 持久化失败或下载校验失败时退出非零，不能自动重提。
- 每成功一个音色立即原子写入音频、清单和台账；重启可跳过已完成音色。
- 下载响应按真实音频格式决定 `.mp3/.wav/.ogg/.webm/.m4a`，清单字节数和 SHA-256 匹配。
- 最终校验必须覆盖 30 个音色，否则命令退出非零。
- 日志只显示音色、状态和进度，不显示 API key 或完整 provider 响应。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
node --test scripts/generate-voiceover-preview-library.test.mjs
```

- [ ] **Step 3: 实现生成器**

生成器入口：

```bash
MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM=1 npm run generate:voiceover-previews
```

实现约束：

- 使用 `loadServerEnvFile()` 合并 `.env.server` 和进程环境，进程环境优先。
- 通过 `runKieTtsJob()` 使用合规的 parent-owned payload；`parentJobId` 固定为版本化系统身份，`childKey/groupIndex` 与音色目录索引一致。
- 本次生成默认串行；`MEIAO_VOICE_PREVIEW_LIBRARY_CONCURRENCY` 允许 `1..2`，默认 1。
- provider 请求、轮询和下载超时继续使用已有 KIE TTS 环境变量；新增容量/并发变量同步写入 env 模板和部署文档。
- 台账固定在 `server/data/voiceover-preview-library-ledger.json`，继续由现有 `server/data/` ignore 规则保护。
- `package.json` 新增 `generate:voiceover-previews`。

- [ ] **Step 4: 运行测试和 dry-run**

Run:

```bash
node --test scripts/generate-voiceover-preview-library.test.mjs
npm run generate:voiceover-previews
```

Expected: 测试通过；无确认开关的 dry-run 在创建付费任务前安全退出，并报告剩余数量。

- [ ] **Step 5: 提交**

```bash
git add package.json .gitignore .env.server.example docs/tencent-cloud-deploy.md docs/project-overview.md scripts/generate-voiceover-preview-library.mjs scripts/generate-voiceover-preview-library.test.mjs
git commit -m "feat(voiceover): add resumable preview library generator"
```

### Task 3: 把有效预置 URL 加入公共配置

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/voiceoverContract.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `server/voiceoverContract.test.mjs`
- Modify: `src/types.ts`

- [ ] **Step 1: 写失败测试**

覆盖：

- `buildPublicSystemConfig()` 接收启动时校验过的 `voiceoverPreviewUrls`，只给对应音色增加 `previewUrl`。
- 没有预置资源时保持现有音色对象，不泄露文件路径、task id、token 或 API key。
- `server/index.mjs` 只在启动时加载一次 `public/voiceover-previews/manifest.json`，并把 URL 映射传给所有公共配置构造路径。
- 清单损坏不会导致服务启动失败，但会记录短错误码并让对应音色走兜底。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
node --test server/voiceoverContract.test.mjs server/jobRuntime.test.mjs
```

- [ ] **Step 3: 实现公共配置接入**

- `getVoiceoverPublicConfig(env, readiness, previewUrlsByVoice)` 复制音色目录并条件性增加 `previewUrl`。
- `SystemPublicConfig.voiceoverTranslation.voices` 增加 `previewUrl?: string`。
- `server/index.mjs` 使用仓库 `public` 目录加载共享库，进程启动日志只记录 ready/total 和错误码。
- 不改变 `/api/voiceover/voice-previews` 的认证和账号素材持久化合同。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```bash
node --test server/voiceoverContract.test.mjs server/jobRuntime.test.mjs server/voiceoverPreviewRoute.test.mjs
```

- [ ] **Step 5: 提交**

```bash
git add server/index.mjs server/jobRuntime.mjs server/voiceoverContract.mjs server/jobRuntime.test.mjs server/voiceoverContract.test.mjs src/types.ts
git commit -m "feat(voiceover): publish shared preview urls"
```

### Task 4: 前端直接播放预置音频并保留失败兜底

**Files:**
- Modify: `src/shell/components/VoiceoverTranslationWorkspace.tsx`
- Modify: `src/shell/components/VoiceoverTranslationWorkspace.test.mjs`

- [ ] **Step 1: 写失败测试**

源码与行为合同覆盖：

- `voices` 中有 `previewUrl` 时先写入内存 URL 映射并直接调用 `Audio.play()`。
- 成功播放预置 URL 的路径不能调用 `requestVoiceoverPreview()`。
- 静态资源触发 `error` 或 `play()` 拒绝时，只对该音色清除预置 URL 并调用账号试听 API 一次。
- 再次点击正在播放的音色会暂停；切换音色会停止上一段。
- 目标语言切换不清除与语言无关的系统音色 URL。
- 卸载时暂停音频、清理 `src` 和事件处理器。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
node --experimental-strip-types --test src/shell/components/VoiceoverTranslationWorkspace.test.mjs
```

- [ ] **Step 3: 实现直接播放**

- 初始化/同步 `previewUrlsRef` 为服务端提供的 `voiceName -> previewUrl`。
- 把播放动作拆为返回成功/失败的可测 helper，预置 URL 成功后立即结束。
- 仅在预置 URL 缺失或首次播放失败时进入现有 POST + poll 流程。
- 生成中提示只用于兜底生成路径；直接播放不得显示“正在生成真实音色试听”。

- [ ] **Step 4: 运行测试、类型和构建**

Run:

```bash
node --experimental-strip-types --test src/shell/components/VoiceoverTranslationWorkspace.test.mjs
npm run build
```

- [ ] **Step 5: 提交**

```bash
git add src/shell/components/VoiceoverTranslationWorkspace.tsx src/shell/components/VoiceoverTranslationWorkspace.test.mjs
git commit -m "fix(voiceover): play prebuilt voice previews immediately"
```

### Task 5: 生成并锁定全部 30 个真实音色资源

**Files:**
- Create: `public/voiceover-previews/manifest.json`
- Create: `public/voiceover-previews/*.{mp3,wav,ogg,webm,m4a}`

- [ ] **Step 1: 运行全量生成**

Run:

```bash
MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM=1 npm run generate:voiceover-previews
```

Expected:

- 只为没有有效文件和 provider task id 的音色创建新任务。
- 全部 30 个音色最终显示 ready。
- 若出现未知提交或 provider 失败，停止声明完成；使用台账中的原 task id 恢复，不手工重建。

- [ ] **Step 2: 运行完整性与构建校验**

Run:

```bash
node --test server/voiceoverPreviewLibrary.test.mjs scripts/generate-voiceover-preview-library.test.mjs
npm run build
```

再比较：

- `public/voiceover-previews/manifest.json` 有 30 条。
- `dist/voiceover-previews/manifest.json` 与 public 清单一致。
- public 与 dist 的所有音频 SHA-256 均与清单一致。

- [ ] **Step 3: 安全审查**

Run:

```bash
npm run security:audit
git grep -n -E 'providerTaskId|KIE_API_KEY|Bearer ' -- public/voiceover-previews
```

Expected: 部署资源中没有 task id、密钥或认证头。

- [ ] **Step 4: 提交音频资源**

```bash
git add public/voiceover-previews
git commit -m "assets(voiceover): add prebuilt Gemini voice previews"
```

### Task 6: 本地浏览器、发布门禁和云上资源验收

**Files:**
- Modify if required by verified docs contract: `docs/release-and-handoff.md`

- [ ] **Step 1: 跑定向和全量验证**

Run:

```bash
node --test server/voiceoverPreviewLibrary.test.mjs scripts/generate-voiceover-preview-library.test.mjs server/voiceoverContract.test.mjs server/jobRuntime.test.mjs server/voiceoverPreviewRoute.test.mjs
node --experimental-strip-types --test src/shell/components/VoiceoverTranslationWorkspace.test.mjs src/services/voiceoverPreviewClient.test.mjs
npm run lint
npm test
npm run build
npm run doctor
```

- [ ] **Step 2: 本地真实 UI 验收**

在 `http://127.0.0.1:3000/?module=video` 登录态下：

- 打开「口播翻译」音色弹层。
- 连续试听至少 Zephyr、Puck、Kore、Sadaltager、Sulafat。
- 确认点击即播放、不显示生成提示。
- 检查网络请求只有 `/voiceover-previews/<file>` GET，且为 200；没有 `/api/voiceover/voice-previews` POST。
- 关闭弹层或切换功能后音频停止。

- [ ] **Step 3: 发布前代码审查**

审查本任务全部提交和最终 diff，重点核对：

- 没有混入工作树中既有的图片对比查看器改动。
- 没有用户数据、密钥、provider task id 或本地绝对路径。
- 清单与音频完整一致。
- `server/data` 排除与云端保留规则不变。

- [ ] **Step 4: 发布并验收云上静态资源**

仅在当前任务仍包含腾讯云发布授权时执行：

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

逐个验证 30 个公网 URL：

- HTTP 200。
- Content-Type 为清单音频类型。
- 字节数和 SHA-256 与本地清单一致。
- 正式域名浏览器点击试听不产生 POST 生成请求。

- [ ] **Step 5: 推送与交付证据**

推送当前发布分支，记录：

- 本地 HEAD。
- GitHub 远端分支 HEAD。
- 腾讯云 release id 和运行目录（若本次发布）。
- 30/30 静态资源校验结果。
- 自动化测试结果。
- 本地和云上 UI 验收结果分别陈述。

