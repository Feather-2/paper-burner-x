import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import mockSuiteDefault, {
  MockModelClient,
  MockMcpProvider,
  MockEventBus,
  MockServer,
  ScenarioRunner,
  createMockTestEnv,
} from '../../../../js/agents/testing/mock-suite.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mock-suite exports', () => {
  it('exposes a default export that mirrors named exports', () => {
    expect(mockSuiteDefault).toMatchObject({
      MockModelClient,
      MockMcpProvider,
      MockEventBus,
      MockServer,
      ScenarioRunner,
      createMockTestEnv,
    });
    expect(mockSuiteDefault.MockModelClient).toBe(MockModelClient);
    expect(mockSuiteDefault.MockMcpProvider).toBe(MockMcpProvider);
    expect(mockSuiteDefault.MockEventBus).toBe(MockEventBus);
    expect(mockSuiteDefault.MockServer).toBe(MockServer);
    expect(mockSuiteDefault.ScenarioRunner).toBe(ScenarioRunner);
    expect(mockSuiteDefault.createMockTestEnv).toBe(createMockTestEnv);
  });
});

describe('MockModelClient', () => {
  it('records call history and exposes callCount', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(12345);
    const client = new MockModelClient({ responses: { default: 'OK' } });

    const response = await client.chat({ messages: [{ role: 'user', content: 'hello' }], usage: 'worker' });

    expect(response.content).toBe('OK');
    expect(client.callCount).toBe(1);
    expect(client.callHistory[0]).toMatchObject({
      usage: 'worker',
      timestamp: 12345,
      messages: [{ role: 'user', content: 'hello' }],
    });
    nowSpy.mockRestore();
  });

  it('throws when registering a non-function predicate rule', () => {
    const client = new MockModelClient();
    expect(() => client.when(null, 'nope')).toThrow('predicate must be a function');
  });

  it('evaluates predicate rules before handler/sequence/keyword matching', async () => {
    const client = new MockModelClient({
      responses: { hello: 'keyword', default: 'default' },
      sequence: ['sequence'],
      handler: async () => 'handler',
    }).when(
      (messages) => messages[messages.length - 1]?.content === 'hello',
      'rule'
    );

    const response = await client.chat({ messages: [{ role: 'user', content: 'hello' }] });
    expect(response.content).toBe('rule');
  });

  it('ignores rule errors and continues evaluation/fallback', async () => {
    const client = new MockModelClient({
      handler: async () => 'handler-fallback',
    })
      .when(() => {
        throw new Error('predicate boom');
      }, 'rule-1')
      .when(() => true, () => {
        throw new Error('response boom');
      });

    const response = await client.chat({ messages: [{ role: 'user', content: 'any' }] });
    expect(response.content).toBe('handler-fallback');
  });

  it('uses handler when provided', async () => {
    const handler = vi.fn(async () => 'dynamic');
    const client = new MockModelClient({ handler });

    const response = await client.chat({ messages: [{ role: 'user', content: 'x' }], usage: 'planner' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.content).toBe('dynamic');
    expect(response.model).toBe('mock');
  });

  it('uses sequence responses in round-robin order when present', async () => {
    const client = new MockModelClient({ sequence: ['a', 'b'] });

    const r1 = await client.chat({ messages: [{ role: 'user', content: 'x' }] });
    const r2 = await client.chat({ messages: [{ role: 'user', content: 'x' }] });
    const r3 = await client.chat({ messages: [{ role: 'user', content: 'x' }] });

    expect([r1.content, r2.content, r3.content]).toEqual(['a', 'b', 'a']);
  });

  it('matches keyword responses using the last message content', async () => {
    const client = new MockModelClient({ responses: { hello: 'world', default: 'fallback' } });
    const response = await client.chat({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'say hello please' },
      ],
    });
    expect(response.content).toBe('world');
  });

  it('falls back to default response when no match is found', async () => {
    const clientWithDefault = new MockModelClient({ responses: { default: 'custom default' } });
    const response1 = await clientWithDefault.chat({ messages: [{ role: 'user', content: 'nope' }] });
    expect(response1.content).toBe('custom default');

    const clientWithoutDefault = new MockModelClient({ responses: {} });
    const response2 = await clientWithoutDefault.chat({ messages: [{ role: 'user', content: 'nope' }] });
    expect(response2.content).toBe('Mock response');
  });

  it('normalizes response objects and maps finishReason/systemFingerprint', async () => {
    const client = new MockModelClient({
      handler: async () => ({
        content: 'payload',
        model: 'm1',
        usage: { total_tokens: 7 },
        finishReason: 'length',
        systemFingerprint: 'fp-1',
        extraField: 123,
      }),
    });

    const response = await client.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(response).toMatchObject({
      content: 'payload',
      model: 'm1',
      usage: { total_tokens: 7 },
      finish_reason: 'length',
      system_fingerprint: 'fp-1',
      extraField: 123,
    });
  });

  it('ask builds messages including optional system prompt', async () => {
    const client = new MockModelClient({ responses: { default: 'OK' } });
    const answer = await client.ask('hello', 'system');
    expect(answer).toBe('OK');
    expect(client.callHistory[0].messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello' },
    ]);
    expect(client.callHistory[0].usage).toBe('worker');
  });

  it('chatStream yields incremental deltas that reassemble into the full response', async () => {
    const client = new MockModelClient({ responses: { default: 'abcdef' } });
    const chunks = [];

    for await (const event of client.chatStream({
      messages: [{ role: 'user', content: 'hi' }],
      chunkSize: 2,
    })) {
      chunks.push(event.delta);
      expect(event.content).toBe('abcdef');
    }

    expect(chunks).toEqual(['ab', 'cd', 'ef']);
  });

  it('chatStream clamps invalid chunkSize to a positive integer', async () => {
    const client = new MockModelClient({ responses: { default: 'abc' } });
    const chunks = [];

    for await (const event of client.chatStream({
      messages: [{ role: 'user', content: 'hi' }],
      chunkSize: 0,
    })) {
      chunks.push(event.delta);
    }

    expect(chunks).toEqual(['a', 'b', 'c']);
  });

  it('respects delay before returning a response (fake timers)', async () => {
    vi.useFakeTimers();
    const client = new MockModelClient({ delay: 25, responses: { default: 'OK' } });

    const chatPromise = client.chat({ messages: [{ role: 'user', content: 'hello' }] });
    let settled = false;
    chatPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(25);
    const response = await chatPromise;

    expect(settled).toBe(true);
    expect(response.content).toBe('OK');
  });

  it('reset clears call history and sequence index', async () => {
    const client = new MockModelClient({ sequence: ['a', 'b'] });
    expect((await client.chat({ messages: [{ role: 'user', content: 'x' }] })).content).toBe('a');
    expect(client.callCount).toBe(1);

    client.reset();

    expect(client.callCount).toBe(0);
    expect((await client.chat({ messages: [{ role: 'user', content: 'x' }] })).content).toBe('a');
  });
});

