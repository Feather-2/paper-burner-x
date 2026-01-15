import { vi } from "vitest";

export function createFakeTime(startMs = 0) {
  let nowMs = Number.isFinite(startMs) ? Math.floor(startMs) : 0;
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += Math.max(0, Math.floor(ms || 0));
    },
    advance: (ms) => {
      nowMs += Math.max(0, Math.floor(ms || 0));
    },
  };
}

export function createCaptureLogger() {
  const calls = [];
  const make = (level) =>
    vi.fn((msg, meta) => {
      calls.push({ level, msg: String(msg), meta });
    });
  return {
    calls,
    logger: {
      debug: make("debug"),
      info: make("info"),
      warn: make("warn"),
      error: make("error"),
    },
  };
}

export function createMockStorage(initial = {}) {
  const store = new Map();
  for (const [k, v] of Object.entries(initial || {})) {
    store.set(String(k), String(v));
  }
  const storage = {
    getItem: vi.fn((key) => (store.has(String(key)) ? store.get(String(key)) : null)),
    setItem: vi.fn((key, value) => {
      store.set(String(key), String(value));
    }),
  };
  return { store, storage };
}

function normalizeOutcome(outcome) {
  if (typeof outcome === "function") return outcome;
  if (outcome instanceof Error) return { throw: outcome };
  if (typeof outcome === "string") return { content: outcome };
  if (outcome !== null && typeof outcome === "object") return outcome;
  return { content: String(outcome ?? "") };
}

/**
 * Minimal provider mock that supports per-model sequential outcomes.
 *
 * Outcomes can be:
 * - string => { content: string }
 * - Error => throw
 * - { content, throw, delayMs, usage } object
 * - (ctx) => any outcome (sync or async)
 */
export function createMockProvider({ id = "mock", behaviors = {}, defaultOutcome = { content: "" }, time = null } = {}) {
  const queues = new Map();
  for (const [modelId, outcomes] of Object.entries(behaviors || {})) {
    const list = Array.isArray(outcomes) ? outcomes : [outcomes];
    queues.set(
      String(modelId),
      list.map((o) => normalizeOutcome(o))
    );
  }

  const calls = [];

  const provider = {
    id: String(id),
    chat: vi.fn(async ({ model, messages, images } = {}) => {
      const m = String(model ?? "");
      const callIndex = calls.length;
      calls.push({ model: m, messages, images });

      const q = queues.get(m) || queues.get("*") || [];
      const next = q.length ? q.shift() : normalizeOutcome(defaultOutcome);
      if (queues.has(m)) queues.set(m, q);

      const resolved = typeof next === "function" ? await next({ model: m, messages, images, callIndex }) : next;
      const outcome = normalizeOutcome(resolved);

      const delayMs = typeof outcome.delayMs === "number" && outcome.delayMs > 0 ? Math.floor(outcome.delayMs) : 0;
      if (delayMs) {
        if (time && typeof time.sleep === "function") await time.sleep(delayMs);
      }

      if (outcome.throw) {
        throw outcome.throw instanceof Error ? outcome.throw : new Error(String(outcome.throw));
      }

      return {
        content: String(outcome.content ?? ""),
        ...(outcome.usage ? { usage: outcome.usage } : {}),
      };
    }),
  };

  const setBehaviors = (modelId, outcomes) => {
    const list = Array.isArray(outcomes) ? outcomes : [outcomes];
    queues.set(
      String(modelId),
      list.map((o) => normalizeOutcome(o))
    );
  };

  return { provider, calls, setBehaviors };
}

export async function withPatchedConsole(methods, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(methods || {})) {
    originals[k] = console[k];
    // eslint-disable-next-line no-console
    console[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      // eslint-disable-next-line no-console
      console[k] = v;
    }
  }
}

