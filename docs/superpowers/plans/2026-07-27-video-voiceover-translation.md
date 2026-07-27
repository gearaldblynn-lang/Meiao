# Video Voiceover Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「短视频」中交付独立的「口播翻译」子功能：把当前用户拥有的单人口播视频自动识别、翻译并改用 Gemini 3.1 Flash TTS 口播，同时保留背景音乐、环境音和音效，并可选复用 Golden 去文案。

**Architecture:** 浏览器只负责单视频准备、目标语言/翻译模式/音色/去文案区域配置和 durable job 提交。服务端以 `voiceover_translate_video` 内部父任务编排受托管资产保护的流水线：可选 Golden 去文案、本地 Demucs `mdx` 分离、Gemini 严格 JSON 分析与翻译、按输入预算分组的 KIE TTS 子任务、FFmpeg 对齐/ducking/混音和最终资产持久化。父任务以版本化 checkpoint 恢复；每个付费子任务单独保存 `providerTaskId`，已有 ID 时只能查询。

**Tech Stack:** React 19、TypeScript 5.9、Node.js ESM、Node test runner、MySQL/本地 JSON job ledger、Temporal、FFmpeg/FFprobe、Python 3 独立虚拟环境、Demucs `mdx`、现有 Gemini 视频分析链、KIE Gemini 3.1 Flash TTS、Golden 去字幕链和 MEIAO managed asset store。

## Global Constraints

- 以 `docs/superpowers/specs/2026-07-27-video-voiceover-translation-design.md` 为批准合同；实现发现冲突时先停下并修订规格，不得静默改变产品决策。
- 本计划只授权本地当前版本实现、测试和本地验收。不得推送 GitHub、安装腾讯云生产模型、修改生产环境变量或部署腾讯云。
- `voiceover_translate_video` 只接受当前用户拥有的 managed video identity。浏览器传入的 URL、时长、尺寸、编码和音轨信息都不是权威值。
- 首版仅支持单视频、单说话人；不做音色克隆、嘴型同步、画面重生成、多说话人分配、译文编辑和目标语言字幕生成。
- Demucs 固定使用官方非量化 `mdx`、CPU、`--two-stems=vocals`；运行时不得联网下载 Python 包或模型，子进程必须使用参数数组而不是 shell 字符串。
- Demucs 默认全局单并发。Python、模型或 FFmpeg filter readiness 不通过时，必须在 Gemini、Golden 或 KIE 的付费 POST 前拒绝新任务。
- Gemini 同步分析在调用前持久化 `speech_analysis_submitting`。进程若在提交与成功 checkpoint 之间中断，失败码必须是 `voiceover_analysis_submission_unknown`，不得自动重提。
- Golden 与每个 KIE TTS 组都使用父任务派生的稳定子任务键。已有 `providerTaskId` 只能查询；创建请求结果不明时使用 `provider_submission_unknown` 并停止自动恢复。
- TTS 模型目录固定声明输入上限 `8192`。没有产品级固定视频秒数上限；开启去文案时额外应用 Golden `600` 秒上限。
- TTS 对齐只允许 `atempo` 范围 `0.75..1.35`；越界返回 `voiceover_timing_out_of_range`，不得为修正时长静默创建第二个收费任务。
- 父任务必须经过现有账号积分预留门禁。`voiceover_translate_video` 使用既有 video job 的 5 积分预留估值；这是 MEIAO 内部风控额度，不在 UI 中冒充 provider 报价。终态继续按现有 provider usage/预留结算规则处理。
- 最终输出必须是 MEIAO 托管的 H.264/AAC MP4、`faststart`、可 Range 读取；provider 临时 URL 和本地路径不能进入前端、checkpoint 或持久日志。
- 原始提取音频、vocals、no-vocals 和 TTS 组音频使用 `intermediate` 资产类型、父 job 关联和默认 72 小时 TTL。活动或可恢复任务的引用必须阻止提前清理。
- 所有阈值、并发和超时来自环境变量并有保守默认与上下界；非法配置回退到默认值，密钥和绝对路径不进入 public config。
- 修改 job 生命周期、重试、provider 提交或资产清理代码前后运行该任务指定的 Hermes Harness。每次提交前查看 `git status --short`，只暂存当前任务文件。
- 真实 provider 验收只创建完成闭环所需的最少任务；已有 task ID 时只恢复查询。自动测试/provider 成功不替代真实浏览器、视频画面和音频听感验收。

---

## Contract Sources

- Gemini TTS behavior, languages, and preset voices: `https://ai.google.dev/gemini-api/docs/speech-generation`
- Gemini 3.1 Flash TTS token contract: `https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview`
- Official Demucs source and `--two-stems=vocals`: `https://github.com/facebookresearch/demucs`
- Official Demucs remote inventory: `https://raw.githubusercontent.com/facebookresearch/demucs/main/demucs/remote/files.txt`
- Official v4.0.1 `mdx` ensemble config: `https://raw.githubusercontent.com/facebookresearch/demucs/v4.0.1/demucs/remote/mdx.yaml`
- KIE create/query body and response contract: the user-supplied API document attached to the approved design conversation; all required fields are copied into Task 6 so implementation does not depend on an unavailable browser session.

---

## File Structure

### New shared and client files

- `src/utils/voiceoverCatalog.mjs`: 版本化语言/音色目录、常用语言排序和确定性自动音色映射。
- `src/utils/voiceoverCatalog.test.mjs`: 目录完整性、稳定顺序、30 音色白名单和自动匹配回归。
- `src/services/voiceoverTranslationClient.ts`: 稳定提交键、父任务请求、类型安全的 retry request。
- `src/services/voiceoverTranslationClient.test.mjs`: payload、去文案区域、重复提交和 retry 安全测试。
- `src/shell/components/VoiceoverTranslationWorkspace.tsx`: 单视频准备、配置、确认和 composer portal。
- `src/shell/components/VoiceoverTranslationWorkspace.test.mjs`: 工作区结构、单视频、配置和提交流程守卫。
- `src/shell/components/VoiceoverResultPlayer.tsx`: 原片/译制片切换、原文/译文详情和下载。
- `src/shell/components/VoiceoverResultPlayer.test.mjs`: 托管 URL、播放器切换和结果元数据守卫。
- `src/adapters/voiceoverTranslationHydration.test.mjs`: 刷新/重启后的项目卡、阶段、错误和结果恢复。

### New server and runtime files

- `server/voiceoverContract.mjs`: env 归一化、父 payload、checkpoint、分析/翻译分段和错误合同。
- `server/voiceoverContract.test.mjs`: 边界、未知字段、大小预算、错误码和 public-safe config 测试。
- `server/voiceoverAnalysis.mjs`: RTCFE 分析 prompt、vocal-only 分析素材请求和严格 JSON 解析。
- `server/voiceoverAnalysis.test.mjs`: prompt 锚点、单/多人、语言、时间轴和提交未知测试。
- `server/providerKieTts.mjs`: KIE TTS 创建/查询、状态映射、task ID checkpoint 和结果 URL 解析。
- `server/providerKieTts.test.mjs`: exact-once、HTTP 分类、轮询、结果转存边界和取消测试。
- `server/voiceoverSeparation.mjs`: Demucs readiness、全局信号量、进程组、输出校验和临时目录清理。
- `server/voiceoverSeparation.test.mjs`: 参数、哈希、并发、超时、取消、注入防护和输出测试。
- `server/voiceoverAudio.mjs`: WAV 提取、vocal-only 视频、分组对齐、ducking、混音、mux 和 probe。
- `server/voiceoverAudio.test.mjs`: FFmpeg 参数、atempo、时间放置、滤镜、编解码和时长测试。
- `server/voiceoverChildJobStore.mjs`: 父任务持有的 Golden/KIE 子任务 ledger 和稳定查找。
- `server/voiceoverChildJobStore.test.mjs`: 本地/MySQL 子任务创建、checkpoint、恢复和 worker 隔离测试。
- `server/voiceoverTranslationRunner.mjs`: checkpoint 驱动的父编排器和阶段恢复。
- `server/voiceoverTranslationRunner.test.mjs`: 每个故障切点、付费幂等、取消和最终结果测试。

### New deployment and probe files

- `deploy/voiceover/requirements.in`: 人工维护的顶层 Python 依赖。
- `deploy/voiceover/requirements.lock`: 带版本与 hashes 的可复现 CPU 运行依赖。
- `deploy/voiceover/demucs-models.json`: `mdx` 四个权重的官方 URL、字节数和 SHA-256。
- `deploy/voiceover/mdx.yaml`: 与模型 manifest 同版本的官方 ensemble 配置。
- `scripts/install-voiceover-demucs.mjs`: 显式安装/校验命令；应用启动与 job 执行不调用它。
- `scripts/install-voiceover-demucs.test.mjs`: dry-run、哈希失败、重复安装和路径安全测试。
- `scripts/probe-voiceover-translation.mjs`: readiness、fixture dry-run 和显式 live canary。
- `scripts/probe-voiceover-translation.test.mjs`: 默认不计费、已有 task ID query-only 和输出脱敏测试。

### Existing files to modify

- `src/types.ts`, `src/shell/types.ts`: 口播 payload、checkpoint、结果和 public config 类型。
- `src/services/mediaTranscodeClient.ts`, `server/mediaTranscodeContract.mjs`, `server/mediaTranscodeService.mjs`: `voiceover_translation` profile。
- `server/mediaTranscodeSessionStore.mjs`, `server/mediaTranscodeApi.mjs`: profile 持久化与输入音轨验证。
- `server/assetStore.mjs`: 流式 `persistAssetFile`、`content_hash` 和可控 intermediate TTL。
- `server/localJobStore.mjs`, `server/jobManager.mjs`, `server/temporalWorker.mjs`: running checkpoint callback、父持有子任务隔离和重试保留。
- `server/temporal/workflows.mjs`: 内部父任务单 activity attempt；付费重提由 checkpoint 禁止。
- `server/jobSubmissionPolicy.mjs`: 父任务权限/provider/零重试和内部子任务创建边界。
- `server/accountCredits.mjs`: 让内部复合父任务使用既有 video job 积分预留，而不是因 `provider='internal'` 绕过预算门禁。
- `server/jobRuntime.mjs`: 非敏感 feature/readiness/catalog/limit public config。
- `server/providerGateway.mjs`: 只增加 `kie_tts` 的恢复分派；复合父任务不进入通用 provider gateway。
- `server/index.mjs`: application-job dispatcher、依赖注入、checkpoint、managed audio/video persistence、health 和 API wiring。
- `src/ShellMigratedApp.tsx`, `src/shell/modules/Video/VideoModule.tsx`: 子功能、工作区 slot、提交、已有结果带入和普通输入框排除。
- `src/shell/components/ProjectCard.tsx`, `src/shell/components/ProjectListView.tsx`: 入口按钮、独立卡片、取消/重试和结果播放器。
- `src/adapters/shellDataAdapter.ts`, `src/utils/shellProjectScope.mjs`: job hydration、标签、项目范围和排序。
- `src/components/uiArchitecture.test.mjs`: 路由、slot、输入框排除、自然滚动和回调链结构门禁。
- `.env.server.example`, `docs/project-overview.md`, `docs/tencent-cloud-deploy.md`, `项目交接上下文.md`, `docs/release-and-handoff.md`, `docs/prompt-rtcfe-migration-map.md`: 配置、安装、运行、prompt 与发布边界。
- `package.json`: 新增 `probe:voiceover-translation`，不新增 Node 主进程 Python 依赖。

---

### Task 1: Versioned Catalog, Shared Types, and Server Contract

**Files:**

- Create: `src/utils/voiceoverCatalog.mjs`
- Create: `src/utils/voiceoverCatalog.test.mjs`
- Create: `server/voiceoverContract.mjs`
- Create: `server/voiceoverContract.test.mjs`
- Modify: `src/types.ts`
- Modify: `src/shell/types.ts`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`

**Interfaces:**

- Export `VOICEOVER_TTS_MODEL`, `VOICEOVER_MODEL_MAX_INPUT_TOKENS`, `VOICEOVER_LANGUAGES`, `VOICEOVER_VOICES`, `getVoiceoverLanguage(code)`, `getVoiceoverVoice(name)`, `listVoiceoverLanguages()`, and `selectAutomaticVoice(profile)`.
- Export `VOICEOVER_CHECKPOINT_VERSION`, `VOICEOVER_MAX_TTS_GROUPS`, `getVoiceoverConfig(env)`, `getVoiceoverPublicConfig(env, readiness)`, `normalizeVoiceoverPayload(input)`, `normalizeVoiceoverCheckpoint(value)`, `mergeVoiceoverCheckpoint(current, patch)`, `validateVoiceoverAnalysis(value, options)`, and `buildVoiceoverError(code, message, details)`.
- Add TypeScript contracts `VoiceoverVoiceProfile`, `VoiceoverTranscriptSegment`, `VoiceoverTranslationSegment`, `VoiceoverTranslationPayload`, `VoiceoverCheckpointV1`, and `VoiceoverTranslationResult`.
- Public config shape is exactly `{ enabled, ready, model, languages, voices, limits, readiness }`; `readiness` contains booleans and concurrency only.
- Public `limits` includes non-sensitive `maxTargetTextBytesPerSecond` and `ttsGroupLimit` values derived from the normalized config and shared group constant.

- [ ] **Step 1: Add failing catalog tests**

```js
test('catalog pins the current model contract', () => {
  assert.equal(VOICEOVER_TTS_MODEL, 'google/gemini-3-1-flash-tts');
  assert.equal(VOICEOVER_MODEL_MAX_INPUT_TOKENS, 8192);
  assert.equal(VOICEOVER_VOICES.length, 30);
  assert.equal(new Set(VOICEOVER_VOICES.map((voice) => voice.name)).size, 30);
  assert.deepEqual(
    VOICEOVER_LANGUAGES.filter((language) => language.common).map((language) => language.code),
    ['cmn', 'en', 'ja', 'ko', 'es', 'pt', 'fr', 'de', 'ar', 'ru'],
  );
});

