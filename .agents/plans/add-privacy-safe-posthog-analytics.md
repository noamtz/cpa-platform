# Feature: Add minimal privacy-safe PostHog analytics

The following plan is complete, but implementation must first revalidate issue #13, the current `main` branch,
the pinned PostHog package/API, the canonical Wiki architecture, and the active diff. Pay special attention to the
closed event/property schemas, the active (rather than dormant or DEV-only) workflow seams, and the requirement that
analytics remain best-effort. Do not alter `src/instrument.js`, the Sentry dependency/configuration, or any product
state transition in order to make telemetry easier to emit.

## Feature Description

Add a small browser-only analytics adapter that sends a documented set of operational workflow milestones to
PostHog Cloud EU when, and only when, an explicit public project key is configured. The adapter will lazy-load the
exact pinned browser SDK, disable every automatic collection surface, retain only schema-approved application and
SDK properties immediately before transmission, use a random session-scoped anonymous identifier, and absorb SDK
initialization/capture/transport failures.

Instrument the acknowledged boundaries of CPA sign-in, public questionnaire start/resume/completion, private-file
upload, PDF generation/signing, CPA-assisted questionnaire completion, and final CPA workflow status transitions.
The events report only fixed outcomes, fixed milestone/surface enums, and coarse failure categories. They never
receive or derive properties from a CPA/client/user record, questionnaire answer, file, URL, raw exception, or
application identifier. A repository data dictionary will be the human-readable contract for the event names,
triggers, allowed properties, prohibited data, identity behavior, and EU configuration.

## User Story

As the AuditFlow product owner,
I want privacy-safe operational milestones for the migrated workflows,
so that I can verify real workflows succeed or fail after migration without identifying a CPA client or changing
the product experience.

## Problem Statement

The migration has tests and deployment evidence but no production funnel/operational analytics. The owner therefore
cannot tell whether critical real journeys reach their durable success boundaries or where they fail. Broad browser
analytics would be disproportionate and risky because public URLs contain access tokens and the UI handles names,
email addresses, tax questionnaire responses, filenames, signatures, and document content. Telemetry also cannot be
allowed to become a new dependency of the save queues, signing flow, navigation, or Sentry crash diagnostics.

## Solution Statement

Introduce a single `src/lib/analytics.js` boundary with these responsibilities:

- Read only a browser-safe `VITE_POSTHOG_KEY`; a blank/missing key returns a permanent no-op without importing or
  initializing PostHog and therefore cannot issue a PostHog request.
- Dynamically import exactly pinned `posthog-js@1.428.6`, initialize it against the fixed
  `https://eu.i.posthog.com` host, and explicitly disable autocapture, pageview/pageleave/dead-click/exception/
  performance/heatmap capture, feature/survey remote collection, and session recording.
- Use PostHog's anonymous random ID with `persistence: "sessionStorage"` and `person_profiles: "never"`. Do not expose an
  `identify` API and do not accept a user/client/submission/template ID as adapter input.
- Validate every event against a frozen per-event schema before capture. A `before_send` guard must repeat the
  allowlist at the final SDK boundary and strip URL/referrer/path/user-agent/device/session and every other automatic
  property, retaining only the random `$distinct_id`, necessary SDK library metadata, the no-person-profile marker,
  and the documented application properties.
- Catch synchronous SDK exceptions, rejected lazy initialization, and request errors; callers never `await` analytics.
- Classify failures from numeric HTTP status or exact known error names into fixed enums without reading, copying,
  serializing, or forwarding an error message/body/stack/request URL.

Call sites emit after the existing durable acknowledgement on success and immediately before preserving the current
failure result/rethrow on failure. PostHog is not added to the backend or PDF Lambda, and no page/component may import
the raw SDK.

## Out of Scope / Non-Goals

- Not included: autocapture, pageviews, page-leave events, dead clicks, exception capture, web vitals, heatmaps,
  surveys, feature flags, group analytics, user profiles, cohorts, or PostHog session replay.
- Not included: names, email addresses, phone/contact details, CPA/client/user/submission/template/step IDs, record
  IDs, public link tokens, query strings, paths, full URLs, answers, tax values, document categories, filenames,
  file contents/URIs/sizes/types, template JSON, field values, signatures, raw exception payloads, stacks, or messages.
- Not included: cross-session user tracking. The pseudonymous ID is random and session-scoped; it is not derived from
  Cognito claims, application records, URLs, browser fingerprinting, or customer data.
- Not included: server-side PostHog events or changes to the PDF Lambda's existing aggregate CloudWatch logging.
- Not included: telemetry in dormant `PdfSignStepWrapper`/`PdfFormStep`, DEV-only PDF POCs, or unmounted agent flows.
- Not included: a new consent UI or a legal/privacy-policy redesign. Production enablement remains an explicit owner
  configuration decision; a different consent requirement is an operational gate, not something to guess in code.
- Not changing: Sentry source, DSN, tracing, unmasked replay, sampling, ErrorBoundary, dependency, or observed behavior.
- Not changing: questionnaire save ordering/resume semantics, upload retries/progress, PDF upload fail-soft behavior,
  CPA transitions, Hebrew copy, RTL layout, toasts/alerts, navigation, or persisted state.
- Not included: production deployment, DNS, Base44, migration data, AWS tables/buckets/Lambdas, or Terraform changes.

## Feature Metadata

**Feature Type**: New Capability

**Estimated Complexity**: High

**Primary Systems Affected**: Vite browser bootstrap/configuration, analytics adapter, Cognito callback, public
questionnaire, browser file client, active PDF signer, CPA-assisted questionnaire, dashboard status transitions,
SST StaticSite build configuration, test deployment workflow, frontend/foundation tests, operational documentation

