/**
 * @file tests/unit/agents/llm/internal/rate-limit.test.js
 * @description getRateLimiter tests for validation, boundary, and concurrency paths.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const instances = [];
  const TokenBucketRateLimiter = vi.fn(function TokenBucketRateLimiter(options) {
    this.options = options;
    instances.push(this);
  });

  return { instances, TokenBucketRateLimiter };
});

vi.mock("../../../../../js/agents/llm/rate-limit.js", () => ({
  TokenBucketRateLimiter: mocked.TokenBucketRateLimiter,
}));

import { getRateLimiter } from "../../../../../js/agents/llm/internal/rate-limit.js";

const makeTime = () => ({
  now: () => 0,
  sleep: async () => {},
});

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  return root;
};

describe("getRateLimiter", () => {
  let rateLimiters;
  let time;

  beforeEach(() => {
    rateLimiters = new Map();
    time = makeTime();
    mocked.instances.length = 0;
    mocked.TokenBucketRateLimiter.mockClear();
  });

  it.each([
    { label: "null", modelEntry: null },
    { label: "undefined", modelEntry: undefined },
    { label: "empty string", modelEntry: "" },
    { label: "empty array", modelEntry: [] },
    { label: "empty object", modelEntry: {} },
  ])("returns null when modelEntry is $label", ({ modelEntry }) => {
    const limiter = getRateLimiter({ rateLimiters, modelEntry, time });

    expect(limiter).toBeNull();
    expect(rateLimiters.size).toBe(0);
    expect(mocked.TokenBucketRateLimiter).not.toHaveBeenCalled();
  });

  it("returns null when id is an empty string", () => {
    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: "", limits: { rateLimit: 1 } },
      time,
    });

    expect(limiter).toBeNull();
    expect(rateLimiters.size).toBe(0);
    expect(mocked.TokenBucketRateLimiter).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing limits", modelEntry: { id: "model" } },
    { label: "empty limits", modelEntry: { id: "model", limits: {} } },
    {
      label: "rateLimit undefined",
      modelEntry: { id: "model", limits: { rateLimit: undefined } },
    },
    { label: "rateLimit null", modelEntry: { id: "model", limits: { rateLimit: null } } },
    { label: "rateLimit 0", modelEntry: { id: "model", limits: { rateLimit: 0 } } },
    { label: "rateLimit empty string", modelEntry: { id: "model", limits: { rateLimit: "" } } },
  ])("returns null when $label", ({ modelEntry }) => {
    const limiter = getRateLimiter({ rateLimiters, modelEntry, time });

    expect(limiter).toBeNull();
    expect(rateLimiters.size).toBe(0);
    expect(mocked.TokenBucketRateLimiter).not.toHaveBeenCalled();
  });

  it("returns null when rateLimit is whitespace", () => {
    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: "model", limits: { rateLimit: "   " } },
      time,
    });

    expect(limiter).toBeNull();
    expect(rateLimiters.size).toBe(0);
    expect(mocked.TokenBucketRateLimiter).not.toHaveBeenCalled();
  });

  it.each([
    { label: "negative", rateLimit: -1 },
    { label: "non-numeric string", rateLimit: "not-a-number" },
    { label: "array", rateLimit: [] },
    { label: "array-like object", rateLimit: { 0: 1, length: 1 } },
    { label: "plain object", rateLimit: {} },
  ])("returns null when rateLimit is $label", ({ rateLimit }) => {
    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: "model", limits: { rateLimit } },
      time,
    });

    expect(limiter).toBeNull();
    expect(rateLimiters.size).toBe(0);
    expect(mocked.TokenBucketRateLimiter).not.toHaveBeenCalled();
  });

  it("creates a limiter when rateLimit is a numeric string", () => {
    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: "model", limits: { rateLimit: "5" } },
      time,
    });

    expect(limiter).toBe(mocked.instances[0]);
    expect(rateLimiters.get("model")).toBe(limiter);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledTimes(1);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledWith({
      rps: 5,
      burst: 1,
      concurrency: 1,
      maxQueue: 500,
      time,
    });
  });

  it("creates a limiter when rateLimit is MAX_SAFE_INTEGER", () => {
    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: "model", limits: { rateLimit: Number.MAX_SAFE_INTEGER } },
      time,
    });

    expect(limiter).toBe(mocked.instances[0]);
    expect(rateLimiters.get("model")).toBe(limiter);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledTimes(1);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledWith({
      rps: Number.MAX_SAFE_INTEGER,
      burst: 1,
      concurrency: 1,
      maxQueue: 500,
      time,
    });
  });

  it("creates a limiter when rateLimit is Infinity", () => {
    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: "model", limits: { rateLimit: Infinity } },
      time,
    });

    expect(limiter).toBe(mocked.instances[0]);
    expect(rateLimiters.get("model")).toBe(limiter);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledWith({
      rps: Infinity,
      burst: 1,
      concurrency: 1,
      maxQueue: 500,
      time,
    });
  });

  it("reuses an existing limiter without creating a new one", () => {
    const existing = { name: "existing" };
    rateLimiters.set("model", existing);

    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: "model", limits: { rateLimit: 3 } },
      time,
    });

    expect(limiter).toBe(existing);
    expect(mocked.TokenBucketRateLimiter).not.toHaveBeenCalled();
  });

  it("returns the same limiter on rapid sequential calls", () => {
    const modelEntry = { id: "model", limits: { rateLimit: 2 } };

    const first = getRateLimiter({ rateLimiters, modelEntry, time });
    const second = getRateLimiter({ rateLimiters, modelEntry, time });
    const third = getRateLimiter({ rateLimiters, modelEntry, time });

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledTimes(1);
  });

  it("returns the same limiter for simultaneous calls", async () => {
    const modelEntry = { id: "model", limits: { rateLimit: 2 } };

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => getRateLimiter({ rateLimiters, modelEntry, time })),
      Promise.resolve().then(() => getRateLimiter({ rateLimiters, modelEntry, time })),
    ]);

    expect(first).toBe(second);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledTimes(1);
  });

  it("handles a very long id string representing large payloads", () => {
    const hugeId = `file:${"a".repeat(200000)}`;
    const limiter = getRateLimiter({
      rateLimiters,
      modelEntry: { id: hugeId, limits: { rateLimit: 1 } },
      time,
    });

    expect(limiter).toBe(mocked.instances[0]);
    expect(rateLimiters.get(hugeId)).toBe(limiter);
    expect(mocked.TokenBucketRateLimiter).toHaveBeenCalledTimes(1);
  });

  it("handles deep nested model entries with valid limits", () => {
    const modelEntry = {
      id: "deep",
      limits: { rateLimit: 1, nested: buildDeepObject(40) },
    };

    const limiter = getRateLimiter({ rateLimiters, modelEntry, time });

    expect(limiter).toBe(mocked.instances[0]);
    expect(rateLimiters.get("deep")).toBe(limiter);
  });
});
