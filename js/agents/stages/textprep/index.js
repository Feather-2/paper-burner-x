// TextPrep stage entry: TP1-TP6 to produce ContentPackage v0.1 from a long text input.

import { normalizeText } from "./normalize.js";
import { chunkText } from "./chunk.js";
import { planSlides } from "./slideplan.js";
import { extractClaims } from "./claims.js";
import { buildContentPackage } from "./build-content-package.js";

function toRawText(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    if (typeof input.text === "string") return input.text;
    if (typeof input.rawText === "string") return input.rawText;
  }
  return "";
}

function toChunkOptions(input) {
  if (input && typeof input === "object" && input.chunkOptions && typeof input.chunkOptions === "object") return input.chunkOptions;
  return null;
}

function extractJsonCandidate(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);

  return s;
}

function makeEmitter(stageApi) {
  const emitFn = stageApi?.emit || stageApi?.eventBus?.emit;
  if (typeof emitFn !== "function") return null;
  return (name, payload) => emitFn.call(stageApi?.eventBus || null, name, { actor: "textprep", status: "completed", payload });
}

function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}

function alignClaimsHeuristic(slideIntents, claims) {
  const claimIds = (Array.isArray(claims) ? claims : []).map((c) => c?.claimId).filter(Boolean);
  let cursor = 0;

  const out = [];
  for (const s of Array.isArray(slideIntents) ? slideIntents : []) {
    const pageType = String(s?.pageType || "");
    if (pageType === "cover" || pageType === "agenda") {
      out.push({ ...s, claimIds: [] });
      continue;
    }

    if (pageType === "overview") {
      out.push({ ...s, claimIds: claimIds.slice(0, 5) });
      continue;
    }
    if (pageType === "summary") {
      const take = claimIds.slice(Math.max(0, claimIds.length - 5));
      out.push({ ...s, claimIds: take.length ? take : claimIds.slice(0, 5) });
      continue;
    }

    if (cursor >= claimIds.length) {
      out.push({ ...s, claimIds: [] });
      continue;
    }

    const takeN = pageType === "comparison" || pageType === "process" ? 2 : 1;
    const assigned = claimIds.slice(cursor, cursor + takeN);
    cursor += assigned.length;
    out.push({ ...s, claimIds: assigned });
  }
  return out;
}

async function alignClaimsToSlides(slideIntents, claims, constraints = {}) {
  const aiApiService = constraints?.__services?.aiApiService || globalThis?.aiApiService;
  const claimIdSet = new Set((Array.isArray(claims) ? claims : []).map((c) => c?.claimId).filter(Boolean));
  const slideIdSet = new Set((Array.isArray(slideIntents) ? slideIntents : []).map((s) => s?.slideIntentId).filter(Boolean));

  if (aiApiService && typeof aiApiService.chat === "function") {
    const messages = [
      {
        role: "system",
        content:
          "You are a claim-to-slide aligner. Return ONLY a JSON array of {slideIntentId, claimIds}. " +
          "Use only provided claimIds; do not invent ids; cover/agenda should typically have empty claimIds.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            slides: (Array.isArray(slideIntents) ? slideIntents : []).map((s) => ({
              slideIntentId: s.slideIntentId,
              pageType: s.pageType,
              title: s.title,
              objective: s.objective,
              keyPoints: s.keyPoints,
            })),
            claims: (Array.isArray(claims) ? claims : []).map((c) => ({ claimId: c.claimId, text: c.text, importance: c.importance })),
          },
          null,
          2
        ),
      },
    ];

    try {
      const result = await aiApiService.chat({ messages, model: constraints?.model || "auto", temperature: 0.1, maxTokens: 1200 });
      const candidate = extractJsonCandidate(result?.content);
      if (candidate) {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) {
          const bySlide = new Map();
          for (const row of parsed) {
            const sid = row?.slideIntentId;
            if (!slideIdSet.has(sid)) continue;
            const claimIdsRaw = Array.isArray(row?.claimIds) ? row.claimIds : [];
            const filtered = claimIdsRaw.map((x) => String(x)).filter((x) => claimIdSet.has(x));
            bySlide.set(sid, filtered);
          }
          return (Array.isArray(slideIntents) ? slideIntents : []).map((s) => ({
            ...s,
            claimIds: bySlide.get(s.slideIntentId) || [],
          }));
        }
      }
    } catch {
      // fall through to heuristic
    }
  }

  return alignClaimsHeuristic(slideIntents, claims);
}

export class TextPrepStage {
  constructor({ defaultChunkOptions } = {}) {
    this.defaultChunkOptions = defaultChunkOptions || { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  }

  /**
   * Stage interface (Runtime): execute(runContext, input) -> ContentPackage.
   * @param {object} runContext
   * @param {string|{text?:string,rawText?:string,chunkOptions?:object}} input
   * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function,aiApiService?:object}=} stageApi
   * @returns {Promise<object>} ContentPackage v0.1
   */
  async execute(runContext, input, stageApi = {}) {
    const emit = makeEmitter(stageApi);
    const rawText = toRawText(input);

    checkCancelled(stageApi);
    const normalized = normalizeText(rawText);
    emit?.("textprep.normalize.completed", {
      textHash: normalized.textHash,
      normalizedChars: normalized.normalized.length,
      normalization: normalized.normalization,
    });

    checkCancelled(stageApi);
    const chunkOptions = { ...this.defaultChunkOptions, ...(toChunkOptions(input) || {}) };
    const chunks = chunkText(normalized.normalized, chunkOptions);
    emit?.("textprep.chunk.completed", {
      chunkCount: chunks.length,
      chunkSize: chunkOptions.chunkSize,
      overlap: chunkOptions.overlap,
    });

    checkCancelled(stageApi);
    const slideIntents = await planSlides(chunks, {
      ...(runContext?.constraints || {}),
      __services: { aiApiService: stageApi.aiApiService },
    });
    emit?.("textprep.slideplan.completed", { slideCount: slideIntents.length });

    checkCancelled(stageApi);
    const { claims, evidenceLedger } = extractClaims(chunks, slideIntents, {
      sourceId: "user_text",
      sourceTextNormalized: normalized.normalized,
      maxQuoteLen: 220,
    });
    emit?.("textprep.claims.completed", { claimCount: claims.length, evidenceCount: evidenceLedger.length });

    checkCancelled(stageApi);
    const alignedSlides = await alignClaimsToSlides(slideIntents, claims, {
      ...(runContext?.constraints || {}),
      __services: { aiApiService: stageApi.aiApiService },
    });
    emit?.("textprep.align.completed", { slideCount: alignedSlides.length });

    checkCancelled(stageApi);
    const sources = [
      {
        sourceId: "user_text",
        kind: "user_text",
        title: "User Input",
        textHash: normalized.textHash,
        normalization: normalized.normalization,
        // Internal-only: used to validate evidence locators/quotes (H3), not emitted in ContentPackage.sources.
        sourceTextNormalized: normalized.normalized,
      },
    ];

    const pkg = buildContentPackage(runContext || { runId: "run_unknown", constraints: {} }, sources, alignedSlides, claims, evidenceLedger, []);
    if (pkg?.metrics?.textprep) pkg.metrics.textprep.chunkCount = chunks.length;
    return pkg;
  }

  // Convenience for existing code: run(input, context) (like DesignStage).
  async run(input, context = {}) {
    return this.execute(context.runContext || { runId: "run_unknown", constraints: {} }, input, context);
  }
}

// Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
export async function runTextPrepStage(runContext, input, stageApi = {}) {
  const stage = new TextPrepStage();
  return stage.execute(runContext, input, stageApi);
}

