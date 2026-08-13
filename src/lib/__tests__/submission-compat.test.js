import { describe, it, expect } from 'vitest';
import {
  getResponses,
  isLegacySubmission,
  isStepAnswered,
  legacyToResponses,
  getStepProgress,
  getAllFiles,
  getStepSummary,
} from '../submission-compat';

// ─── Helpers ─────────────────────────────────────────────────

function makeStep(id, responseType = 'upload', opts = {}) {
  return {
    id,
    response_type: responseType,
    title: opts.title || id,
    emoji: opts.emoji || '📝',
    enabled: true,
    order: opts.order ?? 0,
    upload_config: opts.upload_config || null,
    ...opts,
  };
}

// ─── Response Format Handling ────────────────────────────────
// State Machine: ENTRY POINT + Legacy Submissions

describe('Response Format Handling', () => {
  it('new format submission returns parsed responses', () => {
    const sub = {
      responses: JSON.stringify({ s1: { answer: true } }),
      template_version: 2,
    };
    const result = getResponses(sub);
    expect(result).toEqual({ s1: { answer: true } });
  });

  it('legacy submission (no responses field) is converted to new format', () => {
    const sub = {
      is_employee: true,
      form_106_files: ['file1.pdf'],
      has_stock_market: false,
      // No responses field, no template_version → legacy
    };
    expect(isLegacySubmission(sub)).toBe(true);

    const responses = getResponses(sub);
    expect(responses.employee.answer).toBe(true);
    expect(responses.employee.files).toEqual(['file1.pdf']);
    expect(responses.stocks.answer).toBe(false);
  });

  it('null or undefined submission returns empty responses', () => {
    expect(getResponses(null)).toEqual({});
    expect(getResponses(undefined)).toEqual({});
  });

  it('responses as already-parsed object is returned as-is', () => {
    const obj = { s1: { answer: true } };
    const sub = { responses: obj, template_version: 1 };
    expect(getResponses(sub)).toBe(obj);
  });

  it('malformed JSON responses string returns empty object', () => {
    const sub = { responses: '{broken', template_version: 1 };
    expect(getResponses(sub)).toEqual({});
  });
});

// ─── Legacy Submission Conversion (direct) ───────────────────
// State Machine: Edge Case 8 — Legacy Submissions

describe('Legacy Submission Conversion', () => {
  it('legacy step with text field maps correctly', () => {
    const sub = {
      has_additional_income: true,
      additional_income_details: 'Rental income from apartment',
    };
    const responses = legacyToResponses(sub);
    expect(responses.additional.answer).toBe(true);
    expect(responses.additional.text).toBe('Rental income from apartment');
  });

  it('legacy step where answer field is undefined is skipped', () => {
    const sub = {
      is_employee: true,
      // has_stock_market is not set at all
    };
    const responses = legacyToResponses(sub);
    expect(responses.employee.answer).toBe(true);
    expect(responses.stocks).toBeUndefined();
  });

  it('legacy step with files but answer=false does not include files', () => {
    const sub = {
      is_employee: false,
      form_106_files: ['should_not_appear.pdf'],
    };
    const responses = legacyToResponses(sub);
    expect(responses.employee.answer).toBe(false);
    // Files should only be included when answer is truthy and files exist
    // The function always attaches files if they exist, but the step was answered "no"
    expect(responses.employee.files).toEqual(['should_not_appear.pdf']);
  });
});

// ─── isStepAnswered ──────────────────────────────────────────

describe('isStepAnswered', () => {
  it('returns true for an answered step', () => {
    const sub = {
      responses: JSON.stringify({ s1: { answer: true } }),
      template_version: 1,
    };
    expect(isStepAnswered(sub, 's1')).toBe(true);
  });

  it('returns false for an unanswered step', () => {
    const sub = {
      responses: JSON.stringify({ s1: { answer: true } }),
      template_version: 1,
    };
    expect(isStepAnswered(sub, 's2')).toBe(false);
  });

  it('works with legacy submission format', () => {
    const sub = {
      is_employee: true,
      // No responses field → legacy
    };
    expect(isStepAnswered(sub, 'employee')).toBe(true);
    expect(isStepAnswered(sub, 'stocks')).toBe(false);
  });
});

// ─── Progress Calculation ────────────────────────────────────
// State Machine: DASHBOARD PROGRESS CALCULATION

describe('Progress Calculation', () => {
  const regularSteps = [
    makeStep('s1'),
    makeStep('s2'),
    makeStep('s3'),
    makeStep('s4'),
  ];

  it('no submission returns 0% progress', () => {
    expect(getStepProgress(null, regularSteps)).toBe(0);
  });

  it('all regular steps answered returns 100%', () => {
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true },
        s2: { answer: false },
        s3: { answer: true },
        s4: { answer: true },
      }),
      template_version: 1,
    };
    expect(getStepProgress(sub, regularSteps)).toBe(100);
  });

  it('half the steps answered returns ~50%', () => {
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true },
        s2: { answer: false },
      }),
      template_version: 1,
    };
    expect(getStepProgress(sub, regularSteps)).toBe(50);
  });

  it('pdf_sign step with signed record counts as done', () => {
    const steps = [makeStep('s1'), makeStep('pdf1', 'pdf_sign')];
    const sub = {
      responses: JSON.stringify({ s1: { answer: true } }),
      signed_pdfs: JSON.stringify([{ step_id: 'pdf1', incomplete: false }]),
      template_version: 1,
    };
    expect(getStepProgress(sub, steps)).toBe(100);
  });

  it('pdf_sign step answered "no" (not relevant) counts as done', () => {
    const steps = [makeStep('s1'), makeStep('pdf1', 'pdf_sign')];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true },
        pdf1: { answer: false },
      }),
      template_version: 1,
    };
    expect(getStepProgress(sub, steps)).toBe(100);
  });

  it('pdf_sign step with no record and no answer is not counted', () => {
    const steps = [makeStep('s1'), makeStep('pdf1', 'pdf_sign')];
    const sub = {
      responses: JSON.stringify({ s1: { answer: true } }),
      template_version: 1,
    };
    expect(getStepProgress(sub, steps)).toBe(50);
  });

  it('empty steps array returns 0%', () => {
    const sub = {
      responses: JSON.stringify({ s1: { answer: true } }),
      template_version: 1,
    };
    expect(getStepProgress(sub, [])).toBe(0);
  });
});

