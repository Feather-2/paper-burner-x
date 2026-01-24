import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  messageManagerCtor: vi.fn(),
  messageManagerInstances: [],
  getLimit: vi.fn(),
  dequeInstances: [],
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  Deque: class DequeMock {
    constructor() {
      this._items = [];
      mockState.dequeInstances.push(this);
    }
    push(item) {
      this._items.push(item);
    }
    shift() {
      return this._items.shift();
    }
    toArray() {
      return [...this._items];
    }
    clear() {
      this._items.length = 0;
    }
    get size() {
      return this._items.length;
    }
  },
}));

vi.mock("../../../../../js/agents/runtime/core/constants/limits.js", () => ({
  getLimit: mockState.getLimit,
}));

vi.mock("../../../../../js/agents/runtime/core/message-manager.js", () => {
  class MessageManagerMock {
    constructor(options) {
      mockState.messageManagerCtor(options);
      this._contextConfig = options?.contextConfig ?? null;
      this.messages = [];
      this._tokenUsage = { input: 0, output: 0, total: 0 };
      this._compressionHistory = [];
      this._compressionPromise = null;
      this._compressionPending = false;
      this.addMessage = vi.fn((message) => {
        this.messages.push(message);
        return message;
      });
      this.addMessages = vi.fn((messages) => {
        this.messages.push(...messages);
        return messages;
      });
      this.reset = vi.fn(async (opts) => opts);
      this._shouldCompress = vi.fn(() => false);
      this._scheduleCompression = vi.fn((opts) => opts);
      this.flushCompression = vi.fn(async (opts) => opts);
      this._compress = vi.fn(async () => undefined);
      this.getStatus = vi.fn(() => ({ ok: true }));
      this.setContextConfig = vi.fn((config) => {
        this._contextConfig = config;
        return config;
      });
      mockState.messageManagerInstances.push(this);
    }
  }
  return { MessageManager: MessageManagerMock };
});

import * as messageHandling from "../../../../../js/agents/runtime/core/agent-loop-message-handling.js";

const createLoop = (options = {}) => {
  class BaseLoop {}
  messageHandling.attachMessageHandling(BaseLoop);
  const loop = new BaseLoop();
  messageHandling.initMessageHandling(loop, {
    stageName: options.stageName ?? "stage",
    actor: options.actor ?? "actor",
  });
  loop.stageName = options.stageName ?? "stage";
  loop.actor = options.actor ?? "actor";
  loop.emit = options.emit;
  loop.eventBus = options.eventBus;
  loop.pause = options.pause ?? vi.fn();
  return loop;
};

beforeEach(() => {
  mockState.messageManagerCtor.mockReset();
  mockState.getLimit.mockReset();
  mockState.messageManagerInstances.length = 0;
  mockState.dequeInstances.length = 0;
  mockState.getLimit.mockReturnValue(3);
});

