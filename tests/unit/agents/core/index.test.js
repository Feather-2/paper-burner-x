import { describe, it, expect, vi, beforeEach } from 'vitest';

const buildDeepObject = (depth) => {
  let current = { value: 'leaf' };
  for (let i = 0; i < depth; i += 1) {
    current = { nested: current };
  }
  return current;
};

const LONG_STRING = 'x'.repeat(100000);
const LARGE_BUFFER = new Uint8Array(1024 * 1024);

const defaultKernelMethodFactory = () => ({
  usePreset: vi.fn().mockResolvedValue(undefined),
  use: vi.fn().mockResolvedValue(undefined),
  registerService: vi.fn(),
  registerServiceFactory: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
});

class KernelMock {
  constructor(config) {
    this.config = config;
    const methods = KernelMock.methodFactory();
    this.usePreset = methods.usePreset;
    this.use = methods.use;
    this.registerService = methods.registerService;
    this.registerServiceFactory = methods.registerServiceFactory;
    this.start = methods.start;
    KernelMock.instances.push(this);
  }
}
KernelMock.instances = [];
KernelMock.methodFactory = defaultKernelMethodFactory;
KernelMock.create = vi.fn();

const KernelStatusMock = { READY: 'ready' };
const KernelCompatMock = class KernelCompatMock {};
const EventBusMock = class EventBusMock {};
const RunStoreAdapterMock = class RunStoreAdapterMock {};
const createEventRecordMock = vi.fn();
const isValidEventNameMock = vi.fn();
const matchPatternMock = vi.fn();
const LamportClockMock = class LamportClockMock {};
const StateBusMock = class StateBusMock {};
const ServiceBusMock = class ServiceBusMock {};
const createRetryProxyMock = vi.fn();
const createTimeoutProxyMock = vi.fn();
const createCacheProxyMock = vi.fn();
const MessageBusMock = class MessageBusMock {};
const createPluginMock = vi.fn();
const PluginContextMock = class PluginContextMock {};
const PluginManagerMock = class PluginManagerMock {};
const PluginStatusMock = { ACTIVE: 'active' };
const SecurePluginLoaderMock = class SecurePluginLoaderMock {};
const presetsMock = { minimal: { description: 'minimal' } };
const resolvePresetMock = vi.fn();
const mergePresetConfigMock = vi.fn();
const listPresetsMock = vi.fn();
const isServiceProviderMock = vi.fn();
const adaptProviderMock = vi.fn();
const adaptProvidersMock = vi.fn();
const WasmSandboxMock = class WasmSandboxMock {};
const createSandboxMock = vi.fn();
const createSandboxFactoryMock = vi.fn();
const SandboxPoolMock = class SandboxPoolMock {};
const createSandboxPluginMock = vi.fn();
const SkillExecutorMock = class SkillExecutorMock {};
const createSkillExecutorMock = vi.fn();
const SandboxCapabilityMock = { BASIC: 'basic' };
const SandboxPresetMock = { DEFAULT: 'default' };
const ResourceLimitsMock = { DEFAULT: {} };
const LWWRegisterMock = class LWWRegisterMock {};
const GCounterMock = class GCounterMock {};
const PNCounterMock = class PNCounterMock {};
const LWWMapMock = class LWWMapMock {};
const ORSetMock = class ORSetMock {};
const CRDTDocumentMock = class CRDTDocumentMock {};
const CRDTSyncManagerMock = class CRDTSyncManagerMock {};
const createMemoryTransportMock = vi.fn();
const OpTypeMock = { ADD: 'add' };
const createOpMock = vi.fn();
const ArchiveMock = class ArchiveMock {};
const MapAdapterMock = class MapAdapterMock {};
const FallbackAdapterMock = class FallbackAdapterMock {};
const CheckpointTypeMock = { FULL: 'full' };
const createCheckpointMock = vi.fn();
const migrateCheckpointMock = vi.fn();
const validateRpcRequestMock = vi.fn();
const validateRpcResponseMock = vi.fn();
const validateLlmResponseMock = vi.fn();
const validateToolCallMock = vi.fn();
const validateToolResultMock = vi.fn();
const normalizeToolResultMock = vi.fn();
const ContainerMock = class ContainerMock {};
const SINGLETONMock = Symbol('SINGLETON');
const TRANSIENTMock = Symbol('TRANSIENT');
const createContainerMock = vi.fn();
const ServiceIdMock = vi.fn();
const createAgentContainerMock = vi.fn();
const createTestContainerMock = vi.fn();

