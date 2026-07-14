# Short Video Media Transcode and Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-safe video/audio trim-and-transcode flow that normalizes every short-video reference upload before it becomes a managed asset or Seedance task input.

**Architecture:** The browser opens one shared trim dialog and uploads the selected source into a user-owned temporary server session. FFprobe supplies authoritative metadata; after the user chooses a 2–15 second range, server-side FFmpeg emits canonical MP4/H.264/AAC or MP3 output, validates it again, and only then persists it as a managed asset. Existing paid job creation remains downstream and cannot run while media preparation is incomplete.

**Tech Stack:** React 19, TypeScript, Radix Slider, Node.js ESM, Node test runner, FFmpeg/FFprobe static runtime with environment overrides, existing managed asset storage and Seedance provider gateway.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-14-media-transcode-and-trim-design.md`.
- Video output is MP4 + H.264 + optional AAC + `yuv420p` + faststart, 720p-class canvas, 30 FPS, 2–15 seconds, at most 50 MB.
- Audio output is MP3, 2–15 seconds, at most 15 MB.
- Reference videos and reference audios each allow at most 3 files and at most 15 seconds total per task.
- Never auto-trim the first 15 seconds; the user selects the retained interval.
- Preserve the entire source frame. Ratios outside 0.4–2.5 use centered padding, never stretch or crop the subject.
- Source files stay temporary until conversion passes; no source upload to stored assets, COS, KIE, job records, or app state.
- Conversion failure/cancel must not create a Seedance job, reserve credits, or write a failed project card.
- Capacity, concurrency, TTL, and timeout values are environment-controlled with conservative defaults.
- Preserve all pre-existing dirty-worktree changes; stage only files/hunks owned by this feature.
- Do not deploy or create a paid Seedance smoke task in this plan.

---

## File Structure

- `server/mediaTranscodeContract.mjs`: pure Seedance media limits, trim validation, target canvas calculation, output validation, FFmpeg argument construction.
- `server/mediaTranscodeService.mjs`: binary resolution, FFprobe/FFmpeg subprocess execution, cancellation, concurrency gate, and runtime status.
- `server/mediaTranscodeSessionStore.mjs`: disk-backed temporary sessions, ownership, TTL, and cleanup.
- `server/mediaTranscodeApi.mjs`: session creation/conversion/cancellation orchestration with injectable persistence and logging.
- `src/services/mediaTranscodeClient.ts`: authenticated create/convert/cancel API calls.
- `src/utils/mediaTrimRules.mjs`: browser-side count/duration budgeting and queue rules.
- `src/shell/components/MediaTrimTranscodeDialog.tsx`: real preview, Radix two-thumb trim slider, conversion status, and theme-aligned layout.
- `src/ShellMigratedApp.tsx`: production upload interception, queue ownership, and successful-material insertion.
- `src/shell/components/layout/BottomInputBar.tsx`: hover/tap contract hints for reference video/audio upload entries.
- `src/adapters/shellWorkflow.ts` and `server/providerGateway.mjs`: task-time count/duration defense in depth.

### Task 1: Media Contract and FFmpeg Runtime

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `server/mediaTranscodeContract.mjs`
- Create: `server/mediaTranscodeContract.test.mjs`
- Create: `server/mediaTranscodeService.mjs`
- Create: `server/mediaTranscodeService.test.mjs`

**Interfaces:**
- Produces: `MEDIA_LIMITS`, `validateTrimRange(input)`, `calculateVideoCanvas(input)`, `buildVideoTranscodeArgs(input)`, `buildAudioTranscodeArgs(input)`, `validateTranscodedOutput(kind, metadata)`.
- Produces: `createMediaTranscodeService(options)` with `probe(path, signal)`, `transcode(input)`, `cancel(sessionId)`, `getStatus()`, and `checkReadiness()`.

- [ ] **Step 1: Add failing contract tests**

```js
test('calculateVideoCanvas preserves portrait ratio inside Seedance pixel limits', () => {
  assert.deepEqual(calculateVideoCanvas({ width: 1080, height: 1920 }), {
    width: 720,
    height: 1280,
    padded: false,
  });
});

