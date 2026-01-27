import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/runtime/tools/tool-executor.js', () => {
  const ToolExecutor = vi.fn(function ToolExecutor(...args) {
    this.args = args;
  });

  const createToolExecutor = vi.fn((...args) => ({ kind: 'createToolExecutor', args }));

  return { ToolExecutor, createToolExecutor };
});

vi.mock('../../../../../js/agents/runtime/tools/TaskTool.js', () => {
  const createTaskTool = vi.fn((...args) => ({ kind: 'createTaskTool', args }));

  const TASK_TOOL_DEFINITION = Object.freeze({
    name: 'task',
    description: 'mock task tool',
    schema: Object.freeze({
      type: 'object',
      properties: Object.freeze({ id: Object.freeze({ type: 'string' }) }),
    }),
    version: 1,
  });

  const ContextMode = Object.freeze({
    LOCAL: 'LOCAL',
    GLOBAL: 'GLOBAL',
  });

  return { createTaskTool, TASK_TOOL_DEFINITION, ContextMode };
});

vi.mock('../../../../../js/agents/runtime/tools/RecallTool.js', () => {
  const createRecallTool = vi.fn((...args) => ({ kind: 'createRecallTool', args }));

  const RECALL_TOOL_DEFINITION = Object.freeze({
    name: 'recall',
    description: 'mock recall tool',
    schema: Object.freeze({ type: 'object' }),
  });

  return { createRecallTool, RECALL_TOOL_DEFINITION };
});

vi.mock('../../../../../js/agents/runtime/tools/BacktrackTool.js', () => {
  const createBacktrackTool = vi.fn((...args) => ({ kind: 'createBacktrackTool', args }));

  const BACKTRACK_TOOL_DEFINITION = Object.freeze({
    name: 'backtrack',
    description: 'mock backtrack tool',
    schema: Object.freeze({ type: 'object' }),
  });

  return { createBacktrackTool, BACKTRACK_TOOL_DEFINITION };
});

vi.mock('../../../../../js/agents/runtime/tools/DMailTool.js', () => {
  const createDMailTool = vi.fn((...args) => ({ kind: 'createDMailTool', args }));

  const DMAIL_TOOL_DEFINITION = Object.freeze({
    name: 'dmail',
    description: 'mock dmail tool',
    schema: Object.freeze({ type: 'object' }),
  });

  return { createDMailTool, DMAIL_TOOL_DEFINITION };
});

vi.mock('../../../../../js/agents/runtime/tools/schema-validator.js', () => {
  const validateToolSchema = vi.fn((...args) => ({ kind: 'validateToolSchema', args }));
  return { validateToolSchema };
});

vi.mock('../../../../../js/agents/runtime/tools/tool-quotas.js', () => {
  const ToolQuotaManager = vi.fn(function ToolQuotaManager(...args) {
    this.args = args;
  });
  return { ToolQuotaManager };
});

vi.mock('../../../../../js/agents/runtime/tools/platform/index.js', () => {
  const createPlatformTools = vi.fn((...args) => ({ kind: 'createPlatformTools', args }));
  const getPlatformType = vi.fn((...args) => ({ kind: 'getPlatformType', args }));
  const hasCapability = vi.fn((...args) => ({ kind: 'hasCapability', args }));

  return { createPlatformTools, getPlatformType, hasCapability };
});

const SUBJECT_PATH = '../../../../../js/agents/runtime/tools/index.js';

const TOOL_EXECUTOR_PATH = '../../../../../js/agents/runtime/tools/tool-executor.js';
const TASK_TOOL_PATH = '../../../../../js/agents/runtime/tools/TaskTool.js';
const RECALL_TOOL_PATH = '../../../../../js/agents/runtime/tools/RecallTool.js';
const BACKTRACK_TOOL_PATH = '../../../../../js/agents/runtime/tools/BacktrackTool.js';
const DMAIL_TOOL_PATH = '../../../../../js/agents/runtime/tools/DMailTool.js';
const SCHEMA_VALIDATOR_PATH = '../../../../../js/agents/runtime/tools/schema-validator.js';
const TOOL_QUOTAS_PATH = '../../../../../js/agents/runtime/tools/tool-quotas.js';
const PLATFORM_TOOLS_PATH = '../../../../../js/agents/runtime/tools/platform/index.js';

