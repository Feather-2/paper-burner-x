import { describe, it, expect, vi, beforeEach } from 'vitest';

const deepCloneMock = vi.hoisted(() => vi.fn());
const isPlainObjectMock = vi.hoisted(() => vi.fn());
const toNonEmptyStringMock = vi.hoisted(() => vi.fn());
const normalizeTodoEntryMock = vi.hoisted(() => vi.fn());
const genIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  deepClone: deepCloneMock,
  isPlainObject: isPlainObjectMock,
  toNonEmptyString: toNonEmptyStringMock,
}));

vi.mock('../../../../../js/agents/plugins/memory/todo-normalize.js', () => ({
  normalizeTodoEntry: normalizeTodoEntryMock,
}));

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.utils.js', () => ({
  genId: genIdMock,
}));

import { applyWriteMethods } from '../../../../../js/agents/plugins/memory/unified-memory-store.write.js';
import {
  L0_SET_SYSTEM_PROMPT,
  L0_SET_TASK_GOAL,
  L0_ADD_TODO,
  L0_UPDATE_TODO,
  L0_REMOVE_TODO,
  L0_REPLACE_TODOS,
  L1_ADD_MESSAGE,
  L1_ADD_MESSAGES,
  L1_CLEAR_MESSAGES,
  L1_SET_MESSAGES,
  L1_SET_DECK,
  L1_ADD_SIGNAL,
  L1_ACKNOWLEDGE_SIGNAL,
  L1_RECORD_DECISION,
  L1_SET_SCRATCHPAD,
  L1_CLEAR_SCRATCHPAD,
  L1_SET_FLAG,
  L1_SYNC_DISCOVERY,
  L1_SYNC_SUBAGENT,
  L2_SET_STAGE_SUMMARY,
  L2_ADD_CLAIM,
  L2_REPLACE_CLAIMS,
} from '../../../../../js/agents/plugins/memory/action-types.js';