vi.mock('../../../../js/agents/core/kernel.js', () => ({
  Kernel: KernelMock,
  KernelStatus: KernelStatusMock,
}));

vi.mock('../../../../js/agents/core/kernel-compat.js', () => ({
  KernelCompat: KernelCompatMock,
}));

vi.mock('../../../../js/agents/core/event-bus.js', () => ({
  EventBus: EventBusMock,
  RunStoreAdapter: RunStoreAdapterMock,
  createEventRecord: createEventRecordMock,
  isValidEventName: isValidEventNameMock,
  matchPattern: matchPatternMock,
  LamportClock: LamportClockMock,
}));

vi.mock('../../../../js/agents/core/state-bus.js', () => ({
  StateBus: StateBusMock,
}));

vi.mock('../../../../js/agents/core/service-bus.js', () => ({
  ServiceBus: ServiceBusMock,
  createRetryProxy: createRetryProxyMock,
  createTimeoutProxy: createTimeoutProxyMock,
  createCacheProxy: createCacheProxyMock,
}));

vi.mock('../../../../js/agents/core/message-bus.js', () => ({
  MessageBus: MessageBusMock,
}));

vi.mock('../../../../js/agents/core/plugin.js', () => ({
  createPlugin: createPluginMock,
  PluginContext: PluginContextMock,
  PluginManager: PluginManagerMock,
  PluginStatus: PluginStatusMock,
}));

vi.mock('../../../../js/agents/core/secure-plugin-loader.js', () => ({
  SecurePluginLoader: SecurePluginLoaderMock,
}));

vi.mock('../../../../js/agents/core/presets.js', () => ({
  presets: presetsMock,
  resolvePreset: resolvePresetMock,
  mergePresetConfig: mergePresetConfigMock,
  listPresets: listPresetsMock,
}));

vi.mock('../../../../js/agents/core/compat.js', () => ({
  isServiceProvider: isServiceProviderMock,
  adaptProvider: adaptProviderMock,
  adaptProviders: adaptProvidersMock,
}));

vi.mock('../../../../js/agents/core/sandbox/index.js', () => ({
  WasmSandbox: WasmSandboxMock,
  createSandbox: createSandboxMock,
  createSandboxFactory: createSandboxFactoryMock,
  SandboxPool: SandboxPoolMock,
  createSandboxPlugin: createSandboxPluginMock,
  SkillExecutor: SkillExecutorMock,
  createSkillExecutor: createSkillExecutorMock,
  SandboxCapability: SandboxCapabilityMock,
  SandboxPreset: SandboxPresetMock,
  ResourceLimits: ResourceLimitsMock,
}));

vi.mock('../../../../js/agents/core/crdt/index.js', () => ({
  LWWRegister: LWWRegisterMock,
  GCounter: GCounterMock,
  PNCounter: PNCounterMock,
  LWWMap: LWWMapMock,
  ORSet: ORSetMock,
  CRDTDocument: CRDTDocumentMock,
  CRDTSyncManager: CRDTSyncManagerMock,
  createMemoryTransport: createMemoryTransportMock,
  OpType: OpTypeMock,
  createOp: createOpMock,
}));

vi.mock('../../../../js/agents/core/archive/archive.js', () => ({
  Archive: ArchiveMock,
  MapAdapter: MapAdapterMock,
  FallbackAdapter: FallbackAdapterMock,
}));