test('calculateVideoCanvas pads ratios narrower than 0.4 without cropping', () => {
  const result = calculateVideoCanvas({ width: 300, height: 1200 });
  assert.equal(result.width / result.height, 0.4);
  assert.equal(result.padded, true);
});

test('validateTrimRange rejects automatic overlong selections', () => {
  assert.throws(
    () => validateTrimRange({ durationSeconds: 30, startSeconds: 0, endSeconds: 15.1 }),
    /不能超过 15 秒/,
  );
});
```

- [ ] **Step 2: Run the contract tests and confirm RED**

Run: `node --test server/mediaTranscodeContract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `mediaTranscodeContract.mjs`.

- [ ] **Step 3: Implement the pure contract**

```js
export const MEDIA_LIMITS = Object.freeze({
  video: { minSeconds: 2, maxSeconds: 15, maxFiles: 3, maxTotalSeconds: 15, maxBytes: 50 * 1024 * 1024 },
  audio: { minSeconds: 2, maxSeconds: 15, maxFiles: 3, maxTotalSeconds: 15, maxBytes: 15 * 1024 * 1024 },
});

export const validateTrimRange = ({ durationSeconds, startSeconds, endSeconds }) => {
  const selected = Number(endSeconds) - Number(startSeconds);
  if (selected < 2) throw createMediaError('media_trim_too_short', '裁剪片段不能少于 2 秒');
  if (selected > 15) throw createMediaError('media_trim_too_long', '裁剪片段不能超过 15 秒');
  if (startSeconds < 0 || endSeconds > durationSeconds) throw createMediaError('media_trim_out_of_bounds', '裁剪范围超出素材时长');
  return { startSeconds: Number(startSeconds), endSeconds: Number(endSeconds), durationSeconds: selected };
};
```

`calculateVideoCanvas` must use a 720px preferred short edge, cap the long edge at 1280px, round both dimensions to even integers, and pad only when the source ratio is outside 0.4–2.5. `buildVideoTranscodeArgs` must emit `libx264`, `yuv420p`, `30`, `aac` when an audio stream exists, `-movflags +faststart`, and a scale/pad filter derived from the calculated canvas. `buildAudioTranscodeArgs` must emit `libmp3lame`, 44.1 kHz, stereo, and 192 kbps.

- [ ] **Step 4: Run contract tests and confirm GREEN**

Run: `node --test server/mediaTranscodeContract.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Add the static runtime dependencies and failing service tests**

Add production dependencies `ffmpeg-static` and `ffprobe-static`. Resolve binaries in this exact order:

```js
const ffmpegPath = env.MEIAO_FFMPEG_PATH || packagedFfmpegPath || 'ffmpeg';
const ffprobePath = env.MEIAO_FFPROBE_PATH || packagedFfprobePath || 'ffprobe';
```

Service tests inject a fake `spawnProcess` and assert:

```js
test('transcode releases its concurrency permit after cancellation', async () => {
  const service = createMediaTranscodeService({ concurrency: 1, spawnProcess: fakeBlockingSpawn });
  const pending = service.transcode({ sessionId: 's1', kind: 'audio', inputPath: '/tmp/in.wav', outputPath: '/tmp/out.mp3', startSeconds: 0, endSeconds: 3 });
  await service.cancel('s1');
  await assert.rejects(pending, /已取消/);
  assert.equal(service.getStatus().active, 0);
});
```

- [ ] **Step 6: Run service tests and confirm RED**

Run: `node --test server/mediaTranscodeService.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `mediaTranscodeService.mjs`.

- [ ] **Step 7: Implement binary readiness, probe, transcode, timeout, and cancellation**

