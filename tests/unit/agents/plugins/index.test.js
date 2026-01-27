import { describe, it, expect, vi, beforeEach } from 'vitest';

const SUBJECT_PATH = '../../../../js/agents/plugins/index.js';

vi.mock(
  '../../../../js/agents/plugins/compression/cicada.js',
  () => ({
    default: { name: 'cicada', kind: 'compression' },
  }),
  { virtual: true },
);

vi.mock(
  '../../../../js/agents/plugins/compression/watchdog.js',
  () => ({
    plugin: { name: 'watchdog', kind: 'compression' },
  }),
  { virtual: true },
);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function importSubject() {
  return import(SUBJECT_PATH);
}

function makeDeepNestedObject(depth) {
  let current = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    current = { level: i, next: current };
  }
  return current;
}

describe('loadPlugin', () => {
  it('loads a known plugin and returns its default export', async () => {
    const { loadPlugin } = await importSubject();
    const plugin = await loadPlugin('compression/cicada');
    expect(plugin).toEqual({ name: 'cicada', kind: 'compression' });
  });

  it('loads a known plugin and returns the module object when default is missing', async () => {
    const { loadPlugin } = await importSubject();
    const mod = await loadPlugin('compression/watchdog');

    expect(mod).toMatchObject({ plugin: { name: 'watchdog', kind: 'compression' } });
    expect(mod).not.toHaveProperty('default');
  });

  it('throws an error for unknown plugin names', async () => {
    const { loadPlugin } = await importSubject();
    await expect(loadPlugin('does/not-exist')).rejects.toThrowError(/Unknown plugin:/);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['0', 0],
    ['-1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['empty array', []],
    ['empty object', {}],
    ['array-like object', { 0: 'compression/cicada', length: 1 }],
    ['numeric string', '42'],
  ])('rejects invalid/edge name: %s', async (_label, name) => {
    const { loadPlugin } = await importSubject();
    await expect(loadPlugin(name)).rejects.toThrowError(/Unknown plugin:/);
  });

  it('propagates errors thrown by plugin loaders', async () => {
    const { loadPlugin, registerPlugin } = await importSubject();
    registerPlugin('custom/fails', async () => {
      throw new Error('boom');
    });

    await expect(loadPlugin('custom/fails')).rejects.toThrow('boom');
  });

  it('throws TypeError when a registered loader is not a function', async () => {
    const { loadPlugin, registerPlugin } = await importSubject();
    registerPlugin('custom/bad-loader', { not: 'a function' });

    await expect(loadPlugin('custom/bad-loader')).rejects.toThrow(TypeError);
  });

  it('handles concurrent and rapid consecutive loads deterministically', async () => {
    const { loadPlugin, registerPlugin } = await importSubject();
    const loader = vi.fn(async () => ({ default: { name: 'concurrent', kind: 'custom' } }));
    registerPlugin('custom/concurrent', loader);

    const [a, b] = await Promise.all([
      loadPlugin('custom/concurrent'),
      loadPlugin('custom/concurrent'),
    ]);

    expect(a).toEqual({ name: 'concurrent', kind: 'custom' });
    expect(b).toEqual({ name: 'concurrent', kind: 'custom' });
    expect(loader).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect(await loadPlugin('custom/concurrent')).toEqual({ name: 'concurrent', kind: 'custom' });
    }
    expect(loader).toHaveBeenCalledTimes(12);
  });

  it('supports large payloads and deep nested plugin objects', async () => {
    const { loadPlugin, registerPlugin } = await importSubject();
    const large = 'x'.repeat(1_000_000);
    const deep = makeDeepNestedObject(256);

    registerPlugin('custom/large', async () => ({ default: large }));
    registerPlugin('custom/deep', async () => ({ default: deep }));

    const loadedLarge = await loadPlugin('custom/large');
    expect(loadedLarge).toHaveLength(1_000_000);

    const loadedDeep = await loadPlugin('custom/deep');
    expect(loadedDeep).toBe(deep);
    expect(loadedDeep).toMatchObject({ level: 255, next: expect.any(Object) });
  });
});

