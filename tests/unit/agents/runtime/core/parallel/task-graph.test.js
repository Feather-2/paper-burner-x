import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockToNonEmptyString, defaultToNonEmptyString } = vi.hoisted(() => {
  const defaultToNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };
  return {
    defaultToNonEmptyString,
    mockToNonEmptyString: vi.fn(defaultToNonEmptyString),
  };
});

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: mockToNonEmptyString,
}));

import { TaskGraph } from '../../../../../../js/agents/runtime/core/parallel/task-graph.js';

describe('TaskGraph', () => {
  /** @type {TaskGraph} */
  let graph;

  beforeEach(() => {
    mockToNonEmptyString.mockReset();
    mockToNonEmptyString.mockImplementation(defaultToNonEmptyString);
    graph = new TaskGraph();
  });

  it('adds tasks with normalized dependencies and returns this', () => {
    const result = graph.addTask(0, [0, -1, Number.MAX_SAFE_INTEGER, ' 42 ', '  ', null, '42', '0']);

    expect(result).toBe(graph);
    expect(graph.getTask(0)).not.toBeNull();
    expect(graph.getTask(0).dependencies).toEqual([
      '0',
      '-1',
      String(Number.MAX_SAFE_INTEGER),
      '42',
    ]);
    expect(mockToNonEmptyString).toHaveBeenCalledWith(0);
  });

  it('throws when taskId is empty or invalid', () => {
    const invalidIds = [null, undefined, '', '   '];
    for (const value of invalidIds) {
      expect(() => graph.addTask(value)).toThrow(TypeError);
    }
  });

  it('accepts object task ids via string coercion', () => {
    const id = {};
    graph.addTask(id);

    expect(graph.getTask(id)).not.toBeNull();
    expect(graph.getTask({})).not.toBeNull();
  });

  it('treats non-array or nullish dependencies as empty', () => {
    graph.addTask('A', {});
    graph.addTask('B', null);
    graph.addTask('C', undefined);
    graph.addTask('D', []);

    expect(graph.getTask('A').dependencies).toEqual([]);
    expect(graph.getTask('B').dependencies).toEqual([]);
    expect(graph.getTask('C').dependencies).toEqual([]);
    expect(graph.getTask('D').dependencies).toEqual([]);
  });

  it('getTask returns null for invalid ids', () => {
    graph.addTask('A');

    expect(graph.getTask(null)).toBeNull();
    expect(graph.getTask(undefined)).toBeNull();
    expect(graph.getTask('')).toBeNull();
    expect(graph.getTask('   ')).toBeNull();
  });

  it('clears tasks with clear and dispose', () => {
    graph.addTask('A');
    graph.clear();
    expect(graph.getTask('A')).toBeNull();

    graph.addTask('B');
    graph.dispose();
    expect(graph.getTask('B')).toBeNull();
  });

  it('returns empty levels for an empty graph', () => {
    expect(graph.getLevels()).toEqual([]);
  });

  it('builds levels for a DAG', () => {
    graph.addTask('D');
    graph.addTask('B', ['D']);
    graph.addTask('C', ['D']);
    graph.addTask('A', ['B', 'C']);

    const levels = graph.getLevels();

    expect(levels).toHaveLength(3);
    expect(levels[0].slice().sort()).toEqual(['D']);
    expect(levels[1].slice().sort()).toEqual(['B', 'C']);
    expect(levels[2].slice().sort()).toEqual(['A']);
  });

  it('throws when dependency is missing and allowMissingDependencies is false', () => {
    graph.addTask('A', ['missing']);

    expect(() => graph.getLevels()).toThrowError('TaskGraph: missing dependency "missing" required by "A"');
  });

  it('ignores missing dependencies when allowMissingDependencies is true', () => {
    graph.addTask('A', ['missing']);

    expect(graph.getLevels({ allowMissingDependencies: true })).toEqual([['A']]);
  });

  it('throws on cycles and reports remaining ids', () => {
    graph.addTask('A', ['B']);
    graph.addTask('B', ['A']);

    let error;
    try {
      graph.getLevels();
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('cycle detected');
    expect(error.message).toContain('A');
    expect(error.message).toContain('B');
  });

  it('handles deep dependency chains', () => {
    const depth = 50;
    for (let i = 0; i < depth; i += 1) {
      const id = `T${i}`;
      const deps = i === 0 ? [] : [`T${i - 1}`];
      graph.addTask(id, deps);
    }

    const levels = graph.getLevels();

    expect(levels).toHaveLength(depth);
    expect(levels[0]).toEqual(['T0']);
    expect(levels[levels.length - 1]).toEqual([`T${depth - 1}`]);
  });

  it('handles large task sets in a single level', () => {
    const count = 1000;
    for (let i = 0; i < count; i += 1) {
      graph.addTask(`N${i}`);
    }

    const levels = graph.getLevels();

    expect(levels).toHaveLength(1);
    expect(levels[0]).toHaveLength(count);
  });

  it('supports concurrent getLevels calls without mutation', async () => {
    graph.addTask('A');
    graph.addTask('B', ['A']);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => graph.getLevels()),
      Promise.resolve().then(() => graph.getLevels()),
    ]);

    expect(first).toEqual(second);
    expect(first).toEqual([['A'], ['B']]);
  });

  it('handles rapid consecutive addTask calls', () => {
    for (let i = 0; i < 25; i += 1) {
      graph.addTask('A', [`D${i}`]);
    }

    expect(graph.getTask('A').dependencies).toEqual(['D24']);
  });

  it('accepts long string ids and dependencies', () => {
    const longId = 'x'.repeat(10000);
    const longDep = 'y'.repeat(5000);

    graph.addTask(longId, [longDep]);

    expect(graph.getTask(longId)).not.toBeNull();
    expect(graph.getTask(longId).dependencies).toEqual([longDep]);
  });
});
