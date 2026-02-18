import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserServer } from '../../../../../js/agents/sdk/http/browser-server.js';
import { HmrClient } from '../../../../../js/agents/core/webruntime/hmr.js';
import { withVfsEvents } from '../../../../../js/agents/core/webruntime/vfs-events.js';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';

function createServiceWorkerMock() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  const serviceWorker = {
    controller: { postMessage: vi.fn() },
    register: vi.fn(async () => ({})),
    ready: Promise.resolve({}),
    addEventListener: vi.fn((event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    }),
    removeEventListener: vi.fn((event, handler) => {
      listeners.get(event)?.delete(handler);
    }),
  };

  return {
    serviceWorker,
    dispatch(event, payload) {
      for (const handler of listeners.get(event) || []) {
        handler(payload);
      }
    },
  };
}

describe('webruntime integration flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes ArrayBuffer POST body through bridge -> browser-server -> request-handler', async () => {
    const sw = createServiceWorkerMock();
    vi.stubGlobal('navigator', { serviceWorker: sw.serviceWorker });

    const agentFactory = vi.fn(async () => ({
      run: vi.fn(async (prompt) => ({
        output: `echo:${prompt}`,
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        tool_calls: [],
      })),
    }));

    const server = await createBrowserServer(agentFactory, { port: 3303, scope: '/__agent__/' });
    await server.listen();

    const replies = [];
    const channelPort = {
      postMessage: (msg) => replies.push(msg),
    };
    const body = new TextEncoder().encode(JSON.stringify({ prompt: '你好', session_id: 's-1' })).buffer;

    sw.dispatch('message', {
      data: {
        type: 'virtual-request',
        requestId: 'req-1',
        port: 3303,
        method: 'POST',
        url: '/v1/run',
        headers: { 'content-type': 'application/json' },
        body,
      },
      ports: [channelPort],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replies).toHaveLength(1);
    expect(replies[0].status).toBe(200);
    expect(JSON.parse(replies[0].body)).toEqual(expect.objectContaining({
      session_id: 's-1',
      output: 'echo:你好',
    }));

    server.close();
  });

  it('propagates real VFS delete operations into HMR full-reload', async () => {
    const vfs = withVfsEvents(new MemoryVfs());
    const client = new HmrClient({ vfs });

    client.createHotContext('/live.js').accept(() => {});
    const fullReloads = [];
    client.on('hmr:full-reload', (event) => fullReloads.push(event));

    await vfs.writeText('/live.js', 'export const live = true;');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reloadsBeforeDelete = fullReloads.length;
    await vfs.unlink('/live.js');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fullReloads.length).toBeGreaterThan(reloadsBeforeDelete);
    expect(fullReloads.at(-1)).toEqual(expect.objectContaining({ type: 'full-reload' }));
    expect(fullReloads.at(-1)?.path).toMatch(/\/?live\.js$/);

    client.dispose();
  });
});
