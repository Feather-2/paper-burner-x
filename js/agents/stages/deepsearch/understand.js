import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { claimsFromChunks } from "../../deepsearch/understanding/claims-from-chunks.js";
import { dedupeClaims } from "../../deepsearch/understanding/dedupe.js";
import { detectConflicts } from "../../deepsearch/understanding/conflicts.js";
import { logEvent, setLogContext } from "./logger.js";
import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";

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

// ===== LLM Claims Prompt: 基于 gap.question 从 chunks 提取更精准论点 =====
const LLM_CLAIMS_PROMPT = `你是一个研究助手，需要从文档片段中提取与问题相关的关键论点。

## 问题
{gapQuestion}

## 文档片段
{chunkTexts}

## 任务
1. 仔细阅读文档片段
2. 提取能够回答或部分回答问题的关键论点
3. 每个论点必须有原文引用支持

## 输出格式 (JSON)
{
  "claims": [
    {
      "text": "论点陈述（简洁、清晰）",
      "importance": "core|support",
      "quote": "原文引用（必须是文档中的原文）",
      "chunkIndex": 0  // 引用来自哪个 chunk
    }
  ]
}
`;

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

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeImportance(v) {
  const s = toNonEmptyString(v);
  if (s === "core" || s === "support") return s;
  return null;
}

