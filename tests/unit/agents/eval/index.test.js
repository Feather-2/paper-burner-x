import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../js/agents/eval/types.js', () => ({
  TYPES_SENTINEL: Symbol('TYPES_SENTINEL'),
  TYPES_EMPTY_OBJECT: {},
  TYPES_EMPTY_ARRAY: [],
}));

vi.mock('../../../../js/agents/eval/graders/index.js', () => ({
  GRADERS_SENTINEL: Symbol('GRADERS_SENTINEL'),
}));

vi.mock('../../../../js/agents/eval/metrics.js', () => ({
  METRICS_SENTINEL: Symbol('METRICS_SENTINEL'),
}));

vi.mock('../../../../js/agents/eval/harness.js', () => {
  class EvalHarness {
    constructor(options = {}) {
      if (options === null) throw new TypeError('options must be an object');
      if (options !== undefined && (typeof options !== 'object' || Array.isArray(options))) {
        throw new TypeError('options must be an object');
      }
      this.options = options ?? {};
    }

    run(input) {
      if (input == null) throw new TypeError('input is required');

      if (typeof input === 'string') return { type: 'string', length: input.length };
      if (typeof input === 'number') return { type: 'number', value: input };
      if (Array.isArray(input)) return { type: 'array', length: input.length };
      if (typeof input === 'object') return { type: 'object', keys: Object.keys(input).length };

      return { type: typeof input };
    }
  }

  return { EvalHarness };
});

vi.mock('../../../../js/agents/eval/graders/content.js', () => {
  const EvaluateStage = vi.fn(async (stage) => {
    if (stage == null) throw new TypeError('stage is required');

    if (typeof stage === 'string') {
      const trimmed = stage.trim();
      if (trimmed === '') throw new RangeError('stage must not be empty');
      if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
      return stage;
    }

    if (typeof stage === 'number') {
      if (!Number.isFinite(stage) || Number.isNaN(stage)) throw new RangeError('stage must be finite');
      return stage;
    }

    if (Array.isArray(stage)) return stage.length;
    if (typeof stage === 'object') return Object.keys(stage).length;

    return String(stage);
  });

  const defaultExport = vi.fn(async (...args) => EvaluateStage(...args));
  return { EvaluateStage, default: defaultExport };
});

const evalIndexPath = '../../../../js/agents/eval/index.js';

