import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("cancellation.checkCancelled throws AbortError with reason message and cause", async () => {
  const { checkCancelled } = await import("../../../js/agents/shared/utils/cancellation.js");

  expect(() => checkCancelled(null)).not.toThrow();
  expect(() => checkCancelled(undefined)).not.toThrow();

  const controller = new AbortController();
  expect(() => checkCancelled(controller.signal)).not.toThrow();
  controller.abort("stop");
  expect(() => checkCancelled(controller.signal)).toThrow(/stop/);

  const controller2 = new AbortController();
  const boom = new Error("boom");
  controller2.abort(boom);
  expect(() => checkCancelled(controller2.signal)).toThrow(/boom/);

  const controller3 = new AbortController();
  controller3.abort({ message: "from-object" });
  expect(() => checkCancelled(controller3.signal)).toThrow(/from-object/);

  const controller4 = new AbortController();
  controller4.abort({ any: "thing" });
  expect(() => checkCancelled(controller4.signal)).toThrow(/Run cancelled/);
});

it("cancellation.isAbortError detects AbortError and ABORT_ERR", async () => {
  const { isAbortError } = await import("../../../js/agents/shared/utils/cancellation.js");

  expect(isAbortError(new Error("x"))).toBe(false);

  const abort = new Error("stop");
  abort.name = "AbortError";
  expect(isAbortError(abort)).toBe(true);

  const abortCode = new Error("stop");
  abortCode.code = "ABORT_ERR";
  expect(isAbortError(abortCode)).toBe(true);
});

it("cancellation.withCancellation checks signal before invoking", async () => {
  const { withCancellation } = await import("../../../js/agents/shared/utils/cancellation.js");

  expect(() => withCancellation(null)).toThrow(/fn must be a function/);

  const called = [];
  const fn = withCancellation(async (_value, { signal } = {}) => {
    called.push({ ok: true, aborted: Boolean(signal?.aborted) });
    return "ok";
  });

  const controller = new AbortController();
  const out = await fn(1, { signal: controller.signal });
  expect(out).toBe("ok");
  expect(called.length).toBe(1);

  const controller2 = new AbortController();
  controller2.abort("stop");
  await expect(() => fn(1, { signal: controller2.signal }), /stop/);
  expect(called.length).toBe(1);
});

it("cancellation.createLinkedSignal links parent abort and timeout", async () => {
  const { createLinkedSignal, checkCancelled } = await import("../../../js/agents/shared/utils/cancellation.js");

  {
    const parent = new AbortController();
    const linked = createLinkedSignal(parent.signal);
    parent.abort("stop");
    expect(() => checkCancelled(linked)).toThrow(/stop/);
  }

  {
    const parent = new AbortController();
    parent.abort("already");
    const linked = createLinkedSignal(parent.signal);
    expect(() => checkCancelled(linked)).toThrow(/already/);
  }

  {
    const linked = createLinkedSignal(null, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(() => checkCancelled(linked)).toThrow(/Timeout/);
  }
});
