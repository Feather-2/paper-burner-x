/**
 * WritingPhaseHandler - 写作阶段处理器
 *
 * 职责：
 * - 管理写作阶段的独立迭代
 * - 监控报告字数是否达标
 * - 控制 write-report 工具的循环调用
 */

import { DeepSearchEvents } from "../../../runtime/events/events.js";
import { classifyDeepSearchError } from "../../../shared/utils/error-classifier.js";
import { maybePersistToolOutput } from "../../../runtime/core/tool-output-persistence.js";
import { loadPrompt, renderPromptTemplate } from "../../../prompts/prompt-loader.js";

/**
 * @typedef {"system"|"user"|"assistant"} DeepSearchChatRole
 *
 * @typedef {object} DeepSearchChatMessage
 * @property {DeepSearchChatRole | string} role
 * @property {any} content
 *
 * @typedef {object} DeepSearchModelCallOptions
 * @property {number=} temperature
 * @property {number=} maxTokens
 * @property {AbortSignal=} signal
 *
 * @typedef {object} DeepSearchModelResponse
 * @property {string=} content
 * @property {any=} usage
 *
 * @typedef {(messages: DeepSearchChatMessage[], options: DeepSearchModelCallOptions) => Promise<DeepSearchModelResponse>} DeepSearchCallModel
 *
 * @typedef {object} DeepSearchToolAction
 * @property {string} action
 * @property {Record<string, any>=} args
 *
 * @typedef {object} DeepSearchDecision
 * @property {string=} thought
 * @property {string=} action
 * @property {Record<string, any>=} args
 * @property {DeepSearchToolAction[]=} actions
 *
 * @typedef {(event: string, payload?: any, meta?: any) => void} DeepSearchEmit
 *
 * @typedef {(content: string) => (DeepSearchDecision | null | undefined)} DeepSearchParseDecision
 *
 * @typedef {(toolName: string, args: Record<string, any>, ctx: { state: any, emit?: DeepSearchEmit, stageApi?: any, sharedContext?: any }) => Promise<any>} DeepSearchExecuteTool
 *
 * @typedef {object} WritingPhaseHandlerOptions
 * @property {any} logger
 * @property {DeepSearchEmit=} emit
 * @property {DeepSearchParseDecision} parseDecision
 * @property {DeepSearchExecuteTool} executeTool
 * @property {number=} maxIterations
 * @property {number=} maxParseFailures
 *
 * @typedef {object} WritingPhaseShouldEnterParams
 * @property {any} state
 * @property {string} mode
 * @property {any} globalConfig
 * @property {number} iteration
 * @property {number} maxIterations
 * @property {number} toolCallCount
 * @property {number} maxToolCalls
 *
 * @typedef {object} WritingPhaseStatsParams
 * @property {any} state
 * @property {string} mode
 * @property {any} globalConfig
 *
 * @typedef {object} WritingPhaseStats
 * @property {number} wordCount
 * @property {number} minWords
 * @property {number} doneTodos
 * @property {number} totalTodos
 *
 * @typedef {object} WritingPhaseRunParams
 * @property {any} state
 * @property {any} stageApi
 * @property {any} sharedContext
 * @property {DeepSearchCallModel} callModel
 * @property {(msg: DeepSearchChatMessage) => void} addMessage
 * @property {() => DeepSearchChatMessage[]} messages
 * @property {AbortSignal=} signal
 * @property {() => (void | Promise<void>)=} flushMessages
 *
 * @typedef {object} WritingPhaseRunResult
 * @property {number} iterations
 */

let _writingPhasePromptTemplate = null;
let _writingPhaseWarnedUnresolved = false;

export class WritingPhaseHandler {
  /**
   * @param {WritingPhaseHandlerOptions} options
   */
  constructor({ logger, emit, parseDecision, executeTool, maxIterations = 5, maxParseFailures = 3 }) {
    this._logger = logger;
    this._emit = emit;
    this._parseDecision = parseDecision;
    this._executeTool = executeTool;
    this.maxIterations = maxIterations;
    this.maxParseFailures = maxParseFailures;
  }

