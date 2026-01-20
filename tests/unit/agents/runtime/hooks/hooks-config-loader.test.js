import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  loggerLog: vi.fn(),
  nativeWatchSupported: false,
  fileWatcherInstances: [],
}));

vi.mock('../../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../../js/agents/shared/index.js');

  class MockFileWatcher {
    constructor(options) {
      this.options = options;
      this.started = false;
      this.stopped = false;
      this.start = vi.fn(async () => {
        this.started = true;
      });
      this.stop = vi.fn(() => {
        this.stopped = true;
      });
      mockState.fileWatcherInstances.push(this);
    }
  }

  return {
    ...actual,
    createLogger: () => ({
      warn: (...args) => mockState.loggerWarn(...args),
      info: (...args) => mockState.loggerInfo(...args),
      error: (...args) => mockState.loggerError(...args),
      debug: (...args) => mockState.loggerDebug(...args),
      log: (...args) => mockState.loggerLog(...args),
    }),
    FileWatcher: MockFileWatcher,
    isNativeWatchSupported: vi.fn(async () => mockState.nativeWatchSupported),
  };
});

import HooksConfigLoaderDefault, {
  HooksConfigLoader,
  createHooksConfigLoader,
} from '../../../../../js/agents/runtime/hooks/hooks-config-loader.js';
import HookRegistry, { HookEvent, HookType } from '../../../../../js/agents/runtime/hooks/hook-registry.js';

function makeENOENT(path) {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
  err.code = 'ENOENT';
  return err;
}

class MockVfs {
  constructor() {
    this._files = new Map();
    this._clockMs = 1_000_000;
  }

  async writeText(path, text, { mtimeMs } = {}) {
    const p = String(path ?? '');
    const t = typeof text === 'string' ? text : String(text ?? '');
    const nextMtime = typeof mtimeMs === 'number' && Number.isFinite(mtimeMs)
      ? mtimeMs
      : (this._clockMs += 1000);
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

function makeDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i++) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mockState.loggerWarn = vi.fn();
  mockState.loggerInfo = vi.fn();
  mockState.loggerError = vi.fn();
  mockState.loggerDebug = vi.fn();
  mockState.loggerLog = vi.fn();
  mockState.nativeWatchSupported = false;
  mockState.fileWatcherInstances.length = 0;
});

