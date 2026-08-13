# Questionnaire State Machine — Test Suite Plan

> **Purpose**: Define a comprehensive, behavior-focused test suite covering all states, transitions, and edge cases documented in `QUESTIONNAIRE_STATE_MACHINE.md`. Tests target **pure logic modules** (no React rendering) — fast, reliable, and resilient to UI refactoring.
>
> **Goal**: Once this test suite is green, it becomes the regression safety net for simplifying and refactoring the questionnaire logic.

---

## Modules Under Test

The testable logic lives in 3 pure modules — no API calls, no React, no side effects:

| Module | Functions Under Test |
|--------|---------------------|
| `questionnaire-steps.js` | `buildSteps`, `parseSignedPdfs`, `getResumeStepIndex`, `deriveStepStatuses` |
| `submission-compat.js` | `getResponses`, `isLegacySubmission`, `legacyToResponses`, `getStepProgress`, `getAllFiles`, `getStepSummary` |
| `questionnaire-template.js` | `filterStepsByClientConditions`, `getActiveSteps`, `resolveYearPlaceholders`, `parseTemplateSteps` |

---

## Design Principles

### 1. Behavior-focused test names
Test names describe **what should happen** from a user/business perspective, not implementation details. This ensures they remain valid after refactoring:

```
✓ "client with no responses starts at the welcome screen"
✓ "pension step is excluded for osek patur clients"
✗ "getResumeStepIndex returns 0 when responses object is empty"  ← too implementation-coupled
```

### 2. Pure logic only
All tested functions are pure `(input) → output` with zero dependencies on React, the DOM, or network:
- Tests run in < 1 second
- No mocking of APIs or components needed
- Safe to run on every save

### 3. Edge-case driven
Every documented edge case from the state machine has at least one corresponding test.

---

## Test Runner: Vitest

Since the project uses Vite, Vitest is the natural choice — zero extra config for path aliases (`@/`), ESM, etc.

### Setup Steps
1. Install: `npm install -D vitest`
2. Add scripts to `package.json`:
   - `"test": "vitest run"`
   - `"test:watch": "vitest"`
3. Create `vitest.config.js` inheriting from `vite.config.js`

---

## Test File: `src/lib/__tests__/questionnaire-steps.test.js`

### Resume & Navigation (State Machine: RESUME LOGIC)

| # | Test Name | Scenario |
|---|-----------|----------|
| 1 | client with no responses starts at the welcome screen | Empty responses + empty signedPdfs → returns index pointing to first content step, but caller shows welcome |
| 2 | client resumes at the first unanswered step | Steps 1-3 answered, step 4 unanswered → resume at 4 |
| 3 | client with all steps answered goes to done screen | All steps have responses → resume index = done |
| 4 | race condition: server step_completed ahead of local — trusts server | `step_completed=5`, firstUnanswered=3 → resume at 5 |
| 5 | race condition: step_completed behind first unanswered — uses first unanswered | `step_completed=2`, firstUnanswered=4 → resume at 4 |

### Step Building (State Machine: STEP ANSWERING LOOP)

| # | Test Name | Scenario |
|---|-----------|----------|
| 6 | steps array includes welcome and done bookends | Input: 3 active steps → output has 5 entries (welcome + 3 + done) |
| 7 | pdf_sign step with skip_question goes directly to sign type | `response_type=pdf_sign` + `skip_question=true` → type is `pdf_sign` |
| 8 | pdf_sign step without skip_question renders as question type | `response_type=pdf_sign` + `skip_question=false` → type is `question` |
| 9 | regular step types are preserved as question type | `response_type=upload` → type is `question` |

### Signed PDF Parsing

| # | Test Name | Scenario |
|---|-----------|----------|
| 10 | valid signed_pdfs JSON is parsed into a map by step_id | JSON array with 2 records → map with 2 entries keyed by step_id |
| 11 | empty or null signed_pdfs returns empty map | `null` / `undefined` → `{}` |
| 12 | malformed JSON returns empty map gracefully | `"not json"` → `{}` |

### Step Status Derivation (State Machine: DASHBOARD)

| # | Test Name | Scenario |
|---|-----------|----------|
| 13 | completed regular step is marked as completed | response with `answer !== undefined` → in completedStepIds |
| 14 | unanswered step is not in completed or incomplete lists | no response for step → in neither list |
| 15 | signed PDF (complete) is marked as completed | signedPdfsById has record with `incomplete=false` → completedStepIds |
| 16 | signed PDF (incomplete) is marked as incomplete | signedPdfsById has record with `incomplete=true` → incompleteStepIds |
| 17 | pdf_sign step answered "no" is marked as completed | `answer=false` in responses → completedStepIds |

---

## Test File: `src/lib/__tests__/submission-compat.test.js`

### Response Format Handling (State Machine: ENTRY + Legacy)

