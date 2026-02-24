import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HooksConfigLoader, createHooksConfigLoader } from '../hooks-config-loader.js';
import HookRegistry from '../hook-registry.js';

// ---------------------------------------------------------------------------
// Mock VFS
// ---------------------------------------------------------------------------

function createMockVFS(files = {}) {
  const store = new Map(Object.entries(files));
  return {
    async readFile(path) {
      if (!store.has(path)) { const e = new Error(`ENOENT: ${path}`); e.code = 'ENOENT'; throw e; }
      return new TextEncoder().encode(store.get(path));
    },
    async readText(path) {
      if (!store.has(path)) { const e = new Error(`ENOENT: ${path}`); e.code = 'ENOENT'; throw e; }
      return store.get(path);
    },
    async stat(path) {
      if (!store.has(path)) { const e = new Error(`ENOENT: ${path}`); e.code = 'ENOENT'; throw e; }
      return { mtimeMs: Date.now() };
    },
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Shared defaults
// ---------------------------------------------------------------------------

const SAFE_OPTS = { useNativeWatch: false, pollIntervalMs: 100000 };
const CONFIG_PATH = '.agents/hooks.json';

function validConfig(hooks = [{ event: 'PreToolUse', type: 'command', tools: 'bash' }]) {
  return JSON.stringify({ hooks });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HooksConfigLoader', () => {
  /** @type {HookRegistry} */
  let registry;
  /** @type {HooksConfigLoader | null} */
  let loader;

  beforeEach(() => {
    registry = new HookRegistry();
    loader = null;
  });

  afterEach(async () => {
    if (loader) {
      try { loader.stopWatching(); } catch { /* noop */ }
      try { await loader.dispose(); } catch { /* noop */ }
      loader = null;
    }
  });

  // --- constructor ---------------------------------------------------------

  describe('constructor', () => {
    it('throws without vfs', () => {
      expect(() => new HooksConfigLoader({ registry }))
        .toThrow(/requires.*vfs/i);
    });

    it('throws without registry', () => {
      const vfs = createMockVFS();
      expect(() => new HooksConfigLoader({ vfs }))
        .toThrow(/requires.*registry/i);
    });

    it('accepts valid options', () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      expect(loader).toBeInstanceOf(HooksConfigLoader);
    });
  });

  // --- loadConfig ----------------------------------------------------------

  describe('loadConfig', () => {
    it('returns null when config file missing', async () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      const result = await loader.loadConfig();
      expect(result).toBeNull();
    });

    it('returns parsed config when file exists', async () => {
      const vfs = createMockVFS({ [CONFIG_PATH]: validConfig() });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      const result = await loader.loadConfig();
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('hooks');
      expect(Array.isArray(result.hooks)).toBe(true);
      expect(result.hooks.length).toBe(1);
    });

    it('returns null for invalid JSON', async () => {
      const vfs = createMockVFS({ [CONFIG_PATH]: '{not valid json!!!' });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      const result = await loader.loadConfig();
      expect(result).toBeNull();
    });
  });

  // --- applyConfig ---------------------------------------------------------

  describe('applyConfig', () => {
    it('clears registry on null config', async () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      registry.register('PreToolUse', { type: 'command' });
      expect(registry.list('PreToolUse').length).toBe(1);

      await loader.applyConfig(null);
      expect(registry.list('PreToolUse').length).toBe(0);
    });

    it('registers hooks from valid config', async () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });

      await loader.applyConfig({
        hooks: [
          { event: 'PreToolUse', type: 'command', tools: 'bash' },
          { event: 'PostToolUse', type: 'command', tools: 'read' },
        ],
      });

      expect(registry.list('PreToolUse').length).toBe(1);
      expect(registry.list('PostToolUse').length).toBe(1);
    });

    it('skips invalid hook entries (missing event, invalid type)', async () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });

      await loader.applyConfig({
        hooks: [
          { type: 'command' },                      // missing event
          { event: 'PreToolUse', type: 'bogus' },   // invalid type
          { event: 'PreToolUse', type: 'command' },  // valid
        ],
      });

      expect(registry.list('PreToolUse').length).toBe(1);
    });

    it('handles empty hooks array', async () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      registry.register('PreToolUse', { type: 'command' });

      await loader.applyConfig({ hooks: [] });
      expect(registry.list('PreToolUse').length).toBe(0);
    });
  });

  // --- init ----------------------------------------------------------------

  describe('init', () => {
    it('loads config and starts watching', async () => {
      const vfs = createMockVFS({ [CONFIG_PATH]: validConfig() });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });

      await loader.init();
      expect(registry.list('PreToolUse').length).toBe(1);
    });

    it('works with missing config file (no hooks)', async () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });

      await loader.init();
      expect(registry.list('PreToolUse').length).toBe(0);
    });
  });

  // --- reload --------------------------------------------------------------

  describe('reload', () => {
    it('no-op when content unchanged', async () => {
      const cfg = validConfig();
      const vfs = createMockVFS({ [CONFIG_PATH]: cfg });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      await loader.init();

      const clearSpy = vi.spyOn(registry, 'clear');
      // init already called clear+register; reset the spy count
      clearSpy.mockClear();

      // Reload with identical content — mtime may differ but hash is same
      // Force same mtime by overriding stat
      const frozenMtime = Date.now();
      vfs.stat = async () => ({ mtimeMs: frozenMtime });
      // Prime the loader's internal mtime to match
      loader._lastModified = frozenMtime;

      await loader.reload();
      expect(clearSpy).not.toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it('reloads when content changed', async () => {
      const vfs = createMockVFS({ [CONFIG_PATH]: validConfig() });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      await loader.init();
      expect(registry.list('PreToolUse').length).toBe(1);

      // Mutate VFS content
      const newCfg = validConfig([
        { event: 'PreToolUse', type: 'command', tools: 'bash' },
        { event: 'PostToolUse', type: 'command', tools: 'grep' },
      ]);
      vfs._store.set(CONFIG_PATH, newCfg);

      await loader.reload();
      expect(registry.list('PreToolUse').length).toBe(1);
      expect(registry.list('PostToolUse').length).toBe(1);
    });

    it('clears hooks when config file deleted', async () => {
      const vfs = createMockVFS({ [CONFIG_PATH]: validConfig() });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      await loader.init();
      expect(registry.list('PreToolUse').length).toBe(1);

      // Remove the config file from VFS
      vfs._store.delete(CONFIG_PATH);

      await loader.reload();
      expect(registry.list('PreToolUse').length).toBe(0);
    });
  });

  // --- dispose -------------------------------------------------------------

  describe('dispose', () => {
    it('stops watching', async () => {
      const vfs = createMockVFS({ [CONFIG_PATH]: validConfig() });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      await loader.init();

      const stopSpy = vi.spyOn(loader, 'stopWatching');
      await loader.dispose();
      expect(stopSpy).toHaveBeenCalled();
      stopSpy.mockRestore();
    });

    it('clears registry', async () => {
      const vfs = createMockVFS({ [CONFIG_PATH]: validConfig() });
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      await loader.init();
      expect(registry.list('PreToolUse').length).toBe(1);

      await loader.dispose();
      expect(registry.list('PreToolUse').length).toBe(0);
    });

    it('is idempotent', async () => {
      const vfs = createMockVFS();
      loader = new HooksConfigLoader({ vfs, registry, ...SAFE_OPTS });

      await loader.dispose();
      // Second call should not throw
      await loader.dispose();
      expect(loader.disposed).toBe(true);
    });
  });

  // --- createHooksConfigLoader factory -------------------------------------

  describe('createHooksConfigLoader', () => {
    it('returns a HooksConfigLoader instance', () => {
      const vfs = createMockVFS();
      loader = createHooksConfigLoader({ vfs, registry, ...SAFE_OPTS });
      expect(loader).toBeInstanceOf(HooksConfigLoader);
    });
  });
});
