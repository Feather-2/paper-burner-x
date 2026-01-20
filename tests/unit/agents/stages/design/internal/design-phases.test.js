import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/runtime/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, checkCancelled: vi.fn() };
});

vi.mock('../../../../../../js/agents/stages/design/design-helpers.js', () => ({
  emitStage: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/internal/phases/phase-utils.js', () => ({
  DESIGN_PHASE_DEFAULTS: {
    costPerHDSlot: 0.04,
    costPerBasicSlot: 0.003,
    refineRecommendedSteps: 5,
    refineHardLimit: 15,
  },
  runWithPhaseSpan: vi.fn((_traceContext, _name, _meta, runPhase) => runPhase()),
}));

vi.mock('../../../../../../js/agents/stages/design/internal/deck-planner.js', () => ({
  planDeck: vi.fn(),
  applyUserEdits: vi.fn(),
  formatPlanForDialog: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/generators/layout-generator.js', () => ({
  generateLayoutBatch: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/dsl/dsl-builder.js', () => ({
  buildSlideHtml: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/dsl/dsl-rules.js', () => ({
  getDslRules: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/image/image-planner.js', () => ({
  ImagePlanner: { plan: vi.fn() },
}));

vi.mock('../../../../../../js/agents/stages/design/refiner/qa-validator.js', () => ({
  validateSlide: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/shared/design-utils.js', () => ({
  escapeHtml: vi.fn(),
}));

vi.mock('../../../../../../js/agents/shared/utils/cancellation.js', () => ({
  createLinkedSignal: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/reviewer/auto-reviewer.js', () => ({
  runAutoReview: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/refiner/react-refiner.js', () => ({
  runReactRefiner: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js', () => ({
  createToolExecutor: vi.fn(),
}));

import {
  runPreparationPhase,
  runPlanningPhase,
  runLayoutPhase,
  runGeneratingPhase,
  runBatchRepairPhase,
  runVisualPhase,
  runReviewPhase,
} from '../../../../../../js/agents/stages/design/internal/design-phases.js';
import { checkCancelled } from '../../../../../../js/agents/runtime/index.js';
import { emitStage } from '../../../../../../js/agents/stages/design/design-helpers.js';
import { runWithPhaseSpan } from '../../../../../../js/agents/stages/design/internal/phases/phase-utils.js';
import { planDeck, applyUserEdits, formatPlanForDialog } from '../../../../../../js/agents/stages/design/internal/deck-planner.js';
import { generateLayoutBatch } from '../../../../../../js/agents/stages/design/generators/layout-generator.js';
import { buildSlideHtml } from '../../../../../../js/agents/stages/design/dsl/dsl-builder.js';
import { getDslRules } from '../../../../../../js/agents/stages/design/dsl/dsl-rules.js';
import { ImagePlanner } from '../../../../../../js/agents/stages/design/image/image-planner.js';
import { validateSlide } from '../../../../../../js/agents/stages/design/refiner/qa-validator.js';
import { escapeHtml } from '../../../../../../js/agents/stages/design/shared/design-utils.js';
import { createLinkedSignal } from '../../../../../../js/agents/shared/utils/cancellation.js';
import { runAutoReview } from '../../../../../../js/agents/stages/design/reviewer/auto-reviewer.js';
import { runReactRefiner } from '../../../../../../js/agents/stages/design/refiner/react-refiner.js';
import { createToolExecutor } from '../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js';

const makeSlideIntents = (count = 1) =>
  Array.from({ length: count }, (_value, index) => ({
    slideIntentId: `s${index + 1}`,
    pageType: 'content',
    title: `Title ${index + 1}`,
  }));

const makePlans = (slideIntents) =>
  slideIntents.map((intent, index) => ({
    slideIntentId: intent.slideIntentId,
    layoutHint: `hint-${index}`,
  }));

const makeLayouts = (slideIntents) =>
  slideIntents.map((intent) => ({
    slideIntentId: intent.slideIntentId,
    layoutHtml: `<section data-slide-id="${intent.slideIntentId}"></section>`,
  }));

