import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js', () => {
  return {
    createTodo: vi.fn(),
    transitionTodoStatus: vi.fn(),
    validateTodo: vi.fn(),
  };
});

vi.mock('../../../../../../../js/agents/stages/deepsearch/states.js', () => {
  return {
    TodoStatus: {
      OPEN: 'open',
      PENDING: 'pending',
      IN_PROGRESS: 'in_progress',
      COMPLETED: 'completed',
      CANCELLED: 'cancelled',
    },
  };
});

import { definition, handler, default as handlerDefault } from '../../../../../../../js/agents/stages/deepsearch/tools/refine-planning/handler.js';
import { createTodo, transitionTodoStatus, validateTodo } from '../../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js';
import { TodoStatus } from '../../../../../../../js/agents/stages/deepsearch/states.js';

const buildContext = (overrides = {}) => {
  const state = overrides.state || {};
  if (!Array.isArray(state.todos)) state.todos = [];
  const emit = overrides.emit || vi.fn();
  return { ...overrides, state, emit };
};

beforeEach(() => {
  vi.clearAllMocks();
  createTodo.mockImplementation((input = {}) => ({
    todoId: input.todoId || 'todo_default',
    text: input.text || '',
    status: input.status || TodoStatus.OPEN,
    createdAt: input.createdAt || '2024-01-01T00:00:00.000Z',
    updatedAt: input.updatedAt || '2024-01-01T00:00:00.000Z',
  }));
  validateTodo.mockReturnValue({ valid: true, issues: [] });
  transitionTodoStatus.mockImplementation((todo, newStatus) => {
    if (!todo || typeof todo !== 'object') return false;
    todo.status = String(newStatus);
    return true;
  });
});

describe('definition', () => {
  it('exposes refine-planning metadata', () => {
    expect(definition.name).toBe('refine-planning');
    expect(definition.layer).toBe(0);
    expect(definition.activation.keywords).toContain('refine');
  });
});

