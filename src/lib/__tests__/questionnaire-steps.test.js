import { describe, it, expect } from 'vitest';
import { buildSteps, parseSignedPdfs, getResumeStepIndex, deriveStepStatuses } from '../questionnaire-steps';

// ─── Helpers ─────────────────────────────────────────────────

/** Create a minimal step config for testing. */
function makeStep(id, responseType = 'upload', opts = {}) {
  return {
    id,
    response_type: responseType,
    title: opts.title || id,
    emoji: opts.emoji || '📝',
    enabled: true,
    order: opts.order ?? 0,
    pdf_sign_config: opts.pdf_sign_config || null,
    skip_question: opts.skip_question || false,
    ...opts,
  };
}

// ─── Resume & Navigation ────────────────────────────────────
// State Machine: RESUME LOGIC

describe('Resume & Navigation', () => {
  const steps = [
    makeStep('s1'),
    makeStep('s2'),
    makeStep('s3'),
    makeStep('s4'),
  ];
  const totalSteps = steps.length + 2; // welcome + steps + done

  it('client with no responses starts at the first content step', () => {
    const responses = {};
    const signedPdfs = {};
    const idx = getResumeStepIndex(steps, responses, signedPdfs, totalSteps, 0);
    // Should point to the first content step (index 1 in STEPS = first unanswered)
    expect(idx).toBe(1);
  });

  it('client resumes at the first unanswered step', () => {
    const responses = {
      s1: { answer: true },
      s2: { answer: false },
      // s3 and s4 unanswered
    };
    const idx = getResumeStepIndex(steps, responses, {}, totalSteps, 0);
    expect(idx).toBe(3); // 1-indexed: step s3 is at content index 2, +1 for welcome = 3
  });

  it('client with all steps answered goes to done screen', () => {
    const responses = {
      s1: { answer: true },
      s2: { answer: false },
      s3: { answer: true },
      s4: { answer: true },
    };
    const idx = getResumeStepIndex(steps, responses, {}, totalSteps, 0);
    // All answered → should go to last valid step (done index = totalSteps - 1)
    expect(idx).toBe(totalSteps - 1);
  });

  it('race condition: server step_completed ahead of local — trusts server', () => {
    const responses = {
      s1: { answer: true },
      s2: { answer: true },
      // s3 unanswered (firstUnanswered = 3)
    };
    const stepCompleted = 5; // Server is ahead
    const idx = getResumeStepIndex(steps, responses, {}, totalSteps, stepCompleted);
    // Should trust step_completed since it's >= firstUnanswered
    expect(idx).toBeGreaterThanOrEqual(3);
    expect(idx).toBeLessThan(totalSteps);
  });

  it('race condition: step_completed behind first unanswered — uses first unanswered', () => {
    const responses = {
      s1: { answer: true },
      s2: { answer: true },
      // s3 unanswered → firstUnanswered = 3
    };
    const stepCompleted = 2; // Behind
    const idx = getResumeStepIndex(steps, responses, {}, totalSteps, stepCompleted);
    expect(idx).toBe(3); // Uses firstUnanswered
  });

  it('pdf_sign step with signed record is counted as answered for resume', () => {
    const pdfStep = makeStep('pdf1', 'pdf_sign');
    const allSteps = [makeStep('s1'), pdfStep, makeStep('s3')];
    const total = allSteps.length + 2;
    const responses = { s1: { answer: true } };
    const signedPdfs = { pdf1: { step_id: 'pdf1', incomplete: false } };
    const idx = getResumeStepIndex(allSteps, responses, signedPdfs, total, 0);
    // s1 answered, pdf1 signed → first unanswered is s3 at index 3
    expect(idx).toBe(3);
  });

  it('pdf_sign step answered "no" is counted as answered for resume', () => {
    const pdfStep = makeStep('pdf1', 'pdf_sign');
    const allSteps = [makeStep('s1'), pdfStep, makeStep('s3')];
    const total = allSteps.length + 2;
    const responses = {
      s1: { answer: true },
      pdf1: { answer: false }, // "not relevant"
    };
    const idx = getResumeStepIndex(allSteps, responses, {}, total, 0);
    // s1 answered, pdf1 answered no → first unanswered is s3 at index 3
    expect(idx).toBe(3);
  });
});

// ─── Step Building ──────────────────────────────────────────
// State Machine: STEP ANSWERING LOOP

