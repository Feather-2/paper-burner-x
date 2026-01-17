
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitState,
} from "../../js/agents/shared/utils/circuit-breaker.js";

describe("shared/utils/circuit-breaker", () => {
  describe("CircuitState", () => {
    it("has expected values", () => {
      expect(CircuitState.CLOSED).toBe("closed");
      expect(CircuitState.OPEN).toBe("open");
      expect(CircuitState.HALF_OPEN).toBe("half_open");
    });

    it("is frozen", () => {
      expect(Object.isFrozen(CircuitState)).toBe(true);
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
        expect(b.state).toBe(CircuitState.CLOSED);
      });

      it("accepts custom options", () => {
        expect(breaker.name).toBe("test");
        expect(breaker.failureThreshold).toBe(3);
        expect(breaker.successThreshold).toBe(2);
      });
    });

    describe("state", () => {
      it("starts in CLOSED state", () => {
        expect(breaker.state).toBe(CircuitState.CLOSED);
      });
    });

    describe("getStats", () => {
      it("returns initial stats", () => {
        const stats = breaker.getStats();
        expect(stats.state).toBe(CircuitState.CLOSED);
        expect(stats.failureCount).toBe(0);
        expect(stats.successCount).toBe(0);
        expect(stats.totalCalls).toBe(0);
      });

      it("tracks calls", async () => {
        await breaker.execute(async () => "ok");
        const stats = breaker.getStats();
        expect(stats.totalCalls).toBe(1);
        expect(stats.totalSuccesses).toBe(1);
      });
    });

    describe("canExecute", () => {
      it("returns true when CLOSED", () => {
        expect(breaker.canExecute()).toBe(true);
      });

      it("returns false when OPEN", () => {
        breaker.trip("test");
        expect(breaker.canExecute()).toBe(false);
      });

      it("returns true in HALF_OPEN within limit", () => {
        // Trip and transition to half-open
        breaker.trip("test");
        mockTime.now = () => 2000; // Past openDurationMs
        expect(breaker.canExecute()).toBe(true);
      });
    });

    describe("execute", () => {
      it("executes function on success", async () => {
        const result = await breaker.execute(async () => 42);
        expect(result).toBe(42);
      });

      it("propagates errors", async () => {
        await expect(() => breaker.execute(async () => { throw new Error("fail"); })).rejects.toThrow(/fail/
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
        expect(breaker.state).toBe(CircuitState.OPEN);
      });

      it("throws when OPEN", async () => {
        breaker.trip("manual");
        await expect(() => breaker.execute(async () => "ok")).rejects.toThrow(/Circuit breaker is open/
        );
      });

      it("recovers after successful probes in HALF_OPEN", async () => {
        // Trip
        breaker.trip("test");
        expect(breaker.state).toBe(CircuitState.OPEN);

        // Advance time past openDurationMs
        mockTime.now = () => 2000;

        // First probe - success
        await breaker.execute(async () => "ok");
        expect(breaker.state).toBe(CircuitState.HALF_OPEN);

        // Second probe - success (successThreshold = 2)
        await breaker.execute(async () => "ok");
        expect(breaker.state).toBe(CircuitState.CLOSED);
      });

      it("returns to OPEN on failure in HALF_OPEN", async () => {
        breaker.trip("test");
        mockTime.now = () => 2000;

        try {
          await breaker.execute(async () => { throw new Error("fail"); });
        } catch {
          // expected
        }

        expect(breaker.state).toBe(CircuitState.OPEN);
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

        expect(breaker.state).toBe(CircuitState.CLOSED);
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
        expect(b.state).toBe(CircuitState.CLOSED); // 1 failure, threshold is 2

        try {
          await b.execute(async () => { throw new Error("fatal error 2"); });
        } catch {}
        expect(b.state).toBe(CircuitState.OPEN); // 2 failures, trips
      });
    });

    describe("reset", () => {
      it("resets to CLOSED state", () => {
        breaker.trip("test");
        breaker.reset();
        expect(breaker.state).toBe(CircuitState.CLOSED);
      });

      it("clears failure count", async () => {
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch {}
        }

        breaker.reset();
        const stats = breaker.getStats();
        expect(stats.failureCount).toBe(0);
      });

      it("calls onStateChange", () => {
        const events = [];
        const b = new CircuitBreaker({
          onStateChange: (e) => events.push(e),
          time: mockTime,
        });

        b.trip("test");
        b.reset();

        const manualResetEvent = events.find((e) => e.reason === "manual_reset");
        expect(manualResetEvent).toMatchObject({
          from: CircuitState.OPEN,
          to: CircuitState.CLOSED,
          reason: "manual_reset",
        });
      });
    });

    describe("trip", () => {
      it("manually opens the breaker", () => {
        breaker.trip("manual");
        expect(breaker.state).toBe(CircuitState.OPEN);
      });

      it("calls onStateChange with reason", () => {
        const events = [];
        const b = new CircuitBreaker({
          onStateChange: (e) => events.push(e),
          time: mockTime,
        });

        b.trip("test_reason");

        const tripEvent = events.find((e) => e.to === CircuitState.OPEN);
        expect(tripEvent).toMatchObject({
          from: CircuitState.CLOSED,
          to: CircuitState.OPEN,
          reason: "test_reason",
        });
      });
    });

    describe("state transitions", () => {
      it("OPEN -> HALF_OPEN after timeout", () => {
        breaker.trip("test");
        expect(breaker.state).toBe(CircuitState.OPEN);

        // Advance time
        mockTime.now = () => 2000;

        // Access state triggers transition check
        expect(breaker.state).toBe(CircuitState.HALF_OPEN);
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
        await expect(() => b.execute(async () => "ok")).rejects.toThrow(/Circuit breaker is half_open/
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
        expect(breaker).toBeInstanceOf(CircuitBreaker);
      });

      it("returns same breaker for same name", () => {
        const b1 = registry.get("test");
        const b2 = registry.get("test");
        expect(b1).toBe(b2);
      });

      it("applies options on creation", () => {
        const breaker = registry.get("test", { failureThreshold: 10 });
        expect(breaker.failureThreshold).toBe(10);
      });
    });

    describe("has", () => {
      it("returns false for unknown", () => {
        expect(registry.has("unknown")).toBe(false);
      });

      it("returns true for registered", () => {
        registry.get("test");
        expect(registry.has("test")).toBe(true);
      });
    });

    describe("remove", () => {
      it("removes breaker", () => {
        registry.get("test");
        expect(registry.remove("test")).toBe(true);
        expect(registry.has("test")).toBe(false);
      });

      it("returns false for unknown", () => {
        expect(registry.remove("unknown")).toBe(false);
      });
    });

    describe("getAllStats", () => {
      it("returns stats for all breakers", () => {
        registry.get("a");
        registry.get("b");

        const stats = registry.getAllStats();
        expect(stats).toHaveProperty("a");
        expect(stats).toHaveProperty("b");
      });

      it("returns empty object when empty", () => {
        const stats = registry.getAllStats();
        expect(stats).toEqual({});
      });
    });

    describe("resetAll", () => {
      it("resets all breakers", () => {
        const a = registry.get("a");
        const b = registry.get("b");

        a.trip("test");
        b.trip("test");

        registry.resetAll();

        expect(a.state).toBe(CircuitState.CLOSED);
        expect(b.state).toBe(CircuitState.CLOSED);
      });
    });
  });
});
