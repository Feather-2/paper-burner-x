import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';

const TYPES_MODULE_SPECIFIER = '../../../../js/agents/eval/types.js';
const TYPES_FILE_URL = new URL(TYPES_MODULE_SPECIFIER, import.meta.url);
const TYPES_FILE_PATH = fileURLToPath(TYPES_FILE_URL);

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    // Wrap with a mock so we can assert calls and simulate failures without changing real behavior.
    readFile: vi.fn(actual.readFile),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function importTypesModule() {
  return import(TYPES_MODULE_SPECIFIER);
}

async function readTypesSource() {
  const { readFile } = await import('node:fs/promises');
  return readFile(TYPES_FILE_PATH, 'utf8');
}

function normalizeTypeExpr(typeExpr) {
  if (typeof typeExpr !== 'string') {
    throw new TypeError('typeExpr must be a string');
  }
  return typeExpr.replace(/\s+/g, ' ').trim();
}

function parsePropertyNameToken(token) {
  if (typeof token !== 'string') {
    throw new TypeError('property token must be a string');
  }
  const trimmed = token.trim();
  if (!trimmed) {
    throw new TypeError('property token must be a non-empty string');
  }

  let optional = false;
  let name = trimmed;

  if (name.startsWith('[') && name.endsWith(']')) {
    optional = true;
    name = name.slice(1, -1);
  }

  // JSDoc allows defaults like [foo=bar]; we only care about the name.
  const eqIdx = name.indexOf('=');
  if (eqIdx !== -1) {
    name = name.slice(0, eqIdx);
  }

  return { name, optional };
}

