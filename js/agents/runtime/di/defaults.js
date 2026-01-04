/**
 * Default Service Registrations
 *
 * Provides factory functions for core agent services.
 */

import { Container, SINGLETON } from "./container.js";

/**
 * Service IDs used across the agent system.
 */
export const ServiceId = {
  LOGGER: "logger",
  EVENT_BUS: "eventBus",
  MEMORY_STORE: "memoryStore",
  MODEL_ROUTER: "modelRouter",
  MCP_CLIENT: "mcpClient",
  RETRIEVAL_ROUTER: "retrievalRouter",
  BUDGET_MANAGER: "budgetManager",
  CHECKPOINT_MANAGER: "checkpointManager",
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
    return new EventBus();
  });

  // MemoryStore (depends on eventBus)
  container.register(ServiceId.MEMORY_STORE, async (c) => {
    const { MemoryStore } = await import("../memory/memory-store.js");
    const eventBus = await c.get(ServiceId.EVENT_BUS);
    return new MemoryStore({ eventBus });
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
