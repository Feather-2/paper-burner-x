import { describe, it, expect, vi, beforeEach } from 'vitest';

const { MockTextEncoder } = vi.hoisted(() => ({
  MockTextEncoder: class {
    encode(value) {
      return { length: value.length * 2 };
    }
  },
}));

vi.mock('node:util', () => ({
  TextEncoder: MockTextEncoder,
}));

import { TextEncoder as MockedTextEncoder } from 'node:util';

import {
  OUTPUT_THRESHOLD,
  PREVIEW_SIZE,
  KEEP_RECENT_OUTPUTS,
  PERSISTED_OUTPUT_START,
  PERSISTED_OUTPUT_END,
  isPersistedOutput,
  wrapPersistedOutput,
  cleanOldPersistedOutputs,
  createPersistedOutputHook,
  configurePersistedOutput,
  getPersistedOutputConfig,
  resetPersistedOutputConfig,
  default as persistedOutputDefault,
} from '../../../../../js/agents/runtime/core/persisted-output.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetPersistedOutputConfig();
});

function buildDeepObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  return root;
}

describe('OUTPUT_THRESHOLD', () => {
  it('matches the expected default', () => {
    expect(OUTPUT_THRESHOLD).toBe(400000);
  });
});

describe('PREVIEW_SIZE', () => {
  it('matches the expected default', () => {
    expect(PREVIEW_SIZE).toBe(2000);
  });
});

describe('KEEP_RECENT_OUTPUTS', () => {
  it('matches the expected default', () => {
    expect(KEEP_RECENT_OUTPUTS).toBe(3);
  });
});

describe('PERSISTED_OUTPUT_START', () => {
  it('matches the expected marker', () => {
    expect(PERSISTED_OUTPUT_START).toBe('<persisted-output>');
  });
});

describe('PERSISTED_OUTPUT_END', () => {
  it('matches the expected marker', () => {
    expect(PERSISTED_OUTPUT_END).toBe('</persisted-output>');
  });
});

describe('isPersistedOutput', () => {
  it('returns false for non-string values', () => {
    const values = [null, undefined, 0, -1, {}, [], true];
    values.forEach((value) => {
      expect(isPersistedOutput(value)).toBe(false);
    });
  });

  it('returns false for empty or whitespace strings', () => {
    expect(isPersistedOutput('')).toBe(false);
    expect(isPersistedOutput('   ')).toBe(false);
  });

  it('returns true when the persisted tag is present', () => {
    expect(isPersistedOutput(`${PERSISTED_OUTPUT_START}data`)).toBe(true);
    expect(isPersistedOutput(`prefix ${PERSISTED_OUTPUT_START} suffix`)).toBe(true);
  });
});

describe('wrapPersistedOutput', () => {
  it('returns original string when under or at the threshold', () => {
    expect(wrapPersistedOutput('', { threshold: 0 })).toBe('');
    expect(wrapPersistedOutput('abc', { threshold: 3 })).toBe('abc');
    expect(wrapPersistedOutput('   ', { threshold: 3 })).toBe('   ');
  });

  it('stringifies non-string content including empty objects and arrays', () => {
    expect(wrapPersistedOutput({})).toBe('{}');
    expect(wrapPersistedOutput([])).toBe('[]');
    expect(wrapPersistedOutput(0)).toBe('0');
    expect(wrapPersistedOutput(null)).toBe('null');
  });

  it('falls back to String when JSON.stringify throws', () => {
    const value = { toString: () => 'circular' };
    value.self = value;
    expect(wrapPersistedOutput(value, { threshold: 100 })).toBe('circular');
  });

  it('handles undefined input by coercing to an empty string', () => {
    expect(wrapPersistedOutput(undefined)).toBe('');
  });

  it('wraps large output and includes preview and tags', () => {
    const content = 'x'.repeat(50);
    const result = wrapPersistedOutput(content, { threshold: 10, previewSize: 5 });

    expect(result).toContain(PERSISTED_OUTPUT_START);
    expect(result).toContain(PERSISTED_OUTPUT_END);
    expect(result).toContain('[Large output truncated - showing first 5 characters]');
    expect(result).toContain(content.slice(0, 5));
    expect(result).toContain('[Use VFS to access full content if needed]');
  });

  it('uses TextEncoder byte length when formatting totals', () => {
    vi.stubGlobal('TextEncoder', MockedTextEncoder);

    const content = 'abcd';
    const result = wrapPersistedOutput(content, { threshold: 1, previewSize: 2 });
    const expectedBytes = (content.length * 2).toLocaleString();
    const expectedChars = content.length.toLocaleString();

    expect(result).toContain(`[Total: ${expectedBytes} bytes / ${expectedChars} characters]`);
  });

  it('uses byte threshold semantics for multi-byte content', () => {
    const content = '你好'; // 2 chars, 6 bytes in UTF-8
    const result = wrapPersistedOutput(content, { threshold: 4, previewSize: 2 });
    expect(result).toContain(PERSISTED_OUTPUT_START);
    expect(result).toContain('[Total: 6 bytes / 2 characters]');
  });

  it('accepts numeric strings for threshold and previewSize', () => {
    const content = 'abcdef';
    const result = wrapPersistedOutput(content, { threshold: '1', previewSize: '2' });

    expect(result).toContain(PERSISTED_OUTPUT_START);
    expect(result).toContain(content.slice(0, 2));
  });

  it('handles negative thresholds and zero preview size', () => {
    const content = 'abc';
    const result = wrapPersistedOutput(content, { threshold: -1, previewSize: 0 });

    expect(result).toContain('first 0 characters');
    expect(result).toContain(PERSISTED_OUTPUT_START);
  });

  it('avoids wrapping when threshold is MAX_SAFE_INTEGER', () => {
    const content = 'y'.repeat(1000);
    const result = wrapPersistedOutput(content, { threshold: Number.MAX_SAFE_INTEGER });

    expect(result).toBe(content);
  });

  it('handles very large strings beyond the default threshold', () => {
    const content = 'a'.repeat(OUTPUT_THRESHOLD + 10);
    const result = wrapPersistedOutput(content);
    const preview = content.slice(0, PREVIEW_SIZE);

    expect(result).toContain(PERSISTED_OUTPUT_START);
    expect(result).toContain(preview);
    expect(result).toContain(`${content.length.toLocaleString()} characters`);
  });

  it('handles deep nested objects without throwing', () => {
    const deep = buildDeepObject(60);
    const result = wrapPersistedOutput(deep, { threshold: 5, previewSize: 10 });

    expect(result).toContain(PERSISTED_OUTPUT_START);
  });

  it('handles concurrent calls without shared state', async () => {
    const inputs = ['alpha', 'beta', 'gamma', 'delta'];
    const results = await Promise.all(
      inputs.map((value) =>
        Promise.resolve(wrapPersistedOutput(value.repeat(5), { threshold: 5, previewSize: 3 }))),
    );

    results.forEach((result, index) => {
      expect(result).toContain(PERSISTED_OUTPUT_START);
      expect(result).toContain(inputs[index].repeat(5).slice(0, 3));
    });
  });
});

