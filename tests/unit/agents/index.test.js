import { describe, it, expect, vi, beforeEach } from 'vitest';

const { moduleInitCount, throwOnImport } = vi.hoisted(() => ({
  moduleInitCount: {
    core: 0,
    runtime: 0,
    compression: 0,
    telemetry: 0,
    deepsearch: 0,
    sdk: 0,
    shared: 0,
    vfs: 0,
    storage: 0,
  },
  throwOnImport: {
    core: false,
    runtime: false,
    compression: false,
    telemetry: false,
    deepsearch: false,
    sdk: false,
    shared: false,
    vfs: false,
    storage: false,
  },
}));

const WHITESPACE_STRING = ' \t\n ';
const LONG_STRING = 'c'.repeat(100_000);
const BIG_BUFFER = new Uint8Array(2 * 1024 * 1024);
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const ARRAY_LIKE_OBJECT = Object.freeze({ 0: 'x', length: 0 });

function makeDeepChain(depth) {
  const root = { level: 0 };
  let cur = root;
  for (let i = 1; i < depth; i++) {
    cur.next = { level: i };
    cur = cur.next;
  }
  return root;
}

const PRESETS_DEEP_OBJECT = makeDeepChain(64);

const BOUNDARY_CASES = [
  ['null', null],
  ['undefined', undefined],
  ['empty string', ''],
  ['whitespace string', WHITESPACE_STRING],
  ['empty array', EMPTY_ARRAY],
  ['empty object', EMPTY_OBJECT],
  ['zero', 0],
  ['-1', -1],
  ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
  ['numeric string', '123'],
  ['array-like object', ARRAY_LIKE_OBJECT],
  ['long string', LONG_STRING],
  ['deep object', PRESETS_DEEP_OBJECT],
  ['big buffer', BIG_BUFFER],
];

const BOUNDARY_VALUES = BOUNDARY_CASES.map(([, value]) => value);

function makeFn(exportName) {
  return vi.fn((...args) => {
    if (args[0] === '__throw__') {
      throw new Error(`${exportName}:boom`);
    }
    if (args[0] === '__reject__') {
      return Promise.reject(new Error(`${exportName}:reject`));
    }
    return { name: exportName, args };
  });
}

function makeClass(exportName) {
  return class {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error(`${exportName}:boom`);
      }
      this.__name = exportName;
      this.__args = args;
    }
  };
}

const coreExports = {
  // Kernel
  Kernel: makeClass('Kernel'),
  KernelStatus: Object.freeze({
    tag: 'KernelStatus',
    nil: null,
    undef: undefined,
    emptyStr: '',
    whitespace: WHITESPACE_STRING,
    emptyArr: EMPTY_ARRAY,
    emptyObj: EMPTY_OBJECT,
    zero: 0,
    negOne: -1,
    max: Number.MAX_SAFE_INTEGER,
    numericString: '123',
    arrayLike: ARRAY_LIKE_OBJECT,
  }),
  KernelBuilder: makeClass('KernelBuilder'),

  // Buses
  EventBus: makeClass('EventBus'),
  StateBus: makeClass('StateBus'),
  ServiceBus: makeClass('ServiceBus'),
  MessageBus: makeClass('MessageBus'),

  // Plugins
  createPlugin: makeFn('createPlugin'),
  PluginContext: makeClass('PluginContext'),
  PluginManager: makeClass('PluginManager'),
  PluginStatus: WHITESPACE_STRING,

  // Presets
  presets: PRESETS_DEEP_OBJECT,
  resolvePreset: makeFn('resolvePreset'),
  mergePresetConfig: makeFn('mergePresetConfig'),
  listPresets: makeFn('listPresets'),

  // Proxies
  createRetryProxy: makeFn('createRetryProxy'),
  createTimeoutProxy: makeFn('createTimeoutProxy'),
  createCacheProxy: makeFn('createCacheProxy'),

  // Quick kernels
  quickKernel: makeFn('quickKernel'),
  minimalKernel: makeFn('minimalKernel'),
  deepsearchKernel: makeFn('deepsearchKernel'),
  productionKernel: makeFn('productionKernel'),

  // Compat
  isServiceProvider: makeFn('isServiceProvider'),
  adaptProvider: makeFn('adaptProvider'),
  adaptProviders: makeFn('adaptProviders'),
};

