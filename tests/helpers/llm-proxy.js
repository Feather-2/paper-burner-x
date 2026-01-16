/**
 * LLM Proxy - SSE 流式响应 Mock
 *
 * 支持:
 * - 本地 HTTP Server 模拟 LLM API
 * - SSE 事件流响应
 * - 请求记录与验证
 * - 多响应队列
 *
 * @example
 * // 基础用法
 * const proxy = await startLLMProxy({
 *   responses: [
 *     sse(contentDelta('Hello'), contentDelta(' World'), messageStop())
 *   ]
 * });
 *
 * const response = await fetch(`${proxy.url}/v1/messages`, {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ model: 'test', messages: [] })
 * });
 *
 * // 验证请求
 * expect(proxy.requests[0].json.model).toBe('test');
 *
 * await proxy.close();
 *
 * @module tests/helpers/llm-proxy
 */

import http from 'node:http';
import { EventEmitter } from 'node:events';

/**
 * @typedef {Object} SseEvent
 * @property {string} type - 事件类型
 * @property {number} [index] - 索引
 * @property {Object} [delta] - 增量数据
 * @property {Object} [content_block] - 内容块
 * @property {Object} [message] - 消息对象
 * @property {Object} [usage] - Token 使用统计
 */

/**
 * @typedef {Object} SseResponse
 * @property {'sse'} kind - 响应类型
 * @property {SseEvent[]} events - 事件序列
 */

/**
 * @typedef {Object} JsonResponse
 * @property {'json'} kind - 响应类型
 * @property {Object} body - JSON 响应体
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {'error'} kind - 响应类型
 * @property {number} statusCode - HTTP 状态码
 * @property {Object} body - 错误响应体
 */

/**
 * @typedef {SseResponse | JsonResponse | ErrorResponse} ProxyResponse
 */

/**
 * @typedef {Object} RecordedRequest
 * @property {string} body - 原始请求体
 * @property {Object} json - 解析后的 JSON
 * @property {http.IncomingHttpHeaders} headers - 请求头
 * @property {string} method - 请求方法
 * @property {string} url - 请求 URL
 */

/**
 * @typedef {Object} LLMProxyOptions
 * @property {ProxyResponse[]} [responses=[]] - 预设响应队列
 * @property {number} [port=0] - 端口号 (0 = 随机)
 * @property {number} [responseDelay=0] - 响应延迟 (ms)
 * @property {number} [eventDelay=0] - 事件间延迟 (ms)
 */

/**
 * @typedef {Object} LLMProxy
 * @property {string} url - 代理 URL
 * @property {number} port - 端口号
 * @property {RecordedRequest[]} requests - 记录的请求
 * @property {() => Promise<void>} close - 关闭服务器
 * @property {(response: ProxyResponse) => void} queueResponse - 添加响应到队列
 * @property {() => RecordedRequest | undefined} getLastRequest - 获取最后一个请求
 * @property {() => void} clearRequests - 清空请求记录
 * @property {EventEmitter} events - 事件发射器
 */

/**
 * 格式化 SSE 事件
 * @param {SseEvent} event - 事件对象
 * @returns {string} SSE 格式字符串
 */
