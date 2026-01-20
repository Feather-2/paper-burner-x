import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const fnMocks = [];

  const createFn = (name) => {
    const impl = (input, ...rest) => {
      if (input === '__throw__') {
        throw new Error(`${name} error`);
      }
      return { name, input, rest };
    };
    const fn = vi.fn(impl);
    fnMocks.push(fn);
    return fn;
  };

  const createClass = (name) => {
    return class {
      constructor(input, ...rest) {
        if (input === '__throw__') {
          throw new Error(`${name} error`);
        }
        this.name = name;
        this.input = input;
        this.rest = rest;
      }
    };
  };

  const createErrorClass = (name) => {
    return class extends Error {
      constructor(message, ...rest) {
        if (message === '__throw__') {
          throw new Error(`${name} error`);
        }
        super(message);
        this.name = name;
        this.input = message;
        this.rest = rest;
      }
    };
  };

  const createEnum = (name) =>
    Object.freeze({
      kind: name,
      values: [`${name}.A`, `${name}.B`],
    });

  const functionNames = [
    'checkCancelled',
    'checkPaused',
    'getEmitFn',
    'isValidAgentStatus',
    'isValidStepStatus',
    'isAgentActive',
    'isAgentTerminal',
    'createLifecycleEmitter',
    'loadMechanisms',
    'initMechanisms',
    'getErrorBoundary',
    'createDefaultErrorBoundary',
    'normalizeReportLength',
    'maybePersistToolOutput',
    'maybePersistJsonArtifact',
    'wrapPersistedOutput',
    'isPersistedOutput',
    'createPersistedOutputHook',
    'normalizeToolResult',
    'resolveToolExecutor',
    'createToolExecutor',
    'enhanceEventBusWithHooks',
    'getHookRegistry',
    'createPreToolUseHook',
    'createContainer',
    'createAgentContainer',
    'createTestContainer',
    'classifyCommand',
    'parseCompoundCommand',
  ];

  const classNames = [
    'BaseAgentLoop',
    'BaseStage',
    'ResourceGuard',
    'AgentOrchestrator',
    'TaskGraph',
    'ToolRegistry',
    'ToolExecutor',
    'HookRegistry',
    'Container',
    'MessageManager',
    'StatusController',
    'StageApiFactory',
    'UnifiedAgentContext',
    'EventBus',
    'Watchdog',
    'CicadaCompressor',
    'CompressionLayer',
    'CompressionCoordinator',
    'TokenTracker',
    'TraceContext',
  ];

  const errorClassNames = [
    'StagePausedError',
    'StageCancelledError',
    'StageTimeoutError',
  ];

  const enumNames = [
    'AgentStatus',
    'StepStatus',
    'ReportLength',
    'SchedulingMode',
    'HookType',
    'ServiceId',
    'RuntimeEvents',
    'WatchdogEvents',
    'CicadaEvents',
    'DeepSearchEvents',
    'DesignEvents',
    'IngestEvents',
    'CodeSearchEvents',
    'AgentLifecycleEvents',
    'PhaseEvents',
  ];

  const symbolNames = ['SINGLETON', 'TRANSIENT'];

  const functions = {};
  functionNames.forEach((name) => {
    functions[name] = createFn(name);
  });

  const classes = {};
  classNames.forEach((name) => {
    classes[name] = createClass(name);
  });

  const errorClasses = {};
  errorClassNames.forEach((name) => {
    errorClasses[name] = createErrorClass(name);
  });

  const enums = {};
  enumNames.forEach((name) => {
    enums[name] = createEnum(name);
  });

  return {
    fnMocks,
    functionNames,
    classNames,
    errorClassNames,
    enumNames,
    symbolNames,
    ...functions,
    ...classes,
    ...errorClasses,
    ...enums,
    SINGLETON: Symbol('SINGLETON'),
    TRANSIENT: Symbol('TRANSIENT'),
  };
});

vi.mock('../../../../js/agents/runtime/core/agent-loop.js', () => ({
  BaseAgentLoop: mocks.BaseAgentLoop,
  BaseStage: mocks.BaseStage,
  checkCancelled: mocks.checkCancelled,
  checkPaused: mocks.checkPaused,
  getEmitFn: mocks.getEmitFn,
}));

vi.mock('../../../../js/agents/runtime/core/agent-status.js', () => ({
  AgentStatus: mocks.AgentStatus,
  StepStatus: mocks.StepStatus,
  isValidAgentStatus: mocks.isValidAgentStatus,
  isValidStepStatus: mocks.isValidStepStatus,
  isAgentActive: mocks.isAgentActive,
  isAgentTerminal: mocks.isAgentTerminal,
}));

vi.mock('../../../../js/agents/runtime/core/stage-errors.js', () => ({
  StagePausedError: mocks.StagePausedError,
  StageCancelledError: mocks.StageCancelledError,
  StageTimeoutError: mocks.StageTimeoutError,
}));

vi.mock('../../../../js/agents/runtime/core/lifecycle.js', () => ({
  createLifecycleEmitter: mocks.createLifecycleEmitter,
}));

