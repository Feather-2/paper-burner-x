import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('asyncify-support', () => {
  describe('getQuickJS fallback chain', () => {
    it('loads async variant first and sets _isAsyncModule = true', async () => {
      const fakeModule = { newRuntime: vi.fn() };
      vi.doMock('quickjs-emscripten', () => ({
        newQuickJSAsyncWASMModule: vi.fn(async () => fakeModule),
        getQuickJS: vi.fn(async () => { throw new Error('should not be called'); }),
      }));

      const { isAsyncifyEnabled, WasmSandbox } = await import('../wasm-sandbox.js');
      const sandbox = new WasmSandbox();

      // Force getQuickJS via init (will fail at newRuntime, but module is loaded)
      try { await sandbox.init(); } catch { /* expected - fake module */ }

      expect(isAsyncifyEnabled()).toBe(true);
    });

    it('falls back to sync getQuickJS when async variant throws', async () => {
      const fakeModule = { newRuntime: vi.fn() };
      vi.doMock('quickjs-emscripten', () => ({
        newQuickJSAsyncWASMModule: vi.fn(async () => { throw new Error('no asyncify'); }),
        getQuickJS: vi.fn(async () => fakeModule),
      }));

      const { isAsyncifyEnabled, WasmSandbox } = await import('../wasm-sandbox.js');
      const sandbox = new WasmSandbox();
      try { await sandbox.init(); } catch { /* expected */ }

      expect(isAsyncifyEnabled()).toBe(false);
    });

    it('falls back to quickjs-emscripten-core when quickjs-emscripten unavailable', async () => {
      const fakeModule = { newRuntime: vi.fn() };
      vi.doMock('quickjs-emscripten', () => {
        throw new Error('module not found');
      });
      vi.doMock('quickjs-emscripten-core', () => ({
        newQuickJSWASMModule: vi.fn(async () => fakeModule),
      }));

      const { isAsyncifyEnabled, WasmSandbox } = await import('../wasm-sandbox.js');
      const sandbox = new WasmSandbox();
      try { await sandbox.init(); } catch { /* expected */ }

      expect(isAsyncifyEnabled()).toBe(false);
    });

    it('throws when all loading paths fail', async () => {
      vi.doMock('quickjs-emscripten', () => {
        throw new Error('not found');
      });
      vi.doMock('quickjs-emscripten-core', () => {
        throw new Error('not found');
      });

      const { WasmSandbox } = await import('../wasm-sandbox.js');
      const sandbox = new WasmSandbox();
      await expect(sandbox.init()).rejects.toThrow('WASM sandbox requires quickjs-emscripten');
    });
  });

  describe('asyncMode property', () => {
    it('returns "asyncify" when async module loaded', async () => {
      const fakeModule = { newRuntime: vi.fn() };
      vi.doMock('quickjs-emscripten', () => ({
        newQuickJSAsyncWASMModule: vi.fn(async () => fakeModule),
      }));

      const { WasmSandbox } = await import('../wasm-sandbox.js');
      const sandbox = new WasmSandbox();
      try { await sandbox.init(); } catch { /* expected */ }

      expect(sandbox.asyncMode).toBe('asyncify');
    });

    it('returns "polling" when sync module loaded', async () => {
      const fakeModule = { newRuntime: vi.fn() };
      vi.doMock('quickjs-emscripten', () => ({
        newQuickJSAsyncWASMModule: vi.fn(async () => { throw new Error('no'); }),
        getQuickJS: vi.fn(async () => fakeModule),
      }));

      const { WasmSandbox } = await import('../wasm-sandbox.js');
      const sandbox = new WasmSandbox();
      try { await sandbox.init(); } catch { /* expected */ }

      expect(sandbox.asyncMode).toBe('polling');
    });
  });

  describe('isAsyncifyEnabled export', () => {
    it('is exported and returns boolean', async () => {
      vi.doMock('quickjs-emscripten', () => {
        throw new Error('not found');
      });
      vi.doMock('quickjs-emscripten-core', () => {
        throw new Error('not found');
      });

      const { isAsyncifyEnabled } = await import('../wasm-sandbox.js');
      expect(typeof isAsyncifyEnabled).toBe('function');
      expect(typeof isAsyncifyEnabled()).toBe('boolean');
    });
  });
});