import { describe, it, expect, vi, beforeEach } from 'vitest';

const ERROR_SENTINEL = '__throw__';

const mocked = vi.hoisted(() => {
  const errorSentinel = '__throw__';
  const makeMockFunction = (name) =>
    vi.fn((...args) => {
      if (args[0] === errorSentinel) {
        throw new Error();
      }
      return { name, args };
    });

  const makeMockClass = (name, options = {}) => {
    const { extendsError = false } = options;
    if (extendsError) {
      return class extends Error {
        constructor(...args) {
          const message = args.length > 0 ? args[0] : name;
          if (message === errorSentinel) {
            throw new Error();
          }
          super(String(message));
          this.kind = name;
          this.args = args;
        }
      };
    }

    return class {
      constructor(...args) {
        if (args[0] === errorSentinel) {
          throw new Error();
        }
        this.kind = name;
        this.args = args;
      }
    };
  };

  const createAgent = makeMockFunction('createAgent');
  const AgentBuilder = makeMockClass('AgentBuilder');
  const AgentInstance = makeMockClass('AgentInstance');
  const SubagentRegistry = makeMockClass('SubagentRegistry');
  const globalSubagentRegistry = { id: 'globalSubagentRegistry' };
  const DefaultAgentLoop = makeMockClass('DefaultAgentLoop');
  const BaseAgentLoop = makeMockClass('BaseAgentLoop');
  const EventBus = makeMockClass('EventBus');
  const AgentStatus = { Idle: 'idle', Running: 'running' };
  const StepStatus = { Pending: 'pending', Done: 'done' };
  const isAgentActive = makeMockFunction('isAgentActive');
  const isAgentTerminal = makeMockFunction('isAgentTerminal');
  const StagePausedError = makeMockClass('StagePausedError', { extendsError: true });
  const StageCancelledError = makeMockClass('StageCancelledError', { extendsError: true });
  const CicadaCompressor = makeMockClass('CicadaCompressor');
  const CompressionLayer = makeMockClass('CompressionLayer');
  const Watchdog = makeMockClass('Watchdog');
  const AlertMonitor = makeMockClass('AlertMonitor');
  const createTaskTool = makeMockFunction('createTaskTool');
  const ContextMode = { Append: 'append', Replace: 'replace' };
  const TASK_TOOL_DEFINITION = { name: 'task', parameters: {} };
  const createRecallTool = makeMockFunction('createRecallTool');
  const RECALL_TOOL_DEFINITION = { name: 'recall', parameters: {} };
  const createBacktrackTool = makeMockFunction('createBacktrackTool');
  const BACKTRACK_TOOL_DEFINITION = { name: 'backtrack', parameters: {} };
  const createDMailTool = makeMockFunction('createDMailTool');
  const DMAIL_TOOL_DEFINITION = { name: 'dmail', parameters: {} };
  const BacktrackManager = makeMockClass('BacktrackManager');
  const SoftBacktrackManager = makeMockClass('SoftBacktrackManager');
  const createLogger = makeMockFunction('createLogger');
  const trackToolCall = makeMockFunction('trackToolCall');
  const createBudgetManager = makeMockFunction('createBudgetManager');
  const BudgetAction = { Consume: 'consume', Release: 'release' };
  const createMcpClient = makeMockFunction('createMcpClient');
  const McpClient = makeMockClass('McpClient');
  const McpProvider = makeMockClass('McpProvider');
  const loadAgentConfig = makeMockFunction('loadAgentConfig');
  const mergeConfigs = makeMockFunction('mergeConfigs');
  const DeepSearchAgentLoop = makeMockClass('DeepSearchAgentLoop');
  const DesignAgentLoop = makeMockClass('DesignAgentLoop');
  const CodeSearchStage = makeMockClass('CodeSearchStage');

  return {
    createAgent,
    AgentBuilder,
    AgentInstance,
    SubagentRegistry,
    globalSubagentRegistry,
    DefaultAgentLoop,
    BaseAgentLoop,
    EventBus,
    AgentStatus,
    StepStatus,
    isAgentActive,
    isAgentTerminal,
    StagePausedError,
    StageCancelledError,
    CicadaCompressor,
    CompressionLayer,
    Watchdog,
    AlertMonitor,
    createTaskTool,
    ContextMode,
    TASK_TOOL_DEFINITION,
    createRecallTool,
    RECALL_TOOL_DEFINITION,
    createBacktrackTool,
    BACKTRACK_TOOL_DEFINITION,
    createDMailTool,
    DMAIL_TOOL_DEFINITION,
    BacktrackManager,
    SoftBacktrackManager,
    createLogger,
    trackToolCall,
    createBudgetManager,
    BudgetAction,
    createMcpClient,
    McpClient,
    McpProvider,
    loadAgentConfig,
    mergeConfigs,
    DeepSearchAgentLoop,
    DesignAgentLoop,
    CodeSearchStage,
  };
});

