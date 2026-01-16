/**
 * ScriptedModel - 预设输出序列的 LLM Mock
 *
 * 用途:
 * - Agent 循环测试
 * - 多轮对话测试
 * - 工具调用流程测试
 *
 * @example
 * const model = createScriptedModel([
 *   { content: '', tool_calls: [{ name: 'search', input: { query: 'test' } }] },
 *   { content: 'Done', stop_reason: 'end_turn' },
 * ]);
 *
 * const result1 = await model.chat({ messages: [] });
 * // => { content: '', tool_calls: [...] }
 *
 * const result2 = await model.chat({ messages: [] });
 * // => { content: 'Done', stop_reason: 'end_turn' }
 */

/**
 * @typedef {object} ScriptedModelOutput
 * @property {string} [content] - 文本响应
 * @property {Array<{ id?: string, name: string, input: any }>} [tool_calls] - 工具调用
 * @property {string} [stop_reason] - 停止原因 (end_turn, tool_use, max_tokens)
 * @property {{ input_tokens?: number, output_tokens?: number }} [usage] - Token 使用统计
 */

/**
 * @typedef {object} ScriptedModelOptions
 * @property {number} [delay=0] - 响应延迟 (ms)
 * @property {Error | null} [error=null] - 错误注入 (每次调用都抛出)
 * @property {Error | null} [errorOnce=null] - 一次性错误 (仅第一次调用抛出)
 * @property {boolean} [loop=false] - 循环模式 (到达末尾后从头开始)
 */

/**
 * @typedef {object} ScriptedModelCallRecord
 * @property {number} index - 调用索引
 * @property {number} timestamp - 调用时间戳
 * @property {any} input - 输入参数
 * @property {ScriptedModelOutput | null} output - 输出 (null 表示抛出错误)
 * @property {Error | null} error - 错误 (如果有)
 */

/**
 * 创建预设输出序列的 LLM Mock
 *
 * @param {ScriptedModelOutput[]} outputs - 预设输出序列
 * @param {ScriptedModelOptions} [options={}] - 配置选项
 * @returns {{ id: string, chat: Function, call: Function, calls: ScriptedModelCallRecord[], reset: Function }}
 */
export function createScriptedModel(outputs, options = {}) {
  const {
    delay = 0,
    error = null,
    errorOnce = null,
    loop = false,
  } = options;

  let idx = 0;
  let errorOnceTriggered = false;
  /** @type {ScriptedModelCallRecord[]} */
  const calls = [];

  /**
   * @param {any} input
   * @returns {Promise<ScriptedModelOutput>}
   */
  async function chat(input) {
    const callIndex = calls.length;
    const timestamp = Date.now();

    // 延迟模拟
    if (delay > 0) {
      await sleep(delay);
    }

    // 一次性错误
    if (errorOnce && !errorOnceTriggered) {
      errorOnceTriggered = true;
      calls.push({ index: callIndex, timestamp, input, output: null, error: errorOnce });
      throw errorOnce;
    }

    // 持续错误
    if (error) {
      calls.push({ index: callIndex, timestamp, input, output: null, error });
      throw error;
    }

    // 获取预设输出
    if (!outputs || outputs.length === 0) {
      const output = { content: '', stop_reason: 'end_turn' };
      calls.push({ index: callIndex, timestamp, input, output, error: null });
      return output;
    }

    let output;
    if (idx >= outputs.length) {
      if (loop) {
        idx = 0;
        output = outputs[idx++];
      } else {
        // 超出序列后返回最后一个
        output = outputs[outputs.length - 1];
      }
    } else {
      output = outputs[idx++];
    }

    calls.push({ index: callIndex, timestamp, input, output, error: null });
    return output;
  }

  function reset() {
    idx = 0;
    errorOnceTriggered = false;
    calls.length = 0;
  }

  return {
    id: 'scripted-model',
    chat,
    call: chat, // 兼容 BaseProvider.call()
    calls,
    reset,
  };
}

/**
 * 创建返回固定内容的简单 Mock
 *
 * @param {string} content - 固定返回的文本内容
 * @param {ScriptedModelOptions} [options={}] - 配置选项
 */
export function createFixedModel(content, options = {}) {
  return createScriptedModel([{ content, stop_reason: 'end_turn' }], { ...options, loop: true });
}

/**
 * 创建模拟工具调用的 Mock
 *
 * @param {Array<{ name: string, input: any }>} toolCalls - 工具调用列表
 * @param {string} [finalContent='Done'] - 工具调用后的最终响应
 * @param {ScriptedModelOptions} [options={}] - 配置选项
 */
export function createToolCallingModel(toolCalls, finalContent = 'Done', options = {}) {
  const outputs = [
    {
      content: '',
      tool_calls: toolCalls.map((tc, i) => ({
        id: tc.id || `call_${i}`,
        name: tc.name,
        input: tc.input,
      })),
      stop_reason: 'tool_use',
    },
    { content: finalContent, stop_reason: 'end_turn' },
  ];
  return createScriptedModel(outputs, options);
}

/**
 * 创建多轮对话 Mock
 *
 * @param {string[]} responses - 每轮对话的响应内容
 * @param {ScriptedModelOptions} [options={}] - 配置选项
 */
export function createMultiTurnModel(responses, options = {}) {
  const outputs = responses.map((content, i) => ({
    content,
    stop_reason: i === responses.length - 1 ? 'end_turn' : 'end_turn',
  }));
  return createScriptedModel(outputs, options);
}

/**
 * 创建模拟超时的 Mock
 *
 * @param {number} timeoutMs - 超时时间 (ms)
 */
export function createTimeoutModel(timeoutMs) {
  return createScriptedModel([{ content: 'timeout', stop_reason: 'end_turn' }], { delay: timeoutMs });
}

/**
 * 创建模拟错误的 Mock
 *
 * @param {Error | string} error - 错误对象或错误消息
 */
export function createErrorModel(error) {
  const err = typeof error === 'string' ? new Error(error) : error;
  return createScriptedModel([], { error: err });
}

/**
 * 断言工具：验证模型被调用的次数
 *
 * @param {{ calls: ScriptedModelCallRecord[] }} model - ScriptedModel 实例
 * @param {number} expectedCount - 期望的调用次数
 * @throws {Error} 如果调用次数不匹配
 */
export function assertCallCount(model, expectedCount) {
  if (model.calls.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} calls, but got ${model.calls.length}`);
  }
}

/**
 * 断言工具：验证最后一次调用的输入
 *
 * @param {{ calls: ScriptedModelCallRecord[] }} model - ScriptedModel 实例
 * @param {(input: any) => boolean} predicate - 验证函数
 * @throws {Error} 如果验证失败
 */
export function assertLastCallInput(model, predicate) {
  if (model.calls.length === 0) {
    throw new Error('No calls recorded');
  }
  const lastCall = model.calls[model.calls.length - 1];
  if (!predicate(lastCall.input)) {
    throw new Error(`Last call input validation failed: ${JSON.stringify(lastCall.input)}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default createScriptedModel;