describe('HooksConfigLoader', () => {
  describe('constructor', () => {
    it('throws when vfs is missing', () => {
      const registry = new HookRegistry();
      expect(() => new HooksConfigLoader()).toThrow(/requires\s+\{\s*vfs\s*\}/i);
      expect(() => new HooksConfigLoader(null)).toThrow(/requires\s+\{\s*vfs\s*\}/i);
      expect(() => new HooksConfigLoader({ registry })).toThrow(/requires\s+\{\s*vfs\s*\}/i);
    });

    it('throws when registry is missing or incompatible', () => {
      const vfs = new MockVfs();
      expect(() => new HooksConfigLoader({ vfs })).toThrow(/requires\s+\{\s*registry\s*\}/i);
      expect(() => new HooksConfigLoader({ vfs, registry: {} })).toThrow(/requires\s+\{\s*registry\s*\}/i);
    });

    it('accepts registry-like objects with clear/register methods', () => {
      const registry = { clear: vi.fn(), register: vi.fn() };
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
      expect(loader._registry).toBe(registry);
    });

    it('uses defaults when configPath is blank and pollIntervalMs is not a number', () => {
      const loader = new HooksConfigLoader({
        vfs: new MockVfs(),
        registry: new HookRegistry(),
        configPath: '   ',
        pollIntervalMs: '500',
      });
      expect(loader._configPath).toBe('.agents/hooks.json');
      expect(loader._pollIntervalMs).toBe(2000);
      expect(loader._useNativeWatch).toBe(true);
    });

    it('clamps pollIntervalMs for 0/-1 and allows MAX_SAFE_INTEGER', () => {
      const vfs = new MockVfs();
      const registry = new HookRegistry();
      expect(new HooksConfigLoader({ vfs, registry, pollIntervalMs: 0 })._pollIntervalMs).toBe(250);
      expect(new HooksConfigLoader({ vfs, registry, pollIntervalMs: -1 })._pollIntervalMs).toBe(250);
      expect(new HooksConfigLoader({ vfs, registry, pollIntervalMs: Number.MAX_SAFE_INTEGER })._pollIntervalMs)
        .toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('loadConfig()', () => {
    it('loads valid config', async () => {
      const vfs = new MockVfs();
      const cfg = { hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'bash' }] };
      await vfs.writeText('.agents/hooks.json', JSON.stringify(cfg));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toEqual(cfg);
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });

    it('returns null for missing config without warning', async () => {
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });

    it('returns null for empty or whitespace content', async () => {
      const vfs = new MockVfs();
      await vfs.writeText('.agents/hooks.json', '   ');

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });

    it('returns null and warns on invalid JSON', async () => {
      const vfs = new MockVfs();
      await vfs.writeText('.agents/hooks.json', '{ invalid json');

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('falls back to readFile when readText is missing', async () => {
      const text = JSON.stringify({ hooks: [] });
      const bytes = typeof TextEncoder === 'undefined' ? Buffer.from(text, 'utf8') : new TextEncoder().encode(text);
      const vfs = { readFile: vi.fn(async () => bytes) };

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toEqual({ hooks: [] });
      expect(vfs.readFile).toHaveBeenCalledTimes(1);
    });

    it('warns when readText fails with non-ENOENT error', async () => {
      const vfs = {
        readText: vi.fn(async () => {
          const err = new Error('EACCES: permission denied');
          err.code = 'EACCES';
          throw err;
        }),
      };
      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('accepts empty hooks array', async () => {
      const vfs = new MockVfs();
      const cfg = { hooks: [] };
      await vfs.writeText('.agents/hooks.json', JSON.stringify(cfg));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toEqual(cfg);
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });

    it('accepts empty object root', async () => {
      const vfs = new MockVfs();
      await vfs.writeText('.agents/hooks.json', JSON.stringify({}));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toEqual({});
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });

    it('rejects config with unknown root keys', async () => {
      const vfs = new MockVfs();
      await vfs.writeText('.agents/hooks.json', JSON.stringify({ hooks: [], extra: 1 }));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('rejects hooks when hooks is not an array', async () => {
      const vfs = new MockVfs();
      await vfs.writeText('.agents/hooks.json', JSON.stringify({ hooks: {} }));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('rejects config with too many hooks', async () => {
      const vfs = new MockVfs();
      const hooks = Array.from({ length: 201 }, () => ({ event: HookEvent.PRE_AGENT, type: HookType.COMMAND }));
      await vfs.writeText('.agents/hooks.json', JSON.stringify({ hooks }));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('filters invalid hook entries and keeps valid ones', async () => {
      const vfs = new MockVfs();
      const cfg = {
        hooks: [
          null,
          {},
          { event: '   ', type: 'command' },
          { event: HookEvent.PRE_TOOL_USE, type: 0 },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, blocking: 'yes' },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tools: {} },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, toolPatterns: ['bash', 1] },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.PROMPT },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.AGENT },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, unexpected: true },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'bash' },
        ],
      };
      await vfs.writeText('.agents/hooks.json', JSON.stringify(cfg));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      const loaded = await loader.loadConfig();

      expect(loaded).toEqual({ hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'bash' }] });
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('rejects oversized config files', async () => {
      const vfs = new MockVfs();
      const huge = 'a'.repeat(256 * 1024 + 1);
      await vfs.writeText('.agents/hooks.json', JSON.stringify({ hooks: [], pad: huge }));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('rejects configs that are too deep', async () => {
      const vfs = new MockVfs();
      const cfg = { hooks: [], nested: makeDeepObject(7) };
      await vfs.writeText('.agents/hooks.json', JSON.stringify(cfg));

      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });
      await expect(loader.loadConfig()).resolves.toBeNull();
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });
  });

  describe('applyConfig()', () => {
    it('clears registry before applying new hooks', async () => {
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
      expect(registry.list(HookEvent.PRE_TOOL_USE)[0].command).toBe('new');
    });

    it('clears registry and returns for null/undefined configs', async () => {
      const registry = new HookRegistry();
      registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, command: 'old' });

      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
      await loader.applyConfig(null);
      await loader.applyConfig(undefined);

      expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });

    it('warns and ignores when config is not an object', async () => {
      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });

      await loader.applyConfig(['not-an-object']);

      expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('warns and ignores when hooks is not an array', async () => {
      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });

      await loader.applyConfig({ hooks: {} });

      expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('registers hooks and normalizes event names', async () => {
      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });

      await loader.applyConfig({
        hooks: [
          { event: 'PRE_TOOL_USE', type: HookType.COMMAND, command: 'a' },
          { event: 'pre-tool-use', type: HookType.COMMAND, command: 'b' },
          { event: 'pre tool use', type: HookType.COMMAND, command: 'c' },
          { event: 'pretooluse', type: HookType.COMMAND, command: 'd' },
          { eventName: 'PreToolUse', type: HookType.COMMAND, command: 'e' },
          { event_name: 'PreToolUse', type: HookType.COMMAND, command: 'f' },
        ],
      });

      const commands = registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.command).sort();
      expect(commands).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });

    it('skips invalid hook definitions and continues', async () => {
      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });

      await loader.applyConfig({
        hooks: [
          'not-an-object',
          { event: '   ', type: HookType.COMMAND },
          { event: 'NotARealEvent', type: HookType.COMMAND },
          { event: HookEvent.PRE_TOOL_USE, type: 'invalid' },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.PROMPT },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.AGENT },
          { event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, command: 'ok' },
        ],
      });

      expect(registry.list(HookEvent.PRE_TOOL_USE)).toHaveLength(1);
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('registers prompt hooks with long strings', async () => {
      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
      const prompt = 'x'.repeat(10_000);

      await loader.applyConfig({
        hooks: [{ event: HookEvent.PRE_AGENT, type: HookType.PROMPT, prompt }],
      });

      const hooks = registry.list(HookEvent.PRE_AGENT);
      expect(hooks).toHaveLength(1);
      expect(hooks[0].prompt.length).toBe(prompt.length);
    });
  });

  describe('reload()', () => {
    it('detects config changes via hash and applies updates', async () => {
      const vfs = new MockVfs();
      const configPath = '.agents/hooks.json';
      await vfs.writeText(configPath, JSON.stringify({
        hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'v1' }],
      }));

      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs, registry, configPath });

      await loader.reload();
      expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.tools?.[0])).toEqual(['v1']);

      const frozenMtime = vfs.getMtimeMs(configPath);
      await vfs.writeText(
        configPath,
        JSON.stringify({
          hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'v2' }],
        }),
        { mtimeMs: frozenMtime }
      );

      await loader.reload();
      expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.tools?.[0])).toEqual(['v2']);
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });

    it('does not re-apply when config is unchanged on rapid consecutive calls', async () => {
      const vfs = new MockVfs();
      const configPath = '.agents/hooks.json';
      await vfs.writeText(configPath, JSON.stringify({
        hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND }],
      }));

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

    it('handles config deletion by clearing hooks', async () => {
      const vfs = new MockVfs();
      const configPath = '.agents/hooks.json';
      await vfs.writeText(configPath, JSON.stringify({
        hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND }],
      }));

      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs, registry, configPath });

      await loader.reload();
      expect(registry.list(HookEvent.PRE_TOOL_USE)).toHaveLength(1);

      await vfs.delete(configPath);
      await loader.reload();

      expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
    });

    it('keeps last applied config if new config is invalid JSON', async () => {
      const vfs = new MockVfs();
      const configPath = '.agents/hooks.json';
      await vfs.writeText(configPath, JSON.stringify({
        hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'ok' }],
      }));

      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs, registry, configPath });

      await loader.reload();
      expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.tools?.[0])).toEqual(['ok']);

      await vfs.writeText(configPath, '{ invalid json');
      await loader.reload();

      expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.tools?.[0])).toEqual(['ok']);
      expect(mockState.loggerWarn).toHaveBeenCalled();
    });

    it('continues when stat fails with non-ENOENT error', async () => {
      const vfs = new MockVfs();
      const configPath = '.agents/hooks.json';
      await vfs.writeText(configPath, JSON.stringify({
        hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'v1' }],
      }));

      vi.spyOn(vfs, 'stat').mockImplementation(async () => {
        const err = new Error('EACCES: permission denied');
        err.code = 'EACCES';
        throw err;
      });

      const registry = new HookRegistry();
      const loader = new HooksConfigLoader({ vfs, registry, configPath });

      await loader.reload();
      expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.tools?.[0])).toEqual(['v1']);

      await vfs.writeText(configPath, JSON.stringify({
        hooks: [{ event: HookEvent.PRE_TOOL_USE, type: HookType.COMMAND, tool: 'v2' }],
      }));
      await loader.reload();

      expect(registry.list(HookEvent.PRE_TOOL_USE).map((h) => h.tools?.[0])).toEqual(['v2']);
      expect(mockState.loggerWarn).not.toHaveBeenCalled();
    });
  });

  describe('startWatching() / stopWatching() / dispose()', () => {
    it('uses FileWatcher when native watch is supported', async () => {
      mockState.nativeWatchSupported = true;
      const vfs = new MockVfs();
      const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });

      await loader.startWatching();

      expect(mockState.fileWatcherInstances).toHaveLength(1);
      const watcher = mockState.fileWatcherInstances[0];
      expect(watcher.options.path).toBe('.agents/hooks.json');
      expect(watcher.options.vfs).toBe(vfs);
      expect(watcher.start).toHaveBeenCalledTimes(1);
      expect(loader._fileWatcher).toBe(watcher);
      expect(loader._watchTimer).toBeNull();
    });

    it('uses polling when native watch is disabled', async () => {
      mockState.nativeWatchSupported = true;
      const vfs = new MockVfs();
      const loader = new HooksConfigLoader({
        vfs,
        registry: new HookRegistry(),
        pollIntervalMs: 250,
        useNativeWatch: false,
      });

      vi.useFakeTimers();
      const reloadSpy = vi.spyOn(loader, 'reload').mockResolvedValue();

      await loader.startWatching();
      expect(loader._watchTimer).not.toBeNull();

      await vi.advanceTimersByTimeAsync(250);
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      loader.stopWatching();
      expect(loader._watchTimer).toBeNull();
    });

    it('startWatching is idempotent for sequential calls', async () => {
      mockState.nativeWatchSupported = true;
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });

      await loader.startWatching();
      await loader.startWatching();

      expect(mockState.fileWatcherInstances).toHaveLength(1);
      expect(mockState.fileWatcherInstances[0].start).toHaveBeenCalledTimes(1);
    });

    it('stopWatching stops FileWatcher and clears reference', async () => {
      mockState.nativeWatchSupported = true;
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });

      await loader.startWatching();
      const watcher = mockState.fileWatcherInstances[0];
      loader.stopWatching();

      expect(watcher.stop).toHaveBeenCalledTimes(1);
      expect(loader._fileWatcher).toBeNull();
    });

    it('dispose clears registry and blocks further operations', async () => {
      const registry = new HookRegistry();
      registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, command: 'x' });

      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });
      await loader.dispose();

      expect(loader.disposed).toBe(true);
      expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
      await expect(loader.reload()).rejects.toThrow(/disposed/i);
    });
  });

  describe('_hashContent()', () => {
    it('returns a stable 8-character hex hash', () => {
      const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });
      const hash = loader._hashContent('hello');
      expect(hash).toBe('4f9f2cab');
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });
});

describe('createHooksConfigLoader', () => {
  it('creates a HooksConfigLoader instance', () => {
    const loader = createHooksConfigLoader({ vfs: new MockVfs(), registry: new HookRegistry() });
    expect(loader).toBeInstanceOf(HooksConfigLoader);
  });

  it('propagates constructor errors', () => {
    expect(() => createHooksConfigLoader({ vfs: new MockVfs() })).toThrow(/requires\s+\{\s*registry\s*\}/i);
  });
});

describe('default export', () => {
  it('exports the HooksConfigLoader class', () => {
    expect(HooksConfigLoaderDefault).toBe(HooksConfigLoader);
    const loader = new HooksConfigLoaderDefault({ vfs: new MockVfs(), registry: new HookRegistry() });
    expect(loader).toBeInstanceOf(HooksConfigLoader);
  });
});