vi.mock('../../../../js/agents/sdk/AgentBuilder.js', () => ({
  createAgent: mocked.createAgent,
  AgentBuilder: mocked.AgentBuilder,
  AgentInstance: mocked.AgentInstance,
}));

vi.mock('../../../../js/agents/sdk/SubagentRegistry.js', () => ({
  SubagentRegistry: mocked.SubagentRegistry,
  globalSubagentRegistry: mocked.globalSubagentRegistry,
}));

vi.mock('../../../../js/agents/sdk/DefaultAgentLoop.js', () => ({
  DefaultAgentLoop: mocked.DefaultAgentLoop,
}));

vi.mock('../../../../js/agents/runtime/core/agent-loop.js', () => ({
  BaseAgentLoop: mocked.BaseAgentLoop,
}));

vi.mock('../../../../js/agents/core/event-bus.js', () => ({
  EventBus: mocked.EventBus,
}));

vi.mock('../../../../js/agents/runtime/core/agent-status.js', () => ({
  AgentStatus: mocked.AgentStatus,
  StepStatus: mocked.StepStatus,
  isAgentActive: mocked.isAgentActive,
  isAgentTerminal: mocked.isAgentTerminal,
}));

vi.mock('../../../../js/agents/runtime/core/stage-errors.js', () => ({
  StagePausedError: mocked.StagePausedError,
  StageCancelledError: mocked.StageCancelledError,
}));

vi.mock('../../../../js/agents/plugins/compression/index.js', () => ({
  CicadaCompressor: mocked.CicadaCompressor,
  CompressionLayer: mocked.CompressionLayer,
  Watchdog: mocked.Watchdog,
}));

vi.mock('../../../../js/agents/sdk/AlertMonitor.js', () => ({
  AlertMonitor: mocked.AlertMonitor,
}));

vi.mock('../../../../js/agents/runtime/tools/TaskTool.js', () => ({
  createTaskTool: mocked.createTaskTool,
  ContextMode: mocked.ContextMode,
  TASK_TOOL_DEFINITION: mocked.TASK_TOOL_DEFINITION,
}));

vi.mock('../../../../js/agents/runtime/tools/RecallTool.js', () => ({
  createRecallTool: mocked.createRecallTool,
  RECALL_TOOL_DEFINITION: mocked.RECALL_TOOL_DEFINITION,
}));

vi.mock('../../../../js/agents/runtime/tools/BacktrackTool.js', () => ({
  createBacktrackTool: mocked.createBacktrackTool,
  BACKTRACK_TOOL_DEFINITION: mocked.BACKTRACK_TOOL_DEFINITION,
}));

vi.mock('../../../../js/agents/runtime/tools/DMailTool.js', () => ({
  createDMailTool: mocked.createDMailTool,
  DMAIL_TOOL_DEFINITION: mocked.DMAIL_TOOL_DEFINITION,
}));

vi.mock('../../../../js/agents/sdk/BacktrackManager.js', () => ({
  BacktrackManager: mocked.BacktrackManager,
}));

vi.mock('../../../../js/agents/sdk/SoftBacktrackManager.js', () => ({
  SoftBacktrackManager: mocked.SoftBacktrackManager,
}));

vi.mock('../../../../js/agents/shared/index.js', () => ({
  createLogger: mocked.createLogger,
  trackToolCall: mocked.trackToolCall,
  createBudgetManager: mocked.createBudgetManager,
  BudgetAction: mocked.BudgetAction,
}));

vi.mock('../../../../js/agents/mcp/index.js', () => ({
  createMcpClient: mocked.createMcpClient,
  McpClient: mocked.McpClient,
  McpProvider: mocked.McpProvider,
}));

vi.mock('../../../../js/agents/sdk/config-loader.js', () => ({
  loadAgentConfig: mocked.loadAgentConfig,
  mergeConfigs: mocked.mergeConfigs,
}));

vi.mock('../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js', () => ({
  DeepSearchAgentLoop: mocked.DeepSearchAgentLoop,
}));

vi.mock('../../../../js/agents/stages/design/agent-loop.js', () => ({
  DesignAgentLoop: mocked.DesignAgentLoop,
}));

vi.mock('../../../../js/agents/stages/codesearch/codesearch-stage.js', () => ({
  CodeSearchStage: mocked.CodeSearchStage,
}));

import * as sdk from '../../../../js/agents/sdk/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

