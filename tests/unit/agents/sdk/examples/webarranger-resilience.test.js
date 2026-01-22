import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/sdk/examples/webarranger-resilience.js';

const hoisted = vi.hoisted(() => ({
    createAgent: vi.fn(),
    createLogger: vi.fn(),
    loggerError: vi.fn(),
    discoveryStatus: { CONTRADICTED: 'contradicted' }
}));

vi.mock('../../../../../js/agents/sdk/index.js', () => ({
    createAgent: hoisted.createAgent,
    createLogger: hoisted.createLogger
}));

vi.mock('../../../../../js/agents/sdk/DiscoveryManager.js', () => ({
    DiscoveryStatus: hoisted.discoveryStatus
}));

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve));

const makeBuilder = () => {
    const builder = {
        useCicada: vi.fn(() => builder),
        useBacktrack: vi.fn(() => builder),
        build: vi.fn(() => ({ id: 'arranger' }))
    };

    return builder;
};

const importWorkflowModule = async (query = '') => {
    const mod = await import(`${MODULE_PATH}${query}`);
    await flushMicrotasks();
    return mod;
};

beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    hoisted.createAgent.mockReset();
    hoisted.createLogger.mockReset();
    hoisted.loggerError.mockReset();
    hoisted.discoveryStatus.CONTRADICTED = 'contradicted';

    hoisted.createLogger.mockReturnValue({ error: hoisted.loggerError });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('sdk/examples/webarranger-resilience (module side effects)', () => {
    it('runs the happy path and builds the arranger with resilience options', async () => {
        const builder = makeBuilder();
        hoisted.createAgent.mockReturnValue(builder);

        await importWorkflowModule();

        expect(hoisted.createLogger).toHaveBeenCalledWith(
            'sdk/examples/webarranger-resilience'
        );
        expect(hoisted.createAgent).toHaveBeenCalledTimes(1);

        expect(builder.useCicada).toHaveBeenCalledWith({ maxTokens: 4000 });
        const cicadaOptions = builder.useCicada.mock.calls[0][0];
        expect(typeof cicadaOptions.maxTokens).toBe('number');
        expect(Number.isFinite(cicadaOptions.maxTokens)).toBe(true);
        expect(Array.isArray(cicadaOptions)).toBe(false);

        expect(builder.useBacktrack).toHaveBeenCalledWith({ maxBacktracks: 3 });
        const backtrackOptions = builder.useBacktrack.mock.calls[0][0];
        expect(typeof backtrackOptions.maxBacktracks).toBe('number');
        expect(Number.isFinite(backtrackOptions.maxBacktracks)).toBe(true);
        expect(Array.isArray(backtrackOptions)).toBe(false);

        expect(builder.build).toHaveBeenCalledTimes(1);
        expect(hoisted.loggerError).not.toHaveBeenCalled();

        const logArgs = console.log.mock.calls.flat().filter((x) => typeof x === 'string');
        expect(logArgs.some((line) => line.includes('Starting Resilient WebArranger Workflow'))).toBe(true);
        expect(logArgs.some((line) => line.includes('Arranger Evaluation:'))).toBe(true);
        expect(logArgs.some((line) => line.includes('Resilience demonstration completed'))).toBe(true);
    });

    it('exports nothing (script/example module)', async () => {
        hoisted.createAgent.mockReturnValue(makeBuilder());

        const mod = await importWorkflowModule();

        expect(Object.keys(mod)).toEqual([]);
    });

    it('logs a thrown Error via logger.error', async () => {
        const error = new Error('boom');
        hoisted.createAgent.mockImplementation(() => {
            throw error;
        });

        await importWorkflowModule();

        expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
        expect(hoisted.loggerError).toHaveBeenCalledWith('main failed', { error });

        const logArgs = console.log.mock.calls.flat().filter((x) => typeof x === 'string');
        expect(logArgs.some((line) => line.includes('Starting Resilient WebArranger Workflow'))).toBe(true);
    });

    it.each([
        // Empty values
        ['null', null],
        ['undefined', undefined],
        ['empty string', ''],
        ['empty array', []],
        ['empty object', {}],
        // Boundary values
        ['zero', 0],
        ['negative one', -1],
        ['max safe integer', Number.MAX_SAFE_INTEGER],
        ['whitespace string', '   '],
        // Type boundaries
        ['string as number', '4000'],
        ['object as array', { 0: 'item', length: 1 }]
    ])('logs boundary error value (%s)', async (_label, value) => {
        hoisted.createAgent.mockImplementation(() => {
            throw value;
        });

        await importWorkflowModule();

        expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
        expect(hoisted.loggerError).toHaveBeenCalledWith('main failed', { error: value });
    });

    it('logs when the agent builder chain breaks mid-flight', async () => {
        const builder = makeBuilder();
        builder.useCicada.mockReturnValueOnce(null);
        hoisted.createAgent.mockReturnValue(builder);

        await importWorkflowModule();

        expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
        expect(hoisted.loggerError.mock.calls[0][0]).toBe('main failed');
        expect(hoisted.loggerError.mock.calls[0][1]).toEqual({
            error: expect.any(TypeError)
        });
    });

    it('handles concurrent executions (cache-busting imports)', async () => {
        const builders = [];
        hoisted.createAgent.mockImplementation(() => {
            const builder = makeBuilder();
            builders.push(builder);
            return builder;
        });

        await Promise.all([
            importWorkflowModule('?v=0'),
            importWorkflowModule('?v=1'),
            importWorkflowModule('?v=2')
        ]);

        expect(hoisted.createLogger).toHaveBeenCalledTimes(3);
        expect(hoisted.createAgent).toHaveBeenCalledTimes(3);
        expect(builders).toHaveLength(3);
        for (const builder of builders) {
            expect(builder.useCicada).toHaveBeenCalledTimes(1);
            expect(builder.useBacktrack).toHaveBeenCalledTimes(1);
            expect(builder.build).toHaveBeenCalledTimes(1);
        }
        expect(hoisted.loggerError).not.toHaveBeenCalled();
    });

    it('handles rapid sequential executions (cache-busting imports)', async () => {
        const builders = [];
        hoisted.createAgent.mockImplementation(() => {
            const builder = makeBuilder();
            builders.push(builder);
            return builder;
        });

        for (let i = 0; i < 5; i += 1) {
            // Keep each import isolated without relying on module cache resets.
            await importWorkflowModule(`?seq=${i}`);
        }

        expect(hoisted.createLogger).toHaveBeenCalledTimes(5);
        expect(hoisted.createAgent).toHaveBeenCalledTimes(5);
        expect(builders).toHaveLength(5);
        expect(hoisted.loggerError).not.toHaveBeenCalled();
    });

    it('logs resource-sized error payloads (huge file + long string + deep nesting)', async () => {
        const longString = 'x'.repeat(200000);
        const deepNested = (() => {
            const root = {};
            let cursor = root;
            for (let i = 0; i < 50; i += 1) {
                cursor.level = {};
                cursor = cursor.level;
            }
            return root;
        })();
        const hugeFile = {
            name: 'huge.pdf',
            size: Number.MAX_SAFE_INTEGER,
            contents: longString
        };
        const payload = { file: hugeFile, message: longString, nested: deepNested };

        hoisted.createAgent.mockImplementation(() => {
            throw payload;
        });

        await importWorkflowModule();

        expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
        expect(hoisted.loggerError).toHaveBeenCalledWith('main failed', {
            error: payload
        });
    });
});
