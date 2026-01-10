/**
 * @file tests/ppt/storage/checkpoint-manager.test.js
 * @description js/ppt/storage/checkpoint-manager.js unit tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CheckpointManager,
  getStageName,
} from '../../../js/ppt/storage/checkpoint-manager.js';

function makeLocalStorage(initial = {}) {
  const entries = Object.entries(initial).map(([key, value]) => [key, String(value)]);
  const store = new Map(entries);

  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
  };
}

describe('ppt/storage/checkpoint-manager (CheckpointManager)', () => {
  const ORIGINAL_LOCALSTORAGE = globalThis.localStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    globalThis.localStorage = makeLocalStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.localStorage = ORIGINAL_LOCALSTORAGE;
  });

  it('save() stores checkpoints, uses toJSON when present, and clamps history length', () => {
    const manager = new CheckpointManager('p1');

    const state = {
      iteration: 1,
      L1: { claims: [{}, {}] },
      toJSON: () => ({ ok: true }),
    };

    const cp1 = manager.save('deepsearch.scan', state, { slideCount: 3 });
    expect(cp1).toMatchObject({
      stage: 'deepsearch.scan',
      metadata: { iteration: 1, claimCount: 2, slideCount: 3 },
      state: { ok: true },
    });

    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(1);
      manager.save(`stage_${i}`, { iteration: i, L1: { claims: [] } });
    }

    const all = manager.getAll();
    expect(all).toHaveLength(5); // MAX_CHECKPOINTS
    expect(all[0].stage).toBe('stage_0');
    expect(manager.getLatest().stage).toBe('stage_4');
  });

  it('getLatestByStage returns the latest checkpoint for a stage', () => {
    const manager = new CheckpointManager('p1');

    manager.save('a', { iteration: 0 });
    vi.advanceTimersByTime(1);
    manager.save('b', { iteration: 1 });
    vi.advanceTimersByTime(1);
    manager.save('a', { iteration: 2 });

    expect(manager.getLatestByStage('a').metadata.iteration).toBe(2);
    expect(manager.getLatestByStage('missing')).toBeNull();
  });

  it('hasRecoverable/getRecoverySummary reflect latest checkpoint', () => {
    const manager = new CheckpointManager('p1');

    expect(manager.hasRecoverable()).toBe(false);
    expect(manager.getRecoverySummary()).toBeNull();

    manager.save('deepsearch.write', { iteration: 3 });
    expect(manager.hasRecoverable()).toBe(true);
    expect(manager.getRecoverySummary()).toMatchObject({
      stage: 'deepsearch.write',
      canRecover: true,
      metadata: { iteration: 3 },
    });
  });

  it('clear() removes stored checkpoints', () => {
    const manager = new CheckpointManager('p1');
    manager.save('a', {});
    expect(manager.getAll()).toHaveLength(1);

    manager.clear();
    expect(manager.getAll()).toEqual([]);
  });

  it('handles invalid stored JSON gracefully', () => {
    globalThis.localStorage.setItem('ppt_checkpoint_p1', 'not-json');

    const manager = new CheckpointManager('p1');
    expect(manager.getAll()).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load checkpoints'),
      expect.anything(),
    );
  });
});

describe('ppt/storage/checkpoint-manager (getStageName)', () => {
  it('returns friendly names for known stages and falls back to raw stage', () => {
    expect(getStageName('deepsearch.scan')).toBe('DeepSearch: 扫描');
    expect(getStageName('unknown.stage')).toBe('unknown.stage');
  });
});