The service must parse FFprobe JSON into:

```ts
type MediaProbe = {
  kind: 'video' | 'audio';
  durationSeconds: number;
  formatNames: string[];
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  sizeBytes: number;
  hasAudio: boolean;
};
```

Never pass shell strings. Use `spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })`, keep the child in `activeChildrenBySessionId`, kill it on abort/cancel/timeout, and release the semaphore permit in `finally`.

- [ ] **Step 8: Run Task 1 tests and commit**

Run: `node --test server/mediaTranscodeContract.test.mjs server/mediaTranscodeService.test.mjs`

Expected: PASS.

```bash
git add package.json package-lock.json server/mediaTranscodeContract.mjs server/mediaTranscodeContract.test.mjs server/mediaTranscodeService.mjs server/mediaTranscodeService.test.mjs
git commit -m "feat: add media transcode runtime"
```

### Task 2: Temporary Sessions and Shared API Orchestration

**Files:**
- Create: `server/mediaTranscodeSessionStore.mjs`
- Create: `server/mediaTranscodeSessionStore.test.mjs`
- Create: `server/mediaTranscodeApi.mjs`
- Create: `server/mediaTranscodeApi.test.mjs`
- Modify: `server/index.mjs`
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `server/envDocumentationSource.test.mjs`

**Interfaces:**
- Consumes: `createMediaTranscodeService`, `validateTrimRange`, `validateTranscodedOutput`.
- Produces: `createMediaTranscodeSessionStore(options)` with `create`, `getOwned`, `markConverting`, `remove`, `cleanupExpired`, `count`.
- Produces: `createMediaTranscodeApi({ store, service, persistAsset, log })` with `createSession`, `convertSession`, `cancelSession`, `status`, `readiness`.

- [ ] **Step 1: Write failing disk-session tests**

```js
test('a session can only be read by its owner and expires by TTL', async () => {
  const clock = { now: () => 1_000 };
  const store = createMediaTranscodeSessionStore({ rootDir, ttlMs: 10_000, clock });
  const created = await store.create({ userId: 'u1', kind: 'video', fileName: 'source.mov', fileBuffer: Buffer.from('x'), probe });
  await assert.rejects(() => store.getOwned(created.id, 'u2'), /无权访问/);
  clock.now = () => 12_000;
  assert.equal((await store.cleanupExpired()).removed, 1);
});
```

- [ ] **Step 2: Run session tests and confirm RED**

Run: `node --test server/mediaTranscodeSessionStore.test.mjs`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement disk-backed sessions**

Store each source under `<root>/<randomUUID>/source` and a sidecar `session.json` containing only session id, user id, media kind, sanitized original name, created/updated timestamps, conversion state, and probe metadata. Reject IDs that are not UUIDs before path resolution. Write sidecars atomically. `remove` must delete only the resolved child directory beneath the configured root.

- [ ] **Step 4: Add failing API orchestration tests**

```js
test('conversion persists only the validated canonical output', async () => {
  const api = createMediaTranscodeApi({ store, service, persistAsset, log });
  const result = await api.convertSession({ userId: 'u1', sessionId: 's1', startSeconds: 1, endSeconds: 6, module: 'video' });
  assert.equal(persistAsset.mock.calls.length, 1);
  assert.equal(persistAsset.mock.calls[0].mimeType, 'video/mp4');
  assert.equal(result.durationSeconds, 5);
  assert.equal(await store.count(), 0);
});

test('failed conversion never persists or logs success', async () => {
  service.transcode = async () => { throw mediaError('media_transcode_failed'); };
  await assert.rejects(() => api.convertSession(request));
  assert.equal(persistAsset.mock.calls.length, 0);
  assert.equal(log.mock.calls.at(-1).action, 'media_transcode_failed');
});
```

- [ ] **Step 5: Run API tests and confirm RED**

Run: `node --test server/mediaTranscodeApi.test.mjs`

