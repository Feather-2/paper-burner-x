const test = require("node:test");
const assert = require("node:assert/strict");

function makeTextResponse(text, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return String(text || "");
    },
    async json() {
      throw new Error("json not implemented");
    },
  };
}

function makeJsonResponse(json, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(json);
    },
    async json() {
      return json;
    },
  };
}

function createFetchMock() {
  const calls = [];
  const handlers = [];

  const fetchImpl = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options: options || {} });
    for (const h of handlers) {
      if (h.match(u, options)) return h.handle(u, options);
    }
    throw new Error(`Unexpected fetch: ${u}`);
  };

  fetchImpl.calls = calls;
  fetchImpl.when = (match, handle) => handlers.push({ match, handle });
  return fetchImpl;
}

function withFakeNow(startMs, fn) {
  const realNow = Date.now;
  let nowMs = startMs;
  Date.now = () => nowMs;
  const api = {
    now: () => nowMs,
    set: (ms) => {
      nowMs = ms;
    },
    advance: (ms) => {
      nowMs += Math.max(0, Math.floor(ms || 0));
    },
  };

  return Promise.resolve()
    .then(() => fn(api))
    .finally(() => {
      Date.now = realNow;
    });
}

function longHtml(extra = "") {
  return `<!doctype html><html><head>${extra}</head><body>${"x".repeat(200)}</body></html>`;
}

test("LocalMcpProvider: workerEndpoint success skips CORS proxies (search)", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when(
    (url) => url === "https://worker.example/search",
    async () =>
      makeJsonResponse({
        success: true,
        results: [{ title: "t", url: "https://example.com", snippet: "s" }],
      })
  );

  const provider = new LocalMcpProvider({
    workerEndpoint: "https://worker.example",
    corsProxies: ["https://p1/?"],
    fetchImpl: fetchMock,
  });

  const out = await provider.callTool("search", { query: "hello" });
  assert.equal(out.success, true);
  assert.equal(fetchMock.calls.length, 1);
  assert.equal(fetchMock.calls[0].url, "https://worker.example/search");
});

test("LocalMcpProvider: workerEndpoint failure falls back to CORS proxies (search)", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when((url) => url === "https://worker.example/search", async () => makeJsonResponse({ success: false, error: "down" }));

  fetchMock.when(
    (url) => url.startsWith("https://p1/?"),
    async () =>
      makeTextResponse(
        longHtml(
          [
            '<a href="https://duckduckgo.com/">ddg</a>',
            '<a href="https://example.com">Example Title</a>',
            '<a href="https://example.org">Another</a>',
          ].join("")
        )
      )
  );

  const provider = new LocalMcpProvider({
    workerEndpoint: "https://worker.example",
    corsProxies: ["https://p1/?", "https://p2/?"],
    fetchImpl: fetchMock,
  });

  const out = await provider.callTool("search", { query: "hello", domain: "example.com", time_range: "week", limit: 2 });
  assert.equal(out.success, true);

  assert.equal(fetchMock.calls.length, 2);
  assert.equal(fetchMock.calls[0].url, "https://worker.example/search");
  assert.ok(fetchMock.calls[1].url.startsWith("https://p1/?"));

  const { options } = fetchMock.calls[1];
  assert.equal(options.method, "GET");
  assert.equal(options.mode, "cors");
  assert.ok(options.signal, "expected AbortSignal");
  assert.equal(options.headers.Accept.includes("text/html"), true);
  assert.equal(typeof options.headers["Accept-Language"], "string");

  const encoded = fetchMock.calls[1].url.slice("https://p1/?".length);
  const decoded = decodeURIComponent(encoded);
  assert.ok(decoded.startsWith("https://html.duckduckgo.com/html/?"));
  assert.ok(decoded.includes("q=site%3Aexample.com"), "expected site:domain injected and encoded");
});

test("LocalMcpProvider: workerEndpoint success skips CORS proxies (fetch_content)", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when(
    (url) => url === "https://worker.example/fetch",
    async () =>
      makeJsonResponse({
        success: true,
        title: "T",
        extractedText: "X".repeat(300),
        metadata: { url: "https://site.example/page", fetchedAt: "2020-01-01T00:00:00.000Z" },
      })
  );

  const provider = new LocalMcpProvider({
    workerEndpoint: "https://worker.example",
    corsProxies: ["https://p1/?"],
    fetchImpl: fetchMock,
  });

  const out = await provider.callTool("fetch_content", { url: "https://site.example/page" });
  assert.equal(out.success, true);
  assert.equal(fetchMock.calls.length, 1);
  assert.equal(fetchMock.calls[0].url, "https://worker.example/fetch");
});

