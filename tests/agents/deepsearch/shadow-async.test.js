import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ShadowAgent, createShadowSubscriber, waitForShadowValidation } from "../../../js/agents/stages/deepsearch/shadow-agent.js";

describe("ShadowAgent Async Subscriber", () => {
  let mockEventBus;
  let mockStageApi;
  let handlers;

  beforeEach(() => {
    handlers = new Map();
    mockEventBus = {
      subscribe: vi.fn((eventName, handler) => {
        if (!handlers.has(eventName)) handlers.set(eventName, []);
        handlers.get(eventName).push(handler);
        return () => {
          const arr = handlers.get(eventName) || [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        };
      }),
      emit: vi.fn((eventName, payload) => {
        const arr = handlers.get(eventName) || [];
        for (const h of arr) h({ record: payload });
      }),
      once: vi.fn((eventName, handler) => {
        const unsub = mockEventBus.subscribe(eventName, (payload) => {
          unsub();
          handler(payload);
        });
        return unsub;
      }),
    };
    mockStageApi = {
      emit: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createShadowSubscriber", () => {
    test("returns unsubscribe function when disabled", () => {
      const unsub = createShadowSubscriber(mockEventBus, mockStageApi, { enabled: false });
      expect(typeof unsub).toBe("function");
      expect(mockEventBus.subscribe).not.toHaveBeenCalled();
    });

    test("subscribes to UNDERSTAND_COMPLETED when enabled", () => {
      const unsub = createShadowSubscriber(mockEventBus, mockStageApi, { enabled: true });
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        "deepsearch.understand.completed",
        expect.any(Function)
      );
      expect(typeof unsub).toBe("function");
    });

    test("handles invalid eventBus gracefully", () => {
      const unsub = createShadowSubscriber(null, mockStageApi, { enabled: true });
      expect(typeof unsub).toBe("function");
    });

    test("triggers validation on UNDERSTAND_COMPLETED event", async () => {
      const onValidated = vi.fn();
      const state = {
        L1: {
          claims: [{ claimId: "c_1", text: "Test claim", evidenceIds: ["e_1"] }],
          evidenceLedger: [{ evidenceId: "e_1", quote: "Test quote" }],
        },
      };

      createShadowSubscriber(mockEventBus, mockStageApi, {
        enabled: true,
        state,
        onValidated,
      });

      // 模拟事件触发
      mockEventBus.emit("deepsearch.understand.completed", {
        gapId: "gap_1",
        iteration: 1,
        claims: state.L1.claims,
        evidenceLedger: state.L1.evidenceLedger,
      });

      // 等待异步处理完成
      await new Promise(resolve => setTimeout(resolve, 100));

      // 验证 SHADOW_COMPLETED 事件被发送
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "deepsearch.shadow.completed",
        expect.objectContaining({
          gapId: "gap_1",
          iteration: 1,
        })
      );
    });

    test("skips validation when no claims", async () => {
      const onValidated = vi.fn();
      createShadowSubscriber(mockEventBus, mockStageApi, {
        enabled: true,
        onValidated,
      });

      mockEventBus.emit("deepsearch.understand.completed", {
        claims: [],
        evidenceLedger: [],
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(onValidated).not.toHaveBeenCalled();
    });

    test("unsubscribe function removes listener", () => {
      const unsub = createShadowSubscriber(mockEventBus, mockStageApi, { enabled: true });
      expect(handlers.get("deepsearch.understand.completed")?.length).toBe(1);

      unsub();
      expect(handlers.get("deepsearch.understand.completed")?.length).toBe(0);
    });
  });

  describe("ShadowAgent.validateBatch", () => {
    test("validates claims against evidence", async () => {
      const agent = new ShadowAgent(mockStageApi, {}, {});
      // Mock validateEvidence to return a simple result
      agent.validateEvidence = vi.fn().mockResolvedValue({
        supports: true,
        strength: "moderate",
        confidence: 0.8,
      });

      const claims = [
        { claimId: "c_1", text: "Claim 1", evidenceIds: ["e_1"] },
      ];
      const evidenceLedger = [
        { evidenceId: "e_1", quote: "Evidence 1" },
      ];

      const results = await agent.validateBatch(claims, evidenceLedger, { gapId: "gap_1" });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        claimId: "c_1",
        evidenceId: "e_1",
        valid: true,
      });
    });

    test("handles empty claims array", async () => {
      const agent = new ShadowAgent(mockStageApi, {}, {});
      const results = await agent.validateBatch([], [], {});
      expect(results).toEqual([]);
    });

    test("respects maxCallsPerRound limit", async () => {
      const agent = new ShadowAgent(mockStageApi, {}, { maxCallsPerRound: 2 });
      agent.validateEvidence = vi.fn().mockResolvedValue({ supports: true });

      const claims = [
        { claimId: "c_1", evidenceIds: ["e_1"] },
        { claimId: "c_2", evidenceIds: ["e_2"] },
        { claimId: "c_3", evidenceIds: ["e_3"] }, // should be skipped
      ];
      const evidence = [
        { evidenceId: "e_1" },
        { evidenceId: "e_2" },
        { evidenceId: "e_3" },
      ];

      await agent.validateBatch(claims, evidence, {});
      expect(agent.validateEvidence).toHaveBeenCalledTimes(2);
    });

    test("catches validation errors gracefully", async () => {
      const agent = new ShadowAgent(mockStageApi, {}, {});
      agent.validateEvidence = vi.fn().mockRejectedValue(new Error("Test error"));

      const claims = [{ claimId: "c_1", evidenceIds: ["e_1"] }];
      const evidence = [{ evidenceId: "e_1" }];

      const results = await agent.validateBatch(claims, evidence, {});
      expect(results[0]).toMatchObject({
        claimId: "c_1",
        evidenceId: "e_1",
        valid: false,
        skipped: true,
        reason: "Test error",
      });
    });
  });

  describe("waitForShadowValidation", () => {
    test("resolves with results when event received", async () => {
      const resultPromise = waitForShadowValidation(mockEventBus, "gap_1", 5000);

      // 模拟事件发送
      setTimeout(() => {
        mockEventBus.emit("deepsearch.shadow.completed", {
          gapId: "gap_1",
          results: [{ valid: true }],
        });
      }, 10);

      const results = await resultPromise;
      expect(results).toEqual([{ valid: true }]);
    });

    test("resolves with null on timeout", async () => {
      const results = await waitForShadowValidation(mockEventBus, "gap_1", 50);
      expect(results).toBeNull();
    });

    test("handles invalid eventBus", async () => {
      const results = await waitForShadowValidation(null, "gap_1", 50);
      expect(results).toBeNull();
    });
  });

  describe("Integration: main flow not blocked", () => {
    test("UNDERSTAND_COMPLETED triggers async validation without blocking", async () => {
      const validationStarted = vi.fn();
      const validationCompleted = vi.fn();

      const state = {
        L1: {
          claims: [{ claimId: "c_1", evidenceIds: ["e_1"] }],
          evidenceLedger: [{ evidenceId: "e_1" }],
        },
      };

      createShadowSubscriber(mockEventBus, mockStageApi, {
        enabled: true,
        state,
        onValidated: validationCompleted,
      });

      // 模拟主流程发送事件
      validationStarted();
      mockEventBus.emit("deepsearch.understand.completed", {
        gapId: "gap_1",
        claims: state.L1.claims,
        evidenceLedger: state.L1.evidenceLedger,
      });

      // 主流程可以立即继续，不等待 Shadow
      expect(validationStarted).toHaveBeenCalled();

      // Shadow 异步完成后会触发回调
      await new Promise(resolve => setTimeout(resolve, 100));
      // 验证完成事件被发送
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "deepsearch.shadow.completed",
        expect.any(Object)
      );
    });
  });
});