vi.mock('../../../../js/agents/core/archive/checkpoint-schema.js', () => ({
  CheckpointType: CheckpointTypeMock,
  createCheckpoint: createCheckpointMock,
  migrateCheckpoint: migrateCheckpointMock,
}));

vi.mock('../../../../js/agents/core/contracts/index.js', () => ({
  validateRpcRequest: validateRpcRequestMock,
  validateRpcResponse: validateRpcResponseMock,
  validateLlmResponse: validateLlmResponseMock,
  validateToolCall: validateToolCallMock,
  validateToolResult: validateToolResultMock,
  normalizeToolResult: normalizeToolResultMock,
}));

vi.mock('../../../../js/agents/core/di/index.js', () => ({
  Container: ContainerMock,
  SINGLETON: SINGLETONMock,
  TRANSIENT: TRANSIENTMock,
  createContainer: createContainerMock,
  ServiceId: ServiceIdMock,
  createAgentContainer: createAgentContainerMock,
  createTestContainer: createTestContainerMock,
}));

let corePromise;
const loadCore = async () => {
  if (!corePromise) {
    corePromise = import('../../../../js/agents/core/index.js');
  }
  return corePromise;
};

beforeEach(() => {
  vi.clearAllMocks();
  KernelMock.instances.length = 0;
  KernelMock.methodFactory = defaultKernelMethodFactory;
  KernelMock.create.mockReset();
  KernelMock.create.mockResolvedValue({ id: 'kernel-instance' });
});

const reExportCases = [
  ['Kernel', KernelMock],
  ['KernelStatus', KernelStatusMock],
  ['KernelCompat', KernelCompatMock],
  ['EventBus', EventBusMock],
  ['RunStoreAdapter', RunStoreAdapterMock],
  ['createEventRecord', createEventRecordMock],
  ['isValidEventName', isValidEventNameMock],
  ['matchPattern', matchPatternMock],
  ['LamportClock', LamportClockMock],
  ['StateBus', StateBusMock],
  ['ServiceBus', ServiceBusMock],
  ['createRetryProxy', createRetryProxyMock],
  ['createTimeoutProxy', createTimeoutProxyMock],
  ['createCacheProxy', createCacheProxyMock],
  ['MessageBus', MessageBusMock],
  ['createPlugin', createPluginMock],
  ['PluginContext', PluginContextMock],
  ['PluginManager', PluginManagerMock],
  ['PluginStatus', PluginStatusMock],
  ['SecurePluginLoader', SecurePluginLoaderMock],
  ['presets', presetsMock],
  ['resolvePreset', resolvePresetMock],
  ['mergePresetConfig', mergePresetConfigMock],
  ['listPresets', listPresetsMock],
  ['isServiceProvider', isServiceProviderMock],
  ['adaptProvider', adaptProviderMock],
  ['adaptProviders', adaptProvidersMock],
  ['WasmSandbox', WasmSandboxMock],
  ['createSandbox', createSandboxMock],
  ['createSandboxFactory', createSandboxFactoryMock],
  ['SandboxPool', SandboxPoolMock],
  ['createSandboxPlugin', createSandboxPluginMock],
  ['SkillExecutor', SkillExecutorMock],
  ['createSkillExecutor', createSkillExecutorMock],
  ['SandboxCapability', SandboxCapabilityMock],
  ['SandboxPreset', SandboxPresetMock],
  ['ResourceLimits', ResourceLimitsMock],
  ['LWWRegister', LWWRegisterMock],
  ['GCounter', GCounterMock],
  ['PNCounter', PNCounterMock],
  ['LWWMap', LWWMapMock],
  ['ORSet', ORSetMock],
  ['CRDTDocument', CRDTDocumentMock],
  ['CRDTSyncManager', CRDTSyncManagerMock],
  ['createMemoryTransport', createMemoryTransportMock],
  ['OpType', OpTypeMock],
  ['createOp', createOpMock],
  ['Archive', ArchiveMock],
  ['MapAdapter', MapAdapterMock],
  ['FallbackAdapter', FallbackAdapterMock],
  ['CheckpointType', CheckpointTypeMock],
  ['createCheckpoint', createCheckpointMock],
  ['migrateCheckpoint', migrateCheckpointMock],
  ['validateRpcRequest', validateRpcRequestMock],
  ['validateRpcResponse', validateRpcResponseMock],
  ['validateLlmResponse', validateLlmResponseMock],
  ['validateToolCall', validateToolCallMock],
  ['validateToolResult', validateToolResultMock],
  ['normalizeToolResult', normalizeToolResultMock],
  ['Container', ContainerMock],
  ['SINGLETON', SINGLETONMock],
  ['TRANSIENT', TRANSIENTMock],
  ['createContainer', createContainerMock],
  ['ServiceId', ServiceIdMock],
  ['createAgentContainer', createAgentContainerMock],
  ['createTestContainer', createTestContainerMock],
];