function formatSseEvent(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * 延迟函数
 * @param {number} ms - 毫秒数
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动 LLM 测试代理服务器
 *
 * @param {LLMProxyOptions} [options={}] - 配置选项
 * @returns {Promise<LLMProxy>} 代理对象
 */
export async function startLLMProxy(options = {}) {
  const {
    responses = [],
    port = 0,
    responseDelay = 0,
    eventDelay = 0,
  } = options;

  /** @type {ProxyResponse[]} */
  const responseQueue = [...responses];
  /** @type {RecordedRequest[]} */
  const requests = [];
  const events = new EventEmitter();

  const server = http.createServer(async (req, res) => {
    // 收集请求体
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8');

    // 记录请求
    let json = {};
    try {
      json = JSON.parse(body);
    } catch {
      // 非 JSON 请求
    }

    const recorded = {
      body,
      json,
      headers: req.headers,
      method: req.method || 'GET',
      url: req.url || '/',
    };
    requests.push(recorded);
    events.emit('request', recorded);

    // 响应延迟
    if (responseDelay > 0) {
      await sleep(responseDelay);
    }

    // 获取下一个响应
    const response = responseQueue.shift();

    if (!response) {
      // 无预设响应，返回默认
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_default',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Default response' }],
        stop_reason: 'end_turn',
      }));
      return;
    }

    if (response.kind === 'error') {
      res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body));
      return;
    }

    if (response.kind === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body));
      return;
    }

    // SSE 响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    for (const event of response.events) {
      if (eventDelay > 0) {
        await sleep(eventDelay);
      }
      res.write(formatSseEvent(event));
    }

    res.end();
  });

  // 启动服务器
  await new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(undefined));
  });

  const address = server.address();
  const actualPort = typeof address === 'object' ? address?.port : port;
  const url = `http://127.0.0.1:${actualPort}`;

  return {
    url,
    port: actualPort,
    requests,
    events,
    queueResponse: (response) => responseQueue.push(response),
    getLastRequest: () => requests[requests.length - 1],
    clearRequests: () => requests.length = 0,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}

// ============ SSE 事件构建器 ============

/**
 * 构建 SSE 响应
 * @param {...SseEvent} events - 事件序列
 * @returns {SseResponse}
 */
export function sse(...events) {
  return { kind: 'sse', events };
}

/**
 * 构建 JSON 响应
 * @param {Object} body - 响应体
 * @returns {JsonResponse}
 */
export function json(body) {
  return { kind: 'json', body };
}

/**
 * 构建错误响应
 * @param {number} statusCode - HTTP 状态码
 * @param {Object} body - 错误体
 * @returns {ErrorResponse}
 */
export function error(statusCode, body) {
  return { kind: 'error', statusCode, body };
}

/**
 * message_start 事件
 * @param {string} [messageId='msg_test'] - 消息 ID
 * @param {string} [model='test-model'] - 模型名
 * @returns {SseEvent}
 */
export function messageStart(messageId = 'msg_test', model = 'test-model') {
  return {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  };
}

/**
 * content_block_start 事件 (文本)
 * @param {number} [index=0] - 块索引
 * @returns {SseEvent}
 */
export function contentBlockStart(index = 0) {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  };
}

/**
 * content_block_start 事件 (工具调用)
 * @param {number} index - 块索引
 * @param {string} toolId - 工具调用 ID
 * @param {string} toolName - 工具名称
 * @returns {SseEvent}
 */
export function toolUseStart(index, toolId, toolName) {
  return {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id: toolId,
      name: toolName,
      input: {},
    },
  };
}

/**
 * content_block_delta 事件 (文本增量)
 * @param {string} text - 文本内容
 * @param {number} [index=0] - 块索引
 * @returns {SseEvent}
 */
export function contentDelta(text, index = 0) {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  };
}

/**
 * content_block_delta 事件 (工具输入增量)
 * @param {string} partialJson - JSON 片段
 * @param {number} index - 块索引
 * @returns {SseEvent}
 */
export function toolInputDelta(partialJson, index) {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  };
}

/**
 * content_block_stop 事件
 * @param {number} [index=0] - 块索引
 * @returns {SseEvent}
 */
export function contentBlockStop(index = 0) {
  return {
    type: 'content_block_stop',
    index,
  };
}

/**
 * message_delta 事件
 * @param {string} [stopReason='end_turn'] - 停止原因
 * @param {number} [outputTokens=50] - 输出 Token 数
 * @returns {SseEvent}
 */
export function messageDelta(stopReason = 'end_turn', outputTokens = 50) {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason },
    usage: { output_tokens: outputTokens },
  };
}

/**
 * message_stop 事件
 * @returns {SseEvent}
 */
