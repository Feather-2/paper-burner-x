import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockLogger = { debug: vi.fn(), warn: vi.fn() };
  const mockTokenTracker = { record: vi.fn() };
  const createStageApiMock = vi.fn((config) => ({ ...config }));
  const createLoggerMock = vi.fn(() => mockLogger);
  const createFsAdapterFromVfsMock = vi.fn();
  const createVfsGlobFnMock = vi.fn();
  const isPlainObjectMock = vi.fn(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  );
  const toNonNegativeIntMock = vi.fn((value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  });
  const getGlobalTokenTrackerMock = vi.fn(() => mockTokenTracker);
  const withRetryMock = vi.fn(async (fn) => fn());
  const getErrorBoundaryMock = vi.fn(() => ({ wrap: vi.fn((fn) => fn()) }));
  const ToolQuotaManagerMock = vi.fn().mockImplementation(function (opts) {
    this.opts = opts;
    this.tryCall = vi.fn(async (_tool, fn) => fn());
  });
  const CircuitBreakerRegistryMock = vi.fn().mockImplementation(function () {
    this.get = vi.fn(() => null);
  });

  class TraceContextMock {
    constructor(opts = {}) {
      this.opts = opts;
    }
    startSpan() {
      return {};
    }
    endSpan() {}
    withSpan(_name, fn) {
      return fn();
    }
    getTraceparent() {
      return 'traceparent';
    }
  }
  TraceContextMock.parseTraceparent = vi.fn(() => null);

  const MessageBusMock = vi.fn().mockImplementation(function (eventBus) {
    this.eventBus = eventBus;
    this.request = vi.fn(async () => undefined);
    this.handle = vi.fn();
  });

  return {
    mockLogger,
    mockTokenTracker,
    createStageApiMock,
    createLoggerMock,
    createFsAdapterFromVfsMock,
    createVfsGlobFnMock,
    isPlainObjectMock,
    toNonNegativeIntMock,
    getGlobalTokenTrackerMock,
    withRetryMock,
    getErrorBoundaryMock,
    ToolQuotaManagerMock,
    CircuitBreakerRegistryMock,
    TraceContextMock,
    MessageBusMock,
  };
});

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  createStageApi: mocks.createStageApiMock,
  createLogger: mocks.createLoggerMock,
  isPlainObject: mocks.isPlainObjectMock,
  toNonNegativeInt: mocks.toNonNegativeIntMock,
  CircuitBreakerRegistry: mocks.CircuitBreakerRegistryMock,
}));

vi.mock('../../../../../../js/agents/vfs/fs-adapter.js', () => ({
  createFsAdapterFromVfs: mocks.createFsAdapterFromVfsMock,
}));

vi.mock('../../../../../../js/agents/vfs/glob.js', () => ({
  createVfsGlobFn: mocks.createVfsGlobFnMock,
}));

vi.mock('../../../../../../js/agents/plugins/telemetry/index.js', () => ({
  getGlobalTokenTracker: mocks.getGlobalTokenTrackerMock,
  TraceContext: mocks.TraceContextMock,
}));

vi.mock('../../../../../../js/agents/runtime/core/retry-strategy.js', () => ({
  withRetry: mocks.withRetryMock,
}));

vi.mock('../../../../../../js/agents/runtime/core/error-boundary.js', () => ({
  getErrorBoundary: mocks.getErrorBoundaryMock,
}));

vi.mock('../../../../../../js/agents/runtime/tools/tool-quotas.js', () => ({
  ToolQuotaManager: mocks.ToolQuotaManagerMock,
}));

vi.mock('../../../../../../js/agents/core/message-bus.js', () => ({
  MessageBus: mocks.MessageBusMock,
}));

import StageApiFactoryDefault, {
  StageApiFactory,
  createStageApiFactory,
} from '../../../../../../js/agents/runtime/core/api/stage-api-factory.js';

