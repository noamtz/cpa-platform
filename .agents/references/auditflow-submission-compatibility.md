# AuditFlow submission compatibility

Use this for persistence design, import tooling, or submission reads/writes. The Base44 JSONC entities describe source data to migrate, not the target AWS database design. Preserve the externally observed shapes of `Submission.responses`, `signed_pdfs`, and `cpa_audit_log`, which are JSON-encoded strings in the existing system, and continue reading legacy flat submission fields until migrated data no longer needs the compatibility path. Evidence: source `base44/entities/Submission.jsonc`, `src/lib/submission-compat.js`, and `src/lib/__tests__/submission-compat.test.js`.

Any normalization of these fields belongs behind the target persistence/API boundary so UI behavior stays stable. Do not select an AWS database or reshape stored data merely by copying Base44's entity layout; that choice requires an architecture decision. See `.agents/references/auditflow-rewrite-target.md`.
