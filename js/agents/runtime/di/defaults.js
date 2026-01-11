/**
 * Default Service Registrations
 *
 * Provides factory functions for core agent services.
 */

import { Container, SINGLETON, TRANSIENT } from "./container.js";
import { LamportClockService } from "../../core/lamport-clock.js";
import { CircuitBreakerRegistry } from "../../shared/utils/circuit-breaker.js";
import { createAdaptiveTokenCounter } from "../../shared/tokenizers/adaptive-token-counter.js";
import { InjectionScanner } from "../../sdk/injection-scanner.js";
import { FileLock } from "../../vfs/file-lock.js";
import { createDefaultErrorBoundary } from "../core/error-boundary.js";
import { TokenTracker } from "../telemetry/token-tracker.js";
import { TraceContext } from "../telemetry/trace-context.js";
import { enhanceEventBusWithHooks } from "../hooks/event-bus-hooks.js";

/** @type {any} */
const process = /** @type {any} */ (globalThis).process;

/**
 * Service IDs used across the agent system.
 */
export const ServiceId = {
  LOGGER: "logger",
  EVENT_BUS: "eventBus",
  LAMPORT_CLOCK: "lamportClock",
  TRACE_CONTEXT: "traceContext",
  RETRY_STRATEGY: "retryStrategy",
  ERROR_BOUNDARY: "errorBoundary",
  INJECTION_SCANNER: "injectionScanner",
  TOKEN_TRACKER: "tokenTracker",
  TOKEN_COUNTER: "tokenCounter",
  DEGRADATION_MATRIX: "degradationMatrix",
  TOOL_QUOTA_MANAGER: "toolQuotaManager",
  MEMORY_STORE: "memoryStore",
  STATE_ENGINE: "stateEngine",
  MODEL_ROUTER: "modelRouter",
  MCP_CLIENT: "mcpClient",
  RETRIEVAL_ROUTER: "retrievalRouter",
  BUDGET_MANAGER: "budgetManager",
  SUBAGENT_REGISTRY: "subagentRegistry",
  CHECKPOINT_MANAGER: "checkpointManager",
  CIRCUIT_BREAKER_REGISTRY: "circuitBreakerRegistry",
  WATCHDOG: "watchdog",
  WORKER_POOL: "workerPool",
  KERNEL: "kernel",
  MESSAGE_BUS: "messageBus",
  // P6.4: Runtime Adapters
  JS_ADAPTER: "jsAdapter",
  PYTHON_ADAPTER: "pythonAdapter",
  PYTHON_SKILL_EXECUTOR: "pythonSkillExecutor",
  RUNTIME_SCHEDULER: "runtimeScheduler",
  // P6.5: Shared Utils
  HNSW_INDEX: "hnswIndex",
  SCHEMA_VALIDATOR: "schemaValidator",
  // P6.6: VFS
  DELTA_SYNC: "deltaSync",
  FILE_LOCK: "fileLock",
  // P6.7: Retrieval
  TOC_BUILDER: "tocBuilder",
  // P7: Advanced Features
  POLICY_ENGINE: "policyEngine",
  POLICY_MANAGER: "policyManager",
  REPLAY_CONTROLLER: "replayController",
  VFS_PROXY: "vfsProxy",
  SHARED_MEMORY_BRIDGE: "sharedMemoryBridge",
};

/**
 * Create a container with default agent service registrations.
 *
 * All services are lazily instantiated on first access.
 *
 * @param {Object} [overrides] - Override specific services
 * @returns {Container}
 */
