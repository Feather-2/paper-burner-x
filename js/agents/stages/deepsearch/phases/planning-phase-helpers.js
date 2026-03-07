/**
 * DeepSearch Planning Phase Helpers
 */

import { getToolCatalogPrompt } from "../tools/index.js";
import { createLogger } from "../../../shared/index.js";
import { loadPrompt, renderPromptTemplate } from "../../../prompts/prompt-loader.js";

export const logger = createLogger("stages/deepsearch/phases/planning-phase");

export const EPHEMERAL_TAG = Object.freeze({
  BLACKBOARD: "blackboard",
  MEMORY: "memory",
  BUDGET: "budget",
  REMINDER: "reminder",
  CONVERGENCE: "convergence",
});

export const DEFAULT_MIN_FINDINGS_BY_MODE = Object.freeze({
  quick: 3,
  wider: 5,
  deeper: 10,
  default: 5,
});

export const ALLOWED_MODES = new Set(Object.keys(DEFAULT_MIN_FINDINGS_BY_MODE).filter((mode) => mode !== "default"));

export const WRITE_PHASE_CUTOFF_RATIO = 0.6;
export const REMINDER_AFTER_ITERATION = 3;
export const REMINDER_MAX_TODOS = 3;
export const REMINDER_TAIL = "请优先处理以上问题，不要跳过待办直接写报告。";
export const MAX_TASK_GOAL_LEN = 200;
export const MAX_MODE_DESC_LEN = 80;
export const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

/**
 * @typedef {object} SystemPromptConfigLike
 * @property {{ cacheKey?: string, failOnUnresolved?: boolean }=} prompts
 * @property {string=} promptCacheKey
 * @property {boolean=} promptFailOnUnresolved
 * @property {boolean=} promptFailFast
 * @property {{ [mode: string]: { minWords?: number } | undefined }=} report
 */

/**
 * @typedef {object} SystemPromptOptions
 * @property {string=} skillsPrompt
 * @property {SystemPromptConfigLike | null=} config
 * @property {string=} mode
 * @property {string=} cacheKey
 */

/**
 * @typedef {object} SkillsCatalogContextLike
 * @property {{
 *   cwd?: string,
 *   getCwd?: (() => string),
 *   allowProcessCwdForSkills?: boolean,
 *   skills?: { allowProcessCwdFallback?: boolean }
 * }=} stageApi
 * @property {{
 *   state?: { userConfig?: { skills?: { allowProcessCwdFallback?: boolean } } },
 *   globalConfig?: { skills?: { allowProcessCwdFallback?: boolean } }
 * }=} agent
 */

export function sanitizePromptInput(value, fallback, maxLen) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  if (!Number.isFinite(maxLen) || maxLen <= 0 || trimmed.length <= maxLen) return trimmed;
  const sliceLen = Math.max(0, maxLen - 3);
  return sliceLen > 0 ? `${trimmed.slice(0, sliceLen)}...` : trimmed.slice(0, maxLen);
}

export function resolveModeDescription(modeDescription, fallbackMode) {
  const candidate = sanitizePromptInput(modeDescription, "", MAX_MODE_DESC_LEN);
  if (candidate && ALLOWED_MODES.has(candidate)) return candidate;
  const fallback = sanitizePromptInput(fallbackMode, "wider", MAX_MODE_DESC_LEN);
  return ALLOWED_MODES.has(fallback) ? fallback : "wider";
}

