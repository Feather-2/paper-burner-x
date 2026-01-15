/**
 * Mock Testing Suite - 离线模拟测试套件
 *
 * 提供无 API Key 情况下的核心逻辑自动化回归测试能力。
 * 支持:
 * - MockModelClient: 模拟 LLM 响应
 * - MockMcpProvider: 模拟 MCP 工具调用
 * - MockEventBus: 事件捕获和断言
 * - Scenario Runner: 预定义场景回放
 */

/**
 * Mock Model Client - 模拟 LLM 响应
 *
 * 支持:
 * - 固定响应 (responses)
 * - 响应序列 (sequence)
 * - 动态响应 (handler)
 * - 延迟模拟 (delay)
 */
export class MockModelClient {
  constructor(options = {}) {
    this.responses = options.responses || {};
    this.sequence = options.sequence || [];
    this.handler = options.handler || null;
    this.rules = Array.isArray(options.rules) ? options.rules.slice() : [];
    this.delay = options.delay || 0;
    this.callHistory = [];
    this._sequenceIndex = 0;
  }

  /**
   * Register a predicate-based rule (evaluated before keyword matching).
   *
   * @param {(messages:any[], options:any) => boolean} predicate
   * @param {any} response
   * @returns {MockModelClient}
   */
  when(predicate, response) {
    if (typeof predicate !== "function") throw new Error("MockModelClient.when(predicate, response): predicate must be a function");
    this.rules.push({ predicate, response });
    return this;
  }

  /**
   * 模拟 chat 调用
   */
  async chat(options) {
    const { messages, usage = "worker" } = options;
    const lastMessage = messages[messages.length - 1]?.content || "";

    this.callHistory.push({ messages, usage, timestamp: Date.now() });

    if (this.delay > 0) {
      await new Promise(r => setTimeout(r, this.delay));
    }

    // 0. Predicate rules (stateful / context-aware)
    for (const rule of this.rules) {
      try {
        if (rule && typeof rule.predicate === "function" && rule.predicate(messages, options)) {
          const resolved = typeof rule.response === "function" ? await rule.response(messages, options) : rule.response;
          return this._normalizeResponse(resolved);
        }
      } catch {
        // ignore rule errors
      }
    }

    // 1. 动态 handler
    if (typeof this.handler === "function") {
      const result = await this.handler(messages, options);
      return this._normalizeResponse(result);
    }

    // 2. 响应序列
    if (this.sequence.length > 0) {
      const response = this.sequence[this._sequenceIndex % this.sequence.length];
      this._sequenceIndex++;
      return this._normalizeResponse(response);
    }

    // 3. 关键词匹配
    for (const [keyword, response] of Object.entries(this.responses)) {
      if (lastMessage.includes(keyword)) {
        return this._normalizeResponse(response);
      }
    }

    // 4. 默认响应
    return this._normalizeResponse(this.responses.default || "Mock response");
  }

  /**
   * Streaming variant: returns an AsyncGenerator that yields incremental chunks.
   * This does not change the core `chat()` contract and is optional for tests.
   *
   * @param {object} options
   * @param {number} [options.chunkSize=20]
   */
  async *chatStream(options = {}) {
    const resp = await this.chat(options);
    const text = String(resp?.content || "");
    const chunkSize = Number.isFinite(options.chunkSize) ? Math.max(1, Math.floor(options.chunkSize)) : 20;
    for (let i = 0; i < text.length; i += chunkSize) {
      yield { ...resp, delta: text.slice(i, i + chunkSize) };
    }
  }

  /**
   * 简单单轮对话
   */
  async ask(prompt, systemPrompt) {
    const messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const result = await this.chat({ messages });
    return result.content;
  }

  _normalizeResponse(response) {
    if (typeof response === "string") {
      return {
        content: response,
        model: "mock",
        usage: { total_tokens: 100 },
        finish_reason: "stop",
        system_fingerprint: "mock",
        logprobs: null,
      };
    }
    return {
      content: response.content || "",
      model: response.model || "mock",
      usage: response.usage || { total_tokens: 100 },
      finish_reason: response.finish_reason || response.finishReason || "stop",
      system_fingerprint: response.system_fingerprint || response.systemFingerprint || "mock",
      logprobs: response.logprobs ?? null,
      ...response,
    };
  }

  /**
   * 重置状态
   */
  reset() {
    this.callHistory = [];
    this._sequenceIndex = 0;
  }

