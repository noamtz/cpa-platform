# Code review — privacy-safe PostHog analytics

**PR:** [#36](https://github.com/noamtz/cpa-platform/pull/36)

**Branch:** `feature/add-privacy-safe-posthog-analytics`

**Reviewed commit:** `4d3d3a03113223af989d5ba7a1c0c589aa895b0f`

## Summary

Request changes. The call-site schemas, fail-open wrappers, AWS environment wiring, and workflow sequencing are
thoughtfully constrained, but the final PostHog privacy hook is incompatible with the real pinned SDK: it removes
properties that PostHog requires for ingestion, so all configured operational events are dropped. The same hook also
retains exact timestamps even though the approved privacy contract explicitly forbids them. The fake-SDK tests do not
model either behavior.

## Stats

- Files changed: 20
- Additions: 1,730
- Deletions: 42
- Critical findings: 0
- High findings: 2
- Medium findings: 2
- Low findings: 0

## Findings

### High

#### AGENT FIXES — The real SDK drops every event because the final guard removes required ingestion properties

`src/lib/analytics.js:100`

`filterPostHogEvent` rebuilds `event.properties`, but its reserved-property allowlist omits both `token` and the
actual SDK anonymous property `distinct_id` (the implementation currently allows `$distinct_id`, which is not the
normal property emitted here). In the installed and pinned `posthog-js@1.428.6`, event-property calculation adds the
project `token` before `before_send`; the before-send runner snapshots required ingestion properties and drops an
event if the hook removes one. Consequently this hook returns an envelope without `token`, and the SDK rejects the
event before transport. The test at `src/lib/__tests__/analytics.test.js:143` uses an invented envelope and invokes
the hook directly, so it false-passes without exercising the SDK's required-property check.

Retain only the immutable SDK-issued ingestion fields required by this pinned version (`token` and the
session-scoped anonymous `distinct_id`) at the final boundary; do not expose them through the application's public
capture API. Update the reserved-property documentation and add a realistic enriched-envelope regression that
proves a valid event survives the SDK's before-send check while caller-supplied data is still removed.

#### HUMAN DECIDES — The final envelope violates the explicit no-timestamp privacy contract

`src/lib/analytics.js:118`

The hook deliberately copies the SDK-added top-level `timestamp`, while the approved contract says timestamps are
forbidden (`docs/analytics-data-dictionary.md:15`) and calls for a closed final allowlist. The pinned SDK supplies
this value before `before_send`, so configured events carry an exact client timestamp. The current final-envelope
test does not provide a timestamp and therefore cannot catch the contradiction.

The recommended resolution is to remove `timestamp` from the returned envelope and add a realistic `Date` input to
the regression test, asserting that it is absent. If exact client timestamps are intentionally desired instead,
that is a privacy-contract change and needs explicit owner approval plus matching plan/dictionary/test updates.

### Medium

#### AGENT FIXES — The operational data dictionary does not satisfy the accepted documentation contract

`docs/analytics-data-dictionary.md:1`

The dictionary omits the required event/configuration owners, pinned SDK version, best-effort delivery and possible
loss/latency behavior, key rotation/disable procedure, schema-change governance, safe verification queries, and
invented enum-only examples. Its reserved-property section also documents `$distinct_id` instead of the actual SDK
`distinct_id`. Add the missing operational sections and keep the property description aligned with the corrected
final guard.

#### AGENT FIXES — Upload analytics regression coverage stops at one initiation failure

`src/api/__tests__/file-client.test.js:148`

The plan requires initiation, PUT, and completion failures plus injected capture failures, identical error identity,
unchanged URI/progress behavior, and a captured-JSON exclusion assertion over all sensitive fixtures. The added
tests cover both success surfaces and one public initiation rejection, but do not exercise XHR PUT failure,
completion failure, or thrown/rejected `captureEvent`; the public success fixture is also not checked as a complete
captured JSON string. Add the promised cases so the central upload wrapper's non-invasive and privacy guarantees do
not regress unnoticed.

## Review routing

### HUMAN READS

- `src/lib/analytics.js:100` — final privacy and ingestion boundary for every analytics event.
- `infra/sst/application.ts:229` — public PostHog project-key injection into the deployed frontend build.
- `src/api/cognito-auth.js:89` — authentication completion/failure sequencing around analytics capture.

### HUMAN TESTS

- `.agents/plans/add-privacy-safe-posthog-analytics.md:460` — the owner-authorized synthetic EU network acceptance
  was not run locally; complete it only after the final-envelope blockers are fixed.

### FYI

- `.agents/reports/add-privacy-safe-posthog-analytics-report.md:96` — local validation used Node 24.13.0 rather than
  the required Node 20.17.0. The PR's `Deploy SST test` check passed on Node 20.17.0, but it does not replace the
  missing live PostHog network inspection.
- `src/components/questionnaire/CompletionScreen.jsx:4` — full repository lint still reports this inherited unused
  import and `src/pages/UserManagement.jsx:5`; changed-file lint is clean.
- `src/components/dashboard/AddClientModal.jsx:41` — full repository typecheck remains red on the documented imported
  UI typing baseline; frontend/foundation tests, the build, and foundation typecheck are green.

## Validation

| Check | Result |
| --- | --- |
| PR head/status | PASS — head unchanged; `Deploy SST test` completed successfully |
| `npm ci` | PASS — installed exact `posthog-js@1.428.6` under local Node 24.13.0 |
| `npm test` | PASS — 14 files / 150 tests |
| Focused analytics/workflow tests | PASS — 8 files / 83 tests |
| `npm run test:foundation` | PASS — 44 files / 350 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run build` | PASS |
| Changed-file ESLint | PASS |
| Foundation contract verifier | PASS |
| `python tooling/validate_codex_layer.py` | PASS — 31 skills / 6 custom agents |
| `git diff --check` | PASS |
| Sentry instrumentation diff | PASS — unchanged |
| `npm run typecheck` | BASELINE FAIL — imported UI typing diagnostics remain |
| `npm run lint` | BASELINE FAIL — 2 inherited unused imports outside this PR |
| Owner-authorized EU network acceptance | NOT RUN |

## What is good

- The public capture API rejects unknown events, properties, and enum values before loading the SDK.
- Analytics calls do not receive raw identifiers, URLs, files, questionnaire content, or exceptions.
- Auth, upload, questionnaire, signing, and CPA workflow captures are placed after durable success boundaries or in
  failure paths that preserve existing error identity and control flow.
- Blank-key behavior, the hard-coded EU host, disabled automatic collection features, and SST environment wiring are
  explicit and covered by tests/contracts.
- Sentry bootstrap behavior is unchanged.

## Recommendation

**Request changes.** Fix and regression-test the real PostHog final envelope first, remove or explicitly re-approve
client timestamps, then complete the upload failure/capture test matrix and operational data dictionary before the PR
returns for review.

## Resolution

All four automated findings were accepted and fixed on the feature branch:

1. The final guard now retains the SDK-issued public project `token` only when it exactly matches the configured key,
   retains the anonymous session-scoped `distinct_id`, and fails closed when either field or the no-profile marker is
   invalid. The public capture schema still rejects caller-supplied ingestion fields.
2. Top-level client `timestamp` and property-level `$time` are removed. A realistic SDK-enriched envelope regression
   proves that the ingestion fields survive while timestamps and forbidden browser/session data do not.
3. Upload tests now cover initiation, signed PUT, and completion failures plus synchronous and asynchronous analytics
   failures, preserving product URI, progress, and rejected error identity.
4. The data dictionary now records exact SDK/version/envelope behavior, owners, the full prohibited-data contract,
   delivery/loss expectations, enable/disable/rotation operations, schema governance, and safe verification queries.

Post-fix validation ran with Node 20.17.0: 155 frontend tests and 350 foundation tests passed, as did the production
build, foundation typecheck/lint, changed-file lint, foundation contract verifier, Codex-layer validator, and
`git diff --check`. Full application typecheck and lint remain at the documented imported baseline; lint reports only
the same two unrelated unused imports. The owner-authorized synthetic EU network inspection remains a manual gate
after deployment.