const buildBoundarySamples = () => {
  const deepNested = {};
  let cursor = deepNested;
  for (let i = 0; i < 50; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }

  const largeString = 'x'.repeat(100000);
  const largeArray = Array.from({ length: 10000 }, (_, index) => index);
  const largeFile = new Uint8Array(1024 * 1024);

  return {
    nullValue: null,
    undefinedValue: undefined,
    emptyString: '',
    whitespace: '   ',
    emptyArray: [],
    emptyObject: {},
    zero: 0,
    negative: -1,
    maxSafe: Number.MAX_SAFE_INTEGER,
    stringNumber: '123',
    objectAsArray: { 0: 'zero', length: 1 },
    largeString,
    largeArray,
    largeFile,
    deepNested,
  };
};

const assertBoundaryCalls = (fn, name, values) => {
  const results = values.map((value) => fn(value));
  expect(fn).toHaveBeenCalledTimes(values.length);
  values.forEach((value, index) => {
    expect(fn).toHaveBeenNthCalledWith(index + 1, value);
    expect(results[index].name).toBe(name);
    expect(results[index].args[0]).toBe(value);
  });
};

const functionCases = [
  {
    name: 'createAgent',
    getExport: () => sdk.createAgent,
    getMock: () => mocked.createAgent,
    boundary: (samples) => [samples.nullValue, samples.undefinedValue, samples.emptyString, samples.emptyArray, samples.emptyObject],
  },
  {
    name: 'isAgentActive',
    getExport: () => sdk.isAgentActive,
    getMock: () => mocked.isAgentActive,
    boundary: (samples) => [samples.zero, samples.negative, samples.maxSafe],
  },
  {
    name: 'isAgentTerminal',
    getExport: () => sdk.isAgentTerminal,
    getMock: () => mocked.isAgentTerminal,
    boundary: (samples) => [samples.whitespace, samples.stringNumber],
  },
  {
    name: 'createTaskTool',
    getExport: () => sdk.createTaskTool,
    getMock: () => mocked.createTaskTool,
    boundary: (samples) => [samples.objectAsArray],
  },
  {
    name: 'createRecallTool',
    getExport: () => sdk.createRecallTool,
    getMock: () => mocked.createRecallTool,
    boundary: (samples) => [samples.largeString],
  },
  {
    name: 'createBacktrackTool',
    getExport: () => sdk.createBacktrackTool,
    getMock: () => mocked.createBacktrackTool,
    boundary: (samples) => [samples.largeFile],
  },
  {
    name: 'createDMailTool',
    getExport: () => sdk.createDMailTool,
    getMock: () => mocked.createDMailTool,
    boundary: (samples) => [samples.deepNested],
  },
  {
    name: 'createLogger',
    getExport: () => sdk.createLogger,
    getMock: () => mocked.createLogger,
    boundary: (samples) => [samples.largeArray],
  },
  {
    name: 'trackToolCall',
    getExport: () => sdk.trackToolCall,
    getMock: () => mocked.trackToolCall,
    boundary: (samples) => [samples.emptyString],
  },
  {
    name: 'createBudgetManager',
    getExport: () => sdk.createBudgetManager,
    getMock: () => mocked.createBudgetManager,
    boundary: (samples) => [samples.emptyObject],
    rapid: true,
  },
  {
    name: 'createMcpClient',
    getExport: () => sdk.createMcpClient,
    getMock: () => mocked.createMcpClient,
    boundary: (samples) => [samples.emptyArray],
    concurrent: true,
  },
  {
    name: 'loadAgentConfig',
    getExport: () => sdk.loadAgentConfig,
    getMock: () => mocked.loadAgentConfig,
    boundary: (samples) => [samples.nullValue],
  },
  {
    name: 'mergeConfigs',
    getExport: () => sdk.mergeConfigs,
    getMock: () => mocked.mergeConfigs,
    boundary: (samples) => [samples.emptyObject],
  },
];

functionCases.forEach(({ name, getExport, getMock, boundary, concurrent, rapid }) => {
  describe(name, () => {
    it('re-exports the underlying function', () => {
      expect(getExport()).toBe(getMock());
    });

    it('handles boundary inputs', () => {
      const samples = buildBoundarySamples();
      const values = boundary(samples);
      assertBoundaryCalls(getExport(), name, values);
    });

    it('propagates errors from the implementation', () => {
      const fn = getExport();
      expect(() => fn(ERROR_SENTINEL)).toThrow();
    });

    if (concurrent) {
      it('handles concurrent calls', async () => {
        const fn = getExport();
        const values = [1, 2, 3];
        const results = await Promise.all(values.map((value) => Promise.resolve().then(() => fn(value))));
        expect(fn).toHaveBeenCalledTimes(values.length);
        results.forEach((result, index) => {
          expect(result.args[0]).toBe(values[index]);
        });
      });
    }

    if (rapid) {
      it('handles rapid successive calls', () => {
        const fn = getExport();
        for (let i = 0; i < 5; i += 1) {
          fn(i);
        }
        expect(fn).toHaveBeenCalledTimes(5);
      });
    }
  });
});

