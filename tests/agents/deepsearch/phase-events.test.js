const test = require("node:test");
const assert = require("node:assert/strict");

function createTestEventBus() {
  const listeners = new Map();
  const events = [];

  return {
    events,
    subscribe(name, handler) {
      const key = String(name || "");
      const set = listeners.get(key) || new Set();
      set.add(handler);
      listeners.set(key, set);
      return () => {
        set.delete(handler);
        if (set.size === 0) listeners.delete(key);
      };
    },
    async emit(name, record) {
      events.push({ name, record });
      const set = listeners.get(String(name || ""));
      if (!set) return;
      for (const handler of [...set]) {
        await handler({ name, record });
      }
    },
  };
}

test("phase transition dispatches handler", async () => {
  const { PhaseStatus } = await import("../../../js/agents/stages/deepsearch/states.js");
  const { DeepSearchEvents } = await import("../../../js/agents/stages/deepsearch/events.js");
  const { subscribePhaseTransitions } = await import("../../../js/agents/stages/deepsearch/phase-handlers.js");

  const bus = createTestEventBus();
  let received = null;

  subscribePhaseTransitions(
    bus,
    {
      [PhaseStatus.GAPS]: async (context) => {
        received = context;
      },
    },
    {}
  );

  await bus.emit(DeepSearchEvents.PHASE_TRANSITION, { payload: { to: PhaseStatus.GAPS, context: { ok: true } } });
  assert.deepEqual(received, { ok: true });
});

test("phaseMachine rejects invalid transition", async () => {
  const { PhaseStatus, phaseMachine } = await import("../../../js/agents/stages/deepsearch/states.js");

  const entity = { status: PhaseStatus.SCAN };
  const ok = phaseMachine.transition(entity, PhaseStatus.WRITE, { reason: "test" });

  assert.equal(ok, false);
  assert.equal(entity.status, PhaseStatus.SCAN);
});

test("handler error triggers NODE_FAILED", async () => {
  const { PhaseStatus } = await import("../../../js/agents/stages/deepsearch/states.js");
  const { DeepSearchEvents } = await import("../../../js/agents/stages/deepsearch/events.js");
  const { subscribePhaseTransitions } = await import("../../../js/agents/stages/deepsearch/phase-handlers.js");

  const bus = createTestEventBus();

  subscribePhaseTransitions(
    bus,
    {
      [PhaseStatus.GAPS]: async () => {
        throw new Error("boom");
      },
    },
    {
      onError: (err, { phase }) => {
        bus.emit(DeepSearchEvents.NODE_FAILED, { payload: { phase, message: err.message } });
      },
    }
  );

  await bus.emit(DeepSearchEvents.PHASE_TRANSITION, { payload: { to: PhaseStatus.GAPS } });

  const failed = bus.events.find((evt) => evt.name === DeepSearchEvents.NODE_FAILED);
  assert.ok(failed, "expected NODE_FAILED event");
  assert.equal(failed.record?.payload?.phase, PhaseStatus.GAPS);
  assert.equal(failed.record?.payload?.message, "boom");
});