  /**
   * 检查是否需要进入写作阶段
   * @param {WritingPhaseShouldEnterParams} params
   * @returns {boolean}
   */
  shouldEnter({ state, mode, globalConfig, iteration, maxIterations, toolCallCount, maxToolCalls }) {
    const report = state.L1?.report;
    const reportContent = report?.markdown || "";
    const wordCount = reportContent.replace(/\s+/g, "").length;
    const reportConfig = globalConfig?.report?.[mode] || {};
    const minWords = reportConfig.minWords || { quick: 4000, wider: 6000, deeper: 10000 }[mode] || 4000;

    const reachedLimit = iteration >= maxIterations || toolCallCount >= maxToolCalls;
    return wordCount < minWords && reachedLimit;
  }

  /**
   * 获取写作阶段统计信息
   * @param {WritingPhaseStatsParams} params
   * @returns {WritingPhaseStats}
   */
  getStats({ state, mode, globalConfig }) {
    const report = state.L1?.report;
    const reportContent = report?.markdown || "";
    const wordCount = reportContent.replace(/\s+/g, "").length;
    const reportConfig = globalConfig?.report?.[mode] || {};
    const minWords = reportConfig.minWords || { quick: 4000, wider: 6000, deeper: 10000 }[mode] || 4000;
    const todos = state?.todos || [];
    const doneTodos = todos.filter(t => t.status === "done" || t.status === "completed").length;

    return { wordCount, minWords, doneTodos, totalTodos: todos.length };
  }

