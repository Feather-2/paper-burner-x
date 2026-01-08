import { afterEach, describe, expect, it } from 'vitest';

import defaultPresets, {
  presets,
  listPresets,
  mergePresetConfig,
  resolvePreset,
} from '../../../js/agents/core/presets.js';

function cleanupTestPresets() {
  for (const name of Object.keys(presets)) {
    if (name.startsWith('__test_')) {
      delete presets[name];
    }
  }
}

afterEach(() => {
  cleanupTestPresets();
});

describe('core/presets', () => {
  it('exports presets as both named and default export', () => {
    expect(defaultPresets).toBe(presets);
    expect(Object.keys(presets)).toContain('minimal');
  });

  it('resolvePreset throws for unknown preset', () => {
    expect(() => resolvePreset('__does_not_exist__')).toThrow(/Unknown preset/);
  });

  it('resolvePreset resolves a non-extending preset', () => {
    const resolved = resolvePreset('minimal');
    expect(resolved).toMatchObject({
      name: 'minimal',
      plugins: ['compression/cicada'],
    });
    expect(resolved.config['compression/cicada']).toEqual({ aggressive: false });
  });

  it('resolvePreset resolves deep inheritance and merges plugins/config', () => {
    const resolved = resolvePreset('deepsearch');

    expect(resolved.plugins).toEqual([
      'compression/cicada',
      'compression/watchdog',
      'resilience/retry',
      'service/scheduler',
      'service/llm',
      'service/vfs',
      'sandbox',
      'analysis/fingerprint',
      'stage/deepsearch',
    ]);

    expect(resolved.config).toMatchObject({
      'compression/cicada': { aggressive: false },
      'compression/watchdog': { threshold: 0.75 },
      'resilience/retry': { maxRetries: 3 },
      'analysis/fingerprint': { windowSize: 5 },
    });
  });

  it('resolvePreset dedupes plugins and allows child config override', () => {
    presets.__test_dedupe = {
      description: 'dedupe test',
      extends: 'minimal',
      plugins: ['compression/cicada', 'compression/cicada', 'extra/plugin'],
      config: {
        'compression/cicada': { aggressive: true },
      },
    };

    const resolved = resolvePreset('__test_dedupe');
    expect(resolved.plugins).toEqual(['compression/cicada', 'extra/plugin']);
    expect(resolved.config['compression/cicada']).toEqual({ aggressive: true });
  });

  it('mergePresetConfig merges plugins, supports disablePlugins, and deep-merges per-plugin config', () => {
    const merged = mergePresetConfig('standard', {
      disablePlugins: ['compression/watchdog'],
      plugins: ['service/llm', 'compression/cicada'], // duplicate should be deduped
      config: {
        'compression/watchdog': { threshold: 0.5, enabled: true },
        'compression/cicada': { aggressive: true },
        'new/plugin': { mode: 'on' },
      },
    });

    expect(merged.plugins).toEqual([
      'compression/cicada',
      'resilience/retry',
      'service/scheduler',
      'service/llm',
    ]);

    expect(merged.config['compression/watchdog']).toEqual({ threshold: 0.5, enabled: true });
    expect(merged.config['compression/cicada']).toEqual({ aggressive: true });
    expect(merged.config['new/plugin']).toEqual({ mode: 'on' });
  });

  it('mergePresetConfig supports default userConfig argument', () => {
    const merged = mergePresetConfig('minimal');
    expect(merged).toMatchObject({
      name: 'minimal',
      plugins: ['compression/cicada'],
      config: { 'compression/cicada': { aggressive: false } },
    });
  });

  it('listPresets reports extends and pluginCount, including edge cases', () => {
    presets.__test_missing_plugins_config = {
      description: 'no plugins/config',
      // plugins/config intentionally omitted
    };
    presets.__test_empty_plugins = {
      description: 'empty plugins',
      plugins: [],
      config: {},
    };

    const listed = listPresets();

    const minimal = listed.find((p) => p.name === 'minimal');
    expect(minimal).toMatchObject({ extends: null, pluginCount: 1 });

    const full = listed.find((p) => p.name === 'full');
    expect(full).toMatchObject({ extends: 'standard' });

    const missing = listed.find((p) => p.name === '__test_missing_plugins_config');
    expect(missing).toMatchObject({ extends: null, pluginCount: 0 });

    const empty = listed.find((p) => p.name === '__test_empty_plugins');
    expect(empty).toMatchObject({ extends: null, pluginCount: 0 });

    const resolvedMissing = resolvePreset('__test_missing_plugins_config');
    expect(resolvedMissing.plugins).toEqual([]);
    expect(resolvedMissing.config).toEqual({});
  });
});