function makeDeepNestedObject(depth) {
  let root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i++) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

const LONG_STRING = 'x'.repeat(100_000);
const DEEP_NESTED_OBJECT = makeDeepNestedObject(300);
const BIG_BUFFER = new Uint8Array(2 * 1024 * 1024);

const BASE_ARG_SETS = [
  [],
  ['normal', 123, { ok: true }],
  [null],
  [undefined],
  [''],
  ['   '],
  [0],
  [-1],
  [Number.MAX_SAFE_INTEGER],
  [[]],
  [{}],
  [LONG_STRING],
  [DEEP_NESTED_OBJECT],
  [BIG_BUFFER],
  ['42'],
  [{ 0: 'x', length: 1 }],
];

function expectMockCalls(fn, argSets) {
  expect(fn).toHaveBeenCalledTimes(argSets.length);
  argSets.forEach((args, i) => {
    expect(fn.mock.calls[i]).toEqual(args);
  });
}

async function loadSubjectAnd(depPath) {
  const subject = await import(SUBJECT_PATH);
  const dep = await import(depPath);
  return { subject, dep };
}

describe('ToolExecutor', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(TOOL_EXECUTOR_PATH));
  });

  it('re-exports ToolExecutor from tool-executor', () => {
    expect(subject.ToolExecutor).toBe(dep.ToolExecutor);
  });

  it('constructs with normal arguments', () => {
    const instance = new subject.ToolExecutor('cfg', { mode: 'auto' }, 1);
    expect(subject.ToolExecutor).toHaveBeenCalledTimes(1);
    expect(subject.ToolExecutor.mock.calls[0]).toEqual(['cfg', { mode: 'auto' }, 1]);
    expect(instance.args).toEqual(['cfg', { mode: 'auto' }, 1]);
  });

  it('constructs with boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const instances = argSets.map((args) => new subject.ToolExecutor(...args));
    expectMockCalls(subject.ToolExecutor, argSets);
    instances.forEach((instance, i) => {
      expect(instance.args).toEqual(argSets[i]);
    });
  });

  it('propagates constructor errors from dependency', () => {
    subject.ToolExecutor.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    expect(() => new subject.ToolExecutor('x')).toThrow('boom');
  });
});

describe('createToolExecutor', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(TOOL_EXECUTOR_PATH));
  });

  it('re-exports createToolExecutor from tool-executor', () => {
    expect(subject.createToolExecutor).toBe(dep.createToolExecutor);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.createToolExecutor({ platform: 'node' }, { debug: true });
    expect(subject.createToolExecutor).toHaveBeenCalledTimes(1);
    expect(subject.createToolExecutor).toHaveBeenCalledWith({ platform: 'node' }, { debug: true });
    expect(result).toEqual({ kind: 'createToolExecutor', args: [{ platform: 'node' }, { debug: true }] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.createToolExecutor(...args));
    expectMockCalls(subject.createToolExecutor, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'createToolExecutor', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.createToolExecutor.mockImplementationOnce(() => {
      throw new TypeError('bad args');
    });

    expect(() => subject.createToolExecutor('x')).toThrow(TypeError);
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 25 }, (_, i) => [
      i,
      i % 2 === 0 ? LONG_STRING : 'ok',
      i % 3 === 0 ? DEEP_NESTED_OBJECT : { n: i },
    ]);

    subject.createToolExecutor.mockImplementation(async (...args) => ({
      kind: 'async createToolExecutor',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.createToolExecutor(...args)));
    expectMockCalls(subject.createToolExecutor, argSets);
    expect(results[0]).toEqual({ kind: 'async createToolExecutor', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async createToolExecutor', args: argSets.at(-1) });
  });
});

describe('createTaskTool', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(TASK_TOOL_PATH));
  });

  it('re-exports createTaskTool from TaskTool', () => {
    expect(subject.createTaskTool).toBe(dep.createTaskTool);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.createTaskTool({ id: 't1' }, 'run');
    expect(subject.createTaskTool).toHaveBeenCalledTimes(1);
    expect(subject.createTaskTool).toHaveBeenCalledWith({ id: 't1' }, 'run');
    expect(result).toEqual({ kind: 'createTaskTool', args: [{ id: 't1' }, 'run'] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.createTaskTool(...args));
    expectMockCalls(subject.createTaskTool, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'createTaskTool', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.createTaskTool.mockImplementationOnce(() => {
      throw new Error('task error');
    });

    expect(() => subject.createTaskTool('x')).toThrow('task error');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 30 }, (_, i) => [
      { id: String(i) },
      i % 5 === 0 ? '   ' : 'ok',
      i % 2 === 0 ? BIG_BUFFER : null,
    ]);

    subject.createTaskTool.mockImplementation(async (...args) => ({
      kind: 'async createTaskTool',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.createTaskTool(...args)));
    expectMockCalls(subject.createTaskTool, argSets);
    expect(results[0]).toEqual({ kind: 'async createTaskTool', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async createTaskTool', args: argSets.at(-1) });
  });
});

describe('TASK_TOOL_DEFINITION', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(TASK_TOOL_PATH));
  });

  it('re-exports TASK_TOOL_DEFINITION from TaskTool', () => {
    expect(subject.TASK_TOOL_DEFINITION).toBe(dep.TASK_TOOL_DEFINITION);
  });

  it('exposes an immutable non-empty definition object', () => {
    expect(subject.TASK_TOOL_DEFINITION).toBeTypeOf('object');
    expect(subject.TASK_TOOL_DEFINITION).not.toBeNull();
    expect(Object.isFrozen(subject.TASK_TOOL_DEFINITION)).toBe(true);
    expect(subject.TASK_TOOL_DEFINITION.name).toBe('task');
    expect(subject.TASK_TOOL_DEFINITION.schema).toMatchObject({ type: 'object' });
  });
});

