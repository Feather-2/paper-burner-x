/**
 * DeepSearch Agent Loop
 *
 * 极简核心 + 可插拔
 */

import { BaseAgentLoop } from "../../runtime/core/agent-loop.js";
import { DeepSearchState } from "./state.js";
import { getModelCaller } from "./model.js";
import { createLogger } from "./runtime/logger.js";
import { tools, executeTool, getToolCatalogPrompt } from "./tools/index.js";
import { isPlainObject } from "../../shared/utils/value-utils.js";
import { robustParseJson } from "../../shared/utils/robust-json.js";
import { loadPrompt } from "../../prompts/prompt-loader.js";
import { DeepSearchEvents } from "../../runtime/events/events.js";
import { ModelResponseHandler } from "./runtime/model-response-handler.js";
import { WritingPhaseHandler } from "./runtime/writing-phase-handler.js";

// Skills 系统（动态加载）
let SkillsManager = null;
async function loadSkillsSystem() {
  try {
    const skills = await import("../../skills/index.js");
    SkillsManager = skills.SkillsManager || skills.default;
  } catch { }
}

// 可选机制（按需加载）
let BudgetManager = null;
let CheckpointManager = null;
let SharedContext = null;
let BacktrackManager = null;
let DiscoveryManager = null;
let MemoryStore = null;
let UnifiedAgentContext = null;

async function loadMechanisms() {
  try {
    const budget = await import("./budget.js");
    BudgetManager = budget.BudgetManager || budget.default;
  } catch { }
  try {
    const checkpoint = await import("./runtime/checkpoint.js");
    CheckpointManager = checkpoint.CheckpointManager || checkpoint.default;
  } catch { }
  try {
    const shared = await import("./runtime/shared-context.js");
    SharedContext = shared.SharedContext || shared.default;
  } catch { }
  try {
    const discovery = await import("../../sdk/DiscoveryManager.js");
    DiscoveryManager = discovery.DiscoveryManager || discovery.default;
  } catch { }
  try {
    const memory = await import("../../runtime/memory/memory-store.js");
    MemoryStore = memory.MemoryStore || memory.default;
  } catch { }
  try {
    const unified = await import("../../runtime/context/unified-agent-context.js");
    UnifiedAgentContext = unified.UnifiedAgentContext || unified.default;
  } catch { }
}

export const AgentStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

// 分析模式配置（默认值，可被 config.json 覆盖）
export const AnalysisMode = Object.freeze({
  QUICK: "quick",     // 快速概览
  WIDER: "wider",     // 广度优先
  DEEPER: "deeper",   // 深度优先
});

const DEFAULT_MODE_CONFIG = {
  quick: { maxIterations: 15, writeIterations: 5, maxToolCalls: 50, subagentIterations: 5, description: "快速概览" },
  wider: { maxIterations: 30, writeIterations: 10, maxToolCalls: 100, subagentIterations: 10, description: "广度优先，覆盖所有文档" },
  deeper: { maxIterations: 50, writeIterations: 15, maxToolCalls: 200, subagentIterations: 15, description: "深度优先，逐个分析" },
};

/**
 * 获取模式配置（合并 config.json 和默认值）
 */
function getModeConfig(mode, globalConfig) {
  const defaults = DEFAULT_MODE_CONFIG[mode] || DEFAULT_MODE_CONFIG.wider;
  const configOverride = globalConfig?.agent?.[mode] || {};
  return {
    ...defaults,
    ...configOverride,
    // 保留 description 和 subagentIterations（config.json 不覆盖）
    description: defaults.description,
    subagentIterations: configOverride.subagentIterations || defaults.subagentIterations,
  };
}

// 硬编码 fallback（当 md 文件加载失败时使用，工具列表由 getToolCatalogPrompt 动态生成）
const FALLBACK_SYSTEM_PROMPT = `你是一个文档分析助手。

{{TOOLS_CATALOG}}

## 输出格式
{"thought": "思考", "action": "skill名", "args": {...}}
`;

// 缓存加载的提示词
let _systemPromptTemplate = null;