| # | Test Name | Scenario |
|---|-----------|----------|
| 18 | new format submission returns parsed responses | `responses` is JSON string → parsed object |
| 19 | legacy submission (no responses field) is converted to new format | Old flat fields (`is_employee`, etc.) → mapped to step IDs |
| 20 | null or undefined submission returns empty responses | `null` → `{}` |
| 21 | responses as already-parsed object is returned as-is | Object input → same object back |
| 22 | malformed JSON responses string returns empty object | `"broken{"` → `{}` |

### Progress Calculation (State Machine: DASHBOARD PROGRESS)

| # | Test Name | Scenario |
|---|-----------|----------|
| 23 | no submission returns 0% progress | `null` submission → 0 |
| 24 | all regular steps answered returns 100% | 4/4 steps with answers → 100 |
| 25 | half the steps answered returns ~50% | 2/4 steps answered → 50 |
| 26 | pdf_sign step with signed record counts as done | signedPdfs entry exists → counted |
| 27 | pdf_sign step answered "no" (not relevant) counts as done | `answer: false` → counted |
| 28 | pdf_sign step with no record and no answer is not counted | No signedPdfs, no response → not counted |
| 29 | empty steps array returns 0% | `[]` → 0 |

### File Collection

| # | Test Name | Scenario |
|---|-----------|----------|
| 30 | files from template-order steps are collected in order | 3 steps with files → 3 groups in template order |
| 31 | files from steps removed from template are still included | Response has files for step not in activeSteps → still in output |
| 32 | steps with answer=false have no files collected | `answer: false` → no file group |

### Step Summary

| # | Test Name | Scenario |
|---|-----------|----------|
| 33 | summary uses saved title/emoji from response when available | Response has `title` → used over template title |
| 34 | summary falls back to template title when response has none | No response title → template title used |
| 35 | responses for steps not in template are included at the end | Extra response → appended to summary |

---

## Test File: `src/lib/__tests__/questionnaire-template.test.js`

### Client Condition Filtering (State Machine: osek_type Filtering)

| # | Test Name | Scenario |
|---|-----------|----------|
| 36 | pension step is excluded for osek patur clients | `osek_type=עוסק פטור` → pension step removed |
| 37 | pension step is included for osek murshe clients | `osek_type=עוסק מורשה` → pension step present |
| 38 | steps without conditions are always included | No condition field → always in output |
| 39 | all steps are shown when client has no osek_type set | `osek_type=undefined` → conditional steps excluded (values check fails) |
| 40 | unknown condition types default to showing the step | `condition.type="unknown"` → step included |

### Active Step Resolution

| # | Test Name | Scenario |
|---|-----------|----------|
| 41 | disabled steps are excluded | `enabled=false` → not in output |
| 42 | steps are sorted by order field | Unordered input → sorted by `order` |
| 43 | all enabled steps are included regardless of type | Mix of upload, text, pdf_sign → all present |

### Year Placeholder Resolution

| # | Test Name | Scenario |
|---|-----------|----------|
| 44 | year placeholders in title and question are replaced | `{year}` → `"2024"` |
| 45 | year placeholders in upload_config fields are replaced | `upload_config.title` with `{year}` → resolved |
| 46 | year placeholders in text_config fields are replaced | `text_config.description` with `{year}` → resolved |
| 47 | steps without text fields are handled gracefully | `text_config=null` → no error |

### Template Parsing

| # | Test Name | Scenario |
|---|-----------|----------|
| 48 | valid JSON steps array is parsed correctly | JSON string → parsed array |
| 49 | invalid JSON falls back to DEFAULT_STEPS | `"broken"` → DEFAULT_STEPS |
| 50 | non-array parsed value falls back to DEFAULT_STEPS | `"{}"` → DEFAULT_STEPS |

---

## Edge Case Coverage Matrix

Mapping from `QUESTIONNAIRE_STATE_MACHINE.md` edge cases to test coverage:

| # | Edge Case | Test File | Test #s |
|---|-----------|-----------|---------|
| 1 | Template changed mid-session (steps added/removed) | submission-compat | 30, 31, 35 |
| 2 | osek_type filtering mismatch | questionnaire-template | 36–40 |
| 3 | completed_at null despite all steps answered | questionnaire-steps | 3 |
| 4 | Race condition on fast clicks | questionnaire-steps | 4, 5 |
| 5 | pdf_sign "no" answer not counted in progress | submission-compat | 27 |
| 6 | Return from PdfSignPage | questionnaire-steps | 2 (with signedPdfs merge) |
| 7 | Historical template on completed submissions | questionnaire-template | 48–50 |
| 8 | Legacy submissions (pre-template system) | submission-compat | 19 |
| 9 | New submission creation timing | Component-level (outside pure logic scope) |
| 10 | Dashboard uses current template (not historical) | submission-compat | 24–29 |

---

## Running Tests

```bash
# Single run — all tests
npm run test

# Watch mode — re-runs on file changes
npm run test:watch

# Run specific file
npx vitest run src/lib/__tests__/questionnaire-steps.test.js
```

---

## What's Next

Once this test suite is fully green:
1. ✅ Regression safety net established
2. → Refactor the questionnaire logic to simplify state transitions
3. → Run tests after each refactor step to catch regressions
