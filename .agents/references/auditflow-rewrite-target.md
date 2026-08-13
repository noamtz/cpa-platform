# AuditFlow rewrite target

Status: accepted owner direction, 2026-08-12.

- Preserve the existing AuditFlow UI and externally observable behavior.
- Migrate the application runtime fully from Base44 to AWS.
- Treat `C:\Users\ntzur\workspace-antigravity\auditflow` as a read-only behavioral and migration reference unless the owner explicitly requests changes there.
- Treat Base44 code, schemas, and data formats as behavioral and migration inputs, not target-platform dependencies.
- Retire Base44 only after the corresponding AWS path has parity evidence and a rollback-safe cutover.
- This decision does not select AWS services for authentication, persistence, file storage, background work, or secrets; record those choices separately before binding the rewrite to them.
