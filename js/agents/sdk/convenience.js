/**
 * SDK convenience helpers (L0)
 *
 * One-line wrappers for common stage runs.
 */

import { EventBus } from "../core/event-bus.js";
import { makeSecureTimestampedId, toNonEmptyString } from "../shared/index.js";

/**
 * @callback EventCallback
 * @param {any} event
 * @returns {void}
 */

/**
 * @typedef {object} ConvenienceRunOptions
 * @property {any[]} [sources] - Source inputs for the run.
 * @property {any} [modelRouter] - Optional ModelRouter instance.
 * @property {number} [maxIterations] - Optional max iteration override.
 * @property {AbortSignal} [signal] - Optional cancellation signal.
 * @property {EventCallback} [onEvent] - Optional event stream callback.
 * @property {(meta: { prefix: string }) => string} [runIdFactory] - Optional runId factory.
 */

/**
 * @typedef {object} DeepSearchConvenienceSuccess
 * @property {true} ok
 * @property {any} report
 * @property {{ claims: any[], todos: any[] }} findings
 */

/**
 * @typedef {object} DesignConvenienceSuccess
 * @property {true} ok
 * @property {{ deckHtmlDsl: string, slidesMeta: any[] }} slides
 * @property {{ review: any, visual: any, refine: any, pendingImages: any[] }} findings
 */

/**
 * @typedef {object} ConvenienceFailure
 * @property {false} ok
 * @property {string} error
 */

/**
 * @typedef {DeepSearchConvenienceSuccess | ConvenienceFailure} DeepSearchConvenienceResult
 */

/**
 * @typedef {DesignConvenienceSuccess | ConvenienceFailure} DesignConvenienceResult
 */

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * @param {EventBus} eventBus
 * @param {EventCallback | undefined} onEvent
 * @returns {(() => void) | null}
 */
function bindEventCallback(eventBus, onEvent) {
  if (typeof onEvent !== "function") return null;
  return eventBus.on("*", (event) => {
    onEvent(event);
  });
}

/**
 * @param {string} prefix
 * @returns {string}
 */
export function createRunId(prefix, options = {}) {
  const normalizedPrefix = toNonEmptyString(prefix) || "run";
  const runIdFactory = typeof options?.runIdFactory === "function" ? options.runIdFactory : null;

  if (runIdFactory) {
    try {
      const custom = toNonEmptyString(runIdFactory({ prefix: normalizedPrefix }));
      if (custom) return custom;
    } catch {
      // ignore factory errors and fallback to secure default
    }
  }

  return makeSecureTimestampedId(normalizedPrefix, { allowInsecureFallback: true });
}

/**
 * @param {string} taskGoal
 * @param {any[]} sources
 * @returns {any[]}
 */
function toFallbackSlideIntents(taskGoal, sources) {
  const collected = [];
  for (const source of sources) {
    if (typeof source === "string" && source.trim()) {
      collected.push(source.trim());
      continue;
    }
    if (source && typeof source === "object") {
      if (typeof source.keyPoint === "string" && source.keyPoint.trim()) {
        collected.push(source.keyPoint.trim());
        continue;
      }
      if (typeof source.summary === "string" && source.summary.trim()) {
        collected.push(source.summary.trim());
        continue;
      }
      if (typeof source.title === "string" && source.title.trim()) {
        collected.push(source.title.trim());
      }
    }
  }

  const keyPoints = collected.slice(0, 5);
  if (keyPoints.length === 0 && taskGoal) keyPoints.push(taskGoal);

  return [
    {
      pageType: "title",
      title: taskGoal || "Generated Slides",
      keyPoints,
    },
  ];
}

/**
 * One-line DeepSearch execution.
 *
 * @param {string} taskGoal - Research goal.
 * @param {ConvenienceRunOptions} [options] - Optional execution settings.
 * @returns {Promise<DeepSearchConvenienceResult>}
 */
export async function runDeepSearch(taskGoal, options = {}) {
  const eventBus = new EventBus();
  const unsubscribe = bindEventCallback(eventBus, options?.onEvent);

  try {
    const { DeepSearchAgentLoop } = await import("../stages/deepsearch/deepsearch-agent-loop.js");
    const runId = createRunId("deepsearch", { runIdFactory: options?.runIdFactory });
    const maxIterations = toPositiveInt(options?.maxIterations);
    const sources = Array.isArray(options?.sources) ? options.sources : [];
    const userConfig = maxIterations ? { maxIterations } : {};

    const loop = new DeepSearchAgentLoop({
      eventBus,
      ...(maxIterations ? { maxIterations } : {}),
    });

    const output = await loop.run(
      {
        runId,
        taskGoal: typeof taskGoal === "string" ? taskGoal : String(taskGoal || ""),
        userConfig,
        L0: { sources },
      },
      {
        stageApi: {
          eventBus,
          modelRouter: options?.modelRouter,
          signal: options?.signal,
        },
        runContext: { runId, userConfig },
      }
    );

    return {
      ok: true,
      report: output?.report || null,
      findings: {
        claims: Array.isArray(output?.claims) ? output.claims : [],
        todos: Array.isArray(output?.todos) ? output.todos : [],
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  } finally {
    unsubscribe?.();
  }
}

/**
 * One-line Design/PPT execution.
 *
 * @param {string} taskGoal - Slide deck goal.
 * @param {ConvenienceRunOptions} [options] - Optional execution settings.
 * @returns {Promise<DesignConvenienceResult>}
 */
export async function runDesign(taskGoal, options = {}) {
  const eventBus = new EventBus();
  const unsubscribe = bindEventCallback(eventBus, options?.onEvent);

  try {
    const { DesignAgentLoop } = await import("../stages/design/agent-loop.js");
    const runId = createRunId("design", { runIdFactory: options?.runIdFactory });
    const maxIterations = toPositiveInt(options?.maxIterations);
    const sources = Array.isArray(options?.sources) ? options.sources : [];
    const normalizedTaskGoal = typeof taskGoal === "string" ? taskGoal : String(taskGoal || "");

    const explicitSlideIntents = sources
      .filter((source) => source && typeof source === "object" && Array.isArray(source.slideIntents))
      .flatMap((source) => source.slideIntents);

    const contentPackage = {
      runId,
      taskGoal: normalizedTaskGoal,
      sources,
      slideIntents: explicitSlideIntents.length > 0 ? explicitSlideIntents : toFallbackSlideIntents(normalizedTaskGoal, sources),
      userConfig: maxIterations ? { maxIterations } : {},
    };

    const loop = new DesignAgentLoop({ eventBus });
    const output = await loop.run(contentPackage, {
      stageApi: {
        eventBus,
        modelRouter: options?.modelRouter,
        signal: options?.signal,
      },
      runContext: {
        runId,
        userConfig: contentPackage.userConfig,
      },
    });

    return {
      ok: true,
      slides: {
        deckHtmlDsl: typeof output?.deckHtmlDsl === "string" ? output.deckHtmlDsl : "",
        slidesMeta: Array.isArray(output?.slidesMeta) ? output.slidesMeta : [],
      },
      findings: {
        review: output?.reviewReport ?? null,
        visual: output?.visualReport ?? null,
        refine: output?.refineReport ?? null,
        pendingImages: Array.isArray(output?.pendingImages) ? output.pendingImages : [],
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  } finally {
    unsubscribe?.();
  }
}
