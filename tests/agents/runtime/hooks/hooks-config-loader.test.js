import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  HooksConfigLoader,
  HookRegistry,
  HookType,
  HookEvent,
} from '../../../../js/agents/runtime/hooks/index.js';

function makeENOENT(path) {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
  err.code = 'ENOENT';
  return err;
}

/**
 * Minimal in-memory VFS for unit testing HooksConfigLoader.
 * Implements the subset of the VFS API that HooksConfigLoader uses (readText + stat).
 */
class MockVfs {
  constructor() {
    /** @type {Map<string, { text: string, mtimeMs: number }>} */
    this._files = new Map();
    this._clockMs = 1_000_000;
  }

  async writeText(path, text, { mtimeMs } = {}) {
    const p = String(path ?? '');
    const t = typeof text === 'string' ? text : String(text ?? '');
    const nextMtime = typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? mtimeMs : (this._clockMs += 1000);
    this._files.set(p, { text: t, mtimeMs: nextMtime });
    return nextMtime;
  }

  async delete(path) {
    this._files.delete(String(path ?? ''));
  }

  async readText(path) {
    const p = String(path ?? '');
    const entry = this._files.get(p);
    if (!entry) throw makeENOENT(p);
    return entry.text;
  }

  async stat(path) {
    const p = String(path ?? '');
    const entry = this._files.get(p);
    if (!entry) throw makeENOENT(p);
    return { mtimeMs: entry.mtimeMs };
  }

  getMtimeMs(path) {
    return this._files.get(String(path ?? ''))?.mtimeMs ?? 0;
  }
}

describe('HooksConfigLoader - constructor', () => {
  it('throws if vfs is missing', () => {
    const registry = new HookRegistry();
    expect(() => new HooksConfigLoader({ registry })).toThrow(/requires\s+\{\s*vfs\s*\}/i);
  });

  it('throws if registry is missing', () => {
    const vfs = new MockVfs();
    expect(() => new HooksConfigLoader({ vfs })).toThrow(/requires\s+\{\s*registry\s*\}/i);
  });

  it('uses default configPath and pollIntervalMs', () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });
    expect(loader._configPath).toBe('.agents/hooks.json');
    expect(loader._pollIntervalMs).toBe(2000);
  });

  it('accepts registry-like objects with clear/register', () => {
    const registry = { clear: vi.fn(), register: vi.fn() };
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
    expect(loader._registry).toBe(registry);
  });

  it('clamps pollIntervalMs to minimum 250ms', () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry(), pollIntervalMs: 10 });
    expect(loader._pollIntervalMs).toBe(250);
  });
});

