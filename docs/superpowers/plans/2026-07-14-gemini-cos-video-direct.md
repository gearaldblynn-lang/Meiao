# Gemini COS Video Direct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route complete storyboard/reference videos through private Tencent COS signed GET URLs directly to KIE Gemini, with no KIE temporary-media staging or alternate media fallback.

**Architecture:** Keep browser and persisted app state on existing managed asset URLs. At the provider boundary, download a managed video once, upload it to the configured private COS bucket, and generate a short-lived signed GET URL immediately before the Gemini request. External video URLs are passed through unchanged; Gemini video read failures fail closed and never retry through KIE file storage.

**Tech Stack:** Node.js ESM, `cos-nodejs-sdk-v5`, Node test runner, KIE Gemini Chat Completions, Tencent COS private bucket.

## Global Constraints

- Gemini must receive the complete video file through a COS signed URL.
- Video media must never be uploaded to KIE `openrouter-chat` or `mayo-storage` as a fallback.
- Do not use keyframes, transcripts, another model, or any other content fallback.
- COS credentials stay server-side and are restricted to the dedicated bucket.
- Signed URL lifetime is configured by `MEIAO_COS_SIGNED_URL_TTL_SECONDS`, default `10800` seconds.
- Existing image, PDF, Seedance, and non-Gemini media behavior remains unchanged.

---

### Task 1: Lock the new routing contract with failing tests

**Files:**
- Modify: `server/providerAssetTransfer.test.mjs`
- Modify: `server/providerGateway.test.mjs`
- Create: `server/tencentCosVideoStore.test.mjs`

**Interfaces:**
- Consumes: `resolveProviderGeminiChatMediaUrl(value, options)`
- Produces: contract assertions for `uploadVideoToCos`, direct external URLs, and no KIE video fallback.

- [ ] Add a resolver test where a managed MP4 calls `deps.uploadGeminiVideoToCos` and returns its signed COS URL.
- [ ] Add a resolver test where a COS MP4 URL is returned unchanged and no upload dependency is invoked.
- [ ] Replace legacy tests that require external videos to upload to `openrouter-chat` with assertions that the Gemini body contains the original video URL and no `/file-stream-upload` request occurs.
- [ ] Add a provider test proving an explicit Gemini file-read failure performs one Gemini request and zero KIE upload requests.
- [ ] Run `node --test server/tencentCosVideoStore.test.mjs server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs` and confirm the new assertions fail for the missing COS implementation/legacy behavior.

### Task 2: Implement private COS upload and signing

**Files:**
- Create: `server/tencentCosVideoStore.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/project-overview.md`

**Interfaces:**
- Produces: `uploadGeminiVideoToCos({ fileBuffer, fileName, mimeType }, env, signal): Promise<string>`

- [ ] Add `cos-nodejs-sdk-v5` as a production dependency.
- [ ] Validate `MEIAO_COS_SECRET_ID`, `MEIAO_COS_SECRET_KEY`, `MEIAO_COS_BUCKET`, and `MEIAO_COS_REGION`; fail with an actionable `provider_config_error` when incomplete.
- [ ] Upload deterministic SHA-256 keyed objects under `gemini-video/`, set the actual video content type, and generate a signed GET URL.
- [ ] Parse `MEIAO_COS_SIGNED_URL_TTL_SECONDS` with a conservative default of `10800` seconds.
- [ ] Forward cancellation before upload/signing and avoid logging credentials or signed query strings.
- [ ] Document every new environment variable and the private-bucket/CAM least-privilege requirement.

### Task 3: Route Gemini videos through COS and remove KIE fallback

**Files:**
- Modify: `server/providerAssetTransfer.mjs`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerMediaRouting.mjs`
- Modify: `server/providerMediaRouting.test.mjs`

**Interfaces:**
- Consumes: `uploadGeminiVideoToCos` from Task 2.
- Produces: provider messages whose video URLs are either signed COS URLs or unchanged external URLs.

- [ ] For managed video URLs, download the managed asset and call `uploadGeminiVideoToCos`.
- [ ] For external video URLs, return the normalized URL unchanged.
- [ ] Remove the `shouldUploadGeminiVideoUrlToOpenRouterChat` routing decision and its production call sites.
- [ ] Prevent `recoverKieChatError` from invoking managed-media KIE fallback whenever the payload contains a video.
- [ ] Run the three focused test files and confirm all pass.

### Task 4: Review, release, real verification, and incident closure

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/agents/repeated-issues.md`
- External record: `../云上日志诊断看板/data/*` through `npm run record-fix`

**Interfaces:**
- Consumes: tested application changes and production COS credentials.
- Produces: deployed build, real Gemini result, health evidence, and reusable root-cause record.

- [ ] Run Hermes changed-file check, focused tests, full server tests, lint, build, and security audit.
- [ ] Review the complete diff for credential exposure, user isolation, signed URL leakage, provider retries, and unrelated changes.
- [ ] Commit and push the isolated fix.
- [ ] Configure the dedicated COS bucket credentials and TTL in production `.env.server` without printing secrets.
- [ ] Check cloud readiness, deploy through `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`, and verify `/api/health`, worker health, build/resource chain, and PM2 logs.
- [ ] Run one approved real storyboard/video analysis and prove: COS object uploaded, signed COS URL sent to Gemini, no KIE `/file-stream-upload`, Gemini returns beginning/middle/end video details.
- [ ] Add root cause, fix, and prevention rule to the project root-cause library and diagnostic dashboard; regenerate and test the dashboard.