/**
 * 动态构建系统提示词
 * 
 * 支持的占位符:
 * - {{TOOLS_CATALOG}}: 由 getToolCatalogPrompt() 动态生成，按优先级排序
 * - {{SKILLS_CATALOG}}: 由 SkillsManager 动态生成，基于任务目标匹配
 * - {{CURRENT_DATE}}: 当前日期
 * 
 * @param {Object} options
 * @param {string} options.skillsPrompt - Skills 注入内容
 * @returns {Promise<string>}
 */
async function getSystemPrompt({ skillsPrompt = "", config = null, mode = "wider" } = {}) {
  // 加载模板
  if (!_systemPromptTemplate) {
    try {
      _systemPromptTemplate = await loadPrompt("deepsearch/system");
    } catch (e) {
      console.warn("[deepsearch] Failed to load system.md:", e.message);
      _systemPromptTemplate = FALLBACK_SYSTEM_PROMPT;
    }
  }

  let prompt = _systemPromptTemplate;

  // 替换 {{TOOLS_CATALOG}}
  const toolsCatalog = getToolCatalogPrompt();
  if (prompt.includes("{{TOOLS_CATALOG}}")) {
    prompt = prompt.replace("{{TOOLS_CATALOG}}", toolsCatalog);
  } else {
    // 如果没有占位符，追加到末尾
    prompt = prompt + "\n\n" + toolsCatalog;
  }

  // 替换 {{SKILLS_CATALOG}}
  if (prompt.includes("{{SKILLS_CATALOG}}")) {
    prompt = prompt.replace("{{SKILLS_CATALOG}}", skillsPrompt || "（无匹配的 Skills）");
  } else if (skillsPrompt) {
    // 如果没有占位符但有 skills，追加到末尾
    prompt = prompt + "\n\n" + skillsPrompt;
  }

  // 替换 {{CURRENT_DATE}} 或 {{currentDate}}
  const currentDate = new Date().toISOString().split("T")[0];
  prompt = prompt.replace(/\{\{currentDate\}\}/gi, currentDate);

  // 替换配置相关占位符
  const reportConfig = config?.report || {};
  const modeConfig = reportConfig[mode] || {};
  const defaults = { quick: { minWords: 4000 }, wider: { minWords: 6000 }, deeper: { minWords: 10000 } };
  const minWords = modeConfig.minWords ?? defaults[mode]?.minWords ?? 6000;

  // {{minWords.quick}}, {{minWords.wider}}, {{minWords.deeper}}
  prompt = prompt.replace(/\{\{minWords\.quick\}\}/gi, String(reportConfig.quick?.minWords ?? 4000));
  prompt = prompt.replace(/\{\{minWords\.wider\}\}/gi, String(reportConfig.wider?.minWords ?? 6000));
  prompt = prompt.replace(/\{\{minWords\.deeper\}\}/gi, String(reportConfig.deeper?.minWords ?? 10000));
  prompt = prompt.replace(/\{\{minWords\}\}/gi, String(minWords));

  return prompt;
}

export class DeepSearchAgentLoop extends BaseAgentLoop {
  constructor(options = {}) {
    // 从 userConfig 提取 contextConfig
    const contextConfig = {
      contextWindow: options.contextWindow || options.userConfig?.contextWindow,
      compressThreshold: options.compressThreshold || options.userConfig?.compressThreshold,
    };
    super({ actor: "deepsearch", stageName: "deepsearch", contextConfig, ...options });

    this.status = AgentStatus.IDLE;
    this.state = null;

    // 全局配置（从 config.json 加载）
    this.globalConfig = options.config || options.globalConfig || null;

    // 分析模式（使用 getModeConfig 合并配置）
    this.mode = options.mode || AnalysisMode.WIDER;
    const modeConfig = getModeConfig(this.mode, this.globalConfig);
    this.maxIterations = options.maxIterations || modeConfig.maxIterations;
    this.writeIterations = modeConfig.writeIterations;
    this.maxToolCalls = modeConfig.maxToolCalls;
    this.subagentIterations = modeConfig.subagentIterations;

    this.eventBus = options.eventBus || null;

    // 可插拔机制
    this.budget = options.budget || null;
    this.checkpoint = options.checkpoint || null;
    this.sharedContext = options.sharedContext || null;
    this.backtrackManager = options.backtrackManager || null;
    this.discoveryManager = options.discoveryManager || null;
    this.maxBacktracks = options.maxBacktracks ?? 3;

    // 统一记忆管理（新）
    this.memory = options.memory || null;
    this.memoryConfig = options.memoryConfig || options.userConfig?.memory || null;

    // 统一上下文（门面）
    this.context = options.context || null;

    this._logger = createLogger("agent-loop");
  }