describe('hasPlugin', () => {
  it('returns true for known plugins', async () => {
    const { hasPlugin } = await importSubject();
    expect(hasPlugin('compression/cicada')).toBe(true);
  });

  it('returns false for unknown plugins', async () => {
    const { hasPlugin } = await importSubject();
    expect(hasPlugin('unknown/plugin')).toBe(false);
  });

  it.each([
    ['null', null, false],
    ['undefined', undefined, false],
    ['empty string', '', false],
    ['whitespace string', '   ', false],
    ['0', 0, false],
    ['-1', -1, false],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER, false],
    ['empty array', [], false],
    ['empty object', {}, false],
    ['array-like object', { 0: 'compression/cicada', length: 1 }, false],
    ['numeric string', '42', false],
  ])('handles boundary name: %s', async (_label, name, expected) => {
    const { hasPlugin } = await importSubject();
    expect(hasPlugin(name)).toBe(expected);
  });

  it('reflects custom registrations, including non-string keys', async () => {
    const { hasPlugin, registerPlugin } = await importSubject();
    registerPlugin(undefined, async () => ({ default: { ok: true } }));
    registerPlugin(null, async () => ({ default: { ok: true } }));
    registerPlugin(0, async () => ({ default: { ok: true } }));

    expect(hasPlugin(undefined)).toBe(true);
    expect(hasPlugin(null)).toBe(true);
    expect(hasPlugin(0)).toBe(true);
  });
});