describe('scoped config', () => {
  it('supports scope-specific persisted output config isolation', () => {
    configurePersistedOutput({ outputThreshold: 10 }, { scope: 'run-a' });
    configurePersistedOutput({ outputThreshold: 20 }, { scope: 'run-b' });

    expect(getPersistedOutputConfig({ scope: 'run-a' }).outputThreshold).toBe(10);
    expect(getPersistedOutputConfig({ scope: 'run-b' }).outputThreshold).toBe(20);
    expect(getPersistedOutputConfig().outputThreshold).toBe(OUTPUT_THRESHOLD);

    const wrappedA = wrapPersistedOutput('x'.repeat(15), { scope: 'run-a' });
    const wrappedB = wrapPersistedOutput('x'.repeat(15), { scope: 'run-b' });
    expect(wrappedA).toContain(PERSISTED_OUTPUT_START);
    expect(wrappedB).toBe('x'.repeat(15));

    resetPersistedOutputConfig({ scope: 'run-a' });
    expect(getPersistedOutputConfig({ scope: 'run-a' }).outputThreshold).toBe(OUTPUT_THRESHOLD);
  });
});

describe('cleanOldPersistedOutputs', () => {
  it('returns non-array input unchanged', () => {
    const values = [null, undefined, {}, '', 0];
    values.forEach((value) => {
      expect(cleanOldPersistedOutputs(value)).toBe(value);
    });
  });

  it('returns empty array as-is', () => {
    const messages = [];
    const result = cleanOldPersistedOutputs(messages);

    expect(result).toBe(messages);
    expect(result).toEqual([]);
  });

  it('returns original array when persisted outputs are within keepRecent', () => {
    const messages = [
      { content: `${PERSISTED_OUTPUT_START}a` },
      { content: 'normal' },
    ];
    const result = cleanOldPersistedOutputs(messages, 1);

    expect(result).toBe(messages);
  });

  it('cleans oldest persisted outputs beyond keepRecent', () => {
    const messages = [
      { role: 'assistant', content: `${PERSISTED_OUTPUT_START}A` },
      { role: 'user', content: 'normal' },
      { role: 'assistant', content: `${PERSISTED_OUTPUT_START}B` },
      { role: 'assistant', content: `${PERSISTED_OUTPUT_START}C` },
      { role: 'assistant', content: `${PERSISTED_OUTPUT_START}D` },
    ];
    const result = cleanOldPersistedOutputs(messages, 2);

    expect(result).not.toBe(messages);
    expect(result[0].content).toBe('[Old large output cleared to save context space]');
    expect(result[2].content).toBe('[Old large output cleared to save context space]');
    expect(result[3].content).toBe(messages[3].content);
    expect(result[4].content).toBe(messages[4].content);
    expect(result[0].role).toBe('assistant');
  });

  it('ignores non-object entries and non-string content', () => {
    const messages = [
      null,
      { content: 123 },
      { content: `${PERSISTED_OUTPUT_START}A` },
      { content: `${PERSISTED_OUTPUT_START}B` },
    ];
    const result = cleanOldPersistedOutputs(messages, 1);

    expect(result[0]).toBeNull();
    expect(result[1].content).toBe(123);
    expect(result[2].content).toBe('[Old large output cleared to save context space]');
    expect(result[3].content).toBe(messages[3].content);
  });

  it('keeps outputs unchanged when keepRecent is 0 because of slice behavior', () => {
    const messages = [
      { content: `${PERSISTED_OUTPUT_START}A` },
      { content: `${PERSISTED_OUTPUT_START}B` },
    ];
    const result = cleanOldPersistedOutputs(messages, 0);

    expect(result[0].content).toBe(messages[0].content);
    expect(result[1].content).toBe(messages[1].content);
  });

  it('cleans at least one output when keepRecent is negative', () => {
    const messages = [
      { content: `${PERSISTED_OUTPUT_START}A` },
      { content: `${PERSISTED_OUTPUT_START}B` },
    ];
    const result = cleanOldPersistedOutputs(messages, -1);

    expect(result[0].content).toBe('[Old large output cleared to save context space]');
    expect(result[1].content).toBe(messages[1].content);
  });

  it('accepts keepRecent as a numeric string', () => {
    const messages = [
      { content: `${PERSISTED_OUTPUT_START}A` },
      { content: `${PERSISTED_OUTPUT_START}B` },
    ];
    const result = cleanOldPersistedOutputs(messages, '1');

    expect(result[0].content).toBe('[Old large output cleared to save context space]');
    expect(result[1].content).toBe(messages[1].content);
  });
});