const runtimeExports = {
  // Agent loop
  BaseAgentLoop: makeClass('BaseAgentLoop'),
  AgentStatus: -1,
  StepStatus: 0,

  // Orchestrator
  AgentOrchestrator: makeClass('AgentOrchestrator'),
  SchedulingMode: Number.MAX_SAFE_INTEGER,
  TaskGraph: makeClass('TaskGraph'),

  // Events
  EventBus: makeClass('RuntimeEventBus'),
  RuntimeEvents: EMPTY_ARRAY,
  WatchdogEvents: EMPTY_OBJECT,
  CicadaEvents: LONG_STRING,

  // Compression
  Watchdog: makeClass('Watchdog'),
  CicadaCompressor: makeClass('CicadaCompressor'),
  CompressionCoordinator: makeClass('CompressionCoordinator'),

  // Telemetry
  TokenTracker: makeClass('TokenTracker'),
  TraceContext: makeClass('TraceContext'),

  // Tools
  ToolRegistry: makeClass('ToolRegistry'),
  ToolExecutor: makeClass('ToolExecutor'),
  createToolExecutor: makeFn('createToolExecutor'),

  // DI
  Container: makeClass('Container'),
  createContainer: makeFn('createContainer'),
  ServiceId: null,

  // Hooks / Safety
  HookRegistry: makeClass('HookRegistry'),
  HookType: undefined,
  enhanceEventBusWithHooks: makeFn('enhanceEventBusWithHooks'),
  createPreToolUseHook: makeFn('createPreToolUseHook'),
  classifyCommand: makeFn('classifyCommand'),
  parseCompoundCommand: makeFn('parseCompoundCommand'),
};

const compressionExports = {
  Watchdog: runtimeExports.Watchdog,
  CicadaCompressor: runtimeExports.CicadaCompressor,
  CompressionCoordinator: runtimeExports.CompressionCoordinator,
  ProactiveCompressor: makeClass('ProactiveCompressor'),
  CompressionQualityMonitor: makeClass('CompressionQualityMonitor'),
};

const telemetryExports = {
  TokenTracker: runtimeExports.TokenTracker,
  TraceContext: runtimeExports.TraceContext,
  SpanKind: Object.freeze({ INTERNAL: 'internal' }),
  SpanStatus: Object.freeze({ OK: 'ok' }),
};

const deepsearchExports = {
  DeepSearchAgentLoop: makeClass('DeepSearchAgentLoop'),
  DeepSearchState: '',
  runDeepSearchAgent: makeFn('runDeepSearchAgent'),
  runDeepSearchStage: makeFn('runDeepSearchStage'),
  DesignAgentLoop: makeClass('DesignAgentLoop'),
  runDesignStage: makeFn('runDesignStage'),
  CodeSearchStage: makeClass('CodeSearchStage'),
  TextPrepStage: makeClass('TextPrepStage'),
  runTextPrepStage: makeFn('runTextPrepStage'),
};

const sdkExports = {
  AgentBuilder: makeClass('AgentBuilder'),
  createAgent: makeFn('createAgent'),
  createAgentBuilder: makeFn('createAgentBuilder'),
};

const sharedExports = {
  Archive: makeClass('Archive'),
  createBudgetManager: makeFn('createBudgetManager'),
  robustParseJson: makeFn('robustParseJson'),
  createLogger: makeFn('createLogger'),
  safeExec: makeFn('safeExec'),
  CircuitBreaker: makeClass('CircuitBreaker'),
  getCircuitBreaker: makeFn('getCircuitBreaker'),
};

