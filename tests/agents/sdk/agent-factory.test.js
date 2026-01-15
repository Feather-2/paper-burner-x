import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';

const mockedEventBus = vi.hoisted(() => {
  const instances = [];

  class EventBus {
    constructor() {
      this.emit = vi.fn();
      this.subscribe = vi.fn(() => vi.fn());
      this.enableBackpressure = vi.fn();

      instances.push(this);
    }
  }

  return { instances, EventBus };
});

const mockedTaskTool = vi.hoisted(() => ({
  TASK_TOOL_DEFINITION: { name: 'Task', parameters: {} },
  createTaskTool: vi.fn(() => vi.fn(async () => ({ ok: true }))),
}));

const mockedRecallTool = vi.hoisted(() => ({
  RECALL_TOOL_DEFINITION: { name: 'Recall', parameters: {} },
  createRecallTool: vi.fn(() => vi.fn(async () => ({ ok: true }))),
}));

const mockedBacktrackTool = vi.hoisted(() => ({
  BACKTRACK_TOOL_DEFINITION: { name: 'Backtrack', parameters: {} },
  createBacktrackTool: vi.fn(() => vi.fn(async () => ({ ok: true }))),
}));

const mockedCicada = vi.hoisted(() => {
  const instances = [];

  class CicadaCompressor {
    constructor(options = {}) {
      this.options = options;
      this.sharedContext = { from: 'cicada' };
      this.dispose = vi.fn(async () => {});
      instances.push(this);
    }
  }

  return { instances, CicadaCompressor };
});

const mockedBacktrackManager = vi.hoisted(() => {
  const instances = [];

  class BacktrackManager {
    constructor(options = {}) {
      this.options = options;
      instances.push(this);
    }
  }

  return { instances, BacktrackManager };
});

const mockedDiscoveryManager = vi.hoisted(() => {
  const instances = [];

  class DiscoveryManager {
    constructor(options = {}) {
      this.options = options;
      instances.push(this);
    }
  }

  return { instances, DiscoveryManager };
});

const mockedAlertMonitor = vi.hoisted(() => {
  const instances = [];

  class AlertMonitor {
    constructor(options = {}) {
      this.options = options;
      instances.push(this);
    }
  }

  return { instances, AlertMonitor };
});

const mockedToolExecutor = vi.hoisted(() => {
  const instances = [];

  class ToolExecutor {
    constructor(options = {}) {
      this.options = options;
      this.tools = options.tools || {};
      this.register = vi.fn((name, tool) => {
        this.tools[name] = tool;
      });
      this.execute = vi.fn(async (name, params, context) => {
        const tool = this.tools[name];
        if (!tool) return { ok: false, success: false, data: null, error: `Unknown tool: ${name}` };

        const handler = typeof tool === 'function' ? tool : tool.handler;
        if (typeof handler !== 'function') return { ok: false, success: false, data: null, error: `Tool ${name} has no handler` };

        return { ok: true, success: true, data: await handler(params, context) };
      });

      instances.push(this);
    }
  }

  return { instances, ToolExecutor };
});

const mockedDefaultAgentLoop = vi.hoisted(() => {
  const instances = [];

  class DefaultAgentLoop {
    constructor(options = {}) {
      this.options = options;
      this.run = vi.fn(async () => ({ ok: true }));
      this.dispose = vi.fn(async () => {});
      this._executeAbortController = { abort: vi.fn() };
      this._detachEventBusListeners = vi.fn();
      instances.push(this);
    }
  }

  return { instances, DefaultAgentLoop };
});

