# Task 11 Report: Visual-analysis model preflight

## Outcome

- Product Restoration now resolves its analysis primary and provider fallback
  only from public catalog entries whose `supportsImageInput` value is exactly
  `true`.
- A capable configured model remains first choice. If it is incapable or absent
  from the capable catalog, the first capable catalog entry becomes the stable
  primary; fallback selection still prefers the first different model family.
- An empty/incapable visual catalog fails before `createInternalJob` with:
  `当前系统分析模型不支持图片输入，请联系管理员调整`.
- The capability gate is scoped to Product Restoration metadata or the new
  explicit request option. Ordinary text analysis retains the configured model
  and unfiltered fallback behavior.
- Product Restoration still disables semantic resubmission, so one logical
  analysis creates at most one internal control job.

## TDD evidence

- RED: the five new scenarios initially produced four expected failures:
  an incapable catalog still created a job, incapable fallbacks were selected,
  and an incapable configured model was not replaced. The ordinary text
  compatibility scenario already passed.
- GREEN: `node --test src/services/arkService.test.mjs` -> 40/40 passed.

## Verification

- Product Restoration contract/workflow/UI/cancellation/rollout suites:
  99/99 passed.
- `npx tsc -b`: passed.
- `npm run lint`: passed with 0 errors and 660 warnings, exactly at the existing
  warning budget.
- `npm run build`: passed; Vite transformed 2177 modules.
- `git diff --check`: passed.

No provider call, paid generation, push, deploy, or cloud mutation was made.
