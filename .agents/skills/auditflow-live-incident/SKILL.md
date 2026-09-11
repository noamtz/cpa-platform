---
name: auditflow-live-incident
description: Diagnose and repair AuditFlow test-environment API 5xx/403 incidents with account-pinned AWS evidence, request-correlated logs, boundary drift checks, narrow test-only IAM synchronization, and focused smoke probes. Use for live test-stage failures or requests to fix the deployed test environment quickly. Do not use for ordinary local debugging, production mutation, broad release validation, or full E2E testing.
---

# AuditFlow live incident

Resolve one deployed test-stage failure through the shortest evidence-backed path.

## Inputs

Resolve these from the current request before mutation:

- failing route or user action;
- exact stage; mutation is supported only for `test`;
- an explicit local AWS profile supplied or previously confirmed by the user;
- API Gateway/Lambda request ID when available.

Never choose a profile by its name, dump AWS config, expose credentials or public-link tokens, or infer authority to mutate production. If the profile is missing, continue with local/read-only code analysis and ask one focused question before AWS access.

Read `.agents/references/auditflow-api-security-contracts.md` and `.agents/references/auditflow-aws-operations.md` before live work. Read [the command catalog](references/commands.md) before running the incident utility.

## Fast path

1. Preserve the current worktree. Record the failing route and request ID without copying secrets into commands or notes.
2. Run the identity preflight. Stop on account mismatch; do not print either account ID.
3. Run the health probe. If the request ID is known, query only its recent Lambda log events.
4. Run the workload-boundary diff for permission-shaped failures. Compare every SDK command and transaction primitive, not only the top-level API call.
5. Choose the smallest safe repair:
   - If the owner-managed test workload boundary alone differs from the source policy, run the focused incident tests, then the confirmed boundary sync. Readback is mandatory.
   - If application code, configuration, resources, or data must change, use the normal focused tests, SST diff, and SST deployment. Do not directly update Lambda code.
   - If evidence is insufficient, add or use sanitized structured provider diagnostics. Do not start a broad E2E run merely to discover the provider error.
6. Verify with the smallest matching probe. Use the disposable first-save probe only when a real write is necessary; it removes its business records but intentionally retains the immutable diagnostic journal entry.
7. Run the project’s full validation once after the fix is proven. Escalate to full E2E only when the affected behavior crosses several browser/API boundaries or the focused probe cannot establish parity.

## Safety boundaries

- Boundary sync and rollback require their exact confirmation flags and reject production.
- Preserve the immediately previous boundary version for rollback.
- Treat a mismatch between source policy and deployed policy as a stop condition unless the requested fix explicitly reconciles that drift.
- Do not use real clients or tokens in probes. The utility generates an invented client and never prints its token.
- Report any retained diagnostic audit entry; do not claim a write probe left zero durable evidence.
- Base44 and production AWS remain untouched unless separately authorized.

## Completion

Return the root cause, exact narrow repair, focused probe result, cleanup status, and final validation status. Include the provider request ID only when it is useful and contains no sensitive material.
