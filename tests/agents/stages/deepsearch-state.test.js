/**
 * DeepSearchState P1.3 Tests
 *
 * 验证状态委托到 MemoryStore 的正确性
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { DeepSearchState } from "../../../js/agents/stages/deepsearch/state.js";

describe("DeepSearchState P1.3: MemoryStore 委托", () => {
  describe("taskGoal 代理", () => {
    it("无 MemoryStore 时使用本地值", () => {
      const state = new DeepSearchState({ taskGoal: "local goal" });
      assert.equal(state.taskGoal, "local goal");
    });

    it("有 MemoryStore 时优先读取 MemoryStore", () => {
      const mockMemory = { L0: { taskGoal: "memory goal" } };
      const state = new DeepSearchState({ taskGoal: "local", memoryStore: mockMemory });
      assert.equal(state.taskGoal, "memory goal");
    });

    it("MemoryStore 为空时回退到本地", () => {
      const mockMemory = { L0: { taskGoal: "" } };
      const state = new DeepSearchState({ taskGoal: "local", memoryStore: mockMemory });
      assert.equal(state.taskGoal, "local");
    });

    it("setter 同步写入 MemoryStore", () => {
      const mockMemory = { L0: { taskGoal: "" }, setTaskGoal: (g) => { mockMemory.L0.taskGoal = g; } };
      const state = new DeepSearchState({ memoryStore: mockMemory });

      state.taskGoal = "new goal";

      assert.equal(mockMemory.L0.taskGoal, "new goal");
      assert.equal(state._localTaskGoal, "new goal");
    });

    it("setter 在无 setTaskGoal 方法时直接写 L0", () => {
      const mockMemory = { L0: { taskGoal: "" } };
      const state = new DeepSearchState({ memoryStore: mockMemory });

      state.taskGoal = "direct write";

      assert.equal(mockMemory.L0.taskGoal, "direct write");
    });
  });

  describe("awaitUserFeedback 代理", () => {
    it("无 MemoryStore 时使用 L2", () => {
      const state = new DeepSearchState({});
      state.L2.awaitUserFeedback = true;
      assert.equal(state.awaitUserFeedback, true);
    });

    it("有 MemoryStore 时优先读取", () => {
      const mockMemory = { awaitUserFeedback: true };
      const state = new DeepSearchState({ memoryStore: mockMemory });
      state.L2.awaitUserFeedback = false;
      assert.equal(state.awaitUserFeedback, true);
    });

    it("setter 同步写入 MemoryStore 和 L2", () => {
      const mockMemory = { awaitUserFeedback: false };
      const state = new DeepSearchState({ memoryStore: mockMemory });

      state.awaitUserFeedback = true;

      assert.equal(mockMemory.awaitUserFeedback, true);
      assert.equal(state.L2.awaitUserFeedback, true);
    });
  });

  describe("taskImpossible 代理", () => {
    it("无 MemoryStore 时使用 L2", () => {
      const state = new DeepSearchState({});
      state.L2.taskImpossible = true;
      assert.equal(state.taskImpossible, true);
    });

    it("有 MemoryStore 时优先读取", () => {
      const mockMemory = { taskImpossible: true };
      const state = new DeepSearchState({ memoryStore: mockMemory });
      state.L2.taskImpossible = false;
      assert.equal(state.taskImpossible, true);
    });

    it("setter 同步写入 MemoryStore 和 L2", () => {
      const mockMemory = { taskImpossible: false };
      const state = new DeepSearchState({ memoryStore: mockMemory });

      state.taskImpossible = true;

      assert.equal(mockMemory.taskImpossible, true);
      assert.equal(state.L2.taskImpossible, true);
    });
  });

  describe("序列化", () => {
    it("toJSON 使用 getter 获取 taskGoal", () => {
      const mockMemory = { L0: { taskGoal: "memory value" } };
      const state = new DeepSearchState({ taskGoal: "local", memoryStore: mockMemory });

      const json = state.toJSON();

      assert.equal(json.taskGoal, "memory value");
    });

    it("toSnapshot 使用 getter 获取 taskGoal", () => {
      const mockMemory = { L0: { taskGoal: "snapshot value" } };
      const state = new DeepSearchState({ taskGoal: "local", memoryStore: mockMemory });

      const snapshot = state.toSnapshot();

      assert.equal(snapshot.taskGoal, "snapshot value");
    });
  });

  describe("bindMemoryStore 后的行为", () => {
    it("绑定后 taskGoal 从 MemoryStore 读取", () => {
      const state = new DeepSearchState({ taskGoal: "initial" });
      const mockMemory = { L0: { taskGoal: "" }, setTaskGoal: (g) => { mockMemory.L0.taskGoal = g; } };

      state.bindMemoryStore(mockMemory);

      // bindMemoryStore 会同步 taskGoal 到 MemoryStore
      assert.equal(mockMemory.L0.taskGoal, "initial");
      assert.equal(state.taskGoal, "initial");
    });

    it("绑定后 todos 共享引用", () => {
      const state = new DeepSearchState({ todos: [{ id: "1", text: "test" }] });
      const mockMemory = { L0: { todos: [] } };

      state.bindMemoryStore(mockMemory);

      // todos 应该共享
      assert.equal(state.todos.length, 1);
      assert.equal(mockMemory.L0.todos, state.todos);
    });
  });
});
