import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../../js/agents/shared/index.js');
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import {
  STRUCTURED_PLAN_SCHEMA_VERSION,
  createRequirementsAnalysis,
  createRequirement,
  createArchitecturalDecision,
  createPlanStep,
  createRisk,
  createCriticalFile,
} from '../../../../../js/agents/plugins/plan/structured-plan.js';

import { isPlainObject, toNonEmptyString } from '../../../../../js/agents/shared/index.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('STRUCTURED_PLAN_SCHEMA_VERSION', () => {
  it('exports the current schema version', () => {
    expect(STRUCTURED_PLAN_SCHEMA_VERSION).toBe('1.0');
  });
});

describe('createRequirementsAnalysis', () => {
  it('returns empty arrays with expected keys', () => {
    const result = createRequirementsAnalysis();
    expect(result).toEqual({
      functional: [],
      nonFunctional: [],
      assumptions: [],
      clarifications: [],
      outOfScope: [],
    });
  });

  it('creates independent objects across simultaneous calls', async () => {
    const [first, second] = await Promise.all([
      Promise.resolve(createRequirementsAnalysis()),
      Promise.resolve(createRequirementsAnalysis()),
    ]);

    expect(first).not.toBe(second);
    expect(first.functional).not.toBe(second.functional);
    first.functional.push({ id: 'req_1' });
    expect(second.functional).toHaveLength(0);
  });
});

describe('createRequirement', () => {
  it('uses defaults for invalid input and empty values', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const result = createRequirement(null);

    expect(result.id).toBe('req_123456');
    expect(result.type).toBe('functional');
    expect(result.priority).toBe('should_have');
    expect(result.description).toBe('');
    expect(result.acceptanceCriteria).toEqual([]);
  });

  it('accepts valid fields and filters acceptanceCriteria strings only', () => {
    const result = createRequirement({
      id: 'req_custom',
      type: 'constraint',
      description: 'desc',
      priority: 'must_have',
      acceptanceCriteria: ['one', 2, null, 'two', {}, '   ', []],
    });

    expect(result).toEqual({
      id: 'req_custom',
      type: 'constraint',
      description: 'desc',
      priority: 'must_have',
      acceptanceCriteria: ['one', 'two', '   '],
    });
  });

  it('handles boundary values, long strings, and non-array criteria', () => {
    const longText = 'a'.repeat(10000);
    const result = createRequirement({
      id: 0,
      description: -1,
      priority: 'nice_to_have',
      type: 'non_functional',
      acceptanceCriteria: {},
    });

    expect(result.id).toBe('0');
    expect(result.description).toBe('-1');
    expect(result.priority).toBe('nice_to_have');
    expect(result.type).toBe('non_functional');
    expect(result.acceptanceCriteria).toEqual([]);

    const longResult = createRequirement({ description: longText, acceptanceCriteria: [] });
    expect(longResult.description.length).toBe(longText.length);

    const maxResult = createRequirement({ description: Number.MAX_SAFE_INTEGER });
    expect(maxResult.description).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('falls back on empty strings and preserves empty criteria entries', () => {
    vi.spyOn(Date, 'now').mockReturnValue(7);
    const result = createRequirement({
      id: '   ',
      description: '   ',
      acceptanceCriteria: [''],
    });

    expect(result.id).toBe('req_7');
    expect(result.description).toBe('');
    expect(result.acceptanceCriteria).toEqual(['']);
  });

  it('uses isPlainObject and toNonEmptyString for inputs', () => {
    const mockedIsPlainObject = vi.mocked(isPlainObject);
    const mockedToNonEmptyString = vi.mocked(toNonEmptyString);
    mockedIsPlainObject.mockReturnValueOnce(false);
    mockedToNonEmptyString.mockReturnValueOnce(undefined);

    const result = createRequirement({ id: 'req_ignore' });
    expect(result.id.startsWith('req_')).toBe(true);
  });
});

describe('createArchitecturalDecision', () => {
  it('uses defaults for non-plain input and empty values', () => {
    vi.spyOn(Date, 'now').mockReturnValue(500);
    const result = createArchitecturalDecision(undefined);

    expect(result).toEqual({
      id: 'adr_500',
      title: '',
      context: '',
      decision: '',
      rationale: '',
      alternatives: [],
      tradeoffs: [],
      consequences: [],
    });
  });

  it('accepts valid fields and filters list values', () => {
    const result = createArchitecturalDecision({
      id: 'adr_custom',
      title: 'Title',
      context: 'Context',
      decision: 'Decision',
      rationale: 'Rationale',
      alternatives: ['a', 1, null, 'b'],
      tradeoffs: ['t1', {}, 't2'],
      consequences: ['c1', false, 'c2'],
    });

    expect(result).toEqual({
      id: 'adr_custom',
      title: 'Title',
      context: 'Context',
      decision: 'Decision',
      rationale: 'Rationale',
      alternatives: ['a', 'b'],
      tradeoffs: ['t1', 't2'],
      consequences: ['c1', 'c2'],
    });
  });

  it('handles rapid consecutive calls with changing timestamps', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValue(3);

    const first = createArchitecturalDecision();
    const second = createArchitecturalDecision();
    const third = createArchitecturalDecision();

    expect(first.id).toBe('adr_1');
    expect(second.id).toBe('adr_2');
    expect(third.id).toBe('adr_3');
  });

  it('creates independent objects when called simultaneously', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(99);
    const [first, second] = await Promise.all([
      Promise.resolve(createArchitecturalDecision()),
      Promise.resolve(createArchitecturalDecision()),
    ]);

    expect(first).not.toBe(second);
    expect(first.alternatives).not.toBe(second.alternatives);
  });
});

