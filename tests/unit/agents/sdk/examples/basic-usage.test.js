import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = {
    agents: [],
    loggers: [],
    reset() {
        this.agents = [];
        this.loggers = [];
    },
    getLoggerByActor(actor) {
        const match = this.loggers.find(
            (entry) => entry.config && entry.config.actor === actor
        );
        return match ? match.logger : undefined;
    }
};

const buildAgent = (state) => {
    const agent = {
        __capabilities: state.capabilities,
        __hooks: state.hooks,
        __events: state.events,
        getCapabilityDefinitions: vi.fn(() => {
            return state.capabilities.map((capability) => ({
                ...capability.definition
            }));
        }),
        run: vi.fn(async (params) => {
            const paramsObject =
                params && typeof params === 'object' ? params : {};
            const toolName =
                paramsObject.tool ||
                paramsObject.capability ||
                paramsObject.name;
            const capability = toolName
                ? state.capabilities.find((item) => item.name === toolName)
                : state.capabilities[0];

            if (!capability) {
                throw new Error('No capability registered');
            }

            for (const hook of state.hooks.before) {
                const hookResult = await hook({
                    tool: capability.name,
                    params: paramsObject
                });
                if (hookResult && hookResult.skip) {
                    return hookResult.value;
                }
            }

            if (typeof capability.handler !== 'function') {
                throw new Error(`No handler for capability: ${capability.name}`);
            }

            let result = await capability.handler(paramsObject);
            for (const hook of state.hooks.after) {
                const hookResult = await hook({
                    tool: capability.name,
                    result
                });
                if (hookResult !== undefined) {
                    result = hookResult;
                }
            }

            return result;
        })
    };

    mockState.agents.push(agent);
    return agent;
};

vi.mock('../../../../../js/agents/sdk/index.js', () => {
    const createAgent = vi.fn((options = {}) => {
        const state = {
            actor: options.actor,
            capabilities: [],
            hooks: { before: [], after: [] },
            events: []
        };

        const builder = {
            useCapability(name, configOrHandler) {
                const isHandler = typeof configOrHandler === 'function';
                let definition = null;
                let handler = null;
                let modulePath = null;

                if (isHandler) {
                    handler = configOrHandler;
                } else if (configOrHandler && typeof configOrHandler === 'object') {
                    definition = configOrHandler.definition
                        ? { ...configOrHandler.definition }
                        : null;
                    handler = configOrHandler.handler;
                    modulePath = configOrHandler.module;
                }

                const capabilityName =
                    definition && typeof definition.name === 'string'
                        ? definition.name
                        : name;
                const normalizedDefinition = definition
                    ? { ...definition, name: capabilityName }
                    : { name: capabilityName };

                state.capabilities.push({
                    name: capabilityName,
                    definition: normalizedDefinition,
                    handler,
                    module: modulePath
                });

                return builder;
            },
            useHook(stage, handler) {
                if (!state.hooks[stage]) {
                    state.hooks[stage] = [];
                }
                state.hooks[stage].push(handler);
                return builder;
            },
            onEvent(pattern, handler) {
                state.events.push({ pattern, handler });
                return builder;
            },
            build() {
                return buildAgent(state);
            }
        };

        return builder;
    });

    const createLogger = vi.fn((config) => {
        const logger = {
            info: vi.fn(),
            error: vi.fn()
        };
        mockState.loggers.push({ config, logger });
        return logger;
    });

    return { createAgent, createLogger };
});

const loadModule = async () => {
    return import('../../../../../js/agents/sdk/examples/basic-usage.js');
};

beforeEach(() => {
    mockState.reset();
    vi.clearAllMocks();
    vi.resetModules();
});

