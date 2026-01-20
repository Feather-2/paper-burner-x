import { describe, it, expect, vi, beforeEach } from "vitest";

const sseMocks = vi.hoisted(() => ({
  parseSseStream: vi.fn(),
}));

const sharedMocks = vi.hoisted(() => ({
  normalizeMaxBytes: vi.fn(),
  readJsonWithLimit: vi.fn(),
}));

vi.mock("../../../../js/agents/mcp/sse.js", () => ({
  parseSseStream: sseMocks.parseSseStream,
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  normalizeMaxBytes: sharedMocks.normalizeMaxBytes,
  readJsonWithLimit: sharedMocks.readJsonWithLimit,
}));

import NexusSkillProviderDefault, { NexusSkillProvider } from "../../../../js/agents/mcp/nexus-skill-provider.js";

function makeResponse({ ok = true, status = 200, headers = {}, body = null } = {}) {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]));
  return {
    ok,
    status,
    headers: {
      get: (name) => headerMap.get(String(name).toLowerCase()) || "",
    },
    body,
  };
}

function buildDeepObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeAsyncIterable(events) {
  return (async function* () {
    for (const evt of events) {
      if (evt instanceof Error) throw evt;
      yield evt;
    }
  })();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected global fetch");
    }),
  );

  sharedMocks.normalizeMaxBytes.mockImplementation((value, fallback) => {
    if (value === Infinity) return Infinity;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const n = Math.floor(parsed);
    return n > 0 ? n : fallback;
  });
  sharedMocks.readJsonWithLimit.mockResolvedValue({});
  sseMocks.parseSseStream.mockImplementation(() => makeAsyncIterable([]));
});

