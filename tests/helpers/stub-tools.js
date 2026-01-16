/**
 * StubTools - 工具执行 Mock
 *
 * 用途:
 * - 工具执行测试
 * - 调用记录和验证
 * - 错误/延迟注入
 *
 * @example
 * const tools = createStubTools({
 *   search: { result: { items: ['a', 'b'] } },
 *   read: { result: { content: 'file content' } },
 * });
 *
 * const result = await tools.execute('search', { query: 'test' });
 * // => { ok: true, data: { items: ['a', 'b'] } }
 *
 * console.log(tools.calls);
 * // => [{ name: 'search', args: { query: 'test' }, ... }]
 */

/**
 * @typedef {object} StubToolConfig
 * @property {any} [result] - 固定返回值
 * @property {Error | string | null} [error=null] - 错误注入
 * @property {number} [delay=0] - 响应延迟 (ms)
 * @property {(args: any, context: any) => any | Promise<any>} [handler] - 自定义处理函数
 */

/**
 * @typedef {object} StubToolCall
 * @property {string} name - 工具名称
 * @property {any} args - 调用参数
 * @property {any} context - 执行上下文
 * @property {number} timestamp - 调用时间戳
 * @property {any} result - 返回结果
 * @property {Error | null} error - 错误 (如果有)
 * @property {number} duration - 执行耗时 (ms)
 */

/**
 * @typedef {object} StubToolsOptions
 * @property {Error | string | null} [defaultError=null] - 默认错误 (所有工具)
 * @property {number} [defaultDelay=0] - 默认延迟 (所有工具)
 * @property {any} [defaultResult={ ok: true }] - 默认返回值
 * @property {boolean} [recordCalls=true] - 是否记录调用
 */

/**
 * 创建工具执行 Mock
 *
 * @param {Record<string, StubToolConfig | any>} [toolConfigs={}] - 工具配置
 * @param {StubToolsOptions} [options={}] - 全局配置
 */