function makeDeepNestedObject(depth) {
  let current = { leaf: true };
  for (let i = 0; i < depth; i += 1) current = { nested: current };
  return current;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('EvalHarness', () => {
  it('re-exports EvalHarness from harness.js', async () => {
    const [indexMod, harnessMod] = await Promise.all([
      import(evalIndexPath),
      import('../../../../js/agents/eval/harness.js'),
    ]);

    expect(indexMod.EvalHarness).toBe(harnessMod.EvalHarness);
    expect(typeof indexMod.EvalHarness).toBe('function');
  });

  it('constructor: handles null/undefined/empty and type boundaries', async () => {
    const { EvalHarness } = await import(evalIndexPath);

    expect(() => new EvalHarness()).not.toThrow();
    expect(() => new EvalHarness(undefined)).not.toThrow();
    expect(() => new EvalHarness({})).not.toThrow();

    expect(() => new EvalHarness(null)).toThrow(TypeError);
    expect(() => new EvalHarness('')).toThrow(TypeError);
    expect(() => new EvalHarness([])).toThrow(TypeError);
  });

  it('run: covers normal, boundary, and error cases', async () => {
    const { EvalHarness } = await import(evalIndexPath);
    const harness = new EvalHarness({});

    expect(() => harness.run(null)).toThrow(TypeError);
    expect(() => harness.run(undefined)).toThrow(TypeError);

    expect(harness.run('')).toEqual({ type: 'string', length: 0 });
    expect(harness.run(' \t\n ')).toEqual({ type: 'string', length: 4 });

    expect(harness.run(0)).toEqual({ type: 'number', value: 0 });
    expect(harness.run(-1)).toEqual({ type: 'number', value: -1 });
    expect(harness.run(Number.MAX_SAFE_INTEGER)).toEqual({ type: 'number', value: Number.MAX_SAFE_INTEGER });

    expect(harness.run([])).toEqual({ type: 'array', length: 0 });
    expect(harness.run({})).toEqual({ type: 'object', keys: 0 });

    expect(harness.run('123')).toEqual({ type: 'string', length: 3 });
    expect(harness.run({ 0: 'x', length: 1 })).toEqual({ type: 'object', keys: 2 });
  });

  it('run: supports resource and concurrency boundaries', async () => {
    const { EvalHarness } = await import(evalIndexPath);
    const harness = new EvalHarness({});

    const hugeString = 'a'.repeat(100_000);
    const hugeArray = Array.from({ length: 50_000 }, (_, i) => i);
    const deepObject = makeDeepNestedObject(60);

    expect(harness.run(hugeString)).toEqual({ type: 'string', length: hugeString.length });
    expect(harness.run(hugeArray)).toEqual({ type: 'array', length: hugeArray.length });
    expect(harness.run(deepObject)).toEqual({ type: 'object', keys: 1 });

    const results = await Promise.all([0, -1, Number.MAX_SAFE_INTEGER, '', [], {}].map(async (v) => harness.run(v)));

    expect(results).toEqual([
      { type: 'number', value: 0 },
      { type: 'number', value: -1 },
      { type: 'number', value: Number.MAX_SAFE_INTEGER },
      { type: 'string', length: 0 },
      { type: 'array', length: 0 },
      { type: 'object', keys: 0 },
    ]);
  });
});

describe('EvaluateStage', () => {
  it('re-exports EvaluateStage from graders/content.js', async () => {
    const [indexMod, contentMod] = await Promise.all([
      import(evalIndexPath),
      import('../../../../js/agents/eval/graders/content.js'),
    ]);

    expect(indexMod.EvaluateStage).toBe(contentMod.EvaluateStage);
    expect(typeof indexMod.EvaluateStage).toBe('function');
  });

  it('rejects null/undefined/empty/whitespace', async () => {
    const { EvaluateStage } = await import(evalIndexPath);

    await expect(EvaluateStage(null)).rejects.toThrow(TypeError);
    await expect(EvaluateStage(undefined)).rejects.toThrow(TypeError);
    await expect(EvaluateStage('')).rejects.toThrow(RangeError);
    await expect(EvaluateStage('   ')).rejects.toThrow(RangeError);
  });

  it('handles boundary values and type edges', async () => {
    const { EvaluateStage } = await import(evalIndexPath);

    await expect(EvaluateStage(0)).resolves.toBe(0);
    await expect(EvaluateStage(-1)).resolves.toBe(-1);
    await expect(EvaluateStage(Number.MAX_SAFE_INTEGER)).resolves.toBe(Number.MAX_SAFE_INTEGER);

    await expect(EvaluateStage('0')).resolves.toBe(0);
    await expect(EvaluateStage('  42 ')).resolves.toBe(42);
    await expect(EvaluateStage('not a number')).resolves.toBe('not a number');

    await expect(EvaluateStage([])).resolves.toBe(0);
    await expect(EvaluateStage({})).resolves.toBe(0);
    await expect(EvaluateStage({ a: 1, b: 2 })).resolves.toBe(2);

    await expect(EvaluateStage({ 0: 'x', length: 1 })).resolves.toBe(2);
    await expect(EvaluateStage('123')).resolves.toBe(123);

    await expect(EvaluateStage(Infinity)).rejects.toThrow(RangeError);
    await expect(EvaluateStage(NaN)).rejects.toThrow(RangeError);
  });

  it('supports concurrency and resource boundaries', async () => {
    const { EvaluateStage } = await import(evalIndexPath);

    const hugeString = 'x'.repeat(120_000);
    const hugeArray = Array.from({ length: 80_000 }, (_, i) => i);
    const deepObject = makeDeepNestedObject(80);

    const inputs = [
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      ' 9007199254740991 ',
      hugeString,
      hugeArray,
      deepObject,
      { a: 1, b: 2, c: 3 },
    ];

    const results = await Promise.all(inputs.map((v) => EvaluateStage(v)));

    expect(results).toEqual([
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      hugeString,
      hugeArray.length,
      1,
      3,
    ]);
    expect(EvaluateStage).toHaveBeenCalledTimes(inputs.length);
  });
});

describe('default export', () => {
  it('re-exports default from graders/content.js', async () => {
    const [indexMod, contentMod] = await Promise.all([
      import(evalIndexPath),
      import('../../../../js/agents/eval/graders/content.js'),
    ]);

    expect(indexMod.default).toBe(contentMod.default);
    expect(typeof indexMod.default).toBe('function');
  });

  it('delegates to EvaluateStage (normal + error paths)', async () => {
    const { default: evaluate, EvaluateStage } = await import(evalIndexPath);

    await expect(evaluate('  7 ')).resolves.toBe(7);
    expect(EvaluateStage).toHaveBeenCalledWith('  7 ');

    await expect(evaluate(null)).rejects.toThrow(TypeError);
    await expect(evaluate('   ')).rejects.toThrow(RangeError);
  });

  it('handles concurrency and resource boundaries', async () => {
    const { default: evaluate } = await import(evalIndexPath);

    const hugeString = 'z'.repeat(150_000);

    const results = await Promise.all([evaluate('1'), evaluate('2'), evaluate(0), evaluate(hugeString)]);
    expect(results).toEqual([1, 2, 0, hugeString]);
  });
});

describe('export * wiring', () => {
  it('re-exports from types.js, graders/index.js, and metrics.js', async () => {
    const [indexMod, typesMod, gradersMod, metricsMod] = await Promise.all([
      import(evalIndexPath),
      import('../../../../js/agents/eval/types.js'),
      import('../../../../js/agents/eval/graders/index.js'),
      import('../../../../js/agents/eval/metrics.js'),
    ]);

    expect(indexMod.TYPES_SENTINEL).toBe(typesMod.TYPES_SENTINEL);
    expect(indexMod.GRADERS_SENTINEL).toBe(gradersMod.GRADERS_SENTINEL);
    expect(indexMod.METRICS_SENTINEL).toBe(metricsMod.METRICS_SENTINEL);
  });
});