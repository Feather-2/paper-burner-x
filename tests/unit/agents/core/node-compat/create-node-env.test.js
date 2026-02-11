import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';

// Mock createSandbox to avoid WASM dependency
const mockSandbox = {
  execute: vi.fn().mockResolvedValue({ success: true, data: 42, metrics: {} }),
  dispose: vi.fn(),
  _disposed: false,
};

vi.mock(
  '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
  () => ({
    createSandbox: vi.fn().mockResolvedValue(mockSandbox),
    WasmSandbox: class {},
    default: class {},
  }),
);

const { createNodeEnv } = await import(
  '../../../../../js/agents/core/node-compat/create-node-env.js'
);

describe('create-node-env', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSandbox.execute.mockResolvedValue({ success: true, data: 42, metrics: {} });
    mockSandbox._disposed = false;
  });

  // 1. Default config returns all expected properties
  it('returns vfs, sandbox, execute, runFile, dispose', async () => {
    const env = await createNodeEnv();
    expect(env).toHaveProperty('vfs');
    expect(env).toHaveProperty('sandbox');
    expect(typeof env.execute).toBe('function');
    expect(typeof env.runFile).toBe('function');
    expect(typeof env.dispose).toBe('function');
  });

  // 2. execute delegates to sandbox
  it('execute runs code through sandbox', async () => {
    const env = await createNodeEnv();
    const result = await env.execute('1 + 1');
    expect(result).toEqual({ success: true, data: 42, metrics: {} });
    expect(mockSandbox.execute).toHaveBeenCalledWith('1 + 1', {});
  });

  // 3. External VFS is used when provided
  it('uses external VFS when provided', async () => {
    const extVfs = new MemoryVfs();
    const env = await createNodeEnv({ vfs: extVfs });
    // The wrapped vfs should proxy to our external instance
    await env.vfs.writeText('test.txt', 'hello');
    const content = await extVfs.readText('test.txt');
    expect(content).toBe('hello');
  });

  // 4. dispose sets terminated to true
  it('dispose marks environment as terminated', async () => {
    const env = await createNodeEnv();
    expect(env.terminated).toBe(false);
    await env.dispose();
    expect(env.terminated).toBe(true);
    expect(mockSandbox.dispose).toHaveBeenCalled();
  });

  // 5. VFS supports events (has on/off methods)
  it('vfs supports event methods on/off', async () => {
    const env = await createNodeEnv();
    expect(typeof env.vfs.on).toBe('function');
    expect(typeof env.vfs.off).toBe('function');
    expect(typeof env.vfs.removeAllListeners).toBe('function');
  });

  // 6. runFile reads from VFS and executes
  it('runFile reads file from VFS and executes content', async () => {
    const env = await createNodeEnv();
    await env.vfs.writeText('script.js', 'console.log("hi")');
    await env.runFile('script.js');
    expect(mockSandbox.execute).toHaveBeenCalledWith(
      'console.log("hi")',
      { __filename: 'script.js' },
    );
  });
});
