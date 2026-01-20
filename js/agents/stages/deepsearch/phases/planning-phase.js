/**
 * DeepSearch Planning Phase
 *
 * Responsibilities:
 * - Build system prompt (tools + optional skills catalog)
 * - Inject ephemeral context (shadow, blackboard, memory, budget, convergence, reminders)
 * - Call model + parse decisions (via ModelResponseHandler)
 */

import { getToolCatalogPrompt } from "../tools/index.js";
import { isPlainObject, toNonNegativeInt, toPositiveInt } from "../../../shared/index.js";
import { createLogger } from "../../../shared/index.js";
import { loadPrompt, renderPromptTemplate } from "../../../prompts/prompt-loader.js";
import { DeepSearchEvents } from "../../../runtime/index.js";

const logger = createLogger("stages/deepsearch/phases/planning-phase");

const EPHEMERAL_TAG = Object.freeze({
  BLACKBOARD: "blackboard",
  MEMORY: "memory",
  BUDGET: "budget",
  REMINDER: "reminder",
  CONVERGENCE: "convergence",
});

const DEFAULT_MIN_FINDINGS_BY_MODE = Object.freeze({
  quick: 3,
  wider: 5,
  deeper: 10,
  default: 5,
});

const ALLOWED_MODES = new Set(Object.keys(DEFAULT_MIN_FINDINGS_BY_MODE).filter((mode) => mode !== "default"));

const WRITE_PHASE_CUTOFF_RATIO = 0.6;
const REMINDER_AFTER_ITERATION = 3;
const REMINDER_MAX_TODOS = 3;
const REMINDER_TAIL = "请优先处理以上问题，不要跳过待办直接写报告。";
const MAX_TASK_GOAL_LEN = 200;
const MAX_MODE_DESC_LEN = 80;
const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

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
 * @typedef {object} DeepSearchGapsConfig
 * @property {number=} maxFindingGaps
 * @property {number=} maxGapFindings
 * @property {number=} maxGaps
 * @property {number=} gapOnlyStreakLimit
 * @property {number=} maxGapOnlyIterations
 * @property {number=} gapOnlyLimit
 * @property {number=} noProgressStreakLimit
 * @property {number=} maxNoProgressIterations
 * @property {number=} stagnationLimit
 *
 * @typedef {object} DeepSearchUserConfig
 * @property {DeepSearchGapsConfig=} gaps
 * @property {{ includeCatalog?: boolean }=} skills
 *
 * @typedef {object} DeepSearchState
 * @property {DeepSearchUserConfig=} userConfig
 *
 * @typedef {object} DeepSearchGapConvergencePolicy
 * @property {number} maxFindingGaps
 * @property {number} gapOnlyStreakLimit
 * @property {number} noProgressStreakLimit
 *
 * @typedef {object} AddInitialDeepSearchMessagesParams
 * @property {any} agent
 * @property {any} stageApi
 * @property {Function=} SkillsManager
 * @property {string=} modeDescription
 *
 * @typedef {object} DeepSearchConvergenceState
 * @property {number} lastClaimCount
 * @property {number} lastGapFindingCount
 * @property {number} lastOpenTodoCount
 * @property {number} lastCompletedTodoCount
 * @property {number} gapOnlyStreak
 * @property {number} noProgressStreak
 *
 * @typedef {object} IterationConvergenceTracker
 * @property {DeepSearchGapConvergencePolicy} convergencePolicy
 * @property {DeepSearchConvergenceState} convergence
 * @property {() => void} initBaselines
 * @property {(plannedIteration: number) => void} emitIterationCompleted
 *
 * @typedef {object} CreateIterationConvergenceTrackerParams
 * @property {any} agent
 * @property {DeepSearchGapConvergencePolicy} convergencePolicy
 *
 * @typedef {"success"|"retry"|"skip"|"stop"} PlanningIterationStatus
 *
 * @typedef {object} PlanningIterationResult
 * @property {PlanningIterationStatus} status
 * @property {DeepSearchDecision=} decision
 * @property {string=} content
 * @property {string=} reason
 *
 * @typedef {object} DeepSearchResponseHandler
 * @property {number} retryCount
 * @property {number} maxRetries
 * @property {(response: DeepSearchModelResponse, options: { stageApi: any, addMessage: (msg: DeepSearchChatMessage) => void, budget: any }) => Promise<PlanningIterationResult>} handleResponse
 *
 * @typedef {object} RunPlanningPhaseIterationParams
 * @property {any} agent
 * @property {any} stageApi
 * @property {any} context
 * @property {DeepSearchCallModel} callModel
 * @property {DeepSearchResponseHandler} responseHandler
 * @property {number} iteration
 * @property {number} toolCallCount
 * @property {number} systemRetryCount
 * @property {number} maxSystemRetriesPerIteration
 * @property {DeepSearchGapConvergencePolicy} convergencePolicy
 * @property {DeepSearchConvergenceState} convergence
 */

