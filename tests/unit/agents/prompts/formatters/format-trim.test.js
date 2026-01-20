import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedFs = vi.hoisted(() => ({
  readFileSync: vi.fn(() => `   ${'A'.repeat(1000000)}   `),
}));

vi.mock('node:fs', () => ({
  readFileSync: mockedFs.readFileSync,
}));

import { formatTrim } from '../../../../../js/agents/prompts/formatters/format-trim.js';
import { readFileSync } from 'node:fs';

describe('formatTrim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty string for nullish and empty string values', () => {
    expect(formatTrim(null)).toBe('');
    expect(formatTrim(undefined)).toBe('');
    expect(formatTrim('')).toBe('');
  });

  it('stringifies empty containers consistently', () => {
    expect(formatTrim([])).toBe('');
    expect(formatTrim({})).toBe('[object Object]');
  });

  it('trims normal inputs while preserving stringified values', () => {
    expect(formatTrim('  hello  ')).toBe('hello');
    expect(formatTrim(123)).toBe('123');
    expect(formatTrim(true)).toBe('true');
  });

  it('handles boundary numeric values and whitespace-only strings', () => {
    expect(formatTrim(0)).toBe('0');
    expect(formatTrim(-1)).toBe('-1');
    expect(formatTrim(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(formatTrim(' \n\t ')).toBe('');
  });

  it('handles string-as-number and array-like objects', () => {
    expect(formatTrim(' 42 ')).toBe('42');

    const arrayLike = {
      0: ' a ',
      1: ' b ',
      length: 2,
      toString() {
        return ' a , b ';
      },
    };

    expect(formatTrim(arrayLike)).toBe('a , b');
  });

  it('handles large file content and long strings', () => {
    const fileContent = readFileSync('big.txt', 'utf8');
    const trimmedFileContent = formatTrim(fileContent);

    expect(readFileSync).toHaveBeenCalledWith('big.txt', 'utf8');
    expect(trimmedFileContent.length).toBe(fileContent.length - 6);
    expect(trimmedFileContent[0]).toBe('A');
    expect(trimmedFileContent[trimmedFileContent.length - 1]).toBe('A');

    const longString = `  ${'B'.repeat(200000)}  `;
    const trimmedLongString = formatTrim(longString);

    expect(trimmedLongString.length).toBe(longString.length - 4);
    expect(trimmedLongString[0]).toBe('B');
    expect(trimmedLongString[trimmedLongString.length - 1]).toBe('B');
  });

  it('handles deep nested structures', () => {
    const nested = [[[[['  deep  ']]]]];

    expect(formatTrim(nested)).toBe('deep');
  });

  it('supports concurrent and rapid sequential calls', async () => {
    const values = ['  one  ', 2, null, '   three', []];
    const concurrentResults = await Promise.all(
      values.map((value) => Promise.resolve().then(() => formatTrim(value)))
    );

    expect(concurrentResults).toEqual(['one', '2', '', 'three', '']);

    const sequentialResults = [];
    for (let index = 0; index < 1000; index += 1) {
      sequentialResults.push(formatTrim('  repeat  '));
    }

    expect(sequentialResults).toHaveLength(1000);
    expect(sequentialResults.every((result) => result === 'repeat')).toBe(true);
  });

  it('propagates errors from string conversion', () => {
    const badValue = {
      toString() {
        throw new Error('boom');
      },
    };

    expect(() => formatTrim(badValue)).toThrow('boom');
  });
});