reExportCases.forEach(([name, expected]) => {
  describe(name, () => {
    it('re-exports the symbol', async () => {
      const core = await loadCore();
      expect(core[name]).toBe(expected);
    });
  });
});

describe('default', () => {
  it('exports Kernel as default', async () => {
    const core = await loadCore();
    expect(core.default).toBe(KernelMock);
  });
});

describe('quickKernel', () => {
  it('calls Kernel.create with the standard preset by default', async () => {
    const core = await loadCore();
    const sentinel = { id: 'quick' };
    KernelMock.create.mockResolvedValueOnce(sentinel);

    const result = await core.quickKernel();

    expect(KernelMock.create).toHaveBeenCalledWith('standard', {});
    expect(result).toBe(sentinel);
  });

  it('forwards boundary presets and configs', async () => {
    const core = await loadCore();
    const deepConfig = buildDeepObject(32);

    const cases = [
      { preset: '', config: {}, expected: {} },
      { preset: '   ', config: { spaced: true }, expected: { spaced: true } },
      { preset: null, config: undefined, expected: {} },
      { preset: 0, config: [], expected: [] },
      { preset: -1, config: { retries: -1 }, expected: { retries: -1 } },
      { preset: Number.MAX_SAFE_INTEGER, config: { max: Number.MAX_SAFE_INTEGER }, expected: { max: Number.MAX_SAFE_INTEGER } },
      { preset: '123', config: { timeout: '1000' }, expected: { timeout: '1000' } },
      { preset: 'standard', config: null, expected: null },
      { preset: LONG_STRING, config: { file: LARGE_BUFFER, nested: deepConfig }, expected: { file: LARGE_BUFFER, nested: deepConfig } },
    ];

    for (const entry of cases) {
      await core.quickKernel(entry.preset, entry.config);
    }

    expect(KernelMock.create).toHaveBeenCalledTimes(cases.length);
    cases.forEach((entry, index) => {
      const expectedConfig = Object.prototype.hasOwnProperty.call(entry, 'expected')
        ? entry.expected
        : entry.config;
      expect(KernelMock.create).toHaveBeenNthCalledWith(
        index + 1,
        entry.preset,
        expectedConfig
      );
    });
  });

  it('propagates Kernel.create errors', async () => {
    const core = await loadCore();
    KernelMock.create.mockRejectedValueOnce(new Error('boom'));

    await expect(core.quickKernel('standard', {})).rejects.toThrow('boom');
  });

  it('supports concurrent calls', async () => {
    const core = await loadCore();
    KernelMock.create.mockImplementation((preset, config) =>
      Promise.resolve({ preset, config })
    );

    await Promise.all([
      core.quickKernel('standard', { seq: 1 }),
      core.quickKernel('standard', { seq: 2 }),
      core.quickKernel('standard', { seq: 3 }),
    ]);

    expect(KernelMock.create).toHaveBeenCalledTimes(3);
    expect(KernelMock.create).toHaveBeenNthCalledWith(1, 'standard', { seq: 1 });
    expect(KernelMock.create).toHaveBeenNthCalledWith(2, 'standard', { seq: 2 });
    expect(KernelMock.create).toHaveBeenNthCalledWith(3, 'standard', { seq: 3 });
  });
});

