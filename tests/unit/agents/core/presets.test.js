import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { presets, resolvePreset } from '../../../../js/agents/core/presets.js';

const mockedReadFileSync = vi.mocked(readFileSync);
const basePresets = JSON.parse(JSON.stringify(presets));

const resetPresets = () => {
  for (const key of Object.keys(presets)) {
    delete presets[key];
  }
  for (const [key, value] of Object.entries(basePresets)) {
    presets[key] = JSON.parse(JSON.stringify(value));
  }
};

const buildDeepObject = (depth) => {
  let current = { value: 'leaf' };
  for (let i = 0; i < depth; i += 1) {
    current = { nested: current };
  }
  return current;
};

beforeEach(() => {
  resetPresets();
  mockedReadFileSync.mockReset();
});

describe('presets', () => {
  it('includes expected core presets and metadata', () => {
    const names = Object.keys(presets);
    expect(names).toEqual(
      expect.arrayContaining([
        'minimal',
        'standard',
        'full',
        'deepsearch',
        'design',
        'codesearch',
        'production',
        'development',
        'test',
      ])
    );

    expect(presets.minimal).toMatchObject({
      description: expect.any(String),
      plugins: ['compression/cicada'],
      config: { 'compression/cicada': { aggressive: false } },
    });
    expect(presets.full.extends).toBe('standard');
  });

  it('stores plugins as arrays and configs as plain objects', () => {
    Object.values(presets).forEach((preset) => {
      expect(preset).toEqual(expect.objectContaining({ description: expect.any(String) }));
      if (preset.plugins !== undefined) {
        expect(Array.isArray(preset.plugins)).toBe(true);
      }
      if (preset.config !== undefined) {
        expect(preset.config).not.toBeNull();
        expect(Array.isArray(preset.config)).toBe(false);
        expect(typeof preset.config).toBe('object');
      }
    });
  });
});

describe('resolvePreset', () => {
  it('resolves a non-extending preset without mutating source data', () => {
    const originalPlugins = presets.minimal.plugins;
    const originalConfig = presets.minimal.config;

    const resolved = resolvePreset('minimal');

    expect(resolved).toMatchObject({
      name: 'minimal',
      description: presets.minimal.description,
    });
    expect(resolved.plugins).toEqual(['compression/cicada']);
    expect(resolved.config).toEqual({ 'compression/cicada': { aggressive: false } });
    expect(resolved.plugins).not.toBe(originalPlugins);
    expect(resolved.config).not.toBe(originalConfig);
    expect(presets.minimal.plugins).toBe(originalPlugins);
    expect(presets.minimal.config).toBe(originalConfig);
  });

  it('merges inherited plugins and config with overrides', () => {
    const resolved = resolvePreset('production');

    expect(resolved.plugins).toEqual([
      'compression/cicada',
      'compression/watchdog',
      'resilience/retry',
      'service/scheduler',
      'service/llm',
      'service/vfs',
      'sandbox',
      'analysis/fingerprint',
      'service/mcp',
    ]);

    expect(resolved.config).toMatchObject({
      'compression/cicada': { aggressive: true },
      'compression/watchdog': { threshold: 0.75 },
      'resilience/retry': { maxRetries: 3 },
    });
  });

  it('extends parents and preserves newly added config entries', () => {
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

  it('dedupes plugins across parent and child presets', () => {
    presets.__test_dedupe = {
      description: 'dedupe',
      extends: 'standard',
      plugins: ['compression/cicada', 'service/scheduler', 'extra/plugin', 'compression/cicada'],
      config: {},
    };

    const resolved = resolvePreset('__test_dedupe');

    expect(resolved.plugins).toEqual([
      'compression/cicada',
      'compression/watchdog',
      'resilience/retry',
      'service/scheduler',
      'extra/plugin',
    ]);
  });

  it('throws for unknown preset names across boundary values', () => {
    const cases = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '123',
      { length: 1, 0: 'x' },
    ];

    cases.forEach((value) => {
      expect(() => resolvePreset(value)).toThrow(/Unknown preset/);
    });
  });

  it('handles concurrent and rapid successive calls independently', async () => {
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(resolvePreset('standard')))
    );

    expect(concurrentResults).toHaveLength(5);
    expect(new Set(concurrentResults).size).toBe(5);
    concurrentResults.forEach((result) => {
      expect(result.name).toBe('standard');
      expect(result.plugins).toEqual([
        'compression/cicada',
        'compression/watchdog',
        'resilience/retry',
        'service/scheduler',
      ]);
    });

    const quickFirst = resolvePreset('standard');
    const quickSecond = resolvePreset('standard');

    expect(quickFirst).not.toBe(quickSecond);
    expect(quickFirst.config).not.toBe(quickSecond.config);
  });

  it('handles large inputs, long strings, and deep nesting', () => {
    const longName = 'x'.repeat(10000);
    expect(() => resolvePreset(longName)).toThrow(/Unknown preset/);

    const hugeFileContent = 'y'.repeat(200000);
    mockedReadFileSync.mockReturnValueOnce(hugeFileContent);
    const fileDerivedName = readFileSync('/tmp/huge.txt');
    expect(() => resolvePreset(fileDerivedName)).toThrow(/Unknown preset/);

    const deepConfig = buildDeepObject(8);
    presets.__test_deep = {
      description: 'deep',
      plugins: ['compression/cicada'],
      config: { 'deep/plugin': deepConfig },
    };

    const resolved = resolvePreset('__test_deep');
    expect(resolved.config['deep/plugin']).toEqual(deepConfig);
  });
});