describe('MockMcpProvider', () => {
  it('returns default search results and records callHistory', async () => {
    const provider = new MockMcpProvider();
    const result = await provider.search('vitest', { limit: 1 });

    expect(result).toMatchObject({
      success: true,
      results: [
        expect.objectContaining({
          title: expect.stringContaining('vitest'),
          url: expect.any(String),
          snippet: expect.any(String),
        }),
      ],
    });
    expect(provider.callHistory).toEqual([{ method: 'search', query: 'vitest', options: { limit: 1 } }]);
  });

  it('uses registered tool handlers for search/fetch/callTool', async () => {
    const searchTool = vi.fn(async (query, options) => ({ success: false, results: [{ query, options }] }));
    const fetchTool = vi.fn(async (url, options) => ({ success: true, title: 'T', content: String(url), options }));
    const customTool = vi.fn(async (args) => ({ success: true, data: { echoed: args } }));

    const provider = new MockMcpProvider({
      tools: {
        search: searchTool,
        fetch: fetchTool,
        custom: customTool,
      },
    });

    const searchResult = await provider.search('q', { k: 1 });
    const fetchResult = await provider.fetch('https://example.com', { headers: { a: 'b' } });
    const toolResult = await provider.callTool('custom', { x: 2 });

    expect(searchTool).toHaveBeenCalledWith('q', { k: 1 });
    expect(fetchTool).toHaveBeenCalledWith('https://example.com', { headers: { a: 'b' } });
    expect(customTool).toHaveBeenCalledWith({ x: 2 });

    expect(searchResult.success).toBe(false);
    expect(fetchResult).toMatchObject({ success: true, title: 'T', content: 'https://example.com' });
    expect(toolResult).toEqual({ success: true, data: { echoed: { x: 2 } } });
  });

  it('registerTool overwrites existing tool handlers', async () => {
    const provider = new MockMcpProvider({ tools: { ping: vi.fn(() => ({ success: true, data: 1 })) } });
    provider.registerTool('ping', vi.fn(() => ({ success: true, data: 2 })));

    const result = await provider.callTool('ping', {});
    expect(result).toEqual({ success: true, data: 2 });
  });

  it('callTool falls back to a mock result when tool is missing', async () => {
    const provider = new MockMcpProvider();
    const result = await provider.callTool('missing', { a: 1 });
    expect(result).toEqual({ success: true, data: 'Mock result for missing' });
    expect(provider.callHistory[0]).toEqual({ method: 'callTool', name: 'missing', args: { a: 1 } });
  });

  it('reset clears callHistory', async () => {
    const provider = new MockMcpProvider();
    await provider.search('x');
    await provider.fetch('https://example.com');
    provider.reset();
    expect(provider.callHistory).toEqual([]);
  });
});