  /**
   * 获取调用次数
   */
  get callCount() {
    return this.callHistory.length;
  }
}

/**
 * Mock MCP Provider - 模拟 MCP 工具调用
 */
export class MockMcpProvider {
  constructor(options = {}) {
    this.tools = options.tools || {};
    this.callHistory = [];
  }

  /**
   * 注册模拟工具
   */
  registerTool(name, handler) {
    this.tools[name] = handler;
  }

  /**
   * 模拟搜索
   */
  async search(query, options = {}) {
    this.callHistory.push({ method: "search", query, options });

    if (this.tools.search) {
      return this.tools.search(query, options);
    }

    return {
      success: true,
      results: [
        { title: `Mock result for: ${query}`, url: "https://example.com", snippet: "Mock snippet" },
      ],
    };
  }

  /**
   * 模拟 fetch
   */
  async fetch(url, options = {}) {
    this.callHistory.push({ method: "fetch", url, options });

    if (this.tools.fetch) {
      return this.tools.fetch(url, options);
    }

    return {
      success: true,
      content: `Mock content from ${url}`,
      title: "Mock Page",
    };
  }

  /**
   * 模拟工具调用
   */
  async callTool(name, args) {
    this.callHistory.push({ method: "callTool", name, args });

    if (this.tools[name]) {
      return this.tools[name](args);
    }

    return { success: true, data: `Mock result for ${name}` };
  }

  reset() {
    this.callHistory = [];
  }
}

/**
 * Mock Event Bus - 事件捕获和断言
 */
export class MockEventBus {
  constructor() {
    this.events = [];
    this.listeners = new Map();
  }

  emit(name, payload) {
    this.events.push({ name, payload, timestamp: Date.now() });
    const handlers = this.listeners.get(name) || [];
    handlers.forEach(h => h(payload));
  }