Expected: FAIL with missing module.

- [ ] **Step 6: Implement API orchestration**

`createSession` probes before returning. `convertSession` must:

```js
const session = await store.getOwned(sessionId, userId);
const trim = validateTrimRange({ durationSeconds: session.probe.durationSeconds, startSeconds, endSeconds });
const output = await service.transcode({ sessionId, kind: session.kind, inputPath: session.sourcePath, ...trim });
validateTranscodedOutput(session.kind, output.probe);
const persisted = await persistAsset({ userId, module, fileBuffer: output.fileBuffer, fileName: output.fileName, mimeType: output.mimeType, metadata: output.probe });
await store.remove(sessionId);
return { ...persisted, ...publicProbeFields(output.probe), fileName: output.fileName, mimeType: output.mimeType };
```

Use a `finally` block that removes failed/cancelled sessions and output files. Log only non-sensitive metadata.

- [ ] **Step 7: Add shared HTTP helpers and both auth-mode routes**

Create one set of handler functions near the existing asset persistence helpers in `server/index.mjs`, then call them from both the MySQL and local JSON route sections:

```js
POST   /api/media-transcodes/sessions
POST   /api/media-transcodes/sessions/:id/convert
DELETE /api/media-transcodes/sessions/:id
```

For session creation, reject `Content-Length` above `MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES` before calling `readMultipartFormData`. For conversion, call `readBody(req, { maxBytes: 64 * 1024 })`. Persist canonical output through `persistAssetBuffer` with `assetType: 'source'`, never through KIE upload.

- [ ] **Step 8: Add environment controls and health status**

Document and implement:

```dotenv
MEIAO_MEDIA_TRANSCODE_ENABLED=0
MEIAO_FFMPEG_PATH=
MEIAO_FFPROBE_PATH=
MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES=209715200
MEIAO_MEDIA_TRANSCODE_CONCURRENCY=1
MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS=600000
MEIAO_MEDIA_PROBE_TIMEOUT_MS=30000
MEIAO_MEDIA_TRANSCODE_SESSION_TTL_MS=1800000
MEIAO_MEDIA_TRANSCODE_MAX_SESSIONS=20
```

Expose only `{ enabled, ffmpegReady, ffprobeReady, active, queued, sessions }` under `/api/health.mediaTranscode`.

- [ ] **Step 9: Run Task 2 tests and commit only owned hunks**

Run: `node --test server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeApi.test.mjs server/envDocumentationSource.test.mjs`

Expected: PASS.

```bash
git add server/mediaTranscodeSessionStore.mjs server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeApi.mjs server/mediaTranscodeApi.test.mjs
git add -p server/index.mjs .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md server/envDocumentationSource.test.mjs
git commit -m "feat: add managed media transcode sessions"
```

### Task 3: Browser Client and Pure Trim Rules

**Files:**
- Create: `src/services/mediaTranscodeClient.ts`
- Create: `src/utils/mediaTrimRules.mjs`
- Create: `src/utils/mediaTrimRules.test.mjs`
- Modify: `src/ShellMigratedApp.tsx` (Material metadata only in this task)

**Interfaces:**
- Produces: `createMediaTranscodeSession`, `convertMediaTranscodeSession`, `cancelMediaTranscodeSession`.
- Produces: `getMediaBudget`, `validateMediaQueueSelection`, `normalizeTrimSelection`.
- Adds to `Material`: `mimeType?: string`, `durationSeconds?: number`, `frameRate?: number`, `mediaTranscoded?: boolean`.

- [ ] **Step 1: Write failing pure-rule tests**

```js
test('remaining duration subtracts existing canonical media', () => {
  assert.deepEqual(getMediaBudget([{ durationSeconds: 6 }, { durationSeconds: 4 }]), {
    usedSeconds: 10,
    remainingSeconds: 5,
    remainingFiles: 1,
  });
});

test('selection rejects a fourth reference audio before upload', () => {
  assert.throws(() => validateMediaQueueSelection({ existing: [{}, {}, {}], incomingCount: 1 }), /最多上传 3 个/);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test src/utils/mediaTrimRules.test.mjs`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement pure rules and typed client**