vi.mock('../../../js/agents/core/event-bus.js', () => ({ EventBus: mockedEventBus.EventBus }));
vi.mock('../../../js/agents/runtime/tools/TaskTool.js', () => mockedTaskTool);
vi.mock('../../../js/agents/runtime/tools/RecallTool.js', () => mockedRecallTool);
vi.mock('../../../js/agents/runtime/tools/BacktrackTool.js', () => mockedBacktrackTool);
vi.mock('../../../js/agents/runtime/compression/cicada-compressor.js', () => ({ CicadaCompressor: mockedCicada.CicadaCompressor }));
vi.mock('../../../js/agents/sdk/BacktrackManager.js', () => ({ BacktrackManager: mockedBacktrackManager.BacktrackManager }));
vi.mock('../../../js/agents/sdk/DiscoveryManager.js', () => ({ DiscoveryManager: mockedDiscoveryManager.DiscoveryManager }));
vi.mock('../../../js/agents/sdk/AlertMonitor.js', () => ({ AlertMonitor: mockedAlertMonitor.AlertMonitor }));
vi.mock('../../../js/agents/runtime/tools/tool-executor.js', () => ({ ToolExecutor: mockedToolExecutor.ToolExecutor }));
vi.mock('../../../js/agents/sdk/DefaultAgentLoop.js', () => ({ DefaultAgentLoop: mockedDefaultAgentLoop.DefaultAgentLoop }));

/**
 * Minimal AgentConfig-like object for AgentFactory.create().
 * @param {object} [overrides]
 */
function createStubConfig(overrides = {}) {
  const capabilities = overrides.capabilities instanceof Map ? overrides.capabilities : new Map();
  const subagentTypes = Array.isArray(overrides.subagentTypes) ? overrides.subagentTypes : [];

  const subagentRegistry = {
    getAvailableTypes: vi.fn(() => subagentTypes),
    getSubagentCatalogPrompt: vi.fn(() => overrides.subagentCatalogPrompt || ''),
  };

  /** @type {any} */
  const cfg = {
    actor: overrides.actor || 'TestActor',
    options: overrides.options || {},
    capabilities,
    hooks: overrides.hooks || { before: [], after: [] },
    mcpConfig: overrides.mcpConfig || null,
    cicadaConfig: overrides.cicadaConfig || null,
    backtrackConfig: overrides.backtrackConfig || null,
    discoveryConfig: overrides.discoveryConfig || null,
    alertMonitorConfig: overrides.alertMonitorConfig || null,
    subagentRegistry,
    eventHandlers: overrides.eventHandlers || [],
    useCapability: vi.fn((name, cap) => {
      capabilities.set(name, cap);
      return cfg;
    }),
  };

  return cfg;
}