const applyAction = (state, action) => {
  if (!action || typeof action.type !== 'string') return;
  switch (action.type) {
    case L0_SET_SYSTEM_PROMPT: {
      state.L0 = state.L0 || {};
      state.L0.systemPrompt = action.payload.prompt;
      break;
    }
    case L0_SET_TASK_GOAL: {
      state.L0 = state.L0 || {};
      state.L0.taskGoal = action.payload.goal;
      break;
    }
    case L0_ADD_TODO: {
      state.L0 = state.L0 || {};
      const list = Array.isArray(state.L0.todos) ? state.L0.todos : [];
      list.push(action.payload.todo);
      state.L0.todos = list;
      break;
    }
    case L0_UPDATE_TODO: {
      state.L0 = state.L0 || {};
      const list = Array.isArray(state.L0.todos) ? state.L0.todos : [];
      state.L0.todos = list.map((todo) => {
        if (!todo) return todo;
        if (todo.id === action.payload.id || todo.todoId === action.payload.id) {
          return { ...todo, ...action.payload.updates };
        }
        return todo;
      });
      break;
    }
    case L0_REMOVE_TODO: {
      state.L0 = state.L0 || {};
      const list = Array.isArray(state.L0.todos) ? state.L0.todos : [];
      state.L0.todos = list.filter((todo) => todo?.id !== action.payload.id && todo?.todoId !== action.payload.id);
      break;
    }
    case L0_REPLACE_TODOS: {
      state.L0 = state.L0 || {};
      state.L0.todos = Array.isArray(action.payload.todos) ? action.payload.todos : [];
      break;
    }
    case L1_ADD_MESSAGE: {
      state.L1 = state.L1 || {};
      const list = Array.isArray(state.L1.messages) ? state.L1.messages : [];
      list.push(action.payload.message);
      state.L1.messages = list;
      break;
    }
    case L1_ADD_MESSAGES: {
      state.L1 = state.L1 || {};
      const list = Array.isArray(state.L1.messages) ? state.L1.messages : [];
      if (Array.isArray(action.payload.messages)) list.push(...action.payload.messages);
      state.L1.messages = list;
      break;
    }
    case L1_CLEAR_MESSAGES: {
      state.L1 = state.L1 || {};
      state.L1.messages = [];
      break;
    }
    case L1_SET_MESSAGES: {
      state.L1 = state.L1 || {};
      state.L1.messages = Array.isArray(action.payload.messages) ? action.payload.messages : [];
      break;
    }
    case L1_SET_DECK: {
      state.L1 = state.L1 || {};
      state.L1.deck = action.payload.deck;
      break;
    }
    case L1_ADD_SIGNAL: {
      state.L1 = state.L1 || {};
      const list = Array.isArray(state.L1.signals) ? state.L1.signals : [];
      list.push(action.payload.signal);
      state.L1.signals = list;
      break;
    }
    case L1_ACKNOWLEDGE_SIGNAL: {
      state.L1 = state.L1 || {};
      const list = Array.isArray(state.L1.signals) ? state.L1.signals : [];
      state.L1.signals = list.map((signal) => {
        if (signal?.id === action.payload.id) return { ...signal, acknowledged: true };
        return signal;
      });
      break;
    }
    case L1_RECORD_DECISION: {
      state.L1 = state.L1 || {};
      const list = Array.isArray(state.L1.decisions) ? state.L1.decisions : [];
      list.push(action.payload.decision);
      state.L1.decisions = list;
      break;
    }
    case L1_SET_SCRATCHPAD: {
      state.L1 = state.L1 || {};
      const scratchpad = isPlainObjectMock(state.L1.scratchpad) ? state.L1.scratchpad : {};
      state.L1.scratchpad = { ...scratchpad, [action.payload.key]: action.payload.value };
      break;
    }
    case L1_CLEAR_SCRATCHPAD: {
      state.L1 = state.L1 || {};
      state.L1.scratchpad = {};
      break;
    }
    case L1_SET_FLAG: {
      state.L1 = state.L1 || {};
      const flags = isPlainObjectMock(state.L1.flags) ? state.L1.flags : {};
      state.L1.flags = { ...flags, [action.payload.name]: action.payload.value };
      break;
    }
    case L1_SYNC_DISCOVERY: {
      state.L1 = state.L1 || {};
      const table = state.L1.syncTable && typeof state.L1.syncTable === 'object' ? state.L1.syncTable : {};
      const discoveries = table.discoveries && typeof table.discoveries === 'object' ? table.discoveries : {};
      state.L1.syncTable = {
        ...table,
        discoveries: { ...discoveries, [action.payload.id]: action.payload.data },
      };
      break;
    }
    case L1_SYNC_SUBAGENT: {
      state.L1 = state.L1 || {};
      const table = state.L1.syncTable && typeof state.L1.syncTable === 'object' ? state.L1.syncTable : {};
      const subagents = table.subagents && typeof table.subagents === 'object' ? table.subagents : {};
      state.L1.syncTable = {
        ...table,
        subagents: { ...subagents, [action.payload.id]: action.payload.data },
      };
      break;
    }
    case L2_SET_STAGE_SUMMARY: {
      state.L2 = state.L2 || {};
      const summaries = state.L2.stageSummaries && typeof state.L2.stageSummaries === 'object' ? state.L2.stageSummaries : {};
      state.L2.stageSummaries = { ...summaries, [action.payload.stage]: action.payload.summary };
      break;
    }
    case L2_ADD_CLAIM: {
      state.L2 = state.L2 || {};
      const list = Array.isArray(state.L2.claims) ? state.L2.claims : [];
      list.push(action.payload.claim);
      state.L2.claims = list;
      break;
    }
    case L2_REPLACE_CLAIMS: {
      state.L2 = state.L2 || {};
      state.L2.claims = Array.isArray(action.payload.claims) ? action.payload.claims : [];
      break;
    }
    default:
      break;
  }
};