describe('listAvailablePlugins', () => {
  it('lists built-in plugin names', async () => {
    const { listAvailablePlugins } = await importSubject();
    const list = listAvailablePlugins();

    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain('compression/cicada');
    expect(list).toContain('debug/inspector');
  });

  it('returns a new array instance on each call', async () => {
    const { listAvailablePlugins } = await importSubject();
    const a = listAvailablePlugins();
    const b = listAvailablePlugins();

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('includes newly registered plugins, including long names', async () => {
    const { listAvailablePlugins, registerPlugin, hasPlugin } = await importSubject();
    const longName = `custom/${'a'.repeat(10_000)}`;
    registerPlugin(longName, async () => ({ default: { ok: true } }));

    expect(hasPlugin(longName)).toBe(true);
    expect(listAvailablePlugins()).toContain(longName);
  });

  it('handles a large number of custom registrations without losing built-ins', async () => {
    const { listAvailablePlugins, registerPlugin, hasPlugin } = await importSubject();
    const base = new Set(listAvailablePlugins());

    const count = 250;
    for (let i = 0; i < count; i += 1) {
      registerPlugin(`bulk/plugin-${i}`, async () => ({ default: i }));
    }

    const all = listAvailablePlugins();
    expect(all.length).toBeGreaterThanOrEqual(base.size + count);
    expect(all).toContain('compression/cicada');
    expect(hasPlugin('bulk/plugin-0')).toBe(true);
    expect(hasPlugin(`bulk/plugin-${count - 1}`)).toBe(true);
  });
});

describe('registerPlugin', () => {
  it('registers a new plugin loader and enables loading it', async () => {
    const { registerPlugin, hasPlugin, loadPlugin, listAvailablePlugins } = await importSubject();
    const loader = vi.fn(async () => ({ default: { name: 'custom', kind: 'test' } }));

    registerPlugin('custom/plugin', loader);

    expect(hasPlugin('custom/plugin')).toBe(true);
    expect(listAvailablePlugins()).toContain('custom/plugin');
    await expect(loadPlugin('custom/plugin')).resolves.toEqual({ name: 'custom', kind: 'test' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('overrides an existing plugin loader', async () => {
    const { registerPlugin, loadPlugin } = await importSubject();

    registerPlugin('compression/cicada', async () => ({ default: { name: 'override' } }));
    const plugin = await loadPlugin('compression/cicada');

    expect(plugin).toEqual({ name: 'override' });
  });

  it.each([
    ['empty string', ''],
    ['whitespace string', '   '],
    ['0', 0],
    ['-1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['null', null],
    ['undefined', undefined],
    ['empty array', []],
    ['empty object', {}],
    ['array-like object', { 0: 'x', length: 0 }],
  ])('accepts boundary plugin name: %s', async (_label, name) => {
    const { registerPlugin, hasPlugin, loadPlugin, listAvailablePlugins } = await importSubject();

    registerPlugin(name, async () => ({ default: { ok: true, name: String(name) } }));

    expect(hasPlugin(name)).toBe(true);
    expect(listAvailablePlugins()).toContain(String(name));
    await expect(loadPlugin(name)).resolves.toMatchObject({ ok: true });
  });

  it('last registration wins under rapid consecutive overrides', async () => {
    const { registerPlugin, loadPlugin } = await importSubject();

    registerPlugin('custom/override', async () => ({ default: { v: 1 } }));
    registerPlugin('custom/override', async () => ({ default: { v: 2 } }));
    registerPlugin('custom/override', async () => ({ default: { v: 3 } }));

    await expect(loadPlugin('custom/override')).resolves.toEqual({ v: 3 });
  });
});

describe('createPluginLoader', () => {
  it('creates an async loader function that delegates to loadPlugin', async () => {
    const { createPluginLoader } = await importSubject();
    const loader = createPluginLoader();

    expect(typeof loader).toBe('function');

    const plugin = await loader('compression/cicada');
    expect(plugin).toEqual({ name: 'cicada', kind: 'compression' });
  });

  it('rejects unknown plugin names through the created loader', async () => {
    const { createPluginLoader } = await importSubject();
    const loader = createPluginLoader();

    await expect(loader('unknown/plugin')).rejects.toThrowError(/Unknown plugin:/);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['0', 0],
    ['-1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['empty array', []],
    ['empty object', {}],
  ])('handles boundary names concurrently: %s', async (_label, name) => {
    const { createPluginLoader } = await importSubject();
    const loader = createPluginLoader();

    const results = await Promise.all([
      loader(name).then(
        () => null,
        (e) => e,
      ),
      loader(name).then(
        () => null,
        (e) => e,
      ),
    ]);

    results.forEach((r) => expect(r).toBeInstanceOf(Error));
  });

  it('supports concurrent loads via the created loader', async () => {
    const { createPluginLoader, registerPlugin } = await importSubject();
    const loader = createPluginLoader();
    const fn = vi.fn(async () => ({ default: { ok: true } }));
    registerPlugin('custom/concurrent', fn);

    const results = await Promise.all([
      loader('custom/concurrent'),
      loader('custom/concurrent'),
      loader('custom/concurrent'),
    ]);

    results.forEach((r) => expect(r).toEqual({ ok: true }));
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('default export', () => {
  it('exposes the expected API surface', async () => {
    const mod = await importSubject();
    const api = mod.default;

    expect(api).toBeDefined();
    expect(api).toMatchObject({
      load: expect.any(Function),
      has: expect.any(Function),
      list: expect.any(Function),
      register: expect.any(Function),
      createLoader: expect.any(Function),
    });

    expect(api.load).toBe(mod.loadPlugin);
    expect(api.has).toBe(mod.hasPlugin);
    expect(api.list).toBe(mod.listAvailablePlugins);
    expect(api.register).toBe(mod.registerPlugin);
    expect(api.createLoader).toBe(mod.createPluginLoader);
  });

  it('supports end-to-end register → has/list → load through default API', async () => {
    const mod = await importSubject();
    const api = mod.default;

    const deep = makeDeepNestedObject(64);
    api.register('custom/e2e', async () => ({ default: deep }));

    expect(api.has('custom/e2e')).toBe(true);
    expect(api.list()).toContain('custom/e2e');

    const loaded = await api.load('custom/e2e');
    expect(loaded).toMatchObject({ level: 63, next: expect.any(Object) });

    const loader = api.createLoader();
    await expect(loader('custom/e2e')).resolves.toBe(deep);
  });
});