function stripJsComments(code) {
  if (typeof code !== 'string') {
    throw new TypeError('code must be a string');
  }

  let out = '';
  let i = 0;
  let state = 'normal';

  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];

    if (state === 'normal') {
      if (c === '/' && n === '/') {
        state = 'lineComment';
        i += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        state = 'blockComment';
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'single';
        out += c;
        i += 1;
        continue;
      }
      if (c === '"') {
        state = 'double';
        out += c;
        i += 1;
        continue;
      }
      if (c === '`') {
        state = 'template';
        out += c;
        i += 1;
        continue;
      }

      out += c;
      i += 1;
      continue;
    }

    if (state === 'lineComment') {
      if (c === '\n') {
        out += '\n';
        state = 'normal';
      }
      i += 1;
      continue;
    }

    if (state === 'blockComment') {
      if (c === '*' && n === '/') {
        state = 'normal';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'single') {
      out += c;
      if (c === '\\') {
        if (i + 1 < code.length) out += code[i + 1];
        i += 2;
        continue;
      }
      if (c === "'") state = 'normal';
      i += 1;
      continue;
    }

    if (state === 'double') {
      out += c;
      if (c === '\\') {
        if (i + 1 < code.length) out += code[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') state = 'normal';
      i += 1;
      continue;
    }

    // template
    out += c;
    if (c === '\\') {
      if (i + 1 < code.length) out += code[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') state = 'normal';
    i += 1;
  }

  return out;
}

function isAllowedTypesOnlyRuntime(codeWithoutComments) {
  if (typeof codeWithoutComments !== 'string') {
    throw new TypeError('codeWithoutComments must be a string');
  }

  const normalized = codeWithoutComments.replace(/\s+/g, ' ').trim();
  if (normalized === '') return true;

  const exportEmpty = /^export\s*\{\s*\}\s*;?$/.test(normalized);
  if (exportEmpty) return true;

  const useStrictOnly = /^['"]use strict['"]\s*;?$/.test(normalized);
  if (useStrictOnly) return true;

  const useStrictThenExportEmpty =
    /^['"]use strict['"]\s*;?\s*export\s*\{\s*\}\s*;?$/.test(normalized);
  if (useStrictThenExportEmpty) return true;

  return false;
}

function parseJSDocTypedefs(source) {
  if (typeof source !== 'string') {
    throw new TypeError('source must be a string');
  }

  /** @type {Map<string, {name:string, kind:string, properties: Map<string, {type:string, optional:boolean, rawToken:string, desc?:string}>, raw:string}>} */
  const typedefs = new Map();

  const blocks = source.match(/\/\*\*[\s\S]*?\*\//g) || [];
  for (const block of blocks) {
    const lines = block
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd());

    const typedefLine = lines.find((l) => l.trimStart().startsWith('@typedef '));
    if (!typedefLine) continue;

    const tm = typedefLine.match(/^@typedef\s+\{([^}]+)\}\s+([A-Za-z0-9_$]+)/);
    if (!tm) continue;

    const kind = normalizeTypeExpr(tm[1]);
    const name = tm[2];

    /** @type {Map<string, {type:string, optional:boolean, rawToken:string, desc?:string}>} */
    const properties = new Map();

    for (const l of lines) {
      const pm = l.match(/^@property\s+\{([^}]+)\}\s+(\S+)(?:\s+-\s+(.*))?$/);
      if (!pm) continue;

      const type = normalizeTypeExpr(pm[1]);
      const rawToken = pm[2];
      const desc = pm[3]?.trim();

      const parsedName = parsePropertyNameToken(rawToken);
      properties.set(parsedName.name, {
        type,
        optional: parsedName.optional,
        rawToken,
        desc,
      });
    }

    typedefs.set(name, { name, kind, properties, raw: block });
  }

  return typedefs;
}

async function loadTypedefsFromRepo() {
  const source = await readTypesSource();
  return { source, typedefs: parseJSDocTypedefs(source) };
}

function expectTypedefHasProperties(typedef, expectedProps) {
  for (const [propName, expected] of Object.entries(expectedProps)) {
    const actual = typedef.properties.get(propName);
    expect(actual, `missing @property "${propName}" on ${typedef.name}`).toBeTruthy();

    if (expected.type != null) {
      expect(
        normalizeTypeExpr(actual.type),
        `${typedef.name}.${propName} type mismatch`,
      ).toBe(normalizeTypeExpr(expected.type));
    }

    if (typeof expected.optional === 'boolean') {
      expect(
        actual.optional,
        `${typedef.name}.${propName} optionality mismatch`,
      ).toBe(expected.optional);
    }
  }
}

const EXPECTED = {
  EvalTask: {
    id: { type: 'string', optional: false },
    description: { type: 'string', optional: false },
    input: { type: 'unknown', optional: false },
    expected: { type: 'unknown', optional: true },
    graders: { type: 'GraderConfig[]', optional: false },
    metadata: { type: 'Record<string, unknown>', optional: true },
    type: { type: "'capability' | 'regression'", optional: true },
  },
  Trial: {
    taskId: { type: 'string', optional: false },
    trialIndex: { type: 'number', optional: false },
    transcript: { type: 'Transcript', optional: false },
    outcome: { type: 'unknown', optional: false },
    graderResults: { type: 'GraderResult[]', optional: false },
    passed: { type: 'boolean', optional: false },
    score: { type: 'number', optional: false },
    latencyMs: { type: 'number', optional: false },
    metrics: { type: 'TrialMetrics', optional: false },
  },
  Transcript: {
    entries: { type: 'TranscriptEntry[]', optional: false },
    startTime: { type: 'number', optional: false },
    endTime: { type: 'number', optional: false },
  },
  TranscriptEntry: {
    type: {
      type: "'input' | 'output' | 'tool_call' | 'tool_result' | 'error' | 'event'",
      optional: false,
    },
    content: { type: 'unknown', optional: false },
    timestamp: { type: 'number', optional: false },
    metadata: { type: 'Record<string, unknown>', optional: true },
  },
  GraderConfig: {
    type: { type: 'string', optional: false },
    weight: { type: 'number', optional: true },
    options: { type: 'Record<string, unknown>', optional: true },
  },
  GraderResult: {
    graderType: { type: 'string', optional: false },
    passed: { type: 'boolean', optional: false },
    score: { type: 'number', optional: false },
    reason: { type: 'string', optional: true },
    issues: { type: 'EvalIssue[]', optional: true },
  },
  EvalIssue: {
    type: { type: 'string', optional: false },
    severity: { type: "'error' | 'warning' | 'info'", optional: false },
    message: { type: 'string', optional: false },
    location: { type: 'string', optional: true },
  },
  TrialMetrics: {
    turns: { type: 'number', optional: false },
    toolCalls: { type: 'number', optional: false },
    totalTokens: { type: 'number', optional: false },
    timeToFirstToken: { type: 'number', optional: true },
  },
  EvalSuiteResult: {
    suiteId: { type: 'string', optional: false },
    tasks: { type: 'TaskResult[]', optional: false },
    aggregated: { type: 'AggregatedMetrics', optional: false },
  },
  TaskResult: {
    taskId: { type: 'string', optional: false },
    trials: { type: 'Trial[]', optional: false },
    passRate: { type: 'number', optional: false },
    passAtK: { type: 'number', optional: false },
    passExpK: { type: 'number', optional: false },
  },
  AggregatedMetrics: {
    totalTasks: { type: 'number', optional: false },
    passedTasks: { type: 'number', optional: false },
    avgPassRate: { type: 'number', optional: false },
    avgScore: { type: 'number', optional: false },
    avgLatencyMs: { type: 'number', optional: false },
  },
  EvalSuite: {
    suiteId: { type: 'string', optional: false },
    tasks: { type: 'EvalTask[]', optional: false },
    metadata: { type: 'Record<string, unknown>', optional: true },
  },
  Grader: {
    type: { type: 'string', optional: false },
    grade: {
      type: '(input:any, config: GraderConfig, ...rest:any[]) => (GraderResult | Promise<GraderResult>)',
      optional: false,
    },
  },
};

describe('eval/types (module)', () => {
  it('imports without throwing (normal path)', async () => {
    await expect(importTypesModule()).resolves.toBeTruthy();
  });

  it('has no named runtime exports; if CJS interop adds default, it is empty', async () => {
    const mod = await importTypesModule();
    const keys = Object.keys(mod);
    const namedKeys = keys.filter((k) => k !== 'default');
    expect(namedKeys).toEqual([]);

    if ('default' in mod) {
      expect(mod.default).toEqual({});
    }
  });

  it('supports concurrent imports (concurrency boundary)', async () => {
    const mods = await Promise.all(
      Array.from({ length: 25 }, () => importTypesModule()),
    );

    for (const mod of mods) {
      const keys = Object.keys(mod);
      const namedKeys = keys.filter((k) => k !== 'default');
      expect(namedKeys).toEqual([]);
      if ('default' in mod) expect(mod.default).toEqual({});
    }
  });

  it('reads its source via fs/promises and records the call (mocked external dependency)', async () => {
    const source = await readTypesSource();
    expect(typeof source).toBe('string');
    expect(source).toContain('@typedef');

    const { readFile } = await import('node:fs/promises');
    expect(readFile).toHaveBeenCalledWith(TYPES_FILE_PATH, 'utf8');
  });

  it('propagates fs read errors (error handling)', async () => {
    const { readFile } = await import('node:fs/promises');
    readFile.mockRejectedValueOnce(new Error('read failed'));

    await expect(readTypesSource()).rejects.toThrow('read failed');
  });

  it('allows only types-only runtime markers outside comments (boundary)', async () => {
    const source = await readTypesSource();
    const nonComment = stripJsComments(source);
    expect(isAllowedTypesOnlyRuntime(nonComment)).toBe(true);
  });
});

describe('parseJSDocTypedefs (test harness)', () => {
  it('rejects null/undefined and non-strings (empty/type boundaries)', () => {
    // null / undefined
    expect(() => parseJSDocTypedefs(null)).toThrow(TypeError);
    expect(() => parseJSDocTypedefs(undefined)).toThrow(TypeError);

    // type boundary: object when string expected
    expect(() => parseJSDocTypedefs({})).toThrow(TypeError);
    expect(() => parseJSDocTypedefs([])).toThrow(TypeError);

    // boundary values: numbers (0, -1, MAX_SAFE_INTEGER)
    expect(() => parseJSDocTypedefs(0)).toThrow(TypeError);
    expect(() => parseJSDocTypedefs(-1)).toThrow(TypeError);
    expect(() => parseJSDocTypedefs(Number.MAX_SAFE_INTEGER)).toThrow(TypeError);
  });

  it('returns an empty map for empty/whitespace input (empty boundary)', () => {
    expect(parseJSDocTypedefs('')).toEqual(new Map());
    expect(parseJSDocTypedefs('   \n\t  ')).toEqual(new Map());
  });

  it('parses optional properties using bracket syntax (boundary)', () => {
    const src = [
      '/**',
      ' * @typedef {Object} X',
      ' * @property {string} [a]',
      ' * @property {number} [b=1]',
      ' * @property {unknown} c',
      ' */',
      '',
    ].join('\n');

    const typedefs = parseJSDocTypedefs(src);
    const x = typedefs.get('X');

    expect(x).toBeTruthy();
    expect(x.kind).toBe('Object');

    expect(x.properties.get('a').optional).toBe(true);
    expect(x.properties.get('b').optional).toBe(true);
    expect(x.properties.get('c').optional).toBe(false);
  });

  it('rejects blank property tokens (empty boundary)', () => {
    expect(() => parsePropertyNameToken('')).toThrow(TypeError);
    expect(() => parsePropertyNameToken('   ')).toThrow(TypeError);
  });

  it('rejects non-string property tokens (type boundaries)', () => {
    expect(() => parsePropertyNameToken(null)).toThrow(TypeError);
    expect(() => parsePropertyNameToken(undefined)).toThrow(TypeError);

    // boundary values: numbers (0, -1, MAX_SAFE_INTEGER)
    expect(() => parsePropertyNameToken(0)).toThrow(TypeError);
    expect(() => parsePropertyNameToken(-1)).toThrow(TypeError);
    expect(() => parsePropertyNameToken(Number.MAX_SAFE_INTEGER)).toThrow(TypeError);

    // type boundary: array/object
    expect(() => parsePropertyNameToken([])).toThrow(TypeError);
    expect(() => parsePropertyNameToken({})).toThrow(TypeError);
  });

  it('handles very long comment-only sources (resource boundary)', () => {
    const huge = '/**\n' + '* x\n'.repeat(200_000) + '*/\n';
    const typedefs = parseJSDocTypedefs(huge);
    expect(typedefs.size).toBe(0);

    const nonComment = stripJsComments(huge).trim();
    expect(nonComment).toBe('');
  });

  it('parses deeply nested type expressions (deep nesting boundary)', () => {
    const src = [
      '/**',
      ' * @typedef {Object} Deep',
      ' * @property {Record<string, Record<string, Record<string, Record<string, unknown>>>>} data',
      ' */',
      '',
    ].join('\n');

    const typedefs = parseJSDocTypedefs(src);
    const deep = typedefs.get('Deep');
    expect(deep).toBeTruthy();

    const data = deep.properties.get('data');
    expect(data).toBeTruthy();
    expect(normalizeTypeExpr(data.type)).toBe(
      normalizeTypeExpr(
        'Record<string, Record<string, Record<string, Record<string, unknown>>>>',
      ),
    );
  });

  it('supports concurrent reads/parses of the real types file (concurrency boundary)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => loadTypedefsFromRepo()),
    );

    // All reads should produce identical content.
    const first = results[0].source;
    for (const r of results) {
      expect(r.source).toBe(first);
      expect(r.typedefs.size).toBeGreaterThan(0);
    }

    const { readFile } = await import('node:fs/promises');
    expect(readFile).toHaveBeenCalledTimes(10);
  });
});

describe('EvalTask', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('EvalTask');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.EvalTask);
  });
});

