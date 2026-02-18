import { describe, it, expect, vi } from "vitest";

import { withTimeout } from "../../../../../js/agents/shared/utils/with-timeout.js";

describe("shared/utils/with-timeout", () => {
  it("resolves successful promises before timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "fast-op")).resolves.toBe("ok");
  });

  it("rejects with TIMEOUT and aborts the provided controller", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const onTimeout = vi.fn();

    const promise = withTimeout(new Promise(() => {}), 10, {
      label: "slow-op",
      abortController: controller,
      onTimeout,
    });
    const observed = promise.catch((err) => err);

    await vi.advanceTimersByTimeAsync(10);
    await expect(observed).resolves.toMatchObject({
      message: "slow-op timed out after 10ms",
      code: "TIMEOUT",
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("rejects with AbortError when the external signal aborts", async () => {
    const controller = new AbortController();
    const onAbort = vi.fn();
    const promise = withTimeout(new Promise(() => {}), 1000, {
      label: "abortable-op",
      signal: controller.signal,
      onAbort,
    });

    controller.abort("Stop");
    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORTED",
      message: "Stop",
    });
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
