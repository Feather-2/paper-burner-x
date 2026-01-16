/**
 * MiddlewareRecorder - 中间件/钩子执行记录器
 *
 * 用途:
 * - 验证钩子执行顺序
 * - 记录钩子调用参数
 * - 验证钩子是否被正确触发
 *
 * @example
 * const recorder = createMiddlewareRecorder();
 *
 * // 注册到 HookRegistry
 * recorder.registerTo(hookRegistry);
 *
 * // 运行 agent...
 * await agentLoop.execute(input);
 *
 * // 验证执行顺序
 * assertHookOrder(recorder, [
 *   HookEvent.PRE_AGENT,
 *   HookEvent.PRE_LLM_CALL,
 *   HookEvent.POST_LLM_CALL,
 *   HookEvent.PRE_TOOL_USE,
 *   HookEvent.POST_TOOL_USE,
 *   HookEvent.POST_AGENT,
 * ]);
 */

import { HookEvent, HookType } from '../../js/agents/runtime/hooks/hook-registry.js';

/**
 * @typedef {object} HookInvocation
 * @property {string} event - HookEvent 名称
 * @property {any} context - 调用上下文
 * @property {number} timestamp - 调用时间戳
 * @property {any} result - 返回结果
 * @property {Error | null} error - 错误 (如果有)
 * @property {number} duration - 执行耗时 (ms)
 */

/**
 * @typedef {object} MiddlewareRecorderOptions
 * @property {boolean} [recordContext=true] - 是否记录完整上下文
 * @property {(event: string, ctx: any) => any} [beforeHandler] - 前置处理函数
 * @property {(event: string, ctx: any, result: any) => any} [afterHandler] - 后置处理函数
 * @property {Record<string, Error | string>} [errors={}] - 错误注入映射
 * @property {Record<string, number>} [delays={}] - 延迟注入映射
 */

/**
 * 创建中间件记录器
 *
 * @param {MiddlewareRecorderOptions} [options={}]
 */
export function createMiddlewareRecorder(options = {}) {
  const {
    recordContext = true,
    beforeHandler = null,
    afterHandler = null,
    errors = {},
    delays = {},
  } = options;

  /** @type {HookInvocation[]} */
  const invocations = [];

  /**
   * 创建钩子 handler
   *
   * @param {string} event - HookEvent 名称
   */
  function createHandler(event) {
    return async (context) => {
      const startTime = Date.now();

      // 前置处理
      if (beforeHandler) {
        beforeHandler(event, context);
      }

      // 延迟注入
      const delay = delays[event];
      if (delay && delay > 0) {
        await sleep(delay);
      }

      // 错误注入
      const error = errors[event];
      if (error) {
        const err = typeof error === 'string' ? new Error(error) : error;
        const duration = Date.now() - startTime;

        invocations.push({
          event,
          context: recordContext ? cloneContext(context) : null,
          timestamp: startTime,
          result: null,
          error: err,
          duration,
        });

        // 对于 Pre 钩子，返回 skip 信号
        if (event.startsWith('Pre')) {
          return { skip: true, reason: err.message };
        }
        throw err;
      }

      const duration = Date.now() - startTime;
      let result = null;

      // 后置处理
      if (afterHandler) {
        result = afterHandler(event, context, null);
      }

      invocations.push({
        event,
        context: recordContext ? cloneContext(context) : null,
        timestamp: startTime,
        result,
        error: null,
        duration,
      });

      return result;
    };
  }

  /**
   * 注册到 HookRegistry
   *
   * @param {import('../../js/agents/runtime/hooks/hook-registry.js').HookRegistry} registry
   * @param {string[]} [events] - 要注册的事件，默认全部
   */
  function registerTo(registry, events = null) {
    const targetEvents = events || Object.values(HookEvent);

    for (const event of targetEvents) {
      registry.register(event, {
        type: HookType.COMMAND,
        blocking: false,
        handler: createHandler(event),
      });
    }
  }

  /**
   * 创建可直接使用的钩子对象
   *
   * @param {string[]} [events] - 要创建的事件，默认全部
   * @returns {Record<string, { type: string, blocking: boolean, handler: Function }>}
   */
  function createHooks(events = null) {
    const targetEvents = events || Object.values(HookEvent);
    const hooks = {};

    for (const event of targetEvents) {
      hooks[event] = {
        type: HookType.COMMAND,
        blocking: false,
        handler: createHandler(event),
      };
    }

    return hooks;
  }

  /**
   * 重置记录
   */
  function reset() {
    invocations.length = 0;
  }

  /**
   * 获取指定事件的调用记录
   *
   * @param {string} event - HookEvent 名称
   */
  function getInvocationsFor(event) {
    return invocations.filter(inv => inv.event === event);
  }

  /**
   * 获取最后一次调用
   */
  function getLastInvocation() {
    return invocations.length > 0 ? invocations[invocations.length - 1] : null;
  }

  /**
   * 获取执行顺序
   */
  function getEventOrder() {
    return invocations.map(inv => inv.event);
  }

  /**
   * 检查某事件是否被调用
   *
   * @param {string} event - HookEvent 名称
   */
  function wasCalled(event) {
    return invocations.some(inv => inv.event === event);
  }

  /**
   * 获取某事件的调用次数
   *
   * @param {string} event - HookEvent 名称
   */
  function getCallCount(event) {
    return invocations.filter(inv => inv.event === event).length;
  }

  return {
    invocations,
    registerTo,
    createHooks,
    reset,
    getInvocationsFor,
    getLastInvocation,
    getEventOrder,
    wasCalled,
    getCallCount,
    // 暴露 handler 创建函数供自定义使用
    createHandler,
  };
}

