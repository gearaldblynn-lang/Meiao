# Continuous Voiceover TTS Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one continuous translated narration per video and locally align its spoken turns back to the source speech windows without duplicate provider submissions.

**Architecture:** Version-2 checkpoints persist one continuous KIE TTS child and one managed WAV. A pinned offline faster-whisper base model returns word timestamps, a strict transcript matcher produces acoustic turn boundaries, and FFmpeg trims/retimes branches from the single WAV into the existing video windows. Version-1 checkpoints retain the existing grouped-TTS recovery path.

**Tech Stack:** Node.js ESM, Python 3.11, faster-whisper 1.2.1, CTranslate2 CPU int8, FFmpeg, MySQL child-job ledger, Node test runner.

## Global Constraints

- New tasks create exactly one paid TTS child and use `temperature: 0`.
- Existing provider task IDs are query-only recovery identities and are never resubmitted automatically.
- Runtime performs no network download; packages and model files are pinned and hash-verified before startup.
- Demucs and Whisper subprocesses share one heavy-media concurrency permit.
- Alignment failure is fail-closed; proportional or guessed word cuts are forbidden.
- Final output contains no source audio or background stem.
- Existing completed version-1 results remain readable and playable.

---

### Task 1: Continuous TTS Planning Contract

**Files:**
- Modify: `server/voiceoverAnalysis.mjs`
- Modify: `server/voiceoverAnalysis.test.mjs`

**Interfaces:**
- Produces: `buildVoiceoverContinuousTtsPlan({ segments, selectedVoiceName, maxInputTokens })`
- Produces: a single plan with `dialogueTurns`, `voiceName`, `temperature: 0`, `scene`, and `sampleContext`

- [ ] **Step 1: Write failing tests**

Add tests proving six input segments produce one plan, preserve turn order and
exact text, use one speaker and temperature zero, and reject the full request
when its serialized provider input exceeds `ttsMaxInputTokens`.

- [ ] **Step 2: Run the tests and observe RED**

Run:

```bash
node --test server/voiceoverAnalysis.test.mjs
```

Expected: failure because `buildVoiceoverContinuousTtsPlan` is not exported.

- [ ] **Step 3: Implement the minimal planner**

Reuse `buildVoiceoverTtsProviderInput` for the serialized-budget estimate. Do
not change the legacy `buildVoiceoverTtsGroups` behavior.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/voiceoverAnalysis.test.mjs
```

Expected: all voiceover-analysis tests pass.

### Task 2: Version-2 Checkpoint Contract

**Files:**
- Modify: `server/voiceoverContract.mjs`
- Modify: `server/voiceoverContract.test.mjs`
- Modify: `src/shell/types.ts`

**Interfaces:**
- Produces: `VOICEOVER_TTS_RENDER_VERSION = 2`
- Produces: normalized `ttsBatch`
- Produces: version-aware `ttsGroups`

- [ ] **Step 1: Write failing versioned-checkpoint tests**

Cover one version-2 batch identity, version-2 acoustic group fields, rejection of
duplicated provider identities in groups, version-1 completed readback, and
version-1 incomplete recovery without automatic conversion.

- [ ] **Step 2: Run RED**

```bash
node --test server/voiceoverContract.test.mjs
```

Expected: version-2 fields are rejected as unknown.

- [ ] **Step 3: Implement normalized contracts**

Add `ttsRenderVersion`, `ttsBatch`, and render-version-specific group
normalizers. Merge the batch using the same monotonic child status and immutable
provider identity rules already used by subtitle-removal children.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/voiceoverContract.test.mjs
```

Expected: all contract and migration tests pass.

### Task 3: Offline Alignment Runtime

**Files:**
- Create: `server/voiceoverForcedAlignment.mjs`
- Create: `server/voiceoverForcedAlignment.test.mjs`
- Create: `deploy/voiceover/whisper-model.json`

**Interfaces:**
- Produces: `checkVoiceoverAlignmentReadiness({ env, config, deps })`
- Produces: `alignVoiceoverTurns({ audioPath, turns, targetLanguage, signal, env, config, deps })`
- Returns: `{ similarity, transcript, groups: [{ index, sourceStartMs, sourceEndMs, actualDurationMs }] }`

- [ ] **Step 1: Write failing parser and process tests**

Cover exact English, punctuation drift, Mandarin aliasing, no-space tokens,
unsupported-language automatic detection, low similarity, non-monotonic
timestamps, oversized subprocess output, abort and timeout.

- [ ] **Step 2: Run RED**

```bash
node --test server/voiceoverForcedAlignment.test.mjs
```

Expected: module does not exist.

- [ ] **Step 3: Implement the bounded subprocess**

Spawn only the configured Python 3.11 runtime. Use the pinned local model path,
CPU int8, word timestamps, exact initial prompt and a JSON-only stdout
contract. Normalize aliases before calling Python. Validate all returned paths,
counts, timestamps and similarity in Node.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/voiceoverForcedAlignment.test.mjs
```

Expected: all forced-alignment tests pass without network.

### Task 4: Single-Source FFmpeg Mapping

**Files:**
- Modify: `server/voiceoverAudio.mjs`
- Modify: `server/voiceoverAudio.test.mjs`

**Interfaces:**
- Produces: `alignContinuousVoiceover({ audioPath, turns, outputPath, totalDurationMs, config, signal, deps })`

- [ ] **Step 1: Write failing FFmpeg-argument tests**

Assert one input path, one whole-source normalization stage, `asplit=N`,
per-turn `atrim` from acoustic boundaries, safe `atempo`, centered target delay,
48 kHz mono PCM output and rejection of overlapping/invalid acoustic ranges.

- [ ] **Step 2: Run RED**

```bash
node --test server/voiceoverAudio.test.mjs
```

Expected: continuous alignment function is missing.

- [ ] **Step 3: Implement the filter graph**

Keep the legacy multi-input `alignVoiceoverGroups` function unchanged. Return
the calculated evidence groups beside the output metadata.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/voiceoverAudio.test.mjs
```