describe('Trial', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('Trial');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.Trial);
  });
});

describe('Transcript', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('Transcript');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.Transcript);
  });
});

describe('TranscriptEntry', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('TranscriptEntry');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.TranscriptEntry);
  });
});

describe('GraderConfig', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('GraderConfig');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.GraderConfig);
  });
});

describe('GraderResult', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('GraderResult');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.GraderResult);
  });
});

describe('EvalIssue', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('EvalIssue');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.EvalIssue);
  });
});

describe('TrialMetrics', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('TrialMetrics');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.TrialMetrics);
  });
});

describe('EvalSuiteResult', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('EvalSuiteResult');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.EvalSuiteResult);
  });
});

describe('TaskResult', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('TaskResult');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.TaskResult);
  });
});

describe('AggregatedMetrics', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('AggregatedMetrics');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.AggregatedMetrics);
  });
});

describe('EvalSuite', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('EvalSuite');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.EvalSuite);
  });
});

describe('Grader', () => {
  it('matches expected JSDoc schema', async () => {
    const { typedefs } = await loadTypedefsFromRepo();
    const t = typedefs.get('Grader');

    expect(t).toBeTruthy();
    expect(t.kind).toBe('Object');
    expectTypedefHasProperties(t, EXPECTED.Grader);

    // Additional check: ensure the function signature is present even if whitespace changes.
    const grade = t.properties.get('grade');
    expect(grade).toBeTruthy();
    expect(normalizeTypeExpr(grade.type)).toContain('=>');
    expect(normalizeTypeExpr(grade.type)).toContain('Promise<GraderResult>');
  });
});