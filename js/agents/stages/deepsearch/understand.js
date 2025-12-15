import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { claimsFromChunks } from "../../deepsearch/understanding/claims-from-chunks.js";
import { dedupeClaims } from "../../deepsearch/understanding/dedupe.js";
import { detectConflicts } from "../../deepsearch/understanding/conflicts.js";
import { logEvent, setLogContext } from "./logger.js";

// ===== Reflect Prompt: LLM 自主判断是否需要更多信息 =====
const REFLECT_PROMPT = `你是一个研究助手，需要判断当前收集的证据是否足以回答用户的问题。

## 用户问题
{taskGoal}

## 覆盖情况统计
{coverageStats}

## 未覆盖的知识缺口
{uncoveredGaps}

## 核心论点样本 (共 {totalClaims} 个)
{coreClaims}

## 任务
基于以上覆盖情况，判断：
1. 当前证据是否足以回答用户问题的核心部分？
2. 未覆盖的缺口是否关键？是否需要外部搜索补充？

## 输出格式 (严格 JSON)
{
  "sufficient": true/false,           // 证据是否充分
  "confidence": 0.0-1.0,              // 置信度 (0.8+ 表示很确定)
  "reason": "简短说明判断理由",
  "missingAspects": ["缺失方面1"],    // 如果不充分，列出关键缺失
  "suggestedQueries": ["搜索词1"]     // 如果不充分，建议的搜索词 (最多3个)
}

只返回 JSON，不要其他内容。`;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function truncate(s, maxLen = 220) {
  const t = collapseWhitespace(s);
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

function normalizeUnderstandClaimEditsCacheKeyInputs(taskGoal, claims, evidenceById) {
  const rows = Array.isArray(claims) ? claims : [];
  const draftClaims = rows.map((c) => ({
    text: truncate(c?.text || "", 320),
    importance: truncate(c?.importance || "", 24),
  }));

  const evidenceQuotes = [];
  for (const c of rows) {
    const ids = Array.isArray(c?.evidenceIds) ? c.evidenceIds : [];
    for (const eid of ids) {
      const row = evidenceById?.get ? evidenceById.get(String(eid)) : null;
      const q = row && typeof row.quote === "string" ? row.quote : "";
      const t = q ? truncate(q, 220) : "";
      if (t) evidenceQuotes.push(t);
    }
  }
  evidenceQuotes.sort();

  return {
    taskGoal: truncate(taskGoal || ""),
    draftClaims,
    evidenceQuotes,
  };
}

/**
 * Reflect: LLM 自主判断当前证据是否充分
 * @returns {{sufficient: boolean, confidence: number, reason: string, missingAspects: string[], suggestedQueries: string[]}}
 */
async function reflectOnEvidence(state, { claims, evidenceLedger, gaps }, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "analyst", state });

  // 计算覆盖统计
  const allGaps = Array.isArray(gaps) ? gaps : [];
  const openGaps = allGaps.filter(g => String(g?.status || "open") === "open");
  const filledGaps = allGaps.filter(g => g?.status === "filled");
  const blockedGaps = allGaps.filter(g => g?.status === "blocked");

  const allClaims = Array.isArray(claims) ? claims : [];
  const coreClaims = allClaims.filter(c => c?.importance === "core");
  const supportClaims = allClaims.filter(c => c?.importance === "support");

  const evidenceCount = Array.isArray(evidenceLedger) ? evidenceLedger.length : 0;

  // 计算 gap 覆盖率
  const coveredGapIds = new Set();
  for (const c of allClaims) {
    for (const gid of Array.isArray(c?.gapIds) ? c.gapIds : []) {
      coveredGapIds.add(String(gid));
    }
  }

  const uncoveredGaps = openGaps.filter(g => !coveredGapIds.has(String(g?.gapId)));
  const coverageRate = allGaps.length > 0 ? (filledGaps.length / allGaps.length) : 1;

  // === 健壮性：快速路径 ===
  // 如果没有 gaps 或者所有 gaps 都已填充，直接返回 sufficient
  if (allGaps.length === 0 || openGaps.length === 0) {
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
    const sufficient = uncoveredGaps.length === 0 || coverageRate >= 0.7;
    return {
      sufficient,
      confidence: 0.5,
      reason: `Fallback rule: ${uncoveredGaps.length} uncovered gaps, coverage ${(coverageRate * 100).toFixed(0)}%`,
      missingAspects: uncoveredGaps.slice(0, 3).map(g => g?.question || g?.text || "unknown"),
      suggestedQueries: [],
    };
  }

  // 准备 prompt 数据
  const taskGoal = String(state?.taskGoal || state?.userConfig?.taskGoal || "未指定");

  const coverageStats = [
    `- 总 Gaps: ${allGaps.length}`,
    `- 已填充: ${filledGaps.length} (${(coverageRate * 100).toFixed(0)}%)`,
    `- 未覆盖: ${uncoveredGaps.length}`,
    `- 已阻塞: ${blockedGaps.length}`,
    `- 总论点: ${allClaims.length} (核心: ${coreClaims.length}, 支持: ${supportClaims.length})`,
    `- 总证据: ${evidenceCount}`,
  ].join("\n");

  const uncoveredGapsStr = uncoveredGaps.length > 0
    ? uncoveredGaps.slice(0, 5).map((g, i) =>
        `${i + 1}. [${g?.type || "?"}] ${g?.question || g?.text || "?"}`
      ).join("\n")
    : "无 (所有缺口已覆盖)";

  // 只展示核心论点样本
  const coreClaimsStr = coreClaims.length > 0
    ? coreClaims.slice(0, 5).map((c, i) =>
        `${i + 1}. ${String(c?.text || "").slice(0, 80)}${c?.text?.length > 80 ? "..." : ""}`
      ).join("\n")
    : supportClaims.length > 0
      ? supportClaims.slice(0, 3).map((c, i) =>
          `${i + 1}. (支持) ${String(c?.text || "").slice(0, 80)}`
        ).join("\n")
      : "无论点";

  const prompt = REFLECT_PROMPT
    .replace("{taskGoal}", taskGoal)
    .replace("{coverageStats}", coverageStats)
    .replace("{uncoveredGaps}", uncoveredGapsStr)
    .replace("{totalClaims}", String(allClaims.length))
    .replace("{coreClaims}", coreClaimsStr);

  const cacheKeyInputs = { rawPrompt: truncate(prompt, 900) };

  // === 健壮性：带超时的 LLM 调用 ===
  const timeoutMs = 15000; // 15 秒超时
  let timeoutId;

  try {
    const resultPromise = callModel(
      [{ role: "user", content: prompt }],
      { model: "auto", temperature: 0.1, maxTokens: 400, cacheKeyInputs }
    );

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
        missingAspects: uncoveredGaps.slice(0, 3).map(g => g?.question || "?"),
        suggestedQueries: []
      };
    }

    const parsed = JSON.parse(candidate);

    // === 健壮性：验证返回值 ===
    const sufficient = typeof parsed.sufficient === "boolean" ? parsed.sufficient : coverageRate >= 0.6;
    const confidence = typeof parsed.confidence === "number" && !Number.isNaN(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

    return {
      sufficient,
      confidence,
      reason: String(parsed.reason || "").slice(0, 200),
      missingAspects: Array.isArray(parsed.missingAspects)
        ? parsed.missingAspects.filter(x => typeof x === "string" && x.trim()).slice(0, 5)
        : [],
      suggestedQueries: Array.isArray(parsed.suggestedQueries)
        ? parsed.suggestedQueries.filter(x => typeof x === "string" && x.trim()).slice(0, 3)
        : [],
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      sufficient: coverageRate >= 0.6,
      confidence: 0.3,
      reason: `Reflect error: ${String(err?.message || err).slice(0, 100)}`,
      missingAspects: uncoveredGaps.slice(0, 3).map(g => g?.question || "?"),
      suggestedQueries: [],
    };
  }
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function normalizeGapIds(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
}