function safeChunkIndex(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatChunksForLLM(chunks) {
  return safeArray(chunks)
    .map((c, i) => {
      const text = typeof c?.text === "string" ? c.text : "";
      return `### Chunk ${i}\n${text}`;
    })
    .join("\n\n");
}

function locateQuoteInSourceSlice(sourceText, baseLocator, quote) {
  const baseStart = safeInt(baseLocator?.charStart);
  const baseEnd = safeInt(baseLocator?.charEnd);
  if (baseStart === null || baseEnd === null) return null;
  if (!(baseStart < baseEnd)) return null;
  if (baseStart < 0 || baseEnd > sourceText.length) return null;
  if (typeof quote !== "string" || !quote) return null;

  const window = sourceText.slice(baseStart, baseEnd);
  const idx = window.indexOf(quote);
  if (idx < 0) return null;

  const charStart = baseStart + idx;
  const charEnd = charStart + quote.length;
  if (!(charStart < charEnd) || charEnd > baseEnd) return null;
  if (sourceText.slice(charStart, charEnd) !== quote) return null;
  return { charStart, charEnd };
}

/**
 * Generate claims with LLM for a specific gap, grounded in provided chunks.
 * - Returns null on "LLM unavailable" or fatal errors so caller can fallback to rules.
 * - Skips any claim whose quote cannot be precisely located in sourceTextNormalized.
 *
 * @param {{gapId?:string,question?:string,type?:string}} gap
 * @param {Array<{chunkId:string,sourceId:string,locator:{charStart:number,charEnd:number},text:string,score?:number}>} chunks
 * @param {object} stageApi
 * @param {DeepSearchState} state
 * @param {{maxQuoteLen:number}} options
 * @returns {Promise<null|{claims:any[],evidences:any[]}>}
 */
async function generateClaimsWithLLM(gap, chunks, stageApi, state, { maxQuoteLen }) {
  const callModel = getModelCaller(stageApi, { usage: "analyst", state });
  if (!callModel) return null;

  const gapQuestion = toNonEmptyString(gap?.question);
  if (!gapQuestion) return null;

  const sourceTextById = indexSourceTextById(state?.L0?.sources);

  const promptChunks = safeArray(chunks).filter((c) => typeof c?.text === "string" && toNonEmptyString(c?.chunkId) && toNonEmptyString(c?.sourceId));

  if (!promptChunks.length) return null;

  const prompt = LLM_CLAIMS_PROMPT
    .replace("{gapQuestion}", gapQuestion)
    .replace("{chunkTexts}", formatChunksForLLM(promptChunks));

  const cacheKeyInputs = {
    gapId: toNonEmptyString(gap?.gapId) || "",
    question: truncate(gapQuestion, 220),
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
          "你是一个严谨的研究助手。只能基于提供的文档片段提取论点，不得编造。输出必须为严格 JSON，且 quote 必须为原文精确片段。",
      },
      { role: "user", content: prompt },
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

      if (typeof maxQuoteLen === "number" && Number.isFinite(maxQuoteLen) && maxQuoteLen > 0 && quote.length > maxQuoteLen) {
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
  // 最早的入口日志
  console.log("[DeepSearch] understand stage entry", {
    hasState: !!input?.state,
    stateType: input?.state?.constructor?.name,
  });

  const emit = makeStageEmitter(stageApi, "deepsearch");

  let state;
  try {
    state = ensureState(runContext, input);
  } catch (err) {
    console.error("[DeepSearch] understand ensureState failed:", err);
    throw err;
  }

  // 设置日志上下文
  setLogContext({ runId: state.runId, iteration: state.iteration || 0 });

  try {
    checkCancelled(stageApi);
  } catch (err) {
    console.error("[DeepSearch] understand checkCancelled failed:", err);
    throw err;
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
  logEvent({
    stage: 'understand',
    message: 'Understand stage started',
    data: {
      retrievedChunks: retrieved.length,
      unconsumedChunks: newRetrieved.length,
      existingClaims: existingClaims.length,
    },
  });

  // 发射阶段开始事件
  emitUnderstandProgress(emit, {
    current: 0,
    total: 1,
    msg: "正在启动理解阶段...",
    detail: { step: "init" },
  });

  if (!newRetrieved.length) {
    logEvent({ stage: "understand", message: "No unconsumed chunks to process" });
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

  // === per-gap 模式：按 gapId 分组生成 claims ===
  const chunksByGapId = new Map();
  /** @type {any[]} */
  const ungappedChunks = [];
  for (const r of newRetrieved) {
    const gapIds = normalizeGapIds(r?.matchedGapIds || r?.gapId);
    if (!gapIds.length) {
      ungappedChunks.push(r);
      continue;
    }
    for (const gapId of gapIds) {
      const gid = String(gapId);
      if (!chunksByGapId.has(gid)) chunksByGapId.set(gid, []);
      chunksByGapId.get(gid).push(r);
    }
  }

  const gapsById = new Map();
  for (const g of Array.isArray(state?.L1?.gaps) ? state.L1.gaps : []) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    gapsById.set(String(gid), g);
  }

  /** @type {any[]} */
  const seedClaimsRaw = [];
  /** @type {any[]} */
  const seedEvidencesRaw = [];
  let nextSeedClaimNum = 0;
  let nextSeedEvidenceNum = 0;

  // 并行调用所有 gap 的 LLM（后续 ID rebase 仍按原顺序串行执行，保持行为稳定）
  const gapEntries = Array.from(chunksByGapId.entries());
  const llmResults = await Promise.all(
    gapEntries.map(async ([gapId, chunksForGap]) => {
      const deduped = dedupeChunksByChunkId(chunksForGap);
      const gap = gapsById.get(String(gapId)) || { gapId: String(gapId) };

      let seed = null;
      if (useLLMClaims) {
        try {
          seed = await generateClaimsWithLLM(gap, deduped, stageApi, state, { maxQuoteLen });
        } catch (err) {
          console.error("[DeepSearch] understand generateClaimsWithLLM failed:", { gapId, err });
          seed = null;
        }
      }
      if (!isValidSeed(seed)) {
        seed = claimsFromChunksWithDiagnostics(deduped, { label: "gap", gapId });
      }
      if (!isValidSeed(seed)) {
        seed = basicSeedFromChunks(deduped, { label: "gap", gapId });
      }
      if (!seed || !Array.isArray(seed.claims) || !Array.isArray(seed.evidences)) seed = { claims: [], evidences: [] };

      return { gapId, seed };
    })
  );

  for (const { gapId, seed } of llmResults) {
    const rebased = rebaseSeedIds(seed, { nextSeedClaimNum, nextSeedEvidenceNum });
    nextSeedClaimNum = rebased.nextSeedClaimNum;
    nextSeedEvidenceNum = rebased.nextSeedEvidenceNum;

    for (const c of rebased.claims) c.gapIds = [String(gapId)];
    for (const e of rebased.evidences) e.gapIds = [String(gapId)];
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

  const seedClaims = dedupeClaims(seedClaimsRaw, { threshold: dedupeThreshold, mergeEvidence: true });

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
    const gapIds = Array.from(
      new Set([
        ...normalizeGapIds(retrievedRow?.matchedGapIds || retrievedRow?.gapId),
        ...normalizeGapIds(seed?.gapIds),
      ])
    );

    const candidateEvidence = {
      evidenceId: seedEvidenceId,
      chunkId: String(seed.chunkId),
      sourceId: String(sourceId),
      locator: derived.locator,
      quote: derived.quote,
      gapIds,
    };

    const sig = evidenceSignature(candidateEvidence);
    if (sig) {
      const existingEvidenceId = existingEvidenceIdBySignature.get(sig);
      if (existingEvidenceId) {
        seedToFinalEvidenceId.set(seedEvidenceId, existingEvidenceId);
        const existing = existingEvidenceById.get(existingEvidenceId);
        if (existing && gapIds.length) {
          const mergedGapIds = Array.from(new Set([...normalizeGapIds(existing?.gapIds), ...gapIds]));
          if (mergedGapIds.length) existing.gapIds = mergedGapIds;
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
  const claims = dedupeClaims(combinedClaims, { threshold: dedupeThreshold, mergeEvidence: true });

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
  for (const e of evidenceLedger) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid) continue;
    evidenceGapIdsById.set(eid, normalizeGapIds(e?.gapIds));
  }

  for (const c of claims) {
    const gapIds = [...normalizeGapIds(c?.gapIds)];
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
