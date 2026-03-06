import { describe, expect, it } from 'vitest';

import { quickKernel } from '../../js/agents/core/index.js';

describe('agents basic flow e2e', () => {
  it('runs an RPC round trip through kernel.messageBus and event bus', async () => {
    const kernel = await quickKernel('minimal', { keepHistory: true });

    try {
      const handled = [];
      kernel.messageBus.on('rpc:echo', async (payload, evt) => {
        handled.push({ payload, name: evt.name });
        return {
          echo: payload.text,
          traceId: payload.traceId || null,
        };
      });

      const result = await kernel.messageBus.request(
        'rpc:echo',
        { text: 'hello-e2e', traceId: 'trace-smoke' },
        { timeoutMs: 1000 },
      );

      expect(result).toEqual({
        echo: 'hello-e2e',
        traceId: 'trace-smoke',
      });
      expect(handled).toEqual([
        {
          payload: { text: 'hello-e2e', traceId: 'trace-smoke' },
          name: 'rpc:echo',
        },
      ]);

      const history = kernel.events.getHistory();
      expect(history.some((event) => event.name === 'rpc:echo')).toBe(true);
    } finally {
      await kernel.stop();
    }
  });
});
