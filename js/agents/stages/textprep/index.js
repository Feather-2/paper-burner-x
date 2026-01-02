// TextPrep stage entry: TP1-TP6 to produce ContentPackage v0.1 from a long text input.

import { normalizeText } from "./normalize.js";
import { chunkText } from "./chunk.js";
import { planSlides } from "./slideplan.js";
import { extractClaims } from "./claims.js";
import { buildContentPackage } from "./build-content-package.js";
import { BaseStage } from "../../runtime/core/agent-loop.js";
import { createStageApi } from "../../shared/utils/stage-api.js";
import { injectSystemHint } from "../../shared/utils/message-utils.js";
import { extractJsonCandidate } from "../../shared/utils/json-candidate.js";

function toRawText(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    if (typeof input.text === "string") return input.text;
    if (typeof input.rawText === "string") return input.rawText;
    if (Array.isArray(input.sources)) {
      const merged = input.sources
        .map((s) => {
          if (typeof s === "string") return s;
          if (!s || typeof s !== "object") return "";
          if (typeof s.sourceTextNormalized === "string") return s.sourceTextNormalized;
          if (typeof s.textNormalized === "string") return s.textNormalized;
          if (typeof s.text === "string") return s.text;
          if (typeof s.rawText === "string") return s.rawText;
          return "";
        })
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (merged) return merged;
    }
  }
  return "";
}

function toChunkOptions(input) {
  if (input && typeof input === "object" && input.chunkOptions && typeof input.chunkOptions === "object") return input.chunkOptions;
  return null;
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
  const systemHint = constraints?.__services?.runtimeHints?.system || constraints?.runtimeHints?.system;
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
    const hintedMessages = injectSystemHint(messages, systemHint);

    try {
      const result = await aiApiService.chat({
        messages: hintedMessages,
        model: constraints?.model || "auto",
        temperature: 0.1,
        maxTokens: 1200,
      });
      const candidate = extractJsonCandidate(result?.content, { prefer: "array" });
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

export class TextPrepStage extends BaseStage {
  constructor({ defaultChunkOptions, eventBus, logger } = {}) {
    super({ name: "textprep", eventBus, logger });
    this.defaultChunkOptions = defaultChunkOptions || { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  }

  async run(input, context = {}) {
    const api = createStageApi(context);
    const runContext = api.runContext || { runId: "run_unknown", constraints: {} };

    const emit = (name, payload) => api.emit(name, { actor: "textprep", status: "completed", payload });
    const rawText = toRawText(input);

    api.checkCancelled();
    const normalized = normalizeText(rawText);
    emit("textprep.normalize.completed", {
      textHash: normalized.textHash,
      normalizedChars: normalized.normalized.length,
      normalization: normalized.normalization,
    });

    api.checkCancelled();
    const chunkOptions = { ...this.defaultChunkOptions, ...(toChunkOptions(input) || {}) };
    const chunks = chunkText(normalized.normalized, chunkOptions);
    emit("textprep.chunk.completed", {
      chunkCount: chunks.length,
      chunkSize: chunkOptions.chunkSize,
      overlap: chunkOptions.overlap,
    });

    api.checkCancelled();
    const slideIntents = await planSlides(chunks, {
      ...(runContext?.constraints || {}),
      __services: { aiApiService: api.aiApiService, runtimeHints: api.runtimeHints },
    });
    emit("textprep.slideplan.completed", { slideCount: slideIntents.length });

    api.checkCancelled();
    const { claims, evidenceLedger } = extractClaims(chunks, slideIntents, {
      sourceId: "user_text",
      sourceTextNormalized: normalized.normalized,
      maxQuoteLen: 220,
    });
    emit("textprep.claims.completed", { claimCount: claims.length, evidenceCount: evidenceLedger.length });

    api.checkCancelled();
    const alignedSlides = await alignClaimsToSlides(slideIntents, claims, {
      ...(runContext?.constraints || {}),
      __services: { aiApiService: api.aiApiService, runtimeHints: api.runtimeHints },
    });
    emit("textprep.align.completed", { slideCount: alignedSlides.length });

    api.checkCancelled();
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

    const pkg = buildContentPackage(runContext, sources, alignedSlides, claims, evidenceLedger, []);
    if (pkg?.metrics?.textprep) pkg.metrics.textprep.chunkCount = chunks.length;
    return pkg;
  }
}

// Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
export async function runTextPrepStage(runContext, input, stageApi = {}) {
  const stage = new TextPrepStage();
  return stage.execute(runContext, input, stageApi);
}