describe('handler', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty array', []],
    ['object', {}],
  ])('returns error when actions list is %s', async (_label, actions) => {
    const context = buildContext();
    const result = await handler({ actions, reason: 'no-actions' }, context);

    expect(result).toEqual({ success: false, error: 'actions list is required' });
    expect(context.emit).not.toHaveBeenCalled();
  });

  it('skips unknown action types', async () => {
    const context = buildContext();
    const actions = [{ type: 123 }, {}];
    const result = await handler({ actions, reason: 'unknown' }, context);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ action: 'skipped', error: 'Unknown action type: 123', raw: actions[0] });
    expect(result.results[1]).toEqual({ action: 'skipped', error: 'Unknown action type: ', raw: actions[1] });
    expect(createTodo).not.toHaveBeenCalled();
    expect(context.emit).toHaveBeenCalledWith('deepsearch.planning.refined', { reason: 'unknown', actions: result.results });
  });

  it('creates todo using addTodo and emits events', async () => {
    const state = {
      todos: [],
      addTodo: vi.fn((todo) => {
        state.todos.push(todo);
        return todo;
      }),
    };
    const emit = vi.fn();
    const context = buildContext({ state, emit });

    const result = await handler({
      actions: [{ type: 'create', title: '  new task  ', todoId: 't1' }],
      reason: '',
    }, context);

    expect(createTodo).toHaveBeenCalledTimes(1);
    const createArgs = createTodo.mock.calls[0][0];
    expect(createArgs.text).toBe('new task');
    expect(createArgs.status).toBe(TodoStatus.OPEN);
    expect(createArgs.source).toBe('llm');
    expect(state.addTodo).toHaveBeenCalledTimes(1);
    expect(state.todos).toHaveLength(1);
    expect(result.results).toEqual([{ action: 'created', todoId: 't1' }]);
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.created', { todoId: 't1', text: 'new task' });
    expect(emit).toHaveBeenCalledWith('deepsearch.planning.refined', { reason: '', actions: result.results });
  });

  it('creates todo and pushes into state when addTodo is missing', async () => {
    const context = buildContext();
    const result = await handler({
      actions: [{ type: 'create', text: 'task', todoId: 't2', status: 'pending' }],
      reason: 'bulk',
    }, context);

    expect(context.state.todos).toHaveLength(1);
    expect(context.state.todos[0].todoId).toBe('t2');
    expect(createTodo).toHaveBeenCalledWith(expect.objectContaining({ text: 'task', status: 'pending' }));
    expect(result.results[0]).toEqual({ action: 'created', todoId: 't2' });
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('rejects create when text is %s', async (_label, text) => {
    const context = buildContext();
    const result = await handler({
      actions: [{ type: 'create', text }],
      reason: 'missing-text',
    }, context);

    expect(result.results[0].action).toBe('create_failed');
    expect(result.results[0].error).toBe('text is required');
    expect(createTodo).not.toHaveBeenCalled();
    expect(context.state.todos).toHaveLength(0);
  });

  it('reports create_failed when validation fails', async () => {
    validateTodo.mockReturnValueOnce({ valid: false, issues: ['invalid todo'] });
    const context = buildContext();

    const result = await handler({
      actions: [{ type: 'create', text: 'bad todo', todoId: 't3' }],
      reason: 'invalid',
    }, context);

    expect(result.results[0]).toEqual({ action: 'create_failed', todoId: 't3', issues: ['invalid todo'] });
    expect(context.state.todos).toHaveLength(0);
    expect(context.emit).toHaveBeenCalledWith('deepsearch.planning.refined', { reason: 'invalid', actions: result.results });
    expect(context.emit).not.toHaveBeenCalledWith('deepsearch.todo.created', expect.anything());
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['0', 0],
  ])('fails update when todoId is %s', async (_label, todoId) => {
    const context = buildContext();
    const result = await handler({
      actions: [{ type: 'update', todoId, text: 'next' }],
      reason: 'missing-id',
    }, context);

    expect(result.results[0].action).toBe('update_failed');
    expect(result.results[0].error).toBe('todoId is required');
    expect(validateTodo).not.toHaveBeenCalled();
  });

  it('skips update when todoId type mismatches', async () => {
    const context = buildContext({ state: { todos: [{ todoId: 1, text: 'old', status: 'open' }] } });
    const result = await handler({
      actions: [{ type: 'update', todoId: '1', text: 'new' }],
      reason: 'type-mismatch',
    }, context);

    expect(result.results[0]).toEqual({ action: 'update_skipped', todoId: '1', error: 'Todo not found' });
  });

  it('updates todo via updateTodo and emits updated event', async () => {
    const todo = { todoId: 'u1', text: 'old', status: 'open' };
    const updated = { todoId: 'u1', text: 'new text', status: 'pending' };
    const updateTodo = vi.fn(() => updated);
    const context = buildContext({ state: { todos: [todo], updateTodo } });

    const result = await handler({
      actions: [{ type: 'update', todoId: 'u1', text: '  new text  ', status: '  pending  ' }],
      reason: 'revise',
    }, context);

    expect(updateTodo).toHaveBeenCalledWith('u1', { text: 'new text', status: 'pending' }, context.emit);
    expect(transitionTodoStatus).not.toHaveBeenCalled();
    expect(validateTodo).toHaveBeenCalledWith(updated);
    expect(result.results[0]).toEqual({ action: 'updated', todoId: 'u1' });
    expect(context.emit).toHaveBeenCalledWith('deepsearch.todo.updated', {
      todoId: 'u1',
      status: 'pending',
      text: 'new text',
    });
  });

  it('updates todo in place and transitions status when updateTodo is missing', async () => {
    const todo = { todoId: 'u2', text: 'old', status: 'open' };
    const context = buildContext({ state: { todos: [todo] } });

    const result = await handler({
      actions: [{ type: 'update', todoId: 'u2', text: '  new  ', status: 'completed' }],
      reason: 'progress',
    }, context);

    expect(todo.text).toBe('new');
    expect(Number.isNaN(Date.parse(todo.updatedAt))).toBe(false);
    expect(transitionTodoStatus).toHaveBeenCalledWith(todo, 'completed', context.emit);
    expect(validateTodo).toHaveBeenCalledWith(todo);
    expect(result.results[0]).toEqual({ action: 'updated', todoId: 'u2' });
    expect(context.emit).toHaveBeenCalledWith('deepsearch.todo.updated', {
      todoId: 'u2',
      status: 'completed',
      text: 'new',
    });
  });

  it('updates todo with negative todoId', async () => {
    const todo = { todoId: -1, text: 'old', status: 'open' };
    const context = buildContext({ state: { todos: [todo] } });

    const result = await handler({
      actions: [{ type: 'update', todoId: -1, text: 'next' }],
      reason: 'negative-id',
    }, context);

    expect(todo.text).toBe('next');
    expect(result.results[0]).toEqual({ action: 'updated', todoId: -1 });
  });

  it('reports update_failed when validation fails', async () => {
    const todo = { todoId: 'u3', text: 'old', status: 'open' };
    const updated = { todoId: 'u3', text: 'new', status: 'pending' };
    const updateTodo = vi.fn(() => updated);
    validateTodo.mockReturnValueOnce({ valid: false, issues: ['bad status'] });
    const context = buildContext({ state: { todos: [todo], updateTodo } });

    const result = await handler({
      actions: [{ type: 'update', todoId: 'u3', text: 'new', status: 'pending' }],
      reason: 'invalid-update',
    }, context);

    expect(result.results[0]).toEqual({ action: 'update_failed', todoId: 'u3', issues: ['bad status'] });
    expect(context.emit).not.toHaveBeenCalledWith('deepsearch.todo.updated', expect.anything());
  });

  it.each([
    ['empty string', ''],
    ['null', null],
  ])('fails delete when todoId is %s', async (_label, todoId) => {
    const context = buildContext();
    const result = await handler({
      actions: [{ type: 'delete', todoId }],
      reason: 'missing-id',
    }, context);

    expect(result.results[0].action).toBe('delete_failed');
    expect(result.results[0].error).toBe('todoId is required');
  });

  it('deletes todo using removeTodo with max safe integer id', async () => {
    const removeTodo = vi.fn(() => true);
    const context = buildContext({ state: { todos: [{ todoId: Number.MAX_SAFE_INTEGER }], removeTodo } });

    const result = await handler({
      actions: [{ type: 'delete', todoId: Number.MAX_SAFE_INTEGER }],
      reason: 'cleanup',
    }, context);

    expect(removeTodo).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
    expect(result.results[0]).toEqual({ action: 'deleted', todoId: Number.MAX_SAFE_INTEGER });
  });

  it('deletes todo by filtering state when removeTodo is missing', async () => {
    const context = buildContext({
      state: { todos: [{ todoId: 'd1' }, { todoId: 'd2' }] },
    });

    const result = await handler({
      actions: [{ type: 'delete', todoId: 'd1' }],
      reason: 'cleanup',
    }, context);

    expect(context.state.todos).toEqual([{ todoId: 'd2' }]);
    expect(result.results[0]).toEqual({ action: 'deleted', todoId: 'd1' });
  });

  it('handles large text and deep nested action payloads', async () => {
    const largeText = 'x'.repeat(100000);
    const deepPayload = { meta: { level1: { level2: { level3: { level4: true } } } } };
    const context = buildContext();

    const result = await handler({
      actions: [{ type: 'create', text: largeText, todoId: 'big', ...deepPayload }],
      reason: 'large-input',
    }, context);

    const createArgs = createTodo.mock.calls[0][0];
    expect(createArgs.text.length).toBe(largeText.length);
    expect(createArgs.meta.level1.level2.level3.level4).toBe(true);
    expect(result.results[0]).toEqual({ action: 'created', todoId: 'big' });
  });

  it('handles concurrent calls independently', async () => {
    const contextA = buildContext();
    const contextB = buildContext();

    const [resultA, resultB] = await Promise.all([
      handler({ actions: [{ type: 'create', text: 'alpha', todoId: 'a1' }], reason: 'r1' }, contextA),
      handler({ actions: [{ type: 'create', text: 'beta', todoId: 'b1' }], reason: 'r2' }, contextB),
    ]);

    expect(resultA.results[0]).toEqual({ action: 'created', todoId: 'a1' });
    expect(resultB.results[0]).toEqual({ action: 'created', todoId: 'b1' });
    expect(contextA.state.todos).toHaveLength(1);
    expect(contextB.state.todos).toHaveLength(1);
    expect(contextA.emit).toHaveBeenCalledWith('deepsearch.planning.refined', { reason: 'r1', actions: resultA.results });
    expect(contextB.emit).toHaveBeenCalledWith('deepsearch.planning.refined', { reason: 'r2', actions: resultB.results });
  });

  it('supports rapid sequential calls on the same state', async () => {
    const context = buildContext();

    await handler({ actions: [{ type: 'create', text: 'first', todoId: 't1' }], reason: 'r1' }, context);
    await handler({ actions: [{ type: 'create', text: 'second', todoId: 't2' }], reason: 'r2' }, context);

    expect(context.state.todos.map((todo) => todo.todoId)).toEqual(['t1', 't2']);
    expect(createTodo).toHaveBeenCalledTimes(2);
  });
});

describe('default', () => {
  it('bundles definition and handler', () => {
    expect(handlerDefault.definition).toBe(definition);
    expect(handlerDefault.handler).toBe(handler);
  });
});
