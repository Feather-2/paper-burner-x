import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sandbox-interface before importing the module under test.
vi.mock(
  '../../../../../js/agents/core/sandbox/sandbox-interface.js',
  () => ({
    SANDBOX_LEVELS: ['wasm', 'worker', 'iframe', 'main'],
    AUTO_PRIORITY: ['wasm', 'iframe', 'worker', 'main'],
    DEFAULT_CONFIG: {
      level: 'auto',
      vfs: null,
      capabilities: [],
      timeout: 30000,
      cwd: '/',
      env: {},
      onConsole: null,
      mainThreadFallback: true,
    },
    validateConfig(config) {
      const base = {
        level: 'auto',
        vfs: null,
        capabilities: [],
        timeout: 30000,
        cwd: '/',
        env: {},
        onConsole: null,
        mainThreadFallback: true,
      };
      return { ...base, ...config };
    },
  })
);

// Mock skill-executor-helpers (isWasmSupported).
let wasmSupported = false;
vi.mock(
  '../../../../../js/agents/core/sandbox/skill-executor-helpers.js',
  () => ({
    isWasmSupported: vi.fn(async () => wasmSupported),
  })
);

// Mock wasm-sandbox.js so we never need real QuickJS.
vi.mock(
  '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
  () => ({
    createSandbox: vi.fn(async () => ({
      execute: vi.fn(async () => ({ success: true, data: 42 })),
      dispose: vi.fn(),
    })),
  })
);

const { createSandboxFactory } = await import(
  '../../../../../js/agents/core/sandbox/create-sandbox.js'
);

describe('createSandboxFactory', () => {
  beforeEach(() => {
    wasmSupported = false;
    vi.clearAllMocks();
  });

  // 1. Returns a valid Sandbox interface
  it('returns an object with the Sandbox interface', async () => {
    const sb = await createSandboxFactory({ level: 'main' });
    expect(sb).toHaveProperty('level');
    expect(sb).toHaveProperty('execute');
    expect(sb).toHaveProperty('runFile');
    expect(sb).toHaveProperty('terminate');
    expect(typeof sb.terminated).toBe('boolean');
  });

  // 2. level='main' executes simple expressions
  it('level=main executes a simple expression', async () => {
    const sb = await createSandboxFactory({ level: 'main' });
    const result = await sb.execute('1 + 2');
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);
    expect(typeof result.durationMs).toBe('number');
  });

  // 3. level='main' returns ok:false on error
  it('level=main returns ok:false on execution error', async () => {
    const sb = await createSandboxFactory({ level: 'main' });
    const result = await sb.execute('(function(){ throw new Error("boom") })()');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
    expect(typeof result.durationMs).toBe('number');
  });

  // 4. terminate prevents further execution
  it('throws after terminate', async () => {
    const sb = await createSandboxFactory({ level: 'main' });
    expect(sb.terminated).toBe(false);
    await sb.terminate();
    expect(sb.terminated).toBe(true);
    await expect(sb.execute('1')).rejects.toThrow('Sandbox terminated');
  });

  // 5. runFile reads from VFS then executes
  it('runFile reads from VFS and executes', async () => {
    const vfs = { readText: vi.fn(async () => '10 * 5') };
    const sb = await createSandboxFactory({ level: 'main', vfs });
    const result = await sb.runFile('/test.js');
    expect(vfs.readText).toHaveBeenCalledWith('/test.js');
    expect(result.ok).toBe(true);
    expect(result.value).toBe(50);
  });

  // 5b. runFile throws when no VFS configured
  it('runFile throws without VFS', async () => {
    const sb = await createSandboxFactory({ level: 'main', vfs: null });
    await expect(sb.runFile('/x.js')).rejects.toThrow('No VFS configured');
  });

  // 6. auto mode degrades to available level
  it('auto mode falls back to main when others unavailable', async () => {
    wasmSupported = false;
    const sb = await createSandboxFactory({ level: 'auto' });
    expect(sb.level).toBe('main');
    const r = await sb.execute('42');
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  // 7. invalid level throws
  it('throws on invalid level', async () => {
    await expect(createSandboxFactory({ level: 'bogus' })).rejects.toThrow('Unknown sandbox level');
  });

  // 8. mainThreadFallback=false rejects main level
  it('rejects main level when mainThreadFallback is false', async () => {
    await expect(
      createSandboxFactory({ level: 'main', mainThreadFallback: false })
    ).rejects.toThrow('Main-thread sandbox disabled');
  });

  // 9. iframe stub throws
  it('iframe level throws not-implemented', async () => {
    await expect(
      createSandboxFactory({ level: 'iframe' })
    ).rejects.toThrow('iframe sandbox not yet implemented');
  });

  // 10. double terminate is idempotent
  it('double terminate is safe', async () => {
    const sb = await createSandboxFactory({ level: 'main' });
    await sb.terminate();
    await sb.terminate(); // should not throw
    expect(sb.terminated).toBe(true);
  });
});