const createLoop = (overrides = {}) => ({
  phase: 'idle',
  state: {},
  batchSize: 2,
  batchConcurrency: 1,
  _transitionPhase: vi.fn(),
  _callTool: vi.fn(),
  waitForUserAction: vi.fn(),
  _buildVisualSlots: vi.fn(() => []),
  applyUserInputsToConfig: vi.fn((config) => config),
  _blackboard: {
    logDecision: vi.fn(),
    setSummary: vi.fn(),
  },
  ...overrides,
});

const createExecutionFns = (contextOverrides = {}) => {
  const stepContext = { signal: {}, ...contextOverrides };
  return {
    stepContext,
    startExecution: vi.fn(async () => ({
      loopIteration: { id: 'iter' },
      stepInfo: { context: stepContext },
    })),
    finishExecution: vi.fn(async () => {}),
  };
};

const createContext = (overrides = {}) => ({
  signal: {},
  eventBus: {},
  interactionMode: {},
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  checkCancelled.mockImplementation(() => {});
  emitStage.mockImplementation(() => {});
  runWithPhaseSpan.mockImplementation((_traceContext, _name, _meta, runPhase) => runPhase());
  planDeck.mockReturnValue({ plans: [], summary: 'summary' });
  applyUserEdits.mockImplementation((plans) => plans);
  formatPlanForDialog.mockReturnValue('dialog');
  generateLayoutBatch.mockReturnValue([]);
  getDslRules.mockResolvedValue({ rules: true });
  ImagePlanner.plan.mockReturnValue([]);
  validateSlide.mockImplementation(() => ({ pass: true, issues: [] }));
  buildSlideHtml.mockReturnValue('<section>safe</section>');
  escapeHtml.mockImplementation((value) => String(value));
  createLinkedSignal.mockImplementation((signal, timeout) => ({ signal, timeout }));
  runAutoReview.mockResolvedValue({ pass: true, score: 100, issues: [], fixes: [], summary: 'ok' });
  runReactRefiner.mockResolvedValue({
    finalDeck: { deckHtmlDsl: '<refined/>', slidesMeta: [] },
    qualityScore: 1,
    steps: [],
    terminationReason: 'done',
  });
  createToolExecutor.mockReturnValue({ execute: vi.fn() });
});

