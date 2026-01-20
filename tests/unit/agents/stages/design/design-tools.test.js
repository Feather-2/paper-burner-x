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
  it('exposes a frozen tool definition list', () => {
    expect(Array.isArray(DESIGN_AGENT_TOOL_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(DESIGN_AGENT_TOOL_DEFINITIONS)).toBe(true);

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
    expect(new Set(names).size).toBe(names.length);

    for (const def of DESIGN_AGENT_TOOL_DEFINITIONS) {
      expect(def).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        parameters: expect.any(Object),
      });
    }

    expect(() => {
      DESIGN_AGENT_TOOL_DEFINITIONS.push({ name: 'extra' });
    }).toThrow();
  });
});

describe('getToolDefinitions', () => {
  it('returns a shallow copy of definitions', () => {
    const copy = getToolDefinitions();
    expect(copy).toEqual(DESIGN_AGENT_TOOL_DEFINITIONS);
    expect(copy).not.toBe(DESIGN_AGENT_TOOL_DEFINITIONS);

    copy.push({ name: 'extra' });
    expect(DESIGN_AGENT_TOOL_DEFINITIONS).not.toHaveLength(copy.length);
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

  describe('parse_outline', () => {
    it('returns slide intents and content package', async () => {
      const largeText = 'x'.repeat(200000);
      const contentPackage = {
        slideIntents: [{ id: 1 }, { id: 2 }],
        source: largeText,
        meta: makeDeepObject(40),
      };

      const result = await handlers.parse_outline({ contentPackage });

      expect(result.slideIntents).toBe(contentPackage.slideIntents);
      expect(result.contentPackage).toBe(contentPackage);
    });

    it('handles missing or invalid slide intents', async () => {
      const result = await handlers.parse_outline({ contentPackage: { slideIntents: {} } });
      expect(result).toEqual({ slideIntents: [], contentPackage: { slideIntents: {} } });

      const emptyResult = await handlers.parse_outline();
      expect(emptyResult).toEqual({ slideIntents: [], contentPackage: null });
    });

    it('throws when params are null', async () => {
      await expect(handlers.parse_outline(null)).rejects.toThrow(TypeError);
    });
  });

  describe('extract_style', () => {
    it('delegates to _initDesignSystem with provided inputs', async () => {
      const contentPackage = { id: 'pkg' };
      const constraints = { maxSlides: 10 };
      const userConfig = { theme: 'mono', deep: makeDeepObject(30) };

      agentLoop._initDesignSystem.mockResolvedValue({ theme: 'mono' });

      const result = await handlers.extract_style({ contentPackage, constraints, userConfig }, context);

      expect(agentLoop._initDesignSystem).toHaveBeenCalledWith(
        contentPackage,
        context,
        constraints,
        userConfig
      );
      expect(result).toEqual({ designSystem: { theme: 'mono' } });
    });

    it('uses defaults for empty and missing values', async () => {
      agentLoop._initDesignSystem.mockResolvedValue({ theme: 'default' });

      const result = await handlers.extract_style({ constraints: '', userConfig: '' }, context);

      expect(agentLoop._initDesignSystem).toHaveBeenCalledWith(null, context, {}, {});
      expect(result).toEqual({ designSystem: { theme: 'default' } });
    });

    it('propagates initialization errors', async () => {
      agentLoop._initDesignSystem.mockRejectedValue(new Error('init failed'));
      await expect(handlers.extract_style({}, context)).rejects.toThrow('init failed');
    });
  });

  describe('spawn_slide_agent', () => {
    it('calls generateBatch with resolved options', async () => {
      const slideIntents = [{ id: 1 }];
      const contentPackage = { id: 'pkg' };
      const designSystem = { theme: 'bright' };
      const emit = vi.fn();

      mockedBatch.generateBatch.mockResolvedValue(['html']);

      const result = await handlers.spawn_slide_agent(
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

      const [intents, pkg, system, options] = mockedBatch.generateBatch.mock.calls[0];
      expect(intents).toBe(slideIntents);
      expect(pkg).toBe(contentPackage);
      expect(system).toBe(designSystem);
      expect(options).toEqual({
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
      expect(result).toEqual({ generated: ['html'] });
    });

    it('normalizes inputs and applies defaults', async () => {
      mockedBatch.generateBatch.mockResolvedValue(['generated']);

      const result = await handlers.spawn_slide_agent(
        {
          slideIntents: 'oops',
          imageSlots: {},
          selectedIdeas: 'idea',
          batchSize: '3',
          batchConcurrency: 0,
        },
        context
      );

      const [intents, pkg, system, options] = mockedBatch.generateBatch.mock.calls[0];
      expect(intents).toEqual([]);
      expect(pkg).toBeNull();
      expect(system).toBeNull();
      expect(options.batchSize).toBe('3');
      expect(options.batchConcurrency).toBe(agentLoop.batchConcurrency);
      expect(options.imageSlots).toEqual([]);
      expect(options.selectedIdeas).toEqual([]);
      expect(options.aiApiService).toBe(context.aiApiService);
      expect(options.signal).toBe(context.signal);
      expect(result).toEqual({ generated: ['generated'] });
    });

    it('supports concurrent batch generation', async () => {
      mockedBatch.generateBatch.mockImplementation((intents) =>
        Promise.resolve(`generated-${intents.length}`)
      );

      const [first, second] = await Promise.all([
        handlers.spawn_slide_agent({ slideIntents: [{}, {}] }, context),
        handlers.spawn_slide_agent({ slideIntents: [{}] }, context),
      ]);

      expect(first).toEqual({ generated: 'generated-2' });
      expect(second).toEqual({ generated: 'generated-1' });
      expect(mockedBatch.generateBatch).toHaveBeenCalledTimes(2);
    });

    it('propagates batch generation errors', async () => {
      mockedBatch.generateBatch.mockRejectedValue(new Error('batch failed'));
      await expect(handlers.spawn_slide_agent({}, context)).rejects.toThrow('batch failed');
    });
  });

  describe('take_screenshot', () => {
    it('returns an empty screenshot list', async () => {
      const result = await handlers.take_screenshot({ slideIndex: 0 });
      expect(result).toEqual({ screenshots: [] });
    });
  });

  describe('fix_slide', () => {
    it('fills currentHtml and designSystem from state when missing', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>fixed</div>');

      const result = await handlers.fix_slide(
        {
          slideIndex: 0,
          issues: [],
          currentHtml: null,
          designSystem: null,
        },
        context
      );

      expect(mockedBatchRepair.runSingleSlideRepair).toHaveBeenCalledWith(
        {
          slideIndex: 0,
          currentHtml: agentLoop.state.deckHtmlDsl,
          issues: [],
          designSystem: agentLoop.state.designSystem,
        },
        {
          aiApiService: context.aiApiService,
          modelRouter: context.modelRouter,
          signal: context.signal,
        }
      );
      expect(result).toEqual({ fixedHtml: '<div>fixed</div>' });
    });

    it('respects explicit currentHtml and designSystem values', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockResolvedValue('<div>updated</div>');

      const result = await handlers.fix_slide(
        {
          slideIndex: 1,
          issues: [{ id: 'issue' }],
          currentHtml: '',
          designSystem: { theme: 'custom' },
        },
        context
      );

      const [payload] = mockedBatchRepair.runSingleSlideRepair.mock.calls[0];
      expect(payload.currentHtml).toBe('');
      expect(payload.designSystem).toEqual({ theme: 'custom' });
      expect(result).toEqual({ fixedHtml: '<div>updated</div>' });
    });

    it('handles rapid sequential repairs with boundary slide indexes', async () => {
      mockedBatchRepair.runSingleSlideRepair
        .mockResolvedValueOnce('fixed--1')
        .mockResolvedValueOnce(`fixed-${Number.MAX_SAFE_INTEGER}`);

      const first = await handlers.fix_slide(
        { slideIndex: -1, issues: [{ note: 'x' }] },
        context
      );
      const second = await handlers.fix_slide(
        { slideIndex: Number.MAX_SAFE_INTEGER, issues: [{ note: 'y' }] },
        context
      );

      expect(first).toEqual({ fixedHtml: 'fixed--1' });
      expect(second).toEqual({ fixedHtml: `fixed-${Number.MAX_SAFE_INTEGER}` });
      expect(mockedBatchRepair.runSingleSlideRepair).toHaveBeenCalledTimes(2);
    });

    it('passes through type boundaries', async () => {
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

    it('propagates repair errors', async () => {
      mockedBatchRepair.runSingleSlideRepair.mockRejectedValue(new Error('repair failed'));
      await expect(handlers.fix_slide({}, context)).rejects.toThrow('repair failed');
    });
  });

  describe('fill_visual', () => {
    it('uses visualSlots when visualSlotsForRender is missing', async () => {
      const visualSlots = [{ id: 'slot' }];
      const contentPackage = { id: 'pkg' };
      const designSystem = { theme: 'fill' };
      const slideHtmls = ['<div/>'];
      const runContext = { mode: 'fast' };
      const constraints = { maxAssets: 1 };
      const imageSlots = [{ id: 'img' }];
      const aiImageSlotIds = ['ai-1'];

      agentLoop._renderVisuals.mockResolvedValue({ ok: true });

      const result = await handlers.fill_visual(
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
      expect(result).toEqual({ ok: true });
    });

    it('prefers visualSlotsForRender and normalizes arrays', async () => {
      agentLoop._renderVisuals.mockResolvedValue({ ok: true });

      await handlers.fill_visual(
        {
          visualSlotsForRender: [{ id: 'render' }],
          visualSlots: [{ id: 'ignored' }],
          slideHtmls: {},
          imageSlots: 'bad',
          aiImageSlotIds: { bad: true },
        },
        context
      );

      const [slots, , , slideHtmls, , , , imageSlots, aiImageSlotIds] =
        agentLoop._renderVisuals.mock.calls[0];
      expect(slots).toEqual([{ id: 'render' }]);
      expect(slideHtmls).toEqual([]);
      expect(imageSlots).toEqual([]);
      expect(aiImageSlotIds).toEqual([]);
    });

    it('handles null params and concurrent calls', async () => {
      agentLoop._renderVisuals.mockImplementation((slots) =>
        Promise.resolve({ slots: slots.length })
      );

      const [first, second] = await Promise.all([
        handlers.fill_visual(null, context),
        handlers.fill_visual({ visualSlots: [{}, {}] }, context),
      ]);

      expect(first).toEqual({ slots: 0 });
      expect(second).toEqual({ slots: 2 });
      expect(agentLoop._renderVisuals).toHaveBeenCalledTimes(2);
    });

    it('propagates render errors', async () => {
      agentLoop._renderVisuals.mockRejectedValue(new Error('render failed'));
      await expect(handlers.fill_visual({}, context)).rejects.toThrow('render failed');
    });
  });

  describe('chat_ask', () => {
    it('emits progress and waits for user action', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockResolvedValue({ ok: true });

      const message = 'y'.repeat(10000);
      const result = await handlers.chat_ask(
        { message, actionName: 'confirm' },
        context
      );

      expect(mockedRuntime.getEmitFn).toHaveBeenCalledWith(context);
      expect(emit).toHaveBeenCalledWith('design.chat.ask', {
        actor: 'design',
        status: 'progress',
        payload: {
          message,
          actionName: 'confirm',
        },
      });
      expect(agentLoop.waitForUserAction).toHaveBeenCalledWith('confirm', {
        eventBus: context.eventBus,
        signal: context.signal,
      });
      expect(result).toEqual({ actionName: 'confirm', payload: { ok: true } });
    });

    it('returns default action when actionName is falsy', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);

      const result = await handlers.chat_ask({ message: 0, actionName: '' }, context);

      expect(emit).toHaveBeenCalledWith('design.chat.ask', {
        actor: 'design',
        status: 'progress',
        payload: {
          message: '',
          actionName: 'chat_reply',
        },
      });
      expect(agentLoop.waitForUserAction).not.toHaveBeenCalled();
      expect(result).toEqual({ actionName: 'chat_reply' });
    });

    it('accepts whitespace action names', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockResolvedValue({ ok: true });

      const result = await handlers.chat_ask(
        { message: 'ok', actionName: '  ' },
        context
      );

      expect(agentLoop.waitForUserAction).toHaveBeenCalledWith('  ', {
        eventBus: context.eventBus,
        signal: context.signal,
      });
      expect(result).toEqual({ actionName: '  ', payload: { ok: true } });
    });

    it('supports concurrent chat actions', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockImplementation((action) =>
        Promise.resolve({ action })
      );

      const [first, second] = await Promise.all([
        handlers.chat_ask({ message: 'a', actionName: 'one' }, context),
        handlers.chat_ask({ message: 'b', actionName: 'two' }, context),
      ]);

      expect(first).toEqual({ actionName: 'one', payload: { action: 'one' } });
      expect(second).toEqual({ actionName: 'two', payload: { action: 'two' } });
      expect(agentLoop.waitForUserAction).toHaveBeenCalledTimes(2);
    });

    it('propagates wait errors', async () => {
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);
      agentLoop.waitForUserAction.mockRejectedValue(new Error('wait failed'));

      await expect(
        handlers.chat_ask({ message: 'fail', actionName: 'bad' }, context)
      ).rejects.toThrow('wait failed');
    });
  });

  describe('orchestrate_batch_repair', () => {
    it('delegates to runBatchRepair with stageApi', async () => {
      mockedBatchRepair.runBatchRepair.mockResolvedValue({ ok: true });

      const params = { deckPackage: { id: 'deck' }, designSystem: { theme: 'x' } };
      const result = await handlers.orchestrate_batch_repair(params, {
        ...context,
        stageApi: { id: 'override' },
      });

      expect(mockedBatchRepair.runBatchRepair).toHaveBeenCalledWith(params, {
        ...context,
        stageApi: agentLoop,
      });
      expect(result).toEqual({ ok: true });
    });

    it('handles rapid sequential batch repairs', async () => {
      mockedBatchRepair.runBatchRepair
        .mockResolvedValueOnce({ deck: 'a' })
        .mockResolvedValueOnce({ deck: 'b' });

      const first = await handlers.orchestrate_batch_repair(
        { deckPackage: { id: 'a' } },
        context
      );
      const second = await handlers.orchestrate_batch_repair(
        { deckPackage: { id: 'b' } },
        context
      );

      expect(first).toEqual({ deck: 'a' });
      expect(second).toEqual({ deck: 'b' });
      expect(mockedBatchRepair.runBatchRepair).toHaveBeenCalledTimes(2);
    });

    it('propagates batch repair errors', async () => {
      mockedBatchRepair.runBatchRepair.mockRejectedValue(new Error('batch repair failed'));
      await expect(
        handlers.orchestrate_batch_repair({ deckPackage: {} }, context)
      ).rejects.toThrow('batch repair failed');
    });
  });
});
