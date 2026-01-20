/**
 * @file tests/unit/agents/core/archive/checkpoint-schema.test.js
 * @description Unit tests for checkpoint-schema.js exports; covers defaults, boundaries, concurrency, and migrations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => 'x'.repeat(2 * 1024 * 1024)),
}));

import {
  CHECKPOINT_SCHEMA_VERSION,
  CheckpointType,
  createCheckpoint,
  validateCheckpoint,
  migrateCheckpoint,
} from '../../../../../js/agents/core/archive/checkpoint-schema.js';

const FIXED_TIME = new Date('2024-01-01T00:00:00.000Z');
const FIXED_TS = FIXED_TIME.getTime();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('CHECKPOINT_SCHEMA_VERSION', () => {
  it('exposes the expected version string', () => {
    expect(typeof CHECKPOINT_SCHEMA_VERSION).toBe('string');
    expect(CHECKPOINT_SCHEMA_VERSION).toBe('1.0');
    expect(CHECKPOINT_SCHEMA_VERSION.trim()).toBe('1.0');
  });
});

describe('CheckpointType', () => {
  it('is frozen and exposes expected values', () => {
    expect(Object.isFrozen(CheckpointType)).toBe(true);
    expect(CheckpointType.PRE_ACTION).toBe('pre-action');
    expect(CheckpointType.PAUSE).toBe('pause');
    expect(CheckpointType.COMPRESS).toBe('compress');
    expect(CheckpointType.ARCHIVE).toBe('archive');
  });

  it('rejects mutation attempts', () => {
    expect(() => {
      CheckpointType.PRE_ACTION = 'override';
    }).toThrow(TypeError);
  });
});

describe('createCheckpoint', () => {
  it('creates a normalized checkpoint with defaults', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    const nodeStates = { node: 'alpha' };
    const checkpoint = createCheckpoint(nodeStates);

    expect(checkpoint.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(checkpoint.nodeStates).toBe(nodeStates);
    expect(checkpoint.timestamp).toBe(FIXED_TS);
    expect(checkpoint.metadata).toEqual({
      type: CheckpointType.PRE_ACTION,
      runId: undefined,
      iteration: undefined,
    });
  });

  it('merges metadata and preserves extras', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    const nodeStates = { step: 1 };
    const metadata = {
      type: CheckpointType.COMPRESS,
      runId: 'run-1',
      iteration: 2,
      extra: { ok: true },
    };

    const checkpoint = createCheckpoint(nodeStates, metadata);

    expect(checkpoint.metadata).toEqual({
      type: CheckpointType.COMPRESS,
      runId: 'run-1',
      iteration: 2,
      extra: { ok: true },
    });
    expect(checkpoint.timestamp).toBe(FIXED_TS);
  });

  it('handles boundary and type-mismatch metadata values', () => {
    const metadata = {
      type: '',
      runId: '   ',
      iteration: '7',
      zero: 0,
      negative: -1,
      max: Number.MAX_SAFE_INTEGER,
    };

    const checkpoint = createCheckpoint({ ok: true }, metadata);

    expect(checkpoint.metadata.type).toBe('');
    expect(checkpoint.metadata.runId).toBe('   ');
    expect(checkpoint.metadata.iteration).toBe('7');
    expect(checkpoint.metadata.zero).toBe(0);
    expect(checkpoint.metadata.negative).toBe(-1);
    expect(checkpoint.metadata.max).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('accepts array metadata and empty array nodeStates', () => {
    const nodeStates = [];
    const metadata = ['alpha', 'beta'];
    const checkpoint = createCheckpoint(nodeStates, metadata);

    expect(checkpoint.nodeStates).toBe(nodeStates);
    expect(checkpoint.metadata.type).toBe(CheckpointType.PRE_ACTION);
    expect(checkpoint.metadata[0]).toBe('alpha');
    expect(checkpoint.metadata[1]).toBe('beta');
  });

  it('handles resource boundary inputs (huge file, long string, deep nesting)', () => {
    const hugePayload = readFileSync('/tmp/huge.txt', 'utf8');
    const longRunId = 'r'.repeat(100_000);
    const deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i <= 100; i += 1) {
      cursor.child = { level: i };
      cursor = cursor.child;
    }

    const checkpoint = createCheckpoint(deep, { runId: longRunId, payload: hugePayload });

    expect(hugePayload.length).toBeGreaterThan(1024 * 1024);
    expect(checkpoint.nodeStates).toBe(deep);
    expect(checkpoint.metadata.runId).toBe(longRunId);
    expect(checkpoint.metadata.payload).toBe(hugePayload);
    expect(readFileSync).toHaveBeenCalledWith('/tmp/huge.txt', 'utf8');
  });

  it('handles concurrent calls without shared state', async () => {
    const inputs = [
      { nodeStates: { a: 1 }, metadata: { runId: 'r1' } },
      { nodeStates: { b: 2 }, metadata: { runId: 'r2' } },
      { nodeStates: { c: 3 }, metadata: { runId: 'r3' } },
    ];

    const results = await Promise.all(
      inputs.map(({ nodeStates, metadata }) => Promise.resolve(createCheckpoint(nodeStates, metadata)))
    );

    expect(results.map((result) => result.nodeStates)).toEqual(inputs.map((input) => input.nodeStates));
    expect(results.map((result) => result.metadata.runId)).toEqual(['r1', 'r2', 'r3']);
    expect(results[0]).not.toBe(results[1]);
  });

  it('handles rapid consecutive calls without leaking state', () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(createCheckpoint({ index: i }, { iteration: i }));
    }

    expect(results.map((result) => result.metadata.iteration)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(results).size).toBe(results.length);
  });
});

describe('validateCheckpoint', () => {
  it('returns true for a valid checkpoint', () => {
    const checkpoint = createCheckpoint({ ok: true });
    expect(validateCheckpoint(checkpoint)).toBe(true);
  });

  it('returns false for empty or non-object inputs', () => {
    const cases = [null, undefined, '', 0, false, [], {}];
    for (const value of cases) {
      expect(validateCheckpoint(value)).toBe(false);
    }
  });

  it('accepts truthy values even with unusual types', () => {
    expect(validateCheckpoint({ schemaVersion: -1, nodeStates: 1 })).toBe(true);
    expect(validateCheckpoint({ schemaVersion: '   ', nodeStates: [] })).toBe(true);
    expect(
      validateCheckpoint({ schemaVersion: Number.MAX_SAFE_INTEGER, nodeStates: { a: 1 } })
    ).toBe(true);
  });

  it('rejects falsy schemaVersion or nodeStates', () => {
    expect(validateCheckpoint({ schemaVersion: '', nodeStates: {} })).toBe(false);
    expect(validateCheckpoint({ schemaVersion: 0, nodeStates: {} })).toBe(false);
    expect(validateCheckpoint({ schemaVersion: '1.0', nodeStates: 0 })).toBe(false);
  });

  it('handles resource boundary inputs', () => {
    const hugePayload = readFileSync('/tmp/huge.txt', 'utf8');
    const deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i <= 50; i += 1) {
      cursor.child = { level: i };
      cursor = cursor.child;
    }

    expect(hugePayload.length).toBeGreaterThan(1024 * 1024);
    expect(validateCheckpoint({ schemaVersion: '1.0', nodeStates: hugePayload })).toBe(true);
    expect(validateCheckpoint({ schemaVersion: '1.0', nodeStates: deep })).toBe(true);
    expect(readFileSync).toHaveBeenCalledWith('/tmp/huge.txt', 'utf8');
  });

  it('handles concurrent validation consistently', async () => {
    const inputs = [
      { schemaVersion: '1.0', nodeStates: {} },
      { schemaVersion: '', nodeStates: {} },
      null,
      { schemaVersion: 'x', nodeStates: [] },
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve(validateCheckpoint(input)))
    );

    expect(results).toEqual([true, false, false, true]);
  });
});

describe('migrateCheckpoint', () => {
  it('returns null for nullish or empty inputs', () => {
    const cases = [null, undefined, '', 0];
    for (const value of cases) {
      expect(migrateCheckpoint(value)).toBeNull();
    }
  });

  it('returns the same object for already migrated checkpoints', () => {
    const checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      nodeStates: { ok: true },
      timestamp: 123,
      metadata: { type: CheckpointType.PAUSE },
    };

    expect(migrateCheckpoint(checkpoint)).toBe(checkpoint);
  });

  it('migrates legacy format with explicit fields', () => {
    const nodeStates = { step: 'done' };
    const metadata = { type: CheckpointType.PAUSE, note: 'ok' };
    const legacy = { nodeStates, timestamp: 42, metadata };
    const migrated = migrateCheckpoint(legacy);

    expect(migrated).not.toBe(legacy);
    expect(migrated.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(migrated.nodeStates).toBe(nodeStates);
    expect(migrated.timestamp).toBe(42);
    expect(migrated.metadata).toBe(metadata);
  });

  it('falls back to defaults for missing fields and falsy values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    const missing = {};
    const missingMigrated = migrateCheckpoint(missing);

    expect(missingMigrated.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(missingMigrated.nodeStates).toBe(missing);
    expect(missingMigrated.timestamp).toBe(FIXED_TS);
    expect(missingMigrated.metadata).toEqual({ type: CheckpointType.ARCHIVE });

    const falsyFields = { timestamp: 0, metadata: null };
    const falsyMigrated = migrateCheckpoint(falsyFields);

    expect(falsyMigrated.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(falsyMigrated.nodeStates).toBe(falsyFields);
    expect(falsyMigrated.timestamp).toBe(FIXED_TS);
    expect(falsyMigrated.metadata).toEqual({ type: CheckpointType.ARCHIVE });
  });

  it('accepts array checkpoints and preserves empty metadata objects', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    const legacyWithEmptyMetadata = { nodeStates: { ok: true }, metadata: {} };
    const migrated = migrateCheckpoint(legacyWithEmptyMetadata);

    expect(migrated.metadata).toBe(legacyWithEmptyMetadata.metadata);

    const legacyArray = [];
    const migratedArray = migrateCheckpoint(legacyArray);

    expect(migratedArray.nodeStates).toBe(legacyArray);
    expect(migratedArray.timestamp).toBe(FIXED_TS);
    expect(migratedArray.metadata).toEqual({ type: CheckpointType.ARCHIVE });
  });

  it('handles rapid consecutive migrations without shared state', () => {
    const legacyList = [
      { nodeStates: { a: 1 }, timestamp: 1 },
      { nodeStates: { b: 2 }, timestamp: 2 },
      { nodeStates: { c: 3 }, timestamp: 3 },
    ];

    const results = legacyList.map((legacy) => migrateCheckpoint(legacy));

    expect(results.map((result) => result.timestamp)).toEqual([1, 2, 3]);
    expect(results.map((result) => result.nodeStates)).toEqual(
      legacyList.map((legacy) => legacy.nodeStates)
    );
  });
});