test("LocalMcpProvider: workerEndpoint failure falls back to CORS proxies (fetch_content) and extracts metadata", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when((url) => url === "https://worker.example/fetch", async () => makeJsonResponse({ success: false, error: "down" }));

  fetchMock.when(
    (url) => url.startsWith("https://p1/?"),
    async () =>
      makeTextResponse(
        longHtml(
          [
            "<title>My &amp; Title</title>",
            '<meta content="Second desc" name="description">',
            "<style>body{font-size:14px;background:#fff;}</style>",
            "<script>var x = 1;</script>",
            "<noscript>no</noscript>",
            "<svg><path d='x'></path></svg>",
            "<body>Hello&nbsp;world https://evil.example url(test) <div>More</div></body>",
          ].join("")
        )
      )
  );

  const provider = new LocalMcpProvider({
    workerEndpoint: "https://worker.example",
    corsProxies: ["https://p1/?"],
    fetchImpl: fetchMock,
  });

  const out = await provider.callTool("fetch_content", { url: "https://site.example/page" });
  assert.equal(out.success, true);

  const json = out.content.find((c) => c.type === "json")?.data;
  assert.ok(json && json.metadata);
  assert.equal(json.metadata.url, "https://site.example/page");
  assert.equal(json.metadata.title, "My & Title");
  assert.equal(json.metadata.description, "Second desc");
  assert.equal(json.metadata.proxy, "https://p1/?");

  const text = out.content.find((c) => c.type === "text")?.text || "";
  assert.ok(text.includes("Hello world"));
  assert.equal(text.includes("https://evil.example"), false);
  assert.equal(text.includes("var x"), false);
  assert.equal(text.includes("font-size"), false);
});

test("LocalMcpProvider: corsProxies injection + in-order attempts", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when((url) => url.startsWith("https://p1/?"), async () => {
    throw new Error("p1");
  });
  fetchMock.when((url) => url.startsWith("https://p2/?"), async () => makeTextResponse(longHtml("<title>ok</title>")));

  const provider = new LocalMcpProvider({
    corsProxies: ["https://p1/?", "https://p2/?"],
    fetchImpl: fetchMock,
  });

  const out = await provider._fetchWithCorsFallback("https://target.example/page", { timeoutMs: 1234, tryDirect: false });
  assert.equal(out.proxy, "https://p2/?");
  assert.equal(fetchMock.calls.length, 2);
  assert.ok(fetchMock.calls[0].url.startsWith("https://p1/?"));
  assert.ok(fetchMock.calls[1].url.startsWith("https://p2/?"));
});

test("LocalMcpProvider: all proxies fail -> AggregateError includes all reasons", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when((url) => url.startsWith("https://p1/?"), async () => {
    throw new Error("e1");
  });
  fetchMock.when((url) => url.startsWith("https://p2/?"), async () => {
    throw new Error("e2");
  });

  const provider = new LocalMcpProvider({
    corsProxies: ["https://p1/?", "https://p2/?"],
    fetchImpl: fetchMock,
  });

  await assert.rejects(
    () => provider._fetchWithCorsFallback("https://target.example/fail", { tryDirect: false }),
    (err) => {
      assert.ok(err instanceof AggregateError);
      assert.equal(err.errors.length, 2);
      assert.ok(err.errors[0].message.includes("e1"));
      assert.ok(err.errors[1].message.includes("e2"));
      return true;
    }
  );
});

test("LocalMcpProvider: last-good proxy is preferred on next request", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  let p2Count = 0;

  fetchMock.when((url) => url.startsWith("https://p1/?"), async () => {
    throw new Error("p1-down");
  });
  fetchMock.when((url) => url.startsWith("https://p2/?"), async () => {
    p2Count += 1;
    return makeTextResponse(longHtml("<title>ok</title>"));
  });

  const provider = new LocalMcpProvider({
    corsProxies: ["https://p1/?", "https://p2/?"],
    fetchImpl: fetchMock,
  });

  await provider._fetchWithCorsFallback("https://target.example/1", { tryDirect: false });
  assert.equal(p2Count, 1);

  const before = fetchMock.calls.length;
  await provider._fetchWithCorsFallback("https://target.example/2", { tryDirect: false });
  const afterCalls = fetchMock.calls.slice(before);

  assert.equal(afterCalls.length, 1);
  assert.ok(afterCalls[0].url.startsWith("https://p2/?"));
});

test("LocalMcpProvider: failed proxy cooldown skips within window", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  await withFakeNow(0, async (time) => {
    const fetchMock = createFetchMock();
    let p2Attempt = 0;

    fetchMock.when((url) => url.startsWith("https://p1/?"), async () => {
      throw new Error("p1-fail");
    });
    fetchMock.when((url) => url.startsWith("https://p2/?"), async () => {
      p2Attempt += 1;
      if (p2Attempt === 1) return makeTextResponse(longHtml("<title>ok</title>"));
      throw new Error("p2-fail");
    });
    fetchMock.when((url) => url.startsWith("https://p3/?"), async () => makeTextResponse(longHtml("<title>ok3</title>")));

    const provider = new LocalMcpProvider({
      corsProxies: ["https://p1/?", "https://p2/?", "https://p3/?"],
      fetchImpl: fetchMock,
    });

    await provider._fetchWithCorsFallback("https://target.example/a", { tryDirect: false });

    time.advance(1);
    await provider._fetchWithCorsFallback("https://target.example/b", { tryDirect: false });

    const secondAttemptUrls = fetchMock.calls.slice(2).map((c) => c.url);
    assert.ok(secondAttemptUrls[0].startsWith("https://p2/?"));
    assert.ok(secondAttemptUrls[1].startsWith("https://p3/?"));
    assert.equal(secondAttemptUrls.some((u) => u.startsWith("https://p1/?")), false);
  });
});