test('automatic voice mapping is deterministic and returns a supported voice', () => {
  const profile = {
    pitch: 'high',
    brightness: 'bright',
    energy: 'energetic',
    pace: 'fast',
    accentDescription: 'clear Mandarin',
  };
  assert.equal(selectAutomaticVoice(profile), selectAutomaticVoice(profile));
  assert.ok(getVoiceoverVoice(selectAutomaticVoice(profile)));
});
```

Populate the catalog with the exact Appendix A and Appendix B entries. Every object is frozen; codes and names are stable identifiers, not translated display strings.

- [ ] **Step 2: Run catalog tests and confirm RED**

Run: `node --test src/utils/voiceoverCatalog.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `voiceoverCatalog.mjs`.

- [ ] **Step 3: Implement the frozen catalog and deterministic matcher**

Use a fixed trait score. Map `pitch`, `brightness`, `energy`, and `pace` to integer tags; add one point for each exact tag match, preserve Appendix B order as the tie-breaker, and never inspect demographic attributes. `accentDescription` may only select between equally scored voices by stable normalized keyword tags (`clear`, `soft`, `warm`, `bright`, `casual`, `firm`); otherwise it contributes zero.

- [ ] **Step 4: Run catalog tests and confirm GREEN**

Run: `node --test src/utils/voiceoverCatalog.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Add failing env, payload, checkpoint, and public-config tests**

```js
test('invalid capacity values fall back to conservative defaults', () => {
  const config = getVoiceoverConfig({
    MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1',
    MEIAO_VOICEOVER_SEPARATION_CONCURRENCY: '99',
    MEIAO_VOICEOVER_MIN_ATEMPO: 'oops',
    MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS: '9000',
    MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND: '513',
  });
  assert.equal(config.separationConcurrency, 1);
  assert.equal(config.minAtempo, 0.75);
  assert.equal(config.ttsMaxInputTokens, 8192);
  assert.equal(config.maxTargetTextBytesPerSecond, 96);
});

test('checkpoint rejects local paths, signed urls, unknown fields, and oversized text', () => {
  assert.throws(
    () => normalizeVoiceoverCheckpoint({
      version: 1,
      stage: 'voice_separated',
      baseVideoAssetId: 'asset-base',
      localPath: '/tmp/secret.wav',
    }),
    (error) => error.code === 'voiceover_checkpoint_invalid',
  );
});

test('public config cannot leak local paths or credentials', () => {
  const config = getVoiceoverPublicConfig(enabledEnv(), {
    pythonReady: true,
    modelReady: true,
    ffmpegReady: true,
  });
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /SEPARATION_PYTHON|MODEL_DIR|apiKey|token|\\/Users\\//);
});
```

Also cover:

- `targetLanguage` and manual `voiceName` membership.
- `removeText=true` requiring a clamped normalized rectangle.
- `sourceAssetId` or managed `sourceUrl` identity, but never an arbitrary `http(s)` URL.
- checkpoint stage monotonicity and allowed fields per stage.
- at most 200 segments, 20,000 UTF-8 bytes per source/target transcript field, the shared `VOICEOVER_MAX_TTS_GROUPS=100`, and 256 KB serialized checkpoint.
- all error codes in design section 12.

- [ ] **Step 6: Run contract tests and confirm RED**

Run: `node --test server/voiceoverContract.test.mjs server/jobRuntime.test.mjs`

Expected: FAIL because `voiceoverContract.mjs` and the `voiceoverTranslation` public config do not exist.

- [ ] **Step 7: Implement exact configuration and TypeScript contracts**

Use these defaults and bounds:

```js
export const VOICEOVER_DEFAULTS = Object.freeze({
  enabled: false,
  demucsModel: 'mdx',
  separationConcurrency: 1,
  separationTimeoutMs: 3_600_000,
  minAtempo: 0.75,
  maxAtempo: 1.35,
  ttsMaxInputTokens: 8192,
  groupGapMs: 800,
  overlapToleranceMs: 150,
  maxTargetTextBytesPerSecond: 96,
  duckingDb: 4,
  fadeMs: 40,
  durationToleranceMs: 100,
  intermediateTtlMs: 259_200_000,
  kieBaseUrl: 'https://api.kie.ai',
  kieModel: 'google/gemini-3-1-flash-tts',
});

export const VOICEOVER_BOUNDS = Object.freeze({
  separationConcurrency: [1, 2],
  separationTimeoutMs: [300_000, 7_200_000],
  minAtempo: [0.5, 1],
  maxAtempo: [1, 2],
  ttsMaxInputTokens: [1, 8192],
  groupGapMs: [0, 3000],
  overlapToleranceMs: [0, 1000],
  maxTargetTextBytesPerSecond: [16, 512],
  duckingDb: [0, 12],
  fadeMs: [0, 200],
  durationToleranceMs: [20, 500],
  intermediateTtlMs: [3_600_000, 2_592_000_000],
});
```

`VoiceoverCheckpointV1` follows the approved spec exactly and adds only bounded operational fields:

```ts
type VoiceoverTtsGroupCheckpoint = {
  index: number;
  attempt: number;
  childJobId: string;
  providerTaskId?: string;
  assetId?: string;
  status: 'queued' | 'submitted' | 'succeeded' | 'failed';
  startMs: number;
  endMs: number;
  actualDurationMs?: number;
  atempo?: number;
};
```

`subtitleRemoval` checkpoint 同样增加 `attempt: number` 和 `status: 'queued' | 'submitted' | 'succeeded' | 'failed'`。初始 attempt 为 `0`；自动恢复不得增加 attempt。

Checkpoint top level adds `analysisAttempt: number`, initially `0`. `mergeVoiceoverCheckpoint` keeps stages monotonic during worker execution. A separate server-only `prepareVoiceoverRetryCheckpoint(checkpoint, retryPlan)` is the only function allowed to rewind `speech_analysis_submitting` to `voice_separated`; it increments `analysisAttempt`, retains the managed stem asset IDs, and is callable only after the user confirms a possibly chargeable new analysis attempt.

`buildPublicSystemConfig` publishes the complete frozen catalogs but only these readiness keys:

```js
readiness: {
  pythonReady: Boolean(readiness.pythonReady),
  modelReady: Boolean(readiness.modelReady),
  ffmpegReady: Boolean(readiness.ffmpegReady),
  separationConcurrency: config.separationConcurrency,
}
```

- [ ] **Step 8: Run Task 1 tests, harness, and commit**

Run:

```bash
node --test src/utils/voiceoverCatalog.test.mjs server/voiceoverContract.test.mjs server/jobRuntime.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed src/utils/voiceoverCatalog.mjs --changed server/voiceoverContract.mjs --changed server/jobRuntime.mjs --changed src/types.ts --changed src/shell/types.ts
git diff --check
```

Expected: tests PASS, harness has no blocking finding, and diff check is clean.

Commit:

```bash
git add src/utils/voiceoverCatalog.mjs src/utils/voiceoverCatalog.test.mjs server/voiceoverContract.mjs server/voiceoverContract.test.mjs src/types.ts src/shell/types.ts server/jobRuntime.mjs server/jobRuntime.test.mjs
git commit -m "feat(video): define voiceover translation contract"
```

### Task 2: Voiceover Media Profile and Owned Source Preparation

**Files:**

- Modify: `server/mediaTranscodeContract.mjs`
- Modify: `server/mediaTranscodeContract.test.mjs`
- Modify: `server/mediaTranscodeSessionStore.mjs`
- Modify: `server/mediaTranscodeSessionStore.test.mjs`
- Modify: `server/mediaTranscodeApi.mjs`
- Modify: `server/mediaTranscodeApi.test.mjs`
- Modify: `server/mediaTranscodeService.mjs`
- Modify: `server/mediaTranscodeService.test.mjs`
- Modify: `src/services/mediaTranscodeClient.ts`
- Modify: `src/services/mediaTranscodeClient.test.mjs`
- Modify: `src/shell/mediaTranscodeIntegration.test.mjs`

**Interfaces:**

- Extend `MediaTranscodeProfile` and `MEDIA_TRANSCODE_PROFILES` with `'voiceover_translation'`.
- `validateMediaTranscodeSource` requires one video track and one audio track for this profile.
- `buildVideoTranscodeArgs` preserves source aspect ratio, maps video/audio, emits H.264 `yuv420p` + AAC MP4 + `faststart`, and does not enforce Seedance's 15-second limit.
- Compatible H.264/yuv420p/AAC MP4 sources use the existing no-op managed upload path.

- [ ] **Step 1: Add failing profile tests**

```js
test('voiceover profile has no artificial duration cap and requires audio', () => {
  assert.deepEqual(validateTrimRange({
    profile: 'voiceover_translation',
    durationSeconds: 1800,
    startSeconds: 0,
    endSeconds: 1800,
  }), { startSeconds: 0, endSeconds: 1800, durationSeconds: 1800 });
  assert.throws(
    () => validateMediaTranscodeSource({
      profile: 'voiceover_translation',
      kind: 'video',
      hasVideo: true,
      hasAudio: false,
    }),
    (error) => error.code === 'media_audio_track_required',
  );
});