describe('HooksConfigLoader - loadConfig() / init()', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadConfig() loads and parses valid config', async () => {
    const vfs = new MockVfs();
    const cfg = { hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, command: 'echo ok' }] };
    await vfs.writeText('.agents/hooks.json', JSON.stringify(cfg));

    const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
    await expect(loader.loadConfig()).resolves.toEqual(cfg);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('loadConfig() handles missing config file (returns null, no warning)', async () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });
    await expect(loader.loadConfig()).resolves.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('loadConfig() handles invalid JSON (warns, returns null)', async () => {
    const vfs = new MockVfs();
    await vfs.writeText('.agents/hooks.json', '{ invalid json');

    const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
    await expect(loader.loadConfig()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('Failed to parse hooks config JSON'))).toBe(true);
  });

  it('loadConfig() falls back to readFile when readText is missing', async () => {
    const text = JSON.stringify({ hooks: [] });
    const bytes = typeof TextEncoder === 'undefined' ? Buffer.from(text, 'utf8') : new TextEncoder().encode(text);
    const vfs = { readFile: vi.fn(async () => bytes) };

    const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
    await expect(loader.loadConfig()).resolves.toEqual({ hooks: [] });
    expect(vfs.readFile).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('init() loads + applies valid config', async () => {
    const vfs = new MockVfs();
    const cfg = { hooks: [{ event: 'PRE_TOOL_USE', type: 'command', command: 'echo v1' }] };
    await vfs.writeText('.agents/hooks.json', JSON.stringify(cfg));

    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs, registry });
    vi.spyOn(loader, 'startWatching').mockResolvedValue();

    await loader.init();

    const hooks = registry.list(HookEvent.PRE_TOOL_USE);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].type).toBe('command');
    expect(hooks[0].command).toBe('echo v1');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('init() handles missing config file (no error, clears hooks)', async () => {
    const vfs = new MockVfs();
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, command: 'old' });

    const loader = new HooksConfigLoader({ vfs, registry });
    vi.spyOn(loader, 'startWatching').mockResolvedValue();

    await loader.init();

    expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('HooksConfigLoader - applyConfig()', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears registry before applying', async () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, command: 'old' });

    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
    const clearSpy = vi.spyOn(registry, 'clear');
    const registerSpy = vi.spyOn(registry, 'register');

    await loader.applyConfig({
      hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, command: 'new' }],
    });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy.mock.invocationCallOrder[0]).toBeLessThan(registerSpy.mock.invocationCallOrder[0]);

    const hooks = registry.list(HookEvent.PRE_TOOL_USE);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].command).toBe('new');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('registers valid hooks and normalizes event names (PRE_TOOL_USE, PreToolUse, pre_tool_use)', async () => {
    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });

    await loader.applyConfig({
      hooks: [
        { event: 'PRE_TOOL_USE', type: 'command', command: 'a' },
        { event: 'PreToolUse', type: 'command', command: 'b' },
        { event: 'pre_tool_use', type: 'command', command: 'c' },
      ],
    });

    const hooks = registry.list(HookEvent.PRE_TOOL_USE);
    expect(hooks.map((h) => h.command).sort()).toEqual(['a', 'b', 'c']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips invalid hook definitions (logs warning) and continues', async () => {
    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });

    await loader.applyConfig({
      hooks: [
        'not-an-object',
        { event: 'NotARealEvent', type: 'command' },
        { event: HookEvent.PRE_TOOL_USE, type: 'not-a-real-type' },
        // prompt hooks require a prompt - this will throw in HookRegistry.register()
        { event: HookEvent.PRE_TOOL_USE, type: HookType.PROMPT },
        { event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, command: 'ok' },
      ],
    });

    expect(registry.list(HookEvent.PRE_TOOL_USE)).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('warns and ignores when config is not a plain object', async () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, command: 'old' });

    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
    const registerSpy = vi.spyOn(registry, 'register');

    await loader.applyConfig(['not-an-object']);

    expect(registerSpy).not.toHaveBeenCalled();
    expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('hooks.json root must be an object'))).toBe(true);
  });

  it('warns and ignores when hooks is not an array', async () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, command: 'old' });

    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
    const registerSpy = vi.spyOn(registry, 'register');

    await loader.applyConfig({ hooks: 'nope' });

    expect(registerSpy).not.toHaveBeenCalled();
    expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("'hooks' must be an array"))).toBe(true);
  });
});

