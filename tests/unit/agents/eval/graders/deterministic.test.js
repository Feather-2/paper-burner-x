import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  regexGrader,
  stateCheckGrader,
  toolCallsGrader,
  transcriptGrader,
} from '../../../../../js/agents/eval/graders/deterministic.js';

vi.mock('node:os', () => ({
  cpus: vi.fn(() => Array.from({ length: 4 }, () => ({ model: 'mock' }))),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('regexGrader', () => {
  it('fails when patterns are missing or invalid', () => {
    const empty = regexGrader.grade('text', { options: { patterns: [] } });
    expect(empty.passed).toBe(false);
    expect(empty.issues[0].type).toBe('missing_pattern');

    const invalid = regexGrader.grade('text', { options: { patterns: {} } });
    expect(invalid.passed).toBe(false);
    expect(invalid.reason).toBe('No regex pattern provided');
  });

  it('normalizes empty-like outputs', () => {
    const nullResult = regexGrader.grade(null, { options: { pattern: '^$' } });
    expect(nullResult.passed).toBe(true);

    const undefinedResult = regexGrader.grade(undefined, { options: { pattern: '^$' } });
    expect(undefinedResult.passed).toBe(true);

    const emptyStringResult = regexGrader.grade('', { options: { pattern: '^$' } });
    expect(emptyStringResult.passed).toBe(true);

    const whitespaceResult = regexGrader.grade('   ', { options: { pattern: '\\s+' } });
    expect(whitespaceResult.passed).toBe(true);
  });

  it('stringifies numeric outputs', () => {
    const zero = regexGrader.grade(0, { options: { pattern: '^0$' } });
    expect(zero.passed).toBe(true);

    const negative = regexGrader.grade(-1, { options: { pattern: '-1' } });
    expect(negative.passed).toBe(true);

    const maxSafe = regexGrader.grade(Number.MAX_SAFE_INTEGER, {
      options: { pattern: String(Number.MAX_SAFE_INTEGER) },
    });
    expect(maxSafe.passed).toBe(true);
  });

  it('respects caseInsensitive and explicit flags', () => {
    const caseInsensitive = regexGrader.grade('FOO', {
      options: { pattern: 'foo', caseInsensitive: true },
    });
    expect(caseInsensitive.passed).toBe(true);

    const overrideFlags = regexGrader.grade('FOO', {
      options: { pattern: /foo/i, flags: 'g' },
    });
    expect(overrideFlags.passed).toBe(false);
    expect(overrideFlags.issues[0].type).toBe('regex_mismatch');
  });

  it('supports any-match mode and invert', () => {
    const anyMatch = regexGrader.grade('alpha beta', {
      options: { patterns: ['gamma', 'beta'], match: 'any' },
    });
    expect(anyMatch.passed).toBe(true);

    const inverted = regexGrader.grade('alpha beta', {
      options: { patterns: ['beta'], match: 'any', invert: true },
    });
    expect(inverted.passed).toBe(false);
    expect(inverted.reason).toContain('Forbidden pattern matched');
  });

  it('counts matches across patterns on large text and supports invert', () => {
    const largeText = 'token '.repeat(200000);
    const passResult = regexGrader.grade(largeText, {
      options: { patterns: ['token'], minMatches: 200000 },
    });
    expect(passResult.passed).toBe(true);

    const invertResult = regexGrader.grade(largeText, {
      options: { patterns: ['token'], minMatches: 1, invert: true },
    });
    expect(invertResult.passed).toBe(false);
  });

  it('ignores non-finite minMatches values', () => {
    const result = regexGrader.grade('foo', {
      options: { pattern: 'foo', minMatches: '2' },
    });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('All required patterns matched');
  });

  it('handles concurrent and rapid consecutive calls', async () => {
    const { cpus } = await import('node:os');
    const concurrency = cpus().length;

    const concurrentResults = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        Promise.resolve(
          regexGrader.grade(`value-${i}`, { options: { pattern: `value-${i}` } })
        )
      )
    );
    expect(concurrentResults.every((result) => result.passed)).toBe(true);

    const rapidResults = [];
    for (let i = 0; i < 25; i++) {
      rapidResults.push(regexGrader.grade(`fast-${i}`, { options: { pattern: `fast-${i}` } }));
    }
    expect(rapidResults.every((result) => result.passed)).toBe(true);
  });
});

describe('stateCheckGrader', () => {
  it('matches deep nested subsets via path', () => {
    const outcome = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: [{ item: { name: 'alpha', count: 3 } }],
            },
          },
        },
      },
    };

    const result = stateCheckGrader.grade(outcome, {
      options: {
        path: 'level1.level2.level3.level4.level5[0].item',
        expected: { name: /alp/, count: 3 },
      },
    });

    expect(result.passed).toBe(true);
  });

  it('handles empty structures and null/undefined values', () => {
    const emptyArray = stateCheckGrader.grade([], { options: { expected: [] } });
    expect(emptyArray.passed).toBe(true);

    const emptyObject = stateCheckGrader.grade({}, { options: { expected: {} } });
    expect(emptyObject.passed).toBe(true);

    const nullTruthiness = stateCheckGrader.grade(null, { options: {} });
    expect(nullTruthiness.passed).toBe(false);

    const undefinedTruthiness = stateCheckGrader.grade(undefined, { options: {} });
    expect(undefinedTruthiness.passed).toBe(false);

    const emptyStringTruthiness = stateCheckGrader.grade('', { options: {} });
    expect(emptyStringTruthiness.passed).toBe(false);
  });

  it('evaluates predicates and supports inversion', () => {
    const pass = stateCheckGrader.grade({ value: 0 }, {
      options: { path: 'value', predicate: (value) => value === 0 },
    });
    expect(pass.passed).toBe(true);

    const inverted = stateCheckGrader.grade({ value: 0 }, {
      options: { path: 'value', predicate: (value) => value === 0, not: true },
    });
    expect(inverted.passed).toBe(false);
  });

  it('reports predicate errors', () => {
    const result = stateCheckGrader.grade({ value: 1 }, {
      options: {
        path: 'value',
        predicate: () => {
          throw new Error('boom');
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.issues[0].type).toBe('predicate_error');
    expect(result.reason).toContain('Predicate threw');
  });

  it('detects type mismatches for arrays and primitives', () => {
    const arrayMismatch = stateCheckGrader.grade({ list: {} }, {
      options: { path: 'list', expected: [1] },
    });
    expect(arrayMismatch.passed).toBe(false);
    expect(arrayMismatch.reason).toContain('Expected an array');

    const stringNumber = stateCheckGrader.grade({ value: 1 }, {
      options: { path: 'value', expected: '1' },
    });
    expect(stringNumber.passed).toBe(false);
  });
});

describe('toolCallsGrader', () => {
  it('fails when transcript has no tool calls and minCalls is required', () => {
    const result = toolCallsGrader.grade(null, { options: { minCalls: 1 } });
    expect(result.passed).toBe(false);
    expect(result.issues[0].type).toBe('tool_calls_too_few');
  });

  it('enforces call count and required/forbidden tools', () => {
    const transcript = [
      { type: 'tool_call', content: { name: 'alpha' } },
      { type: 'tool_call', content: { tool: 'beta' } },
    ];

    const result = toolCallsGrader.grade(transcript, {
      options: {
        minCalls: 3,
        maxCalls: 1,
        required: ['alpha', 'gamma'],
        forbidden: ['beta'],
      },
    });

    expect(result.passed).toBe(false);
    const types = result.issues.map((issue) => issue.type);
    expect(types).toContain('tool_calls_too_few');
    expect(types).toContain('tool_calls_too_many');
    expect(types).toContain('missing_tool_call');
    expect(types).toContain('forbidden_tool_call');
  });

  it('validates required call sequence', () => {
    const transcript = {
      entries: [
        { type: 'tool_call', content: 'first' },
        { type: 'tool_call', content: { name: 'second' } },
        { type: 'tool_call', content: { call: { name: 'third' } } },
      ],
    };

    const result = toolCallsGrader.grade(transcript, {
      options: { sequence: ['second', 'first'] },
    });

    expect(result.passed).toBe(false);
    expect(result.issues[0].type).toBe('tool_call_sequence');
  });

  it('matches tool args subsets and reports mismatches', () => {
    const transcript = {
      entries: [
        {
          type: 'tool_call',
          content: {
            name: 'calc',
            args: { meta: { id: 0 }, extra: { deep: { value: 'ok' } } },
          },
        },
      ],
    };

    const pass = toolCallsGrader.grade(transcript, {
      options: { match: [{ name: 'calc', args: { meta: { id: 0 } } }] },
    });
    expect(pass.passed).toBe(true);

    const mismatchTranscript = {
      entries: [
        {
          type: 'tool_call',
          content: { name: 'calc', args: { numbers: { 0: 1 } } },
        },
      ],
    };

    const fail = toolCallsGrader.grade(mismatchTranscript, {
      options: { match: [{ name: 'calc', args: { numbers: [1] } }] },
    });

    expect(fail.passed).toBe(false);
    expect(fail.issues[0].type).toBe('tool_args_mismatch');
    expect(fail.issues[0].message).toContain('Expected an array');
  });
});

describe('transcriptGrader', () => {
  it('flags transcript errors by default', () => {
    const transcript = { entries: [{ type: 'error' }] };
    const result = transcriptGrader.grade(transcript, { options: {} });
    expect(result.passed).toBe(false);
    expect(result.issues[0].type).toBe('transcript_error');
  });

  it('allows error entries when allowErrors is true', () => {
    const transcript = { entries: [{ type: 'error' }] };
    const result = transcriptGrader.grade(transcript, { options: { allowErrors: true } });
    expect(result.passed).toBe(true);
  });

  it('counts tokens and enforces constraints', () => {
    const transcript = {
      startTime: 0,
      endTime: 100,
      entries: [
        { type: 'output', metadata: { totalTokens: 5 } },
        { type: 'output', metadata: { tokens: 3 } },
        { type: 'tool_call', metadata: { tokenCount: 2 } },
        { type: 'tool_call', metadata: { usage: { total_tokens: 4 } } },
      ],
    };

    const result = transcriptGrader.grade(transcript, {
      options: {
        minTurns: 2,
        maxTurns: 2,
        minToolCalls: 2,
        maxToolCalls: 2,
        minTokens: 14,
        maxTokens: 14,
        minLatencyMs: 0,
        maxLatencyMs: Number.MAX_SAFE_INTEGER,
      },
    });

    expect(result.passed).toBe(true);
  });

  it('reports constraint violations with boundary values', () => {
    const transcript = {
      startTime: 0,
      endTime: 50,
      entries: [
        { type: 'output', metadata: { totalTokens: 1 } },
        { type: 'tool_call', metadata: { totalTokens: 1 } },
      ],
    };

    const result = transcriptGrader.grade(transcript, {
      options: {
        maxTurns: -1,
        minTokens: 99,
        maxLatencyMs: 10,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.issues.every((issue) => issue.type === 'constraint_violation')).toBe(true);
  });
});
