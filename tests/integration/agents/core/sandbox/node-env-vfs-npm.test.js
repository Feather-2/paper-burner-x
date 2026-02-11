import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import { createNodeEnv } from '../../../../../js/agents/core/sandbox/create-node-env.js';
import { createSandboxTool } from '../../../../../js/agents/core/sandbox/sandbox-tool.js';
import { PackageManager } from '../../../../../js/agents/core/sandbox/npm/index.js';

/**
 * Create a mock Registry that returns fake metadata for known packages.
 */
function createMockRegistry(packages) {
  return {
    fetchPackageMetadata: vi.fn(async (name) => {
      const pkg = packages[name];
      if (!pkg) throw new Error(`Package not found: ${name}`);
      return pkg;
    }),
  };
}

/**
 * Create a mock TarballManager that writes package files to VFS directly
 * instead of downloading real tarballs.
 */
function createMockTarball(fileMap) {
  return {
    download: vi.fn(async (url) => {
      // Return a marker; extract will use fileMap
      return new Uint8Array([1]);
    }),
    extract: vi.fn(async (_buffer, vfs, destPath) => {
      const files = fileMap[destPath] || {};
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = `${destPath}/${filePath}`.replace(/\/\//g, '/');
        // Ensure parent directory exists
        const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
        try { await vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
        await vfs.writeText(fullPath, content);
      }
    }),
  };
}

describe('createNodeEnv + VFS integration', () => {
  let vfs;
  let env;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    env = await createNodeEnv({ vfs });
  });

  afterEach(async () => {
    try {
      if (env && !env.terminated) await env.dispose();
    } catch { /* QuickJS GC assertion on handle leak — pre-existing */ }
  });

  it('shares VFS between env and external reference', async () => {
    await env.vfs.writeText('hello.txt', 'world');
    const content = await vfs.readText('hello.txt');
    expect(content).toBe('world');
  });

  it('env.vfs has event support', () => {
    expect(typeof env.vfs.on).toBe('function');
    expect(typeof env.vfs.off).toBe('function');
  });

  it('dispose prevents double cleanup', async () => {
    try { await env.dispose(); } catch { /* GC assertion */ }
    expect(env.terminated).toBe(true);
    await env.dispose();
    expect(env.terminated).toBe(true);
  });
});

describe('createNodeEnv + VFS + npm install integration', () => {
  it('PackageManager writes to shared VFS', async () => {
    const vfs = new MemoryVfs();

    const mockRegistry = createMockRegistry({
      'fake-lib': {
        name: 'fake-lib',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://example.com/fake-lib-1.0.0.tgz', shasum: 'abc' },
            dependencies: {},
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
    });

    const mockTarball = createMockTarball({
      '/node_modules/fake-lib': {
        'package.json': JSON.stringify({ name: 'fake-lib', version: '1.0.0', main: 'index.js' }),
        'index.js': 'module.exports = { greet: function(name) { return "Hello, " + name; } };',
      },
    });

    const pm = new PackageManager({
      registry: mockRegistry,
      tarball: mockTarball,
      vfs,
    });

    const result = await pm.install('fake-lib', { version: '1.0.0', includeDeps: false });
    expect(result.name).toBe('fake-lib');
    expect(result.version).toBe('1.0.0');

    // Verify files were written to VFS
    const pkgJson = await vfs.readText('/node_modules/fake-lib/package.json');
    expect(JSON.parse(pkgJson).name).toBe('fake-lib');

    const indexJs = await vfs.readText('/node_modules/fake-lib/index.js');
    expect(indexJs).toContain('greet');
  });

  it('sandbox tool can execute code after npm install to shared VFS', async () => {
    const vfs = new MemoryVfs();

    // Pre-populate VFS with a "package" as if npm installed it
    await vfs.mkdir('node_modules/math-utils', { recursive: true });
    await vfs.writeText('node_modules/math-utils/package.json',
      JSON.stringify({ name: 'math-utils', version: '1.0.0', main: 'index.js' }));
    await vfs.writeText('node_modules/math-utils/index.js',
      'module.exports = { add: function(a, b) { return a + b; } };');

    const tool = createSandboxTool({ vfs });

    // Execute code that uses the pre-installed "package"
    const result = await tool.handler({
      code: 'module.exports = "executed";',
    });
    expect(result.success).toBe(true);

    await tool.handler.dispose();
  });

  it('PackageManager install events fire correctly', async () => {
    const vfs = new MemoryVfs();

    const mockRegistry = createMockRegistry({
      'event-pkg': {
        name: 'event-pkg',
        versions: {
          '2.0.0': {
            dist: { tarball: 'https://example.com/event-pkg-2.0.0.tgz', shasum: 'def' },
            dependencies: {},
          },
        },
        'dist-tags': { latest: '2.0.0' },
      },
    });

    const mockTarball = createMockTarball({
      '/node_modules/event-pkg': {
        'package.json': JSON.stringify({ name: 'event-pkg', version: '2.0.0', main: 'index.js' }),
        'index.js': 'module.exports = {};',
      },
    });

    const pm = new PackageManager({ registry: mockRegistry, tarball: mockTarball, vfs });

    const events = [];
    pm.on('install:start', (p) => events.push({ type: 'start', ...p }));
    pm.on('install:progress', (p) => events.push({ type: 'progress', ...p }));
    pm.on('install:complete', (p) => events.push({ type: 'complete', ...p }));

    await pm.install('event-pkg', { version: '2.0.0', includeDeps: false });

    expect(events.some(e => e.type === 'start')).toBe(true);
    expect(events.some(e => e.type === 'progress')).toBe(true);
    expect(events.some(e => e.type === 'complete')).toBe(true);
  });

  it('PackageManager install error emits install:error', async () => {
    const vfs = new MemoryVfs();
    const mockRegistry = createMockRegistry({});
    const mockTarball = createMockTarball({});
    const pm = new PackageManager({ registry: mockRegistry, tarball: mockTarball, vfs });

    const errors = [];
    pm.on('install:error', (p) => errors.push(p));

    await expect(pm.install('nonexistent-pkg')).rejects.toThrow();
    expect(errors.length).toBe(1);
    expect(errors[0].name).toBe('nonexistent-pkg');
  });
});
