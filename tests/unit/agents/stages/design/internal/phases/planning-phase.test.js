import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedRuntime = vi.hoisted(() => ({
  checkCancelled: vi.fn(),
}));

const mockedShared = vi.hoisted(() => ({
  toNonEmptyString: vi.fn(),
}));

const mockedStates = vi.hoisted(() => ({
  DesignPhase: {
    DECK_PLANNING: 'DECK_PLANNING',
    PLAN_CONFIRMING: 'PLAN_CONFIRMING',
  },
}));

const mockedHelpers = vi.hoisted(() => ({
  emitStage: vi.fn(),
}));

const mockedPlanner = vi.hoisted(() => ({
  planDeck: vi.fn(),
  applyUserEdits: vi.fn(),
  formatPlanForDialog: vi.fn(),
}));

const mockedPhaseUtils = vi.hoisted(() => ({
  runWithPhaseSpan: vi.fn(),
}));

vi.mock('../../../../../../../js/agents/runtime/index.js', () => ({
  checkCancelled: mockedRuntime.checkCancelled,
}));

vi.mock('../../../../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: mockedShared.toNonEmptyString,
}));

vi.mock('../../../../../../../js/agents/stages/design/states.js', () => ({
  DesignPhase: mockedStates.DesignPhase,
}));

vi.mock('../../../../../../../js/agents/stages/design/design-helpers.js', () => ({
  emitStage: mockedHelpers.emitStage,
}));

vi.mock('../../../../../../../js/agents/stages/design/internal/deck-planner.js', () => ({
  planDeck: mockedPlanner.planDeck,
  applyUserEdits: mockedPlanner.applyUserEdits,
  formatPlanForDialog: mockedPlanner.formatPlanForDialog,
}));

vi.mock('../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js', () => ({
  runWithPhaseSpan: mockedPhaseUtils.runWithPhaseSpan,
}));

const loadPlanningPhase = async () => await import(
  '../../../../../../../js/agents/stages/design/internal/phases/planning-phase.js'
);

const makeLoop = (overrides = {}) => ({
  phase: 'initial',
  state: {
    slideIntents: [],
    designSystem: null,
  },
  _transitionPhase: vi.fn(),
  waitForUserAction: vi.fn(),
  _blackboard: {
    logDecision: vi.fn(),
    setSummary: vi.fn(),
  },
  ...overrides,
});

const defaultToNonEmptyString = (value) => {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
};