/**
 * 从 state.userConfig.gaps 推导 Gap 收敛策略配置。
 * @param {DeepSearchState} state
 * @returns {DeepSearchGapConvergencePolicy}
 */
export function getGapConvergencePolicy(state) {
  const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  return {
    maxFindingGaps: toNonNegativeInt(cfg.maxFindingGaps ?? cfg.maxGapFindings ?? cfg.maxGaps, 50), // 0 disables cap
    gapOnlyStreakLimit: toPositiveInt(cfg.gapOnlyStreakLimit ?? cfg.maxGapOnlyIterations ?? cfg.gapOnlyLimit, 2),
    noProgressStreakLimit: toPositiveInt(cfg.noProgressStreakLimit ?? cfg.maxNoProgressIterations ?? cfg.stagnationLimit, 3),
  };
}

function sanitizePromptInput(value, fallback, maxLen) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  if (!Number.isFinite(maxLen) || maxLen <= 0 || trimmed.length <= maxLen) return trimmed;
  const sliceLen = Math.max(0, maxLen - 3);
  return sliceLen > 0 ? `${trimmed.slice(0, sliceLen)}...` : trimmed.slice(0, maxLen);
}

function resolveModeDescription(modeDescription, fallbackMode) {
  const candidate = sanitizePromptInput(modeDescription, "", MAX_MODE_DESC_LEN);
  if (candidate && ALLOWED_MODES.has(candidate)) return candidate;
  const fallback = sanitizePromptInput(fallbackMode, "wider", MAX_MODE_DESC_LEN);
  return ALLOWED_MODES.has(fallback) ? fallback : "wider";
}