const storageExports = {
  RunStore: makeClass('RunStore'),
  RunStoreConstants: { VERSION: 1 },
  saveTask: makeFn('saveTask'),
  saveState: makeFn('saveState'),
  createRun: makeFn('createRun'),
  updateRunContext: makeFn('updateRunContext'),
  deleteRun: makeFn('deleteRun'),
  appendEvent: makeFn('appendEvent'),
  appendEvents: makeFn('appendEvents'),
  saveArtifact: makeFn('saveArtifact'),
  updateManifest: makeFn('updateManifest'),
  loadTask: makeFn('loadTask'),
  loadState: makeFn('loadState'),
  listRunRecords: makeFn('listRunRecords'),
  listRuns: makeFn('listRuns'),
  getRun: makeFn('getRun'),
  getEvents: makeFn('getEvents'),
  getArtifact: makeFn('getArtifact'),
  getArtifactRecord: makeFn('getArtifactRecord'),
  getArtifactById: makeFn('getArtifactById'),
  loadArtifact: makeFn('loadArtifact'),
  listArtifacts: makeFn('listArtifacts'),
  listArtifactSummaries: makeFn('listArtifactSummaries'),
  getLatestArtifactSummary: makeFn('getLatestArtifactSummary'),
  getManifest: makeFn('getManifest'),
  estimateQuota: makeFn('estimateQuota'),
  cleanupRuns: makeFn('cleanupRuns'),
  setRetentionPolicy: makeFn('setRetentionPolicy'),
  exportRunAsZip: makeFn('exportRunAsZip'),
  importRunFromZip: makeFn('importRunFromZip'),
  canonicalArtifactType: makeFn('canonicalArtifactType'),
  isSupportedArtifactType: makeFn('isSupportedArtifactType'),
  generateArtifactId: makeFn('generateArtifactId'),
};

// Mock VFS to prevent environment-specific side effects during barrel import
const vfsExports = {
  createVfs: makeFn('createVfs'),
  MemoryVfs: makeClass('MemoryVfs'),
  OpfsVfs: makeClass('OpfsVfs'),
  NodeVfs: makeClass('NodeVfs'),
  FsVfs: makeClass('FsVfs'),
  createMemoryVfs: makeFn('createMemoryVfs'),
  createOpfsVfs: makeFn('createOpfsVfs'),
  createNodeVfs: makeFn('createNodeVfs'),
};

function registerDependencyMocks() {
  // `vi.resetModules()` does not clear mock-module cache (mock:*), so we re-register
  // our manual mocks per-test to force Vitest to invalidate cached mocked exports.
  vi.doMock('../../../js/agents/core/index.js', () => {
    moduleInitCount.core += 1;
    if (throwOnImport.core) throw new Error('core import failed');
    return coreExports;
  });

  vi.doMock('../../../js/agents/runtime/index.js', () => {
    moduleInitCount.runtime += 1;
    if (throwOnImport.runtime) throw new Error('runtime import failed');
    return runtimeExports;
  });

  vi.doMock('../../../js/agents/plugins/compression/index.js', () => {
    moduleInitCount.compression += 1;
    if (throwOnImport.compression) throw new Error('compression import failed');
    return compressionExports;
  });

  vi.doMock('../../../js/agents/plugins/telemetry/index.js', () => {
    moduleInitCount.telemetry += 1;
    if (throwOnImport.telemetry) throw new Error('telemetry import failed');
    return telemetryExports;
  });

  vi.doMock('../../../js/agents/stages/index.js', () => {
    moduleInitCount.deepsearch += 1;
    if (throwOnImport.deepsearch) throw new Error('deepsearch import failed');
    return deepsearchExports;
  });

  vi.doMock('../../../js/agents/sdk/AgentBuilder.js', () => {
    moduleInitCount.sdk += 1;
    if (throwOnImport.sdk) throw new Error('sdk import failed');
    return sdkExports;
  });

  vi.doMock('../../../js/agents/shared/index.js', () => {
    moduleInitCount.shared += 1;
    if (throwOnImport.shared) throw new Error('shared import failed');
    return sharedExports;
  });

  vi.doMock('../../../js/agents/vfs/index.js', () => {
    moduleInitCount.vfs += 1;
    if (throwOnImport.vfs) throw new Error('vfs import failed');
    return vfsExports;
  });

  vi.doMock('../../../js/agents/storage/index.js', () => {
    moduleInitCount.storage += 1;
    if (throwOnImport.storage) throw new Error('storage import failed');
    return storageExports;
  });
}

const hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

const AGENTS_INDEX_MODULE_PATH = '../../../js/agents/index.js';
let agentsIndexImportCounter = 0;

function freshAgentsIndexSpecifier(tag = 't') {
  agentsIndexImportCounter += 1;
  return `${AGENTS_INDEX_MODULE_PATH}?${tag}=${agentsIndexImportCounter}`;
}

async function importAgentsIndex() {
  return import(AGENTS_INDEX_MODULE_PATH);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  for (const key of Object.keys(throwOnImport)) throwOnImport[key] = false;
  for (const key of Object.keys(moduleInitCount)) moduleInitCount[key] = 0;

  registerDependencyMocks();
});

function describeFunctionExport(exportName, expectedFn) {
  describe(exportName, () => {
    it('re-exports the symbol from its source module', async () => {
      const agents = await importAgentsIndex();
      expect(hasOwn(agents, exportName)).toBe(true);
      expect(agents[exportName]).toBe(expectedFn);
    });

    it('handles boundary inputs', async () => {
      const agents = await importAgentsIndex();
      const startingCalls = expectedFn.mock.calls.length;
      for (const [, value] of BOUNDARY_CASES) {
        const result = await agents[exportName](value);
        expect(result.name).toBe(exportName);
        expect(result.args[0]).toBe(value);
      }
      expect(expectedFn).toHaveBeenCalledTimes(startingCalls + BOUNDARY_CASES.length);
    });

    it('propagates implementation errors', async () => {
      const agents = await importAgentsIndex();
      await expect(Promise.resolve().then(() => agents[exportName]('__throw__'))).rejects.toThrow(
        `${exportName}:boom`,
      );
    });

    if (exportName === 'safeExec') {
      it('supports rapid consecutive calls', async () => {
        const agents = await importAgentsIndex();
        for (let i = 0; i < 100; i++) {
          agents.safeExec(i);
        }
        expect(agents.safeExec).toHaveBeenCalledTimes(100);
        expect(agents.safeExec.mock.calls[0][0]).toBe(0);
        expect(agents.safeExec.mock.calls[99][0]).toBe(99);
      });

      it('supports concurrent calls', async () => {
        const agents = await importAgentsIndex();
        const inputs = Array.from({ length: 50 }, (_, i) => i);

        const results = await Promise.all(
          inputs.map((i) => Promise.resolve().then(() => agents.safeExec(i))),
        );

        expect(agents.safeExec).toHaveBeenCalledTimes(inputs.length);
        for (let i = 0; i < inputs.length; i++) {
          expect(results[i].name).toBe('safeExec');
          expect(results[i].args[0]).toBe(inputs[i]);
        }
      });

      it('propagates async rejections', async () => {
        const agents = await importAgentsIndex();
        await expect(agents.safeExec('__reject__')).rejects.toThrow('safeExec:reject');
      });
    }
  });
}

function describeClassExport(exportName, expectedCtor) {
  describe(exportName, () => {
    it('re-exports the symbol from its source module', async () => {
      const agents = await importAgentsIndex();
      expect(hasOwn(agents, exportName)).toBe(true);
      expect(agents[exportName]).toBe(expectedCtor);
    });

    it('can be constructed with boundary inputs', async () => {
      const agents = await importAgentsIndex();
      const Ctor = agents[exportName];

      const instance = new Ctor(...BOUNDARY_VALUES);
      expect(instance.__name).toBe(exportName);
      expect(instance.__args).toHaveLength(BOUNDARY_VALUES.length);

      for (let i = 0; i < BOUNDARY_VALUES.length; i++) {
        expect(instance.__args[i]).toBe(BOUNDARY_VALUES[i]);
      }
    });

    it('propagates constructor errors', async () => {
      const agents = await importAgentsIndex();
      const Ctor = agents[exportName];
      expect(() => new Ctor('__throw__')).toThrow(`${exportName}:boom`);
    });

    if (exportName === 'RuntimeEventBus') {
      it('is not the same export as core EventBus', async () => {
        const agents = await importAgentsIndex();
        expect(agents.RuntimeEventBus).not.toBe(agents.EventBus);
        expect(agents.RuntimeEventBus).toBe(runtimeExports.EventBus);
        expect(agents.EventBus).toBe(coreExports.EventBus);
      });
    }
  });
}

