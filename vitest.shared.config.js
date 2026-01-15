import { defineConfig } from "vitest/config";

// Focused Vitest config for js/agents/shared coverage.
// Keeps this suite independent from the repo's broader mixed node:test/vitest setup.
export default defineConfig({
  test: {
    include: [
      "tests/agents/shared/**/*.vitest.test.js",
      "tests/agents/shared/utils/**/*.test.js",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "js/agents/shared/embeddings/embedding-service.js",
        "js/agents/shared/embeddings/vector-index.js",
        "js/agents/shared/tokenizers/**/*.js",
        "js/agents/shared/contracts/rpc-message.js",
        "js/agents/shared/contracts/llm-response.js",
        "js/agents/shared/archive/archive.js",
        "js/agents/shared/archive/checkpoint-schema.js",
      ],
      statements: 90,
      functions: 90,
      branches: 85,
      lines: 90,
    },
  },
});