export function createStubTools(toolConfigs = {}, options = {}) {
  const {
    defaultError = null,
    defaultDelay = 0,
    defaultResult = { ok: true },
    recordCalls = true,
  } = options;

  /** @type {StubToolCall[]} */
  const calls = [];

  /** @type {Record<string, StubToolConfig>} */
  const configs = {};

  // 规范化工具配置
  for (const [name, config] of Object.entries(toolConfigs)) {
    if (typeof config === 'function') {
      configs[name] = { handler: config };
    } else if (config && typeof config === 'object') {
      configs[name] = config;
    } else {
      configs[name] = { result: config };
    }
  }

  /**
   * 执行工具
   *
   * @param {string} name - 工具名称
   * @param {any} args - 调用参数
   * @param {any} [context={}] - 执行上下文
   * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
   */
  async function execute(name, args, context = {}) {
    const startTime = Date.now();
    const config = configs[name] || {};

    const delay = config.delay ?? defaultDelay;
    const error = config.error ?? defaultError;

    // 延迟模拟
    if (delay > 0) {
      await sleep(delay);
    }

    // 错误注入
    if (error) {
      const err = typeof error === 'string' ? new Error(error) : error;
      const duration = Date.now() - startTime;

      if (recordCalls) {
        calls.push({
          name,
          args,
          context,
          timestamp: startTime,
          result: null,
          error: err,
          duration,
        });
      }

      return { ok: false, error: err.message };
    }

    // 自定义处理函数
    if (typeof config.handler === 'function') {
      try {
        const result = await config.handler(args, context);
        const duration = Date.now() - startTime;

        if (recordCalls) {
          calls.push({
            name,
            args,
            context,
            timestamp: startTime,
            result,
            error: null,
            duration,
          });
        }

        return normalizeResult(result);
      } catch (err) {
        const duration = Date.now() - startTime;

        if (recordCalls) {
          calls.push({
            name,
            args,
            context,
            timestamp: startTime,
            result: null,
            error: err instanceof Error ? err : new Error(String(err)),
            duration,
          });
        }

        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 固定返回值
    const result = config.result !== undefined ? config.result : defaultResult;
    const duration = Date.now() - startTime;

    if (recordCalls) {
      calls.push({
        name,
        args,
        context,
        timestamp: startTime,
        result,
        error: null,
        duration,
      });
    }

    return normalizeResult(result);
  }

  /**
   * 批量执行工具
   *
   * @param {Array<{ name: string, args: any }>} actions - 工具调用列表
   * @param {any} [context={}] - 执行上下文
   */
  async function executeBatch(actions, context = {}) {
    return Promise.all(
      actions.map(action => execute(action.name, action.args, context))
    );
  }

  /**
   * 重置调用记录
   */
  function reset() {
    calls.length = 0;
  }

  /**
   * 获取指定工具的调用记录
   *
   * @param {string} name - 工具名称
   */
  function getCallsFor(name) {
    return calls.filter(c => c.name === name);
  }

  /**
   * 获取最后一次调用
   */
  function getLastCall() {
    return calls.length > 0 ? calls[calls.length - 1] : null;
  }

  /**
   * 动态添加/更新工具配置
   *
   * @param {string} name - 工具名称
   * @param {StubToolConfig | any} config - 工具配置
   */
  function setTool(name, config) {
    if (typeof config === 'function') {
      configs[name] = { handler: config };
    } else if (config && typeof config === 'object') {
      configs[name] = config;
    } else {
      configs[name] = { result: config };
    }
  }

  /**
   * 检查工具是否存在
   *
   * @param {string} name - 工具名称
   */
  function hasTool(name) {
    return name in configs;
  }

  return {
    execute,
    executeBatch,
    calls,
    reset,
    getCallsFor,
    getLastCall,
    setTool,
    hasTool,
    configs,
  };
}

/**
 * 创建简单的成功返回工具集
 *
 * @param {string[]} names - 工具名称列表
 * @param {any} [result={ ok: true }] - 统一返回值
 */
export function createSuccessTools(names, result = { ok: true }) {
  const configs = {};
  for (const name of names) {
    configs[name] = { result };
  }
  return createStubTools(configs);
}

/**
 * 创建简单的失败返回工具集
 *
 * @param {string[]} names - 工具名称列表
 * @param {string} [errorMessage='Tool failed'] - 错误消息
 */
export function createFailingTools(names, errorMessage = 'Tool failed') {
  const configs = {};
  for (const name of names) {
    configs[name] = { error: errorMessage };
  }
  return createStubTools(configs);
}

/**
 * 创建延迟工具集
 *
 * @param {string[]} names - 工具名称列表
 * @param {number} delayMs - 延迟时间 (ms)
 */
export function createDelayedTools(names, delayMs) {
  const configs = {};
  for (const name of names) {
    configs[name] = { delay: delayMs, result: { ok: true } };
  }
  return createStubTools(configs);
}

/**
 * 断言工具：验证工具被调用的次数
 *
 * @param {{ calls: StubToolCall[] }} tools - StubTools 实例
 * @param {string} name - 工具名称
 * @param {number} expectedCount - 期望的调用次数
 */
export function assertToolCallCount(tools, name, expectedCount) {
  const count = tools.calls.filter(c => c.name === name).length;
  if (count !== expectedCount) {
    throw new Error(`Expected ${name} to be called ${expectedCount} times, but got ${count}`);
  }
}

/**
 * 断言工具：验证工具调用顺序
 *
 * @param {{ calls: StubToolCall[] }} tools - StubTools 实例
 * @param {string[]} expectedOrder - 期望的调用顺序
 */
export function assertToolCallOrder(tools, expectedOrder) {
  const actualOrder = tools.calls.map(c => c.name);
  if (actualOrder.length !== expectedOrder.length) {
    throw new Error(`Expected ${expectedOrder.length} calls, but got ${actualOrder.length}`);
  }
  for (let i = 0; i < expectedOrder.length; i++) {
    if (actualOrder[i] !== expectedOrder[i]) {
      throw new Error(`Expected call ${i} to be ${expectedOrder[i]}, but got ${actualOrder[i]}`);
    }
  }
}

/**
 * 断言工具：验证工具调用参数
 *
 * @param {{ calls: StubToolCall[] }} tools - StubTools 实例
 * @param {string} name - 工具名称
 * @param {number} callIndex - 调用索引
 * @param {(args: any) => boolean} predicate - 验证函数
 */
export function assertToolCallArgs(tools, name, callIndex, predicate) {
  const toolCalls = tools.calls.filter(c => c.name === name);
  if (callIndex >= toolCalls.length) {
    throw new Error(`Tool ${name} was not called ${callIndex + 1} times`);
  }
  if (!predicate(toolCalls[callIndex].args)) {
    throw new Error(`Tool ${name} call ${callIndex} args validation failed: ${JSON.stringify(toolCalls[callIndex].args)}`);
  }
}

function normalizeResult(result) {
  if (result === null || result === undefined) {
    return { ok: true, data: null };
  }
  if (typeof result === 'object' && 'ok' in result) {
    return result;
  }
  return { ok: true, data: result };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default createStubTools;