describe("initMessageHandling", () => {
  it("should_construct_MessageManager_with_expected_options_when_called", () => {
    const loop = {};
    const options = {
      contextConfig: { mode: "compact" },
      tokenCounter: { count: vi.fn() },
      logger: { info: vi.fn() },
      emit: vi.fn(),
      stageName: "stage",
      actor: "actor",
      maxUserInputs: 5,
    };

    mockState.getLimit.mockReturnValue(7);
    messageHandling.initMessageHandling(loop, options);

    expect(mockState.messageManagerCtor).toHaveBeenCalledWith({
      contextConfig: options.contextConfig,
      tokenCounter: options.tokenCounter,
      logger: options.logger,
      emit: options.emit,
      stageName: "stage",
      actor: "actor",
    });
  });

  it("should_call_getLimit_with_MAX_USER_INPUTS_when_called", () => {
    const loop = {};

    messageHandling.initMessageHandling(loop, { stageName: "stage", actor: "actor", maxUserInputs: 5 });

    expect(mockState.getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", 5);
  });

  it("should_set_loop_maxUserInputs_from_getLimit_when_called", () => {
    const loop = {};
    mockState.getLimit.mockReturnValue(7);

    messageHandling.initMessageHandling(loop, { stageName: "stage", actor: "actor", maxUserInputs: 5 });

    expect(loop._maxUserInputs).toBe(7);
  });

  it("should_initialize_user_inputs_with_Deque_when_called", () => {
    const loop = {};

    messageHandling.initMessageHandling(loop, { stageName: "stage", actor: "actor" });

    expect(mockState.dequeInstances).toContain(loop._userInputs);
  });

  it("should_initialize_userInputUnsub_to_null_when_called", () => {
    const loop = {};

    messageHandling.initMessageHandling(loop, { stageName: "stage", actor: "actor" });

    expect(loop._userInputUnsub).toBe(null);
  });

  it("should_initialize_userInputBus_to_null_when_called", () => {
    const loop = {};

    messageHandling.initMessageHandling(loop, { stageName: "stage", actor: "actor" });

    expect(loop._userInputBus).toBe(null);
  });

  it("should_set_default_userInputEvent_when_called", () => {
    const loop = {};

    messageHandling.initMessageHandling(loop, { stageName: "stage", actor: "actor" });

    expect(loop._userInputEvent).toBe("user.input");
  });

  it("should_initialize_pauseListenerUnsub_to_null_when_called", () => {
    const loop = {};

    messageHandling.initMessageHandling(loop, { stageName: "stage", actor: "actor" });

    expect(loop._pauseListenerUnsub).toBe(null);
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER, "5", undefined])(
    "should_pass_maxUserInputs_to_getLimit_when_maxUserInputs_is_%s",
    (maxUserInputs) => {
      const loop = {};

      messageHandling.initMessageHandling(loop, { stageName: "", actor: "", maxUserInputs });

      expect(mockState.getLimit).toHaveBeenLastCalledWith("MAX_USER_INPUTS", maxUserInputs);
    }
  );

  it("should_not_throw_when_options_are_undefined", () => {
    const loop = {};

    expect(() => messageHandling.initMessageHandling(loop)).not.toThrow();
  });

  it("should_call_getLimit_with_undefined_when_options_are_undefined", () => {
    const loop = {};

    messageHandling.initMessageHandling(loop);

    expect(mockState.getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", undefined);
  });

  it("should_throw_when_loop_is_null", () => {
    expect(() => messageHandling.initMessageHandling(null, {})).toThrow();
  });

  it("should_throw_when_options_are_null", () => {
    expect(() => messageHandling.initMessageHandling({}, null)).toThrow();
  });
});

describe("attachMessageHandling", () => {
  it("should_attach_addMessage_method_when_attached", () => {
    class BaseLoop {}

    messageHandling.attachMessageHandling(BaseLoop);
    const loop = new BaseLoop();

    expect(typeof loop.addMessage).toBe("function");
  });

  it("should_define_messages_getter_when_attached", () => {
    class BaseLoop {}

    messageHandling.attachMessageHandling(BaseLoop);

    expect(Object.getOwnPropertyDescriptor(BaseLoop.prototype, "messages")?.get).toBeTypeOf("function");
  });

  it("should_not_override_constructor_when_attached", () => {
    class BaseLoop {}

    messageHandling.attachMessageHandling(BaseLoop);
    const loop = new BaseLoop();

    expect(loop.constructor).toBe(BaseLoop);
  });

  it("should_throw_when_BaseAgentLoop_is_invalid", () => {
    expect(() => messageHandling.attachMessageHandling(null)).toThrow();
  });
});

describe("AgentLoopMessageHandling", () => {
  it("should_return_message_manager_messages_when_getting_messages", () => {
    const loop = createLoop();
    loop._messageManager.messages = [{ id: 1 }];

    expect(loop.messages).toBe(loop._messageManager.messages);
  });

  it("should_return_message_manager_contextConfig_when_getting_contextConfig", () => {
    const loop = createLoop();
    loop._messageManager._contextConfig = { window: 10 };

    expect(loop._contextConfig).toBe(loop._messageManager._contextConfig);
  });

  it("should_set_message_manager_contextConfig_when_setting_contextConfig", () => {
    const loop = createLoop();

    loop._contextConfig = { window: 20 };

    expect(loop._messageManager._contextConfig).toEqual({ window: 20 });
  });

  it("should_return_message_manager_tokenUsage_when_getting_tokenUsage", () => {
    const loop = createLoop();
    loop._messageManager._tokenUsage = { input: 1, output: 2, total: 3 };

    expect(loop._tokenUsage).toBe(loop._messageManager._tokenUsage);
  });

  it("should_return_message_manager_compressionHistory_when_getting_compressionHistory", () => {
    const loop = createLoop();
    loop._messageManager._compressionHistory = ["snapshot"];

    expect(loop._compressionHistory).toBe(loop._messageManager._compressionHistory);
  });

  it("should_return_message_manager_compressionPromise_when_getting_compressionPromise", () => {
    const loop = createLoop();
    loop._messageManager._compressionPromise = Promise.resolve();

    expect(loop._compressionPromise).toBe(loop._messageManager._compressionPromise);
  });

  it("should_return_message_manager_compressionPending_when_getting_compressionPending", () => {
    const loop = createLoop();
    loop._messageManager._compressionPending = true;

    expect(loop._compressionPending).toBe(true);
  });

  it("should_delegate_addMessage_to_messageManager_when_called", () => {
    const loop = createLoop();
    const message = { role: "user", content: "hello" };

    loop.addMessage(message);

    expect(loop._messageManager.addMessage).toHaveBeenCalledWith(message);
  });

  it("should_return_added_message_when_addMessage_called", () => {
    const loop = createLoop();
    const message = { role: "user", content: "hello" };

    const result = loop.addMessage(message);

    expect(result).toBe(message);
  });

  it("should_delegate_addMessages_to_messageManager_when_called", () => {
    const loop = createLoop();
    const messages = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }];

    loop.addMessages(messages);

    expect(loop._messageManager.addMessages).toHaveBeenCalledWith(messages);
  });

  it("should_return_added_messages_when_addMessages_called", () => {
    const loop = createLoop();
    const messages = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }];

    const result = loop.addMessages(messages);

    expect(result).toBe(messages);
  });

  it("should_delegate_resetMessages_to_messageManager_when_called", async () => {
    const loop = createLoop();

    await loop.resetMessages({ clearCompressionHistory: true });

    expect(loop._messageManager.reset).toHaveBeenCalledWith({ clearCompressionHistory: true });
  });

  it("should_return_value_from_messageManager_reset_when_resetMessages_called", async () => {
    const loop = createLoop();

    const result = await loop.resetMessages({ clearCompressionHistory: true });

    expect(result).toEqual({ clearCompressionHistory: true });
  });

  it("should_return_value_from_messageManager_shouldCompress_when_called", () => {
    const loop = createLoop();
    loop._messageManager._shouldCompress.mockReturnValue(true);

    expect(loop._shouldCompress()).toBe(true);
  });

  it("should_delegate_scheduleCompression_to_messageManager_when_called", () => {
    const loop = createLoop();

    loop._scheduleCompression({ force: true });

    expect(loop._messageManager._scheduleCompression).toHaveBeenCalledWith({ force: true });
  });

  it("should_return_value_from_messageManager_scheduleCompression_when_called", () => {
    const loop = createLoop();

    const result = loop._scheduleCompression({ force: true });

    expect(result).toEqual({ force: true });
  });

  it("should_delegate_flushCompression_to_messageManager_when_called", async () => {
    const loop = createLoop();

    await loop.flushCompression({ maxRounds: 2 });

    expect(loop._messageManager.flushCompression).toHaveBeenCalledWith({ maxRounds: 2 });
  });

  it("should_return_value_from_messageManager_flushCompression_when_called", async () => {
    const loop = createLoop();

    const result = await loop.flushCompression({ maxRounds: 2 });

    expect(result).toEqual({ maxRounds: 2 });
  });

  it("should_delegate_compressMessages_to_messageManager_when_called", async () => {
    const loop = createLoop();

    await loop._compressMessages();

    expect(loop._messageManager._compress).toHaveBeenCalledTimes(1);
  });

  it("should_return_context_status_from_messageManager_when_called", () => {
    const loop = createLoop();

    expect(loop.getContextStatus()).toEqual({ ok: true });
  });

  it("should_delegate_setContextConfig_to_messageManager_when_called", () => {
    const loop = createLoop();
    const config = { contextWindow: 100 };

    loop.setContextConfig(config);

    expect(loop._messageManager.setContextConfig).toHaveBeenCalledWith(config);
  });

  it("should_return_value_from_messageManager_setContextConfig_when_called", () => {
    const loop = createLoop();
    const config = { contextWindow: 100 };

    const result = loop.setContextConfig(config);

    expect(result).toBe(config);
  });

  it("should_not_attach_user_input_listener_when_eventBus_is_missing", () => {
    const loop = createLoop();

    loop._attachUserInputListener(null);
    loop._attachUserInputListener({});

    expect(loop._userInputBus).toBe(null);
  });

  it("should_subscribe_to_default_user_input_event_when_eventName_is_empty", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachUserInputListener(eventBus, { eventName: "" });

    expect(eventBus.subscribe).toHaveBeenCalledWith("user.input", expect.any(Function), {});
  });

  it("should_subscribe_to_custom_user_input_event_when_eventName_is_provided", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachUserInputListener(eventBus, { eventName: "user.input.next" });

    expect(eventBus.subscribe).toHaveBeenCalledWith("user.input.next", expect.any(Function), {});
  });

  it("should_pass_signal_option_when_attaching_user_input_listener", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };
    const controller = new AbortController();

    loop._attachUserInputListener(eventBus, { signal: controller.signal });

    expect(eventBus.subscribe).toHaveBeenCalledWith("user.input", expect.any(Function), { signal: controller.signal });
  });

  it("should_record_payload_when_user_input_handler_receives_payload_object", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };
    const recordSpy = vi.spyOn(loop, "recordUserInput").mockReturnValue({ payload: "ok", ts: 1 });

    loop._attachUserInputListener(eventBus);
    const handler = eventBus.subscribe.mock.calls[0][1];
    handler({ payload: { text: "hello" } });

    expect(recordSpy).toHaveBeenCalledWith({ text: "hello" });
  });

  it("should_record_evt_when_user_input_handler_receives_raw_evt", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };
    const recordSpy = vi.spyOn(loop, "recordUserInput").mockReturnValue({ payload: "ok", ts: 1 });

    loop._attachUserInputListener(eventBus);
    const handler = eventBus.subscribe.mock.calls[0][1];
    handler("raw");

    expect(recordSpy).toHaveBeenCalledWith("raw");
  });

  it("should_not_resubscribe_when_user_input_bus_and_event_are_unchanged", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachUserInputListener(eventBus, { eventName: "user.input" });
    loop._attachUserInputListener(eventBus, { eventName: "user.input" });

    expect(eventBus.subscribe).toHaveBeenCalledTimes(1);
  });

  it("should_unsubscribe_when_user_input_event_changes", () => {
    const loop = createLoop();
    const unsub = vi.fn();
    const eventBus = { subscribe: vi.fn(() => unsub) };

    loop._attachUserInputListener(eventBus, { eventName: "user.input" });
    loop._attachUserInputListener(eventBus, { eventName: "user.input.next" });

    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("should_unsubscribe_when_user_input_bus_changes", () => {
    const loop = createLoop();
    const unsub = vi.fn();
    const eventBusA = { subscribe: vi.fn(() => unsub) };
    const eventBusB = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachUserInputListener(eventBusA, { eventName: "user.input" });
    loop._attachUserInputListener(eventBusB, { eventName: "user.input" });

    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("should_not_attach_pause_listener_when_eventBus_is_missing", () => {
    const loop = createLoop();

    loop._attachPauseListener(null);
    loop._attachPauseListener({});

    expect(loop._pauseListenerUnsub).toBe(null);
  });

  it("should_subscribe_once_when_attachPauseListener_called_multiple_times", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachPauseListener(eventBus);
    loop._attachPauseListener(eventBus);

    expect(eventBus.subscribe).toHaveBeenCalledTimes(1);
  });

  it("should_pause_with_reason_when_pause_handler_receives_reason", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachPauseListener(eventBus);
    const handler = eventBus.subscribe.mock.calls[0][1];
    handler({ payload: { reason: "break" } });

    expect(loop.pause).toHaveBeenCalledWith("break");
  });

  it("should_pause_with_message_when_pause_handler_receives_message", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachPauseListener(eventBus);
    const handler = eventBus.subscribe.mock.calls[0][1];
    handler({ payload: { message: "stop" } });

    expect(loop.pause).toHaveBeenCalledWith("stop");
  });

  it("should_pause_with_user_requested_when_pause_handler_receives_non_string_reason", () => {
    const loop = createLoop();
    const eventBus = { subscribe: vi.fn(() => vi.fn()) };

    loop._attachPauseListener(eventBus);
    const handler = eventBus.subscribe.mock.calls[0][1];
    handler({ payload: 0 });

    expect(loop.pause).toHaveBeenCalledWith("user_requested");
  });

  it("should_not_throw_when_detaching_listeners_and_unsub_throws", () => {
    const loop = createLoop();
    loop._userInputUnsub = vi.fn(() => {
      throw new Error("fail");
    });
    loop._userInputBus = { subscribe: vi.fn() };
    loop._pauseListenerUnsub = vi.fn(() => {
      throw new Error("fail");
    });

    expect(() => loop._detachEventBusListeners()).not.toThrow();
  });

  it("should_set_user_input_unsub_to_null_when_detaching_listeners", () => {
    const loop = createLoop();
    loop._userInputUnsub = vi.fn();
    loop._userInputBus = { subscribe: vi.fn() };

    loop._detachEventBusListeners();

    expect(loop._userInputUnsub).toBe(null);
  });

  it("should_set_user_input_bus_to_null_when_detaching_listeners", () => {
    const loop = createLoop();
    loop._userInputUnsub = vi.fn();
    loop._userInputBus = { subscribe: vi.fn() };

    loop._detachEventBusListeners();

    expect(loop._userInputBus).toBe(null);
  });

  it("should_set_pause_listener_unsub_to_null_when_detaching_listeners", () => {
    const loop = createLoop();
    loop._pauseListenerUnsub = vi.fn();

    loop._detachEventBusListeners();

    expect(loop._pauseListenerUnsub).toBe(null);
  });

  it("should_return_entry_with_payload_when_recordUserInput_called", () => {
    const loop = createLoop();

    const entry = loop.recordUserInput("one");

    expect(entry.payload).toBe("one");
  });

  it("should_set_entry_ts_from_Date_now_when_recordUserInput_called", () => {
    const loop = createLoop();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123);

    const entry = loop.recordUserInput("one");

    expect(entry.ts).toBe(123);
    nowSpy.mockRestore();
  });

  it("should_trim_old_inputs_when_recordUserInput_exceeds_limit", () => {
    const loop = createLoop();
    loop._maxUserInputs = 2;

    loop.recordUserInput("one");
    loop.recordUserInput("two");
    loop.recordUserInput("three");

    expect(loop._userInputs.toArray().map((item) => item.payload)).toEqual(["two", "three"]);
  });

  it.each([0, -1, "2", Number.NaN, Infinity])("should_not_trim_inputs_when_limit_is_%s", (limit) => {
    const loop = createLoop();
    loop._maxUserInputs = limit;

    loop.recordUserInput("a");
    loop.recordUserInput("b");
    loop.recordUserInput("c");

    expect(loop._userInputs.toArray().map((item) => item.payload)).toEqual(["a", "b", "c"]);
  });

  it("should_emit_stage_user_input_event_when_emit_function_exists", () => {
    const emit = vi.fn();
    const loop = createLoop({ emit });
    loop._maxUserInputs = 2;

    const entry = loop.recordUserInput("three");

    expect(emit).toHaveBeenCalledWith("stage.user.input", {
      actor: "actor",
      status: "info",
      payload: entry,
    });
  });

  it("should_fallback_to_eventBus_emit_when_emit_is_not_function", () => {
    const eventBus = { emit: vi.fn() };
    const loop = createLoop({ eventBus, emit: null });

    const entry = loop.recordUserInput({ text: "hello" });

    expect(eventBus.emit).toHaveBeenCalledWith(
      "stage.user.input",
      expect.objectContaining({ actor: "actor", status: "info", payload: entry })
    );
  });

  it("should_enforce_limit_when_recordUserInput_called_rapidly", async () => {
    const loop = createLoop();
    loop._maxUserInputs = 3;

    const payloads = ["a", "b", "c", "d"];
    await Promise.all(payloads.map((payload) => Promise.resolve(loop.recordUserInput(payload))));

    expect(loop._userInputs.toArray().map((entry) => entry.payload)).toEqual(["b", "c", "d"]);
  });

  it("should_return_all_items_when_consumeUserInputs_called", () => {
    const loop = createLoop();
    loop.recordUserInput("first");
    loop.recordUserInput("second");

    expect(loop.consumeUserInputs().map((entry) => entry.payload)).toEqual(["first", "second"]);
  });

  it("should_clear_queue_when_consumeUserInputs_called_with_default_options", () => {
    const loop = createLoop();
    loop.recordUserInput("first");

    loop.consumeUserInputs();

    expect(loop._userInputs.size).toBe(0);
  });

  it("should_not_clear_queue_when_consumeUserInputs_clear_is_false", () => {
    const loop = createLoop();
    loop.recordUserInput("third");

    loop.consumeUserInputs({ clear: false });

    expect(loop._userInputs.size).toBe(1);
  });

  it("should_return_empty_array_when_consumeUserInputs_called_with_no_inputs", () => {
    const loop = createLoop();

    expect(loop.consumeUserInputs()).toEqual([]);
  });

  it("should_return_trimmed_text_when_drainUserInputsAsText_called", () => {
    const loop = createLoop();
    loop.recordUserInput("  hello  ");
    loop.recordUserInput({ text: "world" });

    expect(loop.drainUserInputsAsText().text).toBe("hello\nworld");
  });

  it("should_not_clear_queue_when_drainUserInputsAsText_clear_is_false", () => {
    const loop = createLoop();
    loop.recordUserInput("again");

    loop.drainUserInputsAsText({ clear: false });

    expect(loop._userInputs.size).toBe(1);
  });

  it("should_return_original_config_when_applyUserInputsToConfig_has_no_inputs", () => {
    const loop = createLoop();
    const config = { a: 1 };

    expect(loop.applyUserInputsToConfig(config)).toBe(config);
  });

  it("should_append_text_to_default_key_when_existing_value_is_string", () => {
    const loop = createLoop();
    loop.recordUserInput({ message: "note" });

    expect(loop.applyUserInputsToConfig({ userNotes: "prior" }).userNotes).toEqual(["prior", "note"]);
  });

  it("should_set_last_user_note_when_applyUserInputsToConfig_called", () => {
    const loop = createLoop();
    loop.recordUserInput({ message: "note" });

    expect(loop.applyUserInputsToConfig({})._lastUserNote).toBe("note");
  });

  it("should_set_last_user_note_at_when_applyUserInputsToConfig_called", () => {
    const loop = createLoop();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(456);
    loop.recordUserInput({ message: "note" });

    expect(loop.applyUserInputsToConfig({})._lastUserNoteAt).toBe(456);
    nowSpy.mockRestore();
  });

  it("should_accumulate_raw_user_inputs_when_applyUserInputsToConfig_called", () => {
    const loop = createLoop();
    loop.recordUserInput("one");
    loop.recordUserInput("two");

    expect(loop.applyUserInputsToConfig({})._rawUserInputs.map((item) => item.payload)).toEqual(["one", "two"]);
  });

  it("should_support_custom_key_when_applyUserInputsToConfig_key_is_provided", () => {
    const loop = createLoop();
    loop.recordUserInput("note");

    expect(loop.applyUserInputsToConfig({}, { key: "notes" }).notes).toEqual(["note"]);
  });

  it("should_ignore_non_array_existing_values_when_appending_to_custom_key", () => {
    const loop = createLoop();
    const largeText = "x".repeat(100000);
    loop.recordUserInput(largeText);

    expect(loop.applyUserInputsToConfig({ notes: { invalid: true } }, { key: "notes" }).notes).toEqual([largeText]);
  });

  it("should_create_new_config_when_userConfig_is_not_object", () => {
    const loop = createLoop();
    loop.recordUserInput({ text: "note" });

    expect(loop.applyUserInputsToConfig("invalid").userNotes).toEqual(["note"]);
  });

  it("should_return_original_config_when_applyUserInputsToConfig_text_is_empty", () => {
    const loop = createLoop();
    const config = { a: 1 };
    loop.recordUserInput("   ");

    expect(loop.applyUserInputsToConfig(config)).toBe(config);
  });

  it("should_clear_queue_when_applyUserInputsToConfig_is_called", () => {
    const loop = createLoop();
    loop.recordUserInput({ a: { b: { c: 1 } } });

    loop.applyUserInputsToConfig(null);

    expect(loop._userInputs.size).toBe(0);
  });

  it("should_return_false_when_hasPendingUserInputs_called_with_no_inputs", () => {
    const loop = createLoop();

    expect(loop.hasPendingUserInputs()).toBe(false);
  });

  it("should_return_true_when_hasPendingUserInputs_called_with_inputs_present", () => {
    const loop = createLoop();
    loop.recordUserInput("one");

    expect(loop.hasPendingUserInputs()).toBe(true);
  });

  it("should_return_null_when_hasPendingUserInputs_called_with_userInputs_null", () => {
    const loop = createLoop();
    loop._userInputs = null;

    expect(loop.hasPendingUserInputs()).toBe(null);
  });

  it("should_return_empty_string_when_formatUserInputs_items_is_not_array", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs({})).toBe("");
  });

  it("should_return_empty_string_when_formatUserInputs_items_is_empty_array", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([])).toBe("");
  });

  it("should_return_trimmed_line_when_formatUserInputs_payload_is_string", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([{ payload: "  hello " }])).toBe("hello");
  });

  it("should_return_trimmed_line_when_formatUserInputs_payload_has_text", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([{ payload: { text: " world " } }])).toBe("world");
  });

  it("should_return_trimmed_line_when_formatUserInputs_payload_has_message", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([{ payload: { message: " ok " } }])).toBe("ok");
  });

  it("should_return_json_when_formatUserInputs_payload_is_object", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([{ payload: { nested: { value: 1 } } }])).toBe("{\"nested\":{\"value\":1}}");
  });

  it("should_fallback_to_String_when_formatUserInputs_payload_is_circular", () => {
    const loop = createLoop();
    const circular = {};
    circular.self = circular;

    expect(loop.formatUserInputs([{ payload: circular }])).toBe("[object Object]");
  });

  it("should_skip_nullish_items_when_formatUserInputs_called", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([undefined, null])).toBe("");
  });

  it("should_fallback_to_item_when_payload_is_nullish", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([{ payload: null }])).toBe("{\"payload\":null}");
  });

  it("should_filter_blank_lines_when_formatUserInputs_called", () => {
    const loop = createLoop();

    expect(loop.formatUserInputs([{ payload: "   " }, { payload: "" }, { payload: "ok" }])).toBe("ok");
  });

  it.each([
    { value: 0, expected: "0" },
    { value: -1, expected: "-1" },
    { value: Number.MAX_SAFE_INTEGER, expected: String(Number.MAX_SAFE_INTEGER) },
  ])("should_stringify_numeric_payload_when_formatUserInputs_payload_is_$value", ({ value, expected }) => {
    const loop = createLoop();

    expect(loop.formatUserInputs([{ payload: value }])).toBe(expected);
  });
});