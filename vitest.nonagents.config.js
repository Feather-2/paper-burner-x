import { defineConfig } from 'vitest/config';

// Repo has a mix of `node:test` and `vitest` test files.
// This config scopes Vitest to non-agent Vitest suites so we can run all non-`js/agents`
// tests without picking up `node:test` files (which would fail under Vitest).
export default defineConfig({
  test: {
    include: [
      'tests/api/**/*.test.js',
      'tests/chatbot/**/*.test.js',
      'tests/core/**/*.test.js',
      'tests/history/**/*.test.js',
      'tests/processing/**/*.test.js',
      'tests/ppt/ui-v2/event-bus.test.js',
      'tests/ppt/ui-v2/state-store.test.js',
      'tests/ppt/ui-v2/state-store.events.test.js',
      'tests/ppt/dsl/serialize.test.js',
      'tests/ppt/workflow/workflow-states.test.js',
      'tests/ppt/workflow/unified-state-mapping.vitest.test.js',
      'tests/ppt/core/math-converter.test.js',
      'tests/ppt/core/health-check.test.js',
      'tests/ppt/core/slide-constants.test.js',
      'tests/ppt/storage/checkpoint-manager.test.js',
      'tests/ui/**/*.test.js',
      'tests/storage/**/*.test.js',
      'tests/annotations/**/*.test.js',
      'tests/shared/**/*.test.js',
      'tests/utils/**/*.test.js',
    ],
  },
});
