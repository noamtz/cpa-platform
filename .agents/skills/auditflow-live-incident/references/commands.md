# Incident command catalog

Run commands with Node 20.17.0 from the repository root. Replace `<profile>` with the explicit user-confirmed local profile. Do not paste credentials or public questionnaire tokens into any command.

## Read-only evidence

```powershell
npm run incident:test -- preflight --stage test --profile <profile>
npm run incident:test -- probe-health --stage test --profile <profile>
npm run incident:test -- logs --stage test --profile <profile> --request-id <request-id> --minutes 15
npm run incident:test -- boundary-diff --stage test --profile <profile>
```

`logs` returns at most 50 recent, sanitized events. `boundary-diff` reports statement/action drift without printing policy ARNs or account IDs.

## Local incident gate

```powershell
npm run test:incident
npm run typecheck:foundation
npm run lint:foundation
```

Run this gate before a narrow boundary mutation. The tests derive DynamoDB permissions from runtime SDK imports and transaction primitives.

## Test-only boundary repair

```powershell
npm run incident:test -- boundary-sync --stage test --profile <profile> --confirm-test-boundary-sync
```

The sync verifies STS identity, refuses root and the deployment role, reads the current managed policy, renders the desired policy from `infra/sst/deployment-policy.ts`, creates a new default version only when drift exists, verifies readback, preserves the previous default for rollback, and removes older non-default versions.

Rollback only to the newest retained non-default version returned by the sync:

```powershell
npm run incident:test -- boundary-rollback --stage test --profile <profile> --version-id <version-id> --confirm-test-boundary-rollback
```

## Focused live probes

Health is read-only. The public first-save probe writes invented data through the real CloudFront/API/Lambda path:

```powershell
npm run incident:test -- probe-public-first-save --stage test --profile <profile> --confirm-test-first-save
```

The write probe creates an invented client directly, performs the real first save, queries its generated Submission, and deletes the client, Submission, and active guard in a `finally` cleanup. The ChangeJournal entry is deliberately retained as immutable audit evidence and contains no public-link token because the probe client starts in `in_progress` state.

## Application-code fallback

There is intentionally no direct Lambda code updater. For code or configuration changes use:

```powershell
npm run test:incident
node tooling/verify_sst_foundation.mjs --mode deployer --stage test
npm run sst:diff:test
npm run sst:deploy:test
node tooling/verify_sst_foundation.mjs
```

Run the focused probe first after deployment, then the full repository validation once.
