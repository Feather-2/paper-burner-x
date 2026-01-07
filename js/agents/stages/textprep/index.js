// TextPrep stage entry: TP1-TP6 to produce ContentPackage v0.1 from a long text input.

import { normalizeText } from "./normalize.js";
import { chunkText } from "./chunk.js";
import { planSlides } from "./slideplan.js";
import { extractClaims } from "./claims.js";
import { buildContentPackage } from "./build-content-package.js";
import { BaseStage } from "../../runtime/core/agent-loop.js";
import { TraceContext } from "../../runtime/telemetry/trace-context.js";
import { getErrorBoundary } from "../../runtime/core/error-boundary.js";
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

function resolveStageTraceContext(api) {
  const candidate = api?.traceContext;
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof candidate.startSpan === "function" &&
    typeof candidate.endSpan === "function" &&
    typeof candidate.withSpan === "function"
  ) {
    return candidate;
  }

  const traceparent = typeof api?.traceparent === "string" ? api.traceparent.trim() : "";
  if (traceparent) {
    const parsed = TraceContext.parseTraceparent(traceparent);
    if (parsed?.traceId && parsed?.spanId) {
      return new TraceContext({ traceId: parsed.traceId, parentSpanId: parsed.spanId });
    }
  }

  return new TraceContext();
}

function resolveErrorBoundary(api) {
  const direct = api?.errorBoundary;
  if (direct && typeof direct === "object" && typeof direct.wrap === "function") return direct;

  const container = api?.container;
  if (container && typeof container === "object") {
    const tryGet = typeof container.tryGet === "function" ? container.tryGet.bind(container) : null;
    if (tryGet) {
      const candidate = tryGet("errorBoundary");
      if (candidate && typeof candidate === "object" && typeof candidate.wrap === "function") return candidate;
    }
    const get = typeof container.get === "function" ? container.get.bind(container) : null;
    if (get) {
      try {
        const candidate = get("errorBoundary");
        if (candidate && typeof candidate === "object" && typeof candidate.wrap === "function") return candidate;
      } catch {
        // ignore
      }
    }
  }

  return getErrorBoundary();
}

