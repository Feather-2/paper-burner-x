/**
 * DeepSearch Agent Loop
 *
 * 极简核心 + 可插拔
 */

import { BaseAgentLoop } from "../../runtime/core/agent-loop.js";
import { DeepSearchState } from "./state.js";
import { getModelCaller } from "./model.js";
import { createLogger } from "./runtime/logger.js";
import { executeTool, getToolCatalogPrompt } from "./tools/index.js";
import { isPlainObject, sanitizeForJson } from "../../shared/utils/value-utils.js";
import { robustParseJson } from "../../shared/utils/robust-json.js";
import { loadPrompt, renderPromptTemplate } from "../../prompts/prompt-loader.js";
import { DeepSearchEvents } from "../../runtime/events/events.js";
import { ModelResponseHandler } from "./runtime/model-response-handler.js";
import { WritingPhaseHandler } from "./runtime/writing-phase-handler.js";
import { classifyDeepSearchError } from "./runtime/error-classifier.js";
import SourceManager from "./source-manager.js";
import { maybePersistToolOutput } from "../../runtime/persisted-output.js";

// Skills 系统（动态加载）
let SkillsManager = null;
async function loadSkillsSystem() {
  try {
    const skills = await import("../../skills/index.js");
    SkillsManager = skills.SkillsManager || skills.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load skills system:", msg);
  }
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
    const budget = await import("../../shared/utils/budget.js");
    BudgetManager = budget.BudgetManager || budget.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load BudgetManager:", msg);
  }
  try {
    const checkpoint = await import("./runtime/checkpoint.js");
    CheckpointManager = checkpoint.CheckpointManager || checkpoint.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load CheckpointManager:", msg);
  }
  try {
    const shared = await import("./runtime/shared-context.js");
    SharedContext = shared.SharedContext || shared.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load SharedContext:", msg);
  }
  try {
    const backtrack = await import("./runtime/backtrack-manager.js");
    BacktrackManager = backtrack.BacktrackManager || backtrack.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load BacktrackManager:", msg);
  }
  try {
    const discovery = await import("../../sdk/DiscoveryManager.js");
    DiscoveryManager = discovery.DiscoveryManager || discovery.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load DiscoveryManager:", msg);
  }
  try {
    const memory = await import("../../runtime/memory/memory-store.js");
    MemoryStore = memory.MemoryStore || memory.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load MemoryStore:", msg);
  }
  try {
    const unified = await import("../../runtime/context/unified-agent-context.js");
    UnifiedAgentContext = unified.UnifiedAgentContext || unified.default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[deepsearch] Failed to load UnifiedAgentContext:", msg);
  }
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

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function deepSortForStableJson(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => deepSortForStableJson(v, seen));

  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = deepSortForStableJson(value[key], seen);
  }
  return out;
}

function stableStringify(value, { maxChars = 2000 } = {}) {
  const cleaned = sanitizeForJson(value);
  let s = "";
  try {
    s = JSON.stringify(deepSortForStableJson(cleaned));
  } catch {
    try {
      s = JSON.stringify(cleaned);
    } catch {
      s = String(value ?? "");
    }
  }
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(0, Math.floor(Number(maxChars))) : 0;
  if (!limit || s.length <= limit) return s;
  return s.slice(0, limit) + "...";
}

function normalizeToolCallGuard(config) {
  const cfg = isPlainObject(config) ? config : {};
  const enabled = cfg.enabled === true;
  const maxConsecutive = toPositiveInt(cfg.maxConsecutive, 6);
  const warnAt = toPositiveInt(cfg.warnAt, Math.max(2, maxConsecutive - 1));
  const maxSigChars = toPositiveInt(cfg.maxSignatureChars, 2000);
  const ignoreTools = new Set(Array.isArray(cfg.ignoreTools) ? cfg.ignoreTools.map(String).filter(Boolean) : []);
  return { enabled, maxConsecutive, warnAt, maxSigChars, ignoreTools };
}

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

// 缓存加载的提示词（模块化）
let _systemCorePromptTemplate = null;
let _systemLegacyPromptTemplate = null;
let _systemSubagentsPromptTemplate = null;
const _modePromptTemplates = new Map(); // mode -> template
let _systemPromptWarnedUnresolved = false;