function createModelSignal(stageApi, timeoutMs) {
  const parentSignal = stageApi?.signal;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof AbortController === "undefined") {
    return { signal: parentSignal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const onAbort = () => {
    try {
      controller.abort(parentSignal?.reason);
    } catch {
      controller.abort();
    }
  };

  let timeoutId = setTimeout(() => {
    try {
      controller.abort(new Error(`Planning phase timed out after ${timeoutMs}ms`));
    } catch {
      controller.abort();
    }
  }, timeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      onAbort();
    } else if (typeof parentSignal.addEventListener === "function") {
      parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    if (parentSignal && typeof parentSignal.removeEventListener === "function") {
      parentSignal.removeEventListener("abort", onAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

function fingerprintText(text, maxLen = 200) {
  const t = String(text || "").slice(0, maxLen).toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 0;
  for (let i = 0; i < t.length; i++) {
    hash = ((hash << 5) - hash) + t.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

// Hardcoded fallback (tools catalog is still dynamically generated).
const FALLBACK_SYSTEM_PROMPT = `你是一个文档分析助手。

{{TOOLS_CATALOG}}

## 输出格式
{"thought": "思考", "action": "skill名", "args": {...}}
`;

let _systemCorePromptTemplate = null;
let _systemLegacyPromptTemplate = null;
let _systemSubagentsPromptTemplate = null;
const _modePromptTemplates = new Map(); // mode -> template
let _systemPromptWarnedUnresolved = false;

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
        logger.warn("[deepsearch] Failed to load system-core.md/system.md:", { error: e?.message || e });
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
  if (!_systemSubagentsPromptTemplate && normalizedMode !== "quick") {
    try {
      _systemSubagentsPromptTemplate = await loadPrompt("deepsearch/system-subagents");
    } catch {
      _systemSubagentsPromptTemplate = "";
    }
  }

  const toolsCatalog = getToolCatalogPrompt();
  const currentDate = new Date().toISOString().split("T")[0];

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

  const subagentsTemplate = normalizedMode === "quick" ? "" : _systemSubagentsPromptTemplate || "";
  const combinedTemplate = [_systemCorePromptTemplate, modeTemplate, subagentsTemplate].filter(Boolean).join("\n\n---\n\n");

  const failOnUnresolved =
    config?.prompts?.failOnUnresolved === true ||
    config?.promptFailOnUnresolved === true ||
    config?.promptFailFast === true;

  const baseRenderOptions = {
    vars,
    appendIfMissing,
    keepUnresolved: false,
  };

  if (failOnUnresolved) {
    return renderPromptTemplate(combinedTemplate, { ...baseRenderOptions, failOnUnresolved: true });
  }

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

async function buildSkillsPrompt({ agent, stageApi, SkillsManager }) {
  const includeSkillsCatalog =
    agent.state?.userConfig?.skills?.includeCatalog === true || agent.globalConfig?.skills?.includeCatalog === true;
  if (!SkillsManager || !includeSkillsCatalog) return "";

  try {
    const skillsManager = new SkillsManager();
    /** @type {any} */
    const nodeProcess = /** @type {any} */ (globalThis).process;
    const cwd =
      stageApi?.cwd ||
      (typeof nodeProcess?.cwd === "function" ? nodeProcess.cwd() : "");
    if (!cwd) {
      agent._logger?.info?.("[Skills] Skipping skills catalog: cwd unavailable");
      return "";
    }
    if (typeof skillsManager.getCatalogPrompt === "function") {
      const prompt = await skillsManager.getCatalogPrompt(cwd);
      if (prompt) {
        agent._logger?.info?.("[Skills] Included skills catalog");
        return prompt;
      }
    }
  } catch (err) {
    agent._logger?.warn?.(`[Skills] Failed to build catalog: ${err?.message || err}`);
  }
  return "";
}

/**
 * 注入 DeepSearch 初始 system/user 消息（system prompt + 目标/预算等提示）。
 * @param {AddInitialDeepSearchMessagesParams} params
 * @returns {Promise<void>}
 */
export async function addInitialDeepSearchMessages({
  agent,
  stageApi,
  SkillsManager,
  modeDescription,
}) {
  const skillsPrompt = await buildSkillsPrompt({ agent, stageApi, SkillsManager });
  const systemPrompt = await getSystemPrompt({ skillsPrompt, config: agent.globalConfig, mode: agent.mode });
  agent.addMessage({ role: "system", content: systemPrompt });

  const sources = agent.state.L0?.sources || [];
  const taskGoal = sanitizePromptInput(agent.state?.taskGoal, "分析文档", MAX_TASK_GOAL_LEN);
  const modeDesc = resolveModeDescription(modeDescription, agent.mode);
  agent.addMessage({
    role: "user",
    content: `目标: ${taskGoal}
文档: ${sources.length} 个
模式: ${modeDesc}

## 研究预算
- 最大迭代: ${agent.maxIterations} 轮
- 工具调用上限: ${agent.maxToolCalls} 次
- 写作阶段: 第 ${agent.maxIterations - agent.writeIterations + 1} 轮开始（预留 ${agent.writeIterations} 轮写报告）

## 预算使用建议
- 前 ${Math.floor(agent.maxIterations * 0.6)} 轮: 收集信息、记录 findings（至少 5 条 claims）
- 中间 ${Math.floor(agent.maxIterations * 0.2)} 轮: 填补 gaps、交叉验证
- 最后 ${agent.writeIterations} 轮: 写报告、提交

请开始。`,
  });
}

/**
 * 创建“收敛追踪器”，用于统计每轮 claims/gaps/todos 变化并发出 completed 事件。
 * @param {CreateIterationConvergenceTrackerParams} params
 * @returns {IterationConvergenceTracker}
 */
export function createIterationConvergenceTracker({ agent, convergencePolicy }) {
  const convergence = {
    lastClaimCount: 0,
    lastGapFindingCount: 0,
    lastOpenTodoCount: 0,
    lastCompletedTodoCount: 0,
    gapOnlyStreak: 0,
    noProgressStreak: 0,
  };

  const getIterationMetrics = () => {
    const todos = Array.isArray(agent.context?.todos)
      ? agent.context.todos
      : Array.isArray(agent.state?.todos)
        ? agent.state.todos
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

    const gaps = Array.isArray(agent.state?.L1?.gaps) ? agent.state.L1.gaps : [];
    let openGapCount = 0;
    for (const gap of gaps) {
      const status = normalize(gap?.status) || "open";
      if (status === "open") openGapCount += 1;
    }

    return { openTodoCount, completedTodoCount, blockedTodoCount, totalTodos, openGapCount };
  };

  const initBaselines = () => {
    try {
      const claimIds = agent.sharedContext?.search?.("finding_claim") || [];
      const gapIds = agent.sharedContext?.search?.("finding_gap") || [];
      const m = getIterationMetrics();
      convergence.lastClaimCount = claimIds.length;
      convergence.lastGapFindingCount = gapIds.length;
      convergence.lastOpenTodoCount = m.openTodoCount;
      convergence.lastCompletedTodoCount = m.completedTodoCount;
    } catch {
      // ignore
    }
  };

  const emitIterationCompleted = (plannedIteration) => {
    const completedIteration = Number.isFinite(plannedIteration) ? plannedIteration - 1 : null;
    if (completedIteration === null || completedIteration < 0) return;
    const metrics = getIterationMetrics();
    const claimIds = agent.sharedContext?.search?.("finding_claim") || [];
    const gapIds = agent.sharedContext?.search?.("finding_gap") || [];
    const claimCount = claimIds.length;
    const gapFindingCount = gapIds.length;

    const claimDelta = claimCount - convergence.lastClaimCount;
    const gapDelta = gapFindingCount - convergence.lastGapFindingCount;
    const completedDelta = metrics.completedTodoCount - convergence.lastCompletedTodoCount;
    const openTodoDelta = metrics.openTodoCount - convergence.lastOpenTodoCount;

    const didProgress = claimDelta > 0 || completedDelta > 0 || openTodoDelta < 0;
    if (didProgress) convergence.noProgressStreak = 0;
    else convergence.noProgressStreak += 1;

    const gapOnly = gapDelta > 0 && claimDelta <= 0 && completedDelta <= 0 && openTodoDelta >= 0;
    if (gapOnly) convergence.gapOnlyStreak += 1;
    else convergence.gapOnlyStreak = 0;

    convergence.lastClaimCount = claimCount;
    convergence.lastGapFindingCount = gapFindingCount;
    convergence.lastOpenTodoCount = metrics.openTodoCount;
    convergence.lastCompletedTodoCount = metrics.completedTodoCount;

    const payload = {
      iteration: completedIteration,
      ...metrics,
      findingClaims: claimCount,
      findingGaps: gapFindingCount,
    };
    agent._emit?.("deepsearch.iteration.completed", payload, { status: "completed" });
    agent.eventBus?.emit?.("iteration.completed", { actor: "deepsearch", status: "completed", payload });
  };

  return { convergencePolicy, convergence, initBaselines, emitIterationCompleted };
}

/**
 * 运行单轮规划阶段：注入临时上下文、调用模型、并通过 responseHandler 解析决策。
 * @param {RunPlanningPhaseIterationParams} params
 * @returns {Promise<PlanningIterationResult>}
 */
export async function runPlanningPhaseIteration({
  agent,
  stageApi,
  context,
  callModel,
  responseHandler,
  iteration,
  toolCallCount,
  systemRetryCount,
  maxSystemRetriesPerIteration,
  convergencePolicy,
  convergence,
}) {
  const plannedIteration = iteration + 1;

  const contextStatus = agent.getContextStatus?.() || {};
  const totalTokens = contextStatus.tokenUsage?.total || 0;
  const tokenPct = contextStatus.contextWindow
    ? Math.round((totalTokens / contextStatus.contextWindow) * 100)
    : 0;
  const compressFlag = contextStatus.needsCompression ? " [COMPRESS]" : "";
  const retryInfo =
    responseHandler.retryCount > 0 ? ` (retry ${responseHandler.retryCount}/${responseHandler.maxRetries})` : "";
  const systemRetryInfo =
    systemRetryCount > 0 ? ` (sys-retry ${systemRetryCount}/${maxSystemRetriesPerIteration})` : "";
  agent._logger?.debug?.(
    `Iteration ${plannedIteration}/${agent.maxIterations}${retryInfo}${systemRetryInfo} | Tokens: ${totalTokens} (${tokenPct}%)${compressFlag} | Messages: ${agent.messages.length}`
  );

  // 预算检查
  if (agent.budget?.isExhausted?.()) {
    agent._logger?.warn?.("Budget exhausted");
    return { status: "stop", reason: "budget_exhausted" };
  }

  agent._emit?.(DeepSearchEvents.AGENT_ITERATION, {
    iteration: plannedIteration,
    retry: responseHandler.retryCount,
    systemRetry: systemRetryCount,
  });

  // Fail-safe: ensure any scheduled compression has applied before the model call.
  await agent.flushCompression?.();

  const shadow = stageApi.agent?.shadow || context.agent?.shadow;
  const baseMessages = agent.messages;
  const ephemeralMessages = [];
  if (shadow) {
    const subconsciousAlert = shadow.getInjectedPrompt(baseMessages);
    if (subconsciousAlert) {
      agent._logger?.info?.("[Shadow] Injecting subconscious alert (ephemeral)");
      try {
        agent._emit?.(
          "prompt.shadow.injected",
          {
            runId: agent.state?.runId,
            iteration: plannedIteration,
            chars: String(subconsciousAlert).length,
            fingerprint: fingerprintText(subconsciousAlert),
          },
          { status: "injected", actor: "system" }
        );
      } catch {
        // ignore
      }
      ephemeralMessages.push({ role: "user", content: subconsciousAlert });
    }
  }

  // [Blackboard] 注入 SharedContext 黑板摘要（发现、信号、决策）
  if (agent.sharedContext) {
    const blackboardPrompt = agent.sharedContext.buildBlackboardPrompt?.();
    if (blackboardPrompt) {
      agent._logger?.info?.("[Blackboard] Injecting context summary (ephemeral)");
      const claimIds = agent.sharedContext.search?.("finding_claim") || [];
      const gapIds = agent.sharedContext.search?.("finding_gap") || [];
      if (claimIds.length > 0 || gapIds.length > 0) {
        agent._logger?.debug?.(`Blackboard: Claims=${claimIds.length}, Gaps=${gapIds.length}`);
      }
      try {
        agent._emit?.(
          "prompt.blackboard.injected",
          {
            runId: agent.state?.runId,
            iteration: plannedIteration,
            claimCount: claimIds.length,
            gapCount: gapIds.length,
            chars: String(blackboardPrompt).length,
            fingerprint: fingerprintText(blackboardPrompt),
          },
          { status: "injected", actor: "system" }
        );
      } catch {
        // ignore
      }
      ephemeralMessages.push({
        role: "system",
        content: `<${EPHEMERAL_TAG.BLACKBOARD}>\n${blackboardPrompt}\n</${EPHEMERAL_TAG.BLACKBOARD}>`,
      });
    }
  }

  // [Memory] 注入统一记忆上下文（优先使用 MemoryStore）
  if (agent.memory) {
    agent.memory.syncAll();

    const lastSyncedCount = agent._lastSyncedMessageCount || 0;
    const newMessages = agent.messages.slice(lastSyncedCount);
    if (newMessages.length > 0) {
      const simplifiedNew = newMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500),
      }));
      agent.memory.addMessages?.(simplifiedNew);
      agent._lastSyncedMessageCount = agent.messages.length;
    }

    if (Array.isArray(agent.state?.todos)) {
      const todos = agent.state.todos.map((t) => {
        const content = t.text || t.content || "";
        if (!content) {
          agent._logger?.warn?.(`Todo ${t.todoId || t.id} has no text/content`);
        }
        return {
          id: t.todoId || t.id,
          content,
          status: t.status === "open" ? "pending" : t.status === "done" ? "done" : t.status,
          priority: t.priority || "normal",
          ts: t.ts || Date.now(),
        };
      });
      agent.memory.replaceTodos?.(todos);
    }

    if (Array.isArray(agent.state?.L1?.claims)) {
      agent.memory.replaceClaims?.(agent.state.L1.claims);
    }

    const stats = agent.memory.getStats();
    agent._logger?.debug?.(
      `MemoryStore L0: todos=${stats.todoCount} | L1: msgs=${stats.messageCount} sigs=${stats.signalCount} | L2: claims=${stats.claimCount} | L3: arch=${stats.archiveCount}`
    );

    const memoryContext = agent.memory.buildPromptContext();
    if (memoryContext) {
      agent._logger?.info?.("[Memory] Injecting unified context (ephemeral)");
      try {
        agent._emit?.(
          "prompt.memory.injected",
          {
            runId: agent.state?.runId,
            iteration: plannedIteration,
            chars: String(memoryContext).length,
            fingerprint: fingerprintText(memoryContext),
          },
          { status: "injected", actor: "system" }
        );
      } catch {
        // ignore
      }
      ephemeralMessages.push({
        role: "system",
        content: `<${EPHEMERAL_TAG.MEMORY}>\n${memoryContext}\n</${EPHEMERAL_TAG.MEMORY}>`,
      });
    }
  }

  // ===== 预算进度提示 =====
  const writeStartIteration = agent.maxIterations - agent.writeIterations + 1;
  const phase =
    plannedIteration < writeStartIteration * WRITE_PHASE_CUTOFF_RATIO
      ? "收集"
      : plannedIteration < writeStartIteration
        ? "验证"
        : "写作";
  const budgetStatus = `[预算] 迭代 ${plannedIteration}/${agent.maxIterations} | 工具 ${toolCallCount}/${agent.maxToolCalls} | 阶段: ${phase}`;
  ephemeralMessages.push({
    role: "system",
    content: `<${EPHEMERAL_TAG.BUDGET}>${budgetStatus}</${EPHEMERAL_TAG.BUDGET}>`,
  });

  // ===== 待办状态检查提醒 =====
  const todos = agent.state?.todos || [];
  const totalTodos = todos.length;
  const doneTodos = todos.filter((t) => t.status === "done" || t.status === "completed").length;
  const pendingTodos = todos.filter((t) => t.status !== "done" && t.status !== "completed");

  // 发现记录数量检查
  let findingCount = 0;
  let findingClaims = 0;
  let findingGaps = 0;
  if (agent.sharedContext) {
    const claims = agent.sharedContext.search?.("finding_claim") || [];
    const gaps = agent.sharedContext.search?.("finding_gap") || [];
    findingClaims = claims.length;
    findingGaps = gaps.length;
    findingCount = findingClaims + findingGaps;
  }
  const minFindings = DEFAULT_MIN_FINDINGS_BY_MODE[agent.mode] || DEFAULT_MIN_FINDINGS_BY_MODE.default;

  // ===== Gap 收敛策略（防“调研黑洞”） =====
  const convergenceNotes = [];
  if (convergencePolicy.maxFindingGaps > 0 && findingGaps >= convergencePolicy.maxFindingGaps) {
    convergenceNotes.push(
      `⚠️ Gap 预算已达上限：${findingGaps}/${convergencePolicy.maxFindingGaps}。本轮请停止新增 gaps，优先合并/去重并填补最重要的 3 个。`
    );
  }
  if (convergence.gapOnlyStreak >= convergencePolicy.gapOnlyStreakLimit && findingGaps > 0) {
    convergenceNotes.push(
      `⚠️ 连续 ${convergence.gapOnlyStreak} 轮只新增 gaps 且无新增 claims/完成 todo（边际收益低）。本轮请先把 gaps 变成可验证 claims，或将无法填补的 gap 标记为 blocked/cancelled。`
    );
  }
  if (convergence.noProgressStreak >= convergencePolicy.noProgressStreakLimit && findingClaims >= minFindings) {
    convergenceNotes.push(
      `⚠️ 连续 ${convergence.noProgressStreak} 轮无有效进展（claims/todos）。已达到最小发现门槛 ${findingClaims}/${minFindings}，请收敛范围并进入写作/总结。`
    );
  }
  if (convergenceNotes.length > 0) {
    try {
      agent._emit?.(
        "prompt.convergence.injected",
        {
          runId: agent.state?.runId,
          iteration: plannedIteration,
          noteCount: convergenceNotes.length,
          findingClaims,
          findingGaps,
        },
        { status: "injected", actor: "system" }
      );
    } catch {
      // ignore
    }
    ephemeralMessages.push({
      role: "system",
      content: `<${EPHEMERAL_TAG.CONVERGENCE}>\n${convergenceNotes.join("\n")}\n</${EPHEMERAL_TAG.CONVERGENCE}>`,
    });
  }

  // 如果待办未完成或发现不足，注入强提醒
  if ((pendingTodos.length > 0 && iteration > REMINDER_AFTER_ITERATION) || findingCount < minFindings) {
    const reminders = [];
    if (pendingTodos.length > 0) {
      reminders.push(
        `⚠️ 待办未完成 (${doneTodos}/${totalTodos})：\n${pendingTodos
          .slice(0, REMINDER_MAX_TODOS)
          .map((t) => `  - ${t.text || t.content}`)
          .join("\n")}`
      );
    }
    if (findingCount < minFindings) {
      reminders.push(`⚠️ 发现记录不足：当前 ${findingCount} 条，需要至少 ${minFindings} 条`);
    }
    if (reminders.length > 0) {
      try {
        agent._emit?.(
          "prompt.reminder.injected",
          {
            runId: agent.state?.runId,
            iteration: plannedIteration,
            reason: [
              pendingTodos.length > 0 ? "pending_todos" : null,
              findingCount < minFindings ? "low_findings" : null,
            ].filter(Boolean),
            pendingTodos: pendingTodos.length,
            doneTodos,
            totalTodos,
            findingCount,
            minFindings,
          },
          { status: "injected", actor: "system" }
        );
      } catch {
        // ignore
      }
      ephemeralMessages.push({
        role: "system",
        content: `<${EPHEMERAL_TAG.REMINDER}>\n${reminders.join("\n\n")}\n\n${REMINDER_TAIL}\n</${EPHEMERAL_TAG.REMINDER}>`,
      });
    }
  }

  const transientMessages = ephemeralMessages.length > 0 ? [...baseMessages, ...ephemeralMessages] : baseMessages;

  const modelTimeoutMs = toPositiveInt(
    stageApi?.modelTimeoutMs ?? stageApi?.env?.DEEPSEARCH_MODEL_TIMEOUT_MS,
    DEFAULT_MODEL_TIMEOUT_MS
  );
  const { signal: modelSignal, cleanup: cleanupModelSignal } = createModelSignal(stageApi, modelTimeoutMs);
  let response;
  try {
    response = await callModel(transientMessages, {
      temperature: 0.3,
      maxTokens: 1000,
      signal: modelSignal,
    });
  } finally {
    cleanupModelSignal();
  }

  const result = await responseHandler.handleResponse(response, {
    stageApi,
    addMessage: (msg) => agent.addMessage(msg),
    budget: agent.budget,
  });

  if (result.status !== "success") return result;

  const decision = result.decision;
  if (agent.context) agent.context.iteration = plannedIteration;
  else agent.state.iteration = plannedIteration;

  if (decision.thought) {
    const thoughtPreview = decision.thought.length > 150 ? decision.thought.slice(0, 150) + "..." : decision.thought;
    agent._logger?.debug?.(`Thought: ${thoughtPreview}`);
  }

  if (decision.action) {
    const decisionRecord = { action: decision.action, reason: decision.thought || "" };
    if (agent.context) agent.context.recordDecision(decisionRecord);
    else if (agent.memory) agent.memory.recordDecision(decisionRecord);
  }

  return { status: "success", decision };
}