vi.mock('../../../../js/agents/runtime/core/mechanisms.js', () => ({
  loadMechanisms: mocks.loadMechanisms,
  initMechanisms: mocks.initMechanisms,
}));

vi.mock('../../../../js/agents/runtime/core/error-boundary.js', () => ({
  getErrorBoundary: mocks.getErrorBoundary,
  createDefaultErrorBoundary: mocks.createDefaultErrorBoundary,
}));

vi.mock('../../../../js/agents/runtime/core/resource-guard.js', () => ({
  ResourceGuard: mocks.ResourceGuard,
}));

vi.mock('../../../../js/agents/runtime/core/constants.js', () => ({
  normalizeReportLength: mocks.normalizeReportLength,
  ReportLength: mocks.ReportLength,
}));

vi.mock('../../../../js/agents/runtime/core/tool-output-persistence.js', () => ({
  maybePersistToolOutput: mocks.maybePersistToolOutput,
  maybePersistJsonArtifact: mocks.maybePersistJsonArtifact,
}));

vi.mock('../../../../js/agents/runtime/core/persisted-output.js', () => ({
  wrapPersistedOutput: mocks.wrapPersistedOutput,
  isPersistedOutput: mocks.isPersistedOutput,
  createPersistedOutputHook: mocks.createPersistedOutputHook,
}));

vi.mock('../../../../js/agents/runtime/core/orchestrator.js', () => ({
  AgentOrchestrator: mocks.AgentOrchestrator,
  SchedulingMode: mocks.SchedulingMode,
}));

vi.mock('../../../../js/agents/runtime/core/parallel/task-graph.js', () => ({
  TaskGraph: mocks.TaskGraph,
}));

vi.mock('../../../../js/agents/runtime/core/tool-registry.js', () => ({
  ToolRegistry: mocks.ToolRegistry,
  normalizeToolResult: mocks.normalizeToolResult,
  resolveToolExecutor: mocks.resolveToolExecutor,
}));

vi.mock('../../../../js/agents/runtime/tools/tool-executor.js', () => ({
  ToolExecutor: mocks.ToolExecutor,
  createToolExecutor: mocks.createToolExecutor,
}));

vi.mock('../../../../js/agents/runtime/hooks/index.js', () => ({
  HookRegistry: mocks.HookRegistry,
  HookType: mocks.HookType,
  enhanceEventBusWithHooks: mocks.enhanceEventBusWithHooks,
  getHookRegistry: mocks.getHookRegistry,
  createPreToolUseHook: mocks.createPreToolUseHook,
}));

vi.mock('../../../../js/agents/core/di/index.js', () => ({
  Container: mocks.Container,
  SINGLETON: mocks.SINGLETON,
  TRANSIENT: mocks.TRANSIENT,
  createContainer: mocks.createContainer,
  ServiceId: mocks.ServiceId,
  createAgentContainer: mocks.createAgentContainer,
  createTestContainer: mocks.createTestContainer,
}));

vi.mock('../../../../js/agents/runtime/safety/command-classifier.js', () => ({
  classifyCommand: mocks.classifyCommand,
  parseCompoundCommand: mocks.parseCompoundCommand,
}));

vi.mock('../../../../js/agents/runtime/core/message-manager.js', () => ({
  MessageManager: mocks.MessageManager,
}));

vi.mock('../../../../js/agents/runtime/core/status-controller.js', () => ({
  StatusController: mocks.StatusController,
}));

vi.mock('../../../../js/agents/runtime/core/api/stage-api-factory.js', () => ({
  StageApiFactory: mocks.StageApiFactory,
}));

vi.mock('../../../../js/agents/runtime/core/context/unified-agent-context.js', () => ({
  UnifiedAgentContext: mocks.UnifiedAgentContext,
}));

vi.mock('../../../../js/agents/core/event-bus.js', () => ({
  EventBus: mocks.EventBus,
}));

vi.mock('../../../../js/agents/runtime/events/events.js', () => ({
  RuntimeEvents: mocks.RuntimeEvents,
  WatchdogEvents: mocks.WatchdogEvents,
  CicadaEvents: mocks.CicadaEvents,
  DeepSearchEvents: mocks.DeepSearchEvents,
  DesignEvents: mocks.DesignEvents,
  IngestEvents: mocks.IngestEvents,
  CodeSearchEvents: mocks.CodeSearchEvents,
  AgentLifecycleEvents: mocks.AgentLifecycleEvents,
  PhaseEvents: mocks.PhaseEvents,
}));

vi.mock('../../../../js/agents/plugins/compression/index.js', () => ({
  Watchdog: mocks.Watchdog,
  CicadaCompressor: mocks.CicadaCompressor,
  CompressionLayer: mocks.CompressionLayer,
  CompressionCoordinator: mocks.CompressionCoordinator,
}));

vi.mock('../../../../js/agents/plugins/telemetry/index.js', () => ({
  TokenTracker: mocks.TokenTracker,
  TraceContext: mocks.TraceContext,
}));

