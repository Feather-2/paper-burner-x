import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

// Workaround: @vitest/coverage-v8 may assume `coverage/.tmp` exists.
// Create it unconditionally (best-effort) to avoid racey ENOENT failures.
try {
  fs.mkdirSync(path.join(process.cwd(), 'coverage', '.tmp'), { recursive: true });
} catch {
  // Best-effort: tests can still run without coverage output.
}

// Repo has been fully migrated to vitest for tests/agents.
// All tests under tests/agents now use vitest syntax.
export default defineConfig({
  test: {
    testTimeout: 30000,
    include: [
      'tests/app/**/*.test.js',
      'tests/api/**/*.test.js',
      'tests/chatbot/**/*.test.js',
      'tests/core/**/*.test.js',
      'tests/history/**/*.test.js',
      'tests/processing/**/*.test.js',
      // All agents tests are now vitest
      'tests/agents/**/*.test.js',
      // All ppt tests are now vitest
      'tests/ppt/**/*.test.js',
      'tests/ui/**/*.test.js',
      'tests/storage/**/*.test.js',
      'tests/annotations/**/*.test.js',
      'tests/shared/**/*.test.js',
      'tests/utils/**/*.test.js',
    ],
    coverage: {
      provider: 'v8',
      // Workaround: with v8 coverage + parallel workers, `clean: true` can race and remove
      // the temporary coverage directory while other workers are still writing.
      clean: false,
      include: [
        'js/agents/retrieval/bm25.js',
        'js/agents/retrieval/vector-search.js',
        'js/agents/retrieval/hybrid-retrieval.js',
        'js/agents/retrieval/mmr.js',
        'js/agents/core/lamport-clock.js',
        'js/agents/runtime/tools/TaskTool.js',
        'js/agents/runtime/di/defaults.js',
        'js/agents/runtime/di/global-container.js',
        'js/agents/runtime/memory/memory-store.js',
        'js/agents/runtime/memory/memory-store.impl.js',
        'js/agents/runtime/hooks/hook-registry.js',
        'js/agents/runtime/compression/coordinator.js',
        'js/agents/runtime/compression/cicada-compressor.js',
        'js/agents/runtime/core/tool-registry.js',
        'js/agents/runtime/core/message-manager.js',
        'js/agents/runtime/core/status-controller.js',
        'js/agents/plugins/compression/watchdog.js',
        'js/agents/sdk/AgentBuilder.js',
        'js/agents/sdk/agent-factory.js',
        'js/agents/sdk/injection-scanner.js',
        'js/agents/runtime/telemetry/token-tracker.js',
        'js/agents/shared/tokenizers/adaptive-token-counter.js',
        'js/agents/shared/utils/circuit-breaker.js',
        'js/agents/shared/utils/cancellation.js',
        'js/agents/shared/utils/deque.js',
        'js/agents/shared/utils/lru-cache.js',
        'js/agents/shared/utils/schema-validator.js',
        'js/agents/vfs/path.js',
        'js/agents/vfs/glob.js',
        'js/agents/vfs/vfs.memory.js',
        'js/agents/vfs/file-lock.js',
        'js/agents/vfs/operations.js',
        'js/agents/vfs/checkpoints.js',
        'js/agents/vfs/delta-sync.js',
        'js/agents/ingest/adapters/pdf.js',
        'js/agents/ingest/adapters/docx.js',
        'js/agents/ingest/adapters/html.js',
        'js/agents/ingest/adapters/markdown.js',
        'js/agents/ingest/adapters/pptx.js',
        'js/agents/mcp/mcp-client.js',
        'js/agents/mcp/mcp-nexus-provider.js',
        'js/agents/mcp/sse.js',
        'js/agents/shared/contracts/tool-result.js',
        // LLM module (Vitest-based unit tests live under tests/agents/llm/*.vitest.test.js)
        'js/agents/llm/constants.js',
        'js/agents/llm/provider.js',
        'js/agents/llm/model-events.js',
        'js/agents/llm/model-router.js',
        'js/agents/llm/rate-limit.js',
        'js/agents/llm/overflow-recovery.js',
        'js/agents/llm/mock-provider.js',
        'js/agents/llm/image-provider.js',
        'js/agents/llm/whisper-provider.js',
        'js/agents/stages/codesearch/codesearch-stage.js',
        'js/agents/stages/codesearch/indexing/index-store.js',
        'js/agents/stages/codesearch/indexing/symbol-indexer.js',
        'js/agents/stages/codesearch/phases/planning-phase.js',
        'js/agents/stages/codesearch/phases/execution-phase.js',
        'js/agents/stages/codesearch/phases/summarizing-phase.js',
        'js/agents/storage/run-store.js',
        'js/agents/storage/run-exporter.js',
        'js/agents/storage/artifact-manager.js',
        'js/agents/skills/loader.js',
        'js/agents/skills/loader.node.js',
        'js/agents/skills/user-store.js',
        'js/agents/core/sandbox/skill-executor.js',
        // DeepSearch stage core files
        'js/agents/stages/deepsearch/deepsearch-agent-loop.js',
        'js/agents/stages/deepsearch/todos.js',
        'js/agents/stages/deepsearch/tools/index.js',
        // Design stage core files (unit-tested via Vitest)
        'js/agents/stages/design/agent-loop.js',
        'js/agents/stages/design/dsl/dsl-builder.js',
        'js/agents/stages/design/generators/design-tokens.js',
        'js/agents/stages/design/generators/layout-generator.js',
        'js/agents/stages/design/runtime/deck-planner.js',
        'js/agents/stages/design/edit-mode/edit-loop.js',
        'js/agents/stages/design/edit-mode/tools.js',
        'js/agents/stages/design/edit-mode/history.js',
      ],
      reporter: ['text'],
      statements: 90,
      functions: 90,
      branches: 85,
      lines: 90,
    },
  },
});
