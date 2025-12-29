import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { DesignBlackboard } from "../../../../js/agents/stages/design/runtime/design-blackboard.js";

describe("DesignBlackboard", () => {
  let blackboard;

  beforeEach(() => {
    blackboard = new DesignBlackboard({ runId: "test_run" });
  });

  describe("constructor", () => {
    it("should initialize with runId", () => {
      assert.strictEqual(blackboard.runId, "test_run");
    });

    it("should generate runId if not provided", () => {
      const bb = new DesignBlackboard();
      assert.ok(bb.runId.startsWith("design_"));
    });

    it("should set default limits", () => {
      assert.strictEqual(blackboard.limits.summariesMax, 20);
      assert.strictEqual(blackboard.limits.signalsMax, 50);
      assert.strictEqual(blackboard.limits.decisionsMax, 100);
    });
  });

  describe("L1 Summaries", () => {
    it("should set and get summary", () => {
      blackboard.setSummary("outline", "10 slides parsed");
      assert.strictEqual(blackboard.getSummary("outline"), "10 slides parsed");
    });

    it("should return null for missing summary", () => {
      assert.strictEqual(blackboard.getSummary("nonexistent"), null);
    });

    it("should get all summaries", () => {
      blackboard.setSummary("outline", "10 slides");
      blackboard.setSummary("style", "dark theme");
      const all = blackboard.getAllSummaries();
      assert.deepStrictEqual(all, {
        outline: "10 slides",
        style: "dark theme",
      });
    });

    it("should prune summaries when exceeding limit", () => {
      const bb = new DesignBlackboard({ limits: { summariesMax: 2 } });
      bb.setSummary("a", "1");
      bb.setSummary("b", "2");
      bb.setSummary("c", "3");
      const all = bb.getAllSummaries();
      assert.strictEqual(Object.keys(all).length, 2);
      assert.strictEqual(all.b, "2");
      assert.strictEqual(all.c, "3");
    });
  });

  describe("Signals", () => {
    it("should push and pop signals (FIFO)", () => {
      blackboard.pushSignal("style_override", { color: "red" });
      blackboard.pushSignal("outline_edit", { slide: 1 });

      const first = blackboard.popSignal();
      assert.strictEqual(first.type, "style_override");
      assert.deepStrictEqual(first.payload, { color: "red" });

      const second = blackboard.popSignal();
      assert.strictEqual(second.type, "outline_edit");
    });

    it("should return null when popping empty queue", () => {
      assert.strictEqual(blackboard.popSignal(), null);
    });

    it("should peek signals without removing", () => {
      blackboard.pushSignal("a", {});
      blackboard.pushSignal("b", {});

      const peeked = blackboard.peekSignals(2);
      assert.strictEqual(peeked.length, 2);
      assert.strictEqual(peeked[0].type, "a");

      // Should still be there
      assert.strictEqual(blackboard.popSignal().type, "a");
    });

    it("should check if signal exists", () => {
      blackboard.pushSignal("test_signal", {});
      assert.strictEqual(blackboard.hasSignal("test_signal"), true);
      assert.strictEqual(blackboard.hasSignal("other"), false);
    });

    it("should clear signals by type", () => {
      blackboard.pushSignal("a", {});
      blackboard.pushSignal("b", {});
      blackboard.pushSignal("a", {});

      blackboard.clearSignals("a");
      assert.strictEqual(blackboard.hasSignal("a"), false);
      assert.strictEqual(blackboard.hasSignal("b"), true);
    });

    it("should clear all signals", () => {
      blackboard.pushSignal("a", {});
      blackboard.pushSignal("b", {});

      blackboard.clearSignals();
      assert.strictEqual(blackboard.popSignal(), null);
    });
  });

  describe("Decisions", () => {
    it("should log decisions", () => {
      blackboard.logDecision("select_theme", "User chose dark mode");
      const decisions = blackboard.getRecentDecisions(1);
      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].action, "select_theme");
      assert.strictEqual(decisions[0].reason, "User chose dark mode");
    });

    it("should get recent decisions", () => {
      blackboard.logDecision("a", "1");
      blackboard.logDecision("b", "2");
      blackboard.logDecision("c", "3");

      const recent = blackboard.getRecentDecisions(2);
      assert.strictEqual(recent.length, 2);
      assert.strictEqual(recent[0].action, "b");
      assert.strictEqual(recent[1].action, "c");
    });
  });

  describe("Versions", () => {
    it("should save and get version", () => {
      const snapshot = { deckHtml: "<section>test</section>" };
      blackboard.saveVersion("v1", snapshot);

      const version = blackboard.getVersion("v1");
      assert.strictEqual(version.label, "v1");
      assert.deepStrictEqual(version.snapshot, snapshot);
    });

    it("should list versions", () => {
      blackboard.saveVersion("v1", {});
      blackboard.saveVersion("v2", {});

      const list = blackboard.listVersions();
      assert.strictEqual(list.length, 2);
      assert.strictEqual(list[0].label, "v1");
      assert.strictEqual(list[1].label, "v2");
    });
  });

  describe("buildBlackboardPrompt", () => {
    it("should build prompt with summaries", () => {
      blackboard.setSummary("outline", "10 slides");
      blackboard.setSummary("style", "dark theme");

      const prompt = blackboard.buildBlackboardPrompt();
      assert.ok(prompt.includes("## 设计摘要"));
      assert.ok(prompt.includes("[outline] 10 slides"));
      assert.ok(prompt.includes("[style] dark theme"));
    });

    it("should include pending signals", () => {
      blackboard.pushSignal("style_override", { message: "Change to blue" });

      const prompt = blackboard.buildBlackboardPrompt();
      assert.ok(prompt.includes("## 待处理信号"));
      assert.ok(prompt.includes("[style_override]"));
    });

    it("should include recent decisions", () => {
      blackboard.logDecision("select_theme", "User preference");

      const prompt = blackboard.buildBlackboardPrompt();
      assert.ok(prompt.includes("## 最近决策"));
      assert.ok(prompt.includes("select_theme"));
    });

    it("should return empty string when nothing to show", () => {
      const prompt = blackboard.buildBlackboardPrompt();
      assert.strictEqual(prompt, "");
    });
  });

  describe("Serialization", () => {
    it("should serialize to JSON", () => {
      blackboard.setSummary("test", "value");
      blackboard.pushSignal("sig", { data: 1 });
      blackboard.logDecision("act", "reason");

      const json = blackboard.toJSON();
      assert.strictEqual(json.runId, "test_run");
      assert.deepStrictEqual(json.summaries, { test: "value" });
      assert.strictEqual(json.signals.length, 1);
      assert.strictEqual(json.decisions.length, 1);
    });

    it("should deserialize from JSON", () => {
      const data = {
        runId: "restored_run",
        summaries: { outline: "5 slides" },
        signals: [{ type: "test", payload: {}, timestamp: Date.now() }],
        decisions: [{ action: "test", reason: "test", timestamp: Date.now() }],
      };

      const restored = DesignBlackboard.fromJSON(data);
      assert.strictEqual(restored.runId, "restored_run");
      assert.strictEqual(restored.getSummary("outline"), "5 slides");
      assert.strictEqual(restored.popSignal().type, "test");
    });
  });
});