describe('ContextMode', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(TASK_TOOL_PATH));
  });

  it('re-exports ContextMode from TaskTool', () => {
    expect(subject.ContextMode).toBe(dep.ContextMode);
  });

  it('exposes an immutable mode map', () => {
    expect(subject.ContextMode).toBeTypeOf('object');
    expect(subject.ContextMode).not.toBeNull();
    expect(Object.isFrozen(subject.ContextMode)).toBe(true);
    expect(subject.ContextMode).toMatchObject({ LOCAL: 'LOCAL', GLOBAL: 'GLOBAL' });
  });
});

describe('createRecallTool', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(RECALL_TOOL_PATH));
  });

  it('re-exports createRecallTool from RecallTool', () => {
    expect(subject.createRecallTool).toBe(dep.createRecallTool);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.createRecallTool({ query: 'foo' }, 10);
    expect(subject.createRecallTool).toHaveBeenCalledTimes(1);
    expect(subject.createRecallTool).toHaveBeenCalledWith({ query: 'foo' }, 10);
    expect(result).toEqual({ kind: 'createRecallTool', args: [{ query: 'foo' }, 10] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.createRecallTool(...args));
    expectMockCalls(subject.createRecallTool, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'createRecallTool', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.createRecallTool.mockImplementationOnce(() => {
      throw new Error('recall error');
    });

    expect(() => subject.createRecallTool('x')).toThrow('recall error');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 20 }, (_, i) => [
      i % 2 === 0 ? { q: '42' } : null,
      i,
      i % 4 === 0 ? LONG_STRING : 'ok',
    ]);

    subject.createRecallTool.mockImplementation(async (...args) => ({
      kind: 'async createRecallTool',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.createRecallTool(...args)));
    expectMockCalls(subject.createRecallTool, argSets);
    expect(results[0]).toEqual({ kind: 'async createRecallTool', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async createRecallTool', args: argSets.at(-1) });
  });
});

describe('RECALL_TOOL_DEFINITION', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(RECALL_TOOL_PATH));
  });

  it('re-exports RECALL_TOOL_DEFINITION from RecallTool', () => {
    expect(subject.RECALL_TOOL_DEFINITION).toBe(dep.RECALL_TOOL_DEFINITION);
  });

  it('exposes an immutable non-empty definition object', () => {
    expect(subject.RECALL_TOOL_DEFINITION).toBeTypeOf('object');
    expect(subject.RECALL_TOOL_DEFINITION).not.toBeNull();
    expect(Object.isFrozen(subject.RECALL_TOOL_DEFINITION)).toBe(true);
    expect(subject.RECALL_TOOL_DEFINITION.name).toBe('recall');
    expect(subject.RECALL_TOOL_DEFINITION.schema).toMatchObject({ type: 'object' });
  });
});

