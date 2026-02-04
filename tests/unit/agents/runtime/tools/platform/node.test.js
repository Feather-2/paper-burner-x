import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    files: new Map(), // path -> { content: string }
    dirs: new Set(), // path
    realpathRoots: new Map(), // from -> to
    realpathErrors: new Map(), // path -> Error
  };

  const normalize = (input) => {
    if (typeof input !== 'string') return String(input);
    let p = input.replace(/\\/g, '/');
    p = p.replace(/\/+/g, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  };

  const parentDir = (input) => {
    const p = normalize(input);
    const idx = p.lastIndexOf('/');
    if (idx <= 0) return '/';
    return p.slice(0, idx) || '/';
  };

  const baseName = (input) => {
    const p = normalize(input);
    const idx = p.lastIndexOf('/');
    return idx === -1 ? p : p.slice(idx + 1);
  };

  const makeErr = (code, message) => {
    const err = new Error(message);
    err.code = code;
    return err;
  };

  const ensureDirRecursive = (dirPath) => {
    const p = normalize(dirPath);
    if (p === '/') {
      state.dirs.add('/');
      return;
    }
    const parts = p.split('/').filter(Boolean);
    let current = '';
    state.dirs.add('/');
    for (const part of parts) {
      current += `/${part}`;
      state.dirs.add(current);
    }
  };

  const resolveRealpath = (input) => {
    const p = normalize(input);

    let bestFrom = '';
    let bestTo = '';
    for (const [fromRaw, toRaw] of state.realpathRoots.entries()) {
      const from = normalize(fromRaw);
      const to = normalize(toRaw);
      if (p === from || p.startsWith(`${from}/`)) {
        if (from.length > bestFrom.length) {
          bestFrom = from;
          bestTo = to;
        }
      }
    }
    if (!bestFrom) return p;
    return normalize(bestTo + p.slice(bestFrom.length));
  };

  const fs = {
    realpath: vi.fn(async (input) => {
      const p = normalize(input);

      if (state.realpathErrors.has(p)) {
        throw state.realpathErrors.get(p);
      }
      if (!state.files.has(p) && !state.dirs.has(p)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, realpath '${p}'`);
      }
      return resolveRealpath(p);
    }),

    readFile: vi.fn(async (input, options) => {
      const p = normalize(input);

      if (state.dirs.has(p)) {
        throw makeErr('EISDIR', `EISDIR: illegal operation on a directory, readFile '${p}'`);
      }
      const record = state.files.get(p);
      if (!record) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, readFile '${p}'`);
      }

      const encoding = typeof options === 'string' ? options : options?.encoding;
      if (encoding) return record.content;
      return Buffer.from(record.content, 'utf8');
    }),

    writeFile: vi.fn(async (input, data) => {
      const p = normalize(input);

      if (state.dirs.has(p)) {
        throw makeErr('EISDIR', `EISDIR: illegal operation on a directory, writeFile '${p}'`);
      }
      const dir = parentDir(p);
      if (!state.dirs.has(dir)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, open '${p}'`);
      }

      const content =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : data == null
              ? ''
              : String(data);

      state.files.set(p, { content });
    }),

    appendFile: vi.fn(async (input, data) => {
      const p = normalize(input);

      if (state.dirs.has(p)) {
        throw makeErr('EISDIR', `EISDIR: illegal operation on a directory, appendFile '${p}'`);
      }
      const dir = parentDir(p);
      if (!state.dirs.has(dir)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, open '${p}'`);
      }

      const content =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : data == null
              ? ''
              : String(data);

      const prev = state.files.get(p)?.content ?? '';
      state.files.set(p, { content: prev + content });
    }),

    mkdir: vi.fn(async (input, options) => {
      const p = normalize(input);
      const recursive = Boolean(options?.recursive);

      if (recursive) {
        ensureDirRecursive(p);
        return;
      }

      const dir = parentDir(p);
      if (!state.dirs.has(dir)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, mkdir '${p}'`);
      }
      state.dirs.add(p);
    }),

    readdir: vi.fn(async (input, options) => {
      const p = normalize(input);
      if (!state.dirs.has(p)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, scandir '${p}'`);
      }

      const withFileTypes = Boolean(options?.withFileTypes);
      const entries = new Map(); // name -> 'file' | 'dir'

      for (const dir of state.dirs) {
        if (dir === p) continue;
        if (parentDir(dir) === p) entries.set(baseName(dir), 'dir');
      }
      for (const file of state.files.keys()) {
        if (parentDir(file) === p) entries.set(baseName(file), 'file');
      }

      const names = [...entries.keys()].sort();
      if (!withFileTypes) return names;

      return names.map((name) => {
        const kind = entries.get(name);
        return {
          name,
          isFile: () => kind === 'file',
          isDirectory: () => kind === 'dir',
          isSymbolicLink: () => false,
        };
      });
    }),

    stat: vi.fn(async (input) => {
      const p = normalize(input);
      if (state.dirs.has(p)) {
        return {
          size: 0,
          isFile: () => false,
          isDirectory: () => true,
        };
      }
      const record = state.files.get(p);
      if (!record) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, stat '${p}'`);
      }
      return {
        size: record.content.length,
        isFile: () => true,
        isDirectory: () => false,
      };
    }),

    lstat: vi.fn(async (input) => fs.stat(input)),

    access: vi.fn(async (input) => {
      const p = normalize(input);
      if (!state.dirs.has(p) && !state.files.has(p)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, access '${p}'`);
      }
    }),

    unlink: vi.fn(async (input) => {
      const p = normalize(input);
      if (!state.files.has(p)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, unlink '${p}'`);
      }
      state.files.delete(p);
    }),

    rm: vi.fn(async (input, options) => {
      const p = normalize(input);
      const recursive = Boolean(options?.recursive);

      if (state.files.has(p)) {
        state.files.delete(p);
        return;
      }
      if (!state.dirs.has(p)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, rm '${p}'`);
      }
      if (!recursive) {
        throw makeErr('ENOTEMPTY', `ENOTEMPTY: directory not empty, rm '${p}'`);
      }

      for (const file of [...state.files.keys()]) {
        if (file === p || file.startsWith(`${p}/`)) state.files.delete(file);
      }
      for (const dir of [...state.dirs]) {
        if (dir === p || dir.startsWith(`${p}/`)) state.dirs.delete(dir);
      }
      state.dirs.add('/');
    }),

    rename: vi.fn(async (from, to) => {
      const src = normalize(from);
      const dst = normalize(to);

      const record = state.files.get(src);
      if (!record) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, rename '${src}' -> '${dst}'`);
      }
      const dstDir = parentDir(dst);
      if (!state.dirs.has(dstDir)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, rename '${src}' -> '${dst}'`);
      }

      state.files.delete(src);
      state.files.set(dst, { content: record.content });
    }),

    copyFile: vi.fn(async (from, to) => {
      const src = normalize(from);
      const dst = normalize(to);

      const record = state.files.get(src);
      if (!record) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, copyFile '${src}' -> '${dst}'`);
      }
      const dstDir = parentDir(dst);
      if (!state.dirs.has(dstDir)) {
        throw makeErr('ENOENT', `ENOENT: no such file or directory, copyFile '${src}' -> '${dst}'`);
      }

      state.files.set(dst, { content: record.content });
    }),
  };

  const toNonEmptyString = vi.fn((value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  });

  const globToRegex = vi.fn((pattern) => {
    if (typeof pattern !== 'string') return /.^/;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const withDoubleStar = escaped.replace(/\\\*\\\*/g, '.*');
    const withStar = withDoubleStar.replace(/\\\*/g, '[^/]*');
    return new RegExp(withStar);
  });

  const exec = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));

  const reset = () => {
    state.files.clear();
    state.dirs.clear();
    state.realpathRoots.clear();
    state.realpathErrors.clear();
    state.dirs.add('/');
  };

  reset();

  return {
    state,
    fs,
    reset,
    normalize,
    parentDir,
    baseName,
    makeErr,
    ensureDirRecursive,
    toNonEmptyString,
    globToRegex,
    exec,
  };
});

vi.mock('node:fs/promises', () => hoisted.fs);
vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: hoisted.toNonEmptyString,
  globToRegex: hoisted.globToRegex,
}));
vi.mock('../../../../../../js/agents/runtime/core/exec/index.js', () => ({
  exec: hoisted.exec,
}));
// Force createNodeTools().glob() down the fallback path that uses our mocked
// fs + globToRegex implementation (instead of touching the real filesystem).
vi.mock('fast-glob', () => ({
  default: () => {
    throw new Error('fast-glob disabled in unit tests');
  },
}));

function addDir(dirPath) {
  hoisted.ensureDirRecursive(hoisted.normalize(dirPath));
}

function addFile(filePath, content) {
  const p = hoisted.normalize(filePath);
  addDir(hoisted.parentDir(p));
  hoisted.state.files.set(p, { content: String(content) });
}

function asString(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value && typeof value === 'object' && typeof value.toString === 'function') return value.toString('utf8');
  return String(value);
}

function extractExecInvocation(call) {
  const [a, b, c] = call ?? [];
  if (typeof a === 'string') {
    const args = Array.isArray(b) ? b : undefined;
    const options = c ?? (args ? undefined : b);
    return { command: a, args, options };
  }
  if (a && typeof a === 'object') {
    return {
      command: a.command ?? a.cmd,
      args: a.args ?? a.argv,
      options: a.options ?? a,
    };
  }
  return { command: undefined, args: undefined, options: undefined };
}

function extractTimeoutMs(invocation) {
  const o = invocation?.options;
  if (!o || typeof o !== 'object') return undefined;
  // Different exec helpers use different option names; support both.
  if (typeof o.timeoutMs === 'number') return o.timeoutMs;
  if (typeof o.timeout === 'number') return o.timeout;
  if (o.options && typeof o.options.timeoutMs === 'number') return o.options.timeoutMs;
  if (o.options && typeof o.options.timeout === 'number') return o.options.timeout;
  return undefined;
}

async function importSubject() {
  const mod = await import('../../../../../../js/agents/runtime/tools/platform/node.js');
  return mod.createNodeTools;
}

describe('createNodeTools', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    hoisted.reset();

    addDir('/base');
    hoisted.state.realpathRoots.set('/base', '/real/base');
  });

  it('defaults basePath to process.cwd()', async () => {
    const createNodeTools = await importSubject();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/base');

    const tools = await createNodeTools({ allowedCommands: ['echo'] });

    expect(cwdSpy).toHaveBeenCalledTimes(1);
    cwdSpy.mockRestore();

    expect(typeof tools).toBe('object');
    expect(typeof tools.bash).toBe('function');
    expect(typeof tools.read).toBe('function');
    expect(typeof tools.write).toBe('function');
    expect(typeof tools.list).toBe('function');
    expect(typeof tools.glob).toBe('function');
    expect(typeof tools.grep).toBe('function');
    expect(tools.platform).toBe('node');
  });

  it('falls back when basePath realpath fails', async () => {
    hoisted.state.realpathErrors.set('/base', hoisted.makeErr('EACCES', 'no access'));

    const createNodeTools = await importSubject();
    const tools = await createNodeTools({ basePath: '/base', allowedCommands: ['echo'] });

    expect(typeof tools).toBe('object');
    expect(typeof tools.bash).toBe('function');
    expect(typeof tools.read).toBe('function');
    expect(typeof tools.write).toBe('function');
    expect(typeof tools.list).toBe('function');
    expect(typeof tools.glob).toBe('function');
    expect(typeof tools.grep).toBe('function');
    expect(tools.platform).toBe('node');
  });

  it('rejects when options is null (type boundary)', async () => {
    const createNodeTools = await importSubject();
    await expect(createNodeTools(null)).rejects.toThrow();
  });

  it('blocks path traversal attempts', async () => {
    const createNodeTools = await importSubject();
    const tools = await createNodeTools({ basePath: '/base', allowedCommands: ['echo'] });

    const r1 = await tools.read({ path: '../secret.txt' });
    expect(r1.error).toBe('Path traversal detected');

    const r2 = await tools.read({ path: '..\\secret.txt' });
    expect(r2.error).toBe('Path traversal detected');

    const w1 = await tools.write({ path: '/base/../pwn.txt', content: 'x' });
    expect(w1.success).toBe(false);
    expect(w1.error).toBe('Path traversal detected');
  });

  it('reads files under basePath and rejects unsafe absolute paths', async () => {
    addFile('/base/inside.txt', 'hello');
    addDir('/outside');
    addFile('/outside/evil.txt', 'nope');

    const createNodeTools = await importSubject();
    const tools = await createNodeTools({ basePath: '/base', allowedCommands: ['echo'] });

    const inside = await tools.read({ path: 'inside.txt' });
    expect(inside.error).toBeUndefined();
    expect(inside.content).toBe('hello');

    const outside = await tools.read({ path: '/outside/evil.txt' });
    expect(outside.content).toBe('');
    expect(outside.error).toMatch(/outside/i);
    expect(
      hoisted.fs.readFile.mock.calls.some(([p]) => hoisted.normalize(p) === '/outside/evil.txt'),
    ).toBe(false);

    const insideAbs = await tools.read({ path: '/base/inside.txt' });
    expect(insideAbs.error).toBeUndefined();
    expect(insideAbs.content).toBe('hello');
  });

  it('writes new files under basePath (allowMissing) and blocks writes outside', async () => {
    addDir('/outside');

    const createNodeTools = await importSubject();
    const tools = await createNodeTools({ basePath: '/base', allowedCommands: ['echo'] });

    const writeOk = await tools.write({ path: 'new.txt', content: 'content' });
    expect(writeOk.success).toBe(true);
    expect(hoisted.state.files.get('/base/new.txt')?.content).toBe('content');

    const readBack = await tools.read({ path: 'new.txt' });
    expect(readBack.error).toBeUndefined();
    expect(readBack.content).toBe('content');

    const realpathCalls = hoisted.fs.realpath.mock.calls.map(([p]) => hoisted.normalize(p));
    expect(realpathCalls).toContain('/base/new.txt');
    expect(realpathCalls).toContain('/base');

    const writeOutside = await tools.write({ path: '/outside/new.txt', content: 'x' });
    expect(writeOutside.success).toBe(false);
    expect(hoisted.state.files.has('/outside/new.txt')).toBe(false);

    const writeMissingRoot = await tools.write({ path: '/nope/new.txt', content: 'x' });
    expect(writeMissingRoot.success).toBe(false);
    expect(hoisted.state.files.has('/nope/new.txt')).toBe(false);

    const writeEmpty = await tools.write({ path: '', content: 'x' });
    expect(writeEmpty.success).toBe(false);

    const writeUndefined = await tools.write({ path: undefined, content: 'x' });
    expect(writeUndefined.success).toBe(false);
  });

  it('supports concurrent writes and large/deep-path content', async () => {
    const createNodeTools = await importSubject();
    const tools = await createNodeTools({ basePath: '/base', allowedCommands: ['echo'] });

    const big = 'x'.repeat(1024 * 1024 + 7);

    const deepSegments = Array.from({ length: 25 }, (_, i) => `d${i}`);
    const deepDir = `/base/${deepSegments.join('/')}`;
    addDir(deepDir);

    const deepRel = `${deepSegments.join('/')}/deep.txt`;

    await Promise.all([
      tools.write({ path: 'a.txt', content: 'a' }),
      tools.write({ path: 'big.txt', content: big }),
      tools.write({ path: deepRel, content: 'deep' }),
    ]);

    expect((await tools.read({ path: 'a.txt' })).content).toBe('a');
    expect((await tools.read({ path: 'big.txt' })).content).toBe(big);
    expect((await tools.read({ path: deepRel })).content).toBe('deep');
  });

  it('globs files using globToRegex (including deep nesting) and supports concurrent calls', async () => {
    addDir('/base/sub');
    addFile('/base/a.js', 'a');
    addFile('/base/b.txt', 'b');
    addFile('/base/sub/c.js', 'c');

    const deepSegments = Array.from({ length: 20 }, (_, i) => `g${i}`);
    const deepDir = `/base/${deepSegments.join('/')}`;
    addDir(deepDir);
    addFile(`${deepDir}/deep.js`, 'deep');

    hoisted.globToRegex.mockReturnValue(/\.js$/);

    const createNodeTools = await importSubject();
    const tools = await createNodeTools({ basePath: '/base', allowedCommands: ['echo'] });

    const [r1, r2] = await Promise.all([
      tools.glob({ pattern: '**/*.js' }),
      tools.glob({ pattern: '**/*.js' }),
    ]);

    expect(hoisted.globToRegex).toHaveBeenCalledWith('**/*.js');

    const has = (results, suffix) => results.some((p) => String(p).endsWith(suffix));

    expect(r1.error).toBeUndefined();
    expect(has(r1.files, 'a.js')).toBe(true);
    expect(has(r1.files, 'c.js')).toBe(true);
    expect(has(r1.files, 'deep.js')).toBe(true);
    expect(has(r1.files, 'b.txt')).toBe(false);

    expect(r2.error).toBeUndefined();
    expect(has(r2.files, 'a.js')).toBe(true);
    expect(has(r2.files, 'c.js')).toBe(true);
    expect(has(r2.files, 'deep.js')).toBe(true);
    expect(has(r2.files, 'b.txt')).toBe(false);

    const traversal = await tools.glob({ pattern: '../*.js' });
    expect(traversal.files).toEqual([]);
    expect(traversal.error).toMatch(/traversal/i);

    await expect(tools.glob()).rejects.toThrow();
    await expect(tools.glob(null)).rejects.toThrow();
  });

  it('bash parses quoting/escapes, enforces allowedCommands, validates inputs, clamps timeouts, and supports concurrency', async () => {
    hoisted.exec.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

    const createNodeTools = await importSubject();

    const tools = await createNodeTools({
      basePath: '/base',
      allowedCommands: ['echo', '', '   ', null, 0, {}, []],
      maxTimeoutMs: 5,
    });

    const first = await tools.bash({ command: 'echo "hello world"', timeout: Number.MAX_SAFE_INTEGER });
    expect(first.exitCode).toBe(0);
    expect(hoisted.exec).toHaveBeenCalledTimes(1);

    let invocation = extractExecInvocation(hoisted.exec.mock.calls[0]);
    expect(invocation.command).toBe('echo');
    expect(Array.isArray(invocation.args)).toBe(true);
    expect(invocation.args).toEqual(expect.arrayContaining(['hello world']));
    expect(invocation.options?.cwd).toBe('/base');

    let timeoutMs = extractTimeoutMs(invocation);
    expect(timeoutMs).toBeTypeOf('number');
    expect(timeoutMs).toBeGreaterThanOrEqual(1);
    expect(timeoutMs).toBeLessThanOrEqual(5);

    await tools.bash({ command: 'echo "a\\\"b"' });
    invocation = extractExecInvocation(hoisted.exec.mock.calls[1]);
    expect(invocation.command).toBe('echo');
    expect(invocation.args).toEqual(expect.arrayContaining(['a"b']));

    await Promise.all([tools.bash({ command: 'echo "first"' }), tools.bash({ command: 'echo "second"' })]);
    expect(hoisted.exec).toHaveBeenCalledTimes(4);

    const blocked = await tools.bash({ command: 'ls -la' });
    expect(blocked.exitCode).toBe(-1);
    expect(blocked.error).toMatch(/not allowed/i);
    expect(hoisted.exec).toHaveBeenCalledTimes(4);

    const toolsWhitespace = await createNodeTools({ basePath: '/base', allowedCommands: [' echo '] });
    const blockedWhitespace = await toolsWhitespace.bash({ command: 'echo hi' });
    expect(blockedWhitespace.exitCode).toBe(-1);

    const toolsMinTimeout = await createNodeTools({ basePath: '/base', allowedCommands: ['echo'], maxTimeoutMs: 0 });
    await toolsMinTimeout.bash({ command: 'echo hi', timeout: -1 });
    invocation = extractExecInvocation(hoisted.exec.mock.calls[hoisted.exec.mock.calls.length - 1]);
    timeoutMs = extractTimeoutMs(invocation);
    expect(timeoutMs).toBe(1);

    const toolsDefaultTimeout = await createNodeTools({
      basePath: '/base',
      allowedCommands: ['echo'],
      maxTimeoutMs: '1000',
    });
    await toolsDefaultTimeout.bash({ command: 'echo hi', timeout: 70000 });
    invocation = extractExecInvocation(hoisted.exec.mock.calls[hoisted.exec.mock.calls.length - 1]);
    timeoutMs = extractTimeoutMs(invocation);
    expect(timeoutMs).toBeLessThanOrEqual(60000);

    expect((await tools.bash({ command: '   ' })).error).toMatch(/Command required/i);
    expect((await tools.bash({ command: null })).error).toMatch(/Command required/i);
    expect((await tools.bash({ command: {} })).error).toMatch(/Command required/i);
    expect((await tools.bash({ command: 'echo "abc' })).error).toMatch(/quote/i);
  });
});
