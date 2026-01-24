import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedBatch = vi.hoisted(() => ({
  generateBatch: vi.fn(),
}));

const mockedRuntime = vi.hoisted(() => ({
  getEmitFn: vi.fn(),
}));

const mockedBatchRepair = vi.hoisted(() => ({
  runSingleSlideRepair: vi.fn(),
  runBatchRepair: vi.fn(),
}));

vi.mock('../../../../../js/agents/stages/design/generators/batch-generator.js', () => ({
  generateBatch: mockedBatch.generateBatch,
}));

vi.mock('../../../../../js/agents/runtime/index.js', () => ({
  getEmitFn: mockedRuntime.getEmitFn,
}));

vi.mock('../../../../../js/agents/stages/design/refiner/batch-repair-agent.js', () => ({
  runSingleSlideRepair: mockedBatchRepair.runSingleSlideRepair,
  runBatchRepair: mockedBatchRepair.runBatchRepair,
}));

let DESIGN_AGENT_TOOL_DEFINITIONS;
let createDesignToolHandlers;
let getToolDefinitions;

function makeDeepObject(depth) {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }
  return root;
}

function makeAgentLoop(overrides = {}) {
  return {
    batchSize: 4,
    batchConcurrency: 2,
    _initDesignSystem: vi.fn(),
    _renderVisuals: vi.fn(),
    waitForUserAction: vi.fn(),
    state: {
      deckHtmlDsl: '<section>base</section>',
      designSystem: { theme: 'default' },
    },
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    aiApiService: { id: 'ai' },
    modelRouter: { id: 'router' },
    eventBus: { emit: vi.fn() },
    signal: { aborted: false },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockedBatch.generateBatch.mockReset();
  mockedRuntime.getEmitFn.mockReset();
  mockedBatchRepair.runSingleSlideRepair.mockReset();
  mockedBatchRepair.runBatchRepair.mockReset();

  vi.resetModules();
  const mod = await import('../../../../../js/agents/stages/design/design-tools.js');
  DESIGN_AGENT_TOOL_DEFINITIONS = mod.DESIGN_AGENT_TOOL_DEFINITIONS;
  createDesignToolHandlers = mod.createDesignToolHandlers;
  getToolDefinitions = mod.getToolDefinitions;
});

describe('DESIGN_AGENT_TOOL_DEFINITIONS', () => {
  it('should_return_true_when_definitions_is_array', () => {
    expect(Array.isArray(DESIGN_AGENT_TOOL_DEFINITIONS)).toBe(true);
  });

  it('should_return_true_when_definitions_is_frozen', () => {
    expect(Object.isFrozen(DESIGN_AGENT_TOOL_DEFINITIONS)).toBe(true);
  });

  it('should_contain_expected_tool_names_when_mapped', () => {
    const names = DESIGN_AGENT_TOOL_DEFINITIONS.map((def) => def.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'parse_outline',
        'extract_style',
        'spawn_slide_agent',
        'take_screenshot',
        'fix_slide',
        'fill_visual',
        'chat_ask',
        'orchestrate_batch_repair',
      ])
    );
  });

  it('should_return_true_when_tool_names_are_unique', () => {
    const names = DESIGN_AGENT_TOOL_DEFINITIONS.map((def) => def.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should_return_true_when_each_definition_has_required_shape', () => {
    const ok = DESIGN_AGENT_TOOL_DEFINITIONS.every(
      (def) =>
        typeof def?.name === 'string' &&
        typeof def?.description === 'string' &&
        def?.parameters != null &&
        typeof def.parameters === 'object'
    );
    expect(ok).toBe(true);
  });

  it('should_throw_when_attempting_to_mutate_frozen_definitions', () => {
    expect(() => {
      DESIGN_AGENT_TOOL_DEFINITIONS.push({ name: 'extra' });
    }).toThrow();
  });
});

describe('getToolDefinitions', () => {
  it('should_return_equal_definitions_when_called', () => {
    const copy = getToolDefinitions();
    expect(copy).toEqual(DESIGN_AGENT_TOOL_DEFINITIONS);
  });

  it('should_return_new_array_reference_when_called', () => {
    const copy = getToolDefinitions();
    expect(copy).not.toBe(DESIGN_AGENT_TOOL_DEFINITIONS);
  });

  it('should_not_change_original_length_when_mutating_returned_copy', () => {
    const originalLength = DESIGN_AGENT_TOOL_DEFINITIONS.length;
    const copy = getToolDefinitions();

    copy.push({ name: 'extra' });

    expect(DESIGN_AGENT_TOOL_DEFINITIONS).toHaveLength(originalLength);
  });
});