/**
 * 创建简单的执行顺序记录器
 * 只记录事件名称，不记录上下文
 */
export function createOrderRecorder() {
  return createMiddlewareRecorder({ recordContext: false });
}

/**
 * 创建带错误注入的记录器
 *
 * @param {Record<string, Error | string>} errors - 错误映射
 */
export function createErrorRecorder(errors) {
  return createMiddlewareRecorder({ errors });
}

/**
 * 创建带延迟注入的记录器
 *
 * @param {Record<string, number>} delays - 延迟映射 (ms)
 */
export function createDelayedRecorder(delays) {
  return createMiddlewareRecorder({ delays });
}

/**
 * 断言：验证钩子执行顺序
 *
 * @param {{ invocations: HookInvocation[] }} recorder
 * @param {string[]} expectedOrder - 期望的事件顺序
 */
export function assertHookOrder(recorder, expectedOrder) {
  const actualOrder = recorder.invocations.map(inv => inv.event);

  if (actualOrder.length !== expectedOrder.length) {
    throw new Error(
      `Hook order mismatch: expected ${expectedOrder.length} invocations, got ${actualOrder.length}\n` +
      `Expected: [${expectedOrder.join(', ')}]\n` +
      `Actual: [${actualOrder.join(', ')}]`
    );
  }

  for (let i = 0; i < expectedOrder.length; i++) {
    if (actualOrder[i] !== expectedOrder[i]) {
      throw new Error(
        `Hook order mismatch at index ${i}: expected ${expectedOrder[i]}, got ${actualOrder[i]}\n` +
        `Expected: [${expectedOrder.join(', ')}]\n` +
        `Actual: [${actualOrder.join(', ')}]`
      );
    }
  }
}

/**
 * 断言：验证钩子被调用次数
 *
 * @param {{ invocations: HookInvocation[] }} recorder
 * @param {string} event - HookEvent 名称
 * @param {number} expectedCount - 期望的调用次数
 */
export function assertHookCallCount(recorder, event, expectedCount) {
  const count = recorder.invocations.filter(inv => inv.event === event).length;
  if (count !== expectedCount) {
    throw new Error(`Expected ${event} to be called ${expectedCount} times, but got ${count}`);
  }
}

/**
 * 断言：验证钩子被调用
 *
 * @param {{ invocations: HookInvocation[] }} recorder
 * @param {string} event - HookEvent 名称
 */
export function assertHookCalled(recorder, event) {
  const called = recorder.invocations.some(inv => inv.event === event);
  if (!called) {
    const events = recorder.invocations.map(inv => inv.event);
    throw new Error(`Expected ${event} to be called, but it was not. Called events: [${events.join(', ')}]`);
  }
}

/**
 * 断言：验证钩子未被调用
 *
 * @param {{ invocations: HookInvocation[] }} recorder
 * @param {string} event - HookEvent 名称
 */
export function assertHookNotCalled(recorder, event) {
  const called = recorder.invocations.some(inv => inv.event === event);
  if (called) {
    throw new Error(`Expected ${event} not to be called, but it was`);
  }
}

/**
 * 断言：验证钩子上下文包含指定字段
 *
 * @param {{ invocations: HookInvocation[] }} recorder
 * @param {string} event - HookEvent 名称
 * @param {number} callIndex - 调用索引
 * @param {(context: any) => boolean} predicate - 验证函数
 */
export function assertHookContext(recorder, event, callIndex, predicate) {
  const eventInvocations = recorder.invocations.filter(inv => inv.event === event);

  if (callIndex >= eventInvocations.length) {
    throw new Error(`${event} was not called ${callIndex + 1} times`);
  }

  const context = eventInvocations[callIndex].context;
  if (!predicate(context)) {
    throw new Error(
      `${event} call ${callIndex} context validation failed: ${JSON.stringify(context)}`
    );
  }
}

/**
 * 获取完整的 Agent 执行生命周期事件顺序
 * 用于验证完整的一次 Agent 执行
 */
export function getFullLifecycleOrder() {
  return [
    HookEvent.PRE_AGENT,
    HookEvent.PRE_LLM_CALL,
    HookEvent.POST_LLM_CALL,
    HookEvent.PRE_TOOL_USE,
    HookEvent.POST_TOOL_USE,
    HookEvent.POST_AGENT,
  ];
}

/**
 * 获取只有 LLM 调用的生命周期事件顺序
 * 用于验证不使用工具的 Agent 执行
 */
export function getLLMOnlyLifecycleOrder() {
  return [
    HookEvent.PRE_AGENT,
    HookEvent.PRE_LLM_CALL,
    HookEvent.POST_LLM_CALL,
    HookEvent.POST_AGENT,
  ];
}

// === 内部工具函数 ===

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cloneContext(ctx) {
  if (ctx === null || ctx === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(ctx));
  } catch {
    // 如果无法序列化，返回浅拷贝
    return { ...ctx };
  }
}

// Re-export HookEvent for convenience
export { HookEvent };

export default createMiddlewareRecorder;
