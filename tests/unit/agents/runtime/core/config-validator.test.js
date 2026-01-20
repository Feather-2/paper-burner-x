import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateLogger, mockCreateSafeRegex } = vi.hoisted(() => ({
  mockCreateLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  mockCreateSafeRegex: vi.fn((pattern, flags) => {
    if (pattern === '__invalid__') {
      throw new Error('Bad regex');
    }
    return new RegExp(pattern, flags);
  }),
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: mockCreateLogger,
  createSafeRegex: mockCreateSafeRegex,
}));

import { ConfigValidator, validateConfig, CommonSchemas } from '../../../../../js/agents/runtime/core/config-validator.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConfigValidator', () => {
  it('applies defaults for empty object and clones object defaults across calls', () => {
    const schema = {
      name: { type: 'string', default: 'anon' },
      settings: { type: 'object', default: { flags: { debug: true } } },
    };
    const validator = new ConfigValidator(schema);

    const first = validator.validate({});
    expect(first.valid).toBe(true);
    expect(first.errors).toEqual([]);
    expect(first.config).toEqual({
      name: 'anon',
      settings: { flags: { debug: true } },
    });

    first.config.settings.flags.debug = false;

    const second = validator.validate({});
    expect(second.config.settings.flags.debug).toBe(true);
    expect(second.config.settings).not.toBe(first.config.settings);
  });

  it('uses default function for missing fields', () => {
    const schema = {
      token: { type: 'string', default: () => 'token_1' },
    };
    const validator = new ConfigValidator(schema);

    const result = validator.validate({});
    expect(result.errors).toEqual([]);
    expect(result.config.token).toBe('token_1');
  });

  it('handles null or undefined root config by treating it as empty object', () => {
    const schema = {
      required: { type: 'string', required: true },
      optional: { type: 'string', default: 'x' },
    };
    const validator = new ConfigValidator(schema);

    for (const input of [null, undefined]) {
      const result = validator.validate(input);
      expect(result.config.optional).toBe('x');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({ path: 'required', message: 'Required field missing' });
    }
  });

  it('rejects non-object root values like empty arrays', () => {
    const schema = { name: { type: 'string' } };
    const validator = new ConfigValidator(schema);

    const result = validator.validate([]);
    expect(result.valid).toBe(false);
    expect(result.config).toEqual({});
    expect(result.errors).toEqual([
      { path: 'root', message: 'Expected object', value: [] },
    ]);
  });

  it('copies unknown fields in non-strict mode and reports them in strict mode', () => {
    const schema = { known: { type: 'string' } };

    const nonStrict = new ConfigValidator(schema);
    const nonStrictResult = nonStrict.validate({ known: 'ok', extra: 123 });
    expect(nonStrictResult.errors).toHaveLength(0);
    expect(nonStrictResult.config).toEqual({ known: 'ok', extra: 123 });

    const strict = new ConfigValidator(schema, { strict: true });
    const strictResult = strict.validate({ known: 'ok', extra: 123 });
    expect(strictResult.config).toEqual({ known: 'ok' });
    expect(strictResult.errors).toEqual([
      { path: 'extra', message: 'Unknown field', value: 123 },
    ]);
  });

  it('reports type mismatch without coercion for string as number and object as array', () => {
    const schema = {
      age: { type: 'number' },
      tags: { type: 'array' },
      name: { type: 'string' },
    };
    const validator = new ConfigValidator(schema);

    const result = validator.validate({ age: '42', tags: {}, name: null });
    expect(result.errors).toHaveLength(3);
    expect(result.errors).toEqual(expect.arrayContaining([
      { path: 'age', message: 'Expected number, got string', value: '42' },
      { path: 'tags', message: 'Expected array, got object', value: {} },
      { path: 'name', message: 'Expected string, got null', value: null },
    ]));
    expect(result.config.age).toBe('42');
  });

  it('coerces compatible types when enabled and rejects invalid coercions', () => {
    const schema = {
      age: { type: 'number' },
      flag: { type: 'boolean' },
    };
    const validator = new ConfigValidator(schema, { coerce: true });

    const okResult = validator.validate({ age: '42', flag: 0 });
    expect(okResult.errors).toHaveLength(0);
    expect(okResult.config).toEqual({ age: 42, flag: false });

    const badResult = validator.validate({ age: 'nope', flag: 1 });
    expect(badResult.errors).toEqual([
      { path: 'age', message: 'Expected number, got string', value: 'nope' },
    ]);
    expect(badResult.config).toEqual({ age: 'nope', flag: true });
  });

  it('enforces enum constraints', () => {
    const schema = {
      status: { type: 'string', enum: ['open', 'closed'] },
    };
    const validator = new ConfigValidator(schema);

    const result = validator.validate({ status: 'pending' });
    expect(result.errors).toEqual([
      { path: 'status', message: 'Value must be one of: open, closed', value: 'pending' },
    ]);
  });

  it('enforces number boundaries including 0, -1, and MAX_SAFE_INTEGER', () => {
    const schema = {
      count: { type: 'number', min: 0, max: Number.MAX_SAFE_INTEGER },
    };
    const validator = new ConfigValidator(schema);

    const tooSmall = validator.validate({ count: -1 });
    expect(tooSmall.errors).toEqual([
      { path: 'count', message: 'Value must be >= 0', value: -1 },
    ]);

    const zero = validator.validate({ count: 0 });
    expect(zero.errors).toHaveLength(0);

    const maxOk = validator.validate({ count: Number.MAX_SAFE_INTEGER });
    expect(maxOk.errors).toHaveLength(0);

    const tooLarge = validator.validate({ count: Number.MAX_SAFE_INTEGER + 1 });
    expect(tooLarge.errors).toEqual([
      { path: 'count', message: `Value must be <= ${Number.MAX_SAFE_INTEGER}`, value: Number.MAX_SAFE_INTEGER + 1 },
    ]);
  });

  it('enforces string length and pattern constraints, including whitespace', () => {
    const schema = {
      title: { type: 'string', minLength: 1, maxLength: 5, pattern: '^\\S+$' },
    };
    const validator = new ConfigValidator(schema);

    const empty = validator.validate({ title: '' });
    expect(empty.errors).toHaveLength(2);
    expect(empty.errors).toEqual(expect.arrayContaining([
      { path: 'title', message: 'Length must be >= 1', value: '' },
      { path: 'title', message: 'Value must match pattern: ^\\S+$', value: '' },
    ]));

    const tooLong = validator.validate({ title: 'abcdef' });
    expect(tooLong.errors).toEqual([
      { path: 'title', message: 'Length must be <= 5', value: 'abcdef' },
    ]);

    const whitespace = validator.validate({ title: '   ' });
    expect(whitespace.errors).toEqual([
      { path: 'title', message: 'Value must match pattern: ^\\S+$', value: '   ' },
    ]);
    expect(mockCreateSafeRegex).toHaveBeenCalledWith('^\\S+$', 'u');

    const ok = validator.validate({ title: 'abc' });
    expect(ok.errors).toHaveLength(0);
  });

  it('reports invalid regex patterns', () => {
    const schema = { tag: { type: 'string', pattern: '__invalid__' } };
    const validator = new ConfigValidator(schema);

    const result = validator.validate({ tag: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe('Invalid pattern: __invalid__ (Bad regex)');
    expect(mockCreateSafeRegex).toHaveBeenCalledWith('__invalid__', 'u');
  });

  it('validates array length and item schemas', () => {
    const schema = {
      ids: { type: 'array', minLength: 1, maxLength: 3, items: { type: 'number', min: 0 } },
    };
    const validator = new ConfigValidator(schema);

    const empty = validator.validate({ ids: [] });
    expect(empty.errors).toEqual([
      { path: 'ids', message: 'Array length must be >= 1', value: [] },
    ]);

    const tooLong = validator.validate({ ids: [1, 2, 3, 4] });
    expect(tooLong.errors).toEqual([
      { path: 'ids', message: 'Array length must be <= 3', value: [1, 2, 3, 4] },
    ]);

    const badItem = validator.validate({ ids: [1, -1] });
    expect(badItem.errors).toEqual([
      { path: 'ids[1]', message: 'Value must be >= 0', value: -1 },
    ]);

    const ok = validator.validate({ ids: [0, 2] });
    expect(ok.errors).toHaveLength(0);
    expect(ok.config.ids).toEqual([0, 2]);
  });

  it('validates nested object properties and applies nested defaults', () => {
    const schema = {
      settings: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: true },
          threshold: { type: 'number', min: 0 },
        },
      },
    };
    const validator = new ConfigValidator(schema);

    const result = validator.validate({ settings: { threshold: -1 } });
    expect(result.config.settings).toEqual({ enabled: true, threshold: -1 });
    expect(result.errors).toEqual([
      { path: 'settings.threshold', message: 'Value must be >= 0', value: -1 },
    ]);
  });

  it('runs custom validators with explicit and fallback messages', () => {
    const schema = {
      code: { type: 'string', validate: (v) => (v === 'ok' ? true : 'bad code') },
      note: { type: 'string', validate: () => false },
    };
    const validator = new ConfigValidator(schema);

    const result = validator.validate({ code: 'no', note: 'x' });
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toEqual(expect.arrayContaining([
      { path: 'code', message: 'bad code', value: 'no' },
      { path: 'note', message: 'Custom validation failed', value: 'x' },
    ]));
  });

  it('allows any type but still runs custom validation', () => {
    const schema = {
      payload: { type: 'any', validate: (v) => (v ? true : 'missing') },
    };
    const validator = new ConfigValidator(schema);

    const result = validator.validate({ payload: 0 });
    expect(result.errors).toEqual([
      { path: 'payload', message: 'missing', value: 0 },
    ]);
  });

  it('supports concurrent and rapid consecutive validations without shared state', async () => {
    const schema = {
      options: { type: 'object', default: { list: [] } },
      count: { type: 'number', min: 0 },
    };
    const validator = new ConfigValidator(schema);

    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () => Promise.resolve(validator.validate({ count: 1 })))
    );

    expect(concurrent.every((result) => result.valid)).toBe(true);
    concurrent[0].config.options.list.push('x');
    expect(concurrent[1].config.options.list).toEqual([]);
    expect(concurrent[2].config.options.list).toEqual([]);

    const sequential = Array.from({ length: 3 }, () => validator.validate({ count: -1 }));
    expect(sequential[0].errors).not.toBe(sequential[1].errors);
    expect(sequential[0].errors[0].message).toBe('Value must be >= 0');
    expect(sequential[1].errors[0].message).toBe('Value must be >= 0');
  });

  it('handles resource boundaries for long strings, large arrays, and deep nesting', () => {
    const makeDeepSchema = (depth) => {
      let schema = { value: { type: 'string', minLength: 1 } };
      let config = { value: 'ok' };
      for (let i = 0; i < depth; i += 1) {
        schema = { child: { type: 'object', properties: schema } };
        config = { child: config };
      }
      return { schema, config };
    };

    const { schema: deepSchema, config: deepConfig } = makeDeepSchema(25);
    const schema = {
      blob: { type: 'string', maxLength: 5000 },
      lines: { type: 'array', maxLength: 1000, items: { type: 'string' } },
      deep: { type: 'object', properties: deepSchema },
    };
    const validator = new ConfigValidator(schema);

    const longString = 'a'.repeat(10000);
    const largeArray = Array.from({ length: 2000 }, () => 'x');
    const result = validator.validate({ blob: longString, lines: largeArray, deep: deepConfig });

    expect(result.errors).toHaveLength(2);
    expect(result.errors).toEqual(expect.arrayContaining([
      { path: 'blob', message: 'Length must be <= 5000', value: longString },
      { path: 'lines', message: 'Array length must be <= 1000', value: largeArray },
    ]));

    let current = result.config.deep;
    for (let i = 0; i < 25; i += 1) {
      current = current.child;
    }
    expect(current.value).toBe('ok');
  });
});

describe('validateConfig', () => {
  it('wraps ConfigValidator and honors options', () => {
    const schema = {
      url: CommonSchemas.url,
      count: { type: 'number', min: 0 },
    };

    const result = validateConfig(
      { url: 'https://example.com', count: '5', extra: 'x' },
      schema,
      { coerce: true, strict: true }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { path: 'extra', message: 'Unknown field', value: 'x' },
    ]);
    expect(result.config).toEqual({ url: 'https://example.com', count: 5 });
  });
});
