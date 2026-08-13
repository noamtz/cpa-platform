/**
 * Compatibility layer for submissions.
 * Handles conversion between old flat-field format and new dynamic responses format.
 */

// Maps old flat fields to step IDs
const LEGACY_FIELD_MAP = {
  employee: {
    answerField: "is_employee",
    filesField: "form_106_files",
    confirmField: "form_106_uploaded",
  },
  pension: {
    answerField: "has_pension_fund",
    filesField: "pension_files",
  },
  stocks: {
    answerField: "has_stock_market",
    filesField: "form_867_files",
    confirmField: "form_867_uploaded",
  },
  insurance: {
    answerField: "has_life_insurance",
    filesField: "insurance_files",
  },
  donations: {
    answerField: "has_donations",
    filesField: "donation_files",
  },
  additional: {
    answerField: "has_additional_income",
    textField: "additional_income_details",
  },
};

/**
 * Detect if a submission uses the old flat-field format.
 */
export function isLegacySubmission(submission) {
  return !submission.responses && !submission.template_version;
}

/**
 * Convert old flat-field submission to new responses format.
 * Returns a responses object (parsed, not JSON string).
 */
export function legacyToResponses(submission) {
  const responses = {};

  for (const [stepId, fields] of Object.entries(LEGACY_FIELD_MAP)) {
    const answer = submission[fields.answerField];
    if (answer === undefined) continue;

    const entry = { answer };

    if (fields.filesField && submission[fields.filesField]?.length > 0) {
      entry.files = submission[fields.filesField];
    }

    if (fields.textField && submission[fields.textField]) {
      entry.text = submission[fields.textField];
    }

    responses[stepId] = entry;
  }

  return responses;
}

/**
 * Get the responses object from a submission (handles both formats).
 * Always returns a parsed object.
 */
export function getResponses(submission) {
  if (!submission) return {};

  if (isLegacySubmission(submission)) {
    return legacyToResponses(submission);
  }

  // New format: responses is a JSON string
  if (typeof submission.responses === "string") {
    try {
      return JSON.parse(submission.responses);
    } catch {
      return {};
    }
  }

  // Already parsed or empty
  return submission.responses || {};
}

/**
 * Calculate progress percentage from a submission + template steps.
 * @param {object} submission - The submission object
 * @param {array} activeSteps - Only enabled steps from the template
 * @returns {number} Progress percentage (0-100)
 */
export function getStepProgress(submission, activeSteps) {
  if (!submission || !activeSteps?.length) return 0;

  const responses = getResponses(submission);

  // Parse signed PDFs to check which pdf_sign steps are completed
  let signedPdfsById = {};
  if (submission.signed_pdfs) {
    try {
      const arr = JSON.parse(submission.signed_pdfs);
      for (const record of arr) {
        if (record.step_id) signedPdfsById[record.step_id] = record;
      }
    } catch {}
  }

  const answeredCount = activeSteps.filter((step) => {
    if (step.response_type === 'pdf_sign') {
      // Count as done if signed, OR if client answered "no" (not relevant)
      return !!signedPdfsById[step.id] || responses[step.id]?.answer === false;
    }
    return responses[step.id]?.answer !== undefined;
  }).length;

  return Math.round((answeredCount / activeSteps.length) * 100);
}

/**
 * Replace {TAX_YEAR} / {year} placeholders with the actual submission tax year.
 */
function resolvePlaceholders(text, submission) {
  if (!text) return text;
  const year = submission?.tax_year || new Date().getFullYear();
  return text.replace(/\{TAX_YEAR\}/g, year).replace(/\{year\}/g, year);
}

/**
 * Get all file URIs from a submission (handles both formats).
 * Returns array of { stepId, stepTitle, files[] }
 */
export function getAllFiles(submission, activeSteps) {
  if (!submission) return [];

  const responses = getResponses(submission);
  const fileGroups = [];
  const addedStepIds = new Set();

  // First: steps in the template (preserves order)
  for (const step of activeSteps) {
    const response = responses[step.id];
    if (response?.answer && response.files?.length > 0) {
      fileGroups.push({
        stepId: step.id,
        label: resolvePlaceholders(step.upload_config?.title || step.title, submission),
        files: response.files,
        file_names: response.file_names || [],
      });
      addedStepIds.add(step.id);
    }
  }

  // Also include files from responses not in the current template
  // (custom steps or steps removed since submission was created)
  for (const [stepId, response] of Object.entries(responses)) {
    if (!addedStepIds.has(stepId) && response?.answer && response.files?.length > 0) {
      fileGroups.push({
        stepId,
        label: response.title || stepId,
        files: response.files,
        file_names: response.file_names || [],
      });
    }
  }

  return fileGroups;
}

/**
 * Check if a step has been completed (answered) in a submission.
 */
export function isStepAnswered(submission, stepId) {
  const responses = getResponses(submission);
  return responses[stepId]?.answer !== undefined;
}

/**
 * Build a flat summary of step statuses for dashboard display.
 * Returns array of { label, emoji, answer, hasFiles, fileCount, text }
 * Uses title/emoji from responses if available (saved at answer time), falls back to template.
 */
export function getStepSummary(submission, activeSteps) {
  const responses = getResponses(submission);
  const stepsById = Object.fromEntries(activeSteps.map(s => [s.id, s]));

  const summary = [];

  for (const step of activeSteps) {
    const response = responses[step.id];
    summary.push({
      stepId: step.id,
      label: resolvePlaceholders(response?.title || step.title, submission),
      emoji: response?.emoji || step.emoji,
      answer: response?.answer,
      hasFiles: (response?.files?.length || 0) > 0,
      fileCount: response?.files?.length || 0,
      text: response?.text || null,
    });
  }

  // Add any answered responses not in the template (new questions added after submission)
  const stepsInTemplate = new Set(activeSteps.map(s => s.id));
  for (const [stepId, response] of Object.entries(responses)) {
    if (!stepsInTemplate.has(stepId) && response?.answer !== undefined) {
      summary.push({
        stepId,
        label: response.title || stepId,
        emoji: response.emoji || '❓',
        answer: response.answer,
        hasFiles: (response?.files?.length || 0) > 0,
        fileCount: response?.files?.length || 0,
        text: response?.text || null,
      });
    }
  }

  return summary;
}