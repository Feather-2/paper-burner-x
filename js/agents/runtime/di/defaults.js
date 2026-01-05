/**
 * Default Service Registrations
 *
 * Provides factory functions for core agent services.
 */

import { Container, SINGLETON, TRANSIENT } from "./container.js";
import { CircuitBreakerRegistry } from "../../shared/utils/circuit-breaker.js";
import { TraceContext } from "../telemetry/trace-context.js";

/**
 * Service IDs used across the agent system.
 */
export const ServiceId = {
  LOGGER: "logger",
  EVENT_BUS: "eventBus",
  TRACE_CONTEXT: "traceContext",
  MEMORY_STORE: "memoryStore",
  STATE_ENGINE: "stateEngine",
  MODEL_ROUTER: "modelRouter",
  MCP_CLIENT: "mcpClient",
  RETRIEVAL_ROUTER: "retrievalRouter",
  BUDGET_MANAGER: "budgetManager",
  CHECKPOINT_MANAGER: "checkpointManager",
  CIRCUIT_BREAKER_REGISTRY: "circuitBreakerRegistry",
  WATCHDOG: "watchdog",
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

  // EventBus (no dependencies)
  container.register(ServiceId.EVENT_BUS, async (c) => {
    const { EventBus } = await import("../events/event-bus.js");
    const eventBus = new EventBus();
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
    return new ModelRouter({ logger });
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