describe('createBacktrackTool', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(BACKTRACK_TOOL_PATH));
  });

  it('re-exports createBacktrackTool from BacktrackTool', () => {
    expect(subject.createBacktrackTool).toBe(dep.createBacktrackTool);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.createBacktrackTool({ steps: 3 }, 'safe');
    expect(subject.createBacktrackTool).toHaveBeenCalledTimes(1);
    expect(subject.createBacktrackTool).toHaveBeenCalledWith({ steps: 3 }, 'safe');
    expect(result).toEqual({ kind: 'createBacktrackTool', args: [{ steps: 3 }, 'safe'] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.createBacktrackTool(...args));
    expectMockCalls(subject.createBacktrackTool, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'createBacktrackTool', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.createBacktrackTool.mockImplementationOnce(() => {
      throw new Error('backtrack error');
    });

    expect(() => subject.createBacktrackTool('x')).toThrow('backtrack error');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 20 }, (_, i) => [
      i,
      i % 2 === 0 ? DEEP_NESTED_OBJECT : { depth: i },
      i % 5 === 0 ? BIG_BUFFER : [],
    ]);

    subject.createBacktrackTool.mockImplementation(async (...args) => ({
      kind: 'async createBacktrackTool',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.createBacktrackTool(...args)));
    expectMockCalls(subject.createBacktrackTool, argSets);
    expect(results[0]).toEqual({ kind: 'async createBacktrackTool', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async createBacktrackTool', args: argSets.at(-1) });
  });
});

describe('BACKTRACK_TOOL_DEFINITION', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(BACKTRACK_TOOL_PATH));
  });

  it('re-exports BACKTRACK_TOOL_DEFINITION from BacktrackTool', () => {
    expect(subject.BACKTRACK_TOOL_DEFINITION).toBe(dep.BACKTRACK_TOOL_DEFINITION);
  });

  it('exposes an immutable non-empty definition object', () => {
    expect(subject.BACKTRACK_TOOL_DEFINITION).toBeTypeOf('object');
    expect(subject.BACKTRACK_TOOL_DEFINITION).not.toBeNull();
    expect(Object.isFrozen(subject.BACKTRACK_TOOL_DEFINITION)).toBe(true);
    expect(subject.BACKTRACK_TOOL_DEFINITION.name).toBe('backtrack');
    expect(subject.BACKTRACK_TOOL_DEFINITION.schema).toMatchObject({ type: 'object' });
  });
});

describe('createDMailTool', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(DMAIL_TOOL_PATH));
  });

  it('re-exports createDMailTool from DMailTool', () => {
    expect(subject.createDMailTool).toBe(dep.createDMailTool);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.createDMailTool({ to: 'a@b.com' }, 'hi');
    expect(subject.createDMailTool).toHaveBeenCalledTimes(1);
    expect(subject.createDMailTool).toHaveBeenCalledWith({ to: 'a@b.com' }, 'hi');
    expect(result).toEqual({ kind: 'createDMailTool', args: [{ to: 'a@b.com' }, 'hi'] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.createDMailTool(...args));
    expectMockCalls(subject.createDMailTool, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'createDMailTool', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.createDMailTool.mockImplementationOnce(() => {
      throw new Error('dmail error');
    });

    expect(() => subject.createDMailTool('x')).toThrow('dmail error');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 25 }, (_, i) => [
      { i, subject: i % 2 === 0 ? '   ' : 'ok' },
      i % 3 === 0 ? LONG_STRING : 'short',
      i % 4 === 0 ? BIG_BUFFER : null,
    ]);

    subject.createDMailTool.mockImplementation(async (...args) => ({
      kind: 'async createDMailTool',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.createDMailTool(...args)));
    expectMockCalls(subject.createDMailTool, argSets);
    expect(results[0]).toEqual({ kind: 'async createDMailTool', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async createDMailTool', args: argSets.at(-1) });
  });
});

describe('DMAIL_TOOL_DEFINITION', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(DMAIL_TOOL_PATH));
  });

  it('re-exports DMAIL_TOOL_DEFINITION from DMailTool', () => {
    expect(subject.DMAIL_TOOL_DEFINITION).toBe(dep.DMAIL_TOOL_DEFINITION);
  });

  it('exposes an immutable non-empty definition object', () => {
    expect(subject.DMAIL_TOOL_DEFINITION).toBeTypeOf('object');
    expect(subject.DMAIL_TOOL_DEFINITION).not.toBeNull();
    expect(Object.isFrozen(subject.DMAIL_TOOL_DEFINITION)).toBe(true);
    expect(subject.DMAIL_TOOL_DEFINITION.name).toBe('dmail');
    expect(subject.DMAIL_TOOL_DEFINITION.schema).toMatchObject({ type: 'object' });
  });
});