**Dependencies**: Closed issues [#7](https://github.com/noamtz/cpa-platform/issues/7) and
[#10](https://github.com/noamtz/cpa-platform/issues/10); exact `posthog-js@1.428.6`; an owner-created PostHog Cloud EU
project and environment-scoped public project key for live acceptance

## Related Work

**Implements**: [issue #13](https://github.com/noamtz/cpa-platform/issues/13)  ·  **Epic**:
[issue #1](https://github.com/noamtz/cpa-platform/issues/1) ·
[PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) ·
[Architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- `.agents/plans/preserve-public-questionnaire-persistence-resume.md` and
  [PR #25](https://github.com/noamtz/cpa-platform/pull/25) - owns the acknowledged start/save/resume/complete seams.
- `.agents/plans/prove-sst-pdf-generation-signing-parity.md` and
  [PR #27](https://github.com/noamtz/cpa-platform/pull/27) - owns the active SST PDF signer and privacy-safe aggregate
  logging precedent.
- `.agents/plans/complete-cpa-workflow-template-parity.md` and
  [PR #28](https://github.com/noamtz/cpa-platform/pull/28) - owns the CPA workflow and template boundaries.

**Forward-references**:

- [Issue #14](https://github.com/noamtz/cpa-platform/issues/14) - production-readiness gates consume this issue's
  test-stage analytics evidence.
- [Issue #15](https://github.com/noamtz/cpa-platform/issues/15) - production cutover and 72-hour watch use the
  documented events without expanding the schema.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (Architecture map through Ground rules) - Repository boundaries, Node version, validation suite,
  AWS-only target, and explicit issue #13 migration status.
- `.agents/references/auditflow-frontend-conventions.md` (entire file) - JavaScript/JSX placement, imports, naming,
  RTL, generated-UI, lint, and typecheck conventions.
- `.agents/references/auditflow-questionnaire-parity.md` (entire file) - Save queue and resume invariants that
  analytics must not disturb.
- `.agents/references/auditflow-pdf-pipeline.md` (entire file) - Active server-rendered PDF boundary and lazy browser
  tooling requirements.
- `src/main.jsx` (lines 1-11) - `./instrument` must stay the first import and the Sentry ErrorBoundary must remain.
- `src/instrument.js` (lines 1-25) - Owner-approved Sentry tracing and unmasked replay; byte-for-byte no-touch file.
- `src/api/cognito-auth.js` (lines 17-105, 108-136) - Factory injection pattern, callback success boundary before
  `location.replace`, and runtime Vite configuration pattern.
- `src/api/__tests__/cognito-auth.test.js` (lines 5-100) - Injectable OIDC/location fakes and callback-order tests.
- `src/pages/ClientQuestionnaire.jsx` (lines 82-182, 214-300, 419-544) - Load/resume decision, serialized saves,
  acknowledged start/complete, and active route to the PDF signer. URLs in lines 488-490 and 527-529 contain tokens.
- `src/lib/questionnaire-start.js` (lines 1-10) and
  `src/lib/__tests__/questionnaire-start.test.js` (lines 13-51) - Start happens only after a Submission exists and
  the first step remains blocked until acknowledgement.
- `src/api/file-client.js` (lines 14-69, 73-138) - Shared two-phase public/CPA upload boundary and injected factories;
  central instrumentation avoids exposing component file/answer objects.
- `src/api/__tests__/file-client.test.js` (lines 20-104) - XHR/initiate/complete/progress/error test pattern and
  sensitive synthetic fixtures that can prove telemetry redaction.
- `src/pages/PdfSignIframeOverlay.jsx` (lines 252-343, 416-537) - Mounted signer load, validation, generation, fail-soft
  upload, durable signed-record save, token-bearing return URL, and existing Sentry capture at lines 337-339.
- `src/pages/CpaFillQuestionnaire.jsx` (lines 120-185) - CPA queued save and durable assisted-questionnaire completion.
- `src/components/dashboard/ClientRow.jsx` (lines 754-787) - The two final CPA workflow transitions:
  `ready_for_ira` and `reviewed`.
- `lambda/pdf-generator/index.mjs` (lines 134-162, 298-339) and
  `lambda/pdf-generator/__tests__/handler.test.mjs` (lines 246-283) - Existing aggregate-only telemetry and a test
  that forbids URLs, template fields/values, signatures, and customer fixture content. Mirror its privacy posture,
  not its server logging implementation.
- `.env.example` (lines 1-13) - Committed blank browser configuration pattern; never inspect or commit local env files.
- `infra/sst/application.ts` (lines 210-229) - StaticSite build-time Vite environment injection.
- `infra/sst/__tests__/contracts.test.ts` (lines 380-398) - Source-contract assertion pattern for StaticSite settings.
- `.github/workflows/deploy-sst-test.yml` (lines 93-109, 111 onward) - Environment-scoped CI variables and Node
  20.17.0 SST preview/deploy validation.
- `vitest.config.js` (lines 1-10) - Node-based frontend test discovery under `src/**/__tests__`.
- `docs/migration/auditflow-source-baseline.md` (lines 43-56) and
  `.agents/reports/complete-cpa-workflow-template-parity-report.md` (Validation results) - Inherited frontend
  lint/typecheck failures versus current zero-regression expectations.

### New Files to Create

- `src/lib/analytics.js` - Sole PostHog import/init/capture boundary, event schemas, final payload allowlist, no-op
  behavior, and safe failure categorization.
- `src/lib/__tests__/analytics.test.js` - Configuration, schema, redaction, pseudonymity, ordering/failure isolation,
  and final-envelope tests with an injected fake SDK.
- `docs/analytics-data-dictionary.md` - Event purpose, trigger, exact properties/enums, reserved SDK properties,
  forbidden data, identity/retention behavior, configuration, ownership, and validation instructions.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [PostHog JavaScript SDK installation](https://posthog.com/docs/libraries/js#installation)
  - Specific section: package installation, browser import, and CSP requirements.
  - Why: Use the supported browser package path and verify the current site has no CSP that blocks EU ingestion.
- [PostHog JavaScript configuration builder](https://posthog.com/docs/libraries/js/config#configuration-builder)
  - Specific options: `api_host`, `autocapture`, pageview/pageleave/dead-click/exception/heatmap/performance capture,
    persistence, person profiles, session recording, feature/remote behavior, `before_send`, and request errors.
  - Why: Automatic collection defaults are broader than `autocapture`; each privacy-relevant option must be explicit.
- [PostHog privacy/data collection](https://posthog.com/docs/privacy/data-collection#autocapture)
  - Specific sections: disabling autocapture and overriding/rejecting events with `before_send`.
  - Why: The final-send guard is the defense against SDK-added URL/referrer/device properties.
- [PostHog manual event capture](https://posthog.com/docs/libraries/js/usage#capturing-events)
  - Specific section: `posthog.capture(eventName, properties)`.
  - Why: Only explicit named milestones are permitted.
- [Current PostHog browser defaults source](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/posthog-core.ts#L262-L346)
  - Why: Revalidate exact defaults/options against pinned `1.428.6`; do not rely on changing SDK defaults.
- [Vite environment variables](https://vite.dev/guide/env-and-mode.html#env-variables-and-modes)
  - Why: `VITE_POSTHOG_KEY` is intentionally exposed to the browser and must contain only the public project key,
    never a PostHog personal/API secret.

### Patterns to Follow

**Naming conventions:** Keep the reusable pure/browser boundary in kebab-case `src/lib/analytics.js` with named
exports. Event names and enum values use lowercase snake_case. Page/component files remain PascalCase and import only
`captureOperationalEvent`, never `posthog-js`.

**Dependency injection:** Mirror `createCognitoAuth` (`src/api/cognito-auth.js:17-23`) and `createFileClient`
(`src/api/file-client.js:51-60`): the analytics factory accepts an SDK loader and browser storage so Node tests use
fakes and issue zero requests.

**Error handling:** The adapter is fail-closed for data and fail-open for product behavior. Unknown events,
properties, values, or forbidden shapes are dropped. SDK throws/rejections are swallowed inside the adapter.
Workflow catches emit a fixed category and then retain the exact existing return/rethrow/control-flow behavior.
Never forward `FunctionCallError.body`, `error.message`, `error.stack`, `response`, or a caught object.

**Logging:** Add no console logging for PostHog failures. Preserve the existing console/Sentry behavior. The
`on_request_error` callback is an empty non-throwing function.

**Closed event/data contract:** The adapter and dictionary must agree on exactly these application events:

| Event | Trigger | Allowed application properties |
|---|---|---|
| `cpa_sign_in` | Cognito callback succeeds before redirect, or rejects | `outcome`; failure-only `failure_category` |
| `questionnaire_start` | Welcome start receives/uses an acknowledged Submission, or start persistence returns false | `outcome`; failure-only `failure_category` |
| `questionnaire_resume` | Loaded incomplete Submission is recognized as already started | `outcome` (`success` in current flow) |
| `questionnaire_complete` | Public completion save is acknowledged, or returns false | `outcome`; failure-only `failure_category` |
| `file_upload` | Shared public/CPA two-phase upload completes, or rejects | `outcome`; `surface` (`public`/`cpa`); failure-only `failure_category` |
| `pdf_generate` | Mounted signer generation resolves, or rejects | `outcome`; failure-only `failure_category` |
| `pdf_sign` | Signed-PDF record persistence is acknowledged, validation blocks, or submit rejects | `outcome`; failure-only `failure_category` |
| `cpa_workflow_complete` | CPA-assisted completion or final status transition resolves/returns false | `outcome`; `milestone` (`assisted_questionnaire`, `ready_for_filing`, `filed`); failure-only `failure_category` |

`outcome` is exactly `success` or `failure`. `failure_category` is selected only from `authentication`,
`authorization`, `validation`, `not_found`, `conflict`, `persistence`, `transport`, `service`, or `unknown`.
No free-form string, count, timestamp, duration, file property, route, or identifier is accepted. At the final SDK
boundary retain only these documented reserved properties where required: random anonymous `$distinct_id`, `$lib`,
`$lib_version`, and the no-person-profile marker. Strip every other SDK-generated property.

**Call-site sequencing:** A success capture follows the existing awaited acknowledgement; a failure capture occurs
without awaiting and the existing false return/rethrow/alert/toast/navigation continues unchanged. Analytics never
enters `saveQueue`, never becomes part of `Promise.all`, and never changes a returned Submission or status result.

---

## IMPLEMENTATION PLAN

### Phase 1: Closed Analytics Boundary

Pin the browser dependency, encode the closed event/property schemas, implement lazy explicit-config initialization,
and prove the final SDK event is stripped before any product call site is touched.

**Tasks:**

- Add exact `posthog-js@1.428.6` package/lock entries.
- Implement the injected analytics factory/singleton and its complete privacy/failure-isolation test matrix.
- Add blank local and environment-scoped SST/CI configuration without enabling analytics by default.

### Phase 2: Acknowledged Workflow Milestones

**Depends on:** Phase 1 (all call sites depend on the schema-enforcing no-throw adapter)

Add minimal calls at the existing durable success/failure boundaries. Keep active public/CPA/PDF paths separate and
leave dormant/DEV paths untouched.

**Tasks:**

- Bootstrap analytics after Sentry initialization without awaiting it.
- Instrument Cognito callback completion/failure.
- Instrument public questionnaire start/resume/complete.
- Instrument shared public/CPA file upload.
- Instrument active PDF generation and signed-record persistence.
- Instrument CPA-assisted completion and the two final dashboard transitions.

### Phase 3: Contract Documentation and Regression Gates

**Depends on:** Phase 2 (the dictionary documents the implemented event/call-site contract)

Publish the repository data dictionary, run privacy scans and full local validation, prove Sentry has no diff, and
prepare an owner-authorized EU test-stage verification that uses only synthetic business data.

**Tasks:**

- Document every event/property and operational configuration/ownership rule.
- Run frontend, foundation, build, lint/typecheck comparison, Codex-layer, and diff validation.
- With explicit authorization and a configured EU project only, verify network envelopes and PostHog ingestion.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE `package.json` and `package-lock.json`

- **IMPLEMENT**: run `npm install --save-exact posthog-js@1.428.6`; keep it in browser dependencies and commit the
  resulting lockfile only. Do not update unrelated packages or add a React provider/plugin.
- **PATTERN**: `package.json:10-32` uses exact pins for behavior-sensitive runtime dependencies; privacy behavior
  must not drift through a caret range.
- **GOTCHA**: Recheck the pinned package's exported default and config option names against official source/docs.
  Do not silently move to a newer version merely because `latest` changed after this plan.
- **VALIDATE**: `npm ls posthog-js --depth=0; npm test`
- **SATISFIES**: AC #2 and #8.

### 2. CREATE `src/lib/analytics.js` and `src/lib/__tests__/analytics.test.js`

- **IMPLEMENT**: export the fixed EU host, frozen event/property schemas, safe status/name-only failure classifier,
  injected `createAnalytics`, and runtime `initializeAnalytics`/`captureOperationalEvent` singleton wrappers.
- **IMPLEMENT**: return a permanent no-op before SDK import when the trimmed project key is blank. With a key,
  dynamically load the SDK once; coalesce concurrent initialization/capture calls; queue or safely drop early valid
  captures until initialization settles; never reject to a caller.
- **IMPLEMENT**: initialize with `api_host: "https://eu.i.posthog.com"`, `persistence: "sessionStorage"`,
  `person_profiles: "never"`, `autocapture: false`, `capture_pageview: false`, `capture_pageleave: false`,
  `capture_dead_clicks: false`, `capture_exceptions: false`, `capture_heatmaps: false`,
  `capture_performance: false`, `disable_session_recording: true`, `save_campaign_params: false`,
  `save_referrer: false`, `disableDeviceModel: true`, `advanced_disable_flags: true`, `disable_surveys: true`,
  `disable_web_experiments: true`, `disable_product_tours: true`, `disable_conversations: true`,
  `disable_external_dependency_loading: true`, `ip: false`, and an empty non-throwing `on_request_error` callback.
  Revalidate these exact names against the pinned package; do not use deprecated `advanced_disable_decide`.
- **IMPLEMENT**: validate application properties before `capture`; `before_send` must reject unknown events and
  reconstruct properties from the event's schema plus only the documented reserved SDK fields. Do not recursively
  sanitize arbitrary input—unknown/invalid input is dropped in full so sensitive values cannot be transformed into
  apparently safe data.
- **TEST**: missing/blank config never invokes the loader/init/capture and issues no request; concurrent init loads
  once; every allowlisted event/enum passes; unknown event/key/value/object/array/function is dropped; failure-only
  fields cannot appear on success; required fields cannot be omitted.
- **TEST**: feed invented names, email, client/submission IDs, public token, token-bearing URL, query/path, answers,
  tax values, filename/URI, template JSON, signature, and raw `Error` through every public adapter surface; assert
  none appear in the final event object or its JSON serialization.
- **TEST**: fake SDK auto-adds `$current_url`, `$pathname`, `$referrer`, `$useragent`, device/session fields, and
  unexpected nested data; `before_send` strips them while retaining only schema properties and the anonymous ID/
  SDK metadata. Assert the adapter exposes no identify method and accepts no ID input.
- **TEST**: loader rejection, init throw, capture throw, `before_send` invalid input, storage failure, and request-error
  callback all resolve/no-op without throwing; a sentinel product-state object remains unchanged.
- **PATTERN**: `src/api/__tests__/cognito-auth.test.js:5-41` and `src/lib/__tests__/pdf-api.test.js:41-85` inject
  browser/network dependencies; `lambda/pdf-generator/__tests__/handler.test.mjs:246-283` asserts forbidden telemetry.
- **VALIDATE**: `npx vitest run src/lib/__tests__/analytics.test.js`
- **SATISFIES**: AC #1-#5 and #8.

### 3. UPDATE `.env.example`, `infra/sst/application.ts`, `infra/sst/__tests__/contracts.test.ts`, and `.github/workflows/deploy-sst-test.yml`

- **IMPLEMENT**: document blank `VITE_POSTHOG_KEY=` as a public browser project key. Do not add a configurable host;
  the adapter owns the EU host and rejects host drift by construction.
- **IMPLEMENT**: add `VITE_POSTHOG_KEY: process.env.VITE_POSTHOG_KEY ?? ""` to the StaticSite environment. Add the
  same job environment variable from the GitHub Environment-scoped `vars.VITE_POSTHOG_KEY`; absence must produce the
  same valid no-op build.
- **IMPLEMENT**: extend the foundation source-contract test to assert the exact StaticSite mapping. Do not add the
  key to SST outputs, backend Lambda environment, IAM, secrets, tables, or the committed foundation JSON inventory.
- **GOTCHA**: a PostHog project key is intentionally public in a Vite bundle. Never configure a PostHog personal API
  key as `VITE_*`. Do not read or print local ignored env files.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js infra/sst/__tests__/contracts.test.ts; npm run build`
- **SATISFIES**: AC #1, #2, and #8.

### 4. UPDATE `src/main.jsx`

- **IMPLEMENT**: import the analytics initializer only after the existing first `./instrument` import and Sentry
  import; invoke it once without `await` before/around root rendering. Preserve the ErrorBoundary and fallback.
- **PATTERN**: `src/main.jsx:1-11`; this is the sole application bootstrap.
- **GOTCHA**: do not move, wrap, edit, or dynamically load Sentry. Do not place PostHog in `src/instrument.js`. A
  missing key, slow chunk, blocked network, or SDK error must not delay React rendering.
- **VALIDATE**: `npm run build; $mergeBase = git merge-base HEAD origin/main; git diff --exit-code $mergeBase -- src/instrument.js`
- **SATISFIES**: AC #1, #4, #6, and #8.

### 5. UPDATE `src/api/cognito-auth.js` and `src/api/__tests__/cognito-auth.test.js`

- **IMPLEMENT**: inject the no-throw capture function into `createCognitoAuth`. Emit `cpa_sign_in/success` after
  `signinRedirectCallback` validates state and immediately before `location.replace`; on rejection emit only
  `cpa_sign_in/failure` with a fixed classified category, then rethrow the identical error for `AuthCallback`.
- **PATTERN**: `src/api/cognito-auth.js:85-99` is the durable sign-in callback boundary; lines 6-14 already sanitize
  return paths but no path belongs in analytics.
- **TEST**: event ordering is callback resolution -> capture -> existing replace; capture throw/rejection does not
  prevent replace; callback rejection retains error identity and existing UI failure path; captured data contains
  neither callback user/state/return path nor credentials.
- **GOTCHA**: do not instrument `me`, silent token refresh, logout, or unauthenticated dashboard redirects as sign-ins;
  they would inflate or mislabel the operational milestone.
- **VALIDATE**: `npx vitest run src/api/__tests__/cognito-auth.test.js`
- **SATISFIES**: AC #4 and #5.

### 6. UPDATE `src/pages/ClientQuestionnaire.jsx`

- **IMPLEMENT**: after load identifies a non-completed, already-started Submission and selects the resume index,
  emit `questionnaire_resume/success`. Emit nothing for invalid/missing links or already completed views.
- **IMPLEMENT**: make `handleStart` observe the existing `startQuestionnaireWithSubmission` result without changing
  the helper contract: emit success only after acknowledged/reused Submission opens step one; emit failure/
  `persistence` on a false result; return the same result.
- **IMPLEMENT**: emit `questionnaire_complete/success` only after `updateSubmission(..., true)` returns the
  acknowledged Submission; emit failure/`persistence` on false and preserve the exact current step/scroll/return.
- **PATTERN**: `ClientQuestionnaire.jsx:224-269` owns the serialized save queue; lines 281-300 own start/complete.
- **GOTCHA**: never pass `clientId`, `token`, `submission`, `templateId/version`, active steps, `stepData`, responses,
  completion time, or `location`. Analytics must not run inside `saveQueue.current.enqueue`.
- **VALIDATE**: `npx vitest run src/lib/__tests__/questionnaire-start.test.js src/lib/__tests__/questionnaire-save-queue.test.js src/lib/__tests__/questionnaire-steps.test.js; npx eslint src/pages/ClientQuestionnaire.jsx --quiet`
- **SATISFIES**: AC #3-#5.

### 7. UPDATE `src/api/file-client.js` and `src/api/__tests__/file-client.test.js`

- **IMPLEMENT**: inject `captureEvent` into `createFileClient`. Wrap the shared public and CPA upload return paths so
  an acknowledged complete response emits `file_upload/success` with only `surface`; a rejection emits failure plus
  a safe category and rethrows the identical error. Keep initiate -> XHR PUT -> complete -> 100% progress unchanged.
- **PATTERN**: `file-client.js:51-69` is the central upload pipeline and already supports injected browser factories.
- **TEST**: both surfaces emit once after complete, not at initiate/PUT; initiate/PUT/complete failures emit once and
  preserve rejected error identity; capture failure never changes returned URI, progress callbacks, or rejection.
- **TEST**: existing fixtures intentionally contain file objects, names, sizes, content types, upload IDs/headers,
  signed URLs, client/token/submission/owner/step IDs, and returned URIs; assert none enter the captured event JSON.
- **GOTCHA**: do not add file purpose because the approved architecture forbids document categories. Do not
  instrument download/signed-URL methods as uploads.
- **VALIDATE**: `npx vitest run src/api/__tests__/file-client.test.js`
- **SATISFIES**: AC #3-#5.

### 8. UPDATE `src/pages/PdfSignIframeOverlay.jsx`

- **IMPLEMENT**: add a local fixed stage enum, not error-derived text. Emit `pdf_sign/failure` with `validation` when
  required-field validation blocks submission, without passing missing field names.
- **IMPLEMENT**: wrap only `generatePdf`: emit `pdf_generate/success` after the Blob resolves or failure with a fixed
  category before rethrowing the identical exception into the existing outer catch.
- **IMPLEMENT**: emit `pdf_sign/success` only after `updateClientSubmission` acknowledges the signed record and before
  the existing done state/timed token-bearing navigation. The outer catch emits `pdf_sign/failure` once per attempt,
  categorized from the fixed stage, then preserves the console/alert/finally behavior.
- **PATTERN**: lines 416-537 are the mounted production submit path. Preserve the existing fail-soft upload catch at
  lines 471-490; Task 7 records its upload outcome independently, and signing may still succeed with no file URI.
- **GOTCHA**: keep `Sentry.captureException` at lines 337-339 exactly as-is. Never pass template/field inputs, Blob,
  generated size, file, signed record, audit trail, navigator/screen, URL state, IDs, token, or caught error.
- **VALIDATE**: `npx vitest run src/lib/__tests__/pdf-api.test.js src/api/__tests__/file-client.test.js; npx eslint src/pages/PdfSignIframeOverlay.jsx --quiet; npm run build`
- **SATISFIES**: AC #3-#6.

### 9. UPDATE `src/pages/CpaFillQuestionnaire.jsx` and `src/components/dashboard/ClientRow.jsx`

- **IMPLEMENT**: in CPA fill, emit `cpa_workflow_complete` with milestone `assisted_questionnaire` after the
  completion save returns true; emit failure/`persistence` on false; preserve queue/error/reload/scroll behavior.
- **IMPLEMENT**: after each `transitionSubmissionStatus` resolves, emit success with `ready_for_filing` or `filed`
  before the existing refresh. On rejection emit a classified failure and rethrow the identical error so the existing
  event-handler behavior is not converted into a handled product state.
- **PATTERN**: `CpaFillQuestionnaire.jsx:142-185` absorbs known save failures into boolean results;
  `ClientRow.jsx:754-787` has the two direct atomic backend status transitions.
- **GOTCHA**: do not send the target status string directly; map it to the closed milestone enum. Never pass client,
  submission, row, audit, progress, year, or error data. Do not instrument link-copy because it exposes a token URL.
- **VALIDATE**: `npx vitest run src/lib/__tests__/cpa-fill.test.js; npx eslint src/pages/CpaFillQuestionnaire.jsx src/components/dashboard/ClientRow.jsx --quiet; npm run build`
- **SATISFIES**: AC #3-#5.

### 10. CREATE `docs/analytics-data-dictionary.md`

- **IMPLEMENT**: document the eight-event table above with purpose, precise trigger, owner, exact required/optional
  property names and enums, success/failure meaning, and examples containing invented enum values only.
- **IMPLEMENT**: document the final reserved SDK properties, random session-scoped identity/no profiles, hard-coded
  EU host, blank-key no-op, package version, disabled features, best-effort delivery, expected latency/possible loss,
  key rotation/disable procedure, and PostHog/GitHub Environment owners.
- **IMPLEMENT**: list every prohibited field class from this plan and state that an event-schema change requires code,
  tests, and dictionary in the same review. Include verification queries that use event/property names only—never
  customer examples.
- **GOTCHA**: do not include a real project key, endpoint with project/query data, screenshot, distinct ID, user/client
  example, or captured production payload. This is a technical contract in the repository, not a duplicate Wiki PRD.
- **VALIDATE**: `rg -n "cpa_sign_in|questionnaire_start|questionnaire_resume|questionnaire_complete|file_upload|pdf_generate|pdf_sign|cpa_workflow_complete|eu\.i\.posthog\.com" docs/analytics-data-dictionary.md`
- **SATISFIES**: AC #2, #3, and #7.

### 11. RUN full local validation and privacy/Sentry diff audit

- **IMPLEMENT**: use Node 20.17.0; perform clean install and every repository suite. Compare inherited frontend lint/
  typecheck diagnostics with the latest accepted report and require zero diagnostics in touched files.
- **AUDIT**: inspect the complete diff for any raw SDK import outside `src/lib/analytics.js`, any free-form event/
  property construction, any identifier/error/URL/file/answer passed to capture, and any Sentry/instrumentation change.
- **AUDIT**: search production code/docs for PostHog calls and verify each is one of the eight allowlisted events;
  verify no `identify`, group, recorder, pageview, autocapture, or direct `posthog.capture` escapes the adapter.
- **VALIDATE**: `npm ci; npm test; npm run typecheck; npm run lint; npm run build; npm run test:foundation; npm run typecheck:foundation; npm run lint:foundation; python tooling/validate_codex_layer.py; git diff --check`
- **VALIDATE**: `$mergeBase = git merge-base HEAD origin/main; git diff --exit-code $mergeBase -- src/instrument.js; rg -n 'posthog-js|posthog\.capture|\.identify\(|startSessionRecording|capture_pageview|autocapture' src -g '!src/lib/analytics.js'`
- **VALIDATE**: `npm run sst:diff:test` only as an owner-authenticated read-only infrastructure preview; verify no
  stateful replacement, production/Terraform/DNS change, new backend secret, or non-site PostHog configuration.
- **SATISFIES**: AC #1-#8.

### 12. PERFORM owner-authorized test-stage EU acceptance

- **PRECONDITION**: the owner creates/selects a PostHog Cloud EU project, configures only its public project key as
  the test GitHub Environment variable, explicitly authorizes the test deployment and synthetic workflow exercise,
  and confirms the applicable consent/privacy policy. Without those prerequisites, record this gate as not run.
- **RUN**: deploy the complete test stage, open a clean browser session, and exercise synthetic CPA sign-in; new and
  resumed questionnaire; completion; public and CPA upload; PDF generation/sign success/failure; CPA-assisted
  completion; ready-for-filing and filed transitions.
- **VERIFY ABSENCE**: with the key removed/blank, load and exercise the app while filtering browser network traffic
  for `posthog`; there must be zero PostHog requests and no product difference.
- **VERIFY EU/SCHEMA**: with the key set, inspect outgoing request envelopes and PostHog Live Events. Only the eight
  names, documented enums, reserved anonymous/SDK properties, and EU host may appear. Search the captured payload for
  synthetic name/email/client/submission/template/step IDs, token, token-bearing URL/query/path, answer text,
  filename/URI, template field/value, and signature sentinel strings; all must be absent.
- **VERIFY FAILURE ISOLATION**: block `eu.i.posthog.com` and make the fake/real transport fail while completing saves,
  uploads, PDF signing, and CPA transitions. UI results, returned values, persisted state, refresh/resume, and Sentry
  behavior must match the unblocked run; no spinner or navigation waits on analytics.
- **EVIDENCE**: retain only aggregate event counts by allowlisted name/outcome and pass/fail timestamps. Do not commit
  raw event envelopes, distinct IDs, keys, URLs, screenshots containing payload data, or synthetic business records.
- **CLEANUP**: remove/archive only the exact synthetic records through supported journaled paths. Disable/remove the
  test key if continued collection is not approved.
- **VALIDATE**: `npm run sst:deploy:test; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`
- **SATISFIES**: AC #1-#8 live acceptance.

---

## TESTING STRATEGY

### Unit Tests

- Analytics factory tests use an injected fake SDK/loader/storage and assert the exact init configuration rather than
  contacting PostHog. They cover missing config, one-time lazy init, early events, the eight event schemas, all enums,
  forbidden shapes/strings, final `before_send` reconstruction, session identity, and every SDK failure surface.
- Treat privacy as a positive allowlist: tests assert exact equality of the final properties object. A denylist-only
  assertion is insufficient because SDK upgrades can add new properties.
- Cognito tests assert capture ordering, no callback payload leakage, same error identity, and redirect continuity.
- File-client tests assert capture after complete, one failure event per rejection, unchanged progress/results/errors,
  and absence of every file/request/owner credential in capture calls.
- Existing questionnaire start/save/resume, PDF API, and CPA fill helpers remain characterization regressions. Do not
  introduce a browser component testing stack solely for analytics; page call sites are thin and receive manual
  browser acceptance plus full build/lint validation.

### Integration Tests

- SST source-contract tests prove blank/default StaticSite configuration and environment-scoped project-key mapping
  without exposing it as an output or backend environment value.
- The production Vite build proves the dynamically imported SDK chunk resolves and missing configuration still
  builds/renders normally.
- Owner-authorized browser acceptance verifies the actual PostHog request host/envelope, EU Live Events, absence mode,
  transport blocking, and persisted workflow state with synthetic records only.
- Existing PDF handler aggregate-log tests remain unchanged and pass, proving server logging does not regress while
  browser analytics is added.

### Edge Cases

- Undefined, null, empty, whitespace-only, non-string, or accidentally secret-like project configuration.
- Two bootstrap/capture calls during SDK load; load resolves after a route event; load/init/capture/request callback
  throws; sessionStorage unavailable/throws; browser goes offline; ad blocker/CSP blocks PostHog.
- Unknown event, misspelled event/property, extra key, missing required property, success with a failure category,
  failure without a category, invalid surface/milestone/outcome/category, object/array/Error/URL as a value.
- SDK injects current URL with `client`/`token`, referrer, pathname/query, browser/device/user-agent, session/replay,
  feature-flag, campaign, or automatic-event properties.
- Cognito callback success redirects immediately; callback rejection; capture throws; existing session refresh is not
  miscounted as sign-in.
- New questionnaire without Submission, reused Submission, resume with server step race guard, completed-on-load,
  stale/archive reload, queued save failure, final PDF step completion, and analytics unavailable throughout.
- Upload initiate failure, expired signed URL, XHR non-2xx/network/abort, complete failure, multiple files, public/CPA
  surface, signed-PDF fail-soft upload, and capture failure after a successful complete response.
- PDF required-field validation, template preparation failure, generation failure, zero-byte/no-upload path, upload
  failure that still saves, save conflict/failure, successful acknowledgement, and token-bearing delayed return URL.
- CPA completion conflict/generic failure; ready-for-filing/filed transition success/rejection; refresh behavior and
  backend ChangeJournal atomicity unchanged.

---

## VALIDATION COMMANDS

Use Node `20.17.0`. Run from the repository root. Full frontend lint/typecheck have an accepted imported baseline;
the pass condition is no new count/class and zero diagnostics in touched paths. Foundation checks must pass cleanly.

### Level 1: Syntax & Style

```powershell
node --version
npm ci
npx eslint src/main.jsx src/api/cognito-auth.js src/api/file-client.js src/pages/ClientQuestionnaire.jsx src/pages/PdfSignIframeOverlay.jsx src/pages/CpaFillQuestionnaire.jsx src/components/dashboard/ClientRow.jsx --quiet
npm run typecheck
npm run lint
npm run typecheck:foundation
npm run lint:foundation
git diff --check
```

### Level 2: Unit Tests

```powershell
npx vitest run src/lib/__tests__/analytics.test.js src/api/__tests__/cognito-auth.test.js src/api/__tests__/file-client.test.js src/lib/__tests__/questionnaire-start.test.js src/lib/__tests__/questionnaire-save-queue.test.js src/lib/__tests__/questionnaire-steps.test.js src/lib/__tests__/pdf-api.test.js src/lib/__tests__/cpa-fill.test.js
npm test
npm run test:foundation
```

### Level 3: Integration, Build, Contract, and Diff Tests

```powershell
npm run build
npx vitest run --config vitest.foundation.config.js infra/sst/__tests__/contracts.test.ts lambda/pdf-generator/__tests__/handler.test.mjs
node tooling/verify_sst_foundation.mjs --mode contract --stage test
python tooling/validate_codex_layer.py
$mergeBase = git merge-base HEAD origin/main
git diff --exit-code $mergeBase -- src/instrument.js
npm run sst:diff:test
```

Inspect the SST preview for a static-site build update only; no stateful replacement, API/Lambda/IAM expansion,
production/Terraform/DNS change, or project key in outputs.

### Level 4: Manual Local Validation

1. Run with `VITE_POSTHOG_KEY` blank. Complete representative local/synthetic flows and confirm zero PostHog request,
   unchanged screens/navigation/saves, and no console error added by analytics.
2. Use the injected fake SDK/test harness with a synthetic public key. Confirm one lazy load/init and exact events at
   each durable boundary; block/reject transport and confirm the product result/state is identical.
3. Inspect the production build/chunks: the PostHog SDK is lazy, the EU host is fixed, and the project key is the only
   supported runtime input. Verify source maps/bundle contain no personal PostHog API secret.
4. Inspect the diff around every capture call. Each call contains literals or closed enum mappings only; none receives
   product objects, caught errors, IDs, URL/location, file metadata, answers, or spread properties.
5. Confirm the existing Sentry ErrorBoundary, tracing targets, replay integration, mask/media settings, and sample
   rates are identical to the merge base.

### Level 5: Owner-Authorized Live Validation

```powershell
npm run sst:deploy:test
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
```

Execute Task 12 with disposable synthetic data and aggregate evidence only. Do not print or retain the PostHog key,
distinct ID, raw envelope, event URL, Cognito claims, client token, record IDs, answers, filenames, signatures, or
internal references.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 - Explicit configuration/no-op:** missing or blank configuration imports/initializes no PostHog SDK,
  issues no PostHog request, and leaves every product path unchanged.
- [ ] **AC #2 - EU closed event contract:** configured analytics sends only the eight documented event names to
  `https://eu.i.posthog.com` with exact per-event application properties and documented reserved SDK properties.
- [ ] **AC #3 - Sensitive-data exclusion:** automated tests and live synthetic inspection prevent names, emails,
  contact/client/application identifiers, record IDs, tokens, paths/query/full URLs, answers/tax values, document
  categories, filenames/content/URIs/metadata, template/field/signature data, and raw exceptions from entering events.
- [ ] **AC #4 - Non-invasive failure behavior:** SDK load/init/capture/transport/storage failure has no user-visible
  effect, adds no wait, changes no returned error/result, and does not alter questionnaire/upload/PDF/CPA saved state.
- [ ] **AC #5 - Operational usefulness without client identity:** outcomes and coarse categories distinguish success/
  failure at CPA sign-in, questionnaire start/resume/complete, upload, PDF generate/sign, assisted completion, and
  final CPA transitions using only a random session-scoped anonymous identifier.
- [ ] **AC #6 - Sentry preserved:** `src/instrument.js` has zero diff and Sentry initialization order, ErrorBoundary,
  tracing, unmasked replay, and sampling behavior remain unchanged.
- [ ] **AC #7 - Data dictionary:** `docs/analytics-data-dictionary.md` documents event purpose, precise trigger, exact
  allowed properties/enums, identity, forbidden data, EU/config behavior, failure semantics, and ownership.
- [ ] **AC #8 - Automatic collection disabled:** autocapture, pageview/pageleave, dead-click, exception, performance,
  heatmap, replay, profile, feature/remote, and survey collection are disabled and regression-tested.
- [ ] Full local validation passes subject only to the recorded untouched frontend lint/typecheck baseline, with zero
  touched-path diagnostics and no stateful/production infrastructure drift.
- [ ] Test-stage live acceptance is reported honestly as authorized-and-passed or not run; code no-op completion is
  not misrepresented as EU ingestion proof.

---

## COMPLETION CHECKLIST

- [ ] Issue #13, epic/Wiki decisions, #7/#10 closures, PostHog docs/version, and branch diff revalidated.
- [ ] Feature branch created from current `main`; no product code implemented during planning.
- [ ] Exact dependency/lockfile added with no unrelated upgrade.
- [ ] One analytics adapter owns all SDK access, event schemas, final property stripping, and failure isolation.
- [ ] Blank config and all forbidden payload/config/transport cases pass adapter tests.
- [ ] SST/CI/local browser config is environment-scoped, EU-fixed, and omitted from outputs/backend.
- [ ] Sentry-first bootstrap and complete Sentry configuration remain unchanged.
- [ ] All eight active workflow milestones are instrumented only at durable boundaries.
- [ ] Dormant/DEV paths, backend/PDF logging, workflow state, UI/copy/navigation, and Base44/production stay untouched.
- [ ] Data dictionary matches code/tests exactly and contains no keys or identifying examples.
- [ ] Each focused validation passes immediately; full frontend/foundation/build/contract/Codex/diff gates run.
- [ ] Inherited lint/typecheck baseline compared with zero touched-path regression.
- [ ] Read-only SST test diff inspected and safe.
- [ ] Any live deployment/browser/PostHog exercise performed only with explicit approval and aggregate evidence.
- [ ] Acceptance criteria checked, code reviewed, implementation report written, and plan/report committed with the
  feature implementation.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Resolved assumption - session pseudonym:** Use the SDK-generated random anonymous distinct ID with session-scoped
  persistence and no person profile/identify call. This supports within-session funnel correlation while avoiding
  cross-session customer tracking. Cross-session retention would be a privacy/product scope change.
- **Resolved assumption - fixed EU host:** Only `VITE_POSTHOG_KEY` is configurable; the adapter hard-codes
  `https://eu.i.posthog.com`. A configurable host would create an avoidable regional-compliance failure mode.
- **Resolved assumption - exact SDK pin:** Plan research found `posthog-js@1.428.6` current on 2026-09-08. Pin it
  exactly and explicitly configure privacy settings; do not inherit future default behavior through a range.
- **Resolved assumption - active signer only:** `App.jsx` mounts `PdfSignIframeOverlay` at `/questionnaire/sign`.
  `PdfSignStepWrapper`/`PdfFormStep` and DEV POCs are not instrumented merely because source files exist.
- **Resolved assumption - centralized upload:** Instrument `file-client.js`, not `QuestionStep`, so all current
  public/CPA two-phase uploads share one tested boundary and components never hand file/response data to analytics.
- **Assumption - configuration is enablement:** Issue/architecture approval plus an environment-scoped project key is
  the explicit technical enablement gate; no new in-product consent UI is required for these schema-closed operational
  events. If counsel/owner requires prior end-user consent, production enablement must stop and the consent experience
  must be designed separately rather than silently added to this migration slice.
- **Open operational prerequisite:** The owner must create/select a PostHog Cloud EU project and configure the public
  test project key before AC #2's live ingestion portion can be proven. The implementation and no-config AC #1 are not
  blocked; report live acceptance as not run until the prerequisite and deployment authorization exist.
- **No critical product decision is required to begin implementation.** Any request for persistent/user-linked
  identity, new event/property, raw performance/error data, server events, non-EU host, replay/autocapture, or Sentry
  change is a scope/architecture change and must be resolved explicitly.

## NOTES (open canvas)

### Privacy and delivery boundary

```text
existing durable workflow acknowledgement/failure
  -> literal allowlisted event + fixed enums only
  -> captureOperationalEvent (synchronous no-throw handoff)
  -> per-event schema rejects unknown data
  -> lazy exact PostHog SDK (only when key exists)
  -> before_send reconstructs exact final properties
  -> PostHog EU best-effort batch transport

Any failure from configuration/storage/import/init/capture/transport
  -> swallowed inside analytics boundary
  -> original workflow result/error/state/navigation continues
```

### Why the plan uses both pre-capture validation and `before_send`

Call-site schema validation prevents application code from passing sensitive workflow objects. It does not by itself
stop the browser SDK from adding current URL, referrer, browser/device, campaign, or session properties later.
`before_send` is therefore a second, final allowlist over the SDK-composed event. Both layers use exact equality tests;
a denylist would eventually miss a newly added SDK property.

### Why analytics is not awaited or flushed at navigation

The business requirement prioritizes product continuity over guaranteed telemetry delivery. Waiting for `capture`,
forcing immediate transport, or flushing before Cognito/questionnaire navigation would put PostHog latency/failure on
the critical path. The adapter may lose a final event under abrupt unload; the data dictionary must state this. If
loss becomes operationally material, evaluate a separately approved beacon/server design without weakening privacy.

### Confidence score

**8/10 for one-pass implementation.** The active workflow boundaries, environment injection, test patterns, Sentry
constraint, and privacy precedent are well evidenced. Remaining risk is concentrated in the pinned SDK's exact
automatic-property/config behavior and live EU envelope, which the final `before_send` allowlist, exact package pin,
fake-SDK tests, and owner-authorized network inspection address. The external PostHog EU project/key and consent
confirmation are operational prerequisites rather than unresolved code design.

## AMENDMENTS
