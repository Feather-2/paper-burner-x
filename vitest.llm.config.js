import { defineConfig } from "vitest/config";

// Focused Vitest config for js/agents/llm coverage.
// This avoids pulling in the repo's wider mixed suite when the goal is LLM-only coverage.
export default defineConfig({
  test: {
    include: ["tests/agents/llm/**/*.vitest.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "js/agents/llm/constants.js",
        "js/agents/llm/provider.js",
        "js/agents/llm/model-events.js",
        "js/agents/llm/model-router.js",
        "js/agents/llm/rate-limit.js",
        "js/agents/llm/overflow-recovery.js",
        "js/agents/llm/mock-provider.js",
        "js/agents/llm/image-provider.js",
        "js/agents/llm/whisper-provider.js",
      ],
      statements: 90,
      functions: 90,
      branches: 85,
      lines: 90,
    },
  },
});

