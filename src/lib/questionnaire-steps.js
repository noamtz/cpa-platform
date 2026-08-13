/**
 * Pure helpers for questionnaire step state.
 * No React, no side effects — just data transforms.
 */

/**
 * Build the full STEPS array: [welcome, ...contentSteps, done]
 */
export function buildSteps(activeSteps) {
  return [
    { id: "welcome", type: "welcome" },
    ...activeSteps.map((s) =>
      // Only use pdf_sign type (skip yes/no) when skip_question is true
      s.response_type === "pdf_sign" && s.pdf_sign_config?.pdf_template_id && s.skip_question
        ? { id: s.id, type: "pdf_sign", config: s }
        : { id: s.id, type: "question", config: s }
    ),
    { id: "done", type: "done" },
  ];
}

/**
 * Parse signed_pdfs JSON string into a Map<step_id, record>.
 */
export function parseSignedPdfs(signedPdfsJson) {
  if (!signedPdfsJson) return {};
  try {
    const arr = JSON.parse(signedPdfsJson);
    return Object.fromEntries(arr.map((r) => [r.step_id, r]));
  } catch {
    return {};
  }
}

/**
 * Determine which step index to resume on when loading an in-progress submission.
 * Returns the 1-based index into STEPS (1 = first content step).
 * stepCompleted: the step_completed value from the submission (0-based content index + 1 offset).
 */
export function getResumeStepIndex(resolvedSteps, responses, signedPdfsById, totalSteps, stepCompleted = 0) {
  let firstUnanswered = null;
  for (let i = 0; i < resolvedSteps.length; i++) {
    const s = resolvedSteps[i];
    let answered;
    if (s.response_type === "pdf_sign") {
      answered = !!signedPdfsById[s.id] || responses[s.id]?.answer === false;
    } else {
      answered = responses[s.id]?.answer !== undefined;
    }
    if (!answered && firstUnanswered === null) {
      firstUnanswered = i + 1; // +1 for welcome step offset
    }
  }

  if (firstUnanswered === null) {
    // All steps answered — go to done
    return Math.min(resolvedSteps.length + 1, totalSteps - 1);
  }

  // If step_completed is ahead of the first unanswered step,
  // the answer was likely lost due to a race condition — trust step_completed.
  const stepCompletedIndex = stepCompleted > 0 ? stepCompleted : 0;
  if (stepCompletedIndex >= firstUnanswered) {
    return Math.min(stepCompletedIndex, totalSteps - 2);
  }

  return firstUnanswered;
}

/**
 * Derive which step IDs are completed / incomplete for the StepSelector UI.
 */
export function deriveStepStatuses(activeSteps, responses, signedPdfsById) {
  const completedStepIds = [];
  const incompleteStepIds = [];

  for (const s of activeSteps) {
    if (s.response_type === "pdf_sign") {
      const rec = signedPdfsById[s.id];
      if (rec) {
        if (rec.exempted_by_cpa) {
          completedStepIds.push(s.id);
        } else if (rec.incomplete) {
          incompleteStepIds.push(s.id);
        } else {
          completedStepIds.push(s.id);
        }
      } else if (responses[s.id]?.answer === false) {
        // Client answered "no" to the yes/no question — mark as complete
        completedStepIds.push(s.id);
      }
    } else {
      if (responses[s.id]?.answer !== undefined) completedStepIds.push(s.id);
    }
  }

  return { completedStepIds, incompleteStepIds };
}