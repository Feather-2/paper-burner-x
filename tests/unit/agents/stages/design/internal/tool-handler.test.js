import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedRuntime = vi.hoisted(() => ({
  resolveToolExecutor: vi.fn(),
}));

const mockedDesignTools = vi.hoisted(() => ({
  DESIGN_AGENT_TOOL_DEFINITIONS: [],
  createDesignToolHandlers: vi.fn(),
}));

const mockedStates = vi.hoisted(() => ({
  DesignPhase: {
    IDLE: 'idle',
    OUTLINE_PARSING: 'outline_parsing',
    OUTLINE_CONFIRMING: 'outline_confirming',
    STYLE_EXTRACTING: 'style_extracting',
    STYLE_CONFIRMING: 'style_confirming',
    DECK_PLANNING: 'deck_planning',
    PLAN_CONFIRMING: 'plan_confirming',
    LAYOUT_ANALYZING: 'layout_analyzing',
    LAYOUT_GENERATING: 'layout_generating',
    LAYOUT_DEVELOPING: 'layout_developing',
    LAYOUT_CONFIRMING: 'layout_confirming',
    GENERATING: 'generating',
    GENERATING_PAUSED: 'generating_paused',
    REVIEWING: 'reviewing',
    FIXING: 'fixing',
    REPAIR: 'repair',
    VISUAL_FILLING: 'visual_filling',
    COMPLETED: 'completed',
    EDITING: 'editing',
    FAILED: 'failed',
  },
}));

const { DesignPhase } = mockedStates;

vi.mock('../../../../../../js/agents/runtime/index.js', () => ({
  resolveToolExecutor: mockedRuntime.resolveToolExecutor,
}));

vi.mock('../../../../../../js/agents/stages/design/design-tools.js', () => ({
  DESIGN_AGENT_TOOL_DEFINITIONS: mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS,
  createDesignToolHandlers: mockedDesignTools.createDesignToolHandlers,
}));

vi.mock('../../../../../../js/agents/stages/design/states.js', () => ({
  DesignPhase: mockedStates.DesignPhase,
}));

async function loadToolHandler() {
  return await import('../../../../../../js/agents/stages/design/internal/tool-handler.js');
}

function makeDesignTools() {
  return {
    parse_outline: vi.fn(),
    extract_style: vi.fn(),
    spawn_slide_agent: vi.fn(),
    take_screenshot: vi.fn(),
    fix_slide: vi.fn(),
    fill_visual: vi.fn(),
    chat_ask: vi.fn(),
  };
}

function makeDeepObject(depth) {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }
  return root;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  mockedRuntime.resolveToolExecutor.mockReset();
  mockedDesignTools.createDesignToolHandlers.mockReset();

  mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS.length = 0;
  mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS.push(
    { name: 'parse_outline' },
    { name: 'extract_style' },
    { name: 'spawn_slide_agent' },
  );
});

describe('initDesignTooling', () => {
  it('registers tools and sets shortcuts', async () => {
    const { initDesignTooling } = await loadToolHandler();
    const designTools = makeDesignTools();
    mockedDesignTools.createDesignToolHandlers.mockReturnValue(designTools);

    const loop = { registerTools: vi.fn() };
    const extraTools = { extra: vi.fn() };

    const result = initDesignTooling(loop, extraTools);

    expect(mockedDesignTools.createDesignToolHandlers).toHaveBeenCalledWith(loop);
    expect(loop.registerTools).toHaveBeenNthCalledWith(1, designTools);
    expect(loop.registerTools).toHaveBeenNthCalledWith(2, extraTools);
    expect(loop._designTools).toBe(designTools);
    expect(loop._toolParseOutline).toBe(designTools.parse_outline);
    expect(loop._toolExtractStyle).toBe(designTools.extract_style);
    expect(loop._toolSpawnSlideAgent).toBe(designTools.spawn_slide_agent);
    expect(loop._toolTakeScreenshot).toBe(designTools.take_screenshot);
    expect(loop._toolFixSlide).toBe(designTools.fix_slide);
    expect(loop._toolFillVisual).toBe(designTools.fill_visual);
    expect(loop._toolChatAsk).toBe(designTools.chat_ask);
    expect(result).toBe(designTools);
  });

  it('skips optional tools when values are falsy', async () => {
    const { initDesignTooling } = await loadToolHandler();
    const designTools = makeDesignTools();
    mockedDesignTools.createDesignToolHandlers.mockReturnValue(designTools);

    const falsyValues = [null, undefined, '', 0];
    for (const tools of falsyValues) {
      const loop = { registerTools: vi.fn() };
      initDesignTooling(loop, tools);
      expect(loop.registerTools).toHaveBeenCalledTimes(1);
      expect(loop.registerTools).toHaveBeenCalledWith(designTools);
    }
  });

  it('registers empty array/object tools', async () => {
    const { initDesignTooling } = await loadToolHandler();
    const designTools = makeDesignTools();
    mockedDesignTools.createDesignToolHandlers.mockReturnValue(designTools);

    const toolValues = [[], {}];
    for (const tools of toolValues) {
      const loop = { registerTools: vi.fn() };
      initDesignTooling(loop, tools);
      expect(loop.registerTools).toHaveBeenCalledTimes(2);
      expect(loop.registerTools).toHaveBeenNthCalledWith(1, designTools);
      expect(loop.registerTools).toHaveBeenNthCalledWith(2, tools);
    }
  });

  it('throws when loop.registerTools is missing', async () => {
    const { initDesignTooling } = await loadToolHandler();
    const designTools = makeDesignTools();
    mockedDesignTools.createDesignToolHandlers.mockReturnValue(designTools);

    expect(() => initDesignTooling({})).toThrow();
  });
});