describe('basicAgent', () => {
    it('exposes capability definitions and event handler', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { basicAgent } = await loadModule();

        const definitions = basicAgent.getCapabilityDefinitions();
        const names = definitions.map((definition) => definition.name);
        expect(names).toEqual(['echo', 'greet']);

        const greetDefinition = definitions.find(
            (definition) => definition.name === 'greet'
        );
        expect(greetDefinition).toBeTruthy();
        expect(greetDefinition.description).toEqual(expect.any(String));
        expect(greetDefinition.activation.keywords).toEqual(
            expect.arrayContaining(['hello', 'hi'])
        );
        expect(greetDefinition.activation.keywords).toHaveLength(3);

        expect(basicAgent.__events).toHaveLength(1);
        const eventEntry = basicAgent.__events[0];
        expect(eventEntry.pattern).toBe('demo:*');
        expect(typeof eventEntry.handler).toBe('function');

        const eventPayload = { type: 'demo:test' };
        eventEntry.handler(eventPayload);
        expect(logSpy).toHaveBeenCalledWith('[Event]', eventPayload);

        logSpy.mockRestore();
    });

    it('echo capability handles boundary inputs', async () => {
        const { basicAgent } = await loadModule();
        const longText = 'x'.repeat(10000);

        const cases = [
            { input: 'hello', expected: 'hello' },
            { input: '', expected: '' },
            { input: '   ', expected: '   ' },
            { input: '123', expected: '123' },
            { input: longText, expected: longText },
            { input: null, expected: '' },
            { input: undefined, expected: '' },
            { input: 0, expected: '' },
            { input: -1, expected: '' },
            { input: Number.MAX_SAFE_INTEGER, expected: '' },
            { input: [], expected: '' },
            { input: {}, expected: '' },
            { input: { length: 0 }, expected: '' }
        ];

        for (const testCase of cases) {
            const result = await basicAgent.run({
                tool: 'echo',
                text: testCase.input
            });
            expect(result).toEqual({
                success: true,
                data: { echoed: testCase.expected }
            });
        }

        const emptyObjectResult = await basicAgent.run({});
        expect(emptyObjectResult).toEqual({
            success: true,
            data: { echoed: '' }
        });

        const emptyArrayResult = await basicAgent.run([]);
        expect(emptyArrayResult).toEqual({
            success: true,
            data: { echoed: '' }
        });

        const defaultResult = await basicAgent.run();
        expect(defaultResult).toEqual({
            success: true,
            data: { echoed: '' }
        });
    });

    it('greet capability handles edge cases including deep objects', async () => {
        const { basicAgent } = await loadModule();
        const deepObject = {
            level1: { level2: { level3: { level4: 'value' } } }
        };

        const cases = [
            { input: 'Ada', expected: 'Hello, Ada!' },
            { input: '', expected: 'Hello, !' },
            { input: '   ', expected: 'Hello,    !' },
            { input: '123', expected: 'Hello, 123!' },
            { input: null, expected: 'Hello, World!' },
            { input: undefined, expected: 'Hello, World!' },
            { input: 0, expected: 'Hello, World!' },
            { input: -1, expected: 'Hello, World!' },
            { input: Number.MAX_SAFE_INTEGER, expected: 'Hello, World!' },
            { input: [], expected: 'Hello, World!' },
            { input: {}, expected: 'Hello, World!' },
            { input: deepObject, expected: 'Hello, World!' }
        ];

        for (const testCase of cases) {
            const result = await basicAgent.run({
                tool: 'greet',
                name: testCase.input
            });
            expect(result).toEqual({
                success: true,
                data: { message: testCase.expected }
            });
        }
    });
});

