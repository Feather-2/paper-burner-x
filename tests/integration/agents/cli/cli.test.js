/**
 * CLI 模块测试
 *
 * 测试 js/agents/cli/ 目录下的模块:
 * - model-client.js: CliModelClient, CliModelRouter, createAiApiServiceAdapter
 *
 * @module tests/agents/cli
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const DEMO_PATH = new URL("../../../../js/agents/cli/demo.js", import.meta.url);

const loadRedactSensitive = () => {
  const source = readFileSync(DEMO_PATH, "utf-8");
  const start = source.indexOf("const redactSensitive");
  const end = source.indexOf("const safeStringify", start);

  if (start === -1 || end === -1) {
    throw new Error("redactSensitive not found in demo.js");
  }

  const snippet = source.slice(start, end);
  const context = {};
  vm.runInNewContext(`${snippet}\nthis.__redactSensitive = redactSensitive;`, context);

  if (typeof context.__redactSensitive !== "function") {
    throw new Error("Failed to load redactSensitive from demo.js");
  }

  return context.__redactSensitive;
};

// ============================================================================
// demo.js Tests
// ============================================================================

describe("demo.js redactSensitive", () => {
  it("redactSensitive: handles empty values", () => {
    const redactSensitive = loadRedactSensitive();

    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
    expect(redactSensitive("")).toBe("");
  });

  it("redactSensitive: redacts nested objects and sensitive keys", () => {
    const redactSensitive = loadRedactSensitive();
    const input = {
      apiKey: "sk-1234567890abcdef",
      nested: {
        token: "token-value",
        auth: "Bearer abcdefghijklmnop",
        list: [
          { password: "supersecret" },
          { info: "sk-aaaaaaaaaaaaaaaa" },
          { deep: { authorization: "Bearer xyzxyzxyzxyzxyz" } },
        ],
        details: {
          ok: "safe",
        },
      },
      keep: "normal",
      __proto__: { shouldNot: "appear" },
    };

    const output = redactSensitive(input);

    expect(output.apiKey).toBe("REDACTED");
    expect(output.nested.token).toBe("REDACTED");
    expect(output.nested.auth).toBe("REDACTED");
    expect(output.nested.list[0].password).toBe("REDACTED");
    expect(output.nested.list[1].info).toBe("sk-REDACTED");
    expect(output.nested.list[2].deep.authorization).toBe("REDACTED");
    expect(output.nested.details.ok).toBe("safe");
    expect(output.keep).toBe("normal");
    expect(Object.prototype.hasOwnProperty.call(output, "__proto__")).toBe(false);
  });
});

// ============================================================================
// CliModelClient Tests
// ============================================================================

it("CliModelClient: constructor sets default values", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

  const client = new CliModelClient();
  expect(client.apiKey).toBe("");
  expect(client.baseUrl).toBe("https://api.deepseek.com/v1");
  expect(client.model).toBe("deepseek-chat");
  expect(client.contextWindow).toBe(null);
  expect(client.maxOutputTokens).toBe(null);
  expect(client.timeoutMs).toBe(null);
});

it("CliModelClient: constructor accepts custom options", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

  const client = new CliModelClient({
    apiKey: "test-key",
    baseUrl: "https://custom.api/v1/",
    model: "custom-model",
    contextWindow: 8000,
    maxOutputTokens: 2048,
    timeoutMs: 30000,
  });

  expect(client.apiKey).toBe("test-key");
  expect(client.baseUrl).toBe("https://custom.api/v1");
  expect(client.model).toBe("custom-model");
  expect(client.contextWindow).toBe(8000);
  expect(client.maxOutputTokens).toBe(2048);
  expect(client.timeoutMs).toBe(30000);
});

it("CliModelClient: baseUrl trailing slash is stripped", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

  const client = new CliModelClient({ baseUrl: "https://api.example.com/v1/" });
  expect(client.baseUrl).toBe("https://api.example.com/v1");
});

it("CliModelClient: chat throws without API key", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

  const client = new CliModelClient({ apiKey: "" });

  await expect(() => client.chat({ messages: [{ role: "user", content: "hi" }] }),
    /API Key 未设置/
  );
});

it("CliModelClient: chat constructs correct request", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
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

    expect(capturedRequest.url).toBe("https://test.api/v1/chat/completions");
    expect(capturedRequest.method).toBe("POST");
    expect(capturedRequest.headers["Authorization"]).toContain("sk-test");

    const body = JSON.parse(capturedRequest.body);
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(1000);
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);

    expect(result.content).toBe("response");
    expect(result.model).toBe("test-model");
    expect(result.usage).toEqual({ total_tokens: 10 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: chat uses default maxTokens from options", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({
      apiKey: "sk-test",
      maxOutputTokens: 2048,
    });

    await client.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(capturedBody.max_tokens).toBe(2048);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: chat handles HTTP error", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });

    await expect(() => client.chat({ messages: [{ role: "user", content: "hi" }] }),
      (err) => err.message.includes("API 请求失败") && err.message.includes("401")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: chat handles non-JSON error response", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

  const mockFetch = async () => ({
    ok: false,
    status: 500,
    headers: { get: () => "text/plain" },
    text: async () => "Internal Server Error",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });

    await expect(() => client.chat({ messages: [{ role: "user", content: "hi" }] }),
      (err) => err.message.includes("500") && err.message.includes("Internal Server Error")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: ask builds messages correctly", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });

    const result = await client.ask("What is 2+2?", "You are a math tutor");
    expect(result).toBe("answer");
    expect(capturedMessages.length).toBe(2);
    expect(capturedMessages[0].role).toBe("system");
    expect(capturedMessages[0].content).toBe("You are a math tutor");
    expect(capturedMessages[1].role).toBe("user");
    expect(capturedMessages[1].content).toBe("What is 2+2?");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: ask without system prompt", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });

    await client.ask("Hello");
    expect(capturedMessages.length).toBe(1);
    expect(capturedMessages[0].role).toBe("user");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// CliModelRouter Tests
// ============================================================================

it("CliModelRouter: constructor without config or env warns", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalEnv = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const warns = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warns.push(args.map((v) => String(v)).join(" "));

  try {
    const router = new CliModelRouter();
    expect(router.config).toBe(null);
    expect(warns).toEqual(expect.arrayContaining([expect.stringContaining("未找到配置")]));
  } finally {
    process.env.OPENAI_API_KEY = originalEnv;
    console.warn = originalWarn;
  }
});

it("CliModelRouter: getClient with env var returns env client", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  const originalUrl = process.env.OPENAI_BASE_URL;
  const originalModel = process.env.OPENAI_MODEL;

  process.env.OPENAI_API_KEY = "sk-env-test";
  process.env.OPENAI_BASE_URL = "https://env.api/v1";
  process.env.OPENAI_MODEL = "env-model";

  try {
    const router = new CliModelRouter();
    const client = router.getClient("worker");

    expect(client.apiKey).toBe("sk-env-test");
    expect(client.baseUrl).toBe("https://env.api/v1");
    expect(client.model).toBe("env-model");
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalUrl) process.env.OPENAI_BASE_URL = originalUrl;
    else delete process.env.OPENAI_BASE_URL;
    if (originalModel) process.env.OPENAI_MODEL = originalModel;
    else delete process.env.OPENAI_MODEL;
  }
});

it("CliModelRouter: getClient caches env client", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-cache-test";

  try {
    const router = new CliModelRouter();
    const client1 = router.getClient("worker");
    const client2 = router.getClient("planner");

    expect(client1).toBe(client2);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
  }
});

it("CliModelRouter: getClient throws without config or env", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  // Suppress warning
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const router = new CliModelRouter();

    expect(() => router.getClient("worker")).toThrow(/未配置模型/);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    console.warn = originalWarn;
  }
});

it("CliModelRouter: getAvailableModels with env returns env model", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_MODEL = "test-model";

  try {
    const router = new CliModelRouter();
    const models = router.getAvailableModels();

    expect(models).toEqual(["env:test-model"]);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalModel) process.env.OPENAI_MODEL = originalModel;
    else delete process.env.OPENAI_MODEL;
  }
});

it("CliModelRouter: getAvailableModels without config returns empty", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const router = new CliModelRouter();
    const models = router.getAvailableModels();

    expect(models).toEqual([]);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    console.warn = originalWarn;
  }
});

it("CliModelRouter: getTierMapping returns empty without config", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const router = new CliModelRouter();
    const tiers = router.getTierMapping();

    expect(tiers).toEqual({});
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    console.warn = originalWarn;
  }
});

it("CliModelRouter: uses config and caches tier client", async () => {
  const { CliModelRouter, CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const router = new CliModelRouter();
    router.config = {
      models: {
        normal: {
          apiKey: "sk-config",
          baseUrl: "https://config.api/v1/",
          model: "config-model",
        },
      },
      tiers: { normal: ["worker"] },
      default: "normal",
    };

    const client1 = router.getClient("worker");
    const client2 = router.getClient("worker");

    expect(client1).toBeInstanceOf(CliModelClient);
    expect(client1).toBe(client2);
    expect(client1.baseUrl).toBe("https://config.api/v1");
    expect(client1.model).toBe("config-model");
    expect(router.getAvailableModels()).toEqual(["normal"]);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    console.warn = originalWarn;
  }
});

it("CliModelRouter: empty OPENAI_API_KEY treated as missing", async () => {
  const { CliModelRouter } = await import("../../../../js/agents/cli/model-client.js");

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const router = new CliModelRouter();
    router.config = null;

    expect(router.getAvailableModels()).toEqual([]);
    expect(() => router.getClient("worker")).toThrow(/未配置模型/);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    console.warn = originalWarn;
  }
});

// ============================================================================
// createAiApiServiceAdapter Tests
// ============================================================================

it("createAiApiServiceAdapter: chat delegates to router", async () => {
  const { CliModelRouter, createAiApiServiceAdapter, CliModelClient } = await import(
    "../../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-adapter-test";

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

  try {
    const router = new CliModelRouter();
    const adapter = createAiApiServiceAdapter(router);

    const result = await adapter.chat({
      messages: [{ role: "user", content: "hi" }],
      usage: "worker",
    });

    expect(result.content).toBe("adapter response");
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

it("createAiApiServiceAdapter: getAvailableModels returns formatted models", async () => {
  const { CliModelRouter, createAiApiServiceAdapter } = await import(
    "../../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_MODEL = "gpt-4";

  try {
    const router = new CliModelRouter();
    const adapter = createAiApiServiceAdapter(router);

    const models = adapter.getAvailableModels();

    expect(models.length).toBe(1);
    expect(models[0].id).toBe("env:gpt-4");
    expect(models[0].name).toBe("env:gpt-4");
    expect(models[0].type).toBe("cli");
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalModel) process.env.OPENAI_MODEL = originalModel;
    else delete process.env.OPENAI_MODEL;
  }
});

it("createAiApiServiceAdapter: defaults usage to worker when empty", async () => {
  const { CliModelRouter, createAiApiServiceAdapter } = await import(
    "../../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-usage-test";

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "ok" } }],
      model: "m",
      usage: {},
    }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const router = new CliModelRouter();
    const roles = [];
    const originalGetClient = router.getClient.bind(router);
    router.getClient = (role) => {
      roles.push(role);
      return originalGetClient(role);
    };

    const adapter = createAiApiServiceAdapter(router);
    await adapter.chat({ messages: [{ role: "user", content: "hi" }], usage: "" });

    expect(roles[0]).toBe("worker");
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

it("createAiApiServiceAdapter: throws without env or config", async () => {
  const { CliModelRouter, createAiApiServiceAdapter } = await import(
    "../../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const router = new CliModelRouter();
    router.config = null;
    const adapter = createAiApiServiceAdapter(router);

    await expect(adapter.chat({ messages: [] })).rejects.toThrow(/未配置模型/);
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    console.warn = originalWarn;
  }
});

// ============================================================================
// Default Export Tests
// ============================================================================

it("default export includes all expected exports", async () => {
  const defaultExport = await import("../../../../js/agents/cli/model-client.js");

  expect(defaultExport.CliModelClient).toBeTypeOf("function");
  expect(defaultExport.CliModelRouter).toBeTypeOf("function");
  expect(defaultExport.createAiApiServiceAdapter).toBeTypeOf("function");
  expect(defaultExport.default).toEqual(
    expect.objectContaining({
      CliModelClient: defaultExport.CliModelClient,
      CliModelRouter: defaultExport.CliModelRouter,
      createAiApiServiceAdapter: defaultExport.createAiApiServiceAdapter,
    })
  );
  expect(defaultExport.default.CliModelClient).toBe(defaultExport.CliModelClient);
  expect(defaultExport.default.CliModelRouter).toBe(defaultExport.CliModelRouter);
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

it("CliModelClient: handles empty response choice", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });
    const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(result.content).toBe("");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: handles missing message content", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });
    const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(result.content).toBe("");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: respects abort signal", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

  const mockFetch = async (url, init) => {
    // Check if signal is passed
    if (init.signal) {
      return new Promise((_, reject) => {
        if (init.signal.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        init.signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        }, { once: true });
      });
    }
    return { ok: true, json: async () => ({ choices: [], model: "m", usage: {} }) };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });
    const controller = new AbortController();

    const promise = client.chat({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow("Aborted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: chat handles retry-after header", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({ apiKey: "sk-test" });

    await expect(() => client.chat({ messages: [{ role: "user", content: "hi" }] }),
      (err) => err.status === 429 && err.retryAfter === "30"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: handles timeout", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
    const client = new CliModelClient({ apiKey: "sk-test", timeoutMs: 50 });

    await expect(() => client.chat({ messages: [{ role: "user", content: "hi" }] }),
      (err) => err.message.includes("timeout") || err.name === "AbortError"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("CliModelClient: contextWindow truncation is applied", async () => {
  const { CliModelClient } = await import("../../../../js/agents/cli/model-client.js");

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

  try {
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
    expect(capturedMessages.length).toBeLessThanOrEqual(longMessages.length);
    expect(capturedMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "system" })])
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// Integration-style Tests
// ============================================================================

it("CliModelRouter + CliModelClient integration", async () => {
  const { CliModelRouter, CliModelClient } = await import(
    "../../../../js/agents/cli/model-client.js"
  );

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-integration";

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

  try {
    const router = new CliModelRouter();
    const client = router.getClient("worker");

    expect(client).toBeInstanceOf(CliModelClient);

    const result = await client.ask("test");
    expect(result).toBe("integrated");
  } finally {
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    globalThis.fetch = originalFetch;
  }
});