describe('createPlanStep', () => {
  it('uses fallback stepId and defaults for invalid status or complexity', () => {
    const result = createPlanStep(
      { stepId: '   ', status: 'done', complexity: 'super' },
      { fallbackIndex: 0 }
    );

    expect(result.stepId).toBe('step_1');
    expect(result.status).toBe('pending');
    expect(result.complexity).toBe('medium');
  });

  it('builds stepId from boundary fallbackIndex values', () => {
    const resultZero = createPlanStep({ stepId: '' }, { fallbackIndex: 0 });
    const resultNegative = createPlanStep({ stepId: '' }, { fallbackIndex: -1 });
    const resultMax = createPlanStep(
      { stepId: '' },
      { fallbackIndex: Number.MAX_SAFE_INTEGER }
    );
    const resultString = createPlanStep({ stepId: '' }, { fallbackIndex: '0' });

    expect(resultZero.stepId).toBe('step_1');
    expect(resultNegative.stepId).toBe('step_0');
    expect(resultMax.stepId).toBe(`step_${Number.MAX_SAFE_INTEGER + 1}`);
    expect(resultString.stepId).toBe('step_01');
  });

  it('accepts valid input and filters array fields', () => {
    const result = createPlanStep({
      stepId: 'step_custom',
      title: 'Title',
      description: 'Desc',
      status: 'completed',
      dependencies: ['a', 2, null, 'b'],
      complexity: 'high',
      files: ['file.js', 0, 'file2.js'],
      tools: ['tool', {}, 'tool2'],
      outputs: ['out', false, 'out2'],
    });

    expect(result).toEqual({
      stepId: 'step_custom',
      title: 'Title',
      description: 'Desc',
      status: 'completed',
      dependencies: ['a', 'b'],
      complexity: 'high',
      files: ['file.js', 'file2.js'],
      tools: ['tool', 'tool2'],
      outputs: ['out', 'out2'],
    });
  });

  it('handles long strings and nested values without crashing', () => {
    const longText = 'x'.repeat(20000);
    const nested = { a: { b: { c: 'd' } } };
    const result = createPlanStep({
      title: longText,
      description: longText,
      dependencies: ['dep', nested, ['nested'], 'dep2'],
      files: [longText, { not: 'file' }],
      tools: { not: 'array' },
      outputs: [],
    });

    expect(result.title.length).toBe(longText.length);
    expect(result.description.length).toBe(longText.length);
    expect(result.dependencies).toEqual(['dep', 'dep2']);
    expect(result.files).toEqual([longText]);
    expect(result.tools).toEqual([]);
    expect(result.outputs).toEqual([]);
  });

  it('creates independent arrays across simultaneous calls', async () => {
    const [first, second] = await Promise.all([
      Promise.resolve(createPlanStep()),
      Promise.resolve(createPlanStep()),
    ]);

    expect(first).not.toBe(second);
    expect(first.dependencies).not.toBe(second.dependencies);
    first.dependencies.push('step_1');
    expect(second.dependencies).toHaveLength(0);
  });
});

describe('createRisk', () => {
  it('uses defaults for invalid input and omits contingency', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10);
    const result = createRisk(null);

    expect(result).toEqual({
      id: 'risk_10',
      category: 'technical',
      description: '',
      severity: 'medium',
      likelihood: 'medium',
      mitigation: '',
    });
    expect(Object.prototype.hasOwnProperty.call(result, 'contingency')).toBe(false);
  });

  it('accepts valid input and trims contingency', () => {
    const result = createRisk({
      id: 'risk_custom',
      category: 'schedule',
      description: 'desc',
      severity: 'critical',
      likelihood: 'high',
      mitigation: 'mit',
      contingency: '  plan  ',
    });

    expect(result).toEqual({
      id: 'risk_custom',
      category: 'schedule',
      description: 'desc',
      severity: 'critical',
      likelihood: 'high',
      mitigation: 'mit',
      contingency: 'plan',
    });
  });

  it('handles boundary numeric values and invalid enums', () => {
    const result = createRisk({
      category: 'unknown',
      severity: 'extreme',
      likelihood: 'maybe',
      description: 0,
      mitigation: Number.MAX_SAFE_INTEGER,
      contingency: '',
    });

    expect(result.category).toBe('technical');
    expect(result.severity).toBe('medium');
    expect(result.likelihood).toBe('medium');
    expect(result.description).toBe('0');
    expect(result.mitigation).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(Object.prototype.hasOwnProperty.call(result, 'contingency')).toBe(false);
  });
});

describe('createCriticalFile', () => {
  it('uses defaults for invalid input and omits changes when not array', () => {
    const result = createCriticalFile(undefined);

    expect(result).toEqual({
      path: '',
      action: 'modify',
      reason: '',
    });
    expect(Object.prototype.hasOwnProperty.call(result, 'changes')).toBe(false);
  });

  it('accepts valid input and filters changes', () => {
    const hugePath = '/tmp/' + 'a'.repeat(5000);
    const result = createCriticalFile({
      path: hugePath,
      action: 'delete',
      reason: 'cleanup',
      changes: ['one', 2, null, 'two'],
    });

    expect(result).toEqual({
      path: hugePath,
      action: 'delete',
      reason: 'cleanup',
      changes: ['one', 'two'],
    });
  });

  it('falls back for invalid action and stringifies boundary values', () => {
    const result = createCriticalFile({
      path: '   ',
      action: 'unknown',
      reason: -1,
      changes: { deep: { nest: true } },
    });

    expect(result.path).toBe('');
    expect(result.action).toBe('modify');
    expect(result.reason).toBe('-1');
    expect(Object.prototype.hasOwnProperty.call(result, 'changes')).toBe(false);
  });
});