describe('getDesignToolDefinitions', () => {
  it('returns a shallow copy of tool definitions', async () => {
    const { getDesignToolDefinitions } = await loadToolHandler();
    const definitions = getDesignToolDefinitions();
    const expectedLength = mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS.length;

    expect(definitions).toEqual(mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS);
    expect(definitions).not.toBe(mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS);
    definitions.push({ name: 'extra' });
    expect(mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS).toHaveLength(expectedLength);
  });

  it('returns an empty array when definitions are empty', async () => {
    mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS.length = 0;
    const { getDesignToolDefinitions } = await loadToolHandler();
    expect(getDesignToolDefinitions()).toEqual([]);
  });
});

describe('installToolHandler', () => {
  it('adds getToolDefinitions to prototype and returns fresh copies', async () => {
    const { installToolHandler } = await loadToolHandler();

    class ToolHandler {
      constructor() {
        this.state = {};
      }
    }

    installToolHandler(ToolHandler);
    const handler = new ToolHandler();

    const first = handler.getToolDefinitions();
    const second = handler.getToolDefinitions();

    expect(first).toEqual(mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS);
    expect(second).toEqual(mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS);
    expect(first).not.toBe(second);
    expect(first).not.toBe(mockedDesignTools.DESIGN_AGENT_TOOL_DEFINITIONS);
  });

  it('throws for invalid constructors', async () => {
    const { installToolHandler } = await loadToolHandler();
    expect(() => installToolHandler(null)).toThrow();
  });
});

