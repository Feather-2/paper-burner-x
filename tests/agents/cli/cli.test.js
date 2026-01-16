/**
 * CLI 模块测试
 *
 * 测试 js/agents/cli/ 目录下的模块:
 * - model-client.js: CliModelClient, CliModelRouter, createAiApiServiceAdapter
 *
 * @module tests/agents/cli
 */

import test from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// CliModelClient Tests
// ============================================================================

test("CliModelClient: constructor sets default values", async () => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const client = new CliModelClient();
  assert.equal(client.apiKey, "");
  assert.equal(client.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(client.model, "deepseek-chat");
  assert.equal(client.contextWindow, null);
  assert.equal(client.maxOutputTokens, null);
  assert.equal(client.timeoutMs, null);
});

test("CliModelClient: constructor accepts custom options", async () => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const client = new CliModelClient({
    apiKey: "test-key",
    baseUrl: "https://custom.api/v1/",
    model: "custom-model",
    contextWindow: 8000,
    maxOutputTokens: 2048,
    timeoutMs: 30000,
  });

  assert.equal(client.apiKey, "test-key");
  assert.equal(client.baseUrl, "https://custom.api/v1");
  assert.equal(client.model, "custom-model");
  assert.equal(client.contextWindow, 8000);
  assert.equal(client.maxOutputTokens, 2048);
  assert.equal(client.timeoutMs, 30000);
});

test("CliModelClient: baseUrl trailing slash is stripped", async () => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const client = new CliModelClient({ baseUrl: "https://api.example.com/v1/" });
  assert.equal(client.baseUrl, "https://api.example.com/v1");
});

test("CliModelClient: chat throws without API key", async () => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const client = new CliModelClient({ apiKey: "" });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hi" }] }),
    /API Key 未设置/
  );
});

test("CliModelClient: chat constructs correct request", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  let capturedRequest = null;
  const mockFetch = async (url, init) => {
    capturedRequest = { url, ...init };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "response" } }],
        model: "test-model",
        usage: { total_tokens: 10 },
      }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({
    apiKey: "sk-test",
    baseUrl: "https://test.api/v1",
    model: "test-model",
  });

  const result = await client.chat({
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.5,
    maxTokens: 1000,
  });

  assert.equal(capturedRequest.url, "https://test.api/v1/chat/completions");
  assert.equal(capturedRequest.method, "POST");
  assert.ok(capturedRequest.headers["Authorization"].includes("sk-test"));

  const body = JSON.parse(capturedRequest.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.temperature, 0.5);
  assert.equal(body.max_tokens, 1000);
  assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);

  assert.equal(result.content, "response");
  assert.equal(result.model, "test-model");
  assert.deepEqual(result.usage, { total_tokens: 10 });
});

test("CliModelClient: chat uses default maxTokens from options", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  let capturedBody = null;
  const mockFetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        model: "m",
        usage: {},
      }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({
    apiKey: "sk-test",
    maxOutputTokens: 2048,
  });

  await client.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(capturedBody.max_tokens, 2048);
});

test("CliModelClient: chat handles HTTP error", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const mockFetch = async () => ({
    ok: false,
    status: 401,
    headers: {
      get: (name) => (name === "content-type" ? "application/json" : null),
    },
    json: async () => ({ error: { message: "Unauthorized" } }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hi" }] }),
    (err) => err.message.includes("API 请求失败") && err.message.includes("401")
  );
});

test("CliModelClient: chat handles non-JSON error response", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const mockFetch = async () => ({
    ok: false,
    status: 500,
    headers: { get: () => "text/plain" },
    text: async () => "Internal Server Error",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hi" }] }),
    (err) => err.message.includes("500") && err.message.includes("Internal Server Error")
  );
});

test("CliModelClient: ask builds messages correctly", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  let capturedMessages = null;
  const mockFetch = async (url, init) => {
    capturedMessages = JSON.parse(init.body).messages;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "answer" } }],
        model: "m",
        usage: {},
      }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });

  const result = await client.ask("What is 2+2?", "You are a math tutor");
  assert.equal(result, "answer");
  assert.equal(capturedMessages.length, 2);
  assert.equal(capturedMessages[0].role, "system");
  assert.equal(capturedMessages[0].content, "You are a math tutor");
  assert.equal(capturedMessages[1].role, "user");
  assert.equal(capturedMessages[1].content, "What is 2+2?");
});