const {
  mockLogger,
  mockTokenTracker,
  createStageApiMock,
  createFsAdapterFromVfsMock,
  createVfsGlobFnMock,
  isPlainObjectMock,
  toNonNegativeIntMock,
  getGlobalTokenTrackerMock,
  withRetryMock,
  getErrorBoundaryMock,
  ToolQuotaManagerMock,
  CircuitBreakerRegistryMock,
  TraceContextMock,
  MessageBusMock,
} = mocks;

const buildDeepObject = (depth) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = { index: i };
    node = node.next;
  }
  return root;
};

beforeEach(() => {
  vi.clearAllMocks();
  createStageApiMock.mockImplementation((config) => ({ ...config }));
  createFsAdapterFromVfsMock.mockImplementation(() => null);
  createVfsGlobFnMock.mockImplementation(() => null);
  isPlainObjectMock.mockImplementation(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  );
  toNonNegativeIntMock.mockImplementation((value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  });
  getGlobalTokenTrackerMock.mockImplementation(() => mockTokenTracker);
  withRetryMock.mockImplementation(async (fn) => fn());
  getErrorBoundaryMock.mockImplementation(() => ({ wrap: vi.fn((fn) => fn()) }));
  ToolQuotaManagerMock.mockImplementation(function (opts) {
    this.opts = opts;
    this.tryCall = vi.fn(async (_tool, fn) => fn());
  });
  CircuitBreakerRegistryMock.mockImplementation(function () {
    this.get = vi.fn(() => null);
  });
  TraceContextMock.parseTraceparent.mockImplementation(() => null);
  MessageBusMock.mockImplementation(function (eventBus) {
    this.eventBus = eventBus;
    this.request = vi.fn(async () => undefined);
    this.handle = vi.fn();
  });
});