describe("NexusSkillProvider", () => {
  it("normalizes baseUrl, wires limits, and sets headers", () => {
    sharedMocks.normalizeMaxBytes.mockImplementation((value, fallback) => {
      if (value === "2048") return 2048;
      if (value === undefined && fallback === 2048) return 4096;
      return fallback;
    });

    const provider = new NexusSkillProvider({
      baseUrl: "http://localhost:3000///",
      authToken: "tok",
      timeout: 0,
      cacheEnabled: false,
      cacheTTL: Number.MAX_SAFE_INTEGER,
      maxResponseBytes: "2048",
      allowedHosts: {},
    });

    expect(provider.baseUrl).toBe("http://localhost:3000");
    expect(provider.authToken).toBe("tok");
    expect(provider.timeout).toBe(0);
    expect(provider.cacheEnabled).toBe(false);
    expect(provider.cacheTTL).toBe(Number.MAX_SAFE_INTEGER);
    expect(provider.maxResponseBytes).toBe(2048);
    expect(provider.maxSkillContentBytes).toBe(4096);
    expect(sharedMocks.normalizeMaxBytes).toHaveBeenCalledTimes(2);
    expect(sharedMocks.normalizeMaxBytes.mock.calls[1][1]).toBe(2048);

    expect(provider._getHeaders()).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok",
    });
  });

  it("throws on empty or invalid baseUrl values", () => {
    const cases = [null, undefined, "", "   "];
    for (const value of cases) {
      expect(() => new NexusSkillProvider({ baseUrl: value })).toThrow(/baseUrl is required/i);
    }
    expect(() => new NexusSkillProvider({ baseUrl: "ftp://example.com" })).toThrow(/unsupported URL protocol/i);
  });

  it("blocks private hosts unless allowed and enforces allowlist", () => {
    expect(() => new NexusSkillProvider({ baseUrl: "http://127.0.0.1:3000" })).toThrow(/blocked URL hostname/i);

    const privateAllowed = new NexusSkillProvider({
      baseUrl: "http://127.0.0.1:3000",
      allowPrivateNetwork: true,
    });
    expect(privateAllowed.baseUrl).toBe("http://127.0.0.1:3000");

    const allowlisted = new NexusSkillProvider({
      baseUrl: "http://127.0.0.1:3000",
      allowedHosts: ["127.0.0.1"],
    });
    expect(allowlisted.baseUrl).toBe("http://127.0.0.1:3000");

    expect(
      () =>
        new NexusSkillProvider({
          baseUrl: "https://example.com",
          allowedHosts: ["allowed.example.com"],
        }),
    ).toThrow(/not in allowlist/i);

    expect(
      () =>
        new NexusSkillProvider({
          baseUrl: "http://localhost:3000",
          allowedHosts: [],
        }),
    ).toThrow(/blocked URL hostname/i);
  });

  it("_readJson handles fallbacks and response-size errors", async () => {
    const provider = new NexusSkillProvider();

    const tooLarge = new Error("too large");
    tooLarge.name = "ResponseTooLargeError";
    sharedMocks.readJsonWithLimit.mockRejectedValueOnce(tooLarge);
    await expect(provider._readJson({}, { maxBytes: 1, context: "ctx", fallback: { ok: true } })).rejects.toThrow(
      "too large",
    );

    const fallback = { ok: true };
    sharedMocks.readJsonWithLimit.mockRejectedValueOnce(new Error("boom"));
    await expect(provider._readJson({}, { fallback })).resolves.toBe(fallback);

    sharedMocks.readJsonWithLimit.mockRejectedValueOnce(new Error("boom2"));
    await expect(provider._readJson({}, {})).rejects.toThrow("boom2");

    sharedMocks.readJsonWithLimit.mockResolvedValueOnce({ ok: true });
    await expect(provider._readJson({}, {})).resolves.toEqual({ ok: true });
  });

  it("isAvailable updates connected state and handles errors", async () => {
    const provider = new NexusSkillProvider();
    const fetchSpy = vi.spyOn(provider, "_fetch");

    fetchSpy.mockResolvedValueOnce({ ok: true });
    await expect(provider.isAvailable()).resolves.toBe(true);
    expect(provider.connected).toBe(true);

    fetchSpy.mockResolvedValueOnce({ ok: false });
    await expect(provider.isAvailable()).resolves.toBe(false);
    expect(provider.connected).toBe(false);

    fetchSpy.mockRejectedValueOnce(new Error("fail"));
    await expect(provider.isAvailable()).resolves.toBe(false);
    expect(provider.connected).toBe(false);
  });

  it("listSkills caches results and supports rapid consecutive calls", async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ ok: true, status: 200 }));
    sharedMocks.readJsonWithLimit.mockResolvedValueOnce({
      skills: [{ name: "s1", description: "d1" }],
    });

    const provider = new NexusSkillProvider({ cacheTTL: Number.MAX_SAFE_INTEGER });
    const first = await provider.listSkills();
    const second = await provider.listSkills();

    expect(first).toEqual([{ name: "s1", description: "d1" }]);
    expect(second).toEqual([{ name: "s1", description: "d1" }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("listSkills returns empty array when skills payload is missing", async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ ok: true, status: 200 }));
    sharedMocks.readJsonWithLimit.mockResolvedValueOnce({});

    const provider = new NexusSkillProvider({ cacheEnabled: false });
    const result = await provider.listSkills();
    expect(result).toEqual([]);
  });

  it("listSkills throws on non-ok response", async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ ok: false, status: 503 }));

    const provider = new NexusSkillProvider();
    await expect(provider.listSkills()).rejects.toThrow("Failed to list skills: 503");
  });

  it("listSkills expires cache when cacheTTL is negative", async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ ok: true, status: 200 }));
    sharedMocks.readJsonWithLimit.mockResolvedValue({ skills: [] });

    const provider = new NexusSkillProvider({ cacheTTL: -1 });
    await provider.listSkills();
    await provider.listSkills();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("listSkills does not share inflight work across concurrent calls", async () => {
    globalThis.fetch.mockResolvedValue(makeResponse({ ok: true, status: 200 }));
    const first = createDeferred();
    const second = createDeferred();
    sharedMocks.readJsonWithLimit.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const provider = new NexusSkillProvider();
    const p1 = provider.listSkills();
    const p2 = provider.listSkills();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    first.resolve({ skills: [] });
    second.resolve({ skills: [] });

    await expect(Promise.all([p1, p2])).resolves.toEqual([[], []]);
  });

  it("getSkillContent caches and returns large content payloads", async () => {
    const body = "x".repeat(1024 * 1024);
    const metadata = buildDeepObject(32);
    const content = { body, supportFiles: {}, metadata };

    globalThis.fetch.mockResolvedValue(makeResponse({ ok: true, status: 200 }));
    sharedMocks.readJsonWithLimit.mockResolvedValueOnce(content);

    const provider = new NexusSkillProvider({ cacheTTL: Number.MAX_SAFE_INTEGER });
    const first = await provider.getSkillContent("alpha");
    const second = await provider.getSkillContent("alpha");

    expect(first.body.length).toBe(body.length);
    expect(first.supportFiles).toEqual({});
    expect(first.metadata).toEqual(metadata);
    expect(second).toEqual(first);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("getSkillContent handles 404 and other error responses", async () => {
    const provider = new NexusSkillProvider();

    globalThis.fetch.mockResolvedValueOnce(makeResponse({ ok: false, status: 404 }));
    await expect(provider.getSkillContent("missing")).rejects.toThrow("Skill not found: missing");

    globalThis.fetch.mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }));
    await expect(provider.getSkillContent("bad")).rejects.toThrow("Failed to get skill content: 500");
  });

  it("executeTool returns results and surfaces errors", async () => {
    const provider = new NexusSkillProvider();
    const fetchSpy = vi.spyOn(provider, "_fetch");

    fetchSpy.mockResolvedValueOnce(makeResponse({ ok: true, status: 200 }));
    sharedMocks.readJsonWithLimit.mockResolvedValueOnce({ ok: true });

    const out = await provider.executeTool("tool1", { nested: { a: 1 } }, { traceId: "t1" });
    expect(out).toEqual({ ok: true });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({ toolId: "tool1", params: { nested: { a: 1 } }, traceId: "t1" });

    fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 400 }));
    sharedMocks.readJsonWithLimit.mockResolvedValueOnce({ message: "Bad request" });
    await expect(provider.executeTool("tool2", {})).rejects.toThrow("Bad request");

    fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }));
    sharedMocks.readJsonWithLimit.mockRejectedValueOnce(new Error("nope"));
    await expect(provider.executeTool("tool3", {})).rejects.toThrow("Tool execution failed: 500");
  });

  it("executeWorkflow returns results and surfaces errors", async () => {
    const provider = new NexusSkillProvider();
    const fetchSpy = vi.spyOn(provider, "_fetch");

    const context = { deep: buildDeepObject(4) };
    fetchSpy.mockResolvedValueOnce(makeResponse({ ok: true, status: 200 }));
    sharedMocks.readJsonWithLimit.mockResolvedValueOnce({ ok: true, result: "done" });

    const out = await provider.executeWorkflow("goal", [{ step: "a" }], context);
    expect(out).toEqual({ ok: true, result: "done" });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({ goal: "goal", steps: [{ step: "a" }], context });

    fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 418 }));
    sharedMocks.readJsonWithLimit.mockResolvedValueOnce({ message: "Nope" });
    await expect(provider.executeWorkflow("goal2", [], {})).rejects.toThrow("Nope");

    fetchSpy.mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }));
    sharedMocks.readJsonWithLimit.mockRejectedValueOnce(new Error("fail"));
    await expect(provider.executeWorkflow("goal3", [], {})).rejects.toThrow("Workflow execution failed: 500");
  });

  it("streamExecution emits parsed messages and ignores invalid payloads", async () => {
    const provider = new NexusSkillProvider({ authToken: "tok", timeout: 0 });
    const events = [
      { data: JSON.stringify({ ok: true }) },
      { data: "   " },
      { data: "{bad" },
      { data: JSON.stringify({ ok: false, value: 0 }) },
    ];

    sseMocks.parseSseStream.mockImplementation(() => makeAsyncIterable(events));
    globalThis.fetch.mockResolvedValue(
      makeResponse({
        ok: true,
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: { stream: true },
      }),
    );

    const onMessage = vi.fn();
    await provider.streamExecution("/api/stream", { a: 1 }, onMessage);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/stream");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer tok",
    });
    expect(JSON.parse(init.body)).toEqual({ a: 1 });

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage.mock.calls[0][0]).toEqual({ ok: true });
    expect(onMessage.mock.calls[1][0]).toEqual({ ok: false, value: 0 });
    expect(sseMocks.parseSseStream.mock.calls[0][1]).toMatchObject({ readTimeoutMs: 60000 });
  });

  it("streamExecution forwards errors to onError when provided", async () => {
    const provider = new NexusSkillProvider();
    globalThis.fetch.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 500,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const onError = vi.fn();
    await provider.streamExecution("/api/stream", {}, undefined, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("streamExecution throws on unexpected content types", async () => {
    const provider = new NexusSkillProvider();
    globalThis.fetch.mockResolvedValue(
      makeResponse({
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
        body: {},
      }),
    );

    await expect(provider.streamExecution("/api/stream", {}, () => {})).rejects.toThrow(/unexpected content-type/i);
  });

  it("createRegistrations builds definitions and handlers", async () => {
    const provider = new NexusSkillProvider();
    const skills = [
      {
        name: "alpha",
        description: "Alpha",
        priority: 2,
        mutexKey: "m",
        version: "1.0",
        allowedTools: ["t1"],
      },
      { name: "beta", description: "Beta" },
    ];
    const content = { body: "body", supportFiles: {}, metadata: { extra: true } };

    const listSpy = vi.spyOn(provider, "listSkills").mockResolvedValue(skills);
    const contentSpy = vi.spyOn(provider, "getSkillContent").mockResolvedValue(content);

    const registrations = await provider.createRegistrations();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(registrations).toHaveLength(2);

    const [first, second] = registrations;
    expect(first.definition).toMatchObject({
      name: "alpha",
      description: "Alpha",
      priority: 2,
      mutexKey: "m",
      metadata: { source: "nexus", version: "1.0", allowedTools: ["t1"] },
    });
    expect(second.definition).toMatchObject({
      name: "beta",
      description: "Beta",
      priority: 0,
      mutexKey: null,
      metadata: { source: "nexus" },
    });

    const handlerOut = await first.handler({ q: 1 }, { user: "x" });
    expect(contentSpy).toHaveBeenCalledWith("alpha");
    expect(handlerOut).toEqual({
      skill: "alpha",
      output: { body: "body", support_files: {} },
      metadata: { extra: true },
    });
  });

  it("clearCache and invalidateCache manage entries", () => {
    const provider = new NexusSkillProvider();
    provider.cache.set("skills:list", { data: [1], timestamp: Date.now() });
    provider.cache.set("skills:content:alpha", { data: { body: "" }, timestamp: Date.now() });
    provider.cache.set("other", { data: "x", timestamp: Date.now() });

    provider.invalidateCache("skills:");
    expect(provider.cache.has("skills:list")).toBe(false);
    expect(provider.cache.has("skills:content:alpha")).toBe(false);
    expect(provider.cache.has("other")).toBe(true);

    provider.cache.set("skills:list", { data: [1], timestamp: Date.now() });
    provider.invalidateCache("");
    expect(provider.cache.size).toBe(0);

    provider.cache.set("skills:list", { data: [1], timestamp: Date.now() });
    provider.clearCache();
    expect(provider.cache.size).toBe(0);
  });
});

describe("default export", () => {
  it("matches NexusSkillProvider", () => {
    expect(NexusSkillProviderDefault).toBe(NexusSkillProvider);
  });
});