describe('runPreparationPhase', () => {
  it('runs outline parsing and style extraction with overrides', async () => {
    const slideIntents = makeSlideIntents(2);
    const contentPackage = { slideIntents };
    const designSystem = {
      theme: 'light',
      colorScheme: 'base',
      fontFamily: 'Arial',
      accentColor: '#123456',
    };
    const loop = createLoop();
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === 'parse_outline') {
        return { ok: true, data: { contentPackage, slideIntents } };
      }
      if (tool === 'extract_style') {
        return { ok: true, data: { designSystem: { ...designSystem } } };
      }
      return { ok: false, error: 'unexpected tool' };
    });
    loop.waitForUserAction.mockResolvedValue({
      theme: 'Dark',
      colorScheme: ' #fff ',
      fontFamily: 'Helvetica',
      accentColor: 'rgba(255, 0, 0, 0.5)',
    });
    const { startExecution, finishExecution, stepContext } = createExecutionFns();
    const context = createContext({ interactionMode: { outlineConfirm: 'skip', styleConfirm: 'manual' } });
    const emit = vi.fn();

    const result = await runPreparationPhase(loop, {
      contentPackage,
      context,
      runContext: { runId: 'run-1' },
      emit,
      startExecution,
      finishExecution,
    });

    expect(result.slideIntents).toHaveLength(2);
    expect(result.designSystem.theme).toBe('dark');
    expect(result.designSystem.colorScheme).toBe('#fff');
    expect(result.designSystem.fontFamily).toBe('Helvetica');
    expect(result.designSystem.accentColor).toBe('rgba(255, 0, 0, 0.5)');
    expect(loop.state.slideIntents).toHaveLength(2);
    expect(loop._callTool).toHaveBeenCalledWith('parse_outline', { contentPackage }, context);
    expect(loop._callTool).toHaveBeenCalledWith(
      'extract_style',
      { contentPackage, constraints: {}, userConfig: {} },
      stepContext
    );
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.style.preview')).toBe(true);
    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      undefined,
      'design.phase.preparation',
      { runId: 'run-1', slideCount: 2 },
      expect.any(Function)
    );
  });

  it('normalizes long overrides and falls back for invalid inputs', async () => {
    const slideIntents = makeSlideIntents(1);
    const baseContentPackage = { slideIntents };
    const designSystem = {
      theme: 'light',
      colorScheme: 'base',
      fontFamily: 'Arial',
      accentColor: '#123456',
    };
    const longColorScheme = 'c'.repeat(80);
    const longFontFamily = `Font ${'A'.repeat(150)}`;
    const loop = createLoop({ state: { contentPackage: baseContentPackage } });
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === 'parse_outline') {
        return { ok: true, data: { contentPackage: baseContentPackage, slideIntents } };
      }
      if (tool === 'extract_style') {
        return { ok: true, data: { designSystem: { ...designSystem } } };
      }
      return { ok: false, error: 'unexpected tool' };
    });
    loop.waitForUserAction.mockResolvedValue({
      theme: 0,
      colorScheme: longColorScheme,
      fontFamily: longFontFamily,
      accentColor: '',
    });
    const { startExecution, finishExecution } = createExecutionFns();
    const context = createContext({
      signal: null,
      interactionMode: { outlineConfirm: 'skip', styleConfirm: 'manual' },
    });

    const result = await runPreparationPhase(loop, {
      contentPackage: null,
      context,
      runContext: undefined,
      emit: vi.fn(),
      startExecution,
      finishExecution,
    });

    expect(result.designSystem.theme).toBe('light');
    expect(result.designSystem.accentColor).toBe('#123456');
    expect(result.designSystem.colorScheme).toBe(longColorScheme.slice(0, 40));
    expect(result.designSystem.fontFamily).toBe(longFontFamily.trim().slice(0, 100));
  });

  it('throws when slide intents are missing', async () => {
    const loop = createLoop();
    loop._callTool.mockResolvedValue({
      ok: true,
      data: { contentPackage: { slideIntents: [] }, slideIntents: [] },
    });
    const { startExecution, finishExecution } = createExecutionFns();
    const context = createContext({ interactionMode: { outlineConfirm: 'skip', styleConfirm: 'skip' } });

    await expect(
      runPreparationPhase(loop, {
        contentPackage: { slideIntents: [] },
        context,
        runContext: {},
        emit: vi.fn(),
        startExecution,
        finishExecution,
      })
    ).rejects.toThrow('contentPackage.slideIntents is required');

    expect(loop._callTool).toHaveBeenCalledTimes(1);
  });
});