test("LocalMcpProvider: proxyCooldownMs configurable + proxy re-enters after cooldown", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  await withFakeNow(0, async (time) => {
    const fetchMock = createFetchMock();
    let p1Call = 0;
    let p2Call = 0;
    let p3Call = 0;

    fetchMock.when((url) => url.startsWith("https://p1/?"), async () => {
      p1Call += 1;
      if (p1Call === 1) throw new Error("p1-fail-1");
      return makeTextResponse(longHtml("<title>p1-back</title>"));
    });
    fetchMock.when((url) => url.startsWith("https://p2/?"), async () => {
      p2Call += 1;
      if (p2Call === 1) return makeTextResponse(longHtml("<title>p2-ok</title>"));
      throw new Error("p2-fail");
    });
    fetchMock.when((url) => url.startsWith("https://p3/?"), async () => {
      p3Call += 1;
      if (p3Call <= 1) return makeTextResponse(longHtml("<title>p3-ok</title>"));
      throw new Error("p3-fail");
    });

    const provider = new LocalMcpProvider({
      corsProxies: ["https://p1/?", "https://p2/?", "https://p3/?"],
      proxyCooldownMs: 1000,
      fetchImpl: fetchMock,
    });

    await provider._fetchWithCorsFallback("https://target.example/1", { tryDirect: false });

    time.set(500);
    await provider._fetchWithCorsFallback("https://target.example/2", { tryDirect: false });
    const secondUrls = fetchMock.calls.slice(2).map((c) => c.url);
    assert.equal(secondUrls.some((u) => u.startsWith("https://p1/?")), false);

    time.set(1001);
    await provider._fetchWithCorsFallback("https://target.example/3", { tryDirect: false });
    const thirdUrls = fetchMock.calls.slice(4).map((c) => c.url);
    assert.ok(thirdUrls[0].startsWith("https://p3/?"), "last-good should be tried first");
    assert.ok(thirdUrls[1].startsWith("https://p1/?"), "p1 should re-enter after cooldown");
    assert.equal(thirdUrls.some((u) => u.startsWith("https://p2/?")), false, "p2 should still be in cooldown");
  });
});

test("LocalMcpProvider: direct fetch uses mode:cors (no 'no-cors')", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when((url) => url === "https://site.example/page", async () => makeTextResponse(longHtml("<title>x</title>")));

  const provider = new LocalMcpProvider({
    corsProxies: [""],
    fetchImpl: fetchMock,
  });

  await provider._fetchWithCorsFallback("https://site.example/page", { tryDirect: true });
  assert.equal(fetchMock.calls.length, 1);
  assert.equal(fetchMock.calls[0].options.mode, "cors");
});

test("LocalMcpProvider: returns tool errors for invalid inputs and unknown tools", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const provider = new LocalMcpProvider({ fetchImpl: async () => makeTextResponse(longHtml("<title>x</title>")) });

  const badSearch = await provider.callTool("search", {});
  assert.equal(badSearch.success, false);
  assert.match(badSearch.error, /query is required/);

  const badFetch = await provider.callTool("fetch_content", {});
  assert.equal(badFetch.success, false);
  assert.match(badFetch.error, /url is required/);

  const unknown = await provider.callTool("unknown_tool", {});
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /Unknown tool/);
});

test("LocalMcpProvider: proxy fetch schedules timeout using provided timeoutMs", async () => {
  const { LocalMcpProvider } = await import("../../js/agents/mcp/local-mcp-provider.js");

  const fetchMock = createFetchMock();
  fetchMock.when((url) => url.startsWith("https://p1/?"), async () => makeTextResponse(longHtml("<title>ok</title>")));

  const provider = new LocalMcpProvider({
    corsProxies: ["https://p1/?"],
    fetchImpl: fetchMock,
  });

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timeouts = [];
  const cleared = [];
  globalThis.setTimeout = (fn, ms, ...rest) => {
    timeouts.push(ms);
    return 123;
  };
  globalThis.clearTimeout = (id) => {
    cleared.push(id);
  };

  try {
    await provider._fetchWithCorsFallback("https://target.example/t", { tryDirect: false, timeoutMs: 4321 });
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }

  assert.deepEqual(timeouts, [4321]);
  assert.deepEqual(cleared, [123]);
});
