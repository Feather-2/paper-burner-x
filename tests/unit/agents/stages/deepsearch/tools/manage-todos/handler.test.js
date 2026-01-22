import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedTodoUtils = vi.hoisted(() => ({
  createTodo: vi.fn(),
  transitionTodoStatus: vi.fn(),
  validateTodo: vi.fn(),
}));

const mockedStates = vi.hoisted(() => ({
  TodoStatus: {
    OPEN: 'open',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  },
}));

vi.mock('../../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js', () => ({
  createTodo: mockedTodoUtils.createTodo,
  transitionTodoStatus: mockedTodoUtils.transitionTodoStatus,
  validateTodo: mockedTodoUtils.validateTodo,
}));

vi.mock('../../../../../../../js/agents/stages/deepsearch/states.js', () => ({
  TodoStatus: mockedStates.TodoStatus,
}));

async function loadModule() {
  return await import('../../../../../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js');
}

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();

  mockedTodoUtils.createTodo.mockReset();
  mockedTodoUtils.transitionTodoStatus.mockReset();
  mockedTodoUtils.validateTodo.mockReset();

  mockedTodoUtils.createTodo.mockImplementation((payload) => ({
    ...payload,
    todoId: payload.todoId ?? 'todo_1',
    text: payload.text,
  }));
  mockedTodoUtils.validateTodo.mockReturnValue({ valid: true, issues: [] });
  mockedTodoUtils.transitionTodoStatus.mockImplementation((todo, status) => {
    todo.status = status;
  });
});

describe('definition', () => {
  it('exposes expected metadata', async () => {
    const { definition } = await loadModule();

    expect(definition).toMatchObject({
      name: 'manage-todos',
      layer: 0,
      activation: {
        keywords: expect.arrayContaining(['todo']),
        phases: expect.arrayContaining(['planning', 'executing']),
      },
    });
    expect(typeof definition.description).toBe('string');
    expect(definition.description.trim().length).toBeGreaterThan(0);
  });
});

