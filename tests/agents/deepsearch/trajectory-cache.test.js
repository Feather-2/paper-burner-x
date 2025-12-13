const test = require("node:test");
const assert = require("node:assert/strict");

function createMockModelRouter(handler) {
  const calls = [];
  return {
    calls,
    call: async (messages, opts) => {
      calls.push({ messages, opts });
      return handler(messages, opts);
    },
  };
}

test("TrajectoryCache: hit/miss + key stability + in-flight dedupe", async () => {
  const { TrajectoryCache } = await import("../../../js/agents/stages/deepsearch/trajectory-cache.js");

  const cache = new TrajectoryCache({ maxSize: 10, schemaVersion: 1 });

  const inputs = { taskGoal: "Goal", scanSummarySummaryText: "Summary", existingGaps: [{ type: "data", question: "q", status: "open", missCount: 0 }] };
  const k1 = cache.computeKey("gaps", inputs, { model: "auto", temperature: 0.2 });
  const k2 = cache.computeKey("gaps", inputs, { model: "auto", temperature: 0.2 });
  assert.equal(k1, k2);

  const k3 = cache.computeKey("gaps", inputs, { model: "auto", temperature: 0.3 });
  assert.notEqual(k1, k3);

  let computes = 0;
  const v1 = await cache.getOrCompute(k1, async () => {
    computes++;
    return { ok: true, n: 1 };
  });
  assert.deepEqual(v1, { ok: true, n: 1 });
  assert.equal(computes, 1);

  const v2 = await cache.getOrCompute(k1, async () => {
    computes++;
    return { ok: true, n: 2 };
  });
  assert.deepEqual(v2, { ok: true, n: 1 });
  assert.equal(computes, 1);

  cache.invalidate(k1);
  const v3 = await cache.getOrCompute(k1, async () => {
    computes++;
    return { ok: true, n: 3 };
  });
  assert.deepEqual(v3, { ok: true, n: 3 });
  assert.equal(computes, 2);

  const inflightKey = cache.computeKey("understand", { taskGoal: "G", draftClaims: [], evidenceQuotes: [] }, { model: "auto", temperature: 0.2 });
  let inflightComputes = 0;
  const computeFn = async () => {
    inflightComputes++;
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true };
  };

  const [a, b] = await Promise.all([cache.getOrCompute(inflightKey, computeFn), cache.getOrCompute(inflightKey, computeFn)]);
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });
  assert.equal(inflightComputes, 1);
});

test("TrajectoryManager: shared cache dedupes gaps + understand LLM calls across trajectories", async () => {
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../../js/agents/stages/deepsearch/gaps.js");
  const { runDeepSearchUnderstandStage } = await import("../../../js/agents/stages/deepsearch/understand.js");

  const state = new DeepSearchState({
    runId: "run_traj_cache",
    taskGoal: "Test goal",
    maxIterations: 2,
    userConfig: { gaps: { blockAfterMisses: 1 } },
    L0: { sources: [] },
    L1: { scanSummary: { summaryText: "Scan summary" } },
  });

  const modelRouter = createMockModelRouter(async (messages) => {
    const sys = String(messages?.[0]?.content || "");
    await new Promise((r) => setTimeout(r, 25)); // amplify in-flight overlap
    if (sys.includes("DeepSearch gap planner")) {
      return {
        content:
          "```json\n" +
          JSON.stringify({ gaps: [{ type: "definition", question: "What is X?", priority: "high", queryHints: ["x"] }] }) +
          "\n```",
      };
    }
    if (sys.includes("DeepSearch claim extractor")) {
      return { content: "```json\n" + JSON.stringify({ claims: [] }) + "\n```" };
    }
    return { content: "```json\n{}\n```" };
  });

  const stageApi = { modelRouter, checkCancelled: () => {} };
  const runContext = { runId: "run_traj_cache" };
  const stages = {
    runContext,
    runGapsStage: (rc, input, api) => runDeepSearchGapsStage(rc, input, api),
    runRetrieveStage: async (_rc, input) => {
      const s = input?.state || input;
      s.L2.retrievedChunks = [];
      return { state: s, retrievedChunks: [] };
    },
    runUnderstandStage: (rc, input, api) => runDeepSearchUnderstandStage(rc, input, api),
    emit: null,
  };

  const manager = new TrajectoryManager({ n: 2, mergeStrategy: "best", cachePolicy: "share", cacheMaxSize: 100 });
  const trajectories = manager.fork(state);
  await Promise.all(trajectories.map((t) => manager.runTrajectory(t, stages, stageApi)));

  const calls = modelRouter.calls;
  assert.equal(calls.length, 2);
  assert.ok(calls.some((c) => String(c.messages?.[0]?.content || "").includes("DeepSearch gap planner")));
  assert.ok(calls.some((c) => String(c.messages?.[0]?.content || "").includes("DeepSearch claim extractor")));
});

test("TrajectoryManager: cachePolicy=off does not dedupe LLM calls", async () => {
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../../js/agents/stages/deepsearch/gaps.js");
  const { runDeepSearchUnderstandStage } = await import("../../../js/agents/stages/deepsearch/understand.js");

  const state = new DeepSearchState({
    runId: "run_traj_cache_off",
    taskGoal: "Test goal",
    maxIterations: 2,
    userConfig: { gaps: { blockAfterMisses: 1 } },
    L0: { sources: [] },
    L1: { scanSummary: { summaryText: "Scan summary" } },
  });

  const modelRouter = createMockModelRouter(async (messages) => {
    const sys = String(messages?.[0]?.content || "");
    await new Promise((r) => setTimeout(r, 10));
    if (sys.includes("DeepSearch gap planner")) {
      return { content: "```json\n" + JSON.stringify({ gaps: [] }) + "\n```" };
    }
    if (sys.includes("DeepSearch claim extractor")) {
      return { content: "```json\n" + JSON.stringify({ claims: [] }) + "\n```" };
    }
    return { content: "```json\n{}\n```" };
  });

  const stageApi = { modelRouter, checkCancelled: () => {} };
  const runContext = { runId: "run_traj_cache_off" };
  const stages = {
    runContext,
    runGapsStage: (rc, input, api) => runDeepSearchGapsStage(rc, input, api),
    runRetrieveStage: async (_rc, input) => {
      const s = input?.state || input;
      s.L2.retrievedChunks = [];
      return { state: s, retrievedChunks: [] };
    },
    runUnderstandStage: (rc, input, api) => runDeepSearchUnderstandStage(rc, input, api),
    emit: null,
  };

  const manager = new TrajectoryManager({ n: 2, mergeStrategy: "best", cachePolicy: "off" });
  const trajectories = manager.fork(state);
  await Promise.all(trajectories.map((t) => manager.runTrajectory(t, stages, stageApi)));

  assert.equal(modelRouter.calls.length, 4);
});

