import { describe, it, expect } from 'vitest';

import { createAgentContainer, createTestContainer, ServiceId } from '../../../js/agents/runtime/di/index.js';

describe('DI defaults', () => {
  it('can attempt to resolve all registered default services', async () => {
    const container = createAgentContainer();

    const ids = container.getServiceIds();
    expect(ids).toContain(ServiceId.SUBAGENT_REGISTRY);

    const results = [];
    for (const id of ids) {
      try {
        // Factories in the container can be sync or async.
        // We intentionally exercise them here (best-effort) to catch obvious wiring regressions.
        await container.get(id);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error });
      }
    }

    const subagentRegistryResult = results.find((r) => r.id === ServiceId.SUBAGENT_REGISTRY);
    expect(subagentRegistryResult?.ok).toBe(true);
  });

  it('covers DegradationMatrix getMemoryUsage fallbacks', async () => {
    /** @type {any} */
    const proc = globalThis.process;
    const originalMemoryUsage = proc?.memoryUsage;
    const originalPerfMemory = globalThis?.performance?.memory;

    try {
      // 1) Normal Node memoryUsage path (heapUsed/heapTotal)
      if (proc) {
        proc.memoryUsage = () => ({ heapUsed: 10, heapTotal: 100, rss: 100 });
      }

      {
        const container = createAgentContainer();
        const matrix = await container.get(ServiceId.DEGRADATION_MATRIX);
        matrix.recordRequest({ latencyMs: 0, isError: false });
      }

      // 2) Fallback to rss when heap fields are missing
      if (proc) {
        proc.memoryUsage = () => ({ rss: 100 });
      }

      {
        const container = createAgentContainer();
        const matrix = await container.get(ServiceId.DEGRADATION_MATRIX);
        matrix.recordRequest({ latencyMs: 0, isError: false });
      }

      // 3) memoryUsage throws → fallback to performance.memory
      if (proc) {
        proc.memoryUsage = () => {
          throw new Error('boom');
        };
      }
      if (globalThis.performance) {
        globalThis.performance.memory = { usedJSHeapSize: 10, jsHeapSizeLimit: 100 };
      }

      {
        const container = createAgentContainer();
        const matrix = await container.get(ServiceId.DEGRADATION_MATRIX);
        matrix.recordRequest({ latencyMs: 0, isError: false });
      }

      // 4) No usable inputs → fallback to 0
      if (proc) {
        proc.memoryUsage = () => ({ heapUsed: 0, heapTotal: 0, rss: 0 });
      }
      if (globalThis.performance) {
        globalThis.performance.memory = undefined;
      }

      {
        const container = createAgentContainer();
        const matrix = await container.get(ServiceId.DEGRADATION_MATRIX);
        matrix.recordRequest({ latencyMs: 0, isError: false });
      }
    } finally {
      if (proc && originalMemoryUsage) proc.memoryUsage = originalMemoryUsage;
      if (globalThis.performance) globalThis.performance.memory = originalPerfMemory;
    }
  });

  it('covers EventBus backpressure branch when enableBackpressure is missing', async () => {
    const mod = await import('../../../js/agents/core/event-bus.js');
    const EventBus = mod.EventBus;

    const originalEnable = EventBus.prototype.enableBackpressure;
    try {
      EventBus.prototype.enableBackpressure = undefined;
      const container = createAgentContainer();
      const eventBus = await container.get(ServiceId.EVENT_BUS);
      expect(eventBus).toBeTruthy();
    } finally {
      EventBus.prototype.enableBackpressure = originalEnable;
    }
  });

  it('createTestContainer stubs are callable', () => {
    const container = createTestContainer();

    const logger = container.get(ServiceId.LOGGER);
    logger.debug();
    logger.info();
    logger.warn();
    logger.error();

    const bus = container.get(ServiceId.EVENT_BUS);
    bus.emit();
    const off = bus.on();
    off();
    bus.off();
  });
});