describe('createPersistedOutputHook', () => {
  it('returns a hook function', () => {
    expect(typeof createPersistedOutputHook()).toBe('function');
  });

  it('returns non-object results as-is', () => {
    const hook = createPersistedOutputHook();

    expect(hook({ tool: 't', result: null })).toBe(null);
    expect(hook({ tool: 't', result: undefined })).toBe(undefined);
    expect(hook({ tool: 't', result: 'text' })).toBe('text');
  });

  it('returns original result when data is not a string', () => {
    const hook = createPersistedOutputHook();
    const result = { data: 123, extra: {} };

    expect(hook({ tool: 't', result })).toBe(result);
  });

  it('returns original result when data is within threshold', () => {
    const hook = createPersistedOutputHook({ threshold: 10 });
    const result = { data: 'short', meta: 'ok' };

    expect(hook({ tool: 't', result })).toBe(result);
  });

  it('wraps large data and preserves other fields', () => {
    const hook = createPersistedOutputHook({ threshold: 5, previewSize: 3 });
    const result = { data: 'longer than 5', meta: 'keep' };
    const output = hook({ tool: 't', result });

    expect(output).not.toBe(result);
    expect(output.data).toContain(PERSISTED_OUTPUT_START);
    expect(output.meta).toBe('keep');
  });

  it('handles rapid sequential calls', () => {
    const hook = createPersistedOutputHook({ threshold: 2, previewSize: 1 });
    const outputs = [];

    for (let i = 0; i < 5; i += 1) {
      outputs.push(hook({ tool: 't', result: { data: `v${i}-xxxx`, index: i } }));
    }

    outputs.forEach((output, index) => {
      expect(output.data).toContain(PERSISTED_OUTPUT_START);
      expect(output.index).toBe(index);
    });
  });
});

describe('default export', () => {
  it('exposes the same references as named exports', () => {
    expect(persistedOutputDefault).toEqual(expect.objectContaining({
      OUTPUT_THRESHOLD,
      PREVIEW_SIZE,
      KEEP_RECENT_OUTPUTS,
      PERSISTED_OUTPUT_START,
      PERSISTED_OUTPUT_END,
      isPersistedOutput,
      wrapPersistedOutput,
      cleanOldPersistedOutputs,
    }));
    expect(persistedOutputDefault.isPersistedOutput).toBe(isPersistedOutput);
    expect(persistedOutputDefault.wrapPersistedOutput).toBe(wrapPersistedOutput);
    expect(persistedOutputDefault.cleanOldPersistedOutputs).toBe(cleanOldPersistedOutputs);
    expect(persistedOutputDefault.OUTPUT_THRESHOLD).toBe(OUTPUT_THRESHOLD);
    expect(persistedOutputDefault.PREVIEW_SIZE).toBe(PREVIEW_SIZE);
    expect(persistedOutputDefault.KEEP_RECENT_OUTPUTS).toBe(KEEP_RECENT_OUTPUTS);
    expect(persistedOutputDefault.PERSISTED_OUTPUT_START).toBe(PERSISTED_OUTPUT_START);
    expect(persistedOutputDefault.PERSISTED_OUTPUT_END).toBe(PERSISTED_OUTPUT_END);
    expect(persistedOutputDefault.createPersistedOutputHook).toBeUndefined();
  });
});