  /**
   * 执行写作阶段
   * @param {WritingPhaseRunParams} params
   * @returns {Promise<WritingPhaseRunResult>}
   */
  async run({ state, stageApi, sharedContext, callModel, addMessage, messages, signal, flushMessages }) {
    const stats = this.getStats({ state, mode: state.userConfig?.mode, globalConfig: state.globalConfig });
    this._logger.info(`报告未完成 (${stats.wordCount}/${stats.minWords} 字)，进入写作阶段 (最多 ${this.maxIterations} 轮)`);

    // 注入写作阶段提示
    addMessage({
      role: "user",
      content: `⚠️ 研究阶段已结束，报告字数不足 (${stats.wordCount}/${stats.minWords} 字)。
待办完成: ${stats.doneTodos}/${stats.totalTodos}

进入**写作阶段**（${this.maxIterations} 轮）。

**重要**：每次只追加 500-800 字，避免 JSON 过长导致解析失败。

步骤：
1. get-findings - 回顾发现
2. append - 分批追加内容
3. submit - 提交

示例：{"thought":"补充内容","action":"write-report","args":{"action":"append","content":"## 章节\\n\\n内容..."}}`,
    });

    // 按需注入写作模块（拆分自 system prompt）
    if (_writingPhasePromptTemplate === null) {
      try {
        _writingPhasePromptTemplate = await loadPrompt("deepsearch/system-writing");
      } catch {
        _writingPhasePromptTemplate = "";
      }
    }

    if (_writingPhasePromptTemplate) {
      try {
        const report = state?.globalConfig?.report || {};
        const vars = {
          currentDate: new Date().toISOString().split("T")[0],
          "minWords.quick": report.quick?.minWords ?? 4000,
          "minWords.wider": report.wider?.minWords ?? 6000,
          "minWords.deeper": report.deeper?.minWords ?? 10000,
        };
        const cfg = state?.globalConfig || {};
        const failOnUnresolved =
          cfg?.prompts?.failOnUnresolved === true || cfg?.promptFailOnUnresolved === true || cfg?.promptFailFast === true;

        const baseOptions = { vars, keepUnresolved: false };
        const rendered = failOnUnresolved
          ? renderPromptTemplate(_writingPhasePromptTemplate, { ...baseOptions, failOnUnresolved: true })
          : !_writingPhaseWarnedUnresolved
            ? renderPromptTemplate(_writingPhasePromptTemplate, {
              ...baseOptions,
              warnOnUnresolved: true,
              onUnresolved: () => {
                _writingPhaseWarnedUnresolved = true;
              },
            })
            : renderPromptTemplate(_writingPhasePromptTemplate, baseOptions);
        addMessage({ role: "user", content: rendered });
      } catch {
        // ignore prompt injection failures
      }
    }

    let iteration = 0; // 已完成的写作轮次
    let parseFailures = 0;
    let systemRetryCount = 0;

    while (iteration < this.maxIterations) {
      const plannedIteration = iteration + 1;
      this._logger.debug(
        `Writing phase ${plannedIteration}/${this.maxIterations} (parseFailures ${parseFailures}/${this.maxParseFailures})`
      );

      if (signal?.aborted) break;

      try {
        await flushMessages?.();
        const response = await callModel(messages(), { temperature: 0.3, maxTokens: 1000, signal });
        const content = response?.content || "";

        if (!content.trim()) {
          parseFailures++;
          this._logger.warn(`Writing phase empty response ${parseFailures}/${this.maxParseFailures}`);
          if (parseFailures >= this.maxParseFailures) break;
          continue; // 系统重试：不扣减写作轮次
        }

        addMessage({ role: "assistant", content });
        const decision = this._parseDecision(content);

        if (!decision) {
          parseFailures++;
          this._logger.warn(`Writing phase parse failure ${parseFailures}/${this.maxParseFailures}`);
          if (parseFailures >= this.maxParseFailures) {
            this._logger.warn("Too many parse failures in writing phase, stopping");
            break;
          }
          addMessage({
            role: "user",
            content: `JSON 解析失败，请确保输出有效的 JSON 格式：{"thought": "...", "action": "write-report", "args": {...}}`,
          });
          continue; // 系统重试：不扣减写作轮次
        }

        parseFailures = 0;
        systemRetryCount = 0;

        // 只允许 write-report
        const actions = decision.actions || [{ action: decision.action, args: decision.args }];
        let shouldExit = false;

        for (const item of actions) {
          if (item.action === "write-report") {
            const result = await this._executeTool("write-report", item.args || {}, {
              state,
              emit: this._emit,
              stageApi,
              sharedContext,
            });

            let payloadForPrompt = result;
            try {
              const stored = await maybePersistToolOutput(/** @type {any} */ ({
                runStore: stageApi?.runStore || null,
                runId: state?.runId,
                toolName: "write-report",
                args: item.args || {},
                iteration: plannedIteration,
                result,
              }));
              payloadForPrompt = stored.inline;
            } catch {
              // ignore persistence failures
            }
            addMessage({
              role: "user",
              content: `结果: ${JSON.stringify(payloadForPrompt, null, 2)}\n\n如需读取完整 persisted output，请用 get-artifact { artifactId }。`,
            });

            if (item.args?.action === "submit" && result.success) {
              this._logger.info("报告提交成功");
              shouldExit = true;
              break;
            }
          } else if (item.action === "complete") {
            shouldExit = true;
            break;
          }
        }

        // 本轮写作成功完成（即使不退出），才扣减轮次
        iteration = plannedIteration;
        if (shouldExit) break;
      } catch (err) {
        const info = classifyDeepSearchError(err);
        this._logger.error("Writing phase error", {
          error: info.message,
          category: info.category,
          recoverable: info.recoverable,
          ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
          ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
        });

        if (!info.recoverable) {
          this._emit?.(DeepSearchEvents.AGENT_ERROR, {
            error: info.message,
            recoverable: false,
            category: info.category,
            ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
            ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
          });
          throw err;
        }

        systemRetryCount += 1;
        if (systemRetryCount >= this.maxParseFailures) {
          this._logger.warn(`Too many system retries in writing phase (${systemRetryCount}), stopping`);
          break;
        }
      }
    }

    return { iterations: iteration };
  }
}

export default WritingPhaseHandler;