export function createAgentContainer(overrides = {}) {
  const container = new Container();

  // Logger (no dependencies)
  container.register(ServiceId.LOGGER, () => {
    return console; // Default to console, can be overridden
  });

  // LamportClock (no dependencies)
  container.register(ServiceId.LAMPORT_CLOCK, () => new LamportClockService(), { scope: SINGLETON });

  // EventBus (no dependencies)
  container.register(ServiceId.EVENT_BUS, async (c) => {
    const { EventBus } = await import("../../core/event-bus.js");
    const eventBus = new EventBus();
    enhanceEventBusWithHooks(eventBus);
    // P4.6: 默认启用背压，避免高频事件堆积（浏览器和 Node.js 均生效）
    if (typeof eventBus.enableBackpressure === "function") {
      try {
        eventBus.enableBackpressure({
          coalescePattern: /\.progress$/,
          deferNonCoalesced: false,
          maxQueueSize: 10000,
        });
      } catch {
        // ignore
      }
    }
    return eventBus;
  });

  // TraceContext (no dependencies)
  // Use SINGLETON so stages created from the same container share a trace by default.
  container.register(
    ServiceId.TRACE_CONTEXT,
    () => new TraceContext(),
    { scope: SINGLETON }
  );

  // RetryStrategy (no dependencies)
  // Singleton so global retry budgets apply across services.
  container.register(
    ServiceId.RETRY_STRATEGY,
    async () => {
      const { RetryStrategy } = await import("../core/retry-strategy.js");
      return new RetryStrategy();
    },
    { scope: SINGLETON }
  );

  // ErrorBoundary (no dependencies)
  container.register(ServiceId.ERROR_BOUNDARY, () => createDefaultErrorBoundary(), { scope: SINGLETON });

  // InjectionScanner (no dependencies)
  container.register(ServiceId.INJECTION_SCANNER, () => new InjectionScanner(), { scope: SINGLETON });

  // TokenTracker (no dependencies)
  container.register(ServiceId.TOKEN_TRACKER, () => new TokenTracker(), { scope: SINGLETON });

  // TokenCounter (adaptive-token-counter, no dependencies)
  container.register(ServiceId.TOKEN_COUNTER, () => createAdaptiveTokenCounter(), { scope: SINGLETON });

  // DegradationMatrix (depends on logger)
  // Singleton so system-level metrics apply across services/stages.
  container.register(
    ServiceId.DEGRADATION_MATRIX,
    async (c) => {
      const { DegradationMatrix } = await import("../resilience/degradation-matrix.js");
      const logger = c.get(ServiceId.LOGGER);

      const getMemoryUsage = () => {
        // Ratio in [0, 1] best-effort, cross runtime.
        try {
          if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
            const mem = process.memoryUsage();
            const used = typeof mem.heapUsed === "number" ? mem.heapUsed : mem.rss;
            const total = typeof mem.heapTotal === "number" ? mem.heapTotal : mem.rss;
            if (typeof used === "number" && typeof total === "number" && total > 0) return used / total;
          }
        } catch {
          // ignore
        }

        try {
          const perfMem = /** @type {any} */ (globalThis?.performance)?.memory;
          if (
            perfMem &&
            typeof perfMem.usedJSHeapSize === "number" &&
            typeof perfMem.jsHeapSizeLimit === "number" &&
            perfMem.jsHeapSizeLimit > 0
          ) {
            return perfMem.usedJSHeapSize / perfMem.jsHeapSizeLimit;
          }
        } catch {
          // ignore
        }

        return 0;
      };

      return new DegradationMatrix({
        getMemoryUsage,
        onLevelChange: (info) => {
          logger?.warn?.("[DegradationMatrix] Operation level changed", info);
        },
      });
    },
    { scope: SINGLETON }
  );

  // ToolQuotaManager (no dependencies)
  container.register(
    ServiceId.TOOL_QUOTA_MANAGER,
    async () => {
      const { ToolQuotaManager } = await import("../tools/tool-quotas.js");
      return new ToolQuotaManager({
        defaultMaxCalls: 100,
        defaultWindowMs: 60_000,
        quotas: {
          // Common high-frequency tools (warn/block configured at call site).
          search: { maxCalls: 10, windowMs: 60_000 },
          "search-docs": { maxCalls: 10, windowMs: 60_000 },
          "search.query": { maxCalls: 10, windowMs: 60_000 },
          "search.fetch": { maxCalls: 30, windowMs: 60_000 },
        },
      });
    },
    { scope: SINGLETON }
  );

  // MemoryStore (depends on eventBus)
  container.register(ServiceId.MEMORY_STORE, async (c) => {
    const { MemoryStore } = await import("../memory/memory-store.js");
    const eventBus = await c.get(ServiceId.EVENT_BUS);
    return new MemoryStore({ eventBus });
  });

  // StateEngine (depends on eventBus)
  container.register(ServiceId.STATE_ENGINE, async (c) => {
    const { StateEngine } = await import("../memory/state-engine.js");
    const eventBus = await c.get(ServiceId.EVENT_BUS);
    return new StateEngine({ eventBus });
  });

  // ModelRouter (depends on logger)
  container.register(ServiceId.MODEL_ROUTER, async (c) => {
    const { ModelRouter } = await import("../../llm/model-router.js");
    const logger = c.get(ServiceId.LOGGER);
    const retryStrategy = await c.get(ServiceId.RETRY_STRATEGY);
    return new ModelRouter({ logger, retryStrategy });
  });

  // McpClient (no dependencies)
  container.register(ServiceId.MCP_CLIENT, async () => {
    const { McpClient } = await import("../../mcp/mcp-client.js");
    return new McpClient();
  });

  // RetrievalRouter (no dependencies)
  container.register(ServiceId.RETRIEVAL_ROUTER, async () => {
    const { RetrievalRouter } = await import("../../retrieval/retrieval-router.js");
    return new RetrievalRouter();
  });

  // BudgetManager (no dependencies)
  container.register(ServiceId.BUDGET_MANAGER, async () => {
    const { createBudgetManager } = await import("../../shared/utils/budget.js");
    return createBudgetManager();
  });

  // SubagentRegistry (no dependencies)
  // Registered via DI to avoid runtime/tools importing from sdk directly.
  container.register(
    ServiceId.SUBAGENT_REGISTRY,
    async () => {
      const { globalSubagentRegistry } = await import("../../sdk/SubagentRegistry.js");
      return globalSubagentRegistry;
    },
    { scope: SINGLETON }
  );

  // CircuitBreakerRegistry (no dependencies)
  container.register(ServiceId.CIRCUIT_BREAKER_REGISTRY, () => {
    return new CircuitBreakerRegistry();
  });

  // Watchdog (depends on eventBus)
  // Use TRANSIENT so each stage/run can get an isolated instance.
  container.register(
    ServiceId.WATCHDOG,
    async (c) => {
      const { Watchdog } = await import("../compression/watchdog.js");
      const eventBus = await c.get(ServiceId.EVENT_BUS);
      return new Watchdog({ eventBus });
    },
    { scope: TRANSIENT }
  );

  // WorkerPool - 注意需要传入 createWorker 函数，这里只提供工厂
  // 实际使用时需要 override 或调用方提供 createWorker
  container.register(
    ServiceId.WORKER_POOL,
    async () => {
      const { WorkerPool } = await import("../core/worker-pool.js");
      // 返回 WorkerPool 类而非实例，因为需要 createWorker
      return { WorkerPool, isWorkerSupported: typeof Worker !== "undefined" };
    },
    { scope: SINGLETON }
  );

  // Kernel (recommended - from core module)
  container.register(
    ServiceId.KERNEL,
    async () => {
      const { Kernel } = await import("../../core/kernel.js");
      return Kernel.create('minimal');
    },
    { scope: SINGLETON }
  );

  // MessageBus (depends on eventBus) - now uses core/message-bus.js
  container.register(
    ServiceId.MESSAGE_BUS,
    async (c) => {
      const { MessageBus } = await import("../../core/message-bus.js");
      const eventBus = await c.get(ServiceId.EVENT_BUS);
      return new MessageBus(eventBus);
    },
    { scope: SINGLETON }
  );

  // P6.4: JS Runtime Adapter (TRANSIENT - 每个执行环境独立)
  container.register(
    ServiceId.JS_ADAPTER,
    async () => {
      const { JSRuntimeAdapter } = await import("../core/js-adapter.js");
      return new JSRuntimeAdapter({ useWorkerSandbox: true });
    },
    { scope: TRANSIENT }
  );

  // P6.4: Python Runtime Adapter (SINGLETON - Pyodide 初始化较慢，复用)
  container.register(
    ServiceId.PYTHON_ADAPTER,
    async () => {
      const { PythonRuntimeAdapter } = await import("../core/python-adapter.js");
      return new PythonRuntimeAdapter();
    },
    { scope: SINGLETON }
  );

  // P6.4: Python Skill Executor (depends on pythonAdapter)
  container.register(
    ServiceId.PYTHON_SKILL_EXECUTOR,
    async (c) => {
      const { PythonSkillExecutor } = await import("../deps/python-skill-executor.js");
      const pythonAdapter = await c.get(ServiceId.PYTHON_ADAPTER);
      return new PythonSkillExecutor({ pythonAdapter });
    },
    { scope: SINGLETON }
  );

  // P6.4: Runtime Scheduler (SINGLETON)
  container.register(
    ServiceId.RUNTIME_SCHEDULER,
    async () => {
      const { RuntimeScheduler } = await import("../core/scheduler.js");
      return new RuntimeScheduler();
    },
    { scope: SINGLETON }
  );

  // P6.5: HNSW Index (TRANSIENT - 每个向量库独立)
  container.register(
    ServiceId.HNSW_INDEX,
    async () => {
      const { HnswLiteIndex } = await import("../../shared/embeddings/hnsw-lite.js");
      return new HnswLiteIndex();
    },
    { scope: TRANSIENT }
  );

  // P6.5: Schema Validator (SINGLETON)
  container.register(
    ServiceId.SCHEMA_VALIDATOR,
    async () => {
      const { SchemaValidator } = /** @type {any} */ (await import("../../shared/utils/schema-validator.js"));
      return new SchemaValidator();
    },
    { scope: SINGLETON }
  );

  // P6.6: Delta Sync (TRANSIENT - 每次同步独立)
  container.register(
    ServiceId.DELTA_SYNC,
    async () => {
      const { DeltaSyncSession } = await import("../../vfs/delta-sync.js");
      return { DeltaSyncSession }; // 返回类，由调用方实例化
    },
    { scope: SINGLETON }
  );

  // P6.6: File Lock (SINGLETON - 全局锁管理)
  container.register(
    ServiceId.FILE_LOCK,
    () => new FileLock(),
    { scope: SINGLETON }
  );

  // P6.7: TOC Builder (SINGLETON)
  container.register(
    ServiceId.TOC_BUILDER,
    async () => {
      const { TocBuilder } = /** @type {any} */ (await import("../../retrieval/toc-builder.js"));
      return new TocBuilder();
    },
    { scope: SINGLETON }
  );

  // P7.1: Policy Engine (SINGLETON - 规则评估引擎)
  container.register(
    ServiceId.POLICY_ENGINE,
    async () => {
      const { PolicyEngine } = await import("../policy/engine.js");
      return new PolicyEngine({ defaultEffect: "prompt" });
    },
    { scope: SINGLETON }
  );

  // P7.1: Policy Manager (SINGLETON - 策略管理，依赖 EventBus)
  container.register(
    ServiceId.POLICY_MANAGER,
    async (c) => {
      const { PolicyManager } = await import("../policy/manager.js");
      const eventBus = await c.get(ServiceId.EVENT_BUS);
      const engine = await c.get(ServiceId.POLICY_ENGINE);
      return new PolicyManager({ eventBus, engine });
    },
    { scope: SINGLETON }
  );

  // P7.2: Replay Controller (TRANSIENT - 每次回放独立)
  container.register(
    ServiceId.REPLAY_CONTROLLER,
    async () => {
      const { RunReplayController } = await import("../telemetry/replay-controller.js");
      return new RunReplayController();
    },
    { scope: TRANSIENT }
  );

  // P7.3: VFS Proxy (TRANSIENT - Worker 通信代理)
  container.register(
    ServiceId.VFS_PROXY,
    async () => {
      const { VfsProxy } = await import("../core/vfs-proxy.js");
      return { VfsProxy }; // 返回类，由 Worker 场景实例化
    },
    { scope: SINGLETON }
  );

  // P7.3: Shared Memory Bridge (SINGLETON - SAB/MessagePort 桥接)
  container.register(
    ServiceId.SHARED_MEMORY_BRIDGE,
    async () => {
      const { SharedMemoryBridge } = await import("../core/shared-memory.js");
      return new SharedMemoryBridge();
    },
    { scope: SINGLETON }
  );

  // Apply overrides
  for (const [id, factory] of Object.entries(overrides)) {
    container.override(id, factory);
  }

  return container;
}

/**
 * Create a minimal container for testing.
 *
 * @param {Object} [mocks] - Mock implementations
 * @returns {Container}
 */
export function createTestContainer(mocks = {}) {
  const container = new Container();

  // Minimal logger
  container.registerValue(ServiceId.LOGGER, {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  });

  // Mock EventBus
  container.registerValue(ServiceId.EVENT_BUS, {
    emit: () => {},
    on: () => () => {},
    off: () => {},
  });

  // Apply mocks
  for (const [id, value] of Object.entries(mocks)) {
    container.registerValue(id, value);
  }

  return container;
}
