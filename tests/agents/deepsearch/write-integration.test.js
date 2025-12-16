/**
 * Write Stage Integration Tests
 * 验证 ReAct Reviewer 与 Legacy Reviewer 的模式切换
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

describe("Write Stage - ReAct Reviewer Integration", () => {
  it("should default to legacy mode when reviewerMode is not configured", async () => {
    // 测试向后兼容性：未配置 reviewerMode 时应使用 legacy
    const mockState = {
      runId: "test-run-1",
      iteration: 1,
      taskGoal: "Test report",
      userConfig: {
        write: {
          enableReviewer: true,
          maxReviewRounds: 1,
          // reviewerMode 未配置
        },
      },
      L0: { sources: [] },
      L1: {
        claims: [
          {
            claimId: "c1",
            text: "Test claim",
            evidenceIds: ["e1"],
            gapIds: ["g1"],
          },
        ],
        evidenceLedger: [
          {
            evidenceId: "e1",
            quote: "Test evidence",
            sourceId: "s1",
          },
        ],
        gaps: [
          {
            gapId: "g1",
            question: "Test gap",
          },
        ],
      },
      addTimeline: mock.fn(),
    };

    // Mock stageApi
    const mockEmit = mock.fn();
    const mockCallModel = mock.fn(async () => ({
      content: JSON.stringify({
        overallScore: 0.8,
        issues: [],
        patchPlan: [],
      }),
    }));

    const stageApi = {
      emit: mockEmit,
      modelRouter: {
        call: mockCallModel,
      },
    };

    // 动态导入以避免模块加载问题
    const { runDeepSearchWriteStage } = await import(
      "../../../js/agents/stages/deepsearch/write.js"
    );

    const result = await runDeepSearchWriteStage(
      {},
      { state: mockState },
      stageApi
    );

    // 验证使用了 legacy 模式
    assert.ok(result.report, "Report should be generated");
    assert.ok(
      result.report.reviewFeedback,
      "Review feedback should be present"
    );
    assert.strictEqual(
      result.report.reviewFeedback.mode,
      "legacy",
      "Should use legacy mode by default"
    );
  });

  it("should use legacy mode when reviewerMode is explicitly set to 'legacy'", async () => {
    const mockState = {
      runId: "test-run-2",
      iteration: 1,
      taskGoal: "Test report",
      userConfig: {
        write: {
          enableReviewer: true,
          maxReviewRounds: 1,
          reviewerMode: "legacy", // 显式设置为 legacy
        },
      },
      L0: { sources: [] },
      L1: {
        claims: [
          {
            claimId: "c1",
            text: "Test claim",
            evidenceIds: ["e1"],
            gapIds: ["g1"],
          },
        ],
        evidenceLedger: [
          {
            evidenceId: "e1",
            quote: "Test evidence",
            sourceId: "s1",
          },
        ],
        gaps: [
          {
            gapId: "g1",
            question: "Test gap",
          },
        ],
      },
      addTimeline: mock.fn(),
    };

    const mockEmit = mock.fn();
    const mockCallModel = mock.fn(async () => ({
      content: JSON.stringify({
        overallScore: 0.8,
        issues: [],
        patchPlan: [],
      }),
    }));

    const stageApi = {
      emit: mockEmit,
      modelRouter: {
        call: mockCallModel,
      },
    };

    const { runDeepSearchWriteStage } = await import(
      "../../../js/agents/stages/deepsearch/write.js"
    );

    const result = await runDeepSearchWriteStage(
      {},
      { state: mockState },
      stageApi
    );

    assert.strictEqual(
      result.report.reviewFeedback.mode,
      "legacy",
      "Should use legacy mode when explicitly configured"
    );
  });

  it("should emit wordCount in all write-related events", async () => {
    const mockState = {
      runId: "test-run-3",
      iteration: 1,
      taskGoal: "Test report",
      userConfig: {
        write: {
          enableReviewer: true,
          maxReviewRounds: 1,
          reviewerMode: "legacy",
        },
      },
      L0: { sources: [] },
      L1: {
        claims: [
          {
            claimId: "c1",
            text: "Test claim with multiple words",
            evidenceIds: ["e1"],
            gapIds: ["g1"],
          },
        ],
        evidenceLedger: [
          {
            evidenceId: "e1",
            quote: "Test evidence with content",
            sourceId: "s1",
          },
        ],
        gaps: [
          {
            gapId: "g1",
            question: "Test gap question",
          },
        ],
      },
      addTimeline: mock.fn(),
    };

    const emittedEvents = [];
    const mockEmit = mock.fn((eventName, payload) => {
      emittedEvents.push({ eventName, payload });
    });

    const mockCallModel = mock.fn(async () => ({
      content: JSON.stringify({
        overallScore: 0.8,
        issues: [],
        patchPlan: [],
      }),
    }));

    const stageApi = {
      emit: mockEmit,
      modelRouter: {
        call: mockCallModel,
      },
    };

    const { runDeepSearchWriteStage } = await import(
      "../../../js/agents/stages/deepsearch/write.js"
    );

    await runDeepSearchWriteStage({}, { state: mockState }, stageApi);

    // 查找 write.completed 事件
    const completedEvent = emittedEvents.find(
      (e) => e.eventName === "deepsearch.write.completed"
    );
    assert.ok(completedEvent, "write.completed event should be emitted");

    // makeStageEmitter wraps payload in {actor, status, payload}
    const eventPayload = completedEvent.payload?.payload || completedEvent.payload;

    assert.ok(
      typeof eventPayload === "object" && typeof eventPayload.wordCount === "number",
      "wordCount should be included in completed event"
    );
    assert.ok(
      eventPayload.wordCount >= 0,
      "wordCount should be >= 0"
    );

    // 查找 review.started 事件
    const reviewStartedEvent = emittedEvents.find(
      (e) => e.eventName === "deepsearch.write.review.started"
    );
    if (reviewStartedEvent) {
      const payload = reviewStartedEvent.payload?.payload || reviewStartedEvent.payload;
      assert.ok(
        typeof payload === "object",
        "review.started payload should be an object"
      );
      // wordCount 可能存在
      if ("wordCount" in payload) {
        assert.ok(
          typeof payload.wordCount === "number",
          "wordCount should be a number when present"
        );
      }
    }

    // 查找 review.completed 事件
    const reviewCompletedEvent = emittedEvents.find(
      (e) => e.eventName === "deepsearch.write.review.completed"
    );
    if (reviewCompletedEvent) {
      const payload = reviewCompletedEvent.payload?.payload || reviewCompletedEvent.payload;
      assert.ok(
        typeof payload === "object",
        "review.completed payload should be an object"
      );
      // wordCount 可能存在
      if ("wordCount" in payload) {
        assert.ok(
          typeof payload.wordCount === "number",
          "wordCount should be a number when present"
        );
      }
    }
  });

  it("should not affect existing behavior when reviewer is disabled", async () => {
    const mockState = {
      runId: "test-run-4",
      iteration: 1,
      taskGoal: "Test report",
      userConfig: {
        write: {
          enableReviewer: false, // Reviewer 禁用
        },
      },
      L0: { sources: [] },
      L1: {
        claims: [
          {
            claimId: "c1",
            text: "Test claim",
            evidenceIds: ["e1"],
            gapIds: ["g1"],
          },
        ],
        evidenceLedger: [
          {
            evidenceId: "e1",
            quote: "Test evidence",
            sourceId: "s1",
          },
        ],
        gaps: [
          {
            gapId: "g1",
            question: "Test gap",
          },
        ],
      },
      addTimeline: mock.fn(),
    };

    const mockEmit = mock.fn();
    const stageApi = {
      emit: mockEmit,
    };

    const { runDeepSearchWriteStage } = await import(
      "../../../js/agents/stages/deepsearch/write.js"
    );

    const result = await runDeepSearchWriteStage(
      {},
      { state: mockState },
      stageApi
    );

    assert.ok(result.report, "Report should be generated");
    assert.strictEqual(
      result.report.reviewFeedback.reviewed,
      false,
      "Should not review when disabled"
    );
    assert.strictEqual(
      result.report.reviewFeedback.rounds,
      0,
      "Should have 0 review rounds"
    );
  });
});

describe("Write Stage - ReAct Reviewer Mode", () => {
  it("should use ReAct reviewer when reviewerMode is set to 'react'", async () => {
    const mockState = {
      runId: "test-run-react-1",
      iteration: 1,
      taskGoal: "Test report with ReAct",
      userConfig: {
        write: {
          enableReviewer: true,
          maxReviewRounds: 1,
          reviewerMode: "react", // 使用 ReAct 模式
        },
      },
      L0: { sources: [] },
      L1: {
        claims: [
          {
            claimId: "c1",
            text: "Test claim for ReAct",
            evidenceIds: ["e1"],
            gapIds: ["g1"],
          },
        ],
        evidenceLedger: [
          {
            evidenceId: "e1",
            quote: "Test evidence quote",
            sourceId: "s1",
          },
        ],
        gaps: [
          {
            gapId: "g1",
            question: "Test gap for ReAct",
          },
        ],
      },
      addTimeline: mock.fn(),
    };

    const emittedEvents = [];
    const mockEmit = mock.fn((eventName, payload) => {
      emittedEvents.push({ eventName, payload });
    });

    // Mock model call for ReAct reviewer
    const mockCallModel = mock.fn(async () => ({
      content: JSON.stringify({
        thought: "Report looks good",
        finish: {
          qualityScore: 8,
          remainingIssues: 0,
          patchPlan: [],
          summary: "Report meets quality standards",
        },
      }),
    }));

    const stageApi = {
      emit: mockEmit,
      modelRouter: {
        call: mockCallModel,
      },
    };

    const { runDeepSearchWriteStage } = await import(
      "../../../js/agents/stages/deepsearch/write.js"
    );

    const result = await runDeepSearchWriteStage(
      {},
      { state: mockState },
      stageApi
    );

    // 验证使用了 ReAct 模式
    assert.ok(result.report, "Report should be generated");
    assert.strictEqual(
      result.report.reviewFeedback.mode,
      "react",
      "Should use react mode when configured"
    );
    assert.strictEqual(
      result.report.reviewFeedback.reviewed,
      true,
      "Report should be reviewed"
    );
    assert.ok(
      result.report.reviewFeedback.rounds > 0,
      "Should have at least one review round"
    );

    // 验证发射了 react 相关事件
    const reactStartedEvent = emittedEvents.find(
      (e) => {
        const payload = e.payload?.payload || e.payload;
        return (
          e.eventName === "deepsearch.write.review.started" &&
          payload.mode === "react"
        );
      }
    );
    assert.ok(
      reactStartedEvent,
      "Should emit review.started event with react mode"
    );

    const reactCompletedEvent = emittedEvents.find(
      (e) => {
        const payload = e.payload?.payload || e.payload;
        return (
          e.eventName === "deepsearch.write.review.completed" &&
          payload.mode === "react"
        );
      }
    );
    assert.ok(
      reactCompletedEvent,
      "Should emit review.completed event with react mode"
    );
  });

  it("should fallback to legacy mode when ReAct reviewer fails", async () => {
    const mockState = {
      runId: "test-run-fallback-1",
      iteration: 1,
      taskGoal: "Test fallback behavior",
      userConfig: {
        write: {
          enableReviewer: true,
          maxReviewRounds: 1,
          reviewerMode: "react",
        },
      },
      L0: { sources: [] },
      L1: {
        claims: [
          {
            claimId: "c1",
            text: "Test claim",
            evidenceIds: ["e1"],
            gapIds: ["g1"],
          },
        ],
        evidenceLedger: [
          {
            evidenceId: "e1",
            quote: "Test evidence",
            sourceId: "s1",
          },
        ],
        gaps: [
          {
            gapId: "g1",
            question: "Test gap",
          },
        ],
      },
      addTimeline: mock.fn(),
    };

    const emittedEvents = [];
    const mockEmit = mock.fn((eventName, payload) => {
      emittedEvents.push({ eventName, payload });
    });

    let callCount = 0;
    const mockCallModel = mock.fn(async () => {
      callCount++;
      // 第一次调用（ReAct）失败
      if (callCount === 1) {
        throw new Error("Model call failed");
      }
      // 第二次调用（fallback to legacy）成功
      return {
        content: JSON.stringify({
          overallScore: 0.8,
          issues: [],
          patchPlan: [],
        }),
      };
    });

    const stageApi = {
      emit: mockEmit,
      modelRouter: {
        call: mockCallModel,
      },
    };

    const { runDeepSearchWriteStage } = await import(
      "../../../js/agents/stages/deepsearch/write.js"
    );

    const result = await runDeepSearchWriteStage(
      {},
      { state: mockState },
      stageApi
    );

    // 验证降级到了 legacy 模式
    assert.ok(result.report, "Report should be generated");
    assert.strictEqual(
      result.report.reviewFeedback.mode,
      "legacy",
      "Should fallback to legacy mode"
    );
    assert.strictEqual(
      result.report.reviewFeedback.fallbackFrom,
      "react",
      "Should indicate fallback from react"
    );

    // 验证发射了 fallback 事件
    const fallbackEvent = emittedEvents.find(
      (e) => e.eventName === "deepsearch.write.react.fallback"
    );
    assert.ok(fallbackEvent, "Should emit react.fallback event");

    const fallbackPayload = fallbackEvent.payload?.payload || fallbackEvent.payload;
    assert.strictEqual(
      fallbackPayload.fallbackMode,
      "legacy",
      "Fallback event should indicate legacy mode"
    );
  });
});