beforeEach(() => {
  mockedEventBus.instances.length = 0;
  mockedCicada.instances.length = 0;
  mockedBacktrackManager.instances.length = 0;
  mockedDiscoveryManager.instances.length = 0;
  mockedAlertMonitor.instances.length = 0;
  mockedToolExecutor.instances.length = 0;
  mockedDefaultAgentLoop.instances.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agents/sdk AgentFactory + AgentInstance', () => {
  it('AgentFactory.create wires optional managers and supports lazy module capabilities', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'paperburner-agent-factory-'));
    try {
      const modPath = path.join(tmp, 'lazy-tool.mjs');
      await fs.writeFile(
        modPath,
        [
          'export async function handler(args, ctx) {',
          '  ctx.emit("lazy.emit", { value: args.value });',
          '  return { from: "lazy", value: args.value, hasDiscovery: Boolean(ctx.discoveryManager), state: ctx.state };',
          '}',
          'export default { handler };',
          '',
        ].join('\n'),
        'utf8'
      );

      const lazyModuleUrl = pathToFileURL(modPath).href;

      const capabilities = new Map([
        [
          'Lazy',
          {
            definition: { name: 'Lazy', description: 'lazy', lazy: true },
            handler: null,
            _module: lazyModuleUrl,
          },
        ],
      ]);

      const config = createStubConfig({
        actor: 'TestActor',
        options: { eventBusBackpressure: { deferNonCoalesced: true } },
        capabilities,
        cicadaConfig: { enabled: true },
        backtrackConfig: { maxSteps: 3 },
        discoveryConfig: { enabled: true },
        alertMonitorConfig: { maxWarnings: 1 },
        subagentTypes: ['Explore'],
        eventHandlers: [{ pattern: 'sdk.test.*', handler: vi.fn() }],
      });

      const { AgentFactory } = await import('../../../js/agents/sdk/agent-factory.js');

      const factory = new AgentFactory();
      const agent = factory.create(config);

      // EventBus backpressure enabled (default + configured).
      expect(mockedEventBus.instances).toHaveLength(1);
      const bus = mockedEventBus.instances[0];
      expect(bus.enableBackpressure).toHaveBeenCalledWith(expect.objectContaining({ deferNonCoalesced: true }));

      // Optional subsystems.
      expect(mockedCicada.instances).toHaveLength(1);
      expect(agent.memory).toBe(mockedCicada.instances[0]);
      expect(mockedBacktrackManager.instances).toHaveLength(1);
      expect(agent.backtrack).toBe(mockedBacktrackManager.instances[0]);
      expect(mockedDiscoveryManager.instances).toHaveLength(1);
      expect(agent.discovery).toBe(mockedDiscoveryManager.instances[0]);

      // Built-in capabilities auto-registered.
      expect(config.useCapability).toHaveBeenCalledWith(
        'Recall',
        expect.objectContaining({ definition: mockedRecallTool.RECALL_TOOL_DEFINITION, handler: expect.any(Function) })
      );
      expect(config.useCapability).toHaveBeenCalledWith(
        'Backtrack',
        expect.objectContaining({ definition: mockedBacktrackTool.BACKTRACK_TOOL_DEFINITION, handler: expect.any(Function) })
      );
      expect(config.useCapability).toHaveBeenCalledWith(
        'Task',
        expect.objectContaining({ definition: mockedTaskTool.TASK_TOOL_DEFINITION, handler: expect.any(Function) })
      );

      expect(mockedRecallTool.createRecallTool).toHaveBeenCalledWith({ compressor: mockedCicada.instances[0] });
      expect(mockedBacktrackTool.createBacktrackTool).toHaveBeenCalledWith({ backtrackManager: mockedBacktrackManager.instances[0] });
      expect(mockedTaskTool.createTaskTool).toHaveBeenCalledWith({ registry: config.subagentRegistry });

      // Event handlers are subscribed via AgentInstance.on(...)
      expect(bus.subscribe).toHaveBeenCalledWith('sdk.test.*', expect.any(Function));

      // AlertMonitor is created and attached.
      expect(mockedAlertMonitor.instances).toHaveLength(1);
      expect(agent.alertMonitor).toBe(mockedAlertMonitor.instances[0]);
      expect(mockedAlertMonitor.instances[0].options).toEqual(expect.objectContaining({ agent }));

      // Lazy module is imported on first use and registered in ToolExecutor.
      const executor = mockedToolExecutor.instances[0];
      expect(executor).toBeTruthy();

      // Cover injected emit callbacks from AgentFactory.create().
      mockedDiscoveryManager.instances[0].options.emit('discovery.event', { ok: true });
      executor.options.emit('executor.event', { ok: true });
      expect(bus.emit).toHaveBeenCalledWith('discovery.event', { ok: true });
      expect(bus.emit).toHaveBeenCalledWith('executor.event', { ok: true });

      const first = await agent.toolExecutor('Lazy', { value: 123 }, { state: { run: 1 }, signal: null });
      expect(first.success).toBe(true);
      expect(first.data).toEqual({ from: 'lazy', value: 123, hasDiscovery: true, state: { run: 1 } });
      expect(bus.emit).toHaveBeenCalledWith('lazy.emit', { value: 123 });

      expect(capabilities.get('Lazy').handler).toEqual(expect.any(Function));
      expect(executor.register).toHaveBeenCalledTimes(1);

      const second = await agent.toolExecutor('Lazy', { value: 456 }, { state: { run: 2 }, signal: null });
      expect(second.success).toBe(true);
      expect(executor.register).toHaveBeenCalledTimes(1); // no re-register on subsequent calls
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('respects backpressure=false (does not call enableBackpressure)', async () => {
    const config = createStubConfig({
      options: { backpressure: false },
    });

    const { AgentFactory } = await import('../../../js/agents/sdk/agent-factory.js');
    const factory = new AgentFactory();
    factory.create(config);

    expect(mockedEventBus.instances).toHaveLength(1);
    expect(mockedEventBus.instances[0].enableBackpressure).not.toHaveBeenCalled();
  });

  it('AgentInstance.getCapabilityCatalogPrompt groups priorities and appends subagent prompt', async () => {
    const { AgentInstance } = await import('../../../js/agents/sdk/agent-factory.js');

    const capabilities = new Map([
      [
        'Critical',
        {
          definition: { name: 'Critical', description: 'c', priority: 'critical', activation: { keywords: ['alpha'] } },
          handler: vi.fn(),
        },
      ],
      [
        'Important',
        {
          definition: { name: 'Important', description: 'i', activation: { priority: 'important', keywords: ['beta', 'gamma'] } },
          handler: vi.fn(),
        },
      ],
      [
        'Optional',
        {
          definition: { name: 'Optional', description: 'o', priority: 2, activation: { keywords: ['delta'] } },
          handler: vi.fn(),
        },
      ],
    ]);

    const subagentRegistry = { getSubagentCatalogPrompt: vi.fn(() => '## Subagents\n- Explore') };

    const agent = new AgentInstance({
      eventBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      capabilities,
      toolExecutor: null,
      mcpConfig: null,
      subagentRegistry,
      compressor: null,
      backtrackManager: null,
      discoveryManager: null,
      actor: 'Tester',
      options: {},
    });

    const prompt = agent.getCapabilityCatalogPrompt();
    expect(agent.skills).toBe(capabilities);
    expect(agent.getCapabilityDefinitions().map((d) => d.name)).toEqual(['Critical', 'Important', 'Optional']);
    expect(agent.getSkillDefinitions().map((d) => d.name)).toEqual(['Critical', 'Important', 'Optional']);
    expect(prompt).toMatch(/\*\*Critical\*\*: c/);
    expect(prompt).toContain('alpha');
    expect(prompt).toMatch(/\*\*Important\*\*: i/);
    expect(prompt).toContain('beta, gamma');
    expect(prompt).toMatch(/\*\*Optional\*\*: o/);
    expect(prompt).toContain('delta');
    expect(prompt).toContain('## Subagents');
    expect(agent.getSkillCatalogPrompt()).toBe(prompt);
  });

  it('AgentInstance.run creates DefaultAgentLoop once, merges defaultLoop options, and emits started', async () => {
    const { AgentInstance } = await import('../../../js/agents/sdk/agent-factory.js');

    const eventBus = { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) };
    const agent = new AgentInstance({
      eventBus,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      capabilities: new Map(),
      toolExecutor: vi.fn(),
      mcpConfig: null,
      subagentRegistry: { getSubagentCatalogPrompt: vi.fn(() => '') },
      compressor: null,
      backtrackManager: null,
      discoveryManager: null,
      actor: 'MyActor',
      options: { defaultLoop: { maxIterations: 99, stageName: 'override' } },
    });

    const out1 = await agent.run({ input: 1 }, { runId: 'r1', state: {}, signal: null });
    expect(out1).toEqual({ ok: true });
    expect(eventBus.emit).toHaveBeenCalledWith('myactor.agent.started', { runId: 'r1' });
    expect(mockedDefaultAgentLoop.instances).toHaveLength(1);
    expect(mockedDefaultAgentLoop.instances[0].options).toEqual(expect.objectContaining({ maxIterations: 99, stageName: 'override' }));

    // Ensure the injected getCatalogPrompt callback is usable (covers the factory wiring).
    expect(mockedDefaultAgentLoop.instances[0].options.getCatalogPrompt()).toContain('##');

    const out2 = await agent.run({ input: 2 }, { runId: 'r2', state: {}, signal: null });
    expect(out2).toEqual({ ok: true });
    expect(mockedDefaultAgentLoop.instances).toHaveLength(1);
  });

  it('AgentInstance.run emits failed and rethrows on loop errors', async () => {
    const { AgentInstance } = await import('../../../js/agents/sdk/agent-factory.js');

    const eventBus = { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) };
    const agent = new AgentInstance({
      eventBus,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      capabilities: new Map(),
      toolExecutor: vi.fn(),
      mcpConfig: null,
      subagentRegistry: { getSubagentCatalogPrompt: vi.fn(() => '') },
      compressor: null,
      backtrackManager: null,
      discoveryManager: null,
      actor: 'AgentX',
      options: {},
    });

    agent.setLoop({
      run: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(agent.run({ input: 1 }, { runId: 'r1', state: {}, signal: null })).rejects.toThrow('boom');
    expect(eventBus.emit).toHaveBeenCalledWith('agentx.agent.started', { runId: 'r1' });
    expect(eventBus.emit).toHaveBeenCalledWith('AgentX.agent.failed', { error: 'boom' });
  });

  it('AgentInstance.on returns a safe unsubscribe and integrates with dispose()', async () => {
    const { AgentInstance } = await import('../../../js/agents/sdk/agent-factory.js');

    const unsub = vi.fn();
    const eventBus = {
      emit: vi.fn(),
      subscribe: vi.fn(() => unsub),
    };

    const agent = new AgentInstance({
      eventBus,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      capabilities: new Map(),
      toolExecutor: vi.fn(),
      mcpConfig: null,
      subagentRegistry: { getSubagentCatalogPrompt: vi.fn(() => '') },
      compressor: null,
      backtrackManager: null,
      discoveryManager: null,
      actor: 'Tester',
      options: {},
    });

    const safe = agent.on('sdk.on.test', vi.fn());
    expect(typeof safe).toBe('function');

    safe();
    safe();
    expect(unsub).toHaveBeenCalledTimes(1);

    await agent.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);

    // When subscribe() returns a non-function, AgentInstance.on should return it as-is.
    const agent2 = new AgentInstance({
      eventBus: { emit: vi.fn(), subscribe: vi.fn(() => null) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      capabilities: new Map(),
      toolExecutor: vi.fn(),
      mcpConfig: null,
      subagentRegistry: { getSubagentCatalogPrompt: vi.fn(() => '') },
      compressor: null,
      backtrackManager: null,
      discoveryManager: null,
      actor: 'Tester',
      options: {},
    });

    expect(agent2.on('sdk.on.test', vi.fn())).toBe(null);
  });

  it('dispose() releases loop + compressor and prevents further use', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'paperburner-agent-dispose-'));
    try {
      const modPath = path.join(tmp, 'noop.mjs');
      await fs.writeFile(modPath, 'export async function handler() { return { ok: true }; }\nexport default { handler };', 'utf8');

      const config = createStubConfig({
        actor: 'DisposeActor',
        options: {},
        cicadaConfig: { enabled: true },
        subagentTypes: [],
        eventHandlers: [{ pattern: 'sdk.dispose.test', handler: vi.fn() }],
        capabilities: new Map([
          [
            'Noop',
            {
              definition: { name: 'Noop', description: 'noop', lazy: true },
              handler: null,
              _module: pathToFileURL(modPath).href,
            },
          ],
        ]),
      });

      const { AgentFactory } = await import('../../../js/agents/sdk/agent-factory.js');
      const agent = new AgentFactory().create(config);

      // Hold onto an executor reference to ensure it checks disposal even after being captured.
      const exec = agent.toolExecutor;

      // Create a loop via run() so loop cleanup paths are exercised.
      await agent.run({ input: 1 }, { runId: 'run', state: {}, signal: null });
      expect(mockedDefaultAgentLoop.instances).toHaveLength(1);
      const loop = mockedDefaultAgentLoop.instances[0];

      // Exercise disposal catch blocks (abort/detach failures are swallowed).
      loop._executeAbortController.abort.mockImplementation(() => {
        throw new Error('abort failed');
      });
      loop._detachEventBusListeners.mockImplementation(() => {
        throw new Error('detach failed');
      });

      // At least one subscription is expected (eventHandlers wiring).
      const bus = mockedEventBus.instances[0];
      const unsubFn = bus.subscribe.mock.results[0]?.value;

      await agent.dispose();

      expect(loop.dispose).toHaveBeenCalledTimes(1);
      expect(mockedCicada.instances[0].dispose).toHaveBeenCalledTimes(1);
      expect(unsubFn).toHaveBeenCalledTimes(1);
      expect(agent._loop).toBe(null);
      expect(agent._toolExecutor).toBe(null);

      await expect(exec('Noop', {}, { state: {}, signal: null })).rejects.toThrow(/disposed/i);
      expect(() => agent.getCapabilityDefinitions()).toThrow(/disposed/i);
      expect(() => agent.on('x', () => {})).toThrow(/disposed/i);
      expect(() => agent.toolExecutor).toThrow(/disposed/i);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