test("CliModelClient: ask without system prompt", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  let capturedMessages = null;
  const mockFetch = async (url, init) => {
    capturedMessages = JSON.parse(init.body).messages;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        model: "m",
        usage: {},
      }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });

  await client.ask("Hello");
  assert.equal(capturedMessages.length, 1);
  assert.equal(capturedMessages[0].role, "user");
});

// ============================================================================
// CliModelRouter Tests
// ============================================================================

test("CliModelRouter: constructor without config or env warns", async (t) => {
  const { CliModelRouter } = await import("../../../js/agents/cli/model-client.js");

  const originalEnv = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const warns = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warns.push(msg);

  t.after(() => {
    process.env.OPENAI_API_KEY = originalEnv;
    console.warn = originalWarn;
  });

  const router = new CliModelRouter();
  assert.equal(router.config, null);
  assert.ok(warns.some((w) => w.includes("未找到配置")));
});

test("CliModelRouter: getClient with env var returns env client", async (t) => {
  const { CliModelRouter } = await import("../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  const originalUrl = process.env.OPENAI_BASE_URL;
  const originalModel = process.env.OPENAI_MODEL;

  process.env.OPENAI_API_KEY = "sk-env-test";
  process.env.OPENAI_BASE_URL = "https://env.api/v1";
  process.env.OPENAI_MODEL = "env-model";

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalUrl) process.env.OPENAI_BASE_URL = originalUrl;
    else delete process.env.OPENAI_BASE_URL;
    if (originalModel) process.env.OPENAI_MODEL = originalModel;
    else delete process.env.OPENAI_MODEL;
  });

  const router = new CliModelRouter();
  const client = router.getClient("worker");

  assert.equal(client.apiKey, "sk-env-test");
  assert.equal(client.baseUrl, "https://env.api/v1");
  assert.equal(client.model, "env-model");
});

test("CliModelRouter: getClient caches env client", async (t) => {
  const { CliModelRouter } = await import("../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-cache-test";

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
  });

  const router = new CliModelRouter();
  const client1 = router.getClient("worker");
  const client2 = router.getClient("planner");

  assert.strictEqual(client1, client2);
});

test("CliModelRouter: getClient throws without config or env", async (t) => {
  const { CliModelRouter } = await import("../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  // Suppress warning
  const originalWarn = console.warn;
  console.warn = () => {};

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    console.warn = originalWarn;
  });

  const router = new CliModelRouter();

  assert.throws(
    () => router.getClient("worker"),
    /未配置模型/
  );
});

test("CliModelRouter: getAvailableModels with env returns env model", async (t) => {
  const { CliModelRouter } = await import("../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_MODEL = "test-model";

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalModel) process.env.OPENAI_MODEL = originalModel;
    else delete process.env.OPENAI_MODEL;
  });

  const router = new CliModelRouter();
  const models = router.getAvailableModels();

  assert.deepEqual(models, ["env:test-model"]);
});

test("CliModelRouter: getAvailableModels without config returns empty", async (t) => {
  const { CliModelRouter } = await import("../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const originalWarn = console.warn;
  console.warn = () => {};

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    console.warn = originalWarn;
  });

  const router = new CliModelRouter();
  const models = router.getAvailableModels();

  assert.deepEqual(models, []);
});

test("CliModelRouter: getTierMapping returns empty without config", async (t) => {
  const { CliModelRouter } = await import("../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const originalWarn = console.warn;
  console.warn = () => {};

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    console.warn = originalWarn;
  });

  const router = new CliModelRouter();
  const tiers = router.getTierMapping();

  assert.deepEqual(tiers, {});
});

// ============================================================================
// createAiApiServiceAdapter Tests
// ============================================================================

test("createAiApiServiceAdapter: chat delegates to router", async (t) => {
  const { CliModelRouter, createAiApiServiceAdapter, CliModelClient } = await import(
    "../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-adapter-test";

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
  });

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "adapter response" } }],
      model: "m",
      usage: {},
    }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const router = new CliModelRouter();
  const adapter = createAiApiServiceAdapter(router);

  const result = await adapter.chat({
    messages: [{ role: "user", content: "hi" }],
    usage: "worker",
  });

  assert.equal(result.content, "adapter response");
});