test('voiceover transcode keeps aspect ratio and produces compatible mp4', () => {
  const args = buildVideoTranscodeArgs({
    profile: 'voiceover_translation',
    inputPath: '/tmp/input.mov',
    outputPath: '/tmp/output.mp4',
    startSeconds: 0,
    endSeconds: 120,
    width: 1080,
    height: 1920,
    hasAudio: true,
  });
  assert.ok(args.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1'));
  assert.deepEqual(args.slice(-8), [
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    '/tmp/output.mp4',
  ].slice(-8));
});
```

Add API/session tests that persist the new profile, reject audio-less video before upload completion, preserve byte limits, and return server-probed duration/dimensions.

- [ ] **Step 2: Run media tests and confirm RED**

Run:

```bash
node --test server/mediaTranscodeContract.test.mjs server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeApi.test.mjs server/mediaTranscodeService.test.mjs src/services/mediaTranscodeClient.test.mjs src/shell/mediaTranscodeIntegration.test.mjs
```

Expected: FAIL because `voiceover_translation` is unsupported.

- [ ] **Step 3: Implement profile-aware validation and transcode**

For `voiceover_translation`, use:

```js
[
  '-hide_banner', '-loglevel', 'error', '-y',
  '-ss', ffmpegSeconds(startSeconds),
  '-i', inputPath,
  '-t', ffmpegSeconds(duration),
  '-map', '0:v:0',
  '-map', '0:a:0',
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-movflags', '+faststart',
  outputPath,
]
```

Do not route this profile through `MEDIA_LIMITS.video.maxSeconds`. If `removeText=true`, the later parent contract separately checks `durationSeconds <= 600`.

- [ ] **Step 4: Run media tests and confirm GREEN**

Run the Step 2 command.

Expected: all tests PASS.

- [ ] **Step 5: Run a local FFmpeg fixture integration**

Generate a 3-second portrait H.264/AAC fixture using the existing test helper, submit it through `voiceover_translation`, and assert:

```js
assert.equal(probe.videoCodec, 'h264');
assert.equal(probe.pixelFormat, 'yuv420p');
assert.equal(probe.audioCodec, 'aac');
assert.equal(probe.width / probe.height, 1080 / 1920);
```

Run: `node --test server/mediaTranscodeService.test.mjs src/shell/mediaTranscodeIntegration.test.mjs`

Expected: PASS without network calls.

- [ ] **Step 6: Run harness and commit**

Run:

```bash
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/mediaTranscodeContract.mjs --changed server/mediaTranscodeService.mjs --changed src/services/mediaTranscodeClient.ts
git diff --check
```

Commit:

```bash
git add server/mediaTranscodeContract.mjs server/mediaTranscodeContract.test.mjs server/mediaTranscodeSessionStore.mjs server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeApi.mjs server/mediaTranscodeApi.test.mjs server/mediaTranscodeService.mjs server/mediaTranscodeService.test.mjs src/services/mediaTranscodeClient.ts src/services/mediaTranscodeClient.test.mjs src/shell/mediaTranscodeIntegration.test.mjs
git commit -m "feat(video): prepare voiceover translation media"
```

### Task 3: Streamed Intermediate Asset Persistence and Retention

**Files:**

- Modify: `server/assetStore.mjs`
- Modify: `server/assetStore.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/jobRuntime.test.mjs`

**Interfaces:**

- Add `persistAssetFile({ pool, publicBaseUrl, userId, module, assetType, originalName, mimeType, sourcePath, provider, providerSourceUrl, jobId, expiresAt, expectedSha256 })`.
- Extend `stored_assets` with nullable `content_hash CHAR(64)` and map it as `contentHash`.
- `persistAssetBuffer` and `persistAssetFile` accept a trusted server-only `expiresAt`; client API payloads cannot supply it.
- `persistJobOutputAssetsIfEnabled` handles `result.audioUrl` as managed `audio/mpeg` or probed audio, as well as existing `videoUrl`/`fileUrl`.

- [ ] **Step 1: Add failing streamed persistence tests**

```js
test('persistAssetFile streams a file, verifies sha256, and records explicit ttl', async () => {
  const expiresAt = 1_700_000_000_000 + 259_200_000;
  const persisted = await persistAssetFile({
    pool: null,
    publicBaseUrl: 'http://127.0.0.1:3001',
    userId: 'user-1',
    module: 'video',
    assetType: 'intermediate',
    originalName: 'vocals.wav',
    mimeType: 'audio/wav',
    sourcePath: fixture.path,
    jobId: 'parent-1',
    expiresAt,
    expectedSha256: fixture.sha256,
  });
  assert.equal(persisted.contentHash, fixture.sha256);
  assert.equal(persisted.expiresAt, expiresAt);
  assert.equal(persisted.jobId, 'parent-1');
});

test('hash mismatch deletes the copied target and creates no asset record', async () => {
  await assert.rejects(
    persistAssetFile({ ...fixtureInput(), expectedSha256: '0'.repeat(64) }),
    (error) => error.code === 'managed_asset_hash_mismatch',
  );
  assert.equal(readLocalAssets().length, 0);
});
```

Also test:

- copy/stream errors leave no row or partial file.
- `assetType='intermediate'` fits the 20-character DB column.
- checkpoint references protect an intermediate asset from cleanup.
- an expired unreferenced intermediate is deleted.
- final `module='video', assetType='result'` remains governed by existing result retention, not intermediate TTL.
- public config and upload routes ignore/reject client `expiresAt`.

- [ ] **Step 2: Run asset tests and confirm RED**

Run: `node --test server/assetStore.test.mjs server/jobRuntime.test.mjs`

Expected: FAIL because `persistAssetFile` and `contentHash` do not exist.

- [ ] **Step 3: Implement streamed copy, schema migration, and explicit expiry**

Use `pipeline(createReadStream(sourcePath), createWriteStream(fullPath, { flags: 'wx' }))` and a streaming `createHash('sha256')`. Insert the row only after copy, byte count, and expected hash succeed. On any failure, unlink only the generated destination path.

Add idempotent schema migration:

```sql
ALTER TABLE stored_assets
ADD COLUMN content_hash CHAR(64) NULL AFTER file_size
```

`expiresAt` is normalized server-side:

```js
const normalizedExpiresAt = Number.isFinite(Number(expiresAt)) && Number(expiresAt) >= 0
  ? Number(expiresAt)
  : getAssetExpiresAt({ module, createdAt });
```

- [ ] **Step 4: Add failing managed-audio output tests**

Create a provider result `{ audioUrl: 'https://provider.example/group-0.mp3' }`, inject a fake remote downloader, and assert `persistJobOutputAssetsIfEnabled` returns a MEIAO managed URL and `assetId` before the job succeeds. Assert retrying the persistence step downloads from the same provider URL but does not create another TTS job.

- [ ] **Step 5: Implement managed audio persistence**

Extend the remote-field table to:

```js
[
  ['videoUrl', 'video', `${job.taskType || 'result'}.mp4`],
  ['audioUrl', 'intermediate', `${job.taskType || 'result'}.mp3`],
  ['fileUrl', 'result', `${job.taskType || 'result'}.bin`],
]
```

For `kie_tts`, set `jobId` to the parent job ID from `payload.parentJobId`, use `MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS`, and preserve the original provider URL only in server-local persistence context, not in the final job result.

- [ ] **Step 6: Run Task 3 tests, harness, and commit**

Run:

```bash
node --test server/assetStore.test.mjs server/jobRuntime.test.mjs server/jobManager.test.mjs server/localJobStore.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/assetStore.mjs --changed server/index.mjs
git diff --check
```

Expected: PASS; harness reports no blocking cleanup or ownership violation.

Commit:

```bash
git add server/assetStore.mjs server/assetStore.test.mjs server/index.mjs server/jobRuntime.test.mjs
git commit -m "feat(assets): persist voiceover intermediates safely"
```

### Task 4: Reproducible Demucs Installation, Readiness, and Separation Runner

**Files:**

- Create: `deploy/voiceover/requirements.in`
- Create: `deploy/voiceover/requirements.lock`
- Create: `deploy/voiceover/build-requirements.in`
- Create: `deploy/voiceover/build-requirements.lock`
- Create: `deploy/voiceover/demucs-models.json`
- Create: `deploy/voiceover/mdx.yaml`
- Create: `scripts/install-voiceover-demucs.mjs`
- Create: `scripts/install-voiceover-demucs.test.mjs`
- Create: `server/voiceoverSeparation.mjs`
- Create: `server/voiceoverSeparation.test.mjs`

**Interfaces:**

- Export installer functions `loadDemucsManifest(path)`, `verifyDemucsModelFiles({ manifest, modelDir })`, and CLI modes `--check`, `--install`, `--download-models`.
- Export runtime functions `checkVoiceoverSeparationReadiness({ env, deps })` and `separateVoiceover({ inputWavPath, workDir, signal, env, deps })`.
- Runtime output is `{ vocalsPath, backgroundPath, model: 'mdx', durationMs }`; private work directories return a cleanup callback after the caller has persisted both stems.

- [ ] **Step 1: Add the exact model manifest**

`deploy/voiceover/demucs-models.json` contains exactly:

```json
{
  "schemaVersion": 1,
  "model": "mdx",
  "files": [
    {
      "name": "0d19c1c6-0f06f20e.th",
      "url": "https://dl.fbaipublicfiles.com/demucs/mdx_final/0d19c1c6-0f06f20e.th",
      "size": 178048329,
      "sha256": "0f06f20ed6ddc8058fa72ccc4845f3a88916eff7d007b623924193de217bbcf4"
    },
    {
      "name": "7ecf8ec1-70f50cc9.th",
      "url": "https://dl.fbaipublicfiles.com/demucs/mdx_final/7ecf8ec1-70f50cc9.th",
      "size": 178048329,
      "sha256": "70f50cc947d08f32e6dd8e2b687d398fa5ef9e51d1bd7600e32205d1f44be6b9"
    },
    {
      "name": "c511e2ab-fe698775.th",
      "url": "https://dl.fbaipublicfiles.com/demucs/mdx_final/c511e2ab-fe698775.th",
      "size": 167334095,
      "sha256": "fe6987756a7087d339bf63b19bb481b12cea02d3bc0de7583df7597210209649"
    },
    {
      "name": "7d865c68-3d5dd56b.th",
      "url": "https://dl.fbaipublicfiles.com/demucs/mdx_final/7d865c68-3d5dd56b.th",
      "size": 167918783,
      "sha256": "3d5dd56b5bc986f136dff98655ded22b2b033f465ccec7a28640a6b15fd71ed6"
    }
  ]
}
```

Use official nonquantized `mdx`: it avoids the previous `mdx_q`/diffq route and its CC-BY-NC/native-build risk on CPython 3.11. Vendor the exact official `mdx.yaml` as `deploy/voiceover/mdx.yaml`; do not vendor model weights. The full hashes below were measured once from the official FBA URLs and cross-checked against the published filename prefixes:

```yaml
models: ['0d19c1c6', '7ecf8ec1', 'c511e2ab', '7d865c68']
weights: [
  [1., 1., 0., 0.],
  [0., 1., 0., 0.],
  [1., 0., 1., 1.],
  [1., 0., 1., 1.],
]
segment: 44
```

- [ ] **Step 2: Lock the independent Python environment**

`requirements.in` pins the top-level packages:

```text
demucs==4.0.1
torch==2.7.1+cpu
torchaudio==2.7.1+cpu
```

Generate `requirements.lock` with hashes on the deployment Python/CPU target. `build-requirements.lock` pins and hashes `setuptools` and `wheel` for Tencent x86_64 manylinux_2_28 CPython 3.11; install it first, then install the application lock with `--require-hashes --no-build-isolation`. This makes the source-build path reproducible without fetching an unpinned isolated builder.

- [ ] **Step 3: Add failing installer and readiness tests**

```js
test('runtime readiness fails closed on one mismatched model hash', async () => {
  const readiness = await checkVoiceoverSeparationReadiness({
    env: completeEnv(),
    deps: fakeDeps({ mismatchedFile: 'c511e2ab-fe698775.th' }),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.modelReady, false);
  assert.equal(readiness.code, 'voiceover_separation_unavailable');
});

test('installer dry-run does not download or create a venv', async () => {
  const result = await runInstaller(['--check'], fakeInstallerDeps());
  assert.equal(result.downloadCalls, 0);
  assert.equal(result.spawnCalls.some((call) => call.args.includes('venv')), false);
});
```

Cover exact byte size + SHA-256, missing YAML, wrong model, Python import/version failure, runtime no-download behavior, and output sanitization.

- [ ] **Step 4: Run installer/readiness tests and confirm RED**

Run:

```bash
node --test scripts/install-voiceover-demucs.test.mjs server/voiceoverSeparation.test.mjs
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 5: Implement installer and fail-closed readiness**

Installer behavior:

- `--check`: read-only verification.
- `--install`: create/update the configured venv from the pinned build lock, then use `python -m pip install --require-hashes --no-build-isolation -r requirements.lock`.
- `--download-models`: download each file to `name.part`, verify size/hash, atomically publish it, and atomically install `mdx.yaml` into the same model directory.
- never print absolute configured paths, access tokens, or full URLs containing query strings.

Readiness checks:

```js
[
  [pythonPath, ['-c', 'import importlib.metadata as m, torch, torchaudio; print(m.version("demucs"))']],
  [pythonPath, ['-c', 'import sys; from pathlib import Path; from demucs.pretrained import get_model; get_model("mdx", Path(sys.argv[1])); print("mdx-load-ok")', modelDir]],
  [ffmpegPath, ['-hide_banner', '-filters']],
]
```

Require `sidechaincompress`, `amix`, `adelay`, `afade`, `atempo`, and `alimiter` in FFmpeg filter output.

- [ ] **Step 6: Add failing separation state-machine tests**

```js
test('spawns mdx cpu two-stem separation without a shell', async () => {
  const result = await separateVoiceover({
    inputWavPath: '/tmp/input with $(touch nope).wav',
    workDir: '/tmp/job-1',
    env: completeEnv(),
    deps: fakeSuccessfulSeparation(),
  });
  assert.deepEqual(result.spawn.args, [
    '-m', 'demucs.separate',
    '-n', 'mdx',
    '-d', 'cpu',
    '-j', '1',
    '--two-stems=vocals',
    '--repo', '/configured/models',
    '--out', '/tmp/job-1/separated',
    '/tmp/input with $(touch nope).wav',
  ]);
  assert.equal(result.spawn.options.shell, false);
});
```

Also test global FIFO concurrency, `detached: true`, abort sends `SIGTERM` then bounded `SIGKILL` to the process group, timeout maps to `voiceover_separation_timeout`, non-zero exit, missing/empty outputs, output duration drift, and cleanup after success/failure.

- [ ] **Step 7: Implement the separation runner**

Use a module-level semaphore sized by `separationConcurrency`. Create task directories with `fs.mkdtemp(path.join(os.tmpdir(), 'meiao-voiceover-'))`; clients never provide the base path. Resolve outputs exactly:

```js
const trackName = path.parse(inputWavPath).name;
const stemDir = path.join(outputDir, 'mdx', trackName);
return {
  vocalsPath: path.join(stemDir, 'vocals.wav'),
  backgroundPath: path.join(stemDir, 'no_vocals.wav'),
};
```

Acquire the semaphore before creating a private work directory. On failure or cancellation remove a private directory; after success return a one-shot cleanup callback so the parent can persist both stems before removal. Never remove a caller-supplied work directory.

- [ ] **Step 8: Run Task 4 tests, harness, and commit**

Run:

```bash
node --test scripts/install-voiceover-demucs.test.mjs server/voiceoverSeparation.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed scripts/install-voiceover-demucs.mjs --changed server/voiceoverSeparation.mjs --changed deploy/voiceover/demucs-models.json
git diff --check
```

Expected: PASS; no model weight appears in `git status --short`.

Commit:

```bash
git add deploy/voiceover/requirements.in deploy/voiceover/requirements.lock deploy/voiceover/build-requirements.in deploy/voiceover/build-requirements.lock deploy/voiceover/demucs-models.json deploy/voiceover/mdx.yaml scripts/install-voiceover-demucs.mjs scripts/install-voiceover-demucs.test.mjs server/voiceoverSeparation.mjs server/voiceoverSeparation.test.mjs
git commit -m "feat(video): add local demucs separation runtime"
```

### Task 5: Gemini Analysis, Translation Validation, and TTS Group Planning

**Files:**

- Create: `server/voiceoverAnalysis.mjs`
- Create: `server/voiceoverAnalysis.test.mjs`
- Modify: `src/services/videoStoryboardService.test.mjs`
- Modify: `docs/prompt-rtcfe-migration-map.md`

**Interfaces:**

- Export `buildVoiceoverAnalysisMessages({ vocalOnlyVideoUrl, targetLanguage, translationMode, durationMs })`.
- Export `parseVoiceoverAnalysis(content, { durationMs, targetLanguage, translationMode, overlapToleranceMs, maxTargetTextBytesPerSecond? })`; omitted target-text density uses `VOICEOVER_DEFAULTS.maxTargetTextBytesPerSecond`.
- Export `buildVoiceoverTtsGroups({ segments, selectedVoiceName, maxInputTokens, groupGapMs })`.
- Export `estimateVoiceoverTtsInputTokens(input)` as a documented conservative UTF-8 upper-bound estimator, not an exact tokenizer.

- [ ] **Step 1: Add failing RTCFE prompt and parser tests**

```js
test('analysis prompt is RTCFE and asks for one strict JSON object', () => {
  const messages = buildVoiceoverAnalysisMessages({
    vocalOnlyVideoUrl: 'https://managed.example/vocal-only.mp4',
    targetLanguage: 'en',
    translationMode: 'natural',
    durationMs: 12_000,
  });
  const prompt = JSON.stringify(messages);
  for (const anchor of ['Role', 'Task', 'Context', 'Format', 'Example']) {
    assert.match(prompt, new RegExp(anchor));
  }
  assert.match(prompt, /sourceLanguage/);
  assert.match(prompt, /speakerCount/);
  assert.match(prompt, /startMs/);
  assert.match(prompt, /targetText/);
});

test('parser rejects multiple speakers before TTS planning', () => {
  assert.throws(
    () => parseVoiceoverAnalysis(JSON.stringify({
      sourceLanguage: 'cmn',
      speakerCount: 2,
      voiceProfile: validProfile(),
      segments: [validSegment()],
    }), parserOptions()),
    (error) => error.code === 'voiceover_multiple_speakers',
  );
});
```

Cover the complete versioned source-language code list, the exact `cmn` Mandarin code (never `zh`/`zh-CN`), no language-content Example, Markdown-fenced JSON stripping, canonical duplicate JSON keys (including escaped keys), bounded nesting, malformed JSON, structurally invalid `segments`, empty speech, unsupported or same source/target language, missing text, `endMs <= startMs`, out-of-bounds times, non-monotonic segments, overlap beyond tolerance, natural/literal mode differences, conservative target-text byte density, and bounded accent description.

- [ ] **Step 2: Run analysis tests and confirm RED**

Run: `node --test server/voiceoverAnalysis.test.mjs src/services/videoStoryboardService.test.mjs`

Expected: FAIL because `voiceoverAnalysis.mjs` does not exist.

- [ ] **Step 3: Implement one controlled analysis input**

Always analyze one managed vocal-only video: original visual track plus isolated vocal audio. Build it in Task 7 before the paid call. Do not try audio-only first and then issue a second paid fallback.

Use the existing Gemini chat/file contract:

```js
{
  role: 'user',
  content: [
    { type: 'input_file', file_url: vocalOnlyVideoUrl },
    { type: 'text', text: rtcfePrompt },
  ],
}
```

Generate the prompt's complete allowed `sourceLanguage` code list from `VOICEOVER_LANGUAGES`. State that Mandarin Chinese is `cmn` and reject `zh`/`zh-CN`. The `E Example` section contains no language content and only directs the model to follow `F Format`, so Japanese, Korean, Mandarin, and other targets are not biased by an English `targetText` sample.

The parser returns:

```js
{
  sourceLanguage,
  speakerCount: 1,
  voiceProfile,
  segments: segments.map(({ id, startMs, endMs, sourceText, targetText }) => ({
    id,
    startMs,
    endMs,
    sourceText,
    targetText,
  })),
}
```

Before `JSON.parse`, scan the already byte-bounded JSON structure with a maximum nesting depth and reject duplicate keys by their decoded key value. A root/profile/segment key repeated through escapes such as `source\u004canguage` is still a duplicate. Regex matching over raw strings is forbidden because transcript text may legitimately contain field names.

After shared normalization, reject `sourceLanguage === targetLanguage`. For every segment, reject abnormal translated-text density before grouping:

```js
const allowedBytes = Math.ceil(
  maxTargetTextBytesPerSecond * Math.max(1, (endMs - startMs) / 1000),
);
```

This is a conservative anomaly guard, not an exact speaking-rate model or tokenizer.

- [ ] **Step 4: Add failing grouping and input-budget tests**

```js
test('groups adjacent speech but never crosses the conservative input budget', () => {
  const groups = buildVoiceoverTtsGroups({
    segments: threeSegmentsWithGaps(400, 1200),
    selectedVoiceName: 'Kore',
    maxInputTokens: 120,
    groupGapMs: 800,
  });
  assert.deepEqual(groups.map((group) => group.segmentIds), [['s1', 's2'], ['s3']]);
  assert.ok(groups.every((group) => group.estimatedInputTokens <= 120));
});

test('one segment larger than the budget fails before provider submission', () => {
  assert.throws(
    () => buildVoiceoverTtsGroups({
      segments: [oversizedSegment()],
      selectedVoiceName: 'Kore',
      maxInputTokens: 16,
      groupGapMs: 800,
    }),
    (error) => error.code === 'voiceover_tts_input_too_large',
  );
});
```

Also assert that exactly `VOICEOVER_MAX_TTS_GROUPS` separated groups pass and the next group fails with `voiceover_tts_input_too_large` before any provider child can be created.

- [ ] **Step 5: Implement conservative budget and group payloads**

Estimate all serialized fields:

```js
const serialized = JSON.stringify({
  speakers: JSON.stringify([{
    speaker_id: 'Speaker 1',
    voice_name: selectedVoiceName,
  }]),
  dialogue_turns: JSON.stringify(group.segments.map((segment) => ({
    speaker_id: 'Speaker 1',
    text: segment.targetText,
  }))),
  temperature: 1,
  scene,
  sample_context: sampleContext,
});
const estimatedInputTokens = Buffer.byteLength(serialized, 'utf8');
```

Label the value `estimatedInputTokens`; never expose it as an exact Gemini token count. A group may merge adjacent segments only when gap `<= groupGapMs` and the merged serialized estimate is `<= maxInputTokens`.
Both checkpoint normalization and group planning import the same exported `VOICEOVER_MAX_TTS_GROUPS`; do not duplicate the literal `100`.

- [ ] **Step 6: Update RTCFE map and run Task 5 tests**

Add one row to `docs/prompt-rtcfe-migration-map.md` naming `buildVoiceoverAnalysisMessages`, its test file, strict JSON anchors, and owner module.

Run:

```bash
node --test server/voiceoverAnalysis.test.mjs src/services/videoStoryboardService.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/voiceoverAnalysis.mjs --changed docs/prompt-rtcfe-migration-map.md
git diff --check
```

Expected: PASS and no prompt boundary warning.

- [ ] **Step 7: Commit**

```bash
git add server/voiceoverAnalysis.mjs server/voiceoverAnalysis.test.mjs src/services/videoStoryboardService.test.mjs docs/prompt-rtcfe-migration-map.md
git commit -m "feat(video): analyze and group translated speech"
```

### Task 6: Exactly-Once KIE Gemini TTS Adapter

**Files:**

- Create: `server/providerKieTts.mjs`
- Create: `server/providerKieTts.test.mjs`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/jobSubmissionPolicy.mjs`
- Modify: `server/jobSubmissionPolicy.test.mjs`

**Interfaces:**

- Export `runKieTtsJob({ job, env, signal, onProviderTaskId, deps })`.
- Export pure helpers `buildKieTtsCreateBody(payload)`, `normalizeKieTtsCreateResponse(body)`, and `normalizeKieTtsRecordResponse(body, taskId)`.
- `executeProviderJob` may dispatch a parent-owned `kie_tts` child but must never dispatch `voiceover_translate_video`.

- [ ] **Step 1: Add failing create-body and response tests**

```js
test('create body matches the documented KIE wrapper contract', () => {
  assert.deepEqual(buildKieTtsCreateBody({
    voiceName: 'Kore',
    dialogueTurns: [{ speaker: 'Speaker 1', text: 'Hello world.' }],
    temperature: 1,
    scene: 'Warm product presentation with controlled pacing.',
    sampleContext: 'One consistent narrator. Preserve pauses between claims.',
  }), {
    model: 'google/gemini-3-1-flash-tts',
    input: {
      speakers: JSON.stringify([{ speaker_id: 'Speaker 1', voice_name: 'Kore' }]),
      dialogue_turns: JSON.stringify([{ speaker_id: 'Speaker 1', text: 'Hello world.' }]),
      temperature: 1,
      scene: 'Warm product presentation with controlled pacing.',
      sample_context: 'One consistent narrator. Preserve pauses between claims.',
    },
  });
});

test('success parses the first audio result url from resultJson', () => {
  assert.deepEqual(normalizeKieTtsRecordResponse({
    code: 200,
    data: {
      state: 'success',
      resultJson: JSON.stringify({ resultUrls: ['https://provider.example/audio.mp3'] }),
    },
  }, 'task-1'), {
    state: 'success',
    providerTaskId: 'task-1',
    audioUrl: 'https://provider.example/audio.mp3',
  });
});
```

Cover `waiting`, `fail`, missing task ID, malformed nested `resultJson`, empty `resultUrls`, 400/401/402/404/422/429/5xx, timeout, abort, invalid language/voice, `scene`/`sample_context` > 1000 characters, and temperature outside `0..2`.

- [ ] **Step 2: Add failing exact-once tests**

```js
test('new task checkpoints id before the first record query', async () => {
  const events = [];
  await runKieTtsJob({
    job: newTtsJob(),
    env: enabledEnv(),
    onProviderTaskId: async (taskId) => events.push(`checkpoint:${taskId}`),
    deps: fakeKieTts({
      onCreate: () => events.push('create'),
      onQuery: () => events.push('query'),
      states: ['waiting', 'success'],
    }),
  });
  assert.deepEqual(events.slice(0, 3), ['create', 'checkpoint:tts-1', 'query']);
});

test('existing provider task id never calls createTask', async () => {
  const deps = fakeKieTts({ rejectCreate: true, states: ['success'] });
  await runKieTtsJob({
    job: newTtsJob({ providerTaskId: 'tts-existing' }),
    env: enabledEnv(),
    deps,
  });
  assert.equal(deps.calls.create, 0);
  assert.equal(deps.calls.query, 1);
});
```

Create network ambiguity without an extracted task ID must produce `provider_submission_unknown`, `retryable=false`. Query/persistence failures with an existing ID retain the ID.

- [ ] **Step 3: Run provider tests and confirm RED**

Run:

```bash
node --test server/providerKieTts.test.mjs server/providerGateway.test.mjs server/jobSubmissionPolicy.test.mjs
```

Expected: FAIL because the TTS adapter and policy do not exist.

- [ ] **Step 4: Implement create/query state machine**

Create:

```text
POST {MEIAO_KIE_TTS_BASE_URL}/api/v1/jobs/createTask
Authorization: Bearer ${kieApiKey}
Content-Type: application/json
```

Query:

```text
GET ${kieBaseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(providerTaskId)}
Authorization: Bearer ${kieApiKey}
```

Never retry POST inside the adapter. Poll only after `await onProviderTaskId(taskId)`. Return:

```js
{
  providerTaskId,
  providerStage: 'provider_wait',
  providerStatus: 'success',
  result: {
    audioUrl,
    voiceName: job.payload.voiceName,
    groupIndex: job.payload.groupIndex,
  },
}
```

The managed-output persistence layer replaces `audioUrl` with `{ audioUrl: managedUrl, assetId }` before the child is marked succeeded.

Operational controls are server-only and bounded:

- `MEIAO_KIE_TTS_REQUEST_TIMEOUT_MS`: default `60000`, bounds `5000..300000`.
- `MEIAO_KIE_TTS_POLL_INTERVAL_MS`: default `4000`, bounds `500..30000`.
- `MEIAO_KIE_TTS_POLL_MAX_ATTEMPTS`: default `180`, bounds `1..720`.
- `MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS`: default `45000`, bounds `0..300000`.

- [ ] **Step 5: Constrain dispatch and browser creation**

Add `kie_tts` to recoverable KIE task types, but authorize `submissionOperation='create'` only when:

```js
payload.executionOwner === 'parent'
&& payload.parentJobId
&& payload.childKey.startsWith('tts:')
```

A browser request that declares `executionOwner='parent'` is still rejected at the HTTP boundary; only `voiceoverChildJobStore` can create this record. `voiceover_translate_video` accepts only `provider='internal'`.

- [ ] **Step 6: Run Task 6 tests, harness, and commit**

Run:

```bash
node --test server/providerKieTts.test.mjs server/providerGateway.test.mjs server/jobSubmissionPolicy.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/providerKieTts.mjs --changed server/providerGateway.mjs --changed server/jobSubmissionPolicy.mjs
git diff --check
```

Expected: PASS; harness reports no duplicate-submit or policy bypass.

Commit:

```bash
git add server/providerKieTts.mjs server/providerKieTts.test.mjs server/providerGateway.mjs server/providerGateway.test.mjs server/jobSubmissionPolicy.mjs server/jobSubmissionPolicy.test.mjs
git commit -m "feat(video): add exactly-once kie tts adapter"
```

### Task 7: FFmpeg Extraction, Vocal-Only Analysis Media, Alignment, and Final Mix

**Files:**

- Create: `server/voiceoverAudio.mjs`
- Create: `server/voiceoverAudio.test.mjs`

**Interfaces:**

- Export `extractVoiceoverAudio({ inputVideoPath, outputWavPath, signal, deps })`.
- Export `buildVocalOnlyAnalysisVideo({ sourceVideoPath, vocalPath, outputPath, signal, deps })`.
- Export `probeVoiceoverAudio(path, deps)`.
- Export `calculateAtempo({ actualDurationMs, targetDurationMs, minAtempo, maxAtempo })`.
- Export `alignVoiceoverGroups({ groups, outputPath, totalDurationMs, config, signal, deps })`.
- Export `mixVoiceoverResult({ baseVideoPath, backgroundPath, narrationPath, outputPath, config, signal, deps })`.
- Export `validateVoiceoverOutput({ path, expectedDurationMs, toleranceMs, deps })`.

- [ ] **Step 1: Add failing extraction and vocal-only media tests**

```js
test('extracts a 48khz pcm working track', () => {
  assert.deepEqual(buildExtractAudioArgs('/in.mp4', '/out.wav'), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', '/in.mp4',
    '-map', '0:a:0',
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    '/out.wav',
  ]);
});

test('vocal-only analysis input copies video and replaces audio', () => {
  const args = buildVocalOnlyVideoArgs('/base.mp4', '/vocals.wav', '/analysis.mp4');
  assert.ok(args.includes('-c:v'));
  assert.ok(args.includes('copy'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('-shortest'));
});
```

Cover missing audio, invalid WAV, duration drift, child process abort, no shell, and source filename metacharacters.

- [ ] **Step 2: Run audio tests and confirm RED**

Run: `node --test server/voiceoverAudio.test.mjs`

Expected: FAIL because `voiceoverAudio.mjs` does not exist.

- [ ] **Step 3: Implement extraction and controlled analysis video**

Vocal-only analysis video uses original normalized video frames, isolated vocal audio, AAC 128k, `-c:v copy`, `-map 0:v:0`, `-map 1:a:0`, and `-movflags +faststart`. Probe it before upload; require H.264/AAC and duration within configured tolerance.

- [ ] **Step 4: Add failing atempo and timeline tests**

```js
test('atempo is actual duration divided by target window', () => {
  assert.equal(calculateAtempo({
    actualDurationMs: 1200,
    targetDurationMs: 1000,
    minAtempo: 0.75,
    maxAtempo: 1.35,
  }), 1.2);
});

test('unsafe timing fails without requesting new speech', () => {
  assert.throws(
    () => calculateAtempo({
      actualDurationMs: 2000,
      targetDurationMs: 1000,
      minAtempo: 0.75,
      maxAtempo: 1.35,
    }),
    (error) => error.code === 'voiceover_timing_out_of_range',
  );
});
```

Add a two-group fixture and assert the filter graph contains, per group, `aresample=48000`, `atempo`, `afade`, and `adelay=${startMs}|${startMs}`, then `amix` and `atrim=duration=${videoSeconds}`.

- [ ] **Step 5: Implement narration alignment**

For group `i`:

```text
[i:a]aresample=48000,pan=mono|c0=c0,
atempo=${ratio},
afade=t=in:st=0:d=${fadeSeconds},
afade=t=out:st=${Math.max(0, durationSeconds - fadeSeconds)}:d=${fadeSeconds},
adelay=${startMs}|${startMs}[voice_i]
```

Mix aligned groups onto a zero-volume 48 kHz mono bed of exact video duration. Reject overlapping target windows beyond the parser tolerance rather than relying on `amix` to hide overlap.

- [ ] **Step 6: Add failing ducking and final-output tests**

Use a generated fixture with:

- stereo background sine at two known frequencies,
- old vocal sine isolated in the vocal track,
- replacement narration at a third frequency,
- 3-second H.264 video.

Assert final spectral samples retain both background frequencies, omit the old-vocal frequency above the agreed threshold, contain the new narration frequency, and stay below `-1 dBFS`. Assert `ffprobe` reports H.264/AAC and duration difference `<= durationToleranceMs`.

- [ ] **Step 7: Implement sidechain mix and mux**

Build the audio graph:

```text
[background]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[bg];
[narration]aresample=48000,pan=stereo|c0=c0|c1=c0[narr];
[bg][narr]sidechaincompress=threshold=0.02:ratio=${duckingRatio}:attack=20:release=250:makeup=1[ducked];
[ducked][narr]amix=inputs=2:duration=longest:normalize=0,
alimiter=limit=0.8912509381:level=0,
atrim=duration=${videoSeconds}[mixed]
```

Map `[mixed]` with base video, use `-c:v copy -c:a aac -b:a 192k -movflags +faststart -shortest`. Compute `duckingRatio = duckingDb === 0 ? 1 : 1 + (duckingDb * 19 / 12)` so the configured `0..12` range maps to FFmpeg's `1..20` ratio range; unit-test 0, 4, and 12 dB. Treat `duckingDb` as the product control label, not a claim that the compressor yields a constant measured attenuation for every source.

- [ ] **Step 8: Run Task 7 tests, harness, and commit**

Run:

```bash
node --test server/voiceoverAudio.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/voiceoverAudio.mjs
git diff --check
```

Expected: PASS on the bundled FFmpeg/FFprobe runtime.

Commit:

```bash
git add server/voiceoverAudio.mjs server/voiceoverAudio.test.mjs
git commit -m "feat(video): align and mix translated voiceover"
```

### Task 8: Durable Parent Checkpoints and Parent-Owned Child Job Ledger

**Files:**

- Create: `server/voiceoverChildJobStore.mjs`
- Create: `server/voiceoverChildJobStore.test.mjs`
- Modify: `server/localJobStore.mjs`
- Modify: `server/localJobStore.test.mjs`
- Modify: `server/jobManager.mjs`
- Modify: `server/jobManager.test.mjs`
- Modify: `server/temporalWorker.mjs`
- Modify: `server/temporalWorker.test.mjs`
- Modify: `server/temporal/workflows.mjs`

**Interfaces:**

- Worker `executeJob(job, signal, options)` receives both `options.onProviderTaskId` and `options.onResultCheckpoint`.
- `onResultCheckpoint(patch)` merges a normalized checkpoint into a running job's `result.voiceoverCheckpoint` without changing terminal status.
- Export `createVoiceoverChildJobLedger({ mode, pool, readLocalStore, mutateLocalStore, now, createJobId })`.
- Ledger methods: `getOrCreate(input)`, `checkpointProviderTaskId(childJobId, taskId)`, `markSucceeded(childJobId, output)`, `markFailed(childJobId, error)`, and `get(childJobId)`.
- `requestRetryJob` and `requestLocalRetryJob` accept server-derived `voiceoverRetryPlan`; browsers may only send `confirmNewProviderAttempt=true`, never an attempt number or child key.

- [ ] **Step 1: Add failing running-checkpoint tests for both ledgers**

```js
test('local worker persists a checkpoint before the next side effect', async () => {
  const events = [];
  const worker = createLocalJobWorker({
    executeJob: async (_job, _signal, { onResultCheckpoint }) => {
      await onResultCheckpoint({
        voiceoverCheckpoint: {
          version: 1,
          stage: 'speech_analysis_submitting',
          baseVideoAssetId: 'base-1',
        },
      });
      events.push('paid-call');
      throw Object.assign(new Error('lost'), { code: 'provider_network_error' });
    },
  });
  await worker.runOnce();
  assert.equal(readJob().result.voiceoverCheckpoint.stage, 'speech_analysis_submitting');
  assert.deepEqual(events, ['paid-call']);
});
```

Mirror the assertion in MySQL and Temporal worker tests. Also assert a checkpoint write cannot change another user's job or a job whose claim timestamp no longer matches.

- [ ] **Step 2: Run ledger tests and confirm RED**

Run:

```bash
node --test server/localJobStore.test.mjs server/jobManager.test.mjs server/temporalWorker.test.mjs
```

Expected: FAIL because `onResultCheckpoint` is missing and failure/retry paths clear `result`.

- [ ] **Step 3: Implement atomic running checkpoints and retry preservation**

Local:

```js
const onResultCheckpoint = async (resultPatch) => {
  await mutate((store) => updateLocalJobResult(store, job.id, resultPatch));
};
```

MySQL uses a claim-guarded update:

```sql
UPDATE internal_jobs
SET result_json = ?, updated_at = ?
WHERE id = ? AND status = 'running' AND started_at = ?
```

Before merging, parse the latest row and call `normalizeVoiceoverCheckpoint`. `requestLocalRetryJob` and `requestRetryJob` preserve `result.voiceoverCheckpoint` only for `taskType='voiceover_translate_video'`; all other task behavior remains unchanged. Explicit destructive reset is not offered for this feature.

- [ ] **Step 4: Add failing parent-owned child tests**

```js
test('same parent and child key returns one child across restart', async () => {
  const first = await ledger.getOrCreate({
    parentJob,
    childKey: 'tts:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: ttsPayload(),
  });
  await ledger.checkpointProviderTaskId(first.id, 'provider-tts-1');
  const second = await rebuiltLedger().getOrCreate({
    parentJob,
    childKey: 'tts:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: ttsPayload(),
  });
  assert.equal(second.id, first.id);
  assert.equal(second.providerTaskId, 'provider-tts-1');
});

test('generic workers and stale recovery ignore parent-owned children', async () => {
  const child = parentOwnedChild({ status: 'running', updatedAt: 0 });
  assert.equal(isParentOwnedChildJob(child), true);
  assert.deepEqual(selectExecutableJobs([child]), []);
  assert.deepEqual(recoverStaleJobs([child]), []);
});
```

Test initial Golden child key `golden:attempt:0`, initial TTS key `tts:0:attempt:0`, wrong parent/user access, terminal reuse, failed child retaining provider ID, duplicate concurrent create, and child payload bounds.

- [ ] **Step 5: Implement stable child creation**

Child payload always includes:

```js
{
  ...providerPayload,
  executionOwner: 'parent',
  parentJobId: parentJob.id,
  childKey,
  clientSubmissionKey: `voiceover-child:${parentJob.id}:${childKey}`,
}
```

Child records start `status='running'`, `maxRetries=0`, inherit parent `userId`, `module='video'`, and are created in the same ledger. For MySQL, compute `lockName = 'voiceover-child:' + sha256(stableKey).slice(0, 32)`, serialize `getOrCreate` with `GET_LOCK(lockName, 10)`, and query by exact user + client submission key before insert. Always release the advisory lock with `RELEASE_LOCK(lockName)`.

Generic local selection, MySQL queued selection, stale-running recovery, Temporal workflow startup, and restart reconciliation call `isParentOwnedChildJob` and exclude these records. A child only changes state through the ledger methods.

For SQL selectors and stale-recovery updates, add this predicate rather than relying on a later in-memory filter:

```sql
AND COALESCE(
  JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.executionOwner')),
  ''
) <> 'parent'
```

Child keys include a server-owned attempt:

```js
const childKey = kind === 'golden'
  ? `golden:attempt:${attempt}`
  : `tts:${groupIndex}:attempt:${attempt}`;
```

Initial attempt is `0`. Ordinary retry/resume/query/persistence recovery reuses the same child and never increments it. When a provider has definitively failed, or submission status is unknown, the retry endpoint requires `confirmNewProviderAttempt=true`; while holding the existing job retry lock it derives `attempt + 1`, preserves the old child row for audit, and updates only the affected checkpoint entry to a queued new attempt. For `voiceover_analysis_submission_unknown`, the same transition calls `prepareVoiceoverRetryCheckpoint`, increments `analysisAttempt`, and rewinds only to `voice_separated`. The same request cannot increment twice because the parent status changes atomically from `failed` to `queued`. Local failures before a paid POST, or query/persistence failures with an existing task ID, reuse attempt `0` and do not require a new paid attempt.

- [ ] **Step 6: Make Temporal parent activity single-attempt**

Add task type based activity selection so `voiceover_translate_video` uses `maximumAttempts: 1`, matching the external-safety boundary. The MEIAO job may be explicitly retried using its checkpoint; Temporal must not replay the whole activity behind the job ledger.

- [ ] **Step 7: Run Task 8 tests, harness, and commit**

Run:

```bash
node --test server/voiceoverChildJobStore.test.mjs server/localJobStore.test.mjs server/jobManager.test.mjs server/temporalWorker.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/voiceoverChildJobStore.mjs --changed server/localJobStore.mjs --changed server/jobManager.mjs --changed server/temporalWorker.mjs --changed server/temporal/workflows.mjs
git diff --check
```

Expected: PASS; harness reports no task-ownership, duplicate-submit, or retry-clears-checkpoint violation.

Commit:

```bash
git add server/voiceoverChildJobStore.mjs server/voiceoverChildJobStore.test.mjs server/localJobStore.mjs server/localJobStore.test.mjs server/jobManager.mjs server/jobManager.test.mjs server/temporalWorker.mjs server/temporalWorker.test.mjs server/temporal/workflows.mjs
git commit -m "feat(jobs): checkpoint voiceover parent and child tasks"
```

### Task 9: Checkpoint-Driven Composite Runner and Server Dispatch

**Files:**

- Create: `server/voiceoverTranslationRunner.mjs`
- Create: `server/voiceoverTranslationRunner.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/accountCredits.mjs`
- Modify: `server/accountCredits.test.mjs`
- Modify: `server/jobSubmissionPolicy.mjs`
- Modify: `server/jobSubmissionPolicy.test.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`

**Interfaces:**

- Export `runVoiceoverTranslationJob({ job, env, signal, onResultCheckpoint, deps })`.
- Add `executeApplicationJob(job, env, signal, options)` in `server/index.mjs`: parent task to composite runner; all other tasks to `executeProviderJobWithManagedAssetScrub`.
- Runner dependencies are explicit: owned asset resolver, FFprobe, managed file persistence, Golden adapter, Gemini analysis, TTS adapter, child ledger, Demucs, FFmpeg audio functions, temp cleanup, and logger.
- Before passing any local input or output path into Task 7 audio helpers, the
  runner must canonicalize it and prove containment within a server-created,
  parent-job-owned work root. Browser payloads cannot select or extend this
  root; symlink or traversal escapes fail before FFmpeg/FFprobe spawn.

- [ ] **Step 1: Add a failing happy-path orchestration test**

Expected ordered events:

```js
[
  'resolve-owned-source',
  'persist:input_prepared',
  'extract-audio',
  'persist:audio_extracted',
  'demucs',
  'persist:voice_separated',
  'build-vocal-only-video',
  'persist:speech_analysis_submitting',
  'gemini-analysis',
  'persist:speech_analyzed',
  'persist:translated',
  'child:tts:0:create',
  'child:tts:0:provider-checkpoint',
  'child:tts:0:succeeded',
  'persist:tts_generating',
  'align',
  'persist:audio_aligned',
  'mix',
  'persist-final',
  'persist:result_persisted',
]
```

Assert the returned result contains:

```js
{
  videoUrl: 'managed-final-url',
  sourceUrl: 'managed-source-url',
  sourceLanguage: 'cmn',
  targetLanguage: 'en',
  translationMode: 'natural',
  voiceName: 'Kore',
  sourceTranscript: '源文',
  translatedTranscript: 'Translation',
  voiceoverStage: 'result_persisted',
  finalAssetId: 'asset-final',
}
```

- [ ] **Step 2: Add failing resume tests at every checkpoint**

Table-drive these cases:

| Existing checkpoint | Must reuse | Next allowed side effect |
|---|---|---|
| `input_prepared` | base video asset | extract audio |
| `audio_extracted` | original audio asset | Demucs |
| `voice_separated` | vocals/background assets | build analysis media |
| `speech_analysis_submitting` | all local assets | fail `voiceover_analysis_submission_unknown` |
| `speech_analyzed` | analysis JSON | select voice and group |
| `translated` | groups and selected voice | find/create TTS children |
| `tts_generating` | succeeded child asset IDs and provider IDs | query failed/incomplete children only |
| `audio_aligned` | narration asset | final mix |
| `result_persisted` | final asset | return without any provider/local recompute |

Also test:

- Golden enabled uses initial child `golden:attempt:0`, and failure stops before Demucs/Gemini/TTS.
- no audio, no speech, multiple speakers, unsupported language, invalid analysis, separation timeout, TTS input too large, timing out of range, mix failure, result persistence failure.
- cancellation before paid stages and after a provider task ID exists.
- a limited-credit account with fewer than 5 available credits is rejected at parent creation before Golden, Gemini, or KIE is called.
- parent creation reserves the existing 5-credit video estimate even though its provider is `internal`; public UI does not display it as provider pricing.
- with `MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND=16`, a one-second segment whose `targetText` is 50 ASCII bytes fails with `voiceover_analysis_invalid` before `child:tts:*:create`; the recorded events contain no TTS child creation or TTS provider side effect.
- non-default env values prove the runner propagates the normalized overlap tolerance, target-text density rate, group gap, and TTS token limit into the parser/group planner instead of falling back to helper defaults.
- temp directory cleanup after intermediate persistence.
- canonical work-root containment accepts server-owned children and rejects
  relative paths, traversal, symlink escapes, and browser-provided roots before
  any Task 7 process call.
- logs contain IDs/stages/durations but no signed URL, full provider body, transcript, key, authorization header, or local path.

- [ ] **Step 3: Run runner tests and confirm RED**

Run: `node --test server/voiceoverTranslationRunner.test.mjs`

Expected: FAIL because the runner does not exist.

- [ ] **Step 4: Implement the stage reducer and resume guards**

The runner begins with:

```js
const config = getVoiceoverConfig(env);
let checkpoint = normalizeVoiceoverCheckpoint(job.result?.voiceoverCheckpoint);
const persistStage = async (patch) => {
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, patch);
  await onResultCheckpoint({ voiceoverCheckpoint: checkpoint });
};
```

Runtime analysis and grouping must pass normalized config values explicitly:

```js
const analysis = parseVoiceoverAnalysis(content, {
  durationMs,
  targetLanguage: job.payload.targetLanguage,
  translationMode: job.payload.translationMode,
  overlapToleranceMs: config.overlapToleranceMs,
  maxTargetTextBytesPerSecond: config.maxTargetTextBytesPerSecond,
});

const groups = buildVoiceoverTtsGroups({
  segments: analysis.segments,
  selectedVoiceName,
  maxInputTokens: config.ttsMaxInputTokens,
  groupGapMs: config.groupGapMs,
});
```

Helper defaults are direct-call fallbacks only; the runtime runner must not let them override normalized env configuration.

Every stage follows:

1. Resolve all referenced asset IDs through current-user ownership.
2. Verify the stored output exists and passes its stage probe.
3. Perform one local or provider side effect only when the checkpoint lacks a reusable result.
4. Persist the managed artifact or bounded JSON.
5. Await `persistStage` before entering the next stage.

Use the normalized source or Golden result as `baseVideoAssetId`, but keep the original source identity in the terminal result.

- [ ] **Step 5: Implement Golden and TTS child execution**

Golden:

```js
const child = await deps.childJobs.getOrCreate({
  parentJob: job,
  childKey: `golden:attempt:${checkpoint.subtitleRemoval?.attempt ?? 0}`,
  taskType: 'subtitle_remove_video',
  provider: 'golden_subtitle',
  payload: buildGoldenChildPayload(job, checkpoint),
});
```

TTS group:

```js
const child = await deps.childJobs.getOrCreate({
  parentJob: job,
  childKey: `tts:${group.index}:attempt:${group.attempt}`,
  taskType: 'kie_tts',
  provider: 'kie',
  payload: buildTtsChildPayload(job, group),
});
```

Adapters receive a callback that writes child `providerTaskId` before polling. Provider output is persisted as managed asset before `markSucceeded`. The parent checkpoint stores only child ID, provider ID, managed asset ID, group timing, status, and bounded metrics.

Automatic resume always uses the checkpoint's current `attempt`. Only the server retry transition described in Task 8 may advance it; the runner rejects browser-supplied attempt values.

- [ ] **Step 6: Wire application dispatch, policy, readiness, and health**

Policy:

- add `voiceover_translate_video` to `VIDEO_JOB_TASK_TYPES`.
- allow only `provider='internal'`, `module='video'`, `subFeature='voiceover_translation'`.
- require video permission, feature enabled, KIE configured, and all local readiness booleans.
- force `maxRetries=0` at creation.
- reject `removeText=true` when Golden is disabled/unconfigured or authoritative duration > 600 seconds.

Budget:

Add this branch before the generic `provider === 'internal'` zero-reservation return in `estimateCreditReservation`:

```js
if (normalizedTaskType === 'voiceover_translate_video') {
  return DEFAULT_VIDEO_CREDIT_ESTIMATE;
}
```

Keep the constant at the existing value `5`; do not add a second voiceover-specific amount. Add local/MySQL tests proving reservation, insufficient-credit rejection, success settlement, failure release, submission-unknown retention, and restart reconciliation follow the existing account-credit rules.

Dispatch:

```js
const executeApplicationJob = async (job, env, signal, options = {}) => {
  if (job.taskType === 'voiceover_translate_video') {
    return runVoiceoverTranslationJob({
      job,
      env,
      signal,
      onResultCheckpoint: options.onResultCheckpoint,
      deps: createVoiceoverRunnerDeps(job),
    });
  }
  return executeProviderJobWithManagedAssetScrub(job, env, signal, options);
};
```

Health/public config includes enabled/ready/catalog/limits, never filesystem paths or URLs. Existing historical cards remain readable when feature is disabled.

- [ ] **Step 7: Run Task 9 tests, harness, and commit**

Run:

```bash
node --test server/voiceoverTranslationRunner.test.mjs server/accountCredits.test.mjs server/jobSubmissionPolicy.test.mjs server/jobRuntime.test.mjs server/providerGateway.test.mjs server/jobManager.test.mjs server/localJobStore.test.mjs server/temporalWorker.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/voiceoverTranslationRunner.mjs --changed server/index.mjs --changed server/accountCredits.mjs --changed server/jobSubmissionPolicy.mjs --changed server/jobRuntime.mjs
git diff --check
```

Expected: PASS; no duplicate paid call, arbitrary URL, path leak, or checkpoint loss.

Commit:

```bash
git add server/voiceoverTranslationRunner.mjs server/voiceoverTranslationRunner.test.mjs server/index.mjs server/accountCredits.mjs server/accountCredits.test.mjs server/jobSubmissionPolicy.mjs server/jobSubmissionPolicy.test.mjs server/jobRuntime.mjs server/jobRuntime.test.mjs
git commit -m "feat(video): orchestrate voiceover translation jobs"
```

### Task 10: Submission Client and Voiceover Translation Workspace

**Files:**

- Create: `src/services/voiceoverTranslationClient.ts`
- Create: `src/services/voiceoverTranslationClient.test.mjs`
- Create: `src/shell/components/VoiceoverTranslationWorkspace.tsx`
- Create: `src/shell/components/VoiceoverTranslationWorkspace.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/modules/Video/VideoModule.tsx`
- Modify: `src/components/uiArchitecture.test.mjs`

**Interfaces:**

- Export `buildVoiceoverSubmissionKey(input)`, `buildVoiceoverJobRequest(input)`, and `buildVoiceoverRetryRequest(job, options)`.
- Workspace props:

```ts
type VoiceoverTranslationWorkspaceProps = {
  active: boolean;
  composerSlotId: string;
  initialSource?: {
    sourceAssetId?: string;
    sourceUrl: string;
    sourceProjectId?: string;
    sourceResultId?: string;
  } | null;
  publicConfig: SystemPublicConfig['voiceoverTranslation'];
  onSubmit: (draft: VoiceoverTranslationDraft) => Promise<void>;
  onClearInitialSource: () => void;
};
```

- [ ] **Step 1: Add failing stable-key and request tests**

```js
test('submission key includes every behavior-changing field', () => {
  const base = validInput();
  const key = buildVoiceoverSubmissionKey(base);
  for (const patch of [
    { targetLanguage: 'ja' },
    { translationMode: 'literal' },
    { voiceMode: 'preset', voiceName: 'Puck' },
    { removeText: true },
    { subtitleRegionNormalized: { x: 0, y: 0.6, width: 1, height: 0.4 } },
  ]) {
    assert.notEqual(buildVoiceoverSubmissionKey({ ...base, ...patch }), key);
  }
});

test('job request is internal, video scoped, and zero retry', () => {
  assert.deepEqual(buildVoiceoverJobRequest(validInput()), {
    module: 'video',
    subFeature: 'voiceover_translation',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    maxRetries: 0,
    payload: expectedNormalizedPayload(),
  });
});
```

Assert direct upload and existing-result input produce the same payload contract; arbitrary external URL fails; duplicate clicks reuse the same active submission key.

- [ ] **Step 2: Run client tests and confirm RED**

Run: `node --test src/services/voiceoverTranslationClient.test.mjs`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the client**

Use canonical JSON key ordering and SHA-256 through the existing browser-safe stable-key helper. Region numbers are rounded to six decimals. Do not include signed access query strings in the key; use managed asset ID or canonical managed path identity.

- [ ] **Step 4: Add failing workspace structure and state tests**

Assert source contains and behavior tests cover:

- one file input with `accept="video/mp4,video/quicktime"`.
- selecting a second file opens replace confirmation; no array/batch state.
- media session uses `profile: 'voiceover_translation'`.
- common languages render first; “更多语言” expands the remaining frozen server catalog.
- `natural` default and `literal` alternative.
- `auto` default; preset list shows all 30 names/traits.
- `removeText` default false; true initializes `{ x: 0, y: 0.7, width: 1, height: 0.3 }`.
- existing `SubtitleRegionEditor` is reused.
- confirm dialog lists video duration, target language, translation mode, resolved voice mode, Golden yes/no, Gemini analysis and KIE TTS as possible paid stages, with no fake amount.
- submit button locks through async completion and repeated clicks reuse the stable key.
- feature disabled/readiness false blocks new submit but does not hide historical cards.
- root uses natural page flow and does not add a fixed-height nested scroll container.

- [ ] **Step 5: Run workspace tests and confirm RED**

Run:

```bash
node --test src/shell/components/VoiceoverTranslationWorkspace.test.mjs src/components/uiArchitecture.test.mjs
```

Expected: FAIL because the workspace and slot do not exist.

- [ ] **Step 6: Implement workspace and composer slot**

Add `voiceover_translation` between `storyboard` and `subtitle_removal`. In `VideoModule`:

```tsx
<div hidden={activeSubFeature !== 'voiceover_translation'}>
  <VoiceoverTranslationWorkspace
    active={activeSubFeature === 'voiceover_translation'}
    composerSlotId="voiceover-translation-composer-slot"
    initialSource={voiceoverInitialSource}
    publicConfig={systemConfig.voiceoverTranslation}
    onSubmit={onSubmitVoiceoverTranslation}
    onClearInitialSource={onClearVoiceoverInitialSource}
  />
</div>
```

In `ShellMigratedApp`, render `<div id="voiceover-translation-composer-slot" />` for the active subfeature and exclude both special workspaces from `BottomInputBar`:

```ts
const usesDedicatedVideoComposer = (
  activeModule === AppModuleObj.VIDEO
  && ['voiceover_translation', 'subtitle_removal'].includes(activeSubFeature)
);
```

The workspace portals its composer controls to the slot and keeps preview/config content in normal document flow.

- [ ] **Step 7: Run Task 10 tests, lint, and commit**

Run:

```bash
node --test src/services/voiceoverTranslationClient.test.mjs src/shell/components/VoiceoverTranslationWorkspace.test.mjs src/components/uiArchitecture.test.mjs
npm run lint
git diff --check
```

Expected: tests and TypeScript lint PASS.

Commit:

```bash
git add src/services/voiceoverTranslationClient.ts src/services/voiceoverTranslationClient.test.mjs src/shell/components/VoiceoverTranslationWorkspace.tsx src/shell/components/VoiceoverTranslationWorkspace.test.mjs src/ShellMigratedApp.tsx src/shell/modules/Video/VideoModule.tsx src/components/uiArchitecture.test.mjs
git commit -m "feat(video): add voiceover translation workspace"
```

### Task 11: Existing-Result Entry, Durable Hydration, and Result Experience

**Files:**

- Create: `src/shell/components/VoiceoverResultPlayer.tsx`
- Create: `src/shell/components/VoiceoverResultPlayer.test.mjs`
- Create: `src/adapters/voiceoverTranslationHydration.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/modules/Video/VideoModule.tsx`
- Modify: `src/shell/components/ProjectListView.tsx`
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/adapters/shellDataAdapter.ts`
- Modify: `src/utils/shellProjectScope.mjs`
- Modify: `src/utils/shellProjectScope.test.mjs`
- Modify: `src/components/uiArchitecture.test.mjs`

**Interfaces:**

- Add callback `onTranslateVideoVoiceover(projectId: string, resultId: string)`.
- Hydrate parent task type `voiceover_translate_video` as `module='video'`, `subFeature='voiceover_translation'`.
- Map backend stages to labels exactly:

```js
{
  input_prepared: '准备视频',
  subtitle_removal: '去除画面文案',
  audio_extracted: '提取音频',
  voice_separated: '分离原口播',
  speech_analysis_submitting: '识别原文',
  speech_analyzed: '识别原文',
  translated: '翻译口播',
  tts_generating: '生成新口播',
  audio_aligned: '对齐混音',
  result_persisted: '保存结果',
}
```

- [ ] **Step 1: Add failing scope and hydration tests**

```js
test('video scope includes voiceover translation in approved order', () => {
  assert.deepEqual(getModuleSubFeatureIds('video'), [
    'generation',
    'storyboard',
    'voiceover_translation',
    'subtitle_removal',
    'diagnosis',
  ]);
});

test('running checkpoint hydrates one durable voiceover card', () => {
  const projects = buildShellDataSnapshot({
    jobs: [voiceoverJob({
      status: 'running',
      checkpoint: {
        version: 1,
        stage: 'tts_generating',
        baseVideoAssetId: 'base-1',
      },
    })],
  }).projects;
  assert.equal(projects[0].subFeature, 'voiceover_translation');
  assert.equal(projects[0].results[0].status, 'generating');
  assert.equal(projects[0].results[0].statusText, '生成新口播');
});
```

Cover local/MySQL field aliases, source/target language, manual/automatic voice, source/translated transcripts, remove-text region, final video, source video, failed codes, cancellation, retry-waiting, tombstone non-revival, ordering, and cross-user exclusion.

- [ ] **Step 2: Run scope/hydration tests and confirm RED**

Run:

```bash
node --test src/utils/shellProjectScope.test.mjs src/adapters/voiceoverTranslationHydration.test.mjs
```

Expected: FAIL because the new subfeature is not normalized or hydrated.

- [ ] **Step 3: Implement adapter and type mapping**

Extend `GeneratedResult` with optional fields:

```ts
sourceLanguage?: string;
targetLanguage?: string;
translationMode?: 'natural' | 'literal';
voiceName?: string;
sourceTranscript?: string;
translatedTranscript?: string;
voiceoverStage?: VoiceoverCheckpointV1['stage'];
sourceUrl?: string;
videoUrl?: string;
finalAssetId?: string;
```

Only parent `voiceover_translate_video` rows create user project cards. Parent-owned `kie_tts` and Golden child rows remain diagnostic children and are not hydrated as independent user projects.

- [ ] **Step 4: Add failing existing-result entry and player tests**

Entry button is visible only when:

- result is completed,
- current user can access it,
- it has a managed `videoUrl`,
- it is not already a `voiceover_translation` project.

Clicking it calls the callback chain `ProjectCard -> ProjectListView -> VideoModule -> ShellMigratedApp`, stores source project/result IDs, switches to `voiceover_translation`, and does not mutate the original project.

Player tests assert:

- original/final toggle shares aspect ratio and pauses the hidden video.
- final download uses the managed result URL.
- transcript details render escaped text and remain collapsed by default.
- source/target language and actual selected voice render.
- no claim of voice cloning or lip sync appears.
- Range-capable URLs are used directly; no browser Blob duplication of the whole video.

- [ ] **Step 5: Implement result player and callbacks**

In `ProjectCard`, completed non-voiceover video results show `口播翻译`. Voiceover cards use `VoiceoverResultPlayer` and actions:

- cancel only while local stage is cancellable; after provider submission label explains that MEIAO stops subsequent processing but cannot promise upstream cancellation.
- retry preserves checkpoint; for `provider_submission_unknown` and `voiceover_analysis_submission_unknown`, require an explicit confirmation that a new attempt may incur another charge.
- ordinary recoverable local failures call `buildVoiceoverRetryRequest` without clearing paid IDs.
- download emits the existing business log with module/subfeature/result ID, not transcript or URL query.

- [ ] **Step 6: Run Task 11 tests and browser-static guards**

Run:

```bash
node --test src/utils/shellProjectScope.test.mjs src/adapters/voiceoverTranslationHydration.test.mjs src/shell/components/VoiceoverResultPlayer.test.mjs src/components/uiArchitecture.test.mjs
npm run lint
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shell/components/VoiceoverResultPlayer.tsx src/shell/components/VoiceoverResultPlayer.test.mjs src/adapters/voiceoverTranslationHydration.test.mjs src/ShellMigratedApp.tsx src/shell/modules/Video/VideoModule.tsx src/shell/components/ProjectListView.tsx src/shell/components/ProjectCard.tsx src/adapters/shellDataAdapter.ts src/utils/shellProjectScope.mjs src/utils/shellProjectScope.test.mjs src/components/uiArchitecture.test.mjs
git commit -m "feat(video): restore and display voiceover translation"
```

### Task 12: Probe, Documentation, Full Verification, and Minimal Local Canary

**Files:**

- Create: `scripts/probe-voiceover-translation.mjs`
- Create: `scripts/probe-voiceover-translation.test.mjs`
- Modify: `package.json`
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `项目交接上下文.md`
- Modify: `docs/release-and-handoff.md`

**Interfaces:**

- `npm run probe:voiceover-translation -- --readiness` is read-only and never calls a paid provider.
- `--fixture-path "$MEIAO_VOICEOVER_FIXTURE_PATH"` runs local media/Demucs/FFmpeg validation without Gemini, Golden, or KIE.
- `--live --source-asset-id "$MEIAO_VOICEOVER_CANARY_ASSET_ID" --target-language en` is the only mode that can create paid tasks and requires `MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1`; `--remove-text` explicitly adds the Golden stage.
- `--resume-parent-job-id "$MEIAO_VOICEOVER_PARENT_JOB_ID"` and `--resume-child-task-id "$MEIAO_VOICEOVER_CHILD_TASK_ID"` are query/recovery-only.

- [ ] **Step 1: Add failing probe safety tests**

```js
test('default and readiness modes cannot create provider tasks', async () => {
  for (const args of [[], ['--readiness']]) {
    const deps = probeDeps({ rejectPaidCall: true });
    const result = await runVoiceoverProbe(args, deps);
    assert.equal(result.exitCode, 0);
    assert.equal(deps.calls.providerCreate, 0);
  }
});

test('live mode requires an explicit confirmation env', async () => {
  const result = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'asset-1',
    '--target-language', 'en',
  ], probeDeps({ env: {} }));
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1/);
});
```

Also test task-ID resume never creates, stdout/stderr redact query strings and secrets, readiness prints booleans only, and `--remove-text` reports the added Golden charge boundary before confirmation.

- [ ] **Step 2: Run probe tests and confirm RED**

Run: `node --test scripts/probe-voiceover-translation.test.mjs`

Expected: FAIL because the probe does not exist.

- [ ] **Step 3: Implement probe modes and package script**

Add:

```json
"probe:voiceover-translation": "node scripts/probe-voiceover-translation.mjs"
```

Readiness output schema:

```json
{
  "enabled": true,
  "ready": true,
  "pythonReady": true,
  "modelReady": true,
  "ffmpegReady": true,
  "separationConcurrency": 1,
  "kieConfigured": true,
  "goldenConfigured": true
}
```

`goldenConfigured` may be false when `removeText` is not requested. Do not print Python/model directory, KIE base URL, tokens, signed URLs, transcripts, or provider response bodies.

- [ ] **Step 4: Document exact configuration and runbook**

Add these names and the Task 1 defaults/bounds to `.env.server.example` and docs:

```text
MEIAO_VOICEOVER_TRANSLATION_ENABLED
MEIAO_VOICEOVER_SEPARATION_PYTHON
MEIAO_VOICEOVER_DEMUCS_MODEL
MEIAO_VOICEOVER_DEMUCS_MODEL_DIR
MEIAO_VOICEOVER_SEPARATION_CONCURRENCY
MEIAO_VOICEOVER_SEPARATION_TIMEOUT_MS
MEIAO_VOICEOVER_MIN_ATEMPO
MEIAO_VOICEOVER_MAX_ATEMPO
MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS
MEIAO_VOICEOVER_GROUP_GAP_MS
MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS
MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND
MEIAO_VOICEOVER_DUCKING_DB
MEIAO_VOICEOVER_FADE_MS
MEIAO_VOICEOVER_DURATION_TOLERANCE_MS
MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS
MEIAO_KIE_TTS_BASE_URL
MEIAO_KIE_TTS_MODEL
MEIAO_KIE_TTS_REQUEST_TIMEOUT_MS
MEIAO_KIE_TTS_POLL_INTERVAL_MS
MEIAO_KIE_TTS_POLL_MAX_ATTEMPTS
MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS
```

Document:

- local venv/model install is an explicit operator step.
- model files remain outside Git and release directory.
- readiness must pass before enabling.
- Demucs local compute is not a third-party per-call charge.
- Gemini analysis, KIE TTS, and optional Golden may charge.
- production sizing and deployment require a separate user confirmation.
- rollback is disabling new submissions; historical results remain available.

- [ ] **Step 5: Run all focused tests**

Run:

```bash
node --test \
  src/utils/voiceoverCatalog.test.mjs \
  server/voiceoverContract.test.mjs \
  server/mediaTranscodeContract.test.mjs \
  server/mediaTranscodeSessionStore.test.mjs \
  server/mediaTranscodeApi.test.mjs \
  server/mediaTranscodeService.test.mjs \
  server/assetStore.test.mjs \
  scripts/install-voiceover-demucs.test.mjs \
  server/voiceoverSeparation.test.mjs \
  server/voiceoverAnalysis.test.mjs \
  server/providerKieTts.test.mjs \
  server/voiceoverAudio.test.mjs \
  server/voiceoverChildJobStore.test.mjs \
  server/voiceoverTranslationRunner.test.mjs \
  server/jobSubmissionPolicy.test.mjs \
  server/jobRuntime.test.mjs \
  server/localJobStore.test.mjs \
  server/jobManager.test.mjs \
  server/temporalWorker.test.mjs \
  src/services/mediaTranscodeClient.test.mjs \
  src/services/voiceoverTranslationClient.test.mjs \
  src/shell/components/VoiceoverTranslationWorkspace.test.mjs \
  src/shell/components/VoiceoverResultPlayer.test.mjs \
  src/adapters/voiceoverTranslationHydration.test.mjs \
  src/utils/shellProjectScope.test.mjs \
  src/components/uiArchitecture.test.mjs \
  scripts/probe-voiceover-translation.test.mjs
```

Expected: all focused tests PASS.

- [ ] **Step 6: Run project gates and final harness**

Run:

```bash
npm run lint
npm run build
npm run doctor
npm run verify
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs \
  --changed server/voiceoverTranslationRunner.mjs \
  --changed server/voiceoverChildJobStore.mjs \
  --changed server/providerKieTts.mjs \
  --changed server/jobManager.mjs \
  --changed server/localJobStore.mjs \
  --changed server/temporalWorker.mjs \
  --changed server/assetStore.mjs \
  --changed server/index.mjs \
  --changed src/ShellMigratedApp.tsx \
  --changed src/adapters/shellDataAdapter.ts
git diff --check
```

Expected:

- lint, build, doctor, and verify exit 0.
- harness has no blocking violation.
- no secret, model weight, venv, temporary media, or generated provider response appears in `git status --short`.

- [ ] **Step 7: Run local readiness and non-paid fixture probe**

Run:

```bash
npm run probe:voiceover-translation -- --readiness
test -n "$MEIAO_VOICEOVER_FIXTURE_PATH"
npm run probe:voiceover-translation -- --fixture-path "$MEIAO_VOICEOVER_FIXTURE_PATH"
```

Expected:

- readiness is true after the explicit local install.
- fixture validates H.264/AAC input, Demucs outputs, vocal-only analysis media, alignment, ducking, final H.264/AAC MP4, duration tolerance, `ftyp`, and Range behavior.
- provider create call count remains zero.

- [ ] **Step 8: Run minimal real-provider canary only with explicit confirmation**

Use a short, owned, single-speaker video with background music. The operator first exports its confirmed managed asset ID as `MEIAO_VOICEOVER_CANARY_ASSET_ID`; the probe rejects an empty value. Set the one-shot confirmation only for the command:

```bash
test -n "$MEIAO_VOICEOVER_CANARY_ASSET_ID"
MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1 \
npm run probe:voiceover-translation -- \
  --live \
  --source-asset-id "$MEIAO_VOICEOVER_CANARY_ASSET_ID" \
  --target-language en
```

The implementation worker must use only that user-confirmed managed asset ID; it must not guess, discover another user's asset, or use a public URL.

Record separately:

- technical evidence: parent/child IDs, checkpoint sequence, one Gemini call, one KIE TTS create per group, managed final asset, H.264/AAC/Range, refresh and local service restart recovery.
- perceptual evidence: original speech no longer intelligible, background music/ambient sound preserved, target language correct, voice timing acceptable, video unchanged.

Run the optional Golden canary only after a second explicit cost confirmation:

```bash
MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1 \
npm run probe:voiceover-translation -- \
  --live \
  --source-asset-id "$MEIAO_VOICEOVER_CANARY_ASSET_ID" \
  --target-language en \
  --remove-text
```

- [ ] **Step 9: Perform real browser acceptance**

Start the local app with `npm run local` and verify at default viewport and 820 px width:

1. 「短视频 → 口播翻译」 order and dedicated workspace.
2. local upload and existing-result entry.
3. target language, more languages, natural/literal, auto/manual voice.
4. remove-text default bottom 30% region, drag, and resize.
5. paid-stage confirmation and duplicate-click lock.
6. real stage progression and durable card after refresh.
7. original/final playback, transcript details, selected voice, download.
8. cancellation explanation and safe retry confirmation.
9. no clipped content or fixed-height nested page scroll.

Capture browser observations separately from automated/provider evidence.

- [ ] **Step 10: Commit probe and documentation**

Run `git status --short`, stage only the named files, then:

```bash
git add scripts/probe-voiceover-translation.mjs scripts/probe-voiceover-translation.test.mjs package.json .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md 项目交接上下文.md docs/release-and-handoff.md
git commit -m "docs(video): add voiceover translation runbook"
```

Do not push or deploy.

---

## Appendix A: Gemini 3.1 Flash TTS Language Catalog

The implementation must encode this ordered snapshot. `common=true` only for the ten entries marked below.

| Code | English name | 中文名称 | Common |
|---|---|---|---|
| `cmn` | Chinese Mandarin | 中文（普通话） | yes |
| `en` | English | 英语 | yes |
| `ja` | Japanese | 日语 | yes |
| `ko` | Korean | 韩语 | yes |
| `es` | Spanish | 西班牙语 | yes |
| `pt` | Portuguese | 葡萄牙语 | yes |
| `fr` | French | 法语 | yes |
| `de` | German | 德语 | yes |
| `ar` | Arabic | 阿拉伯语 | yes |
| `ru` | Russian | 俄语 | yes |
| `bn` | Bangla | 孟加拉语 | no |
| `nl` | Dutch | 荷兰语 | no |
| `hi` | Hindi | 印地语 | no |
| `id` | Indonesian | 印度尼西亚语 | no |
| `it` | Italian | 意大利语 | no |
| `mr` | Marathi | 马拉地语 | no |
| `pl` | Polish | 波兰语 | no |
| `ro` | Romanian | 罗马尼亚语 | no |
| `ta` | Tamil | 泰米尔语 | no |
| `te` | Telugu | 泰卢固语 | no |
| `th` | Thai | 泰语 | no |
| `tr` | Turkish | 土耳其语 | no |
| `uk` | Ukrainian | 乌克兰语 | no |
| `vi` | Vietnamese | 越南语 | no |
| `af` | Afrikaans | 南非语 | no |
| `sq` | Albanian | 阿尔巴尼亚语 | no |
| `am` | Amharic | 阿姆哈拉语 | no |
| `hy` | Armenian | 亚美尼亚语 | no |
| `az` | Azerbaijani | 阿塞拜疆语 | no |
| `eu` | Basque | 巴斯克语 | no |
| `be` | Belarusian | 白俄罗斯语 | no |
| `bg` | Bulgarian | 保加利亚语 | no |
| `my` | Burmese | 缅甸语 | no |
| `ca` | Catalan | 加泰罗尼亚语 | no |
| `ceb` | Cebuano | 宿务语 | no |
| `hr` | Croatian | 克罗地亚语 | no |
| `cs` | Czech | 捷克语 | no |
| `da` | Danish | 丹麦语 | no |
| `et` | Estonian | 爱沙尼亚语 | no |
| `fil` | Filipino | 菲律宾语 | no |
| `fi` | Finnish | 芬兰语 | no |
| `gl` | Galician | 加利西亚语 | no |
| `ka` | Georgian | 格鲁吉亚语 | no |
| `el` | Greek | 希腊语 | no |
| `gu` | Gujarati | 古吉拉特语 | no |
| `ht` | Haitian Creole | 海地克里奥尔语 | no |
| `he` | Hebrew | 希伯来语 | no |
| `hu` | Hungarian | 匈牙利语 | no |
| `is` | Icelandic | 冰岛语 | no |
| `jv` | Javanese | 爪哇语 | no |
| `kn` | Kannada | 卡纳达语 | no |
| `kok` | Konkani | 孔卡尼语 | no |
| `lo` | Lao | 老挝语 | no |
| `la` | Latin | 拉丁语 | no |
| `lv` | Latvian | 拉脱维亚语 | no |
| `lt` | Lithuanian | 立陶宛语 | no |
| `lb` | Luxembourgish | 卢森堡语 | no |
| `mk` | Macedonian | 马其顿语 | no |
| `mai` | Maithili | 迈蒂利语 | no |
| `mg` | Malagasy | 马达加斯加语 | no |
| `ms` | Malay | 马来语 | no |
| `ml` | Malayalam | 马拉雅拉姆语 | no |
| `mn` | Mongolian | 蒙古语 | no |
| `ne` | Nepali | 尼泊尔语 | no |
| `nb` | Norwegian Bokmål | 挪威博克马尔语 | no |
| `nn` | Norwegian Nynorsk | 挪威尼诺斯克语 | no |
| `or` | Odia | 奥里亚语 | no |
| `ps` | Pashto | 普什图语 | no |
| `fa` | Persian | 波斯语 | no |
| `pa` | Punjabi | 旁遮普语 | no |
| `sr` | Serbian | 塞尔维亚语 | no |
| `sd` | Sindhi | 信德语 | no |
| `si` | Sinhala | 僧伽罗语 | no |
| `sk` | Slovak | 斯洛伐克语 | no |
| `sl` | Slovenian | 斯洛文尼亚语 | no |
| `sw` | Swahili | 斯瓦希里语 | no |
| `sv` | Swedish | 瑞典语 | no |
| `ur` | Urdu | 乌尔都语 | no |

The source docs list Arabic before Bangla and Mandarin later. The product catalog intentionally moves the ten common languages to the top while preserving official order within the remaining entries.

## Appendix B: Gemini Preset Voice Catalog

| Voice | Official trait |
|---|---|
| `Zephyr` | Bright |
| `Puck` | Upbeat |
| `Charon` | Informative |
| `Kore` | Firm |
| `Fenrir` | Excitable |
| `Leda` | Youthful |
| `Orus` | Firm |
| `Aoede` | Breezy |
| `Callirrhoe` | Easy-going |
| `Autonoe` | Bright |
| `Enceladus` | Breathy |
| `Iapetus` | Clear |
| `Umbriel` | Easy-going |
| `Algieba` | Smooth |
| `Despina` | Smooth |
| `Erinome` | Clear |
| `Algenib` | Gravelly |
| `Rasalgethi` | Informative |
| `Laomedeia` | Upbeat |
| `Achernar` | Soft |
| `Alnilam` | Firm |
| `Schedar` | Even |
| `Gacrux` | Mature |
| `Pulcherrima` | Forward |
| `Achird` | Friendly |
| `Zubenelgenubi` | Casual |
| `Vindemiatrix` | Gentle |
| `Sadachbia` | Lively |
| `Sadaltager` | Knowledgeable |
| `Sulafat` | Warm |

## Spec Coverage Matrix

| Approved design section | Implementation task |
|---|---|
| 1–3 goal, decisions, scope | Global Constraints; Tasks 1, 9, 10, 11 |
| 4 user flow | Tasks 10, 11, 12 |
| 5 frontend design | Tasks 1, 2, 10, 11 |
| 6 parent/child/checkpoint contract | Tasks 1, 6, 8, 9 |
| 7 local Demucs | Task 4 |
| 8 analysis, languages, voice selection | Tasks 1, 5; Appendices A–B |
| 9 KIE TTS | Tasks 3, 6, 8, 9 |
| 10 alignment and mixing | Task 7 |
| 11 intermediate lifecycle | Task 3 and Task 9 |
| 12 cancel, failure, retry | Tasks 6, 8, 9, 11 |
| 13 permissions, security, logging | Global Constraints; Tasks 3, 4, 8, 9, 12 |
| 14 billing boundary | Global Constraints; Tasks 6, 8, 9, 10, 12 |
| 15 test strategy | Every task's RED/GREEN checks |
| 16 local acceptance | Task 12 |
| 17 docs and release boundary | Task 12 |
| 18 success criteria | Task 12 Steps 5–9 |