describe('createDesignToolHandlers', () => {
  let agentLoop;
  let handlers;
  let context;

  beforeEach(() => {
    agentLoop = makeAgentLoop();
    handlers = createDesignToolHandlers(agentLoop);
    context = makeContext();
  });

  it('should_expose_all_expected_tool_handlers_when_created', () => {
    expect(Object.keys(handlers).sort()).toEqual([
      'chat_ask',
      'extract_style',
      'fill_visual',
      'fix_slide',
      'orchestrate_batch_repair',
      'parse_outline',
      'spawn_slide_agent',
      'take_screenshot',
    ]);
  });

  describe('parse_outline', () => {
    it('should_return_slideIntents_reference_when_slideIntents_is_array', async () => {
      const largeText = 'x'.repeat(200000);
      const contentPackage = {
        slideIntents: [{ id: 1 }, { id: 2 }],
        source: largeText,
        meta: makeDeepObject(40),
      };

      const result = await handlers.parse_outline({ contentPackage });

      expect(result.slideIntents).toBe(contentPackage.slideIntents);
    });

    it('should_return_contentPackage_reference_when_contentPackage_provided', async () => {
      const contentPackage = { slideIntents: [] };

      const result = await handlers.parse_outline({ contentPackage });

      expect(result.contentPackage).toBe(contentPackage);
    });

    it('should_return_empty_slideIntents_when_slideIntents_is_not_array', async () => {
      const result = await handlers.parse_outline({ contentPackage: { slideIntents: {} } });
      expect(result.slideIntents).toEqual([]);
    });

    it('should_return_null_contentPackage_when_missing', async () => {
      const result = await handlers.parse_outline();
      expect(result.contentPackage).toBeNull();
    });

    it('should_return_empty_slideIntents_when_missing', async () => {
      const result = await handlers.parse_outline();
      expect(result.slideIntents).toEqual([]);
    });

    it('should_throw_TypeError_when_params_is_null', async () => {
      await expect(handlers.parse_outline(null)).rejects.toThrow(TypeError);
    });
  });

  describe('extract_style', () => {
    it('should_call_initDesignSystem_with_provided_inputs_when_given', async () => {
      const contentPackage = { id: 'pkg' };
      const constraints = { maxSlides: 10 };
      const userConfig = { theme: 'mono', deep: makeDeepObject(30) };

      agentLoop._initDesignSystem.mockResolvedValue({ theme: 'mono' });

      await handlers.extract_style({ contentPackage, constraints, userConfig }, context);

      expect(agentLoop._initDesignSystem).toHaveBeenCalledWith(
        contentPackage,
        context,
        constraints,
        userConfig
      );
    });

    it('should_return_designSystem_when_initDesignSystem_resolves', async () => {
      agentLoop._initDesignSystem.mockResolvedValue({ theme: 'mono' });

      const result = await handlers.extract_style({ contentPackage: { id: 'pkg' } }, context);

      expect(result).toEqual({ designSystem: { theme: 'mono' } });
    });

    it('should_call_initDesignSystem_with_defaulted_args_when_values_missing', async () => {
      agentLoop._initDesignSystem.mockResolvedValue({ theme: 'default' });

      await handlers.extract_style({ constraints: '', userConfig: '' }, context);

      expect(agentLoop._initDesignSystem).toHaveBeenCalledWith(null, context, {}, {});
    });

    it('should_reject_when_initDesignSystem_rejects', async () => {
      agentLoop._initDesignSystem.mockRejectedValue(new Error('init failed'));
      await expect(handlers.extract_style({}, context)).rejects.toThrow('init failed');
    });
  });

  describe('spawn_slide_agent', () => {
    it('should_call_generateBatch_with_slideIntents_contentPackage_and_designSystem', async () => {
      const slideIntents = [{ id: 1 }];
      const contentPackage = { id: 'pkg' };
      const designSystem = { theme: 'bright' };
      const emit = vi.fn();

      mockedBatch.generateBatch.mockResolvedValue(['html']);

      await handlers.spawn_slide_agent(
        {
          slideIntents,
          contentPackage,
          designSystem,
          batchSize: 1,
          batchConcurrency: 5,
          modelRouter: { id: 'router-x' },
          aiApiService: { id: 'ai-x' },
          imageSlots: [{ id: 'img' }],
          selectedIdeas: ['idea'],
          emit,
          signal: { aborted: true },
          dslRules: { allow: true },
        },
        context
      );

      expect(mockedBatch.generateBatch).toHaveBeenCalledWith(slideIntents, contentPackage, designSystem, {
        batchSize: 1,
        batchConcurrency: 5,
        modelRouter: { id: 'router-x' },
        aiApiService: { id: 'ai-x' },
        imageSlots: [{ id: 'img' }],
        selectedIdeas: ['idea'],
        emit,
        signal: { aborted: true },
        dslRules: { allow: true },
      });
    });

    it('should_return_generated_payload_when_generateBatch_resolves', async () => {
      mockedBatch.generateBatch.mockResolvedValue(['html']);

      const result = await handlers.spawn_slide_agent({ slideIntents: [] }, context);

      expect(result).toEqual({ generated: ['html'] });
    });

    it('should_default_batchSize_and_batchConcurrency_when_values_are_falsy', async () => {
      mockedBatch.generateBatch.mockResolvedValue(['generated']);

      await handlers.spawn_slide_agent({ batchSize: 0, batchConcurrency: 0 }, context);

      expect(mockedBatch.generateBatch).toHaveBeenCalledWith([], null, null, expect.objectContaining({
        batchSize: agentLoop.batchSize,
        batchConcurrency: agentLoop.batchConcurrency,
      }));
    });

    it('should_normalize_non_array_inputs_to_empty_arrays_when_provided', async () => {
      mockedBatch.generateBatch.mockResolvedValue(['generated']);

      await handlers.spawn_slide_agent(
        {
          slideIntents: 'oops',
          imageSlots: {},
          selectedIdeas: 'idea',
          batchSize: '3',
          batchConcurrency: 0,
        },
        context
      );

      expect(mockedBatch.generateBatch).toHaveBeenCalledWith([], null, null, expect.objectContaining({
        batchSize: '3',
        batchConcurrency: agentLoop.batchConcurrency,
        imageSlots: [],
        selectedIdeas: [],
        aiApiService: context.aiApiService,
        signal: context.signal,
      }));
    });

    it('should_use_null_modelRouter_when_not_provided', async () => {
      mockedBatch.generateBatch.mockResolvedValue(['generated']);

      await handlers.spawn_slide_agent({ slideIntents: [] }, context);

      expect(mockedBatch.generateBatch).toHaveBeenCalledWith([], null, null, expect.objectContaining({
        modelRouter: null,
      }));
    });

    it('should_call_generateBatch_for_each_parallel_invocation_when_concurrent', async () => {
      mockedBatch.generateBatch.mockImplementation((intents) =>
        Promise.resolve(`generated-${intents.length}`)
      );

      await Promise.all([
        handlers.spawn_slide_agent({ slideIntents: [{}, {}] }, context),
        handlers.spawn_slide_agent({ slideIntents: [{}] }, context),
      ]);

      expect(mockedBatch.generateBatch).toHaveBeenCalledTimes(2);
    });

    it('should_return_distinct_results_when_concurrent', async () => {
      mockedBatch.generateBatch.mockImplementation((intents) =>
        Promise.resolve(`generated-${intents.length}`)
      );

      const results = await Promise.all([
        handlers.spawn_slide_agent({ slideIntents: [{}, {}] }, context),
        handlers.spawn_slide_agent({ slideIntents: [{}] }, context),
      ]);

      expect(results).toEqual([{ generated: 'generated-2' }, { generated: 'generated-1' }]);
    });

    it('should_reject_when_generateBatch_rejects', async () => {
      mockedBatch.generateBatch.mockRejectedValue(new Error('batch failed'));
      await expect(handlers.spawn_slide_agent({}, context)).rejects.toThrow('batch failed');
    });
  });

  describe('take_screenshot', () => {
    it('should_return_empty_screenshots_array_when_called', async () => {
      const result = await handlers.take_screenshot({ slideIndex: 0 });
      expect(result).toEqual({ screenshots: [] });
    });
  });

  describe('fix_slide', () => {
    it('should_use_state_deckHtmlDsl_when_currentHtml_is_null', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>fixed</div>');

      await handlers.fix_slide(
        {
          slideIndex: 0,
          issues: [],
          currentHtml: null,
          designSystem: { theme: 'custom' },
        },
        context
      );

      expect(mockedBatchRepair.runSingleSlideRepair).toHaveBeenCalledWith(
        {
          slideIndex: 0,
          currentHtml: agentLoop.state.deckHtmlDsl,
          issues: [],
          designSystem: { theme: 'custom' },
        },
        {
          aiApiService: context.aiApiService,
          modelRouter: context.modelRouter,
          signal: context.signal,
        }
      );
    });

    it('should_use_state_designSystem_when_designSystem_is_null', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>updated</div>');

      await handlers.fix_slide(
        {
          slideIndex: 1,
          issues: [{ id: 'issue' }],
          currentHtml: '',
          designSystem: null,
        },
        context
      );

      expect(mockedBatchRepair.runSingleSlideRepair).toHaveBeenCalledWith(
        {
          slideIndex: 1,
          currentHtml: '',
          issues: [{ id: 'issue' }],
          designSystem: agentLoop.state.designSystem,
        },
        expect.any(Object)
      );
    });

    it('should_pass_through_type_boundaries_when_inputs_not_normalized', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>typed</div>');

      await handlers.fix_slide({ slideIndex: '2', issues: { id: 'issue' } }, context);

      expect(mockedBatchRepair.runSingleSlideRepair).toHaveBeenCalledWith(
        {
          slideIndex: '2',
          currentHtml: agentLoop.state.deckHtmlDsl,
          issues: { id: 'issue' },
          designSystem: agentLoop.state.designSystem,
        },
        expect.any(Object)
      );
    });

    it('should_return_fixedHtml_when_runSingleSlideRepair_resolves', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>fixed</div>');

      const result = await handlers.fix_slide({ slideIndex: 0, issues: [] }, context);

      expect(result).toEqual({ fixedHtml: '<div>fixed</div>' });
    });

    it('should_call_runSingleSlideRepair_with_context_services_when_called', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>fixed</div>');

      await handlers.fix_slide({ slideIndex: 0, issues: [] }, context);

      expect(mockedBatchRepair.runSingleSlideRepair).toHaveBeenCalledWith(expect.any(Object), {
        aiApiService: context.aiApiService,
        modelRouter: context.modelRouter,
        signal: context.signal,
      });
    });

    it('should_return_fixedHtml_when_slideIndex_is_negative', async () => {
      mockedBatchRepair.runSingleSlideRepair
        .mockResolvedValueOnce('fixed--1');

      const result = await handlers.fix_slide({ slideIndex: -1, issues: [] }, context);

      expect(result).toEqual({ fixedHtml: 'fixed--1' });
    });

    it('should_return_fixedHtml_when_slideIndex_is_MAX_SAFE_INTEGER', async () => {
      mockedBatchRepair.runSingleSlideRepair
        .mockResolvedValueOnce(`fixed-${Number.MAX_SAFE_INTEGER}`);

      const result = await handlers.fix_slide(
        { slideIndex: Number.MAX_SAFE_INTEGER, issues: [] },
        context
      );

      expect(result).toEqual({ fixedHtml: `fixed-${Number.MAX_SAFE_INTEGER}` });
    });

    it('should_call_runSingleSlideRepair_twice_when_invoked_sequentially', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>fixed</div>');

      await handlers.fix_slide({ slideIndex: 1, issues: [] }, context);
      await handlers.fix_slide({ slideIndex: 2, issues: [] }, context);

      expect(mockedBatchRepair.runSingleSlideRepair).toHaveBeenCalledTimes(2);
    });

    it('should_reject_when_runSingleSlideRepair_rejects', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockRejectedValue(new Error('repair failed'));
      await expect(handlers.fix_slide({}, context)).rejects.toThrow('repair failed');
    });
  });

  describe('fill_visual', () => {
    it('should_use_visualSlots_when_visualSlotsForRender_is_missing', async () => {
      const visualSlots = [{ id: 'slot' }];
      const contentPackage = { id: 'pkg' };
      const designSystem = { theme: 'fill' };
      const slideHtmls = ['<div/>'];
      const runContext = { mode: 'fast' };
      const constraints = { maxAssets: 1 };
      const imageSlots = [{ id: 'img' }];
      const aiImageSlotIds = ['ai-1'];

      agentLoop._renderVisuals.mockResolvedValue({ ok: true });

      await handlers.fill_visual(
        {
          visualSlots,
          contentPackage,
          designSystem,
          slideHtmls,
          runContext,
          constraints,
          imageSlots,
          aiImageSlotIds,
        },
        context
      );

      expect(agentLoop._renderVisuals).toHaveBeenCalledWith(
        visualSlots,
        contentPackage,
        designSystem,
        slideHtmls,
        context,
        runContext,
        constraints,
        imageSlots,
        aiImageSlotIds
      );
    });

    it('should_return_render_result_when_renderVisuals_resolves', async () => {
      agentLoop._renderVisuals.mockResolvedValue({ ok: true });

      const result = await handlers.fill_visual({ visualSlots: [] }, context);

      expect(result).toEqual({ ok: true });
    });

    it('should_prefer_visualSlotsForRender_when_provided', async () => {
      agentLoop._renderVisuals.mockResolvedValue({ ok: true });

      await handlers.fill_visual(
        {
          visualSlotsForRender: [{ id: 'render' }],
          visualSlots: [{ id: 'ignored' }],
        },
        context
      );

      const [slots] = agentLoop._renderVisuals.mock.calls[0];
      expect(slots).toEqual([{ id: 'render' }]);
    });

    it('should_normalize_non_array_inputs_to_empty_arrays_when_provided', async () => {
      agentLoop._renderVisuals.mockResolvedValue({ ok: true });

      await handlers.fill_visual(
        {
          slideHtmls: {},
          imageSlots: 'bad',
          aiImageSlotIds: { bad: true },
        },
        context
      );

      const [, , , slideHtmls, , , , imageSlots, aiImageSlotIds] = agentLoop._renderVisuals.mock.calls[0];
      expect([slideHtmls, imageSlots, aiImageSlotIds]).toEqual([[], [], []]);
    });

    it('should_call_renderVisuals_for_each_parallel_invocation_when_concurrent', async () => {
      agentLoop._renderVisuals.mockImplementation((slots) =>
        Promise.resolve({ slots: slots.length })
      );

      await Promise.all([
        handlers.fill_visual(null, context),
        handlers.fill_visual({ visualSlots: [{}, {}] }, context),
      ]);

      expect(agentLoop._renderVisuals).toHaveBeenCalledTimes(2);
    });

    it('should_return_distinct_results_when_concurrent', async () => {
      agentLoop._renderVisuals.mockImplementation((slots) =>
        Promise.resolve({ slots: slots.length })
      );

      const results = await Promise.all([
        handlers.fill_visual(null, context),
        handlers.fill_visual({ visualSlots: [{}, {}] }, context),
      ]);

      expect(results).toEqual([{ slots: 0 }, { slots: 2 }]);
    });

    it('should_reject_when_renderVisuals_rejects', async () => {
      agentLoop._renderVisuals.mockRejectedValue(new Error('render failed'));
      await expect(handlers.fill_visual({}, context)).rejects.toThrow('render failed');
    });
  });

  describe('chat_ask', () => {
    it('should_emit_progress_event_when_called', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockResolvedValue({ ok: true });

      const message = 'y'.repeat(10000);
      await handlers.chat_ask(
        { message, actionName: 'confirm' },
        context
      );

      expect(emit).toHaveBeenCalledWith('design.chat.ask', {
        actor: 'design',
        status: 'progress',
        payload: {
          message,
          actionName: 'confirm',
        },
      });
    });

    it('should_call_waitForUserAction_when_actionName_is_truthy', async () => {
      mockedRuntime.getEmitFn.mockReturnValue(vi.fn());
      agentLoop.waitForUserAction.mockResolvedValue({ ok: true });

      await handlers.chat_ask({ message: 'ok', actionName: 'confirm' }, context);

      expect(agentLoop.waitForUserAction).toHaveBeenCalledWith('confirm', {
        eventBus: context.eventBus,
        signal: context.signal,
      });
    });

    it('should_return_payload_when_waitForUserAction_resolves', async () => {
      mockedRuntime.getEmitFn.mockReturnValue(vi.fn());
      agentLoop.waitForUserAction.mockResolvedValue({ ok: true });

      const result = await handlers.chat_ask({ message: 'ok', actionName: 'confirm' }, context);

      expect(result).toEqual({ actionName: 'confirm', payload: { ok: true } });
    });

    it('should_return_default_actionName_when_actionName_is_falsy', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);

      const result = await handlers.chat_ask({ message: 0, actionName: '' }, context);

      expect(result).toEqual({ actionName: 'chat_reply' });
    });

    it('should_not_call_waitForUserAction_when_actionName_is_falsy', async () => {
      mockedRuntime.getEmitFn.mockReturnValue(vi.fn());

      await handlers.chat_ask({ message: 'ok', actionName: '' }, context);

      expect(agentLoop.waitForUserAction).not.toHaveBeenCalled();
    });

    it('should_emit_default_payload_actionName_when_actionName_is_falsy', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);

      await handlers.chat_ask({ message: 0, actionName: '' }, context);

      expect(emit).toHaveBeenCalledWith('design.chat.ask', expect.objectContaining({
        payload: {
          message: '',
          actionName: 'chat_reply',
        },
      }));
    });

    it('should_call_waitForUserAction_when_actionName_is_whitespace', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockResolvedValue({ ok: true });

      await handlers.chat_ask(
        { message: 'ok', actionName: '  ' },
        context
      );

      expect(agentLoop.waitForUserAction).toHaveBeenCalledWith('  ', {
        eventBus: context.eventBus,
        signal: context.signal,
      });
    });

    it('should_not_throw_when_emitFn_is_missing', async () => {
      mockedRuntime.getEmitFn.mockReturnValue(undefined);

      const result = await handlers.chat_ask({ message: 'ok', actionName: '' }, context);

      expect(result).toEqual({ actionName: 'chat_reply' });
    });

    it('should_call_waitForUserAction_for_each_parallel_invocation_when_concurrent', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockImplementation((action) =>
        Promise.resolve({ action })
      );

      await Promise.all([
        handlers.chat_ask({ message: 'a', actionName: 'one' }, context),
        handlers.chat_ask({ message: 'b', actionName: 'two' }, context),
      ]);

      expect(agentLoop.waitForUserAction).toHaveBeenCalledTimes(2);
    });

    it('should_return_distinct_results_when_concurrent', async () => {
      mockedRuntime.getEmitFn.mockReturnValue(vi.fn());
      agentLoop.waitForUserAction.mockImplementation((action) =>
        Promise.resolve({ action })
      );

      const results = await Promise.all([
        handlers.chat_ask({ message: 'a', actionName: 'one' }, context),
        handlers.chat_ask({ message: 'b', actionName: 'two' }, context),
      ]);

      expect(results).toEqual([
        { actionName: 'one', payload: { action: 'one' } },
        { actionName: 'two', payload: { action: 'two' } },
      ]);
    });

    it('should_reject_when_waitForUserAction_rejects', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockRejectedValue(new Error('wait failed'));

      await expect(
        handlers.chat_ask({ message: 'fail', actionName: 'bad' }, context)
      ).rejects.toThrow('wait failed');
    });
  });

  describe('orchestrate_batch_repair', () => {
    it('should_pass_agentLoop_as_stageApi_when_context_contains_stageApi', async () => {
      mockedBatchRepair.runBatchRepair.mockResolvedValue({ ok: true });

      const params = { deckPackage: { id: 'deck' }, designSystem: { theme: 'x' } };
      await handlers.orchestrate_batch_repair(params, {
        ...context,
        stageApi: { id: 'override' },
      });

      expect(mockedBatchRepair.runBatchRepair).toHaveBeenCalledWith(params, expect.objectContaining({
        stageApi: agentLoop,
      }));
    });

    it('should_return_runBatchRepair_result_when_resolved', async () => {
      mockedBatchRepair.runBatchRepair.mockResolvedValue({ ok: true });

      const params = { deckPackage: { id: 'deck' }, designSystem: { theme: 'x' } };
      const result = await handlers.orchestrate_batch_repair(params, context);

      expect(result).toEqual({ ok: true });
    });

    it('should_call_runBatchRepair_for_each_sequential_invocation_when_repeated', async () => {
      mockedBatchRepair.runBatchRepair
        .mockResolvedValueOnce({ deck: 'a' })
        .mockResolvedValueOnce({ deck: 'b' });

      await handlers.orchestrate_batch_repair(
        { deckPackage: { id: 'a' } },
        context
      );
      await handlers.orchestrate_batch_repair(
        { deckPackage: { id: 'b' } },
        context
      );

      expect(mockedBatchRepair.runBatchRepair).toHaveBeenCalledTimes(2);
    });

    it('should_reject_when_runBatchRepair_rejects', async () => {
      mockedBatchRepair.runBatchRepair.mockRejectedValue(new Error('batch repair failed'));
      await expect(
        handlers.orchestrate_batch_repair({ deckPackage: {} }, context)
      ).rejects.toThrow('batch repair failed');
    });
  });
});