import { describe, it, expect } from 'vitest';
import {
  filterStepsByClientConditions,
  getActiveSteps,
  resolveYearPlaceholders,
  parseTemplateSteps,
  DEFAULT_STEPS,
} from '../questionnaire-template';

// ─── Helpers ─────────────────────────────────────────────────

function makeStep(id, opts = {}) {
  return {
    id,
    title: opts.title || id,
    emoji: opts.emoji || '📝',
    question: opts.question || `Question for ${id}`,
    response_type: opts.response_type || 'upload',
    enabled: opts.enabled !== undefined ? opts.enabled : true,
    order: opts.order ?? 0,
    condition: opts.condition || null,
    upload_config: opts.upload_config || null,
    text_config: opts.text_config || null,
    select_config: null,
    pdf_sign_config: null,
    ...opts,
  };
}

// ─── Client Condition Filtering ──────────────────────────────
// State Machine: osek_type Filtering

describe('Client Condition Filtering', () => {
  const pensionStep = makeStep('pension', {
    condition: { type: 'osek_type', field: 'osek_type', values: ['עוסק מורשה'] },
  });
  const unconditionalStep = makeStep('stocks');
  const allSteps = [unconditionalStep, pensionStep];

  it('pension step is excluded for osek patur clients', () => {
    const client = { osek_type: 'עוסק פטור' };
    const result = filterStepsByClientConditions(allSteps, client);
    expect(result.map(s => s.id)).not.toContain('pension');
    expect(result.map(s => s.id)).toContain('stocks');
  });

  it('pension step is included for osek murshe clients', () => {
    const client = { osek_type: 'עוסק מורשה' };
    const result = filterStepsByClientConditions(allSteps, client);
    expect(result.map(s => s.id)).toContain('pension');
  });

  it('steps without conditions are always included', () => {
    const client = { osek_type: 'עוסק פטור' };
    const result = filterStepsByClientConditions(allSteps, client);
    expect(result.map(s => s.id)).toContain('stocks');
  });

  it('conditional steps are excluded when client has no osek_type set', () => {
    const client = {}; // No osek_type
    const result = filterStepsByClientConditions(allSteps, client);
    // values.includes(undefined) → false, so conditional step is excluded
    expect(result.map(s => s.id)).not.toContain('pension');
    expect(result.map(s => s.id)).toContain('stocks');
  });

  it('unknown condition types default to showing the step', () => {
    const weirdStep = makeStep('weird', {
      condition: { type: 'unknown_type', field: 'foo', values: ['bar'] },
    });
    const result = filterStepsByClientConditions([weirdStep], { foo: 'baz' });
    expect(result.map(s => s.id)).toContain('weird');
  });

  it('all steps are returned when client is null', () => {
    const result = filterStepsByClientConditions(allSteps, null);
    expect(result.length).toBe(allSteps.length);
  });

  it('step with multiple values in condition matches any of them', () => {
    const bothTypesStep = makeStep('general', {
      condition: { type: 'osek_type', field: 'osek_type', values: ['עוסק מורשה', 'עוסק פטור'] },
    });
    const murshe = filterStepsByClientConditions([bothTypesStep], { osek_type: 'עוסק מורשה' });
    const patur = filterStepsByClientConditions([bothTypesStep], { osek_type: 'עוסק פטור' });
    expect(murshe.map(s => s.id)).toContain('general');
    expect(patur.map(s => s.id)).toContain('general');
  });
});

// ─── Active Step Resolution ──────────────────────────────────

describe('Active Step Resolution', () => {
  it('disabled steps are excluded', () => {
    const steps = [
      makeStep('a', { enabled: true, order: 0 }),
      makeStep('b', { enabled: false, order: 1 }),
      makeStep('c', { enabled: true, order: 2 }),
    ];
    const result = getActiveSteps(steps);
    expect(result.map(s => s.id)).toEqual(['a', 'c']);
  });

  it('steps are sorted by order field', () => {
    const steps = [
      makeStep('c', { order: 3 }),
      makeStep('a', { order: 1 }),
      makeStep('b', { order: 2 }),
    ];
    const result = getActiveSteps(steps);
    expect(result.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('all enabled steps are included regardless of type', () => {
    const steps = [
      makeStep('u', { response_type: 'upload', order: 0 }),
      makeStep('t', { response_type: 'text', order: 1 }),
      makeStep('p', { response_type: 'pdf_sign', order: 2 }),
      makeStep('s', { response_type: 'single_select', order: 3 }),
    ];
    const result = getActiveSteps(steps);
    expect(result.length).toBe(4);
  });
});

// ─── Year Placeholder Resolution ─────────────────────────────

describe('Year Placeholder Resolution', () => {
  it('year placeholders in title and question are replaced', () => {
    const steps = [makeStep('s1', { title: 'Income {year}', question: 'Did you work in {year}?' })];
    const result = resolveYearPlaceholders(steps, 2024);
    expect(result[0].title).toBe('Income 2024');
    expect(result[0].question).toBe('Did you work in 2024?');
  });

  it('year placeholders in upload_config fields are replaced', () => {
    const steps = [makeStep('s1', {
      upload_config: {
        title: 'Form 106 for {year}',
        description: 'Upload {year} docs',
        upload_label: 'Upload {year}',
      },
    })];
    const result = resolveYearPlaceholders(steps, 2024);
    expect(result[0].upload_config.title).toBe('Form 106 for 2024');
    expect(result[0].upload_config.description).toBe('Upload 2024 docs');
    expect(result[0].upload_config.upload_label).toBe('Upload 2024');
  });

  it('year placeholders in text_config fields are replaced', () => {
    const steps = [makeStep('s1', {
      text_config: {
        title: 'Details for {year}',
        description: 'Describe {year} income',
      },
    })];
    const result = resolveYearPlaceholders(steps, 2024);
    expect(result[0].text_config.title).toBe('Details for 2024');
    expect(result[0].text_config.description).toBe('Describe 2024 income');
  });

  it('steps without text fields are handled gracefully', () => {
    const steps = [makeStep('s1', { upload_config: null, text_config: null })];
    const result = resolveYearPlaceholders(steps, 2024);
    expect(result[0].upload_config).toBeNull();
    expect(result[0].text_config).toBeNull();
  });

  it('select_config is passed through untouched', () => {
    const selectConfig = {
      title: 'Choose for {year}',
      description: 'Options for {year}',
      options: ['A', 'B', 'C'],
    };
    const steps = [makeStep('s1', { select_config: selectConfig })];
    const result = resolveYearPlaceholders(steps, 2024);
    // resolveYearPlaceholders does NOT process select_config — it should pass through as-is
    expect(result[0].select_config.title).toBe('Choose for {year}');
    expect(result[0].select_config.options).toEqual(['A', 'B', 'C']);
  });
});

// ─── Template Parsing ────────────────────────────────────────

describe('Template Parsing', () => {
  it('valid JSON steps array is parsed correctly', () => {
    const input = JSON.stringify([{ id: 'a' }, { id: 'b' }]);
    const result = parseTemplateSteps(input);
    expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('invalid JSON falls back to DEFAULT_STEPS', () => {
    const result = parseTemplateSteps('broken json');
    expect(result).toBe(DEFAULT_STEPS);
  });

  it('non-array parsed value falls back to DEFAULT_STEPS', () => {
    const result = parseTemplateSteps('{"not": "array"}');
    expect(result).toBe(DEFAULT_STEPS);
  });
});
