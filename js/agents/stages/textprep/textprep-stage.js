import { BaseStage } from "../../runtime/index.js";
import { createStageApi } from "../../shared/index.js";
import {
  toRawText,
  resolveStageTraceContext,
  resolveErrorBoundary,
  ensureTraceContext,
  createStageEmitter,
  createShouldDegrade,
  buildFallbackPackage,
  createTracedAiApiService,
  runNormalizeStep,
  runChunkStep,
  runSlidePlanStep,
  runClaimsStep,
  runAlignStep,
  runBuildPackageStep,
} from "./textprep-helpers.js";

/**
 * Text preparation stage that converts input text into a ContentPackage.
 * @extends BaseStage
 */
export class TextPrepStage extends BaseStage {
  constructor(/** @type {{ defaultChunkOptions?: any, eventBus?: any, logger?: any }} */ { defaultChunkOptions, eventBus, logger } = {}) {
    super({ name: "textprep", eventBus, logger });
    this.defaultChunkOptions = defaultChunkOptions || { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  }

  /**
   * @param {string|object} input
   * @param {object} [context]
   * @returns {Promise<object>}
   */
  async run(input, context = {}) {
    const api = createStageApi(context);
    const runContext = api.runContext || { runId: "run_unknown", constraints: {} };
    const traceContext = resolveStageTraceContext(api);
    const errorBoundary = resolveErrorBoundary(api);
    ensureTraceContext(api, traceContext);

    const emit = createStageEmitter(api);
    const rawText = toRawText(input);

    const shouldDegrade = createShouldDegrade(api, runContext);

    const fallbackFactory = () =>
      buildFallbackPackage({
        rawText,
        input,
        runContext,
        defaultChunkOptions: this.defaultChunkOptions,
      });

    return await errorBoundary.wrap(
      async () =>
        await traceContext.withSpan(
          "textprep.run",
          async (runSpan) => {
            runSpan.setAttributes({ runId: runContext?.runId, rawChars: rawText.length });

            const tracedAiApiService = createTracedAiApiService(api.aiApiService, traceContext);

            const normalized = await runNormalizeStep(rawText, traceContext, api, emit);

            const { chunks } = await runChunkStep({
              normalized,
              input,
              defaultChunkOptions: this.defaultChunkOptions,
              traceContext,
              api,
              emit,
            });

            const slideIntents = await runSlidePlanStep({
              chunks,
              runContext,
              traceContext,
              api,
              emit,
              tracedAiApiService,
            });

            const { claims, evidenceLedger } = await runClaimsStep({
              chunks,
              slideIntents,
              normalized,
              traceContext,
              api,
              emit,
            });

            const alignedSlides = await runAlignStep({
              slideIntents,
              claims,
              runContext,
              traceContext,
              api,
              emit,
              tracedAiApiService,
            });

            const pkg = await runBuildPackageStep({
              runContext,
              normalized,
              alignedSlides,
              claims,
              evidenceLedger,
              traceContext,
              api,
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

/**
 * Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
 * @param {object} runContext
 * @param {string|object} input
 * @param {object} [stageApi]
 * @returns {Promise<object>}
 */
export async function runTextPrepStage(runContext, input, stageApi = {}) {
  const stage = new TextPrepStage();
  return stage.execute(runContext, input, stageApi);
}
