import { describe, it, expect } from "vitest";

import * as phases from "../../../../js/agents/stages/codesearch/phases/index.js";

describe("codesearch/phases/index exports", () => {
  it("re-exports phase entrypoints", () => {
    expect(typeof phases.runPlanningPhase).toBe("function");
    expect(typeof phases.buildSystemPrompt).toBe("function");
    expect(typeof phases.formatOpenTodos).toBe("function");
    expect(typeof phases.isTodoOpen).toBe("function");
    expect(typeof phases.runExecutionStep).toBe("function");
    expect(typeof phases.runSummarizingPhase).toBe("function");
    expect(typeof phases.buildTodoCompletionStats).toBe("function");
  });
});