describe('minimalKernel', () => {
  it('calls Kernel.create with the minimal preset', async () => {
    const core = await loadCore();
    const sentinel = { id: 'minimal' };
    KernelMock.create.mockResolvedValueOnce(sentinel);

    const result = await core.minimalKernel({});

    expect(KernelMock.create).toHaveBeenCalledWith('minimal', {});
    expect(result).toBe(sentinel);
  });

  it('forwards boundary configs', async () => {
    const core = await loadCore();
    const deepConfig = buildDeepObject(8);

    const cases = [
      { input: undefined, expected: {} },
      { input: null, expected: null },
      { input: {}, expected: {} },
      { input: [], expected: [] },
      { input: { nested: deepConfig }, expected: { nested: deepConfig } },
    ];

    for (const entry of cases) {
      await core.minimalKernel(entry.input);
    }

    expect(KernelMock.create).toHaveBeenCalledTimes(cases.length);
    cases.forEach((entry, index) => {
      expect(KernelMock.create).toHaveBeenNthCalledWith(
        index + 1,
        'minimal',
        entry.expected
      );
    });
  });

  it('propagates Kernel.create errors', async () => {
    const core = await loadCore();
    KernelMock.create.mockRejectedValueOnce(new Error('minimal error'));

    await expect(core.minimalKernel({})).rejects.toThrow('minimal error');
  });
});

describe('deepsearchKernel', () => {
  it('calls Kernel.create with the deepsearch preset', async () => {
    const core = await loadCore();
    const sentinel = { id: 'deepsearch' };
    KernelMock.create.mockResolvedValueOnce(sentinel);

    const result = await core.deepsearchKernel({});

    expect(KernelMock.create).toHaveBeenCalledWith('deepsearch', {});
    expect(result).toBe(sentinel);
  });

  it('accepts boundary config values', async () => {
    const core = await loadCore();

    const configs = ['', '   ', 0, -1];
    for (const config of configs) {
      await core.deepsearchKernel(config);
    }

    expect(KernelMock.create).toHaveBeenCalledTimes(configs.length);
    configs.forEach((config, index) => {
      expect(KernelMock.create).toHaveBeenNthCalledWith(
        index + 1,
        'deepsearch',
        config
      );
    });
  });

  it('propagates Kernel.create errors', async () => {
    const core = await loadCore();
    KernelMock.create.mockRejectedValueOnce(new Error('deepsearch error'));

    await expect(core.deepsearchKernel({})).rejects.toThrow('deepsearch error');
  });
});

describe('productionKernel', () => {
  it('calls Kernel.create with the production preset', async () => {
    const core = await loadCore();
    const sentinel = { id: 'production' };
    KernelMock.create.mockResolvedValueOnce(sentinel);

    const result = await core.productionKernel({});

    expect(KernelMock.create).toHaveBeenCalledWith('production', {});
    expect(result).toBe(sentinel);
  });

  it('forwards resource-heavy configs', async () => {
    const core = await loadCore();
    const deepConfig = buildDeepObject(12);
    const config = { file: LARGE_BUFFER, text: LONG_STRING, nested: deepConfig };

    await core.productionKernel(config);

    expect(KernelMock.create).toHaveBeenCalledWith('production', config);
  });

  it('propagates Kernel.create errors', async () => {
    const core = await loadCore();
    KernelMock.create.mockRejectedValueOnce(new Error('production error'));

    await expect(core.productionKernel({})).rejects.toThrow('production error');
  });
});

