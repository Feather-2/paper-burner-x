/**
 * @file js/chatbot/core/streaming-adapter.js
 * @description 流式响应适配器 - 统一不同 API 的流式响应处理
 *
 * Phase 8: Chatbot 重建
 * - 适配 OpenAI、Claude、自定义 API 的流式响应
 * - 提供统一的流解析接口
 * - 支持 SSE 和 fetch 流
 */

/**
 * 流式响应类型
 */
export const StreamType = Object.freeze({
  SSE: 'sse',           // Server-Sent Events
  NDJSON: 'ndjson',     // Newline-delimited JSON
  CHUNKED: 'chunked',   // 普通分块传输
  WEBSOCKET: 'websocket'
});

/**
 * 流式解析器基类
 */
class BaseStreamParser {
  constructor() {
    this.buffer = '';
  }

  /**
   * 解析数据块
   * @param {string} chunk - 原始数据块
   * @returns {Array<{content: string, done: boolean, meta?: Object}>}
   */
  parse(chunk) {
    throw new Error('parse() 未实现');
  }

  /**
   * 重置解析器状态
   */
  reset() {
    this.buffer = '';
  }
}

/**
 * SSE 流解析器（OpenAI 风格）
 */
export class SSEStreamParser extends BaseStreamParser {
  parse(chunk) {
    this.buffer += chunk;
    const results = [];
    const lines = this.buffer.split('\n');

    // 保留最后一个可能不完整的行
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      // 跳过空行和注释
      if (!trimmed || trimmed.startsWith(':')) continue;

      // 解析 data: 前缀
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();

        // [DONE] 标记
        if (data === '[DONE]') {
          results.push({ content: '', done: true });
          continue;
        }

        try {
          const json = JSON.parse(data);

          // OpenAI 格式
          if (json.choices?.[0]?.delta?.content !== undefined) {
            results.push({
              content: json.choices[0].delta.content || '',
              done: json.choices[0].finish_reason === 'stop',
              meta: {
                model: json.model,
                usage: json.usage
              }
            });
          }
          // Claude 格式
          else if (json.type === 'content_block_delta') {
            results.push({
              content: json.delta?.text || '',
              done: false
            });
          }
          else if (json.type === 'message_stop') {
            results.push({ content: '', done: true });
          }
          // 通用格式
          else if (json.content !== undefined) {
            results.push({
              content: json.content,
              done: json.done || false,
              meta: json
            });
          }
        } catch (e) {
          // 非 JSON 数据，直接作为文本
          if (data && data !== '[DONE]') {
            results.push({ content: data, done: false });
          }
        }
      }
    }

    return results;
  }
}

/**
 * NDJSON 流解析器
 */
export class NDJSONStreamParser extends BaseStreamParser {
  parse(chunk) {
    this.buffer += chunk;
    const results = [];
    const lines = this.buffer.split('\n');

    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const json = JSON.parse(trimmed);
        results.push({
          content: json.content || json.text || json.delta?.content || '',
          done: json.done || json.finished || false,
          meta: json
        });
      } catch (e) {
        // 非 JSON，作为纯文本
        results.push({ content: trimmed, done: false });
      }
    }

    return results;
  }
}

/**
 * 流式适配器
 * 统一处理不同 API 的流式响应
 */
export class StreamingAdapter {
  /**
   * @param {Object} options
   * @param {string} options.type - 流类型
   * @param {Function} options.onChunk - 内容回调
   * @param {Function} options.onDone - 完成回调
   * @param {Function} options.onError - 错误回调
   */
  constructor(options = {}) {
    this.type = options.type || StreamType.SSE;
    this.onChunk = options.onChunk || (() => {});
    this.onDone = options.onDone || (() => {});
    this.onError = options.onError || console.error;

    this.parser = this._createParser();
    this.fullContent = '';
    this.meta = {};
  }

  /**
   * 创建解析器
   */
  _createParser() {
    switch (this.type) {
      case StreamType.NDJSON:
        return new NDJSONStreamParser();
      case StreamType.SSE:
      default:
        return new SSEStreamParser();
    }
  }

  /**
   * 处理 fetch Response
   * @param {Response} response
   * @param {AbortSignal} signal
   */
  async processResponse(response, signal) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('响应体不可读');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          // 处理缓冲区中剩余数据
          if (this.parser.buffer) {
            const results = this.parser.parse('\n');
            this._processResults(results);
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const results = this.parser.parse(chunk);
        this._processResults(results);
      }
    } finally {
      reader.releaseLock();
    }

    this.onDone({
      content: this.fullContent,
      meta: this.meta
    });

    return {
      content: this.fullContent,
      meta: this.meta
    };
  }

  /**
   * 处理解析结果
   */
  _processResults(results) {
    for (const result of results) {
      if (result.content) {
        this.fullContent += result.content;
        this.onChunk(result.content);
      }

      if (result.meta) {
        Object.assign(this.meta, result.meta);
      }

      if (result.done) {
        this.onDone({
          content: this.fullContent,
          meta: this.meta
        });
      }
    }
  }

  /**
   * 处理 EventSource（SSE）
   * @param {string} url
   * @param {Object} options
   */
  processEventSource(url, options = {}) {
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        const results = this.parser.parse(`data: ${event.data}\n`);
        this._processResults(results);
      };

      eventSource.onerror = (error) => {
        eventSource.close();
        if (this.fullContent) {
          resolve({ content: this.fullContent, meta: this.meta });
        } else {
          reject(error);
        }
      };

      eventSource.addEventListener('done', () => {
        eventSource.close();
        resolve({ content: this.fullContent, meta: this.meta });
      });

      // 超时处理
      if (options.timeout) {
        setTimeout(() => {
          eventSource.close();
          resolve({ content: this.fullContent, meta: this.meta });
        }, options.timeout);
      }
    });
  }

  /**
   * 重置适配器状态
   */
  reset() {
    this.parser.reset();
    this.fullContent = '';
    this.meta = {};
  }
}

/**
 * 创建流式适配器
 * @param {Object} options
 */
export function createStreamingAdapter(options = {}) {
  return new StreamingAdapter(options);
}

/**
 * 便捷函数：处理流式 fetch 响应
 * @param {Response} response
 * @param {Function} onChunk
 * @param {Object} options
 */
export async function processStreamResponse(response, onChunk, options = {}) {
  const adapter = new StreamingAdapter({
    type: options.type || StreamType.SSE,
    onChunk,
    onError: options.onError
  });

  return adapter.processResponse(response, options.signal);
}

// 向后兼容
if (typeof window !== 'undefined') {
  window.StreamingAdapter = StreamingAdapter;
  window.createStreamingAdapter = createStreamingAdapter;
  window.processStreamResponse = processStreamResponse;
  window.StreamType = StreamType;
}
