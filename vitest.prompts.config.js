import { defineConfig } from "vitest/config";

// Focused Vitest config for js/agents/prompts coverage.
// Keeps this suite independent from the repo's broader mixed node:test/vitest setup.
export default defineConfig({
  test: {
    include: ["tests/agents/prompts/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "js/agents/prompts/prompt-template.js",
        "js/agents/prompts/prompt-registry.js",
        "js/agents/prompts/formatters/**/*.js",
      ],
      statements: 90,
      functions: 90,
      branches: 85,
      lines: 90,
    },
  },
});