function describeValueExport(exportName, expectedValue, boundaryAssert) {
  describe(exportName, () => {
    it('re-exports the symbol from its source module', async () => {
      const agents = await importAgentsIndex();
      expect(hasOwn(agents, exportName)).toBe(true);
      expect(agents[exportName]).toBe(expectedValue);
    });

    it('matches boundary expectations', async () => {
      const agents = await importAgentsIndex();
      boundaryAssert(agents);
    });

    it('is a read-only export binding (best-effort; native ESM only)', async () => {
      const agents = await importAgentsIndex();

      const desc = Object.getOwnPropertyDescriptor(agents, exportName);
      expect(desc).toBeDefined();

      // Real ESM module namespace objects expose non-configurable bindings that throw on assignment.
      // Vitest's module runner can expose exports as configurable properties instead.
      if (desc?.configurable === false) {
        expect(desc?.writable ?? false).toBe(false);
        expect(desc?.configurable).toBe(false);
        expect(() => {
          agents[exportName] = 'mutation';
        }).toThrow(TypeError);
      } else {
        expect(desc?.enumerable ?? false).toBe(true);
      }
    });
  });
}

// ------------------------------
// Core exports
// ------------------------------
describeClassExport('Kernel', coreExports.Kernel);
describeValueExport('KernelStatus', coreExports.KernelStatus, (agents) => {
  const v = agents.KernelStatus;
  expect(v).toBe(coreExports.KernelStatus);

  expect(v.nil).toBeNull();
  expect('undef' in v).toBe(true);
  expect(v.undef).toBeUndefined();
  expect(v.emptyStr).toBe('');
  expect(v.whitespace.trim()).toBe('');
  expect(v.emptyArr).toBe(EMPTY_ARRAY);
  expect(v.emptyObj).toBe(EMPTY_OBJECT);
  expect(v.zero).toBe(0);
  expect(v.negOne).toBe(-1);
  expect(v.max).toBe(Number.MAX_SAFE_INTEGER);
  expect(v.numericString).toBe('123');
  expect(v.arrayLike).toBe(ARRAY_LIKE_OBJECT);
});
describeClassExport('KernelBuilder', coreExports.KernelBuilder);

describeClassExport('EventBus', coreExports.EventBus);
describeClassExport('StateBus', coreExports.StateBus);
describeClassExport('ServiceBus', coreExports.ServiceBus);
describeClassExport('MessageBus', coreExports.MessageBus);

describeFunctionExport('createPlugin', coreExports.createPlugin);
describeClassExport('PluginContext', coreExports.PluginContext);
describeClassExport('PluginManager', coreExports.PluginManager);
describeValueExport('PluginStatus', coreExports.PluginStatus, (agents) => {
  expect(agents.PluginStatus).toBe(WHITESPACE_STRING);
  expect(agents.PluginStatus.trim()).toBe('');
});

describeValueExport('presets', coreExports.presets, (agents) => {
  expect(agents.presets).toBe(PRESETS_DEEP_OBJECT);

  let cur = agents.presets;
  for (let i = 0; i < 63; i++) cur = cur.next;

  expect(cur.level).toBe(63);
  expect(cur.next).toBeUndefined();
});

describeFunctionExport('resolvePreset', coreExports.resolvePreset);
describeFunctionExport('mergePresetConfig', coreExports.mergePresetConfig);
describeFunctionExport('listPresets', coreExports.listPresets);

describeFunctionExport('createRetryProxy', coreExports.createRetryProxy);
describeFunctionExport('createTimeoutProxy', coreExports.createTimeoutProxy);
describeFunctionExport('createCacheProxy', coreExports.createCacheProxy);