describe('validateToolSchema', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(SCHEMA_VALIDATOR_PATH));
  });

  it('re-exports validateToolSchema from schema-validator', () => {
    expect(subject.validateToolSchema).toBe(dep.validateToolSchema);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.validateToolSchema({ name: 'x' }, { type: 'object' });
    expect(subject.validateToolSchema).toHaveBeenCalledTimes(1);
    expect(subject.validateToolSchema).toHaveBeenCalledWith({ name: 'x' }, { type: 'object' });
    expect(result).toEqual({ kind: 'validateToolSchema', args: [{ name: 'x' }, { type: 'object' }] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.validateToolSchema(...args));
    expectMockCalls(subject.validateToolSchema, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'validateToolSchema', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.validateToolSchema.mockImplementationOnce(() => {
      throw new Error('schema invalid');
    });

    expect(() => subject.validateToolSchema('x')).toThrow('schema invalid');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 40 }, (_, i) => [
      i % 2 === 0 ? { type: 'object' } : '42',
      i % 5 === 0 ? undefined : { i },
      i % 7 === 0 ? DEEP_NESTED_OBJECT : {},
    ]);

    subject.validateToolSchema.mockImplementation(async (...args) => ({
      kind: 'async validateToolSchema',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.validateToolSchema(...args)));
    expectMockCalls(subject.validateToolSchema, argSets);
    expect(results[0]).toEqual({ kind: 'async validateToolSchema', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async validateToolSchema', args: argSets.at(-1) });
  });
});

describe('ToolQuotaManager', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(TOOL_QUOTAS_PATH));
  });

  it('re-exports ToolQuotaManager from tool-quotas', () => {
    expect(subject.ToolQuotaManager).toBe(dep.ToolQuotaManager);
  });

  it('constructs with normal arguments', () => {
    const instance = new subject.ToolQuotaManager({ limit: 10 }, 'task');
    expect(subject.ToolQuotaManager).toHaveBeenCalledTimes(1);
    expect(subject.ToolQuotaManager.mock.calls[0]).toEqual([{ limit: 10 }, 'task']);
    expect(instance.args).toEqual([{ limit: 10 }, 'task']);
  });

  it('constructs with boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const instances = argSets.map((args) => new subject.ToolQuotaManager(...args));
    expectMockCalls(subject.ToolQuotaManager, argSets);
    instances.forEach((instance, i) => {
      expect(instance.args).toEqual(argSets[i]);
    });
  });

  it('propagates constructor errors from dependency', () => {
    subject.ToolQuotaManager.mockImplementationOnce(() => {
      throw new Error('quota boom');
    });

    expect(() => new subject.ToolQuotaManager('x')).toThrow('quota boom');
  });
});

describe('createPlatformTools', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(PLATFORM_TOOLS_PATH));
  });

  it('re-exports createPlatformTools from platform/index', () => {
    expect(subject.createPlatformTools).toBe(dep.createPlatformTools);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.createPlatformTools({ platform: 'node' }, { caps: ['fs'] });
    expect(subject.createPlatformTools).toHaveBeenCalledTimes(1);
    expect(subject.createPlatformTools).toHaveBeenCalledWith({ platform: 'node' }, { caps: ['fs'] });
    expect(result).toEqual({
      kind: 'createPlatformTools',
      args: [{ platform: 'node' }, { caps: ['fs'] }],
    });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.createPlatformTools(...args));
    expectMockCalls(subject.createPlatformTools, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'createPlatformTools', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.createPlatformTools.mockImplementationOnce(() => {
      throw new Error('platform error');
    });

    expect(() => subject.createPlatformTools('x')).toThrow('platform error');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 25 }, (_, i) => [
      i % 2 === 0 ? { platform: 'node' } : null,
      i % 3 === 0 ? LONG_STRING : 'ok',
      i % 4 === 0 ? BIG_BUFFER : [],
    ]);

    subject.createPlatformTools.mockImplementation(async (...args) => ({
      kind: 'async createPlatformTools',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.createPlatformTools(...args)));
    expectMockCalls(subject.createPlatformTools, argSets);
    expect(results[0]).toEqual({ kind: 'async createPlatformTools', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async createPlatformTools', args: argSets.at(-1) });
  });
});