The create call sends multipart `file` and `kind`; convert sends JSON range/module; cancel uses DELETE. All calls pass the session token, a caller `AbortSignal`, and a 10-minute conversion timeout. Return these exact types:

```ts
export type MediaTranscodeProbe = { sessionId: string; kind: 'video'|'audio'; durationSeconds: number; formatNames: string[]; videoCodec?: string; audioCodec?: string; width?: number; height?: number; frameRate?: number; sizeBytes: number; };
export type MediaTranscodeResult = { fileUrl: string; assetId?: string; fileName: string; mimeType: string; durationSeconds: number; width?: number; height?: number; frameRate?: number; sizeBytes: number; };
```

- [ ] **Step 4: Run tests, typecheck, and commit**

Run: `node --experimental-strip-types --test src/utils/mediaTrimRules.test.mjs && npx tsc -b`

Expected: PASS and zero TypeScript errors.

```bash
git add src/services/mediaTranscodeClient.ts src/utils/mediaTrimRules.mjs src/utils/mediaTrimRules.test.mjs
git add -p src/ShellMigratedApp.tsx
git commit -m "feat: add media trim client rules"
```

### Task 4: Real Trim Dialog

**Files:**
- Create: `src/shell/components/MediaTrimTranscodeDialog.tsx`
- Create: `src/shell/components/MediaTrimTranscodeDialog.test.mjs`
- Modify: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Consumes: Task 3 client/probe/result types and `normalizeTrimSelection`.
- Produces: `<MediaTrimTranscodeDialog item budget onComplete onCancel />`.

- [ ] **Step 1: Write failing component contract tests**

Use source-structure tests plus pure callbacks to lock user-visible behavior:

```js
assert.match(source, /Slider\.Root/);
assert.match(source, /minStepsBetweenThumbs/);
assert.match(source, /object-contain/);
assert.match(source, /转换并继续/);
assert.match(source, /正在分析素材|转换中|保存素材中/);
assert.match(source, /var\(--bg-base\)/);
assert.match(source, /var\(--accent\)/);
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types --test src/shell/components/MediaTrimTranscodeDialog.test.mjs`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the dialog state machine**

Use states `uploading | ready | converting | completed | error`. Open immediately with an object URL. Call `createMediaTranscodeSession` once; initialize `[start,end]` to `[0, min(duration, remainingBudget, 15)]`; require at least 2 seconds. Use Radix Slider with two thumbs and `step={0.1}`. Seeking either thumb updates `video.currentTime` or `audio.currentTime` when browser preview is available.

The modal uses the current shell pattern:

```tsx
<div className="fixed inset-0 z-[520] flex items-center justify-center p-5" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(10px)' }}>
  <div className="w-full max-w-[720px] overflow-hidden rounded-[28px] border" style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
```

Keep preview height within `min(46vh, 360px)` and use `object-contain`. Audio occupies the same preview area with decorative waveform bars. Disable close and slider while conversion is running; cancellation before conversion deletes the server session.

- [ ] **Step 4: Add accessible labels and contract tooltip copy**

Every thumb must have an `aria-label`; status changes use `aria-live="polite"`; error text explains the next action. Do not expose paths or raw FFmpeg stderr.

- [ ] **Step 5: Run component tests and build**

