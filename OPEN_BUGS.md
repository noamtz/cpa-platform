# Open Bugs & Architectural Issues

## 1. Ghost PDF Template References in Questionnaire Steps
- **Issue**: When a PDF Template is deleted and recreated (or re-uploaded), it is assigned a new ID. However, existing `QuestionnaireTemplate` steps still point to the old, deleted PDF Template ID. This creates a "ghost" template reference.
- **Symptoms**: The signing page fails with `{"error": "Template not found"}` because the API call `getPdfTemplateById` tries to load the old ID which no longer exists in the `PdfTemplate` database collection.
- **Status**: Open / Pending fix

### Proposed Prevention / Protection Mechanisms:
1. **Referential Integrity / Delete Validation**:
   - Prevent deletion of a PDF template if it is currently referenced by any Questionnaire Template steps.
   - Show a warning to the CPA listing the steps that reference this template, prompting them to re-assign or delete those steps first.
2. **Editor-side Warning**:
   - In the CPA Questionnaire Settings editor, show a visual warning (e.g. red warning icon) on any step referencing a PDF template ID that does not exist.
3. **Soft-deletion / Archiving**:
   - Implement archiving for PDF templates instead of permanent deletion, so historical or active steps referencing them still load a read-only archived version if needed.