describe('getPlatformType', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(PLATFORM_TOOLS_PATH));
  });

  it('re-exports getPlatformType from platform/index', () => {
    expect(subject.getPlatformType).toBe(dep.getPlatformType);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.getPlatformType({ env: 'test' });
    expect(subject.getPlatformType).toHaveBeenCalledTimes(1);
    expect(subject.getPlatformType).toHaveBeenCalledWith({ env: 'test' });
    expect(result).toEqual({ kind: 'getPlatformType', args: [{ env: 'test' }] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.getPlatformType(...args));
    expectMockCalls(subject.getPlatformType, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'getPlatformType', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.getPlatformType.mockImplementationOnce(() => {
      throw new Error('type error');
    });

    expect(() => subject.getPlatformType('x')).toThrow('type error');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 35 }, (_, i) => [
      i % 2 === 0 ? { i } : '42',
      i % 5 === 0 ? undefined : { flag: i % 3 === 0 },
      i % 7 === 0 ? DEEP_NESTED_OBJECT : {},
    ]);

    subject.getPlatformType.mockImplementation(async (...args) => ({
      kind: 'async getPlatformType',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.getPlatformType(...args)));
    expectMockCalls(subject.getPlatformType, argSets);
    expect(results[0]).toEqual({ kind: 'async getPlatformType', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async getPlatformType', args: argSets.at(-1) });
  });
});

describe('hasCapability', () => {
  let subject;
  let dep;

  beforeEach(async () => {
    vi.resetModules();
    ({ subject, dep } = await loadSubjectAnd(PLATFORM_TOOLS_PATH));
  });

  it('re-exports hasCapability from platform/index', () => {
    expect(subject.hasCapability).toBe(dep.hasCapability);
  });

  it('forwards normal arguments and returns value', () => {
    const result = subject.hasCapability({ caps: ['fs'] }, 'fs');
    expect(subject.hasCapability).toHaveBeenCalledTimes(1);
    expect(subject.hasCapability).toHaveBeenCalledWith({ caps: ['fs'] }, 'fs');
    expect(result).toEqual({ kind: 'hasCapability', args: [{ caps: ['fs'] }, 'fs'] });
  });

  it('forwards boundary and resource arguments', () => {
    const argSets = [...BASE_ARG_SETS, [LONG_STRING, DEEP_NESTED_OBJECT, BIG_BUFFER]];
    const results = argSets.map((args) => subject.hasCapability(...args));
    expectMockCalls(subject.hasCapability, argSets);
    results.forEach((result, i) => {
      expect(result).toEqual({ kind: 'hasCapability', args: argSets[i] });
    });
  });

  it('propagates errors from dependency', () => {
    subject.hasCapability.mockImplementationOnce(() => {
      throw new Error('capability error');
    });

    expect(() => subject.hasCapability('x')).toThrow('capability error');
  });

  it('handles concurrent calls without mixing arguments', async () => {
    const argSets = Array.from({ length: 30 }, (_, i) => [
      i % 2 === 0 ? { caps: ['a', 'b'] } : null,
      i % 3 === 0 ? '   ' : 'ok',
      i % 4 === 0 ? BIG_BUFFER : { i },
    ]);

    subject.hasCapability.mockImplementation(async (...args) => ({
      kind: 'async hasCapability',
      args,
    }));

    const results = await Promise.all(argSets.map((args) => subject.hasCapability(...args)));
    expectMockCalls(subject.hasCapability, argSets);
    expect(results[0]).toEqual({ kind: 'async hasCapability', args: argSets[0] });
    expect(results.at(-1)).toEqual({ kind: 'async hasCapability', args: argSets.at(-1) });
  });
});