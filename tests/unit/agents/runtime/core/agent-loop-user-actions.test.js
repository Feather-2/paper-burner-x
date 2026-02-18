import { describe, expect, it, vi } from "vitest";
import { UserActionHandler } from "../../../../../js/agents/runtime/core/agent-loop-user-actions.js";

function createBus() {
  let handler = null;
  const unsubscribe = vi.fn();
  return {
    subscribe: vi.fn((_eventName, cb) => {
      handler = cb;
      return unsubscribe;
    }),
    emit(payload) {
      handler?.(payload);
    },
    unsubscribe,
  };
}

describe("UserActionHandler.waitForUserAction", () => {
  it("normalizes invalid timeout values to default instead of immediate timeout", async () => {
    vi.useFakeTimers();
    try {
      const bus = createBus();
      const handler = new UserActionHandler({ eventBus: bus });

      const promise = handler.waitForUserAction("approve", {
        timeout: 0,
        eventBus: bus,
      });

      await vi.advanceTimersByTimeAsync(1);
      bus.emit({ payload: { approved: true } });

      await expect(promise).resolves.toEqual({ approved: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws immediately when signal is already aborted", async () => {
    const bus = createBus();
    const controller = new AbortController();
    controller.abort();
    const handler = new UserActionHandler({ eventBus: bus });

    await expect(handler.waitForUserAction("approve", {
      eventBus: bus,
      signal: controller.signal,
    })).rejects.toThrow("Run cancelled");
  });

  it("times out with positive timeout and unsubscribes listener", async () => {
    vi.useFakeTimers();
    try {
      const bus = createBus();
      const handler = new UserActionHandler({ eventBus: bus });

      const waiting = handler.waitForUserAction("approve", { timeout: 5, eventBus: bus });
      const asserted = expect(waiting).rejects.toThrow("Timeout waiting for user action: approve");
      await vi.advanceTimersByTimeAsync(10);

      await asserted;
      expect(bus.unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
