import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../../js/agents/core/message-bus.js', () => {
  class MessageBus {
    constructor() {
      this._handlers = new Map();
      this.disposed = false;
    }
    on(type, handler) {
      this._handlers.set(type, handler);
      return () => { this._handlers.delete(type); };
    }
    async request(type, payload, options = {}) {
      const handler = this._handlers.get(type);
      if (!handler) throw new Error(`No handler for ${type}`);
      const result = await handler(payload);
      return { ok: true, data: result };
    }
    dispose() { this.disposed = true; }
  }
  return { MessageBus };
});

vi.mock('../../../../../js/agents/core/event-bus.js', () => {
  class EventBus {
    constructor() { this.disposed = false; }
    dispose() { this.disposed = true; }
  }
  return { EventBus };
});

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 ? s : null;
  },
}));

import { StageRpcBridge, createStageRpcBridge } from '../../../../../js/agents/runtime/core/stage-rpc-bridge.js';

describe('StageRpcBridge', () => {
  /** @type {StageRpcBridge} */
  let bridge;

  beforeEach(() => {
    bridge = new StageRpcBridge({ stageId: 'test-stage' });
  });

  afterEach(() => {
    bridge.dispose();
  });

  describe('registerHandler', () => {
    it('registers a handler and returns ok', () => {
      const result = bridge.registerHandler('codesearch:search', async () => 'found');
      expect(result.ok).toBe(true);
      expect(bridge.getEndpoints()).toContain('codesearch:search');
    });

    it('rejects missing endpoint', () => {
      expect(bridge.registerHandler('', () => {}).ok).toBe(false);
      expect(bridge.registerHandler(null, () => {}).ok).toBe(false);
    });

    it('rejects non-function handler', () => {
      expect(bridge.registerHandler('a:b', 'not-fn').ok).toBe(false);
    });

    it('replaces existing handler', () => {
      bridge.registerHandler('a:b', async () => 'v1');
      bridge.registerHandler('a:b', async () => 'v2');
      expect(bridge.getEndpoints()).toEqual(['a:b']);
    });
  });

  describe('request', () => {
    it('sends request and receives response', async () => {
      bridge.registerHandler('codesearch:search', async (payload) => {
        return { results: [payload] };
      });
      const result = await bridge.request('codesearch:search', { query: 'foo' });
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns error for missing endpoint', async () => {
      const result = await bridge.request('', null);
      expect(result.ok).toBe(false);
    });

    it('returns error when no handler registered', async () => {
      const result = await bridge.request('missing:endpoint', {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No handler');
    });
  });

  describe('createClient', () => {
    it('creates scoped client', async () => {
      bridge.registerHandler('deepsearch:query', async (p) => ({ answer: p }));
      const client = bridge.createClient('deepsearch');
      const result = await client.request('deepsearch:query', 'test');
      expect(result.ok).toBe(true);
    });
  });

  describe('dispose', () => {
    it('rejects operations after dispose', () => {
      bridge.dispose();
      expect(bridge.registerHandler('a:b', () => {}).ok).toBe(false);
    });

    it('rejects requests after dispose', async () => {
      bridge.dispose();
      const result = await bridge.request('a:b', {});
      expect(result.ok).toBe(false);
    });

    it('clears handlers on dispose', () => {
      bridge.registerHandler('a:b', () => {});
      bridge.dispose();
      expect(bridge.getEndpoints()).toEqual([]);
    });
  });

  describe('createStageRpcBridge factory', () => {
    it('creates bridge with defaults', () => {
      const b = createStageRpcBridge({ stageId: 'factory-test' });
      expect(b).toBeInstanceOf(StageRpcBridge);
      b.dispose();
    });
  });
});
