import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:crypto', () => ({
  randomBytes: vi.fn((size) => Buffer.alloc(size, 120)),
}));

import { randomBytes } from 'node:crypto';
import { formatLines } from '../../../../../js/agents/prompts/formatters/format-lines.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('formatLines', () => {
  it('returns empty string for nullish and empty inputs', () => {
    expect(formatLines(null)).toBe('');
    expect(formatLines(undefined)).toBe('');
    expect(formatLines('')).toBe('');
    expect(formatLines([])).toBe('');
  });

  it('stringifies empty objects and array-like objects', () => {
    expect(formatLines({})).toBe('[object Object]');
    expect(formatLines({ 0: 'a', length: 1 })).toBe('[object Object]');
  });

  it('joins array values with newlines and removes blank items', () => {
    const input = ['alpha', ' ', '', null, 'beta', undefined, '\n'];
    expect(formatLines(input)).toBe('alpha\nbeta');
  });

  it('stringifies numeric boundaries and preserves string inputs', () => {
    expect(formatLines(0)).toBe('0');
    expect(formatLines(-1)).toBe('-1');
    expect(formatLines(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(formatLines('42')).toBe('42');
    expect(formatLines('   ')).toBe('   ');
  });

  it('handles deep nested values inside arrays', () => {
    const nestedArray = ['b', ['c', ['d', ['e']]]];
    const nestedObject = { level: { next: { value: 1 } } };
    const output = formatLines(['a', nestedArray, nestedObject]);

    expect(output).toBe(`a\n${String(nestedArray)}\n${String(nestedObject)}`);
  });

  it('propagates errors thrown by toString', () => {
    const bad = {
      toString() {
        throw new Error('boom');
      },
    };

    expect(() => formatLines(bad)).toThrow('boom');
  });

  it('handles simultaneous calls without shared state', async () => {
    const inputs = [['a', 'b'], ['x', '', 'y'], null, 5];
    const results = await Promise.all(
      inputs.map((value) => Promise.resolve().then(() => formatLines(value))),
    );

    expect(results).toEqual(['a\nb', 'x\ny', '', '5']);
  });

  it('handles rapid sequential calls consistently', () => {
    const values = [['a', ' ', 'b'], 'c', 0];
    const expected = ['a\nb', 'c', '0'];

    for (let i = 0; i < 60; i += 1) {
      expect(formatLines(values[i % values.length])).toBe(expected[i % expected.length]);
    }
  });

  it('handles large arrays (large file boundary)', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line-${i}`);
    const output = formatLines(lines);

    expect(output.startsWith('line-0')).toBe(true);
    expect(output.endsWith(`line-${lines.length - 1}`)).toBe(true);
    expect(output.split('\n')).toHaveLength(lines.length);
  });

  it('handles long strings generated from mocked dependencies', () => {
    const longString = randomBytes(8192).toString('hex');

    expect(formatLines(longString)).toBe(longString);
    expect(randomBytes).toHaveBeenCalledWith(8192);
  });
});