describe('runPlanningPhase', () => {
  it('generates plans and applies user edits', async () => {
    const slideIntents = makeSlideIntents(2);
    const plans = makePlans(slideIntents);
    planDeck.mockReturnValue({ plans, summary: 'sum' });
    applyUserEdits.mockImplementation((currentPlans, edits) =>
      currentPlans.map((plan) => {
        const hit = edits.find((edit) => edit.slideIntentId === plan.slideIntentId);
        return hit ? { ...plan, ...hit } : plan;
      })
    );
    const loop = createLoop();
    loop.waitForUserAction.mockResolvedValue({ edits: [{ slideIntentId: 's1', layoutHint: 'hero' }] });
    const context = createContext({ interactionMode: { planConfirm: 'manual' } });

    const result = await runPlanningPhase(loop, {
      slideIntents,
      designSystem: {},
      context,
      runContext: { runId: 'run-plan' },
      emit: vi.fn(),
    });

    expect(result.plans[0].layoutHint).toBe('hero');
    expect(applyUserEdits).toHaveBeenCalledWith(plans, [{ slideIntentId: 's1', layoutHint: 'hero' }]);
    expect(loop.state.plans).toHaveLength(2);
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.plan.preview')).toBe(true);
  });

  it('ignores invalid edits and falls back to state intents for non-array input', async () => {
    const slideIntents = makeSlideIntents(2);
    const plans = makePlans(slideIntents);
    planDeck.mockReturnValue({ plans, summary: 'sum' });
    applyUserEdits.mockImplementation((currentPlans, edits) =>
      currentPlans.map((plan) => {
        const hit = edits.find((edit) => edit.slideIntentId === plan.slideIntentId);
        return hit ? { ...plan, ...hit } : plan;
      })
    );
    const loop = createLoop({ state: { slideIntents } });
    loop.waitForUserAction.mockResolvedValue({
      edits: [
        { slideIndex: 0, layoutHint: 'valid' },
        { slideIndex: -1, layoutHint: 'bad' },
        { slideIndex: Number.MAX_SAFE_INTEGER, layoutHint: 'bad' },
        { slideIndex: '1', layoutHint: 'bad' },
        { slideIntentId: '', layoutHint: 'bad' },
        null,
      ],
      plans: {},
    });
    const context = createContext({ interactionMode: { planConfirm: 'manual' } });

    const result = await runPlanningPhase(loop, {
      slideIntents: {},
      designSystem: null,
      context,
      runContext: { runId: 0 },
      emit: vi.fn(),
    });

    expect(planDeck).toHaveBeenCalledWith(slideIntents, null);
    expect(applyUserEdits).toHaveBeenCalledTimes(1);
    expect(applyUserEdits.mock.calls[0][1]).toEqual([{ slideIntentId: 's1', layoutHint: 'valid' }]);
    expect(result.plans[0].layoutHint).toBe('valid');
  });

  it('propagates errors from plan generation', async () => {
    planDeck.mockImplementation(() => {
      throw new Error('boom');
    });
    const loop = createLoop({ state: { slideIntents: [] } });
    const context = createContext({ interactionMode: { planConfirm: 'skip' } });

    await expect(
      runPlanningPhase(loop, {
        slideIntents: [],
        designSystem: {},
        context,
        runContext: {},
        emit: vi.fn(),
      })
    ).rejects.toThrow('boom');
  });

  it('supports concurrent planning runs', async () => {
    planDeck.mockImplementation((intents) => ({
      plans: intents.map((intent) => ({ slideIntentId: intent.slideIntentId })),
      summary: 'ok',
    }));
    const context = createContext({ interactionMode: { planConfirm: 'skip' } });
    const runContext = { runId: 'concurrent' };
    const loopA = createLoop();
    const loopB = createLoop();
    const slideIntentsA = makeSlideIntents(1);
    const slideIntentsB = makeSlideIntents(3);

    const [outA, outB] = await Promise.all([
      runPlanningPhase(loopA, {
        slideIntents: slideIntentsA,
        designSystem: {},
        context,
        runContext,
        emit: vi.fn(),
      }),
      runPlanningPhase(loopB, {
        slideIntents: slideIntentsB,
        designSystem: {},
        context,
        runContext,
        emit: vi.fn(),
      }),
    ]);

    expect(outA.plans).toHaveLength(1);
    expect(outB.plans).toHaveLength(3);
    expect(loopA.state.plans).toHaveLength(1);
    expect(loopB.state.plans).toHaveLength(3);
  });
});

