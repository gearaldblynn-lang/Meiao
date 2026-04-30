# GPT Image 2 Replacement Design

## Goal

Replace `nano-banana-pro` across image-generation features with a new internal model option `gpt-image-2`, while keeping `nano-banana-2` as the default model for stability. Ensure each feature can safely call the correct KIE GPT Image 2 endpoint, migrate unsupported structured parameters into prompt instructions when possible, and validate unsupported payload fields before requests are sent.

## Current Context

- The app currently treats `nano-banana-2` and `nano-banana-pro` as the two image models in shared state, UI model pickers, prompt-building flows, and provider execution.
- `server/providerGateway.mjs` sends image jobs to KIE `/api/v1/jobs/createTask` using Nano Banana style payloads with fields such as `image_input`, `aspect_ratio`, `resolution`, and `output_format`.
- Shared utilities such as `utils/modelQuality.ts`, `utils/modelAspectRatio.ts`, and `utils/appState.ts` encode model-specific defaults and supported options.
- Many user-facing modules are image-to-image workflows rather than pure text-to-image. They need model-aware routing, not just a string replacement.

## Requirements

### Functional

1. Remove `nano-banana-pro` as a user-selectable model everywhere in the app.
2. Add `gpt-image-2` as the replacement selectable model.
3. Keep all default image-generation model selections as `nano-banana-2`.
4. Preserve `nano-banana-2` as a manual fallback option.
5. Route `gpt-image-2` requests to:
   - `gpt-image-2-image-to-image` when at least one input image is present
   - `gpt-image-2-text-to-image` when no input image is present
6. Support up to 16 input images for GPT Image 2 requests.
7. Avoid sending unsupported structured parameters for GPT Image 2.
8. When a user configures an aspect ratio for GPT Image 2, convert that requirement into prompt language instead of sending `aspect_ratio`.
9. Hide or disable UI controls that imply unsupported GPT Image 2 parameters such as quality or structured resolution selection.
10. Migrate persisted `nano-banana-pro` state to `gpt-image-2` when restoring saved state.

### Validation

1. Provider payload validation must prevent unsupported parameter combinations from reaching KIE.
2. GPT Image 2 requests must reject more than 16 input images with a clear error.
3. Shared helpers must determine model capability from a single source of truth instead of scattered `if model === ...` checks.

## Model Capability Design

Create a shared capability layer for image models.

Each image model must define:

- Whether it supports structured image input payloads
- Whether it supports structured aspect ratio
- Whether it supports structured resolution or quality
- Whether it supports structured output format
- The maximum supported input image count
- The default UI quality behavior
- Whether aspect ratio should be translated into prompt language

Expected capabilities:

- `nano-banana-2`
  - Supports structured image input
  - Supports structured aspect ratio
  - Supports structured quality/resolution
  - Supports structured output format
  - Existing ratio and quality UI remain
- `gpt-image-2`
  - Supports image input via GPT Image 2 image-to-image endpoint
  - Does not support structured aspect ratio
  - Does not support structured quality/resolution
  - Does not support structured output format
  - Accepts up to 16 images
  - Uses prompt-based aspect ratio guidance

## Provider Design

Keep `gpt-image-2` as the app-facing model identifier and map it inside `server/providerGateway.mjs`.

### Request Routing

- If `payload.model === 'gpt-image-2'` and `payload.imageUrls.length > 0`:
  - Use KIE model `gpt-image-2-image-to-image`
  - Send `input.prompt`
  - Send `input.input_urls`
- If `payload.model === 'gpt-image-2'` and no input images are present:
  - Use KIE model `gpt-image-2-text-to-image`
  - Send `input.prompt`
- For `nano-banana-2`, preserve the existing create-task payload shape

### Payload Cleaning

For `gpt-image-2`, the provider must not send:

- `aspect_ratio`
- `resolution`
- `output_format`
- `image_input`

The provider should send only fields explicitly supported by the chosen GPT Image 2 endpoint plus `nsfw_checker` if we decide to standardize it.

### Prompt Augmentation

When the selected app model is `gpt-image-2` and the user has chosen a non-auto aspect ratio, append a short deterministic instruction to the prompt indicating the desired composition ratio, for example:

- `1:1` -> square composition
- `3:4` -> portrait composition
- `16:9` -> landscape composition

This helper must live in shared code so all modules get consistent prompt behavior.

## UI And State Design

### Model Options

- `MODEL_OPTIONS` becomes `['nano-banana-2', 'gpt-image-2']`
- Display names become `Nano Banana 2` and `GPT Image 2`

### Defaults

Keep all default module state values on `nano-banana-2`, including:

- Global module defaults
- Translation defaults
- One-click defaults
- Retouch defaults
- Buyer show defaults
- XHS cover defaults
- Any server-side default payload builders

### Persisted State Migration

When restoring saved state, convert any stored `nano-banana-pro` value to `gpt-image-2`. This applies to module config, translation configs, retouch state, buyer show state, video storyboard config, and any other persisted image model field.

### Capability-Driven Controls

When `gpt-image-2` is selected:

- Hide or disable quality controls
- Hide or disable any structured resolution controls that imply provider enforcement
- Keep aspect ratio selection only if the rest of the workflow still benefits from composition guidance; label behavior through UI copy or consistent handling, but backend behavior must rely on prompt augmentation rather than structured payload fields

## Testing Strategy

Add or update tests that cover:

1. Persisted state migration from `nano-banana-pro` to `gpt-image-2`
2. Model option and display-name behavior
3. Aspect ratio helper behavior for GPT Image 2
4. Provider routing from internal `gpt-image-2` to the correct KIE endpoint model
5. Provider payload cleaning for unsupported fields
6. Input-image count validation for GPT Image 2
7. UI visibility or availability changes for quality controls

## Risks And Mitigations

### Ratio Is No Longer A Hard Provider Constraint

Risk:
- GPT Image 2 may not return the exact requested aspect ratio.

Mitigation:
- Inject ratio guidance into prompt consistently.
- Preserve downstream display/export handling that can crop or fit results when exact sizing matters.

### Quality Control Is Less Explicit

Risk:
- Users can no longer request exact `1k` / `2k` / `4k` quality from GPT Image 2.

Mitigation:
- Remove misleading GPT Image 2 quality controls.
- Keep `nano-banana-2` available for workflows needing more deterministic parameter control.

### Payload Drift Across Modules

Risk:
- Different modules may reintroduce unsupported fields.

Mitigation:
- Centralize model capabilities and final provider payload validation in shared helpers and the provider gateway.

## Scope

This change covers image-generation flows only. Chat, Veo, Responses, and unrelated agent-center model policies are out of scope except for shared utilities that already carry image model types.
