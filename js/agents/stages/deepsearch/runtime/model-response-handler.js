/**
 * ModelResponseHandler - 模型响应处理器
 *
 * 职责：
 * - 封装模型调用和重试逻辑
 * - 处理空响应和解析失败
 * - 触发错误事件和用户干预
 */

import { robustParseJson } from "../../../shared/utils/robust-json.js";
import { DeepSearchEvents } from "../../../runtime/events/events.js";

export class ModelResponseHandler {
  constructor({ logger, emit, parseDecision, maxRetries = 5 }) {
    this._logger = logger;
    this._emit = emit;
    this._parseDecision = parseDecision;
    this.maxRetries = maxRetries;
    this.retryCount = 0;
  }

  /**
   * 处理模型响应
   * @param {Object} response - 模型响应
   * @param {Object} options - { stageApi, addMessage, budget }
   * @returns {{ status: 'success'|'retry'|'skip'|'stop', decision?: Object, content?: string }}
   */
  async handleResponse(response, { stageApi, addMessage, budget }) {
    const content = response?.content || "";

    // 空响应处理
    if (!content.trim()) {
      return this._handleEmptyResponse({ stageApi, addMessage });
    }

    // 记录响应
    addMessage({ role: "assistant", content });
    this._logResponse(content);
    this._emit(DeepSearchEvents.MODEL_RESPONDED, { content, usage: response.usage });
    budget?.recordUsage?.(response?.usage);

    // 解析决策
    const decision = this._parseDecision(content);
    if (!decision) {
      return this._handleParseFailure({ stageApi, addMessage });
    }

    // 成功
    this.retryCount = 0;
    return { status: "success", decision, content };
  }

  async _handleEmptyResponse({ stageApi, addMessage }) {
    this.retryCount++;
    this._logger.warn(`Empty response (retry ${this.retryCount}/${this.maxRetries})`);

    if (this.retryCount >= this.maxRetries) {
      this._logger.error("Too many empty responses, pausing");
      this._emit(DeepSearchEvents.AGENT_ERROR, { error: "Too many empty responses", recoverable: true });

      const choice = await this._askUserChoice(stageApi, `连续 ${this.maxRetries} 次空响应，是否继续？`);
      if (choice === "继续重试") {
        this.retryCount = 0;
        return { status: "retry" };
      } else if (choice === "跳过本轮") {
        this.retryCount = 0;
        return { status: "skip" };
      }
      return { status: "stop" };
    }

    addMessage({
      role: "user",
      content: '请按照指定的 JSON 格式输出你的决策：{"thought": "...", "action": "...", "args": {...}}',
    });
    return { status: "retry" };
  }

  async _handleParseFailure({ stageApi, addMessage }) {
    this.retryCount++;
    this._logger.warn(`Failed to parse decision (retry ${this.retryCount}/${this.maxRetries})`);

    if (this.retryCount >= this.maxRetries) {
      this._logger.error("Too many parse failures, pausing");
      this._emit(DeepSearchEvents.AGENT_ERROR, { error: "Too many parse failures", recoverable: true });

      const choice = await this._askUserChoice(stageApi, `连续 ${this.maxRetries} 次解析失败，是否继续？`);
      if (choice === "继续重试") {
        this.retryCount = 0;
        return { status: "retry" };
      } else if (choice === "跳过本轮") {
        this.retryCount = 0;
        return { status: "skip" };
      }
      return { status: "stop" };
    }

    addMessage({
      role: "user",
      content: '无法解析你的响应。请严格按照 JSON 格式输出：{"thought": "你的思考", "action": "工具名称", "args": {...}}',
    });
    return { status: "retry" };
  }

  async _askUserChoice(stageApi, question) {
    if (typeof stageApi?.waitForUserInput !== "function") return null;
    return stageApi.waitForUserInput({
      question,
      options: ["继续重试", "跳过本轮", "停止执行"],
    });
  }

  _logResponse(content) {
    const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
    this._logger.debug(`Model response: ${preview}`);
  }

  reset() {
    this.retryCount = 0;
  }
}

export default ModelResponseHandler;
