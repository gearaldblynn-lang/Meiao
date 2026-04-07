# BuyerShow Target Market Model Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make buyer show model nationality and ethnicity follow `targetCountry` first whenever "include model" is enabled, while keeping reference images limited to atmosphere, styling, and shot language guidance.

**Architecture:** Add regression tests first around the buyer show planning prompt and generation prompt assembly, then tighten both prompt builders so target-market person traits outrank any person visible in the uploaded atmosphere reference. Keep UI, data model, and generation flow unchanged.

**Tech Stack:** TypeScript services and React module source, Node test runner

---

### Task 1: Lock target-market-first rules in buyer show planning prompt

**Files:**
- Modify: `services/arkService.test.mjs`
- Modify: `services/arkService.ts`

- [ ] **Step 1: Write the failing test**

```js
test('buyer show planning prompt makes target market model traits override any person in the reference image', () => {
  assert.match(
    arkServiceSource,
    /Model appearance must be determined by the target market first/,
    'buyer show planning prompt should explicitly prioritize target market model identity'
  );
  assert.match(
    arkServiceSource,
    /Do NOT copy or inherit the reference person's ethnicity, nationality, or skin tone/,
    'buyer show planning prompt should forbid inheriting reference person identity traits'
  );
  assert.match(
    arkServiceSource,
    /Reference people may only inform clothing direction, pose energy, and camera language/,
    'buyer show planning prompt should narrow reference-person reuse to soft styling cues'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test services/arkService.test.mjs`
Expected: FAIL because `generateBuyerShowPrompts` still tells the model to reproduce the reference person's ethnicity and appearance.

- [ ] **Step 3: Write minimal implementation**

```ts
const modelPrompt = state.includeModel
  ? `3. **Include Model Strategy**: The set must include human presence suitable for ${state.targetCountry}.
   Model appearance must be determined by the target market first.
   Every hasFace=true prompt must describe a person who looks native and locally believable for ${state.targetCountry}.
   If the reference image contains a person, do NOT copy or inherit the reference person's ethnicity, nationality, or skin tone.
   Reference people may only inform clothing direction, pose energy, and camera language.`
  : `3. **STILL LIFE Strategy**: **NO HUMAN FACES/BODIES.** Focus on product details and scenes. Hands are allowed if necessary for usage demonstration.`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test services/arkService.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/arkService.test.mjs services/arkService.ts
git commit -m "fix: prioritize buyer show target-market model traits"
```

### Task 2: Lock target-market-first rules in buyer show generation prompt assembly

**Files:**
- Modify: `modules/BuyerShow/buyerShowBehavior.test.mjs`
- Modify: `modules/BuyerShow/BuyerShowModule.tsx`

- [ ] **Step 1: Write the failing test**

```js
test('buyer show generation prompt forbids copying identity traits from the atmosphere reference person', () => {
  assert.match(
    source,
    /must fit the local market identity of \$\{persistentState\.targetCountry\}/,
    'buyer show generation prompt should require target-market-fitting model identity'
  );
  assert.match(
    source,
    /Do NOT copy the reference person's ethnicity, nationality, or skin tone/,
    'buyer show generation prompt should forbid copying reference person identity traits'
  );
  assert.match(
    source,
    /same generated person, not the original reference person/,
    'follow-up buyer show generations should stay consistent with the first generated model rather than the uploaded reference person'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/BuyerShow/buyerShowBehavior.test.mjs`
Expected: FAIL because `triggerNewKieTask` does not yet state the target-market identity priority or the "same generated person" rule.

- [ ] **Step 3: Write minimal implementation**

```ts
refDescription = `VISUAL ATMOSPHERE STYLE REFERENCE (视觉氛围风格参考图):
Reference Image URL: ${refUrl}
This image is the VISUAL ATMOSPHERE reference only.
If it contains a person, use them only for clothing direction, pose energy, and camera language.
Do NOT copy the reference person's ethnicity, nationality, or skin tone.`;

baseRequirement = isFirstImage
  ? `AUTHENTIC LIFESTYLE SNAPSHOT (BENCHMARK): A real user whose appearance must fit the local market identity of ${persistentState.targetCountry}. ${refDescription}`
  : `VISUAL CONSISTENCY & VARIATION: Maintain the same generated person, not the original reference person. ${refDescription}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/BuyerShow/buyerShowBehavior.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/BuyerShow/buyerShowBehavior.test.mjs modules/BuyerShow/BuyerShowModule.tsx
git commit -m "fix: enforce buyer show model identity by target market"
```

### Task 3: Verify the combined behavior and keep regressions contained

**Files:**
- Modify: none required unless verification exposes a prompt wording mismatch

- [ ] **Step 1: Run targeted tests together**

Run: `node --test services/arkService.test.mjs modules/BuyerShow/buyerShowBehavior.test.mjs`
Expected: PASS with both new buyer show constraints covered.

- [ ] **Step 2: Run project build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit any final wording-only fixes if verification required edits**

```bash
git add services/arkService.ts services/arkService.test.mjs modules/BuyerShow/BuyerShowModule.tsx modules/BuyerShow/buyerShowBehavior.test.mjs
git commit -m "test: cover buyer show target-market model priority"
```