describe('runLayoutPhase', () => {
  it('generates layouts and updates state', async () => {
    const slideIntents = makeSlideIntents(2);
    const plans = makePlans(slideIntents);
    const layouts = makeLayouts(slideIntents);
    generateLayoutBatch.mockReturnValue(layouts);
    const loop = createLoop({ state: { slideIntents, plans } });
    const context = createContext({ interactionMode: { layoutConfirm: 'skip' } });

    const result = await runLayoutPhase(loop, {
      slideIntents,
      designSystem: {},
      plans,
      context,
      runContext: { runId: 'layout' },
      emit: vi.fn(),
    });

    expect(result.layouts).toEqual(layouts);
    expect(loop.state.layoutData.layouts).toEqual(layouts);
    expect(generateLayoutBatch).toHaveBeenCalledWith(slideIntents, plans);
  });

  it('rejects unsafe layout overrides and keeps originals', async () => {
    const slideIntents = makeSlideIntents(2);
    const plans = makePlans(slideIntents);
    const layouts = makeLayouts(slideIntents);
    generateLayoutBatch.mockReturnValue(layouts);
    const loop = createLoop({ state: { slideIntents, plans } });
    loop.waitForUserAction.mockResolvedValue({
      layouts: [
        { slideIntentId: 's1', layoutHtml: '<script>alert(1)</script>' },
        { slideIntentId: 's2', layoutHtml: `<div>${'a'.repeat(20001)}</div>` },
      ],
    });
    const context = createContext({ interactionMode: { layoutConfirm: 'manual' } });

    const result = await runLayoutPhase(loop, {
      slideIntents: {},
      designSystem: {},
      plans: {},
      context,
      runContext: { runId: 'layout' },
      emit: vi.fn(),
    });

    expect(generateLayoutBatch).toHaveBeenCalledWith(slideIntents, plans);
    expect(result.layouts).toEqual(layouts);
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith(
      'layout_generated',
      expect.stringContaining('Generated')
    );
    expect(loop._blackboard.logDecision.mock.calls.some((call) => call[0] === 'layout_edited')).toBe(false);
  });

  it('propagates layout generation errors', async () => {
    generateLayoutBatch.mockImplementation(() => {
      throw new Error('layout boom');
    });
    const loop = createLoop({ state: { slideIntents: [] } });
    const context = createContext({ interactionMode: { layoutConfirm: 'skip' } });

    await expect(
      runLayoutPhase(loop, {
        slideIntents: [],
        designSystem: {},
        plans: [],
        context,
        runContext: {},
        emit: vi.fn(),
      })
    ).rejects.toThrow('layout boom');
  });
});