/**
 * 动态构建系统提示词
 * 
 * 支持的占位符:
 * - {{TOOLS_CATALOG}}: 由 getToolCatalogPrompt() 动态生成，按优先级排序
 * - {{SKILLS_CATALOG}}: 由 SkillsManager 动态生成，基于任务目标匹配
 * - {{currentDate}}: 当前日期（兼容 {{CURRENT_DATE}}）
 * 
 * @param {Object} options
 * @param {string} options.skillsPrompt - Skills 注入内容
 * @returns {Promise<string>}
 */
async function getSystemPrompt({ skillsPrompt = "", config = null, mode = "wider" } = {}) {
  const normalizedMode = typeof mode === "string" && mode ? mode : "wider";

  // Load core prompt module (preferred). Fall back to legacy system.md when missing.
  if (!_systemCorePromptTemplate) {
    try {
      _systemCorePromptTemplate = await loadPrompt("deepsearch/system-core");
    } catch (e) {
      try {
        if (!_systemLegacyPromptTemplate) _systemLegacyPromptTemplate = await loadPrompt("deepsearch/system");
        _systemCorePromptTemplate = _systemLegacyPromptTemplate;
      } catch {
        console.warn("[deepsearch] Failed to load system-core.md/system.md:", e?.message || e);
        _systemCorePromptTemplate = FALLBACK_SYSTEM_PROMPT;
      }
    }
  }

  // Load mode module (quick/wider/deeper) on demand.
  let modeTemplate = _modePromptTemplates.get(normalizedMode) || null;
  if (!modeTemplate) {
    try {
      modeTemplate = await loadPrompt(`deepsearch/${normalizedMode}`);
      _modePromptTemplates.set(normalizedMode, modeTemplate);
    } catch {
      modeTemplate = "";
      _modePromptTemplates.set(normalizedMode, modeTemplate);
    }
  }

  // Load SubAgents module only when relevant (keeps prompt smaller in quick mode).
  if (!_systemSubagentsPromptTemplate && normalizedMode !== AnalysisMode.QUICK) {
    try {
      _systemSubagentsPromptTemplate = await loadPrompt("deepsearch/system-subagents");
    } catch {
      _systemSubagentsPromptTemplate = "";
    }
  }

  // 变量注入（统一入口：PromptLoader.renderPromptTemplate）
  const toolsCatalog = getToolCatalogPrompt();
  const currentDate = new Date().toISOString().split("T")[0];

  // 替换配置相关占位符
  const reportConfig = config?.report || {};
  const modeConfig = reportConfig[mode] || {};
  const defaults = { quick: { minWords: 4000 }, wider: { minWords: 6000 }, deeper: { minWords: 10000 } };
  const minWords = modeConfig.minWords ?? defaults[mode]?.minWords ?? 6000;

  const vars = {
    TOOLS_CATALOG: toolsCatalog,
    SKILLS_CATALOG: skillsPrompt || "（无匹配的 Skills）",
    currentDate,
    CURRENT_DATE: currentDate,
    minWords,
    "minWords.quick": reportConfig.quick?.minWords ?? 4000,
    "minWords.wider": reportConfig.wider?.minWords ?? 6000,
    "minWords.deeper": reportConfig.deeper?.minWords ?? 10000,
  };

  const appendIfMissing = {
    TOOLS_CATALOG: toolsCatalog,
    ...(skillsPrompt ? { SKILLS_CATALOG: skillsPrompt } : {}),
  };

  const subagentsTemplate = normalizedMode === AnalysisMode.QUICK ? "" : _systemSubagentsPromptTemplate || "";
  const combinedTemplate = [_systemCorePromptTemplate, modeTemplate, subagentsTemplate].filter(Boolean).join("\n\n---\n\n");

  const failOnUnresolved =
    config?.prompts?.failOnUnresolved === true ||
    config?.promptFailOnUnresolved === true ||
    config?.promptFailFast === true;

  const baseRenderOptions = {
    vars,
    appendIfMissing,
    // Do not leak {{...}} placeholders into the model context by default.
    // When a variable is missing, we warn once (or fail-fast when configured) and strip the placeholder.
    keepUnresolved: false,
  };

  // Fail-fast mode: surface template drift as an explicit error.
  if (failOnUnresolved) {
    return renderPromptTemplate(combinedTemplate, { ...baseRenderOptions, failOnUnresolved: true });
  }

  // Warn once if key placeholders remain unresolved (helps catch config/vars drift) — but keep the prompt clean.
  if (!_systemPromptWarnedUnresolved) {
    return renderPromptTemplate(combinedTemplate, {
      ...baseRenderOptions,
      warnOnUnresolved: true,
      onUnresolved: () => {
        _systemPromptWarnedUnresolved = true;
      },
    });
  }

  return renderPromptTemplate(combinedTemplate, baseRenderOptions);
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

    this.sourceManager = options.sourceManager || null;

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
    this._failureReported = false;

    // Repeated tool-call guard (doom-loop mitigation) — opt-in, browser-safe.
    this._toolCallGuardConfig = normalizeToolCallGuard(
      options.toolCallGuard || options.doomLoopGuard || options.userConfig?.toolCallGuard || options.globalConfig?.toolCallGuard
    );
    this._toolCallGuardState = { lastSig: null, consecutive: 0, warnedAt: 0 };
  }

  _recordToolCall(toolName, toolArgs) {
    const cfg = this._toolCallGuardConfig;
    if (!cfg?.enabled) return null;
    const name = typeof toolName === "string" ? toolName.trim() : String(toolName || "").trim();
    if (!name) return null;
    if (cfg.ignoreTools?.has(name)) return null;

    const sig = `${name}|${stableStringify(toolArgs, { maxChars: cfg.maxSigChars })}`;
    if (sig === this._toolCallGuardState.lastSig) {
      this._toolCallGuardState.consecutive += 1;
    } else {
      this._toolCallGuardState.lastSig = sig;
      this._toolCallGuardState.consecutive = 1;
      this._toolCallGuardState.warnedAt = 0;
    }

    const n = this._toolCallGuardState.consecutive;
    const shouldWarn = n >= cfg.warnAt && this._toolCallGuardState.warnedAt < cfg.warnAt;
    if (shouldWarn) this._toolCallGuardState.warnedAt = cfg.warnAt;

    const shouldStop = n >= cfg.maxConsecutive;
    return { tool: name, signature: sig, consecutive: n, shouldWarn, shouldStop };
  }

  _emit(name, payload, { actor = "deepsearch", status } = {}) {
    // 添加 deepsearch. 前缀，确保事件能被 workflow 层正确捕获
    const eventName = name.startsWith("deepsearch.") ? name : `deepsearch.${name}`;
    const record = {
      actor,
      ...(typeof status === "string" && status ? { status } : {}),
      ...(payload !== undefined ? { payload } : {}),
    };
    if (typeof this.emit === "function") {
      this.emit(eventName, record);
      return;
    }
    this.eventBus?.emit?.(eventName, record);
  }

  _markFailed(err, classification) {
    const info = classification || classifyDeepSearchError(err);
    const payload = {
      error: info.message,
      recoverable: info.recoverable,
      category: info.category,
      ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
      ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
    };

    if (!this._failureReported) {
      this._emit(DeepSearchEvents.AGENT_ERROR, payload);
      this._emit(DeepSearchEvents.AGENT_FAILED, { runId: this.state?.runId, ...payload });
      this._emit("deepsearch.failed", { runId: this.state?.runId, error: payload.error }, { status: "failed" });
      this._failureReported = true;
    }

    if (this.status !== AgentStatus.FAILED) {
      const from = this.status;
      this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from, to: AgentStatus.FAILED });
      this.status = AgentStatus.FAILED;
    }
  }

  async run(input, context = {}) {
    await loadMechanisms();
    await loadSkillsSystem();

    const { stageApi = {} } = context;
    const { signal } = stageApi;

    // 初始化
    this.state = this._ensureState(input);

    if (!this.sourceManager) {
      this.sourceManager = new SourceManager(this.state?.L0?.sources || []);
    } else {
      this.sourceManager.syncSources(this.state?.L0?.sources);
    }
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
    this._failureReported = false;
    // 清空消息（使用父类的 _messages）
    this._messages = [];

    try {
    // 初始化机制
    if (BudgetManager && !this.budget) {
      this.budget = new BudgetManager(this.state);
    }
    if (SharedContext && !this.sharedContext) {
      this.sharedContext = new SharedContext();
    }
    if (CheckpointManager && !this.checkpoint && stageApi.archive) {
      this.checkpoint = new CheckpointManager({
        archive: stageApi.archive,
        emit: (n, p) => this._emit(n, p),
        logger: this._logger,
      });
    }
    if (BacktrackManager && !this.backtrackManager) {
      this.backtrackManager = new BacktrackManager({
        archive: stageApi.archive,
        maxBacktracks: this.maxBacktracks,
        emit: (n, p) => this._emit(n, p),
        logger: this._logger,
        sideEffects: stageApi?.sideEffects || null,
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
      // Memory 2.0: bind DeepSearchState to MemoryStore so todos/flags share a single source of truth.
      if (this.state && typeof this.state.bindMemoryStore === "function") {
        this.state.bindMemoryStore(this.memory);
      }
    } else if (this.memory) {
      // 延迟绑定底层组件
      this.memory.bind({
        sharedContext: this.sharedContext,
        discoveryManager: this.discoveryManager,
      });
      if (this.state && typeof this.state.bindMemoryStore === "function") {
        this.state.bindMemoryStore(this.memory);
      }
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
    this._emit("deepsearch.started", { runId: this.state.runId }, { status: "started" });

    // 构建初始消息
    const sources = this.state.L0?.sources || [];
    const modeConfig = getModeConfig(this.mode, this.globalConfig);
    const modeDesc = modeConfig.description || this.mode;

    // Skills 注入：根据任务目标匹配并注入相关 Skills
    let skillsPrompt = "";
    if (SkillsManager && this.state.taskGoal) {
      try {
        const skillsManager = new SkillsManager();
        const cwd =
          stageApi.cwd ||
          (typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".");

        const browserLike = typeof window !== "undefined" && typeof window.document !== "undefined";
        if (browserLike && typeof skillsManager.getCatalogPrompt === "function") {
          skillsPrompt = await skillsManager.getCatalogPrompt(cwd);
        } else {
          skillsPrompt = await skillsManager.getInjectionPrompt(this.state.taskGoal, cwd);
        }
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
    let systemRetryCount = 0;
    const maxSystemRetriesPerIteration = (() => {
      const raw = this.state?.userConfig?.budget?.maxSystemRetriesPerIteration ?? this.state?.userConfig?.maxSystemRetriesPerIteration;
      const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : null;
      return n !== null && n >= 1 ? n : 3;
    })();

    const getIterationMetrics = () => {
      const todos = Array.isArray(this.context?.todos)
        ? this.context.todos
        : Array.isArray(this.state?.todos)
          ? this.state.todos
          : [];
      const normalize = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
      let completedTodoCount = 0;
      let blockedTodoCount = 0;
      for (const todo of todos) {
        const status = normalize(todo?.status);
        if (status === "completed" || status === "done") completedTodoCount += 1;
        else if (status === "cancelled" || status === "blocked") blockedTodoCount += 1;
      }
      const totalTodos = todos.length;
      const openTodoCount = Math.max(0, totalTodos - completedTodoCount - blockedTodoCount);

      const gaps = Array.isArray(this.state?.L1?.gaps) ? this.state.L1.gaps : [];
      let openGapCount = 0;
      for (const gap of gaps) {
        const status = normalize(gap?.status) || "open";
        if (status === "open") openGapCount += 1;
      }

      return { openTodoCount, completedTodoCount, blockedTodoCount, totalTodos, openGapCount };
    };

    const emitIterationCompleted = (plannedIteration) => {
      const completedIteration = Number.isFinite(plannedIteration) ? plannedIteration - 1 : null;
      if (completedIteration === null || completedIteration < 0) return;
      const payload = { iteration: completedIteration, ...getIterationMetrics() };
      this._emit("deepsearch.iteration.completed", payload, { status: "completed" });
      this.eventBus?.emit?.("iteration.completed", { actor: "deepsearch", status: "completed", payload });
    };

    while (iteration < this.maxIterations) {
      const plannedIteration = iteration + 1;
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
      const systemRetryInfo =
        systemRetryCount > 0 ? ` (sys-retry ${systemRetryCount}/${maxSystemRetriesPerIteration})` : "";
      this._logger.debug(
        `Iteration ${plannedIteration}/${this.maxIterations}${retryInfo}${systemRetryInfo} | Tokens: ${totalTokens} (${tokenPct}%)${compressFlag} | Messages: ${this._messages.length}`
      );

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

      this._emit(DeepSearchEvents.AGENT_ITERATION, {
        iteration: plannedIteration,
        retry: responseHandler.retryCount,
        systemRetry: systemRetryCount,
      });

      // Fail-safe: ensure any scheduled compression has actually applied before the model call.
      // Avoids a microtask race where we schedule compression but still send an oversized context.
      await this.flushCompression?.();

      // [Shadow System] 注入潜意识信号 (上下文工程：即时性、不留痕)
      const shadow = stageApi.agent?.shadow || context.agent?.shadow;
      const baseMessages = this.messages;
      const ephemeralMessages = [];
      if (shadow) {
        // [元认知] 传入当前 messages，让影子系统判断是否有必要注入
        const subconsciousAlert = shadow.getInjectedPrompt(baseMessages);
        if (subconsciousAlert) {
          this._logger.info("[Shadow] Injecting subconscious alert (ephemeral)");
          // 仅为当前调用注入，不改变持久的 messages
          ephemeralMessages.push({ role: "user", content: subconsciousAlert });
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
          ephemeralMessages.push({ role: "system", content: `<blackboard>\n${blackboardPrompt}\n</blackboard>` });
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
          ephemeralMessages.push({ role: "system", content: `<memory>\n${memoryContext}\n</memory>` });
        }
      }

      // ===== 预算进度提示 =====
      const writeStartIteration = this.maxIterations - this.writeIterations + 1;
      const phase =
        plannedIteration < writeStartIteration * 0.6 ? "收集" : plannedIteration < writeStartIteration ? "验证" : "写作";
      const budgetStatus = `[预算] 迭代 ${plannedIteration}/${this.maxIterations} | 工具 ${toolCallCount}/${this.maxToolCalls} | 阶段: ${phase}`;
      ephemeralMessages.push({ role: "system", content: `<budget>${budgetStatus}</budget>` });

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
          ephemeralMessages.push({
            role: "system",
            content: `<reminder>\n${reminders.join("\n\n")}\n\n请优先处理以上问题，不要跳过待办直接写报告。\n</reminder>`,
          });
        }
      }

      const transientMessages = ephemeralMessages.length > 0
        ? [...baseMessages, ...ephemeralMessages]
        : baseMessages;

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
          iteration = plannedIteration;
          if (this.context) this.context.iteration = iteration;
          else this.state.iteration = iteration;
          systemRetryCount = 0;
          emitIterationCompleted(plannedIteration);
          continue;
        }
        if (result.status === "stop") {
          break;
        }

        // 成功解析，先写入 plannedIteration（给 tools 作为本轮标识），但仅在本轮完成后才提交 iteration 计数
        const decision = result.decision;
        if (this.context) this.context.iteration = plannedIteration;
        else this.state.iteration = plannedIteration;

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
          iteration = plannedIteration;
          systemRetryCount = 0;
          emitIterationCompleted(plannedIteration);
          break;
        }

        // 批量执行 tools（并发）
        if (decision.actions) {
          this._logger.info(`Executing ${decision.actions.length} tools in parallel`);
          let loopGuardWarn = null;
          const results = await Promise.all(
            decision.actions.map(async (item) => {
              const toolName = item.action;
              const toolArgs = item.args || {};
              const guard = this._recordToolCall(toolName, toolArgs);
              if (guard?.shouldWarn) loopGuardWarn = guard;
              try {
                this.sourceManager?.syncSources?.(this.state?.L0?.sources);
                const result = await executeTool(toolName, toolArgs, {
                  state: this.state,
                  emit: (n, p) => this._emit(n, p),
                  stageApi,
                  sharedContext: this.sharedContext,
                  discoveryManager: this.discoveryManager,
                  memory: this.memory,
                  sourceManager: this.sourceManager,
                });
                const toolSuccess = typeof result?.success === "boolean" ? result.success : true;
                if (toolSuccess) return { tool: toolName, args: toolArgs, success: true, result };

                const errorMessage =
                  typeof result?.error === "string" && result.error ? result.error : "Tool returned success:false";
                return { tool: toolName, args: toolArgs, success: false, error: errorMessage, result };
              } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                return { tool: toolName, args: toolArgs, success: false, error: errorMessage };
              }
            })
          );
          this._logger.debug(`Batch results: ${results.length} tools completed`);
          toolCallCount += results.length;  // 计数批量调用

          // 保存 checkpoint
          if (this.checkpoint) {
            try {
              await this.checkpoint.save?.(this.state, {
                iteration: plannedIteration,
                metadata: {
                  ...(stageApi?.sideEffects && typeof stageApi.sideEffects.getCursor === "function"
                    ? { sideEffectsCursor: stageApi.sideEffects.getCursor() }
                    : {}),
                },
              });
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              this._logger.warn(`Checkpoint save failed (ignored): ${errorMessage}`);
            }
          }

          const runStore = stageApi?.runStore || null;
          const formatted = [];
          for (const r of results) {
            if (r?.success) {
              try {
                const stored = await maybePersistToolOutput({
                  runStore,
                  runId: this.state?.runId,
                  toolName: r.tool,
                  args: r.args,
                  iteration: plannedIteration,
                  result: r.result,
                });
                formatted.push({ ...r, inline: stored.inline, persisted: stored.persisted, ref: stored.ref || null });
              } catch {
                formatted.push({ ...r, inline: r.result, persisted: false, ref: null });
              }
              continue;
            }
            formatted.push({ ...r, inline: r.result ?? { success: false, error: r.error }, persisted: false, ref: null });
          }

          // 添加批量结果到消息
          const loopGuardNote = loopGuardWarn?.shouldWarn
            ? `\n\n[LoopGuard] 你似乎在重复调用同一个工具（${loopGuardWarn.tool}）多次（连续 ${loopGuardWarn.consecutive} 次）。请改变策略/参数，或使用 ask-user 澄清，避免卡死。`
            : "";
          this.addMessage({
            role: "user",
            content: `批量执行结果:\n${formatted
              .map((r, i) => `${i + 1}. ${r.tool}: ${JSON.stringify(r.inline)}`)
              .join("\n")}\n\n如需读取完整 persisted output，请用 get-artifact { artifactId }。${loopGuardNote}\n\n请继续。`,
          });
          iteration = plannedIteration;
          systemRetryCount = 0;
          emitIterationCompleted(plannedIteration);
          continue;
        }

        // 执行单个 tool
        this._logger.info(`Executing tool: ${decision.action}`);

        this.sourceManager?.syncSources?.(this.state?.L0?.sources);
        const toolResult = await executeTool(decision.action, decision.args || {}, {
          state: this.state,
          emit: (n, p) => this._emit(n, p),
          stageApi,
          sharedContext: this.sharedContext,
          discoveryManager: this.discoveryManager,
          memory: this.memory,
          sourceManager: this.sourceManager,
        });
        toolCallCount++;  // 计数单个调用
        this._logger.debug(`Tool result: ${JSON.stringify(toolResult).slice(0, 200)}`);
        const loopGuard = this._recordToolCall(decision.action, decision.args || {});

        // watchdog handoff 触发回溯
        if (toolResult?.mode === "handoff" && this.backtrackManager?.canBacktrack?.()) {
          try {
            const backtrackResult = await this.backtrackManager.backtrack(
              this.state,
              null, // 使用最近的 checkpoint
              {
                failReason: toolResult.handoff?.reason || "watchdog_handoff",
                correctionHint: toolResult.handoff?.hint,
                sharedContext: this.sharedContext,
              }
            );
            if (backtrackResult.success && backtrackResult.state) {
              this.state = backtrackResult.state;
              this.addMessage({
                role: "user",
                content: `已回溯到之前的状态。原因: ${toolResult.handoff?.reason || "重新开始"}\n\n请基于新状态继续。`,
              });
              iteration = plannedIteration;
              systemRetryCount = 0;
              emitIterationCompleted(plannedIteration);
              continue;
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this._logger.warn(`Backtrack failed (ignored): ${errorMessage}`);
          }
        }

        // 保存 checkpoint
        if (this.checkpoint) {
          try {
            await this.checkpoint.save?.(this.state, {
              iteration: plannedIteration,
              metadata: {
                ...(stageApi?.sideEffects && typeof stageApi.sideEffects.getCursor === "function"
                  ? { sideEffectsCursor: stageApi.sideEffects.getCursor() }
                  : {}),
              },
            });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this._logger.warn(`Checkpoint save failed (ignored): ${errorMessage}`);
          }
        }

        // 添加结果到消息
        let toolPayloadForPrompt = toolResult;
        try {
          const runStore = stageApi?.runStore || null;
          const stored = await maybePersistToolOutput({
            runStore,
            runId: this.state?.runId,
            toolName: decision.action,
            args: decision.args || {},
            iteration: plannedIteration,
            result: toolResult,
          });
          toolPayloadForPrompt = stored.inline;
        } catch {
          // ignore persistence failures (fallback to inline toolResult)
        }

        this.addMessage({
          role: "user",
          content: `结果: ${JSON.stringify(toolPayloadForPrompt, null, 2)}\n\n如需读取完整 persisted output，请用 get-artifact { artifactId }。${loopGuard?.shouldWarn ? `\n\n[LoopGuard] 你似乎在重复调用同一个工具（${loopGuard.tool}）多次（连续 ${loopGuard.consecutive} 次）。请改变策略/参数，或使用 ask-user 澄清，避免卡死。` : ""}\n\n请继续。`,
        });
        iteration = plannedIteration;
        systemRetryCount = 0;
        emitIterationCompleted(plannedIteration);

      } catch (err) {
        const info = classifyDeepSearchError(err);
        const errorMessage = info.message;
        this._logger.error("Iteration error", {
          error: errorMessage,
          category: info.category,
          recoverable: info.recoverable,
          ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
          ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
        });

        if (!info.recoverable) {
          this.addMessage({
            role: "user",
            content: `致命错误: ${errorMessage}\n\n请检查配置/权限/网络后重试。`,
          });
          this._markFailed(err, info);
          throw err;
        }

        this.addMessage({
          role: "user",
          content: `错误: ${errorMessage}\n\n请尝试其他方法。`,
        });
        systemRetryCount += 1;

        // 回滚 state/context 的 iteration（系统错误不扣减研究轮次）
        if (this.context) this.context.iteration = iteration;
        else this.state.iteration = iteration;

        if (systemRetryCount >= maxSystemRetriesPerIteration) {
          iteration = plannedIteration;
          if (this.context) this.context.iteration = iteration;
          else this.state.iteration = iteration;
          systemRetryCount = 0;
          this.addMessage({
            role: "user",
            content: `系统错误已连续发生 ${maxSystemRetriesPerIteration} 次，为避免卡死，已计入 1 轮迭代并继续。`,
          });
          emitIterationCompleted(plannedIteration);
        }
      }
    }

    // ===== 写作阶段：如果报告未完成，额外给 writeIterations 轮 =====
    const executeToolWithSources = (name, args, ctx) => {
      this.sourceManager?.syncSources?.(this.state?.L0?.sources);
      return executeTool(name, args, { ...ctx, sourceManager: this.sourceManager });
    };
    const writingHandler = new WritingPhaseHandler({
      logger: this._logger,
      emit: (n, p) => this._emit(n, p),
      parseDecision: (content) => this._parseDecision(content),
      executeTool: executeToolWithSources,
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
        flushMessages: () => this.flushCompression?.(),
      });
    }

    this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from: this.status, to: AgentStatus.COMPLETED });
    this.status = AgentStatus.COMPLETED;
    this._emit(DeepSearchEvents.AGENT_COMPLETED, { runId: this.state.runId, iterations: iteration });
    this._emit("deepsearch.completed", { runId: this.state.runId, iterations: iteration }, { status: "completed" });

    return this._buildOutput();
    } catch (err) {
      const info = classifyDeepSearchError(err);
      this._logger.error("DeepSearch run failed", {
        error: info.message,
        category: info.category,
        recoverable: info.recoverable,
        ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
        ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
      });
      this._markFailed(err, info);
      throw err;
    }
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
