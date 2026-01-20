/**
 * @file tests/unit/agents/prompts/formatters/escape-template-delimiters.test.js
 * @description Unit tests for escapeTemplateDelimiters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { escapeTemplateDelimiters } from '../../../../../js/agents/prompts/formatters/escape-template-delimiters.js';

vi.mock('node:os', () => ({
  cpus: vi.fn(() => Array.from({ length: 4 }, () => ({ model: 'mock' }))),
}));

const ZERO_WIDTH_SPACE = "\u200B";
const ESCAPED_OPEN = `{${ZERO_WIDTH_SPACE}{`;
const ESCAPED_CLOSE = `}${ZERO_WIDTH_SPACE}}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('escapeTemplateDelimiters', () => {
  it('escapes double-brace delimiters in strings', () => {
    const input = 'a {{b}} c {{d}}';
    const output = escapeTemplateDelimiters(input);

    expect(output).toBe(`a ${ESCAPED_OPEN}b${ESCAPED_CLOSE} c ${ESCAPED_OPEN}d${ESCAPED_CLOSE}`);
  });

  it('leaves strings without delimiters unchanged', () => {
    const input = 'plain text';
    expect(escapeTemplateDelimiters(input)).toBe(input);
  });

  it('handles empty-like inputs and empty containers', () => {
    expect(escapeTemplateDelimiters(null)).toBe('');
    expect(escapeTemplateDelimiters(undefined)).toBe('');
    expect(escapeTemplateDelimiters('')).toBe('');
    expect(escapeTemplateDelimiters([])).toBe('');
    expect(escapeTemplateDelimiters({})).toBe('[object Object]');
  });

  it('stringifies boundary numeric values and whitespace strings', () => {
    expect(escapeTemplateDelimiters(0)).toBe('0');
    expect(escapeTemplateDelimiters(-1)).toBe('-1');
    expect(escapeTemplateDelimiters(Number.MAX_SAFE_INTEGER))
      .toBe(String(Number.MAX_SAFE_INTEGER));
    expect(escapeTemplateDelimiters(' \t\n')).toBe(' \t\n');
  });

  it('handles type boundaries for numeric strings and array-like objects', () => {
    expect(escapeTemplateDelimiters('00123')).toBe('00123');

    const arrayLike = { 0: 'alpha', length: 1 };
    expect(escapeTemplateDelimiters(arrayLike)).toBe('[object Object]');
  });

  it('escapes delimiters after stringifying non-string values', () => {
    const value = {
      toString: () => 'value {{x}} end',
    };

    expect(escapeTemplateDelimiters(value)).toBe(`value ${ESCAPED_OPEN}x${ESCAPED_CLOSE} end`);
  });

  it('propagates errors when stringification fails', () => {
    const value = {
      toString: () => {
        throw new Error('boom');
      },
    };

    expect(() => escapeTemplateDelimiters(value)).toThrow('boom');
  });

  it('handles concurrent calls safely', async () => {
    const { cpus } = await import('node:os');
    const concurrency = cpus().length;

    const inputs = Array.from({ length: concurrency }, (_, i) => `value {{${i}}}`);
    const outputs = await Promise.all(
      inputs.map((input) => Promise.resolve(escapeTemplateDelimiters(input)))
    );

    outputs.forEach((output, i) => {
      expect(output).toBe(`value ${ESCAPED_OPEN}${i}${ESCAPED_CLOSE}`);
    });
  });

  it('handles rapid consecutive calls consistently', () => {
    const outputs = [];
    for (let i = 0; i < 25; i += 1) {
      outputs.push(escapeTemplateDelimiters(`fast {{${i}}}`));
    }

    outputs.forEach((output, i) => {
      expect(output).toBe(`fast ${ESCAPED_OPEN}${i}${ESCAPED_CLOSE}`);
    });
  });

  it('handles large file-like content and long strings', () => {
    const largeFile = Array.from({ length: 10000 }, (_, i) => `line ${i} {{value}}`).join('\n');
    const largeOut = escapeTemplateDelimiters(largeFile);

    expect(largeOut.includes('{{')).toBe(false);
    expect(largeOut.includes('}}')).toBe(false);
    expect(largeOut.includes(`${ESCAPED_OPEN}value${ESCAPED_CLOSE}`)).toBe(true);

    const longString = `${'x'.repeat(200000)}{{tail}}`;
    const longOut = escapeTemplateDelimiters(longString);

    expect(longOut.endsWith(`${ESCAPED_OPEN}tail${ESCAPED_CLOSE}`)).toBe(true);
    expect(longOut.length).toBe(longString.length + 2);
  });

  it('escapes delimiters inside deep nested structures', () => {
    const nested = [];
    let cursor = nested;
    for (let i = 0; i < 50; i += 1) {
      const next = [];
      cursor.push(next);
      cursor = next;
    }
    cursor.push('{{deep}}');

    const output = escapeTemplateDelimiters(nested);

    expect(output.includes('{{')).toBe(false);
    expect(output.includes('}}')).toBe(false);
    expect(output).toContain(`${ESCAPED_OPEN}deep${ESCAPED_CLOSE}`);
  });
});