describe('runGeneratingPhase', () => {
  it('generates slides and stores style lock', async () => {
    const slideIntents = makeSlideIntents(2);
    const contentPackage = { slideIntents };
    const designSystem = {
      theme: 'dark',
      designTokens: { colors: { primary: '#111', accent: '#222', bg: '#fff', text: '#000' } },
    };
    const constraints = { imagePolicy: 'balanced' };
    ImagePlanner.plan.mockReturnValue([
      { slotId: 'img-1', style: 'photo', slideIndex: 0 },
      { slotId: 'img-2', style: 'basic', slideIndex: 1 },
    ]);
    const loop = createLoop();
    loop._callTool.mockResolvedValue({
      ok: true,
      data: {
        generated: [{ slideHtml: '<section>1</section>' }, { slideHtml: '<section>2</section>' }],
      },
    });
    const { startExecution, finishExecution, stepContext } = createExecutionFns();
    const context = createContext({ modelRouter: {}, aiApiService: {} });

    const result = await runGeneratingPhase(loop, {
      slideIntents,
      contentPackage,
      designSystem,
      constraints,
      userConfig: {},
      context,
      runContext: { runId: 'gen', timeoutMs: 5000 },
      emit: vi.fn(),
      startExecution,
      finishExecution,
    });

    expect(result.slideHtmls).toHaveLength(2);
    expect(loop.state.slideHtmls).toHaveLength(2);
    expect(designSystem.styleLock).toEqual(expect.objectContaining({ theme: 'dark', colors: expect.any(Object) }));
    expect(createLinkedSignal).toHaveBeenCalledWith(stepContext.signal, 5000);
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.image.planning.completed')).toBe(true);
    expect(loop._transitionPhase).toHaveBeenCalledTimes(1);
  });

  it('handles QA degradation, deep content, and large timeouts', async () => {
    const slideIntents = makeSlideIntents(1);
    const deepContentPackage = { meta: { level1: { level2: { level3: { value: 'deep' } } } } };
    const designSystem = { theme: 'light', designTokens: { colors: { primary: '#111' } } };
    const constraints = { imageBudget: 0 };
    ImagePlanner.plan.mockReturnValue([{ slotId: 'img-1', style: 'basic', slideIndex: 0 }]);
    const loop = createLoop();
    loop._callTool.mockResolvedValue({ ok: true, data: { generated: [{ slideHtml: '<section>bad</section>' }] } });
    validateSlide
      .mockImplementationOnce(() => ({ pass: false, issues: ['bad'] }))
      .mockImplementationOnce(() => ({ pass: true, issues: [] }));
    const { startExecution, finishExecution, stepContext } = createExecutionFns();
    const context = createContext();

    const result = await runGeneratingPhase(loop, {
      slideIntents,
      contentPackage: deepContentPackage,
      designSystem,
      constraints,
      userConfig: {},
      context,
      runContext: { runId: 'gen', timeoutMs: Number.MAX_SAFE_INTEGER },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      skipReview: true,
    });

    expect(result.degradedCount).toBe(1);
    expect(result.slidesMeta[0].degraded).toBe(true);
    expect(loop._transitionPhase).not.toHaveBeenCalled();
    expect(loop._callTool).toHaveBeenCalledWith(
      'spawn_slide_agent',
      expect.objectContaining({ contentPackage: deepContentPackage }),
      stepContext
    );
    expect(createLinkedSignal).toHaveBeenCalledWith(stepContext.signal, Number.MAX_SAFE_INTEGER);
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.degraded')).toBe(true);
  });

  it('throws when spawn_slide_agent fails', async () => {
    const loop = createLoop();
    loop._callTool.mockResolvedValue({ ok: false, error: 'spawn failed' });
    const { startExecution, finishExecution } = createExecutionFns();
    const context = createContext();

    await expect(
      runGeneratingPhase(loop, {
        slideIntents: makeSlideIntents(1),
        contentPackage: {},
        designSystem: {},
        constraints: {},
        userConfig: {},
        context,
        runContext: { runId: 'gen', timeoutMs: 0 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
      })
    ).rejects.toThrow('spawn failed');
  });
});

describe('runBatchRepairPhase', () => {
  it('skips repair when QA and review are healthy', async () => {
    const loop = createLoop({
      state: {
        slideHtmls: ['<section/>'],
        slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
        designSystem: {},
      },
    });
    const result = await runBatchRepairPhase(loop, {
      context: { signal: {} },
      runContext: { runId: 'repair' },
      emit: vi.fn(),
    });

    expect(result.deckHtmlDsl).toBe('<section/>');
    expect(loop._callTool).not.toHaveBeenCalled();
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.repair.skipped')).toBe(true);
  });

  it('repairs using legacy call signature with large deck input', async () => {
    const largeDeck = 'x'.repeat(50000);
    const state = {
      slideHtmls: ['<section/>'],
      slidesMeta: [{ slideNo: 1, qa: { pass: false, issues: ['bad'] }, degraded: true }],
      designSystem: {},
      contentPackage: { title: 'deck' },
      baseDeckHtmlDsl: largeDeck,
    };
    runAutoReview.mockResolvedValue({ pass: false, score: 50, issues: ['style'], fixes: [], summary: 'needs-fix' });
    const loop = createLoop();
    loop._callTool.mockResolvedValue({
      ok: true,
      data: {
        finalDeck: { deckHtmlDsl: '<fixed/>', slidesMeta: [{ slideNo: 1, qa: { pass: true } }] },
        qualityScore: 80,
        steps: [1],
      },
    });

    const result = await runBatchRepairPhase(loop, state, {
      context: { signal: {} },
      runContext: { runId: 'r' },
      emit: vi.fn(),
    });

    expect(result.deckHtmlDsl).toBe('<fixed/>');
    expect(state.deckHtmlDsl).toBe('<fixed/>');
    expect(state.baseDeckHtmlDsl).toBe('<fixed/>');
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.repair.started')).toBe(true);
  });

  it('returns original deck when batch repair fails', async () => {
    const loop = createLoop({
      state: {
        slideHtmls: ['<section/>'],
        slidesMeta: [{ slideNo: 1, qa: { pass: false, issues: ['bad'] } }],
        designSystem: {},
      },
    });
    runAutoReview.mockResolvedValue({ pass: false, score: 20, issues: ['style'], fixes: [] });
    loop._callTool.mockResolvedValue({ ok: false, error: 'repair failed' });

    const result = await runBatchRepairPhase(loop, {
      context: { signal: {} },
      runContext: { runId: 'r' },
      emit: vi.fn(),
    });

    expect(result.deckHtmlDsl).toBe('<section/>');
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.repair.failed')).toBe(true);
  });
});

describe('runVisualPhase', () => {
  it('fills visuals and emits deck updates', async () => {
    const slideIntents = makeSlideIntents(1);
    const slideHtmls = ['<section>base</section>'];
    const slidesMeta = [{ slideNo: 1, qa: { pass: true } }];
    const imageSlots = [
      { slotId: 'img-1', renderType: 'image' },
      { slotId: 'img-2', renderType: 'svg' },
    ];
    const loop = createLoop({ _buildVisualSlots: vi.fn(() => [{ slotId: 'img-1' }]) });
    loop._callTool.mockResolvedValue({
      ok: true,
      data: {
        deckHtmlDsl: '<deck/>',
        finalImageSlots: imageSlots,
        pendingImages: ['img-1'],
        imageReport: { ok: true },
        visualReport: { ok: true },
      },
    });
    const { startExecution, finishExecution } = createExecutionFns();
    const emitDeckUpdate = vi.fn();
    const context = createContext();

    const result = await runVisualPhase(loop, {
      slideIntents,
      designSystem: {},
      generated: [],
      slideHtmls,
      slidesMeta,
      imageSlots,
      baseDeckHtmlDsl: slideHtmls.join('\n\n'),
      pendingImages: [],
      brainstormResult: null,
      constraints: {},
      userConfig: {},
      context,
      runContext: { runId: 'visual' },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      emitDeckUpdate,
    });

    expect(loop._callTool).toHaveBeenCalledWith(
      'fill_visual',
      expect.objectContaining({ aiImageSlotIds: ['img-1'] }),
      expect.any(Object)
    );
    expect(emitDeckUpdate).toHaveBeenCalledWith('<deck/>', slidesMeta, { source: 'visual_fill' });
    expect(result.deckHtmlDsl).toBe('<deck/>');
    expect(loop.state.deckHtmlDsl).toBe('<deck/>');
  });

  it('supports deferred visuals with empty slots', async () => {
    const loop = createLoop();
    const { startExecution, finishExecution } = createExecutionFns();
    const emitDeckUpdate = vi.fn();
    const context = createContext({ deferredVisuals: true });

    const result = await runVisualPhase(loop, {
      slideIntents: [],
      designSystem: {},
      generated: [],
      slideHtmls: [],
      slidesMeta: [],
      imageSlots: [],
      baseDeckHtmlDsl: '',
      pendingImages: [],
      brainstormResult: null,
      constraints: {},
      userConfig: {},
      context,
      runContext: { runId: 'deferred' },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      emitDeckUpdate,
    });

    expect(loop._callTool).not.toHaveBeenCalled();
    expect(result.imageReport).toEqual({ deferred: true, slotCount: 0 });
    expect(result.pendingImages).toEqual([]);
  });

  it('clamps refine settings and applies refine output', async () => {
    const slideIntents = makeSlideIntents(1);
    const slideHtmls = ['<section>base</section>'];
    const slidesMeta = [{ slideNo: 1, qa: { pass: true } }];
    const imageSlots = [{ slotId: 'img-1', renderType: 'image' }];
    const loop = createLoop({ _buildVisualSlots: vi.fn(() => []) });
    loop._callTool.mockResolvedValue({
      ok: true,
      data: { deckHtmlDsl: '<deck/>', finalImageSlots: imageSlots, pendingImages: [] },
    });
    const { startExecution, finishExecution } = createExecutionFns();
    const emitDeckUpdate = vi.fn();
    const userConfig = { refine: { enabled: true, recommendedSteps: 0, hardLimit: -1 } };
    const context = createContext();

    const result = await runVisualPhase(loop, {
      slideIntents,
      designSystem: {},
      generated: [],
      slideHtmls,
      slidesMeta,
      imageSlots,
      baseDeckHtmlDsl: slideHtmls.join('\n\n'),
      pendingImages: [],
      brainstormResult: null,
      constraints: {},
      userConfig,
      context,
      runContext: { runId: 'refine' },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      emitDeckUpdate,
    });

    const options = runReactRefiner.mock.calls[0][2];
    expect(options.recommendedSteps).toBe(1);
    expect(options.hardLimit).toBe(1);
    expect(result.deckHtmlDsl).toBe('<refined/>');
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.refine.ended')).toBe(true);
  });

  it('throws when fill_visual fails', async () => {
    const loop = createLoop();
    loop._callTool.mockResolvedValue({ ok: false, error: 'fill failed' });
    const { startExecution, finishExecution } = createExecutionFns();
    const context = createContext();

    await expect(
      runVisualPhase(loop, {
        slideIntents: [],
        designSystem: {},
        generated: [],
        slideHtmls: [],
        slidesMeta: [],
        imageSlots: [],
        baseDeckHtmlDsl: '',
        pendingImages: [],
        brainstormResult: null,
        constraints: {},
        userConfig: {},
        context,
        runContext: { runId: 'err' },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        emitDeckUpdate: vi.fn(),
      })
    ).rejects.toThrow('fill failed');
  });
});

describe('runReviewPhase', () => {
  it('runs review and stores result', async () => {
    const loop = createLoop({
      state: { deckHtmlDsl: '<deck/>', slidesMeta: [{ slideNo: 1, qa: { pass: true } }] },
    });
    const context = { signal: {} };

    const result = await runReviewPhase(loop, {
      deckHtmlDsl: '<deck/>',
      slidesMeta: loop.state.slidesMeta,
      designSystem: {},
      context,
      runContext: { runId: 'review' },
      emit: vi.fn(),
    });

    expect(result.reviewResult.pass).toBe(true);
    expect(loop.state.reviewResult).toEqual(result.reviewResult);
    expect(emitStage.mock.calls.some((call) => call[1] === 'design.review.started')).toBe(true);
  });

  it('handles empty inputs and whitespace deck html', async () => {
    const loop = createLoop();
    const deckHtmlDsl = '   ';
    const slidesMeta = [];

    const result = await runReviewPhase(loop, {
      deckHtmlDsl,
      slidesMeta,
      designSystem: {},
      context: undefined,
      runContext: { runId: 0 },
      emit: vi.fn(),
    });

    expect(runAutoReview).toHaveBeenCalledWith({ deckHtmlDsl, slidesMeta }, {}, { signal: undefined });
    expect(result.fixedDeckHtmlDsl).toBe(deckHtmlDsl);
  });

  it('propagates review errors', async () => {
    runAutoReview.mockImplementationOnce(() => {
      throw new Error('review failed');
    });
    const loop = createLoop();

    await expect(
      runReviewPhase(loop, {
        deckHtmlDsl: '',
        slidesMeta: [],
        designSystem: {},
        context: { signal: {} },
        runContext: { runId: 'r' },
        emit: vi.fn(),
      })
    ).rejects.toThrow('review failed');
  });

  it('supports rapid sequential review calls', async () => {
    runAutoReview
      .mockResolvedValueOnce({ pass: false, score: 10, issues: ['a'], fixes: [], summary: 'first' })
      .mockResolvedValueOnce({ pass: true, score: 99, issues: [], fixes: [], summary: 'second' });
    const loop = createLoop({ state: { deckHtmlDsl: '<deck/>', slidesMeta: [] } });
    const context = { signal: {} };

    await runReviewPhase(loop, {
      deckHtmlDsl: '<first/>',
      slidesMeta: [],
      designSystem: {},
      context,
      runContext: { runId: 'r1' },
      emit: vi.fn(),
    });
    await runReviewPhase(loop, {
      deckHtmlDsl: '<second/>',
      slidesMeta: [],
      designSystem: {},
      context,
      runContext: { runId: 'r2' },
      emit: vi.fn(),
    });

    expect(loop.state.reviewResult.score).toBe(99);
    expect(runAutoReview).toHaveBeenCalledTimes(2);
  });
});