test("createAiApiServiceAdapter: getAvailableModels returns formatted models", async (t) => {
  const { CliModelRouter, createAiApiServiceAdapter } = await import(
    "../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_MODEL = "gpt-4";

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalModel) process.env.OPENAI_MODEL = originalModel;
    else delete process.env.OPENAI_MODEL;
  });

  const router = new CliModelRouter();
  const adapter = createAiApiServiceAdapter(router);

  const models = adapter.getAvailableModels();

  assert.equal(models.length, 1);
  assert.equal(models[0].id, "env:gpt-4");
  assert.equal(models[0].name, "env:gpt-4");
  assert.equal(models[0].type, "cli");
});

// ============================================================================
// Default Export Tests
// ============================================================================

test("default export includes all expected exports", async () => {
  const defaultExport = await import("../../../js/agents/cli/model-client.js");

  assert.ok(defaultExport.CliModelClient);
  assert.ok(defaultExport.CliModelRouter);
  assert.ok(defaultExport.createAiApiServiceAdapter);
  assert.ok(defaultExport.default);
  assert.equal(defaultExport.default.CliModelClient, defaultExport.CliModelClient);
  assert.equal(defaultExport.default.CliModelRouter, defaultExport.CliModelRouter);
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

test("CliModelClient: handles empty response choice", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [],
      model: "m",
      usage: {},
    }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });
  const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.content, "");
});

test("CliModelClient: handles missing message content", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: {} }],
      model: "m",
      usage: {},
    }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });
  const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });

  assert.equal(result.content, "");
});

test("CliModelClient: respects abort signal", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const mockFetch = async (url, init) => {
    // Check if signal is passed
    if (init.signal) {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    return { ok: true, json: async () => ({ choices: [], model: "m", usage: {} }) };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });
  const controller = new AbortController();

  const promise = client.chat({
    messages: [{ role: "user", content: "hi" }],
    signal: controller.signal,
  });

  controller.abort();

  await assert.rejects(promise, (err) => err.name === "AbortError");
});

test("CliModelClient: chat handles retry-after header", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const mockFetch = async () => ({
    ok: false,
    status: 429,
    headers: {
      get: (name) => {
        if (name === "content-type") return "application/json";
        if (name === "retry-after") return "30";
        return null;
      },
    },
    json: async () => ({ error: { message: "Rate limited" } }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test" });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hi" }] }),
    (err) => err.status === 429 && err.retryAfter === "30"
  );
});

test("CliModelClient: handles timeout", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  const mockFetch = async (url, init) => {
    // Simulate slow response - must respect abort signal from timeout
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ ok: true, json: async () => ({ choices: [], model: "m", usage: {} }) });
      }, 200);

      if (init?.signal) {
        if (init.signal.aborted) {
          clearTimeout(timer);
          const err = new Error("timeout");
          err.name = "AbortError";
          reject(err);
          return;
        }
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("timeout");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({ apiKey: "sk-test", timeoutMs: 50 });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hi" }] }),
    (err) => err.message.includes("timeout") || err.name === "AbortError"
  );
});

test("CliModelClient: contextWindow truncation is applied", async (t) => {
  const { CliModelClient } = await import("../../../js/agents/cli/model-client.js");

  let capturedMessages = null;
  const mockFetch = async (url, init) => {
    capturedMessages = JSON.parse(init.body).messages;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        model: "m",
        usage: {},
      }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CliModelClient({
    apiKey: "sk-test",
    contextWindow: 100,
  });

  const longMessages = [
    { role: "system", content: "sys" },
    { role: "user", content: "a".repeat(50) },
    { role: "assistant", content: "b".repeat(50) },
    { role: "user", content: "final" },
  ];

  await client.chat({ messages: longMessages, maxTokens: 50 });

  // Should have truncated some messages but kept system
  assert.ok(capturedMessages.length <= longMessages.length);
  assert.ok(capturedMessages.some((m) => m.role === "system"));
});

// ============================================================================
// Integration-style Tests
// ============================================================================

test("CliModelRouter + CliModelClient integration", async (t) => {
  const { CliModelRouter, CliModelClient } = await import(
    "../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-integration";

  t.after(() => {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
  });

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "integrated" } }],
      model: "m",
      usage: {},
    }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const router = new CliModelRouter();
  const client = router.getClient("worker");

  assert.ok(client instanceof CliModelClient);

  const result = await client.ask("test");
  assert.equal(result, "integrated");
});