Run: `node --experimental-strip-types --test src/shell/components/MediaTrimTranscodeDialog.test.mjs src/components/uiArchitecture.test.mjs && npm run build`

Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/shell/components/MediaTrimTranscodeDialog.tsx src/shell/components/MediaTrimTranscodeDialog.test.mjs src/components/uiArchitecture.test.mjs
git commit -m "feat: add media trim dialog"
```

### Task 5: Production Upload Integration and Provider Guardrails

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `src/components/uiArchitecture.test.mjs`
- Modify: `src/shell/modules/Video/storyboardImportUtils.test.mjs`

**Interfaces:**
- Consumes: Tasks 3–4 queue rules, client, dialog, and canonical result.
- Produces: canonical `Material` objects, task payload fields `referenceVideoDurations` / `referenceAudioDurations`, and pure backend guard `assertSeedanceReferenceMediaContract(input)`.

- [ ] **Step 1: Write failing upload-interception tests**

Lock these behaviors in source/behavior tests:

```js
assert.match(shellSource, /activeModule === AppModuleObj\.VIDEO/);
assert.match(shellSource, /type === 'referenceVideo' \|\| type === 'audio'/);
assert.match(shellSource, /MediaTrimTranscodeDialog/);
assert.match(bottomInputSource, /视频格式：MP4、MOV/);
assert.match(bottomInputSource, /音频格式：WAV、MP3/);
assert.match(workflowSource, /referenceVideoDurations/);
assert.match(workflowSource, /referenceAudioDurations/);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --experimental-strip-types --test src/components/uiArchitecture.test.mjs src/shell/modules/Video/storyboardImportUtils.test.mjs`

Expected: FAIL on missing canonical media flow markers.

- [ ] **Step 3: Add the queue in ShellMigratedApp**

When `activeModule===VIDEO` and type is `referenceVideo` or `audio`, `handleMaterialUpload` must enqueue files and return before draft storage or `uploadMaterialToManagedUrl`. Store module, subfeature, type, file, and stable queue id per item. Render one dialog for the head item.

On success, insert only the canonical result:

```ts
const material: Material = {
  id: queueItem.id,
  type: queueItem.type,
  url: result.fileUrl,
  remoteUrl: result.fileUrl,
  fileName: result.fileName,
  mimeType: result.mimeType,
  durationSeconds: result.durationSeconds,
  frameRate: result.frameRate,
  originalWidth: result.width,
  originalHeight: result.height,
  mediaTranscoded: true,
  subFeature: queueItem.subFeature,
};
```

Do not create `localAssetId` for the source file and do not call the old upload coordinator for it.

- [ ] **Step 4: Add hover/tap limit hints**

In the reference video and audio upload choices, render an information icon with a native title plus an in-app hover/focus popover. Copy must include all Seedance limits from the spec. Keep the existing broad `accept="video/*"` and `accept="audio/*"`.

- [ ] **Step 5: Add task-time duration metadata and server validation**

In `runShellVideoGeneration`, derive:

```js
referenceVideoDurations: collectMaterialDurations(input.materials.referenceVideo),
referenceAudioDurations: collectMaterialDurations(input.materials.audio),
```

Before KIE submission, reject more than 3 URLs, any supplied duration outside 2–15, or supplied totals above 15. Do not silently slice invalid lists. Keep existing managed URL resolution and paid submission rules unchanged.

- [ ] **Step 6: Add provider tests**

```js
test('Seedance rejects four reference videos before media resolution', () => {
  assert.throws(
    () => assertSeedanceReferenceMediaContract({ videoUrls: ['v1', 'v2', 'v3', 'v4'], videoDurations: [2, 2, 2, 2] }),
    (error) => error?.code === 'provider_bad_request' && /最多 3 个/.test(error.message),
  );
});

test('Seedance rejects supplied reference audio durations totaling over 15 seconds', () => {
  assert.throws(
    () => assertSeedanceReferenceMediaContract({ audioUrls: ['a1', 'a2'], audioDurations: [8, 8] }),
    (error) => error?.code === 'provider_bad_request' && /总时长不能超过 15 秒/.test(error.message),
  );
});