describe('MockEventBus', () => {
  it('emits events and notifies registered listeners (unsubscribe supported)', () => {
    const bus = new MockEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on('evt', handler);

    bus.emit('evt', { ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ ok: true });

    unsubscribe();
    bus.emit('evt', { ok: false });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('off is a no-op when handler is not registered', () => {
    const bus = new MockEventBus();
    expect(() => bus.off('missing', () => {})).not.toThrow();
  });

  it('assertEmitted supports count assertions and throws descriptive errors', () => {
    const bus = new MockEventBus();
    bus.emit('a', { x: 1 });

    expect(() => bus.assertEmitted('a', 2)).toThrow('Expected event "a" to be emitted at least 2 time(s), got 1');
    expect(bus.assertEmitted('a', 1)).toHaveLength(1);
  });

  it('assertEmitted supports object/regex/predicate payload matching', () => {
    const bus = new MockEventBus();
    bus.emit('x', { status: 'ok', count: 2, tags: ['a', 'b', 'c'] });

    expect(bus.assertEmitted('x', { status: 'ok' })).toHaveLength(1);
    expect(bus.assertEmitted('x', { status: /ok|success/ })).toHaveLength(1);
    expect(bus.assertEmitted('x', { count: (value) => value > 0 })).toHaveLength(1);
    expect(bus.assertEmitted('x', { tags: ['a'] })).toHaveLength(1);
  });

  it('assertEmitted treats null/undefined matcher values as wildcards', () => {
    const bus = new MockEventBus();
    bus.emit('x', { status: 'anything', extra: 1 });
    expect(bus.assertEmitted('x', { status: null })).toHaveLength(1);
    expect(bus.assertEmitted('x', { status: undefined })).toHaveLength(1);
  });

  it('assertEmitted can enforce an exact count of matching payloads', () => {
    const bus = new MockEventBus();
    bus.emit('a', { x: 1 });
    bus.emit('a', { x: 2 });

    expect(() => bus.assertEmitted('a', 2, { x: 1 })).toThrow('Expected 2 event(s) "a" with matching payload, got 1');
  });

  it('assertEmittedWith validates predicate and provides helpful errors', () => {
    const bus = new MockEventBus();
    expect(() => bus.assertEmittedWith('x', null)).toThrow('assertEmittedWith: predicate must be a function');
    expect(() => bus.assertEmittedWith('x', () => true)).toThrow('Expected event "x" to be emitted, but it was never emitted');

    bus.emit('x', { value: 1 });
    bus.emit('x', { value: 2 });

    const satisfying = bus.assertEmittedWith('x', (payload) => payload.value === 2, 'value === 2');
    expect(satisfying).toHaveLength(1);
    expect(satisfying[0].payload).toEqual({ value: 2 });

    expect(() => bus.assertEmittedWith('x', () => {
      throw new Error('boom');
    })).toThrow(/Expected event "x" payload to satisfy predicate/);
  });

  it('assertEmittedInOrder validates input and enforces ordering', () => {
    const bus = new MockEventBus();
    expect(() => bus.assertEmittedInOrder([])).toThrow('assertEmittedInOrder: names must be a non-empty array');

    bus.emit('first', {});
    bus.emit('second', {});

    expect(bus.assertEmittedInOrder(['first', 'second'])).toBe(true);
    expect(() => bus.assertEmittedInOrder(['first', 'third'])).toThrow('Expected event "third" to be emitted after "first", but not found');
  });

  it('assertNotEmitted throws when event exists', () => {
    const bus = new MockEventBus();
    bus.emit('x', {});
    expect(() => bus.assertNotEmitted('x')).toThrow('Expected event "x" not to be emitted, but got 1 times');
    expect(() => bus.assertNotEmitted('y')).not.toThrow();
  });

  it('getPayloads returns payload list and reset clears emitted events (not listeners)', () => {
    const bus = new MockEventBus();
    const handler = vi.fn();
    bus.on('x', handler);

    bus.emit('x', 1);
    bus.emit('x', 2);
    expect(bus.getPayloads('x')).toEqual([1, 2]);

    bus.reset();
    expect(bus.getPayloads('x')).toEqual([]);

    bus.emit('x', 3);
    expect(handler).toHaveBeenCalledWith(3);
  });
});

describe('MockServer', () => {
  it('returns 404 Not Found for unmatched routes', async () => {
    const server = new MockServer();
    const response = await server.fetch('http://mock.local/missing');
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    expect(await response.text()).toBe('Not Found');
  });

  it('supports setTextResponse/setJsonResponse/setStreamResponse chaining', () => {
    const server = new MockServer();
    expect(server.setTextResponse('/a', 'A')).toBe(server);
    expect(server.setJsonResponse('/b', { ok: true })).toBe(server);
    expect(server.setStreamResponse('/c', ['x', 'y'])).toBe(server);
  });

  it('normalizes method/path, matches routes, and records callHistory', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(999);
    const server = new MockServer();
    server.setTextResponse('/hello', 'world');

    const response = await server.fetch('http://mock.local/hello', { method: '  get  ', headers: { a: 'b' } });

    expect(response.ok).toBe(true);
    expect(await response.text()).toBe('world');
    expect(server.callHistory).toEqual([
      expect.objectContaining({
        method: 'GET',
        url: 'http://mock.local/hello',
        path: '/hello',
        headers: { a: 'b' },
        timestamp: 999,
      }),
    ]);
    nowSpy.mockRestore();
  });

  it('matches routes with query strings (pathname + search)', async () => {
    const server = new MockServer();
    server.setTextResponse('/search?q=1', 'OK');
    expect((await (await server.fetch('http://mock.local/search?q=1')).text())).toBe('OK');
    expect((await server.fetch('http://mock.local/search?q=2')).status).toBe(404);
  });

  it('supports method-specific routes and wildcard methods', async () => {
    const server = new MockServer();
    server.setTextResponse('/post', 'OK', { method: 'POST' });
    expect((await server.fetch('http://mock.local/post')).status).toBe(404);
    expect(await (await server.fetch('http://mock.local/post', { method: 'post' })).text()).toBe('OK');

    server.setHandler('/any', (req) => ({ body: req.method }), { method: '*' });
    expect(await (await server.fetch('http://mock.local/any')).text()).toBe('GET');
    expect(await (await server.fetch('http://mock.local/any', { method: 'PUT' })).text()).toBe('PUT');
  });

  it('supports RegExp and function route matchers', async () => {
    const server = new MockServer();
    server.setTextResponse(/\/items\/\d+/, 'ITEM');
    server.setHandler((path) => path.startsWith('/fn/'), () => ({ body: 'FN' }));

    expect(await (await server.fetch('http://mock.local/items/123')).text()).toBe('ITEM');
    expect(await (await server.fetch('http://mock.local/fn/test')).text()).toBe('FN');
  });

  it('supports JSON responses and surfaces headers via Response-like API', async () => {
    const server = new MockServer();
    server.setJsonResponse('/health', { ok: true }, { headers: { 'x-custom': '1' } });

    const response = await server.fetch('http://mock.local/health');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-custom')).toBe('1');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('supports stream responses and concatenates text() from streamed chunks', async () => {
    const server = new MockServer();
    server.setStreamResponse('/stream', ['a', 'b', 'c']);

    const response = await server.fetch('http://mock.local/stream');
    const streamed = [];
    for await (const chunk of response.stream()) streamed.push(chunk);

    expect(streamed).toEqual(['a', 'b', 'c']);
    expect(await response.text()).toBe('abc');
  });

  it('MockResponse.json throws a descriptive error for invalid JSON bodies', async () => {
    const server = new MockServer();
    server.setTextResponse('/bad', '{not-json');

    const response = await server.fetch('http://mock.local/bad');
    await expect(response.json()).rejects.toThrow('MockResponse.json(): Invalid JSON body');
  });

  it('MockResponse.arrayBuffer returns an ArrayBuffer of the text body', async () => {
    const server = new MockServer();
    server.setTextResponse('/buf', 'hello');
    const response = await server.fetch('http://mock.local/buf');
    const buffer = await response.arrayBuffer();
    const decoded = new TextDecoder().decode(new Uint8Array(buffer));
    expect(decoded).toBe('hello');
  });

  it('supports delayed responses via text() (fake timers)', async () => {
    vi.useFakeTimers();
    const server = new MockServer();
    server.setTextResponse('/delayed', 'OK', { delay: 10 });

    const response = await server.fetch('http://mock.local/delayed');
    const textPromise = response.text();

    let settled = false;
    textPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    expect(await textPromise).toBe('OK');
    expect(settled).toBe(true);
  });

  it('normalizes invalid URL-like inputs via fallback path handling', async () => {
    const server = new MockServer();
    server.setTextResponse('not a url', 'OK');
    expect(await (await server.fetch('not a url')).text()).toBe('OK');
  });

  it('reset clears routes and callHistory', async () => {
    const server = new MockServer();
    server.setTextResponse('/x', 'X');
    await server.fetch('http://mock.local/x');
    expect(server.callHistory.length).toBe(1);

    server.reset();
    expect(server.callHistory).toEqual([]);
    expect((await server.fetch('http://mock.local/x')).status).toBe(404);
  });
});

describe('ScenarioRunner', () => {
  it('runs a scenario with input/tool/event assertions and records results', async () => {
    const modelClient = new MockModelClient({ responses: { default: 'Hello world' } });
    const mcpProvider = new MockMcpProvider({
      tools: {
        echo: async (args) => ({ success: true, data: { echoed: args } }),
      },
    });
    const eventBus = new MockEventBus();
    const runner = new ScenarioRunner({ modelClient, mcpProvider, eventBus });

    const scenario = {
      name: 'happy path',
      setup: async ({ eventBus }) => {
        eventBus.emit('ready', { ok: true });
      },
      steps: [
        { input: 'hi', expectedOutput: 'Hello' },
        { toolCall: 'echo', args: { x: 1 }, expectedResult: { success: true, data: { echoed: { x: 1 } } } },
        { assertEvent: 'ready', eventCount: 1 },
      ],
    };

    const result = await runner.run(scenario);

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]).toMatchObject({ index: 0, passed: true, output: 'Hello world' });
    expect(result.steps[1]).toMatchObject({ index: 1, passed: true, toolResult: { success: true, data: { echoed: { x: 1 } } } });
    expect(runner.results).toHaveLength(1);
  });

  it('marks a step as failed when expectedOutput does not match', async () => {
    const runner = new ScenarioRunner({ modelClient: new MockModelClient({ responses: { default: 'nope' } }) });
    const result = await runner.run({ name: 'mismatch', steps: [{ input: 'x', expectedOutput: 'expected' }] });

    expect(result.passed).toBe(false);
    expect(result.steps[0]).toMatchObject({ passed: false, error: 'Expected output to contain "expected"' });
    expect(result.errors[0]).toContain('Step 0: Expected output to contain "expected"');
  });

  it('marks a step as failed when expectedResult deep match fails', async () => {
    const mcpProvider = new MockMcpProvider({
      tools: {
        value: async () => ({ success: true, data: 1 }),
      },
    });
    const runner = new ScenarioRunner({ mcpProvider });
    const result = await runner.run({
      name: 'tool mismatch',
      steps: [{ toolCall: 'value', expectedResult: { success: true, data: 2 } }],
    });

    expect(result.passed).toBe(false);
    expect(result.steps[0].error).toMatch(/Expected data=2, got 1/);
  });

  it('marks a step as failed when event assertion fails', async () => {
    const runner = new ScenarioRunner({ eventBus: new MockEventBus() });
    const result = await runner.run({ name: 'event missing', steps: [{ assertEvent: 'missing', eventCount: 1 }] });

    expect(result.passed).toBe(false);
    expect(result.steps[0].error).toMatch(/Expected event "missing" to be emitted at least 1 time/);
  });

  it('captures step exceptions (e.g. model errors) without crashing the whole run', async () => {
    const runner = new ScenarioRunner({
      modelClient: new MockModelClient({
        handler: async () => {
          throw new Error('model boom');
        },
      }),
    });

    const result = await runner.run({ name: 'model throws', steps: [{ input: 'x' }] });
    expect(result.passed).toBe(false);
    expect(result.steps[0]).toMatchObject({ passed: false, error: 'model boom' });
  });

  it('propagates setup errors (setup is not swallowed)', async () => {
    const runner = new ScenarioRunner();
    await expect(runner.run({
      name: 'setup fails',
      setup: async () => {
        throw new Error('setup boom');
      },
      steps: [],
    })).rejects.toThrow('setup boom');
  });

  it('marks scenario as failed when teardown throws', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run({
      name: 'teardown fails',
      steps: [],
      teardown: async () => {
        throw new Error('teardown boom');
      },
    });

    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Teardown failed: teardown boom');
  });

  it('runAll resets dependencies between scenarios and returns summary stats', async () => {
    const modelClient = new MockModelClient({ sequence: ['a', 'b'] });
    const runner = new ScenarioRunner({ modelClient });

    const scenarios = [
      { name: 's1', steps: [{ input: 'x', expectedOutput: 'a' }] },
      { name: 's2', steps: [{ input: 'x', expectedOutput: 'a' }] },
    ];

    const summary = await runner.runAll(scenarios);
    expect(summary).toEqual({
      total: 2,
      passed: 2,
      failed: 0,
      results: expect.any(Array),
    });
    expect(summary.results).toHaveLength(2);
    expect(runner.results).toHaveLength(2);
  });
});

