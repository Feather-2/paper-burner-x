import { describe, it, expect } from 'vitest';

const evalIndexPath = '../../../../js/agents/eval/index.js';

describe('EvalHarness', () => {
  it('re-exports EvalHarness from harness.js', async () => {
    const [indexMod, harnessMod] = await Promise.all([
      import(evalIndexPath),
      import('../../../../js/agents/eval/harness.js'),
    ]);

    expect(indexMod.EvalHarness).toBe(harnessMod.EvalHarness);
    expect(typeof indexMod.EvalHarness).toBe('function');
  });

  it('runTask: validates inputs and returns TaskResult shape', async () => {
    const { EvalHarness } = await import(evalIndexPath);
    const harness = new EvalHarness({ trialsPerTask: 1, concurrency: 1 });

    await expect(harness.runTask(null)).rejects.toThrow();
    await expect(harness.runTask({})).rejects.toThrow();
    await expect(harness.runTask({ id: '', graders: [] })).rejects.toThrow();

    const result = await harness.runTask({ id: 't1', description: 'demo', input: 'hello', graders: [] }, { trialsPerTask: 1 });
    expect(result).toEqual(
      expect.objectContaining({
        taskId: 't1',
        trials: expect.any(Array),
        passRate: expect.any(Number),
        passAtK: expect.any(Number),
        passExpK: expect.any(Number),
      }),
    );
    expect(result.trials.length).toBe(1);
  });
});

describe('EvaluateStage', () => {
  it('re-exports EvaluateStage and default from graders/content.js', async () => {
    const [indexMod, contentMod] = await Promise.all([
      import(evalIndexPath),
      import('../../../../js/agents/eval/graders/content.js'),
    ]);

    expect(indexMod.EvaluateStage).toBe(contentMod.EvaluateStage);
    expect(indexMod.default).toBe(contentMod.default);
    expect(indexMod.default).toBe(indexMod.EvaluateStage);
  });

  it('run: returns EvaluationResult and flags missing_content', async () => {
    const { EvaluateStage } = await import(evalIndexPath);
    const stage = new EvaluateStage({ passThreshold: 0.6, strict: false });

    const good = await stage.run(null, { content: 'a'.repeat(250), context: { type: 'text' } });
    expect(good).toEqual(expect.objectContaining({ passed: expect.any(Boolean), score: expect.any(Number), issues: expect.any(Array) }));
    expect(good.score).toBeGreaterThanOrEqual(0);
    expect(good.score).toBeLessThanOrEqual(1);

    const empty = await stage.run(null, { content: '', context: { type: 'text' } });
    expect(empty.passed).toBe(false);
    expect(empty.score).toBe(0);
    expect(Array.isArray(empty.issues)).toBe(true);
    expect(empty.issues.map((i) => i.type)).toContain('missing_content');
  });
});

describe('export * wiring', () => {
  it('re-exports graders and metrics modules', async () => {
    const [indexMod, gradersMod, metricsMod] = await Promise.all([
      import(evalIndexPath),
      import('../../../../js/agents/eval/graders/index.js'),
      import('../../../../js/agents/eval/metrics.js'),
    ]);

    expect(indexMod.GraderRegistry).toBe(gradersMod.GraderRegistry);
    expect(indexMod.createDefaultGraderRegistry).toBe(gradersMod.createDefaultGraderRegistry);
    expect(indexMod.defaultGraderRegistry).toBe(gradersMod.defaultGraderRegistry);

    expect(indexMod.aggregateResults).toBe(metricsMod.aggregateResults);
    expect(indexMod.passAtK).toBe(metricsMod.passAtK);
    expect(indexMod.passExpK).toBe(metricsMod.passExpK);
  });
});
