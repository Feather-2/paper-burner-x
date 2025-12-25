import { checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { claimsFromChunks } from "../../deepsearch/understanding/claims-from-chunks.js";
import { dedupeClaims, dedupeClaimsAI } from "../../deepsearch/understanding/dedupe.js";
import { detectConflicts, detectConflictsAI } from "../../deepsearch/understanding/conflicts.js";
import { createLogger } from "./logger.js";
import { extractServices } from "./stage-api.js";
import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";
import { mapConcurrentWithPool } from "../../shared/concurrency.js";
import { LLM_CLAIMS_PROMPT, REFLECT_PROMPT } from "./understand-prompts.js";
import {
  assertHardGates,
  clampProgress,
  collapseWhitespace,
  ensureState,
  formatChunksForLLM,
  indexSourceTextById,
  locateQuoteInSourceSlice,
  normalizeGapIds,
  normalizeTodoIds,
  normalizeImportance,
  normalizeUnderstandClaimEditsCacheKeyInputs,
  quoteFromSourceLocator,
  safeArray,
  safeChunkIndex,
  truncate,
  validateSingleEvidence,
} from "./understand-utils.js";
import { migratGapToTodo } from "./todo-utils.js";

export function computeGapFill(gaps, { claims, evidenceLedger } = {}) {
  const gapList = Array.isArray(gaps) ? gaps : [];
  const filled = new Set();

  for (const c of Array.isArray(claims) ? claims : []) {
    for (const gid of normalizeGapIds(c?.gapIds)) filled.add(gid);
  }
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    for (const gid of normalizeGapIds(e?.gapIds)) filled.add(gid);
  }

  const filledGapIds = [];
  const remainingGaps = [];
  for (const g of gapList) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    if (filled.has(gid)) filledGapIds.push(gid);
    else remainingGaps.push(g);
  }
  return { filledGapIds, remainingGaps };
}

function ensureTodos(state) {
  const existing = Array.isArray(state?.todos) ? state.todos : [];
  if (existing.length) return existing;

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  if (!gaps.length) {
    if (!Array.isArray(state?.todos)) state.todos = [];
    return state.todos;
  }

  const migrated = [];
  for (const gap of gaps) {
    const todo = migratGapToTodo(gap);
    if (todo) migrated.push(todo);
  }
  state.todos = migrated;
  return state.todos;
}

function buildTodoLookup(todos) {
  const todoById = new Map();
  const todoIdByGapId = new Map();
  const gapIdByTodoId = new Map();
  for (const t of Array.isArray(todos) ? todos : []) {
    const todoId = toNonEmptyString(t?.todoId);
    if (!todoId) continue;
    todoById.set(todoId, t);
    const gapId = toNonEmptyString(t?.relatedGapId);
    if (gapId) {
      todoIdByGapId.set(gapId, todoId);
      gapIdByTodoId.set(todoId, gapId);
    }
  }
  return { todoById, todoIdByGapId, gapIdByTodoId };
}