async function tryLLMClaimEdits(state, claims, evidenceLedger, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "analyst", state });
  if (!callModel) return null;

  const evidenceById = new Map();
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    if (!e || !toNonEmptyString(e?.evidenceId)) continue;
    evidenceById.set(String(e.evidenceId), { quote: String(e.quote || ""), sourceId: String(e.sourceId || ""), gapIds: normalizeGapIds(e.gapIds) });
  }

  const cacheKeyInputs = normalizeUnderstandClaimEditsCacheKeyInputs(state?.taskGoal, claims, evidenceById);

  const messages = [
    {
      role: "system",
      content:
        "You are a DeepSearch claim extractor. Improve the provided draft claims for PPT use.\n" +
        "Return ONLY JSON: {claims:[{claimId,text,importance}]}. importance must be 'core' or 'support'.\n" +
        "Do not invent facts; only rephrase/summarize what's supported by the evidence quotes.",
    },
    {
      role: "user",
      content: JSON.stringify(
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
      ),
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

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch understand: input.state is required");
}

function indexSourceTextById(sources) {
  const m = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    const id = toNonEmptyString(s?.sourceId);
    if (!id) continue;
    if (typeof s?.sourceTextNormalized === "string") m.set(id, s.sourceTextNormalized);
  }
  return m;
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
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

function pickEvidenceSpan(text, { maxLen = 220 } = {}) {
  const t = String(text || "");
  if (!t.length) return null;

  let start = 0;
  while (start < t.length && /\s/.test(t[start])) start++;
  if (start >= t.length) return null;

  let end = Math.min(t.length, start + maxLen);

  const window = t.slice(start, end);
  const m = window.match(/[。！？.!?](?=\s|$)/);
  if (m && typeof m.index === "number" && m.index >= 40) end = start + m.index + 1;

  if (end <= start) return null;
  return { relStart: start, relEnd: end };
}

function quoteFromSourceLocator(sourceTextNormalized, locator, { maxQuoteLen = 220 } = {}) {
  const text = String(sourceTextNormalized || "");
  const baseStart = safeInt(locator?.charStart);
  const baseEnd = safeInt(locator?.charEnd);
  if (baseStart === null || baseEnd === null) throw new Error("Hard gate H2 failed: evidence locator must include charStart/charEnd");
  if (!(baseStart < baseEnd)) throw new Error("Hard gate H2 failed: evidence locator must satisfy charStart < charEnd");
  if (baseStart < 0 || baseEnd > text.length) throw new Error("Hard gate H2 failed: evidence locator out of source bounds");

  const slice = text.slice(baseStart, baseEnd);
  const span = pickEvidenceSpan(slice, { maxLen: maxQuoteLen });
  if (!span) throw new Error("Hard gate H3 failed: unable to derive non-empty quote from locator slice");

  const charStart = baseStart + span.relStart;
  const charEnd = baseStart + span.relEnd;
  const quote = text.slice(charStart, charEnd);
  if (!quote) throw new Error("Hard gate H3 failed: evidence.quote must be non-empty");
  return { locator: { charStart, charEnd }, quote };
}

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

/**
 * 验证单条 evidence 是否合规
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateSingleEvidence(e, { sources, sourceTextById, retrievedByChunkId }) {
  const issues = [];
  if (!e) {
    issues.push("evidence is null/undefined");
    return { valid: false, issues };
  }

  const evidenceId = toNonEmptyString(e?.evidenceId) || "(missing)";

  // H4: sourceId 必须存在且可解析
  const sourceId = toNonEmptyString(e?.sourceId);
  if (!sourceId) {
    issues.push("H4: sourceId missing");
  } else if (!Array.isArray(sources) || !sources.some((s) => toNonEmptyString(s?.sourceId) === sourceId)) {
    issues.push(`H4: sourceId "${sourceId}" not found in sources`);
  }

  // H4: chunkId 必须可解析
  const chunkId = toNonEmptyString(e?.chunkId);
  if (!chunkId) {
    issues.push("H4: chunkId missing");
  } else if (!retrievedByChunkId.has(String(chunkId))) {
    issues.push(`H4: chunkId "${chunkId}" not found in retrievedChunks`);
  }

  // H2: locator 必须合法
  const locator = e?.locator;
  const charStart = safeInt(locator?.charStart);
  const charEnd = safeInt(locator?.charEnd);
  if (charStart === null || charEnd === null) {
    issues.push("H2: locator missing charStart/charEnd");
  } else if (!(charStart < charEnd)) {
    issues.push(`H2: charStart (${charStart}) >= charEnd (${charEnd})`);
  }

  // H3: quote 必须非空
  const quote = String(e?.quote || "");
  if (!quote) {
    issues.push("H3: quote is empty");
  }

  // H2 + H3: quote 必须精确匹配 sourceText 切片
  if (sourceId && charStart !== null && charEnd !== null && quote) {
    const sourceText = sourceTextById.get(sourceId);
    if (typeof sourceText !== "string") {
      issues.push(`H4: sourceTextNormalized missing for sourceId "${sourceId}"`);
    } else if (charStart < 0 || charEnd > sourceText.length) {
      issues.push(`H2: locator out of bounds (${charStart}-${charEnd}, text length ${sourceText.length})`);
    } else {
      const slice = sourceText.slice(charStart, charEnd);
      if (slice !== quote) {
        issues.push(`H3: quote mismatch (expected "${slice.slice(0, 50)}...", got "${quote.slice(0, 50)}...")`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * 软降级验证：过滤不合规的 evidence，保留合规的
 * @returns {{ validEvidence: object[], invalidEvidence: {evidence: object, issues: string[]}[], validClaims: object[], orphanedClaims: object[] }}
 */
function validateEvidenceWithDegradation({ sources, sourceTextById, claims, evidenceLedger, retrievedByChunkId }, { emit } = {}) {
  const validEvidence = [];
  const invalidEvidence = [];

  // 验证每条 evidence
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    const { valid, issues } = validateSingleEvidence(e, { sources, sourceTextById, retrievedByChunkId });
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

/**
 * [已废弃] 硬门验证 - 保留用于严格模式或测试
 * @deprecated 请使用 validateEvidenceWithDegradation 进行软降级验证
 */
function assertHardGates({ sources, sourceTextById, claims, evidenceLedger, retrievedByChunkId }) {
  const evidenceById = new Map();
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    if (!e || !toNonEmptyString(e.evidenceId)) continue;
    evidenceById.set(String(e.evidenceId), e);
  }

  // H1 + evidence references resolvable (H4)
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || !Array.isArray(c.evidenceIds) || c.evidenceIds.length < 1) {
      throw new Error("Hard gate H1 failed: claims[].evidenceIds.length must be >= 1");
    }
    for (const eid of c.evidenceIds) {
      if (!evidenceById.has(String(eid))) throw new Error(`Hard gate H4 failed: Unresolvable evidenceId reference: ${String(eid)}`);
    }
  }

  // H2 + H3 + H4 for evidence items
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    if (!e) continue;
    const evidenceId = toNonEmptyString(e?.evidenceId) || "(missing_evidenceId)";
    const sourceId = toNonEmptyString(e?.sourceId);
    if (!sourceId) throw new Error("Hard gate H4 failed: evidence.sourceId is required");
    if (!Array.isArray(sources) || !sources.some((s) => toNonEmptyString(s?.sourceId) === sourceId)) {
      throw new Error(`Hard gate H4 failed: Unresolvable sourceId reference for evidence ${String(evidenceId)}: ${String(sourceId)}`);
    }

    const chunkId = toNonEmptyString(e?.chunkId);
    if (!chunkId || !retrievedByChunkId.has(String(chunkId))) {
      throw new Error(`Hard gate H4 failed: Unresolvable chunkId reference for evidence ${String(evidenceId)}: ${String(chunkId || "")}`);
    }

    const locator = e?.locator;
    const charStart = safeInt(locator?.charStart);
    const charEnd = safeInt(locator?.charEnd);
    if (charStart === null || charEnd === null) throw new Error("Hard gate H2 failed: evidenceLedger[].locator must include charStart/charEnd");
    if (!(charStart < charEnd)) throw new Error("Hard gate H2 failed: evidenceLedger[].locator.charStart must be < charEnd");

    const quote = String(e?.quote || "");
    if (!quote) throw new Error("Hard gate H3 failed: evidence.quote must be non-empty");

    const sourceText = sourceTextById.get(sourceId);
    if (typeof sourceText !== "string") throw new Error(`Hard gate H4 failed: sourceTextNormalized missing for sourceId: ${String(sourceId)}`);
    if (charStart < 0 || charEnd > sourceText.length) throw new Error("Hard gate H2 failed: evidence locator out of bounds");
    const slice = sourceText.slice(charStart, charEnd);
    if (slice !== quote) throw new Error("Hard gate H3 failed: evidence.quote must exactly match sourceTextNormalized at locator");
  }
}

