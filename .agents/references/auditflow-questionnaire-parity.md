# AuditFlow questionnaire parity

Use this when changing questionnaire navigation or saving. Preserve serialized saves through a promise queue, resume at the first unanswered step while respecting the server's `step_completed` race guard, and treat a PDF step as complete when it is signed, CPA-exempted, or answered “no.” Evidence: source `src/pages/ClientQuestionnaire.jsx`, `src/pages/CpaFillQuestionnaire.jsx`, `src/lib/questionnaire-steps.js`, and `src/lib/__tests__/questionnaire-steps.test.js`.

Add or update characterization tests before changing these state transitions. The fuller edge-case inventory is in source `src/docs/QUESTIONNAIRE_STATE_MACHINE.md` and `src/docs/SUBMISSION_ARCHIVING_FLOW.md`; those docs guide discovery, while executable code and tests decide current behavior.