const createState = (overrides = {}) => {
  const base = {
    L0: { systemPrompt: '', taskGoal: '', todos: [] },
    L1: {
      messages: [],
      signals: [],
      decisions: [],
      scratchpad: {},
      flags: {},
      deck: null,
      syncTable: { discoveries: {}, subagents: {} },
    },
    L2: { stageSummaries: {}, claims: [] },
  };

  const L0 = { ...base.L0, ...(overrides.L0 || {}) };
  const L1 = { ...base.L1, ...(overrides.L1 || {}) };
  const syncTable = overrides.L1?.syncTable && typeof overrides.L1.syncTable === 'object' ? overrides.L1.syncTable : {};
  L1.syncTable = { ...base.L1.syncTable, ...syncTable };
  const L2 = { ...base.L2, ...(overrides.L2 || {}) };

  return { L0, L1, L2 };
};

const buildStore = (overrides = {}) => {
  class UnifiedMemoryStore {
    constructor() {
      this._state = createState(overrides);
      this._sharedContext = overrides._sharedContext || null;
      this._discoveryManager = overrides._discoveryManager || null;
      this.dispatchSync = vi.fn((action) => {
        applyAction(this._state, action);
      });
      this.dispatchBatchSync = vi.fn((actions) => {
        if (Array.isArray(actions)) actions.forEach((action) => applyAction(this._state, action));
      });
      this._checkCompress = vi.fn();
      this._emitUpdate = vi.fn();
    }

    _getStateRef() {
      return this._state;
    }

    getTodos() {
      const list = Array.isArray(this._state.L0?.todos) ? this._state.L0.todos : [];
      return [...list];
    }

    getClaims() {
      const list = Array.isArray(this._state.L2?.claims) ? this._state.L2.claims : [];
      return [...list];
    }

    getDiscovery(id) {
      const key = toNonEmptyStringMock(id);
      if (!key) return null;
      return this._state.L1?.syncTable?.discoveries?.[key] || null;
    }

    getSubagent(id) {
      const key = toNonEmptyStringMock(id);
      if (!key) return null;
      return this._state.L1?.syncTable?.subagents?.[key] || null;
    }
  }

  applyWriteMethods(UnifiedMemoryStore);
  return new UnifiedMemoryStore();
};

let store;
let idCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;

  toNonEmptyStringMock.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  });

  isPlainObjectMock.mockImplementation((value) => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  deepCloneMock.mockImplementation((value) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return value;
    }
  });

  genIdMock.mockImplementation((prefix = 'id') => `${prefix}_${idCounter++}`);

  normalizeTodoEntryMock.mockImplementation((todo, options = {}) => {
    const base = isPlainObjectMock(todo) ? { ...todo } : { value: todo };
    let id = base.todoId || base.id;
    if (!id && typeof options.generateId === 'function') {
      id = options.generateId('todo');
    }
    return { ...base, id, todoId: base.todoId || id };
  });

  store = buildStore();
});

