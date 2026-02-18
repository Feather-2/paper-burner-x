import { describe, it, expect } from 'vitest';
import {
  MSG_EXECUTE,
  MSG_READY,
  MSG_RESULT,
  buildGuestScript,
  createIframeSandbox,
} from '../../../../../js/agents/core/sandbox/iframe-sandbox.js';

describe('iframe-sandbox', () => {
  describe('buildGuestScript', () => {
    it('returns a non-empty string', () => {
      const script = buildGuestScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('contains message event listener', () => {
      const script = buildGuestScript();
      expect(script).toContain('addEventListener');
      expect(script).toContain('message');
    });

    it('contains execute message type', () => {
      const script = buildGuestScript();
      expect(script).toContain(MSG_EXECUTE);
    });

    it('contains result message type', () => {
      const script = buildGuestScript();
      expect(script).toContain(MSG_RESULT);
    });

    it('contains ready handshake message type', () => {
      const script = buildGuestScript();
      expect(script).toContain(MSG_READY);
    });

    it('contains console proxy', () => {
      const script = buildGuestScript();
      expect(script).toContain('iframe-sandbox:console');
      expect(script).toContain('console');
    });

    it('uses eval for code execution', () => {
      const script = buildGuestScript();
      expect(script).toContain('eval');
    });
  });

  describe('createIframeSandbox', () => {
    it('throws in Node.js environment (no DOM)', () => {
      expect(() => createIframeSandbox()).toThrow('DOM environment');
    });

    it('throws with custom config in Node.js', () => {
      expect(() => createIframeSandbox({ timeout: 5000 })).toThrow('DOM environment');
    });

    it('waits for ready handshake and ignores untrusted message sources', async () => {
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
        const iframeWindow = { postMessage: () => {} };
        const postMessageCalls = [];
        iframeWindow.postMessage = (payload) => {
          postMessageCalls.push(payload);
        };

        setGlobal('window', {
          addEventListener: (name, fn) => {
            if (name === 'message') onMessage = fn;
          },
          removeEventListener: () => {},
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
        setGlobal('Blob', class FakeBlob {
          constructor(parts) {
            this.parts = parts;
          }
        });
        setGlobal('URL', {
          createObjectURL: () => 'blob:mock',
          revokeObjectURL: () => {},
        });
        setGlobal('location', { origin: 'https://example.test' });
        setGlobal('crypto', { randomUUID: () => 'uuid' });

        const sandbox = createIframeSandbox({
          timeout: 100,
          readyTimeout: 200,
          sessionIdFactory: () => 'sandbox-session',
          allowedOrigins: ['null'],
        });

        const pending = sandbox.execute('1 + 1');
        await Promise.resolve();
        expect(postMessageCalls).toHaveLength(0);

        onMessage?.({
          data: { type: MSG_READY, session: 'sandbox-session' },
          source: {},
          origin: 'null',
        });
        await Promise.resolve();
        expect(postMessageCalls).toHaveLength(0);

        onMessage?.({
          data: { type: MSG_READY, session: 'sandbox-session' },
          source: iframeWindow,
          origin: 'null',
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(postMessageCalls).toHaveLength(1);
        expect(postMessageCalls[0]).toMatchObject({ type: MSG_EXECUTE, session: 'sandbox-session' });

        onMessage?.({
          data: { type: MSG_RESULT, id: 1, ok: true, value: 'wrong', session: 'sandbox-session' },
          source: {},
          origin: 'null',
        });
        await Promise.resolve();

        onMessage?.({
          data: { type: MSG_RESULT, id: 1, ok: true, value: 2, session: 'sandbox-session' },
          source: iframeWindow,
          origin: 'null',
        });

        await expect(pending).resolves.toMatchObject({ ok: true, value: 2 });
        sandbox.terminate();
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
