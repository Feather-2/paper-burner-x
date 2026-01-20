import { beforeEach, describe, expect, it, vi } from 'vitest';

const resourceMocks = vi.hoisted(() => {
  const makeDeepNested = (depth) => {
    let node = { value: 'leaf' };
    for (let i = 0; i < depth; i += 1) {
      node = { next: node };
    }
    return node;
  };
  return {
    getHugeString: vi.fn(() => 'x'.repeat(100000)),
    getHugeBuffer: vi.fn(() => new Uint8Array(1024 * 1024)),
    getDeepNested: vi.fn(() => makeDeepNested(1000)),
  };
});

vi.mock('virtual:resource-fixtures', () => resourceMocks, { virtual: true });

import {
  TransportKind,
  isValidTransportKind,
  normalizeTransportKind,
} from '../../../../js/agents/mcp/constants.js';
import {
  getDeepNested,
  getHugeBuffer,
  getHugeString,
} from 'virtual:resource-fixtures';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TransportKind', () => {
  it('exports the expected transport identifiers', () => {
    expect(TransportKind).toEqual({
      JSONRPC: 'jsonrpc',
      TOOLAPI: 'toolapi',
      REST: 'rest',
    });
  });

  it('is frozen and resists mutation attempts', () => {
    const original = TransportKind.JSONRPC;

    expect(Object.isFrozen(TransportKind)).toBe(true);
    expect(() => {
      Object.defineProperty(TransportKind, 'JSONRPC', { value: 'changed' });
    }).toThrow(TypeError);
    expect(TransportKind.JSONRPC).toBe(original);
  });
});

describe('isValidTransportKind', () => {
  it('accepts known transport kinds', () => {
    expect(isValidTransportKind('jsonrpc')).toBe(true);
    expect(isValidTransportKind('toolapi')).toBe(true);
    expect(isValidTransportKind('rest')).toBe(true);
  });

  it('rejects invalid, nullish, and boundary values', () => {
    const invalidValues = [
      null,
      undefined,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      [],
      {},
      'JSONRPC',
      '123',
      { 0: 'jsonrpc', length: 1 },
      Symbol('sym'),
    ];

    invalidValues.forEach((value) => {
      expect(isValidTransportKind(value)).toBe(false);
    });
  });

  it('handles resource-heavy inputs without throwing', () => {
    const hugeString = getHugeString();
    const hugeBuffer = getHugeBuffer();
    const deepNested = getDeepNested();

    expect(() => isValidTransportKind(hugeString)).not.toThrow();
    expect(() => isValidTransportKind(hugeBuffer)).not.toThrow();
    expect(() => isValidTransportKind(deepNested)).not.toThrow();

    expect(isValidTransportKind(hugeString)).toBe(false);
    expect(isValidTransportKind(hugeBuffer)).toBe(false);
    expect(isValidTransportKind(deepNested)).toBe(false);

    expect(getHugeString).toHaveBeenCalledTimes(1);
    expect(getHugeBuffer).toHaveBeenCalledTimes(1);
    expect(getDeepNested).toHaveBeenCalledTimes(1);
  });

  it('remains consistent under concurrent and rapid calls', async () => {
    const inputs = ['jsonrpc', 'rest', 'toolapi', 'invalid', '', null, undefined];
    const results = await Promise.all(
      inputs.map((value) => Promise.resolve(isValidTransportKind(value)))
    );

    expect(results).toEqual([true, true, true, false, false, false, false]);

    const rapid = Array.from({ length: 50 }, () => isValidTransportKind('jsonrpc'));
    expect(rapid.every((value) => value === true)).toBe(true);
  });
});

describe('normalizeTransportKind', () => {
  it('normalizes valid kinds with whitespace and casing', () => {
    expect(normalizeTransportKind('JSONRPC')).toBe('jsonrpc');
    expect(normalizeTransportKind('  rest  ')).toBe('rest');
    expect(normalizeTransportKind(' ToolApi ')).toBe('toolapi');
  });

  it('returns undefined for invalid, nullish, and boundary values', () => {
    const invalidValues = [
      null,
      undefined,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      [],
      {},
      'unknown',
      'jsonrpcx',
      '123',
      { 0: 'jsonrpc', length: 1 },
    ];

    invalidValues.forEach((value) => {
      expect(normalizeTransportKind(value)).toBeUndefined();
    });
  });

  it('does not throw on unusual input types', () => {
    expect(() => normalizeTransportKind(Symbol('sym'))).not.toThrow();
    expect(() => normalizeTransportKind({ toString: () => { throw new Error('boom'); } })).not.toThrow();
  });

  it('handles resource-heavy inputs without throwing', () => {
    const hugeString = getHugeString();
    const hugeBuffer = getHugeBuffer();
    const deepNested = getDeepNested();

    expect(() => normalizeTransportKind(hugeString)).not.toThrow();
    expect(() => normalizeTransportKind(hugeBuffer)).not.toThrow();
    expect(() => normalizeTransportKind(deepNested)).not.toThrow();

    expect(normalizeTransportKind(hugeString)).toBeUndefined();
    expect(normalizeTransportKind(hugeBuffer)).toBeUndefined();
    expect(normalizeTransportKind(deepNested)).toBeUndefined();

    expect(getHugeString).toHaveBeenCalledTimes(1);
    expect(getHugeBuffer).toHaveBeenCalledTimes(1);
    expect(getDeepNested).toHaveBeenCalledTimes(1);
  });

  it('remains consistent under concurrent and rapid calls', async () => {
    const inputs = ['jsonrpc', 'REST', ' toolapi ', 'invalid', '', null, undefined];
    const results = await Promise.all(
      inputs.map((value) => Promise.resolve(normalizeTransportKind(value)))
    );

    expect(results).toEqual(['jsonrpc', 'rest', 'toolapi', undefined, undefined, undefined, undefined]);

    const rapid = Array.from({ length: 50 }, () => normalizeTransportKind('rest'));
    expect(rapid.every((value) => value === 'rest')).toBe(true);
  });
});
