// TP4: Slide planning (SlideIntent[]).
//
// The planner should NOT introduce new facts. It should only propose page structure
// (page types/titles/objectives/keyPoints) based on the input chunks + constraints.

import { ALLOWED_PAGE_TYPES, PageType } from "./constants.js";
import { injectSystemHint, protoSafeReviver} from "../../shared/index.js";
import { extractJsonCandidate } from "../../shared/index.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { createLogger } from "../../shared/utils/logger.js";
const logger = createLogger("agents");
function clampArrayStrings(arr) {
  if (!Array.isArray(arr)) return undefined;
  const out = [];
  for (const v of arr) {
    const s = toNonEmptyString(v);
    if (s) out.push(s);
  }
  return out.length ? out : undefined;
}

/** @private Maximum allowed JSON candidate length to prevent DoS via oversized payloads. */
const MAX_JSON_CANDIDATE_LEN = 64_000;
/** @private Maximum allowed slide intents to prevent memory exhaustion. */
const MAX_SLIDE_INTENTS = 100;

function tryParseSlideIntentsFromContent(content) {
  const candidate = extractJsonCandidate(content, { prefer: "array" });
  if (!candidate) return null;
  // Length guard: reject oversized payloads before parsing.
  if (candidate.length > MAX_JSON_CANDIDATE_LEN) {
    logger.warn("[slideplan] JSON candidate exceeds max length, rejecting");
    return null;
  }
  try {
    const parsed = JSON.parse(candidate, protoSafeReviver);
    if (!Array.isArray(parsed)) return null;
    // Cardinality guard: limit number of slide intents.
    if (parsed.length > MAX_SLIDE_INTENTS) {
      logger.warn(`[slideplan] Parsed ${parsed.length} intents, truncating to ${MAX_SLIDE_INTENTS}`);
      return parsed.slice(0, MAX_SLIDE_INTENTS);
    }
    return parsed;
  } catch (err) {
    logger.warn("[slideplan] JSON parse failed:", err?.message);
    return null;
  }
}

function normalizeIntent(raw, i) {
  const r = isPlainObject(raw) ? raw : {};
  const slideIntentId = toNonEmptyString(r.slideIntentId) || `s${i + 1}`;

  /** @type {string} */
  let pageType = toNonEmptyString(r.pageType) || "overview";
  pageType = pageType.toLowerCase();
  if (!ALLOWED_PAGE_TYPES.has(pageType)) pageType = "overview";

  const title = toNonEmptyString(r.title) || (pageType === "cover" ? "Presentation" : `Slide ${i + 1}`);
  const objective = toNonEmptyString(r.objective);
  const keyPoints = clampArrayStrings(r.keyPoints);

  // claimIds is allowed by the schema, but TextPrep normally fills this in TP5/align.
  const claimIds = clampArrayStrings(r.claimIds);

  return {
    slideIntentId,
    pageType,
    title,
    ...(objective ? { objective } : {}),
    ...(keyPoints ? { keyPoints } : {}),
    ...(claimIds ? { claimIds } : {}),
  };
}

function ensureCoreSlides(intents, titleHint) {
  const out = Array.isArray(intents) ? [...intents] : [];

  const titleFromHint = (() => {
    const s = toNonEmptyString(titleHint);
    if (!s) return "Presentation";
    return s.split("\n")[0].trim().slice(0, 60) || "Presentation";
  })();

  const has = new Set(out.map((s) => s?.pageType).filter(Boolean));

  if (!has.has("cover")) out.unshift({ slideIntentId: "s_cover", pageType: "cover", title: titleFromHint });
  if (!has.has("agenda")) out.splice(1, 0, { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda" });
  if (!has.has("overview")) out.splice(2, 0, { slideIntentId: "s_overview", pageType: "overview", title: "Overview" });
  if (!has.has("summary")) out.push({ slideIntentId: "s_summary", pageType: "summary", title: "Summary" });

  // Ensure unique ids.
  const seen = new Set();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    let id = s?.slideIntentId;
    if (!id || seen.has(id)) id = `s${i + 1}`;
    seen.add(id);
    out[i] = { ...s, slideIntentId: id };
  }
  return out;
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function chunkSnippets(chunks, { maxChunks = 8, maxChars = 500 } = {}) {
  const arr = Array.isArray(chunks) ? chunks : [];
  return arr.slice(0, maxChunks).map((c) => ({
    chunkId: c?.chunkId,
    locator: c?.locator,
    text: collapseWhitespace(String(c?.text || "")).slice(0, maxChars),
  }));
}

function heuristicPlan(chunks, constraints) {
  const desired =
    (constraints && typeof constraints.pageCount === "number" && constraints.pageCount > 0 ? constraints.pageCount : undefined) ||
    (Array.isArray(constraints?.pageCountRange) ? Math.round((constraints.pageCountRange[0] + constraints.pageCountRange[1]) / 2) : undefined) ||
    8;

  const intents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Presentation" },
    { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda" },
    { slideIntentId: "s_overview", pageType: "overview", title: "Key Takeaways" },
  ];

  const remaining = Math.max(0, desired - intents.length - 1);
  for (let i = 0; i < remaining; i++) {
    intents.push({
      slideIntentId: `s_${i + 1}`,
      pageType: i % 2 === 0 ? "process" : "comparison",
      title: i % 2 === 0 ? "Process" : "Comparison",
    });
  }

  intents.push({ slideIntentId: "s_summary", pageType: "summary", title: "Summary" });
  return ensureCoreSlides(intents, chunks?.[0]?.text);
}

/**
 * @param {Array<{chunkId:string,text:string,locator:{charStart:number,charEnd:number,lineStart?:number,lineEnd?:number}}>} chunks
 * @param {object} constraints (may include __services.aiApiService)
 * @returns {Promise<object[]>} SlideIntent[]
 */
export async function planSlides(chunks, constraints = {}) {
  const aiApiService = constraints?.__services?.aiApiService || globalThis?.aiApiService;
  const systemHint = constraints?.__services?.runtimeHints?.system || constraints?.runtimeHints?.system;

  if (aiApiService && typeof aiApiService.chat === "function") {
    const messages = [
      {
        role: "system",
        content:
          "You are a slide planner. Return ONLY a JSON array of SlideIntent objects. " +
          "Allowed pageType: cover, agenda, overview, comparison, process, summary, appendix. " +
          "Do not introduce new facts; summarize and structure what is present in the input snippets.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            constraints: (() => {
              const c = isPlainObject(constraints) ? { ...constraints } : {};
              delete c.__services;
              return c;
            })(),
            chunkSnippets: chunkSnippets(chunks, { maxChunks: 10, maxChars: 700 }),
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
        temperature: 0.2,
        maxTokens: 1200,
        timeout: constraints?.llmTimeout ?? 30_000,
      });
      const parsed = tryParseSlideIntentsFromContent(result?.content);
      if (parsed) {
        const normalized = parsed.map((it, i) => normalizeIntent(it, i));
        return ensureCoreSlides(normalized, chunks?.[0]?.text);
      }
    } catch (err) {
      logger.warn("[slideplan] LLM call failed, falling back to heuristic:", err?.message);
      // fall through to heuristic
    }
  }

  return heuristicPlan(chunks, constraints);
}

/**
 * Back-compat alias (older tests/code may call generateSlideIntents).
 * @deprecated Use planSlides instead.
 */
export const generateSlideIntents = planSlides;
