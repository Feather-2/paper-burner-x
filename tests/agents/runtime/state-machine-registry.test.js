const test = require("node:test");
const assert = require("node:assert/strict");

async function getRegistry() {
  const { StateMachineRegistry } = await import("../../../js/agents/runtime/state-machine-registry.js");
  return StateMachineRegistry.getInstance();
}

async function createTestMachine(transitions, name = "TestMachine") {
  const { createStateMachine } = await import("../../../js/agents/runtime/state-machine.js");
  return createStateMachine(transitions, name);
}

function cleanup(registry, names) {
  for (const name of names) {
    registry.unregister(name);
  }
}

test("StateMachineRegistry singleton returns the same instance", async () => {
  const { StateMachineRegistry } = await import("../../../js/agents/runtime/state-machine-registry.js");
  const first = StateMachineRegistry.getInstance();
  const second = StateMachineRegistry.getInstance();
  assert.strictEqual(first, second);
});

test("StateMachineRegistry register validates name and machine", async () => {
  const registry = await getRegistry();
  assert.throws(() => registry.register("", {}), /name is required/);
  assert.throws(() => registry.register("valid", null), /machine is required/);
});

test("StateMachineRegistry register/get/getAll/getAllNames", async () => {
  const registry = await getRegistry();
  const name = "__test__.registry.basic";
  const transitions = { idle: ["active"], active: [] };
  const machine = await createTestMachine(transitions, "BasicMachine");

  registry.unregister(name);
  try {
    registry.register(name, machine, {
      module: "test",
      description: "Basic registry coverage",
      states: ["idle", "active"],
      transitions,
    });

    assert.strictEqual(registry.get(name), machine);

    const all = registry.getAll();
    assert.ok(all instanceof Map);
    assert.strictEqual(all.get(name), machine);

    const names = registry.getAllNames();
    assert.ok(names.includes(name));
  } finally {
    cleanup(registry, [name]);
  }
});

test("StateMachineRegistry exportSnapshot includes metadata and current state", async () => {
  const registry = await getRegistry();
  const name = "__test__.registry.snapshot";
  const transitions = { idle: ["running"], running: [] };
  const machine = await createTestMachine(transitions, "SnapshotMachine");
  machine.state = "idle";
  machine.getState = () => "running";

  registry.unregister(name);
  try {
    registry.register(name, machine, {
      module: "test",
      description: "Snapshot registry coverage",
      states: ["idle", "running"],
      transitions,
    });

    const snapshot = registry.exportSnapshot();
    assert.ok(snapshot[name]);

    const entry = snapshot[name];
    assert.equal(entry.name, name);
    assert.equal(entry.module, "test");
    assert.equal(entry.description, "Snapshot registry coverage");
    assert.deepEqual(entry.states, ["idle", "running"]);
    assert.deepEqual(entry.transitions, transitions);
    assert.equal(entry.currentState, "running");
  } finally {
    cleanup(registry, [name]);
  }
});

test("StateMachineRegistry duplicate registration throws", async () => {
  const registry = await getRegistry();
  const name = "__test__.registry.duplicate";
  const transitions = { idle: ["active"], active: [] };
  const machine = await createTestMachine(transitions, "DuplicateMachine");

  registry.unregister(name);
  try {
    registry.register(name, machine, {
      module: "test",
      description: "Duplicate registry coverage",
      states: ["idle", "active"],
      transitions,
    });

    assert.throws(
      () => registry.register(name, machine, { module: "test", description: "dup", states: [], transitions: {} }),
      /already registered/
    );
  } finally {
    cleanup(registry, [name]);
  }
});

test("StateMachineRegistry missing machine handling", async () => {
  const registry = await getRegistry();
  assert.equal(registry.get("__test__.registry.missing"), undefined);
  assert.equal(registry.unregister("__test__.registry.missing"), false);
});

test("StateMachineRegistry registers deepsearch and design machines", async () => {
  const registry = await getRegistry();

  await import("../../../js/agents/stages/deepsearch/states.js");
  await import("../../../js/agents/stages/design/states.js");

  const names = registry.getAllNames();
  const required = [
    "deepsearch.phase",
    "deepsearch.gap",
    "design.phase",
    "design.slide",
    "design.visualSlot",
    "design.editSession",
    "design.subAgent",
    "design.review",
  ];

  for (const name of required) {
    assert.ok(names.includes(name), `Expected registry to include ${name}`);
  }
});
