# Continuous Voiceover TTS Alignment Design

**Date:** 2026-08-02

## Goal

Eliminate audible narrator drift between the beginning and end of a translated
voiceover while preserving sentence-level synchronization with the source
video. A new task must synthesize one continuous narration in one paid TTS
request, recover each translated turn's actual acoustic boundaries locally, and
map those turns back to the original speech windows without reintroducing the
source audio or background music.

## Current Failure

The current runner creates one independent KIE Gemini TTS task per analyzed
speech segment. Every child uses the same preset voice name, but each request is
sampled independently with `temperature: 1`. The provider therefore has no
shared speaker state across segments. Per-segment `atempo` values then amplify
the perceptual difference. The 2026-08-02 production canary used six Fenrir
children and split into two visibly different speed regimes: the first four
turns used approximately `1.44-1.67x`, while the last two used approximately
`1.17-1.19x`.

KIE's documented result contains one audio URL and no per-dialogue-turn
timestamps. A single provider call alone therefore fixes narrator continuity
but does not preserve durable sentence timing anchors.

## Chosen Architecture

### One continuous provider render

New voiceover checkpoints use `ttsRenderVersion: 2`. The runner creates one
`kie_tts` child with every translated segment represented as an ordered
`dialogue_turn`. All turns use one speaker and one selected preset voice.
Generation uses `temperature: 0`; the scene and sample context require one
continuous narrator, exact text and order, and a clear pause between turns.

The durable child identity is:

```text
tts:continuous:attempt:<ttsAttemptBase>
```

The checkpoint stores one `ttsBatch` record containing the child job,
provider-task and managed-audio identities. No provider identity is duplicated
across per-turn records.

### Offline forced alignment

The continuous managed WAV is aligned locally with pinned
`faster-whisper==1.2.1` and the immutable
`Systran/faster-whisper-base` revision
`ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`. The model directory is installed
before runtime, verified by exact file size and SHA-256, and loaded with
`local_files_only` semantics. Runtime processing must never download packages
or model files.

The Python subprocess receives only:

- the server-owned continuous WAV path;
- the target-language alignment code;
- the exact ordered translated turns;
- the pinned local model directory;
- bounded similarity and process settings.

It returns a bounded JSON object containing one acoustic `sourceStartMs` and
`sourceEndMs` pair per translated turn plus the recognized transcript and
similarity score. Whisper word timestamps are matched to the exact known
transcript with Unicode NFKC normalization and a monotonic sequence alignment.
The subprocess must reject low similarity, missing turns, word-sharing
boundaries, non-monotonic timestamps or output beyond the configured byte cap.

Language aliases are explicit: `cmn -> zh`, `fil -> tl`, `jv -> jw`, and
`nb -> no`. If Whisper has no native code, the aligner may use automatic
detection but must still pass the exact-text similarity and one-boundary-per-turn
contracts. A language-independent long-pause boundary fallback is allowed only
when it produces exactly the required turn count and all boundaries pass the
same monotonic and minimum-duration checks. Otherwise the task fails with
`voiceover_forced_alignment_failed`; it must never cut at guessed proportional
positions.

### Piecewise timeline mapping from one source

FFmpeg receives the continuous TTS asset once. It normalizes that source once,
splits it into filter branches, trims each branch using the aligned acoustic
source boundaries, and applies the existing safe `atempo` calculation against
the corresponding original video speech window. Residual room in a video
window is divided equally before and after speech. The final aligned narration
remains 48 kHz mono PCM, and the final MP4 still contains only the unchanged
video stream plus the new narration.

The durable `ttsGroups` for render version 2 contain:

```json
{
  "index": 0,
  "startMs": 100,
  "endMs": 3208,
  "sourceStartMs": 120,
  "sourceEndMs": 4980,
  "actualDurationMs": 4860,
  "atempo": 1.563706564
}
```

They are alignment evidence, not provider child records.

## Checkpoint And Billing Safety

Existing checkpoints without `ttsRenderVersion` are render version 1:

- completed version-1 results remain read-only and playable;
- an incomplete version-1 checkpoint with any submitted provider identity
  resumes only its existing version-1 children;
- an incomplete version-1 checkpoint must never be silently converted into a
  new paid continuous render;
- brand-new checkpoints set render version 2 before TTS submission;
- version-2 retries reuse the exact `ttsBatch.providerTaskId` when present;
- a new paid attempt requires the existing explicit retry confirmation path and
  increments `ttsAttemptBase`.

A process crash after provider acceptance but before parent checkpoint storage
is handled by the child ledger and existing idempotent `clientSubmissionKey`.
The runner queries the same provider task and never automatically creates a
second task.

## Runtime And Resource Safety

The Whisper base model is approximately 145 MB on disk. Alignment uses CPU
`int8`, one thread-bounded subprocess and a single shared heavy-media permit.
Demucs separation and Whisper alignment must not overlap across voiceover jobs
on the 7.5 GiB Tencent host. A timed-out or aborted subprocess is terminated,
its output is bounded, and the permit is released only after process close.

Service bootstrap verifies package versions, model inventory and hashes without
loading the model. Deployment readiness performs one real local model-load and
short-WAV alignment probe before the production release is marked ready.

## Error Handling

- Missing package/model/hash: `voiceover_alignment_unavailable`
- Low transcript similarity or invalid turn map:
  `voiceover_forced_alignment_failed`
- Unsafe duration or `atempo`: existing
  `voiceover_timing_out_of_range`
- Unknown provider submission: preserve the version-2 batch checkpoint and
  require recovery of the same task identity
- Abort/timeout: terminate locally, preserve the original durable provider
  identity, and do not resubmit

No raw transcript, server path, provider task ID, model directory or alignment
debug payload is returned through the public API.

## Verification

Automated coverage must prove:

1. New multi-turn jobs create exactly one paid TTS child with one voice and
   `temperature: 0`.
2. The aligner maps exact and mildly imperfect multilingual transcripts to
   monotonic per-turn acoustic windows and rejects low-confidence mappings.
3. FFmpeg uses one continuous audio input, trims every aligned source window,
   preserves the target video windows and emits the expected `atempo` evidence.
4. Resume paths query the existing continuous provider task and do not create a
   second child.
5. Version-1 incomplete and completed checkpoints keep their legacy identities
   and behavior.
6. Package/model readiness is offline, hash-pinned and bounded.
7. A real local fixture uses one continuous narration source and yields the same
   segment count, clean final audio, unchanged video stream and valid MP4.
8. Production acceptance creates at most one new paid canary after active jobs
   reach zero, then records provider-child count, text identity, source/target
   boundaries, per-turn `atempo`, final media metadata and browser playback.

## Rejected Alternatives

### Keep independent TTS calls and lower temperature

This reduces variation but cannot create shared speaker state across requests.
It is an incomplete mitigation, not a root-cause fix.

### Cut the continuous result only by silence

Unconstrained sentence-internal pauses can be mistaken for turn boundaries.
Pause anchors are acceptable only as a validated fallback, never as the primary
or proportional cutting rule.

### Globally stretch the entire narration

One global ratio preserves continuous timbre but lets individual claims drift
away from their visual actions. The product requires sentence-level mapping.
