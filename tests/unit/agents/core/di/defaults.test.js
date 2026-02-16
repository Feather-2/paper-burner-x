import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  lamportClockInstances: [],
  circuitBreakerRegistryInstances: [],
  injectionScannerInstances: [],
  fileLockInstances: [],
  tokenTrackerInstances: [],
  traceContextInstances: [],
  eventBusInstances: [],
  eventBusEnableBackpressureImpl: vi.fn(),
  eventBusHasBackpressure: true,
  createAdaptiveTokenCounter: vi.fn(() => ({ type: "adaptive" })),
  createDefaultErrorBoundary: vi.fn(() => ({ name: "defaultErrorBoundary" })),
  enhanceEventBusWithHooks: vi.fn(),
}));

vi.mock("../../../../../js/agents/core/lamport-clock.js", () => ({
  LamportClockService: class LamportClockService {
    constructor() {
      this.id = Symbol("lamport");
      mocks.lamportClockInstances.push(this);
    }
  },
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  CircuitBreakerRegistry: class CircuitBreakerRegistry {
    constructor() {
      mocks.circuitBreakerRegistryInstances.push(this);
    }
  },
  createAdaptiveTokenCounter: mocks.createAdaptiveTokenCounter,
}));

vi.mock("../../../../../js/agents/sdk/injection-scanner.js", () => ({
  InjectionScanner: class InjectionScanner {
    constructor() {
      mocks.injectionScannerInstances.push(this);
    }
  },
}));

vi.mock("../../../../../js/agents/vfs/file-lock.js", () => ({
  FileLock: class FileLock {
    constructor() {
      mocks.fileLockInstances.push(this);
    }
  },
}));

vi.mock("../../../../../js/agents/runtime/core/error-boundary.js", () => ({
  createDefaultErrorBoundary: mocks.createDefaultErrorBoundary,
}));

vi.mock("../../../../../js/agents/plugins/telemetry/index.js", () => ({
  TokenTracker: class TokenTracker {
    constructor() {
      mocks.tokenTrackerInstances.push(this);
    }
  },
  TraceContext: class TraceContext {
    constructor() {
      mocks.traceContextInstances.push(this);
    }
  },
}));

vi.mock("../../../../../js/agents/runtime/hooks/event-bus-hooks.js", () => ({
  enhanceEventBusWithHooks: mocks.enhanceEventBusWithHooks,
}));

vi.mock("../../../../../js/agents/core/event-bus.js", () => ({
  EventBus: class EventBus {
    constructor() {
      mocks.eventBusInstances.push(this);
      if (mocks.eventBusHasBackpressure) {
        this.enableBackpressure = (...args) =>
          mocks.eventBusEnableBackpressureImpl(...args);
      }
    }
  },
}));

import { Container } from "../../../../../js/agents/core/di/container.js";
import {
  ServiceId,
  createAgentContainer,
} from "../../../../../js/agents/core/di/defaults.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const restoreNodeEnv = () => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
};

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  current.leaf = "end";
  return root;
};