const classCases = [
  { name: 'AgentBuilder', getExport: () => sdk.AgentBuilder, getMock: () => mocked.AgentBuilder },
  { name: 'AgentInstance', getExport: () => sdk.AgentInstance, getMock: () => mocked.AgentInstance },
  { name: 'SubagentRegistry', getExport: () => sdk.SubagentRegistry, getMock: () => mocked.SubagentRegistry },
  { name: 'DefaultAgentLoop', getExport: () => sdk.DefaultAgentLoop, getMock: () => mocked.DefaultAgentLoop },
  { name: 'EventBus', getExport: () => sdk.EventBus, getMock: () => mocked.EventBus },
  {
    name: 'StagePausedError',
    getExport: () => sdk.StagePausedError,
    getMock: () => mocked.StagePausedError,
    boundary: (samples) => [samples.emptyString],
    isErrorClass: true,
  },
  {
    name: 'StageCancelledError',
    getExport: () => sdk.StageCancelledError,
    getMock: () => mocked.StageCancelledError,
    boundary: (samples) => [samples.emptyString],
    isErrorClass: true,
  },
  { name: 'BacktrackManager', getExport: () => sdk.BacktrackManager, getMock: () => mocked.BacktrackManager },
  { name: 'SoftBacktrackManager', getExport: () => sdk.SoftBacktrackManager, getMock: () => mocked.SoftBacktrackManager },
  { name: 'McpClient', getExport: () => sdk.McpClient, getMock: () => mocked.McpClient },
  { name: 'McpProvider', getExport: () => sdk.McpProvider, getMock: () => mocked.McpProvider },
];

classCases.forEach(({ name, getExport, getMock, boundary, isErrorClass }) => {
  describe(name, () => {
    it('re-exports the underlying class', () => {
      expect(getExport()).toBe(getMock());
    });

    it('constructs with boundary inputs', () => {
      const samples = buildBoundarySamples();
      const args = boundary ? boundary(samples) : [samples.emptyObject];
      const Ctor = getExport();
      const instance = new Ctor(...args);
      expect(instance).toBeInstanceOf(Ctor);
      if (isErrorClass) {
        expect(instance).toBeInstanceOf(Error);
      }
      expect(instance.args).toEqual(args);
    });

    it('throws when constructor signals error', () => {
      const Ctor = getExport();
      expect(() => new Ctor(ERROR_SENTINEL)).toThrow();
    });
  });
});

const constantCases = [
  { name: 'globalSubagentRegistry', getExport: () => sdk.globalSubagentRegistry, getExpected: () => mocked.globalSubagentRegistry },
  { name: 'AgentStatus', getExport: () => sdk.AgentStatus, getExpected: () => mocked.AgentStatus, keys: ['Idle', 'Running'] },
  { name: 'StepStatus', getExport: () => sdk.StepStatus, getExpected: () => mocked.StepStatus, keys: ['Pending', 'Done'] },
  { name: 'ContextMode', getExport: () => sdk.ContextMode, getExpected: () => mocked.ContextMode, keys: ['Append', 'Replace'] },
  { name: 'TASK_TOOL_DEFINITION', getExport: () => sdk.TASK_TOOL_DEFINITION, getExpected: () => mocked.TASK_TOOL_DEFINITION, keys: ['name', 'parameters'] },
  { name: 'RECALL_TOOL_DEFINITION', getExport: () => sdk.RECALL_TOOL_DEFINITION, getExpected: () => mocked.RECALL_TOOL_DEFINITION, keys: ['name', 'parameters'] },
  { name: 'BACKTRACK_TOOL_DEFINITION', getExport: () => sdk.BACKTRACK_TOOL_DEFINITION, getExpected: () => mocked.BACKTRACK_TOOL_DEFINITION, keys: ['name', 'parameters'] },
  { name: 'DMAIL_TOOL_DEFINITION', getExport: () => sdk.DMAIL_TOOL_DEFINITION, getExpected: () => mocked.DMAIL_TOOL_DEFINITION, keys: ['name', 'parameters'] },
  { name: 'BudgetAction', getExport: () => sdk.BudgetAction, getExpected: () => mocked.BudgetAction, keys: ['Consume', 'Release'] },
];

constantCases.forEach(({ name, getExport, getExpected, keys }) => {
  describe(name, () => {
    it('re-exports the constant value', () => {
      expect(getExport()).toBe(getExpected());
    });

    if (keys) {
      it('exposes the expected keys', () => {
        expect(Object.keys(getExport())).toEqual(keys);
      });
    }
  });
});

describe('VERSION', () => {
  it('exposes the SDK version string', () => {
    expect(sdk.VERSION).toBe('1.0.0');
  });
});
