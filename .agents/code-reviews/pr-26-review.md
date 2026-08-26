# PR #26 Merge-gate review — Private S3 files and ZIP downloads

**Reviewed head:** `6d8efae3ca2f2d97915cdd3916773cad4d686843`

## Summary

The latest ZIP lease fencing and conditionally journaled PdfTemplate mirror fixes are sound, and the complete local
suite remains healthy relative to the imported frontend baseline. The fresh merge-gate pass nevertheless found two
High-severity production-flow regressions: a new taxpayer cannot upload a document before the first Submission is
created, and the active PDF-signing page requests a template through a compatibility route that the SST API does not
provide. Both block acceptance criterion #1, so PR #26 is not ready to merge.

## Findings

### Critical

None.

### High

#### 1. First-time questionnaire uploads dereference a missing Submission

Evidence: `src/components/questionnaire/QuestionStep.jsx:76-87`, `src/pages/ClientQuestionnaire.jsx:161-180`, and
`src/pages/ClientQuestionnaire.jsx:223-276`.

When a client has no active Submission, `ClientQuestionnaire` intentionally leaves `submission` null and moves from
the welcome screen directly to the first configured question. The default first question is an upload step. Selecting
a file calls `uploadPublicFile` with `submission.id`, but the first Submission is only created later when Continue
invokes `updateClientSubmission`. The property access therefore throws before upload initiation, so a new client who
answers “yes” cannot upload the required first document.

Fix: establish and return an active provisional Submission before enabling the first direct upload, without advancing
the questionnaire step, and use that acknowledged ID/version for upload initiation and subsequent saves. Add a
frontend or assembled-flow regression covering a client with no active Submission uploading on the first question.

#### 2. The active PDF-signing route calls an endpoint absent from the SST API

Evidence: `src/pages/PdfSignIframeOverlay.jsx:281-289`, `src/App.jsx:42-50`, `backend/api/handler.ts:78-86`, and
`backend/api/handler.ts:221-228`.

`/questionnaire/sign` is the production signing page. Its load path posts directly to
`/api/apps/{appId}/functions/getPdfTemplateById`, but the SST handler allowlists and registers only the seven listed
public compatibility routes; an unknown route returns 404 before dependency construction. The local Vite Base44
proxy can mask this gap, while the deployed Router sends `/api/*` to the SST API. Consequently the production signing
flow fails before loading the template.

Fix: add an AWS-backed, token-authorized public template-read compatibility route that verifies the requested PDF
template is referenced by the authorized client's active questionnaire and returns the mirrored template JSON needed
by the signing page. Do not restore the source endpoint's unauthenticated lookup. Add an assembled-route regression
and a production-signing-page regression proving the AWS route is used.

### Medium

None.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| PR state | PASS — open, non-draft, mergeable, clean; GitHub deploy check succeeded |
| Node/npm | PASS — Node 20.17.0 and npm 10.8.2 |
| `npm ci` | PASS — documented peer/engine/deprecation warnings; audit reports 31 findings |
| Direct dependency pins | PASS — S3 client, presigner, multipart helper, and JSZip resolve to exact versions |
| `npm test` | PASS — 10 files, 96 tests |
| `npm run test:foundation` | PASS — 28 files, 199 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run typecheck` | BASELINE — 151 diagnostics versus 233 documented; zero changed-path hits |
| `npm run lint` | BASELINE — 17 errors versus 23 documented; zero changed-path hits |
| `npm run build` | PASS — existing Browserslist-age notice only |
| SST contract verifier | PASS — test-stage contract and worker inventory verified |
| Private-file cutover gate | PASS — correctly blocks deployment because issue #11 evidence is absent |
| Codex-layer validation | PASS — 31 skills and 6 custom agents |
| `git diff --check origin/main...HEAD` | PASS |
| `npm run sst:diff:test` | BLOCKED — STS rejects the cached test credential with `InvalidClientTokenId` |
| Live AWS/browser acceptance | NOT RUN — requires issue #11 evidence, refreshed credentials, and authorized deployment |

The external preview and live-acceptance gaps are not the basis for this verdict. The two findings follow directly
from the committed component lifecycle and exact API route allowlist.

## What is done well

- Terminal ZIP status is now fenced through the conditionally updated lease object, preventing a stale owner from
  replacing the takeover winner.
- PdfTemplate mirroring carries source concurrency, uses conditional persistence, and records ordered ChangeJournal
  evidence with idempotent replay behavior.
- Upload/read contracts remain metadata-only, opaque, resource-derived, and covered by broad authorization and
  failure-path tests.
- Deployment correctly fails closed until issue #11 publishes bounded import evidence.
- All changed paths remain free of frontend typecheck and lint diagnostics.

## Recommendation

**Request changes.** Fix the first-Submission upload lifecycle and provide the scoped AWS template-read route used by
the production signing page, add regressions for both flows, then rerun the full validation and merge-gate review.

## Resolution

Both High findings were accepted and fixed on the PR branch:

1. Starting a questionnaire without an active Submission now waits for the journaled provisional Submission response
   before rendering the first question. The acknowledged ID and revision are installed through the existing save
   queue, the persisted step remains at the welcome boundary, and the start button is disabled while creation is in
   flight. Regression coverage proves the first upload step stays unavailable until acknowledgement and that an
   existing Submission is reused.
2. The active signing page now loads PDF template JSON through an explicit AWS compatibility route carrying
   `client_id`, `token`, and `template_id`. The route reuses the scoped template-file authorization boundary: it
   requires an active Submission, pins that Submission's questionnaire, verifies the questionnaire references the
   requested PDF template, and returns only the ID, optional name, and template JSON. Contract, service, assembled
   route, SST inventory, and production signing-client regressions cover the new path.

Post-fix validation passed under Node 20.17.0: 99 frontend tests, 201 foundation/backend tests, foundation typecheck
and lint, production build, SST contract verification, Codex-layer validation, dependency-pin checks, and
`git diff --check`. Repository-wide frontend typecheck and lint remain at the imported baseline (150 diagnostics and
17 errors, with zero changed-path hits); the typecheck count improved by one because the touched welcome button now
uses the repository's typed-primitive compatibility pattern. The private-file deployment gate continues to block on
missing issue #11 evidence as designed. The SST diff remains externally blocked because the cached AWS credential
returns `InvalidClientTokenId`; live AWS/browser acceptance was not run.

**Resolution status:** fixed locally; ready for a fresh PR review after commit and push.