describe('createMockTestEnv', () => {
  it('creates a fully wired environment and stageApi facade', async () => {
    const env = createMockTestEnv({
      model: { responses: { default: 'OK' } },
      mcp: { tools: { ping: async () => ({ success: true, data: 'pong' }) } },
    });

    expect(env.runner.modelClient).toBe(env.modelClient);
    expect(env.runner.mcpProvider).toBe(env.mcpProvider);
    expect(env.runner.eventBus).toBe(env.eventBus);

    const stageApi = env.createStageApi();
    stageApi.emit('test:event', { ok: true });
    expect(env.eventBus.getPayloads('test:event')).toEqual([{ ok: true }]);

    const chatSpy = vi.spyOn(env.modelClient, 'chat');
    await stageApi.modelRouter.call([{ role: 'user', content: 'hi' }], { usage: 'worker' });
    expect(chatSpy).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'hi' }], usage: 'worker' });

    const toolResult = await env.mcpProvider.callTool('ping', {});
    expect(toolResult).toEqual({ success: true, data: 'pong' });

    expect(stageApi.signal).toBeInstanceOf(AbortSignal);
    expect(stageApi.signal.aborted).toBe(false);
  });

  it('createStageApi supports overrides', () => {
    const env = createMockTestEnv();
    const customEmit = vi.fn();
    const stageApi = env.createStageApi({ emit: customEmit, customValue: 42 });

    stageApi.emit('x', { ok: true });
    expect(customEmit).toHaveBeenCalledWith('x', { ok: true });
    expect(stageApi.customValue).toBe(42);
  });
});