describe('handler', () => {
  it('create: uses state.addTodo and emits event', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = {
      addTodo: vi.fn((draft) => ({ ...draft, todoId: 'todo_added' })),
    };

    const result = await handler(
      { action: 'create', todoId: 'todo_from_args', text: '  Task 1  ', priority: 'high', queryHints: ['q1'] },
      { state, emit }
    );

    expect(mockedTodoUtils.createTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        todoId: 'todo_from_args',
        text: 'Task 1',
        priority: 'high',
        queryHints: ['q1'],
        status: mockedStates.TodoStatus.OPEN,
        source: 'user',
      })
    );

    const draft = mockedTodoUtils.createTodo.mock.results[0]?.value;
    expect(state.addTodo).toHaveBeenCalledWith(draft);
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(draft);
    expect(result).toMatchObject({ success: true, todo: expect.objectContaining({ todoId: 'todo_added', text: 'Task 1' }) });
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.created', { todoId: 'todo_added', text: 'Task 1' });
  });

  it('create: falls back to state.todos array when state.addTodo is missing', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = { todos: null };

    const result = await handler({ action: 'create', content: '  Legacy content  ' }, { state, emit });

    expect(result).toMatchObject({ success: true, todo: expect.objectContaining({ todoId: 'todo_1', text: 'Legacy content' }) });
    expect(Array.isArray(state.todos)).toBe(true);
    expect(state.todos).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.created', { todoId: 'todo_1', text: 'Legacy content' });
  });

  it('create: prefers args.todo.text over other compatibility fields', async () => {
    const { handler } = await loadModule();
    const state = { todos: [] };

    await handler(
      {
        action: 'create',
        todo: { text: '  fromTodoText  ', content: 'fromTodoContent', title: 'fromTodoTitle' },
        text: 'fromText',
        content: 'fromContent',
        title: 'fromTitle',
      },
      { state, emit: vi.fn() }
    );

    const call = mockedTodoUtils.createTodo.mock.calls[0][0];
    expect(call.text).toBe('fromTodoText');
  });

  it.each([
    ['args.todo.text', { todo: { text: '  A  ' } }, 'A'],
    ['args.text', { text: '  B  ' }, 'B'],
    ['args.todo.content', { todo: { content: '  C  ' } }, 'C'],
    ['args.content', { content: '  D  ' }, 'D'],
    ['args.todo.title', { todo: { title: '  E  ' } }, 'E'],
    ['args.title', { title: '  F  ' }, 'F'],
  ])('create: supports text from %s', async (_label, partialArgs, expectedText) => {
    const { handler } = await loadModule();
    const state = { todos: [] };

    const result = await handler({ action: 'create', ...partialArgs }, { state, emit: undefined });

    expect(result).toMatchObject({ success: true, todo: expect.objectContaining({ text: expectedText }) });
    expect(mockedTodoUtils.createTodo).toHaveBeenCalledWith(expect.objectContaining({ text: expectedText }));
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['empty array', []],
    ['empty object', {}],
    ['0', 0],
    ['-1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
  ])('create: rejects invalid text (%s)', async (_label, text) => {
    const { handler } = await loadModule();

    const result = await handler({ action: 'create', text }, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: 'text is required for creating a todo' });
    expect(mockedTodoUtils.createTodo).not.toHaveBeenCalled();
    expect(mockedTodoUtils.validateTodo).not.toHaveBeenCalled();
  });

  it('create: resolves todoId and applies defaults/overrides (priority, queryHints, status, source)', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = { todos: [] };

    await handler(
      {
        action: 'create',
        todoId: 'id_from_args',
        text: 'Task',
        todo: {
          todoId: 'id_from_todo',
          id: 'id_from_todo_id',
          source: 'system',
          meta: { deep: { nest: { level: 10 } } },
        },
        priority: 0, // type boundary: number instead of string
        queryHints: null, // nullish => default []
        status: 'custom-status',
      },
      { state, emit }
    );

    const call = mockedTodoUtils.createTodo.mock.calls[0][0];
    expect(call.todoId).toBe('id_from_args');
    expect(call.priority).toBe(0);
    expect(call.queryHints).toEqual([]);
    expect(call.status).toBe('custom-status');
    expect(call.source).toBe('system');
    expect(call.meta).toEqual({ deep: { nest: { level: 10 } } });
  });

  it('create: ignores args.todo when it is not an object', async () => {
    const { handler } = await loadModule();
    const state = { todos: [] };

    await handler({ action: 'create', todo: 'not-an-object', text: 'Task' }, { state, emit: vi.fn() });

    const call = mockedTodoUtils.createTodo.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(call, '0')).toBe(false);
    expect(call.text).toBe('Task');
  });

  it('create: accepts args.todo as an array (type boundary) without crashing', async () => {
    const { handler } = await loadModule();
    const state = { todos: [] };

    const result = await handler({ action: 'create', todo: [], text: 'Task' }, { state, emit: vi.fn() });

    expect(result.success).toBe(true);
    expect(state.todos).toHaveLength(1);
  });

  it('create: returns validation issues and does not mutate state', async () => {
    const { handler } = await loadModule();
    mockedTodoUtils.validateTodo.mockReturnValueOnce({ valid: false, issues: ['bad', 'worse'] });

    const emit = vi.fn();
    const state = { todos: [] };
    const result = await handler({ action: 'create', text: 'Task' }, { state, emit });

    expect(result).toEqual({ success: false, error: 'bad; worse', issues: ['bad', 'worse'] });
    expect(state.todos).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('create: handles resource boundaries (very long text, huge queryHints, deep nested meta)', async () => {
    const { handler } = await loadModule();
    const state = { todos: [] };
    const emit = vi.fn();

    const longText = 'x'.repeat(50_000);
    const hugeQueryHints = Array.from({ length: 2_000 }, (_, i) => `q${i}`);
    const nestedMeta = { deep: { nest: { level: 1, child: { level: 2, child: { level: 3 } } } } };

    const result = await handler(
      {
        action: 'create',
        text: `  ${longText}  `,
        todo: { queryHints: hugeQueryHints, meta: nestedMeta },
      },
      { state, emit }
    );

    expect(result.success).toBe(true);
    const call = mockedTodoUtils.createTodo.mock.calls[0][0];
    expect(call.text).toBe(longText);
    expect(call.queryHints).toBe(hugeQueryHints);
    expect(call.meta).toBe(nestedMeta);
  });

  it.each([
    ['undefined', { action: 'update' }],
    ['null', { action: 'update', todoId: null }],
    ['empty string', { action: 'update', todoId: '' }],
    ['zero', { action: 'update', todoId: 0 }],
  ])('update: returns error when todoId is missing (%s)', async (_label, args) => {
    const { handler } = await loadModule();

    const result = await handler(args, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: 'todoId is required' });
  });

  it('update: returns error when todo is not found due to type mismatch (string vs number)', async () => {
    const { handler } = await loadModule();
    const state = { todos: [{ todoId: 1, text: 'one', status: 'open' }] };

    const result = await handler({ action: 'update', todoId: '1', text: 'new' }, { state, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: 'Todo not found' });
  });

  it('update: uses state.updateTodo with trimmed updates', async () => {
    const { handler } = await loadModule();
    const todo = { todoId: 't1', text: 'old', status: 'open' };
    const emit = vi.fn();
    const state = {
      todos: [todo],
      updateTodo: vi.fn((_id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler({ action: 'update', todoId: 't1', text: '  new  ', status: ' completed ' }, { state, emit });

    expect(state.updateTodo).toHaveBeenCalledWith('t1', { text: 'new', status: 'completed' }, emit);
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(expect.objectContaining({ todoId: 't1', text: 'new', status: 'completed' }));
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.updated', { todoId: 't1', status: 'completed', text: 'new' });
    expect(result).toMatchObject({ success: true, todo: expect.objectContaining({ todoId: 't1', text: 'new', status: 'completed' }) });
  });

  it('update: skips state.updateTodo when no valid updates are provided', async () => {
    const { handler } = await loadModule();
    const todo = { todoId: 't1', text: 'old', status: 'open' };
    const emit = vi.fn();
    const state = { todos: [todo], updateTodo: vi.fn() };

    const result = await handler({ action: 'update', todoId: 't1', text: '  ', status: '  ' }, { state, emit });

    expect(state.updateTodo).not.toHaveBeenCalled();
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(todo);
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.updated', { todoId: 't1', status: 'open', text: 'old' });
    expect(result).toMatchObject({ success: true, todo });
  });

  it('update: returns error when state.updateTodo returns null', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = {
      todos: [{ todoId: 't1', text: 'old', status: 'open' }],
      updateTodo: vi.fn(() => null),
    };

    const result = await handler({ action: 'update', todoId: 't1', text: 'new' }, { state, emit });

    expect(result).toEqual({ success: false, error: 'Todo not found' });
    expect(mockedTodoUtils.validateTodo).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('update: returns validation issues after state.updateTodo', async () => {
    const { handler } = await loadModule();
    mockedTodoUtils.validateTodo.mockReturnValueOnce({ valid: false, issues: ['invalid'] });

    const emit = vi.fn();
    const todo = { todoId: 't1', text: 'old', status: 'open' };
    const state = {
      todos: [todo],
      updateTodo: vi.fn((_id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler({ action: 'update', todoId: 't1', status: 'completed' }, { state, emit });

    expect(result).toEqual({ success: false, error: 'invalid', issues: ['invalid'] });
    expect(emit).not.toHaveBeenCalled();
  });

  it('update: updates in-place without state.updateTodo (text + status + updatedAt)', async () => {
    const { handler } = await loadModule();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const emit = vi.fn();
    const todo = { todoId: 't2', text: 'old', status: 'open' };
    const state = { todos: [todo] };

    const result = await handler({ action: 'update', todoId: 't2', text: '  revise ', status: 'completed' }, { state, emit });

    expect(todo.text).toBe('revise');
    expect(todo.updatedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, 'completed', emit);
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(todo);
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.updated', { todoId: 't2', status: 'completed', text: 'revise' });
    expect(result).toMatchObject({ success: true, todo });
  });

  it('update: ignores non-string nextText/nextStatus (type boundaries)', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: 't3', text: 'old', status: 'open' };
    const state = { todos: [todo] };

    const result = await handler({ action: 'update', todoId: 't3', text: 123, status: { value: 'completed' } }, { state, emit });

    expect(todo.text).toBe('old');
    expect(todo.status).toBe('open');
    expect(todo.updatedAt).toBeUndefined();
    expect(mockedTodoUtils.transitionTodoStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, todo });
  });

  it.each([
    ['args.todo.todoId', { todo: { todoId: 't_from_todo' }, text: 'new' }, 't_from_todo'],
    ['args.todo.id', { todo: { id: 't_from_id' }, text: 'new' }, 't_from_id'],
  ])('update: resolves todoId from %s', async (_label, args, expectedTodoId) => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: expectedTodoId, text: 'old', status: 'open' };
    const state = {
      todos: [todo],
      updateTodo: vi.fn((_id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler({ action: 'update', ...args }, { state, emit });

    expect(state.updateTodo).toHaveBeenCalledWith(expectedTodoId, { text: 'new' }, emit);
    expect(result.success).toBe(true);
  });

  it('update: throws when state.todos is a plain object (object-as-array boundary)', async () => {
    const { handler } = await loadModule();
    const state = { todos: {} };

    await expect(handler({ action: 'update', todoId: 't1', text: 'new' }, { state, emit: vi.fn() })).rejects.toThrow();
  });

  it.each([
    ['negative', -1],
    ['max safe', Number.MAX_SAFE_INTEGER],
  ])('update: supports numeric todoId boundaries (%s)', async (_label, todoId) => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId, text: 'old', status: 'open' };
    const state = { todos: [todo] };

    const result = await handler({ action: 'update', todoId, status: 'completed' }, { state, emit });

    expect(result.success).toBe(true);
    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, 'completed', emit);
  });

  it('update: handles rapid consecutive updates', async () => {
    const { handler } = await loadModule();
    const todo = { todoId: 't4', text: 'old', status: 'open' };
    const state = { todos: [todo] };

    await handler({ action: 'update', todoId: 't4', text: 'first' }, { state, emit: vi.fn() });
    await handler({ action: 'update', todoId: 't4', status: 'completed' }, { state, emit: vi.fn() });

    expect(todo.text).toBe('first');
    expect(todo.status).toBe('completed');
  });

  it('complete: uses state.updateTodo when available', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: 't5', text: 'a', status: 'open' };
    const state = {
      todos: [todo],
      updateTodo: vi.fn((_id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler({ action: 'complete', todoId: 't5' }, { state, emit });

    expect(state.updateTodo).toHaveBeenCalledWith('t5', { status: mockedStates.TodoStatus.COMPLETED }, emit);
    expect(mockedTodoUtils.transitionTodoStatus).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.completed', { todoId: 't5' });
    expect(result.todo.status).toBe(mockedStates.TodoStatus.COMPLETED);
  });

  it('complete: falls back to transition when updateTodo is missing', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: 't6', text: 'a', status: 'open' };
    const state = { todos: [todo] };

    const result = await handler({ action: 'complete', todoId: 't6' }, { state, emit });

    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, mockedStates.TodoStatus.COMPLETED, emit);
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.completed', { todoId: 't6' });
    expect(result.todo).toBe(todo);
  });

  it('complete: falls back to transition when updateTodo returns undefined', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: 't6b', text: 'a', status: 'open' };
    const state = {
      todos: [todo],
      updateTodo: vi.fn(() => undefined),
    };

    const result = await handler({ action: 'complete', todoId: 't6b' }, { state, emit });

    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, mockedStates.TodoStatus.COMPLETED, emit);
    expect(result.todo).toBe(todo);
  });

  it('complete: returns error when todo is missing', async () => {
    const { handler } = await loadModule();

    const result = await handler({ action: 'complete', todoId: 'missing' }, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: 'Todo not found' });
  });

  it('cancel: uses state.updateTodo when available', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: 't7', text: 'a', status: 'open' };
    const state = {
      todos: [todo],
      updateTodo: vi.fn((_id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler({ action: 'cancel', todoId: 't7' }, { state, emit });

    expect(state.updateTodo).toHaveBeenCalledWith('t7', { status: mockedStates.TodoStatus.CANCELLED }, emit);
    expect(mockedTodoUtils.transitionTodoStatus).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.cancelled', { todoId: 't7' });
    expect(result.todo.status).toBe(mockedStates.TodoStatus.CANCELLED);
  });

  it('cancel: falls back to transition when updateTodo is missing', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: 't8', text: 'a', status: 'open' };
    const state = { todos: [todo] };

    const result = await handler({ action: 'cancel', todoId: 't8' }, { state, emit });

    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, mockedStates.TodoStatus.CANCELLED, emit);
    expect(emit).toHaveBeenCalledWith('deepsearch.todo.cancelled', { todoId: 't8' });
    expect(result.todo).toBe(todo);
  });

  it('cancel: returns error when todo is missing', async () => {
    const { handler } = await loadModule();

    const result = await handler({ action: 'cancel', todoId: 'missing' }, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: 'Todo not found' });
  });

  it('list: returns selected fields only', async () => {
    const { handler } = await loadModule();
    const state = {
      todos: [
        { todoId: 't1', text: 'one', status: 'open', priority: 'high', extra: 'x' },
        { todoId: 't2', text: 'two', status: 'completed', priority: 'low', extra: 'y' },
      ],
    };

    const result = await handler({ action: 'list' }, { state, emit: vi.fn() });

    expect(result).toEqual({
      success: true,
      todos: [
        { todoId: 't1', text: 'one', status: 'open', priority: 'high' },
        { todoId: 't2', text: 'two', status: 'completed', priority: 'low' },
      ],
    });
  });

  it('list: returns empty list when state.todos is missing or null', async () => {
    const { handler } = await loadModule();

    await expect(handler({ action: 'list' }, { state: {}, emit: vi.fn() })).resolves.toEqual({ success: true, todos: [] });
    await expect(handler({ action: 'list' }, { state: { todos: null }, emit: vi.fn() })).resolves.toEqual({ success: true, todos: [] });
  });

  it('list: throws when state.todos is a plain object (object-as-array boundary)', async () => {
    const { handler } = await loadModule();
    const state = { todos: {} };

    await expect(handler({ action: 'list' }, { state, emit: vi.fn() })).rejects.toThrow();
  });

  it.each([
    ['unknown string', { action: 'unknown' }, 'Unknown action: unknown'],
    ['0 (number)', { action: 0 }, 'Unknown action: 0'],
    ['undefined', {}, 'Unknown action: undefined'],
  ])('returns error for unknown action (%s)', async (_label, args, expectedError) => {
    const { handler } = await loadModule();

    const result = await handler(args, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: expectedError });
  });

  it('supports concurrent create calls on shared state', async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = { todos: [] };
    let counter = 0;
    mockedTodoUtils.createTodo.mockImplementation((payload) => ({
      ...payload,
      todoId: `todo_${++counter}`,
      text: payload.text,
    }));

    const [first, second] = await Promise.all([
      handler({ action: 'create', text: 'A' }, { state, emit }),
      handler({ action: 'create', text: 'B' }, { state, emit }),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(state.todos).toHaveLength(2);
    expect(new Set(state.todos.map((t) => t.todoId)).size).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe('default', () => {
  it('exports definition and handler', async () => {
    const mod = await loadModule();

    expect(mod.default.definition).toBe(mod.definition);
    expect(mod.default.handler).toBe(mod.handler);
  });
});