Expected: legacy and continuous alignment tests pass.

### Task 5: Runner Integration And Durable Recovery

**Files:**
- Modify: `server/voiceoverTranslationRunner.mjs`
- Modify: `server/voiceoverTranslationRunner.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Consumes: continuous plan, `ttsBatch`, forced-alignment runtime and continuous FFmpeg mapper
- Produces: one provider child for new jobs and version-2 alignment evidence

- [ ] **Step 1: Write failing integration tests**

Cover one create call for six turns, exact batch checkpoint before polling,
recovery by existing provider task ID, crash after provider acceptance, no
second submission, forced-alignment failure, aligned resume without model load,
and untouched version-1 child recovery.

- [ ] **Step 2: Run RED**

```bash
node --test server/voiceoverTranslationRunner.test.mjs
```

Expected: new tasks still create one child per segment.

- [ ] **Step 3: Implement the versioned runner paths**

Set render version 2 for new translated checkpoints. Extract the existing loop
as the explicit version-1 path. Add the version-2 batch path and persist each
state transition before moving to the next boundary.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/voiceoverTranslationRunner.test.mjs server/providerKieTts.test.mjs
```

Expected: all runner and provider tests pass with one version-2 provider create.

### Task 6: Pinned Installer And Shared Heavy Permit

**Files:**
- Modify: `scripts/install-voiceover-demucs.mjs`
- Modify: `scripts/install-voiceover-demucs.test.mjs`
- Modify: `server/voiceoverSeparation.mjs`
- Create: `server/voiceoverHeavyProcessLimiter.mjs`
- Create: `server/voiceoverHeavyProcessLimiter.test.mjs`
- Modify: `deploy/voiceover/requirements.in`
- Modify: `deploy/voiceover/requirements.lock`
- Modify: `deploy/voiceover/requirements-darwin-arm64.in`
- Modify: `deploy/voiceover/requirements-darwin-arm64.lock`

**Interfaces:**
- Produces: hash-verified Whisper model install/check
- Produces: `acquireVoiceoverHeavyProcessPermit(signal, limit)`

- [ ] **Step 1: Write failing installer and concurrency tests**

Require exact faster-whisper/CTranslate2 pins, exact model inventory, rejection
of symlinks/size/hash drift, no download in check mode, no runtime download, and
mutual exclusion between simulated separation and alignment owners.

- [ ] **Step 2: Run RED**

```bash
node --test scripts/install-voiceover-demucs.test.mjs server/voiceoverHeavyProcessLimiter.test.mjs server/voiceoverSeparation.test.mjs
```

Expected: Whisper inventory and shared permit assertions fail.

- [ ] **Step 3: Implement and regenerate hash locks**

Pin faster-whisper 1.2.1 and compatible wheels through `pip-compile
--generate-hashes`. Download only the exact Hugging Face revision during the
explicit model-install mode, verify every file, then publish atomically.

- [ ] **Step 4: Run GREEN**

```bash
node --test scripts/install-voiceover-demucs.test.mjs server/voiceoverHeavyProcessLimiter.test.mjs server/voiceoverSeparation.test.mjs server/voiceoverForcedAlignment.test.mjs
```

Expected: installer, limiter and both heavy runtimes pass offline tests.

### Task 7: Documentation And Verification

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/project-overview.md`
- Modify: `docs/agents/repeated-issues.md`
- Modify: `CLAUDE.md`
- Modify: `scripts/probe-voiceover-translation.mjs`
- Modify: `scripts/probe-voiceover-translation.test.mjs`

**Interfaces:**
- Produces: deployment and acceptance contract for render version 2

- [ ] **Step 1: Extend the probe tests**

Require one TTS provider child, render version 2, exact text order, transcript
similarity, acoustic and target boundaries, per-turn `atempo`, pure new
narration, unchanged H.264 stream and Range playback.

- [ ] **Step 2: Run the focused suite**

```bash
node --test server/voiceover*.test.mjs scripts/install-voiceover-demucs.test.mjs scripts/probe-voiceover-translation.test.mjs
```

Expected: zero failures.

- [ ] **Step 3: Run repository gates**

```bash
npm run lint
npm test
npm run build
npm run doctor
```

Expected: every command exits zero.

- [ ] **Step 4: Run the real local media fixture**

Use one continuous WAV fixture and verify the exact group count, transcript
similarity threshold, clean aligned narration, final duration/codecs/fast-start
and unchanged video stream.

- [ ] **Step 5: Review before any cloud release**

Inspect the complete diff for billing identity, checkpoint compatibility,
process limits, secret/path exposure, model provenance and deployment rollback.
Do not deploy while any active paid job exists.

- [ ] **Step 6: Deploy and run one paid canary only when authorized by the existing release boundary**

Use the normal code-review gate and verify public/host-local health, real model
readiness, one provider child, browser playback and diagnostic-dashboard
closure. Never create a second canary to compensate for an unknown first
submission.
