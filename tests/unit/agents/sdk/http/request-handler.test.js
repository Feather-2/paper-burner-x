import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequestHandler } from '../../../../../js/agents/sdk/http/request-handler.js';

describe('createRequestHandler', () => {
  /** @type {ReturnType<typeof createRequestHandler>} */
  let handler;
  /** @type {import('vitest').Mock} */
  let mockRun;

  beforeEach(() => {
    mockRun = vi.fn(async () => ({
      output: 'Hello world',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
      tool_calls: [],
    }));

    const agentFactory = vi.fn(async () => ({
      run: mockRun,
      eventBus: null,
    }));

    handler = createRequestHandler(agentFactory);
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const res = await handler({ method: 'GET', pathname: '/health', headers: {}, body: '' });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    });

    it('rejects non-GET methods', async () => {
      const res = await handler({ method: 'POST', pathname: '/health', headers: {}, body: '' });
      expect(res.status).toBe(405);
    });
  });

  describe('POST /v1/run', () => {
    it('executes agent and returns result', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify({ prompt: 'hi' }),
      });

      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.output).toBe('Hello world');
      expect(data.stop_reason).toBe('end_turn');
      expect(data.session_id).toMatch(/^session[-_]/);
      expect(data.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
      expect(mockRun).toHaveBeenCalledWith('hi', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });

    it('uses provided session_id', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify({ prompt: 'hi', session_id: 'my-session' }),
      });

      const data = JSON.parse(res.body);
      expect(data.session_id).toBe('my-session');
    });

    it('rejects missing prompt', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify({ session_id: 'x' }),
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('prompt');
    });

    it('rejects empty prompt', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify({ prompt: '   ' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects empty body', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: '',
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid JSON', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: 'not json',
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid JSON');
    });

    it('parses JSON with proto-safe reviver and rejects invalid session_id', async () => {
      const polluted = '{"prompt":"hi","session_id":"","__proto__":{"polluted":true}}';
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: polluted,
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('session_id');
      expect({}.polluted).toBeUndefined();
    });

    it('uses injected sessionIdFactory when session_id is missing', async () => {
      const customHandler = createRequestHandler(
        vi.fn(async () => ({ run: mockRun })),
        { sessionIdFactory: () => 'custom-session-id' }
      );

      const res = await customHandler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify({ prompt: 'hi' }),
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).session_id).toBe('custom-session-id');
    });

    it('rejects array body', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify([{ prompt: 'hi' }]),
      });
      expect(res.status).toBe(400);
    });

    it('rejects oversized body', async () => {
      const smallHandler = createRequestHandler(
        vi.fn(async () => ({ run: mockRun })),
        { maxBodyBytes: 50 }
      );
      const res = await smallHandler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify({ prompt: 'x'.repeat(100) }),
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('exceeds');
    });

    it('rejects GET for run endpoint', async () => {
      const res = await handler({ method: 'GET', pathname: '/v1/run', headers: {}, body: '' });
      expect(res.status).toBe(405);
    });

    it('returns 502 on agent error', async () => {
      mockRun.mockRejectedValueOnce(new Error('LLM failed'));
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run',
        headers: {},
        body: JSON.stringify({ prompt: 'hi' }),
      });
      expect(res.status).toBe(502);
      expect(JSON.parse(res.body).error).toContain('LLM failed');
    });

    it('returns 504 on timeout even if downstream ignores abort', async () => {
      vi.useFakeTimers();
      try {
        const never = new Promise(() => {});
        const timeoutHandler = createRequestHandler(
          vi.fn(async () => ({ run: vi.fn(() => never), eventBus: null })),
          { defaultTimeoutMs: 10 }
        );

        const pending = timeoutHandler({
          method: 'POST',
          pathname: '/v1/run',
          headers: {},
          body: JSON.stringify({ prompt: 'timeout me' }),
        });

        await vi.advanceTimersByTimeAsync(20);
        const res = await pending;

        expect(res.status).toBe(504);
        expect(JSON.parse(res.body).error).toContain('may continue');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('concurrent session (reject mode)', () => {
    it('returns 409 when session is already locked', async () => {
      let resolveFirst;
      const hangPromise = new Promise((r) => { resolveFirst = r; });
      const hangRun = vi.fn(async () => {
        await hangPromise;
        return { output: 'done', stop_reason: 'end_turn', usage: {}, tool_calls: [] };
      });

      const factory = vi.fn(async () => ({ run: hangRun, eventBus: null }));
      const rejectHandler = createRequestHandler(factory, { sessionMode: 'reject' });

      const body = JSON.stringify({ prompt: 'hello', session_id: 'locked-session' });
      const req = { method: 'POST', pathname: '/v1/run', headers: {}, body };

      // First request blocks on hangPromise
      const first = rejectHandler(req);

      // Second request with same session_id should be rejected
      const second = await rejectHandler(req);
      expect(second.status).toBe(409);
      expect(JSON.parse(second.body).error).toMatch(/concurrent/i);

      // Cleanup
      resolveFirst();
      await first;
    });
  });

  describe('POST /v1/run/stream', () => {
    it('returns 500 without stream target', async () => {
      const res = await handler({
        method: 'POST',
        pathname: '/v1/run/stream',
        headers: {},
        body: JSON.stringify({ prompt: 'hi' }),
      });
      expect(res.status).toBe(500);
    });

    it('streams events to target', async () => {
      const chunks = [];
      const target = {
        write: vi.fn((c) => chunks.push(c)),
        end: vi.fn(),
      };

      const res = await handler(
        {
          method: 'POST',
          pathname: '/v1/run/stream',
          headers: {},
          body: JSON.stringify({ prompt: 'hi' }),
        },
        target
      );

      expect(res.status).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/event-stream');

      // Should have at least agent_start and agent_stop events
      const events = chunks
        .filter((c) => c.startsWith('data: '))
        .map((c) => JSON.parse(c.replace('data: ', '').trim()));

      const types = events.map((e) => e.type);
      expect(types).toContain('agent_start');
      expect(types).toContain('agent_stop');
    });
  });

  describe('unknown routes', () => {
    it('returns 404', async () => {
      const res = await handler({ method: 'POST', pathname: '/unknown', headers: {}, body: JSON.stringify({ prompt: 'hi' }) });
      expect(res.status).toBe(404);
    });
  });

  describe('dispose', () => {
    it('exposes dispose function', () => {
      expect(typeof handler.dispose).toBe('function');
      handler.dispose(); // should not throw
    });
  });
});