import * as runtime from '../../../../js/agents/runtime/index.js';

const buildDeepObject = (depth) => {
  let root = { level: 0 };
  let node = root;
  for (let i = 1; i <= depth; i += 1) {
    node.next = { level: i };
    node = node.next;
  }
  return root;
};

const longString = 'x'.repeat(10000);
const largeFile = { name: 'huge.bin', size: 1024 * 1024 * 1024 };
const deepObject = buildDeepObject(24);
const emptyArray = [];
const emptyObject = {};
const arrayLike = { 0: 'x', length: 1 };
const boundaryValues = [
  null,
  undefined,
  '',
  emptyArray,
  emptyObject,
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  '   ',
  '123',
  arrayLike,
  longString,
  largeFile,
  deepObject,
];

const rapidValues = ['rapid-1', 'rapid-2', 'rapid-3'];

const call = (fn, ...args) => Promise.resolve().then(() => fn(...args));

beforeEach(() => {
  mocks.fnMocks.forEach((fn) => fn.mockClear());
});

const runFunctionTests = (name) => {
  describe(name, () => {
    it('forwards normal input', async () => {
      const subject = runtime[name];
      const input = { id: name };

      const result = await call(subject, input);

      expect(subject).toBe(mocks[name]);
      expect(typeof subject).toBe('function');
      expect(result).toEqual({ name, input, rest: [] });
      expect(mocks[name]).toHaveBeenCalledTimes(1);
      expect(mocks[name]).toHaveBeenCalledWith(input);
    });

    it('handles boundary values and concurrency', async () => {
      const subject = runtime[name];

      const results = await Promise.all(
        boundaryValues.map((value) => call(subject, value))
      );

      expect(results.map((result) => result.input)).toEqual(boundaryValues);

      const rapidResults = [];
      for (const value of rapidValues) {
        rapidResults.push(await call(subject, value));
      }

      expect(rapidResults.map((result) => result.input)).toEqual(rapidValues);
      expect(mocks[name]).toHaveBeenCalledTimes(
        boundaryValues.length + rapidValues.length
      );
    });

    it('propagates errors', async () => {
      await expect(call(runtime[name], '__throw__')).rejects.toThrow(
        `${name} error`
      );
    });
  });
};

const runClassTests = (name, { isError = false } = {}) => {
  describe(name, () => {
    it('constructs with normal input', () => {
      const subject = runtime[name];
      const input = isError ? `${name} message` : { id: name };

      const instance = new subject(input);

      expect(subject).toBe(mocks[name]);
      expect(instance).toBeInstanceOf(subject);
      expect(instance.name).toBe(name);
      expect(instance.input).toBe(input);
      if (isError) {
        expect(instance).toBeInstanceOf(Error);
        expect(instance.message).toBe(String(input));
      }
    });

    it('handles boundary inputs and concurrent instantiation', async () => {
      const subject = runtime[name];

      const instances = await Promise.all(
        boundaryValues.map((value) => Promise.resolve(new subject(value)))
      );

      expect(instances.map((instance) => instance.input)).toEqual(
        boundaryValues
      );

      const rapidInstances = rapidValues.map((value) => new subject(value));
      expect(rapidInstances.map((instance) => instance.input)).toEqual(
        rapidValues
      );
    });

    it('throws on error sentinel', () => {
      const subject = runtime[name];
      expect(() => new subject('__throw__')).toThrow(`${name} error`);
    });
  });
};

const runEnumTests = (name) => {
  describe(name, () => {
    it('exposes frozen enum values', () => {
      const value = runtime[name];

      expect(value).toBe(mocks[name]);
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.kind).toBe(name);
      expect(Array.isArray(value.values)).toBe(true);
      expect(value.values.length).toBeGreaterThan(0);
    });

    it('is stable across boundary keys', () => {
      const value = runtime[name];
      const map = new Map(boundaryValues.map((key) => [key, value]));

      boundaryValues.forEach((key) => {
        expect(map.get(key)).toBe(value);
      });
    });
  });
};

const runSymbolTests = (name) => {
  describe(name, () => {
    it('exposes symbol identity', () => {
      const value = runtime[name];

      expect(value).toBe(mocks[name]);
      expect(typeof value).toBe('symbol');
    });

    it('is distinct and stable across boundary keys', () => {
      const value = runtime[name];
      const other = name === 'SINGLETON' ? runtime.TRANSIENT : runtime.SINGLETON;
      const map = new Map(boundaryValues.map((key) => [key, value]));

      expect(value).not.toBe(other);
      boundaryValues.forEach((key) => {
        expect(map.get(key)).toBe(value);
      });
    });
  });
};

mocks.functionNames.forEach((name) => runFunctionTests(name));
mocks.classNames.forEach((name) => runClassTests(name));
mocks.errorClassNames.forEach((name) => runClassTests(name, { isError: true }));
mocks.enumNames.forEach((name) => runEnumTests(name));
mocks.symbolNames.forEach((name) => runSymbolTests(name));