describe('createResumeToolExecutor', () => {
  it('returns cached outline results when phase allows and slideIntents array present', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    const baseExecutor = vi.fn();
    mockedRuntime.resolveToolExecutor.mockReturnValue(baseExecutor);

    const deep = makeDeepObject(30);
    const largeText = 'x'.repeat(10000);
    const largeSlideIntents = Array.from({ length: 1000 }, (_, index) => ({ index }));
    const parsedContentPackage = { slideIntents: ['ignored'], raw: largeText, deep };
    const resumeState = {
      phase: DesignPhase.STYLE_EXTRACTING,
      slideIntents: largeSlideIntents,
      parsedContentPackage,
      contentPackage: { slideIntents: ['fallback'] },
    };

    const executor = createResumeToolExecutor({
      stageApi: { name: 'stage' },
      resumeState,
      contentPackage: { slideIntents: ['ignored2'] },
    });

    const result = await executor('parse_outline');

    expect(result.contentPackage).toBe(parsedContentPackage);
    expect(result.slideIntents).toBe(largeSlideIntents);
    expect(result.contentPackage.raw.length).toBe(largeText.length);
    expect(result.contentPackage.deep).toBe(deep);
    expect(mockedRuntime.resolveToolExecutor).toHaveBeenCalledWith({ name: 'stage' });
    expect(baseExecutor).not.toHaveBeenCalled();
  });

  it('uses contentPackage slideIntents when resumeState has none', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    mockedRuntime.resolveToolExecutor.mockReturnValue(vi.fn());

    const contentPackage = { slideIntents: [] };
    const resumeState = { phase: DesignPhase.STYLE_EXTRACTING, slideIntents: null };
    const executor = createResumeToolExecutor({ resumeState, contentPackage });

    const result = await executor('parse_outline');

    expect(result.contentPackage).toBe(contentPackage);
    expect(result.slideIntents).toEqual([]);
  });

  it('falls back to base executor when slideIntents is a non-array object', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    const baseExecutor = vi.fn().mockResolvedValue({ ok: true });
    mockedRuntime.resolveToolExecutor.mockReturnValue(baseExecutor);

    const resumeState = {
      phase: DesignPhase.STYLE_EXTRACTING,
      slideIntents: { length: 1, 0: 'x' },
      parsedContentPackage: { slideIntents: ['ignored'] },
    };

    const executor = createResumeToolExecutor({ resumeState, stageApi: {} });
    const result = await executor('parse_outline', { data: 'x' }, {});

    expect(baseExecutor).toHaveBeenCalledWith('parse_outline', { data: 'x' }, {});
    expect(result).toEqual({ ok: true });
  });

  it('returns designSystem when phase allows and designSystem provided', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    const baseExecutor = vi.fn();
    mockedRuntime.resolveToolExecutor.mockReturnValue(baseExecutor);

    const resumeState = { phase: DesignPhase.STYLE_CONFIRMING, designSystem: {} };
    const executor = createResumeToolExecutor({ resumeState, stageApi: {} });

    const result = await executor('extract_style');

    expect(result).toEqual({ designSystem: {} });
    expect(baseExecutor).not.toHaveBeenCalled();
  });

  it('returns generated when resumeState has cached generated', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    const baseExecutor = vi.fn();
    mockedRuntime.resolveToolExecutor.mockReturnValue(baseExecutor);

    const generated = [{ slideHtml: '<x>' }];
    const resumeState = { phase: DesignPhase.VISUAL_FILLING, generated };
    const executor = createResumeToolExecutor({ resumeState, stageApi: {} });

    const result = await executor('spawn_slide_agent');

    expect(result).toEqual({ generated });
    expect(baseExecutor).not.toHaveBeenCalled();
  });

  it('derives generated from slideHtmls and slidesMeta with default sources', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    mockedRuntime.resolveToolExecutor.mockReturnValue(undefined);

    const resumeState = {
      phase: DesignPhase.VISUAL_FILLING,
      slideHtmls: ['<a>', '<b>'],
      slidesMeta: [{ source: 'meta' }],
    };
    const executor = createResumeToolExecutor({ resumeState, stageApi: {} });

    const result = await executor('spawn_slide_agent');

    expect(result.generated).toEqual([
      { slideHtml: '<a>', source: 'meta' },
      { slideHtml: '<b>', source: 'resume' },
    ]);
  });

  it('falls back to base executor with boundary values when cached tools are unavailable', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    const baseExecutor = vi.fn().mockResolvedValue({ ok: true });
    mockedRuntime.resolveToolExecutor.mockReturnValue(baseExecutor);

    const params = {
      limit: Number.MAX_SAFE_INTEGER,
      offset: -1,
      count: '0',
      file: null,
    };
    const context = {
      note: '   ',
      value: 0,
      meta: undefined,
    };

    const executor = createResumeToolExecutor({
      stageApi: undefined,
      resumeState: null,
      contentPackage: null,
    });

    const result = await executor('', params, context);

    expect(baseExecutor).toHaveBeenCalledWith('', params, context);
    expect(result).toEqual({ ok: true });
  });

  it('falls back to agentLoop tools when base executor is not a function', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    mockedRuntime.resolveToolExecutor.mockReturnValue(null);

    const tool = vi.fn().mockResolvedValue({ ok: true });
    const agentLoop = { _tools: { custom: tool } };
    const executor = createResumeToolExecutor({
      agentLoop,
      stageApi: {},
      resumeState: { phase: DesignPhase.IDLE },
    });

    const params = { size: 0 };
    const context = { requestId: 'req-1' };
    const result = await executor('custom', params, context);

    expect(tool).toHaveBeenCalledWith(params, context);
    expect(result).toEqual({ ok: true });
  });

  it('returns an error object for unknown tools', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    mockedRuntime.resolveToolExecutor.mockReturnValue(undefined);

    const executor = createResumeToolExecutor({
      agentLoop: {},
      stageApi: {},
      resumeState: { phase: DesignPhase.IDLE },
    });

    const result = await executor(0);

    expect(result).toEqual({ ok: false, error: 'Unknown tool: 0' });
  });

  it('supports concurrent and rapid consecutive calls', async () => {
    const { createResumeToolExecutor } = await loadToolHandler();
    mockedRuntime.resolveToolExecutor.mockReturnValue(undefined);

    const resumeState = {
      phase: DesignPhase.VISUAL_FILLING,
      slideIntents: ['s1'],
      parsedContentPackage: { slideIntents: ['s1'], id: 'pkg' },
      designSystem: { theme: 't' },
      generated: [{ slideHtml: '<x>' }],
    };

    const executor = createResumeToolExecutor({ resumeState, stageApi: {} });

    const [outline, style, generated] = await Promise.all([
      executor('parse_outline'),
      executor('extract_style'),
      executor('spawn_slide_agent'),
    ]);

    expect(outline.slideIntents).toEqual(['s1']);
    expect(style.designSystem).toEqual({ theme: 't' });
    expect(generated.generated).toEqual([{ slideHtml: '<x>' }]);

    const sequential = [];
    for (let i = 0; i < 3; i += 1) {
      sequential.push(await executor('parse_outline'));
    }

    expect(sequential).toHaveLength(3);
    expect(sequential.every((entry) => entry.slideIntents[0] === 's1')).toBe(true);
  });
});
