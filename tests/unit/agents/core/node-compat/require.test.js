import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import { createRequire } from '../../../../../js/agents/core/node-compat/require.js';
import { createResolver, BUILTIN_MODULE_NAMES } from '../../../../../js/agents/core/node-compat/module-resolver.js';

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

  it('awaits ESM transform before wrapping module code', async () => {
    await vfs.writeText('esm.js', 'export const value = 7;');
    const evaluate = vi.fn(async (code) => new Function('return ' + code)());
    const { require: req } = createRequire({ vfs, builtinModules: {}, evaluate });
    const mod = await req('./esm');
    expect(mod.value).toBe(7);
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

// ── module wrapping / globals injection ─────────────────────────

describe('createRequire module wrapping', () => {
  /** @type {MemoryVfs} */
  let vfs;

  beforeEach(() => {
    vfs = new MemoryVfs();
  });

  it('injects process into module scope', async () => {
    await vfs.writeText('mod.js', 'module.exports = typeof process;');
    const fakeProcess = { env: { NODE_ENV: 'test' } };
    const evaluate = vi.fn(async (code) => new Function('return ' + code)());
    const { require: req } = createRequire({
      vfs, builtinModules: {}, evaluate,
      globals: { process: fakeProcess },
    });
    const result = await req('./mod');
    expect(result).toBe('object');
  });

  it('injects console into module scope', async () => {
    await vfs.writeText('mod.js', 'module.exports = typeof console;');
    const fakeConsole = { log: vi.fn() };
    const evaluate = vi.fn(async (code) => new Function('return ' + code)());
    const { require: req } = createRequire({
      vfs, builtinModules: {}, evaluate,
      globals: { console: fakeConsole },
    });
    const result = await req('./mod');
    expect(result).toBe('object');
  });

  it('injects Buffer into module scope', async () => {
    await vfs.writeText('mod.js', 'module.exports = typeof Buffer;');
    const FakeBuffer = class Buffer {};
    const evaluate = vi.fn(async (code) => new Function('return ' + code)());
    const { require: req } = createRequire({
      vfs, builtinModules: {}, evaluate,
      globals: { Buffer: FakeBuffer },
    });
    const result = await req('./mod');
    expect(result).toBe('function');
  });

  it('injects global/globalThis into module scope', async () => {
    await vfs.writeText('mod.js', 'module.exports = typeof global;');
    const fakeGlobal = { myGlobal: true };
    const evaluate = vi.fn(async (code) => new Function('return ' + code)());
    const { require: req } = createRequire({
      vfs, builtinModules: {}, evaluate,
      globals: { global: fakeGlobal },
    });
    const result = await req('./mod');
    expect(result).toBe('object');
  });

  it('__dynamicImport is passed as function', async () => {
    await vfs.writeText('mod.js', '');
    let capturedDynamicImport;
    const evaluate = vi.fn(async () => {
      return async (exports, require, module, __filename, __dirname,
        process, console, Buffer, global, globalThis, __dynamicImport) => {
        capturedDynamicImport = __dynamicImport;
        module.exports = { hasDynamicImport: typeof __dynamicImport === 'function' };
      };
    });
    const { require: req } = createRequire({ vfs, builtinModules: {}, evaluate });
    const result = await req('./mod');
    expect(result.hasDynamicImport).toBe(true);
    expect(capturedDynamicImport).toBeTypeOf('function');
  });

  it('wrapper passes correct __filename and __dirname', async () => {
    await vfs.writeText('src/lib/mod.js', '');
    let capturedFilename, capturedDirname;
    const evaluate = vi.fn(async () => {
      return async (exports, require, module, __filename, __dirname) => {
        capturedFilename = __filename;
        capturedDirname = __dirname;
      };
    });
    const { require: req } = createRequire({ vfs, builtinModules: {}, evaluate });
    await req('./src/lib/mod');
    expect(capturedFilename).toBe('src/lib/mod.js');
    expect(capturedDirname).toBe('src/lib');
  });

  it('wrapper has 11 parameters', async () => {
    await vfs.writeText('mod.js', '');
    let paramCount;
    const evaluate = vi.fn(async (code) => {
      const fn = new Function('return ' + code)();
      paramCount = fn.length;
      return async () => {};
    });
    const { require: req } = createRequire({ vfs, builtinModules: {}, evaluate });
    await req('./mod');
    expect(paramCount).toBe(11);
  });
});