describe('applyWriteMethods', () => {
  describe('accessors and bind', () => {
    it('exposes flag accessors and binds shared/discovery references', () => {
      store = buildStore({
        L1: { flags: { awaitUserFeedback: true, taskImpossible: false } },
      });

      expect(store.awaitUserFeedback).toBe(true);
      expect(store.taskImpossible).toBe(false);

      store.awaitUserFeedback = 'yes';
      store.taskImpossible = 0;

      expect(store._state.L1.flags.awaitUserFeedback).toBe(true);
      expect(store._state.L1.flags.taskImpossible).toBe(false);
      expect(store._emitUpdate).toHaveBeenCalledWith('flags', { awaitUserFeedback: true });
      expect(store._emitUpdate).toHaveBeenCalledWith('flags', { taskImpossible: false });

      const shared = { name: 'shared' };
      const discovery = { name: 'discovery' };
      const result = store.bind({ sharedContext: shared, discoveryManager: discovery });

      expect(result).toBe(store);
      expect(store.sharedContext).toBe(shared);
      expect(store.discoveryManager).toBe(discovery);

      store.bind({ sharedContext: null, discoveryManager: undefined });
      expect(store.sharedContext).toBe(shared);
      expect(store.discoveryManager).toBe(discovery);
    });
  });

  describe('setSystemPrompt', () => {
    it('skips dispatch for nullish, empty, or unchanged prompts', () => {
      store = buildStore({ L0: { systemPrompt: '' } });
      store.setSystemPrompt(null);
      store.setSystemPrompt(undefined);
      store.setSystemPrompt('   ');

      expect(store.dispatchSync).not.toHaveBeenCalled();

      store.setSystemPrompt('Hello');
      const callCount = store.dispatchSync.mock.calls.length;
      store.setSystemPrompt('  Hello ');

      expect(store.dispatchSync).toHaveBeenCalledTimes(callCount);
    });

    it('dispatches long prompts and updates state', () => {
      const longPrompt = 'p'.repeat(100000);
      store.setSystemPrompt(longPrompt);

      expect(store._state.L0.systemPrompt).toBe(longPrompt);
      expect(store.dispatchSync).toHaveBeenCalledWith({
        type: L0_SET_SYSTEM_PROMPT,
        payload: { prompt: longPrompt },
      });
    });
  });

  describe('setTaskGoal', () => {
    it('accepts numeric boundaries and updates when changed', () => {
      store.setTaskGoal(0);
      expect(store._state.L0.taskGoal).toBe('0');

      store.setTaskGoal(-1);
      expect(store._state.L0.taskGoal).toBe('-1');

      const max = Number.MAX_SAFE_INTEGER;
      store.setTaskGoal(max);
      expect(store._state.L0.taskGoal).toBe(String(max));
    });

    it('skips dispatch for whitespace when already empty', () => {
      store = buildStore({ L0: { taskGoal: '' } });
      store.setTaskGoal('   ');
      expect(store.dispatchSync).not.toHaveBeenCalled();
    });
  });

  describe('addTodo', () => {
    it('normalizes input and returns the inserted todo', () => {
      normalizeTodoEntryMock.mockImplementationOnce((todo, options) => {
        expect(options).toEqual({ generateId: genIdMock, fillTimestamps: true });
        return { id: 'todo-1', title: todo.title };
      });

      const result = store.addTodo({ title: 'one' });

      expect(result).toEqual({ id: 'todo-1', title: 'one' });
      expect(store._state.L0.todos).toEqual([{ id: 'todo-1', title: 'one' }]);
    });

    it('returns null when normalized entry has no id', () => {
      normalizeTodoEntryMock.mockImplementationOnce(() => ({ title: 'no-id' }));

      const result = store.addTodo({ title: 'no-id' });

      expect(result).toBeNull();
      expect(store._state.L0.todos.length).toBe(1);
    });
  });

  describe('updateTodo', () => {
    it('returns null for invalid id or non-plain updates', () => {
      store._state.L0.todos = [{ id: 'a', title: 'first' }];

      expect(store.updateTodo('', { title: 'x' })).toBeNull();
      expect(store.updateTodo('a', null)).toBeNull();
      expect(store.updateTodo('a', [])).toBeNull();
      expect(store.dispatchSync).not.toHaveBeenCalled();
    });

    it('updates matching todos for numeric string ids', () => {
      const max = Number.MAX_SAFE_INTEGER;
      store._state.L0.todos = [
        { id: '0', title: 'zero' },
        { id: '-1', title: 'neg' },
        { id: String(max), title: 'big' },
      ];

      const updatedZero = store.updateTodo(0, { status: 'done' });
      const updatedNeg = store.updateTodo(-1, { status: 'blocked' });
      const updatedBig = store.updateTodo(max, { status: 'queued' });

      expect(updatedZero).toEqual({ id: '0', title: 'zero', status: 'done' });
      expect(updatedNeg).toEqual({ id: '-1', title: 'neg', status: 'blocked' });
      expect(updatedBig).toEqual({ id: String(max), title: 'big', status: 'queued' });
    });
  });

  describe('removeTodo', () => {
    it('returns null for invalid ids and does not dispatch', () => {
      expect(store.removeTodo(null)).toBeNull();
      expect(store.removeTodo(undefined)).toBeNull();
      expect(store.removeTodo('   ')).toBeNull();
      expect(store.dispatchSync).not.toHaveBeenCalled();
    });

    it('removes by id or todoId and returns the removed entry', () => {
      store._state.L0.todos = [
        { id: 'a', title: 'first' },
        { todoId: 'b', title: 'second' },
      ];

      const removed = store.removeTodo('a');
      const missing = store.removeTodo('missing');

      expect(removed).toEqual({ id: 'a', title: 'first' });
      expect(missing).toBeNull();
      expect(store._state.L0.todos).toEqual([{ todoId: 'b', title: 'second' }]);
    });
  });

  describe('replaceTodos', () => {
    it('replaces todos after normalizing each entry', () => {
      const todos = [{ title: 'one' }, { title: 'two', id: 't2' }];

      const result = store.replaceTodos(todos);

      expect(normalizeTodoEntryMock).toHaveBeenCalledTimes(2);
      expect(result.length).toBe(2);
      expect(store._state.L0.todos.length).toBe(2);
    });

    it('handles non-array input by replacing with empty list', () => {
      const result = store.replaceTodos({ id: 'not-array' });

      expect(result).toEqual([]);
      expect(store._state.L0.todos).toEqual([]);
    });
  });

  describe('addMessage', () => {
    it('adds a message, returns it, and checks compression', () => {
      store = buildStore({ L1: { messages: undefined } });
      const message = { id: 'm1', content: 'hi' };

      const result = store.addMessage(message);

      expect(result).toEqual(message);
      expect(store._state.L1.messages).toEqual([message]);
      expect(store._checkCompress).toHaveBeenCalledTimes(1);
    });

    it('handles rapid consecutive calls with long payloads', async () => {
      const longText = 'x'.repeat(20000);
      const [first, second] = await Promise.all([
        Promise.resolve(store.addMessage({ id: 'm1', content: longText })),
        Promise.resolve(store.addMessage({ id: 'm2', content: 'short' })),
      ]);

      expect([first?.id, second?.id].sort()).toEqual(['m1', 'm2']);
      expect(store._state.L1.messages.length).toBe(2);
      expect(store._checkCompress).toHaveBeenCalledTimes(2);
    });
  });

  describe('addMessages', () => {
    it('returns empty list for non-array or empty inputs', () => {
      expect(store.addMessages(undefined)).toEqual([]);
      expect(store.addMessages({ id: 1 })).toEqual([]);
      expect(store.addMessages([])).toEqual([]);
      expect(store.dispatchSync).not.toHaveBeenCalled();
    });

    it('adds batches and returns only new messages', async () => {
      const batch = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` }));
      const [first, second] = await Promise.all([
        Promise.resolve(store.addMessages(batch)),
        Promise.resolve(store.addMessages([{ id: 'm5' }])),
      ]);

      expect(first).toEqual(batch);
      expect(second).toEqual([{ id: 'm5' }]);
      expect(store._state.L1.messages.length).toBe(6);
      expect(store._checkCompress).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearMessages and setMessages', () => {
    it('clears messages via dispatch', () => {
      store._state.L1.messages = [{ id: 'm1' }];
      store.clearMessages();

      expect(store._state.L1.messages).toEqual([]);
      expect(store.dispatchSync).toHaveBeenCalledWith({ type: L1_CLEAR_MESSAGES, payload: {} });
    });

    it('sets messages and normalizes non-array input', () => {
      store.setMessages([{ id: 'm1' }]);
      expect(store._state.L1.messages).toEqual([{ id: 'm1' }]);

      store.setMessages({ id: 'not-array' });
      expect(store._state.L1.messages).toEqual([]);
      expect(store.dispatchSync).toHaveBeenCalledWith({
        type: L1_SET_MESSAGES,
        payload: { messages: [] },
      });
    });
  });

  describe('setDeck', () => {
    it('dispatches deck updates', () => {
      const deck = { title: 'overview' };
      store.setDeck(deck);

      expect(store._state.L1.deck).toEqual(deck);
      expect(store.dispatchSync).toHaveBeenCalledWith({ type: L1_SET_DECK, payload: { deck } });
    });
  });

  describe('addSignal and acknowledgeSignal', () => {
    it('adds signals and returns the inserted entry', () => {
      store._state.L1.signals = [{ id: 's0' }];
      const signal = { id: 's1', title: 'alert' };

      const result = store.addSignal(signal);

      expect(result).toEqual(signal);
      expect(store._state.L1.signals.length).toBe(2);
    });

    it('acknowledges signals by trimmed id', () => {
      store._state.L1.signals = [{ id: 'sig1', acknowledged: false }];

      expect(store.acknowledgeSignal('   ')).toBeNull();

      const result = store.acknowledgeSignal(' sig1 ');

      expect(result?.acknowledged).toBe(true);
      expect(store._state.L1.signals[0].acknowledged).toBe(true);
    });
  });

  describe('recordDecision', () => {
    it('records decisions and returns the added entry', () => {
      store._state.L1.decisions = [];
      const decision = { id: 'd1', summary: 'choose' };

      const result = store.recordDecision(decision);

      expect(result).toEqual(decision);
      expect(store._state.L1.decisions).toEqual([decision]);
    });
  });

  describe('scratchpad updates', () => {
    it('sets scratchpad entries and emits updates', () => {
      const deep = { level: 0 };
      let node = deep;
      for (let i = 1; i <= 10; i += 1) {
        node.child = { level: i };
        node = node.child;
      }

      store.setScratchpad('nested', deep);

      expect(store._state.L1.scratchpad.nested).toEqual(deep);
      expect(store._emitUpdate).toHaveBeenCalledWith('scratchpad', { key: 'nested', value: deep });
    });

    it('clears scratchpad and emits cleared updates', () => {
      store._state.L1.scratchpad = { a: 1 };
      store.clearScratchpad();

      expect(store._state.L1.scratchpad).toEqual({});
      expect(store._emitUpdate).toHaveBeenCalledWith('scratchpad', { cleared: true });
    });
  });

  describe('setFlag', () => {
    it('ignores empty flag names', () => {
      store.setFlag('');
      store.setFlag('   ');

      expect(store.dispatchSync).not.toHaveBeenCalled();
      expect(store._emitUpdate).not.toHaveBeenCalled();
    });

    it('coerces values to boolean and emits updates', () => {
      store.setFlag('ready', 'false');
      store.setFlag('ready', 0);

      expect(store._state.L1.flags.ready).toBe(false);
      expect(store._emitUpdate).toHaveBeenCalledWith('flags', { ready: true });
      expect(store._emitUpdate).toHaveBeenCalledWith('flags', { ready: false });
    });
  });

  describe('syncDiscovery', () => {
    it('returns null for invalid ids', () => {
      expect(store.syncDiscovery(undefined, {})).toBeNull();
      expect(store.syncDiscovery('   ', {})).toBeNull();
      expect(store.dispatchSync).not.toHaveBeenCalled();
    });

    it('syncs discovery data and normalizes non-plain payloads', () => {
      const result = store.syncDiscovery(123, []);

      expect(result).toEqual({});
      expect(store._state.L1.syncTable.discoveries['123']).toEqual({});
    });
  });

  describe('syncSubagent', () => {
    it('syncs subagent data and returns stored value', () => {
      const payload = { status: 'active' };
      const result = store.syncSubagent('sub-1', payload);

      expect(result).toEqual(payload);
      expect(store._state.L1.syncTable.subagents['sub-1']).toEqual(payload);
    });
  });

  describe('setStageSummary', () => {
    it('ignores empty stages and stores default summaries', () => {
      store.setStageSummary('', 'ignored');
      expect(store.dispatchSync).not.toHaveBeenCalled();

      store.setStageSummary('stage-1', null);
      expect(store._state.L2.stageSummaries['stage-1']).toBe('');
    });
  });

  describe('addClaim and replaceClaims', () => {
    it('adds claims with deep nesting and supports rapid calls', async () => {
      const deep = { level: 0 };
      let node = deep;
      for (let i = 1; i <= 8; i += 1) {
        node.child = { level: i };
        node = node.child;
      }

      const [first, second] = await Promise.all([
        Promise.resolve(store.addClaim(deep)),
        Promise.resolve(store.addClaim({ id: 'c2' })),
      ]);

      expect(first).toEqual(deep);
      expect(second).toEqual({ id: 'c2' });
      expect(store._state.L2.claims.length).toBe(2);
    });

    it('replaces claims with deep-cloned arrays', () => {
      const claims = [{ id: 'c1' }, { id: 'c2' }];
      const result = store.replaceClaims(claims);

      expect(deepCloneMock).toHaveBeenCalledWith(claims);
      expect(result).toEqual(claims);
      expect(store._state.L2.claims).not.toBe(claims);
    });

    it('handles non-array claim input by clearing claims', () => {
      const result = store.replaceClaims({ id: 'not-array' });

      expect(result).toEqual([]);
      expect(store._state.L2.claims).toEqual([]);
    });
  });

  describe('syncFromSharedContext', () => {
    it('no-ops without a shared context', () => {
      store.syncFromSharedContext();
      expect(store.dispatchBatchSync).not.toHaveBeenCalled();
    });

    it('batches new signals, summaries, and decisions', () => {
      store = buildStore({
        L1: {
          signals: [{ id: 's1' }],
          decisions: [{ id: 'd1' }],
        },
        L2: { stageSummaries: {} },
      });

      const shared = {
        getSignals: () => [{ id: 's1' }, { id: 's2' }, { title: 'no-id' }],
        getAllSummaries: () => ({ stageA: 'summaryA', '': 'empty' }),
        getDecisions: () => [{ id: 'd1' }, { id: 'd2' }, { title: 'no-id' }],
      };

      store.bind({ sharedContext: shared });
      store.syncFromSharedContext();

      expect(store.dispatchBatchSync).toHaveBeenCalledTimes(1);
      const batch = store.dispatchBatchSync.mock.calls[0][0];
      expect(batch.length).toBe(6);
      expect(store._state.L1.signals.some((signal) => signal?.id === 's2')).toBe(true);
      expect(store._state.L1.decisions.some((decision) => decision?.id === 'd2')).toBe(true);
      expect(store._state.L2.stageSummaries.stageA).toBe('summaryA');
    });
  });

  describe('syncFromDiscoveryManager', () => {
    it('no-ops with empty discovery lists', () => {
      store.bind({ discoveryManager: { getAllDiscoveries: () => [] } });
      store.syncFromDiscoveryManager();
      expect(store.dispatchBatchSync).not.toHaveBeenCalled();
    });

    it('syncs discovery entries with defaults and skips missing ids', () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);

      const manager = {
        getAllDiscoveries: () => [
          { id: 'd1', status: 'closed', keywords: ['k'], by: 'user', ts: 100 },
          { id: 'd2' },
          { status: 'missing-id' },
        ],
      };
      store.bind({ discoveryManager: manager });

      store.syncFromDiscoveryManager();

      expect(store.dispatchBatchSync).toHaveBeenCalledTimes(1);
      expect(store._state.L1.syncTable.discoveries.d1).toEqual({
        status: 'closed',
        keywords: ['k'],
        by: 'user',
        ts: 100,
      });
      expect(store._state.L1.syncTable.discoveries.d2).toEqual({
        status: 'open',
        keywords: [],
        by: null,
        ts: 12345,
      });

      nowSpy.mockRestore();
    });
  });

  describe('syncAll', () => {
    it('invokes shared context and discovery syncs', () => {
      const sharedSpy = vi.spyOn(store, 'syncFromSharedContext');
      const discoverySpy = vi.spyOn(store, 'syncFromDiscoveryManager');

      store.syncAll();

      expect(sharedSpy).toHaveBeenCalledTimes(1);
      expect(discoverySpy).toHaveBeenCalledTimes(1);
    });
  });
});