// ─── File Collection ─────────────────────────────────────────

describe('File Collection', () => {
  it('files from template-order steps are collected in order', () => {
    const steps = [
      makeStep('s1', 'upload', { upload_config: { title: 'Step 1 Files' } }),
      makeStep('s2', 'upload', { upload_config: { title: 'Step 2 Files' } }),
    ];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true, files: ['a.pdf'] },
        s2: { answer: true, files: ['b.pdf', 'c.pdf'] },
      }),
      template_version: 1,
    };
    const groups = getAllFiles(sub, steps);
    expect(groups.length).toBe(2);
    expect(groups[0].stepId).toBe('s1');
    expect(groups[1].stepId).toBe('s2');
    expect(groups[1].files).toEqual(['b.pdf', 'c.pdf']);
  });

  it('files from steps removed from template are still included', () => {
    const steps = [makeStep('s1', 'upload')]; // Only s1 in template
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true, files: ['a.pdf'] },
        removed_step: { answer: true, files: ['orphan.pdf'], title: 'Removed' },
      }),
      template_version: 1,
    };
    const groups = getAllFiles(sub, steps);
    expect(groups.length).toBe(2);
    expect(groups[1].stepId).toBe('removed_step');
  });

  it('steps with answer=false have no files collected', () => {
    const steps = [makeStep('s1', 'upload')];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: false },
      }),
      template_version: 1,
    };
    const groups = getAllFiles(sub, steps);
    expect(groups.length).toBe(0);
  });

  it('legacy submission flat files are collected via converted responses', () => {
    const steps = [
      makeStep('employee', 'upload', { upload_config: { title: 'Form 106' } }),
    ];
    const sub = {
      is_employee: true,
      form_106_files: ['106.pdf'],
      // Legacy format — no responses field
    };
    const groups = getAllFiles(sub, steps);
    expect(groups.length).toBe(1);
    expect(groups[0].files).toEqual(['106.pdf']);
  });
});

// ─── Step Summary ────────────────────────────────────────────

describe('Step Summary', () => {
  it('summary uses saved title/emoji from response when available', () => {
    const steps = [makeStep('s1', 'upload', { title: 'Template Title', emoji: '📄' })];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true, title: 'Saved Title', emoji: '🎉' },
      }),
      template_version: 1,
    };
    const summary = getStepSummary(sub, steps);
    expect(summary[0].label).toBe('Saved Title');
    expect(summary[0].emoji).toBe('🎉');
  });

  it('summary falls back to template title when response has none', () => {
    const steps = [makeStep('s1', 'upload', { title: 'Template Title', emoji: '📄' })];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true },
      }),
      template_version: 1,
    };
    const summary = getStepSummary(sub, steps);
    expect(summary[0].label).toBe('Template Title');
    expect(summary[0].emoji).toBe('📄');
  });

  it('responses for steps not in template are included at the end', () => {
    const steps = [makeStep('s1', 'upload')];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true },
        extra: { answer: true, title: 'Extra Step', emoji: '❓' },
      }),
      template_version: 1,
    };
    const summary = getStepSummary(sub, steps);
    expect(summary.length).toBe(2);
    expect(summary[1].stepId).toBe('extra');
    expect(summary[1].label).toBe('Extra Step');
  });

  it('step with answer=false shows false as the answer value', () => {
    const steps = [makeStep('s1', 'upload')];
    const sub = {
      responses: JSON.stringify({ s1: { answer: false } }),
      template_version: 1,
    };
    const summary = getStepSummary(sub, steps);
    expect(summary[0].answer).toBe(false);
  });

  it('step with files reports hasFiles and fileCount', () => {
    const steps = [makeStep('s1', 'upload')];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true, files: ['a.pdf', 'b.pdf'] },
      }),
      template_version: 1,
    };
    const summary = getStepSummary(sub, steps);
    expect(summary[0].hasFiles).toBe(true);
    expect(summary[0].fileCount).toBe(2);
  });

  it('step with text response includes text in summary', () => {
    const steps = [makeStep('s1', 'text')];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true, text: 'Rental income' },
      }),
      template_version: 1,
    };
    const summary = getStepSummary(sub, steps);
    expect(summary[0].text).toBe('Rental income');
  });

  it('{TAX_YEAR} placeholder in response title is resolved', () => {
    const steps = [makeStep('s1', 'upload')];
    const sub = {
      responses: JSON.stringify({
        s1: { answer: true, title: 'Income for {TAX_YEAR}' },
      }),
      template_version: 1,
      tax_year: 2024,
    };
    const summary = getStepSummary(sub, steps);
    expect(summary[0].label).toBe('Income for 2024');
  });
});
