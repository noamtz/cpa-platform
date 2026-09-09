# Implementation Report: Privacy-safe PostHog analytics

**Plan:** `.agents/plans/add-privacy-safe-posthog-analytics.md`
**Issue:** [#13](https://github.com/noamtz/cpa-platform/issues/13)
**Branch:** `feature/add-privacy-safe-posthog-analytics`
**Date:** 2026-09-08

## Summary

Implemented the issue #13 analytics contract with the exact `posthog-js@1.428.6` browser SDK, an EU-only and
configuration-gated adapter, strict application and final-send allowlists, session-scoped anonymous identity, and
best-effort failure isolation. Instrumentation covers the eight agreed operational events across Cognito sign-in,
public questionnaire start/resume/completion, shared uploads, active PDF generation/signing, and CPA completion
milestones. Sentry configuration and behavior were not changed.

The analytics data dictionary is in `docs/analytics-data-dictionary.md`. No AWS deployment, production action, live
PostHog request, or tracker mutation was performed.

## Tasks completed

1. Added exact `posthog-js@1.428.6` dependency and lockfile graph.
2. Added `src/lib/analytics.js` with:
   - blank-key permanent no-op and lazy one-time SDK loading;
   - fixed `https://eu.i.posthog.com` host;
   - explicit disablement of automatic capture, replay, profiles, flags, surveys, experiments, tours, conversations,
     external dependency loading, referrer/campaign storage, device model, performance, and IP capture;
   - frozen eight-event/property schemas and fixed failure enums;
   - status/name-only failure classification;
   - pre-capture validation and final `before_send` reconstruction;
   - synchronous and asynchronous loader/init/capture/request-error isolation.
3. Added 35 adapter tests covering missing configuration, one-time initialization, queued early capture, every event,
   every application enum, forbidden sensitive inputs, SDK-added property removal, top-level profile mutation removal,
   anonymous reserved metadata, and failure surfaces.
4. Added optional `VITE_POSTHOG_KEY` plumbing to `.env.example`, the SST static-site build, its contract test, and the
   test deployment workflow.
5. Initialized analytics from `src/main.jsx` while preserving `src/instrument.js` as the first import.
6. Instrumented Cognito callback success/failure with ordering, identical-error, and analytics-failure tests.
7. Instrumented public questionnaire resume/start/completion only at acknowledged state boundaries.
8. Instrumented shared public/CPA two-phase uploads after completion and on identical-error rethrow, with surface-only
   tests.
9. Instrumented the mounted PDF signer for required-field validation, PDF generation, and signed-record persistence.
10. Instrumented CPA-assisted completion and final `ready_for_filing`/`filed` workflow transitions.
11. Added the privacy and event data dictionary.

## Validation

### Passed

- `npm ci` — exit 0; 1,069 packages installed. It reported the repository's existing peer/deprecation warnings, a
  non-fatal Windows `EPERM` cleanup warning, and 35 audit findings.
- `npm ls posthog-js --depth=0` — exact `posthog-js@1.428.6`.
- `npm test` — 14 files, 150 tests passed.
- `npm run test:foundation` — 44 files, 350 tests passed.
- Focused analytics/auth/file/questionnaire/PDF/CPA tests — passed.
- `npx vitest run --config vitest.foundation.config.js infra/sst/__tests__/contracts.test.ts lambda/pdf-generator/__tests__/handler.test.mjs`
  — 2 files, 21 tests passed.
- Touched-file ESLint command from the plan — passed.
- `npm run typecheck:foundation` — passed.
- `npm run lint:foundation` — passed.
- `npm run build` — passed.
- `node tooling/verify_sst_foundation.mjs --mode contract --stage test` — passed.
- `python tooling/validate_codex_layer.py` — passed (31 skills, 6 custom agents).
- `git diff --check` — passed; only Git's existing LF-to-CRLF working-copy notices were emitted.
- Sentry audit — `src/instrument.js` has no diff from the merge base; current blob hash is
  `5738f0545b986e87d486cda09602701309ccd86b`.
- Pinned SDK declaration audit — every configured privacy option is present in the installed 1.428.6 type declarations;
  deprecated `advanced_disable_decide` is not used.

### Known baseline failures

- `npm run typecheck` — exit 2 with 147 existing UI/checkJs diagnostics. The two analytics-related signer literal
  diagnostics found during implementation were fixed; remaining touched-file diagnostics are the pre-existing
  shadcn primitive prop-typing failures in `CpaFillQuestionnaire.jsx`.
- `npm run lint` — exit 1 with two unrelated existing unused imports:
  `getResponses` in `src/components/questionnaire/CompletionScreen.jsx` and `Button` in
  `src/pages/UserManagement.jsx`. All files changed for runtime instrumentation pass the focused lint command.

### Not run

- `npm run sst:diff:test` — not run because neither `AWS_PROFILE` nor `AWS_REGION` is configured in this session. The
  AWS operations contract requires an authenticated profile and deployer-permission verification before a preview.
- Live PostHog EU acceptance — not run because no owner-approved project key/consent confirmation or live-test scope
  was supplied. No key was added to a local file or GitHub Environment, and no deployment was attempted.

## Deviations and issues

- The implementation followed the planned seams and event contract. The final guard was strengthened to reconstruct
  the safe top-level capture envelope as well as properties, removing optional `$set`, `$set_once`, `$unset`, and any
  unknown top-level data.
- Validation ran under installed Node `v24.13.0`, not the repository-declared Node `20.17.0`; npm emitted the expected
  engine warning. Tests, build, and foundation checks nevertheless passed.
- Installing the pinned SDK necessarily advanced shared transitive `core-js` and `dompurify` versions to satisfy the
  SDK's declared ranges. The existing explicit ARM64 canvas dependency was preserved after npm attempted to normalize
  the duplicate dependency/optional-dependency declaration.

## Ready next step

The local implementation is ready for `$piv-commit`. Live acceptance remains a separately authorized post-deployment
gate once the owner provides the PostHog EU project configuration and confirms consent/scope.
