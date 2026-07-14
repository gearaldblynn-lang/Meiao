# Task 12 Fix 3 Report

## Scope

Closed the final Important finding in `.superpowers/sdd/task-12-final-review.md`. No provider calls, paid generation, push, deploy, or cloud changes were performed.

## Fix

- ProjectCard now derives Product Restoration image-credit presence and totals from one array of per-result values normalized with `normalizeKnownProductRestoreCredits`.
- Only values that normalize to a known number participate in `has` and `sum`; malformed values cannot be converted to a fabricated zero or positive total before reaching the analysis panel.
- Product Restoration result metadata uses the same shared strict normalizer.
- The generic `normalizeCreditsConsumed` function and all ordinary-module call sites remain unchanged.

## TDD evidence

The new ProjectCard-level test transpiles and server-renders the real `ProjectCard`, forces its detail view open, and captures the props that ProjectCard sends to the Product Restoration analysis panel.

RED:

```text
node --test src/shell/components/ProjectCard.productRestoreCredits.test.mjs

1 failed
false => image credits "0", total credits "unknown"
```

GREEN:

```text
node --test src/shell/components/ProjectCard.productRestoreCredits.test.mjs

1 passed, 0 failed
```

Coverage asserts:

- `false`, `[]`, `{}`, whitespace, `01`, `1e2`, and `.5` remain unknown;
- numeric `0` and strict string `"0"` remain known zero;
- numeric `1.25` and strict string `"0.5"` retain their legal decimal values.

## Verification

- ProjectCard/UI related aggregate: `202 passed, 0 failed`.
- Existing extended Task 12 aggregate: `490 passed, 0 failed`.
- `npx tsc -b --pretty false`: passed.
- `npm run lint`: passed with `0 errors`; existing warning budget remained `660/660`.
- `npm run build`: passed; Vite built 2178 modules.
- Final staged diff and whitespace checks are run immediately before commit.

## Files

- `src/shell/components/ProjectCard.tsx`
- `src/shell/components/ProjectCard.productRestoreCredits.test.mjs`
