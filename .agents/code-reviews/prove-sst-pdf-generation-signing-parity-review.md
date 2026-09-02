# Code review — SST PDF generation and signing parity

**Branch:** `feature/prove-sst-pdf-generation-signing-parity`

**Reviewed commit:** `b2734d34166c30ca781148d788fc42ad3350df98` plus the current working tree

**PR:** not created

## Summary

Request changes. The handler, endpoint resolver, SST resource split, focused tests, and aggregate-only logging are
coherent, but the branch cannot yet provide the proof its name and plan require. The boundary profile does not
approach the effective Lambda response limit and models that limit against decoded HTTP bytes instead of the
base64-bearing Lambda proxy envelope. Separately, the staged-bundle verifier targets an artifact that `sst diff`
does not create and is not called by the deployment workflow.

## Stats

- Files Modified: 14
- Files Added: 10
- Files Deleted: 0
- New lines: 2,950
- Deleted lines: 242

## Findings

### High

```text
severity: high
file: tooling/verify_pdf_parity.mjs
line: 219
issue: The boundary profile can pass without exercising the real synchronous-response or latency boundary.
detail: buildProfilePayload pads only the request to the profile minimum; it does nothing to make the generated PDF approach the declared output maximum or the HTTP timeout. A direct run of the shipped boundary payload produced a 1,000,083-byte request, a 29,525-byte PDF, and completed generation in 382 ms, so it is not evidence for the planned near-limit output or 30-second behavior. The limit model is also wrong for this handler shape: index.mjs base64-encodes the PDF inside the Lambda proxy response, so a 5,900,000-byte PDF becomes 7,866,668 base64 bytes before JSON overhead, exceeding Lambda's 6,291,456-byte synchronous response-payload quota even though the verifier's decoded-response ceiling would accept it. AWS documents a 6 MB synchronous Lambda request/response payload quota and a separate 10 MB HTTP API payload quota. The current focused test only checks the synthetic request size and configured ceiling, allowing the core measured-limits acceptance criterion to false-pass.
suggestion: Generate deterministic below-limit and above-limit PDFs whose complete serialized Lambda proxy responses straddle the 6 MB quota (the practical raw-PDF ceiling is roughly 4.5 MiB because of base64), and add a latency/load case that materially approaches the HTTP timeout. Assert expected success/failure through the deployed endpoint, update the fixture bands and runbook terminology, and add regressions against actual output/envelope sizes rather than configuration values alone.
```

Supporting AWS limits: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) and
[HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html).

### Medium

```text
severity: medium
file: tooling/verify_pdf_bundle.mjs
line: 80
issue: The staged-bundle proof is unusable with the documented preview output and is absent from the deployment gate.
detail: The verifier unconditionally opens <artifacts>/<function>/code.zip. After the successful SST preview, the emitted PDF artifact is .sst/artifacts/PdfRendererFunction-src and there is no .sst/artifacts/PdfRendererFunction/code.zip; running the documented npm command fails with ENOENT. The workflow then proceeds directly from `sst diff` to the cutover check and conditional deployment without invoking verify:pdf-bundle. Consequently the exact font digest and Linux ARM64 native-binary checks required by the plan and AC #1 are neither reproducible after preview nor enforced before deployment. The post-deploy health check only proves that some font bytes loaded, not that their digest is correct.
suggestion: Make the verifier understand the staging directory SST actually emits (including an exact AArch64 ELF-machine check), or add a deterministic packaging step that materializes the final archive before deployment. Invoke that verification immediately after preview and before the deploy step, and add focused valid/missing/wrong-font/wrong-architecture verifier tests.
```

### Critical

None.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| `npm run test:pdf` | PASS — 2 files / 17 tests |
| `npm run test:foundation` | PASS — 30 files / 219 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| Foundation contract verifier | PASS — schema v3 and distinct PDF API/function inventory |
| `git diff --check` | PASS — configured line-ending notices only |
| Boundary generation probe | FAILS INTENT — 1,000,083-byte request, 29,525-byte output, 382 ms |
| `npm run verify:pdf-bundle -- --artifacts .sst/artifacts --function PdfRendererFunction` | FAIL — expected `PdfRendererFunction/code.zip` does not exist after preview |

## Recommendation

**Request changes.** Correct the effective response-limit model and make the boundary profile genuinely exercise it;
then make exact staged-asset verification runnable and mandatory before the conditional test deployment.

## Resolution

Both findings were accepted and fixed on the feature branch:

1. The boundary profile now embeds a deterministic off-page image resource that is preserved in every copied PDF
   page without changing visible pixels. Under Node 20.17.0 it produces a 5,705,426-byte request, a 4,224,443-byte
   PDF, and a 5,632,933-byte complete Lambda proxy response. The verifier models base64 expansion, enforces the 6 MB
   Lambda synchronous-payload quota independently from its decoded HTTP read ceiling, records proxy-payload bytes,
   and has an explicit over-limit regression.
2. The bundle verifier now accepts the preview staging directory SST actually emits, verifies the exact font copy
   source, exact `@napi-rs/canvas-linux-arm64-gnu@0.1.100` package, and the ELF64 AArch64 machine header. The test
   deployment workflow runs it immediately after `sst diff` and before the cutover/deploy gate. Post-deploy live
   verification downloads and inspects Lambda's actual `code.zip`, closing the final-copy proof.

Post-fix validation passed with 108 application tests, 21 focused PDF tests, 223 foundation/backend/tooling tests,
clean foundation typecheck/lint, a successful production build, contract/bundle/Codex-layer verification, and
`git diff --check`. Full application typecheck remains at the accepted imported baseline of 150 diagnostics with
zero touched-path hits. Full lint reports 16 inherited source errors plus three generated `.sst/artifacts` rule
metadata errors (two are in the newly previewed PDF bundle); no touched source file has a lint error.
