import { describe, it, expect } from 'vitest';
import {
  isBrowserWithDOM,
  buildEvalGuestScript,
  MSG_EVAL,
  MSG_EVAL_RESULT,
  MSG_CONSOLE,
  MSG_READY,
  createIframeEvalBridge,
} from '../../../../../js/agents/core/sandbox/iframe-eval-bridge.js';

describe('iframe-eval-bridge', () => {
  describe('isBrowserWithDOM', () => {
    it('returns false in Node.js environment', () => {
      expect(isBrowserWithDOM()).toBe(false);
    });
  });

  describe('buildEvalGuestScript', () => {
    it('returns a string containing message handler', () => {
      const script = buildEvalGuestScript();
      expect(typeof script).toBe('string');
      expect(script).toContain('addEventListener');
      expect(script).toContain(MSG_EVAL);
      expect(script).toContain(MSG_EVAL_RESULT);
      expect(script).toContain(MSG_CONSOLE);
      expect(script).toContain(MSG_READY);
    });

    it('intercepts console methods', () => {
      const script = buildEvalGuestScript();
      expect(script).toContain("'log'");
      expect(script).toContain("'warn'");
      expect(script).toContain("'error'");
    });
  });

  describe('message constants', () => {
    it('exports correct message types', () => {
      expect(MSG_EVAL).toBe('iframe-eval:eval');
      expect(MSG_EVAL_RESULT).toBe('iframe-eval:result');
      expect(MSG_CONSOLE).toBe('iframe-eval:console');
      expect(MSG_READY).toBe('iframe-eval:ready');
    });
  });

  describe('createIframeEvalBridge', () => {
    it('throws in Node.js environment (no DOM)', () => {
      expect(() => createIframeEvalBridge()).toThrow('DOM environment');
    });

    it('throws with custom config in Node.js', () => {
      expect(() => createIframeEvalBridge({ timeout: 5000 })).toThrow('DOM environment');
    });

    it('waits for ready handshake and validates source/session before resolving', async () => {
      const originalWindow = globalThis.window;
      const originalDocument = globalThis.document;
      const originalBlob = globalThis.Blob;
      const originalUrl = globalThis.URL;
      const originalLocation = globalThis.location;
      const originalCrypto = globalThis.crypto;

      try {
        const setGlobal = (key, value) => {
          Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
          });
        };
        /** @type {(event: any) => void} */
        let onMessage = null;
        const listeners = new Map();
        const iframeWindow = { postMessage: () => {} };
        const postMessageSpy = (payload) => {
          postMessageSpy.calls.push(payload);
        };
        postMessageSpy.calls = [];
        iframeWindow.postMessage = postMessageSpy;

        setGlobal('window', {
          addEventListener: (name, fn) => {
            listeners.set(name, fn);
            if (name === 'message') onMessage = fn;
          },
          removeEventListener: (name) => {
            listeners.delete(name);
          },
        });
        setGlobal('document', {
          createElement: () => ({
            sandbox: '',
            style: {},
            src: '',
            contentWindow: iframeWindow,
            remove: () => {},
          }),
          body: { appendChild: () => {} },
        });
        class FakeBlob {
          constructor(parts) {
            this.parts = parts;
          }
        }
        setGlobal('Blob', FakeBlob);
        setGlobal('URL', {
          createObjectURL: () => 'blob:mock',
          revokeObjectURL: () => {},
        });
        setGlobal('location', { origin: 'https://example.test' });
        setGlobal('crypto', { randomUUID: () => 'uuid' });

        const bridge = createIframeEvalBridge({
          timeout: 50,
          readyTimeout: 200,
          sessionIdFactory: () => 'sess-1',
          allowedOrigins: ['null'],
        });

        const pendingEval = bridge.evaluate('1 + 1', 'main.js');
        await Promise.resolve();
        expect(postMessageSpy.calls).toHaveLength(0);

        onMessage?.({
          data: { type: MSG_READY, session: 'sess-1' },
          source: {},
          origin: 'null',
        });
        await Promise.resolve();
        expect(postMessageSpy.calls).toHaveLength(0);

        onMessage?.({
          data: { type: MSG_READY, session: 'wrong-session' },
          source: iframeWindow,
          origin: 'null',
        });
        await Promise.resolve();
        expect(postMessageSpy.calls).toHaveLength(0);

        onMessage?.({
          data: { type: MSG_READY, session: 'sess-1' },
          source: iframeWindow,
          origin: 'null',
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(postMessageSpy.calls).toHaveLength(1);
        expect(postMessageSpy.calls[0]).toMatchObject({ type: MSG_EVAL, session: 'sess-1' });

        onMessage?.({
          data: { type: MSG_EVAL_RESULT, id: 1, ok: true, value: 'bad', session: 'sess-1' },
          source: {},
          origin: 'null',
        });
        await Promise.resolve();

        onMessage?.({
          data: { type: MSG_EVAL_RESULT, id: 1, ok: true, value: 2, session: 'sess-1' },
          source: iframeWindow,
          origin: 'null',
        });

        await expect(pendingEval).resolves.toEqual({ ok: true, value: 2, error: undefined });
        bridge.dispose();
      } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else Object.defineProperty(globalThis, 'window', originalWindow);
        if (originalDocument === undefined) delete globalThis.document;
        else Object.defineProperty(globalThis, 'document', originalDocument);
        if (originalBlob === undefined) delete globalThis.Blob;
        else Object.defineProperty(globalThis, 'Blob', originalBlob);
        if (originalUrl === undefined) delete globalThis.URL;
        else Object.defineProperty(globalThis, 'URL', originalUrl);
        if (originalLocation === undefined) delete globalThis.location;
        else Object.defineProperty(globalThis, 'location', originalLocation);
        if (originalCrypto === undefined) delete globalThis.crypto;
        else Object.defineProperty(globalThis, 'crypto', originalCrypto);
      }
    });
  });
});
