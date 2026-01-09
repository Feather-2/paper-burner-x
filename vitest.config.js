import { defineConfig } from 'vitest/config';

// Repo has a mix of `node:test` and `vitest` test files.
// This config scopes Vitest to the Vitest-based runtime tests so `npx vitest run tests/agents/runtime`
// doesn't attempt to execute `node:test` suites (which would fail under Vitest).
export default defineConfig({
  test: {
    include: [
      'tests/agents/core/**/*.test.js',
      'tests/agents/runtime/analysis.test.js',
      'tests/agents/runtime/compression.test.js',
      'tests/agents/runtime/core.test.js',
      'tests/agents/runtime/di-defaults-smoke.test.js',
      'tests/agents/runtime/di-singletons.test.js',
      'tests/agents/runtime/file-lock.test.js',
      'tests/agents/runtime/injection-scanner.test.js',
      'tests/agents/runtime/memory.test.js',
      'tests/agents/runtime/telemetry.test.js',
      'tests/agents/runtime/adaptive-token-counter.test.js',
      'tests/agents/runtime/token-tracker.test.js',
      'tests/agents/runtime/task-tool-di.test.js',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'js/agents/core/lamport-clock.js',
        'js/agents/runtime/tools/TaskTool.js',
        'js/agents/runtime/di/defaults.js',
        'js/agents/runtime/di/global-container.js',
        'js/agents/sdk/injection-scanner.js',
        'js/agents/runtime/telemetry/token-tracker.js',
        'js/agents/shared/tokenizers/adaptive-token-counter.js',
        'js/agents/vfs/file-lock.js',
      ],
      reporter: ['text'],
      statements: 90,
      functions: 90,
      branches: 85,
      lines: 90,
    },
  },
});