export function createModelSignal(stageApi, timeoutMs) {
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

export function fingerprintText(text, maxLen = 200) {
  const t = String(text || "").slice(0, maxLen).toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 0;
  for (let i = 0; i < t.length; i++) {
    hash = ((hash << 5) - hash) + t.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

// Hardcoded fallback (tools catalog is still dynamically generated).
export const FALLBACK_SYSTEM_PROMPT = `你是一个文档分析助手。

{{TOOLS_CATALOG}}

## 输出格式
{"thought": "思考", "action": "skill名", "args": {...}}
`;

let _systemCorePromptTemplate = null;
let _systemLegacyPromptTemplate = null;
let _systemSubagentsPromptTemplate = null;
const _modePromptTemplates = new Map(); // mode -> template
let _systemPromptWarnedUnresolved = false;

/**
 * @param {SystemPromptOptions} [options]
 * @returns {string}
 */
function resolvePromptCacheKey({ cacheKey, config } = {}) {
  const direct = typeof cacheKey === "string" ? cacheKey.trim() : "";
  if (direct) return direct;
  const fromConfig =
    typeof config?.prompts?.cacheKey === "string"
      ? config.prompts.cacheKey.trim()
      : typeof config?.promptCacheKey === "string"
        ? config.promptCacheKey.trim()
        : "";
  return fromConfig || "default";
}

function resetSystemPromptCacheInternal() {
  _systemCorePromptTemplate = null;
  _systemLegacyPromptTemplate = null;
  _systemSubagentsPromptTemplate = null;
  _modePromptTemplates.clear();
  _systemPromptWarnedUnresolved = false;
}

let _activePromptCacheKey = "default";

export function resetSystemPromptCache() {
  _activePromptCacheKey = "default";
  resetSystemPromptCacheInternal();
}

/**
 * @param {SystemPromptOptions} [options]
 * @returns {Promise<string>}
 */
export async function getSystemPrompt({ skillsPrompt = "", config = null, mode = "wider", cacheKey } = {}) {
  const resolvedCacheKey = resolvePromptCacheKey({ cacheKey, config });
  if (resolvedCacheKey !== _activePromptCacheKey) {
    _activePromptCacheKey = resolvedCacheKey;
    resetSystemPromptCacheInternal();
  }

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

export async function buildSkillsPrompt({ agent, stageApi, SkillsManager }) {
  const includeSkillsCatalog =
    agent.state?.userConfig?.skills?.includeCatalog === true || agent.globalConfig?.skills?.includeCatalog === true;
  if (!SkillsManager || !includeSkillsCatalog) return "";

  try {
    const skillsManager = new SkillsManager();
    const { cwd, source } = resolveSkillsCatalogCwd({ agent, stageApi });
    if (!cwd) {
      agent._logger?.info?.("[Skills] Skipping skills catalog: cwd unavailable", { source });
      return "";
    }
    if (typeof skillsManager.getCatalogPrompt === "function") {
      const prompt = await skillsManager.getCatalogPrompt(cwd);
      if (prompt) {
        agent._logger?.info?.("[Skills] Included skills catalog", { source });
        return prompt;
      }
    }
  } catch (err) {
    agent._logger?.warn?.(`[Skills] Failed to build catalog: ${err?.message || err}`);
  }
  return "";
}

/**
 * @param {SkillsCatalogContextLike} [options]
 * @returns {{ cwd: string, source: string }}
 */
export function resolveSkillsCatalogCwd({ agent, stageApi } = {}) {
  const fromStageApiCwd = sanitizePromptInput(stageApi?.cwd, "", 4096);
  if (fromStageApiCwd) return { cwd: fromStageApiCwd, source: "stageApi.cwd" };

  if (typeof stageApi?.getCwd === "function") {
    try {
      const fromGetter = sanitizePromptInput(stageApi.getCwd(), "", 4096);
      if (fromGetter) return { cwd: fromGetter, source: "stageApi.getCwd" };
    } catch {
      // ignore getter failures
    }
  }

  const allowProcessFallback = resolveProcessCwdFallbackPolicy(agent, stageApi);
  if (!allowProcessFallback) return { cwd: "", source: "disabled" };

  const nodeProcess = (/** @type {{ process?: { cwd?: () => string } }} */ (globalThis)).process;
  const fromProcess = typeof nodeProcess?.cwd === "function" ? sanitizePromptInput(nodeProcess.cwd(), "", 4096) : "";
  if (fromProcess) return { cwd: fromProcess, source: "process.cwd" };
  return { cwd: "", source: "unavailable" };
}

/**
 * @param {SkillsCatalogContextLike["agent"]} agent
 * @param {SkillsCatalogContextLike["stageApi"]} stageApi
 * @returns {boolean}
 */
function resolveProcessCwdFallbackPolicy(agent, stageApi) {
  if (stageApi?.allowProcessCwdForSkills === true) return true;
  if (stageApi?.allowProcessCwdForSkills === false) return false;
  const stageSetting = stageApi?.skills?.allowProcessCwdFallback;
  if (typeof stageSetting === "boolean") return stageSetting;
  const userSetting = agent?.state?.userConfig?.skills?.allowProcessCwdFallback;
  if (typeof userSetting === "boolean") return userSetting;
  const globalSetting = agent?.globalConfig?.skills?.allowProcessCwdFallback;
  if (typeof globalSetting === "boolean") return globalSetting;
  return true;
}

export function logSuppressedError(agent, context, err) {
  const logTarget = agent?._logger || logger;
  const payload = { error: err?.message || err };
  if (logTarget?.debug) {
    logTarget.debug(`[deepsearch] Suppressed error in ${context}`, payload);
    return;
  }
  logTarget?.warn?.(`[deepsearch] Suppressed error in ${context}`, payload);
}

export function emitAgentEvent(agent, event, payload, options, contextLabel = event) {
  try {
    agent._emit?.(event, payload, options);
  } catch (err) {
    logSuppressedError(agent, `emit ${contextLabel}`, err);
  }
}

export function buildBudgetEphemeralMessage({ agent, plannedIteration, toolCallCount }) {
  const writeStartIteration = agent.maxIterations - agent.writeIterations + 1;
  const phase =
    plannedIteration < writeStartIteration * WRITE_PHASE_CUTOFF_RATIO
      ? "收集"
      : plannedIteration < writeStartIteration
        ? "验证"
        : "写作";
  const budgetStatus = `[预算] 迭代 ${plannedIteration}/${agent.maxIterations} | 工具 ${toolCallCount}/${agent.maxToolCalls} | 阶段: ${phase}`;
  return {
    role: "system",
    content: `<${EPHEMERAL_TAG.BUDGET}>${budgetStatus}</${EPHEMERAL_TAG.BUDGET}>`,
  };
}

export function getFindingStats(agent) {
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
  return { findingCount, findingClaims, findingGaps, minFindings };
}

export function buildConvergenceEphemeralMessages({ agent, plannedIteration, convergencePolicy, convergence, findingStats }) {
  const convergenceNotes = [];
  const { findingClaims, findingGaps, minFindings } = findingStats;
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
  if (convergenceNotes.length === 0) return [];

  emitAgentEvent(
    agent,
    "prompt.convergence.injected",
    {
      runId: agent.state?.runId,
      iteration: plannedIteration,
      noteCount: convergenceNotes.length,
      findingClaims,
      findingGaps,
    },
    { status: "injected", actor: "system" },
    "prompt.convergence.injected"
  );

  return [
    {
      role: "system",
      content: `<${EPHEMERAL_TAG.CONVERGENCE}>\n${convergenceNotes.join("\n")}\n</${EPHEMERAL_TAG.CONVERGENCE}>`,
    },
  ];
}

export function buildReminderEphemeralMessages({ agent, plannedIteration, iteration, findingStats }) {
  const todos = agent.state?.todos || [];
  const totalTodos = todos.length;
  const doneTodos = todos.filter((t) => t.status === "done" || t.status === "completed").length;
  const pendingTodos = todos.filter((t) => t.status !== "done" && t.status !== "completed");
  const { findingCount, minFindings } = findingStats;

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
    if (reminders.length === 0) return [];

    emitAgentEvent(
      agent,
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
      { status: "injected", actor: "system" },
      "prompt.reminder.injected"
    );

    return [
      {
        role: "system",
        content: `<${EPHEMERAL_TAG.REMINDER}>\n${reminders.join("\n\n")}\n\n${REMINDER_TAIL}\n</${EPHEMERAL_TAG.REMINDER}>`,
      },
    ];
  }

  return [];
}

export function buildEphemeralMessages({
  agent,
  stageApi,
  context,
  plannedIteration,
  iteration,
  toolCallCount,
  convergencePolicy,
  convergence,
}) {
  const baseMessages = agent.messages;
  const ephemeralMessages = [];

  const shadow = stageApi.agent?.shadow || context.agent?.shadow;
  if (shadow) {
    const subconsciousAlert = shadow.getInjectedPrompt(baseMessages);
    if (subconsciousAlert) {
      agent._logger?.info?.("[Shadow] Injecting subconscious alert (ephemeral)");
      emitAgentEvent(
        agent,
        "prompt.shadow.injected",
        {
          runId: agent.state?.runId,
          iteration: plannedIteration,
          chars: String(subconsciousAlert).length,
          fingerprint: fingerprintText(subconsciousAlert),
        },
        { status: "injected", actor: "system" },
        "prompt.shadow.injected"
      );
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
      emitAgentEvent(
        agent,
        "prompt.blackboard.injected",
        {
          runId: agent.state?.runId,
          iteration: plannedIteration,
          claimCount: claimIds.length,
          gapCount: gapIds.length,
          chars: String(blackboardPrompt).length,
          fingerprint: fingerprintText(blackboardPrompt),
        },
        { status: "injected", actor: "system" },
        "prompt.blackboard.injected"
      );
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
      emitAgentEvent(
        agent,
        "prompt.memory.injected",
        {
          runId: agent.state?.runId,
          iteration: plannedIteration,
          chars: String(memoryContext).length,
          fingerprint: fingerprintText(memoryContext),
        },
        { status: "injected", actor: "system" },
        "prompt.memory.injected"
      );
      ephemeralMessages.push({
        role: "system",
        content: `<${EPHEMERAL_TAG.MEMORY}>\n${memoryContext}\n</${EPHEMERAL_TAG.MEMORY}>`,
      });
    }
  }

  // ===== 预算进度提示 =====
  ephemeralMessages.push(buildBudgetEphemeralMessage({ agent, plannedIteration, toolCallCount }));

  const findingStats = getFindingStats(agent);
  // ===== Gap 收敛策略（防“调研黑洞”） =====
  ephemeralMessages.push(
    ...buildConvergenceEphemeralMessages({ agent, plannedIteration, convergencePolicy, convergence, findingStats })
  );
  // ===== 待办状态检查提醒 =====
  ephemeralMessages.push(...buildReminderEphemeralMessages({ agent, plannedIteration, iteration, findingStats }));

  return { baseMessages, ephemeralMessages };
}
