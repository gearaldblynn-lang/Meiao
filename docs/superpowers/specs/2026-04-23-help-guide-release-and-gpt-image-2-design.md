# Help Guide, Release Notes, And GPT Image 2 Capability Update Design

## Goal

Finish three related changes in one coordinated update:

1. Extract the app-wide help guide content into a dedicated configuration source and complete the usage instructions for all current top-level modules.
2. Update the release notes content so the update modal accurately explains the current release.
3. Correct the GPT Image 2 integration design based on the latest KIE image-to-image spec, specifically allowing structured `aspect_ratio` for GPT Image 2 image-to-image requests while keeping unsupported parameters blocked.

## Current Context

- `components/HelpGuideModal.tsx` currently embeds all help content inline.
- The current help guide covers only a subset of top-level modules, and some modules still have placeholder or incomplete descriptions.
- `config/releaseNotes.ts` already powers the “本次更新” modal and first-open reminder flow.
- The current GPT Image 2 work introduced `gpt-image-2` as the replacement for `nano-banana-pro`, but the earlier design assumed GPT Image 2 could not accept structured aspect ratio.
- The user provided a newer KIE `gpt-image-2-image-to-image` OpenAPI spec showing `aspect_ratio` is now supported for image-to-image.

## Requirements

### Help Guide

1. Move help guide content out of `HelpGuideModal.tsx` into a dedicated config file.
2. Cover all current top-level modules, including both business modules and management/system modules.
3. Keep the existing modal structure:
   - summary
   - steps
   - tips
4. Keep the visual UI unchanged unless needed for the new module set.
5. Avoid placeholder guidance except where a feature is truly not available yet; in those cases, state the current status clearly.

### GPT Image 2 Capability Correction

1. Keep `nano-banana-2` as the default image model.
2. Keep `gpt-image-2` as the selectable replacement for `nano-banana-pro`.
3. For `gpt-image-2-image-to-image`:
   - allow structured `aspect_ratio`
   - allow up to 16 `input_urls`
4. Continue treating `resolution/quality` and `output_format` as unsupported for GPT Image 2.
5. Continue long-running generation handling and warnings for GPT Image 2.
6. Only apply structured `aspect_ratio` where the current KIE spec explicitly confirms support.

### Release Notes And Deployment

1. Update release notes to describe the actual shipped behavior.
2. Increment the release version so the release modal appears as a new update.
3. Deploy the verified code to Tencent Cloud using the existing deployment flow.
4. Perform post-deploy verification.

## Design

### 1. Help Guide Configuration Extraction

Create a new configuration module:

- `config/helpGuide.ts`

This file will export:

- the module ordering for the guide
- the help content record keyed by `AppModule`
- a shared type for help entries

`components/HelpGuideModal.tsx` will stop hardcoding guide copy and instead import:

- the module list
- the help content map

This keeps the modal focused on rendering and navigation, while content maintenance moves into a single configuration file.

### 2. Help Guide Coverage

The help guide should cover all current top-level modules that the app exposes in its main navigation and system areas. At minimum, the content set must include:

- 一键主图 / 详情 / SKU
- 出海翻译
- 买家秀
- 精修
- 摄影图
- 视频
- 智能体中心
- 账号管理或系统管理相关入口 when those are first-class app modules in the current shell

For modules with nested workflows, the help guide remains high level. It should explain:

- what the module is for
- the normal user flow
- practical cautions and tips

It should not try to replace every submodule’s internal field-level documentation.

### 3. GPT Image 2 Capability Model

The shared image capability layer must be updated to reflect the latest confirmed provider behavior.

#### `gpt-image-2` app-facing model

- Supported for text-to-image and image-to-image routing
- Long-running generation warning enabled
- Max input images: 16
- Structured quality selection: unsupported
- Structured output format: unsupported

#### Aspect ratio handling

- `gpt-image-2-image-to-image`
  - structured `aspect_ratio` is supported
  - allowed values are:
    - `auto`
    - `1:1`
    - `5:4`
    - `9:16`
    - `21:9`
    - `16:9`
    - `4:3`
    - `3:2`
    - `4:5`
    - `3:4`
    - `2:3`
- `gpt-image-2-text-to-image`
  - do not assume structured `aspect_ratio` support unless separately confirmed
  - continue fallback behavior by prompt augmentation or no structural ratio field

This means the previous “GPT Image 2 never supports structured ratio” assumption must be removed.

### 4. Provider Request Mapping

Update `server/providerGateway.mjs` so the internal model `gpt-image-2` behaves like this:

#### When source images exist

Call:

- `gpt-image-2-image-to-image`

Send:

- `input.prompt`
- `input.input_urls`
- `input.aspect_ratio` when the selected ratio is one of the confirmed KIE enum values

Do not send:

- `resolution`
- `output_format`
- `image_input`

#### When source images do not exist

Call:

- `gpt-image-2-text-to-image`

Send:

- `input.prompt`

Do not send:

- `resolution`
- `output_format`
- `image_input`

For text-to-image ratio:

- keep current fallback behavior conservative
- do not structurally send `aspect_ratio` unless that endpoint is separately confirmed to support it

### 5. UI Behavior

When `gpt-image-2` is selected:

- keep aspect-ratio selection visible
- hide quality controls
- show a clear warning that GPT Image 2 generation usually takes 300-500 seconds

For image-to-image flows, the selected ratio is now a true provider parameter instead of prompt-only guidance.

For text-to-image flows, the UI can still expose ratio selection if it remains useful for composition intent, but the backend behavior must follow the confirmed endpoint capability rather than assuming both GPT Image 2 endpoints behave the same.

### 6. Release Notes

Update `config/releaseNotes.ts` to include this release’s real changes:

- `gpt-image-2` replaces `nano-banana-pro` as the advanced selectable image model
- `nano-banana-2` remains the default model
- GPT Image 2 now uses KIE’s current routing:
  - image-to-image with structured ratio support
  - text-to-image with conservative unsupported-field handling
- GPT Image 2 shows long-generation warnings and supports longer waiting windows
- help guide content is now centrally managed and expanded across the app

Increment `APP_RELEASE_VERSION` so users receive the update popup again.

## Testing Strategy

Add or update tests for:

1. `config/helpGuide.ts` integration via `HelpGuideModal.tsx` source tests
2. GPT Image 2 image-to-image request body includes `aspect_ratio`
3. GPT Image 2 text-to-image request body does not incorrectly include unsupported fields
4. GPT Image 2 quality controls remain hidden in relevant UIs
5. Release note version and content wiring remain valid
6. Existing UI architecture tests continue to pass

## Deployment Plan

After local verification:

1. Deploy with `./scripts/deploy_tencent.sh`
2. Verify server health
3. Verify the app loads
4. Verify the release notes modal content reflects this version
5. Verify the help guide modal opens and shows the new module coverage

## Risks And Mitigations

### Risk: Text-to-image aspect ratio support is still unclear

Mitigation:

- only enable structured ratio where the provided spec explicitly confirms it
- keep text-to-image conservative

### Risk: Help guide becomes too broad and noisy

Mitigation:

- keep entries concise
- focus on top-level workflow and practical tips
- avoid field-by-field duplication of in-product UI labels

### Risk: Release notes drift from actual shipped behavior

Mitigation:

- update release notes only after implementation details are finalized
- keep the release notes tied directly to tested behavior
