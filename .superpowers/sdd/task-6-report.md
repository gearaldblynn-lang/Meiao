# Task 6 Report: Image Upgrade Product Restoration workspace

## Status

Complete for the requested local-only Task 6 scope. No provider request, push, deployment, cloud configuration change, or paid generation was performed.

Commit subject: `feat: add image upgrade product restoration workspace`

## Delivered behavior

- Renamed the active `retouch` surface to `图片升级` across navigation, landing/module copy, project/task labels, workflow display, help, login copy, and logs while preserving the internal module key.
- Added the always-visible `产品还原` subfeature beside `原图精修`, `白底精修`, and disabled `智能增强`, including URL/parameter normalization.
- Added the two ordered material roles: `待还原套图` (10) and `产品参考图` (5), with visible/native guidance, whole-selection rejection before file reads, current/limit counts, and scoped left/right reordering.
- Added six stable emphasis chips with the Task 2 defaults and non-empty normalization.
- Added Product Restoration-only model and resolution controls: model + 2K/4K, default 2K, no 1K, ratio, width, height, or size-mode controls, with unsupported 4K falling back to 2K.
- Added fail-closed `off|admin|all` new-submission gating from public system config while preserving tab and historical project access.
- Counted billing previews from restore targets only; zero targets estimate zero image jobs, references and analysis do not inflate the displayed image count.
- Updated the three active project/handoff documents with the roles, limits, analysis-first lifecycle, output behavior, rollout environment values, and explicit local-only/not-deployed status.

## TDD evidence

Initial required RED:

```text
node --test src/components/uiArchitecture.test.mjs src/shell/modules/Retouch/productRestoreUi.test.mjs
tests 187, pass 177, fail 10
```

The failures were the expected missing legacy rename/tab/workspace policy/billing behavior. A later exact-count RED also proved that an empty Product Restoration workspace incorrectly estimated one image before the billing fix:

```text
node --test src/shell/modules/Retouch/productRestoreUi.test.mjs
tests 7, pass 6, fail 1 (expected 0, actual 1)
```

Final focused and adjacent GREEN:

```text
node --test src/components/uiArchitecture.test.mjs \
  src/shell/modules/Retouch/productRestoreUi.test.mjs \
  src/utils/imageBilling.test.mjs \
  src/modules/Retouch/productRestoreContract.test.mjs \
  src/utils/productRestoreRollout.test.mjs
tests 209, pass 209, fail 0
```

## Verification

```text
npx tsc -b
PASS

npm run lint
PASS: 0 errors, 660 warnings across 80 affected files (repository budget 660)

npm run build
PASS: 2166 modules transformed; production bundle built

git diff --check
PASS
```

The final fresh verification is rerun immediately before commit; its result should be treated as authoritative if it differs from the intermediate evidence above.

## Scope and concerns

- The rollout remains fail-closed when public config is missing or invalid.
- No browser/provider smoke was run because this task is explicitly local-only and provider calls are prohibited. The UI contract, pure policy behavior, TypeScript integration, lint budget, and production build are green.
- Concurrent unowned media-transcode and managed-asset work remains dirty in package, server, environment, and related test files. Those files are not part of Task 6 and must not be staged, reverted, or committed with this task.