describe('StageApiFactory', () => {
  it('resolves services from container and uses eventBus emit', () => {
    const traceContext = {
      startSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: vi.fn(),
      getTraceparent: vi.fn(),
    };
    const retryStrategy = { execute: vi.fn(async (fn) => fn()) };
    const errorBoundary = { wrap: vi.fn((fn) => fn()) };
    const toolQuotaManager = { tryCall: vi.fn(async (_tool, fn) => fn()) };
    const messageBus = { request: vi.fn(), handle: vi.fn() };
    const container = {
      tryGet: vi.fn((key) => ({
        traceContext,
        retryStrategy,
        errorBoundary,
        toolQuotaManager,
        messageBus,
      })[key]),
    };
    const eventBus = { emit: vi.fn() };

    const factory = new StageApiFactory({ eventBus, container });

    expect(factory.services.traceContext).toBe(traceContext);
    expect(factory.services.retryStrategy).toBe(retryStrategy);
    expect(factory.services.errorBoundary).toBe(errorBoundary);
    expect(factory.services.toolQuotaManager).toBe(toolQuotaManager);
    expect(factory.services.messageBus).toBe(messageBus);
    expect(factory.baseConfig.emit).toBe(eventBus.emit);
    expect(factory.baseConfig.signal).toBeNull();
    expect(ToolQuotaManagerMock).not.toHaveBeenCalled();
    expect(CircuitBreakerRegistryMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to default toolQuotaManager and errorBoundary', () => {
    const eventBus = { emit: vi.fn() };
    const factory = new StageApiFactory({ eventBus });

    expect(getErrorBoundaryMock).toHaveBeenCalledTimes(1);
    expect(ToolQuotaManagerMock).toHaveBeenCalledTimes(1);
    const opts = ToolQuotaManagerMock.mock.calls[0][0];
    expect(opts.defaultMaxCalls).toBe(100);
    expect(opts.defaultWindowMs).toBe(60_000);
    expect(opts.quotas.search.maxCalls).toBe(10);
    expect(MessageBusMock).toHaveBeenCalledWith(eventBus);
    expect(factory.services.messageBus).toBe(MessageBusMock.mock.instances[0]);
  });

  it('logs and continues when container.get throws', () => {
    const container = {
      get: vi.fn(() => {
        throw new Error('boom');
      }),
    };

    const factory = new StageApiFactory({ container });

    expect(mockLogger.debug).toHaveBeenCalled();
    expect(factory.services.traceContext).toBeInstanceOf(TraceContextMock);
  });

  it('handles MessageBus construction failure', () => {
    MessageBusMock.mockImplementationOnce(function () {
      throw new Error('bus-failure');
    });
    const eventBus = { emit: vi.fn() };

    const factory = new StageApiFactory({ eventBus });

    expect(factory.services.messageBus).toBeNull();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('resolveMessageBus'),
      expect.any(Error)
    );
  });

  it('uses parsed traceparent when available', () => {
    TraceContextMock.parseTraceparent.mockReturnValueOnce({
      traceId: 'trace-id',
      spanId: 'span-id',
    });

    const factory = new StageApiFactory({ traceparent: '  traceparent  ' });

    expect(TraceContextMock.parseTraceparent).toHaveBeenCalledWith('traceparent');
    expect(factory.services.traceContext.opts).toEqual({
      traceId: 'trace-id',
      parentSpanId: 'span-id',
    });
  });

  it('ignores empty or whitespace traceparent', () => {
    const factoryEmpty = new StageApiFactory({ traceparent: '' });
    const factoryWhitespace = new StageApiFactory({ traceparent: '   ' });

    expect(TraceContextMock.parseTraceparent).not.toHaveBeenCalled();
    expect(factoryEmpty.services.traceContext).toBeInstanceOf(TraceContextMock);
    expect(factoryWhitespace.services.traceContext).toBeInstanceOf(TraceContextMock);
  });

  it('merges overrides, filters undefined/null, and configures backpressure', () => {
    const eventBus = { emit: vi.fn(), enableBackpressure: vi.fn() };
    const baseSignal = new AbortController().signal;
    const factory = new StageApiFactory({
      signal: baseSignal,
      eventBus,
      eventBusBackpressure: { maxQueueSize: 5 },
    });
    const overrides = {
      emit: undefined,
      nullValue: null,
      emptyString: '',
      whitespace: '   ',
      zero: 0,
      emptyObj: {},
      emptyArray: [],
      custom: 'value',
    };

    factory.createBaseApi(overrides);

    const call = createStageApiMock.mock.calls[0][0];
    expect(call.signal).toBe(baseSignal);
    expect(call.emit).toBe(eventBus.emit);
    expect(call.custom).toBe('value');
    expect(call.emptyString).toBe('');
    expect(call.whitespace).toBe('   ');
    expect(call.zero).toBe(0);
    expect(call.emptyObj).toBe(overrides.emptyObj);
    expect(call.emptyArray).toBe(overrides.emptyArray);
    expect('nullValue' in call).toBe(false);
    expect(eventBus.enableBackpressure).toHaveBeenCalledWith(
      expect.objectContaining({
        maxQueueSize: 5,
        deferNonCoalesced: false,
        coalescePattern: expect.any(RegExp),
      })
    );
    expect(isPlainObjectMock).toHaveBeenCalledWith({ maxQueueSize: 5 });
  });

  it('handles null and empty-array overrides', () => {
    const eventBus = { emit: vi.fn() };
    const factory = new StageApiFactory({ eventBus });

    factory.createBaseApi(null);
    factory.createBaseApi([]);

    expect(createStageApiMock).toHaveBeenCalledTimes(2);
  });

  it('skips backpressure when disabled', () => {
    const eventBus = { emit: vi.fn(), enableBackpressure: vi.fn() };
    const factory = new StageApiFactory({ eventBus, eventBusBackpressure: false });

    factory.createBaseApi();

    expect(eventBus.enableBackpressure).not.toHaveBeenCalled();
  });

  it('does not override pre-configured backpressure', () => {
    const eventBus = { emit: vi.fn(), enableBackpressure: vi.fn(), _backpressure: { enabled: true } };
    const factory = new StageApiFactory({ eventBus, eventBusBackpressure: { maxQueueSize: 1 } });

    factory.createBaseApi();

    expect(eventBus.enableBackpressure).not.toHaveBeenCalled();
  });

  it('derives fs and globFn from vfs when missing', () => {
    const vfs = { id: 1 };
    const fsAdapter = { readFile: vi.fn() };
    const globFn = vi.fn();
    createFsAdapterFromVfsMock.mockReturnValueOnce(fsAdapter);
    createVfsGlobFnMock.mockReturnValueOnce(globFn);

    const factory = new StageApiFactory({ vfs, eventBus: { emit: vi.fn() } });
    const api = factory.createBaseApi();

    expect(createFsAdapterFromVfsMock).toHaveBeenCalledWith(vfs);
    expect(createVfsGlobFnMock).toHaveBeenCalledWith(vfs);
    expect(api.fs).toBe(fsAdapter);
    expect(api.globFn).toBe(globFn);
  });

  it('does not override existing fs or globFn', () => {
    createStageApiMock.mockImplementationOnce((config) => ({
      ...config,
      vfs: { id: 1 },
      fs: 'existing',
      globFn: 'existingGlob',
    }));
    const factory = new StageApiFactory({ vfs: { id: 1 }, eventBus: { emit: vi.fn() } });
    const api = factory.createBaseApi();

    expect(createFsAdapterFromVfsMock).not.toHaveBeenCalled();
    expect(createVfsGlobFnMock).not.toHaveBeenCalled();
    expect(api.fs).toBe('existing');
    expect(api.globFn).toBe('existingGlob');
  });

  it('wraps aiApiService with token tracking and circuit breaker, supports concurrency', async () => {
    const breakerExecute = vi.fn(async (fn) => fn());
    const breakerRegistry = { get: vi.fn(() => ({ execute: breakerExecute })) };
    const resp1 = {
      model: 'm1',
      provider: 'p1',
      usage: { promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: '7' },
    };
    const resp2 = { usage: { prompt_tokens: -1, completion_tokens: 0 } };
    const resp3 = { usage: { input: { value: 1 }, output: [] } };
    const originalChat = vi
      .fn()
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2)
      .mockResolvedValueOnce(resp3);
    const aiApiService = { chat: originalChat };
    const factory = new StageApiFactory({
      aiApiService,
      circuitBreakerRegistry: breakerRegistry,
      eventBus: { emit: vi.fn() },
    });
    const api = factory.createBaseApi();

    const [r1, r2] = await Promise.all([
      api.aiApiService.chat({ usage: 'u1', model: 'm1' }),
      api.aiApiService.chat({ usage: 'u2', model: 'm2' }),
    ]);
    const r3 = await api.aiApiService.chat({ usage: 'u3', model: 'm3' });

    expect(r1).toBe(resp1);
    expect(r2).toBe(resp2);
    expect(r3).toBe(resp3);
    expect(aiApiService.circuitBreakerRegistry).toBe(breakerRegistry);
    expect(breakerRegistry.get).toHaveBeenCalledWith(
      'aiApiService:chat:u1:m1',
      expect.any(Object)
    );
    expect(breakerRegistry.get).toHaveBeenCalledWith(
      'aiApiService:chat:u2:m2',
      expect.any(Object)
    );
    expect(breakerExecute).toHaveBeenCalledTimes(3);
    expect(withRetryMock).toHaveBeenCalledTimes(3);
    expect(mockTokenTracker.record).toHaveBeenCalledTimes(3);

    const tokenArgs = toNonNegativeIntMock.mock.calls.map((call) => call[0]);
    expect(tokenArgs).toContain(Number.MAX_SAFE_INTEGER);
    expect(tokenArgs).toContain('7');
    expect(tokenArgs).toContain(-1);
    expect(tokenArgs).toContain(0);
    expect(tokenArgs.some((arg) => Array.isArray(arg))).toBe(true);
    expect(tokenArgs.some((arg) => arg && typeof arg === 'object' && !Array.isArray(arg))).toBe(
      true
    );
  });

  it('records token tracking failure and rethrows', async () => {
    const error = new Error('boom');
    const aiApiService = { chat: vi.fn().mockRejectedValue(error) };
    const factory = new StageApiFactory({ aiApiService, eventBus: { emit: vi.fn() } });
    const api = factory.createBaseApi();

    await expect(api.aiApiService.chat({ usage: 'fail', model: 'm1' })).rejects.toThrow('boom');

    expect(mockTokenTracker.record).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'boom' })
    );
  });

  it('uses retryStrategy for aiApiService and mcp clients', async () => {
    const retryStrategy = { execute: vi.fn(async (fn) => fn()) };
    const aiApiService = { chat: vi.fn().mockResolvedValue({ usage: {} }) };
    const mcpClient = { callTool: vi.fn().mockResolvedValue('ok') };
    const externalSearchProvider = { callTool: vi.fn().mockResolvedValue('ok2') };
    const factory = new StageApiFactory({
      aiApiService,
      mcpClient,
      externalSearchProvider,
      retryStrategy,
      eventBus: { emit: vi.fn() },
    });
    const api = factory.createBaseApi();
    const signal = new AbortController().signal;

    await api.aiApiService.chat({ signal });
    await api.mcpClient.callTool('tool', {}, { signal });
    await api.externalSearchProvider.callTool('search', {}, { signal });

    expect(retryStrategy.execute).toHaveBeenCalledTimes(3);
    expect(retryStrategy.execute).toHaveBeenCalledWith(expect.any(Function), { signal });
    expect(withRetryMock).not.toHaveBeenCalled();
  });

  it('falls back to withRetry for mcpClient without retryStrategy', async () => {
    const mcpClient = { callTool: vi.fn().mockResolvedValue('ok') };
    const factory = new StageApiFactory({ mcpClient, eventBus: { emit: vi.fn() } });
    const api = factory.createBaseApi();

    await api.mcpClient.callTool('tool', { a: 1 }, {});

    expect(withRetryMock).toHaveBeenCalled();
  });

  it('handles rapid consecutive createBaseApi calls with large inputs', () => {
    const eventBus = { emit: vi.fn() };
    const factory = new StageApiFactory({ eventBus });
    const hugeString = 'a'.repeat(200000);
    const deepObject = buildDeepObject(50);

    factory.createBaseApi({ archive: hugeString, policy: deepObject });
    factory.createBaseApi({ archive: hugeString + 'b', policy: deepObject });

    expect(createStageApiMock).toHaveBeenCalledTimes(2);
    const firstCall = createStageApiMock.mock.calls[0][0];
    expect(firstCall.archive).toBe(hugeString);
    expect(firstCall.policy).toBe(deepObject);
  });

  it('createDeepSearchApi warns when required fields are missing', () => {
    const eventBus = { emit: vi.fn() };
    const factory = new StageApiFactory({ eventBus });

    factory.createDeepSearchApi();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('DeepSearch API missing fields')
    );
  });

  it('createDeepSearchApi merges services and overrides', () => {
    const eventBus = { emit: vi.fn() };
    const aiApiService = { chat: vi.fn().mockResolvedValue({ usage: {} }) };
    const factory = new StageApiFactory({
      signal: new AbortController().signal,
      eventBus,
      aiApiService,
      localRetriever: 'local',
      externalSearchProvider: 'external',
      storageAdapter: 'storage',
      ocr: 'ocr',
    });

    factory.createDeepSearchApi({ localRetriever: 'override', ocr: 'override-ocr' });

    const call = createStageApiMock.mock.calls[0][0];
    expect(call.localRetriever).toBe('override');
    expect(call.externalSearchProvider).toBe('external');
    expect(call.storageAdapter).toBe('storage');
    expect(call.ocr).toBe('override-ocr');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('createDesignApi merges services and overrides', () => {
    const eventBus = { emit: vi.fn() };
    const aiApiService = { chat: vi.fn().mockResolvedValue({ usage: {} }) };
    const factory = new StageApiFactory({
      signal: new AbortController().signal,
      eventBus,
      aiApiService,
      imageProvider: 'images',
      svgGenerator: 'svg',
      modelRouter: 'router',
    });

    factory.createDesignApi({ imageProvider: 'override-image' });

    const call = createStageApiMock.mock.calls[0][0];
    expect(call.imageProvider).toBe('override-image');
    expect(call.svgGenerator).toBe('svg');
    expect(call.modelRouter).toBe('router');
  });

  it('createTextPrepApi delegates to createBaseApi', () => {
    const factory = new StageApiFactory({ eventBus: { emit: vi.fn() } });
    const spy = vi.spyOn(factory, 'createBaseApi');
    const overrides = { custom: 'x' };

    factory.createTextPrepApi(overrides);

    expect(spy).toHaveBeenCalledWith(overrides);
  });

  it('validate returns false and warns when fields are missing', () => {
    const factory = new StageApiFactory({ eventBus: { emit: vi.fn() } });

    const ok = factory.validate({ signal: null, emit: undefined }, ['signal', 'emit'], 'Test');

    expect(ok).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Test API missing fields')
    );
  });

  it('validate returns true for zero and empty-string values', () => {
    const factory = new StageApiFactory({ eventBus: { emit: vi.fn() } });

    const ok = factory.validate({ signal: 0, emit: '' }, ['signal', 'emit'], 'Test');

    expect(ok).toBe(true);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('validate throws when requiredFields is not an array', () => {
    const factory = new StageApiFactory({ eventBus: { emit: vi.fn() } });

    expect(() => factory.validate({ signal: 1 }, { not: 'array' }, 'Test')).toThrow(TypeError);
  });

  it('fromWorkflowContext maps fields and imageService fallback', () => {
    const ctx = {
      signal: 'signal',
      eventBus: { emit: vi.fn() },
      traceContext: { startSpan: vi.fn(), endSpan: vi.fn(), withSpan: vi.fn(), getTraceparent: vi.fn() },
      traceparent: 'traceparent',
      container: { tryGet: vi.fn() },
      aiApiService: 'ai',
      modelRouter: 'router',
      localRetriever: 'local',
      externalSearchProvider: 'external',
      mcpClient: 'mcp',
      mcpResources: 'resources',
      circuitBreakerRegistry: { get: vi.fn() },
      storageAdapter: 'storage',
      ocr: 'ocr',
      imageService: 'image-service',
      svgGenerator: 'svg',
      archive: 'archive',
      logger: 'logger',
      vfs: 'vfs',
      policy: 'policy',
    };

    const factory = StageApiFactory.fromWorkflowContext(ctx);

    expect(factory.baseConfig.signal).toBe('signal');
    expect(factory.baseConfig.emit).toBe(ctx.eventBus.emit);
    expect(factory.services.aiApiService).toBe('ai');
    expect(factory.services.imageProvider).toBe('image-service');
    expect(factory.services.externalSearchProvider).toBe('external');
    expect(factory.services.policy).toBe('policy');
  });
});

describe('createStageApiFactory', () => {
  it('creates a StageApiFactory instance', () => {
    const factory = createStageApiFactory({ eventBus: { emit: vi.fn() } });

    expect(factory).toBeInstanceOf(StageApiFactory);
  });
});

describe('default export', () => {
  it('exports StageApiFactory as default', () => {
    expect(StageApiFactoryDefault).toBe(StageApiFactory);
  });
});