describeFunctionExport('quickKernel', coreExports.quickKernel);
describeFunctionExport('minimalKernel', coreExports.minimalKernel);
describeFunctionExport('deepsearchKernel', coreExports.deepsearchKernel);
describeFunctionExport('productionKernel', coreExports.productionKernel);

describeFunctionExport('isServiceProvider', coreExports.isServiceProvider);
describeFunctionExport('adaptProvider', coreExports.adaptProvider);
describeFunctionExport('adaptProviders', coreExports.adaptProviders);

// ------------------------------
// Runtime exports
// ------------------------------
describeClassExport('BaseAgentLoop', runtimeExports.BaseAgentLoop);
describeValueExport('AgentStatus', runtimeExports.AgentStatus, (agents) => {
  expect(agents.AgentStatus).toBe(-1);
  expect(typeof agents.AgentStatus).toBe('number');
});
describeValueExport('StepStatus', runtimeExports.StepStatus, (agents) => {
  expect(agents.StepStatus).toBe(0);
  expect(typeof agents.StepStatus).toBe('number');
});

describeClassExport('AgentOrchestrator', runtimeExports.AgentOrchestrator);
describeValueExport('SchedulingMode', runtimeExports.SchedulingMode, (agents) => {
  expect(agents.SchedulingMode).toBe(Number.MAX_SAFE_INTEGER);
  expect(Number.isSafeInteger(agents.SchedulingMode)).toBe(true);
});
describeClassExport('TaskGraph', runtimeExports.TaskGraph);

describeClassExport('RuntimeEventBus', runtimeExports.EventBus);

describeValueExport('RuntimeEvents', runtimeExports.RuntimeEvents, (agents) => {
  expect(Array.isArray(agents.RuntimeEvents)).toBe(true);
  expect(agents.RuntimeEvents).toBe(EMPTY_ARRAY);
  expect(agents.RuntimeEvents).toHaveLength(0);
});
describeValueExport('WatchdogEvents', runtimeExports.WatchdogEvents, (agents) => {
  expect(agents.WatchdogEvents).toBe(EMPTY_OBJECT);
  expect(typeof agents.WatchdogEvents).toBe('object');
  expect(agents.WatchdogEvents).not.toBeNull();
  expect(Object.keys(agents.WatchdogEvents)).toHaveLength(0);
});
describeValueExport('CicadaEvents', runtimeExports.CicadaEvents, (agents) => {
  expect(agents.CicadaEvents).toBe(LONG_STRING);
  expect(typeof agents.CicadaEvents).toBe('string');
  expect(agents.CicadaEvents.length).toBe(LONG_STRING.length);
});

describeClassExport('Watchdog', runtimeExports.Watchdog);
describeClassExport('CicadaCompressor', runtimeExports.CicadaCompressor);
describeClassExport('CompressionCoordinator', runtimeExports.CompressionCoordinator);

describeClassExport('TokenTracker', runtimeExports.TokenTracker);
describeClassExport('TraceContext', runtimeExports.TraceContext);

describeClassExport('ToolRegistry', runtimeExports.ToolRegistry);
describeClassExport('ToolExecutor', runtimeExports.ToolExecutor);
describeFunctionExport('createToolExecutor', runtimeExports.createToolExecutor);

describeClassExport('Container', runtimeExports.Container);
describeFunctionExport('createContainer', runtimeExports.createContainer);
describeValueExport('ServiceId', runtimeExports.ServiceId, (agents) => {
  expect(agents.ServiceId).toBeNull();
});

describeClassExport('HookRegistry', runtimeExports.HookRegistry);
describeValueExport('HookType', runtimeExports.HookType, (agents) => {
  expect(hasOwn(agents, 'HookType')).toBe(true);
  expect(agents.HookType).toBeUndefined();
});

describeFunctionExport('enhanceEventBusWithHooks', runtimeExports.enhanceEventBusWithHooks);
describeFunctionExport('createPreToolUseHook', runtimeExports.createPreToolUseHook);
describeFunctionExport('classifyCommand', runtimeExports.classifyCommand);
describeFunctionExport('parseCompoundCommand', runtimeExports.parseCompoundCommand);