function createTracedAiApiService(aiApiService, traceContext) {
  if (!aiApiService || typeof aiApiService !== "object" || typeof aiApiService.chat !== "function") return aiApiService;

  return new Proxy(aiApiService, {
    get(target, prop) {
      if (prop === "chat") {
        return async (opts = {}) => {
          const model = typeof opts?.model === "string" ? opts.model : "auto";
          const maxTokens = typeof opts?.maxTokens === "number" ? opts.maxTokens : undefined;
          const temperature = typeof opts?.temperature === "number" ? opts.temperature : undefined;
          const usage = typeof opts?.usage === "string" ? opts.usage : undefined;
          return await traceContext.withSpan("textprep.llm.chat", async (span) => {
            span.setAttributes({
              ...(model ? { model } : {}),
              ...(usage ? { usage } : {}),
              ...(maxTokens !== undefined ? { maxTokens } : {}),
              ...(temperature !== undefined ? { temperature } : {}),
            });
            return await target.chat.call(target, opts);
          });
        };
      }

      const value = target[prop];
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
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
  constructor(/** @type {{ defaultChunkOptions?: any, eventBus?: any, logger?: any }} */ { defaultChunkOptions, eventBus, logger } = {}) {
    super({ name: "textprep", eventBus, logger });
    this.defaultChunkOptions = defaultChunkOptions || { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  }

  async run(input, context = {}) {
    const api = createStageApi(context);
    const runContext = api.runContext || { runId: "run_unknown", constraints: {} };
    const traceContext = resolveStageTraceContext(api);
    const errorBoundary = resolveErrorBoundary(api);
    try {
      if (!api.traceContext) api.traceContext = traceContext;
    } catch {
      // ignore (non-extensible stageApi)
    }

    const emit = (name, payload) => api.emit(name, { actor: "textprep", status: "completed", payload });
    const rawText = toRawText(input);

    const shouldDegrade = () => {
      const cfg =
        api && typeof api === "object" && api.errorBoundaryConfig && typeof api.errorBoundaryConfig === "object"
          ? api.errorBoundaryConfig
          : null;
      if (cfg?.degrade === true) return true;
      if (api?.errorBoundaryDegrade === true || api?.degradeOnError === true) return true;
      const constraints = runContext?.constraints && typeof runContext.constraints === "object" ? runContext.constraints : null;
      if (constraints?.errorBoundary?.degrade === true) return true;
      return false;
    };

    const fallbackFactory = () => {
      // Best-effort heuristic pipeline: avoids LLM calls, still satisfies hard gates.
      const normalized = normalizeText(rawText);
      const chunkOptions = { ...this.defaultChunkOptions, ...(toChunkOptions(input) || {}) };
      const chunks = chunkText(normalized.normalized, chunkOptions);

      const desired = (() => {
        const c = runContext?.constraints;
        if (c && typeof c.pageCount === "number" && c.pageCount > 0) return Math.floor(c.pageCount);
        if (Array.isArray(c?.pageCountRange) && c.pageCountRange.length >= 2) {
          const a = Number(c.pageCountRange[0]);
          const b = Number(c.pageCountRange[1]);
          if (Number.isFinite(a) && Number.isFinite(b)) return Math.max(4, Math.round((a + b) / 2));
        }
        return 8;
      })();

      const slideIntents = [];
      slideIntents.push({ slideIntentId: "s_cover", pageType: "cover", title: "Presentation" });
      slideIntents.push({ slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda" });
      slideIntents.push({ slideIntentId: "s_overview", pageType: "overview", title: "Overview" });
      const remaining = Math.max(0, desired - slideIntents.length - 1);
      for (let i = 0; i < remaining; i++) {
        slideIntents.push({
          slideIntentId: `s_${i + 1}`,
          pageType: i % 2 === 0 ? "process" : "comparison",
          title: i % 2 === 0 ? "Process" : "Comparison",
        });
      }
      slideIntents.push({ slideIntentId: "s_summary", pageType: "summary", title: "Summary" });

      const { claims, evidenceLedger } = extractClaims(chunks, slideIntents, {
        sourceId: "user_text",
        sourceTextNormalized: normalized.normalized,
        maxQuoteLen: 220,
      });

      const alignedSlides = alignClaimsHeuristic(slideIntents, claims);

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

      const safeRunContext = { ...runContext, mode: "textprep" };
      const pkg = buildContentPackage(safeRunContext, sources, alignedSlides, claims, evidenceLedger, []);
      if (pkg?.metrics?.textprep) pkg.metrics.textprep.chunkCount = chunks.length;
      return pkg;
    };

    return await errorBoundary.wrap(
      async () =>
        await traceContext.withSpan(
          "textprep.run",
          async (runSpan) => {
        runSpan.setAttributes({ runId: runContext?.runId, rawChars: rawText.length });

        const tracedAiApiService = createTracedAiApiService(api.aiApiService, traceContext);

        api.checkCancelled();
        const normalized = await traceContext.withSpan("textprep.normalize", async (span) => {
          const out = normalizeText(rawText);
          span.setAttributes({
            textHash: out?.textHash,
            normalizedChars: out?.normalized?.length ?? 0,
          });
          return out;
        });
        emit("textprep.normalize.completed", {
          textHash: normalized.textHash,
          normalizedChars: normalized.normalized.length,
          normalization: normalized.normalization,
        });

        api.checkCancelled();
        const chunkOptions = { ...this.defaultChunkOptions, ...(toChunkOptions(input) || {}) };
        const chunks = await traceContext.withSpan("textprep.chunk", async (span) => {
          const out = chunkText(normalized.normalized, chunkOptions);
          span.setAttributes({ chunkCount: out?.length ?? 0, chunkSize: chunkOptions.chunkSize, overlap: chunkOptions.overlap });
          return out;
        });
        emit("textprep.chunk.completed", {
          chunkCount: chunks.length,
          chunkSize: chunkOptions.chunkSize,
          overlap: chunkOptions.overlap,
        });

        api.checkCancelled();
        const slideIntents = await traceContext.withSpan("textprep.slideplan", async (span) => {
          const out = await planSlides(chunks, {
            ...(runContext?.constraints || {}),
            __services: { aiApiService: tracedAiApiService, runtimeHints: api.runtimeHints },
          });
          span.setAttribute("slideCount", Array.isArray(out) ? out.length : 0);
          return out;
        });
        emit("textprep.slideplan.completed", { slideCount: slideIntents.length });

        api.checkCancelled();
        const { claims, evidenceLedger } = await traceContext.withSpan("textprep.claims", async (span) => {
          const out = extractClaims(chunks, slideIntents, {
            sourceId: "user_text",
            sourceTextNormalized: normalized.normalized,
            maxQuoteLen: 220,
          });
          span.setAttributes({
            claimCount: Array.isArray(out?.claims) ? out.claims.length : 0,
            evidenceCount: Array.isArray(out?.evidenceLedger) ? out.evidenceLedger.length : 0,
          });
          return out;
        });
        emit("textprep.claims.completed", { claimCount: claims.length, evidenceCount: evidenceLedger.length });

        api.checkCancelled();
        const alignedSlides = await traceContext.withSpan("textprep.align", async (span) => {
          const out = await alignClaimsToSlides(slideIntents, claims, {
            ...(runContext?.constraints || {}),
            __services: { aiApiService: tracedAiApiService, runtimeHints: api.runtimeHints },
          });
          span.setAttribute("slideCount", Array.isArray(out) ? out.length : 0);
          return out;
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

        const pkg = await traceContext.withSpan("textprep.build.contentPackage", async (span) => {
          span.setAttributes({ runId: runContext?.runId, slideCount: alignedSlides.length, claimCount: claims.length });
          return buildContentPackage(runContext, sources, alignedSlides, claims, evidenceLedger, []);
        });
        if (pkg?.metrics?.textprep) pkg.metrics.textprep.chunkCount = chunks.length;
        return pkg;
      },
      { attributes: { stage: "textprep", runId: runContext?.runId } }
        ),
      {
        context: {
          stage: "textprep",
          runId: runContext?.runId,
          shouldDegrade,
          fallbackFactory,
          emit: typeof api?.emit === "function" ? api.emit : null,
        },
        rethrow: true,
      }
    );
  }
}

// Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
export async function runTextPrepStage(runContext, input, stageApi = {}) {
  const stage = new TextPrepStage();
  return stage.execute(runContext, input, stageApi);
}