  on(name, handler) {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, []);
    }
    this.listeners.get(name).push(handler);
    return () => this.off(name, handler);
  }

  off(name, handler) {
    const handlers = this.listeners.get(name) || [];
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  /**
   * 断言事件被触发
   * @param {string} name - 事件名
   * @param {number|Object} countOrMatcher - 数量或 payload 匹配器
   * @param {Object} [payloadMatcher] - payload 匹配器（当第二参数为数量时）
   *
   * 用法示例:
   * - assertEmitted("event", 2) // 触发 2 次
   * - assertEmitted("event", { status: "ok" }) // 至少 1 次且 payload 匹配
   * - assertEmitted("event", 2, { status: "ok" }) // 恰好 2 次且 payload 匹配
   * - assertEmitted("event", { status: /success|ok/ }) // 正则匹配
   * - assertEmitted("event", { count: v => v > 0 }) // 函数断言
   */
  assertEmitted(name, countOrMatcher = 1, payloadMatcher) {
    const matches = this.events.filter(e => e.name === name);

    // 解析参数
    let expectedCount = 1;
    let matcher = null;

    if (typeof countOrMatcher === "number") {
      expectedCount = countOrMatcher;
      matcher = payloadMatcher || null;
    } else if (countOrMatcher && typeof countOrMatcher === "object") {
      expectedCount = 1; // 至少 1 次
      matcher = countOrMatcher;
    }

    // 数量断言
    if (matches.length < expectedCount) {
      throw new Error(`Expected event "${name}" to be emitted at least ${expectedCount} time(s), got ${matches.length}`);
    }

    // payload 断言
    if (matcher) {
      const matchingPayloads = matches.filter(e => this._payloadMatches(e.payload, matcher));
      if (matchingPayloads.length === 0) {
        const received = matches.map(e => JSON.stringify(e.payload)).join(", ");
        throw new Error(`Expected event "${name}" payload to match ${JSON.stringify(matcher)}, but no match found. Received: [${received}]`);
      }

      // 如果指定了精确数量，检查匹配的数量
      if (typeof countOrMatcher === "number" && payloadMatcher && matchingPayloads.length < expectedCount) {
        throw new Error(`Expected ${expectedCount} event(s) "${name}" with matching payload, got ${matchingPayloads.length}`);
      }
    }

    return matches;
  }

  /**
   * 断言事件被触发且 payload 满足条件
   * @param {string} name
   * @param {(payload: any) => boolean} predicate
   * @param {string} [description] - 可选的错误描述
   */
  assertEmittedWith(name, predicate, description) {
    if (typeof predicate !== "function") {
      throw new Error("assertEmittedWith: predicate must be a function");
    }

    const matches = this.events.filter(e => e.name === name);
    if (matches.length === 0) {
      throw new Error(`Expected event "${name}" to be emitted, but it was never emitted`);
    }

    const satisfying = matches.filter(e => {
      try {
        return predicate(e.payload);
      } catch {
        return false;
      }
    });

    if (satisfying.length === 0) {
      const desc = description ? ` (${description})` : "";
      const received = matches.map(e => JSON.stringify(e.payload)).slice(0, 3).join(", ");
      throw new Error(`Expected event "${name}" payload to satisfy predicate${desc}. Received: [${received}${matches.length > 3 ? ", ..." : ""}]`);
    }

    return satisfying;
  }

  /**
   * 断言事件按顺序触发
   * @param {string[]} names - 事件名数组，按顺序
   */
  assertEmittedInOrder(names) {
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error("assertEmittedInOrder: names must be a non-empty array");
    }

    let lastIdx = -1;
    for (const name of names) {
      const idx = this.events.findIndex((e, i) => i > lastIdx && e.name === name);
      if (idx === -1) {
        const after = lastIdx >= 0 ? ` after "${this.events[lastIdx]?.name}"` : "";
        throw new Error(`Expected event "${name}" to be emitted${after}, but not found`);
      }
      lastIdx = idx;
    }

    return true;
  }

  _payloadMatches(actual, expected, path = "") {
    if (expected === undefined || expected === null) return true;

    // 正则匹配
    if (expected instanceof RegExp) {
      return expected.test(String(actual ?? ""));
    }

    // 函数断言
    if (typeof expected === "function") {
      try {
        return !!expected(actual);
      } catch {
        return false;
      }
    }

    // 对象递归匹配（只检查 expected 中的字段）
    if (expected && typeof expected === "object") {
      if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) return false;
        for (let i = 0; i < expected.length; i++) {
          if (!this._payloadMatches(actual[i], expected[i], `${path}[${i}]`)) return false;
        }
        return true;
      }

      if (!actual || typeof actual !== "object") return false;
      for (const [k, v] of Object.entries(expected)) {
        if (!this._payloadMatches(actual[k], v, path ? `${path}.${k}` : k)) return false;
      }
      return true;
    }

    // 原始值比较
    return actual === expected;
  }

  /**
   * 断言事件未被触发
   */
  assertNotEmitted(name) {
    const matches = this.events.filter(e => e.name === name);
    if (matches.length > 0) {
      throw new Error(`Expected event "${name}" not to be emitted, but got ${matches.length} times`);
    }
  }

  /**
   * 获取指定事件的所有 payload
   */
  getPayloads(name) {
    return this.events.filter(e => e.name === name).map(e => e.payload);
  }

  reset() {
    this.events = [];
  }
}

class MockHeaders {
  constructor(init = {}) {
    this._map = new Map();
    for (const [key, value] of Object.entries(init || {})) {
      this.set(key, value);
    }
  }

  set(name, value) {
    const key = String(name || "").toLowerCase();
    if (!key) return;
    this._map.set(key, String(value ?? ""));
  }

  get(name) {
    const key = String(name || "").toLowerCase();
    return this._map.has(key) ? this._map.get(key) : null;
  }

  has(name) {
    const key = String(name || "").toLowerCase();
    return this._map.has(key);
  }

  entries() {
    return Array.from(this._map.entries());
  }
}

function normalizeMethod(method) {
  const m = typeof method === "string" && method.trim() ? method.trim().toUpperCase() : "GET";
  return m;
}

