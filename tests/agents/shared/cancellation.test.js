const test = require("node:test");
const assert = require("node:assert/strict");

test("cancellation.checkCancelled throws AbortError with reason message and cause", async () => {
  const { checkCancelled } = await import("../../../js/agents/shared/utils/cancellation.js");

  assert.doesNotThrow(() => checkCancelled(null));
  assert.doesNotThrow(() => checkCancelled(undefined));

  const controller = new AbortController();
  assert.doesNotThrow(() => checkCancelled(controller.signal));
  controller.abort("stop");
  assert.throws(
    () => checkCancelled(controller.signal),
    (err) => err && err.name === "AbortError" && err.message === "stop" && err.cause === "stop"
  );

  const controller2 = new AbortController();
  const boom = new Error("boom");
  controller2.abort(boom);
  assert.throws(
    () => checkCancelled(controller2.signal),
    (err) => err && err.name === "AbortError" && err.message === "boom" && err.cause === boom
  );

  const controller3 = new AbortController();
  controller3.abort({ message: "from-object" });
  assert.throws(
    () => checkCancelled(controller3.signal),
    (err) => err && err.name === "AbortError" && err.message === "from-object"
  );

  const controller4 = new AbortController();
  controller4.abort({ any: "thing" });
  assert.throws(() => checkCancelled(controller4.signal), /Run cancelled/);
});

test("cancellation.isAbortError detects AbortError and ABORT_ERR", async () => {
  const { isAbortError } = await import("../../../js/agents/shared/utils/cancellation.js");

  assert.equal(isAbortError(new Error("x")), false);

  const abort = new Error("stop");
  abort.name = "AbortError";
  assert.equal(isAbortError(abort), true);

  const abortCode = new Error("stop");
  abortCode.code = "ABORT_ERR";
  assert.equal(isAbortError(abortCode), true);
});

test("cancellation.withCancellation checks signal before invoking", async () => {
  const { withCancellation } = await import("../../../js/agents/shared/utils/cancellation.js");

  assert.throws(() => withCancellation(null), /fn must be a function/);

  const called = [];
  const fn = withCancellation(async (_value, { signal } = {}) => {
    called.push({ ok: true, aborted: Boolean(signal?.aborted) });
    return "ok";
  });

  const controller = new AbortController();
  const out = await fn(1, { signal: controller.signal });
  assert.equal(out, "ok");
  assert.equal(called.length, 1);

  const controller2 = new AbortController();
  controller2.abort("stop");
  await assert.rejects(() => fn(1, { signal: controller2.signal }), /stop/);
  assert.equal(called.length, 1);
});

test("cancellation.createLinkedSignal links parent abort and timeout", async () => {
  const { createLinkedSignal, checkCancelled } = await import("../../../js/agents/shared/utils/cancellation.js");

  {
    const parent = new AbortController();
    const linked = createLinkedSignal(parent.signal);
    parent.abort("stop");
    assert.throws(() => checkCancelled(linked), /stop/);
  }

  {
    const parent = new AbortController();
    parent.abort("already");
    const linked = createLinkedSignal(parent.signal);
    assert.throws(() => checkCancelled(linked), /already/);
  }

  {
    const linked = createLinkedSignal(null, 5);
    await new Promise((r) => setTimeout(r, 20));
    assert.throws(() => checkCancelled(linked), /Timeout/);
  }
});