describe("ServiceId", () => {
  it("exposes unique non-empty string identifiers", () => {
    const values = Object.values(ServiceId);

    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => typeof value === "string")).toBe(true);
    expect(values.every((value) => value.trim().length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("createAgentContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lamportClockInstances.length = 0;
    mocks.circuitBreakerRegistryInstances.length = 0;
    mocks.injectionScannerInstances.length = 0;
    mocks.fileLockInstances.length = 0;
    mocks.tokenTrackerInstances.length = 0;
    mocks.traceContextInstances.length = 0;
    mocks.eventBusInstances.length = 0;
    mocks.eventBusHasBackpressure = true;
    mocks.eventBusEnableBackpressureImpl.mockReset();
    mocks.eventBusEnableBackpressureImpl.mockImplementation(() => {});
    restoreNodeEnv();
  });

  afterEach(() => {
    restoreNodeEnv();
    vi.restoreAllMocks();
  });

  it.each([
    ["undefined", undefined],
    ["empty object", {}],
    ["empty array", []],
    ["empty string", ""],
    ["zero", 0],
    ["negative one", -1],
    ["max safe integer", Number.MAX_SAFE_INTEGER],
  ])("creates a container with %s overrides", (_label, overrides) => {
    const container = createAgentContainer(overrides);

    expect(container).toBeInstanceOf(Container);
    expect(container.get(ServiceId.LOGGER)).toBe(console);
  });

  it("throws for null overrides", () => {
    expect(() => createAgentContainer(null)).toThrow(TypeError);
  });

  it.each([
    ["whitespace string overrides", "   ", /Factory for "0" must be a function/],
    ["numeric string overrides", "123", /Factory for "0" must be a function/],
    ["array overrides", ["not-a-fn"], /Factory for "0" must be a function/],
    [
      "array-like object overrides",
      { 0: "not-a-fn", length: 1 },
      /Factory for "0" must be a function/,
    ],
    [
      "object override with non-function factory",
      { [ServiceId.LOGGER]: {} },
      /Factory for "logger" must be a function/,
    ],
    [
      "object override with null factory",
      { [ServiceId.LOGGER]: null },
      /Factory for "logger" must be a function/,
    ],
  ])("throws when %s are provided", (_label, overrides, errorMatcher) => {
    expect(() => createAgentContainer(overrides)).toThrow(errorMatcher);
  });

  it("applies override factories and caches singleton results", () => {
    const factory = vi.fn(() => ({ name: "custom-logger" }));
    const container = createAgentContainer({ [ServiceId.LOGGER]: factory });

    const first = container.get(ServiceId.LOGGER);
    const second = container.get(ServiceId.LOGGER);

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("handles long ids, large strings, and deep nesting in overrides", () => {
    const longId = `service-${"x".repeat(10000)}`;
    const longString = "y".repeat(100000);
    const largeContent = "z".repeat(1024 * 1024);
    const deepObject = buildDeepObject(40);

    const container = createAgentContainer({
      [longId]: () => longString,
      largeContent: () => largeContent,
      deepTree: () => deepObject,
    });

    expect(container.get(longId)).toBe(longString);
    expect(container.get("largeContent").length).toBe(1024 * 1024);

    let cursor = container.get("deepTree");
    for (let i = 0; i < 40; i += 1) {
      cursor = cursor.next;
    }
    expect(cursor.leaf).toBe("end");
  });

  it("initializes the event bus with hooks and backpressure options", async () => {
    const container = createAgentContainer();

    const eventBus = await container.get(ServiceId.EVENT_BUS);

    expect(mocks.enhanceEventBusWithHooks).toHaveBeenCalledTimes(1);
    expect(mocks.enhanceEventBusWithHooks).toHaveBeenCalledWith(eventBus);
    expect(mocks.eventBusEnableBackpressureImpl).toHaveBeenCalledTimes(1);

    const [options] = mocks.eventBusEnableBackpressureImpl.mock.calls[0];
    expect(options).toMatchObject({
      maxQueueSize: 10000,
    });
  });

  it("rethrows backpressure errors in non-production and warns", async () => {
    process.env.NODE_ENV = "test";
    const error = new Error("boom");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mocks.eventBusEnableBackpressureImpl.mockImplementation(() => {
      throw error;
    });

    const container = createAgentContainer();

    await expect(container.get(ServiceId.EVENT_BUS)).rejects.toThrow(error);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to enable backpressure",
      { error }
    );
  });

  it("suppresses backpressure errors in production but still warns", async () => {
    process.env.NODE_ENV = "production";
    const error = new Error("boom");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mocks.eventBusEnableBackpressureImpl.mockImplementation(() => {
      throw error;
    });

    const container = createAgentContainer();
    const eventBus = await container.get(ServiceId.EVENT_BUS);

    expect(eventBus).toBe(mocks.eventBusInstances[0]);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to enable backpressure",
      { error }
    );
  });

  it("skips backpressure setup when unsupported", async () => {
    mocks.eventBusHasBackpressure = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const container = createAgentContainer();
    const eventBus = await container.get(ServiceId.EVENT_BUS);

    expect(mocks.eventBusEnableBackpressureImpl).not.toHaveBeenCalled();
    expect(mocks.enhanceEventBusWithHooks).toHaveBeenCalledWith(eventBus);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns the same singleton instance for concurrent and sequential calls", async () => {
    const container = createAgentContainer();

    const [first, second] = await Promise.all([
      container.get(ServiceId.EVENT_BUS),
      container.get(ServiceId.EVENT_BUS),
    ]);

    expect(first).toBe(second);
    expect(mocks.eventBusInstances.length).toBe(1);

    const lamportFirst = container.get(ServiceId.LAMPORT_CLOCK);
    const lamportSecond = container.get(ServiceId.LAMPORT_CLOCK);

    expect(lamportFirst).toBe(lamportSecond);
    expect(mocks.lamportClockInstances.length).toBe(1);
  });
});