test('Seedance accepts three canonical references totaling exactly 15 seconds', () => {
  assert.doesNotThrow(() => assertSeedanceReferenceMediaContract({
    videoUrls: ['v1', 'v2', 'v3'],
    videoDurations: [5, 5, 5],
    audioUrls: ['a1'],
    audioDurations: [15],
  }));
});
```

- [ ] **Step 7: Run focused integration tests and commit**

Run: `node --test server/providerGateway.test.mjs`

Run: `node --experimental-strip-types --test src/components/uiArchitecture.test.mjs src/shell/modules/Video/storyboardImportUtils.test.mjs`

Expected: PASS.

```bash
git add src/ShellMigratedApp.tsx src/shell/components/layout/BottomInputBar.tsx src/adapters/shellWorkflow.ts server/providerGateway.mjs server/providerGateway.test.mjs src/components/uiArchitecture.test.mjs src/shell/modules/Video/storyboardImportUtils.test.mjs
git commit -m "feat: normalize short video media uploads"
```

### Task 6: Real Binary Probe, Documentation, and Full Verification

**Files:**
- Create: `scripts/probe-media-transcode.mjs`
- Create: `scripts/probe-media-transcode.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `.env.server.example`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: `npm run probe:media-transcode`, a no-provider/no-credit real FFmpeg probe.

- [ ] **Step 1: Write the probe contract test**

The script must create inputs under a temporary directory, run through the same service functions, validate outputs with FFprobe, and clean the directory in `finally`. It must never call `/api/jobs`, KIE, COS, or external URLs.

```js
assert.match(source, /createMediaTranscodeService/);
assert.match(source, /validateTranscodedOutput/);
assert.match(source, /rm\(.+recursive: true/);
assert.doesNotMatch(source, /api\.kie\.ai|createInternalJob|\/api\/jobs/);
```

- [ ] **Step 2: Implement the real probe**

Generate a 4-second portrait test video and a 4-second WAV tone with the packaged FFmpeg. Convert the video to canonical MP4 and the WAV to MP3 using the production service. If the binary supports `libx265`, also generate a tiny HEVC source and verify decoding to H.264. Always verify output duration, codecs, dimensions/pixel range, frame rate, and file size with FFprobe.

- [ ] **Step 3: Run the real binary probe**

Run: `npm run probe:media-transcode`

Expected: JSON summary with `ok: true`, canonical video/audio metadata, and no external requests.

- [ ] **Step 4: Run targeted regression suites**

Run: `node --test server/mediaTranscodeContract.test.mjs server/mediaTranscodeService.test.mjs server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeApi.test.mjs server/providerGateway.test.mjs server/assetStore.test.mjs`

Run: `node --experimental-strip-types --test src/utils/mediaTrimRules.test.mjs src/shell/components/MediaTrimTranscodeDialog.test.mjs src/components/uiArchitecture.test.mjs src/shell/modules/Video/storyboardImportUtils.test.mjs`

Expected: all PASS.

- [ ] **Step 5: Run full verification**

Run: `npm run verify`

Expected: lint, all tests, TypeScript, and Vite build PASS.

- [ ] **Step 6: Review the complete diff against paid-task safety**

Confirm with `git diff --check` and focused searches:

```bash
rg -n "media-transcodes|mediaTranscoded|referenceVideoDurations|referenceAudioDurations" src server
rg -n "createInternalJob|reserve|credits" server/mediaTranscode*.mjs src/services/mediaTranscodeClient.ts
```

Expected: the second search has no paid-job or credit calls.

- [ ] **Step 7: Commit the probe and remaining owned documentation hunks**

```bash
git add scripts/probe-media-transcode.mjs scripts/probe-media-transcode.test.mjs
git add -p package.json package-lock.json .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md
git commit -m "test: verify media transcode pipeline"
```

- [ ] **Step 8: Report residual deployment requirement**

Report that the feature is implemented and locally verified, but remains disabled by default until a release task checks cloud binary readiness, temporary disk capacity, health output, and one non-paid upload/convert/persist canary.