function normalizePath(input, baseUrl) {
  const raw = typeof input === "string" ? input : String(input ?? "");
  if (!raw) return "/";
  try {
    const url = new URL(raw, baseUrl || "http://mock.local");
    return url.pathname + url.search;
  } catch {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

function normalizeBody(body) {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

class MockResponse {
  constructor({ status = 200, headers = {}, body = "", stream = null, delay = 0 } = {}) {
    this.status = Number.isFinite(status) ? status : 200;
    this.headers = new MockHeaders(headers);
    this._body = normalizeBody(body);
    this._delay = Number.isFinite(delay) ? Math.max(0, Math.floor(delay)) : 0;
    this._streamChunks = Array.isArray(stream) ? stream.slice() : stream ? [stream] : null;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  async text() {
    if (this._delay) await new Promise((r) => setTimeout(r, this._delay));
    if (!this._streamChunks) return this._body;
    let out = "";
    for await (const chunk of this.stream()) {
      out += String(chunk ?? "");
    }
    return out;
  }

  async json() {
    const text = await this.text();
    return JSON.parse(text);
  }

  async arrayBuffer() {
    const text = await this.text();
    return new TextEncoder().encode(text).buffer;
  }

  async *stream() {
    if (!this._streamChunks) {
      yield this._body;
      return;
    }
    for (const chunk of this._streamChunks) {
      yield chunk;
    }
  }
}

/**
 * Mock Server - API 响应模拟
 *
 * 支持:
 * - setTextResponse / setJsonResponse
 * - setStreamResponse (分块/流式输出)
 * - fetch() 兼容调用
 */
export class MockServer {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || "http://mock.local";
    this.routes = [];
    this.callHistory = [];
  }

  _addRoute({ path, method, handler }) {
    this.routes.push({
      path,
      method: normalizeMethod(method),
      handler,
    });
  }

  _matchRoute(method, path) {
    return this.routes.find((route) => {
      if (route.method && route.method !== method && route.method !== "*") return false;
      if (route.path instanceof RegExp) return route.path.test(path);
      if (typeof route.path === "function") return route.path(path);
      return normalizePath(route.path, this.baseUrl) === path;
    });
  }

  setTextResponse(path, text, options = {}) {
    const { status = 200, headers = {}, method = "GET", delay = 0 } = options || {};
    this._addRoute({
      path,
      method,
      handler: () => new MockResponse({ status, headers, body: text, delay }),
    });
    return this;
  }

  setJsonResponse(path, data, options = {}) {
    const { status = 200, headers = {}, method = "GET", delay = 0 } = options || {};
    const nextHeaders = { "content-type": "application/json", ...headers };
    this._addRoute({
      path,
      method,
      handler: () => new MockResponse({ status, headers: nextHeaders, body: JSON.stringify(data), delay }),
    });
    return this;
  }

  setStreamResponse(path, chunks, options = {}) {
    const { status = 200, headers = {}, method = "GET", delay = 0 } = options || {};
    const streamChunks = Array.isArray(chunks) ? chunks.slice() : [chunks];
    this._addRoute({
      path,
      method,
      handler: () => new MockResponse({ status, headers, stream: streamChunks, delay }),
    });
    return this;
  }

  setHandler(path, handler, options = {}) {
    const method = normalizeMethod(options.method || "GET");
    this._addRoute({ path, method, handler });
    return this;
  }

  async fetch(url, options = {}) {
    const method = normalizeMethod(options.method);
    const path = normalizePath(url, this.baseUrl);
    const req = {
      method,
      url: typeof url === "string" ? url : String(url ?? ""),
      path,
      headers: options.headers || {},
      body: options.body,
    };

    this.callHistory.push({ ...req, timestamp: Date.now() });

    const route = this._matchRoute(method, path);
    if (!route) {
      return new MockResponse({ status: 404, body: "Not Found" });
    }

    const result = typeof route.handler === "function" ? await route.handler(req) : route.handler;
    if (result instanceof MockResponse) return result;
    if (result && typeof result === "object") return new MockResponse(result);
    return new MockResponse({ body: normalizeBody(result) });
  }

  reset() {
    this.routes = [];
    this.callHistory = [];
  }
}

/**
 * Scenario Runner - 预定义场景回放
 *
 * 场景格式:
 * {
 *   name: "test scenario",
 *   steps: [
 *     { input: "user message", expectedOutput: "assistant response" },
 *     { toolCall: "read-doc", args: { sourceId: "doc1" }, expectedResult: { success: true } },
 *   ]
 * }
 */
export class ScenarioRunner {
  constructor(options = {}) {
    this.modelClient = options.modelClient || new MockModelClient();
    this.mcpProvider = options.mcpProvider || new MockMcpProvider();
    this.eventBus = options.eventBus || new MockEventBus();
    this.results = [];
  }

  /**
   * 运行场景
   */
  async run(scenario) {
    const { name, steps, setup, teardown } = scenario;
    const result = { name, passed: true, steps: [], errors: [] };

    // 执行 setup
    if (typeof setup === "function") {
      await setup({ modelClient: this.modelClient, mcpProvider: this.mcpProvider, eventBus: this.eventBus });
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepResult = { index: i, passed: true };

      try {
        if (step.input) {
          // 模拟用户输入 -> 模型响应
          const response = await this.modelClient.ask(step.input);
          stepResult.output = response;

          if (step.expectedOutput && !response.includes(step.expectedOutput)) {
            stepResult.passed = false;
            stepResult.error = `Expected output to contain "${step.expectedOutput}"`;
          }
        }

        if (step.toolCall) {
          // 模拟工具调用
          const toolResult = await this.mcpProvider.callTool(step.toolCall, step.args || {});
          stepResult.toolResult = toolResult;

          if (step.expectedResult) {
            const match = this._deepMatch(toolResult, step.expectedResult);
            if (!match.passed) {
              stepResult.passed = false;
              stepResult.error = match.error;
            }
          }
        }

        if (step.assertEvent) {
          // 断言事件
          this.eventBus.assertEmitted(step.assertEvent, step.eventCount || 1);
        }
      } catch (err) {
        stepResult.passed = false;
        stepResult.error = err.message;
      }

      result.steps.push(stepResult);
      if (!stepResult.passed) {
        result.passed = false;
        result.errors.push(`Step ${i}: ${stepResult.error}`);
      }
    }

    // 执行 teardown（即使中途失败也应尽力清理）
    if (typeof teardown === "function") {
      try {
        await teardown({ modelClient: this.modelClient, mcpProvider: this.mcpProvider, eventBus: this.eventBus, result });
      } catch (err) {
        result.passed = false;
        result.errors.push(`Teardown failed: ${err?.message || err}`);
      }
    }

    this.results.push(result);
    return result;
  }

  /**
   * 批量运行场景
   */
  async runAll(scenarios) {
    const results = [];
    for (const scenario of scenarios) {
      this.reset();
      results.push(await this.run(scenario));
    }
    return {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      results,
    };
  }

  _deepMatch(actual, expected) {
    const matchAny = (act, exp, path = "") => {
      if (exp instanceof RegExp) {
        const ok = exp.test(String(act ?? ""));
        return ok ? { ok: true } : { ok: false, error: `Expected ${path || "value"} to match ${exp}, got ${String(act)}` };
      }
      if (typeof exp === "function") {
        try {
          const ok = !!exp(act);
          return ok ? { ok: true } : { ok: false, error: `Expected ${path || "value"} to satisfy predicate` };
        } catch (err) {
          return { ok: false, error: `Predicate threw at ${path || "value"}: ${err?.message || err}` };
        }
      }
      if (exp && typeof exp === "object") {
        if (Array.isArray(exp)) {
          if (!Array.isArray(act)) return { ok: false, error: `Expected ${path || "value"} to be an array` };
          for (let i = 0; i < exp.length; i++) {
            const r = matchAny(act[i], exp[i], `${path}[${i}]`);
            if (!r.ok) return r;
          }
          return { ok: true };
        }
        if (!act || typeof act !== "object") return { ok: false, error: `Expected ${path || "value"} to be an object` };
        for (const [k, v] of Object.entries(exp)) {
          const nextPath = path ? `${path}.${k}` : k;
          const r = matchAny(act[k], v, nextPath);
          if (!r.ok) return r;
        }
        return { ok: true };
      }

      const ok = act === exp;
      return ok ? { ok: true } : { ok: false, error: `Expected ${path || "value"}=${String(exp)}, got ${String(act)}` };
    };

    const r = matchAny(actual, expected, "");
    return r.ok ? { passed: true } : { passed: false, error: r.error };
  }

  reset() {
    this.modelClient.reset();
    this.mcpProvider.reset();
    this.eventBus.reset();
  }
}

/**
 * 创建完整的 Mock 测试环境
 */
export function createMockTestEnv(options = {}) {
  const modelClient = new MockModelClient(options.model || {});
  const mcpProvider = new MockMcpProvider(options.mcp || {});
  const eventBus = new MockEventBus();
  const runner = new ScenarioRunner({ modelClient, mcpProvider, eventBus });

  return {
    modelClient,
    mcpProvider,
    eventBus,
    runner,
    // 创建 stageApi 兼容对象
    createStageApi: (overrides = {}) => ({
      signal: new AbortController().signal,
      emit: (name, payload) => eventBus.emit(name, payload),
      eventBus,
      modelRouter: { call: (msgs, opts) => modelClient.chat({ messages: msgs, ...opts }) },
      aiApiService: { chat: opts => modelClient.chat(opts) },
      ...overrides,
    }),
  };
}

export default {
  MockModelClient,
  MockMcpProvider,
  MockEventBus,
  MockServer,
  ScenarioRunner,
  createMockTestEnv,
};