describe('Step Building', () => {
  it('steps array includes welcome and done bookends', () => {
    const steps = buildSteps([makeStep('a'), makeStep('b'), makeStep('c')]);
    expect(steps[0]).toEqual({ id: 'welcome', type: 'welcome' });
    expect(steps[steps.length - 1]).toEqual({ id: 'done', type: 'done' });
    expect(steps.length).toBe(5);
  });

  it('pdf_sign step with skip_question goes directly to sign type', () => {
    const step = makeStep('pdf1', 'pdf_sign', {
      skip_question: true,
      pdf_sign_config: { pdf_template_id: 'tmpl1' },
    });
    const built = buildSteps([step]);
    const pdfStep = built.find(s => s.id === 'pdf1');
    expect(pdfStep.type).toBe('pdf_sign');
  });

  it('pdf_sign step without skip_question renders as question type', () => {
    const step = makeStep('pdf1', 'pdf_sign', {
      skip_question: false,
      pdf_sign_config: { pdf_template_id: 'tmpl1' },
    });
    const built = buildSteps([step]);
    const pdfStep = built.find(s => s.id === 'pdf1');
    expect(pdfStep.type).toBe('question');
  });

  it('regular step types are preserved as question type', () => {
    const built = buildSteps([makeStep('u', 'upload'), makeStep('t', 'text')]);
    expect(built[1].type).toBe('question');
    expect(built[2].type).toBe('question');
  });
});

// ─── Signed PDF Parsing ─────────────────────────────────────

describe('Signed PDF Parsing', () => {
  it('valid signed_pdfs JSON is parsed into a map by step_id', () => {
    const json = JSON.stringify([
      { step_id: 'a', pdf_file_url: 'url1', incomplete: false },
      { step_id: 'b', pdf_file_url: 'url2', incomplete: true },
    ]);
    const map = parseSignedPdfs(json);
    expect(Object.keys(map)).toEqual(['a', 'b']);
    expect(map.a.pdf_file_url).toBe('url1');
    expect(map.b.incomplete).toBe(true);
  });

  it('empty or null signed_pdfs returns empty map', () => {
    expect(parseSignedPdfs(null)).toEqual({});
    expect(parseSignedPdfs(undefined)).toEqual({});
    expect(parseSignedPdfs('')).toEqual({});
  });

  it('malformed JSON returns empty map gracefully', () => {
    expect(parseSignedPdfs('not json')).toEqual({});
    expect(parseSignedPdfs('{broken')).toEqual({});
  });
});

// ─── Step Status Derivation ─────────────────────────────────
// State Machine: DASHBOARD

describe('Step Status Derivation', () => {
  it('completed regular step is marked as completed', () => {
    const steps = [makeStep('s1', 'upload')];
    const responses = { s1: { answer: true } };
    const { completedStepIds, incompleteStepIds } = deriveStepStatuses(steps, responses, {});
    expect(completedStepIds).toContain('s1');
    expect(incompleteStepIds).not.toContain('s1');
  });

  it('unanswered step is not in completed or incomplete lists', () => {
    const steps = [makeStep('s1', 'upload')];
    const { completedStepIds, incompleteStepIds } = deriveStepStatuses(steps, {}, {});
    expect(completedStepIds).not.toContain('s1');
    expect(incompleteStepIds).not.toContain('s1');
  });

  it('signed PDF (complete) is marked as completed', () => {
    const steps = [makeStep('pdf1', 'pdf_sign')];
    const signedPdfs = { pdf1: { step_id: 'pdf1', incomplete: false } };
    const { completedStepIds } = deriveStepStatuses(steps, {}, signedPdfs);
    expect(completedStepIds).toContain('pdf1');
  });

  it('signed PDF (incomplete) is marked as incomplete', () => {
    const steps = [makeStep('pdf1', 'pdf_sign')];
    const signedPdfs = { pdf1: { step_id: 'pdf1', incomplete: true } };
    const { incompleteStepIds } = deriveStepStatuses(steps, {}, signedPdfs);
    expect(incompleteStepIds).toContain('pdf1');
  });

  it('pdf_sign step answered "no" is marked as completed', () => {
    const steps = [makeStep('pdf1', 'pdf_sign')];
    const responses = { pdf1: { answer: false } };
    const { completedStepIds } = deriveStepStatuses(steps, responses, {});
    expect(completedStepIds).toContain('pdf1');
  });

  it('mixed submission with regular and pdf_sign steps derives correctly', () => {
    const steps = [
      makeStep('s1', 'upload'),
      makeStep('s2', 'text'),
      makeStep('pdf1', 'pdf_sign'),
      makeStep('pdf2', 'pdf_sign'),
      makeStep('s3', 'upload'),
    ];
    const responses = {
      s1: { answer: true },
      s2: { answer: false },
      pdf2: { answer: false }, // "not relevant"
      // s3 unanswered
    };
    const signedPdfs = {
      pdf1: { step_id: 'pdf1', incomplete: true }, // incomplete sign
    };
    const { completedStepIds, incompleteStepIds } = deriveStepStatuses(steps, responses, signedPdfs);

    expect(completedStepIds).toContain('s1');
    expect(completedStepIds).toContain('s2');
    expect(completedStepIds).toContain('pdf2');
    expect(incompleteStepIds).toContain('pdf1');
    expect(completedStepIds).not.toContain('s3');
    expect(incompleteStepIds).not.toContain('s3');
  });
});