export function messageStop() {
  return { type: 'message_stop' };
}

/**
 * error 事件
 * @param {string} message - 错误信息
 * @param {string} [errorType='api_error'] - 错误类型
 * @returns {SseEvent}
 */
export function errorEvent(message, errorType = 'api_error') {
  return {
    type: 'error',
    error: { type: errorType, message },
  };
}

// ============ 便捷构建器 ============

/**
 * 构建简单文本响应的 SSE 事件序列
 * @param {string} text - 响应文本
 * @param {Object} [options={}] - 选项
 * @param {string} [options.messageId] - 消息 ID
 * @param {string} [options.model] - 模型名
 * @returns {SseResponse}
 */
export function textResponse(text, options = {}) {
  const { messageId, model } = options;
  return sse(
    messageStart(messageId, model),
    contentBlockStart(),
    contentDelta(text),
    contentBlockStop(),
    messageDelta(),
    messageStop()
  );
}

/**
 * 构建工具调用响应的 SSE 事件序列
 * @param {string} toolName - 工具名称
 * @param {Object} toolInput - 工具输入
 * @param {Object} [options={}] - 选项
 * @param {string} [options.toolId] - 工具调用 ID
 * @param {string} [options.messageId] - 消息 ID
 * @returns {SseResponse}
 */
export function toolCallResponse(toolName, toolInput, options = {}) {
  const { toolId = 'toolu_test', messageId } = options;
  const inputJson = JSON.stringify(toolInput);

  return sse(
    messageStart(messageId),
    toolUseStart(0, toolId, toolName),
    toolInputDelta(inputJson, 0),
    contentBlockStop(0),
    messageDelta('tool_use'),
    messageStop()
  );
}

/**
 * 构建混合响应 (文本 + 工具调用)
 * @param {string} text - 文本内容
 * @param {string} toolName - 工具名称
 * @param {Object} toolInput - 工具输入
 * @returns {SseResponse}
 */
export function textAndToolResponse(text, toolName, toolInput) {
  const inputJson = JSON.stringify(toolInput);

  return sse(
    messageStart(),
    contentBlockStart(0),
    contentDelta(text, 0),
    contentBlockStop(0),
    toolUseStart(1, 'toolu_test', toolName),
    toolInputDelta(inputJson, 1),
    contentBlockStop(1),
    messageDelta('tool_use'),
    messageStop()
  );
}

/**
 * 构建多轮文本响应
 * @param {string[]} texts - 文本数组
 * @returns {SseResponse[]}
 */
export function multiTurnTextResponses(texts) {
  return texts.map((text, i) => textResponse(text, { messageId: `msg_${i}` }));
}

// ============ 断言工具 ============

/**
 * 断言请求数量
 * @param {LLMProxy} proxy - 代理对象
 * @param {number} expectedCount - 期望数量
 */
export function assertRequestCount(proxy, expectedCount) {
  if (proxy.requests.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} requests, got ${proxy.requests.length}`
    );
  }
}

/**
 * 断言最后请求包含指定模型
 * @param {LLMProxy} proxy - 代理对象
 * @param {string} expectedModel - 期望模型名
 */
export function assertLastRequestModel(proxy, expectedModel) {
  const last = proxy.getLastRequest();
  if (!last) {
    throw new Error('No requests recorded');
  }
  if (last.json.model !== expectedModel) {
    throw new Error(
      `Expected model "${expectedModel}", got "${last.json.model}"`
    );
  }
}

/**
 * 断言最后请求的消息
 * @param {LLMProxy} proxy - 代理对象
 * @param {(messages: any[]) => boolean} predicate - 断言函数
 */
export function assertLastRequestMessages(proxy, predicate) {
  const last = proxy.getLastRequest();
  if (!last) {
    throw new Error('No requests recorded');
  }
  if (!predicate(last.json.messages || [])) {
    throw new Error('Request messages assertion failed');
  }
}