function todoDisplayText(todo) {
  return toNonEmptyString(todo?.text) || toNonEmptyString(todo?.question) || toNonEmptyString(todo?.title) || "";
}
/**
 * S5 Understanding wrapper (placeholder): convert retrievedChunks to claims[] + evidenceLedger[].
 * @param {object} runContext
 * @param {import("./state.js").DeepSearchState|{state:import("./state.js").DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchUnderstandStage(runContext, input, stageApi = {}) {
  // 最早的入口日志
  console.log("[DeepSearch] understand stage entry", {
    hasState: !!input?.state,
    stateType: input?.state?.constructor?.name,
  });

  const { emit: rawEmit, logger: injectedLogger } = extractServices(stageApi);
  const emit = makeStageEmitter(stageApi, "deepsearch");

  let state;
  try {
    state = ensureState(runContext, input);
  } catch (err) {
    console.error("[DeepSearch] understand ensureState failed:", err);
    throw err;
  }

  const logger =
    injectedLogger && typeof injectedLogger.info === "function"
      ? injectedLogger
      : createLogger({
          emit: rawEmit,
          getContext: () => ({ runId: state.runId, iteration: state.iteration || 0, trajectoryId: state.trajectoryId, stage: "understand" }),
        });

  try {
    checkCancelled(stageApi);
  } catch (err) {
    console.error("[DeepSearch] understand checkCancelled failed:", err);
    throw err;
  }

  /**
   * Generate claims with LLM for a specific todo, grounded in provided chunks.
   * - Returns null on "LLM unavailable" or fatal errors so caller can fallback to rules.
   * - Skips any claim whose quote cannot be precisely located in sourceTextNormalized.
   *
   * @param {{todoId?:string,text?:string,question?:string,expectedEvidence?:string}} todo
   * @param {Array<{chunkId:string,sourceId:string,locator:{charStart:number,charEnd:number},text:string,score?:number}>} chunks
   * @param {object} stageApi
   * @param {import("./state.js").DeepSearchState} state
   * @param {{maxQuoteLen:number}} options
   * @returns {Promise<null|{claims:any[],evidences:any[]}>}
   */
  async function generateClaimsWithLLM(todo, chunks, stageApi, state, { maxQuoteLen }) {
    const callModel = getModelCaller(stageApi, { usage: "analyst", state });
    if (!callModel) return null;

    const contextSummary = stageApi?.getContextSummary?.() || "";
    const todoQuestion = todoDisplayText(todo);
    if (!todoQuestion) return null;
    const expectedEvidence = toNonEmptyString(todo?.expectedEvidence);
    const promptQuestion = expectedEvidence ? `${todoQuestion}\nExpected evidence: ${expectedEvidence}` : todoQuestion;

    const sourceTextById = indexSourceTextById(state?.L0?.sources);

    const promptChunks = safeArray(chunks).filter(
      (c) => typeof c?.text === "string" && toNonEmptyString(c?.chunkId) && toNonEmptyString(c?.sourceId)
    );

    if (!promptChunks.length) return null;

    const prompt = LLM_CLAIMS_PROMPT.replace("{gapQuestion}", promptQuestion).replace("{chunkTexts}", formatChunksForLLM(promptChunks));

    const promptWithContext = contextSummary ? `## 已知上下文\n${contextSummary}\n\n${prompt}` : prompt;

    const cacheKeyInputs = {
      todoId: toNonEmptyString(todo?.todoId) || "",
      question: truncate(promptQuestion, 220),
      chunkPreviews: promptChunks.map((c) => truncate(c?.text, 240)),
    };

    const timeoutMs = 15000;
    let timeoutId;

    try {
      checkCancelled(stageApi);
      const messages = [
        {
          role: "system",
          content:
            "你是一个高效率的实录采集员 (SubAgent)。你的任务是从文档片段中提取所有可能的、有证据支持的论点。\n" +
            "1. 追求高覆盖率：不要担心冗余，我们会后续处理。提取尽可能细致的信息点。\n" +
            "2. 严谨性：必须基于提供的片段，不得编造。quote 必须是原文精确片段。\n" +
            "3. 格式：输出必须为严格 JSON。",
        },
        { role: "user", content: promptWithContext },
      ];

      const resultPromise = callModel(messages, {
        model: "auto",
        temperature: 0.2,
        maxTokens: 900,
        cacheKeyInputs,
      });

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`LLM claims call timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timeoutId);
      checkCancelled(stageApi);

      const candidate = extractJsonCandidate(result?.content);
      if (!candidate) return null;

      let parsed;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        return null;
      }

      if (!isPlainObject(parsed) || !Array.isArray(parsed.claims)) return null;

      /** @type {any[]} */
      const evidences = [];
      /** @type {any[]} */
      const claims = [];
      const evidenceIdBySig = new Map();
      let claimNum = 0;
      let evidenceNum = 0;

      for (const row of parsed.claims) {
        if (!isPlainObject(row)) continue;
        const claimText = toNonEmptyString(row.text);
        const importance = normalizeImportance(row.importance);
        const quote = typeof row.quote === "string" ? row.quote : "";
        const chunkIndex = safeChunkIndex(row.chunkIndex);
        if (!claimText || !importance || chunkIndex === null) continue;
        if (chunkIndex < 0 || chunkIndex >= promptChunks.length) continue;

        if (
          typeof maxQuoteLen === "number" &&
          Number.isFinite(maxQuoteLen) &&
          maxQuoteLen > 0 &&
          quote.length > maxQuoteLen
        ) {
          continue;
        }

        const chunk = promptChunks[chunkIndex];
        const chunkId = toNonEmptyString(chunk?.chunkId);
        const sourceId = toNonEmptyString(chunk?.sourceId);
        const sourceText = sourceId ? sourceTextById.get(sourceId) : null;
        if (!chunkId || !sourceId || typeof sourceText !== "string") continue;

        const resolved = locateQuoteInSourceSlice(sourceText, chunk?.locator, quote);
        if (!resolved) continue;

        const sig = `${sourceId}::${resolved.charStart}-${resolved.charEnd}::${quote}`;
        let evidenceId = evidenceIdBySig.get(sig);
        if (!evidenceId) {
          evidenceNum += 1;
          evidenceId = `e_${evidenceNum}`;
          evidenceIdBySig.set(sig, evidenceId);
          evidences.push({
            evidenceId,
            chunkId: String(chunkId),
            sourceId: String(sourceId),
            locator: { charStart: resolved.charStart, charEnd: resolved.charEnd },
            quote,
            quoteExact: true,
          });
        }

        claimNum += 1;
        claims.push({
          claimId: `c_${claimNum}`,
          text: collapseWhitespace(claimText),
          importance,
          evidenceIds: [String(evidenceId)],
        });
      }

      return { claims, evidences };
    } catch (err) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  /**
   * Reflect: LLM 自主判断当前证据是否充分
   * @returns {{sufficient: boolean, confidence: number, reason: string, missingAspects: string[], suggestedQueries: string[]}}
   */
  async function reflectOnEvidence(state, { claims, evidenceLedger, todos, gaps }, stageApi) {
    const callModel = getModelCaller(stageApi, { usage: "analyst", state });
    const contextSummary = stageApi?.getContextSummary?.() || "";

    // 计算覆盖统计
    const todoList = Array.isArray(todos) ? todos : [];
    const gapList = Array.isArray(gaps) ? gaps : [];
    const useTodos = todoList.length > 0;

    const statusOf = (item) => {
      const raw = String(item?.status || "open");
      if (!useTodos) {
        if (raw === "filled") return "completed";
        if (raw === "blocked") return "blocked";
        return "open";
      }
      if (raw === "completed") return "completed";
      if (raw === "cancelled") return "blocked";
      if (raw === "pending") return "open";
      return "open";
    };

    const allItems = useTodos ? todoList : gapList;
    const openItems = allItems.filter((item) => statusOf(item) === "open");
    const completedItems = allItems.filter((item) => statusOf(item) === "completed");
    const blockedItems = allItems.filter((item) => statusOf(item) === "blocked");

    const allClaims = Array.isArray(claims) ? claims : [];
    const coreClaims = allClaims.filter((c) => c?.importance === "core");
    const supportClaims = allClaims.filter((c) => c?.importance === "support");

    const evidenceCount = Array.isArray(evidenceLedger) ? evidenceLedger.length : 0;

    const { todoIdByGapId } = buildTodoLookup(Array.isArray(state?.todos) ? state.todos : []);
    const coveredTodoIds = new Set();
    const coveredGapIds = new Set();

    for (const c of allClaims) {
      for (const tid of normalizeTodoIds(c?.todoIds)) coveredTodoIds.add(tid);
      for (const gid of normalizeGapIds(c?.gapIds)) coveredGapIds.add(gid);
    }
    for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
      for (const tid of normalizeTodoIds(e?.todoIds)) coveredTodoIds.add(tid);
      for (const gid of normalizeGapIds(e?.gapIds)) coveredGapIds.add(gid);
    }

    if (useTodos && coveredGapIds.size > 0) {
      for (const gid of coveredGapIds) {
        const tid = todoIdByGapId.get(gid);
        if (tid) coveredTodoIds.add(tid);
      }
    }

    const uncoveredItems = openItems.filter((item) => {
      if (useTodos) {
        const tid = toNonEmptyString(item?.todoId);
        return tid ? !coveredTodoIds.has(tid) : false;
      }
      const gid = toNonEmptyString(item?.gapId);
      return gid ? !coveredGapIds.has(gid) : false;
    });

    const coverageRate = allItems.length > 0 ? completedItems.length / allItems.length : 1;

    // === 健壮性：快速路径 ===
    // 如果没有 gaps 或者所有 gaps 都已填充，直接返回 sufficient
    if (allItems.length === 0 || openItems.length === 0) {
      return {
        sufficient: true,
        confidence: 0.9,
        reason: "All gaps filled or no gaps defined",
        missingAspects: [],
        suggestedQueries: [],
      };
    }

    // 如果有大量证据且覆盖率高，快速返回
    if (coverageRate >= 0.8 && evidenceCount >= 5 && coreClaims.length >= 2) {
      return {
        sufficient: true,
        confidence: 0.85,
        reason: `High coverage (${(coverageRate * 100).toFixed(0)}%) with ${evidenceCount} evidence and ${coreClaims.length} core claims`,
        missingAspects: [],
        suggestedQueries: [],
      };
    }

    if (!callModel) {
      // 没有 LLM，fallback 到规则判断
      const sufficient = uncoveredItems.length === 0 || coverageRate >= 0.7;
      return {
        sufficient,
        confidence: 0.5,
        reason: `Fallback rule: ${uncoveredItems.length} uncovered gaps, coverage ${(coverageRate * 100).toFixed(0)}%`,
        missingAspects: uncoveredItems.slice(0, 3).map((item) => todoDisplayText(item) || item?.question || item?.text || "unknown"),
        suggestedQueries: [],
      };
    }

    // 准备 prompt 数据
    const taskGoal = String(state?.taskGoal || state?.userConfig?.taskGoal || "未指定");

    const coverageLabel = useTodos ? "Todos" : "Gaps";
    const coverageStats = [
      `- 总 ${coverageLabel}: ${allItems.length}`,
      `- 已填充: ${completedItems.length} (${(coverageRate * 100).toFixed(0)}%)`,
      `- 未覆盖: ${uncoveredItems.length}`,
      `- 已阻塞: ${blockedItems.length}`,
      `- 总论点: ${allClaims.length} (核心: ${coreClaims.length}, 支持: ${supportClaims.length})`,
      `- 总证据: ${evidenceCount}`,
    ].join("\n");

    const uncoveredGapsStr =
      uncoveredItems.length > 0
        ? uncoveredItems
            .slice(0, 5)
            .map((item, i) => {
              if (!useTodos) return `${i + 1}. [${item?.type || "?"}] ${item?.question || item?.text || "?"}`;
              const expected = toNonEmptyString(item?.expectedEvidence);
              const prefix = expected ? `(${expected}) ` : "";
              return `${i + 1}. ${prefix}${todoDisplayText(item) || "?"}`;
            })
            .join("\n")
        : "无 (所有缺口已覆盖)";

    // 只展示核心论点样本
    const coreClaimsStr =
      coreClaims.length > 0
        ? coreClaims
            .slice(0, 5)
            .map((c, i) => `${i + 1}. ${String(c?.text || "").slice(0, 80)}${c?.text?.length > 80 ? "..." : ""}`)
            .join("\n")
        : supportClaims.length > 0
          ? supportClaims
              .slice(0, 3)
              .map((c, i) => `${i + 1}. (支持) ${String(c?.text || "").slice(0, 80)}`)
              .join("\n")
          : "无论点";

    const prompt = REFLECT_PROMPT.replace("{taskGoal}", taskGoal)
      .replace("{coverageStats}", coverageStats)
      .replace("{uncoveredGaps}", uncoveredGapsStr)
      .replace("{totalClaims}", String(allClaims.length))
      .replace("{coreClaims}", coreClaimsStr);

    const promptWithContext = contextSummary ? `## 已知上下文\n${contextSummary}\n\n${prompt}` : prompt;

    const cacheKeyInputs = { rawPrompt: truncate(promptWithContext, 900) };

    // === 健壮性：带超时的 LLM 调用 ===
    const timeoutMs = 15000; // 15 秒超时
    let timeoutId;

    try {
      const resultPromise = callModel([{ role: "user", content: promptWithContext }], {
        model: "auto",
        temperature: 0.1,
        maxTokens: 400,
        cacheKeyInputs,
      });

      // 创建超时 Promise
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Reflect LLM call timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timeoutId);

      const candidate = extractJsonCandidate(result?.content);
      if (!candidate) {
        // Parse 失败，用规则兜底
        return {
          sufficient: coverageRate >= 0.6,
          confidence: 0.4,
          reason: "Failed to parse LLM response, using coverage fallback",
          missingAspects: uncoveredItems.slice(0, 3).map((item) => todoDisplayText(item) || item?.question || "?"),
          suggestedQueries: [],
        };
      }

      const parsed = JSON.parse(candidate);

      // === 健壮性：验证返回值 ===
      const sufficient = typeof parsed.sufficient === "boolean" ? parsed.sufficient : coverageRate >= 0.6;
      const confidence =
        typeof parsed.confidence === "number" && !Number.isNaN(parsed.confidence)
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5;

      return {
        sufficient,
        confidence,
        reason: String(parsed.reason || "").slice(0, 200),
        missingAspects: Array.isArray(parsed.missingAspects)
          ? parsed.missingAspects.filter((x) => typeof x === "string" && x.trim()).slice(0, 5)
          : [],
        suggestedQueries: Array.isArray(parsed.suggestedQueries)
          ? parsed.suggestedQueries.filter((x) => typeof x === "string" && x.trim()).slice(0, 3)
          : [],
      };
    } catch (err) {
      clearTimeout(timeoutId);
      return {
        sufficient: coverageRate >= 0.6,
        confidence: 0.3,
        reason: `Reflect error: ${String(err?.message || err).slice(0, 100)}`,
        missingAspects: uncoveredItems.slice(0, 3).map((item) => todoDisplayText(item) || item?.question || "?"),
        suggestedQueries: [],
      };
    }
  }

  async function tryLLMClaimEdits(state, claims, evidenceLedger, stageApi) {
    const callModel = getModelCaller(stageApi, { usage: "analyst", state });
    if (!callModel) return null;

    const contextSummary = stageApi?.getContextSummary?.() || "";
    const evidenceById = new Map();
    for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
      if (!e || !toNonEmptyString(e?.evidenceId)) continue;
      evidenceById.set(String(e.evidenceId), {
        quote: String(e.quote || ""),
        sourceId: String(e.sourceId || ""),
        gapIds: normalizeGapIds(e.gapIds),
      });
    }

    const cacheKeyInputs = normalizeUnderstandClaimEditsCacheKeyInputs(state?.taskGoal, claims, evidenceById);

    const messages = [
      {
        role: "system",
        content:
          "你是一个资深主编 (Lead Agent)。你的任务是审核并综合 SubAgent 提取的初步论点。\n" +
          "1. 综合 (Synthesis)：将相似、冗余的初步论点合并为更全面、更有洞察力的表述。\n" +
          "2. 润色：使论点更符合 PPT 演讲稿的需求，语言精炼且专业。\n" +
          "3. 证据链：确保综合后的论点依然有原始引文证据支持。\n" +
          "4. 格式：仅返回 JSON: {claims:[{claimId,text,importance}]}。importance 必须为 'core' 或 'support'。",
      },
      {
        role: "user",
        content: (() => {
          const originalPrompt = JSON.stringify(
            {
              taskGoal: String(state?.taskGoal || ""),
              draftClaims: (Array.isArray(claims) ? claims : []).map((c) => ({
                claimId: c?.claimId,
                text: c?.text,
                importance: c?.importance,
                evidence: (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])
                  .map((eid) => {
                    const row = evidenceById.get(String(eid));
                    return row ? { evidenceId: String(eid), ...row } : { evidenceId: String(eid) };
                  })
                  .slice(0, 3),
              })),
            },
            null,
            2
          );

          return contextSummary ? `## 已知上下文\n${contextSummary}\n\n${originalPrompt}` : originalPrompt;
        })(),
      },
    ];

    try {
      const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 900, cacheKeyInputs });
      const candidate = extractJsonCandidate(result?.content);
      if (!candidate) return null;
      const parsed = JSON.parse(candidate);
      if (!isPlainObject(parsed) || !Array.isArray(parsed.claims)) return null;
      return parsed.claims;
    } catch {
      return null;
    }
  }

  function emitUnderstandProgress(emit, { current, total, msg, detail }) {
    emit?.(
      "deepsearch.understand.progress",
      {
        phase: "understand",
        step: "claim",
        current,
        total: Math.max(1, total),
        progress: clampProgress(total > 0 ? current / total : 1),
        msg: String(msg || ""),
        ...(detail && typeof detail === "object" && !Array.isArray(detail) ? { detail } : {}),
      },
      { status: "progress" }
    );
  }

  /**
   * 软降级验证：过滤不合规的 evidence，保留合规的
   * @returns {{ validEvidence: object[], invalidEvidence: {evidence: object, issues: string[]}[], validClaims: object[], orphanedClaims: object[] }}
   */
  function validateEvidenceWithDegradation({ sources, sourceTextById, claims, evidenceLedger }, { emit } = {}) {
    const validEvidence = [];
    const invalidEvidence = [];

    // 验证每条 evidence
    for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
      const { valid, issues } = validateSingleEvidence(e, { sources, sourceTextById });
      if (valid) {
        validEvidence.push(e);
      } else {
        invalidEvidence.push({ evidence: e, issues });
        emit?.("deepsearch.evidence.invalid", {
          evidenceId: toNonEmptyString(e?.evidenceId) || "(unknown)",
          issues,
        });
      }
    }

    // 构建有效 evidenceId 集合
    const validEvidenceIds = new Set(validEvidence.map((e) => String(e.evidenceId)));

    // 过滤 claims 中无效的 evidenceIds，并识别孤儿 claims
    const validClaims = [];
    const orphanedClaims = [];

    for (const c of Array.isArray(claims) ? claims : []) {
      if (!c) continue;

      // 过滤掉引用无效 evidence 的 evidenceIds
      const originalIds = Array.isArray(c.evidenceIds) ? c.evidenceIds : [];
      const filteredIds = originalIds.filter((eid) => validEvidenceIds.has(String(eid)));

      // H1: claim 必须至少有 1 条证据
      if (filteredIds.length === 0) {
        orphanedClaims.push({
          ...c,
          _orphaned: true,
          _originalEvidenceIds: originalIds,
          _orphanReason: "all referenced evidence invalid",
        });
        emit?.("deepsearch.claim.orphaned", {
          claimId: toNonEmptyString(c?.claimId) || "(unknown)",
          originalEvidenceCount: originalIds.length,
          reason: "all referenced evidence invalid",
        });
      } else {
        validClaims.push({
          ...c,
          evidenceIds: filteredIds,
        });
      }
    }

    return { validEvidence, invalidEvidence, validClaims, orphanedClaims };
  }

  function maxNumericId(rows, idSelector, { prefix } = {}) {
    const rx = prefix ? new RegExp(`^${prefix.replaceAll(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(\\d+)$`) : null;
    let max = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      const raw = typeof idSelector === "function" ? idSelector(r) : null;
      const id = toNonEmptyString(raw);
      if (!id) continue;
      const m = rx ? id.match(rx) : null;
      if (!m) continue;
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }

  function evidenceSignature(e) {
    const sourceId = toNonEmptyString(e?.sourceId) || "";
    const charStart = safeInt(e?.locator?.charStart);
    const charEnd = safeInt(e?.locator?.charEnd);
    const quote = typeof e?.quote === "string" ? e.quote : "";
    if (!sourceId || charStart === null || charEnd === null || !quote) return null;
    return `${sourceId}::${charStart}-${charEnd}::${quote}`;
  }

  function dedupeChunksByChunkId(chunks) {
    const out = [];
    const seen = new Set();
    for (const c of Array.isArray(chunks) ? chunks : []) {
      const id = toNonEmptyString(c?.chunkId);
      if (!id) {
        out.push(c);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(c);
    }
    return out;
  }

  function rebaseSeedIds(seed, counters) {
    const claims = Array.isArray(seed?.claims) ? seed.claims : [];
    const evidences = Array.isArray(seed?.evidences) ? seed.evidences : [];
    let nextSeedClaimNum = safeInt(counters?.nextSeedClaimNum) ?? 0;
    let nextSeedEvidenceNum = safeInt(counters?.nextSeedEvidenceNum) ?? 0;

    const evidenceIdRemap = new Map();
    /** @type {any[]} */
    const evidencesOut = [];
    for (const e of evidences) {
      if (!e) continue;
      const oldId = toNonEmptyString(e?.evidenceId);
      if (!oldId) continue;
      nextSeedEvidenceNum += 1;
      const newId = `se_${nextSeedEvidenceNum}`;
      evidenceIdRemap.set(String(oldId), newId);
      evidencesOut.push({ ...e, evidenceId: newId });
    }

    /** @type {any[]} */
    const claimsOut = [];
    for (const c of claims) {
      if (!c || typeof c.text !== "string") continue;
      nextSeedClaimNum += 1;
      const newClaimId = `sc_${nextSeedClaimNum}`;
      const evidenceIds = Array.from(
        new Set(
          (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])
            .map((eid) => evidenceIdRemap.get(String(eid)) || null)
            .filter((eid) => toNonEmptyString(eid))
            .map(String)
        )
      );
      if (!evidenceIds.length) continue;
      claimsOut.push({ ...c, claimId: newClaimId, evidenceIds });
    }

    return { claims: claimsOut, evidences: evidencesOut, nextSeedClaimNum, nextSeedEvidenceNum };
  }

  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  // 只处理未消费的新 chunks，避免每轮重复处理历史累计 chunks
  const newRetrieved = retrieved.filter((c) => c?.consumed !== true);
  const existingClaims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const existingEvidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];

  // 记录 understand 阶段开始
  logger.info("Understand stage started", {
    stage: "understand",
    data: { retrievedChunks: retrieved.length, unconsumedChunks: newRetrieved.length, existingClaims: existingClaims.length },
  });

  // 发射阶段开始事件
  emitUnderstandProgress(emit, {
    current: 0,
    total: 1,
    msg: "正在启动理解阶段...",
    detail: { step: "init" },
  });

  if (!newRetrieved.length) {
    logger.info("No unconsumed chunks to process", { stage: "understand" });
    const conflicts = Array.isArray(state?.L1?.conflicts) ? state.L1.conflicts : [];
    const openQuestions = Array.isArray(state?.L1?.openQuestions) ? state.L1.openQuestions : [];
    const reflectResult = isPlainObject(state?.L1?.reflectResult)
      ? state.L1.reflectResult
      : {
          sufficient: existingClaims.length > 0,
          confidence: 0.3,
          reason: "No unconsumed chunks to process",
          missingAspects: [],
          suggestedQueries: [],
        };

    if (!state.L1 || typeof state.L1 !== "object") state.L1 = {};
    state.L1.claims = existingClaims;
    state.L1.evidenceLedger = existingEvidenceLedger;
    state.L1.conflicts = conflicts;
    state.L1.openQuestions = openQuestions;
    state.L1.reflectResult = reflectResult;

    emit?.("deepsearch.understand.completed", {
      claimCount: existingClaims.length,
      evidenceCount: existingEvidenceLedger.length,
      conflictCount: conflicts.length,
      openQuestionCount: openQuestions.length,
      reflectResult,
      skipped: true,
      reason: "no_unconsumed_chunks",
    });

    return {
      state,
      claims: existingClaims,
      evidenceLedger: existingEvidenceLedger,
      conflicts,
      openQuestions,
      reflectResult,
    };
  }

  const sourceTextById = indexSourceTextById(state?.L0?.sources);

  const understandingConfig = isPlainObject(state?.userConfig?.understanding) ? state.userConfig.understanding : {};
  const maxQuoteLen = Number.isFinite(understandingConfig.maxQuoteLen) ? Math.max(60, Math.floor(understandingConfig.maxQuoteLen)) : 220;
  const useLLMClaims = understandingConfig.useLLMClaims !== false;
  const minScore =
    typeof understandingConfig.minScore === "number" && Number.isFinite(understandingConfig.minScore)
      ? Math.max(0, understandingConfig.minScore)
      : 0.15;
  const dedupeThreshold =
    typeof understandingConfig.dedupeThreshold === "number" && Number.isFinite(understandingConfig.dedupeThreshold)
      ? understandingConfig.dedupeThreshold
      : 0.82;

  function isValidSeed(seed) {
    return Boolean(seed && Array.isArray(seed.claims) && seed.claims.length && Array.isArray(seed.evidences) && seed.evidences.length);
  }

  function chunkStatsForClaimsFromChunks(chunks, { minScore } = {}) {
    const rows = Array.isArray(chunks) ? chunks : [];
    let validTextAndLocator = 0;
    let scored = 0;
    let missingScore = 0;
    let belowMinScore = 0;
    for (const c of rows) {
      const hasText = typeof c?.text === "string" && c.text;
      const charStart = safeInt(c?.locator?.charStart);
      const charEnd = safeInt(c?.locator?.charEnd);
      const hasLocator = charStart !== null && charEnd !== null && charStart < charEnd;
      if (hasText && hasLocator) validTextAndLocator += 1;

      const score = typeof c?.score === "number" && Number.isFinite(c.score) ? c.score : null;
      if (score === null) {
        missingScore += 1;
      } else {
        scored += 1;
        if (typeof minScore === "number" && Number.isFinite(minScore) && score < minScore) belowMinScore += 1;
      }
    }
    return { total: rows.length, validTextAndLocator, scored, missingScore, belowMinScore };
  }

  function claimsFromChunksWithDiagnostics(chunks, { label, gapId } = {}) {
    const stats = chunkStatsForClaimsFromChunks(chunks, { minScore });
    console.log("[DeepSearch] understand claimsFromChunks input", { label, gapId, minScore, ...stats });

    let seed = null;
    try {
      seed = claimsFromChunks(chunks, { maxQuoteLen, minScore });
    } catch (err) {
      console.error("[DeepSearch] understand claimsFromChunks failed:", { label, gapId, err });
      seed = null;
    }

    console.log("[DeepSearch] understand claimsFromChunks output", {
      label,
      gapId,
      claimCount: Array.isArray(seed?.claims) ? seed.claims.length : 0,
      evidenceCount: Array.isArray(seed?.evidences) ? seed.evidences.length : 0,
    });

    // 如果全被 minScore 过滤或无法产出，尝试用更低门槛重试一次
    if (!isValidSeed(seed) && stats.total > 0 && minScore > 0) {
      console.warn("[DeepSearch] understand claimsFromChunks retry with minScore=0", { label, gapId, prevMinScore: minScore });
      try {
        const retried = claimsFromChunks(chunks, { maxQuoteLen, minScore: 0 });
        console.log("[DeepSearch] understand claimsFromChunks retry output", {
          label,
          gapId,
          claimCount: Array.isArray(retried?.claims) ? retried.claims.length : 0,
          evidenceCount: Array.isArray(retried?.evidences) ? retried.evidences.length : 0,
        });
        if (isValidSeed(retried)) seed = retried;
      } catch (err) {
        console.error("[DeepSearch] understand claimsFromChunks retry failed:", { label, gapId, err });
      }
    }

    return seed;
  }

  function basicSeedFromChunks(chunks, { label, gapId } = {}) {
    const rows = Array.isArray(chunks) ? chunks : [];
    const ranked = rows.slice().sort((a, b) => (b?.score ?? -Infinity) - (a?.score ?? -Infinity));
    const coreChunkId = toNonEmptyString(ranked?.[0]?.chunkId) || null;

    /** @type {any[]} */
    const evidences = [];
    /** @type {any[]} */
    const claims = [];

    for (const c of rows) {
      const chunkId = toNonEmptyString(c?.chunkId);
      const sourceId = toNonEmptyString(c?.sourceId);
      if (!chunkId || !sourceId) continue;
      const sourceText = sourceTextById.get(sourceId);
      if (typeof sourceText !== "string") continue;

      let derived;
      try {
        derived = quoteFromSourceLocator(sourceText, c?.locator, { maxQuoteLen });
      } catch {
        continue;
      }

      const evidenceId = `e_${evidences.length + 1}`;
      const claimId = `c_${claims.length + 1}`;
      evidences.push({
        evidenceId,
        chunkId: String(chunkId),
        sourceId: String(sourceId),
        locator: derived.locator,
        quote: derived.quote,
        quoteExact: true,
      });

      claims.push({
        claimId,
        text: collapseWhitespace(derived.quote),
        importance: coreChunkId && String(chunkId) === coreChunkId ? "core" : "support",
        evidenceIds: [evidenceId],
      });
    }

    console.log("[DeepSearch] understand basic seed from chunks", {
      label,
      gapId,
      inputChunks: rows.length,
      claimCount: claims.length,
      evidenceCount: evidences.length,
    });

    return { claims, evidences };
  }

  const maxExistingClaimNum = maxNumericId(existingClaims, (c) => c?.claimId, { prefix: "c_" });
  const maxExistingEvidenceNum = maxNumericId(existingEvidenceLedger, (e) => e?.evidenceId, { prefix: "e_" });
  let nextClaimNum = maxExistingClaimNum;
  let nextEvidenceNum = maxExistingEvidenceNum;

  const existingEvidenceById = new Map();
  const existingEvidenceIdBySignature = new Map();
  for (const e of existingEvidenceLedger) {
    const evidenceId = toNonEmptyString(e?.evidenceId);
    if (!evidenceId) continue;
    existingEvidenceById.set(String(evidenceId), e);
    const sig = evidenceSignature(e);
    if (sig) existingEvidenceIdBySignature.set(sig, String(evidenceId));
  }

  const todosAll = ensureTodos(state);
  const { todoById, todoIdByGapId, gapIdByTodoId } = buildTodoLookup(todosAll);
  const gapsById = new Map(
    (Array.isArray(state?.L1?.gaps) ? state.L1.gaps : []).map((g) => [String(g?.gapId || ""), g]).filter(([id]) => id)
  );

  // === per-todo 模式：按 todoId 分组生成 claims ===
  const chunksByTodoId = new Map();
  /** @type {any[]} */
  const ungappedChunks = [];
  for (const r of newRetrieved) {
    let todoIds = normalizeTodoIds(r?.matchedTodoIds || r?.todoId);
    if (!todoIds.length) {
      const gapIds = normalizeGapIds(r?.matchedGapIds || r?.gapId);
      if (gapIds.length) {
        todoIds = gapIds.map((gid) => todoIdByGapId.get(gid)).filter(Boolean);
      }
    }
    if (!todoIds.length) {
      ungappedChunks.push(r);
      continue;
    }
    if (!normalizeTodoIds(r?.matchedTodoIds || r?.todoId).length) {
      r.matchedTodoIds = todoIds.slice();
      if (!toNonEmptyString(r.todoId)) r.todoId = todoIds[0];
    }
    for (const todoId of todoIds) {
      const tid = String(todoId);
      if (!chunksByTodoId.has(tid)) chunksByTodoId.set(tid, []);
      chunksByTodoId.get(tid).push(r);
    }
  }

  /** @type {any[]} */
  const seedClaimsRaw = [];
  /** @type {any[]} */
  const seedEvidencesRaw = [];
  let nextSeedClaimNum = 0;
  let nextSeedEvidenceNum = 0;

  // 并行调用所有 todo 的 LLM（后续 ID rebase 仍按原顺序串行执行，保持行为稳定）
  const todoEntries = Array.from(chunksByTodoId.entries());
  const llmResults = await mapConcurrentWithPool(
    todoEntries,
    async ([todoId, chunksForTodo]) => {
      const deduped = dedupeChunksByChunkId(chunksForTodo);
      const todo = todoById.get(String(todoId)) || { todoId: String(todoId), text: String(todoId) };
      const relatedGapId = gapIdByTodoId.get(String(todoId));
      const relatedGap = relatedGapId ? gapsById.get(String(relatedGapId)) : null;
      const promptTodo =
        relatedGap && toNonEmptyString(relatedGap?.question)
          ? { ...todo, text: relatedGap.question, question: relatedGap.question }
          : todo;

      let seed = null;
      if (useLLMClaims) {
        try {
          seed = await generateClaimsWithLLM(promptTodo, deduped, stageApi, state, { maxQuoteLen });
        } catch (err) {
          console.error("[DeepSearch] understand generateClaimsWithLLM failed:", { todoId, err });
          seed = null;
        }
      }
      if (!isValidSeed(seed)) {
        seed = claimsFromChunksWithDiagnostics(deduped, { label: "todo", gapId: todoId });
      }
      if (!isValidSeed(seed)) {
        seed = basicSeedFromChunks(deduped, { label: "todo", gapId: todoId });
      }
      if (!seed || !Array.isArray(seed.claims) || !Array.isArray(seed.evidences)) seed = { claims: [], evidences: [] };

      return { todoId, seed };
    },
    10
  );

  for (const { todoId, seed } of llmResults) {
    const rebased = rebaseSeedIds(seed, { nextSeedClaimNum, nextSeedEvidenceNum });
    nextSeedClaimNum = rebased.nextSeedClaimNum;
    nextSeedEvidenceNum = rebased.nextSeedEvidenceNum;

    const relatedGapId = gapIdByTodoId.get(String(todoId));
    for (const c of rebased.claims) {
      c.todoIds = [String(todoId)];
      if (relatedGapId) c.gapIds = [String(relatedGapId)];
    }
    for (const e of rebased.evidences) {
      e.todoIds = [String(todoId)];
      if (relatedGapId) e.gapIds = [String(relatedGapId)];
    }
    seedClaimsRaw.push(...rebased.claims);
    seedEvidencesRaw.push(...rebased.evidences);
  }

  // 兜底：对缺少 gapId 的 chunks，仍生成一批 seed claims（但不强行标记 gapIds）
  if (ungappedChunks.length) {
    const deduped = dedupeChunksByChunkId(ungappedChunks);
    let seed = claimsFromChunksWithDiagnostics(deduped, { label: "ungapped", gapId: null });
    if (!isValidSeed(seed)) seed = basicSeedFromChunks(deduped, { label: "ungapped", gapId: null });
    const rebased = rebaseSeedIds(seed, { nextSeedClaimNum, nextSeedEvidenceNum });
    nextSeedClaimNum = rebased.nextSeedClaimNum;
    nextSeedEvidenceNum = rebased.nextSeedEvidenceNum;
    seedClaimsRaw.push(...rebased.claims);
    seedEvidencesRaw.push(...rebased.evidences);
  }

  const seedClaims = await (useLLMClaims ? dedupeClaimsAI(stageApi, seedClaimsRaw) : dedupeClaims(seedClaimsRaw, { threshold: dedupeThreshold, mergeEvidence: true }));

  const referencedSeedEvidenceIds = new Set(
    seedClaims.flatMap((c) => (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])).map(String)
  );

  const retrievedByChunkId = new Map();
  for (const r of retrieved) {
    const cid = toNonEmptyString(r?.chunkId);
    if (cid) retrievedByChunkId.set(cid, r);
  }

  const seedToFinalEvidenceId = new Map();
  /** @type {any[]} */
  const newEvidenceLedger = [];

  for (const seed of Array.isArray(seedEvidencesRaw) ? seedEvidencesRaw : []) {
    if (!seed || !referencedSeedEvidenceIds.has(String(seed.evidenceId))) continue;

    const sourceId = toNonEmptyString(seed?.sourceId) || "source_unknown";
    const sourceText = sourceTextById.get(sourceId);
    const seedEvidenceId = String(seed.evidenceId);

    if (seedToFinalEvidenceId.has(seedEvidenceId)) continue;

    // 如果无法映射回 sourceTextNormalized（H4），保持 evidenceId 引用但不写入 evidenceLedger，让硬/软验证负责抛错/降级
    if (typeof sourceText !== "string") {
      nextEvidenceNum += 1;
      const finalEvidenceId = `e_${nextEvidenceNum}`;
      seedToFinalEvidenceId.set(seedEvidenceId, finalEvidenceId);
      continue;
    }

    const wantsExactQuote = seed?.quoteExact === true;
    let derived = null;
    if (wantsExactQuote && typeof seed?.quote === "string" && seed.quote) {
      const charStart = safeInt(seed?.locator?.charStart);
      const charEnd = safeInt(seed?.locator?.charEnd);
      if (charStart !== null && charEnd !== null && charStart >= 0 && charEnd <= sourceText.length && charStart < charEnd) {
        const slice = sourceText.slice(charStart, charEnd);
        if (slice === seed.quote) derived = { locator: { charStart, charEnd }, quote: seed.quote };
      }
    }
    if (!derived && wantsExactQuote) continue;
    if (!derived) {
      try {
        derived = quoteFromSourceLocator(sourceText, seed.locator, { maxQuoteLen });
      } catch (err) {
        if (understandingConfig.strictMode === true) throw err;
        console.warn("[DeepSearch] understand quoteFromSourceLocator failed:", {
          seedEvidenceId: toNonEmptyString(seed?.evidenceId),
          chunkId: toNonEmptyString(seed?.chunkId),
          sourceId,
          err: String(err?.message || err),
        });
        continue;
      }
    }
    const retrievedRow = retrievedByChunkId.get(String(seed.chunkId));
    let todoIds = Array.from(
      new Set([
        ...normalizeTodoIds(retrievedRow?.matchedTodoIds || retrievedRow?.todoId),
        ...normalizeTodoIds(seed?.todoIds),
      ])
    );
    if (!todoIds.length) {
      const gapIdsFromRow = normalizeGapIds(retrievedRow?.matchedGapIds || retrievedRow?.gapId);
      todoIds = gapIdsFromRow.map((gid) => todoIdByGapId.get(gid)).filter(Boolean);
    }
    const gapIds = Array.from(
      new Set([
        ...normalizeGapIds(retrievedRow?.matchedGapIds || retrievedRow?.gapId),
        ...normalizeGapIds(seed?.gapIds),
        ...todoIds.map((tid) => gapIdByTodoId.get(tid)).filter(Boolean),
      ])
    );

    const candidateEvidence = {
      evidenceId: seedEvidenceId,
      chunkId: String(seed.chunkId),
      sourceId: String(sourceId),
      locator: derived.locator,
      quote: derived.quote,
      todoIds,
      gapIds,
    };

    const sig = evidenceSignature(candidateEvidence);
    if (sig) {
      const existingEvidenceId = existingEvidenceIdBySignature.get(sig);
      if (existingEvidenceId) {
        seedToFinalEvidenceId.set(seedEvidenceId, existingEvidenceId);
        const existing = existingEvidenceById.get(existingEvidenceId);
        if (existing) {
          if (todoIds.length) {
            const mergedTodoIds = Array.from(new Set([...normalizeTodoIds(existing?.todoIds), ...todoIds]));
            if (mergedTodoIds.length) existing.todoIds = mergedTodoIds;
          }
          if (gapIds.length) {
            const mergedGapIds = Array.from(new Set([...normalizeGapIds(existing?.gapIds), ...gapIds]));
            if (mergedGapIds.length) existing.gapIds = mergedGapIds;
          }
        }
        continue;
      }
    }

    nextEvidenceNum += 1;
    const finalEvidenceId = `e_${nextEvidenceNum}`;
    seedToFinalEvidenceId.set(seedEvidenceId, finalEvidenceId);
    if (sig) existingEvidenceIdBySignature.set(sig, finalEvidenceId);

    newEvidenceLedger.push({
      ...candidateEvidence,
      evidenceId: finalEvidenceId,
    });
    existingEvidenceById.set(finalEvidenceId, newEvidenceLedger[newEvidenceLedger.length - 1]);
  }

  /** @type {any[]} */
  const newClaims = [];
  for (const c of Array.isArray(seedClaims) ? seedClaims : []) {
    if (!c || typeof c.text !== "string") continue;
    const seedEvidenceIds = Array.isArray(c?.evidenceIds) ? c.evidenceIds : [];
    const finalEvidenceIds = Array.from(
      new Set(
        seedEvidenceIds
          .map((eid) => seedToFinalEvidenceId.get(String(eid)))
          .filter((eid) => toNonEmptyString(eid))
          .map(String)
      )
    );
    if (!finalEvidenceIds.length) continue;
    nextClaimNum += 1;
    newClaims.push({
      ...c,
      claimId: `c_${nextClaimNum}`,
      evidenceIds: finalEvidenceIds,
    });
  }

  const combinedClaims = [...existingClaims, ...newClaims];
  const claims = await (useLLMClaims ? dedupeClaimsAI(stageApi, combinedClaims) : dedupeClaims(combinedClaims, { threshold: dedupeThreshold, mergeEvidence: true }));

  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    emitUnderstandProgress(emit, {
      current: i + 1,
      total: claims.length,
      msg: `正在提取论点 ${i + 1}/${claims.length}`,
      detail: {
        claimId: toNonEmptyString(c?.claimId) || `claim_${i + 1}`,
        importance: toNonEmptyString(c?.importance) || undefined,
        evidenceCount: Array.isArray(c?.evidenceIds) ? c.evidenceIds.length : 0,
      },
    });
  }

  const referencedEvidenceIds = new Set(
    claims.flatMap((c) => (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])).map(String)
  );

  const evidenceLedgerRaw = [...existingEvidenceLedger, ...newEvidenceLedger];
  let evidenceLedger = evidenceLedgerRaw.filter((e) => e && referencedEvidenceIds.has(String(e.evidenceId)));

  // 避免重复 evidence：基于 (sourceId, locator, quote) 去重，并同步改写 claims[].evidenceIds
  {
    const evidenceIdRemap = new Map();
    const kept = [];
    const keptBySig = new Map();
    const keptById = new Set();

    for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
      const evidenceId = toNonEmptyString(e?.evidenceId);
      if (!evidenceId) continue;
      if (keptById.has(evidenceId)) continue;

      const sig = evidenceSignature(e);
      if (sig && keptBySig.has(sig)) {
        const winner = keptBySig.get(sig);
        if (winner && toNonEmptyString(winner?.evidenceId)) {
          evidenceIdRemap.set(evidenceId, String(winner.evidenceId));
          const mergedTodoIds = Array.from(new Set([...normalizeTodoIds(winner?.todoIds), ...normalizeTodoIds(e?.todoIds)]));
          if (mergedTodoIds.length) winner.todoIds = mergedTodoIds;
          const mergedGapIds = Array.from(new Set([...normalizeGapIds(winner?.gapIds), ...normalizeGapIds(e?.gapIds)]));
          if (mergedGapIds.length) winner.gapIds = mergedGapIds;
        }
        continue;
      }

      kept.push(e);
      keptById.add(evidenceId);
      if (sig) keptBySig.set(sig, e);
    }

    if (evidenceIdRemap.size) {
      for (const c of claims) {
        if (!c || !Array.isArray(c.evidenceIds)) continue;
        const remapped = c.evidenceIds
          .map((eid) => evidenceIdRemap.get(String(eid)) || String(eid))
          .filter((eid) => toNonEmptyString(eid));
        c.evidenceIds = Array.from(new Set(remapped));
      }
    }

    const referencedAfterRemap = new Set(
      claims.flatMap((c) => (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])).map(String)
    );
    evidenceLedger = kept.filter((e) => referencedAfterRemap.has(String(e?.evidenceId)));

  }

  const evidenceGapIdsById = new Map();
  const evidenceTodoIdsById = new Map();
  for (const e of evidenceLedger) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid) continue;
    evidenceGapIdsById.set(eid, normalizeGapIds(e?.gapIds));
    evidenceTodoIdsById.set(eid, normalizeTodoIds(e?.todoIds));
  }

  for (const c of claims) {
    const todoIds = [...normalizeTodoIds(c?.todoIds)];
    const gapIds = [...normalizeGapIds(c?.gapIds)];
    for (const eid of Array.isArray(c?.evidenceIds) ? c.evidenceIds : []) {
      for (const tid of evidenceTodoIdsById.get(String(eid)) || []) todoIds.push(tid);
      for (const gid of evidenceGapIdsById.get(String(eid)) || []) gapIds.push(gid);
    }
    if (!todoIds.length && gapIds.length) {
      for (const gid of gapIds) {
        const tid = todoIdByGapId.get(String(gid));
        if (tid) todoIds.push(tid);
      }
    }
    c.todoIds = Array.from(new Set(todoIds));
    c.gapIds = Array.from(new Set(gapIds));
  }

  const claimEdits = await tryLLMClaimEdits(state, claims, evidenceLedger, stageApi);
  if (Array.isArray(claimEdits) && claimEdits.length) {
    const claimById = new Map(claims.map((c) => [String(c?.claimId || ""), c]).filter(([id]) => id));
    for (const edit of claimEdits) {
      if (!isPlainObject(edit)) continue;
      const id = toNonEmptyString(edit?.claimId);
      if (!id) continue;
      const row = claimById.get(id);
      if (!row) continue;
      const text = toNonEmptyString(edit?.text);
      if (text) row.text = text;
      const importance = toNonEmptyString(edit?.importance);
      if (importance === "core" || importance === "support") row.importance = importance;
    }
  }

  const { conflicts, openQuestions: conflictQuestions } = await (useLLMClaims
    ? detectConflictsAI(stageApi, claims)
    : detectConflicts(claims, {
        topicThreshold: typeof understandingConfig.conflictTopicThreshold === "number" ? understandingConfig.conflictTopicThreshold : 0.6,
        numericThreshold: typeof understandingConfig.conflictNumericThreshold === "number" ? understandingConfig.conflictNumericThreshold : 0.78,
      }));

  const openQuestions = [];
  let qn = 0;
  for (const q of Array.isArray(conflictQuestions) ? conflictQuestions : []) {
    if (!q || typeof q.question !== "string") continue;
    qn++;
    openQuestions.push({
      questionId: `q_${qn}`,
      status: "open",
      question: q.question,
      text: q.question, // backward-compatible alias
      relatedClaimIds: Array.isArray(q.relatedClaimIds) ? q.relatedClaimIds.slice() : [],
    });
  }
  if (!claims.length) {
    qn++;
    openQuestions.push({
      questionId: `q_${qn}`,
      status: "open",
      question: "Insufficient retrieved evidence; consider adding sources or refining the taskGoal.",
      text: "Insufficient retrieved evidence; consider adding sources or refining the taskGoal.",
      relatedClaimIds: [],
    });
  }

  // ===== 软降级验证：过滤不合规的 evidence，保留合规的 =====
  const understandingStrict = understandingConfig.strictMode === true;
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];

  let finalClaims = claims;
  let finalEvidenceLedger = evidenceLedger;
  let degradationStats = null;

  if (understandingStrict) {
    // 严格模式：使用原有的硬门验证（向后兼容）
    assertHardGates({
      sources,
      sourceTextById,
      claims,
      evidenceLedger,
    });
  } else {
    // 软降级模式（默认）：过滤不合规项，保留合规项
    const { validEvidence, invalidEvidence, validClaims, orphanedClaims } = validateEvidenceWithDegradation(
      { sources, sourceTextById, claims, evidenceLedger },
      { emit }
    );

    finalClaims = validClaims;
    finalEvidenceLedger = validEvidence;

    // 记录降级统计
    degradationStats = {
      originalEvidenceCount: evidenceLedger.length,
      validEvidenceCount: validEvidence.length,
      invalidEvidenceCount: invalidEvidence.length,
      originalClaimCount: claims.length,
      validClaimCount: validClaims.length,
      orphanedClaimCount: orphanedClaims.length,
    };

    // 如果有降级发生，记录到 timeline
    if (invalidEvidence.length > 0 || orphanedClaims.length > 0) {
      state.addTimeline({
        name: "deepsearch.hardgate.degraded",
        status: "warning",
        payload: {
          ...degradationStats,
          invalidEvidenceDetails: invalidEvidence.slice(0, 5).map((i) => ({
            evidenceId: toNonEmptyString(i.evidence?.evidenceId) || "(unknown)",
            issues: i.issues,
          })),
          orphanedClaimIds: orphanedClaims.slice(0, 5).map((c) => toNonEmptyString(c?.claimId) || "(unknown)"),
        },
      });

      emit?.("deepsearch.hardgate.degraded", degradationStats);
    }
  }

  const consumedAt = new Date().toISOString();
  for (const r of newRetrieved) {
    if (!r || typeof r !== "object") continue;
    if (r.consumed !== true) r.consumed = true;
    if (!toNonEmptyString(r.consumedAt)) r.consumedAt = consumedAt;
  }

  state.L1.claims = finalClaims;
  state.L1.evidenceLedger = finalEvidenceLedger;
  state.L1.conflicts = conflicts;
  state.L1.openQuestions = openQuestions;

  // 确认日志：验证 claims 被正确写入 state
  console.log("[DeepSearch] understand stage wrote to state.L1:", {
    claimCount: finalClaims.length,
    evidenceCount: finalEvidenceLedger.length,
    stateL1ClaimCount: Array.isArray(state?.L1?.claims) ? state.L1.claims.length : "not array",
    stateL1EvidenceCount: Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger.length : "not array",
    iteration: state?.iteration,
  });

  emit?.("deepsearch.claim.snapshot", {
    runId: toNonEmptyString(state?.runId) || "run_unknown",
    iteration: safeInt(state?.iteration) ?? 0,
    trajectoryId: toNonEmptyString(state?.trajectoryId),
    claims: finalClaims.map((c) => ({
      claimId: c.claimId,
      importance: c.importance,
      todoIds: c.todoIds,
      gapIds: c.gapIds,
      evidenceIds: c.evidenceIds,
      textPreview: c.text?.slice(0, 100),
    })),
    edges: {
      claimToEvidence: finalClaims.flatMap((c) => (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).map((eid) => ({ claimId: c.claimId, evidenceId: eid }))),
      claimToGap: finalClaims.flatMap((c) => (Array.isArray(c.gapIds) ? c.gapIds : []).map((gid) => ({ claimId: c.claimId, gapId: gid }))),
      claimToTodo: finalClaims.flatMap((c) => (Array.isArray(c.todoIds) ? c.todoIds : []).map((tid) => ({ claimId: c.claimId, todoId: tid }))),
    },
  });

  emit?.("deepsearch.evidence.snapshot", {
    runId: toNonEmptyString(state?.runId) || "run_unknown",
    iteration: safeInt(state?.iteration) ?? 0,
    trajectoryId: toNonEmptyString(state?.trajectoryId),
    evidence: finalEvidenceLedger.map((e) => ({
      evidenceId: e.evidenceId,
      sourceId: e.sourceId,
      locator: e.locator,
      quoteLen: e.quote?.length || 0,
      todoIds: e.todoIds,
      gapIds: e.gapIds,
    })),
    edges: {
      evidenceToGap: finalEvidenceLedger.flatMap((e) => (Array.isArray(e.gapIds) ? e.gapIds : []).map((gid) => ({ evidenceId: e.evidenceId, gapId: gid }))),
      evidenceToTodo: finalEvidenceLedger.flatMap((e) => (Array.isArray(e.todoIds) ? e.todoIds : []).map((tid) => ({ evidenceId: e.evidenceId, todoId: tid }))),
    },
  });

  // ===== Reflect: LLM 自主判断证据是否充分 =====
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const reflectCfg = isPlainObject(state?.userConfig?.reflect) ? state.userConfig.reflect : {};
  const extCfg = isPlainObject(state?.userConfig?.externalSearch) ? state.userConfig.externalSearch : {};
  const shouldRunReflectLLM = Boolean(reflectCfg.enabled) || (extCfg.enabled === true && extCfg.autoTrigger === true);

  // 默认不额外消耗一次 LLM 调用；显式开启 reflect 或外搜自动触发时才启用 LLM 反思。
  const reflectStageApi = shouldRunReflectLLM ? stageApi : { ...(isPlainObject(stageApi) ? stageApi : {}), modelRouter: null, aiApiService: null };
  const reflectResult = await reflectOnEvidence(state, { claims: finalClaims, evidenceLedger: finalEvidenceLedger, todos: todosAll, gaps }, reflectStageApi);

  // 记录 reflect 结果到 state
  state.L1.reflectResult = reflectResult;

  state.addTimeline({
    name: "deepsearch.understand",
    status: "completed",
    payload: {
      claimCount: finalClaims.length,
      evidenceCount: finalEvidenceLedger.length,
      conflictCount: conflicts.length,
      openQuestionCount: openQuestions.length,
      reflectSufficient: reflectResult.sufficient,
      reflectConfidence: reflectResult.confidence,
      ...(degradationStats ? { degradation: degradationStats } : {}),
    },
  });

  emit?.("deepsearch.understand.completed", {
    claimCount: finalClaims.length,
    evidenceCount: finalEvidenceLedger.length,
    conflictCount: conflicts.length,
    openQuestionCount: openQuestions.length,
    reflectResult,
    ...(degradationStats ? { degradation: degradationStats } : {}),
  });

  // 如果证据不足，发出信号
  if (!reflectResult.sufficient) {
    emit?.("deepsearch.reflect.needsmore", {
      reason: reflectResult.reason,
      confidence: reflectResult.confidence,
      missingAspects: reflectResult.missingAspects,
      suggestedQueries: reflectResult.suggestedQueries,
    });

    // 记录 reflect 结果
    logger.warn("Evidence insufficient - needs more research", {
      stage: "understand",
      data: { reason: reflectResult.reason, confidence: reflectResult.confidence, missingAspects: reflectResult.missingAspects },
    });
  }

  // 记录 understand 阶段完成
  logger.info("Understand stage completed", {
    stage: "understand",
    data: {
      claimCount: finalClaims.length,
      evidenceCount: finalEvidenceLedger.length,
      conflictCount: conflicts.length,
      openQuestionCount: openQuestions.length,
      reflectSufficient: reflectResult.sufficient,
      reflectConfidence: reflectResult.confidence,
      degraded: !!degradationStats,
    },
  });

  return {
    state,
    claims: finalClaims,
    evidenceLedger: finalEvidenceLedger,
    conflicts,
    openQuestions,
    reflectResult,
    ...(degradationStats ? { degradation: degradationStats } : {}),
  };
}