describe('agentWithHooks', () => {
    it('runs search capability with hooks and timestamp', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456);
        const { agentWithHooks } = await loadModule();
        const auditLogger = mockState.getLoggerByActor('audit');

        expect(auditLogger).toBeTruthy();
        const result = await agentWithHooks.run({ query: 'test' });

        expect(result).toEqual({
            success: true,
            data: { results: ['Result for: test'] },
            _timestamp: 123456
        });
        expect(auditLogger.info).toHaveBeenCalledWith('Calling tool: search', {
            params: { query: 'test' }
        });

        nowSpy.mockRestore();
    });

    it('skips execution when before hook requests skip', async () => {
        const { agentWithHooks } = await loadModule();
        const auditLogger = mockState.getLoggerByActor('audit');

        const result = await agentWithHooks.run({
            query: 'blocked',
            blocked: true
        });

        expect(result).toEqual({ blocked: true });
        expect(auditLogger.info).toHaveBeenCalledWith('Calling tool: search', {
            params: { query: 'blocked', blocked: true }
        });
    });

    it('handles query boundary values and deep nesting', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(42);
        const { agentWithHooks } = await loadModule();
        const longQuery = 'q'.repeat(10000);
        const deepQuery = { level1: { level2: { level3: 'value' } } };

        const cases = [
            { input: 'alpha', expected: 'alpha' },
            { input: '', expected: '' },
            { input: '   ', expected: '   ' },
            { input: '123', expected: '123' },
            { input: longQuery, expected: longQuery },
            { input: null, expected: '' },
            { input: undefined, expected: '' },
            { input: 0, expected: '' },
            { input: -1, expected: '' },
            { input: Number.MAX_SAFE_INTEGER, expected: '' },
            { input: [], expected: '' },
            { input: {}, expected: '' },
            { input: deepQuery, expected: '' }
        ];

        for (const testCase of cases) {
            const result = await agentWithHooks.run({ query: testCase.input });
            expect(result).toEqual({
                success: true,
                data: { results: [`Result for: ${testCase.expected}`] },
                _timestamp: 42
            });
        }

        nowSpy.mockRestore();
    });

    it('supports concurrent and rapid successive calls', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(777);
        const { agentWithHooks } = await loadModule();
        const auditLogger = mockState.getLoggerByActor('audit');

        const [first, second] = await Promise.all([
            agentWithHooks.run({ query: 'one' }),
            agentWithHooks.run({ query: 'two' })
        ]);

        expect(first.data.results[0]).toBe('Result for: one');
        expect(second.data.results[0]).toBe('Result for: two');
        expect(first._timestamp).toBe(777);
        expect(second._timestamp).toBe(777);

        const queries = ['fast-1', 'fast-2', 'fast-3'];
        const results = [];

        for (const query of queries) {
            results.push(await agentWithHooks.run({ query }));
        }

        expect(results.map((item) => item.data.results[0])).toEqual([
            'Result for: fast-1',
            'Result for: fast-2',
            'Result for: fast-3'
        ]);
        expect(auditLogger.info).toHaveBeenCalledTimes(5);

        nowSpy.mockRestore();
    });
});

describe('lazyAgent', () => {
    it('exposes lazy capability definition and module reference', async () => {
        const { lazyAgent } = await loadModule();
        const definitions = lazyAgent.getCapabilityDefinitions();

        expect(definitions).toHaveLength(1);
        expect(definitions[0]).toEqual(
            expect.objectContaining({
                name: 'heavy-task',
                lazy: true
            })
        );
        expect(definitions[0].description).toEqual(expect.any(String));
        expect(lazyAgent.__capabilities[0].module).toBe(
            './heavy-task-handler.js'
        );
        expect(lazyAgent.__capabilities[0].handler).toBeUndefined();
    });
});

describe('runExamples', () => {
    it('logs output and runs agentWithHooks', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { runExamples, basicAgent, agentWithHooks, lazyAgent } =
            await loadModule();

        await runExamples();

        expect(agentWithHooks.run).toHaveBeenCalledTimes(1);
        expect(agentWithHooks.run).toHaveBeenCalledWith({ query: 'test' });
        expect(basicAgent.getCapabilityDefinitions).toHaveBeenCalledTimes(1);
        expect(lazyAgent.getCapabilityDefinitions).toHaveBeenCalledTimes(1);

        const logMessages = logSpy.mock.calls.map((call) => call[0]);
        expect(logMessages).toContain('=== Basic Agent ===');
        expect(logMessages).toContain('\n=== Agent with Hooks ===');
        expect(logMessages).toContain('\n=== Lazy Agent ===');
        expect(logMessages).toContain('Capabilities:');
        expect(logMessages).toContain('Result:');
        expect(logMessages).toContain('Lazy capabilities:');

        logSpy.mockRestore();
    });

    it('propagates errors from agentWithHooks.run', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { runExamples, agentWithHooks } = await loadModule();
        const error = new Error('boom');

        agentWithHooks.run = vi.fn(() => Promise.reject(error));

        await expect(runExamples()).rejects.toThrow('boom');

        logSpy.mockRestore();
    });
});