describe('runPlanningPhase', () => {
  beforeEach(() => {
    vi.resetModules();

    mockedRuntime.checkCancelled.mockReset();
    mockedShared.toNonEmptyString.mockReset();
    mockedHelpers.emitStage.mockReset();
    mockedPlanner.planDeck.mockReset();
    mockedPlanner.applyUserEdits.mockReset();
    mockedPlanner.formatPlanForDialog.mockReset();
    mockedPhaseUtils.runWithPhaseSpan.mockReset();

    mockedRuntime.checkCancelled.mockImplementation(() => {});
    mockedShared.toNonEmptyString.mockImplementation(defaultToNonEmptyString);
    mockedPlanner.planDeck.mockImplementation((slideIntents) => ({
      plans: Array.isArray(slideIntents)
        ? slideIntents.map((intent, index) => ({
          slideIntentId: intent?.slideIntentId ?? `slide_${index}`,
        }))
        : [],
      summary: 'summary',
    }));
    mockedPlanner.applyUserEdits.mockImplementation((plans, edits) =>
      plans.map((plan) => ({
        ...plan,
        edited: true,
        editCount: edits.length,
      }))
    );
    mockedPlanner.formatPlanForDialog.mockImplementation(() => 'dialog');
    mockedPhaseUtils.runWithPhaseSpan.mockImplementation(async (_trace, _name, _attrs, fn) => fn());
  });

  it('runs planning flow and emits preview/confirmed', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const slideIntents = [{ slideIntentId: 's1' }, { slideIntentId: 's2' }];
    const plans = [{ slideIntentId: 's1' }, { slideIntentId: 's2' }];
    const planResult = { plans, summary: 'summary-2' };
    mockedPlanner.planDeck.mockReturnValue(planResult);
    mockedPlanner.formatPlanForDialog.mockReturnValue('dialog-format');

    const loop = makeLoop({ phase: 'start' });
    const emit = vi.fn();
    const context = {
      signal: { aborted: false },
      interactionMode: { planConfirm: 'skip' },
      eventBus: {},
    };
    const runContext = { runId: 0 };
    const traceContext = { trace: 't' };

    const result = await runPlanningPhase(loop, {
      slideIntents,
      designSystem: { theme: 'neo' },
      context,
      runContext,
      emit,
      traceContext,
    });

    expect(mockedRuntime.checkCancelled).toHaveBeenCalledWith(context.signal);
    expect(mockedPlanner.planDeck).toHaveBeenCalledWith(slideIntents, { theme: 'neo' });
    expect(mockedPlanner.formatPlanForDialog).toHaveBeenCalledWith(plans);
    expect(mockedPhaseUtils.runWithPhaseSpan).toHaveBeenCalledWith(
      traceContext,
      'design.phase.planning',
      { runId: 0, slideCount: 2 },
      expect.any(Function)
    );
    expect(loop._transitionPhase).toHaveBeenNthCalledWith(
      1,
      loop.phase,
      mockedStates.DesignPhase.DECK_PLANNING,
      { emit, runId: 0 }
    );
    expect(loop._transitionPhase).toHaveBeenNthCalledWith(
      2,
      loop.phase,
      mockedStates.DesignPhase.PLAN_CONFIRMING,
      { emit, runId: 0 }
    );
    expect(loop.waitForUserAction).not.toHaveBeenCalled();
    expect(mockedHelpers.emitStage).toHaveBeenNthCalledWith(
      1,
      emit,
      'design.plan.preview',
      'awaiting_confirm',
      expect.objectContaining({
        runId: 0,
        plans,
        dialogFormat: 'dialog-format',
        slideCount: 2,
        summary: 'summary-2',
      })
    );
    expect(mockedHelpers.emitStage).toHaveBeenNthCalledWith(
      2,
      emit,
      'design.plan.confirmed',
      'confirmed',
      expect.objectContaining({
        runId: 0,
        plans,
        slideCount: 2,
      })
    );
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith(
      'plan_generated',
      'Generated 2 slide plans',
      { summary: 'summary-2' }
    );
    expect(loop._blackboard.setSummary).toHaveBeenCalledWith('plan', '2 slides planned');
    expect(result.plans).toBe(plans);
    expect(result.planResult).toBe(planResult);
    expect(loop.state.plans).toBe(plans);
  });

  it('falls back to empty inputs and skips confirmation on falsy mode', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const planResult = { plans: [], summary: 'No slides to plan' };
    mockedPlanner.planDeck.mockReturnValue(planResult);

    const loop = makeLoop({
      state: {
        slideIntents: 'not-array',
        designSystem: { theme: 'state-theme' },
      },
    });
    const emit = vi.fn();
    const context = {
      signal: null,
      interactionMode: { planConfirm: 0 },
      eventBus: {},
    };
    const runContext = { runId: Number.MAX_SAFE_INTEGER };

    const result = await runPlanningPhase(loop, {
      slideIntents: null,
      designSystem: undefined,
      context,
      runContext,
      emit,
      traceContext: null,
    });

    expect(mockedPlanner.planDeck).toHaveBeenCalledWith([], { theme: 'state-theme' });
    expect(mockedRuntime.checkCancelled).toHaveBeenCalledWith(null);
    expect(loop.waitForUserAction).not.toHaveBeenCalled();
    expect(mockedHelpers.emitStage).toHaveBeenNthCalledWith(
      1,
      emit,
      'design.plan.preview',
      'awaiting_confirm',
      expect.objectContaining({
        runId: Number.MAX_SAFE_INTEGER,
        plans: [],
        slideCount: 0,
        summary: 'No slides to plan',
      })
    );
    expect(mockedHelpers.emitStage).toHaveBeenNthCalledWith(
      2,
      emit,
      'design.plan.confirmed',
      'confirmed',
      expect.objectContaining({
        runId: Number.MAX_SAFE_INTEGER,
        plans: [],
        slideCount: 0,
      })
    );
    expect(loop._blackboard.setSummary).toHaveBeenCalledWith('plan', '0 slides planned');
    expect(result.plans).toEqual([]);
  });

  it('applies sanitized edits with trimming and slideIndex fallback', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const plans = [{ slideIntentId: 'a' }, { slideIntentId: 'b' }];
    mockedPlanner.planDeck.mockReturnValue({ plans, summary: 'summary' });

    const updatedPlans = [
      { slideIntentId: 'a', edited: true },
      { slideIntentId: 'b', edited: true },
    ];
    mockedPlanner.applyUserEdits.mockReturnValue(updatedPlans);

    const edits = [
      null,
      undefined,
      {},
      { slideIntentId: 'a', visualFocus: '' },
      { slideIntentId: 'a', layoutHint: '   ' },
      {
        slideIntentId: 'a',
        layoutHint: 'L'.repeat(60),
        visualFocus: 'F'.repeat(80),
        keyMessage: 'K'.repeat(120),
        visualIntent: 'I'.repeat(250),
        sellingPoint: 'S'.repeat(250),
      },
      { slideIntentId: 'unknown', slideIndex: 1, keyMessage: 'msg' },
      { slideIntentId: 'unknown', slideIndex: -1, keyMessage: 'bad' },
      { slideIntentId: 'unknown', slideIndex: Number.MAX_SAFE_INTEGER, keyMessage: 'bad' },
      { slideIntentId: 'unknown', slideIndex: '1', keyMessage: 'bad' },
      { slideIntentId: { nested: { value: 1 } }, slideIndex: 0, keyMessage: 'nested' },
    ];

    const loop = makeLoop();
    loop.waitForUserAction.mockResolvedValue({ edits });

    const emit = vi.fn();
    const context = {
      signal: { aborted: false },
      interactionMode: { planConfirm: 'required' },
      eventBus: {},
    };

    const result = await runPlanningPhase(loop, {
      slideIntents: [{ slideIntentId: 'a' }, { slideIntentId: 'b' }],
      designSystem: null,
      context,
      runContext: { runId: 'run-edits' },
      emit,
      traceContext: null,
    });

    const expectedEdits = [
      {
        slideIntentId: 'a',
        layoutHint: 'L'.repeat(50),
        visualFocus: 'F'.repeat(50),
        keyMessage: 'K'.repeat(100),
        visualIntent: 'I'.repeat(200),
        sellingPoint: 'S'.repeat(200),
      },
      { slideIntentId: 'b', keyMessage: 'msg' },
      { slideIntentId: 'a', keyMessage: 'nested' },
    ];

    expect(loop.waitForUserAction).toHaveBeenCalledWith('confirm_plan', {
      eventBus: context.eventBus,
      signal: context.signal,
    });
    expect(mockedPlanner.applyUserEdits).toHaveBeenCalledWith(plans, expectedEdits);
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith(
      'plan_edited',
      'User modified slide plans',
      { editCount: expectedEdits.length }
    );
    expect(mockedHelpers.emitStage).toHaveBeenNthCalledWith(
      1,
      emit,
      'design.plan.preview',
      'awaiting_confirm',
      expect.objectContaining({ plans })
    );
    expect(mockedHelpers.emitStage).toHaveBeenNthCalledWith(
      2,
      emit,
      'design.plan.confirmed',
      'confirmed',
      expect.objectContaining({ plans: updatedPlans })
    );
    expect(result.plans).toBe(updatedPlans);
  });

  it('ignores non-array edits and invalid plan overrides', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const plans = [{ slideIntentId: 'a' }, { slideIntentId: 'b' }];
    mockedPlanner.planDeck.mockReturnValue({ plans, summary: 'summary' });

    const loop = makeLoop();
    loop.waitForUserAction.mockResolvedValue({
      edits: {},
      plans: [
        { slideIntentId: 'a' },
        { slideIntentId: 'a', keyMessage: 'dup' },
      ],
    });

    const context = {
      signal: {},
      interactionMode: { planConfirm: true },
      eventBus: {},
    };

    const result = await runPlanningPhase(loop, {
      slideIntents: [{ slideIntentId: 'a' }, { slideIntentId: 'b' }],
      designSystem: null,
      context,
      runContext: { runId: 'run-invalid' },
      emit: vi.fn(),
      traceContext: null,
    });

    expect(mockedPlanner.applyUserEdits).not.toHaveBeenCalled();
    expect(loop._blackboard.logDecision).not.toHaveBeenCalledWith(
      'plan_edited',
      'User modified slide plans',
      expect.anything()
    );
    expect(result.plans).toBe(plans);
  });

  it('applies direct overrides when plan list is valid', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const plans = [{ slideIntentId: 'a' }, { slideIntentId: 'b' }];
    mockedPlanner.planDeck.mockReturnValue({ plans, summary: 'summary' });

    const updatedPlans = [
      { slideIntentId: 'a', override: true },
      { slideIntentId: 'b', override: true },
    ];
    mockedPlanner.applyUserEdits.mockReturnValue(updatedPlans);

    const loop = makeLoop();
    loop.waitForUserAction.mockResolvedValue({
      plans: [
        { slideIntentId: 'a', visualIntent: 'V'.repeat(205) },
        { slideIntentId: 'b', layoutHint: ' layout ', keyMessage: '   ' },
      ],
    });

    const result = await runPlanningPhase(loop, {
      slideIntents: [{ slideIntentId: 'a' }, { slideIntentId: 'b' }],
      designSystem: null,
      context: {
        signal: {},
        interactionMode: { planConfirm: true },
        eventBus: {},
      },
      runContext: { runId: 'run-override' },
      emit: vi.fn(),
      traceContext: null,
    });

    expect(mockedPlanner.applyUserEdits).toHaveBeenCalledWith(plans, [
      { slideIntentId: 'a', visualIntent: 'V'.repeat(200) },
      { slideIntentId: 'b', layoutHint: 'layout' },
    ]);
    expect(loop._blackboard.logDecision).not.toHaveBeenCalledWith(
      'plan_edited',
      'User modified slide plans',
      expect.anything()
    );
    expect(result.plans).toBe(updatedPlans);
  });

  it('limits edits to MAX_PLAN_EDIT_COUNT', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const plans = [{ slideIntentId: 'a' }];
    mockedPlanner.planDeck.mockReturnValue({ plans, summary: 'summary' });

    const edits = Array.from({ length: 205 }, (_, index) => ({
      slideIntentId: 'a',
      layoutHint: `hint-${index}`,
    }));

    const loop = makeLoop();
    loop.waitForUserAction.mockResolvedValue({ edits });

    await runPlanningPhase(loop, {
      slideIntents: [{ slideIntentId: 'a' }],
      designSystem: null,
      context: {
        signal: {},
        interactionMode: { planConfirm: true },
        eventBus: {},
      },
      runContext: { runId: 'run-max' },
      emit: vi.fn(),
      traceContext: null,
    });

    const appliedEdits = mockedPlanner.applyUserEdits.mock.calls[0][1];
    expect(appliedEdits).toHaveLength(200);
    expect(appliedEdits[0]).toEqual({ slideIntentId: 'a', layoutHint: 'hint-0' });
    expect(appliedEdits[199]).toEqual({ slideIntentId: 'a', layoutHint: 'hint-199' });
  });

  it('propagates cancellation errors', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    mockedRuntime.checkCancelled.mockImplementation(() => {
      throw new Error('cancelled');
    });

    const loop = makeLoop();

    await expect(
      runPlanningPhase(loop, {
        slideIntents: [],
        designSystem: null,
        context: { signal: {} },
        runContext: { runId: 'run-cancel' },
        emit: vi.fn(),
        traceContext: null,
      })
    ).rejects.toThrow('cancelled');

    expect(loop._transitionPhase).toHaveBeenCalledTimes(1);
    expect(mockedPlanner.planDeck).not.toHaveBeenCalled();
    expect(mockedHelpers.emitStage).not.toHaveBeenCalled();
  });

  it('supports quick successive calls on the same loop', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const loop = makeLoop();

    const first = await runPlanningPhase(loop, {
      slideIntents: [{ slideIntentId: 'first' }],
      designSystem: null,
      context: { signal: {}, interactionMode: { planConfirm: 'skip' }, eventBus: {} },
      runContext: { runId: 1 },
      emit: vi.fn(),
      traceContext: null,
    });

    const second = await runPlanningPhase(loop, {
      slideIntents: [{ slideIntentId: 'second' }, { slideIntentId: 'third' }],
      designSystem: null,
      context: { signal: {}, interactionMode: { planConfirm: 'skip' }, eventBus: {} },
      runContext: { runId: 2 },
      emit: vi.fn(),
      traceContext: null,
    });

    expect(first.plans).toHaveLength(1);
    expect(second.plans).toHaveLength(2);
    expect(loop.state.plans).toBe(second.plans);
    expect(mockedPlanner.planDeck).toHaveBeenCalledTimes(2);
  });

  it('supports concurrent calls on separate loops', async () => {
    const { runPlanningPhase } = await loadPlanningPhase();
    const loopA = makeLoop();
    const loopB = makeLoop();

    const [resultA, resultB] = await Promise.all([
      runPlanningPhase(loopA, {
        slideIntents: [{ slideIntentId: 'a' }],
        designSystem: null,
        context: { signal: {}, interactionMode: { planConfirm: 'skip' }, eventBus: {} },
        runContext: { runId: 'r1' },
        emit: vi.fn(),
        traceContext: null,
      }),
      runPlanningPhase(loopB, {
        slideIntents: [{ slideIntentId: 'b' }, { slideIntentId: 'c' }],
        designSystem: null,
        context: { signal: {}, interactionMode: { planConfirm: 'skip' }, eventBus: {} },
        runContext: { runId: 'r2' },
        emit: vi.fn(),
        traceContext: null,
      }),
    ]);

    expect(resultA.plans).toHaveLength(1);
    expect(resultB.plans).toHaveLength(2);
    expect(loopA.state.plans).toBe(resultA.plans);
    expect(loopB.state.plans).toBe(resultB.plans);
  });
});
