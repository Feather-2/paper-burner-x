/**
 * DeepSearch Agent Loop
 *
 * 极简核心 + 可插拔机制
 */

import { BaseAgentLoop } from "../../runtime/agent-loop.js";
import { DeepSearchState } from "./state.js";
import { getModelCaller } from "./model.js";
import { createLogger } from "./logger.js";
import { skills, executeSkill } from "./skills/index.js";
import { isPlainObject } from "../../shared/value-utils.js";

// 可选机制（按需加载）
let BudgetManager = null;
let CheckpointManager = null;
let SharedContext = null;

async function loadMechanisms() {
  try {
    const budget = await import("./budget.js");
    BudgetManager = budget.BudgetManager || budget.default;
  } catch {}
  try {
    const checkpoint = await import("./checkpoint.js");
    CheckpointManager = checkpoint.CheckpointManager || checkpoint.default;
  } catch {}
  try {
    const shared = await import("./shared-context.js");
    SharedContext = shared.SharedContext || shared.default;
  } catch {}
}

export const AgentStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

const SYSTEM_PROMPT = `你是一个文档分析助手。

## 可用技能
- manage-todos: 管理任务列表（创建、更新、完成）
- search-docs: 搜索文档内容
- write-report: 生成报告

## 工作方式
- 自由决定使用哪些技能
- 信息足够时就完成，不必完成所有任务

## 输出格式
{
  "thought": "思考过程",
  "action": "skill名称 或 complete",
  "args": { ... }
}
`;

export class DeepSearchAgentLoop extends BaseAgentLoop {
  constructor(options = {}) {
    super(options);

    this.status = AgentStatus.IDLE;
    this.state = null;
    this.messages = [];
    this.maxIterations = options.maxIterations || 20;
    this.eventBus = options.eventBus || null;

    // 可插拔机制
    this.budget = options.budget || null;
    this.checkpoint = options.checkpoint || null;
    this.sharedContext = options.sharedContext || null;

    this._logger = createLogger("agent-loop");
  }

  _emit(name, payload) {
    this.eventBus?.emit?.(name, { actor: "deepsearch", ...payload });
  }

  async run(input, context = {}) {
    await loadMechanisms();

    const { stageApi = {} } = context;
    const { signal } = stageApi;

    // 初始化
    this.state = this._ensureState(input);
    this.status = AgentStatus.RUNNING;
    this.messages = [];

    // 初始化机制
    if (BudgetManager && !this.budget) {
      this.budget = new BudgetManager(this.state);
    }
    if (SharedContext && !this.sharedContext) {
      this.sharedContext = new SharedContext();
    }

    this._emit("agent.started", { runId: this.state.runId });

    // 构建初始消息
    const sources = this.state.L0?.sources || [];
    this.messages.push({ role: "system", content: SYSTEM_PROMPT });
    this.messages.push({
      role: "user",
      content: `目标: ${this.state.taskGoal || "分析文档"}\n文档: ${sources.length} 个\n\n请开始。`,
    });

    const callModel = getModelCaller(stageApi, { usage: "agent", state: this.state });
    if (!callModel) throw new Error("No model available");

    // 主循环
    let iteration = 0;
    while (iteration < this.maxIterations) {
      iteration++;

      if (signal?.aborted) {
        this.status = AgentStatus.FAILED;
        throw new Error("Aborted");
      }

      // 预算检查
      if (this.budget?.isExhausted?.()) {
        this._logger.warn("Budget exhausted");
        break;
      }

      this._emit("agent.iteration", { iteration });

      try {
        // 调用模型
        const response = await callModel(this.messages, {
          temperature: 0.3,
          maxTokens: 1000,
          signal,
        });

        const content = response?.content || "";
        this.messages.push({ role: "assistant", content });

        // 记录 token 使用
        this.budget?.recordUsage?.(response?.usage);

        // 解析决策
        const decision = this._parseDecision(content);
        if (!decision) continue;

        // 完成
        if (decision.action === "complete") {
          if (!this.state.L1?.report) {
            await executeSkill("write-report", { action: "full" }, {
              state: this.state,
              emit: (n, p) => this._emit(n, p),
              stageApi,
            });
          }
          break;
        }

        // 执行 skill
        const result = await executeSkill(decision.action, decision.args || {}, {
          state: this.state,
          emit: (n, p) => this._emit(n, p),
          stageApi,
          sharedContext: this.sharedContext,
        });

        // 保存 checkpoint
        if (this.checkpoint) {
          await this.checkpoint.save?.(this.state, { iteration });
        }

        // 添加结果到消息
        this.messages.push({
          role: "user",
          content: `结果: ${JSON.stringify(result, null, 2)}\n\n请继续。`,
        });

      } catch (err) {
        this._logger.error("Iteration error", { error: err.message });
        this.messages.push({
          role: "user",
          content: `错误: ${err.message}\n\n请尝试其他方法。`,
        });
      }
    }

    this.status = AgentStatus.COMPLETED;
    this._emit("agent.completed", { runId: this.state.runId, iterations: iteration });

    return this._buildOutput();
  }

  _parseDecision(content) {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      return {
        thought: parsed.thought || "",
        action: parsed.action || "complete",
        args: parsed.args || {},
      };
    } catch {
      return null;
    }
  }

  _buildOutput() {
    return {
      runId: this.state.runId,
      status: this.status,
      report: this.state.L1?.report || null,
      todos: this.state.todos || [],
      claims: this.state.L1?.claims || [],
    };
  }

  _ensureState(input) {
    if (input instanceof DeepSearchState) return input;
    if (input?.state instanceof DeepSearchState) return input.state;
    if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
    if (isPlainObject(input)) return DeepSearchState.fromJSON(input);
    return new DeepSearchState();
  }
}

export default DeepSearchAgentLoop;
