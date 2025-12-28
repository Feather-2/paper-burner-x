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
    this.delay = options.delay || 0;
    this.callHistory = [];
    this._sequenceIndex = 0;
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
      return { content: response, model: "mock", usage: { total_tokens: 100 } };
    }
    return {
      content: response.content || "",
      model: response.model || "mock",
      usage: response.usage || { total_tokens: 100 },
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
   */
  assertEmitted(name, count = 1) {
    const matches = this.events.filter(e => e.name === name);
    if (matches.length < count) {
      throw new Error(`Expected event "${name}" to be emitted ${count} times, got ${matches.length}`);
    }
    return matches;
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
    const { name, steps, setup } = scenario;
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
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) {
        return { passed: false, error: `Expected ${key}=${value}, got ${actual[key]}` };
      }
    }
    return { passed: true };
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
  ScenarioRunner,
  createMockTestEnv,
};