  _emit(name, payload) {
    // 添加 deepsearch. 前缀，确保事件能被 workflow 层正确捕获
    const eventName = name.startsWith("deepsearch.") ? name : `deepsearch.${name}`;
    this.eventBus?.emit?.(eventName, { actor: "deepsearch", ...payload });
  }

  async run(input, context = {}) {
    await loadMechanisms();
    await loadSkillsSystem();

    const { stageApi = {} } = context;
    const { signal } = stageApi;

    // 初始化
    this.state = this._ensureState(input);
    // 同步 mode 到 state（供 tools 使用）
    if (!this.state.userConfig) this.state.userConfig = {};
    this.state.userConfig.mode = this.mode;
    // 同步 globalConfig 到 state（供 tools 读取配置）
    if (this.globalConfig) {
      this.state.globalConfig = this.globalConfig;
    }
    const oldStatus = this.status;
    this.status = AgentStatus.RUNNING;
    this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from: oldStatus, to: AgentStatus.RUNNING });
    // 清空消息（使用父类的 _messages）
    this._messages = [];

    // 初始化机制
    if (BudgetManager && !this.budget) {
      this.budget = new BudgetManager(this.state);
    }
    if (SharedContext && !this.sharedContext) {
      this.sharedContext = new SharedContext();
    }
    if (BacktrackManager && !this.backtrackManager) {
      this.backtrackManager = new BacktrackManager({
        archive: stageApi.archive,
        maxBacktracks: this.maxBacktracks,
        emit: (n, p) => this._emit(n, p),
        logger: this._logger,
      });
    }
    if (DiscoveryManager && !this.discoveryManager) {
      this.discoveryManager = new DiscoveryManager({
        sharedContext: this.sharedContext,
        runId: this.state.runId,
        logger: this._logger
      });
    }

    // 初始化统一记忆管理
    if (MemoryStore && !this.memory) {
      this.memory = new MemoryStore({
        runId: this.state.runId,
        config: this.memoryConfig,
        eventBus: this.eventBus,
        sharedContext: this.sharedContext,
        discoveryManager: this.discoveryManager,
      });
      // 同步初始状态到 MemoryStore
      this.memory.setTaskGoal(this.state.taskGoal || "");
      if (Array.isArray(this.state.todos)) {
        for (const todo of this.state.todos) {
          this.memory.addTodo(todo);
        }
      }
    } else if (this.memory) {
      // 延迟绑定底层组件
      this.memory.bind({
        sharedContext: this.sharedContext,
        discoveryManager: this.discoveryManager,
      });
    }

    // 初始化统一上下文（门面模式）
    if (UnifiedAgentContext && !this.context) {
      this.context = new UnifiedAgentContext({
        runId: this.state.runId,
        eventBus: this.eventBus,
      });
      this.context.bind({
        state: this.state,
        memory: this.memory,
        sharedContext: this.sharedContext,
      });
    }

    this._emit(DeepSearchEvents.AGENT_STARTED, { runId: this.state.runId, mode: this.mode });

    // 构建初始消息
    const sources = this.state.L0?.sources || [];
    const modeConfig = getModeConfig(this.mode, this.globalConfig);
    const modeDesc = modeConfig.description || this.mode;

    // Skills 注入：根据任务目标匹配并注入相关 Skills
    let skillsPrompt = "";
    if (SkillsManager && this.state.taskGoal) {
      try {
        const skillsManager = new SkillsManager();
        const cwd = stageApi.cwd || process.cwd?.() || ".";
        skillsPrompt = await skillsManager.getInjectionPrompt(this.state.taskGoal, cwd);
        if (skillsPrompt) {
          this._logger.info("[Skills] Injected skills based on task goal");
        }
      } catch (err) {
        this._logger.warn(`[Skills] Failed to inject: ${err.message}`);
      }
    }

    // 动态构建系统提示词（Tools 和 Skills 都通过占位符注入）
    const systemPrompt = await getSystemPrompt({ skillsPrompt, config: this.globalConfig, mode: this.mode });
    this.addMessage({ role: "system", content: systemPrompt });
    this.addMessage({
      role: "user",
      content: `目标: ${this.state.taskGoal || "分析文档"}
文档: ${sources.length} 个
模式: ${modeDesc}

## 研究预算
- 最大迭代: ${this.maxIterations} 轮
- 工具调用上限: ${this.maxToolCalls} 次
- 写作阶段: 第 ${this.maxIterations - this.writeIterations + 1} 轮开始（预留 ${this.writeIterations} 轮写报告）

## 预算使用建议
- 前 ${Math.floor(this.maxIterations * 0.6)} 轮: 收集信息、记录 findings（至少 5 条 claims）
- 中间 ${Math.floor(this.maxIterations * 0.2)} 轮: 填补 gaps、交叉验证
- 最后 ${this.writeIterations} 轮: 写报告、提交

请开始。`,
    });

    const callModel = getModelCaller(stageApi, { usage: "agent", state: this.state });
    if (!callModel) throw new Error("No model available");

    // 模型响应处理器（封装重试逻辑）
    const responseHandler = new ModelResponseHandler({
      logger: this._logger,
      emit: (n, p) => this._emit(n, p),
      parseDecision: (content) => this._parseDecision(content),
      maxRetries: 5,
    });

    // 主循环
    let iteration = 0;
    let toolCallCount = 0;  // 工具调用计数

    while (iteration < this.maxIterations) {
      // 检查工具调用次数限制
      if (toolCallCount >= this.maxToolCalls) {
        this._logger.info(`工具调用次数达到上限 (${toolCallCount}/${this.maxToolCalls})，强制进入写作阶段`);
        break;
      }

      // 显示上下文状态
      const contextStatus = this.getContextStatus?.() || {};
      const totalTokens = contextStatus.tokenUsage?.total || 0;
      const tokenPct = contextStatus.contextWindow
        ? Math.round((totalTokens / contextStatus.contextWindow) * 100)
        : 0;
      const compressFlag = contextStatus.needsCompression ? " [COMPRESS]" : "";
      const retryInfo = responseHandler.retryCount > 0 ? ` (retry ${responseHandler.retryCount}/${responseHandler.maxRetries})` : "";
      this._logger.debug(`Iteration ${iteration + 1}/${this.maxIterations}${retryInfo} | Tokens: ${totalTokens} (${tokenPct}%)${compressFlag} | Messages: ${this._messages.length}`);

      if (signal?.aborted) {
        this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from: this.status, to: AgentStatus.FAILED });
        this.status = AgentStatus.FAILED;
        throw new Error("Aborted");
      }

      // 预算检查
      if (this.budget?.isExhausted?.()) {
        this._logger.warn("Budget exhausted");
        break;
      }

      this._emit(DeepSearchEvents.AGENT_ITERATION, { iteration: iteration + 1, retry: responseHandler.retryCount });

      // [Shadow System] 注入潜意识信号 (上下文工程：即时性、不留痕)
      const shadow = stageApi.agent?.shadow || context.agent?.shadow;
      let transientMessages = this.messages;
      if (shadow) {
        // [元认知] 传入当前 messages，让影子系统判断是否有必要注入
        const subconsciousAlert = shadow.getInjectedPrompt(this.messages);
        if (subconsciousAlert) {
          this._logger.info("[Shadow] Injecting subconscious alert (ephemeral)");
          // 仅为当前调用注入，不改变持久的 this.messages
          transientMessages = [
            ...this.messages,
            { role: "user", content: subconsciousAlert }
          ];
        }
      }

      // [Blackboard] 注入 SharedContext 黑板摘要（发现、信号、决策）
      if (this.sharedContext) {
        const blackboardPrompt = this.sharedContext.buildBlackboardPrompt?.();
        if (blackboardPrompt) {
          this._logger.info("[Blackboard] Injecting context summary (ephemeral)");
          // 显示黑板内容摘要
          const claimIds = this.sharedContext.search?.("finding_claim") || [];
          const gapIds = this.sharedContext.search?.("finding_gap") || [];
          if (claimIds.length > 0 || gapIds.length > 0) {
            this._logger.debug(`Blackboard: Claims=${claimIds.length}, Gaps=${gapIds.length}`);
          }
          transientMessages = [
            ...transientMessages,
            { role: "system", content: `<blackboard>\n${blackboardPrompt}\n</blackboard>` }
          ];
        }
      }

      // [Memory] 注入统一记忆上下文（优先使用 MemoryStore）
      if (this.memory) {
        // 每轮同步底层组件数据
        this.memory.syncAll();

        // 优化：仅同步新增的消息到 MemoryStore，而非每轮全量映射
        const lastSyncedCount = this._lastSyncedMessageCount || 0;
        const newMessages = this._messages.slice(lastSyncedCount);
        if (newMessages.length > 0) {
          const simplifiedNew = newMessages.map(m => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500),
          }));
          this.memory.L1.messages.push(...simplifiedNew);
          this._lastSyncedMessageCount = this._messages.length;
        }

        // 同步 state.todos 到 MemoryStore
        if (Array.isArray(this.state?.todos)) {
          this.memory.L0.todos = this.state.todos.map(t => {
            const content = t.text || t.content || "";
            if (!content) {
              this._logger.warn(`Todo ${t.todoId || t.id} has no text/content`);
            }
            return {
              id: t.todoId || t.id,
              content,
              status: t.status === "open" ? "pending" : t.status === "done" ? "done" : t.status,
              priority: t.priority || "normal",
              ts: t.ts || Date.now(),
            };
          });
        }

        // 同步 state.L1.claims 到 MemoryStore
        if (Array.isArray(this.state?.L1?.claims)) {
          this.memory.L2.claims = this.state.L1.claims;
        }

        // 打印 MemoryStore 状态
        const stats = this.memory.getStats();
        this._logger.debug(`MemoryStore L0: todos=${stats.todoCount} | L1: msgs=${stats.messageCount} sigs=${stats.signalCount} | L2: claims=${stats.claimCount} | L3: arch=${stats.archiveCount}`);

        const memoryContext = this.memory.buildPromptContext();
        if (memoryContext) {
          this._logger.info("[Memory] Injecting unified context (ephemeral)");
          transientMessages = [
            ...transientMessages,
            { role: "system", content: `<memory>\n${memoryContext}\n</memory>` }
          ];
        }
      }

      // ===== 预算进度提示 =====
      const writeStartIteration = this.maxIterations - this.writeIterations + 1;
      const phase = iteration < writeStartIteration * 0.6 ? "收集" : iteration < writeStartIteration ? "验证" : "写作";
      const budgetStatus = `[预算] 迭代 ${iteration + 1}/${this.maxIterations} | 工具 ${toolCallCount}/${this.maxToolCalls} | 阶段: ${phase}`;
      transientMessages = [
        ...transientMessages,
        { role: "system", content: `<budget>${budgetStatus}</budget>` }
      ];

      // ===== 待办状态检查提醒 =====
      const todos = this.state?.todos || [];
      const totalTodos = todos.length;
      const doneTodos = todos.filter(t => t.status === "done" || t.status === "completed").length;
      const pendingTodos = todos.filter(t => t.status !== "done" && t.status !== "completed");

      // 发现记录数量检查
      let findingCount = 0;
      if (this.sharedContext) {
        const claims = this.sharedContext.search?.("finding_claim") || [];
        const gaps = this.sharedContext.search?.("finding_gap") || [];
        findingCount = claims.length + gaps.length;
      }
      const minFindings = { quick: 3, wider: 5, deeper: 10 }[this.mode] || 5;

      // 如果待办未完成或发现不足，注入强提醒
      if ((pendingTodos.length > 0 && iteration > 3) || findingCount < minFindings) {
        const reminders = [];
        if (pendingTodos.length > 0) {
          reminders.push(`⚠️ 待办未完成 (${doneTodos}/${totalTodos})：\n${pendingTodos.slice(0, 3).map(t => `  - ${t.text || t.content}`).join("\n")}`);
        }
        if (findingCount < minFindings) {
          reminders.push(`⚠️ 发现记录不足：当前 ${findingCount} 条，需要至少 ${minFindings} 条`);
        }
        if (reminders.length > 0) {
          transientMessages = [
            ...transientMessages,
            { role: "system", content: `<reminder>\n${reminders.join("\n\n")}\n\n请优先处理以上问题，不要跳过待办直接写报告。\n</reminder>` }
          ];
        }
      }

      try {
        // 调用模型 (使用 transientMessages)
        const response = await callModel(transientMessages, {
          temperature: 0.3,
          maxTokens: 1000,
          signal,
        });

        // 使用 ModelResponseHandler 处理响应
        const result = await responseHandler.handleResponse(response, {
          stageApi,
          addMessage: (msg) => this.addMessage(msg),
          budget: this.budget,
        });

        // 根据处理结果决定下一步
        if (result.status === "retry") {
          continue; // 不增加 iteration
        }
        if (result.status === "skip") {
          iteration++;
          continue;
        }
        if (result.status === "stop") {
          break;
        }

        // 成功解析，增加迭代次数
        const decision = result.decision;
        iteration++;
        // 同步到 state/context 供门槛检查使用
        if (this.context) this.context.iteration = iteration;
        else this.state.iteration = iteration;

        // 打印思考过程
        if (decision.thought) {
          const thoughtPreview = decision.thought.length > 150 ? decision.thought.slice(0, 150) + "..." : decision.thought;
          this._logger.debug(`Thought: ${thoughtPreview}`);
        }

        // 记录决策到 context/MemoryStore
        if (decision.action) {
          const decisionRecord = { action: decision.action, reason: decision.thought || "" };
          if (this.context) this.context.recordDecision(decisionRecord);
          else if (this.memory) this.memory.recordDecision(decisionRecord);
        }

        // 完成
        if (decision.action === "complete") {
          if (!this.state.L1?.report) {
            await executeTool("write-report", { action: "full" }, {
              state: this.state,
              emit: (n, p) => this._emit(n, p),
              stageApi,
            });
          }
          break;
        }

        // 批量执行 tools（并发）
        if (decision.actions) {
          this._logger.info(`Executing ${decision.actions.length} tools in parallel`);
          const results = await Promise.all(
            decision.actions.map(async (item) => {
              const toolName = item.action;
              const toolArgs = item.args || {};
              try {
                const result = await executeTool(toolName, toolArgs, {
                  state: this.state,
                  emit: (n, p) => this._emit(n, p),
                  stageApi,
                  sharedContext: this.sharedContext,
                  discoveryManager: this.discoveryManager,
                  memory: this.memory,
                });
                return { tool: toolName, success: true, result };
              } catch (err) {
                return { tool: toolName, success: false, error: err.message };
              }
            })
          );
          this._logger.debug(`Batch results: ${results.length} tools completed`);
          toolCallCount += results.length;  // 计数批量调用

          // 保存 checkpoint
          if (this.checkpoint) {
            await this.checkpoint.save?.(this.state, { iteration });
          }

          // 添加批量结果到消息
          this.addMessage({
            role: "user",
            content: `批量执行结果:\n${results.map((r, i) => `${i + 1}. ${r.tool}: ${r.success ? JSON.stringify(r.result) : `错误: ${r.error}`}`).join("\n")}\n\n请继续。`,
          });
          continue;
        }

        // 执行单个 tool
        this._logger.info(`Executing tool: ${decision.action}`);
        const result = await executeTool(decision.action, decision.args || {}, {
          state: this.state,
          emit: (n, p) => this._emit(n, p),
          stageApi,
          sharedContext: this.sharedContext,
          discoveryManager: this.discoveryManager,
          memory: this.memory,
        });
        toolCallCount++;  // 计数单个调用
        this._logger.debug(`Tool result: ${JSON.stringify(result).slice(0, 200)}`);

        // watchdog handoff 触发回溯
        if (result?.mode === "handoff" && this.backtrackManager?.canBacktrack?.()) {
          const backtrackResult = await this.backtrackManager.backtrack(
            this.state,
            null, // 使用最近的 checkpoint
            {
              failReason: result.handoff?.reason || "watchdog_handoff",
              correctionHint: result.handoff?.hint,
              sharedContext: this.sharedContext,
            }
          );
          if (backtrackResult.success && backtrackResult.state) {
            this.state = backtrackResult.state;
            this.addMessage({
              role: "user",
              content: `已回溯到之前的状态。原因: ${result.handoff?.reason || "重新开始"}\n\n请基于新状态继续。`,
            });
            continue;
          }
        }

        // 保存 checkpoint
        if (this.checkpoint) {
          await this.checkpoint.save?.(this.state, { iteration });
        }

        // 添加结果到消息
        this.addMessage({
          role: "user",
          content: `结果: ${JSON.stringify(result, null, 2)}\n\n请继续。`,
        });

      } catch (err) {
        this._logger.error("Iteration error", { error: err.message });
        this.addMessage({
          role: "user",
          content: `错误: ${err.message}\n\n请尝试其他方法。`,
        });
      }
    }

    // ===== 写作阶段：如果报告未完成，额外给 writeIterations 轮 =====
    const writingHandler = new WritingPhaseHandler({
      logger: this._logger,
      emit: (n, p) => this._emit(n, p),
      parseDecision: (content) => this._parseDecision(content),
      executeTool,
      maxIterations: this.writeIterations || 5,
      maxParseFailures: 3,
    });

    const shouldEnterWritingPhase = writingHandler.shouldEnter({
      state: this.state,
      mode: this.mode,
      globalConfig: this.globalConfig,
      iteration,
      maxIterations: this.maxIterations,
      toolCallCount,
      maxToolCalls: this.maxToolCalls,
    });

    if (shouldEnterWritingPhase) {
      await writingHandler.run({
        state: this.state,
        stageApi,
        sharedContext: this.sharedContext,
        callModel,
        addMessage: (msg) => this.addMessage(msg),
        messages: () => this.messages,
        signal,
      });
    }

    this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from: this.status, to: AgentStatus.COMPLETED });
    this.status = AgentStatus.COMPLETED;
    this._emit(DeepSearchEvents.AGENT_COMPLETED, { runId: this.state.runId, iterations: iteration });

    return this._buildOutput();
  }

  _parseDecision(content) {
    try {
      // 使用健壮的 JSON 解析（支持 markdown 代码块、修复常见问题）
      const parsed = robustParseJson(content);
      if (!parsed) return null;

      // 支持批量 actions
      if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        return {
          thought: parsed.thought || "",
          actions: parsed.actions, // 批量模式
        };
      }

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
    // 优先使用 context（统一入口），回退到 state
    const ctx = this.context;
    return {
      runId: ctx?.runId || this.state.runId,
      status: this.status,
      report: ctx?.report || this.state.L1?.report || null,
      todos: ctx?.todos || this.state.todos || [],
      claims: ctx?.claims || this.state.L1?.claims || [],
    };
  }

  _ensureState(input) {
    if (input instanceof DeepSearchState) return input;
    if (input?.state instanceof DeepSearchState) return input.state;
    if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
    if (isPlainObject(input)) return DeepSearchState.fromJSON(input);
    return new DeepSearchState();
  }

  /**
   * 获取上下文状态（统一入口）
   */
  getAgentContextStatus() {
    if (this.context) return this.context.getContextStatus();
    return {
      runId: this.state?.runId,
      iteration: this.state?.iteration || 0,
      todoCount: this.state?.todos?.length || 0,
      claimCount: this.state?.L1?.claims?.length || 0,
    };
  }
}

export default DeepSearchAgentLoop;