describe('HooksConfigLoader - _hashContent()', () => {
  it('returns stable 8-character hex FNV-1a hash', () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });
    const hash = loader._hashContent('hello');
    expect(hash).toBe('4f9f2cab');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('HooksConfigLoader - hot reload (reload())', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects config changes via hash and reloads/applies new config', async () => {
    const vfs = new MockVfs();
    const configPath = '.agents/hooks.json';
    await vfs.writeText(configPath, JSON.stringify({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: 'command', command: 'v1' }] }));

    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs, registry, configPath });

    await loader.reload();
    expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.command)).toEqual(['v1']);

    // Change content but keep mtime identical to ensure hash-based change detection is exercised.
    const frozenMtime = vfs.getMtimeMs(configPath);
    await vfs.writeText(
      configPath,
      JSON.stringify({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: 'command', command: 'v2' }] }),
      { mtimeMs: frozenMtime }
    );

    await loader.reload();
    expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.command)).toEqual(['v2']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not re-apply when config is unchanged', async () => {
    const vfs = new MockVfs();
    const configPath = '.agents/hooks.json';
    await vfs.writeText(configPath, JSON.stringify({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: 'command' }] }));

    const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry(), configPath });
    const applySpy = vi.spyOn(loader, 'applyConfig');

    await loader.reload();
    await loader.reload();

    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent reload calls', async () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });
    let resolveRead;
    const readPromise = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const readSpy = vi.spyOn(loader, '_readConfigFile').mockReturnValue(readPromise);

    const first = loader.reload();
    const second = loader.reload();

    expect(readSpy).toHaveBeenCalledTimes(1);

    resolveRead({ exists: false, content: '', mtimeMs: 0 });
    await Promise.all([first, second]);

    expect(loader._reloadPromise).toBeNull();
  });

  it('continues when stat fails with non-ENOENT error and uses hash detection', async () => {
    const vfs = new MockVfs();
    const configPath = '.agents/hooks.json';
    await vfs.writeText(
      configPath,
      JSON.stringify({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: 'command', command: 'v1' }] })
    );

    const statSpy = vi.spyOn(vfs, 'stat').mockImplementation(async () => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    });

    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs, registry, configPath });

    await loader.reload();
    expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.command)).toEqual(['v1']);

    await vfs.writeText(
      configPath,
      JSON.stringify({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: 'command', command: 'v2' }] })
    );
    await loader.reload();

    expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.command)).toEqual(['v2']);
    expect(statSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('handles config deletion (clears hooks)', async () => {
    const vfs = new MockVfs();
    const configPath = '.agents/hooks.json';
    await vfs.writeText(configPath, JSON.stringify({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: 'command' }] }));

    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs, registry, configPath });
    const applySpy = vi.spyOn(loader, 'applyConfig');

    await loader.reload();
    expect(registry.list(HookEvent.PRE_TOOL_USE)).toHaveLength(1);

    await vfs.delete(configPath);
    await loader.reload();

    expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
    expect(applySpy.mock.calls.some((c) => c[0] === null)).toBe(true);
  });

  it('keeps last applied config if new config is invalid JSON (but updates hash to avoid warning spam)', async () => {
    const vfs = new MockVfs();
    const configPath = '.agents/hooks.json';
    await vfs.writeText(configPath, JSON.stringify({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: 'command', command: 'ok' }] }));

    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs, registry, configPath });

    await loader.reload();
    expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.command)).toEqual(['ok']);

    await vfs.writeText(configPath, '{ invalid json');
    await loader.reload();

    // Should keep last applied config.
    expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.command)).toEqual(['ok']);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('HooksConfigLoader - startWatching() / stopWatching() / dispose()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('startWatching() starts polling timer', async () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry(), pollIntervalMs: 500 });
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    await loader.startWatching();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(loader._watchTimer).not.toBeNull();
  });

  it('stopWatching() stops and cleans up timer', async () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry(), pollIntervalMs: 500 });
    await loader.startWatching();

    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    loader.stopWatching();

    expect(clearSpy).toHaveBeenCalled();
    expect(loader._watchTimer).toBeNull();
  });

  it('polling calls reload() and stopWatching() halts further polling', async () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry(), pollIntervalMs: 250 });
    const reloadSpy = vi.spyOn(loader, 'reload').mockResolvedValue();

    await loader.startWatching();
    await vi.advanceTimersByTimeAsync(250);
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    loader.stopWatching();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose() stops watching, clears registry, and marks as disposed', async () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, command: 'x' });

    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry, pollIntervalMs: 250 });
    await loader.startWatching();
    expect(loader._watchTimer).not.toBeNull();

    await loader.dispose();

    expect(loader.disposed).toBe(true);
    expect(loader._watchTimer).toBeNull();
    expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
  });

  it('throws when methods are called after dispose()', async () => {
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry(), pollIntervalMs: 250 });
    await loader.dispose();

    await expect(loader.init()).rejects.toThrow(/disposed/i);
    await expect(loader.loadConfig()).rejects.toThrow(/disposed/i);
    await expect(loader.reload()).rejects.toThrow(/disposed/i);
    await expect(loader.startWatching()).rejects.toThrow(/disposed/i);
  });
});