// ------------------------------
// Stages exports
// ------------------------------
describeClassExport('DeepSearchAgentLoop', deepsearchExports.DeepSearchAgentLoop);
describeValueExport('DeepSearchState', deepsearchExports.DeepSearchState, (agents) => {
  expect(agents.DeepSearchState).toBe('');
  expect(agents.DeepSearchState.length).toBe(0);
});
describeFunctionExport('runDeepSearchAgent', deepsearchExports.runDeepSearchAgent);
describeFunctionExport('runDeepSearchStage', deepsearchExports.runDeepSearchStage);
describeClassExport('DesignAgentLoop', deepsearchExports.DesignAgentLoop);
describeFunctionExport('runDesignStage', deepsearchExports.runDesignStage);
describeClassExport('CodeSearchStage', deepsearchExports.CodeSearchStage);
describeClassExport('TextPrepStage', deepsearchExports.TextPrepStage);
describeFunctionExport('runTextPrepStage', deepsearchExports.runTextPrepStage);

// ------------------------------
// SDK exports
// ------------------------------
describeClassExport('AgentBuilder', sdkExports.AgentBuilder);
describeFunctionExport('createAgent', sdkExports.createAgent);
describeFunctionExport('createAgentBuilder', sdkExports.createAgentBuilder);

// ------------------------------
// Shared exports
// ------------------------------
describeClassExport('Archive', sharedExports.Archive);
describeFunctionExport('createBudgetManager', sharedExports.createBudgetManager);
describeFunctionExport('robustParseJson', sharedExports.robustParseJson);
describeFunctionExport('createLogger', sharedExports.createLogger);
describeFunctionExport('safeExec', sharedExports.safeExec);
describeClassExport('CircuitBreaker', sharedExports.CircuitBreaker);
describeFunctionExport('getCircuitBreaker', sharedExports.getCircuitBreaker);

// ------------------------------
// Storage exports
// ------------------------------
describeClassExport('RunStore', storageExports.RunStore);
describeValueExport('RunStoreConstants', storageExports.RunStoreConstants, (agents) => {
  expect(agents.RunStoreConstants).toEqual({ VERSION: 1 });
});
describeFunctionExport('saveTask', storageExports.saveTask);
describeFunctionExport('listRuns', storageExports.listRuns);
describeFunctionExport('exportRunAsZip', storageExports.exportRunAsZip);
describeFunctionExport('canonicalArtifactType', storageExports.canonicalArtifactType);

// ------------------------------
// Import/runtime error handling + concurrency boundary
// ------------------------------
describe('js/agents/index.js (module behavior)', () => {
  it('bubbles dependency import failures', async () => {
    throwOnImport.runtime = true;

    let importError;
    try {
      await import(freshAgentsIndexSpecifier('importFail'));
    } catch (err) {
      importError = err;
    }

    expect(importError).toBeTruthy();
    const message = `${importError?.message ?? ''}\n${importError?.cause?.message ?? ''}`;
    expect(message).toContain('runtime import failed');
  });

  it('initializes mocked dependencies once under concurrent imports', async () => {
    const specifier = freshAgentsIndexSpecifier('concurrent');
    const imports = Array.from({ length: 10 }, () => import(specifier));
    const modules = await Promise.all(imports);

    expect(modules[0].Kernel).toBe(modules[1].Kernel);
    expect(moduleInitCount.core).toBe(1);
    expect(moduleInitCount.runtime).toBe(1);
    expect(moduleInitCount.deepsearch).toBe(1);
    expect(moduleInitCount.sdk).toBe(1);
    expect(moduleInitCount.shared).toBe(1);
    expect(moduleInitCount.storage).toBe(1);
  });

  it('keeps exports stable across repeated imports (rapid consecutive imports)', async () => {
    const first = await importAgentsIndex();
    const second = await importAgentsIndex();

    expect(first.Kernel).toBe(second.Kernel);
    expect(first.safeExec).toBe(second.safeExec);
    expect(first.EventBus).toBe(second.EventBus);
    expect(first.RuntimeEventBus).toBe(second.RuntimeEventBus);
  });
});
