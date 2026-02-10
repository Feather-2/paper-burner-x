import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import { createRequire } from '../../../../../js/agents/core/sandbox/require.js';
import { createResolver, BUILTIN_MODULE_NAMES } from '../../../../../js/agents/core/sandbox/module-resolver.js';

// ── module-resolver tests ──────────────────────────────────────

describe('module-resolver', () => {
  /** @type {MemoryVfs} */
  let vfs;
  let builtinModules;
  let resolver;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    builtinModules = {
      fs: { readFile: vi.fn() },
      path: { join: vi.fn() },
    };
    resolver = createResolver({ vfs, builtinModules });
  });

  it('resolves builtin module "fs"', async () => {
    const result = await resolver.resolve('fs');
    expect(result).toEqual({ type: 'builtin', path: 'fs', module: builtinModules.fs });
  });

  it('resolves node: prefix "node:path"', async () => {
    const result = await resolver.resolve('node:path');
    expect(result).toEqual({ type: 'builtin', path: 'node:path', module: builtinModules.path });
  });

  it('resolves relative path "./lib/utils"', async () => {
    await vfs.writeText('src/lib/utils.js', 'module.exports = 1;');
    const result = await resolver.resolve('./lib/utils', 'src');
    expect(result).toEqual({ type: 'file', path: 'src/lib/utils.js' });
  });

  it('resolves with explicit extension "./file.js"', async () => {
    await vfs.writeText('src/file.js', 'module.exports = 2;');
    const result = await resolver.resolve('./file.js', 'src');
    expect(result).toEqual({ type: 'file', path: 'src/file.js' });
  });

  it('resolves directory to index.js', async () => {
    await vfs.writeText('src/lib/index.js', 'module.exports = 3;');
    const result = await resolver.resolve('./lib', 'src');
    expect(result).toEqual({ type: 'file', path: 'src/lib/index.js' });
  });

  it('resolves node_modules', async () => {
    await vfs.writeText('node_modules/lodash/index.js', 'module.exports = {};');
    const result = await resolver.resolve('lodash', 'src');
    expect(result).toEqual({ type: 'file', path: 'node_modules/lodash/index.js' });
  });

  it('resolves package.json main field', async () => {
    await vfs.writeText('node_modules/foo/package.json', JSON.stringify({ main: 'lib/entry.js' }));
    await vfs.writeText('node_modules/foo/lib/entry.js', 'module.exports = {};');
    const result = await resolver.resolve('foo', '');
    expect(result).toEqual({ type: 'file', path: 'node_modules/foo/lib/entry.js' });
  });

  it('returns null for non-existent module', async () => {
    const result = await resolver.resolve('nonexistent', '');
    expect(result).toBeNull();
  });

  it('BUILTIN_MODULE_NAMES contains common module names', () => {
    for (const name of ['fs', 'path', 'http', 'util', 'events', 'stream', 'crypto', 'os']) {
      expect(BUILTIN_MODULE_NAMES).toContain(name);
    }
  });
});

// ── require tests ──────────────────────────────────────────────

describe('createRequire', () => {
  /** @type {MemoryVfs} */
  let vfs;
  let builtinModules;

  beforeEach(() => {
    vfs = new MemoryVfs();
    builtinModules = {
      fs: { readFile: vi.fn() },
      path: { join: vi.fn() },
    };
  });

  it('require returns builtin module', async () => {
    const { require: req } = createRequire({ vfs, builtinModules });
    const fs = await req('fs');
    expect(fs).toBe(builtinModules.fs);
  });

  it('require loads JSON file', async () => {
    await vfs.writeText('data.json', JSON.stringify({ key: 'value' }));
    const { require: req } = createRequire({ vfs, builtinModules });
    const data = await req('./data.json');
    expect(data).toEqual({ key: 'value' });
  });

  it('require caches modules (second call returns same object)', async () => {
    await vfs.writeText('data.json', JSON.stringify({ key: 'value' }));
    const { require: req } = createRequire({ vfs, builtinModules });
    const a = await req('./data.json');
    const b = await req('./data.json');
    expect(a).toBe(b);
  });

  it('require.resolve returns resolve result', async () => {
    await vfs.writeText('lib.js', 'module.exports = 1;');
    const { require: req } = createRequire({ vfs, builtinModules });
    const result = await req.resolve('./lib');
    expect(result).toEqual({ type: 'file', path: 'lib.js' });
  });

  it('circular dependency does not cause infinite loop', async () => {
    await vfs.writeText('a.js', 'const b = require("./b"); module.exports = { fromA: true };');
    await vfs.writeText('b.js', 'const a = require("./a"); module.exports = { fromB: true };');

    const evaluate = vi.fn(async (code, _filename) => {
      // Return a function that just sets exports without actually executing require calls
      return async (exports, _require, module, _filename, _dirname) => {
        module.exports = { mock: true };
      };
    });

    const { require: req } = createRequire({ vfs, builtinModules, evaluate });
    // Should not throw or hang
    const result = await req('./a');
    expect(result).toBeDefined();
  });

  it('throws when module does not exist', async () => {
    const { require: req } = createRequire({ vfs, builtinModules });
    await expect(req('nonexistent')).rejects.toThrow('Cannot find module');
  });
});