/**
 * S5 Understanding wrapper (placeholder): convert retrievedChunks to claims[] + evidenceLedger[].
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchUnderstandStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  // 设置日志上下文
  setLogContext({ runId: state.runId, iteration: state.iteration || 0 });

  checkCancelled(stageApi);

  // 记录 understand 阶段开始
  logEvent({
    stage: 'understand',
    message: 'Understand stage started',
    data: {
      retrievedChunks: Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks.length : 0,
      existingClaims: Array.isArray(state?.L1?.claims) ? state.L1.claims.length : 0,
    },
  });

  // 发射阶段开始事件
  emitUnderstandProgress(emit, {
    current: 0,
    total: 1,
    msg: "正在启动理解阶段...",
    detail: { step: "init" },
  });

  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const sourceTextById = indexSourceTextById(state?.L0?.sources);

  const understandingConfig = isPlainObject(state?.userConfig?.understanding) ? state.userConfig.understanding : {};
  const maxQuoteLen = Number.isFinite(understandingConfig.maxQuoteLen) ? Math.max(60, Math.floor(understandingConfig.maxQuoteLen)) : 220;
  const dedupeThreshold =
    typeof understandingConfig.dedupeThreshold === "number" && Number.isFinite(understandingConfig.dedupeThreshold)
      ? understandingConfig.dedupeThreshold
      : 0.82;

  const { claims: seedClaims, evidences: seedEvidences } = claimsFromChunks(retrieved, { maxQuoteLen });
  const claims = dedupeClaims(seedClaims, { threshold: dedupeThreshold, mergeEvidence: true });

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

  const referencedEvidenceIds = new Set();
  for (const c of claims) for (const eid of Array.isArray(c?.evidenceIds) ? c.evidenceIds : []) referencedEvidenceIds.add(String(eid));

  const retrievedByChunkId = new Map();
  for (const r of retrieved) {
    const cid = toNonEmptyString(r?.chunkId);
    if (cid) retrievedByChunkId.set(cid, r);
  }

  const evidenceLedger = [];
  for (const e of Array.isArray(seedEvidences) ? seedEvidences : []) {
    if (!e || !referencedEvidenceIds.has(String(e.evidenceId))) continue;

    const sourceId = toNonEmptyString(e?.sourceId) || "source_unknown";
    const sourceText = sourceTextById.get(sourceId);
    if (typeof sourceText !== "string") {
      // Degrade gracefully: if the retrieved chunk doesn't map back to a known source,
      // drop this evidence row and let downstream validation prune orphaned claims.
      continue;
    }

    const derived = quoteFromSourceLocator(sourceText, e.locator, { maxQuoteLen });
    const retrievedRow = retrievedByChunkId.get(String(e.chunkId));
    const gapIds = normalizeGapIds(retrievedRow?.matchedGapIds || retrievedRow?.gapId);
    evidenceLedger.push({
      evidenceId: String(e.evidenceId),
      chunkId: String(e.chunkId),
      sourceId: String(sourceId),
      locator: derived.locator,
      quote: derived.quote,
      gapIds,
    });
  }

  const evidenceGapIdsById = new Map();
  for (const e of evidenceLedger) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid) continue;
    evidenceGapIdsById.set(eid, normalizeGapIds(e?.gapIds));
  }

  for (const c of claims) {
    const gapIds = [];
    for (const eid of Array.isArray(c?.evidenceIds) ? c.evidenceIds : []) {
      for (const gid of evidenceGapIdsById.get(String(eid)) || []) gapIds.push(gid);
    }
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

  const { conflicts, openQuestions: conflictQuestions } = detectConflicts(claims, {
    topicThreshold: typeof understandingConfig.conflictTopicThreshold === "number" ? understandingConfig.conflictTopicThreshold : 0.6,
    numericThreshold: typeof understandingConfig.conflictNumericThreshold === "number" ? understandingConfig.conflictNumericThreshold : 0.78,
  });

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
      retrievedByChunkId,
    });
  } else {
    // 软降级模式（默认）：过滤不合规项，保留合规项
    const { validEvidence, invalidEvidence, validClaims, orphanedClaims } = validateEvidenceWithDegradation(
      { sources, sourceTextById, claims, evidenceLedger, retrievedByChunkId },
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
  for (const r of retrieved) {
    if (!r || typeof r !== "object") continue;
    if (!r.consumed) r.consumed = true;
    if (!toNonEmptyString(r.consumedAt)) r.consumedAt = consumedAt;
  }

  state.L1.claims = finalClaims;
  state.L1.evidenceLedger = finalEvidenceLedger;
  state.L1.conflicts = conflicts;
  state.L1.openQuestions = openQuestions;

  emit?.("deepsearch.claim.snapshot", {
    runId: toNonEmptyString(state?.runId) || "run_unknown",
    iteration: safeInt(state?.iteration) ?? 0,
    trajectoryId: toNonEmptyString(state?.trajectoryId),
    claims: finalClaims.map((c) => ({
      claimId: c.claimId,
      importance: c.importance,
      gapIds: c.gapIds,
      evidenceIds: c.evidenceIds,
      textPreview: c.text?.slice(0, 100),
    })),
    edges: {
      claimToEvidence: finalClaims.flatMap((c) => (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).map((eid) => ({ claimId: c.claimId, evidenceId: eid }))),
      claimToGap: finalClaims.flatMap((c) => (Array.isArray(c.gapIds) ? c.gapIds : []).map((gid) => ({ claimId: c.claimId, gapId: gid }))),
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
      gapIds: e.gapIds,
    })),
    edges: {
      evidenceToGap: finalEvidenceLedger.flatMap((e) => (Array.isArray(e.gapIds) ? e.gapIds : []).map((gid) => ({ evidenceId: e.evidenceId, gapId: gid }))),
    },
  });

  // ===== Reflect: LLM 自主判断证据是否充分 =====
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const reflectCfg = isPlainObject(state?.userConfig?.reflect) ? state.userConfig.reflect : {};
  const extCfg = isPlainObject(state?.userConfig?.externalSearch) ? state.userConfig.externalSearch : {};
  const shouldRunReflectLLM = Boolean(reflectCfg.enabled) || (extCfg.enabled === true && extCfg.autoTrigger === true);

  // 默认不额外消耗一次 LLM 调用；显式开启 reflect 或外搜自动触发时才启用 LLM 反思。
  const reflectStageApi = shouldRunReflectLLM ? stageApi : { ...(isPlainObject(stageApi) ? stageApi : {}), modelRouter: null, aiApiService: null };
  const reflectResult = await reflectOnEvidence(state, { claims: finalClaims, evidenceLedger: finalEvidenceLedger, gaps }, reflectStageApi);

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
    logEvent({
      stage: 'understand',
      message: 'Evidence insufficient - needs more research',
      data: {
        reason: reflectResult.reason,
        confidence: reflectResult.confidence,
        missingAspects: reflectResult.missingAspects,
      },
    });
  }

  // 记录 understand 阶段完成
  logEvent({
    stage: 'understand',
    message: 'Understand stage completed',
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