describe('KernelBuilder', () => {
  it('creates fresh builder instances', async () => {
    const core = await loadCore();

    const first = core.KernelBuilder.create();
    const second = core.KernelBuilder.create();

    expect(first).toBeInstanceOf(core.KernelBuilder);
    expect(second).toBeInstanceOf(core.KernelBuilder);
    expect(first).not.toBe(second);
  });

  it('builds kernels with preset, plugins, services, factories, and merged config', async () => {
    const core = await loadCore();
    const pluginObject = { name: 'plugin-object' };
    const pluginObjectTwo = { name: 'plugin-object-2' };
    const deepConfig = buildDeepObject(10);
    const factory = () => ({ value: 'svc' });

    const builder = core.KernelBuilder.create()
      .withPreset('standard')
      .withPlugin('string-plugin')
      .withPlugin(pluginObject, { threshold: 1 })
      .withPlugins([
        'array-plugin',
        { plugin: pluginObjectTwo, config: { enabled: true } },
      ])
      .withService('svc', { run: 'ok' }, { retries: 0 })
      .withServiceFactory('svcFactory', factory, { scoped: true })
      .withConfig({
        alpha: 1,
        nested: deepConfig,
        file: LARGE_BUFFER,
        text: LONG_STRING,
        timeout: '1000',
      })
      .withConfig({ beta: 2 });

    const kernel = await builder.build();

    expect(KernelMock.instances).toHaveLength(1);
    expect(kernel).toBe(KernelMock.instances[0]);
    expect(kernel.config).toEqual({
      alpha: 1,
      nested: deepConfig,
      file: LARGE_BUFFER,
      text: LONG_STRING,
      timeout: '1000',
      beta: 2,
    });
    expect(KernelMock.create).not.toHaveBeenCalled();

    expect(kernel.usePreset).toHaveBeenCalledWith('standard', {
      plugins: ['string-plugin', 'plugin-object', 'array-plugin', 'plugin-object-2'],
      config: {
        'plugin-object': { threshold: 1 },
        'plugin-object-2': { enabled: true },
      },
    });

    expect(kernel.use).toHaveBeenCalledTimes(2);
    expect(kernel.use).toHaveBeenNthCalledWith(1, pluginObject, { threshold: 1 });
    expect(kernel.use).toHaveBeenNthCalledWith(2, pluginObjectTwo, { enabled: true });

    expect(kernel.registerService).toHaveBeenCalledWith(
      'svc',
      { run: 'ok' },
      { retries: 0 }
    );
    expect(kernel.registerServiceFactory).toHaveBeenCalledWith(
      'svcFactory',
      factory,
      { scoped: true }
    );
    expect(kernel.start).toHaveBeenCalledTimes(1);
  });

  it('handles empty plugin and service collections', async () => {
    const core = await loadCore();

    const kernel = await core.KernelBuilder.create().withPlugins([]).withConfig({}).build();

    expect(kernel.usePreset).toHaveBeenCalledWith('minimal', { plugins: [], config: {} });
    expect(kernel.use).not.toHaveBeenCalled();
    expect(kernel.registerService).not.toHaveBeenCalled();
    expect(kernel.registerServiceFactory).not.toHaveBeenCalled();
    expect(kernel.start).toHaveBeenCalledTimes(1);
  });

  it('throws when plugins is not iterable', async () => {
    const core = await loadCore();
    const builder = core.KernelBuilder.create();

    expect(() => builder.withPlugins({})).toThrow(TypeError);
  });

  it('propagates preset load errors', async () => {
    const core = await loadCore();
    const error = new Error('preset failed');

    KernelMock.methodFactory = () => ({
      usePreset: vi.fn().mockRejectedValue(error),
      use: vi.fn().mockResolvedValue(undefined),
      registerService: vi.fn(),
      registerServiceFactory: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    });

    await expect(core.KernelBuilder.create().build()).rejects.toThrow('preset failed');
  });
});
