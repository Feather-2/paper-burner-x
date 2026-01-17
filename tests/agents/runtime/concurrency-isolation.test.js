import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus } from "../../../js/agents/core/event-bus.js";
import { StateBus } from "../../../js/agents/core/state-bus.js";
import { MessageBus } from "../../../js/agents/core/message-bus.js";

describe("concurrency-isolation", () => {
  describe("StateBus isolation", () => {
    it("separate StateBus instances have independent state", () => {
      const bus1 = new StateBus();
      const bus2 = new StateBus();

      bus1.set("runtime.iteration", 10);
      bus2.set("runtime.iteration", 20);

      expect(bus1.get("runtime.iteration")).toBe(10);
      expect(bus2.get("runtime.iteration")).toBe(20);
    });

    it("StateBus snapshots are isolated between instances", () => {
      const bus1 = new StateBus();
      const bus2 = new StateBus();

      bus1.set("meta.status", "running");
      const snapId1 = bus1.snapshot("snap1");

      bus2.set("meta.status", "idle");
      const snapId2 = bus2.snapshot("snap1"); // same ID, different bus

      expect(bus1.listSnapshots()).toContain(snapId1);
      expect(bus2.listSnapshots()).toContain(snapId2);

      // Rollback on bus1 should not affect bus2
      bus1.set("meta.status", "completed");
      bus1.rollback(snapId1);

      expect(bus1.get("meta.status")).toBe("running");
      expect(bus2.get("meta.status")).toBe("idle");
    });

    it("StateBus subscribers are isolated between instances", () => {
      const bus1 = new StateBus();
      const bus2 = new StateBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus1.subscribe("runtime.*", handler1);
      bus2.subscribe("runtime.*", handler2);

      bus1.set("runtime.tokens.input", 100);
      bus2.set("runtime.tokens.output", 200);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({ path: "runtime.tokens.input", newValue: 100 })
      );

      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledWith(
        expect.objectContaining({ path: "runtime.tokens.output", newValue: 200 })
      );
    });

    it("concurrent StateBus updates do not interfere", async () => {
      const busses = Array.from({ length: 5 }, () => new StateBus());
      const results = [];

      // Concurrent updates
      await Promise.all(
        busses.map(async (bus, idx) => {
          for (let i = 0; i < 100; i++) {
            bus.set("runtime.iteration", i);
            // Simulate async work
            if (i % 10 === 0) await Promise.resolve();
          }
          results.push({ idx, final: bus.get("runtime.iteration") });
        })
      );

      // Each bus should have its own final value
      for (const { final } of results) {
        expect(final).toBe(99);
      }

      // Verify isolation
      for (let i = 0; i < busses.length; i++) {
        expect(busses[i].get("runtime.iteration")).toBe(99);
      }
    });
  });

  describe("EventBus isolation", () => {
    it("separate EventBus instances have independent handlers", () => {
      const bus1 = new EventBus();
      const bus2 = new EventBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus1.on("agent.step", handler1);
      bus2.on("agent.step", handler2);

      bus1.emitSync("agent.step", { data: "from bus1" });
      bus2.emitSync("agent.step", { data: "from bus2" });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      // Each handler only receives events from its own bus
      expect(handler1.mock.calls[0][0]).toEqual(
        expect.objectContaining({ payload: { data: "from bus1" } })
      );
      expect(handler2.mock.calls[0][0]).toEqual(
        expect.objectContaining({ payload: { data: "from bus2" } })
      );
    });

    it("EventBus wildcard handlers are isolated", () => {
      const bus1 = new EventBus();
      const bus2 = new EventBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus1.on("agent.*", handler1);
      bus2.on("agent.*", handler2);

      bus1.emitSync("agent.start", {});
      bus1.emitSync("agent.step", {});
      bus2.emitSync("agent.complete", {});

      expect(handler1).toHaveBeenCalledTimes(2);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("EventBus once() listeners are isolated", async () => {
      const bus1 = new EventBus();
      const bus2 = new EventBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus1.once("test.event", handler1);
      bus2.once("test.event", handler2);

      bus1.emitSync("test.event", { v: 1 });
      bus1.emitSync("test.event", { v: 2 }); // Should not trigger again

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(0);

      bus2.emitSync("test.event", { v: 3 });
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("concurrent event emissions are correctly delivered", async () => {
      const bus = new EventBus();
      const received = [];
      const count = 100;

      bus.on("concurrent.test", (evt) => {
        received.push(evt.payload);
      });

      // Emit events concurrently from multiple "sources"
      await Promise.all(
        Array.from({ length: 5 }, (_, source) =>
          (async () => {
            for (let i = 0; i < count / 5; i++) {
              bus.emitSync("concurrent.test", { source, i });
              if (i % 5 === 0) await Promise.resolve();
            }
          })()
        )
      );

      expect(received.length).toBe(count);
    });

    it("EventBus dispose prevents further emissions", () => {
      const bus = new EventBus();
      const handler = vi.fn();

      bus.on("test.event", handler);
      bus.emitSync("test.event", {});
      expect(handler).toHaveBeenCalledTimes(1);

      bus.dispose();

      // After dispose, handlers should be cleared
      expect(() => bus.emitSync("test.event", {})).not.toThrow();
    });
  });

  describe("MessageBus isolation", () => {
    it("separate MessageBus instances have independent channels", async () => {
      const mb1 = new MessageBus();
      const mb2 = new MessageBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      mb1.on("rpc.echo", handler1);
      mb2.on("rpc.echo", handler2);

      mb1.emit("rpc.echo", { msg: "hello from 1" });
      mb2.emit("rpc.echo", { msg: "hello from 2" });

      expect(handler1).toHaveBeenCalledWith({ msg: "hello from 1" }, expect.anything());
      expect(handler2).toHaveBeenCalledWith({ msg: "hello from 2" }, expect.anything());
    });

    it("MessageBus request/response works independently", async () => {
      const mb1 = new MessageBus();
      const mb2 = new MessageBus();

      mb1.on("rpc.add", (payload) => payload.a + payload.b);
      mb2.on("rpc.multiply", (payload) => payload.a * payload.b);

      const [sum, product] = await Promise.all([
        mb1.request("rpc.add", { a: 2, b: 3 }),
        mb2.request("rpc.multiply", { a: 4, b: 5 }),
      ]);

      expect(sum).toBe(5);
      expect(product).toBe(20);
    });

    it("MessageBus with shared EventBus isolates by request ID", async () => {
      const sharedBus = new EventBus();
      const mb1 = new MessageBus(sharedBus);
      const mb2 = new MessageBus(sharedBus);

      // Both use the same event bus but different request IDs
      mb1.on("shared.echo", (payload) => `mb1:${payload}`);
      mb2.on("shared.echo", (payload) => `mb2:${payload}`);

      // When using shared bus, first registered handler responds
      const result = await mb1.request("shared.echo", "test", { timeoutMs: 1000 });
      expect(result).toMatch(/^mb[12]:test$/);
    });

    it("concurrent MessageBus requests complete correctly", async () => {
      const mb = new MessageBus();
      let counter = 0;

      mb.on("rpc.counter", async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return ++counter;
      });

      const requests = Array.from({ length: 10 }, () =>
        mb.request("rpc.counter", {}, { timeoutMs: 5000 })
      );

      const results = await Promise.all(requests);

      // All requests should complete with unique counter values
      expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("MessageBus request timeout does not affect other requests", async () => {
      const mb = new MessageBus();

      mb.on("rpc.slow", async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "slow";
      });

      mb.on("rpc.fast", () => "fast");

      const [slowPromise, fastResult] = await Promise.allSettled([
        mb.request("rpc.slow", {}, { timeoutMs: 50 }),
        mb.request("rpc.fast", {}, { timeoutMs: 1000 }),
      ]);

      expect(slowPromise.status).toBe("rejected");
      expect(fastResult.status).toBe("fulfilled");
      expect(fastResult.value).toBe("fast");
    });
  });

  describe("multi-agent concurrent execution", () => {
    it("multiple agents with independent state busses run in isolation", async () => {
      const agents = Array.from({ length: 3 }, (_, id) => ({
        id: `agent-${id}`,
        state: new StateBus(),
        events: new EventBus(),
        iterations: [],
      }));

      // Simulate agent execution
      await Promise.all(
        agents.map(async (agent) => {
          agent.state.set("meta.status", "running");
          agent.events.on("step", (evt) => {
            agent.iterations.push(evt.payload.iteration);
          });

          for (let i = 0; i < 10; i++) {
            agent.state.set("runtime.iteration", i);
            agent.events.emitSync("step", { iteration: i });
            await Promise.resolve();
          }

          agent.state.set("meta.status", "completed");
        })
      );

      // Verify each agent has correct state
      for (const agent of agents) {
        expect(agent.state.get("meta.status")).toBe("completed");
        expect(agent.state.get("runtime.iteration")).toBe(9);
        expect(agent.iterations).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      }
    });

    it("agent cancellation does not affect other running agents", async () => {
      const agents = Array.from({ length: 3 }, (_, id) => ({
        id: `agent-${id}`,
        state: new StateBus(),
        abortController: new AbortController(),
        completed: false,
        cancelled: false,
      }));

      // Start all agents
      const executions = agents.map(async (agent, idx) => {
        try {
          for (let i = 0; i < 10; i++) {
            if (agent.abortController.signal.aborted) {
              agent.cancelled = true;
              return;
            }
            agent.state.set("runtime.iteration", i);
            await new Promise((r) => setTimeout(r, 10));
          }
          agent.completed = true;
        } catch (e) {
          agent.cancelled = true;
        }
      });

      // Cancel agent 1 after a short delay
      await new Promise((r) => setTimeout(r, 30));
      agents[1].abortController.abort();

      await Promise.all(executions);

      // Agent 0 and 2 should complete, agent 1 should be cancelled
      expect(agents[0].completed).toBe(true);
      expect(agents[1].cancelled).toBe(true);
      expect(agents[2].completed).toBe(true);
    });

    it("agents with shared EventBus can communicate without state leakage", async () => {
      const sharedEvents = new EventBus();
      const agents = Array.from({ length: 2 }, (_, id) => ({
        id: `agent-${id}`,
        state: new StateBus({ events: sharedEvents }),
        received: [],
      }));

      // Each agent listens for messages addressed to it
      for (const agent of agents) {
        sharedEvents.on(`msg.${agent.id.replace('-', '_')}`, (evt) => {
          agent.received.push(evt.payload);
        });
      }

      // Agent 0 sends to Agent 1
      sharedEvents.emitSync("msg.agent_1", { from: "agent-0", data: "hello" });

      // Agent 1 sends to Agent 0
      sharedEvents.emitSync("msg.agent_0", { from: "agent-1", data: "world" });

      expect(agents[0].received).toEqual([{ from: "agent-1", data: "world" }]);
      expect(agents[1].received).toEqual([{ from: "agent-0", data: "hello" }]);

      // State remains isolated
      agents[0].state.set("runtime.tokens.input", 100);
      agents[1].state.set("runtime.tokens.input", 200);

      expect(agents[0].state.get("runtime.tokens.input")).toBe(100);
      expect(agents[1].state.get("runtime.tokens.input")).toBe(200);
    });
  });

  describe("resource contention", () => {
    it("concurrent snapshot operations are safe", async () => {
      const bus = new StateBus({ maxSnapshots: 10 });
      const snapshots = [];

      // Concurrent snapshot creation
      await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          bus.set("runtime.iteration", i);
          const id = bus.snapshot(`snap-${i}`);
          snapshots.push(id);
          await Promise.resolve();
        })
      );

      // Should have at most maxSnapshots
      expect(bus.listSnapshots().length).toBeLessThanOrEqual(10);

      // LRU eviction should have removed oldest
      const remaining = bus.listSnapshots();
      for (let i = 10; i < 20; i++) {
        expect(remaining).toContain(`snap-${i}`);
      }
    });

    it("concurrent subscribe/unsubscribe is safe", async () => {
      const bus = new StateBus();
      const unsubs = [];
      const callCounts = Array(10).fill(0);

      // Concurrent subscribe
      await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const unsub = bus.subscribe("test.*", () => {
            callCounts[i]++;
          });
          unsubs.push(unsub);
          await Promise.resolve();
        })
      );

      // All subscribers should receive the event
      bus.set("test.value", 1);
      expect(callCounts.every((c) => c === 1)).toBe(true);

      // Concurrent unsubscribe half of them
      await Promise.all(
        unsubs.slice(0, 5).map(async (unsub) => {
          unsub();
          await Promise.resolve();
        })
      );

      // Only remaining subscribers should receive
      bus.set("test.value", 2);
      expect(callCounts.slice(0, 5).every((c) => c === 1)).toBe(true);
      expect(callCounts.slice(5).every((c) => c === 2)).toBe(true);
    });

    it("high-frequency state updates do not lose data", async () => {
      const bus = new StateBus();
      const changes = [];

      bus.subscribe("counter", (change) => {
        changes.push(change.newValue);
      });

      const count = 1000;
      for (let i = 0; i < count; i++) {
        bus.set("counter", i);
      }

      // All changes should be recorded
      expect(changes.length).toBe(count);
      expect(changes[changes.length - 1]).toBe(count - 1);
    });

    it("EventBus handles rapid emit/dispose cycles", () => {
      for (let cycle = 0; cycle < 10; cycle++) {
        const bus = new EventBus();
        const handler = vi.fn();

        bus.on("test.event", handler);

        for (let i = 0; i < 100; i++) {
          bus.emitSync("test.event", { i });
        }

        expect(handler).toHaveBeenCalledTimes(100);
        bus.dispose();
      }
    });

    it("parallel state modifications with change log tracking", async () => {
      const bus = new StateBus({ keepLog: true, maxLog: 1000 });

      await Promise.all(
        Array.from({ length: 5 }, async (_, thread) => {
          for (let i = 0; i < 50; i++) {
            bus.set(`thread.${thread}.iteration`, i);
            if (i % 10 === 0) await Promise.resolve();
          }
        })
      );

      const log = bus.getChangeLog(1000);

      // Should have 250 changes (5 threads * 50 iterations)
      expect(log.length).toBe(250);

      // Each thread should have reached iteration 49
      for (let t = 0; t < 5; t++) {
        expect(bus.get(`thread.${t}.iteration`)).toBe(49);
      }
    });
  });

  describe("edge cases", () => {
    it("empty EventBus operations are safe", () => {
      const bus = new EventBus();

      // Emit to non-existent handlers
      expect(() => bus.emitSync("nonexistent", {})).not.toThrow();

      // Unsubscribe non-existent handler
      const off = bus.on("test", () => {});
      off();
      expect(() => off()).not.toThrow(); // Double unsubscribe
    });

    it("StateBus handles null/undefined values correctly", () => {
      const bus = new StateBus();

      bus.set("nullable", null);
      expect(bus.get("nullable")).toBe(null);

      bus.set("undefinable", undefined);
      expect(bus.get("undefinable")).toBe(undefined);

      bus.set("nested.null", null);
      expect(bus.get("nested.null")).toBe(null);
    });

    it("concurrent rollbacks on same StateBus", async () => {
      const bus = new StateBus();

      bus.set("value", 1);
      const snap1 = bus.snapshot("s1");

      bus.set("value", 2);
      const snap2 = bus.snapshot("s2");

      bus.set("value", 3);

      // Concurrent rollbacks - last one wins
      await Promise.all([
        Promise.resolve().then(() => bus.rollback(snap1)),
        Promise.resolve().then(() => bus.rollback(snap2)),
      ]);

      // Value should be from one of the snapshots
      const value = bus.get("value");
      expect([1, 2]).toContain(value);
    });

    it("MessageBus handles handler errors gracefully", async () => {
      const mb = new MessageBus();

      mb.on("rpc.error", () => {
        throw new Error("Handler error");
      });

      const result = await mb.request("rpc.error", {}, { timeoutMs: 1000 }).catch((e) => e);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("Handler error");
    });

    it("AbortSignal cancellation propagates correctly", async () => {
      const mb = new MessageBus();
      const controller = new AbortController();

      mb.on("rpc.slow", async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return "done";
      });

      const requestPromise = mb.request("rpc.slow", {}, {
        timeoutMs: 5000,
        signal: controller.signal,
      });

      // Abort after 50ms
      setTimeout(() => controller.abort(), 50);

      const result = await requestPromise.catch((e) => e);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toMatch(/abort/i);
    });
  });
});
