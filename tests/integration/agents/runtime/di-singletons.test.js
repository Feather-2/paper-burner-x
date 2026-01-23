import { afterEach, describe, expect, it } from "vitest";

import { createAgentContainer, ServiceId } from '../../../../js/agents/core/di/index.js';
import { Container } from '../../../../js/agents/core/di/container.js';
import { getGlobalContainer, setGlobalContainer } from '../../../../js/agents/core/di/global-container.js';

afterEach(() => {
  setGlobalContainer(null);
});

describe("runtime/di global container", () => {
  it("returns a stable container and supports overrides", () => {
    const first = getGlobalContainer();
    const second = getGlobalContainer();
    expect(first).toBe(second);

    const override = new Container();
    setGlobalContainer(override);
    expect(getGlobalContainer()).toBe(override);

    setGlobalContainer(null);
    const recreated = getGlobalContainer();
    expect(recreated).toBeInstanceOf(Container);
    expect(recreated).not.toBe(override);
  });
});

describe("runtime/di singletons", () => {
  it("resolves singleton instances within the same container", async () => {
    const container = createAgentContainer();

    const ids = [
      ServiceId.LAMPORT_CLOCK,
      ServiceId.INJECTION_SCANNER,
      ServiceId.TOKEN_TRACKER,
      ServiceId.TOKEN_COUNTER,
      ServiceId.ERROR_BOUNDARY,
      ServiceId.CIRCUIT_BREAKER_REGISTRY,
      ServiceId.FILE_LOCK,
    ];

    for (const id of ids) {
      const a = await container.get(id);
      const b = await container.get(id);
      expect(a).toBe(b);
    }
  });

  it("isolates singleton instances across containers", async () => {
    const left = createAgentContainer();
    const right = createAgentContainer();

    const leftClock = await left.get(ServiceId.LAMPORT_CLOCK);
    const rightClock = await right.get(ServiceId.LAMPORT_CLOCK);
    expect(leftClock).not.toBe(rightClock);
    expect(leftClock.nextTick().seq).toBe(1);
    expect(rightClock.nextTick().seq).toBe(1);

    const leftScanner = await left.get(ServiceId.INJECTION_SCANNER);
    const rightScanner = await right.get(ServiceId.INJECTION_SCANNER);
    expect(leftScanner).not.toBe(rightScanner);

    const leftTracker = await left.get(ServiceId.TOKEN_TRACKER);
    const rightTracker = await right.get(ServiceId.TOKEN_TRACKER);
    expect(leftTracker).not.toBe(rightTracker);

    const leftCounter = await left.get(ServiceId.TOKEN_COUNTER);
    const rightCounter = await right.get(ServiceId.TOKEN_COUNTER);
    expect(leftCounter).not.toBe(rightCounter);

    const leftBoundary = await left.get(ServiceId.ERROR_BOUNDARY);
    const rightBoundary = await right.get(ServiceId.ERROR_BOUNDARY);
    expect(leftBoundary).not.toBe(rightBoundary);

    const leftLocks = await left.get(ServiceId.FILE_LOCK);
    const rightLocks = await right.get(ServiceId.FILE_LOCK);
    expect(leftLocks).not.toBe(rightLocks);
  });
});
