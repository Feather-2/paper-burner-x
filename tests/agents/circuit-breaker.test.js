import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitState,
} from "../../js/agents/shared/utils/circuit-breaker.js";

describe("shared/utils/circuit-breaker", () => {
  describe("CircuitState", () => {
    it("has expected values", () => {
      assert.equal(CircuitState.CLOSED, "closed");
      assert.equal(CircuitState.OPEN, "open");
      assert.equal(CircuitState.HALF_OPEN, "half_open");
    });

    it("is frozen", () => {
      assert.ok(Object.isFrozen(CircuitState));
    });
  });

  describe("CircuitBreaker", () => {
    /** @type {CircuitBreaker} */
    let breaker;
    let mockTime;

    beforeEach(() => {
      mockTime = { now: () => 0 };
      breaker = new CircuitBreaker({
        name: "test",
        failureThreshold: 3,
        successThreshold: 2,
        openDurationMs: 1000,
        halfOpenMaxCalls: 2,
        time: mockTime,
      });
    });

    describe("constructor", () => {
      it("creates with default options", () => {
        const b = new CircuitBreaker();
        assert.equal(b.state, CircuitState.CLOSED);
      });

      it("accepts custom options", () => {
        assert.equal(breaker.name, "test");
        assert.equal(breaker.failureThreshold, 3);
        assert.equal(breaker.successThreshold, 2);
      });
    });

    describe("state", () => {
      it("starts in CLOSED state", () => {
        assert.equal(breaker.state, CircuitState.CLOSED);
      });
    });

    describe("getStats", () => {
      it("returns initial stats", () => {
        const stats = breaker.getStats();
        assert.equal(stats.state, CircuitState.CLOSED);
        assert.equal(stats.failureCount, 0);
        assert.equal(stats.successCount, 0);
        assert.equal(stats.totalCalls, 0);
      });

      it("tracks calls", async () => {
        await breaker.execute(async () => "ok");
        const stats = breaker.getStats();
        assert.equal(stats.totalCalls, 1);
        assert.equal(stats.totalSuccesses, 1);
      });
    });

    describe("canExecute", () => {
      it("returns true when CLOSED", () => {
        assert.ok(breaker.canExecute());
      });

      it("returns false when OPEN", () => {
        breaker.trip("test");
        assert.equal(breaker.canExecute(), false);
      });

      it("returns true in HALF_OPEN within limit", () => {
        // Trip and transition to half-open
        breaker.trip("test");
        mockTime.now = () => 2000; // Past openDurationMs
        assert.ok(breaker.canExecute());
      });
    });

    describe("execute", () => {
      it("executes function on success", async () => {
        const result = await breaker.execute(async () => 42);
        assert.equal(result, 42);
      });

      it("propagates errors", async () => {
        await assert.rejects(
          () => breaker.execute(async () => { throw new Error("fail"); }),
          /fail/
        );
      });

      it("trips after failure threshold", async () => {
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch {
            // expected
          }
        }
        assert.equal(breaker.state, CircuitState.OPEN);
      });

      it("throws when OPEN", async () => {
        breaker.trip("manual");
        await assert.rejects(
          () => breaker.execute(async () => "ok"),
          /Circuit breaker is open/
        );
      });

      it("recovers after successful probes in HALF_OPEN", async () => {
        // Trip
        breaker.trip("test");
        assert.equal(breaker.state, CircuitState.OPEN);

        // Advance time past openDurationMs
        mockTime.now = () => 2000;

        // First probe - success
        await breaker.execute(async () => "ok");
        assert.equal(breaker.state, CircuitState.HALF_OPEN);

        // Second probe - success (successThreshold = 2)
        await breaker.execute(async () => "ok");
        assert.equal(breaker.state, CircuitState.CLOSED);
      });

      it("returns to OPEN on failure in HALF_OPEN", async () => {
        breaker.trip("test");
        mockTime.now = () => 2000;

        try {
          await breaker.execute(async () => { throw new Error("fail"); });
        } catch {
          // expected
        }

        assert.equal(breaker.state, CircuitState.OPEN);
      });

      it("resets failure count on success in CLOSED", async () => {
        // Two failures
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch {}
        }

        // Success resets count
        await breaker.execute(async () => "ok");

        // Two more failures shouldn't trip (count was reset)
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch {}
        }

        assert.equal(breaker.state, CircuitState.CLOSED);
      });

      it("respects custom isFailure function", async () => {
        // Create fresh breaker with custom isFailure
        const b = new CircuitBreaker({
          failureThreshold: 2,
          isFailure: (err) => err.message.includes("fatal"),
        });

        // Fatal errors count towards threshold
        try {
          await b.execute(async () => { throw new Error("fatal error 1"); });
        } catch {}
        assert.equal(b.state, CircuitState.CLOSED); // 1 failure, threshold is 2

        try {
          await b.execute(async () => { throw new Error("fatal error 2"); });
        } catch {}
        assert.equal(b.state, CircuitState.OPEN); // 2 failures, trips
      });
    });

    describe("reset", () => {
      it("resets to CLOSED state", () => {
        breaker.trip("test");
        breaker.reset();
        assert.equal(breaker.state, CircuitState.CLOSED);
      });

      it("clears failure count", async () => {
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch {}
        }

        breaker.reset();
        const stats = breaker.getStats();
        assert.equal(stats.failureCount, 0);
      });

      it("calls onStateChange", () => {
        const events = [];
        const b = new CircuitBreaker({
          onStateChange: (e) => events.push(e),
          time: mockTime,
        });

        b.trip("test");
        b.reset();

        assert.ok(events.some((e) => e.reason === "manual_reset"));
      });
    });

    describe("trip", () => {
      it("manually opens the breaker", () => {
        breaker.trip("manual");
        assert.equal(breaker.state, CircuitState.OPEN);
      });

      it("calls onStateChange with reason", () => {
        const events = [];
        const b = new CircuitBreaker({
          onStateChange: (e) => events.push(e),
          time: mockTime,
        });

        b.trip("test_reason");

        const tripEvent = events.find((e) => e.to === CircuitState.OPEN);
        assert.ok(tripEvent);
        assert.equal(tripEvent.reason, "test_reason");
      });
    });

    describe("state transitions", () => {
      it("OPEN -> HALF_OPEN after timeout", () => {
        breaker.trip("test");
        assert.equal(breaker.state, CircuitState.OPEN);

        // Advance time
        mockTime.now = () => 2000;

        // Access state triggers transition check
        assert.equal(breaker.state, CircuitState.HALF_OPEN);
      });
    });

    describe("halfOpenMaxCalls", () => {
      it("limits probe calls in HALF_OPEN before recovery", async () => {
        // Use higher successThreshold so we stay in HALF_OPEN longer
        const b = new CircuitBreaker({
          failureThreshold: 3,
          successThreshold: 5, // Need 5 successes to recover
          halfOpenMaxCalls: 2,
          openDurationMs: 1000,
          time: mockTime,
        });

        b.trip("test");
        mockTime.now = () => 2000;

        // Execute max allowed probes
        await b.execute(async () => "ok"); // halfOpenCalls = 1
        await b.execute(async () => "ok"); // halfOpenCalls = 2

        // Third should fail (max = 2)
        await assert.rejects(
          () => b.execute(async () => "ok"),
          /Circuit breaker is half_open/
        );
      });
    });
  });

  describe("CircuitBreakerRegistry", () => {
    /** @type {CircuitBreakerRegistry} */
    let registry;

    beforeEach(() => {
      registry = new CircuitBreakerRegistry();
    });

    describe("get", () => {
      it("creates new breaker", () => {
        const breaker = registry.get("test");
        assert.ok(breaker instanceof CircuitBreaker);
      });

      it("returns same breaker for same name", () => {
        const b1 = registry.get("test");
        const b2 = registry.get("test");
        assert.equal(b1, b2);
      });

      it("applies options on creation", () => {
        const breaker = registry.get("test", { failureThreshold: 10 });
        assert.equal(breaker.failureThreshold, 10);
      });
    });

    describe("has", () => {
      it("returns false for unknown", () => {
        assert.equal(registry.has("unknown"), false);
      });

      it("returns true for registered", () => {
        registry.get("test");
        assert.ok(registry.has("test"));
      });
    });

    describe("remove", () => {
      it("removes breaker", () => {
        registry.get("test");
        assert.ok(registry.remove("test"));
        assert.equal(registry.has("test"), false);
      });

      it("returns false for unknown", () => {
        assert.equal(registry.remove("unknown"), false);
      });
    });

    describe("getAllStats", () => {
      it("returns stats for all breakers", () => {
        registry.get("a");
        registry.get("b");

        const stats = registry.getAllStats();
        assert.ok("a" in stats);
        assert.ok("b" in stats);
      });

      it("returns empty object when empty", () => {
        const stats = registry.getAllStats();
        assert.deepEqual(stats, {});
      });
    });

    describe("resetAll", () => {
      it("resets all breakers", () => {
        const a = registry.get("a");
        const b = registry.get("b");

        a.trip("test");
        b.trip("test");

        registry.resetAll();

        assert.equal(a.state, CircuitState.CLOSED);
        assert.equal(b.state, CircuitState.CLOSED);
      });
    });
  });
});
